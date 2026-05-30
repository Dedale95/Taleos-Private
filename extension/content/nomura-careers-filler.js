/**
 * Taleos — Nomura Careers Filler
 * Remplit le formulaire SAP SuccessFactors Nomura (career4.successfactors.com, company=nomurahold).
 *
 * Flux couvert :
 *   1. Page listing Nomura → clic automatique "Apply now"
 *   2. Modal "Please sign in" → connexion avec identifiants
 *   3. Formulaire de candidature SF (tor__f* / JUIC widgets) → remplissage complet
 *
 * Source données  : chrome.storage.local.taleos_pending_nomura.profile
 * Upload CV/LM    : chrome.runtime.sendMessage({ action: 'fetch_storage_file', storagePath })
 *
 * Soumission : automatique après 60 secondes (#fbqa_apply) une fois le formulaire rempli.
 */
(async () => {
  'use strict';

  // ══════════════════════════════════════════════════════════════════════════════
  // 0. Garde-fous et initialisation
  // ══════════════════════════════════════════════════════════════════════════════
  // Log immédiat AVANT tout guard — visible même si le script est déjà en cours.
  console.log(`[Nomura Filler] ▶ script chargé | url=${location.href} | guard=${!!globalThis.__TALEOS_NOMURA_FILLER_RUNNING__}`);
  if (globalThis.__TALEOS_NOMURA_FILLER_RUNNING__) {
    console.log('[Nomura Filler] ⛔ Déjà en cours (__TALEOS_NOMURA_FILLER_RUNNING__=true) — exit');
    return;
  }
  // NOTE: guard activé APRÈS vérification de la session en attente (§12) pour ne pas bloquer
  // les injections sur des pages sans session active (navigation sans Taleos).

  const BANNER_ID   = 'taleos-nomura-banner';
  const STORAGE_KEY = 'taleos_pending_nomura';
  const TAB_ID_KEY  = 'taleos_nomura_tab_id';

  // ══════════════════════════════════════════════════════════════════════════════
  // 1. Utilitaires
  // ══════════════════════════════════════════════════════════════════════════════
  function log(msg) {
    const line = `[Nomura Filler] ${msg}`;
    console.log(line);
    try {
      chrome.runtime.sendMessage({
        action: 'extension_run_log',
        source: 'nomura-careers-filler',
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
  // 2. Récupération du profil depuis le storage
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
  // 3. Bannière Taleos
  // ══════════════════════════════════════════════════════════════════════════════
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
          zIndex: '2147483647', background: '#c90813', color: '#fff',
          padding: '8px 16px', fontSize: '13px', fontFamily: 'sans-serif',
          borderBottom: '2px solid #8a0009', textAlign: 'center'
        });
      }
      document.body?.prepend(el);
    }
    if (type === 'success') el.style.background = '#155724';
    if (type === 'warn')    el.style.background = '#856404';
    if (type === 'error')   el.style.background = '#721c24';
    el.textContent = `🏦 Taleos Nomura — ${text}`;
  }

  function activateTab() {
    chrome.runtime.sendMessage({ action: 'nomura_activate_tab' }).catch(() => {});
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 4. Remplissage des champs texte (compatible React/Angular/JUIC)
  // ══════════════════════════════════════════════════════════════════════════════

  /**
   * Renseigne un champ texte avec audit lisible :
   *   formulaire='...' | Firebase='...' → Skip / Correction / Renseignement
   */
  function setInputAudit(el, firebaseVal, label) {
    if (!el) { log(`   ⚠️ ${label} : champ introuvable`); return; }
    const current = (el.value || '').trim();
    const target  = String(firebaseVal || '').trim();
    if (!target) { log(`   ⚠️ ${label} : Firebase='—' → Skip (valeur manquante)`); return; }
    if (current === target) {
      log(`   ✅ ${label} : formulaire='${current}' | Firebase='${target}' → Skip`);
      return;
    }
    const action = current ? 'Correction' : 'Renseignement';
    log(`   ✏️ ${label} : formulaire='${current || 'vide'}' | Firebase='${target}' → ${action}`);
    setNativeValue(el, target);
  }

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
  // 5. PaginatedPicklist SF (widgets JUIC)
  // ══════════════════════════════════════════════════════════════════════════════

  /**
   * Cherche un input de paginatedPicklist dont le label contient l'un des mots-clés.
   * Fallback quand l'ID numérique hardcodé ne correspond pas.
   */
  function findPicklistInputByLabel(keywords) {
    const inputs = Array.from(document.querySelectorAll('[id$=":_input"]'));
    const kw = keywords.map(k => k.toLowerCase());
    for (const input of inputs) {
      const lblId = input.getAttribute('aria-labelledby');
      if (lblId) {
        const lbl = document.getElementById(lblId);
        if (lbl && kw.some(k => lbl.textContent.toLowerCase().includes(k))) return input;
      }
      const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (label && kw.some(k => label.textContent.toLowerCase().includes(k))) return input;
      const container = input.closest('.sf-ui-formElement, .app-form-field, [class*="form"]');
      if (container) {
        const containerText = container.textContent.toLowerCase();
        if (kw.some(k => containerText.includes(k))) return input;
      }
    }
    return null;
  }

  /**
   * Sélectionne une valeur dans un paginatedPicklist SF.
   * Essaie plusieurs variantes pour la localisation (EN/FR).
   */
  async function selectPicklistMulti(inputEl, candidates, label = '') {
    if (!inputEl) { log(`   ⚠️ Picklist "${label}" introuvable`); return false; }

    const norm = s => String(s || '').replace(/ /g, ' ').replace(/ {2,}/g, ' ').trim();
    const candidatesNorm = candidates.map(c => norm(c)).filter(Boolean);
    const firebaseVal    = candidatesNorm[0] || '';

    const currentVal = norm(inputEl.value);
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
        await sleep(200);
        // Fermer le dropdown JUIC s'il est encore ouvert (mousedown sur body + Escape)
        try {
          document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
          inputEl.blur();
        } catch (_) {}
        log(`   ✅ ${label} → "${cn}"`);
        return true;
      }
    }
    log(`   ⚠️ ${label} : aucune valeur parmi [${candidatesNorm.join('|')}]. Disponibles : ${available.join(' | ')}`);
    return false;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 6. Upload de fichier (CV ou LM) depuis Firebase Storage
  // ══════════════════════════════════════════════════════════════════════════════

  /**
   * Cherche le bouton d'upload SF correspondant à 'cv' ou 'lm'.
   *
   * Cherche TOUS les _attachIcon (addAttachments ET removeAttachments) car :
   * - Slot vide     → bouton class="addAttachments"  (icône +)
   * - Slot occupé   → bouton class="removeAttachments" (icône poubelle)
   * Dans les deux cas le même _attachIcon est utilisé (la class change selon état).
   *
   * Stratégie :
   *   1. aria-labelledby — labels ARIA de la section (CV ou Cover Letter)
   *   2. Tri numérique JUIC en fallback (SF rend CV en premier = ID plus bas)
   */
  function findAttachButton(cvOrLm) {
    // Tous les boutons d'action des slots de pièces jointes (qu'ils soient add ou remove)
    const all = Array.from(document.querySelectorAll(
      '.addAttachments[id$=":_attachIcon"], .removeAttachments[id$=":_attachIcon"]'
    ));

    // Trier par préfixe numérique (ordre de rendu SF : CV < LM)
    all.sort((a, b) => {
      const na = parseInt((a.id || '').match(/^(\d+):/)?.[1] || '9999', 10);
      const nb = parseInt((b.id || '').match(/^(\d+):/)?.[1] || '9999', 10);
      return na - nb;
    });

    const cvKw = ['resume', 'curriculum vitae', ' cv', 'lebenslauf'];
    const lmKw = ['cover letter', 'covering letter', 'lettre de motivation', 'motivation', 'anschreiben'];
    const keywords = cvOrLm === 'cv' ? cvKw : lmKw;

    // 1. Recherche par labels ARIA référencés (aria-labelledby)
    for (const btn of all) {
      const refs = (btn.getAttribute('aria-labelledby') || '').split(/\s+/).filter(id => id.length > 2);
      for (const id of refs) {
        const el = document.getElementById(id);
        if (el) {
          const txt = el.textContent.toLowerCase();
          if (keywords.some(k => txt.includes(k))) {
            const cls = btn.classList.contains('removeAttachments') ? 'remove' : 'add';
            log(`   findAttachButton('${cvOrLm}') → #${btn.id} [${cls}] (aria: "${el.textContent.trim().slice(0, 40)}")`);
            return btn;
          }
        }
      }
    }

    // 2. Fallback : tri numérique (CV = index 0, LM = index 1)
    const btn = cvOrLm === 'cv' ? all[0] : (all[1] || null);
    if (btn) {
      const cls = btn.classList.contains('removeAttachments') ? 'remove' : 'add';
      log(`   findAttachButton('${cvOrLm}') → #${btn.id} [${cls}] (fallback index ${cvOrLm === 'cv' ? 0 : 1})`);
    } else {
      log(`   findAttachButton('${cvOrLm}') → null (${all.length} bouton(s) total)`);
    }
    return btn;
  }

  /**
   * Clique sur le bouton d'upload d'une pièce jointe SF (attachIcon), récupère
   * le fichier depuis Firebase Storage et l'injecte dans l'input file JUIC.
   *
   * @param {HTMLElement} actionBtn  - bouton d'upload trouvé via findAttachButton()
   * @param {string} storagePath    - chemin Firebase Storage
   * @param {string} filename       - nom de fichier exact
   * @param {string} label          - libellé pour les logs
   */
  async function uploadFile(actionBtn, storagePath, filename, label = 'Fichier') {
    if (!storagePath) { log(`   ⚠️ ${label} : storagePath absent → skip`); return false; }
    if (!actionBtn)   { log(`   ⚠️ ${label} : bouton d'upload introuvable`); return false; }

    // Télécharger depuis Firebase AVANT toute interaction UI
    const r = await chrome.runtime.sendMessage({ action: 'fetch_storage_file', storagePath }).catch(() => null);
    if (!r?.base64) { log(`   ⚠️ ${label} introuvable dans Firebase Storage (${storagePath})`); return false; }

    const effectiveFilename = String(filename || r.filename || '').trim();
    if (!effectiveFilename) { log(`   ⚠️ ${label} : filename absent → skip`); return false; }

    // Dériver l'ID de base depuis le bouton (ex. id="60:_attachIcon" → baseId='60')
    // pour lire/confirmer le label du BON fichier (CV ou LM) et non le premier trouvé.
    const baseIdMatch = (actionBtn.id || '').match(/^(\d+):/);
    const baseId = baseIdMatch ? baseIdMatch[1] : null;
    log(`   ${label} : bouton trouvé (id=${actionBtn.id || '?'}, baseId=${baseId || '?'})`);
    const getSpecificLabel = () =>
      (baseId ? document.getElementById(`${baseId}:_attachDownloadLabelLink`) : null)
      || document.querySelector('[id$="_attachDownloadLabelLink"]');

    // Lire le nom déjà affiché (pour log)
    const existingLabel = getSpecificLabel();
    const existingName  = existingLabel ? existingLabel.textContent.trim() : 'aucun';
    log(`   ${label} : formulaire='${existingName}' | Firebase='${effectiveFilename}' → Remplacement`);

    // ── Étape 0 : si le slot est occupé (removeAttachments), supprimer le fichier d'abord ──
    let uploadBtn = actionBtn;
    if (actionBtn.classList.contains('removeAttachments')) {
      const btnId = actionBtn.id;
      log(`   ${label} : slot occupé — suppression du fichier existant (${existingName})`);
      actionBtn.click();
      await sleep(600);
      // Attendre que le bouton redevienne addAttachments
      const addBtn = await waitFor(
        () => {
          const el = document.getElementById(btnId);
          return el?.classList.contains('addAttachments') ? el : null;
        },
        6000, 200
      );
      if (!addBtn) {
        log(`   ⚠️ ${label} : addAttachments non apparu après suppression — abandon`);
        return false;
      }
      uploadBtn = addBtn;
      log(`   ${label} : slot libéré — passage en mode upload`);
    }

    // ── Étape 1 : cliquer le bouton d'upload (addAttachments) ────────────────
    uploadBtn.click();
    await sleep(500);

    // ── Étape 2 : cliquer "Upload from Computer" dans le sous-menu ──────────
    const computerBtn = await waitFor(() => {
      return document.querySelector('[id$="_uploadComputer"]')
        || Array.from(document.querySelectorAll('[role="menuitem"], li, button, a'))
            .find(el => /computer|ordinateur|local|depuis.*ordi/i.test(el.textContent) && el.offsetParent !== null)
        || null;
    }, 2500, 200);

    if (computerBtn) {
      computerBtn.click();
      await sleep(400);
    }

    // ── Étape 3 : attendre l'input file ──────────────────────────────────────
    let fileInput = await waitFor(
      () => document.querySelector('input[name="fileData1"]'),
      4000, 200
    );
    if (!fileInput) { log(`   ⚠️ ${label} : input[name="fileData1"] introuvable`); return false; }

    // ── Étape 4 : injecter le fichier ─────────────────────────────────────────
    const bin   = atob(r.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], effectiveFilename, { type: r.type || 'application/pdf' });

    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    fileInput.dispatchEvent(new Event('input',  { bubbles: true }));
    log(`   ⏳ Upload en cours : "${effectiveFilename}"…`);

    // ── Étape 5 : attendre la confirmation ────────────────────────────────────
    const success = await waitFor(() => {
      const ok  = document.querySelector('[id$="_attachSuccess"]:not(.displayNone)');
      if (ok) return ok;
      const lbl = getSpecificLabel();
      if (lbl && lbl.textContent.trim() !== existingName) return lbl;
      return null;
    }, 25000, 500);

    if (success) {
      const confirmedName = getSpecificLabel()?.textContent.trim() || effectiveFilename;
      log(`   ✅ ${label} → "${confirmedName}"`);
      return true;
    }

    log(`   ⚠️ Timeout upload ${label} (25s) — vérifiez que "${effectiveFilename}" est bien chargé`);
    return false;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 7. Acceptation de la politique de confidentialité
  // ══════════════════════════════════════════════════════════════════════════════
  async function acceptPrivacy() {
    const link = document.getElementById('dataPrivacyId');
    if (!link) { log('⚠️ Lien confidentialité (dataPrivacyId) introuvable'); return false; }

    link.click();
    await sleep(800);

    const acceptBtn = await waitFor(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.find(b => b.textContent.trim() === 'Accept') || null;
    }, 4000, 200);

    if (acceptBtn) {
      acceptBtn.click();
      await sleep(500);
      log('✅ Politique de confidentialité → "Accept" cliqué');
    } else {
      // Fallback : forcer fbclc_dpcsId
      const dpcsInput = document.getElementById('fbclc_dpcsId');
      if (dpcsInput) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (setter) setter.call(dpcsInput, '1');
        dpcsInput.dispatchEvent(new Event('change', { bubbles: true }));
        log('✅ Politique de confidentialité → fbclc_dpcsId forcé à "1"');
      }
    }
    return true;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 8. Conversion préavis (mois → semaines)
  // ══════════════════════════════════════════════════════════════════════════════
  function noticePeriodToWeeks(sgNoticePeriod) {
    switch (String(sgNoticePeriod || '').toLowerCase()) {
      case 'none':             return 0;
      case '1_month':          return 4;
      case '2_months':         return 9;
      case '3_months':         return 13;
      case 'more_than_3_months': return 13;
      default:                 return 0;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 9. Remplissage du formulaire de candidature
  // ══════════════════════════════════════════════════════════════════════════════
  async function fillApplicationForm(profile) {
    const phone      = String(profile.phone_number || profile['phone-number'] || profile.phone || '').replace(/\D/g, '');
    const phoneCode  = String(profile.phone_country_code || '+33').trim();
    const fullPhone  = `${phoneCode}${phone}`;
    const noticeWeeks = noticePeriodToWeeks(profile.sg_notice_period);
    const countryVal  = profile.country || 'France';
    const currencyVal = profile.salary_currency || 'EUR';
    const workedVal   = profile.nomura_worked_before || 'No';

    log(`Remplissage Nomura — ${profile.firstname} ${profile.lastname} <${profile.auth_email}>`);

    // ── Firebase snapshot ─────────────────────────────────────────────────────
    log('── Firebase snapshot ─────────────────────────────────');
    log(`   Prénom        : ${profile.firstname        || '—'}`);
    log(`   Nom           : ${profile.lastname         || '—'}`);
    log(`   Téléphone     : ${fullPhone                || '—'} (indicatif: ${phoneCode}, num: ${phone || '—'})`);
    log(`   Adresse       : ${profile.address          || '—'}`);
    log(`   Ville         : ${profile.city             || '—'}`);
    log(`   Code postal   : ${profile.zipcode          || '—'}`);
    log(`   Pays          : ${countryVal}`);
    log(`   CV            : ${profile.cv_filename      || '—'} (storage: ${profile.cv_storage_path ? 'présent' : 'absent'})`);
    log(`   LM            : ${profile.lm_filename      || '—'} (storage: ${profile.lm_storage_path ? 'présent' : 'absent'})`);
    log(`   Devise        : ${currencyVal}`);
    log(`   Salaire       : ${profile.salary_expectations || '—'}`);
    log(`   Préavis       : sg_notice_period="${profile.sg_notice_period || '—'}" → ${noticeWeeks} semaine(s)`);
    log(`   Déjà Nomura   : ${workedVal}`);
    log(`   Genre         : ${profile.nomura_gender || '—'}`);
    log(`   Trans         : ${profile.nomura_trans || '—'}`);
    log(`   Gr. ethnique  : ${profile.nomura_ethnic_group || '—'} / ${profile.nomura_ethnic_subgroup || '—'}`);
    log(`   Religion      : ${profile.nomura_religion || '—'}`);
    log(`   Orientation   : ${profile.nomura_sexual_orientation || '—'}`);
    log(`   Ménage @14    : ${profile.nomura_household_earner ? profile.nomura_household_earner.slice(0, 50) + '…' : '—'}`);
    log(`   École gratuit : ${profile.nomura_free_school_meals || '—'}`);
    log(`   Type école    : ${profile.nomura_school_type ? profile.nomura_school_type.slice(0, 50) + '…' : '—'}`);
    log('── Remplissage ───────────────────────────────────────');
    showBanner('Remplissage en cours…');
    await sleep(600);

    // ── Vérification "déjà postulé" ───────────────────────────────────────────
    const bodyText = document.body?.innerText || '';
    if (/you have already applied|already applied for this/i.test(bodyText)) {
      log('⚠️ Candidature Nomura déjà soumise pour cette offre');
      showBanner('⚠️ Déjà postulé pour cette offre', 'warn');
      await chrome.runtime.sendMessage({
        action: 'candidature_already_applied',
        bankId: 'nomura',
        jobId:     profile.__jobId    || '',
        jobTitle:  profile.__jobTitle || '',
        companyName: 'Nomura',
        offerUrl:  profile.__offerUrl || location.href,
      }).catch(() => null);
      await chrome.storage.local.remove([STORAGE_KEY, TAB_ID_KEY]);
      return;
    }

    // ── Prénom ────────────────────────────────────────────────────────────────
    setInputAudit(document.getElementById('tor__ffirstName'), profile.firstname, 'Prénom');

    // ── Nom ───────────────────────────────────────────────────────────────────
    setInputAudit(document.getElementById('tor__flastName'), profile.lastname, 'Nom');

    // ── Téléphone (indicatif + numéro concaténés) ─────────────────────────────
    setInputAudit(document.getElementById('tor__fcellPhone'), fullPhone, 'Téléphone');

    // ── Adresse ───────────────────────────────────────────────────────────────
    setInputAudit(document.getElementById('tor__faddressLine1'), profile.address, 'Adresse');

    // ── Pays (picklist SF, ID 9:_input) ──────────────────────────────────────
    await sleep(400);
    const countryInput = document.getElementById('9:_input')
      || findPicklistInputByLabel(['country', 'pays']);
    await selectPicklistMulti(countryInput, [countryVal, 'France'], 'Pays');

    // ── Ville ─────────────────────────────────────────────────────────────────
    setInputAudit(document.getElementById('tor__fcity'), profile.city, 'Ville');

    // ── Code postal ───────────────────────────────────────────────────────────
    setInputAudit(document.getElementById('tor__fzip'), profile.zipcode, 'Code postal');

    // ── Upload CV + LM ────────────────────────────────────────────────────────
    // Attendre que les DEUX boutons d'upload soient présents dans le DOM avant
    // d'appeler findAttachButton, pour éviter un fallback sur le slot CV quand
    // le slot LM n'est pas encore rendu.
    await sleep(400);
    const expectedBtnCount = (profile.cv_storage_path ? 1 : 0) + (profile.lm_storage_path ? 1 : 0);
    if (expectedBtnCount > 0) {
      const btnsReady = await waitFor(
        () => {
          const n = document.querySelectorAll(
            '.addAttachments[id$=":_attachIcon"], .removeAttachments[id$=":_attachIcon"]'
          ).length;
          return n >= expectedBtnCount ? n : null;
        },
        8000, 300
      );
      log(`   Boutons d'upload détectés : ${btnsReady || 0} (attendus : ${expectedBtnCount})`);
    }

    if (profile.cv_storage_path) {
      await uploadFile(findAttachButton('cv'), profile.cv_storage_path, profile.cv_filename, 'CV');
    } else {
      log('⚠️ cv_storage_path absent — uploadez le CV manuellement');
    }
    await sleep(1000);

    // ── Upload LM ─────────────────────────────────────────────────────────────
    if (profile.lm_storage_path) {
      // Laisser le temps à SF de mettre à jour l'UI du slot CV avant d'uploader LM
      // (cherche add ET remove — le slot LM peut être occupé d'une session précédente)
      await waitFor(
        () => document.querySelectorAll(
          '.addAttachments[id$=":_attachIcon"], .removeAttachments[id$=":_attachIcon"]'
        ).length >= 2,
        5000, 200
      );
      await uploadFile(findAttachButton('lm'), profile.lm_storage_path, profile.lm_filename, 'LM');
    } else {
      log('ℹ️ lm_storage_path absent — pas de lettre de motivation uploadée');
    }
    await sleep(800);

    // ── Devise (picklist SF, ID 17:_input) ───────────────────────────────────
    const currencyInput = document.getElementById('17:_input')
      || findPicklistInputByLabel(['currency', 'devise', 'monnaie']);
    await selectPicklistMulti(currencyInput, [currencyVal], 'Devise');
    await sleep(350);

    // ── Attentes salariales ───────────────────────────────────────────────────
    setInputAudit(
      document.getElementById('tor__fcust_salaryExpect'),
      profile.salary_expectations ? String(profile.salary_expectations) : '',
      'Attentes salariales'
    );

    // ── Préavis en semaines ────────────────────────────────────────────────────
    setInputAudit(
      document.getElementById('tor__fcust_noticePeriod'),
      String(noticeWeeks),
      `Préavis (sg_notice_period="${profile.sg_notice_period || '—'}" → ${noticeWeeks} sem.)`
    );

    // ── A déjà travaillé chez Nomura (picklist SF, ID 21:_input) ─────────────
    await sleep(350);
    const workedInput = document.getElementById('21:_input')
      || findPicklistInputByLabel(['nomura', 'previously', 'worked', 'travaillé', 'déjà']);
    await selectPicklistMulti(workedInput, [workedVal], 'Déjà travaillé chez Nomura');
    await sleep(350);

    // ── Questions Diversité & Inclusion (optionnelles selon formulaire) ──────
    // Chaque champ est recherché par label — on skip silencieusement s'il n'est pas présent.
    await sleep(300);

    const nomuraDivFields = [
      { keywords: ['gender', 'identify with'],                  val: profile.nomura_gender,            label: 'Genre' },
      { keywords: ['trans'],                                     val: profile.nomura_trans,             label: 'Trans*' },
      { keywords: ['ethnic group', 'ethnicity'],                 val: profile.nomura_ethnic_group,      label: 'Groupe ethnique' },
      { keywords: ['best describes your ethnic'],                val: profile.nomura_ethnic_subgroup,   label: 'Sous-groupe ethnique' },
      { keywords: ['religion', 'belief'],                        val: profile.nomura_religion,          label: 'Religion' },
      { keywords: ['sexual orientation'],                        val: profile.nomura_sexual_orientation,label: 'Orientation sexuelle' },
      { keywords: ['occupation', 'household earner', 'aged about 14'], val: profile.nomura_household_earner, label: 'Profession ménage @14' },
      { keywords: ['free school meals'],                         val: profile.nomura_free_school_meals, label: 'Repas scolaires gratuits' },
      { keywords: ['type of school', 'ages of 11'],              val: profile.nomura_school_type,       label: 'Type d\'école 11-16' },
      { keywords: ['primary carer', 'child or children'],        val: profile.nomura_primary_carer,     label: 'Aidant·e enfant' },
      { keywords: ['look after', 'care for someone', 'ill health caused by disability'], val: profile.nomura_carer, label: 'Aidant·e personne malade' },
      { keywords: ['disability confident'],                      val: profile.nomura_disability_confident, label: 'Disability Confident' }
    ];

    for (const { keywords, val, label } of nomuraDivFields) {
      if (!val) { log(`   ⊘ ${label} : non renseigné dans le profil — skip`); continue; }
      const input = findPicklistInputByLabel(keywords);
      if (!input) { log(`   ⊘ ${label} : champ absent dans ce formulaire — skip`); continue; }
      // Ne pas écraser si déjà renseigné avec la bonne valeur
      if ((input.value || '').trim() === val.trim()) {
        log(`   ✅ ${label} : formulaire='${val}' → Skip (déjà correct)`);
        continue;
      }
      await selectPicklistMulti(input, [val], label);
      await sleep(200);
    }

    // Politique de confidentialité ──────────────────────────────────────────
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
          chrome.runtime.sendMessage({
            action: 'candidature_success',
            bankId: 'nomura',
            jobId:    profile.__jobId    || '',
            jobTitle: profile.__jobTitle || '',
            companyName: 'Nomura',
            offerUrl: profile.__offerUrl || location.href,
            successType: 'submitted',
            successMessage: 'Candidature soumise automatiquement'
          }).catch(() => null);
        } else {
          log('⚠️ Bouton "Postuler" (fbqa_apply) introuvable — cliquez manuellement');
          showBanner('⚠️ Cliquez sur "Postuler" pour soumettre', 'warn');
        }
      }
    }, 1000);
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 10. Connexion (modal "Please sign in")
  // ══════════════════════════════════════════════════════════════════════════════
  async function handleSignIn(profile) {
    log('Page/modal Sign In SF Nomura — connexion avec identifiants enregistrés…');
    showBanner('Connexion à votre compte Nomura…');

    // Attendre que le champ email soit VISIBLE (offsetParent !== null = rendu dans le flux).
    // Important : #username peut exister dans le DOM avant que la modal s'ouvre.
    const emailInput = await waitFor(
      () => {
        const el = document.getElementById('username') || document.querySelector('input[type="email"]');
        return (el && el.offsetParent !== null) ? el : null;
      },
      10000, 200
    );
    const pwdInput = await waitFor(
      () => {
        const el = document.getElementById('password') || document.querySelector('input[type="password"]');
        return (el && el.offsetParent !== null) ? el : null;
      },
      5000, 200
    );

    if (!emailInput || !pwdInput) {
      log('⚠️ Champs email/mot de passe introuvables ou non visibles');
      showBanner('Champs de connexion non trouvés — remplissez manuellement', 'warn');
      activateTab();
      return;
    }

    log(`   Champs visibles — email: #${emailInput.id || '?'} | pwd: #${pwdInput.id || '?'}`);
    setNativeValue(emailInput, profile.auth_email || '');
    await sleep(400);
    setNativeValue(pwdInput, profile.auth_password || '');
    await sleep(600);

    // Attendre que le bouton Sign In soit VISIBLE et initialisé par JUIC.
    // Le texte du bouton ("Sign In") n'est rendu par JUIC qu'une fois la modal prête.
    const submitBtn = await waitFor(
      () => {
        const btn = document.getElementById('fbqa_signin');
        // Visible ET texte non vide → JUIC a fini d'initialiser le bouton
        if (btn && btn.offsetParent !== null && btn.textContent.trim()) return btn;
        // Fallback : chercher un bouton "Sign In" visible avec texte
        return Array.from(document.querySelectorAll('button')).find(b =>
          /^sign in$/i.test(b.textContent.trim()) && b.offsetParent !== null
        ) || null;
      },
      8000, 200
    );

    if (!submitBtn) {
      log('⚠️ Bouton Sign In (#fbqa_signin) non visible / non initialisé par JUIC');
      showBanner('Bouton Sign In non prêt — cliquez manuellement', 'warn');
      activateTab();
      return;
    }

    log(`   → Bouton prêt : #${submitBtn.id || '?'} "${submitBtn.textContent.trim()}"`);

    // JUIC passe l'objet event à juic.fire() → MouseEvent complet obligatoire.
    submitBtn.dispatchEvent(new MouseEvent('click', {
      bubbles: true, cancelable: true, view: window
    }));
    log('✅ Clic Sign In (MouseEvent) → attente résultat connexion…');
    showBanner('Connexion en cours…');

    // Attendre que le bouton Sign In disparaisse (modal fermée) OU qu'une erreur s'affiche.
    // Ne pas tester #username.offsetParent : il peut être caché dès le début et donner
    // un faux positif "succès" avant même que le clic ait eu lieu.
    const loginResult = await waitFor(() => {
      const errorEl = document.querySelector('#errorMsg_1, #uiErrorMsg, #uiErrorContainer_2');
      if (errorEl && errorEl.offsetParent !== null && errorEl.textContent.trim()) {
        return { error: errorEl.textContent.trim() };
      }
      // La modal est fermée quand le bouton Sign In n'est plus visible
      const btn = document.getElementById('fbqa_signin');
      if (!btn || btn.offsetParent === null) {
        return { success: true };
      }
      return null;
    }, 15000, 400);

    if (!loginResult) {
      log('⚠️ Timeout connexion — aucune réponse du formulaire SF');
      showBanner('Connexion timeout — vérifiez manuellement', 'warn');
      activateTab();
      return;
    }
    if (loginResult.error) {
      log(`❌ Connexion échouée : ${loginResult.error}`);
      showBanner(`Connexion Nomura échouée : ${loginResult.error}`, 'error');
      activateTab();
      return;
    }

    log('✅ Connexion Nomura réussie — SF va rediriger vers le formulaire');
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 11a. Portail SF sans session — connexion requise avant formulaire
  // ══════════════════════════════════════════════════════════════════════════════
  async function handleSFPortalLogin(profile) {
    log('Portail SF Nomura (careers?company=nomurahold) — connexion requise…');
    showBanner('Connexion à votre compte Nomura…');

    // Cas 1 : champ username directement visible sur la page
    const usernameField = await waitFor(
      () => document.getElementById('username') || document.querySelector('input[type="email"]'),
      2000, 200
    );
    if (usernameField) {
      await handleSignIn(profile);
      return;
    }

    // Cas 2 : lien "Please sign in" qui ouvre une modal de connexion
    const signInLink = await waitFor(
      () => document.querySelector('a[onclick*="openSignInModal"]') ||
            Array.from(document.querySelectorAll('a')).find(a =>
              /please sign in|sign in/i.test(a.textContent.trim())
            ),
      8000, 200
    );

    if (!signInLink) {
      log('⚠️ Ni champ email ni lien "Please sign in" trouvé sur le portail SF');
      showBanner('Connexion requise — cliquez manuellement sur "Please sign in"', 'warn');
      activateTab();
      return;
    }

    signInLink.click();
    log('✅ Clic "Please sign in" → attente modal connexion…');
    await sleep(800);
    await handleSignIn(profile);
    // Après connexion, background.js re-injecte le filler sur la navigation suivante (formulaire)
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 11b. Clic sur "Apply now" sur la page offre Nomura
  // ══════════════════════════════════════════════════════════════════════════════
  async function handleListingPage(profile) {
    log('Page offre Nomura — attente bouton "Apply now"…');
    showBanner('Ouverture du formulaire de candidature…');

    const applyBtn = await waitFor(
      () =>
        document.querySelector('[data-qa="apply-now-button"]') ||
        document.querySelector('#applyButton_top') ||
        document.querySelector('#applyButton_bottom') ||
        Array.from(document.querySelectorAll('button, a')).find(b =>
          /apply\s*now|postuler|candidater/i.test(b.textContent.trim())
        ),
      10000,
      80  // Poll rapide : le bouton est souvent déjà présent
    );

    if (!applyBtn) {
      log('⚠️ Bouton "Apply now" introuvable sur la page offre');
      showBanner('Bouton Apply non trouvé — cliquez manuellement', 'warn');
      activateTab();
      return;
    }

    applyBtn.click();
    log('✅ Clic "Apply now" → navigation vers portail SF en cours…');
    // Si l'utilisateur n'est pas connecté, SF redirige vers careers?company=nomurahold
    // et le filler est re-injecté là-bas (handleSFPortalLogin).
    // Si l'utilisateur est connecté, SF redirige directement vers le formulaire (isApplicationForm).
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 12. Routage principal
  // ══════════════════════════════════════════════════════════════════════════════
  const entry = await getPendingEntry();
  if (!entry?.profile) {
    log('Pas de session Nomura en attente — exit');
    return; // Pas de session : on ne pose PAS le guard pour ne pas bloquer les prochaines injections
  }

  // Session active confirmée → verrouiller le guard
  globalThis.__TALEOS_NOMURA_FILLER_RUNNING__ = true;

  const profile = entry.profile;
  const url = location.href;

  log(`URL : ${url}`);

  // ── Page de formulaire de candidature SF (portalcareer / career) ─────────────
  const isApplicationForm =
    url.includes('career4.successfactors.com') &&
    (url.includes('career_ns=job_application') || url.includes('portalcareer'));

  // ── Page offre Nomura (fiche offre /job/ sur careers.nomura.com) ──────────────
  // Exclure talentcommunity/apply (redirection intermédiaire → career4) et career4
  const isNomuraJobPage =
    url.includes('careers.nomura.com') &&
    !url.includes('talentcommunity') &&
    (url.includes('/job/') || url.includes('/jobs/') || url.includes('/Nomura/'));

  // ── Portail SF sans offre spécifique (redirect depuis talentcommunity sans session) ──
  // career4.successfactors.com/careers?company=nomurahold — pas encore sur le formulaire,
  // l'utilisateur n'est pas connecté → il faut cliquer "Please sign in" puis se connecter.
  const isSFPortalLogin =
    url.includes('career4.successfactors.com') &&
    !isApplicationForm &&
    !isNomuraJobPage;

  if (isApplicationForm) {
    // Vérifier si on est sur la page de connexion SF (loginFlowRequired)
    const loginForm = document.getElementById('username');
    if (loginForm) {
      await handleSignIn(profile);
    } else {
      await fillApplicationForm(profile);
    }
  } else if (isNomuraJobPage) {
    await handleListingPage(profile);
  } else if (isSFPortalLogin) {
    await handleSFPortalLogin(profile);
  } else {
    log(`URL non reconnue : ${url} — filler inactif`);
  }
})();
