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

  // Bannière en haut de page, décalée sous le header BofA (~60px)
  function setBanner(text, color) {
    let el = document.getElementById(BANNER_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = BANNER_ID;
      Object.assign(el.style, {
        position: 'fixed', top: '60px', left: '0', width: '100%', zIndex: '2147483647',
        background: '#012169', color: '#fff', padding: '8px 16px',
        fontSize: '13px', fontWeight: '600', textAlign: 'center',
        boxShadow: '0 2px 6px rgba(0,0,0,0.3)', fontFamily: 'sans-serif'
      });
      document.documentElement.appendChild(el);
    }
    if (color) el.style.background = color;
    el.textContent = text;
  }

  // React-compatible value setter
  function reactSet(el, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Frappe caractère par caractère (typeaheads Workday)
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

  // Récupérer un fichier depuis Firebase Storage
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

  // Click avec scroll
  async function clickEl(el) {
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(200);
    el.click();
  }

  // ─── Logging structuré (Firebase → formulaire → action) ────────────────────
  // Format : "  ✓ label: Firebase="X" | Formulaire="Y" → skip/renseigné"
  function logFieldAction(label, fbVal, formVal, action) {
    const fbStr  = fbVal  !== undefined && fbVal  !== null ? `Firebase="${fbVal}"` : 'Firebase=—';
    const fmStr  = formVal !== undefined && formVal !== null ? `Formulaire="${formVal}"` : '';
    if (action === 'skip') {
      log(`  ✓ ${label}: ${fbStr} | ${fmStr} → identique, skip`);
    } else if (action === 'fill') {
      log(`  ✓ ${label}: ${fbStr} | ${fmStr} → renseigné`);
    } else if (action === 'missing_firebase') {
      log(`  ⚠️ ${label}: valeur absente dans Firebase → champ ignoré`);
    } else if (action === 'not_found') {
      log(`  ⚠️ ${label}: champ introuvable dans le formulaire`);
    }
  }

  // ─── Fill text field with logging ──────────────────────────────────────────
  async function fillField(automationId, value, label) {
    if (value === undefined || value === null || value === '') {
      logFieldAction(label, value, undefined, 'missing_firebase');
      return;
    }
    const wrapper = document.querySelector(`[data-automation-id="${automationId}"]`);

    if (!wrapper) {
      // Fallback multi-stratégie pour tenants Workday EMEA sans wrappers formField-* :
      // 1. input[name="fieldName"]          → BofA pre-filled : name="legalName--firstName"
      // 2. input[id$="--fieldName"]         → BofA EMEA : id="name--legalName--firstName"
      // 3. input[id*="fieldName"]           → variantes de nommage
      const inputName = automationId.replace(/^formField-/, '');
      const inp = document.querySelector(
        `input[name="${inputName}"]:not([type="hidden"]):not([type="file"]), ` +
        `textarea[name="${inputName}"], ` +
        `input[id$="--${inputName}"]:not([type="hidden"]):not([type="file"]), ` +
        `input[id*="${inputName}"]:not([type="hidden"]):not([type="file"])`
      );
      if (inp) {
        const current = (inp.value || '').trim();
        if (current.toLowerCase() === String(value).trim().toLowerCase()) {
          logFieldAction(label, value, current, 'skip'); return;
        }
        inp.focus();
        reactSet(inp, String(value));
        inp.blur();
        logFieldAction(label, value, current || '(vide)', 'fill');
      } else {
        logFieldAction(label, value, undefined, 'not_found');
      }
      return;
    }

    const wrapperText = (wrapper.innerText || '').toLowerCase();
    if (wrapperText.includes(String(value).toLowerCase())) {
      logFieldAction(label, value, String(value), 'skip'); return;
    }
    const inp = wrapper.querySelector('input:not([type="hidden"]):not([type="file"])');
    if (!inp) { logFieldAction(label, value, '(non éditable)', 'skip'); return; }
    const current = (inp.value || '').trim();
    if (current.toLowerCase() === String(value).trim().toLowerCase()) {
      logFieldAction(label, value, current, 'skip'); return;
    }
    inp.focus();
    reactSet(inp, String(value));
    inp.blur();
    logFieldAction(label, value, current || '(vide)', 'fill');
  }

  // ─── Select listbox option ──────────────────────────────────────────────────
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
  function currentStep() {
    const labels = document.querySelector('[data-automation-id="progressBarActiveStep"]')?.querySelectorAll('label');
    const name = (labels?.[1]?.textContent || '').toLowerCase().trim();
    if (name.includes('my information')) return 'my_information';
    if (name.includes('my experience')) return 'my_experience';
    if (name.includes('application questions')) return 'application_questions';
    if (name.includes('voluntary')) return 'voluntary_disclosures';
    if (name.includes('self identify') || name.includes('self-identify')) return 'self_identify';
    if (name.includes('review')) return 'review';
    return 'unknown';
  }

  // ─── Save and Continue ──────────────────────────────────────────────────────
  async function saveAndContinue() {
    await sleep(400);
    const btn = Array.from(document.querySelectorAll('button')).find(b =>
      b.offsetWidth > 0 && /save and continue/i.test((b.innerText || '').trim())
    );
    if (btn) { await clickEl(btn); await sleep(2000); return true; }
    // Fallback: pageFooterNextButton
    const next = document.querySelector('[data-automation-id="pageFooterNextButton"]');
    if (next && next.offsetWidth > 0) { await clickEl(next); await sleep(2000); return true; }
    log('⚠️ Bouton Save and Continue introuvable');
    return false;
  }

  async function waitForNextStep(expectedStep, timeout = 10000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (currentStep() === expectedStep) return true;
      await sleep(400);
    }
    return false;
  }

  // ─── Popup "Apply Manually" ─────────────────────────────────────────────────
  // Après le clic sur Apply, BofA peut afficher un popup avec l'option
  // "Apply Manually" (vs "Apply with LinkedIn"). Il faut la détecter et la cliquer.

  async function handleApplyManuallyPopup() {
    // Attendre un court instant que le popup apparaisse
    let waited = 0;
    while (waited < 3000) {
      const manualBtn = document.querySelector('[data-automation-id="applyManually"]')
        || Array.from(document.querySelectorAll('a[role="button"], button')).find(el =>
            el.offsetWidth > 0 && /apply manually/i.test((el.innerText || el.textContent || '').trim())
          );
      if (manualBtn) {
        log('🖱️ Popup Apply Manually détecté → clic');
        await clickEl(manualBtn);
        await sleep(2000);
        return true;
      }
      await sleep(300); waited += 300;
    }
    return false;
  }

  // ─── Apply / Continue Application ──────────────────────────────────────────
  // On force toujours le passage par /apply/applyManually pour obtenir un
  // formulaire vierge avec les wrappers formField-* standard.
  // Quand l'utilisateur a déjà postulé, Workday navigue vers /apply (formulaire
  // pré-rempli sans wrappers formField-*) → on redirige vers applyManually.
  async function clickApply() {
    const url = location.href.toLowerCase();

    // Déjà sur le formulaire vierge → rien à faire
    if (url.includes('/apply/applymanually') || url.includes('/application/')) return true;

    // Sur /apply (pré-rempli OU popup) → forcer applyManually
    if (url.includes('/apply')) {
      const applyManualUrl = location.href.replace(/\/apply.*$/i, '') + '/apply/applyManually';
      log('🔄 Redirection Apply Manually (formulaire vierge)...');
      location.href = applyManualUrl;
      await sleep(2000);
      return true;
    }

    // Sur la page offre : chercher d'abord le lien applyManually direct
    const applyManuallyLink = document.querySelector('a[data-automation-id="applyManually"][href]');
    if (applyManuallyLink) {
      log('🚀 Lien Apply Manually → navigation directe...');
      location.href = applyManuallyLink.href;
      await sleep(2000);
      return true;
    }

    // Fallback : clic sur le bouton Apply standard puis gérer le popup
    const btn = document.querySelector('[data-automation-id="adventureButton"]')
      || document.querySelector('[data-automation-id="continueButton"]')
      || document.querySelector('[data-automation-id="applyNow"]')
      || Array.from(document.querySelectorAll('a[role="button"],button')).find(el =>
          el.offsetWidth > 0 && /^(apply|continue application)(\s+now)?$/i.test((el.innerText || '').trim())
        );
    if (btn) {
      log('🚀 Clic Apply/Continue Application...');
      await clickEl(btn);
      await sleep(1500);
      await handleApplyManuallyPopup();
      await sleep(1000);
      return true;
    }
    return false;
  }

  // ─── Sign In ────────────────────────────────────────────────────────────────
  // Logique :
  //   1. accountSettingsButton présent → déjà connecté
  //   2. Bouton "Sign In" visible dans le header → clic pour ouvrir le formulaire
  //   3. Formulaire email/password → remplir + soumettre
  //   4. Attente de la disparition du formulaire

  function isLoggedIn() {
    if (document.getElementById('accountSettingsButton')) return true;
    // "Sign In" dans le header = pas connecté
    const hasSignInBtn = Array.from(document.querySelectorAll('span, button, [role="button"]')).some(el =>
      el.offsetWidth > 0 && /^sign\s*in$/i.test((el.textContent || '').trim())
    );
    if (hasSignInBtn) return false;
    // Pas de formulaire login non plus = OK
    return !document.querySelector('input[data-automation-id="email"]');
  }

  async function handleSignIn(authEmail, authPassword) {
    if (isLoggedIn()) {
      log('  ✓ Déjà connecté');
      return true;
    }

    // Étape 1 : cliquer sur le bouton "Sign In" dans le header pour ouvrir le formulaire
    const signInHeaderBtn = Array.from(document.querySelectorAll('button, [role="button"], a')).find(el =>
      el.offsetWidth > 0 && /^sign\s*in$/i.test((el.innerText || el.textContent || '').trim())
    );
    if (signInHeaderBtn) {
      log('🔐 Clic sur Sign In dans le header...');
      await clickEl(signInHeaderBtn);
      // Attendre que le formulaire apparaisse
      let w = 0;
      while (w < 8000 && !document.querySelector('input[data-automation-id="email"]')) {
        await sleep(400); w += 400;
      }
    }

    const loginEl = document.querySelector('input[data-automation-id="email"]');
    if (!loginEl) {
      log('  ✓ Formulaire de connexion absent après clic — déjà connecté');
      return true;
    }

    if (!authEmail || !authPassword) {
      log('❌ Identifiants BofA manquants — ajoutez-les dans Connexions');
      setBanner('❌ Identifiants Bank of America manquants — Connexions', '#c62828');
      return false;
    }

    log(`🔐 Connexion avec ${authEmail}...`);

    // Remplir email
    const ns = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    loginEl.focus();
    if (ns) ns.call(loginEl, authEmail); else loginEl.value = authEmail;
    loginEl.dispatchEvent(new Event('input', { bubbles: true }));
    loginEl.dispatchEvent(new Event('change', { bubbles: true }));
    loginEl.blur();
    log(`  ✓ Email: ${authEmail}`);
    await sleep(400);

    // Remplir mot de passe
    const passEl = document.querySelector('input[data-automation-id="password"]') || document.querySelector('input[type="password"]');
    if (passEl) {
      passEl.focus();
      if (ns) ns.call(passEl, authPassword); else passEl.value = authPassword;
      passEl.dispatchEvent(new Event('input', { bubbles: true }));
      passEl.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(300);
    }

    // Cliquer Sign In submit : [data-automation-id="click_filter"][aria-label="Sign In"]
    const submitBtn = document.querySelector('[data-automation-id="click_filter"][aria-label="Sign In"]')
      || document.querySelector('[data-automation-id="signInSubmitButton"]')
      || Array.from(document.querySelectorAll('button, [role="button"]')).find(el =>
          el.offsetWidth > 0 && /^sign\s*in$/i.test((el.innerText || el.getAttribute('aria-label') || '').trim())
        );

    if (submitBtn) {
      log('  ✓ Clic sur Sign In...');
      await clickEl(submitBtn);
    } else {
      // Fallback : Enter sur le champ password
      if (passEl) {
        ['keydown', 'keypress', 'keyup'].forEach(t => passEl.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true })));
      }
    }

    // Attendre la disparition du formulaire (connexion réussie)
    let waited = 0;
    while (waited < 15000) {
      await sleep(500); waited += 500;
      if (!document.querySelector('input[data-automation-id="email"]')) break;
    }
    log('  ✓ Connexion terminée');
    return true;
  }

  // ─── STEP 1 : My Information ────────────────────────────────────────────────
  async function fillMyInformation(p) {
    log('📝 Step 1 — My Information');
    setBanner('📝 My Information en cours...');

    // Attendre que React ait rendu les inputs (le progressBar peut apparaître
    // avant que les champs de formulaire soient dans le DOM)
    let waitMs = 0;
    while (waitMs < 5000) {
      const hasInput = document.querySelector(
        '[data-automation-id^="formField-legalName"] input, ' +
        'input[name="legalName--firstName"], input[id*="legalName--firstName"]'
      );
      if (hasInput) break;
      await sleep(300); waitMs += 300;
    }

    // Diagnostic : lister tous les inputs visibles (aide au debug EMEA)
    const allInputs = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="file"]), textarea'))
      .filter(i => i.offsetParent !== null)
      .map(i => `  ${i.tagName}[name="${i.name || ''}"][id="${i.id || ''}"][type="${i.type || ''}"] val="${(i.value||'').slice(0,20)}"`);
    log(`  🔍 Inputs visibles Step 1 (${allInputs.length}):\n${allInputs.slice(0,12).join('\n')}`);
    const formFields = Array.from(document.querySelectorAll('[data-automation-id^="formField-"]'))
      .map(f => f.getAttribute('data-automation-id'));
    log(`  🔍 formField-* présents: ${formFields.length ? formFields.join(', ') : 'AUCUN'}`);

    await fillField('formField-legalName--firstName', p.firstname || p.first_name, 'first_name');
    await fillField('formField-legalName--lastName',  p.lastname  || p.last_name,  'last_name');
    await fillField('formField-addressLine1',         p.address,    'address');
    await fillField('formField-city',                 p.city,       'city');
    await fillField('formField-postalCode',           p.zipcode || p.postal_code, 'postal_code');

    // ── "How Did You Hear About Us?" — multiselect à 2 niveaux ──────────────
    // BofA utilise un widget multiselect (data-automation-id="multiSelectContainer")
    // sans button[aria-haspopup] → navigation : clic container → niveau 1 → niveau 2
    const sourceField = document.querySelector('[data-automation-id="formField-source"]');
    if (sourceField) {
      // Les items sélectionnés peuvent être des chips (US) ou des promptOption (EMEA)
      const chips = Array.from(sourceField.querySelectorAll(
        '[data-automation-id="selectedItem"], [class*="chip"], [data-automation-id="promptOption"]'
      ));
      const alreadySet = chips.some(c => /bank of america careers site/i.test(c.textContent || ''))
        || /bank of america careers site/i.test(sourceField.innerText || '');
      if (alreadySet) {
        logFieldAction('How Did You Hear', 'Bank of America Careers Site', 'Bank of America Careers Site', 'skip');
      } else {
        const container = sourceField.querySelector('[data-automation-id="multiselectInputContainer"], [data-uxi-widget-type="multiselect"]');
        if (container) { container.click(); await sleep(600); }
        // Niveau 1 : trouver "Bank of America Careers Site" dans la liste
        let opt1 = Array.from(document.querySelectorAll('[role="option"],[data-automation-id="promptOption"]'))
          .find(el => el.offsetWidth > 0 && /bank of america careers site/i.test(el.textContent || ''));
        if (opt1) {
          opt1.click(); await sleep(600);
          // Niveau 2 : une sous-liste peut apparaître — cliquer "Bank of America Careers Site" dedans
          const opt2 = Array.from(document.querySelectorAll('[role="option"],[data-automation-id="promptOption"]'))
            .find(el => el.offsetWidth > 0 && /^bank of america careers site$/i.test((el.textContent || '').trim()));
          if (opt2) { opt2.click(); await sleep(400); }
          logFieldAction('How Did You Hear', 'Bank of America Careers Site', '(vide)', 'fill');
        } else {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
          logFieldAction('How Did You Hear', 'Bank of America Careers Site', undefined, 'not_found');
        }
      }
    }

    // ── Country ──────────────────────────────────────────────────────────────
    const countryBtn = document.querySelector('[data-automation-id="formField-country"] button[aria-haspopup]');
    if (countryBtn) {
      const currentCountry = (countryBtn.innerText || '').trim();
      const targetCountry = p.country || 'France';
      if (!currentCountry.toLowerCase().includes(targetCountry.toLowerCase())) {
        await selectListbox(countryBtn, targetCountry);
        logFieldAction('Country', targetCountry, currentCountry || '(vide)', 'fill');
      } else {
        logFieldAction('Country', targetCountry, currentCountry, 'skip');
      }
    }

    // ── Previously employed by BofA? → lu depuis le profil ──────────────────
    const prevEmployed = p.bofa_previously_employed || 'No';
    const prevWorkerInput = document.querySelector(
      `[data-automation-id="formField-candidateIsPreviousWorker"] input[value="${prevEmployed === 'Yes' ? 'true' : 'false'}"]`
    );
    if (prevWorkerInput && !prevWorkerInput.checked) {
      prevWorkerInput.click();
      log(`  ✓ Previously employed by BofA: Firebase="${prevEmployed}" → coché`);
    } else if (prevWorkerInput?.checked) {
      log(`  ✓ Previously employed by BofA: Firebase="${prevEmployed}" → déjà coché`);
    }

    // ── Phone Device Type → Mobile ────────────────────────────────────────────
    const phoneTypeBtn = document.querySelector('[data-automation-id="formField-phoneType"] button[aria-haspopup]')
      || document.querySelector('#phoneNumber--phoneType');
    if (phoneTypeBtn) {
      const currentType = (phoneTypeBtn.innerText || '').trim();
      if (!/mobile/i.test(currentType)) {
        const ok = await selectListbox(phoneTypeBtn, 'Mobile');
        logFieldAction('Phone Device Type', 'Mobile', currentType || '(vide)', ok ? 'fill' : 'not_found');
      } else {
        logFieldAction('Phone Device Type', 'Mobile', currentType, 'skip');
      }
    }

    // ── Country Phone Code → France (+33) ────────────────────────────────────
    // Vérifier d'abord si déjà sélectionné (chip ou promptOption EMEA)
    const phoneCodeField = document.querySelector('[data-automation-id="formField-countryPhoneCode"]');
    const phoneCodeAlreadySet = phoneCodeField
      && /france.*\+33|\+33.*france/i.test(phoneCodeField.innerText || '');
    if (phoneCodeAlreadySet) {
      logFieldAction('Country Phone Code', 'France (+33)', 'France (+33)', 'skip');
    } else {
      const phoneCodeBtn = document.querySelector('[data-automation-id="formField-phoneDeviceType"] button[aria-haspopup]')
        || document.querySelector('[id*="phoneNumber--"][id*="countryPhone"] button, [id*="phoneNumber--phoneCountry"] button')
        || Array.from(document.querySelectorAll('button[aria-haspopup]')).find(b =>
            /france|phone.*code|country.*phone|\(\+/i.test((b.getAttribute('aria-label') || b.innerText || ''))
          );
      if (phoneCodeBtn) {
        const currentCode = (phoneCodeBtn.innerText || '').trim();
        if (!/france.*\+33|\+33.*france/i.test(currentCode)) {
          const ok = await selectListbox(phoneCodeBtn, 'France (+33)', 4000);
          logFieldAction('Country Phone Code', 'France (+33)', currentCode || '(vide)', ok ? 'fill' : 'not_found');
        } else {
          logFieldAction('Country Phone Code', 'France (+33)', currentCode, 'skip');
        }
      } else {
        // Fallback multiselect (même approche que How Did You Hear)
        const cpcContainer = phoneCodeField && phoneCodeField.querySelector('[data-automation-id="multiselectInputContainer"]');
        if (cpcContainer) {
          cpcContainer.click(); await sleep(600);
          const opt = Array.from(document.querySelectorAll('[role="option"],[data-automation-id="promptOption"]'))
            .find(el => el.offsetWidth > 0 && /france.*\+33/i.test(el.textContent || ''));
          if (opt) { opt.click(); await sleep(400); logFieldAction('Country Phone Code', 'France (+33)', '(vide)', 'fill'); }
          else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
        }
      }
    }

    // ── Phone Number ──────────────────────────────────────────────────────────
    const phoneVal = (p['phone-number'] || p.phone_number || p.phone || '').replace(/\s/g, '');
    if (phoneVal) {
      // L'input téléphone peut être dans formField-phoneNumber OU directement via id
      const phoneInput = document.querySelector('[data-automation-id="formField-phoneNumber"] input:not([type="hidden"])')
        || document.querySelector('#phoneNumber--phoneNumber')
        || document.querySelector('input[name="phoneNumber"]');
      if (phoneInput) {
        const currentPhone = (phoneInput.value || '').trim();
        if (currentPhone && currentPhone.replace(/\s/g, '') === phoneVal) {
          logFieldAction('Phone Number', p.phone, currentPhone, 'skip');
        } else {
          reactSet(phoneInput, p.phone);
          phoneInput.blur();
          logFieldAction('Phone Number', p.phone, currentPhone || '(vide)', 'fill');
        }
      } else {
        logFieldAction('Phone Number', p.phone, undefined, 'not_found');
      }
    } else {
      logFieldAction('Phone Number', p.phone, undefined, 'missing_firebase');
    }

    log('✅ My Information complétée');
  }

  // ─── STEP 2 : My Experience ─────────────────────────────────────────────────
  async function fillMyExperience(p) {
    log('📝 Step 2 — My Experience');
    setBanner('📝 My Experience en cours...');
    // Education volontairement ignorée sur BofA (section laissée à remplir manuellement)
    await fillLanguages(p);
    await uploadCV(p);
    log('✅ My Experience complétée');
  }

  // ── 2a. Education ───────────────────────────────────────────────────────────
  async function fillEducation(p) {
    const school   = (p.establishment || p.institution_name || '').trim();
    const diplYear = String(p.diploma_year || p.graduation_year || '').trim();
    const eduLevel = (p.education_level || '').toLowerCase();

    if (!school && !diplYear) { log('  ℹ️ Education: aucune donnée Firebase → section ignorée'); return; }

    const existingSchool = document.querySelector('[data-automation-id="formField-school"] input');
    if (existingSchool?.value?.trim()) {
      logFieldAction('School', school, existingSchool.value.trim(), 'skip');
      if (diplYear) await fillField('formField-lastYearAttended', diplYear, 'diploma_year');
      return;
    }

    // Cliquer Add Education (2ème bouton "Add" visible)
    const addBtns = Array.from(document.querySelectorAll('button')).filter(b =>
      /^add$/i.test((b.innerText || '').trim()) && b.offsetWidth > 0
    );
    const eduAddBtn = addBtns[1];
    if (!eduAddBtn) { log('  ⚠️ Education: bouton Add introuvable'); return; }
    await clickEl(eduAddBtn);
    await sleep(1000);

    const schoolInput = document.querySelector('[data-automation-id="formField-school"] input')
      || document.querySelector('input[id*="--school"]');
    if (!schoolInput) { log('  ⚠️ Education: champ School introuvable'); return; }

    log(`  ⌨️ School: frappe "${school}"...`);
    await simulateTyping(schoolInput, school);
    await sleep(1500);

    const noItems = Array.from(document.querySelectorAll('*')).find(el =>
      el.offsetWidth > 0 && /^no items/i.test((el.innerText || '').trim())
    );
    const opt = !noItems && Array.from(document.querySelectorAll(
      '[role="option"], [data-automation-id="promptOption"], [data-automation-id="menuItem"], [data-automation-id="promptLeafNode"]'
    )).find(el => el.offsetWidth > 0 && (el.innerText || el.textContent || '').toLowerCase().includes(school.toLowerCase()));

    if (opt) {
      opt.click(); await sleep(300);
      ['keydown', 'keyup'].forEach(t => schoolInput.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', keyCode: 13, bubbles: true })));
      log(`  ✓ School: "${school}" → suggestion sélectionnée`);
    } else {
      if (noItems) log(`  ℹ️ School: "${school}" absent de Workday → texte libre`);
      ['keydown', 'keyup'].forEach(t => schoolInput.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', keyCode: 13, bubbles: true })));
      await sleep(200);
      ['keydown', 'keyup'].forEach(t => schoolInput.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', keyCode: 13, bubbles: true })));
      schoolInput.blur();
      log(`  ✓ School: "${school}" → texte libre confirmé`);
    }
    await sleep(400);

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
      log(`  ${ok ? '✓' : '⚠️'} Degree: "${eduLevel}" → ${degreeLabel}${ok ? '' : ' (introuvable)'}`);
    }
    if (diplYear) await fillField('formField-lastYearAttended', diplYear, 'diploma_year');
  }

  // ── 2b. Languages ───────────────────────────────────────────────────────────

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
    return LANG_NAME_MAP[(raw || '').toLowerCase().trim()] || raw;
  }

  function getWSLevel(level) {
    const l = (level || '').toLowerCase();
    if (['native', 'bilingual', 'fluent', 'courant', 'maternelle', 'bilingue'].some(k => l.includes(k))) return 'Fluent';
    if (['intermediate', 'intermédiaire', 'conversational', 'professional', 'working'].some(k => l.includes(k))) return 'Intermediate';
    return 'Basic';
  }

  // Trouver le bouton Add/Add Another de la section Languages par PROXIMITÉ
  // ⚠️ Ne jamais utiliser data-automation-id="add-button" en premier :
  //    plusieurs boutons identiques existent (Education, Languages…) et le
  //    premier dans le DOM est souvent celui d'Education → mauvaise section.
  function _findLangAddBtn(textPattern) {
    // 1. Proximité : remonter depuis le dernier input[name="native"]
    //    (c'est l'ancre la plus fiable vers la section Languages)
    const nativeInputs = Array.from(document.querySelectorAll('input[name="native"]'));
    if (nativeInputs.length > 0) {
      const lastNative = nativeInputs[nativeInputs.length - 1];
      let el = lastNative.parentElement;
      for (let depth = 0; depth < 14 && el; depth++) {
        const btn = Array.from(el.querySelectorAll('button')).find(b =>
          b.offsetWidth > 0 && textPattern.test((b.innerText || '').trim())
        );
        if (btn) return btn;
        el = el.parentElement;
      }
    }

    // 2. Heading "Languages" → chercher dans la section
    const langHeading = Array.from(document.querySelectorAll('h3,h4,legend,[role="heading"]')).find(el =>
      /^languages?$/i.test((el.textContent || '').trim()) && el.offsetWidth > 0
    );
    if (langHeading) {
      let el = langHeading.parentElement;
      for (let depth = 0; depth < 8 && el; depth++) {
        const btn = Array.from(el.querySelectorAll('button')).find(b =>
          b.offsetWidth > 0 && textPattern.test((b.innerText || '').trim())
        );
        if (btn) return btn;
        el = el.parentElement;
      }
    }

    // 3. Dernier bouton correspondant sur la page (Languages est la dernière section)
    const all = Array.from(document.querySelectorAll('button')).filter(b =>
      b.offsetWidth > 0 && textPattern.test((b.innerText || '').trim())
    );
    return all[all.length - 1] || null;
  }

  function findLanguageAddBtn()        { return _findLangAddBtn(/^add$/i); }
  function findLanguageAddAnotherBtn() { return _findLangAddBtn(/add another/i); }

  // Lit l'état de chaque ligne de langue dans le DOM
  // Retourne [{langBtn, wsBtn, nativeInput, langName, wsLevel, isEmpty}]
  function getLangRows() {
    return Array.from(document.querySelectorAll('input[name="native"]')).map(ni => {
      let container = ni.parentElement;
      for (let d = 0; d < 15 && container; d++) {
        const btns = Array.from(container.querySelectorAll('button[aria-haspopup]'));
        const langBtn = btns.find(b => /^language/i.test(b.getAttribute('aria-label') || ''));
        const wsBtn   = btns.find(b => /^written.*spoken/i.test(b.getAttribute('aria-label') || ''));
        if (langBtn) {
          return {
            langBtn,
            wsBtn,
            nativeInput: ni,
            langName: (langBtn.innerText || '').trim(),
            wsLevel:  wsBtn ? (wsBtn.innerText || '').trim() : '',
            isEmpty:  /select one/i.test(langBtn.innerText || '')
          };
        }
        container = container.parentElement;
      }
      return null;
    }).filter(Boolean);
  }

  async function fillLanguages(p) {
    const langs = Array.isArray(p.languages) ? p.languages.filter(l => l.name || l.language) : [];
    if (!langs.length) { log('  ℹ️ Langues: aucune dans Firebase'); return; }

    log(`  🌐 Langues Firebase: ${langs.map(l => normalizeLanguageName(l.name || l.language)).join(', ')}`);

    for (let i = 0; i < langs.length; i++) {
      const lang     = langs[i];
      const langName = normalizeLanguageName(lang.name || lang.language || '');
      const level    = lang.level || lang.proficiency || '';
      const isFluent = getWSLevel(level) === 'Fluent';
      const wsLevel  = getWSLevel(level);

      if (!langName) { log(`  ⚠️ Langue ${i + 1}: nom vide dans Firebase`); continue; }
      log(`  ℹ️ Langue ${i + 1}/${langs.length} "${langName}" (${wsLevel}${isFluent ? ', fluent' : ''})`);

      // ── 1. Chercher ligne existante avec ce nom de langue ────────────────────
      let rows = getLangRows();
      let row  = rows.find(r => r.langName.toLowerCase() === langName.toLowerCase());

      if (!row) {
        // ── 2. Chercher une ligne vide ─────────────────────────────────────────
        row = rows.find(r => r.isEmpty);
      }

      if (!row) {
        // ── 3. Ajouter une nouvelle ligne ──────────────────────────────────────
        const addBtn = rows.length === 0 ? findLanguageAddBtn() : findLanguageAddAnotherBtn();
        if (!addBtn) {
          log(`  ⚠️ Bouton Add/Add Another introuvable pour langue ${i + 1}`);
          break;
        }
        await clickEl(addBtn);
        await sleep(1000);
        log(`  + ${rows.length === 0 ? 'Add' : 'Add Another'} (langue ${i + 1})`);
        rows = getLangRows();
        row  = rows.find(r => r.isEmpty);
        if (!row) { log(`  ⚠️ Ligne vide non trouvée après Add`); continue; }
      }

      // ── 4. Sélectionner la langue si besoin ──────────────────────────────────
      if (row.langName.toLowerCase() !== langName.toLowerCase()) {
        const ok = await selectBestOption(row.langBtn, [langName]);
        if (!ok) { log(`  ⚠️ Langue ${i + 1}: "${langName}" introuvable dans Workday`); continue; }
        log(`  ✓ Langue ${i + 1}: Firebase="${langName}" → sélectionné`);
        await sleep(400);
        // Relire après sélection (les refs DOM peuvent changer)
        rows = getLangRows();
        row  = rows.find(r => r.langName.toLowerCase() === langName.toLowerCase());
        if (!row) { log(`  ⚠️ Ligne "${langName}" introuvable après sélection`); continue; }
      } else {
        log(`  ✓ Langue ${i + 1}: "${langName}" déjà présente`);
      }

      // ── 5. Native / Fluent checkbox ──────────────────────────────────────────
      const nativeChk = row.nativeInput;
      if (nativeChk) {
        if (isFluent && !nativeChk.checked)  { nativeChk.click(); log(`  ✓ Fluent: coché (level="${level}")`); }
        else if (!isFluent && nativeChk.checked) { nativeChk.click(); log(`  ✓ Fluent: décoché (level="${level}")`); }
        else log(`  ✓ Fluent: ${nativeChk.checked ? 'déjà coché' : 'déjà décoché'} (level="${level}")`);
        await sleep(200);
      }

      // ── 6. Written and Spoken ────────────────────────────────────────────────
      if (row.wsBtn) {
        const currentWs = (row.wsBtn.innerText || '').trim();
        if (currentWs.toLowerCase() === wsLevel.toLowerCase()) {
          log(`  ✓ Written & Spoken: "${wsLevel}" déjà correct`);
        } else {
          const wsOk = await selectBestOption(row.wsBtn, [wsLevel]);
          log(`  ${wsOk ? '✓' : '⚠️'} Written & Spoken: "${currentWs}" → ${wsLevel}${wsOk ? '' : ' (introuvable)'}`);
        }
      }

      await sleep(300);
    }
  }

  // ── 2c. CV Upload ────────────────────────────────────────────────────────────

  // Supprime le CV actuellement affiché dans la section Resume/CV de BofA Workday.
  // Sélecteur direct : [data-automation-id="delete-file"] avec aria-label contenant le nom.
  async function deleteExistingCV() {
    // 1. Sélecteur direct BofA : data-automation-id="delete-file"
    const directBtn = document.querySelector('[data-automation-id="delete-file"]');
    if (directBtn && directBtn.offsetWidth > 0) {
      log(`  🗑️ CV existant détecté → suppression (delete-file)...`);
      await clickEl(directBtn);
      // Attendre que le file-upload-item disparaisse
      let w = 0;
      while (w < 3000 && document.querySelector('[data-automation-id="file-upload-item"]')) {
        await sleep(200); w += 200;
      }
      log(`  ✓ CV existant supprimé`);
      return true;
    }
    // 2. Fallback : cherche un bouton delete/remove proche d'une zone upload
    const fallbackBtn = Array.from(document.querySelectorAll('button, [role="button"]')).find(b => {
      if (!b.offsetWidth) return false;
      const label = (b.getAttribute('aria-label') || b.innerText || b.title || '').toLowerCase();
      return /delete|remove|clear|supprimer/i.test(label) && (
        b.closest('[data-automation-id*="upload"]') || b.closest('[data-automation-id*="file"]') ||
        b.closest('[class*="resume"]') || b.closest('[class*="file"]')
      );
    });
    if (fallbackBtn) {
      log(`  🗑️ CV existant détecté → suppression (fallback)...`);
      await clickEl(fallbackBtn);
      await sleep(800);
      log(`  ✓ CV existant supprimé`);
      return true;
    }
    return false;
  }

  async function uploadCV(p) {
    const storagePath = p.cv_storage_path || '';
    const filename    = p.cv_filename || (storagePath ? storagePath.split('/').pop() : 'cv.pdf');
    const cvBase      = (filename || '').replace(/\.pdf$/i, '').toLowerCase();

    // ── Vérifier si le bon CV est déjà affiché (évite delete+reupload inutile) ──
    // BofA affiche le fichier dans [data-automation-id="file-upload-item-name"]
    const uploadedName = (document.querySelector('[data-automation-id="file-upload-item-name"]') || {}).textContent || '';
    const alreadyUploaded = cvBase && uploadedName.toLowerCase().includes(cvBase);
    const uploadSuccess   = !!document.querySelector('[data-automation-id="file-upload-successful"]');
    if (alreadyUploaded && uploadSuccess) {
      logFieldAction('CV', filename, uploadedName.trim(), 'skip');
      return;
    }

    // Supprimer le CV existant si présent
    await deleteExistingCV();

    // Récupérer le file input (toujours présent dans la drop zone après suppression)
    const fileInput = document.querySelector('input[type="file"]');
    if (!fileInput) { log('  ⚠️ CV: input[type="file"] introuvable'); return; }

    if (!storagePath) {
      log('  ⚠️ CV: cv_storage_path absent dans Firebase — upload manuel requis');
      setBanner('⏸️ ÉTAPE MANUELLE : Uploadez votre CV, reprise automatique...', '#c47900');
      let waited = 0;
      while (waited < 180000 && !document.querySelector('[data-automation-id="file-upload-successful"]')) {
        await sleep(1000); waited += 1000;
      }
      log('  ✓ CV uploadé manuellement');
      setBanner('📝 My Experience en cours...');
      return;
    }

    log(`  ⏳ CV: téléchargement "${filename}" depuis Firebase Storage...`);
    const ok = await setFileFromStorage(fileInput, storagePath, filename);
    if (!ok) {
      log('  ⚠️ CV: échec upload Firebase — upload manuel requis');
      setBanner('⏸️ Uploadez votre CV manuellement', '#c47900');
      let waited = 0;
      while (waited < 180000 && !document.querySelector('[data-automation-id="file-upload-successful"]')) {
        await sleep(1000); waited += 1000;
      }
      setBanner('📝 My Experience en cours...');
      return;
    }

    // ── Attendre la confirmation Workday ──────────────────────────────────────
    // BofA affiche [data-automation-id="file-upload-successful"] quand le fichier
    // est accepté côté serveur. Attendre jusqu'à 8 secondes.
    let waited = 0;
    while (waited < 8000 && !document.querySelector('[data-automation-id="file-upload-successful"]')) {
      await sleep(400); waited += 400;
    }

    const successEl     = document.querySelector('[data-automation-id="file-upload-successful"]');
    const uploadedAfter = (document.querySelector('[data-automation-id="file-upload-item-name"]') || {}).textContent || '';

    if (successEl && uploadedAfter.toLowerCase().includes(cvBase)) {
      log(`  ✅ CV: "${filename}" confirmé uploaded par Workday`);
    } else if (successEl) {
      log(`  ✓ CV: upload confirmé (fichier affiché: "${uploadedAfter.trim()}")`);
    } else {
      log(`  ⚠️ CV: pas de confirmation Workday après ${waited}ms — vérifiez manuellement`);
      setBanner('⚠️ Vérifiez le CV manuellement sur cette page', '#e65100');
    }
  }

  // ─── STEP 3 : Application Questions ─────────────────────────────────────────
  function fmtDate(iso) {
    if (!iso) return '';
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[2]}/${m[3]}/${m[1]}` : String(iso);
  }

  // Remplit un widget date Workday (segments Month/Day/Year) via key events
  async function fillWorkdayDateSegments(container, dateStr) {
    const m = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return false;
    const [, year, month, day] = m;

    const fillSegment = async (automationId, value) => {
      const el = container.querySelector(`[data-automation-id="${automationId}"]:not([aria-hidden])`);
      if (!el) return;
      el.scrollIntoView({ block: 'center' });
      el.focus(); el.click();
      await sleep(200);
      const digits = String(parseInt(value, 10)); // supprime les zéros de tête (Workday les gère)
      for (const ch of digits) {
        el.dispatchEvent(new KeyboardEvent('keydown',  { key: ch, keyCode: ch.charCodeAt(0), bubbles: true, cancelable: true }));
        el.dispatchEvent(new KeyboardEvent('keypress', { key: ch, keyCode: ch.charCodeAt(0), bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup',    { key: ch, keyCode: ch.charCodeAt(0), bubbles: true }));
        await sleep(80);
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(150);
    };

    await fillSegment('dateSectionMonth', month);
    await fillSegment('dateSectionDay',   day);
    await fillSegment('dateSectionYear',  year);
    return true;
  }

  function dropdownIsFilled(btn) {
    const txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
    return txt !== '' && txt !== 'select one' && txt !== 'select';
  }

  async function getDropdownOptions(btn, timeout = 2000) {
    btn.click(); await sleep(500);
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

  async function selectBestOption(btn, preferences) {
    // Ouvre le dropdown une seule fois et clique directement sur l'option sans fermer/rouvrir
    btn.click();
    await sleep(500);
    const deadline = Date.now() + 2000;
    let optEls = [];
    while (Date.now() < deadline) {
      optEls = Array.from(document.querySelectorAll(
        '[role="option"], [data-automation-id="promptOption"], [data-automation-id="menuItem"]'
      )).filter(el => el.offsetWidth > 0);
      if (optEls.length > 0) break;
      await sleep(200);
    }
    if (!optEls.length) {
      btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
      return null;
    }
    for (const pref of preferences) {
      const match = optEls.find(el => (el.innerText || el.textContent || '').trim().toLowerCase() === pref.toLowerCase())
        || optEls.find(el => (el.innerText || el.textContent || '').trim().toLowerCase().includes(pref.toLowerCase()));
      if (match) {
        const text = (match.innerText || match.textContent || '').trim();
        match.click();
        await sleep(300);
        return text;
      }
    }
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    return null;
  }

  // Convertit le préavis Firebase (ex. "1_month", "3_months") vers les tranches BofA
  function noticePeriodToBofa(val) {
    const v = (val || '').toLowerCase();
    if (!v || v === 'none') return ['Up to 4 weeks'];
    if (v === '1_month' || v === '4_weeks') return ['Up to 4 weeks'];
    if (v === '2_months') return ['5 to 8 weeks'];
    if (v === '3_months') return ['9 to 12 weeks'];
    if (v === 'more_than_3_months') return ['12 weeks+'];
    // Cas numérique en semaines
    const weeks = parseInt(v);
    if (!isNaN(weeks)) {
      if (weeks <= 4)  return ['Up to 4 weeks'];
      if (weeks <= 8)  return ['5 to 8 weeks'];
      if (weeks <= 12) return ['9 to 12 weeks'];
      return ['12 weeks+'];
    }
    return ['Up to 4 weeks'];
  }

  // Déduire le droit au travail depuis jp_morgan_work_authorizations
  function deriveRightToWork(p) {
    const auths = Array.isArray(p.jp_morgan_work_authorizations) ? p.jp_morgan_work_authorizations : [];
    const hasEU = auths.some(a => (a.country || '').toLowerCase().includes('union') || (a.country || '').toLowerCase().includes('france'));
    return hasEU || auths.length > 0 ? 'Yes' : null;
  }

  // Extraire le texte de la question depuis un formField-* wrapper
  // BofA EMEA Step 3 : texte dans <legend> > [data-automation-id="richText"]
  // BofA US Step 1/2  : texte dans <label>
  function getFieldLabel(field) {
    // 1. legend > richText (BofA EMEA questionnaire)
    const richText = field.querySelector('legend [data-automation-id="richText"]');
    if (richText) return richText.textContent.replace(/\*/g, '').trim();
    // 2. label classique
    const lbl = field.querySelector('label');
    if (lbl) return lbl.textContent.replace(/\*/g, '').trim();
    // 3. innerText du fieldset/legend directement
    const legend = field.querySelector('legend');
    if (legend) return legend.textContent.replace(/\*/g, '').trim();
    return '';
  }

  // Extraire le texte de la question depuis un élément interactif (hors formField)
  function getQuestionText(el) {
    // 1. formField-* parent → utiliser getFieldLabel
    const parentField = el.closest('[data-automation-id^="formField-"]');
    if (parentField) return getFieldLabel(parentField);
    // 2. Remonter jusqu'à trouver legend richText ou label
    let node = el.parentElement;
    for (let depth = 0; depth < 12 && node; depth++) {
      const richText = node.querySelector('legend [data-automation-id="richText"]');
      if (richText && richText.offsetWidth > 0) return richText.textContent.replace(/\*/g, '').trim();
      const lbl = node.querySelector('label');
      if (lbl && lbl.offsetWidth > 0) return lbl.textContent.replace(/\*/g, '').trim();
      // Frères précédents avec texte substantiel
      let sib = el.previousElementSibling;
      while (sib) {
        const sibText = (sib.innerText || sib.textContent || '').replace(/\*/g, '').trim();
        if (sibText.length > 10 && !sib.querySelector('button, input, select')) return sibText;
        sib = sib.previousElementSibling;
      }
      node = node.parentElement;
    }
    return (el.getAttribute('aria-label') || '').replace(/required/i, '').trim();
  }

  async function fillApplicationQuestions(p) {
    log('📝 Step 3 — Application Questions');
    setBanner('📝 Application Questions...');
    await sleep(800);

    let answered = 0;

    // ─── Log du contexte Firebase ─────────────────────────────────────────────
    log(`  Firebase: employer="${p.current_employer || '—'}" | salary="${p.current_salary || '—'} ${p.current_salary_currency || ''}" | notice="${p.sg_notice_period || '—'}" | relatives="${p.bofa_has_relatives || 'No'}" | referred="${p.bofa_referred || 'No'}" | pwc="${p.bofa_worked_at_pwc || 'No'}" | finra="${p.bofa_finra_license || '—'}"`);

    // Scan ALL visible question containers (formField-* ET autres wrappers BofA Step 3)
    // On cible directement les éléments interactifs visibles plutôt que leurs wrappers
    const seen = new Set();

    // Collecter les wrappers formField-* (Step 1/2 compatible)
    const formFields = Array.from(document.querySelectorAll('[data-automation-id^="formField-"]'))
      .filter(f => f.offsetParent !== null);

    for (const field of formFields) {
      const labelText = getFieldLabel(field);
      const lower     = labelText.toLowerCase();

      // ── Radio Yes/No ───────────────────────────────────────────────────────
      const radioNo  = field.querySelector('input[type="radio"][value="false"]:not(:checked), input[type="radio"][value="No"]:not(:checked)');
      const radioYes = field.querySelector('input[type="radio"][value="true"]:not(:checked), input[type="radio"][value="Yes"]:not(:checked)');
      if (radioNo || radioYes) {
        const wantsYes = /right.to.work|authorized|eligible/i.test(lower);
        const target   = wantsYes ? radioYes : radioNo;
        if (target && !target.checked) {
          target.click();
          log(`  ✓ "${labelText.slice(0, 60)}" → ${wantsYes ? 'Yes' : 'No'} (radio)`);
          answered++;
        }
        continue;
      }

      // ── Textarea ─────────────────────────────────────────────────────────────
      const textarea = field.querySelector('textarea');
      if (textarea) {
        if (textarea.value.trim()) continue; // déjà rempli
        let val = '';
        // Champs principaux (non-conditionnels)
        if (/most recent.*employer|current.*employer|confirm.*employer/i.test(lower)) {
          val = p.current_employer || '';
        } else if (/base.salary|current.*salary/i.test(lower)) {
          const amt = p.current_salary || '';
          const cur = p.current_salary_currency || '';
          val = amt ? (cur ? `${amt} ${cur}` : String(amt)) : '';
        } else if (/minimum.*salary|salary requirement/i.test(lower)) {
          const amt = p.salary_expectations || p.min_salary || '';
          const cur = p.current_salary_currency || p.salary_currency || '';
          val = amt ? (cur ? `${amt} ${cur}` : String(amt)) : '';
        } else if (/incentive|bonus/i.test(lower)) {
          val = p.current_bonus ? String(p.current_bonus) : '';
        // Champs conditionnels
        } else if (/relatives|close personal relationship/i.test(lower)) {
          val = p.bofa_relatives_details || '';
        } else if (/referrer|name.*refer/i.test(lower)) {
          val = p.bofa_referrer_name || '';
        } else if (/other business|details.*business/i.test(lower)) {
          val = p.bofa_other_business_details || '';
        } else if (/medical.*assistance|adjustments|disability.*details/i.test(lower)) {
          val = p.bofa_medical_details || '';
        } else if (/additional.*details|disclose.*details/i.test(lower)) {
          val = p.bofa_additional_info_details || '';
        }
        if (val) {
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
          if (setter) setter.call(textarea, val); else textarea.value = val;
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          textarea.dispatchEvent(new Event('change', { bubbles: true }));
          logFieldAction(labelText.slice(0, 50), val, '(vide)', 'fill');
          answered++;
        }
        continue;
      }

      // ── Widget date Workday (dateSectionMonth/Day/Year) ──────────────────────
      if (field.querySelector('[data-automation-id="dateSectionMonth-display"]')) {
        // Vérifier si déjà rempli (année à 4 chiffres visible)
        const yearDisplay = field.querySelector('[data-automation-id="dateSectionYear-display"]');
        const yearVal = (yearDisplay?.textContent || '').trim();
        if (/^\d{4}$/.test(yearVal)) { continue; } // déjà rempli
        let dateStr = '';
        if (/start.date.*employer/i.test(lower)) dateStr = p.employment_start_date || '';
        else if (/start.date.*role/i.test(lower)) dateStr = p.current_role_start_date || p.employment_start_date || '';
        if (dateStr) {
          const ok = await fillWorkdayDateSegments(field, dateStr);
          if (ok) { logFieldAction(labelText.slice(0, 50), dateStr, '(vide)', 'fill'); answered++; }
          else logFieldAction(labelText.slice(0, 50), dateStr, undefined, 'not_found');
        } else {
          logFieldAction(labelText.slice(0, 50), undefined, undefined, 'missing_firebase');
        }
        continue;
      }

      // ── Dropdown ────────────────────────────────────────────────────────────
      const dropBtn = field.querySelector('button[aria-haspopup="listbox"], button[aria-haspopup="true"]');
      if (dropBtn && !dropdownIsFilled(dropBtn)) {
        let chosen = null;

        if (/right.to.work|authorized.to.work|eligible.to.work/i.test(lower)) {
          // Réponse Yes si on a des autorisations dans Firebase
          const rightToWork = p.bofa_right_to_work || (p.jp_morgan_work_authorizations?.length > 0 ? 'Yes' : 'Yes');
          chosen = await selectBestOption(dropBtn, [rightToWork || 'Yes']);
        } else if (/which option.*right.to.work|please select.*right.*work/i.test(lower)) {
          // Type de droit au travail (dropdown de suivi)
          const rwType = p.bofa_right_to_work_type || 'Citizenship';
          chosen = await selectBestOption(dropBtn, [rwType]);
        } else if (/relatives|close personal relationship/i.test(lower)) {
          const val = p.bofa_has_relatives || 'No';
          chosen = await selectBestOption(dropBtn, [val]);
        } else if (/referred.*bank|bank.*referred|refer.*employment/i.test(lower)) {
          const ref = p.bofa_referred || 'No';
          if (ref === 'Yes_employee') chosen = await selectBestOption(dropBtn, ['Yes, by a Bank of America employee', 'Yes']);
          else if (ref === 'Yes_client') chosen = await selectBestOption(dropBtn, ['Yes, by a Bank of America client/customer', 'Yes, by a Bank of America client', 'Yes, by a client', 'Yes']);
          else chosen = await selectBestOption(dropBtn, ['No']);
        } else if (/pricewaterhouse|pwc/i.test(lower)) {
          chosen = await selectBestOption(dropBtn, [p.bofa_worked_at_pwc || 'No']);
        } else if (/finra.*license/i.test(lower)) {
          const finra = p.bofa_finra_license || 'I do not hold a FINRA license';
          chosen = await selectBestOption(dropBtn, [finra]);
        } else if (/vendor.worker/i.test(lower)) {
          chosen = await selectBestOption(dropBtn, [p.bofa_is_vendor_worker || 'No']);
        } else if (/previously applied/i.test(lower)) {
          chosen = await selectBestOption(dropBtn, [p.bofa_previously_applied || 'No']);
        } else if (/notice.period/i.test(lower)) {
          const prefs = noticePeriodToBofa(p.sg_notice_period || p.notice_period_weeks || '');
          log(`  ℹ️ Notice period Firebase="${p.sg_notice_period}" → BofA preferences: ${prefs.join(' | ')}`);
          chosen = await selectBestOption(dropBtn, prefs);
        } else if (/other business.*proprietor|engaged.*other business/i.test(lower)) {
          chosen = await selectBestOption(dropBtn, [p.bofa_other_business || 'No']);
        } else if (/medical condition|special.*educational|disability.*adjust/i.test(lower)) {
          chosen = await selectBestOption(dropBtn, [p.bofa_medical_condition || 'No']);
        } else if (/additional information.*disclose|additional info/i.test(lower)) {
          chosen = await selectBestOption(dropBtn, [p.bofa_additional_info || 'No']);
        } else if (/armed forces/i.test(lower)) {
          // jp_morgan_military_service : "No" ou valeur "Yes..."
          const military = p.jp_morgan_military_service || 'No';
          const wantsYes = /^yes/i.test(military);
          chosen = await selectBestOption(dropBtn, wantsYes ? ['Yes'] : ['No']);
        }

        if (chosen) {
          log(`  ✓ "${labelText.slice(0, 60)}" → ${chosen}`);
          answered++;
          // Après avoir répondu "Yes" à certaines questions → textarea suivant visible
          await sleep(300);
        } else if (chosen === null) {
          // Question non reconnue → essayer "No" par défaut si disponible
          const opts = await getDropdownOptions(dropBtn);
          dropBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
          await sleep(200);
          const noOpt = opts.find(o => /^no$/i.test(o.trim()));
          if (noOpt) {
            const ok = await selectListbox(dropBtn, noOpt);
            if (ok) { log(`  ✓ "${labelText.slice(0, 60)}" → No (défaut)`); answered++; }
          } else if (opts.length) {
            log(`  ⚠️ "${labelText.slice(0, 60)}" — options disponibles: ${opts.slice(0, 5).join(' | ')}`);
          }
        }
        continue;
      }

      // ── Champs texte / date ──────────────────────────────────────────────────
      const inp = field.querySelector(
        'input[type="text"], input[type="date"], input:not([type="radio"]):not([type="checkbox"]):not([type="hidden"]):not([type="file"]):not([type="search"])'
      );
      if (inp && !inp.value?.trim()) {
        let val = '';
        const fbLabel = labelText.slice(0, 50);
        if (/most recent.*employer|current.*employer|confirm.*employer/i.test(lower)) {
          val = p.current_employer || '';
          logFieldAction(fbLabel, val || '(absent Firebase)', inp.value || '(vide)', val ? 'fill' : 'missing_firebase');
        } else if (/start.date.*employer/i.test(lower)) {
          val = fmtDate(p.employment_start_date || '');
          logFieldAction(fbLabel, p.employment_start_date || '(absent)', inp.value || '(vide)', val ? 'fill' : 'missing_firebase');
        } else if (/start.date.*role/i.test(lower)) {
          val = fmtDate(p.current_role_start_date || p.employment_start_date || '');
          logFieldAction(fbLabel, p.current_role_start_date || p.employment_start_date || '(absent)', inp.value || '(vide)', val ? 'fill' : 'missing_firebase');
        } else if (/base.salary|current.*salary/i.test(lower)) {
          const amt = p.current_salary || '';
          const cur = p.current_salary_currency || '';
          val = amt ? (cur ? `${amt} ${cur}` : String(amt)) : '';
          logFieldAction(fbLabel, val || '(absent)', inp.value || '(vide)', val ? 'fill' : 'missing_firebase');
        } else if (/minimum.*salary|salary requirement/i.test(lower)) {
          const amt = p.salary_expectations || p.min_salary || '';
          const cur = p.current_salary_currency || p.salary_currency || '';
          val = amt ? (cur ? `${amt} ${cur}` : String(amt)) : '';
          logFieldAction(fbLabel, val || '(absent)', inp.value || '(vide)', val ? 'fill' : 'missing_firebase');
        } else if (/incentive|bonus/i.test(lower)) {
          val = String(p.current_bonus || '0');
          logFieldAction(fbLabel, val, inp.value || '(vide)', 'fill');
        }

        if (val) {
          reactSet(inp, val);
          answered++;
        }
      }
    }

    // ── Passage 2 : dropdowns BofA Step 3 hors formField-* ────────────────────
    // Ces dropdowns ont id="primaryQuestionnaire--..." et sont dans des wrappers
    // sans data-automation-id="formField-*". On les scanne directement.
    const allDropBtns = Array.from(document.querySelectorAll(
      'button[aria-haspopup="listbox"], button[aria-haspopup="true"]'
    )).filter(b => {
      if (!b.offsetParent || seen.has(b)) return false;
      // Exclure ceux déjà traités dans les formField-*
      if (b.closest('[data-automation-id^="formField-"]')) { seen.add(b); return false; }
      return true;
    });

    for (const dropBtn of allDropBtns) {
      if (dropdownIsFilled(dropBtn)) { seen.add(dropBtn); continue; }
      seen.add(dropBtn);

      const labelText = getQuestionText(dropBtn);
      const lower     = labelText.toLowerCase();
      log(`  🔍 Question détectée: "${labelText.slice(0, 70)}"`);

      let chosen = null;
      if (/right.to.work|authorized.to.work|eligible.to.work/i.test(lower)) {
        chosen = await selectBestOption(dropBtn, ['Yes']);
      } else if (/which option.*right.to.work|please select.*right.*work/i.test(lower)) {
        chosen = await selectBestOption(dropBtn, [p.bofa_right_to_work_type || 'Citizenship']);
      } else if (/relatives|close personal relationship/i.test(lower)) {
        chosen = await selectBestOption(dropBtn, [p.bofa_has_relatives || 'No']);
      } else if (/referred.*bank|bank.*referred|refer.*employment/i.test(lower)) {
        const ref = p.bofa_referred || 'No';
        if (ref === 'Yes_employee') chosen = await selectBestOption(dropBtn, ['Yes, by a Bank of America employee', 'Yes']);
        else if (ref === 'Yes_client') chosen = await selectBestOption(dropBtn, ['Yes, by a Bank of America client', 'Yes, by a client', 'Yes']);
        else chosen = await selectBestOption(dropBtn, ['No']);
      } else if (/pricewaterhouse|pwc/i.test(lower)) {
        chosen = await selectBestOption(dropBtn, [p.bofa_worked_at_pwc || 'No']);
      } else if (/finra/i.test(lower)) {
        const finra = p.bofa_finra_license || 'I do not hold a FINRA license';
        chosen = await selectBestOption(dropBtn, [finra]);
      } else if (/vendor.worker|prestataire.*bank|bank.*prestataire/i.test(lower)) {
        chosen = await selectBestOption(dropBtn, [p.bofa_is_vendor_worker || 'No']);
      } else if (/previously applied/i.test(lower)) {
        chosen = await selectBestOption(dropBtn, [p.bofa_previously_applied || 'No']);
      } else if (/notice.period/i.test(lower)) {
        const prefs = noticePeriodToBofa(p.sg_notice_period || p.notice_period_weeks || '');
        log(`  ℹ️ Notice: Firebase="${p.sg_notice_period}" → ${prefs.join(' | ')}`);
        chosen = await selectBestOption(dropBtn, prefs);
      } else if (/other business.*proprietor|engaged.*other business/i.test(lower)) {
        chosen = await selectBestOption(dropBtn, [p.bofa_other_business || 'No']);
      } else if (/medical condition|special.*educational|disability.*adjust/i.test(lower)) {
        chosen = await selectBestOption(dropBtn, [p.bofa_medical_condition || 'No']);
      } else if (/additional information.*disclose|additional info/i.test(lower)) {
        chosen = await selectBestOption(dropBtn, [p.bofa_additional_info || 'No']);
      } else if (/armed forces/i.test(lower)) {
        const military = p.jp_morgan_military_service || 'No';
        chosen = await selectBestOption(dropBtn, /^yes/i.test(military) ? ['Yes'] : ['No']);
      } else {
        // Inconnu → lire les options disponibles, tenter "No" par défaut
        const opts = await getDropdownOptions(dropBtn);
        dropBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
        await sleep(200);
        const noOpt = opts.find(o => /^no$/i.test(o.trim()));
        if (noOpt) {
          const ok = await selectListbox(dropBtn, noOpt);
          if (ok) { log(`  ✓ "${labelText.slice(0, 60)}" → No (défaut) | options: ${opts.slice(0,4).join(' | ')}`); answered++; }
        } else if (opts.length) {
          log(`  ⚠️ "${labelText.slice(0, 60)}" — options: ${opts.slice(0,4).join(' | ')}`);
        }
        continue;
      }

      if (chosen) {
        log(`  ✓ "${labelText.slice(0, 60)}" → ${chosen}`);
        answered++;
        await sleep(300);
      }
    }

    // ── Passage 3 : textareas conditionnels visibles ───────────────────────────
    const allTextareas = Array.from(document.querySelectorAll('textarea'))
      .filter(t => t.offsetParent !== null && !t.value.trim() && !seen.has(t));
    for (const ta of allTextareas) {
      seen.add(ta);
      const labelText = getQuestionText(ta);
      const lower = labelText.toLowerCase();
      let val = '';
      if (/most recent.*employer|current.*employer|confirm.*employer/i.test(lower)) {
        val = p.current_employer || '';
      } else if (/base.salary|current.*salary/i.test(lower)) {
        const amt = p.current_salary || ''; const cur = p.current_salary_currency || '';
        val = amt ? (cur ? `${amt} ${cur}` : String(amt)) : '';
      } else if (/minimum.*salary|salary requirement/i.test(lower)) {
        const amt = p.salary_expectations || p.min_salary || ''; const cur = p.current_salary_currency || p.salary_currency || '';
        val = amt ? (cur ? `${amt} ${cur}` : String(amt)) : '';
      } else if (/incentive|bonus/i.test(lower)) {
        val = p.current_bonus ? String(p.current_bonus) : '';
      } else if (/relatives|close personal.*relation|name.*describe.*relation/i.test(lower)) {
        val = p.bofa_relatives_details || '';
      } else if (/referrer|name.*refer/i.test(lower)) {
        val = p.bofa_referrer_name || '';
      } else if (/other business|details.*business/i.test(lower)) {
        val = p.bofa_other_business_details || '';
      } else if (/medical.*assistance|adjustments|disability.*details/i.test(lower)) {
        val = p.bofa_medical_details || '';
      } else if (/additional.*details|disclose.*details/i.test(lower)) {
        val = p.bofa_additional_info_details || '';
      }
      if (val) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        if (setter) setter.call(ta, val); else ta.value = val;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        log(`  ✓ Textarea "${labelText.slice(0,50)}" → renseigné`);
        answered++;
      }
    }

    if (!answered) log('  ℹ️ Aucune question remplie (déjà renseignées ou non standard)');
    else log(`  ✓ ${answered} question(s) répondue(s)`);
    log('✅ Application Questions');
  }

  // ─── STEP 4 : Voluntary Disclosures ──────────────────────────────────────────
  async function fillVoluntaryDisclosures(p) {
    log('📝 Step 4 — Voluntary Disclosures (optionnel, laissé vide)');
    setBanner('📝 Voluntary Disclosures...');
  }

  // ─── STEP 5 : Self Identify ───────────────────────────────────────────────────
  async function fillSelfIdentify(p) {
    log('📝 Step 5 — Self Identify (optionnel, laissé vide)');
    setBanner('📝 Self Identify...');
    await sleep(500);
  }

  // ─── STEP 6 : Review & Submit ─────────────────────────────────────────────
  async function reviewAndSubmit(pending) {
    log('📝 Step 5 — Review');
    setBanner('📋 Vérification finale...');
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

    log('⚠️ Confirmation non détectée — vérifiez manuellement');
    setBanner('⚠️ Vérifiez si la candidature a été soumise', '#e65100');
    return false;
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

    // ── Connexion ─────────────────────────────────────────────────────────────
    const ok = await handleSignIn(p.auth_email || p.email, p.auth_password);
    if (!ok) { globalThis.__TALEOS_BOFA_FILLER_RUNNING__ = false; return; }
    await sleep(1000);

    // ── Apply Now / Continue Application ─────────────────────────────────────
    const applied = await clickApply();
    if (applied) {
      // Attendre que le formulaire se charge
      let loadW = 0;
      while (loadW < 12000 && !document.querySelector('[data-automation-id="progressBarActiveStep"]')) {
        await sleep(500); loadW += 500;
      }
    }

    // ── Boucle multi-steps ────────────────────────────────────────────────────
    const done      = new Set();
    let submitted   = false;
    let maxIter     = 14;

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
        await waitForNextStep('self_identify');
      } else if (step === 'self_identify' && !done.has(step)) {
        await fillSelfIdentify(p); done.add(step);
        await saveAndContinue();
        await waitForNextStep('review');
      } else if (step === 'review') {
        submitted = await reviewAndSubmit(pending); break;
      } else if (step === 'unknown') {
        // Sur la page offre ou transition — tenter Apply
        const tryApply = await clickApply();
        if (!tryApply) {
          const advanced = await saveAndContinue();
          if (!advanced) {
            log('❌ Impossible de progresser');
            setBanner('⚠️ Vérification manuelle requise', '#e65100');
            break;
          }
        }
        // Attendre le chargement du formulaire
        let tw = 0;
        while (tw < 6000 && currentStep() === 'unknown') { await sleep(400); tw += 400; }
      } else {
        // Étape déjà faite (retour arrière ou reload) — avancer
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
