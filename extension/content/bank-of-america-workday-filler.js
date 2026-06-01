(function () {
  'use strict';

  if (!/ghr\.wd1\.myworkdayjobs\.com/i.test(location.hostname || '')) return;
  if (globalThis.__TALEOS_BOFA_FILLER_RUNNING__) return;
  globalThis.__TALEOS_BOFA_FILLER_RUNNING__ = true;

  const BANNER_ID = 'taleos-bofa-banner';
  const PENDING_KEY = 'taleos_pending_bank_of_america_workday';
  const TAB_KEY = 'taleos_bank_of_america_workday_tab_id';
  const LOG_PREFIX = '[Taleos BofA]';
  let logged = new Set();

  // ─── Utilitaires ───────────────────────────────────────────────────────────

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function log(msg) {
    const txt = `${LOG_PREFIX} ${msg}`;
    if (logged.has(txt)) return;
    logged.add(txt);
    console.log(txt);
    const level = /❌/.test(txt) ? 'error' : /⚠️/.test(txt) ? 'warn' : 'info';
    try {
      chrome.runtime.sendMessage({ action: 'extension_run_log', source: 'bank-of-america-workday-filler', level, message: txt, ts: new Date().toISOString() }).catch(() => {});
    } catch (_) {}
  }

  function setBanner(text, color) {
    let el = document.getElementById(BANNER_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = BANNER_ID;
      const api = globalThis.__TALEOS_AUTOMATION_BANNER__;
      if (api) { api.applyStyle(el); }
      else {
        Object.assign(el.style, {
          position: 'fixed', top: '0', left: '0', width: '100%', zIndex: '2147483647',
          background: '#1a73e8', color: '#fff', padding: '8px 16px',
          fontSize: '14px', fontWeight: '600', textAlign: 'center',
          boxShadow: '0 2px 6px rgba(0,0,0,0.3)', fontFamily: 'sans-serif'
        });
      }
      document.documentElement.appendChild(el);
    }
    if (color) el.style.background = color;
    el.textContent = text;
  }

  // Simuler frappe native React (compatible React fiber)
  function reactSet(el, value) {
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function visible(sel, root) {
    const ctx = root || document;
    try {
      return Array.from(ctx.querySelectorAll(sel)).find(el => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
      }) || null;
    } catch (_) { return null; }
  }

  async function waitFor(sel, root, timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const el = visible(sel, root);
      if (el) return el;
      await sleep(400);
    }
    return null;
  }

  async function waitForText(text, timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const el = Array.from(document.querySelectorAll('h1,h2,h3,h4,[role="heading"],span,p')).find(
        e => e.offsetWidth > 0 && e.textContent.toLowerCase().includes(text.toLowerCase())
      );
      if (el) return el;
      await sleep(400);
    }
    return null;
  }

  // Scroll + clic sécurisé
  async function clickEl(el) {
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(300);
    el.click();
  }

  // ─── Récupérer le pending state ────────────────────────────────────────────

  async function getPending() {
    let currentTabId = null;
    try {
      const res = await chrome.runtime.sendMessage({ action: 'taleos_get_current_tab_id' });
      currentTabId = res?.tabId || null;
    } catch (_) {}

    const local = await chrome.storage.local.get([PENDING_KEY, TAB_KEY]);
    const pending = local[PENDING_KEY];
    if (!pending) { log('⚠️ Pas de candidature BofA en attente'); return null; }

    const expectedTabId = pending?.tabId || local[TAB_KEY] || null;
    if (currentTabId && expectedTabId && currentTabId !== expectedTabId) {
      log(`⚠️ TabId mismatch (this=${currentTabId} expected=${expectedTabId})`);
      return null;
    }
    return pending;
  }

  // ─── Étape 0 : Sign In ─────────────────────────────────────────────────────

  async function handleSignIn(authEmail, authPassword) {
    const url = location.href.toLowerCase();

    // Si on est déjà sur le formulaire de candidature → pas besoin de sign in
    if (url.includes('/apply/') || url.includes('/application/')) return true;

    // Chercher le bouton Sign In
    const signInBtn = visible('a[href*="signin"]')
      || visible('button[data-automation-id*="signIn"]')
      || Array.from(document.querySelectorAll('a,button,span')).find(el =>
          el.offsetWidth > 0 && /^sign\s*in$/i.test(el.textContent.trim())
        );

    if (signInBtn) {
      log('🔐 Clic sur Sign In...');
      await clickEl(signInBtn);
      await sleep(1500);
    }

    // Attendre le champ email
    const emailEl = await waitFor('input[type="email"], input[data-automation-id*="email"], input[autocomplete*="email"]', null, 10000);
    if (!emailEl) {
      log('⚠️ Champ email introuvable — peut-être déjà connecté ?');
      return true; // on continue quand même
    }

    // Remplir email
    emailEl.focus();
    reactSet(emailEl, authEmail);
    log(`  ✓ Email: ${authEmail}`);
    await sleep(400);

    // Remplir mot de passe
    const pwEl = visible('input[type="password"]');
    if (pwEl) {
      pwEl.focus();
      reactSet(pwEl, authPassword);
      log('  ✓ Mot de passe renseigné');
      await sleep(400);
    }

    // Cliquer le bouton de soumission (Sign In / Connexion / Login)
    const submitBtn = visible('button[data-automation-id*="signIn"]')
      || visible('button[type="submit"]')
      || Array.from(document.querySelectorAll('button')).find(b =>
          b.offsetWidth > 0 && /sign\s*in|connexion|log\s*in/i.test(b.textContent.trim())
        );
    if (submitBtn) {
      await clickEl(submitBtn);
      log('  ✓ Submit sign-in');
    } else {
      // Fallback : touche Entrée sur le champ mot de passe
      (pwEl || emailEl).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      log('  ✓ Enter sur mot de passe (fallback)');
    }

    // Attendre que la page change (on quitte la page sign-in)
    let waited = 0;
    while (waited < 12000) {
      await sleep(500);
      waited += 500;
      if (!document.querySelector('input[type="password"]')) break;
    }
    log('  ✓ Sign In terminé');
    return true;
  }

  // ─── Étape 0b : Cliquer "Apply" sur la page de l'offre ─────────────────────

  async function clickApplyButton() {
    const url = location.href.toLowerCase();
    if (url.includes('/apply/') || url.includes('/application/')) return true; // déjà dans le formulaire

    const applyBtn = await waitFor('[data-automation-id*="applyNow"], [data-automation-id*="apply-now"], [data-automation-id*="applyButton"]', null, 5000)
      || Array.from(document.querySelectorAll('a,button')).find(el =>
          el.offsetWidth > 0 && /^apply(\s+now)?$/i.test(el.textContent.trim())
        );

    if (applyBtn) {
      log('🚀 Clic sur Apply Now...');
      await clickEl(applyBtn);
      await sleep(2000);
      return true;
    }
    return false;
  }

  // ─── Remplissage React-compatible d'un <input> ─────────────────────────────

  async function fillInput(sels, value) {
    if (!value) return false;
    const selsArr = Array.isArray(sels) ? sels : [sels];
    for (const sel of selsArr) {
      const el = visible(sel);
      if (el) {
        el.focus();
        await sleep(100);
        reactSet(el, String(value));
        el.blur();
        return true;
      }
    }
    return false;
  }

  // ─── Sélectionner dans un dropdown Workday (typeahead ou <select>) ─────────

  async function selectDropdown(triggerSels, optionText) {
    if (!optionText) return false;
    const triggerSelsArr = Array.isArray(triggerSels) ? triggerSels : [triggerSels];

    for (const sel of triggerSelsArr) {
      const trigger = visible(sel);
      if (!trigger) continue;
      await clickEl(trigger);
      await sleep(400);

      // Chercher l'option dans la liste ouverte
      const option = Array.from(document.querySelectorAll('[role="option"], [data-automation-id*="listItem"], li')).find(
        el => el.offsetWidth > 0 && el.textContent.trim().toLowerCase().includes(optionText.toLowerCase())
      );
      if (option) {
        await clickEl(option);
        log(`  ✓ Dropdown: ${optionText}`);
        return true;
      }
      // Fermer si pas trouvé
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
      await sleep(200);
    }
    return false;
  }

  // ─── Cliquer le bouton "Next" ou "Save and Continue" ──────────────────────

  async function clickNext() {
    await sleep(500);
    const nextBtn = visible('[data-automation-id*="bottom-navigation-next-button"]')
      || visible('button[data-automation-id*="next"]')
      || Array.from(document.querySelectorAll('button')).find(b =>
          b.offsetWidth > 0 && /next|suivant|continue|save and continue/i.test(b.textContent.trim())
        );
    if (nextBtn) {
      await clickEl(nextBtn);
      await sleep(1500);
      return true;
    }
    log('⚠️ Bouton Next introuvable');
    return false;
  }

  // ─── Détecter l'étape courante ─────────────────────────────────────────────

  function getCurrentStep() {
    // Chercher le step indicator actif
    const active = document.querySelector('[data-automation-id*="formContainer"] h2, [aria-current="step"]')
      || Array.from(document.querySelectorAll('[class*="progress"] span, [class*="step"] span')).find(el => el.offsetWidth > 0);
    const stepText = (active?.textContent || document.title || '').toLowerCase();

    if (stepText.includes('my information') || stepText.includes('my info')) return 'my_information';
    if (stepText.includes('my experience') || stepText.includes('my exp')) return 'my_experience';
    if (stepText.includes('application questions')) return 'application_questions';
    if (stepText.includes('voluntary') || stepText.includes('disclosures')) return 'voluntary_disclosures';
    if (stepText.includes('review')) return 'review';
    return 'unknown';
  }

  // ─── Étape 1 : My Information ─────────────────────────────────────────────

  async function fillMyInformation(p) {
    log('📝 Step 1 — My Information');
    setBanner('📝 Remplissage de vos informations personnelles...');

    await fillInput(['input[data-automation-id*="legalNameSection_firstName"]', 'input[data-automation-id*="firstName"]', 'input[placeholder*="First"]'], p.first_name);
    log(`  ✓ Firebase: first_name="${p.first_name}" → Given Name`);

    await fillInput(['input[data-automation-id*="legalNameSection_lastName"]', 'input[data-automation-id*="lastName"]', 'input[placeholder*="Last"]'], p.last_name);
    log(`  ✓ Firebase: last_name="${p.last_name}" → Family Name`);

    // Adresse
    await fillInput(['input[data-automation-id*="addressSection_addressLine1"]', 'input[data-automation-id*="street"], input[placeholder*="Address"]'], p.address);
    if (p.address) log(`  ✓ Firebase: address="${p.address}" → Street`);

    await fillInput(['input[data-automation-id*="addressSection_city"]', 'input[data-automation-id*="city"]'], p.city);
    if (p.city) log(`  ✓ Firebase: city="${p.city}" → City`);

    await fillInput(['input[data-automation-id*="addressSection_postalCode"]', 'input[data-automation-id*="postal"]'], p.postal_code);
    if (p.postal_code) log(`  ✓ Firebase: postal_code="${p.postal_code}" → Postal Code`);

    // Pays = France (dropdown)
    if (p.country) {
      const countryVal = p.country || 'France';
      await selectDropdown(
        ['[data-automation-id*="addressSection_countryRegion"]', '[data-automation-id*="country"]'],
        countryVal
      );
      log(`  ✓ Firebase: country="${countryVal}" → Country`);
    }

    // Téléphone
    await fillInput(['input[data-automation-id*="phone-device-type"]', 'input[data-automation-id*="phone"]', 'input[type="tel"]'], p.phone);
    if (p.phone) log(`  ✓ Firebase: phone="${p.phone}" → Phone`);

    // "How did you hear about us" → aucun mapping Firebase, on skip (champ optionnel)

    // Radio "Have you previously been employed by Bank of America?" → No
    const radioNo = visible('input[type="radio"][value*="false"], input[type="radio"][value*="No"]')
      || Array.from(document.querySelectorAll('label')).find(l =>
          l.offsetWidth > 0 && /^no$/i.test(l.textContent.trim())
        );
    if (radioNo) {
      await clickEl(radioNo);
      log('  ✓ Previously employed: No');
    }

    log('✅ My Information complétée');
  }

  // ─── Étape 2 : My Experience ───────────────────────────────────────────────

  async function fillMyExperience(p) {
    log('📝 Step 2 — My Experience');
    setBanner('📝 Remplissage de votre expérience...');

    // Section Languages — ajouter les langues du profil
    const addLangBtn = visible('[data-automation-id*="add-button-Section_Language"]')
      || Array.from(document.querySelectorAll('button')).find(b =>
          b.offsetWidth > 0 && /add/i.test(b.textContent) && b.closest('[data-automation-id*="language" i]')
        );

    const langs = (p.languages && Array.isArray(p.languages)) ? p.languages : [];
    if (langs.length > 0 && addLangBtn) {
      for (const lang of langs.slice(0, 3)) {
        const langName = lang.language || lang.name || '';
        if (!langName) continue;
        await clickEl(addLangBtn);
        await sleep(600);

        // Sélectionner la langue dans le dropdown
        await selectDropdown('[data-automation-id*="language-name"]', langName);
        log(`  ✓ Language: ${langName}`);

        // Fluent checkbox si natif / bilingue
        const proficiency = (lang.proficiency || '').toLowerCase();
        if (['native', 'bilingual', 'fluent'].includes(proficiency)) {
          const fluentCheck = visible('input[type="checkbox"][data-automation-id*="fluent"]')
            || Array.from(document.querySelectorAll('label')).find(l =>
                l.offsetWidth > 0 && /fluent/i.test(l.textContent)
              );
          if (fluentCheck) { await clickEl(fluentCheck); log(`  ✓ Fluent: checked`); }

          await selectDropdown('[data-automation-id*="writtenSpokenLevel"]', 'Fluent');
          log(`  ✓ Written/Spoken: Fluent`);
        } else if (['intermediate', 'conversational', 'professional'].includes(proficiency)) {
          await selectDropdown('[data-automation-id*="writtenSpokenLevel"]', 'Intermediate');
          log(`  ✓ Written/Spoken: Intermediate`);
        } else {
          await selectDropdown('[data-automation-id*="writtenSpokenLevel"]', 'Basic');
          log(`  ✓ Written/Spoken: Basic`);
        }
      }
    } else if (langs.length === 0) {
      log('  ℹ️ Aucune langue dans Firebase — section Languages ignorée');
    }

    // Section CV / Resume — signaler mais ne pas bloquer
    const cvInput = document.querySelector('input[type="file"]');
    if (cvInput) {
      log('  ℹ️ Firebase: cv_url présent — upload CV requis (à faire manuellement ou via Playwright)');
      log('  ⚠️ CV upload ignoré (JavaScript injection bloquée par Workday/React)');
    }

    log('✅ My Experience complétée (CV à uploader manuellement si requis)');
  }

  // ─── Étape 3 : Application Questions ──────────────────────────────────────

  async function fillApplicationQuestions(p) {
    log('📝 Step 3 — Application Questions');
    setBanner('📝 Questions de candidature...');

    // Ces questions sont spécifiques à chaque offre — on tente de répondre aux patterns courants
    const allQuestions = document.querySelectorAll('[data-automation-id*="formField"]');
    log(`  ℹ️ ${allQuestions.length} champs détectés`);

    // Réponses génériques pour champs booléens (Yes/No) — choisir No par défaut
    for (const field of allQuestions) {
      const radioNo = field.querySelector('input[type="radio"][value*="false"], input[type="radio"][value*="No"]');
      if (radioNo && !radioNo.checked) {
        const label = field.querySelector('label, [class*="label"]');
        if (label) log(`  ✓ Question auto: "${label.textContent.trim().slice(0,50)}" → No`);
        await clickEl(radioNo);
      }
    }

    log('✅ Application Questions (questions auto-répondues)');
  }

  // ─── Étape 4 : Voluntary Disclosures ──────────────────────────────────────

  async function fillVoluntaryDisclosures(p) {
    log('📝 Step 4 — Voluntary Disclosures');
    setBanner('📝 Déclarations volontaires (EEO)...');

    // Trouver et sélectionner "Prefer not to disclose" / "I do not wish to provide this information"
    const preferNotToSay = Array.from(document.querySelectorAll('[role="option"], label, li, [data-automation-id*="listItem"]')).find(
      el => el.offsetWidth > 0 && /prefer not (to|to self|to identify)|decline|not.*provide|do not wish/i.test(el.textContent)
    );
    if (preferNotToSay) {
      const allDropdowns = document.querySelectorAll('[data-automation-id*="formField"] [role="combobox"], [data-automation-id*="formField"] button[aria-haspopup]');
      for (const dd of allDropdowns) {
        await clickEl(dd);
        await sleep(300);
        const opt = Array.from(document.querySelectorAll('[role="option"]')).find(
          el => /prefer not (to|self)|decline|not.*provide|do not wish/i.test(el.textContent)
        );
        if (opt) { await clickEl(opt); }
      }
    }

    log('✅ Voluntary Disclosures (prefer not to disclose)');
  }

  // ─── Étape 5 : Review & Submit ─────────────────────────────────────────────

  async function reviewAndSubmit(pending) {
    log('📝 Step 5 — Review & Submit');
    setBanner('📋 Vérification finale avant soumission...');
    await sleep(2000);

    // Chercher le bouton Submit
    const submitBtn = visible('[data-automation-id*="bottom-navigation-next-button"]')
      || visible('[data-automation-id*="submit"]')
      || Array.from(document.querySelectorAll('button')).find(b =>
          b.offsetWidth > 0 && /submit/i.test(b.textContent.trim())
        );

    if (!submitBtn) {
      log('⚠️ Bouton Submit introuvable — candidature NON soumise');
      setBanner('⚠️ Vérification manuelle requise — cliquez Submit', '#e65100');
      return false;
    }

    log('🚀 Soumission de la candidature...');
    setBanner('🚀 Soumission en cours...');
    await clickEl(submitBtn);
    await sleep(3000);

    // Vérifier si la confirmation apparaît
    const confirmation = await waitForText('thank you', 6000) || await waitForText('application submitted', 6000) || await waitForText('candidature', 3000);
    if (confirmation) {
      log('✅ Candidature soumise avec succès !');
      setBanner('✅ Candidature Bank of America soumise ! Fermeture dans 3s...', '#2e7d32');

      // Notifier le background
      try {
        await chrome.runtime.sendMessage({
          action: 'candidature_success',
          bankId: 'bank_of_america_workday',
          jobTitle: pending.jobTitle || '',
          jobId: pending.jobId || '',
          offerUrl: pending.offerUrl || '',
          timestamp: new Date().toISOString()
        }).catch(() => {});
      } catch (_) {}

      await sleep(3000);
      const tabId = pending.tabId;
      if (tabId) chrome.tabs.remove(tabId).catch(() => {});
      await chrome.storage.local.remove([PENDING_KEY, TAB_KEY]).catch(() => {});
      return true;
    } else {
      log('⚠️ Confirmation de soumission non détectée');
      setBanner('⚠️ Soumission peut-être réussie — vérifiez manuellement', '#e65100');
    }
    return false;
  }

  // ─── Boucle principale ─────────────────────────────────────────────────────

  async function run() {
    await sleep(1500); // attendre le rendu initial
    setBanner('🔄 Taleos — Automatisation Bank of America en cours...');
    log('🚀 Démarrage filler Bank of America');

    const pending = await getPending();
    if (!pending) { globalThis.__TALEOS_BOFA_FILLER_RUNNING__ = false; return; }

    const p = pending.profile || {};
    const authEmail = p.auth_email || p.email || '';
    const authPassword = p.auth_password || '';

    log(`  Firebase: email="${authEmail}" | jobTitle="${pending.jobTitle || '(unknown)'}"`);

    // ── Step 0a : Sign In si nécessaire ─────────────────────────────────────
    const url = location.href.toLowerCase();
    const isAlreadySignedIn = !!visible('[data-automation-id*="profile"]') || !!visible('[aria-label*="profile"]') || !!visible('[data-automation-id*="my-account"]');
    const isOnSignInPage = url.includes('/login') || url.includes('/signin') || !!visible('input[type="password"]');
    const isOnApplyPage = url.includes('/apply/') || url.includes('/application/');

    if (!isAlreadySignedIn && (isOnSignInPage || !isOnApplyPage)) {
      if (!authEmail || !authPassword) {
        log('❌ Identifiants BofA manquants — configurez-les dans Connexions');
        setBanner('❌ Identifiants Bank of America manquants — ajoutez-les dans Connexions', '#c62828');
        globalThis.__TALEOS_BOFA_FILLER_RUNNING__ = false;
        return;
      }
      await handleSignIn(authEmail, authPassword);
      await sleep(2000);
    } else if (isAlreadySignedIn) {
      log('  ✓ Déjà connecté');
    }

    // ── Step 0b : Clic sur Apply Now (si sur la page de l'offre) ────────────
    await clickApplyButton();
    await sleep(1500);

    // ── Boucle multi-steps ──────────────────────────────────────────────────
    let maxSteps = 8; // guard anti-boucle infinie
    let stepsDone = new Set();
    let submitted = false;

    while (maxSteps-- > 0 && !submitted) {
      const step = getCurrentStep();
      log(`  → Étape détectée: ${step}`);

      if (step === 'my_information' && !stepsDone.has('my_information')) {
        await fillMyInformation(p);
        stepsDone.add('my_information');
        await clickNext();
      } else if (step === 'my_experience' && !stepsDone.has('my_experience')) {
        await fillMyExperience(p);
        stepsDone.add('my_experience');
        await clickNext();
      } else if (step === 'application_questions' && !stepsDone.has('application_questions')) {
        await fillApplicationQuestions(p);
        stepsDone.add('application_questions');
        await clickNext();
      } else if (step === 'voluntary_disclosures' && !stepsDone.has('voluntary_disclosures')) {
        await fillVoluntaryDisclosures(p);
        stepsDone.add('voluntary_disclosures');
        await clickNext();
      } else if (step === 'review') {
        submitted = await reviewAndSubmit(pending);
        break;
      } else if (step === 'unknown') {
        // Tenter de détecter si on est sur la page de l'offre (avant Apply)
        const applyBtnPresent = !!visible('[data-automation-id*="applyNow"]') || !!Array.from(document.querySelectorAll('button,a')).find(b => b.offsetWidth > 0 && /^apply(\s+now)?$/i.test(b.textContent.trim()));
        if (applyBtnPresent && !stepsDone.size) {
          await clickApplyButton();
          await sleep(2000);
        } else {
          // Essayer de cliquer Next pour avancer
          const nextWorked = await clickNext();
          if (!nextWorked) {
            log('⚠️ Impossible de détecter l\'étape — arrêt automatisation');
            setBanner('⚠️ Vérification manuelle requise', '#e65100');
            break;
          }
        }
      } else {
        // Étape déjà traitée → avancer
        await clickNext();
      }
      await sleep(1000);
    }

    if (!submitted) {
      log('⚠️ Automatisation terminée sans soumission confirmée');
    }

    globalThis.__TALEOS_BOFA_FILLER_RUNNING__ = false;
  }

  // ─── Démarrage ──────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => run().catch(e => {
      log(`❌ Erreur fatale: ${e.message}`);
      setBanner(`❌ Erreur: ${e.message}`, '#c62828');
      globalThis.__TALEOS_BOFA_FILLER_RUNNING__ = false;
    }));
  } else {
    run().catch(e => {
      log(`❌ Erreur fatale: ${e.message}`);
      setBanner(`❌ Erreur: ${e.message}`, '#c62828');
      globalThis.__TALEOS_BOFA_FILLER_RUNNING__ = false;
    });
  }
})();
