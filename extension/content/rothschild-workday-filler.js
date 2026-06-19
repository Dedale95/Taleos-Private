/**
 * Taleos — Rothschild & Co Workday Filler  v1
 * Portail : rothschildandco.wd3.myworkdayjobs.com  (locale fr-FR)
 *
 * ══ DOM exploré avec MCP + API calypso applyflowpages le 2026-06-19 ══════════
 *
 * ÉTAPE 1 — Mes renseignements
 *   formField-source                → combobox (ex: "Site de Rothschild & Co")
 *   formField-candidateIsPreviousWorker → radio Oui/Non
 *   formField-country               → combobox (France)
 *   formField-legalName--firstName  → input[text]
 *   formField-legalName--lastName   → input[text]
 *   formField-addressLine1          → input[text]
 *   formField-city                  → input[text]
 *   formField-postalCode            → input[text]
 *   formField-phoneType             → combobox (Mobile / Cellulaire)
 *   formField-countryPhoneCode      → combobox (France / +33)
 *   formField-phoneNumber           → input[text]
 *
 * ÉTAPE 2 — Mon expérience
 *   workExperience-N--jobTitle      → input[text]
 *   workExperience-N--company       → input[text]
 *   workExperience-N--startDate     → mois (select-button) + année (input)
 *   currentlyWorking                → checkbox
 *   formField-school                → combobox
 *   formField-degree                → select-button
 *   formField-fieldOfStudy          → combobox
 *   formField-skills                → input[text] (tags)
 *   input[type="file"]              → CV upload
 *   formField-linkedInAccount       → input[text]
 *
 * ÉTAPE 3 — Questions liées à la candidature
 *   IDs = GUIDs dynamiques → identification par label
 *   Patterns FR courants :
 *     - Autorisation de travail France/UE → Oui
 *     - Visa / sponsoring requis → Non
 *     - Ancien employé Rothschild → p.rothschild_previously_employed || "Non"
 *     - Recommandation interne → Non (ou p.rothschild_referral)
 *     - Préavis (texte libre)  → p.notice_period
 *     - Disponibilité          → p.available_from
 *
 * ÉTAPE 4 — Divulgations volontaires
 *   formField-gender        → select-button (Homme / Femme / ...)
 *   Field-acceptTermsAndAgreements → checkbox OBLIGATOIRE
 *
 * ÉTAPE 5 — Réviser → soumission manuelle
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Champs Firebase utilisés :
 *   first_name, last_name, address, city, postal_code, phone,
 *   establishment, field_of_study, education_degree, education_level, institution_type,
 *   skills, linkedin_url, cv_storage_path, cv_filename,
 *   job_title, current_employer, current_role_start_date, gender,
 *   notice_period, available_from,
 *   rothschild_source            (défaut: "Site de carrière de Rothschild")
 *   rothschild_previously_employed (défaut: "Non")
 */
(function () {
  'use strict';

  if (!/rothschildandco\.wd3\.myworkdayjobs\.com/i.test(location.hostname || '')) return;
  if (globalThis.__TALEOS_ROTHSCHILD_FILLER_RUNNING__) return;
  globalThis.__TALEOS_ROTHSCHILD_FILLER_RUNNING__ = true;

  const PENDING_KEY = 'taleos_pending_rothschild_workday';
  const TAB_KEY     = 'taleos_rothschild_workday_tab_id';
  const BANNER_ID   = 'taleos-rothschild-banner';
  const LOG_PREFIX  = '[Workday — Rothschild & Co]';
  const logged      = new Set();

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function log(msg) {
    const txt = `${LOG_PREFIX} ${msg}`;
    if (logged.has(txt)) return;
    logged.add(txt);
    console.log(txt);
    const level = /❌/.test(txt) ? 'error' : /⚠️/.test(txt) ? 'warn' : 'info';
    try {
      chrome.runtime.sendMessage({
        action: 'extension_run_log', source: 'rothschild-workday-filler',
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
        background: '#1a1a2e', color: '#fff', padding: '8px 16px',
        fontSize: '13px', fontWeight: '600', textAlign: 'center',
        boxShadow: '0 2px 6px rgba(0,0,0,0.3)', fontFamily: 'sans-serif'
      });
      document.documentElement.appendChild(el);
    }
    if (color) el.style.background = color;
    el.textContent = text;
  }

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

  async function fillCombobox(automationId, searchText, label, timeoutMs = 5000) {
    if (!searchText) { log(`  ⏭️  ${label}: vide → ignoré`); return false; }
    const container = document.querySelector(`[data-automation-id="${automationId}"]`);
    if (!container) { log(`  ⚠️  ${label}: formField introuvable`); return false; }

    const selectedPill = container.querySelector(
      '[data-automation-id="selectedItem"],[data-automation-id="promptOption"][aria-selected="true"]'
    );
    if (selectedPill && new RegExp(searchText, 'i').test(selectedPill.textContent || '')) {
      log(`  ✓ ${label}: déjà "${selectedPill.textContent.trim()}" → skip`); return true;
    }

    const input = container.querySelector('input:not([type="hidden"])');
    if (!input) { log(`  ⚠️  ${label}: combobox input introuvable`); return false; }

    input.focus();
    await sleep(200);
    reactSet(input, searchText);
    await sleep(300);

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const opts = Array.from(document.querySelectorAll(
        '[data-automation-id="promptOption"], [role="option"]'
      )).filter(o => o.offsetWidth > 0);
      const opt = opts.find(o => new RegExp(searchText, 'i').test(o.textContent || ''));
      if (opt) {
        await clickEl(opt);
        await sleep(300);
        log(`  ✓ ${label}: "${opt.textContent.trim()}"`);
        return true;
      }
      await sleep(200);
    }

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    log(`  ⚠️  ${label}: option "${searchText}" introuvable dans le combobox`);
    return false;
  }

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
        await clickEl(opt);
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

  function currentStep() {
    const activeStep = document.querySelector('[data-automation-id="progressBarActiveStep"]');
    const name = (activeStep?.textContent || document.querySelector('h2')?.textContent || '').toLowerCase().trim();
    if (name.includes('mes renseignements') || name.includes('my information'))     return 'my_information';
    if (name.includes('mon expérience')     || name.includes('my experience'))      return 'my_experience';
    if (name.includes('questions liées')    || name.includes('application quest'))  return 'application_questions';
    if (name.includes('divulgations')       || name.includes('voluntary'))          return 'voluntary_disclosures';
    if (name.includes('réviser')            || name.includes('review'))             return 'review';
    if (!!document.querySelector('input[type="password"]')) return 'login';
    return 'unknown';
  }

  async function waitForStep(expected, timeout = 20000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (currentStep() === expected) return true;
      await sleep(400);
    }
    return false;
  }

  async function saveAndContinue() {
    await sleep(400);
    const btn = Array.from(document.querySelectorAll('button')).find(b =>
      b.offsetWidth > 0 &&
      /enregistrer\s+et\s+continuer|save\s+and\s+continue/i.test((b.innerText || '').trim())
    ) || document.querySelector('[data-automation-id="pageFooterNextButton"]');
    if (btn) { await clickEl(btn); await sleep(3000); return true; }
    log('⚠️ Bouton "Enregistrer et continuer" introuvable');
    return false;
  }

  function isLoggedIn() {
    if (document.querySelector('input[type="password"]')) return false;
    const isStartPage = Array.from(document.querySelectorAll('button,a')).some(el =>
      el.offsetWidth > 0 && /postuler manuellement|apply manually/i.test(el.innerText || '')
    );
    if (isStartPage) return false;
    return true;
  }

  async function handleSignIn(authEmail, authPassword) {
    if (isLoggedIn()) { log('  ✓ Déjà connecté'); return true; }
    log('🔐 Connexion à Rothschild Workday...');

    const signInLink = Array.from(document.querySelectorAll('a,button')).find(el =>
      el.offsetWidth > 0 && /connexion|ouvrir une session|sign in/i.test(el.textContent || '')
    );
    if (signInLink) { await clickEl(signInLink); await sleep(1500); }

    let waited = 0;
    while (waited < 5000) {
      if (document.querySelectorAll('input[type="password"]').length > 0) break;
      await sleep(300); waited += 300;
    }

    const textInputs = [...document.querySelectorAll('input[type="text"],input[type="email"],input[data-automation-id="email"]')];
    const pwdInputs  = [...document.querySelectorAll('input[type="password"]')];
    const emailEl = textInputs[textInputs.length - 1];
    const pwdEl   = pwdInputs[pwdInputs.length - 1];

    if (!emailEl || !pwdEl) { log('❌ Formulaire de connexion introuvable'); return false; }
    if (!authEmail || !authPassword) {
      log('❌ Identifiants Rothschild manquants — configurez-les dans Connexions');
      setBanner('❌ Identifiants Rothschild manquants', '#c62828');
      return false;
    }

    reactSet(emailEl, authEmail);
    await sleep(200);
    pwdEl.focus(); pwdEl.select();
    reactSet(pwdEl, '');
    await sleep(100);
    reactSet(pwdEl, authPassword);
    await sleep(300);

    const submitBtn = Array.from(document.querySelectorAll('button')).find(b =>
      b.offsetWidth > 0 && /connexion|ouvrir une session|sign in/i.test(b.textContent || '')
    );
    if (submitBtn) { await clickEl(submitBtn); }
    else { pwdEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true })); }

    waited = 0;
    while (waited < 15000) {
      await sleep(500); waited += 500;
      if (!document.querySelector('input[type="password"]')) break;
    }

    const ok = isLoggedIn();
    if (!ok) log('❌ Connexion Rothschild échouée — vérifiez vos identifiants');
    return ok;
  }

  async function handleStartPage() {
    let waited = 0;
    while (waited < 8000) {
      if (document.querySelector('[data-automation-id="progressBarActiveStep"]') ||
          document.querySelector('[data-automation-id*="formField"]')) return;
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
  // ÉTAPE 1
  // ═══════════════════════════════════════════════════════════════════════════
  async function fillMesRenseignements(p) {
    log('📝 Étape 1 — Mes renseignements');
    setBanner('📝 Mes renseignements en cours...');

    let w = 0;
    while (w < 8000) {
      if (document.querySelector('[data-automation-id="formField-legalName--firstName"]') ||
          document.querySelector('[data-automation-id="formField-source"]')) break;
      await sleep(300); w += 300;
    }
    await sleep(500);

    // Source
    const sourceVal = p.rothschild_source || 'Site de carrière';
    const sourceContainer = document.querySelector('[data-automation-id="formField-source"]');
    if (sourceContainer) {
      const alreadySet = !!sourceContainer.querySelector('[data-automation-id="selectedItem"]');
      if (alreadySet) {
        log('  ✓ Source: déjà remplie → skip');
      } else {
        const sourceInput = sourceContainer.querySelector('input:not([type="hidden"])');
        if (sourceInput) {
          reactSet(sourceInput, sourceVal);
          await sleep(600);
          const opts = Array.from(document.querySelectorAll('[data-automation-id="promptOption"]'))
            .filter(o => o.offsetWidth > 0);
          const opt = opts.find(o => new RegExp(sourceVal, 'i').test(o.textContent || '')) || opts[0];
          if (opt) {
            await clickEl(opt);
            log(`  ✓ Source: "${opt.textContent.trim()}"`);
          } else {
            log(`  ⚠️  Source: aucune option trouvée pour "${sourceVal}"`);
          }
        }
      }
    }

    // Ex-employé Rothschild
    const prevWorkerContainer = document.querySelector('[data-automation-id="formField-candidateIsPreviousWorker"]');
    if (prevWorkerContainer) {
      const wasEmployee = (p.rothschild_previously_employed || 'Non').toLowerCase() === 'oui';
      const radios = prevWorkerContainer.querySelectorAll('input[type="radio"]');
      let targetRadio = null;
      for (const radio of radios) {
        const lbl = (document.querySelector(`label[for="${radio.id}"]`)?.textContent || '').trim();
        if (wasEmployee && /oui|yes/i.test(lbl)) { targetRadio = radio; break; }
        if (!wasEmployee && /non|no/i.test(lbl))  { targetRadio = radio; break; }
      }
      if (!targetRadio) {
        targetRadio = prevWorkerContainer.querySelector(`input[value="${wasEmployee ? 'true' : 'false'}"]`);
      }
      if (targetRadio && !targetRadio.checked) {
        await clickEl(targetRadio);
        log(`  ✓ Ex-employé Rothschild: ${wasEmployee ? 'Oui' : 'Non'}`);
      } else if (targetRadio?.checked) {
        log(`  ✓ Ex-employé: déjà ${wasEmployee ? 'Oui' : 'Non'} → skip`);
      }
    }

    // Pays → France
    const countryContainer = document.querySelector('[data-automation-id="formField-country"]');
    if (countryContainer) {
      if (!/france/i.test(countryContainer.innerText || '')) {
        await fillCombobox('formField-country', 'France', 'Pays');
      } else {
        log('  ✓ Pays: déjà France → skip');
      }
    }

    await fillTextField('formField-legalName--firstName', p.first_name || p.firstName, 'Prénom');
    await fillTextField('formField-legalName--lastName',  p.last_name  || p.lastName,  'Nom');
    await fillTextField('formField-addressLine1', p.address,                  'Adresse');
    await fillTextField('formField-addressLine2', p.address_line2 || '',      'Adresse 2');
    await fillTextField('formField-city',         p.city,                     'Ville');
    await fillTextField('formField-postalCode',   p.postal_code || p.zipcode, 'Code postal');

    // Type de téléphone → Mobile
    const phoneTypeContainer = document.querySelector('[data-automation-id="formField-phoneType"]');
    if (phoneTypeContainer) {
      if (!/mobile|cellulaire/i.test(phoneTypeContainer.innerText || '')) {
        await fillCombobox('formField-phoneType', 'Mobile', 'Type téléphone') ||
        await fillCombobox('formField-phoneType', 'Cellulaire', 'Type téléphone');
      } else {
        log('  ✓ Type téléphone: déjà Mobile → skip');
      }
    }

    // Indicatif → France (+33)
    const phoneCodeContainer = document.querySelector('[data-automation-id="formField-countryPhoneCode"]');
    if (phoneCodeContainer) {
      if (!/france|\+33/i.test(phoneCodeContainer.innerText || '')) {
        await fillCombobox('formField-countryPhoneCode', 'France', 'Indicatif (+33)');
      } else {
        log('  ✓ Indicatif: déjà France (+33) → skip');
      }
    }

    const phone = (p['phone-number'] || p.phone_number || p.phone || '').replace(/\s/g, '');
    if (phone) await fillTextField('formField-phoneNumber', phone, 'Téléphone');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ÉTAPE 2
  // ═══════════════════════════════════════════════════════════════════════════
  async function fillWorkExperience(p) {
    const jobTitle  = p.job_title || p.jobTitle || '';
    const company   = p.current_employer || p.employer || '';
    const startDate = p.current_role_start_date || p.employment_start_date || '';

    if (!jobTitle && !company) return;

    const jobTitleInput = document.querySelector('[id*="workExperience"][id*="jobTitle"]') ||
      document.querySelector('[data-automation-id="formField-jobTitle"] input:not([type="hidden"])');

    if (jobTitleInput && jobTitle) {
      const cur = (jobTitleInput.value || '').trim();
      if (cur.toLowerCase() !== jobTitle.toLowerCase()) {
        reactSet(jobTitleInput, jobTitle);
        await sleep(300);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
        log(`  ✓ Titre: "${jobTitle}"`);
      }
    }

    if (company) {
      const companyInput = document.querySelector('[id*="workExperience"][id*="company"]') ||
        document.querySelector('[data-automation-id="formField-company"] input:not([type="hidden"])');
      if (companyInput) {
        const cur = (companyInput.value || '').trim();
        if (!cur || cur.toLowerCase() !== company.toLowerCase()) {
          reactSet(companyInput, company);
          await sleep(300);
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
          log(`  ✓ Société: "${company}"`);
        }
      }
    }

    if (startDate) {
      const parts = startDate.split('-');
      const yyyy = parts[0];
      const mm   = parts[1] || '';

      const yearInput = document.querySelector('[id*="workExperience"][id*="startDate"][id*="year"]') ||
        document.querySelector('[id*="workExperience"][id*="startYear"]');
      if (yearInput && yyyy && (yearInput.value || '').trim() !== yyyy) {
        reactSet(yearInput, yyyy);
        await sleep(200);
        log(`  ✓ Début année: "${yyyy}"`);
      }

      if (mm) {
        const monthBtn = document.querySelector('[id*="workExperience"][id*="startDate"][id*="month"]') ||
          document.querySelector('[id*="workExperience"][id*="startMonth"]');
        if (monthBtn && monthBtn.tagName === 'BUTTON') {
          const monthNames = ['','January','February','March','April','May','June',
                              'July','August','September','October','November','December'];
          const monthText = monthNames[parseInt(mm, 10)] || '';
          if (monthText) await fillSelectButton(monthBtn, monthText, 'Mois début');
        } else if (monthBtn) {
          reactSet(monthBtn, mm); await sleep(200);
        }
      }
    }

    // Case "Emploi actuel"
    const currentJobCheckbox = document.querySelector('[id*="workExperience"][id*="currentlyWorking"]') ||
      [...document.querySelectorAll('input[type="checkbox"]')].find(cb =>
        /currentlyWorking|currentJob|isCurrent/i.test(cb.id || '')
      );
    if (currentJobCheckbox && !currentJobCheckbox.checked) {
      await clickEl(currentJobCheckbox);
      await sleep(300);
      log('  ✓ Emploi actuel: coché');
    }
  }

  async function fillMonExperience(p) {
    log('📝 Étape 2 — Mon expérience');
    setBanner('📝 Mon expérience en cours...');
    await sleep(1000);

    await fillWorkExperience(p);
    await sleep(500);

    // Section Études — cliquer "Ajouter" si pas encore visible
    if (!document.querySelector('[data-automation-id="formField-school"]') &&
        (p.establishment || p.field_of_study || p.education_degree)) {
      const sections = Array.from(document.querySelectorAll('h3, h4, [data-automation-id*="sectionTitle"]'));
      const etudesH = sections.find(h => /étude|education|formation/i.test(h.textContent || ''));
      if (etudesH) {
        const allAddBtns = Array.from(document.querySelectorAll('button'))
          .filter(b => /ajouter|add/i.test(b.textContent.trim()));
        let etudesBtn = null;
        for (const btn of allAddBtns) {
          if (btn.getBoundingClientRect().top >= etudesH.getBoundingClientRect().top) {
            etudesBtn = btn; break;
          }
        }
        if (etudesBtn) {
          log('  📚 Études: ouverture du formulaire...');
          await clickEl(etudesBtn);
          await sleep(1500);
        }
      }
    }

    // École
    if (document.querySelector('[data-automation-id="formField-school"]') && p.establishment) {
      const alreadySet = !!document.querySelector('[data-automation-id="formField-school"] [data-automation-id="selectedItem"]');
      if (!alreadySet) await fillCombobox('formField-school', p.establishment, 'École');
      else log('  ✓ École: déjà remplie → skip');
    }

    // Diplôme
    const degreeContainer = document.querySelector('[data-automation-id="formField-degree"]');
    if (degreeContainer) {
      const degreeBtn = degreeContainer.querySelector('button[id]');
      if (degreeBtn) {
        let degreeValue = p.education_degree || '';
        if (!degreeValue) {
          const lvl  = (p.education_level || '').toLowerCase();
          const type = (p.institution_type || '').toLowerCase();
          if (lvl.includes('bac + 5') || lvl.includes('m2') || lvl.includes('master')) {
            degreeValue = (type.includes('commerce') || type.includes('ingénieur'))
              ? 'Professional Degree' : "Master's Degree";
          } else if (lvl.includes('bac + 3') || lvl.includes('bachelor')) {
            degreeValue = "Bachelor's Degree";
          } else if (lvl.includes('bac + 2')) {
            degreeValue = 'Diploma';
          }
        }
        if (degreeValue) await fillSelectButton(degreeBtn, degreeValue, 'Diplôme');
      }
    }

    // Domaine d'études
    if (document.querySelector('[data-automation-id="formField-fieldOfStudy"]') && p.field_of_study) {
      const alreadySet = !!document.querySelector('[data-automation-id="formField-fieldOfStudy"] [data-automation-id="selectedItem"]');
      if (!alreadySet) await fillCombobox('formField-fieldOfStudy', p.field_of_study, "Domaine d'études");
      else log("  ✓ Domaine d'études: déjà rempli → skip");
    }

    // Compétences
    if (p.skills) {
      const skillsInput = document.querySelector('[data-automation-id="formField-skills"] input:not([type="hidden"])');
      if (skillsInput) {
        for (const skill of String(p.skills).split(',').map(s => s.trim()).filter(Boolean)) {
          reactSet(skillsInput, skill);
          await sleep(400);
          const opt = Array.from(document.querySelectorAll('[role="option"]'))
            .find(o => o.offsetWidth > 0 && new RegExp(skill, 'i').test(o.textContent || ''));
          if (opt) await clickEl(opt);
          else skillsInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
          await sleep(300);
        }
        log(`  ✓ Compétences: "${p.skills}"`);
      }
    }

    // CV
    await uploadCV(p);

    // LinkedIn
    if (p.linkedin_url) await fillTextField('formField-linkedInAccount', p.linkedin_url, 'LinkedIn');
  }

  async function uploadCV(p) {
    const fileInput = document.querySelector('input[type="file"]');
    if (!fileInput) { log('  ⚠️ CV: input[type="file"] introuvable'); return; }

    const filename    = p.cv_filename || 'cv.pdf';
    const storagePath = p.cv_storage_path;

    const uploadOk = !!document.querySelector('[data-automation-id="file-upload-successful"]');
    const uploadedName = document.querySelector('[data-automation-id="file-upload-item-name"]')?.textContent || '';
    if (uploadOk && uploadedName.includes(filename.replace('.pdf', ''))) {
      log(`  ✓ CV: "${filename}" déjà uploadé → skip`); return;
    }

    const deleteBtn = document.querySelector('[data-automation-id="delete-file"]') ||
      Array.from(document.querySelectorAll('button')).find(b =>
        /supprimer|delete/i.test(b.getAttribute('aria-label') || b.innerText || '') &&
        b.closest('[data-automation-id*="upload"],[data-automation-id*="file"]')
      );
    if (deleteBtn) { await clickEl(deleteBtn); await sleep(1000); }

    if (!storagePath) {
      log('  ⚠️ CV: cv_storage_path absent → upload manuel requis');
      setBanner('⏸️ ÉTAPE MANUELLE : Uploadez votre CV puis attendez', '#c47900');
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
    log(!!document.querySelector('[data-automation-id="file-upload-successful"]')
      ? `  ✅ CV: "${filename}" uploadé`
      : `  ⚠️ CV: pas de confirmation après ${waited}ms`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ÉTAPE 3 — Questions liées à la candidature (IDs dynamiques → scan par label)
  // ═══════════════════════════════════════════════════════════════════════════
  async function fillApplicationQuestions(p) {
    log('📝 Étape 3 — Questions liées à la candidature');
    setBanner('📝 Questions candidature en cours...');
    await sleep(2000);

    // Questions select-button (formField-dc*)
    const questionFields = Array.from(document.querySelectorAll('[data-automation-id*="formField-dc"]'));
    log(`  🔍 ${questionFields.length} question(s) dynamique(s) trouvée(s)`);

    for (const field of questionFields) {
      const btn = field.querySelector('button[id]');
      if (!btn) continue;

      // Trouver le texte de la question
      const parent = field.parentElement;
      const siblings = parent ? Array.from(parent.children) : [];
      const idx = siblings.indexOf(field);
      let questionText = '';
      for (let i = idx - 1; i >= 0; i--) {
        const t = siblings[i].textContent?.trim();
        if (t && t.length > 10) { questionText = t.replace(/\s+/g, ' '); break; }
      }
      if (!questionText) questionText = field.querySelector('label,legend')?.textContent?.trim() || '';

      const lower = questionText.toLowerCase();
      const cur   = (btn.textContent || '').trim();

      if (cur && !/sélectionnez|select a value/i.test(cur)) {
        log(`  ✓ "${questionText.slice(0,60)}": déjà "${cur}" → skip`);
        continue;
      }

      let answer = null;

      if (/autorisé.*travailler|autorisation.*travail|légalement.*travailler|right to work|work authoriz/i.test(lower)) {
        answer = 'Oui';
      } else if (/visa|sponsoring|parrainage|permis de travail/i.test(lower)) {
        answer = 'Non';
      } else if (/rothschild|déjà.*employ|previously.*employ|ancien.*employ/i.test(lower)) {
        answer = (p.rothschild_previously_employed || 'Non').match(/oui|yes/i) ? 'Oui' : 'Non';
      } else if (/recommand|référ[e]|connaissez.*quelqu/i.test(lower)) {
        answer = p.rothschild_referral ? 'Oui' : 'Non';
      } else if (/gouvernement|fonctionnaire|regulat|official/i.test(lower)) {
        answer = 'Non';
      } else {
        answer = 'Non';
        log(`  ℹ️ Question inconnue → "Non" par défaut: "${questionText.slice(0,70)}"`);
      }

      // Essayer Oui/Non en français d'abord, puis Yes/No
      const ok = await fillSelectButton(btn, answer, questionText.slice(0, 50)) ||
                 await fillSelectButton(btn, answer === 'Oui' ? 'Yes' : 'No', questionText.slice(0, 50));
      if (!ok) log(`  ⚠️ "${questionText.slice(0,60)}" → ${answer} ÉCHEC`);
    }

    // Questions texte libre (préavis, disponibilité)
    const textFields = Array.from(document.querySelectorAll('[data-automation-id*="formField"]'))
      .filter(f => f.getAttribute('data-automation-id')?.includes('dc'));
    for (const field of textFields) {
      const input = field.querySelector('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]), textarea');
      if (!input || input.value) continue;

      const parent = field.parentElement;
      const siblings = parent ? Array.from(parent.children) : [];
      const idx = siblings.indexOf(field);
      let questionText = '';
      for (let i = idx - 1; i >= 0; i--) {
        const t = siblings[i].textContent?.trim();
        if (t && t.length > 10) { questionText = t.replace(/\s+/g, ' '); break; }
      }

      const lower = questionText.toLowerCase();
      let value = null;

      if (/préavis|notice period/i.test(lower)) {
        value = p.notice_period || '3 months';
      } else if (/disponible|available|start date/i.test(lower)) {
        value = p.available_from || '';
      } else if (/salary|salaire|rémunération/i.test(lower)) {
        value = p.salary_expectations || p.current_salary || '';
      }

      if (value) {
        reactSet(input, String(value));
        log(`  ✓ "${questionText.slice(0,50)}": "${value}"`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ÉTAPE 4 — Divulgations volontaires
  // ═══════════════════════════════════════════════════════════════════════════
  async function fillDivulgationsVolontaires(p) {
    log('📝 Étape 4 — Divulgations volontaires');
    setBanner('📝 Divulgations volontaires en cours...');
    await sleep(1500);

    const genderContainer = document.querySelector('[data-automation-id="formField-gender"]');
    if (genderContainer) {
      const genderBtn = genderContainer.querySelector('button[id]');
      if (genderBtn) {
        const genderMap = {
          'male': 'Homme', 'female': 'Femme', 'homme': 'Homme', 'femme': 'Femme',
          'man': 'Homme', 'woman': 'Femme',
        };
        const target = genderMap[(p.gender || '').toLowerCase()] || "Préfère ne pas répondre";
        await fillSelectButton(genderBtn, target, 'Genre') ||
          await fillSelectButton(genderBtn, p.gender || 'Male', 'Genre');
      }
    }

    // CGU — OBLIGATOIRE
    const cguContainer = document.querySelector('[data-automation-id="Field-acceptTermsAndAgreements"]');
    const cguInput = cguContainer?.querySelector('input[type="checkbox"]')
      || document.getElementById('termsAndConditions--acceptTermsAndAgreements');

    if (cguInput) {
      if (!cguInput.checked) { await clickEl(cguInput); await sleep(300); log('  ✓ CGU: cochée'); }
      else log('  ✓ CGU: déjà cochée → skip');
    } else {
      const cguFallback = Array.from(document.querySelectorAll('input[type="checkbox"]')).find(cb => {
        const lbl = document.querySelector(`label[for="${cb.id}"]`)?.textContent || '';
        return /j'ai lu|termes et conditions|terms and conditions|j'accepte|consent/i.test(lbl);
      });
      if (cguFallback && !cguFallback.checked) {
        await clickEl(cguFallback); log('  ✓ CGU (fallback): cochée');
      } else if (!cguFallback) {
        log('  ❌ CGU: checkbox introuvable — vérifiez manuellement');
        setBanner('⚠️ Cochez manuellement les CGU avant de continuer', '#c47900');
        await sleep(5000);
      }
    }
  }

  async function loadProfile() {
    const local = await chrome.storage.local.get([PENDING_KEY, TAB_KEY]).catch(() => ({}));
    const pending = local[PENDING_KEY];
    if (!pending) { log('⚠️ Pas de candidature Rothschild en attente'); return null; }
    return pending;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN
  // ═══════════════════════════════════════════════════════════════════════════
  async function main() {
    log('🚀 Rothschild & Co Workday Filler v1 démarré');

    const pending = await loadProfile();
    if (!pending) return;

    const p            = pending.profile || pending;
    const authEmail    = pending.email    || p.email;
    const authPassword = pending.password;

    setBanner('⏳ Taleos — Rothschild & Co en cours...');

    const loggedIn = await handleSignIn(authEmail, authPassword);
    if (!loggedIn) return;

    await handleStartPage();

    let waitForm = 0;
    while (waitForm < 20000) {
      if (document.querySelector('[data-automation-id="progressBarActiveStep"]') ||
          document.querySelector('[data-automation-id*="formField"]')) break;
      await sleep(500); waitForm += 500;
    }
    await sleep(1000);

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
        await fillApplicationQuestions(p);
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
        const loginOk = await handleSignIn(authEmail, authPassword);
        if (!loginOk) return;
        await sleep(2000);

      } else {
        log(`⚠️ Étape inconnue "${step}" — retry`);
        await sleep(2000);
        await saveAndContinue();
        await sleep(3000);
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
