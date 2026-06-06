/**
 * Taleos — Morgan Stanley Workday Filler
 * Portail : ms.wd5.myworkdayjobs.com  (locale fr-CA)
 * Moteur   : Workday React (identique à Bank of America, même data-automation-id)
 *
 * 6 étapes :
 *   1. Créer un compte / Ouvrir une session
 *   2. Mes renseignements   (coordonnées, téléphone, source)
 *   3. Mon expérience       (CV, formation, langues)
 *   4. Questions liées à la candidature (droit au travail, etc.)
 *   5. Divulgations volontaires
 *   6. Réviser (PAS de soumission automatique)
 */
(function () {
  'use strict';

  if (!/ms\.wd5\.myworkdayjobs\.com/i.test(location.hostname || '')) return;
  if (globalThis.__TALEOS_MS_FILLER_RUNNING__) return;
  globalThis.__TALEOS_MS_FILLER_RUNNING__ = true;

  // ─── Constantes ─────────────────────────────────────────────────────────────
  const PENDING_KEY = 'taleos_pending_morgan_stanley_workday';
  const TAB_KEY     = 'taleos_morgan_stanley_workday_tab_id';
  const BANNER_ID   = 'taleos-ms-banner';
  const LOG_PREFIX  = '[Taleos MS]';
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

  // ─── Sélectionner une option dans un listbox Workday ────────────────────────
  async function selectListbox(triggerEl, targetText, timeoutMs = 5000) {
    if (!triggerEl) return false;
    await clickEl(triggerEl);
    await sleep(400);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const opts = Array.from(document.querySelectorAll(
        '[role="option"], [data-automation-id="promptOption"], [data-automation-id="menuItem"]'
      ));
      const opt = opts.find(o => o.offsetWidth > 0 && (o.textContent || '').trim().toLowerCase().includes(targetText.toLowerCase()));
      if (opt) { await clickEl(opt); await sleep(300); return true; }
      await sleep(200);
    }
    return false;
  }

  // ─── Remplir un formField-* standard ─────────────────────────────────────────
  async function fillField(automationId, value, label) {
    if (!value) { log(`  ⏭️  ${label || automationId}: vide → ignoré`); return false; }
    const container = document.querySelector(`[data-automation-id="${automationId}"]`);
    if (!container) { log(`  ⚠️  ${label || automationId}: champ introuvable`); return false; }
    const input = container.querySelector('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea');
    if (!input) { log(`  ⚠️  ${label || automationId}: input introuvable`); return false; }
    const current = (input.value || '').trim();
    if (current && current.toLowerCase() === String(value).trim().toLowerCase()) {
      log(`  ✓ ${label || automationId}: déjà "${current}" → skip`);
      return true;
    }
    reactSet(input, String(value).trim());
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    log(`  ✓ ${label || automationId}: "${value}"`);
    return true;
  }

  // ─── Détecter l'étape courante (fr-CA) ──────────────────────────────────────
  function currentStep() {
    const bar = document.querySelector('[data-automation-id="progressBarActiveStep"]');
    const name = (bar?.querySelector('label:last-child')?.textContent || bar?.textContent || '').toLowerCase().trim();
    if (name.includes('mes renseignements') || name.includes('my information'))   return 'my_information';
    if (name.includes('mon expérience')     || name.includes('my experience'))    return 'my_experience';
    if (name.includes('questions liées')    || name.includes('application quest')) return 'application_questions';
    if (name.includes('divulgations')       || name.includes('voluntary'))         return 'voluntary_disclosures';
    if (name.includes('réviser')            || name.includes('review'))            return 'review';
    return 'unknown';
  }

  // ─── Bouton Enregistrer et continuer (fr-CA) / Save and Continue ──────────
  async function saveAndContinue() {
    await sleep(400);
    // Cherche "Enregistrer et continuer" (fr) ou "Save and continue" (en)
    const btn = Array.from(document.querySelectorAll('button')).find(b =>
      b.offsetWidth > 0 &&
      /enregistrer\s+et\s+continuer|save\s+and\s+continue/i.test((b.innerText || '').trim())
    ) || document.querySelector('[data-automation-id="pageFooterNextButton"]');
    if (btn) { await clickEl(btn); await sleep(2500); return true; }
    log('⚠️ Bouton "Enregistrer et continuer" introuvable');
    return false;
  }

  // ─── Attendre une étape spécifique ─────────────────────────────────────────
  async function waitForStep(expected, timeout = 12000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (currentStep() === expected) return true;
      await sleep(400);
    }
    return false;
  }

  // ─── Connexion (fr-CA) ──────────────────────────────────────────────────────
  // MS Workday fr-CA : le bouton de header s'appelle "Ouvrir une session"
  // et le formulaire dans la modale a les mêmes data-automation-id que BofA.

  function isLoggedIn() {
    if (document.getElementById('accountSettingsButton')) return true;
    const hasLoginBtn = Array.from(document.querySelectorAll('span, button, [role="button"]')).some(el =>
      el.offsetWidth > 0 && /ouvrir une session|sign\s*in/i.test((el.textContent || '').trim())
    );
    if (hasLoginBtn) return false;
    return !document.querySelector('input[data-automation-id="email"]');
  }

  async function handleSignIn(authEmail, authPassword) {
    if (isLoggedIn()) { log('  ✓ Déjà connecté'); return true; }

    // Clic "Ouvrir une session" dans le header pour ouvrir la modale
    const signInBtn = Array.from(document.querySelectorAll('button, [role="button"], a, span')).find(el =>
      el.offsetWidth > 0 && /ouvrir une session|sign\s*in/i.test((el.innerText || el.textContent || '').trim())
    );
    if (signInBtn) {
      log('🔐 Clic sur "Ouvrir une session"...');
      await clickEl(signInBtn);
      let w = 0;
      while (w < 6000 && !document.querySelector('input[data-automation-id="email"]')) {
        await sleep(300); w += 300;
      }
    }

    const loginEl = document.querySelector('input[data-automation-id="email"]');
    if (!loginEl) { log('  ✓ Formulaire absent → déjà connecté'); return true; }

    if (!authEmail || !authPassword) {
      log('❌ Identifiants Morgan Stanley manquants — ajoutez-les dans Connexions');
      setBanner('❌ Identifiants Morgan Stanley manquants — Connexions', '#c62828');
      return false;
    }

    log(`🔐 Connexion avec ${authEmail}...`);
    const ns = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;

    loginEl.focus();
    if (ns) ns.call(loginEl, authEmail); else loginEl.value = authEmail;
    loginEl.dispatchEvent(new Event('input', { bubbles: true }));
    loginEl.dispatchEvent(new Event('change', { bubbles: true }));
    loginEl.blur();
    await sleep(400);

    const passEl = document.querySelector('input[data-automation-id="password"]') || document.querySelector('input[type="password"]');
    if (passEl) {
      passEl.focus();
      if (ns) ns.call(passEl, authPassword); else passEl.value = authPassword;
      passEl.dispatchEvent(new Event('input', { bubbles: true }));
      passEl.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(300);
    }

    // Bouton fr-CA : aria-label="Ouvrir une session" ; en-US : aria-label="Sign In"
    const submitBtn =
      document.querySelector('[data-automation-id="click_filter"][aria-label="Ouvrir une session"]') ||
      document.querySelector('[data-automation-id="click_filter"][aria-label="Sign In"]') ||
      Array.from(document.querySelectorAll('button, [role="button"]')).find(el =>
        el.offsetWidth > 0 && /ouvrir une session|sign\s*in/i.test((el.innerText || el.getAttribute('aria-label') || '').trim())
      );

    if (submitBtn) {
      log('  → Clic Ouvrir une session...');
      await clickEl(submitBtn);
    } else if (passEl) {
      ['keydown', 'keypress', 'keyup'].forEach(t =>
        passEl.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }))
      );
    }

    // Attendre disparition du formulaire
    let waited = 0;
    while (waited < 15000) {
      await sleep(500); waited += 500;
      if (!document.querySelector('input[data-automation-id="email"]')) break;
    }
    const ok = !document.querySelector('input[data-automation-id="email"]');
    if (!ok) {
      log('❌ Connexion échouée — vérifiez vos identifiants Morgan Stanley');
      setBanner('❌ Connexion Morgan Stanley échouée — vérifiez vos identifiants', '#c62828');
    }
    return ok;
  }

  // ─── ÉTAPE 2 : Mes renseignements ───────────────────────────────────────────
  async function fillMesRenseignements(p) {
    log('📝 Étape 2 — Mes renseignements');
    setBanner('📝 Mes renseignements en cours...');

    // Attendre le rendu React
    let wMs = 0;
    while (wMs < 6000) {
      if (document.querySelector('[data-automation-id^="formField-legalName"]')) break;
      await sleep(300); wMs += 300;
    }

    // Debug : lister les formField-* présents
    const ffs = Array.from(document.querySelectorAll('[data-automation-id^="formField-"]'))
      .map(f => f.getAttribute('data-automation-id'));
    log(`  🔍 formField-* (${ffs.length}): ${ffs.slice(0, 20).join(', ')}`);

    await fillField('formField-legalName--firstName', p.first_name || p.firstName, 'Prénom');
    await fillField('formField-legalName--lastName',  p.last_name  || p.lastName,  'Nom');
    await fillField('formField-addressLine1',          p.address,    'Adresse');
    await fillField('formField-city',                  p.city,       'Ville');
    await fillField('formField-postalCode',            p.postal_code || p.zipcode, 'Code postal');

    // ── Pays ──
    const countryBtn = document.querySelector('[data-automation-id="formField-country"] button[aria-haspopup]');
    if (countryBtn) {
      const current = (countryBtn.innerText || '').trim();
      const target  = p.country || 'France';
      if (!current.toLowerCase().includes(target.toLowerCase())) {
        await selectListbox(countryBtn, target);
        log(`  ✓ Pays: "${target}"`);
      } else {
        log(`  ✓ Pays: déjà "${current}" → skip`);
      }
    }

    // ── "Comment avez-vous entendu parler de ce poste ?" (Source) ──
    // MS Workday fr-CA — le champ peut s'appeler "source" ou équivalent
    let sourceField = null;
    for (let sw = 0; sw < 4000; sw += 300) {
      sourceField = document.querySelector('[data-automation-id="formField-source"]')
        || (() => {
          const lbl = Array.from(document.querySelectorAll('label, legend')).find(el =>
            /comment avez.vous entendu|how did you hear|source/i.test(el.textContent || '')
          );
          if (!lbl) return null;
          let el = lbl.parentElement;
          for (let d = 0; d < 8 && el; d++) {
            if (el.querySelector('[data-automation-id="multiselectInputContainer"]') ||
                el.querySelector('button[aria-haspopup]')) return el;
            el = el.parentElement;
          }
          return null;
        })();
      if (sourceField) break;
      await sleep(300);
    }

    if (sourceField) {
      // Source = "Eightfold" (candidature venue d'Eightfold) ou "Morgan Stanley Careers Site"
      const msSource = 'Eightfold';
      const alreadySet = new RegExp(msSource, 'i').test(sourceField.innerText || '');
      if (alreadySet) {
        log(`  ✓ Source: déjà "${msSource}" → skip`);
      } else {
        const triggerEl =
          sourceField.querySelector('input[data-uxi-widget-type="selectinput"]') ||
          sourceField.querySelector('[data-automation-id="multiselectInputContainer"]') ||
          sourceField.querySelector('button[aria-haspopup]') ||
          sourceField.querySelector('input[data-automation-id="searchBox"]');

        if (triggerEl) {
          await clickEl(triggerEl);
          await sleep(600);
        }

        // Chercher l'option Eightfold puis fallback Morgan Stanley Careers Site
        const candidates = ['Eightfold', 'Morgan Stanley Careers Site', 'Site de carrières', 'Internet'];
        let found = false;
        for (const candidate of candidates) {
          const deadline = Date.now() + 2500;
          while (Date.now() < deadline) {
            const opt = Array.from(document.querySelectorAll('[data-automation-id="promptOption"]'))
              .find(el => el.offsetWidth > 0 && new RegExp(candidate, 'i').test(el.textContent || ''));
            if (opt) {
              await clickEl(opt);
              await sleep(500);
              // Sous-menu éventuel
              const opt2 = Array.from(document.querySelectorAll('[data-automation-id="promptOption"]'))
                .find(el => el.offsetWidth > 0 && new RegExp(candidate, 'i').test((el.textContent || '').trim()));
              if (opt2) { await clickEl(opt2); await sleep(400); }
              log(`  ✓ Source: "${candidate}"`);
              found = true;
              break;
            }
            await sleep(200);
          }
          if (found) break;
        }
        if (!found) {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
          log('  ⚠️ Source: aucune option reconnue → ignoré');
        }
      }
    }

    // ── Type de téléphone → Mobile ──
    const phoneTypeBtn =
      document.querySelector('[data-automation-id="formField-phoneType"] button[aria-haspopup]') ||
      document.querySelector('[data-automation-id="formField-phoneDeviceType"] button[aria-haspopup]');
    if (phoneTypeBtn) {
      const cur = (phoneTypeBtn.innerText || '').trim();
      // fr-CA : "Mobile" reste "Mobile" dans les deux langues
      if (!/mobile/i.test(cur)) {
        const ok = await selectListbox(phoneTypeBtn, 'Mobile');
        log(`  ✓ Type téléphone: Mobile (était: "${cur}")`);
      } else {
        log(`  ✓ Type téléphone: déjà Mobile → skip`);
      }
    }

    // ── Indicatif pays → France (+33) ──
    const phoneCodeField = document.querySelector('[data-automation-id="formField-countryPhoneCode"]');
    const alreadyFR = phoneCodeField && /france.*\+33|\+33/i.test(phoneCodeField.innerText || '');
    if (!alreadyFR) {
      const codeBtn =
        document.querySelector('[data-automation-id="formField-phoneDeviceType"] button[aria-haspopup]') ||
        document.querySelector('[data-automation-id="formField-countryPhoneCode"] button[aria-haspopup]') ||
        (phoneCodeField && phoneCodeField.querySelector('button[aria-haspopup]'));

      if (codeBtn) {
        const ok = await selectListbox(codeBtn, 'France', 5000);
        log(`  ✓ Indicatif pays: France (+33) — ${ok ? 'sélectionné' : 'non trouvé'}`);
      } else if (phoneCodeField) {
        // Fallback multiselect
        const searchInput = phoneCodeField.querySelector('[data-automation-id="multiselectInputContainer"]') ||
                            phoneCodeField.querySelector('input');
        if (searchInput) {
          await simulateTyping(searchInput, 'France');
          await sleep(600);
          const opt = Array.from(document.querySelectorAll('[data-automation-id="promptOption"]'))
            .find(el => /france/i.test(el.textContent || ''));
          if (opt) { await clickEl(opt); log('  ✓ Indicatif: France (+33)'); }
        }
      }
    } else {
      log('  ✓ Indicatif pays: déjà France (+33) → skip');
    }

    // ── Numéro de téléphone ──
    const phone = (p['phone-number'] || p.phone_number || p.phone || '').replace(/\s/g, '');
    if (phone) {
      const phoneInput =
        document.querySelector('[data-automation-id="formField-phoneNumber"] input:not([type="hidden"])') ||
        document.querySelector('#phoneNumber--phoneNumber') ||
        document.querySelector('input[name="phoneNumber"]');
      if (phoneInput) {
        const cur = (phoneInput.value || '').trim().replace(/\s/g, '');
        if (cur !== phone) {
          reactSet(phoneInput, phone);
          phoneInput.dispatchEvent(new Event('blur', { bubbles: true }));
          log(`  ✓ Téléphone: "${phone}"`);
        } else {
          log(`  ✓ Téléphone: déjà "${phone}" → skip`);
        }
      }
    }
  }

  // ─── ÉTAPE 3 : Mon expérience ────────────────────────────────────────────────
  async function fillMonExperience(p) {
    log('📝 Étape 3 — Mon expérience');
    setBanner('📝 Mon expérience en cours...');

    // ── Upload CV ──
    await uploadCV(p);

    // ── Éducation ──
    await fillEducation(p);

    // ── Langues ──
    await fillLanguages(p);
  }

  // ─── Upload CV ───────────────────────────────────────────────────────────────
  async function deleteExistingCV() {
    const deleteBtn = document.querySelector('[data-automation-id="delete-file"]') ||
      Array.from(document.querySelectorAll('button')).find(b =>
        /supprimer|delete|remove/i.test(b.getAttribute('aria-label') || b.innerText || '') &&
        (b.closest('[data-automation-id*="upload"]') || b.closest('[data-automation-id*="file"]'))
      );
    if (!deleteBtn) return;
    log('  🗑️ CV existant → suppression...');
    await clickEl(deleteBtn);
    let w = 0;
    while (w < 3000 && document.querySelector('[data-automation-id="file-upload-item"]')) {
      await sleep(300); w += 300;
    }
    log('  ✓ CV supprimé');
  }

  async function uploadCV(p) {
    const fileInput = document.querySelector('input[type="file"]');
    if (!fileInput) { log('  ⚠️ CV: input[type="file"] introuvable'); return; }

    const filename  = p.cv_filename  || 'cv.pdf';
    const storagePath = p.cv_storage_path;

    // Vérifier si le bon CV est déjà chargé
    const uploadedName = (document.querySelector('[data-automation-id="file-upload-item-name"]') || {}).textContent || '';
    const uploadOk     = !!document.querySelector('[data-automation-id="file-upload-successful"]');
    if (uploadOk && uploadedName.includes(filename.replace('.pdf', ''))) {
      log(`  ✓ CV: "${filename}" déjà uploadé → skip`);
      return;
    }

    await deleteExistingCV();

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
      setBanner('⏸️ Uploadez votre CV manuellement', '#c47900');
      let w = 0;
      while (w < 180000 && !document.querySelector('[data-automation-id="file-upload-successful"]')) {
        await sleep(1000); w += 1000;
      }
      return;
    }

    // Attendre confirmation Workday
    let waited = 0;
    while (waited < 10000 && !document.querySelector('[data-automation-id="file-upload-successful"]')) {
      await sleep(500); waited += 500;
    }
    const confirmed = !!document.querySelector('[data-automation-id="file-upload-successful"]');
    log(confirmed ? `  ✅ CV: "${filename}" uploadé` : `  ⚠️ CV: pas de confirmation après ${waited}ms`);
  }

  // ─── Éducation ───────────────────────────────────────────────────────────────
  async function fillEducation(p) {
    const school   = p.establishment || p.school;
    const diplYear = p.graduation_year ? String(p.graduation_year) : null;
    const degree   = p.education_level;

    if (!school && !diplYear) { log('  ℹ️ Éducation: pas de données → ignorée'); return; }

    // Attendre que la section soit rendue
    let w = 0;
    while (w < 5000) {
      if (document.querySelector('[data-automation-id="formField-school"]')) break;
      await sleep(300); w += 300;
    }

    // Vérifier si déjà remplie
    const existingSchool = document.querySelector('[data-automation-id="formField-school"] input');
    if (existingSchool && (existingSchool.value || '').trim()) {
      log(`  ✓ École: "${existingSchool.value}" → skip`);
      if (diplYear) await fillField('formField-lastYearAttended', diplYear, 'Année diplomation');
      return;
    }

    if (school) {
      const schoolInput = document.querySelector('[data-automation-id="formField-school"] input') ||
        document.querySelector('input[name*="school"], input[id*="school"]');
      if (schoolInput) {
        await simulateTyping(schoolInput, school);
        await sleep(1000);
        // Sélectionner la première option du typeahead
        const opts = document.querySelectorAll(
          '[role="option"], [data-automation-id="promptOption"], [data-automation-id="menuItem"], [data-automation-id="promptLeafNode"]'
        );
        const opt = Array.from(opts).find(o => o.offsetWidth > 0);
        if (opt) { await clickEl(opt); log(`  ✓ École: "${school}"`); }
        else {
          // Valeur libre si aucune option
          reactSet(schoolInput, school);
          schoolInput.dispatchEvent(new Event('blur', { bubbles: true }));
          log(`  ✓ École (libre): "${school}"`);
        }
        await sleep(400);
      }
    }

    // Diplôme (niveau)
    if (degree) {
      // Mapping éducation fr → Workday
      const degreeMap = {
        'bac + 5 / m2 et plus': "Master's Degree",
        'bac + 4 / m1':         "Master's Degree",
        'bac + 3 / licence':    "Bachelor's Degree",
        'bac + 2':              "Associate's Degree",
        'bac':                  'High School Diploma/GED',
      };
      const degreeLabel = degreeMap[degree.toLowerCase()] || degree;
      const degreeBtn = document.querySelector('[data-automation-id="formField-degree"] button[aria-haspopup]');
      if (degreeBtn) {
        const ok = await selectListbox(degreeBtn, degreeLabel);
        log(`  ${ok ? '✓' : '⚠️'} Diplôme: "${degreeLabel}"`);
      }
    }

    if (diplYear) await fillField('formField-lastYearAttended', diplYear, 'Année diplomation');
  }

  // ─── Langues ─────────────────────────────────────────────────────────────────
  // Workday fr-CA — même structure que BofA en-US
  async function fillLanguages(p) {
    const langs = Array.isArray(p.languages) ? p.languages : [];
    if (!langs.length) { log('  ℹ️ Langues: pas de données → ignorées'); return; }

    // Mapping niveau fr → Workday
    const levelMap = {
      'langue maternelle': 'Native or bilingual',
      'bilingue':          'Native or bilingual',
      'courant':           'Professional working',
      'intermédiaire':     'Limited working',
      'débutant':          'Elementary',
    };

    // Trouver la section Languages via le heading
    async function findLangSection() {
      return Array.from(document.querySelectorAll('[data-automation-id^="languages"], h3, h4, [class*="sectionTitle"]'))
        .find(el => /langues?|languages?/i.test(el.textContent || ''));
    }

    for (let i = 0; i < langs.length; i++) {
      const { language, level } = langs[i];
      if (!language) continue;

      // Si ce n'est pas la première langue, cliquer "Ajouter une autre" / "Add Another"
      if (i > 0) {
        const addBtn = Array.from(document.querySelectorAll('button')).find(b =>
          b.offsetWidth > 0 &&
          /ajouter\s+une\s+autre|ajouter|add\s+another/i.test((b.innerText || '').trim()) &&
          b.closest('[data-automation-id*="language"]')
        ) || (() => {
          const sec = document.querySelector('[data-automation-id="languages"]');
          if (sec) return sec.querySelector('button[type="button"]');
          return null;
        })();
        if (addBtn) { await clickEl(addBtn); await sleep(800); }
        else { log(`  ⚠️ Langues: bouton "Ajouter" introuvable pour la langue ${i + 1}`); break; }
      }

      // Sélectionner la langue dans le listbox de la dernière ligne
      const langBtns = Array.from(document.querySelectorAll('[data-automation-id^="formField-language"] button[aria-haspopup], [data-automation-id="languages"] button[aria-haspopup]'))
        .filter(b => b.offsetWidth > 0);
      const langBtn = langBtns[i] || langBtns[langBtns.length - 1];
      if (langBtn) {
        const ok = await selectListbox(langBtn, language, 5000);
        log(`  ${ok ? '✓' : '⚠️'} Langue ${i + 1}: "${language}"`);
      }

      // Niveau
      if (level) {
        const wdLevel = levelMap[level.toLowerCase()] || level;
        const levelBtns = Array.from(document.querySelectorAll('[data-automation-id^="formField-languageProficiency"] button[aria-haspopup], [data-automation-id="languages"] [data-automation-id*="proficiency"] button[aria-haspopup]'))
          .filter(b => b.offsetWidth > 0);
        const levelBtn = levelBtns[i] || levelBtns[levelBtns.length - 1];
        if (levelBtn) {
          const ok = await selectListbox(levelBtn, wdLevel, 4000);
          log(`  ${ok ? '✓' : '⚠️'} Niveau ${i + 1}: "${wdLevel}"`);
        }
      }
      await sleep(400);
    }
  }

  // ─── ÉTAPE 4 : Questions liées à la candidature ──────────────────────────────
  // Workday fr-CA — questions dynamiques selon le poste.
  // On scanne les formField-* et les labels pour répondre intelligemment.
  async function fillApplicationQuestions(p, jobLocation) {
    log('📝 Étape 4 — Questions liées à la candidature');
    setBanner('📝 Questions candidature en cours...');

    await sleep(1500); // Laisser React charger les questions

    // Tous les champs formField-*
    const fields = Array.from(document.querySelectorAll('[data-automation-id^="formField-"]'));
    log(`  🔍 ${fields.length} question(s) détectée(s)`);

    for (const field of fields) {
      const fieldId = field.getAttribute('data-automation-id') || '';
      const legend  = field.querySelector('legend [data-automation-id="richText"]') ||
                      field.querySelector('legend') || field.querySelector('label');
      const lower   = (legend?.textContent || '').toLowerCase().trim();

      if (!lower) continue;

      // ── Droit au travail / autorisation ──
      if (/droit\s+de\s+travailler|right\s+to\s+work|autoris[eé]|travailleur|habilit/i.test(lower)) {
        const rtwAnswer = deriveRightToWork(p, jobLocation);
        // Radio Oui/Non
        const radioYes = field.querySelector('input[type="radio"][value="true"], input[type="radio"][value="1"]') ||
          Array.from(field.querySelectorAll('input[type="radio"]')).find(r => /oui|yes/i.test(r.nextSibling?.textContent || r.parentElement?.textContent || ''));
        const radioNo = field.querySelector('input[type="radio"][value="false"], input[type="radio"][value="0"]') ||
          Array.from(field.querySelectorAll('input[type="radio"]')).find(r => /non|no/i.test(r.nextSibling?.textContent || r.parentElement?.textContent || ''));
        if (rtwAnswer === 'Yes' && radioYes && !radioYes.checked) {
          radioYes.click();
          log(`  ✓ Droit au travail: Oui (${rtwAnswer})`);
        } else if (rtwAnswer === 'No' && radioNo && !radioNo.checked) {
          radioNo.click();
          log(`  ✓ Droit au travail: Non (${rtwAnswer})`);
        } else {
          log(`  ⚠️ Droit au travail: réponse="${rtwAnswer}" — vérifiez manuellement`);
        }
        continue;
      }

      // ── Visa / sponsorship requis ──
      if (/visa|sponsorship|sponsor|parrainage/i.test(lower)) {
        const needsSponsorship = deriveSponsorship(p, jobLocation);
        const radio = needsSponsorship
          ? Array.from(field.querySelectorAll('input[type="radio"]')).find(r => /oui|yes/i.test(r.parentElement?.textContent || ''))
          : Array.from(field.querySelectorAll('input[type="radio"]')).find(r => /non|no/i.test(r.parentElement?.textContent || ''));
        if (radio && !radio.checked) {
          radio.click();
          log(`  ✓ Sponsorship: ${needsSponsorship ? 'Oui' : 'Non'}`);
        }
        continue;
      }

      // ── Relocation / mobilité ──
      if (/relocation|mobilit|déménagement/i.test(lower)) {
        // Par défaut Non
        const radioNo = Array.from(field.querySelectorAll('input[type="radio"]')).find(r =>
          /non|no/i.test(r.nextSibling?.textContent || r.parentElement?.textContent || '')
        );
        if (radioNo && !radioNo.checked) { radioNo.click(); log(`  ✓ Relocation: Non`); }
        continue;
      }

      // ── Dropdown générique ──
      const dropBtn = field.querySelector('button[aria-haspopup]');
      if (dropBtn) {
        const curText = (dropBtn.innerText || '').trim().toLowerCase();
        if (curText && !['sélectionner', 'select', 'choose', 'choisir'].some(k => curText.includes(k))) {
          log(`  ✓ ${lower.slice(0, 60)}: déjà "${dropBtn.innerText.trim()}" → skip`);
          continue;
        }
        // Laisser à l'utilisateur
        log(`  ⚠️ Question dropdown non gérée automatiquement: "${lower.slice(0, 60)}"`);
        continue;
      }

      // ── Texte libre ──
      const textInput = field.querySelector('input:not([type="radio"]):not([type="checkbox"]):not([type="hidden"]), textarea');
      if (textInput && !(textInput.value || '').trim()) {
        log(`  ⚠️ Champ texte libre non rempli: "${lower.slice(0, 60)}"`);
      }
    }
  }

  // Dériver droit au travail depuis le profil + localisation du poste
  function deriveRightToWork(p, jobLocation) {
    const auths = Array.isArray(p.jp_morgan_work_authorizations) ? p.jp_morgan_work_authorizations : [];
    if (auths.length === 0) return 'Yes'; // Défaut EU

    const loc = (jobLocation || '').toLowerCase();
    const isUK = /royaume.uni|united.kingdom|\buk\b|\blondon\b/i.test(loc);
    const isUS = /états.unis|united.states|\bnew.york\b|\bnyc\b/i.test(loc);
    const isEU = /france|paris|allemagne|espagne|italie|europe/i.test(loc);

    for (const auth of auths) {
      const country = (auth.country || '').toLowerCase();
      const authorized = String(auth.work_authorized || '').toLowerCase() !== 'no';
      if (!authorized) continue;
      if (isUK && /royaume.uni|united.kingdom|\buk\b/i.test(country)) return 'Yes';
      if (isUS && /états.unis|united.states|\bus\b/i.test(country)) return 'Yes';
      if (isEU && /union.europ[eé]enne|eea|europe/i.test(country)) return 'Yes';
    }
    if (isUK) return 'No';
    if (isUS) return 'No';
    // EU par défaut : oui si travailleur EEA/National
    const wt = Array.isArray(p.work_authorization_type) ? p.work_authorization_type : [];
    if (wt.some(t => /national|eea|european/i.test(t))) return 'Yes';
    return 'Yes';
  }

  function deriveSponsorship(p, jobLocation) {
    const auths = Array.isArray(p.jp_morgan_work_authorizations) ? p.jp_morgan_work_authorizations : [];
    for (const auth of auths) {
      if (String(auth.sponsorship_required || '').toLowerCase() === 'yes') return true;
    }
    return false;
  }

  // ─── ÉTAPE 5 : Divulgations volontaires ──────────────────────────────────────
  async function fillDivulgationsVolontaires(p) {
    log('📝 Étape 5 — Divulgations volontaires');
    setBanner('📝 Divulgations volontaires en cours...');

    await sleep(1500);

    const fields = Array.from(document.querySelectorAll('[data-automation-id^="formField-"]'));
    log(`  🔍 ${fields.length} champ(s) de divulgation`);

    for (const field of fields) {
      const legend = field.querySelector('legend [data-automation-id="richText"]') ||
                     field.querySelector('legend') || field.querySelector('label');
      const lower  = (legend?.textContent || '').toLowerCase().trim();
      if (!lower) continue;

      const dropBtn = field.querySelector('button[aria-haspopup]');

      // ── Genre ──
      if (/genre|gender|sexe/i.test(lower) && dropBtn) {
        const genderMap = { 'male': 'Homme', 'female': 'Femme', 'man': 'Homme', 'woman': 'Femme' };
        const target = genderMap[(p.gender || '').toLowerCase()] || p.gender || 'Homme';
        const cur = (dropBtn.innerText || '').trim();
        if (!cur || /sélectionner|select/i.test(cur)) {
          const ok = await selectListbox(dropBtn, target);
          log(`  ${ok ? '✓' : '⚠️'} Genre: "${target}"`);
        } else {
          log(`  ✓ Genre: déjà "${cur}" → skip`);
        }
        continue;
      }

      // ── Handicap ──
      if (/handicap|disability|disabled/i.test(lower)) {
        // Chercher "Je ne souhaite pas répondre" ou "Non" comme option par défaut
        const noDisability = Array.from(field.querySelectorAll('input[type="radio"]')).find(r => {
          const txt = (r.nextSibling?.textContent || r.parentElement?.textContent || '').toLowerCase();
          return /non|no|je ne souhaite pas|decline|prefer not/i.test(txt);
        });
        if (noDisability && !noDisability.checked) {
          noDisability.click();
          log(`  ✓ Handicap: "Je ne souhaite pas répondre"`);
        } else if (dropBtn) {
          const ok = await selectListbox(dropBtn, 'Je ne souhaite pas');
          if (!ok) await selectListbox(dropBtn, 'Decline');
          log(`  ✓ Handicap: option par défaut sélectionnée`);
        }
        continue;
      }

      // ── Vétéran / statut militaire ──
      if (/vétéran|veteran|militaire|military/i.test(lower)) {
        const notVeteran = Array.from(field.querySelectorAll('input[type="radio"]')).find(r => {
          const txt = (r.nextSibling?.textContent || r.parentElement?.textContent || '').toLowerCase();
          return /non.vétéran|not a veteran|je ne suis pas|decline|prefer not/i.test(txt);
        });
        if (notVeteran && !notVeteran.checked) {
          notVeteran.click();
          log(`  ✓ Vétéran: "Non vétéran"`);
        } else if (dropBtn) {
          await selectListbox(dropBtn, 'Je ne souhaite pas');
          log(`  ✓ Vétéran: option par défaut`);
        }
        continue;
      }

      // ── Origine ethnique / Race ──
      if (/ethnique|ethnicité|ethnicité|race|origine/i.test(lower) && dropBtn) {
        const cur = (dropBtn.innerText || '').trim();
        if (!cur || /sélectionner|select/i.test(cur)) {
          const ok = await selectListbox(dropBtn, 'Je ne souhaite pas') ||
                     await selectListbox(dropBtn, 'Decline') ||
                     await selectListbox(dropBtn, 'Prefer not');
          log(`  ${ok ? '✓' : '⚠️'} Origine ethnique: option par défaut`);
        }
        continue;
      }

      // ── Champ non reconnu avec dropdown → log ──
      if (dropBtn) {
        const cur = (dropBtn.innerText || '').trim();
        if (!cur || /sélectionner|select/i.test(cur)) {
          log(`  ⚠️ Divulgation non gérée: "${lower.slice(0, 60)}" → action manuelle requise`);
        }
      }
    }

    // Lettre de motivation (cover letter) — upload si présente
    const coverFileInput = Array.from(document.querySelectorAll('input[type="file"]'))
      .find(f => f.closest('[data-automation-id*="cover"], [data-automation-id*="letter"]'));
    if (coverFileInput && p.letter_storage_path) {
      const letterFilename = p.letter_filename || 'cover-letter.pdf';
      await setFileFromStorage(coverFileInput, p.letter_storage_path, letterFilename);
      log(`  ✓ Lettre de motivation: "${letterFilename}"`);
    }
  }

  // ─── Récupérer les données Firebase ─────────────────────────────────────────
  async function loadProfile() {
    const local = await chrome.storage.local.get([PENDING_KEY, TAB_KEY]).catch(() => ({}));
    const pending = local[PENDING_KEY];
    if (!pending) { log('⚠️ Pas de candidature MS en attente'); return null; }
    return pending;
  }

  // ─── Main ────────────────────────────────────────────────────────────────────
  async function main() {
    log('🚀 Morgan Stanley Workday Filler démarré');

    const pending = await loadProfile();
    if (!pending) return;

    const p           = pending.profile || pending;
    const authEmail   = pending.email    || p.email;
    const authPassword = pending.password;
    const jobLocation  = pending.location || pending.jobLocation || '';

    setBanner('⏳ Taleos — Morgan Stanley en cours...');

    // ── Connexion ──
    const loggedIn = await handleSignIn(authEmail, authPassword);
    if (!loggedIn) return;

    // Attendre que le formulaire de candidature soit chargé
    let waitForm = 0;
    while (waitForm < 15000) {
      if (document.querySelector('[data-automation-id="progressBarActiveStep"]')) break;
      // Gérer le popup "Postuler manuellement" / "Commencer sa candidature"
      const manualBtn = Array.from(document.querySelectorAll('button, a')).find(el =>
        el.offsetWidth > 0 && /postuler manuellement|apply manually/i.test((el.innerText || '').trim())
      );
      if (manualBtn) { await clickEl(manualBtn); await sleep(2000); }
      await sleep(500); waitForm += 500;
    }

    let step = currentStep();
    log(`🔍 Étape courante détectée: "${step}"`);

    // ── Boucle sur les étapes ──
    for (let iter = 0; iter < 10; iter++) {
      step = currentStep();
      log(`\n▶ Étape: ${step}`);

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
        setBanner('✅ Candidature prête — Vérifiez puis soumettez manuellement', '#1b5e20');
        log('✅ Étape Réviser atteinte — soumission manuelle requise');
        return;

      } else {
        // Étape inconnue (account creation, etc.)
        log(`⚠️ Étape inconnue: "${step}" — tentative de continuer`);
        const progressed = await saveAndContinue();
        if (!progressed) { await sleep(2000); }
      }

      await sleep(1000);
    }

    setBanner('⚠️ Nombre max d\'itérations atteint — vérifiez manuellement', '#e65100');
  }

  // Démarrer quand le DOM est prêt
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    setTimeout(main, 1500);
  }
})();
