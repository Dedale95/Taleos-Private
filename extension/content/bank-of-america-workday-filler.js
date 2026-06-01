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
    if (!wrapper) { log(`  ⚠️ Wrapper ${automationId} introuvable`); return; }

    // Vérifier si la valeur est déjà affichée (chip/pill Workday pour champs pré-remplis)
    const wrapperText = (wrapper.innerText || '').toLowerCase();
    if (wrapperText.includes(String(value).toLowerCase())) {
      log(`  ✓ ${label}: déjà renseigné`); return;
    }

    const inp = wrapper.querySelector('input:not([type="hidden"]):not([type="file"])');
    if (!inp) { log(`  ℹ️ ${label}: champ non éditable (déjà rempli par Workday)`); return; }
    const current = inp.value?.trim();
    if (current === String(value).trim()) { log(`  ✓ ${label}: déjà "${current}"`); return; }
    inp.focus();
    reactSet(inp, String(value));
    inp.blur();
    log(`  ✓ Firebase: ${label}="${value}"`);
  }

  // Select an option from a Workday listbox
  // Workday utilise [role="option"] OU [data-automation-id="promptOption"] selon le contexte
  async function selectListbox(triggerBtn, optionText, timeout = 3000) {
    if (!triggerBtn) return false;
    triggerBtn.click();
    await sleep(600);
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const opt = Array.from(document.querySelectorAll(
        '[role="option"], [data-automation-id="promptOption"], [data-automation-id="menuItem"]'
      )).find(el => (el.innerText || el.textContent || '').trim().toLowerCase() === optionText.toLowerCase());
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

    // Confirmer la saisie : suggestion cliquée OU texte libre avec double Enter + blur
    // (double Enter = pattern JP Morgan pour confirmer les typeaheads Workday)
    const opt = !noItems && Array.from(document.querySelectorAll(
      '[role="option"], [data-automation-id="promptOption"], [data-automation-id="menuItem"], [data-automation-id="promptLeafNode"]'
    )).find(el => el.offsetWidth > 0 && (el.innerText || el.textContent || '').toLowerCase().includes(school.toLowerCase()));

    if (opt) {
      opt.click();
      await sleep(300);
      ['keydown', 'keyup'].forEach(t => schoolInput.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', keyCode: 13, bubbles: true })));
      log(`  ✓ Firebase: establishment="${school}" → School (suggestion)`);
      await sleep(400);
    } else {
      // Texte libre : double Enter + blur (JP Morgan pattern)
      if (noItems) log(`  ℹ️ "${school}" non trouvé dans Workday → texte libre`);
      else log(`  ℹ️ Aucune suggestion visible → texte libre`);
      ['keydown', 'keyup'].forEach(t => schoolInput.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', keyCode: 13, bubbles: true })));
      await sleep(200);
      ['keydown', 'keyup'].forEach(t => schoolInput.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', keyCode: 13, bubbles: true })));
      await sleep(200);
      schoolInput.dispatchEvent(new Event('change', { bubbles: true }));
      schoolInput.blur();
      await sleep(500);
      log(`  ✓ Firebase: establishment="${school}" → School (texte libre confirmé)`);
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

  // Trouver le bloc de section Languages dans le DOM
  // Retourne l'élément racine le plus proche qui contient "Languages" comme heading
  function findLanguageSectionRoot() {
    const heading = Array.from(document.querySelectorAll('h3, h4, [data-automation-id*="languageSection"], legend, [role="heading"]'))
      .find(el => /^languages?$/i.test((el.textContent || '').trim()) && el.offsetWidth > 0);
    if (!heading) return null;
    // Remonter jusqu'à trouver un conteneur significatif
    let el = heading.parentElement;
    for (let i = 0; i < 8 && el; i++) {
      if (el.querySelectorAll('button').length >= 1) return el;
      el = el.parentElement;
    }
    return heading.parentElement;
  }

  // Bouton "Add" initial de la section Languages (quand 0 lignes existent)
  function findLanguageAddBtn() {
    const root = findLanguageSectionRoot();
    if (root) {
      const btn = Array.from(root.querySelectorAll('button')).find(b =>
        b.offsetWidth > 0 && /^add$/i.test((b.innerText || '').trim())
      );
      if (btn) return btn;
    }
    // Fallback : dernier bouton "Add" de la page (Languages est la dernière section)
    const allAdds = Array.from(document.querySelectorAll('button')).filter(b =>
      b.offsetWidth > 0 && /^add$/i.test((b.innerText || '').trim())
    );
    return allAdds[allAdds.length - 1] || null;
  }

  // Trouver le bouton "Add Another" de la section Languages spécifiquement.
  function findLanguageAddAnotherBtn() {
    // 1. Chercher via proximity : le bouton "Add Another" le plus proche du dernier input[name="native"]
    const nativeInputs = Array.from(document.querySelectorAll('input[name="native"]'));
    if (nativeInputs.length > 0) {
      const lastNative = nativeInputs[nativeInputs.length - 1];
      let el = lastNative.parentElement;
      for (let depth = 0; depth < 10 && el; depth++) {
        const btn = Array.from(el.querySelectorAll('button')).find(b =>
          b.offsetWidth > 0 && /add another/i.test((b.innerText || '').trim())
        );
        if (btn) return btn;
        el = el.parentElement;
      }
    }
    // 2. Section Languages → chercher "Add Another"
    const root = findLanguageSectionRoot();
    if (root) {
      const btn = Array.from(root.querySelectorAll('button')).find(b =>
        b.offsetWidth > 0 && /add another/i.test((b.innerText || '').trim())
      );
      if (btn) return btn;
    }
    // 3. Dernier recours : dernier "Add Another" de la page
    const allAddAnother = Array.from(document.querySelectorAll('button')).filter(b =>
      b.offsetWidth > 0 && /add another/i.test((b.innerText || '').trim())
    );
    return allAddAnother[allAddAnother.length - 1] || null;
  }

  // ── 2b. Languages ───────────────────────────────────────────────────────────
  // Profile Firebase : lang.name (ex: "Français") + lang.level (ex: "native")
  // Workday attend des noms EN ANGLAIS → mapping FR/autres → EN

  const LANG_NAME_MAP = {
    'français': 'French', 'french': 'French', 'francais': 'French',
    'anglais': 'English', 'english': 'English',
    'espagnol': 'Spanish', 'spanish': 'Spanish',
    'allemand': 'German', 'german': 'German',
    'italien': 'Italian', 'italian': 'Italian',
    'portugais': 'Portuguese', 'portuguese': 'Portuguese',
    'arabe': 'Arabic', 'arabic': 'Arabic',
    'chinois': 'Chinese (Mandarin)', 'mandarin': 'Chinese (Mandarin)',
    'japonais': 'Japanese', 'japanese': 'Japanese',
    'russe': 'Russian', 'russian': 'Russian',
    'néerlandais': 'Dutch', 'dutch': 'Dutch',
    'polonais': 'Polish', 'polish': 'Polish',
  };

  function normalizeLanguageName(raw) {
    const lower = (raw || '').toLowerCase().trim();
    return LANG_NAME_MAP[lower] || raw; // si pas dans la map, utiliser tel quel
  }

  function getWSLevel(level) {
    const l = (level || '').toLowerCase();
    if (['native', 'bilingual', 'fluent', 'courant', 'maternelle', 'bilingue'].some(k => l.includes(k))) return 'Fluent';
    if (['intermediate', 'intermédiaire', 'conversational', 'professional', 'working'].some(k => l.includes(k))) return 'Intermediate';
    return 'Basic';
  }

  async function fillLanguages(p) {
    const langs = Array.isArray(p.languages) ? p.languages.filter(l => l.name || l.language) : [];
    if (!langs.length) { log('  ℹ️ Aucune langue dans Firebase'); return; }

    const displayNames = langs.map(l => normalizeLanguageName(l.name || l.language)).join(', ');
    log(`  🌐 Langues à renseigner: ${displayNames}`);

    // Compter les lignes de langue déjà présentes (avec bouton Select One OU déjà remplies)
    const existingRows = document.querySelectorAll('input[name="native"]');
    const nbExisting = existingRows.length; // nb de lignes langue déjà dans le DOM
    log(`  ℹ️ Lignes langue existantes dans Workday: ${nbExisting}`);

    for (let i = 0; i < langs.length; i++) {
      const lang = langs[i];
      const langName = normalizeLanguageName(lang.name || lang.language || '');
      const level = lang.level || lang.proficiency || '';
      const isFluent = getWSLevel(level) === 'Fluent';
      const wsLevel = getWSLevel(level);

      if (!langName) { log(`  ⚠️ Langue ${i+1} : nom vide dans Firebase`); continue; }

      const currentRows = document.querySelectorAll('input[name="native"]').length;

      if (i < currentRows) {
        // Ligne déjà présente — vérifier si elle a déjà une langue sélectionnée
        const langBtns = Array.from(document.querySelectorAll('button[aria-label="Language Select One Required"]'));
        if (langBtns.length === 0) {
          log(`  ✓ Langue ${i+1} : déjà sélectionnée par Workday`);
          continue;
        }
        // Sinon, prendre le 1er bouton vide disponible (traité plus bas)
      } else if (i === 0 && currentRows === 0) {
        // Première langue et aucune ligne n'existe encore → clic sur "Add" de la section
        const addBtn = findLanguageAddBtn();
        if (addBtn) { await clickEl(addBtn); await sleep(900); log(`  + Add Languages (langue 1)`); }
        else { log('  ⚠️ Bouton Add Languages introuvable'); break; }
      } else {
        // Langues supplémentaires → "Add Another"
        const langAddAnother = findLanguageAddAnotherBtn();
        if (langAddAnother) { await clickEl(langAddAnother); await sleep(900); log(`  + Add Another (langue ${i+1})`); }
        else { log('  ⚠️ Add Another Languages introuvable'); break; }
      }

      // Bouton Language vide disponible
      const langBtn = document.querySelector('button[aria-label="Language Select One Required"]');
      if (!langBtn) {
        log(`  ✓ Langue ${i+1} "${langName}" : déjà remplie par Workday`);
        continue;
      }

      const ok = await selectListbox(langBtn, langName);
      if (ok) log(`  ✓ Firebase: lang.name="${lang.name}" → "${langName}" sélectionné`);
      else { log(`  ⚠️ Langue "${langName}" introuvable dans la liste Workday`); continue; }

      // Fluent checkbox (dernier input[name="native"] dans le DOM = celui de la ligne courante)
      const nativeInputs = Array.from(document.querySelectorAll('input[name="native"]'));
      const nativeChk = nativeInputs[nativeInputs.length - 1];
      if (nativeChk) {
        const isChecked = nativeChk.checked || nativeChk.getAttribute('aria-checked') === 'true';
        if (isFluent && !isChecked) { nativeChk.click(); log(`  ✓ level="${level}" → Fluent: checked`); }
        else if (isFluent) { log(`  ✓ Fluent: déjà coché`); }
        else { log(`  ✓ level="${level}" → Fluent: non coché`); }
        await sleep(200);
      }

      // Written and Spoken (dernier bouton vide)
      const wsBtn = document.querySelector('button[aria-label="Written and Spoken Select One Required"]');
      if (wsBtn) {
        const wsOk = await selectListbox(wsBtn, wsLevel);
        if (wsOk) log(`  ✓ level="${level}" → W&S: ${wsLevel}`);
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
  // Questions Yes/No (dropdown Workday) + champs texte (employeur, salaire, dates…)
  // Stratégie : "Yes" pour right-to-work, "No" pour tout le reste.

  // Formater une date ISO (YYYY-MM-DD) en MM/DD/YYYY pour Workday
  function fmtDate(iso) {
    if (!iso) return '';
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[2]}/${m[3]}/${m[1]}` : String(iso);
  }

  // Vérifie si un bouton dropdown a déjà une valeur sélectionnée (pas "Select One")
  function dropdownIsFilled(btn) {
    const txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
    return txt !== '' && txt !== 'select one' && txt !== 'select';
  }

  // Ouvre le listbox, inspecte les options disponibles, retourne la liste
  async function getDropdownOptions(btn, timeout = 2000) {
    btn.click();
    await sleep(500);
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const opts = Array.from(document.querySelectorAll(
        '[role="option"], [data-automation-id="promptOption"], [data-automation-id="menuItem"]'
      )).filter(el => el.offsetWidth > 0);
      if (opts.length > 0) return opts.map(o => (o.innerText || o.textContent || '').trim());
      await sleep(200);
    }
    return [];
  }

  // Sélectionne la meilleure option d'un dropdown selon une liste de préférences
  async function selectBestOption(btn, preferences) {
    const opts = await getDropdownOptions(btn);
    if (!opts.length) { btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true })); return null; }
    // Fermer le dropdown ouvert
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    await sleep(200);
    for (const pref of preferences) {
      const match = opts.find(o => o.toLowerCase() === pref.toLowerCase())
        || opts.find(o => o.toLowerCase().includes(pref.toLowerCase()));
      if (match) {
        const ok = await selectListbox(btn, match);
        if (ok) return match;
      }
    }
    return null;
  }

  async function fillApplicationQuestions(p) {
    log('📝 Step 3 — Application Questions');
    setBanner('📝 Application Questions...');
    await sleep(800);

    let answered = 0;
    const formFields = Array.from(document.querySelectorAll('[data-automation-id^="formField-"]'))
      .filter(f => f.offsetParent !== null); // visibles uniquement

    for (const field of formFields) {
      // Récupérer le texte de la question (label visible)
      const labelEl = field.querySelector('label');
      const labelText = (labelEl?.textContent || '').replace(/\*/g, '').trim();
      const lowerLabel = labelText.toLowerCase();

      // ── 1. Radio Yes/No (fallback pour certains formulaires)
      const radioNo  = field.querySelector('input[type="radio"][value="false"]:not(:checked), input[type="radio"][value="No"]:not(:checked)');
      const radioYes = field.querySelector('input[type="radio"][value="true"]:not(:checked),  input[type="radio"][value="Yes"]:not(:checked)');
      if (radioNo || radioYes) {
        const wantsYes = /right.to.work|authorized|eligible/i.test(lowerLabel);
        const target = wantsYes ? radioYes : radioNo;
        if (target && !target.checked) { target.click(); log(`  ✓ "${labelText.slice(0,60)}" → ${wantsYes ? 'Yes' : 'No'}`); answered++; }
        continue;
      }

      // ── 2. Dropdown Workday (listbox)
      const dropBtn = field.querySelector('button[aria-haspopup="listbox"], button[aria-haspopup="true"]');
      if (dropBtn && !dropdownIsFilled(dropBtn)) {
        let chosen = null;

        if (/right.to.work|authorized.to.work|eligible.to.work/i.test(lowerLabel)) {
          chosen = await selectBestOption(dropBtn, ['Yes']);
        } else if (/notice.period/i.test(lowerLabel)) {
          // Essayer de lire le profil, sinon défaut 4 semaines
          const noticeWeeks = p.notice_period_weeks || p.notice_period || '';
          const weekPrefs = noticeWeeks ? [`${noticeWeeks}`, `${noticeWeeks} week`, `${noticeWeeks} weeks`] : [];
          chosen = await selectBestOption(dropBtn, [...weekPrefs, '4 Weeks', '4 weeks', '1 Month', '1 month', '2 Weeks', '2 weeks', '1 Week', '1 week']);
        } else if (/relatives|close personal relationship/i.test(lowerLabel)
            || /referred.*bank of america/i.test(lowerLabel)
            || /pricewaterhouse|pwc/i.test(lowerLabel)
            || /finra.*license/i.test(lowerLabel)
            || /vendor.worker/i.test(lowerLabel)
            || /previously applied/i.test(lowerLabel)
            || /armed forces/i.test(lowerLabel)
            || /other business.*proprietor|engaged.*other business/i.test(lowerLabel)
            || /medical condition|special.*educational|disability/i.test(lowerLabel)
            || /additional information.*disclose/i.test(lowerLabel)) {
          chosen = await selectBestOption(dropBtn, ['No']);
        }

        if (chosen) { log(`  ✓ "${labelText.slice(0,60)}" → ${chosen}`); answered++; }
        else if (chosen === null && !/right.to.work/i.test(lowerLabel)) {
          // Question non reconnue → tenter "No" par défaut
          const opts = await getDropdownOptions(dropBtn);
          dropBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
          await sleep(200);
          const hasNo = opts.some(o => /^no$/i.test(o.trim()));
          if (hasNo) {
            const ok = await selectListbox(dropBtn, opts.find(o => /^no$/i.test(o.trim())));
            if (ok) { log(`  ✓ "${labelText.slice(0,60)}" → No (défaut)`); answered++; }
          } else if (opts.length) {
            log(`  ⚠️ "${labelText.slice(0,60)}" — options: ${opts.slice(0,4).join(' | ')}`);
          }
        }
        continue;
      }

      // ── 3. Champs texte / date
      const inp = field.querySelector('input[type="text"], input[type="date"], input:not([type="radio"]):not([type="checkbox"]):not([type="hidden"]):not([type="file"]):not([type="search"])');
      if (inp && !inp.value?.trim()) {
        let val = '';
        if (/most recent.*employer|current.*employer|confirm.*employer/i.test(lowerLabel)) {
          val = p.current_employer || p.employer || '';
        } else if (/start.date.*employer/i.test(lowerLabel)) {
          val = fmtDate(p.employment_start_date || p.employer_start_date || p.start_date || '');
        } else if (/start.date.*role/i.test(lowerLabel)) {
          val = fmtDate(p.role_start_date || p.current_role_start_date || p.employment_start_date || '');
        } else if (/base.salary|current.*salary/i.test(lowerLabel)) {
          val = String(p.current_salary || p.salary || '');
        } else if (/minimum.*salary|salary requirement/i.test(lowerLabel)) {
          val = String(p.min_salary || p.salary_expectation || p.expected_salary || '');
        } else if (/incentive|bonus/i.test(lowerLabel)) {
          val = String(p.current_bonus || p.bonus || '0');
        }
        if (val) { reactSet(inp, val); log(`  ✓ "${labelText.slice(0,60)}" → "${val}"`); answered++; }
        else if (lowerLabel) { log(`  ⚠️ "${labelText.slice(0,60)}" — valeur manquante dans le profil`); }
      }
    }

    if (!answered) log('  ℹ️ Aucune question remplie (formulaire vide, déjà rempli, ou non standard)');
    else log(`  ✓ ${answered} question(s) répondue(s)`);
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
