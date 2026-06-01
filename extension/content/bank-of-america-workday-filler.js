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
          background: '#012169', color: '#fff', padding: '10px 16px',
          fontSize: '14px', fontWeight: '600', textAlign: 'center',
          boxShadow: '0 2px 6px rgba(0,0,0,0.3)', fontFamily: 'sans-serif'
        });
      }
      document.documentElement.appendChild(el);
    }
    if (color) el.style.background = color;
    el.textContent = text;
  }

  // Remplissage React-compatible
  function reactSet(el, value) {
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) nativeSetter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Trouver le premier input visible dans un formField
  function fieldInput(automationId) {
    const wrapper = document.querySelector(`[data-automation-id="${automationId}"]`);
    if (!wrapper) return null;
    const inp = wrapper.querySelector('input:not([type="hidden"]), textarea');
    if (!inp) return null;
    const rect = inp.getBoundingClientRect();
    return rect.width > 0 ? inp : null;
  }

  async function waitForField(automationId, timeout = 10000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const el = fieldInput(automationId);
      if (el) return el;
      await sleep(300);
    }
    return null;
  }

  async function fillField(automationId, value, label) {
    if (!value) return;
    const inp = await waitForField(automationId, 5000);
    if (!inp) { log(`  ⚠️ Champ ${automationId} introuvable`); return; }
    const current = inp.value?.trim();
    if (current === String(value).trim()) {
      log(`  ✓ ${label}: déjà renseigné ("${current}")`);
      return;
    }
    inp.focus();
    reactSet(inp, String(value));
    inp.blur();
    log(`  ✓ Firebase: ${label}="${value}" → ${automationId}`);
  }

  async function clickEl(el) {
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(250);
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

  // ─── Connexion ─────────────────────────────────────────────────────────────

  async function handleSignIn(authEmail, authPassword) {
    // Vérifier si déjà connecté : accountSettingsButton présent + pas de formulaire login
    const accountBtn = document.getElementById('accountSettingsButton');
    const loginForm = document.querySelector('input[data-automation-id="email"]');
    if (accountBtn && !loginForm) {
      log('  ✓ Déjà connecté sur BofA Workday');
      return true;
    }

    if (!loginForm) {
      log('  ℹ️ Formulaire de connexion non détecté — on continue');
      return true;
    }

    if (!authEmail || !authPassword) {
      log('❌ Identifiants BofA manquants — configurez-les dans Connexions');
      setBanner('❌ Identifiants Bank of America manquants — ajoutez-les dans Connexions', '#c62828');
      return false;
    }

    log('🔐 Connexion BofA...');
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;

    loginForm.focus();
    if (nativeSetter) nativeSetter.call(loginForm, authEmail);
    loginForm.dispatchEvent(new Event('input', { bubbles: true }));
    loginForm.dispatchEvent(new Event('change', { bubbles: true }));
    loginForm.blur();
    log(`  ✓ Email: ${authEmail}`);
    await sleep(400);

    const passEl = document.querySelector('input[data-automation-id="password"]') || document.querySelector('input[type="password"]');
    if (passEl) {
      passEl.focus();
      if (nativeSetter) nativeSetter.call(passEl, authPassword);
      passEl.dispatchEvent(new Event('input', { bubbles: true }));
      passEl.dispatchEvent(new Event('change', { bubbles: true }));
      log('  ✓ Mot de passe renseigné');
      await sleep(300);
      // Entrée sur le mot de passe
      ['keydown', 'keypress', 'keyup'].forEach(type =>
        passEl.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13 }))
      );
    }

    // Attendre que le formulaire disparaisse (connexion réussie)
    let waited = 0;
    while (waited < 12000) {
      await sleep(500);
      waited += 500;
      if (!document.querySelector('input[data-automation-id="email"]')) break;
    }
    log('  ✓ Connexion terminée');
    return true;
  }

  // ─── Détecter l'étape courante via progressBar ─────────────────────────────
  // DOM vérifié : <li data-automation-id="progressBarActiveStep">
  //   <label>current step 1 of 5</label>
  //   <label>My Information</label>
  // </li>

  function getCurrentStep() {
    const activeStep = document.querySelector('[data-automation-id="progressBarActiveStep"]');
    if (activeStep) {
      const labels = activeStep.querySelectorAll('label');
      // Le 2ème label contient le nom de l'étape
      const stepName = (labels[1]?.textContent || labels[0]?.textContent || '').toLowerCase().trim();
      if (stepName.includes('my information')) return 'my_information';
      if (stepName.includes('my experience')) return 'my_experience';
      if (stepName.includes('application questions')) return 'application_questions';
      if (stepName.includes('voluntary')) return 'voluntary_disclosures';
      if (stepName.includes('review')) return 'review';
    }

    // Fallback : chercher un H3 visible
    const h3 = Array.from(document.querySelectorAll('h3')).find(el => el.offsetWidth > 0);
    const h3Text = (h3?.textContent || '').toLowerCase();
    if (h3Text.includes('my information')) return 'my_information';
    if (h3Text.includes('my experience')) return 'my_experience';
    if (h3Text.includes('application questions')) return 'application_questions';
    if (h3Text.includes('voluntary')) return 'voluntary_disclosures';
    if (h3Text.includes('review')) return 'review';

    return 'unknown';
  }

  // ─── Cliquer Apply Now ou Continue Application ─────────────────────────────
  // Sélecteurs DOM vérifiés :
  //   Apply Now    : [data-automation-id="applyNow"] ou bouton avec texte "Apply"
  //   Continue App : [data-automation-id="continueButton"]

  async function clickApplyOrContinue() {
    const url = location.href.toLowerCase();
    if (url.includes('/apply/') || url.includes('/application/')) return true;

    // Continue Application (candidature déjà initiée)
    const continueBtn = document.querySelector('[data-automation-id="continueButton"]');
    if (continueBtn && continueBtn.offsetWidth > 0) {
      log('🔄 Clic sur Continue Application...');
      await clickEl(continueBtn);
      await sleep(2000);
      return true;
    }

    // Apply Now
    const applyBtn = document.querySelector('[data-automation-id="applyNow"]')
      || Array.from(document.querySelectorAll('a[role="button"], button')).find(el =>
          el.offsetWidth > 0 && /^apply(\s+now)?$/i.test((el.innerText || '').trim())
        );
    if (applyBtn) {
      log('🚀 Clic sur Apply Now...');
      await clickEl(applyBtn);
      await sleep(2000);
      return true;
    }

    return false;
  }

  // ─── Bouton "Save and Continue" (= Next) ──────────────────────────────────
  // DOM vérifié : button avec texte "Save and Continue"

  async function clickSaveAndContinue() {
    await sleep(400);
    const btn = Array.from(document.querySelectorAll('button')).find(b =>
      b.offsetWidth > 0 && /save and continue/i.test((b.innerText || '').trim())
    ) || document.querySelector('[data-automation-id="bottom-navigation-next-button"]');

    if (btn) {
      log('  → Clic Save and Continue');
      await clickEl(btn);
      await sleep(2000);
      return true;
    }
    log('⚠️ Bouton Save and Continue introuvable');
    return false;
  }

  // ─── Étape 1 : My Information ──────────────────────────────────────────────
  // Sélecteurs DOM vérifiés sur ghr.wd1.myworkdayjobs.com :
  //   formField-legalName--firstName, formField-legalName--lastName
  //   formField-addressLine1, formField-city, formField-postalCode
  //   formField-phoneNumber, formField-candidateIsPreviousWorker (radio)

  async function fillMyInformation(p) {
    log('📝 Step 1 — My Information');
    setBanner('📝 Remplissage de vos informations personnelles...');

    await fillField('formField-legalName--firstName', p.first_name, 'first_name');
    await fillField('formField-legalName--lastName', p.last_name, 'last_name');
    await fillField('formField-addressLine1', p.address, 'address');
    await fillField('formField-city', p.city, 'city');
    await fillField('formField-postalCode', p.postal_code, 'postal_code');
    await fillField('formField-phoneNumber', p.phone, 'phone');

    // Radio "Previously employed?" → No (value="false")
    const radioNo = document.querySelector('[data-automation-id="formField-candidateIsPreviousWorker"] input[value="false"]');
    if (radioNo && !radioNo.checked) {
      radioNo.click();
      log('  ✓ Previously employed: No');
    } else if (radioNo?.checked) {
      log('  ✓ Previously employed: déjà No');
    }

    log('✅ My Information complétée');
  }

  // ─── Sélectionner une option dans un listbox Workday ──────────────────────
  // Pattern DOM vérifié : button[aria-haspopup="listbox"] → click → [role="option"] li

  async function selectListboxOption(btn, optionText) {
    if (!btn) return false;
    btn.click();
    await sleep(700);
    const option = Array.from(document.querySelectorAll('[role="option"]')).find(
      el => (el.innerText || el.textContent || '').trim().toLowerCase() === optionText.toLowerCase()
    );
    if (option) {
      option.click();
      await sleep(300);
      return true;
    }
    // Fermer si pas trouvé
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    await sleep(200);
    return false;
  }

  // ─── Étape 2 : My Experience ───────────────────────────────────────────────
  // Sélecteurs DOM vérifiés :
  //   Language btn   : button[aria-label="Language Select One Required"]
  //   Fluent checkbox: input[name="native"]
  //   W&S btn        : button[aria-label="Written and Spoken Select One Required"]
  //   Add Another    : [data-automation-id="add-button"] texte "Add Another"

  async function fillMyExperience(p) {
    log('📝 Step 2 — My Experience');
    setBanner('📝 Remplissage des langues...');

    const langs = Array.isArray(p.languages) ? p.languages.filter(l => l.language || l.name) : [];

    if (langs.length === 0) {
      log('  ℹ️ Aucune langue dans Firebase — section Languages ignorée');
    } else {
      for (let i = 0; i < langs.length; i++) {
        const lang = langs[i];
        const langName = lang.language || lang.name || '';
        const proficiency = (lang.proficiency || '').toLowerCase();
        const isFluent = ['native', 'bilingual', 'fluent'].includes(proficiency);
        const wsLevel = isFluent ? 'Fluent'
          : ['intermediate', 'conversational', 'professional'].includes(proficiency) ? 'Intermediate'
          : 'Basic';

        // Si pas la 1ère langue → cliquer "Add Another" pour créer une nouvelle ligne
        if (i > 0) {
          const addBtn = Array.from(document.querySelectorAll('[data-automation-id="add-button"]'))
            .find(b => b.offsetWidth > 0 && /add another/i.test((b.innerText || '').trim()));
          if (addBtn) {
            addBtn.click();
            await sleep(900);
            log(`  + Add Another (langue ${i + 1})`);
          } else {
            log(`  ⚠️ Bouton Add Another introuvable pour langue ${i + 1}`);
            break;
          }
        }

        // Bouton Language pour la ligne i (index dans tous les boutons language vides)
        const langBtns = Array.from(document.querySelectorAll('button[aria-label="Language Select One Required"]'));
        const langBtn = langBtns[i] || langBtns[langBtns.length - 1];
        const selected = await selectListboxOption(langBtn, langName);
        if (selected) {
          log(`  ✓ Firebase: languages[${i}].language="${langName}" → Language`);
        } else {
          log(`  ⚠️ Langue "${langName}" introuvable dans la liste Workday`);
          continue;
        }

        // Fluent checkbox (index i parmi tous les input[name="native"])
        const nativeInputs = Array.from(document.querySelectorAll('input[name="native"]'));
        const nativeCheckbox = nativeInputs[i] || nativeInputs[nativeInputs.length - 1];
        if (nativeCheckbox) {
          const shouldBeChecked = isFluent;
          const isChecked = nativeCheckbox.checked || nativeCheckbox.getAttribute('aria-checked') === 'true';
          if (shouldBeChecked && !isChecked) {
            nativeCheckbox.click();
            log(`  ✓ Firebase: proficiency="${proficiency}" → Fluent: checked`);
          } else if (shouldBeChecked) {
            log(`  ✓ Fluent: déjà coché`);
          } else {
            log(`  ✓ Firebase: proficiency="${proficiency}" → Fluent: non coché`);
          }
          await sleep(200);
        }

        // Written and Spoken (index i parmi tous les boutons W&S)
        const wsBtns = Array.from(document.querySelectorAll('button[aria-label="Written and Spoken Select One Required"]'));
        const wsBtn = wsBtns[i] || wsBtns[wsBtns.length - 1];
        const wsSelected = await selectListboxOption(wsBtn, wsLevel);
        if (wsSelected) {
          log(`  ✓ Firebase: proficiency="${proficiency}" → Written & Spoken: ${wsLevel}`);
        } else {
          log(`  ⚠️ Niveau "${wsLevel}" non trouvé`);
        }
      }
    }

    // CV upload — tenter via fetch + DataTransfer (peut être bloqué par Workday React)
    const cvUrl = p.cv_url || p.cv_download_url || '';
    const fileInput = document.querySelector('input[type="file"]');
    if (fileInput && cvUrl) {
      try {
        const resp = await fetch(cvUrl);
        const blob = await resp.blob();
        const filename = p.cv_filename || 'cv.pdf';
        const file = new File([blob], filename, { type: blob.type || 'application/pdf' });
        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        fileInput.dispatchEvent(new Event('input', { bubbles: true }));
        log(`  ✓ Firebase: cv_url → CV uploadé (${filename})`);
      } catch (e) {
        log(`  ⚠️ CV upload échoué (${e.message}) — upload manuel requis`);
        setBanner('⚠️ Uploadez votre CV manuellement puis attendez la suite', '#e65100');
        await sleep(3000); // Laisser du temps pour l'upload manuel
      }
    } else if (fileInput && !cvUrl) {
      log('  ⚠️ Pas de cv_url dans Firebase — CV à uploader manuellement');
      setBanner('⚠️ Uploadez votre CV manuellement puis attendez la suite', '#e65100');
      await sleep(3000);
    }

    log('✅ My Experience complétée');
  }

  // ─── Étape 3 : Application Questions ──────────────────────────────────────

  async function fillApplicationQuestions(p) {
    log('📝 Step 3 — Application Questions');
    setBanner('📝 Questions de candidature...');

    // Répondre "No" aux questions booléennes non encore répondues
    const radiosNo = document.querySelectorAll('input[type="radio"][value="false"]:not(:checked), input[type="radio"][value="No"]:not(:checked)');
    for (const radio of radiosNo) {
      const fieldWrapper = radio.closest('[data-automation-id^="formField-"]');
      if (fieldWrapper) {
        radio.click();
        const label = fieldWrapper.querySelector('label, [class*="label"]');
        if (label) log(`  ✓ Question: "${label.textContent.trim().slice(0,50)}" → No`);
      }
    }

    log('✅ Application Questions');
  }

  // ─── Étape 4 : Voluntary Disclosures ──────────────────────────────────────

  async function fillVoluntaryDisclosures(p) {
    log('📝 Step 4 — Voluntary Disclosures');
    setBanner('📝 Déclarations volontaires (EEO)...');
    // On ne répond pas aux questions de diversité — Workday accepte de passer sans répondre.
    log('✅ Voluntary Disclosures (non renseignées)');
  }

  // ─── Étape 5 : Review & Submit ─────────────────────────────────────────────

  async function reviewAndSubmit(pending) {
    log('📝 Step 5 — Review');
    setBanner('📋 Vérification finale avant soumission...');
    await sleep(2000);

    // Sur la page Review, le bouton final s'appelle "Submit"
    const submitBtn = Array.from(document.querySelectorAll('button')).find(b =>
      b.offsetWidth > 0 && /^submit$/i.test((b.innerText || '').trim())
    ) || document.querySelector('[data-automation-id*="submit"]');

    if (!submitBtn) {
      log('⚠️ Bouton Submit introuvable — vérification manuelle requise');
      setBanner('⚠️ Cliquez Submit pour finaliser la candidature', '#e65100');
      return false;
    }

    log('🚀 Soumission...');
    setBanner('🚀 Soumission en cours...');
    await clickEl(submitBtn);
    await sleep(3000);

    // Détecter la confirmation
    const bodyText = document.body.innerText.toLowerCase();
    if (/thank you|application submitted|candidature/i.test(bodyText)) {
      log('✅ Candidature soumise avec succès !');
      setBanner('✅ Candidature Bank of America soumise ! Fermeture dans 3s...', '#2e7d32');

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
      if (pending.tabId) chrome.tabs.remove(pending.tabId).catch(() => {});
      await chrome.storage.local.remove([PENDING_KEY, TAB_KEY]).catch(() => {});
      return true;
    }

    log('⚠️ Confirmation non détectée — vérifiez manuellement');
    setBanner('⚠️ Soumission peut-être réussie — vérifiez manuellement', '#e65100');
    return false;
  }

  // ─── Boucle principale ─────────────────────────────────────────────────────

  async function run() {
    await sleep(1500);
    setBanner('🔄 Taleos — Automatisation Bank of America en cours...');
    log('🚀 Démarrage filler Bank of America');

    const pending = await getPending();
    if (!pending) { globalThis.__TALEOS_BOFA_FILLER_RUNNING__ = false; return; }

    const p = pending.profile || {};
    const authEmail = p.auth_email || p.email || '';
    const authPassword = p.auth_password || '';

    log(`  Firebase: email="${authEmail}" | jobTitle="${pending.jobTitle || '(unknown)'}"`);

    // ── Connexion ────────────────────────────────────────────────────────────
    const signInOk = await handleSignIn(authEmail, authPassword);
    if (!signInOk) { globalThis.__TALEOS_BOFA_FILLER_RUNNING__ = false; return; }
    await sleep(1000);

    // ── Clic Apply Now / Continue Application ────────────────────────────────
    await clickApplyOrContinue();

    // Attendre que le formulaire soit chargé
    let loadWait = 0;
    while (loadWait < 8000 && !document.querySelector('[data-automation-id="progressBarActiveStep"]')) {
      await sleep(500);
      loadWait += 500;
    }

    // ── Boucle multi-steps ──────────────────────────────────────────────────
    let maxSteps = 10;
    const stepsDone = new Set();
    let submitted = false;

    while (maxSteps-- > 0 && !submitted) {
      const step = getCurrentStep();
      log(`  → Étape: ${step}`);

      if (step === 'my_information' && !stepsDone.has(step)) {
        await fillMyInformation(p);
        stepsDone.add(step);
        await clickSaveAndContinue();
      } else if (step === 'my_experience' && !stepsDone.has(step)) {
        await fillMyExperience(p);
        stepsDone.add(step);
        await clickSaveAndContinue();
      } else if (step === 'application_questions' && !stepsDone.has(step)) {
        await fillApplicationQuestions(p);
        stepsDone.add(step);
        await clickSaveAndContinue();
      } else if (step === 'voluntary_disclosures' && !stepsDone.has(step)) {
        await fillVoluntaryDisclosures(p);
        stepsDone.add(step);
        await clickSaveAndContinue();
      } else if (step === 'review') {
        submitted = await reviewAndSubmit(pending);
        break;
      } else if (step === 'unknown') {
        // Tenter de cliquer Apply/Continue si on est encore sur la page offre
        const clicked = await clickApplyOrContinue();
        if (!clicked) {
          // Essayer Save and Continue pour passer à l'étape suivante
          const advanced = await clickSaveAndContinue();
          if (!advanced) {
            log('❌ Impossible de progresser — arrêt');
            setBanner('⚠️ Vérification manuelle requise', '#e65100');
            break;
          }
        }
        await sleep(1500);
      } else {
        // Étape déjà traitée → avancer
        await clickSaveAndContinue();
      }
      await sleep(800);
    }

    if (!submitted) log('⚠️ Automatisation terminée sans soumission confirmée');
    globalThis.__TALEOS_BOFA_FILLER_RUNNING__ = false;
  }

  // ─── Démarrage ──────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => run().catch(e => {
      log(`❌ ${e.message}`);
      setBanner(`❌ Erreur: ${e.message}`, '#c62828');
      globalThis.__TALEOS_BOFA_FILLER_RUNNING__ = false;
    }));
  } else {
    run().catch(e => {
      log(`❌ ${e.message}`);
      setBanner(`❌ Erreur: ${e.message}`, '#c62828');
      globalThis.__TALEOS_BOFA_FILLER_RUNNING__ = false;
    });
  }
})();
