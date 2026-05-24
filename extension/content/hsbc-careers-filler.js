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
 * IMPORTANT : ne soumet jamais (#fbqa_apply n'est jamais cliqué automatiquement).
 * Le candidat entre son mot de passe et soumet manuellement.
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

    // Genre : mappe vers les options exactes du formulaire SF HSBC
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
      cvFilename:     String(raw.cv_filename      || 'cv.pdf').trim(),
    };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 4. Bannière Taleos
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
  async function uploadCV(storagePath, filename) {
    if (!storagePath) { log('⚠️ cv_storage_path absent — CV non uploadé'); return false; }

    // Ouvrir le widget d'upload
    const attachIcon = document.getElementById('59:_attachIcon');
    if (!attachIcon) { log('⚠️ Bouton upload CV (59:_attachIcon) introuvable'); return false; }
    attachIcon.click();
    await sleep(800);

    // Attendre l'input file
    const fileInput = await waitFor(
      () => document.getElementById('60:_file') || document.querySelector('input[name="fileData1"]'),
      4000
    );
    if (!fileInput) { log('⚠️ Input file CV introuvable après ouverture du widget'); return false; }

    // Télécharger depuis Firebase via background.js
    log(`⏳ Téléchargement CV depuis Firebase : ${storagePath}`);
    const r = await chrome.runtime.sendMessage({ action: 'fetch_storage_file', storagePath }).catch(() => null);
    if (!r?.base64) { log(`⚠️ CV introuvable dans Firebase Storage (${storagePath})`); return false; }

    // Construire le File avec le nom exact Firebase (pas de renommage)
    const bin = atob(r.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const effectiveFilename = String(filename || r.filename || 'cv.pdf').trim();
    const file = new File([bytes], effectiveFilename, { type: r.type || 'application/pdf' });

    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    fileInput.dispatchEvent(new Event('input',  { bubbles: true }));

    // Attendre confirmation d'upload (59:_attachSuccess visible)
    const success = await waitFor(() => {
      const el = document.getElementById('59:_attachSuccess');
      return el && !el.classList.contains('displayNone') ? el : null;
    }, 20000, 500);

    if (success) {
      log(`✅ CV uploadé : ${effectiveFilename}`);
      return true;
    }

    // Vérification alternative : fbja_uploadedResumeId rempli
    const uploadedId = document.getElementById('fbja_uploadedResumeId');
    if (uploadedId?.value) {
      log(`✅ CV uploadé (via fbja_uploadedResumeId) : ${effectiveFilename}`);
      return true;
    }

    log(`⚠️ Timeout upload CV — vérifiez manuellement (${effectiveFilename})`);
    return false;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 8. Acceptation de la politique de confidentialité
  // ══════════════════════════════════════════════════════════════════════════════
  async function acceptPrivacy() {
    const link = document.getElementById('dataPrivacyId');
    if (!link) { log('⚠️ Lien confidentialité (dataPrivacyId) introuvable'); return false; }

    // Cliquer le lien ouvre le texte de la politique (souvent dans un nouvel onglet ou popup).
    // SuccessFactors marque l'acceptation via fbclc_dpcsId une fois la politique lue.
    link.click();
    await sleep(600);

    // Vérifier si le champ caché fbclc_dpcsId a été mis à jour par SF
    const dpcsInput = document.getElementById('fbclc_dpcsId');
    if (dpcsInput && !dpcsInput.value) {
      // Certaines versions SF acceptent automatiquement au clic ; forcer la valeur si besoin.
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(dpcsInput, '1');
      dpcsInput.dispatchEvent(new Event('change', { bubbles: true }));
      log('✅ Politique de confidentialité acceptée (fbclc_dpcsId forcé)');
    } else {
      log('✅ Lien politique de confidentialité cliqué — vérifiez que la case est cochée');
    }

    return true;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 9. Remplissage du formulaire principal (SF new-user application form)
  // ══════════════════════════════════════════════════════════════════════════════
  async function fillApplicationForm(profile) {
    const p = normalizeProfile(profile);
    log(`Début remplissage pour ${p.firstName} ${p.lastName} <${p.email}>`);
    showBanner('Remplissage en cours…');

    // Attendre que le formulaire soit prêt
    const emailField = await waitFor(() => document.getElementById('fbclc_userName'), 8000);
    if (!emailField) {
      log('⚠️ Formulaire SF non détecté (fbclc_userName absent) — abandon');
      showBanner('Formulaire non détecté', 'error');
      return;
    }
    await sleep(600);

    // ── Identifiants (email uniquement — mot de passe laissé à l'utilisateur) ──
    setNativeValue(emailField, p.email);
    await sleep(150);
    const emailConf = document.getElementById('fbclc_emailConf');
    if (emailConf) setNativeValue(emailConf, p.email);
    log(`✅ Email → ${p.email}`);

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
    await sleep(400);
    // Proches travaillant chez HSBC → Non
    await selectPicklist(document.getElementById('13:_input'), 'No', 'Proches HSBC');
    await sleep(350);

    // Ancien employé / prestataire → Non
    await selectPicklist(document.getElementById('17:_input'), 'No', 'Ancien employé HSBC');
    await sleep(350);

    // Genre
    await selectPicklist(document.getElementById('21:_input'), p.gender, 'Genre');
    await sleep(350);

    // Droit au travail dans le pays → Oui
    await selectPicklist(document.getElementById('25:_input'), 'Yes', 'Droit au travail');
    await sleep(350);

    // Employé par les auditeurs externes HSBC → Non
    await selectPicklist(document.getElementById('29:_input'), 'No', "Auditeurs externes HSBC");
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

    // ── Fin ───────────────────────────────────────────────────────────────────────
    log('✅ Formulaire rempli — entrez votre mot de passe puis cliquez Appliquer');
    showBanner(
      '✅ Rempli — entrez votre mot de passe puis cliquez "Apply" pour envoyer',
      'success'
    );
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 10. Gestion des pages SF listing et Eightfold (clic automatique Apply)
  // ══════════════════════════════════════════════════════════════════════════════
  async function handleListingPage(profile) {
    log('Page listing SF HSBC — attente bouton Apply…');
    showBanner('Ouverture du formulaire de candidature…');

    const applyBtn = await waitFor(
      () => document.getElementById('applyButton_top') || document.getElementById('applyButton_bottom'),
      10000
    );
    if (!applyBtn) {
      log('⚠️ Bouton Apply introuvable sur la page SF listing');
      showBanner('Bouton Apply non trouvé — cliquez manuellement', 'warn');
      return;
    }

    applyBtn.click();
    log('✅ Clic Apply → navigation vers le formulaire candidature');
  }

  async function handleEightfoldOffer(profile) {
    log('Page offre Eightfold HSBC — recherche bouton Apply…');
    showBanner('Ouverture de la page SuccessFactors…');

    // Sur Eightfold, le bouton Apply appelle checkDpcs2AndProceed
    // qui peut afficher une popup DPCS avant de naviguer vers SF.
    const applyBtn = await waitFor(
      () => document.getElementById('applyButton_top') || document.getElementById('applyButton_bottom'),
      8000
    );
    if (!applyBtn) {
      log('⚠️ Bouton Apply introuvable sur la page Eightfold');
      showBanner('Bouton Apply non trouvé — cliquez manuellement', 'warn');
      return;
    }

    applyBtn.click();
    log('✅ Clic Apply Eightfold → attente navigation vers SuccessFactors');
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 11. Point d'entrée principal
  // ══════════════════════════════════════════════════════════════════════════════
  async function main() {
    // Détection de la page via le blueprint
    const page = blueprint?.detectPage?.();
    if (!page) {
      // Vérification manuelle minimale : on est sur HSBC SF ou Eightfold ?
      const host = location.hostname;
      const href = location.href;
      if (!host.includes('career2.successfactors.eu') && !host.includes('portal.careers.hsbc.com')) return;
      if (!href.includes('hsbcholdin') && !host.includes('portal.careers.hsbc.com')) return;
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

    // Cas 1 : formulaire candidature SF (new-user registration + apply)
    const isSFForm = host.includes('career2.successfactors.eu')
      && path.startsWith('/career')
      && !href.includes('career_ns=job_listing')
      && !href.includes('career_ns=job_search');

    if (isSFForm) {
      await fillApplicationForm(profile);
      return;
    }

    // Cas 2 : page listing SF (avant clic Apply)
    const isSFListing = host.includes('career2.successfactors.eu')
      && href.includes('hsbcholdin');

    if (isSFListing) {
      await handleListingPage(profile);
      return;
    }

    // Cas 3 : page offre Eightfold
    const isEightfold = host.includes('portal.careers.hsbc.com')
      && path.includes('/careers/job/');

    if (isEightfold) {
      await handleEightfoldOffer(profile);
      return;
    }

    log(`Page non reconnue pour le flux HSBC : ${href}`);
  }

  // Lancer avec un léger délai pour laisser le DOM se stabiliser
  await sleep(800);
  await main();
})();
