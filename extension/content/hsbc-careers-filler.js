/**
 * Taleos — HSBC Careers Filler
 * Remplit le formulaire SAP SuccessFactors HSBC (career2.successfactors.eu, company=hsbcholdin).
 *
 * Flux couvert :
 *   1. Page offre Eightfold (portal.careers.hsbc.com) → clic automatique Apply → SF listing
 *   2. SF listing (career2.successfactors.eu/careers?…) → clic automatique Apply → SF form
 *   3. SF form (career2.successfactors.eu/career?…)    → remplissage complet (sans mot de passe)
 *
 * Source données :  chrome.storage.local.taleos_pending_hsbc.profile
 * Upload CV :       chrome.runtime.sendMessage({ action: 'fetch_storage_file', storagePath })
 *
 * Soumission : automatique après 60 secondes (#fbqa_apply) une fois le formulaire rempli.
 *
 * Noms de fichiers : utilise exactement cv_filename / letter_filename tels que stockés dans Firebase
 * (pas de renommage).
 */
(async () => {
  'use strict';

  // ══════════════════════════════════════════════════════════════════════════════
  // 0. Garde-fous et initialisation
  // ══════════════════════════════════════════════════════════════════════════════
  if (globalThis.__TALEOS_HSBC_FILLER_RUNNING__) return;
  globalThis.__TALEOS_HSBC_FILLER_RUNNING__ = true;

  const BANNER_ID     = 'taleos-hsbc-banner';
  const STORAGE_KEY   = 'taleos_pending_hsbc';
  const TAB_ID_KEY    = 'taleos_hsbc_tab_id';
  const isTop         = window === window.top;
  const blueprint     = globalThis.__TALEOS_HSBC_BLUEPRINT__ || null;

  // ══════════════════════════════════════════════════════════════════════════════
  // 1. Utilitaires de base
  // ══════════════════════════════════════════════════════════════════════════════
  function log(msg) {
    const line = `[HSBC Filler] ${msg}`;
    console.log(line);
    try {
      chrome.runtime.sendMessage({
        action: 'extension_run_log',
        source: 'hsbc-careers-filler',
        level: 'info',
        message: String(msg),
        ts: new Date().toISOString()
      }).catch(() => {});
    } catch (_) {}
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  async function waitFor(fn, timeoutMs = 6000, intervalMs = 250) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const result = fn();
        if (result) return result;
      } catch (_) {}
      await sleep(intervalMs);
    }
    return null;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 2. Récupération du profil
  // ══════════════════════════════════════════════════════════════════════════════
  async function getCurrentTabId() {
    try {
      const res = await chrome.runtime.sendMessage({ action: 'taleos_get_current_tab_id' });
      return res?.tabId || null;
    } catch (_) { return null; }
  }

  async function getPendingEntry() {
    const currentTabId = await getCurrentTabId();
    const stored = await chrome.storage.local.get([STORAGE_KEY, TAB_ID_KEY]);
    const entry = stored[STORAGE_KEY];
    if (!entry?.profile) return null;
    const expectedTabId = entry.tabId || stored[TAB_ID_KEY] || null;
    if (currentTabId && expectedTabId && currentTabId !== expectedTabId) return null;
    return entry;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 3. Normalisation du profil
  // ══════════════════════════════════════════════════════════════════════════════
  function normalizeProfile(raw) {
    // phone_number provient de background.js (déjà sans indicatif ni 0 initial)
    const phone     = String(raw.phone_number || raw['phone-number'] || raw.phone || '').replace(/\D/g, '');
    const phoneCode = String(raw.phone_country_code || '+33').trim();

    // Genre : stocké en anglais (Male/Female/Other) dans Firebase
    // La conversion FR (Mâle/Femelle) se fait dans fillApplicationForm
    const genderRaw = String(raw.gender || '').trim();
    let gender = 'Prefer not to say';
    if (/^male$/i.test(genderRaw))   gender = 'Male';
    if (/^female$/i.test(genderRaw)) gender = 'Female';

    return {
      firstName:      String(raw.firstname || raw.first_name || '').trim(),
      lastName:       String(raw.lastname  || raw.last_name  || '').trim(),
      email:          String(raw.email     || raw.auth_email || '').trim(),
      phoneCode,
      phone,
      gender,
      // Fichiers — noms exacts Firebase (ne pas renommer)
      cvStoragePath:  String(raw.cv_storage_path || '').trim(),
      cvFilename:     String(raw.cv_filename      || '').trim() || null,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 4. Bannière Taleos
  // ══════════════════════════════════════════════════════════════════════════════
  function activateTab() {
    chrome.runtime.sendMessage({ action: 'hsbc_activate_tab' }).catch(() => {});
  }

  function showBanner(text, type = 'info') {
    const api = globalThis.__TALEOS_AUTOMATION_BANNER__;
    let el = document.getElementById(BANNER_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = BANNER_ID;
      if (api) {
        api.applyStyle(el);
      } else {
        Object.assign(el.style, {
          position: 'fixed', top: '0', left: '0', right: '0',
          zIndex: '2147483647', background: '#1a3c6e', color: '#fff',
          padding: '8px 16px', fontSize: '13px', fontFamily: 'sans-serif',
          borderBottom: '2px solid #c8a951', textAlign: 'center'
        });
      }
      document.body.prepend(el);
    }
    if (type === 'success') el.style.background = '#155724';
    if (type === 'warn')    el.style.background = '#856404';
    if (type === 'error')   el.style.background = '#721c24';
    el.textContent = `🏦 Taleos HSBC — ${text}`;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 5. Remplissage des champs texte
  // ══════════════════════════════════════════════════════════════════════════════
  function setNativeValue(el, value) {
    if (!el) return;
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) {
      setter.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur',   { bubbles: true }));
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 6. PaginatedPicklist (widgets SF hors select natif)
  // ══════════════════════════════════════════════════════════════════════════════

  /**
   * Ouvre un paginatedPicklist et sélectionne la valeur cible.
   *
   * Mécanisme SF :
   *   - Chaque widget a un input (N:_input), un bouton (N:_selectButton)
   *   - aria-owns sur l'input → "(N+1):_listSelect" quand la liste est ouverte
   *   - Les options sont des [role="option"] dans cette liste
   */
  async function selectPicklist(inputEl, targetValue, label = '') {
    if (!inputEl) { log(`⚠️ Picklist "${label}" introuvable`); return false; }

    const btnId  = inputEl.id.replace(':_input', ':_selectButton');
    const btn    = document.getElementById(btnId);
    if (btn) btn.click();
    else inputEl.click();

    // Attendre que aria-owns soit défini (liste créée)
    const listId = await waitFor(() => inputEl.getAttribute('aria-owns'), 4000, 150);
    if (!listId) { log(`⚠️ Picklist "${label}" : liste non ouverte`); return false; }

    // Attendre que des options apparaissent
    const list = await waitFor(() => {
      const el = document.getElementById(listId);
      return (el && el.querySelectorAll('[role="option"]').length > 0) ? el : null;
    }, 5000, 200);

    if (!list) { log(`⚠️ Picklist "${label}" : options non chargées`); return false; }

    const options = Array.from(list.querySelectorAll('[role="option"]'));
    const target  = options.find(o => o.textContent.trim() === targetValue);
    if (!target) {
      log(`⚠️ Picklist "${label}" : option "${targetValue}" introuvable. Disponibles : ${options.map(o => o.textContent.trim()).join(' | ')}`);
      return false;
    }

    target.click();
    log(`✅ ${label || 'Picklist'} → "${targetValue}"`);
    return true;
  }

  /**
   * Sélectionne l'indicatif téléphonique en tapant dans le champ (filtrage de la liste).
   * Le champ 9:_input est un combobox avec > 200 options — on filtre par saisie.
   */
  async function selectCallingCode(code) {
    const input = document.getElementById('9:_input');
    if (!input) { log('⚠️ Champ indicatif (9:_input) introuvable'); return false; }

    setNativeValue(input, code);
    await sleep(700); // laisser le filtre s'appliquer

    const listId = input.getAttribute('aria-owns');
    const list   = listId ? document.getElementById(listId) : null;
    if (!list) { log(`⚠️ Indicatif : liste non trouvée`); return false; }

    const options = Array.from(list.querySelectorAll('[role="option"]'));
    const target  = options.find(o => o.textContent.trim() === code);
    if (target) {
      target.click();
      log(`✅ Indicatif → "${code}"`);
      return true;
    }

    // Fallback : premier résultat si le code exact n'est pas là (ex. "+33" vs "+33 France")
    if (options.length > 0 && options[0].textContent.trim().startsWith(code)) {
      options[0].click();
      log(`✅ Indicatif (approx.) → "${options[0].textContent.trim()}"`);
      return true;
    }

    log(`⚠️ Indicatif "${code}" non trouvé dans la liste filtrée`);
    return false;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 7. Upload CV depuis Firebase Storage
  // ══════════════════════════════════════════════════════════════════════════════
  /**
   * Télécharge le CV depuis Firebase Storage et l'injecte directement dans
   * l'input[name="fileData1"] du widget SF (toujours présent dans le DOM).
   * L'onchange JUIC déclenche l'upload côté SF, qu'un CV existe déjà ou non.
   * On remplace TOUJOURS — la version Firebase est la plus à jour.
   */
  async function uploadCV(storagePath, filename) {
    if (!storagePath) { log('   ⚠️ CV : cv_storage_path absent → skip'); return false; }

    // Lire le nom du CV déjà affiché (si présent)
    const existingLabel = document.querySelector('[id$="_attachDownloadLabelLink"]');
    const existingName  = existingLabel ? existingLabel.textContent.trim() : 'aucun';
    const targetName    = String(filename || '?').trim();
    log(`   CV : formulaire='${existingName}' | Firebase='${targetName}' → Remplacement (toujours à jour)`);

    // Télécharger depuis Firebase AVANT toute interaction UI
    const r = await chrome.runtime.sendMessage({ action: 'fetch_storage_file', storagePath }).catch(() => null);
    if (!r?.base64) { log(`   ⚠️ CV introuvable dans Firebase Storage (${storagePath})`); return false; }

    // L'input file est toujours présent dans le DOM SF (même quand un CV existe déjà).
    // On lui injecte directement le fichier — l'onchange JUIC ("uploadFiles") déclenche l'upload.
    // Pas besoin de cliquer le crayon ni d'ouvrir un sous-menu.
    const fileInput = document.querySelector('input[name="fileData1"]');
    if (!fileInput) { log('   ⚠️ input[name="fileData1"] introuvable'); return false; }

    // Nom exact Firebase — jamais renommé
    const effectiveFilename = String(filename || r.filename || '').trim();
    if (!effectiveFilename) { log('   ⚠️ CV : nom de fichier absent (cv_filename non défini dans Firebase)'); return false; }
    const bin   = atob(r.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], effectiveFilename, { type: r.type || 'application/pdf' });

    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    // Déclencher l'onchange JUIC qui lance l'upload SF
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    fileInput.dispatchEvent(new Event('input',  { bubbles: true }));

    log(`   ⏳ Upload en cours : "${effectiveFilename}"…`);

    // Attendre confirmation d'upload (icône succès JUIC visible, IDs dynamiques)
    const success = await waitFor(() => {
      const el = document.querySelector('[id$="_attachSuccess"]:not(.displayNone)');
      return el || null;
    }, 25000, 500);

    if (success) {
      log(`   ✅ CV → remplacé par "${effectiveFilename}"`);
      return true;
    }

    // Fallback : vérifier que le label du CV a changé
    const newLabel = document.querySelector('[id$="_attachDownloadLabelLink"]');
    const newName  = newLabel ? newLabel.textContent.trim() : '';
    if (newName && newName !== existingName) {
      log(`   ✅ CV → label mis à jour : "${newName}"`);
      return true;
    }

    // Fallback 2 : fbja_uploadedResumeId rempli
    const uploadedId = document.getElementById('fbja_uploadedResumeId');
    if (uploadedId?.value) {
      log(`   ✅ CV → uploadé (fbja_uploadedResumeId="${uploadedId.value}") : "${effectiveFilename}"`);
      return true;
    }

    log(`   ⚠️ Timeout upload CV (25s) — vérifiez que "${effectiveFilename}" est bien chargé`);
    return false;
  }
  // 8. Acceptation de la politique de confidentialité
  // ══════════════════════════════════════════════════════════════════════════════
  async function acceptPrivacy() {
    const link = document.getElementById('dataPrivacyId');
    if (!link) { log('⚠️ Lien confidentialité (dataPrivacyId) introuvable'); return false; }

    // Cliquer le lien ouvre une modale avec boutons "Accept" / "Decline" / "Print"
    link.click();
    await sleep(800);

    // Chercher le bouton "Accept" dans la modale
    const acceptBtn = await waitFor(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.find(b => b.textContent.trim() === 'Accept') || null;
    }, 4000, 200);

    if (acceptBtn) {
      acceptBtn.click();
      await sleep(500);
      log('✅ Politique de confidentialité → bouton "Accept" cliqué');
    } else {
      log('⚠️ Bouton "Accept" non trouvé dans la modale — tentative fallback');
    }

    // Vérifier l'acceptation : fbclc_dpcsId non vide + texte de confirmation
    const dpcsInput = document.getElementById('fbclc_dpcsId');
    if (dpcsInput?.value) {
      log(`✅ Politique acceptée (fbclc_dpcsId="${dpcsInput.value}")`);
    } else if (dpcsInput) {
      // Fallback : forcer si la modale n'a pas pu être cliquée
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(dpcsInput, '1');
      dpcsInput.dispatchEvent(new Event('change', { bubbles: true }));
      log('✅ Politique de confidentialité acceptée (fbclc_dpcsId forcé à "1")');
    }

    return true;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 9. Remplissage du formulaire principal (SF portalcareer application form)
  // ══════════════════════════════════════════════════════════════════════════════

  /**
   * Cherche un input de paginatedPicklist dont le label contient l'un des mots-clés.
   * Fallback quand l'ID numérique hardcodé ne correspond pas (numérotation SF variable).
   */
  function findPicklistInputByLabel(keywords) {
    const inputs = Array.from(document.querySelectorAll('[id$=":_input"]'));
    const kw = keywords.map(k => k.toLowerCase());
    for (const input of inputs) {
      // 1. aria-labelledby
      const lblId = input.getAttribute('aria-labelledby');
      if (lblId) {
        const lbl = document.getElementById(lblId);
        if (lbl && kw.some(k => lbl.textContent.toLowerCase().includes(k))) return input;
      }
      // 2. label[for=id]
      const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (label && kw.some(k => label.textContent.toLowerCase().includes(k))) return input;
      // 3. Texte du conteneur parent (souvent un <div class="..."> avec un <label> enfant)
      const container = input.closest('.sf-ui-formElement, .app-form-field, [class*="form"]');
      if (container) {
        const containerText = container.textContent.toLowerCase();
        if (kw.some(k => containerText.includes(k))) return input;
      }
    }
    return null;
  }

  /**
   * Sélectionne une valeur dans un picklist (paginatedPicklist SF).
   * Lit d'abord la valeur actuelle et skip si déjà correcte.
   * Essaie plusieurs variantes texte (EN/FR) pour la localisation.
   */
  async function selectPicklistMulti(inputEl, candidates, label = '') {
    if (!inputEl) { log(`   ⚠️ Picklist "${label}" introuvable`); return false; }

    // Normalise : retire espaces insécables (U+00A0), trim
    const norm = s => String(s || '').replace(/ /g, ' ').replace(/ {2,}/g, ' ').trim();

    const candidatesNorm = candidates.map(c => norm(c)).filter(Boolean);
    const firebaseVal    = candidatesNorm[0] || '';

    // Lire la valeur actuelle affichée dans l'input texte du picklist SF
    const currentVal = norm(inputEl.value);

    // Skip si déjà la bonne valeur
    if (currentVal && candidatesNorm.some(c => c === currentVal)) {
      log(`   ✅ ${label} : formulaire='${currentVal}' | Firebase='${firebaseVal}' → Skip`);
      return true;
    }

    log(`   ✏️ ${label} : formulaire='${currentVal || 'vide'}' | Firebase='${firebaseVal}' → Renseignement`);

    const btnId = inputEl.id.replace(':_input', ':_selectButton');
    const btn   = document.getElementById(btnId);
    if (btn) btn.click(); else inputEl.click();

    const listId = await waitFor(() => inputEl.getAttribute('aria-owns'), 4000, 150);
    if (!listId) { log(`   ⚠️ ${label} : liste non ouverte`); return false; }

    const list = await waitFor(() => {
      const el = document.getElementById(listId);
      return (el && el.querySelectorAll('[role="option"]').length > 0) ? el : null;
    }, 5000, 200);
    if (!list) { log(`   ⚠️ ${label} : options non chargées`); return false; }

    const options   = Array.from(list.querySelectorAll('[role="option"]'));
    const available = options.map(o => norm(o.textContent));

    for (const candidate of candidates) {
      const cn = norm(candidate);
      const target = options.find(o => norm(o.textContent) === cn);
      if (target) {
        target.click();
        log(`   ✅ ${label} → "${cn}"`);
        return true;
      }
    }
    log(`   ⚠️ ${label} : aucune valeur parmi [${candidatesNorm.join('|')}]. Disponibles : ${available.join(' | ')}`);
    return false;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 9a. Détection "déjà postulé"
  // ══════════════════════════════════════════════════════════════════════════════
  /**
   * Appelé dès qu'on détecte le message "Vous avez déjà postulé pour ce poste."
   * Notifie le background (mise à jour tuile + fermeture onglet) et vide le storage.
   */
  async function handleAlreadyApplied(profile) {
    const jobId    = profile.jobId    || profile.job_id    || '';
    const jobTitle = profile.jobTitle || profile.job_title || '';
    const offerUrl = profile.offerUrl || profile.offer_url || location.href;

    log('⚠️ Candidature HSBC déjà soumise pour cette offre — mise à jour tuile et fermeture onglet');
    showBanner('⚠️ Déjà postulé pour cette offre — fermeture dans 3s…', 'warn');

    await chrome.runtime.sendMessage({
      action: 'candidature_already_applied',
      bankId: 'hsbc',
      jobId,
      jobTitle,
      companyName: 'HSBC',
      offerUrl,
    }).catch(() => null);

    await chrome.storage.local.remove([STORAGE_KEY, TAB_ID_KEY]);
  }

  /**
   * Vérifie si la page contient un message "déjà postulé" HSBC.
   * Retourne true si détecté (et déclenche handleAlreadyApplied).
   */
  async function checkAlreadyApplied(profile) {
    const text = document.body?.innerText || '';
    const alreadyApplied =
      /vous avez d[ée]j[àa] postul[ée]/i.test(text) ||
      /you have already applied/i.test(text) ||
      /already applied for this (job|position)/i.test(text);
    if (alreadyApplied) {
      await handleAlreadyApplied(profile);
      return true;
    }
    return false;
  }

  async function fillApplicationForm(profile) {
    const p = normalizeProfile(profile);
    log(`Remplissage HSBC — ${p.firstName} ${p.lastName} <${p.email}>`);
    log('── Firebase snapshot ─────────────────────────────────');
    log(`   Genre     : ${profile.gender || '—'} (→ formulaire: ${/^male$/i.test(profile.gender||'') ? 'Mâle' : /^female$/i.test(profile.gender||'') ? 'Femelle' : 'Prefer not to say'})`);
    log(`   Famille   : ${profile.hsbc_family_at_hsbc || '—'}`);
    log(`   Ancien emp: ${profile.hsbc_former_employee || '—'}${profile.hsbc_employee_id ? ' (ID: ' + profile.hsbc_employee_id + ')' : ''}`);
    log(`   Travail   : ${profile.hsbc_work_right || '—'}`);
    log(`   Auditeurs : ${profile.hsbc_auditors_employee || '—'}`);
    log('── Remplissage ───────────────────────────────────────');
    showBanner('Remplissage en cours…');

    // Attendre que le formulaire soit prêt (jusqu'à 10s)
    // fbclc_userName = champ email du formulaire nouveau compte (non connecté)
    // Pour un utilisateur déjà connecté (/portalcareer), ce champ est absent — on continue quand même
    await sleep(600);

    // Détecter "Vous avez déjà postulé pour ce poste." avant tout remplissage
    if (await checkAlreadyApplied(profile)) return;

    const emailField = document.getElementById('fbclc_userName');

    if (emailField) {
      // ── Identifiants (formulaire nouveau compte) ──
      setNativeValue(emailField, p.email);
      await sleep(150);
      const emailConf = document.getElementById('fbclc_emailConf');
      if (emailConf) setNativeValue(emailConf, p.email);
      log(`✅ Email → ${p.email}`);
    } else {
      log('ℹ️ fbclc_userName absent — utilisateur déjà connecté');
      showBanner('Remplissage en cours…');
    }

    // ── Noms ────────────────────────────────────────────────────────────────────
    const fName = document.getElementById('fbclc_fName');
    if (fName) { setNativeValue(fName, p.firstName); log(`✅ Prénom légal → ${p.firstName}`); }

    const lName = document.getElementById('fbclc_lName');
    if (lName) { setNativeValue(lName, p.lastName); log(`✅ Nom légal → ${p.lastName}`); }

    const prefName = document.getElementById('tor__fcust_PrefFName');
    if (prefName) { setNativeValue(prefName, p.firstName); log(`✅ Prénom préféré → ${p.firstName}`); }

    // ── Téléphone ────────────────────────────────────────────────────────────────
    await sleep(300);
    await selectCallingCode(p.phoneCode);
    await sleep(200);
    const phoneField = document.getElementById('tor__fcellPhone');
    if (phoneField) { setNativeValue(phoneField, p.phone); log(`✅ Téléphone → ${p.phone}`); }

    // ── Questions HSBC spécifiques ────────────────────────────────────────────────
    // Le formulaire est en fr_FR → options en français. On essaie FR puis EN (robustesse).
    await sleep(400);

    // Famille travaillant chez HSBC (depuis profil Firebase, défaut : Non)
    const hsbcFamily = profile.hsbc_family_at_hsbc || 'Non';
    const familyInput = document.getElementById('13:_input')
      || findPicklistInputByLabel(['famille', 'family', 'relative', 'proche']);
    await selectPicklistMulti(familyInput, [hsbcFamily, hsbcFamily === 'Non' ? 'No' : 'Yes'], 'Proches HSBC');
    await sleep(350);

    // Si famille = Oui → remplir le champ texte détails famille
    if (hsbcFamily === 'Oui') {
      const familyDetails = String(profile.hsbc_family_details || '').trim();
        if (familyDetails) {
        // Attendre l'apparition du champ texte conditionnel
        const familyTextarea = await waitFor(
          () => Array.from(document.querySelectorAll('textarea, input[type="text"]'))
            .find(el => {
              const lbl = el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
              return /famille|family|relative|nom.*hsbc|hsbc.*nom/i.test(lbl)
                || /famille|family|relative/i.test(el.closest('[class*="form"]')?.textContent || '');
            }),
          3000, 300
        );
        if (familyTextarea) { setNativeValue(familyTextarea, familyDetails); log(`✅ Détails famille → rempli`); }
        else { log('⚠️ Champ texte détails famille introuvable'); }
      }
      await sleep(300);
    }

    // Ancien employé / prestataire (depuis profil Firebase, défaut : Non)
    const hsbcFormer = profile.hsbc_former_employee || 'Non';
    const formerInput = document.getElementById('17:_input')
      || findPicklistInputByLabel(['ancien', 'former', 'contractor', 'prestataire', 'employé']);
    await selectPicklistMulti(formerInput, [hsbcFormer, hsbcFormer === 'Non' ? 'No' : 'Yes'], 'Ancien employé HSBC');
    await sleep(350);

    // Si ancien employé = Oui → remplir l'Employee ID
    if (hsbcFormer === 'Oui') {
      const empId = String(profile.hsbc_employee_id || '').trim();
        if (empId) {
        const empIdField = await waitFor(
          () => Array.from(document.querySelectorAll('input[type="text"], input:not([type])'))
            .find(el => {
              const lbl = el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
              return /employee.?id|emp.?id|identifiant/i.test(lbl)
                || /employee.?id|emp.?id|identifiant/i.test(el.closest('[class*="form"]')?.textContent || '');
            }),
          3000, 300
        );
        if (empIdField) { setNativeValue(empIdField, empId); log(`✅ Employee ID → ${empId}`); }
        else { log('⚠️ Champ Employee ID introuvable'); }
      }
      await sleep(300);
    }

    // Genre — le formulaire utilise Mâle/Femelle/Prefer not to say
    const genderRaw = String(profile.gender || '').trim();
    const isMale   = /^male$/i.test(genderRaw);
    const isFemale = /^female$/i.test(genderRaw);
    const genderCandidates = isMale
      ? ['Mâle', 'Male', 'Homme', 'M']
      : isFemale
        ? ['Femelle', 'Female', 'Femme', 'F']
        : ['Prefer not to say', 'Je préfère ne pas répondre', 'Autre', 'Other'];
    const genderInput = document.getElementById('21:_input')
      || findPicklistInputByLabel(['sexe', 'gender', 'genre']);
    await selectPicklistMulti(genderInput, genderCandidates, 'Genre');
    await sleep(350);

    // Droit au travail (depuis profil Firebase, défaut : Oui)
    const hsbcWorkRight = profile.hsbc_work_right || 'Oui';
    const workRightInput = document.getElementById('25:_input')
      || findPicklistInputByLabel(['autorisé', 'autorisation', 'travail', 'work', 'legally']);
    await selectPicklistMulti(workRightInput, [hsbcWorkRight, hsbcWorkRight === 'Oui' ? 'Yes' : 'No'], 'Droit au travail');
    await sleep(350);

    // Auditeurs externes HSBC (depuis profil Firebase, défaut : Non)
    const hsbcAuditors = profile.hsbc_auditors_employee || 'Non';
    const auditorsInput = document.getElementById('29:_input')
      || findPicklistInputByLabel(['audit', 'auditeur', 'external audit']);
    await selectPicklistMulti(auditorsInput, [hsbcAuditors, hsbcAuditors === 'Non' ? 'No' : 'Yes'], 'Auditeurs externes HSBC');
    await sleep(350);

    // ── Pays ─────────────────────────────────────────────────────────────────────
    const countrySelect = document.getElementById('fbclc_country');
    if (countrySelect) {
      const franceOpt = Array.from(countrySelect.options).find(o => o.text === 'France');
      if (franceOpt) {
        countrySelect.value = franceOpt.value;
        countrySelect.dispatchEvent(new Event('change', { bubbles: true }));
        log('✅ Pays → France');
      } else {
        log("⚠️ Option 'France' introuvable dans le select pays");
      }
    }

    // ── Visibilité du profil → "Only recruiters managing jobs I apply to" (value=2) ──
    const searPrefRadios = document.querySelectorAll('input[name="fbclc_searPref"]');
    for (const r of searPrefRadios) {
      if (r.value === '2') {
        r.checked = true;
        r.dispatchEvent(new Event('change', { bubbles: true }));
        log('✅ Visibilité profil → recruteurs gérant les offres auxquelles je postule uniquement');
        break;
      }
    }

    // ── Notifications email → décocher (profil discret) ──────────────────────────
    const emailNotif = document.getElementById('fbclc_emailEnabled');
    if (emailNotif?.checked) {
      emailNotif.click();
      log('✅ Notifications email → décochées');
    }

    // ── Upload CV ────────────────────────────────────────────────────────────────
    await sleep(500);
    if (p.cvStoragePath) {
      await uploadCV(p.cvStoragePath, p.cvFilename);
    } else {
      log('⚠️ cv_storage_path absent dans le profil — uploadez le CV manuellement');
    }

    // ── Politique de confidentialité ──────────────────────────────────────────────
    await sleep(500);
    await acceptPrivacy();

    // ── Fin : soumission automatique après 60 secondes ─────────────────────────
    log('✅ Formulaire rempli — soumission automatique dans 60 secondes');
    activateTab();

    let remaining = 60;
    showBanner(`✅ Formulaire rempli — soumission dans ${remaining}s…`, 'success');
    const countdown = setInterval(() => {
      remaining--;
      if (remaining > 0) {
        showBanner(`✅ Formulaire rempli — soumission dans ${remaining}s…`, remaining <= 10 ? 'warn' : 'success');
      } else {
        clearInterval(countdown);
        const submitBtn = document.getElementById('fbqa_apply');
        if (submitBtn) {
          log('✅ Soumission automatique (fbqa_apply)');
          submitBtn.click();
          showBanner('✅ Candidature soumise !', 'success');
        } else {
          log('⚠️ Bouton "Postuler" (fbqa_apply) introuvable — cliquez manuellement');
          showBanner('⚠️ Cliquez sur "Postuler" pour soumettre', 'warn');
        }
      }
    }, 1000);
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 10. Gestion des pages SF listing et Eightfold (clic automatique Apply)
  // ══════════════════════════════════════════════════════════════════════════════
  async function handleListingPage(profile) {
    log('Page listing SF HSBC — attente bouton Apply…');
    showBanner('Ouverture du formulaire de candidature…');

    const applyBtn = await waitFor(
      () =>
        document.getElementById('applyButton_top') ||
        document.getElementById('applyButton_bottom') ||
        document.querySelector('[data-test-id="apply-button"]') ||
        document.querySelector('[class*="position-apply-button"]') ||
        Array.from(document.querySelectorAll('button')).find(b =>
          /apply|postuler|candidater/i.test(b.textContent)
        ),
      10000
    );
    if (!applyBtn) {
      log('⚠️ Bouton Apply introuvable sur la page SF listing');
      showBanner('Bouton Apply non trouvé — cliquez manuellement', 'warn');
      activateTab();
      return;
    }

    applyBtn.click();
    log('✅ Clic Apply → navigation vers le formulaire candidature');
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // Cas Login page : connexion avec identifiants existants
  // ══════════════════════════════════════════════════════════════════════════════
  async function handleLoginPage(profile, offerUrl) {
    log('Page Sign In SF HSBC — connexion avec identifiants enregistrés…');
    showBanner('Connexion à votre compte HSBC…');

    const emailInput = await waitFor(
      () =>
        document.getElementById('username') ||
        document.querySelector('input[name="logonID"]') ||
        document.querySelector('input[autocomplete="username"]') ||
        document.querySelector('input[type="email"]') ||
        document.querySelector('input[name="email"]') ||
        document.querySelector('input[id*="email" i]') ||
        document.querySelector('input[placeholder*="email" i]') ||
        // Formulaire "Career Opportunities: Sign In" (HSBC SF loginFlowRequired)
        document.querySelector('input[id*="user" i]:not([type="hidden"])') ||
        Array.from(document.querySelectorAll('input:not([type="password"]):not([type="hidden"])')).find(
          el => /email|user|login/i.test(el.id + el.name + el.placeholder)
        ),
      8000
    );
    const pwdInput = await waitFor(
      () => document.getElementById('password') || document.querySelector('input[type="password"]'),
      8000
    );

    if (!emailInput || !pwdInput) {
      log('⚠️ Champs email/mot de passe introuvables sur la page Sign In');
      showBanner('Champs de connexion non trouvés — remplissez manuellement', 'warn');
      return;
    }

    setNativeValue(emailInput, profile.auth_email);
    await sleep(300);
    setNativeValue(pwdInput, profile.auth_password || '');
    await sleep(300);

    const submitBtn =
      document.querySelector('button[onclick*="validateFields"]') ||
      document.querySelector('.aquabtn.active button, .button_row button') ||
      Array.from(document.querySelectorAll('button')).find(b => /sign in/i.test(b.textContent));

    if (!submitBtn) {
      log('⚠️ Bouton Sign In introuvable');
      showBanner('Bouton Sign In non trouvé — cliquez manuellement', 'warn');
      return;
    }

    submitBtn.click();
    log('✅ Clic Sign In → attente connexion');
    showBanner('Connexion en cours…');

    // Attendre que la page de connexion disparaisse (succès) OU qu'un message d'erreur apparaisse
    const loginResult = await waitFor(() => {
      const errorEl = document.querySelector('#errorMsg_1, #uiErrorMsg, #uiErrorContainer_2');
      if (errorEl && errorEl.offsetParent !== null) {
        return { error: errorEl.innerText?.trim() || 'Identifiants incorrects' };
      }
      // Succès : champ email disparu ou URL changée
      const loginForm = document.querySelector('#username') || document.querySelector('input[name="logonID"]');
      if (!loginForm || loginForm.offsetParent === null) {
        return { success: true };
      }
      return null; // En attente
    }, 12000, 400);

    if (loginResult?.error) {
      log(`❌ Connexion échouée : ${loginResult.error}`);
      showBanner(`Connexion HSBC échouée : ${loginResult.error}`, 'error');
      return;
    }

    log('✅ Connexion HSBC réussie');

    if (!offerUrl) {
      showBanner('Connecté ! Naviguez manuellement vers l\'offre HSBC', 'warn');
      return;
    }

    log(`→ Navigation vers l'offre : ${offerUrl}`);
    showBanner('Connecté ! Ouverture de l\'offre…');
    await sleep(600);
    location.href = offerUrl;
  }

  /**
   * Cherche l'URL de candidature SF dans les scripts Eightfold.
   *
   * Priorité :
   *   1. URL portalcareer complète dans les scripts inline (inclut _s.crb si présent)
   *   2. ats_job_id → construit portalcareer?career_ns=job_application (pas job_listing !)
   *   3. Fallback ats_job_id dans le HTML brut
   *
   * IMPORTANT : on cible career_ns=job_application et non job_listing.
   *   job_listing redirige vers apply.careers.hsbc.com — ce n'est pas le bon flux.
   *   job_application va directement au formulaire SF (portalcareer).
   */
  function extractSFApplyUrl() {
    try {
      // Normaliser les slashes JSON-échappés (\/ → /) pour les regex
      const normalize = str => str.replace(/\\\//g, '/').replace(/\\u0026/g, '&');

      // 1. Chercher l'URL portalcareer complète dans les scripts inline
      //    Eightfold l'embarque dans le JSON de la page (avec _s.crb si l'utilisateur est connecté)
      for (const s of document.querySelectorAll('script:not([src])')) {
        const raw = s.textContent || '';
        if (!raw.includes('career2.successfactors.eu')) continue;
        const text = normalize(raw);
        const m = text.match(/https?:\/\/career2\.successfactors\.eu\/portalcareer[^"'\s<>]*/);
        if (m && m[0].includes('hsbcholdin')) {
          log(`URL portalcareer directe trouvée dans <script> : ${m[0]}`);
          return m[0];
        }
      }

      // 2. Chercher ats_job_id → construire URL candidature directe
      for (const s of document.querySelectorAll('script:not([src])')) {
        const text = s.textContent || '';
        if (!text.includes('ats_job_id')) continue;
        const m = text.match(/"ats_job_id"\s*:\s*"(\d+)"/);
        if (m && m[1]) {
          const sfUrl = `https://career2.successfactors.eu/portalcareer?company=hsbcholdin&career_ns=job_application&src=Eightfold&career_job_req_id=${m[1]}&lang=fr_FR`;
          log(`ats_job_id=${m[1]} → URL candidature SF : ${sfUrl}`);
          return sfUrl;
        }
      }

      // 3. Fallback : ats_job_id dans le HTML brut
      const bodyHtml = normalize(document.documentElement.innerHTML);
      const m2 = bodyHtml.match(/"ats_job_id"\s*:\s*"(\d+)"/);
      if (m2 && m2[1]) {
        const sfUrl = `https://career2.successfactors.eu/portalcareer?company=hsbcholdin&career_ns=job_application&src=Eightfold&career_job_req_id=${m2[1]}&lang=fr_FR`;
        log(`ats_job_id=${m2[1]} (fallback HTML) → URL candidature SF : ${sfUrl}`);
        return sfUrl;
      }
    } catch (_) {}
    return null;
  }

  /**
   * Tente d'extraire l'URL de candidature SF depuis le React fiber du bouton Apply.
   *
   * Le bouton [data-test-id="apply-button"] est rendu par React/Eightfold.
   * Son composant parent stocke l'URL (avec _s.crb) dans ses props/state.
   * On remonte le fiber jusqu'à trouver une URL career2.successfactors.eu.
   */
  function extractApplyUrlFromButtonFiber() {
    try {
      const btn = document.querySelector('[data-test-id="apply-button"]');
      if (!btn) return null;

      const fiberKey = Object.keys(btn).find(k =>
        k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
      );
      if (!fiberKey) { log('React fiber non trouvé sur le bouton Apply'); return null; }

      let fiber = btn[fiberKey];
      for (let depth = 0; fiber && depth < 30; fiber = fiber.return, depth++) {
        let dataStr = '';
        try { dataStr += JSON.stringify(fiber.memoizedProps || {}); } catch (_) {}
        try { dataStr += JSON.stringify(fiber.memoizedState || {}); } catch (_) {}
        if (!dataStr || !dataStr.includes('career2.successfactors.eu')) continue;

        // Normaliser les slashes échappés
        const text = dataStr.replace(/\\\//g, '/').replace(/\\u0026/g, '&');
        const m = text.match(/https?:\/\/career2\.successfactors\.eu\/portalcareer[^"'\s\\]*/);
        if (m && m[0].includes('hsbcholdin')) {
          log(`URL portalcareer trouvée dans React fiber (depth=${depth}) : ${m[0]}`);
          return m[0];
        }
      }
    } catch (_) {}
    return null;
  }

  async function handleEightfoldOffer(profile) {
    log('Page offre Eightfold HSBC — extraction URL candidature…');
    showBanner('Récupération du lien de candidature…');

    // ── Stratégie A : interception window.open dans le MAIN world ──────────────
    //
    // Le filler tourne dans l'isolated world de Chrome.
    // On demande au background d'injecter le patch via chrome.scripting.executeScript
    // avec world:'MAIN' — cette API bypasse le CSP de la page (contrairement à <script>).
    //
    // Canal de communication MAIN ↔ isolated : CustomEvent sur le document partagé.
    //
    // Quand le bouton appelle window.open(url_avec_s_crb) :
    //   MAIN world : capture l'URL, émet '__taleos_hsbc_url__'
    //   Isolated world (ce code) : reçoit l'event, navigue dans le même onglet

    const applyBtn = await waitFor(
      () => document.querySelector('[data-test-id="apply-button"]'),
      10000
    );

    if (applyBtn) {
      log('Bouton Apply trouvé — injection intercepteur window.open (background → MAIN world)…');

      // Demander au background d'injecter le patch dans le MAIN world
      const patchResult = await chrome.runtime.sendMessage({ action: 'hsbc_inject_mainworld_patch' })
        .catch(() => ({ ok: false, error: 'sendMessage failed' }));
      log(`Patch MAIN world : ${patchResult?.ok ? 'OK' : 'Échec — ' + (patchResult?.error || '?')}`);

      // Écouter le CustomEvent (le MAIN world va l'émettre sur document)
      let capturedUrl = null;
      const urlListener = (e) => { capturedUrl = String(e.detail || ''); };
      document.addEventListener('__taleos_hsbc_url__', urlListener, { once: true });

      // Nettoyer le dataset de toute capture précédente
      delete document.documentElement.dataset.taleosHsbcUrl;

      // Cliquer sur le bouton (isolated world → déclenche le handler MAIN world d'Eightfold)
      applyBtn.click();
      await sleep(1000);

      document.removeEventListener('__taleos_hsbc_url__', urlListener);

      // Fallback : lire aussi le dataset (double sécurité si l'event était déjà passé)
      const finalUrl = capturedUrl || document.documentElement.dataset.taleosHsbcUrl || '';

      if (finalUrl && finalUrl.includes('career2.successfactors.eu')) {
        log(`✅ URL capturée via CustomEvent/dataset MAIN world : ${finalUrl}`);
        showBanner('Navigation vers le formulaire de candidature…');
        await sleep(300);
        location.href = finalUrl;
        return;
      }
      log('Interception window.open : URL non capturée (Eightfold vérifie probablement event.isTrusted)');
    } else {
      log('⚠️ Bouton [data-test-id="apply-button"] non trouvé');
    }

    // ── Stratégie B : URL dans les données de la page ──────────────────────────
    // React fiber du bouton → scripts inline → ats_job_id + portalcareer
    let sfUrl = null;
    const deadline = Date.now() + 5000;
    while (!sfUrl && Date.now() < deadline) {
      sfUrl = extractApplyUrlFromButtonFiber() || extractSFApplyUrl();
      if (!sfUrl) await sleep(300);
    }

    if (sfUrl) {
      log(`✅ URL SF extraite de la page → navigation : ${sfUrl}`);
      showBanner('Redirection vers le formulaire de candidature…');
      await sleep(400);
      location.href = sfUrl;
    } else {
      log('⚠️ URL candidature introuvable dans la page Eightfold');
      showBanner('Lien SF non trouvé — cliquez manuellement sur Postulez maintenant', 'warn');
      activateTab();
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 11. Gestion de la page apply.careers.hsbc.com (intermédiaire HSBC)
  // ══════════════════════════════════════════════════════════════════════════════
  /**
   * apply.careers.hsbc.com/job/TITLE/JOB_ID/
   *
   * Cette page est un intermédiaire entre la fiche SF listing et le formulaire de
   * candidature. Elle affiche un bouton "POSTULER". Stratégie :
   *
   *  1. Chercher ats_job_id dans le HTML (peut-être présent comme sur Eightfold)
   *  2. Extraire l'ID numérique du path URL et l'essayer comme career_job_req_id SF
   *  3. Chercher le bouton/lien POSTULER et naviguer via son href (si c'est un <a>)
   *  4. Fallback : clic programmatique sur le bouton
   */
  async function handleApplyCareerPage(profile) {
    log('Page apply.careers.hsbc.com — recherche bouton POSTULER…');
    showBanner('Ouverture du formulaire de candidature…');

    // Détecter "déjà postulé" sur cette page intermédiaire aussi
    if (await checkAlreadyApplied(profile)) return;

    // 1. Chercher ats_job_id dans la page (cas rare — peut être absent)
    let sfUrl = null;
    const deadline1 = Date.now() + 2000;
    while (!sfUrl && Date.now() < deadline1) {
      sfUrl = extractSFApplyUrl();
      if (!sfUrl) await sleep(300);
    }
    if (sfUrl) {
      log(`✅ URL SF via ats_job_id → navigation : ${sfUrl}`);
      showBanner('Redirection vers la fiche poste SF…');
      await sleep(400);
      location.href = sfUrl;
      return;
    }

    // 2. Trouver le bouton POSTULER (data-test-id fiable, puis texte)
    // ATTENTION : "Postulez maintenant" ≠ "Postuler" — utiliser /postule/i pour couvrir les deux
    const applyEl = await waitFor(() =>
      document.querySelector('[data-test-id="apply-button"]') ||
      document.querySelector('[data-test-id*="apply"]') ||
      Array.from(document.querySelectorAll('a, button')).find(
        el => /postule|apply/i.test(el.textContent.trim())
      ) ||
      null,
      10000
    );

    if (!applyEl) {
      log('⚠️ Bouton POSTULER introuvable sur apply.careers.hsbc.com');
      showBanner('Bouton POSTULER non trouvé — cliquez manuellement', 'warn');
      activateTab();
      return;
    }
    log(`Bouton trouvé : <${applyEl.tagName.toLowerCase()} data-test-id="${applyEl.dataset?.testId || ''}">`);

    // 3. Si c'est un <a> avec href → naviguer directement (sans problème isTrusted)
    const directHref = applyEl.tagName === 'A' ? applyEl.getAttribute('href') : null;
    if (directHref && (directHref.startsWith('http') || directHref.startsWith('/'))) {
      const target = directHref.startsWith('http') ? directHref : new URL(directHref, location.origin).href;
      log(`✅ <a href> POSTULER → navigation : ${target}`);
      showBanner('Navigation vers le formulaire…');
      await sleep(300);
      location.href = target;
      return;
    }

    // 4. Intercepter window.open avant le clic pour capturer l'URL
    // (Le bouton peut appeler window.open() — on détourne vers location.href)
    let capturedUrl = null;
    const origOpen = window.open;
    window.open = function(url) {
      capturedUrl = url ? String(url) : null;
      log(`window.open intercepté → URL capturée : ${capturedUrl}`);
      return null; // empêcher l'ouverture du popup
    };

    applyEl.click();
    await sleep(600);
    window.open = origOpen;

    if (capturedUrl) {
      log(`✅ URL window.open capturée → navigation : ${capturedUrl}`);
      showBanner('Navigation vers le formulaire de candidature…');
      await sleep(200);
      location.href = capturedUrl;
      return;
    }

    // 5. Si pas de capture, le clic a peut-être déclenché une navigation directe
    log('Clic effectué — si la page ne change pas, cliquez manuellement sur POSTULER');
    showBanner('Ouverture du formulaire en cours…');
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 12. Point d'entrée principal
  // ══════════════════════════════════════════════════════════════════════════════
  async function main() {
    // Détection de la page via le blueprint
    const page = blueprint?.detectPage?.();
    if (!page) {
      // Vérification manuelle minimale : on est sur HSBC SF, Eightfold ou apply.careers.hsbc.com ?
      const host = location.hostname;
      const href = location.href;
      const isHsbcHost = host.includes('career2.successfactors.eu')
        || host.includes('portal.careers.hsbc.com')
        || host.includes('apply.careers.hsbc.com');
      if (!isHsbcHost) return;
      if (!href.includes('hsbcholdin') && !host.includes('portal.careers.hsbc.com') && !host.includes('apply.careers.hsbc.com')) return;
    }

    const entry = await getPendingEntry();
    if (!entry?.profile) {
      log('Aucun profil HSBC en attente (taleos_pending_hsbc absent ou tab non correspondant)');
      return;
    }

    const { profile } = entry;
    const host = location.hostname;
    const path = location.pathname;
    const href = location.href;

    // Cas 0 : page de confirmation post-soumission — ne rien faire, effacer le pending
    // URL réelle : /portalcareer?isRedirectToAppSent=true&isQuickApplyPostLoginRedirect=true
    if (href.includes('isRedirectToAppSent=true') || href.includes('isQuickApplyPostLoginRedirect=true')) {
      log('✅ Candidature HSBC confirmée — nettoyage du pending');
      chrome.storage.local.remove([STORAGE_KEY, TAB_ID_KEY]).catch(() => {});
      showBanner('Candidature envoyée avec succès ! 🎉', 'success');
      return;
    }

    // Cas 0.5 : page profil SF (déjà connecté, loginFlowRequired a redirigé vers MY_PROFILE)
    // → naviguer directement vers l'offre Eightfold dans le même onglet
    const isProfilePage = host.includes('career2.successfactors.eu')
      && href.includes('navBarLevel=MY_PROFILE');

    if (isProfilePage) {
      const targetUrl = entry.offerUrl || '';
      if (targetUrl) {
        log(`Déjà connecté (page profil) → navigation vers l'offre : ${targetUrl}`);
        showBanner('Déjà connecté — ouverture de l\'offre…');
        await sleep(500);
        location.href = targetUrl;
      } else {
        log('Déjà connecté mais offerUrl absent — rien à faire');
        showBanner('Connecté. Naviguez vers l\'offre manuellement.', 'warn');
        activateTab();
      }
      return;
    }

    // Cas 1 : page Sign In SF (utilisateur qui a déjà un compte HSBC)
    // Détecte aussi loginFlowRequired=true (URL ouverte par le background) quand SF n'est pas encore connecté
    const isLoginPage = host.includes('career2.successfactors.eu')
      && (href.includes('login_ns=login') || href.includes('loginFlowRequired=true'))
      && href.includes('hsbcholdin');

    if (isLoginPage) {
      if (profile.auth_email) {
        await handleLoginPage(profile, entry.offerUrl || '');
      } else {
        log('Page Sign In HSBC — pas d\'identifiants configurés dans Connexions. Connectez-vous manuellement ou créez un compte.');
        showBanner('Connectez-vous à votre compte HSBC pour continuer', 'warn');
        activateTab();
      }
      return;
    }

    // Cas 2 : formulaire candidature SF
    // Couvre /career (nouveau compte) et /portalcareer (utilisateur déjà connecté)
    const isSFForm = host.includes('career2.successfactors.eu')
      && (path.startsWith('/career') || path.startsWith('/portalcareer'))
      && !href.includes('career_ns=job_listing')
      && !href.includes('career_ns=job_search')
      && !href.includes('login_ns=login')
      && !href.includes('loginFlowRequired=true')
      && !href.includes('navBarLevel=MY_PROFILE');

    if (isSFForm) {
      await fillApplicationForm(profile);
      return;
    }

    // Cas 3 : page listing SF (avant clic Apply)
    // Large, mais les exclusions ci-dessus (login, profil, form) couvrent déjà les faux positifs
    const isSFListing = host.includes('career2.successfactors.eu')
      && href.includes('hsbcholdin')
      && !href.includes('login_ns=login')
      && !href.includes('navBarLevel=MY_PROFILE')
      && !path.startsWith('/portalcareer');

    if (isSFListing) {
      await handleListingPage(profile);
      return;
    }

    // Cas 4 : page intermédiaire apply.careers.hsbc.com (ex. /job/TITLE/ID/)
    // Cette page apparaît quand la fiche SF listing redirige vers le portail apply HSBC.
    if (host.includes('apply.careers.hsbc.com')) {
      await handleApplyCareerPage(profile);
      return;
    }

    // Cas 5 : page offre Eightfold (portal.careers.hsbc.com)
    // On ne restreint pas le path pour couvrir tous les formats d'URL Eightfold
    if (host.includes('portal.careers.hsbc.com')) {
      await handleEightfoldOffer(profile);
      return;
    }

    log(`Page non reconnue pour le flux HSBC : ${href}`);
  }

  // Lancer avec un léger délai pour laisser le DOM se stabiliser
  await sleep(800);
  await main();
})();
