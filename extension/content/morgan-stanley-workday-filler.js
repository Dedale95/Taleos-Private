/**
 * Taleos — Morgan Stanley Workday Filler  v3
 * Portail : ms.wd5.myworkdayjobs.com  (locale fr-CA)
 *
 * ══ DOM RÉEL exploré avec MCP le 2026-06-07 ══════════════════════════════════
 *
 * ÉTAPE 1 — Mes renseignements
 *   formField-source                → combobox input  id=source--source
 *   formField-candidateIsPreviousWorker → radio input id=j3sg* (valeur "true"/"false")
 *   formField-country               → combobox input  (rechercher "France")
 *   formField-legalName--firstName  → input[text]     id=name--legalName--firstName
 *   formField-legalName--lastName   → input[text]     id=name--legalName--lastName
 *   formField-preferredCheck        → checkbox  (laisser décoché)
 *   formField-addressLine1          → input[text]
 *   formField-addressLine2          → input[text]
 *   formField-city                  → input[text]
 *   formField-countryRegion         → input[text]  (département, optionnel)
 *   formField-postalCode            → input[text]
 *   formField-phoneType             → combobox  (chercher "Mobile" ou "Cellulaire")
 *   formField-countryPhoneCode      → combobox  (chercher "France")
 *   formField-phoneNumber           → input[text]
 *   formField-extension             → input[text]  (optionnel)
 *
 * ÉTAPE 2 — Mon expérience
 *   Bouton "Ajouter" section Études → révèle :
 *     formField-school              → combobox input  id=education-N--school
 *     formField-degree              → select-button   id=education-N--degree
 *       options: "High School or High School Equivalent", "Diploma",
 *                "Degree in Progress", "Professional Degree",
 *                "Master's Degree", "Bachelor's Degree", "Doctorat", "Associate Degree"
 *     formField-fieldOfStudy        → combobox input  id=education-N--fieldOfStudy
 *   formField-skills                → input[text]     id=skills--skills
 *   formField- (vide)               → input[file]     (CV upload)
 *   formField-linkedInAccount       → input[text]     id=socialNetworkAccounts--linkedInAccount
 *
 * ÉTAPE 3 — Questions liées à la candidature
 *   IDs = GUIDs dynamiques → identification par label text
 *   Type de champ : button[id] (select-button, pas aria-haspopup)
 *   Options : "Yes" / "No" (EN même en fr-CA)
 *   Q1  : "Do you consent to receive follow up communication via SMS WhatsApp
 *           from Talent Acquisition..." → Yes (profil ms_sms_consent)
 *   Q2  : "légalement autorisé à travailler..." → Yes
 *   Q3  : "besoin que Morgan Stanley sponsorise un visa..." → No
 *   Q4  : "besoin à l'avenir d'un parrainage..." → No
 *   Q5-9: employé gouvernement / fonctionnaire → No
 *
 * ÉTAPE 4 — Divulgations volontaires
 *   formField-gender                → select-button  id=personalInfoPerson--gender
 *     options: "Femme", "Homme", "Préfère de pas s'identifier"
 *   Field-acceptTermsAndAgreements  → checkbox       id=termsAndConditions--acceptTermsAndAgreements
 *     ⚠️ OBLIGATOIRE
 *
 * ÉTAPE 5 — Réviser → soumission manuelle uniquement
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Champs Firebase utilisés :
 *   first_name, last_name, address, city, postal_code, phone_number,
 *   linkedin_url, cv_storage_path, cv_filename, gender,
 *   job_title            (ex: "Associate") — intitulé du poste actuel
 *   current_employer     (ex: "NatWest Markets")
 *   current_role_start_date (ex: "2022-08-08") — format YYYY-MM ou YYYY-MM-DD
 *   ms_source            (défaut: "Site de carrière de Morgan Stanley")
 *   ms_previously_employed (défaut: "No")
 *   ms_sms_consent       (défaut: "Yes")
 *   ms_school            (ex: "Sciences Po Paris")
 *   ms_degree            (ex: "Master's Degree")
 *   ms_field_of_study    (ex: "Finance")
 *   ms_skills            (ex: "Python, Finance, Analyse financière")
 */
(function () {
  'use strict';

  console.log('[Workday — Morgan Stanley] VERSION_CHECK: 1.2.286-local');

  if (!/ms\.wd5\.myworkdayjobs\.com/i.test(location.hostname || '')) return;
  if (globalThis.__TALEOS_MS_FILLER_RUNNING__) return;
  globalThis.__TALEOS_MS_FILLER_RUNNING__ = true;

  // Fermer immédiatement la bannière cookie (si présente) — bloque sinon tout le reste
  (function dismissCookieBanner() {
    const declineBtn = document.querySelector('[data-automation-id="legalNoticeDeclineButton"]');
    if (declineBtn && declineBtn.offsetWidth > 0) { declineBtn.click(); return; }
    // Bannière pas encore rendue → observer
    const obs = new MutationObserver(() => {
      const btn = document.querySelector('[data-automation-id="legalNoticeDeclineButton"]');
      if (btn && btn.offsetWidth > 0) { btn.click(); obs.disconnect(); }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => obs.disconnect(), 15000);
  })();

  // ─── Constantes ─────────────────────────────────────────────────────────────
  const PENDING_KEY = 'taleos_pending_morgan_stanley_workday';
  const TAB_KEY     = 'taleos_morgan_stanley_workday_tab_id';
  const BANNER_ID   = 'taleos-ms-banner';
  const LOG_PREFIX  = '[Workday — Morgan Stanley]';
  const logged      = new Set();

  // ─── Utilitaires ────────────────────────────────────────────────────────────
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function log(msg) {
    const txt = `${LOG_PREFIX} ${msg}`;
    if (logged.has(txt)) return;
    logged.add(txt);
    console.log(txt);
    const level = /❌/.test(txt) ? 'error' : /⚠️/.test(txt) ? 'warn' : 'info';
    try {
      chrome.runtime.sendMessage({
        action: 'extension_run_log', source: 'morgan-stanley-workday-filler',
        level, message: txt, ts: new Date().toISOString()
      }).catch(() => {});
    } catch (_) {}
  }

  function setBanner(text, color) {
    let el = document.getElementById(BANNER_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = BANNER_ID;
      Object.assign(el.style, {
        position: 'fixed', top: '60px', left: '0', width: '100%', zIndex: '2147483647',
        background: '#002D62', color: '#fff', padding: '8px 16px',
        fontSize: '13px', fontWeight: '600', textAlign: 'center',
        boxShadow: '0 2px 6px rgba(0,0,0,0.3)', fontFamily: 'sans-serif'
      });
      document.documentElement.appendChild(el);
    }
    if (color) el.style.background = color;
    el.textContent = text;
  }

  // Injecter valeur React sans casser le state
  function reactSet(el, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function clickEl(el) {
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    await sleep(150);
    ['pointerdown', 'pointerup'].forEach(t =>
      el.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, composed: true, view: window, isPrimary: true }))
    );
    ['mousedown', 'mouseup', 'click'].forEach(t =>
      el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, composed: true, view: window }))
    );
    el.click();
  }

  // Clic CDP via chrome.debugger (isTrusted:true) — pour combobox options et submit
  async function trustedClickEl(el) {
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    await sleep(200);
    const rect = el.getBoundingClientRect();
    const x = Math.round(rect.left + rect.width / 2);
    const y = Math.round(rect.top + rect.height / 2);
    await chrome.runtime.sendMessage({ action: 'trusted_click', x, y }).catch(() => {});
    await sleep(200);
  }

  // ─── Remplir un champ texte simple (formField-*) ─────────────────────────────
  async function fillTextField(automationId, value, label) {
    if (!value) { log(`  ⏭️  ${label || automationId}: vide → ignoré`); return false; }
    const container = document.querySelector(`[data-automation-id="${automationId}"]`);
    if (!container) { log(`  ⚠️  ${label || automationId}: champ introuvable`); return false; }
    const input = container.querySelector('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea');
    if (!input) { log(`  ⚠️  ${label || automationId}: input introuvable`); return false; }
    const current = (input.value || '').trim();
    if (current && current.toLowerCase() === String(value).trim().toLowerCase()) {
      log(`  ✓ ${label}: déjà "${current}" → skip`); return true;
    }
    reactSet(input, String(value).trim());
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    log(`  ✓ ${label}: "${value}"`);
    return true;
  }

  // ─── Workday combobox (champ de recherche + dropdown promptOption) ───────────
  // Utilisé pour : source, pays, école, champ d'études, phoneType, phoneCode
  async function fillCombobox(automationId, searchText, label, timeoutMs = 5000) {
    if (!searchText) { log(`  ⏭️  ${label}: vide → ignoré`); return false; }
    const container = document.querySelector(`[data-automation-id="${automationId}"]`);
    if (!container) { log(`  ⚠️  ${label}: formField introuvable`); return false; }

    // Vérifier si déjà rempli (pill/selected item présent)
    const selectedPill = container.querySelector(
      '[data-automation-id="selectedItem"],[data-automation-id="promptOption"][aria-selected="true"]'
    );
    if (selectedPill && new RegExp(searchText, 'i').test(selectedPill.textContent || '')) {
      log(`  ✓ ${label}: déjà "${selectedPill.textContent.trim()}" → skip`); return true;
    }

    const input = container.querySelector('input:not([type="hidden"])');
    if (!input) { log(`  ⚠️  ${label}: combobox input introuvable`); return false; }

    // Effacer et taper le texte de recherche
    input.focus();
    await sleep(200);
    reactSet(input, searchText);
    await sleep(300);

    // Attendre les options
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const opts = Array.from(document.querySelectorAll(
        '[data-automation-id="promptOption"], [role="option"]'
      )).filter(o => o.offsetWidth > 0);

      const opt = opts.find(o => new RegExp(searchText, 'i').test(o.textContent || ''));
      if (opt) {
        await trustedClickEl(opt);
        await sleep(300);
        log(`  ✓ ${label}: "${opt.textContent.trim()}"`);
        return true;
      }
      await sleep(200);
    }

    // Fermer et signaler
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    log(`  ⚠️  ${label}: option "${searchText}" introuvable dans le combobox`);
    return false;
  }

  // ─── Workday select-button (bouton[id] → [role="option"]) ────────────────────
  // Utilisé pour : degree, gender, step 3 questions
  async function fillSelectButton(buttonEl, targetText, label, timeoutMs = 4000) {
    if (!buttonEl || !targetText) return false;

    const current = (buttonEl.textContent || '').trim();
    if (current && !(/sélectionnez|select a value/i.test(current)) &&
        new RegExp(targetText, 'i').test(current)) {
      log(`  ✓ ${label}: déjà "${current}" → skip`); return true;
    }

    await clickEl(buttonEl);
    await sleep(400);

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const opts = Array.from(document.querySelectorAll('[role="option"]'))
        .filter(o => o.offsetWidth > 0);
      const opt = opts.find(o => new RegExp(targetText, 'i').test(o.textContent || ''));
      if (opt) {
        await trustedClickEl(opt);
        await sleep(300);
        log(`  ✓ ${label}: "${opt.textContent.trim()}"`);
        return true;
      }
      await sleep(200);
    }

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    log(`  ⚠️  ${label}: option "${targetText}" introuvable`);
    return false;
  }

  // ─── Upload CV depuis Firebase Storage ───────────────────────────────────────
  async function setFileFromStorage(fileInput, storagePath, filename) {
    if (!fileInput || !storagePath) return false;
    const r = await chrome.runtime.sendMessage({ action: 'fetch_storage_file', storagePath }).catch(() => null);
    if (!r || r.error || !r.base64) { log(`  ❌ fetch_storage_file: ${r?.error || 'pas de base64'}`); return false; }
    const bin = atob(r.base64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const blob = new Blob([arr], { type: r.type || 'application/pdf' });
    const file = new File([blob], filename || r.filename || 'cv.pdf', { type: blob.type });
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    fileInput.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(500);
    return true;
  }

  // ─── Détecter l'étape courante ───────────────────────────────────────────────
  function currentStep() {
    // Chercher l'élément actif dans la barre de progression
    const activeStep = document.querySelector('[data-automation-id="progressBarActiveStep"]')
      || document.querySelector('.css-1xtbc5b')  // fallback classe CSS
      || (() => {
        // Chercher le titre h2
        const h2 = document.querySelector('h2');
        return h2;
      })();
    const name = (activeStep?.textContent || document.querySelector('h2')?.textContent || '').toLowerCase().trim();
    if (name.includes('mes renseignements') || name.includes('my information'))     return 'my_information';
    if (name.includes('mon expérience')     || name.includes('my experience'))      return 'my_experience';
    if (name.includes('questions liées')    || name.includes('application quest'))  return 'application_questions';
    if (name.includes('divulgations')       || name.includes('voluntary'))          return 'voluntary_disclosures';
    if (name.includes('réviser')            || name.includes('review'))             return 'review';
    // Étape 1 login : "Créer un compte/Ouvrir une session" ou présence d'un champ password
    if (name.includes('créer un compte') || name.includes('ouvrir une session') ||
        name.includes('create account')  || name.includes('sign in') ||
        !!document.querySelector('input[type="password"]')) return 'login';
    return 'unknown';
  }

  async function waitForStep(expected, timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (currentStep() === expected) return true;
      await sleep(400);
    }
    return false;
  }

  // ─── Bouton "Enregistrer et continuer" ───────────────────────────────────────
  async function saveAndContinue() {
    await sleep(400);
    const btn = Array.from(document.querySelectorAll('button')).find(b =>
      b.offsetWidth > 0 &&
      /enregistrer\s+et\s+continuer|save\s+and\s+continue/i.test((b.innerText || '').trim())
    ) || document.querySelector('[data-automation-id="pageFooterNextButton"]');
    if (!btn) { log('⚠️ Bouton "Enregistrer et continuer" introuvable'); return false; }
    log(`  ▶ Clic "Enregistrer et continuer"...`);
    await trustedClickEl(btn);
    await sleep(3000);

    // Détecter les erreurs "liée à la page" (conflits Workday données existantes)
    const pageErrors = [...document.querySelectorAll('[data-automation-id*="validationError"], [class*="error"]')]
      .filter(el => el.offsetWidth > 0 && /liée à la page|page-level/i.test(el.textContent || ''));
    if (pageErrors.length > 0) {
      log(`  ⚠️ ${pageErrors.length} erreur(s) liée(s) à la page (données existantes) — ignorées`);
    }
    return true;
  }

  // ─── Connexion ───────────────────────────────────────────────────────────────
  function isLoggedIn() {
    // Si password visible → page de login
    const pwdVisible = [...document.querySelectorAll('input[type="password"]')]
      .some(i => i.offsetWidth > 0);
    if (pwdVisible) return false;
    // Barre de progression = formulaire de candidature affiché
    if (document.querySelector('[data-automation-id="progressBarActiveStep"]')) return true;
    // Champs spécifiques post-login
    if (document.querySelector('[data-automation-id="formField-legalName--firstName"]') ||
        document.querySelector('[data-automation-id="formField-source"]') ||
        document.querySelector('[data-automation-id="formField-school"]')) return true;
    // Page "Start Your Application" (3 choix) → pas connecté
    const isStartPage = Array.from(document.querySelectorAll('button,a')).some(el =>
      el.offsetWidth > 0 && /apply manually|postuler manuellement/i.test(el.innerText || '')
    );
    if (isStartPage) return false;
    // Autres formFields
    if (document.querySelector('[data-automation-id*="formField"]')) return true;
    return false;
  }

  async function handleSignIn(authEmail, authPassword) {
    // Attendre que la page soit prête : soit déjà connecté, soit formulaire login visible
    let waitInit = 0;
    while (waitInit < 12000) {
      if (isLoggedIn()) { log('  ✓ Déjà connecté'); return true; }
      const emailEl = document.querySelector('[data-automation-id="email"]');
      if (emailEl && emailEl.offsetWidth > 0) break;
      await sleep(300); waitInit += 300;
    }
    if (isLoggedIn()) { log('  ✓ Déjà connecté'); return true; }

    // Log diagnostique : boutons visibles sur la page
    const visibleBtns = Array.from(document.querySelectorAll('button,a'))
      .filter(el => el.offsetWidth > 0 && (el.innerText || '').trim())
      .map(el => `"${(el.innerText || '').trim().slice(0, 40)}"[${el.getAttribute('data-automation-id') || el.tagName}]`)
      .slice(0, 15);
    log(`  🔍 Page state: step="${currentStep()}", buttons=[${visibleBtns.join(', ')}]`);

    log('🔐 Connexion à Morgan Stanley Workday...');

    // Si on est sur la page "Commencer sa candidature" (3 choix), cliquer
    // "Utiliser ma dernière candidature" pour accéder au vrai formulaire de login.
    const lastAppBtn = Array.from(document.querySelectorAll('button,a')).find(el =>
      el.offsetWidth > 0 && /utiliser ma derni|use my last application/i.test(el.innerText || '')
    );
    if (lastAppBtn) {
      log('🖱️ Clic sur "Utiliser ma dernière candidature"...');
      await clickEl(lastAppBtn);
      await sleep(2000);
    }

    // Cliquer "Ouvrir une session" si nécessaire (page 3-choix ou page "Créer un compte")
    // Essayer d'abord data-automation-id="signInLink", puis texte, puis utility button en fallback
    const signInLink = document.querySelector('[data-automation-id="signInLink"]')
      || Array.from(document.querySelectorAll('a,button')).find(el =>
           el.offsetWidth > 0 && /ouvrir une session|sign in/i.test(el.textContent || '')
         );
    if (signInLink) {
      log(`  🖱️ Clic signInLink: "${(signInLink.innerText || '').trim().slice(0, 40)}"[${signInLink.getAttribute('data-automation-id') || ''}]`);
      await clickEl(signInLink);
      // Attendre que le champ email du formulaire sign-in soit visible (jusqu'à 8s)
      let waited = 0;
      while (waited < 8000) {
        await sleep(300); waited += 300;
        const em = document.querySelector('[data-automation-id="email"]');
        if (em && em.offsetWidth > 0) break;
      }
      await sleep(300);
    }

    // Après transition : chercher les champs email et mot de passe
    let emailEl = document.querySelector('[data-automation-id="email"]');
    // Fallback : input type=email ou input nommé "email" visible
    if (!emailEl || emailEl.offsetWidth === 0) {
      emailEl = [...document.querySelectorAll('input[type="email"], input[name="email"], input[autocomplete="username email"]')]
        .find(i => i.offsetWidth > 0) || null;
    }
    const pwdEl = [...document.querySelectorAll('input[type="password"]')]
      .find(i => i.offsetWidth > 0 && i.getAttribute('data-automation-id') !== 'verifyPassword');

    log(`  🎯 Champs login : email=${emailEl ? (emailEl.getAttribute('data-automation-id') || emailEl.id || emailEl.name || 'found') : 'null'}, pwd=${pwdEl ? 'found' : 'null'}`);

    if (!emailEl || !pwdEl) { log('❌ Formulaire de connexion introuvable'); return false; }
    if (!authEmail || !authPassword) {
      log('❌ Identifiants MS manquants — configurez-les dans Connexions');
      setBanner('❌ Identifiants Morgan Stanley manquants', '#c62828');
      return false;
    }

    // Email
    reactSet(emailEl, authEmail);
    await sleep(200);

    // Mot de passe — vider complètement avant de remplir
    pwdEl.focus();
    pwdEl.select();
    reactSet(pwdEl, '');
    await sleep(100);
    reactSet(pwdEl, authPassword);
    await sleep(300);

    // Soumettre via chrome.debugger (trusted click isTrusted:true)
    const submitBtn = document.querySelector('[data-automation-id="signInSubmitButton"]')
      || [...document.querySelectorAll('button')].find(b =>
           b.offsetWidth > 0 &&
           /ouvrir une session|sign in/i.test(b.textContent || '') &&
           b.getAttribute('data-automation-id') !== 'utilityButtonSignIn'
         );
    if (submitBtn) {
      submitBtn.scrollIntoView({ block: 'center' });
      await sleep(300);
      const rect = submitBtn.getBoundingClientRect();
      const x = Math.round(rect.left + rect.width / 2);
      const y = Math.round(rect.top + rect.height / 2);
      await chrome.runtime.sendMessage({ action: 'trusted_click', x, y }).catch(() => {});
      await sleep(300);
    } else {
      pwdEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    }

    // Attendre la navigation vers le formulaire de candidature
    let waited = 0;
    while (waited < 15000) {
      await sleep(500); waited += 500;
      if (isLoggedIn()) break;
    }

    const ok = isLoggedIn();
    if (!ok) log('❌ Connexion MS échouée — vérifiez vos identifiants');
    return ok;
  }

  // ─── Page intermédiaire "Postuler manuellement" ───────────────────────────────
  async function handleStartPage() {
    // Déjà sur /applyManually → rien à faire
    if (location.href.includes('applyManually')) return;
    let waited = 0;
    while (waited < 8000) {
      const manualBtn = Array.from(document.querySelectorAll('button, a')).find(el =>
        el.offsetWidth > 0 && /postuler manuellement|apply manually/i.test(el.innerText || '')
      );
      if (manualBtn) {
        log('🖱️ Clic sur "Postuler manuellement"...');
        await clickEl(manualBtn);
        await sleep(2000);
        return;
      }
      await sleep(500); waited += 500;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ÉTAPE 1 — Mes renseignements
  // ═══════════════════════════════════════════════════════════════════════════
  async function fillMesRenseignements(p) {
    log('📝 Étape 1 — Mes renseignements');
    setBanner('📝 Mes renseignements en cours...');

    // Attendre que React rende les champs
    let w = 0;
    while (w < 8000) {
      if (document.querySelector('[data-automation-id="formField-legalName--firstName"]') ||
          document.querySelector('[data-automation-id="formField-source"]')) break;
      await sleep(300); w += 300;
    }
    await sleep(500);

    // ── Source : combobox "Comment avez-vous entendu parler de nous ?" ──────────
    // Le champ est un combobox qui ouvre un dropdown à 2 niveaux.
    // Valeur profil ms_source (défaut: "Site de carrière de Morgan Stanley")
    const msSource = p.ms_source || 'Site de carrière de Morgan Stanley';
    const sourceContainer = document.querySelector('[data-automation-id="formField-source"]');
    if (sourceContainer) {
      const alreadySet = /site de carri[eè]re de morgan stanley|morgan stanley careers/i.test(
        sourceContainer.innerText || ''
      );
      if (alreadySet) {
        log('  ✓ Source: déjà remplie → skip');
      } else {
        // Taper pour rechercher → niveau 1 "Site de carrière"
        const sourceInput = sourceContainer.querySelector('input:not([type="hidden"])');
        if (sourceInput) {
          // Ouvrir le dropdown avec un vrai clic CDP (isTrusted: true)
          await trustedClickEl(sourceInput);
          await sleep(500);
          reactSet(sourceInput, 'Site de carrière');
          await sleep(1000);
          // Chercher l'option niveau 1 parent (pas celle avec "de Morgan Stanley")
          let opts = Array.from(document.querySelectorAll('[data-automation-id="promptOption"]'))
            .filter(o => o.offsetWidth > 0);
          log(`  ℹ️ Source: ${opts.length} option(s) visibles après saisie L1`);
          const parentOpt = opts.find(o =>
            /site de carri[eè]re(?!\s+de)/i.test(o.textContent || '')
          );
          if (parentOpt) {
            await trustedClickEl(parentOpt);
            await sleep(800);
            // Niveau 2 : sélectionner l'option exacte
            const opts2 = Array.from(document.querySelectorAll('[data-automation-id="promptOption"]'))
              .filter(o => o.offsetWidth > 0);
            log(`  ℹ️ Source: ${opts2.length} option(s) visibles après L1`);
            const targetOpt = opts2.find(o =>
              new RegExp(msSource.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(o.textContent || '')
            ) || opts2.find(o => /morgan stanley/i.test(o.textContent || ''));
            if (targetOpt) {
              await trustedClickEl(targetOpt);
              log(`  ✓ Source: "${targetOpt.textContent.trim()}"`);
            } else {
              log(`  ⚠️ Source: option niveau 2 introuvable → essai direct`);
              await trustedClickEl(sourceInput);
              await sleep(300);
              reactSet(sourceInput, msSource);
              await sleep(1000);
              const directOpt = Array.from(document.querySelectorAll('[data-automation-id="promptOption"]'))
                .find(o => o.offsetWidth > 0 && /morgan stanley/i.test(o.textContent || ''));
              if (directOpt) { await trustedClickEl(directOpt); log(`  ✓ Source (direct): "${directOpt.textContent.trim()}"`); }
            }
          } else {
            log(`  ⚠️ Source: option niveau 1 introuvable (opts: ${opts.map(o=>o.textContent.trim().slice(0,30)).join(' | ')})`);
          }
        }
      }
    }

    // ── Ex-employé Morgan Stanley → radio Oui/Non ────────────────────────────
    const prevWorkerContainer = document.querySelector('[data-automation-id="formField-candidateIsPreviousWorker"]');
    if (prevWorkerContainer) {
      const wasEmployee = (p.ms_previously_employed || 'No').toLowerCase() === 'yes';
      // Les radios sont des inputs[type=radio] — trouver par label Oui/Non
      const radios = prevWorkerContainer.querySelectorAll('input[type="radio"]');
      let targetRadio = null;
      for (const radio of radios) {
        const lbl = (document.querySelector(`label[for="${radio.id}"]`)?.textContent || '').trim();
        if (wasEmployee && /oui|yes/i.test(lbl)) { targetRadio = radio; break; }
        if (!wasEmployee && /non|no/i.test(lbl))  { targetRadio = radio; break; }
      }
      if (!targetRadio) {
        // Fallback : valeur attribut "true"/"false"
        targetRadio = prevWorkerContainer.querySelector(`input[value="${wasEmployee ? 'true' : 'false'}"]`);
      }
      if (targetRadio && !targetRadio.checked) {
        await clickEl(targetRadio);
        log(`  ✓ Ex-employé MS: ${wasEmployee ? 'Oui' : 'Non'}`);
      } else if (targetRadio?.checked) {
        log(`  ✓ Ex-employé MS: déjà ${wasEmployee ? 'Oui' : 'Non'} → skip`);
      }
    }

    // ── Pays → France (combobox, souvent déjà pré-rempli) ────────────────────
    const countryContainer = document.querySelector('[data-automation-id="formField-country"]');
    if (countryContainer) {
      const alreadyFR = /france/i.test(countryContainer.innerText || '');
      if (!alreadyFR) {
        await fillCombobox('formField-country', 'France', 'Pays');
      } else {
        log('  ✓ Pays: déjà France → skip');
      }
    }

    // ── Prénom / Nom ──────────────────────────────────────────────────────────
    const firstName = p.firstname || p.first_name || p.firstName || p.prenom || p.given_name || p.forename || '';
    const lastName  = p.lastname  || p.last_name  || p.lastName  || p.nom   || p.family_name || p.surname  || '';
    await fillTextField('formField-legalName--firstName', firstName, 'Prénom');
    await fillTextField('formField-legalName--lastName',  lastName,  'Nom');

    // ── Adresse ───────────────────────────────────────────────────────────────
    await fillTextField('formField-addressLine1', p.address,                  'Adresse');
    await fillTextField('formField-addressLine2', p.address_line2 || '',      'Adresse 2');
    await fillTextField('formField-city',         p.city,                     'Ville');
    await fillTextField('formField-postalCode',   p.postal_code || p.zipcode, 'Code postal');
    // countryRegion (Département) — effacer systématiquement si vide pour éviter
    // qu'une valeur par défaut Workday (ex: "Non") apparaisse dans la comparaison d'adresse.
    {
      const regionContainer = document.querySelector('[data-automation-id="formField-countryRegion"]');
      if (regionContainer) {
        const regionValue = p.region || p.department_number || '';
        const regionInput = regionContainer.querySelector('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea');
        if (regionInput) {
          if (regionValue) {
            reactSet(regionInput, regionValue);
            log('  ✓ Département: ' + regionValue);
          } else if (regionInput.value && regionInput.value !== '') {
            reactSet(regionInput, '');
            log('  ✓ Département: effacé (valeur par défaut supprimée)');
          }
        }
        // Cas select/dropdown (ex: Workday affiche un menu déroulant avec "Non" par défaut)
        const regionSelect = regionContainer.querySelector('select');
        if (regionSelect && !regionValue && regionSelect.value) {
          regionSelect.value = '';
          regionSelect.dispatchEvent(new Event('change', { bubbles: true }));
          log('  ✓ Département (select): réinitialisé');
        }
      }
    }

    // ── Type de téléphone → Mobile / Cellulaire ────────────────────────────────
    const phoneTypeContainer = document.querySelector('[data-automation-id="formField-phoneType"]');
    if (phoneTypeContainer) {
      const alreadyMobile = /mobile|cellulaire/i.test(phoneTypeContainer.innerText || '');
      if (!alreadyMobile) {
        await fillCombobox('formField-phoneType', 'Mobile', 'Type téléphone') ||
        await fillCombobox('formField-phoneType', 'Cellulaire', 'Type téléphone');
      } else {
        log('  ✓ Type téléphone: déjà Mobile → skip');
      }
    }

    // ── Indicatif pays → France (+33) ────────────────────────────────────────
    const phoneCodeContainer = document.querySelector('[data-automation-id="formField-countryPhoneCode"]');
    if (phoneCodeContainer) {
      const alreadyFR33 = /france|\+33/i.test(phoneCodeContainer.innerText || '');
      if (!alreadyFR33) {
        await fillCombobox('formField-countryPhoneCode', 'France', 'Indicatif (+33)');
      } else {
        log('  ✓ Indicatif: déjà France (+33) → skip');
      }
    }

    // ── Numéro de téléphone ────────────────────────────────────────────────────
    const phone = (p['phone-number'] || p.phone_number || p.phone || '').replace(/\s/g, '');
    if (phone) {
      await fillTextField('formField-phoneNumber', phone, 'Téléphone');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ÉTAPE 2 — Mon expérience
  // ═══════════════════════════════════════════════════════════════════════════
  // ─── Remplir l'expérience professionnelle ────────────────────────────────────
  // Champs : job_title, current_employer, current_role_start_date
  // Workday IDs : workExperience-N--jobTitle, workExperience-N--company,
  //               workExperience-N--location, workExperience-N--startDate--month
  async function fillWorkExperience(p) {
    const jobTitle  = p.job_title || p.jobTitle || '';
    const company   = p.current_employer || p.employer || p.company || '';
    const startDate = p.current_role_start_date || p.start_date || '';

    if (!jobTitle && !company) {
      log('  ⏭️  Expérience pro: aucune donnée (job_title, current_employer) → skip');
      return;
    }

    // Trouver les champs de la première expérience professionnelle (index 0 ou 1)
    // Les IDs Workday sont : workExperience-N--jobTitle (N = nombre variable)
    const jobTitleInput = document.querySelector('[id*="workExperience"][id*="jobTitle"]') ||
      document.querySelector('[data-automation-id="formField-jobTitle"] input:not([type="hidden"])');

    if (!jobTitleInput) {
      log('  ⚠️  Expérience pro: champ jobTitle introuvable');
      return;
    }

    // Titre d'emploi
    if (jobTitle) {
      const cur = (jobTitleInput.value || '').trim();
      if (cur.toLowerCase() !== jobTitle.toLowerCase()) {
        reactSet(jobTitleInput, jobTitle);
        await sleep(300);
        // Fermer le dropdown s'il s'ouvre
        const escKey = new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true });
        document.dispatchEvent(escKey);
        log(`  ✓ Titre d'emploi: "${jobTitle}"`);
      } else {
        log(`  ✓ Titre d'emploi: déjà "${cur}" → skip`);
      }
    }

    // Société / Employeur
    if (company) {
      const companyInput = document.querySelector('[id*="workExperience"][id*="company"]') ||
        document.querySelector('[data-automation-id="formField-company"] input:not([type="hidden"])');
      if (companyInput) {
        const cur = (companyInput.value || '').trim();
        if (!cur || cur.toLowerCase() !== company.toLowerCase()) {
          reactSet(companyInput, company);
          await sleep(300);
          const escKey = new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true });
          document.dispatchEvent(escKey);
          log(`  ✓ Société: "${company}"`);
        } else {
          log(`  ✓ Société: déjà "${cur}" → skip`);
        }
      }
    }

    // Emplacement (location) — si disponible dans le profil
    const location = p.work_location || p.current_location || p.location || '';
    if (location) {
      const locationInput = document.querySelector('[id*="workExperience"][id*="location"]') ||
        document.querySelector('[data-automation-id="formField-location"] input:not([type="hidden"])');
      if (locationInput) {
        const cur = (locationInput.value || '').trim();
        if (!cur || cur.toLowerCase() !== location.toLowerCase()) {
          reactSet(locationInput, location);
          await sleep(300);
          const escKey = new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true });
          document.dispatchEvent(escKey);
          log(`  ✓ Emplacement: "${location}"`);
        } else {
          log(`  ✓ Emplacement: déjà "${cur}" → skip`);
        }
      }
    }

    // Date de début — format YYYY-MM ou YYYY-MM-DD → mois + année séparés
    if (startDate) {
      const parts = startDate.split('-');
      const yyyy = parts[0];       // ex: "2022"
      const mm   = parts[1] || ''; // ex: "08"

      // Année
      const yearInput = document.querySelector('[id*="workExperience"][id*="startDate"][id*="year"]') ||
        document.querySelector('[id*="workExperience"][id*="startYear"]');
      if (yearInput && yyyy) {
        const cur = (yearInput.value || '').trim();
        if (cur !== yyyy) { reactSet(yearInput, yyyy); await sleep(200); log(`  ✓ Début année: "${yyyy}"`); }
        else log(`  ✓ Début année: déjà "${yyyy}" → skip`);
      }

      // Mois (combobox select-button ou input)
      if (mm) {
        const monthBtn = document.querySelector('[id*="workExperience"][id*="startDate"][id*="month"]') ||
          document.querySelector('[id*="workExperience"][id*="startMonth"]');
        if (monthBtn && monthBtn.tagName === 'BUTTON') {
          // Mois en texte anglais pour le dropdown Workday
          const monthNames = ['','January','February','March','April','May','June',
                              'July','August','September','October','November','December'];
          const monthText = monthNames[parseInt(mm, 10)] || '';
          if (monthText) await fillSelectButton(monthBtn, monthText, `Mois début`);
        } else if (monthBtn) {
          reactSet(monthBtn, mm);
          await sleep(200);
          log(`  ✓ Début mois: "${mm}"`);
        }
      }
    }

    // Case "Emploi occupé actuellement" → cocher si c'est l'emploi actuel
    const currentJobCheckbox = document.querySelector('[id*="workExperience"][id*="currentlyWorking"]') ||
      document.querySelector('[data-automation-id="formField-currentJob"] input[type="checkbox"]') ||
      [...document.querySelectorAll('input[type="checkbox"]')].find(cb => {
        const id = cb.id || '';
        return id.includes('currentlyWorking') || id.includes('currentJob') || id.includes('isCurrent');
      });
    if (currentJobCheckbox && !currentJobCheckbox.checked) {
      await clickEl(currentJobCheckbox);
      await sleep(300);
      log('  ✓ Emploi actuel: coché');
    } else if (currentJobCheckbox?.checked) {
      log('  ✓ Emploi actuel: déjà coché → skip');
    }
  }

  async function fillMonExperience(p) {
    log('📝 Étape 2 — Mon expérience');
    setBanner('📝 Mon expérience en cours...');
    await sleep(1000);

    // ── Expérience professionnelle ──────────────────────────────────────────────
    await fillWorkExperience(p);
    await sleep(500);

    // ── Section Études : cliquer "Ajouter" si champs pas encore visibles ──────
    const hasSchoolField = !!document.querySelector('[data-automation-id="formField-school"]');
    if (!hasSchoolField && (p.establishment || p.education_school || p.ms_school || p.education_degree || p.ms_degree)) {
      // Trouver le bouton "Ajouter" de la section Études
      const sections = Array.from(document.querySelectorAll('h3, h4, [data-automation-id*="sectionTitle"]'));
      const etudesH = sections.find(h => /étude|education|formation/i.test(h.textContent || ''));
      if (etudesH) {
        // Chercher le bouton Ajouter le plus proche dans la section
        const allAddBtns = Array.from(document.querySelectorAll('button')).filter(b =>
          b.textContent.trim() === 'Ajouter'
        );
        // "Études" est généralement le 2ème bouton Ajouter (après Expérience pro)
        // Identifier via position dans le DOM par rapport au titre
        let etudesBtn = null;
        for (const btn of allAddBtns) {
          const rect = btn.getBoundingClientRect();
          const sectionRect = etudesH.getBoundingClientRect();
          if (rect.top >= sectionRect.top) { etudesBtn = btn; break; }
        }
        if (etudesBtn) {
          log('  📚 Études: ouverture du formulaire...');
          await clickEl(etudesBtn);
          await sleep(1500);
        }
      }
    }

    // ── École ─────────────────────────────────────────────────────────────────
    // Le champ school est un combobox de recherche
    const schoolContainer = document.querySelector('[data-automation-id="formField-school"]');
    if (schoolContainer && (p.establishment || p.education_school || p.ms_school)) {
      const alreadySet = !!schoolContainer.querySelector('[data-automation-id="selectedItem"]');
      if (!alreadySet) {
        await fillCombobox('formField-school', p.establishment || p.education_school || p.ms_school, 'École');
      } else {
        log('  ✓ École: déjà remplie → skip');
      }
    }

    // ── Diplôme : select-button (id=education-N--degree) ─────────────────────
    // Priorité : education_degree (format MS exact) → dérivé de education_level + institution_type
    const degreeContainer = document.querySelector('[data-automation-id="formField-degree"]');
    if (degreeContainer) {
      const degreeBtn = degreeContainer.querySelector('button[id]');
      if (degreeBtn) {
        // 1. Valeur directe (format MS exact)
        let degreeValue = p.education_degree || p.ms_degree || '';
        // 2. Dérivation depuis education_level + institution_type (champs Taleos existants)
        if (!degreeValue) {
          const lvl  = (p.education_level || '').toLowerCase();
          const type = (p.institution_type || '').toLowerCase();
          if (lvl.includes('bac + 5') || lvl.includes('m2') || lvl.includes('master')) {
            // École de commerce/ingénieurs → Professional Degree, université → Master's
            degreeValue = (type.includes('commerce') || type.includes('ingénieur') || type.includes('spécialis'))
              ? "Professional Degree"
              : "Master's Degree";
          } else if (lvl.includes('bac + 3') || lvl.includes('l3') || lvl.includes('bachelor')) {
            degreeValue = "Bachelor's Degree";
          } else if (lvl.includes('doctorat') || lvl.includes('phd')) {
            degreeValue = "Doctorat";
          } else if (lvl.includes('bac + 2') || lvl.includes('bts') || lvl.includes('dut')) {
            degreeValue = "Diploma";
          } else if (lvl.includes('bac') && !lvl.includes('+')) {
            degreeValue = "High School or High School Equivalent";
          } else if (lvl.includes('cours') || lvl.includes('progress')) {
            degreeValue = "Degree in Progress";
          }
        }
        if (degreeValue) {
          await fillSelectButton(degreeBtn, degreeValue, 'Diplôme');
        }
      }
    }

    // ── Champ d'études : combobox ──────────────────────────────────────────────
    const fosContainer = document.querySelector('[data-automation-id="formField-fieldOfStudy"]');
    if (fosContainer && (p.field_of_study || p.education_field_of_study || p.ms_field_of_study)) {
      const alreadySet = !!fosContainer.querySelector('[data-automation-id="selectedItem"]');
      if (!alreadySet) {
        await fillCombobox('formField-fieldOfStudy', p.field_of_study || p.education_field_of_study || p.ms_field_of_study, 'Champ d\'études');
      } else {
        log('  ✓ Champ d\'études: déjà rempli → skip');
      }
    }

    // ── Habiletés / Skills ─────────────────────────────────────────────────────
    if (p.skills || p.ms_skills) {
      const skillsInput = document.querySelector('[data-automation-id="formField-skills"] input:not([type="hidden"])');
      if (skillsInput) {
        const skills = String(p.skills || p.ms_skills).split(',').map(s => s.trim()).filter(Boolean);
        for (const skill of skills) {
          reactSet(skillsInput, skill);
          await sleep(400);
          // Sélectionner l'option dans le dropdown ou confirmer avec Enter
          const opt = Array.from(document.querySelectorAll('[role="option"]'))
            .find(o => o.offsetWidth > 0 && new RegExp(skill, 'i').test(o.textContent || ''));
          if (opt) {
            await clickEl(opt);
          } else {
            skillsInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
          }
          await sleep(300);
        }
        log(`  ✓ Habiletés: "${p.skills || p.ms_skills}"`);
      }
    }

    // ── CV upload ──────────────────────────────────────────────────────────────
    await uploadCV(p);

    // ── LinkedIn ───────────────────────────────────────────────────────────────
    if (p.linkedin_url) {
      await fillTextField('formField-linkedInAccount', p.linkedin_url, 'LinkedIn');
    }
  }

  async function uploadCV(p) {
    const fileInput = document.querySelector('input[type="file"]');
    if (!fileInput) { log('  ⚠️ CV: input[type="file"] introuvable'); return; }

    const filename    = p.cv_filename || 'cv.pdf';
    const storagePath = p.cv_storage_path;

    // Déjà uploadé ?
    const uploadedName = document.querySelector('[data-automation-id="file-upload-item-name"]')?.textContent || '';
    const uploadOk = !!document.querySelector('[data-automation-id="file-upload-successful"]');
    if (uploadOk && uploadedName.includes(filename.replace('.pdf', ''))) {
      log(`  ✓ CV: "${filename}" déjà uploadé → skip`); return;
    }

    // Supprimer l'existant si présent
    const deleteBtn = document.querySelector('[data-automation-id="delete-file"]') ||
      Array.from(document.querySelectorAll('button')).find(b =>
        /supprimer|delete/i.test(b.getAttribute('aria-label') || b.innerText || '') &&
        b.closest('[data-automation-id*="upload"],[data-automation-id*="file"]')
      );
    if (deleteBtn) {
      await clickEl(deleteBtn);
      await sleep(1000);
    }

    if (!storagePath) {
      log('  ⚠️ CV: cv_storage_path absent → upload manuel requis');
      setBanner('⏸️ ÉTAPE MANUELLE : Uploadez votre CV puis attendez la reprise', '#c47900');
      let w = 0;
      while (w < 180000 && !document.querySelector('[data-automation-id="file-upload-successful"]')) {
        await sleep(1000); w += 1000;
      }
      return;
    }

    log(`  ⏳ CV: téléchargement "${filename}" depuis Firebase Storage...`);
    const ok = await setFileFromStorage(fileInput, storagePath, filename);
    if (!ok) {
      setBanner('⏸️ Uploadez votre CV manuellement puis continuez', '#c47900');
      let w = 0;
      while (w < 180000 && !document.querySelector('[data-automation-id="file-upload-successful"]')) {
        await sleep(1000); w += 1000;
      }
      return;
    }

    let waited = 0;
    while (waited < 10000 && !document.querySelector('[data-automation-id="file-upload-successful"]')) {
      await sleep(500); waited += 500;
    }
    const confirmed = !!document.querySelector('[data-automation-id="file-upload-successful"]');
    log(confirmed ? `  ✅ CV: "${filename}" uploadé` : `  ⚠️ CV: pas de confirmation après ${waited}ms`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ÉTAPE 3 — Questions liées à la candidature
  // IDs = GUIDs dynamiques → scan par texte du label
  // Type = select-button (button[id], pas button[aria-haspopup])
  // Options = "Yes" / "No" (EN, même en fr-CA)
  // ═══════════════════════════════════════════════════════════════════════════
  async function fillApplicationQuestions(p, jobLocation) {
    log('📝 Étape 3 — Questions liées à la candidature');
    setBanner('📝 Questions candidature en cours...');
    await sleep(2000); // Laisser React charger les questions

    // Récupérer tous les formField-dc* (questions dynamiques)
    const questionFields = Array.from(document.querySelectorAll('[data-automation-id*="formField-dc"]'));
    log(`  🔍 ${questionFields.length} question(s) dynamique(s) trouvée(s)`);

    for (const field of questionFields) {
      // Trouver le bouton select dans ce champ (button[id], pas aria-haspopup)
      const btn = field.querySelector('button[id]');
      if (!btn) continue;

      // Trouver le texte de la question — dans l'élément parent du formField
      const parent = field.parentElement;
      const siblings = parent ? Array.from(parent.children) : [];
      const idx = siblings.indexOf(field);
      let questionText = '';
      for (let i = idx - 1; i >= 0; i--) {
        const t = siblings[i].textContent?.trim();
        if (t && t.length > 10) { questionText = t.replace(/\s+/g, ' '); break; }
      }
      // Fallback : label dans le wrapper
      if (!questionText) {
        questionText = field.querySelector('label,legend')?.textContent?.trim() || '';
      }

      const lower = questionText.toLowerCase();
      const cur   = (btn.textContent || '').trim();

      // Déjà rempli → skip
      if (cur && !/sélectionnez|select a value/i.test(cur)) {
        log(`  ✓ "${questionText.slice(0,60)}": déjà "${cur}" → skip`);
        continue;
      }

      let answer = null;

      // SMS / WhatsApp Talent Acquisition consent → Yes (profil ms_sms_consent)
      if (/consent.*sms|whatsapp|talent acquisition.*sms|follow.*communication.*sms/i.test(lower)) {
        answer = p.ms_sms_consent || 'Yes';
      }
      // Droit au travail → Yes
      else if (/légalement autorisé|legally authorized|right to work|autorisé.*travailler/i.test(lower)) {
        answer = 'Yes';
      }
      // Sponsorship visa actuel → No
      else if (/actuellement.*besoin.*sponsor|currently.*need.*sponsor/i.test(lower)) {
        answer = 'No';
      }
      // Sponsorship visa futur → No
      else if (/avenir.*parrainage|future.*sponsor|besoin.*futur/i.test(lower)) {
        answer = 'No';
      }
      // Employé gouvernement / régulateur / fonctionnaire / restricted
      else if (/employé.*gouvernement|government.*official|fonctionnaire|régulateur financier|financial regulator/i.test(lower)) {
        answer = 'No';
      }
      // Famille ou proche d'un fonctionnaire
      else if (/famille immédiate|proche associé|immediate family|close associate/i.test(lower)) {
        answer = 'No';
      }
      // Recommandé par un fonctionnaire
      else if (/recommandé|parrainé|sponsored.*official|referred.*government/i.test(lower)) {
        answer = 'No';
      }
      // Restrictions post-emploi gouvernement
      else if (/restrictions post.emploi|post.employment restriction/i.test(lower)) {
        answer = 'No';
      }
      // Défaut compliance/unknown → No
      else {
        answer = 'No';
        log(`  ℹ️ Question inconnue → "No" par défaut: "${questionText.slice(0,70)}"`);
      }

      const ok = await fillSelectButton(btn, answer, questionText.slice(0, 50));
      if (!ok) log(`  ⚠️ Question: "${questionText.slice(0,60)}" → ${answer} ECHEC`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ÉTAPE 4 — Divulgations volontaires
  // formField-gender → button id=personalInfoPerson--gender
  // Field-acceptTermsAndAgreements → checkbox id=termsAndConditions--acceptTermsAndAgreements
  // ═══════════════════════════════════════════════════════════════════════════
  async function fillDivulgationsVolontaires(p) {
    log('📝 Étape 4 — Divulgations volontaires');
    setBanner('📝 Divulgations volontaires en cours...');
    await sleep(1500);

    // ── Genre ─────────────────────────────────────────────────────────────────
    // Sélecteur exact : formField-gender → button id=personalInfoPerson--gender
    // Options fr-CA : "Femme", "Homme", "Préfère de pas s'identifier"
    const genderContainer = document.querySelector('[data-automation-id="formField-gender"]');
    if (genderContainer) {
      const genderBtn = genderContainer.querySelector('button[id]')
        || document.getElementById('personalInfoPerson--gender');
      if (genderBtn) {
        const genderMap = {
          'male':   'Homme',
          'female': 'Femme',
          'homme':  'Homme',
          'femme':  'Femme',
          'man':    'Homme',
          'woman':  'Femme',
        };
        const target = genderMap[(p.gender || '').toLowerCase()] || "Préfère de pas s'identifier";
        await fillSelectButton(genderBtn, target, 'Genre');
      }
    } else {
      log('  ⚠️ Genre: formField-gender introuvable');
    }

    // ── Checkbox CGU — OBLIGATOIRE ─────────────────────────────────────────────
    // Sélecteur exact : Field-acceptTermsAndAgreements → id=termsAndConditions--acceptTermsAndAgreements
    const cguContainer = document.querySelector('[data-automation-id="Field-acceptTermsAndAgreements"]');
    const cguInput = cguContainer?.querySelector('input[type="checkbox"]')
      || document.getElementById('termsAndConditions--acceptTermsAndAgreements');

    if (cguInput) {
      if (!cguInput.checked) {
        await clickEl(cguInput);
        await sleep(300);
        log('  ✓ CGU: cochée');
      } else {
        log('  ✓ CGU: déjà cochée → skip');
      }
    } else {
      // Fallback textuel
      const allCbs = Array.from(document.querySelectorAll('input[type="checkbox"]'));
      const cguFallback = allCbs.find(cb => {
        const lbl = document.querySelector(`label[for="${cb.id}"]`)?.textContent || '';
        return /j'ai lu|termes et conditions|terms and conditions|j'accepte/i.test(lbl);
      });
      if (cguFallback && !cguFallback.checked) {
        await clickEl(cguFallback);
        log('  ✓ CGU (fallback): cochée');
      } else if (!cguFallback) {
        log('  ❌ CGU: checkbox introuvable — vérifiez manuellement');
        setBanner('⚠️ Cochez manuellement les CGU avant de continuer', '#c47900');
        await sleep(5000);
      }
    }
  }

  // ─── Charger les données de la candidature en attente ────────────────────────
  async function loadProfile() {
    const local = await chrome.storage.local.get([PENDING_KEY, TAB_KEY]).catch(() => ({}));
    const pending = local[PENDING_KEY];
    if (!pending) { log('⚠️ Pas de candidature MS en attente'); return null; }
    return pending;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN
  // ═══════════════════════════════════════════════════════════════════════════
  async function main() {
    log('🚀 Morgan Stanley Workday Filler v3 démarré');

    const pending = await loadProfile();
    if (!pending) return;

    const p           = pending.profile || pending;
    const authEmail   = pending.email    || p.email;
    const authPassword = pending.password;
    const jobLocation = pending.location || pending.jobLocation || '';

    log(`  ℹ️ Pending: email="${authEmail || ''}", hasPassword=${!!authPassword}, keys=${Object.keys(pending).join(',')}`);

    setBanner('⏳ Taleos — Morgan Stanley en cours...');

    // Page intermédiaire "Postuler manuellement" (avant login)
    await handleStartPage();

    // Connexion (sur la page /applyManually avec formulaire "Créer un compte")
    const loggedIn = await handleSignIn(authEmail, authPassword);
    if (!loggedIn) return;

    // Attendre le formulaire (barre de progression ou formFields)
    let waitForm = 0;
    while (waitForm < 20000) {
      if (document.querySelector('[data-automation-id="progressBarActiveStep"]') ||
          document.querySelector('[data-automation-id*="formField"]')) break;
      await sleep(500); waitForm += 500;
    }
    await sleep(1000);

    // Boucle sur les étapes
    for (let iter = 0; iter < 12; iter++) {
      const step = currentStep();
      log(`\n▶ Étape courante: "${step}"`);

      if (step === 'my_information') {
        await fillMesRenseignements(p);
        await saveAndContinue();
        await waitForStep('my_experience');

      } else if (step === 'my_experience') {
        await fillMonExperience(p);
        await saveAndContinue();
        await waitForStep('application_questions');

      } else if (step === 'application_questions') {
        await fillApplicationQuestions(p, jobLocation);
        await saveAndContinue();
        await waitForStep('voluntary_disclosures');

      } else if (step === 'voluntary_disclosures') {
        await fillDivulgationsVolontaires(p);
        await saveAndContinue();
        await waitForStep('review');

      } else if (step === 'review') {
        setBanner('✅ Candidature prête — Vérifiez puis cliquez "Soumettre" manuellement', '#1b5e20');
        log('✅ Étape Réviser atteinte — soumission manuelle uniquement');
        return;

      } else if (step === 'login') {
        // Arrivé sur "Créer un compte/Ouvrir une session" après "Apply Manually"
        log('🔐 Étape login détectée après Apply Manually — connexion');
        const loginOk = await handleSignIn(authEmail, authPassword);
        if (!loginOk) return;
        await sleep(2000);

      } else {
        log(`⚠️ Étape inconnue "${step}" — attente et retry`);
        await sleep(2000);
        const progressed = await saveAndContinue();
        if (!progressed) { await sleep(3000); }
      }

      await sleep(1000);
    }

    setBanner('⚠️ Max itérations atteint — vérifiez manuellement', '#e65100');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    setTimeout(main, 1500);
  }
})();
