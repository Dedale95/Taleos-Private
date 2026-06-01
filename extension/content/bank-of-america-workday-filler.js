(function () {
  'use strict';

  if (!/ghr\.wd1\.myworkdayjobs\.com/i.test(location.hostname || '')) return;
  if (globalThis.__TALEOS_BOFA_FILLER_RUNNING__) return;
  globalThis.__TALEOS_BOFA_FILLER_RUNNING__ = true;

  // ─── Constants ─────────────────────────────────────────────────────────────
  const PENDING_KEY = 'taleos_pending_bank_of_america_workday';
  const TAB_KEY     = 'taleos_bank_of_america_workday_tab_id';
  const BANNER_ID   = 'taleos-bofa-banner';
  const LOG_PREFIX  = '[Taleos BofA]';
  const logged      = new Set();

  // ─── Utilities ─────────────────────────────────────────────────────────────

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function log(msg) {
    const txt = `${LOG_PREFIX} ${msg}`;
    if (logged.has(txt)) return;
    logged.add(txt);
    console.log(txt);
    const level = /❌/.test(txt) ? 'error' : /⚠️/.test(txt) ? 'warn' : 'info';
    try { chrome.runtime.sendMessage({ action: 'extension_run_log', source: 'bank-of-america-workday-filler', level, message: txt, ts: new Date().toISOString() }).catch(() => {}); } catch (_) {}
  }

  function setBanner(text, color) {
    let el = document.getElementById(BANNER_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = BANNER_ID;
      const api = globalThis.__TALEOS_AUTOMATION_BANNER__;
      if (api) api.applyStyle(el);
      else Object.assign(el.style, {
        position: 'fixed', top: '0', left: '0', width: '100%', zIndex: '2147483647',
        background: '#012169', color: '#fff', padding: '10px 16px',
        fontSize: '14px', fontWeight: '600', textAlign: 'center',
        boxShadow: '0 2px 6px rgba(0,0,0,0.3)', fontFamily: 'sans-serif'
      });
      document.documentElement.appendChild(el);
    }
    if (color) el.style.background = color;
    el.textContent = text;
  }

  // React-compatible value setter (bulk — pour champs texte simples)
  function reactSet(el, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Frappe caractère par caractère pour déclencher l'API debounce Workday
  // (même technique que Deloitte filler — requis pour les typeaheads)
  function simulateTyping(el, text) {
    return new Promise(resolve => {
      if (!el || !text) { resolve(); return; }
      const str = String(text).trim();
      const nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      el.focus(); el.click();
      try { el.select(); } catch (_) {}
      const tracker = el._valueTracker;
      if (tracker) tracker.setValue(el.value || '');
      if (nativeSet) nativeSet.call(el, ''); else el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      let i = 0;
      function next() {
        if (i >= str.length) { setTimeout(resolve, 100); return; }
        const ch = str[i++];
        const cur = el.value || '';
        el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true }));
        const trk = el._valueTracker;
        if (trk) trk.setValue(cur);
        if (nativeSet) nativeSet.call(el, cur + ch); else el.value = cur + ch;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
        setTimeout(next, 60);
      }
      setTimeout(next, 200);
    });
  }

  // Récupérer un fichier depuis Firebase Storage et l'assigner à un input[type=file]
  // (même technique que Deloitte/Nomura — fonctionne sur Workday)
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

  // Click with scroll
  async function clickEl(el) {
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(200);
    el.click();
  }

  // Fill a formField-* field's inner input
  async function fillField(automationId, value, label) {
    if (!value) return;
    const wrapper = document.querySelector(`[data-automation-id="${automationId}"]`);
    const inp = wrapper?.querySelector('input:not([type="hidden"]):not([type="file"])');
    if (!inp) { log(`  ⚠️ Champ ${automationId} introuvable`); return; }
    const current = inp.value?.trim();
    if (current === String(value).trim()) { log(`  ✓ ${label}: déjà "${current}"`); return; }
    inp.focus();
    reactSet(inp, String(value));
    inp.blur();
    log(`  ✓ Firebase: ${label}="${value}"`);
  }

  // Select an option from a Workday listbox
  // Clicks the trigger button → waits for [role="option"] → clicks matching option
  async function selectListbox(triggerBtn, optionText, timeout = 3000) {
    if (!triggerBtn) return false;
    triggerBtn.click();
    await sleep(600);
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const opt = Array.from(document.querySelectorAll('[role="option"]')).find(
        el => (el.innerText || el.textContent || '').trim().toLowerCase() === optionText.toLowerCase()
      );
      if (opt) { opt.click(); await sleep(300); return true; }
      await sleep(200);
    }
    // Fermer si pas trouvé
    triggerBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    return false;
  }

  // ─── Pending state ──────────────────────────────────────────────────────────

  async function getPending() {
    let currentTabId = null;
    try { const r = await chrome.runtime.sendMessage({ action: 'taleos_get_current_tab_id' }); currentTabId = r?.tabId || null; } catch (_) {}
    const local = await chrome.storage.local.get([PENDING_KEY, TAB_KEY]);
    const pending = local[PENDING_KEY];
    if (!pending) { log('⚠️ Pas de candidature BofA en attente'); return null; }
    const expectedTabId = pending?.tabId || local[TAB_KEY] || null;
    if (currentTabId && expectedTabId && currentTabId !== expectedTabId) { log(`⚠️ TabId mismatch`); return null; }
    return pending;
  }

  // ─── Step detection ─────────────────────────────────────────────────────────
  // DOM vérifié : [data-automation-id="progressBarActiveStep"] → 2ème <label> = nom étape

  function currentStep() {
    const labels = document.querySelector('[data-automation-id="progressBarActiveStep"]')?.querySelectorAll('label');
    const name = (labels?.[1]?.textContent || '').toLowerCase().trim();
    if (name.includes('my information')) return 'my_information';
    if (name.includes('my experience')) return 'my_experience';
    if (name.includes('application questions')) return 'application_questions';
    if (name.includes('voluntary')) return 'voluntary_disclosures';
    if (name.includes('review')) return 'review';
    return 'unknown';
  }

  // ─── Save and Continue ──────────────────────────────────────────────────────
  // DOM vérifié : button avec texte "Save and Continue"

  async function saveAndContinue() {
    await sleep(400);
    const btn = Array.from(document.querySelectorAll('button')).find(b =>
      b.offsetWidth > 0 && /save and continue/i.test((b.innerText || '').trim())
    );
    if (btn) { await clickEl(btn); await sleep(2000); return true; }
    log('⚠️ Bouton Save and Continue introuvable');
    return false;
  }

  // Wait until form advances to a new step (or timeout)
  async function waitForNextStep(expectedStep, timeout = 8000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (currentStep() === expectedStep) return true;
      await sleep(400);
    }
    return false;
  }

  // ─── Apply / Continue Application ──────────────────────────────────────────
  // DOM vérifié : [data-automation-id="continueButton"] ou [data-automation-id="applyNow"]

  async function clickApply() {
    const url = location.href.toLowerCase();
    if (url.includes('/apply/') || url.includes('/application/')) return true;
    const btn = document.querySelector('[data-automation-id="continueButton"]')
      || document.querySelector('[data-automation-id="applyNow"]')
      || Array.from(document.querySelectorAll('a[role="button"],button')).find(el =>
          el.offsetWidth > 0 && /^apply(\s+now)?$/i.test((el.innerText || '').trim())
        );
    if (btn) { log('🚀 Clic Apply/Continue...'); await clickEl(btn); await sleep(2000); return true; }
    return false;
  }

  // ─── STEP 1 : My Information ────────────────────────────────────────────────
  // Sélecteurs vérifiés sur DOM réel

  async function fillMyInformation(p) {
    log('📝 Step 1 — My Information');
    setBanner('📝 My Information en cours...');

    await fillField('formField-legalName--firstName', p.first_name, 'first_name');
    await fillField('formField-legalName--lastName',  p.last_name,  'last_name');
    await fillField('formField-addressLine1',         p.address,    'address');
    await fillField('formField-city',                 p.city,       'city');
    await fillField('formField-postalCode',           p.postal_code,'postal_code');
    await fillField('formField-phoneNumber',          p.phone,      'phone');

    // "How Did You Hear About Us?" → Bank of America Careers Site
    // formField-source est un listbox Workday — toujours forcer la bonne valeur
    const sourceBtn = document.querySelector('[data-automation-id="formField-source"] button[aria-haspopup]');
    if (sourceBtn) {
      const currentSource = (sourceBtn.innerText || '').trim();
      if (!/bank of america careers site/i.test(currentSource)) {
        const ok = await selectListbox(sourceBtn, 'Bank of America Careers Site');
        if (ok) log('  ✓ How Did You Hear: Bank of America Careers Site');
        else log('  ⚠️ "Bank of America Careers Site" introuvable dans la liste');
      } else {
        log('  ✓ How Did You Hear: déjà Bank of America Careers Site');
      }
    }

    // Country (dropdown) — pré-sélectionné par Workday, vérifier seulement
    const countryBtn = document.querySelector('[data-automation-id="formField-country"] button[aria-haspopup]');
    if (countryBtn && !/france/i.test(countryBtn.innerText)) {
      await selectListbox(countryBtn, p.country || 'France');
      log(`  ✓ Country: ${p.country || 'France'}`);
    } else { log('  ✓ Country: déjà France'); }

    // "Previously employed?" → No
    const radioNo = document.querySelector('[data-automation-id="formField-candidateIsPreviousWorker"] input[value="false"]');
    if (radioNo && !radioNo.checked) { radioNo.click(); log('  ✓ Previously employed: No'); }
    else if (radioNo?.checked) { log('  ✓ Previously employed: déjà No'); }

    log('✅ My Information complétée');
  }

  // ─── STEP 2 : My Experience ─────────────────────────────────────────────────

  async function fillMyExperience(p) {
    log('📝 Step 2 — My Experience');
    setBanner('📝 My Experience en cours...');

    // 2a. Education
    await fillEducation(p);

    // 2b. Languages
    await fillLanguages(p);

    // 2c. CV Upload
    await uploadCV(p);

    log('✅ My Experience complétée');
  }

  // ── 2a. Education ───────────────────────────────────────────────────────────
  // Sélecteurs vérifiés :
  //   [data-automation-id="formField-school"] input → typeahead school
  //   [data-automation-id="formField-degree"] button → listbox degree
  //   [data-automation-id="formField-firstYearAttended"] input → From year
  //   [data-automation-id="formField-lastYearAttended"] input → To year
  //
  // ⚠️ ISC Paris ne figure PAS dans la base Workday BofA (retourne "No Items")
  //    Le filler essaie l'ajout, et si l'école est introuvable, supprime l'entrée.

  async function fillEducation(p) {
    const school    = (p.establishment || p.institution_name || '').trim();
    const diplYear  = String(p.diploma_year || p.graduation_year || '').trim();
    const eduLevel  = (p.education_level || '').toLowerCase();

    if (!school && !diplYear) { log('  ℹ️ Aucune donnée Education → section ignorée'); return; }

    // Vérifier si Education a déjà des entrées remplies
    const existingSchool = document.querySelector('[data-automation-id="formField-school"] input');
    if (existingSchool?.value?.trim()) {
      log(`  ✓ Education déjà remplie ("${existingSchool.value.trim()}")`);
      if (diplYear) {
        await fillField('formField-lastYearAttended', diplYear, 'diploma_year');
      }
      return;
    }

    // Cliquer Add Education (2ème bouton "Add" parmi les visibles)
    const addBtns = Array.from(document.querySelectorAll('button')).filter(b =>
      /^add$/i.test((b.innerText || '').trim()) && b.offsetWidth > 0
    );
    const eduAddBtn = addBtns[1]; // 0=Work Exp, 1=Education
    if (!eduAddBtn) { log('  ⚠️ Bouton Add Education introuvable'); return; }
    await clickEl(eduAddBtn);
    await sleep(1000);

    // Typeahead School — frappe caractère par caractère (déclenche l'API Workday)
    const schoolInput = document.querySelector('[data-automation-id="formField-school"] input')
      || document.querySelector('input[id*="--school"]');
    if (!schoolInput) { log('  ⚠️ Champ School introuvable'); return; }

    log(`  ⌨️ Frappe école "${school}"...`);
    await simulateTyping(schoolInput, school);
    await sleep(1500); // délai API Workday

    // Vérifier les suggestions
    const noItems = Array.from(document.querySelectorAll('*')).find(el =>
      el.offsetWidth > 0 && /^no items/i.test((el.innerText || '').trim())
    );

    if (noItems) {
      log(`  ⚠️ École "${school}" introuvable dans la base Workday`);
      schoolInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
      await sleep(200);
      // Supprimer l'entrée Education vide pour éviter les erreurs de validation
      const deleteBtn = Array.from(document.querySelectorAll('button')).find(b =>
        /delete/i.test((b.innerText || '').trim()) && b.offsetWidth > 0
      );
      if (deleteBtn) { await clickEl(deleteBtn); await sleep(500); log('  🗑️ Entrée Education supprimée'); }
      setBanner('⚠️ École non trouvée dans Workday — remplissez Education manuellement', '#e65100');
      await sleep(2000);
      return;
    }

    // Sélectionner la première suggestion qui correspond
    const opt = Array.from(document.querySelectorAll('[role="option"], [data-automation-id="menuItem"], [data-automation-id="promptLeafNode"]')).find(el =>
      el.offsetWidth > 0 && (el.innerText || el.textContent || '').toLowerCase().includes(school.toLowerCase())
    );
    if (opt) {
      opt.click();
      await sleep(300);
      // Confirmer avec Enter (pattern Deloitte)
      schoolInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
      log(`  ✓ Firebase: establishment="${school}" → School`);
      await sleep(400);
    } else {
      log(`  ⚠️ Suggestion "${school}" non trouvée dans le dropdown`);
    }

    // Degree → mapping education_level → label Workday
    const degreeLabel = (() => {
      if (/bac\+5|m\.?sc|master|m2|grande.?école/i.test(eduLevel)) return "Master's Degree";
      if (/bac\+3|bachelor|licence|bsc|b\.?a\b/i.test(eduLevel)) return "Bachelor's Degree";
      if (/phd|doctorat|doctorate|bac\+8/i.test(eduLevel)) return 'Doctorate';
      if (/bac\+4|maîtrise/i.test(eduLevel)) return "Master's Degree";
      if (/bac\+2|bts|dut/i.test(eduLevel)) return "Associate's Degree";
      return null;
    })();
    const degreeBtn = document.querySelector('[data-automation-id="formField-degree"] button[aria-haspopup]');
    if (degreeBtn && degreeLabel) {
      const ok = await selectListbox(degreeBtn, degreeLabel);
      if (ok) log(`  ✓ Firebase: education_level="${eduLevel}" → Degree: ${degreeLabel}`);
    }

    // To year
    if (diplYear) await fillField('formField-lastYearAttended', diplYear, 'diploma_year');

    log('  ℹ️ Field of Study et From year non disponibles dans Firebase → à compléter manuellement');
  }

  // ── 2b. Languages ───────────────────────────────────────────────────────────
  // Sélecteurs vérifiés sur DOM réel :
  //   button[aria-label="Language Select One Required"] → listbox 112 langues
  //   input[name="native"] → fluent checkbox
  //   button[aria-label="Written and Spoken Select One Required"] → listbox Basic/Intermediate/Fluent
  //   [data-automation-id="add-button"] texte "Add Another" → nouvelle ligne langue

  async function fillLanguages(p) {
    const langs = Array.isArray(p.languages) ? p.languages.filter(l => l.language || l.name) : [];
    if (!langs.length) { log('  ℹ️ Aucune langue dans Firebase'); return; }

    log(`  🌐 Langues à renseigner: ${langs.map(l => l.language).join(', ')}`);

    for (let i = 0; i < langs.length; i++) {
      const lang = langs[i];
      const langName = lang.language || lang.name || '';
      const prof = (lang.proficiency || '').toLowerCase();
      const isFluent = ['native', 'bilingual', 'fluent'].includes(prof);
      const wsLevel = isFluent ? 'Fluent'
        : ['intermediate', 'conversational', 'professional'].includes(prof) ? 'Intermediate'
        : 'Basic';

      // Ajouter une nouvelle ligne si pas la première
      if (i > 0) {
        const addAnother = Array.from(document.querySelectorAll('button')).find(b =>
          b.offsetWidth > 0 && /add another/i.test((b.innerText || '').trim())
        );
        if (addAnother) { await clickEl(addAnother); await sleep(800); log(`  + Add Another`); }
        else { log('  ⚠️ Add Another introuvable'); break; }
      }

      // Bouton Language vide (le premier avec "Select One Required")
      const langBtn = document.querySelector('button[aria-label="Language Select One Required"]');
      if (!langBtn) { log(`  ⚠️ Bouton Language introuvable (langue ${i+1})`); continue; }

      const ok = await selectListbox(langBtn, langName);
      if (ok) log(`  ✓ Firebase: languages[${i}]="${langName}" → Language`);
      else { log(`  ⚠️ Langue "${langName}" introuvable dans la liste`); continue; }

      // Fluent checkbox — prendre le dernier (celui de la ligne qu'on vient d'ajouter)
      const nativeInputs = Array.from(document.querySelectorAll('input[name="native"]'));
      const nativeChk = nativeInputs[nativeInputs.length - 1];
      if (nativeChk) {
        const isChecked = nativeChk.checked || nativeChk.getAttribute('aria-checked') === 'true';
        if (isFluent && !isChecked) { nativeChk.click(); log(`  ✓ Fluent: checked`); }
        else if (isFluent) { log(`  ✓ Fluent: déjà coché`); }
        else { log(`  ✓ Fluent: non coché (${prof})`); }
        await sleep(200);
      }

      // Written and Spoken — prendre le dernier bouton vide
      const wsBtn = document.querySelector('button[aria-label="Written and Spoken Select One Required"]');
      if (wsBtn) {
        const wsOk = await selectListbox(wsBtn, wsLevel);
        if (wsOk) log(`  ✓ Firebase: proficiency="${prof}" → W&S: ${wsLevel}`);
      }

      await sleep(300);
    }
  }

  // ── 2c. CV Upload ───────────────────────────────────────────────────────────
  // Même pattern que Deloitte/Nomura : fetch_storage_file (background) → DataTransfer
  // Fonctionne sur Workday car le background a le token Firebase Storage.

  async function uploadCV(p) {
    const fileInput = document.querySelector('input[type="file"]');
    if (!fileInput) { log('  ℹ️ Pas d\'input file visible'); return; }

    // Vérifier si déjà uploadé (Workday peut l'avoir pré-rempli)
    if (fileInput.files?.length > 0) { log('  ✓ CV déjà uploadé'); return; }

    // Vérifier si un CV est déjà affiché dans la section (nom visible)
    const cvFilename = (p.cv_filename || '').toLowerCase();
    if (cvFilename) {
      const pageText = document.body.innerText.toLowerCase();
      if (pageText.includes(cvFilename.replace('.pdf', ''))) {
        log(`  ✓ CV "${p.cv_filename}" déjà présent`);
        return;
      }
    }

    const storagePath = p.cv_storage_path || '';
    const filename = p.cv_filename || (storagePath ? storagePath.split('/').pop() : 'cv.pdf');

    if (!storagePath) {
      log('  ⚠️ cv_storage_path manquant dans le profil Firebase');
      // Fallback : pause manuelle
      await waitForManualCV(fileInput);
      return;
    }

    log(`  ⏳ Téléchargement CV depuis Firebase Storage...`);
    const ok = await setFileFromStorage(fileInput, storagePath, filename);

    if (ok) {
      log(`  ✓ Firebase: cv_storage_path → CV "${filename}" uploadé`);
    } else {
      log('  ⚠️ Échec upload CV via storage — attente upload manuel');
      await waitForManualCV(fileInput);
    }
  }

  async function waitForManualCV(fileInput) {
    setBanner('⏸️ ÉTAPE MANUELLE : Uploadez votre CV, l\'automatisation reprend automatiquement', '#c47900');
    let waited = 0;
    while (waited < 180000) {
      if (fileInput.files?.length > 0) {
        log('  ✓ CV uploadé manuellement');
        setBanner('📝 My Experience en cours...');
        return;
      }
      await sleep(1000);
      waited += 1000;
    }
    log('  ⚠️ Timeout CV (3 min)');
  }

  // ─── STEP 3 : Application Questions ─────────────────────────────────────────
  // Structure job-spécifique. Stratégie conservative : répondre "No" aux booléens.

  async function fillApplicationQuestions(p) {
    log('📝 Step 3 — Application Questions');
    setBanner('📝 Application Questions...');

    // Récupérer toutes les questions visibles
    const formFields = document.querySelectorAll('[data-automation-id^="formField-"]');
    let answered = 0;

    for (const field of formFields) {
      // Radio Yes/No → sélectionner "No" (false)
      const radioNo = field.querySelector('input[type="radio"][value="false"]:not(:checked), input[type="radio"][value="No"]:not(:checked)');
      if (radioNo) {
        const q = field.querySelector('label')?.textContent?.trim()?.slice(0, 60) || 'question';
        radioNo.click();
        log(`  ✓ "${q}" → No`);
        answered++;
      }
    }

    if (!answered) log('  ℹ️ Aucune question auto-détectée (formulaire vide ou non standard)');
    log('✅ Application Questions');
  }

  // ─── STEP 4 : Voluntary Disclosures ──────────────────────────────────────────

  async function fillVoluntaryDisclosures(p) {
    log('📝 Step 4 — Voluntary Disclosures');
    setBanner('📝 Voluntary Disclosures (EEO)...');
    // Workday autorise de passer sans répondre (pas de champ requis en général)
    log('✅ Voluntary Disclosures (laissées vides — optionnel)');
  }

  // ─── STEP 5 : Review & Submit ─────────────────────────────────────────────

  async function reviewAndSubmit(pending) {
    log('📝 Step 5 — Review');
    setBanner('📋 Vérification finale avant soumission...');
    await sleep(2000);

    const submitBtn = Array.from(document.querySelectorAll('button')).find(b =>
      b.offsetWidth > 0 && /^submit$/i.test((b.innerText || '').trim())
    ) || document.querySelector('[data-automation-id*="submit"]');

    if (!submitBtn) {
      log('⚠️ Bouton Submit introuvable');
      setBanner('⚠️ Cliquez Submit pour finaliser', '#e65100');
      return false;
    }

    log('🚀 Soumission...');
    setBanner('🚀 Soumission en cours...');
    await clickEl(submitBtn);
    await sleep(3000);

    if (/thank you|application submitted|candidature/i.test(document.body.innerText)) {
      log('✅ Candidature soumise !');
      setBanner('✅ Candidature Bank of America soumise ! Fermeture dans 3s...', '#2e7d32');
      try {
        await chrome.runtime.sendMessage({
          action: 'candidature_success', bankId: 'bank_of_america_workday',
          jobTitle: pending.jobTitle || '', jobId: pending.jobId || '',
          offerUrl: pending.offerUrl || '', timestamp: new Date().toISOString()
        }).catch(() => {});
      } catch (_) {}
      await sleep(3000);
      if (pending.tabId) chrome.tabs.remove(pending.tabId).catch(() => {});
      await chrome.storage.local.remove([PENDING_KEY, TAB_KEY]).catch(() => {});
      return true;
    }

    log('⚠️ Confirmation non détectée');
    setBanner('⚠️ Vérifiez manuellement si la candidature a été soumise', '#e65100');
    return false;
  }

  // ─── Sign In ────────────────────────────────────────────────────────────────

  async function handleSignIn(authEmail, authPassword) {
    // Vérifier si déjà connecté (id="accountSettingsButton" présent + pas de formulaire login)
    if (document.getElementById('accountSettingsButton') && !document.querySelector('input[data-automation-id="email"]')) {
      log('  ✓ Déjà connecté');
      return true;
    }
    const loginEl = document.querySelector('input[data-automation-id="email"]');
    if (!loginEl) { log('  ✓ Pas de formulaire de connexion visible'); return true; }
    if (!authEmail || !authPassword) {
      log('❌ Identifiants BofA manquants — ajoutez-les dans Connexions');
      setBanner('❌ Identifiants Bank of America manquants — ajoutez-les dans Connexions', '#c62828');
      return false;
    }
    log('🔐 Connexion...');
    const ns = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    loginEl.focus();
    if (ns) ns.call(loginEl, authEmail); else loginEl.value = authEmail;
    loginEl.dispatchEvent(new Event('input', { bubbles: true }));
    loginEl.dispatchEvent(new Event('change', { bubbles: true }));
    loginEl.blur();
    log(`  ✓ Email: ${authEmail}`);
    await sleep(400);
    const passEl = document.querySelector('input[data-automation-id="password"]') || document.querySelector('input[type="password"]');
    if (passEl) {
      passEl.focus();
      if (ns) ns.call(passEl, authPassword); else passEl.value = authPassword;
      passEl.dispatchEvent(new Event('input', { bubbles: true }));
      passEl.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(300);
      ['keydown', 'keypress', 'keyup'].forEach(t => passEl.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true })));
    }
    let w = 0;
    while (w < 12000) { await sleep(500); w += 500; if (!document.querySelector('input[data-automation-id="email"]')) break; }
    log('  ✓ Connexion terminée');
    return true;
  }

  // ─── Main loop ──────────────────────────────────────────────────────────────

  async function run() {
    await sleep(1500);
    setBanner('🔄 Taleos — Bank of America en cours...');
    log('🚀 Démarrage filler BofA');

    const pending = await getPending();
    if (!pending) { globalThis.__TALEOS_BOFA_FILLER_RUNNING__ = false; return; }

    const p = pending.profile || {};
    log(`  Firebase: email="${p.auth_email || p.email}" | job="${pending.jobTitle}"`);

    // Connexion
    const ok = await handleSignIn(p.auth_email || p.email, p.auth_password);
    if (!ok) { globalThis.__TALEOS_BOFA_FILLER_RUNNING__ = false; return; }
    await sleep(1000);

    // Apply Now / Continue Application
    await clickApply();

    // Attendre que le formulaire charge (progressBar visible)
    let loadW = 0;
    while (loadW < 10000 && !document.querySelector('[data-automation-id="progressBarActiveStep"]')) {
      await sleep(500); loadW += 500;
    }

    // Boucle multi-steps
    const done = new Set();
    let submitted = false;
    let maxIter = 12;

    while (maxIter-- > 0 && !submitted) {
      const step = currentStep();
      log(`  → Step: ${step}`);

      if (step === 'my_information' && !done.has(step)) {
        await fillMyInformation(p); done.add(step);
        await saveAndContinue();
        await waitForNextStep('my_experience');
      } else if (step === 'my_experience' && !done.has(step)) {
        await fillMyExperience(p); done.add(step);
        await saveAndContinue();
        await waitForNextStep('application_questions');
      } else if (step === 'application_questions' && !done.has(step)) {
        await fillApplicationQuestions(p); done.add(step);
        await saveAndContinue();
        await waitForNextStep('voluntary_disclosures');
      } else if (step === 'voluntary_disclosures' && !done.has(step)) {
        await fillVoluntaryDisclosures(p); done.add(step);
        await saveAndContinue();
        await waitForNextStep('review');
      } else if (step === 'review') {
        submitted = await reviewAndSubmit(pending); break;
      } else if (step === 'unknown') {
        // Peut-être sur la page offre, tenter Apply
        const applied = await clickApply();
        if (!applied) {
          // Essayer de progresser
          const advanced = await saveAndContinue();
          if (!advanced) { log('❌ Impossible de progresser'); setBanner('⚠️ Vérification manuelle requise', '#e65100'); break; }
        }
        await sleep(1500);
      } else {
        // Étape déjà faite, avancer
        await saveAndContinue();
        await sleep(1000);
      }
    }

    if (!submitted) log('⚠️ Fin sans soumission confirmée');
    globalThis.__TALEOS_BOFA_FILLER_RUNNING__ = false;
  }

  // ─── Start ───────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => run().catch(e => {
      log(`❌ ${e.message}`); setBanner(`❌ ${e.message}`, '#c62828');
      globalThis.__TALEOS_BOFA_FILLER_RUNNING__ = false;
    }));
  } else {
    run().catch(e => {
      log(`❌ ${e.message}`); setBanner(`❌ ${e.message}`, '#c62828');
      globalThis.__TALEOS_BOFA_FILLER_RUNNING__ = false;
    });
  }
})();
