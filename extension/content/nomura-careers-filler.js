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
  globalThis.__TALEOS_NOMURA_FILLER_RUNNING__ = true;

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
   * Clique sur le bouton d'upload d'une pièce jointe SF (attachIcon), récupère
   * le fichier depuis Firebase Storage et l'injecte dans l'input file JUIC.
   *
   * @param {string} attachBtnSelector  - sélecteur du bouton d'upload (ex. '[id="56:_attachIcon"]')
   * @param {string} storagePath        - chemin Firebase Storage
   * @param {string} filename           - nom de fichier exact
   * @param {string} label              - libellé pour les logs
   */
  async function uploadFile(attachBtnSelector, storagePath, filename, label = 'Fichier') {
    if (!storagePath) { log(`   ⚠️ ${label} : storagePath absent → skip`); return false; }

    // Télécharger depuis Firebase AVANT toute interaction UI
    const r = await chrome.runtime.sendMessage({ action: 'fetch_storage_file', storagePath }).catch(() => null);
    if (!r?.base64) { log(`   ⚠️ ${label} introuvable dans Firebase Storage (${storagePath})`); return false; }

    const effectiveFilename = String(filename || r.filename || '').trim();
    if (!effectiveFilename) { log(`   ⚠️ ${label} : filename absent → skip`); return false; }

    // Lire le nom déjà affiché (pour log)
    const existingLabel = document.querySelector('[id$="_attachDownloadLabelLink"]');
    const existingName  = existingLabel ? existingLabel.textContent.trim() : 'aucun';
    log(`   ${label} : formulaire='${existingName}' | Firebase='${effectiveFilename}' → Remplacement`);

    // ── Étape 1 : cliquer le bouton d'upload ──────────────────────────────────
    const actionBtn = document.querySelector(attachBtnSelector)
      || document.querySelector('.addAttachments[id$="_attachIcon"]')
      || document.querySelector('.addAttachments');
    if (!actionBtn) { log(`   ⚠️ ${label} : bouton d'upload (${attachBtnSelector}) introuvable`); return false; }
    actionBtn.click();
    await sleep(600);

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
      const lbl = document.querySelector('[id$="_attachDownloadLabelLink"]');
      if (lbl && lbl.textContent.trim() !== existingName) return lbl;
      return null;
    }, 25000, 500);

    if (success) {
      const confirmedName = document.querySelector('[id$="_attachDownloadLabelLink"]')?.textContent.trim() || effectiveFilename;
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

    // ── Upload CV (56:_attachIcon) ────────────────────────────────────────────
    await sleep(600);
    if (profile.cv_storage_path) {
      await uploadFile('[id="56:_attachIcon"].addAttachments', profile.cv_storage_path, profile.cv_filename, 'CV');
    } else {
      log('⚠️ cv_storage_path absent — uploadez le CV manuellement');
    }
    await sleep(800);

    // ── Upload LM (58:_attachIcon) ────────────────────────────────────────────
    if (profile.lm_storage_path) {
      await uploadFile('[id="58:_attachIcon"].addAttachments', profile.lm_storage_path, profile.lm_filename, 'LM');
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

    // ── Politique de confidentialité ──────────────────────────────────────────
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

    const emailInput = await waitFor(
      () => document.getElementById('username') || document.querySelector('input[type="email"]'),
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

    setNativeValue(emailInput, profile.auth_email || '');
    await sleep(300);
    setNativeValue(pwdInput, profile.auth_password || '');
    await sleep(300);

    // Bouton "Sign In"
    const submitBtn =
      document.getElementById('fbqa_signin') ||
      Array.from(document.querySelectorAll('button')).find(b => /sign in|connexion/i.test(b.textContent));

    if (!submitBtn) {
      log('⚠️ Bouton Sign In (#fbqa_signin) introuvable');
      showBanner('Bouton Sign In non trouvé — cliquez manuellement', 'warn');
      return;
    }

    submitBtn.click();
    log('✅ Clic Sign In → attente connexion');
    showBanner('Connexion en cours…');

    // Attendre la fin de la connexion (formulaire ou erreur)
    const loginResult = await waitFor(() => {
      const errorEl = document.querySelector('#errorMsg_1, #uiErrorMsg, #uiErrorContainer_2');
      if (errorEl && errorEl.offsetParent !== null) {
        return { error: errorEl.innerText?.trim() || 'Identifiants incorrects' };
      }
      const loginForm = document.getElementById('username');
      if (!loginForm || loginForm.offsetParent === null) {
        return { success: true };
      }
      return null;
    }, 12000, 400);

    if (loginResult?.error) {
      log(`❌ Connexion échouée : ${loginResult.error}`);
      showBanner(`Connexion Nomura échouée : ${loginResult.error}`, 'error');
      return;
    }

    log('✅ Connexion Nomura réussie');
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 11. Clic sur "Apply now" sur la page offre
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
      10000
    );

    if (!applyBtn) {
      log('⚠️ Bouton "Apply now" introuvable sur la page offre');
      showBanner('Bouton Apply non trouvé — cliquez manuellement', 'warn');
      activateTab();
      return;
    }

    applyBtn.click();
    log('✅ Clic "Apply now" → attente modal Sign In ou formulaire');

    // Attendre modal "Please sign in"
    await sleep(1500);
    const signInLink = await waitFor(
      () => document.querySelector('a[onclick*="openSignInModal"]')
        || Array.from(document.querySelectorAll('a')).find(a =>
             /please sign in|connexion/i.test(a.textContent.trim())
           ),
      5000, 300
    );

    if (signInLink) {
      signInLink.click();
      log('✅ Clic "Please sign in" → ouverture modal connexion');
      await sleep(800);
      await handleSignIn(profile);
    }
    // Après connexion, background.js re-injecte le filler sur la prochaine navigation SF
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 12. Routage principal
  // ══════════════════════════════════════════════════════════════════════════════
  const entry = await getPendingEntry();
  if (!entry?.profile) {
    log('Pas de session Nomura en attente — exit');
    return;
  }

  const profile = entry.profile;
  const url = location.href;

  log(`URL : ${url}`);

  // ── Page de formulaire de candidature SF (portalcareer / career) ─────────────
  const isApplicationForm =
    url.includes('career4.successfactors.com') &&
    (url.includes('career_ns=job_application') || url.includes('portalcareer'));

  // ── Page offre / listing Nomura ───────────────────────────────────────────────
  const isListingPage =
    url.includes('career4.successfactors.com') &&
    !isApplicationForm;

  if (isApplicationForm) {
    // Vérifier si on est sur la page de connexion SF (loginFlowRequired)
    const loginForm = document.getElementById('username');
    if (loginForm) {
      await handleSignIn(profile);
    } else {
      await fillApplicationForm(profile);
    }
  } else if (isListingPage) {
    await handleListingPage(profile);
  } else {
    log(`URL non reconnue : ${url} — filler inactif`);
  }
})();
