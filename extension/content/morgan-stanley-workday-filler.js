/**
 * Taleos — Morgan Stanley Workday Filler  v2
 * Portail : ms.wd5.myworkdayjobs.com  (locale fr-CA)
 * Exploré manuellement le 2026-06-06 sur l'offre JR037505
 *
 * Structure réelle du formulaire (5 étapes après connexion) :
 *   1. Mes renseignements  → source (2 niveaux), ex-employé MS, pays, prénom/nom,
 *                            adresse, ville, CP, téléphone
 *   2. Mon expérience      → CV upload (OBLIGATOIRE), exp. pro, études, langues,
 *                            habiletés, LinkedIn
 *   3. Questions candidature → 9 dropdowns Yes/No (compliance / gouvernement)
 *   4. Divulgations volontaires → genre (dropdown fr-CA) + checkbox CGU (OBLIGATOIRE)
 *   5. Réviser             → bouton "Soumettre" (soumission manuelle)
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

  function reactSet(el, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

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
        '[data-automation-id="promptOption"], [role="option"]'
      ));
      const opt = opts.find(o => o.offsetWidth > 0 && (o.textContent || '').trim().toLowerCase().includes(targetText.toLowerCase()));
      if (opt) { await clickEl(opt); await sleep(300); return true; }
      await sleep(200);
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
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
    const name = (bar?.textContent || '').toLowerCase().trim();
    if (name.includes('mes renseignements') || name.includes('my information'))    return 'my_information';
    if (name.includes('mon expérience')     || name.includes('my experience'))     return 'my_experience';
    if (name.includes('questions liées')    || name.includes('application quest')) return 'application_questions';
    if (name.includes('divulgations')       || name.includes('voluntary'))         return 'voluntary_disclosures';
    if (name.includes('réviser')            || name.includes('review'))            return 'review';
    return 'unknown';
  }

  // ─── Bouton Enregistrer et continuer (fr-CA) ─────────────────────────────────
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

  async function waitForStep(expected, timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (currentStep() === expected) return true;
      await sleep(400);
    }
    return false;
  }

  // ─── Connexion fr-CA ─────────────────────────────────────────────────────────
  function isLoggedIn() {
    if (document.getElementById('accountSettingsButton')) return true;
    const hasLoginBtn = Array.from(document.querySelectorAll('span, button, [role="button"], a')).some(el =>
      el.offsetWidth > 0 && /ouvrir une session|sign\s*in/i.test((el.textContent || '').trim())
    );
    if (hasLoginBtn) return false;
    return !document.querySelector('input[data-automation-id="email"]');
  }

  async function handleSignIn(authEmail, authPassword) {
    if (isLoggedIn()) { log('  ✓ Déjà connecté'); return true; }

    // Ouvrir la modale "Ouvrir une session"
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
      log('❌ Identifiants Morgan Stanley manquants — configurez-les dans Connexions');
      setBanner('❌ Identifiants Morgan Stanley manquants — Connexions', '#c62828');
      return false;
    }

    log(`🔐 Connexion avec ${authEmail}...`);
    const ns = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;

    // Remplir email
    loginEl.focus();
    if (ns) ns.call(loginEl, authEmail); else loginEl.value = authEmail;
    loginEl.dispatchEvent(new Event('input', { bubbles: true }));
    loginEl.dispatchEvent(new Event('change', { bubbles: true }));
    loginEl.blur();
    await sleep(400);

    // Vider et remplir le mot de passe proprement
    const passEl = document.querySelector('input[data-automation-id="password"]') ||
                   Array.from(document.querySelectorAll('input[type="password"]')).find(e => e.offsetParent !== null);
    if (passEl) {
      passEl.focus();
      if (ns) { ns.call(passEl, ''); } else { passEl.value = ''; }
      passEl.dispatchEvent(new Event('input', { bubbles: true }));
      // Sélectionner tout et écraser
      passEl.select();
      if (ns) ns.call(passEl, authPassword); else passEl.value = authPassword;
      passEl.dispatchEvent(new Event('input', { bubbles: true }));
      passEl.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(300);
    }

    // Soumettre — fr-CA : aria-label="Ouvrir une session"
    const submitBtn =
      document.querySelector('[data-automation-id="click_filter"][aria-label="Ouvrir une session"]') ||
      document.querySelector('[data-automation-id="click_filter"][aria-label="Sign In"]') ||
      Array.from(document.querySelectorAll('button')).find(el =>
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

    let waited = 0;
    while (waited < 15000) {
      await sleep(500); waited += 500;
      if (!document.querySelector('input[data-automation-id="email"]')) break;
    }
    const ok = !document.querySelector('input[data-automation-id="email"]');
    if (!ok) {
      log('❌ Connexion MS échouée — vérifiez vos identifiants');
      setBanner('❌ Connexion Morgan Stanley échouée — vérifiez vos identifiants', '#c62828');
    }
    return ok;
  }

  // ─── ÉTAPE 1 : Mes renseignements ────────────────────────────────────────────
  // Ordre réel : source → ex-employé MS → pays → prénom → nom → adresse → téléphone
  async function fillMesRenseignements(p) {
    log('📝 Étape 1 — Mes renseignements');
    setBanner('📝 Mes renseignements en cours...');

    // Attendre le rendu React
    let w = 0;
    while (w < 6000) {
      if (document.querySelector('[data-automation-id="formField-source"]') ||
          document.querySelector('[data-automation-id="formField-legalName--firstName"]')) break;
      await sleep(300); w += 300;
    }

    // Debug
    const ffs = Array.from(document.querySelectorAll('[data-automation-id^="formField-"]'))
      .map(f => f.getAttribute('data-automation-id'));
    log(`  🔍 formField-* (${ffs.length}): ${ffs.slice(0, 20).join(', ')}`);

    // ── Source (2 niveaux) ──
    // Niveau 1 : "Site de carrière"
    // Niveau 2 : "Site de carrière de Morgan Stanley"
    let sourceField = null;
    for (let sw = 0; sw < 4000; sw += 300) {
      sourceField = document.querySelector('[data-automation-id="formField-source"]')
        || (() => {
          const lbl = Array.from(document.querySelectorAll('label, legend')).find(el =>
            /comment avez.vous entendu|how did you hear/i.test(el.textContent || '')
          );
          if (!lbl) return null;
          let el = lbl.parentElement;
          for (let d = 0; d < 8 && el; d++) {
            if (el.querySelector('button[aria-haspopup]') ||
                el.querySelector('[data-automation-id="multiselectInputContainer"]')) return el;
            el = el.parentElement;
          }
          return null;
        })();
      if (sourceField) break;
      await sleep(300);
    }

    if (sourceField) {
      const alreadySet = /site de carrière de morgan stanley|morgan stanley careers/i.test(sourceField.innerText || '');
      if (alreadySet) {
        log('  ✓ Source: déjà "Site de carrière de Morgan Stanley" → skip');
      } else {
        const triggerEl = sourceField.querySelector('button[aria-haspopup]') ||
          sourceField.querySelector('[data-automation-id="multiselectInputContainer"]') ||
          sourceField.querySelector('input[data-automation-id="searchBox"]');

        if (triggerEl) {
          await clickEl(triggerEl);
          await sleep(600);
        }

        // Source configurée dans le profil (ms_source) ou défaut "Site de carrière de Morgan Stanley"
        const msSource = p.ms_source || 'Site de carrière de Morgan Stanley';

        // Niveau 1 : "Site de carrière" (catégorie parent)
        let found = false;
        const deadline1 = Date.now() + 3000;
        while (Date.now() < deadline1) {
          // Chercher la catégorie parent correspondant à la source souhaitée
          const opt1 = Array.from(document.querySelectorAll('[data-automation-id="promptOption"]'))
            .find(o => o.offsetWidth > 0 && /site de carri[eè]re(?!\s+de\s+morgan)/i.test(o.textContent || ''));
          if (opt1) {
            await clickEl(opt1);
            await sleep(500);
            // Niveau 2 : l'option exacte
            const opt2 = Array.from(document.querySelectorAll('[data-automation-id="promptOption"]'))
              .find(o => o.offsetWidth > 0 && new RegExp(msSource.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(o.textContent || ''));
            if (opt2) {
              await clickEl(opt2);
              log(`  ✓ Source: "${msSource}"`);
              found = true;
            }
            break;
          }
          await sleep(200);
        }
        if (!found) log('  ⚠️ Source: option introuvable → ignoré');
      }
    }

    // ── Ex-employé MS → lu depuis ms_previously_employed (défaut: Non) ──
    const prevWorker = document.querySelector('[data-automation-id="formField-candidateIsPreviousWorker"]');
    if (prevWorker) {
      const wasEmployee = (p.ms_previously_employed || 'No').toLowerCase() === 'yes';
      const targetVal   = wasEmployee ? 'true' : 'false';
      const targetRadio = prevWorker.querySelector(`input[type="radio"][value="${targetVal}"]`);
      if (targetRadio && !targetRadio.checked) {
        targetRadio.click();
        log(`  ✓ Ex-employé Morgan Stanley: ${wasEmployee ? 'Oui' : 'Non'}`);
      } else {
        log(`  ✓ Ex-employé Morgan Stanley: déjà rempli → skip`);
      }
    }

    // ── Pays → France ──
    const countryBtn = document.querySelector('[data-automation-id="formField-country"] button[aria-haspopup]');
    if (countryBtn) {
      const current = (countryBtn.innerText || '').trim();
      if (!current.toLowerCase().includes('france')) {
        await selectListbox(countryBtn, 'France');
        log('  ✓ Pays: France');
      } else {
        log(`  ✓ Pays: déjà "${current}" → skip`);
      }
    }

    // ── Prénom / Nom / Adresse / Ville / Code postal ──
    await fillField('formField-legalName--firstName', p.first_name || p.firstName, 'Prénom');
    await fillField('formField-legalName--lastName',  p.last_name  || p.lastName,  'Nom');
    await fillField('formField-addressLine1',          p.address,    'Adresse');
    await fillField('formField-city',                  p.city,       'Ville');
    await fillField('formField-postalCode',            p.postal_code || p.zipcode, 'Code postal');

    // ── Type de téléphone → Téléphone cellulaire (= Mobile en fr-CA) ──
    // Note : le type est déjà "Téléphone cellulaire" par défaut sur MS Workday fr-CA
    const phoneTypeBtn = document.querySelector('[data-automation-id="formField-phoneType"] button[aria-haspopup]');
    if (phoneTypeBtn) {
      const cur = (phoneTypeBtn.innerText || '').trim();
      if (!/cellulaire|mobile/i.test(cur)) {
        const ok = await selectListbox(phoneTypeBtn, 'Téléphone cellulaire') ||
                   await selectListbox(phoneTypeBtn, 'Mobile');
        log(`  ${ok ? '✓' : '⚠️'} Type téléphone: Téléphone cellulaire`);
      } else {
        log(`  ✓ Type téléphone: déjà "${cur}" → skip`);
      }
    }

    // ── Indicatif pays → France (+33) ──
    // MS Workday fr-CA pré-sélectionne France (+33) pour les comptes créés en France
    const phoneCodeField = document.querySelector('[data-automation-id="formField-countryPhoneCode"]');
    const alreadyFR = phoneCodeField && /france.*\+33|\+33/i.test(phoneCodeField.innerText || '');
    if (!alreadyFR && phoneCodeField) {
      const codeBtn = phoneCodeField.querySelector('button[aria-haspopup]') ||
        document.querySelector('[data-automation-id="formField-phoneDeviceType"] button[aria-haspopup]');
      if (codeBtn) {
        const ok = await selectListbox(codeBtn, 'France', 5000);
        log(`  ${ok ? '✓' : '⚠️'} Indicatif: France (+33)`);
      }
    } else {
      log('  ✓ Indicatif: déjà France (+33) → skip');
    }

    // ── Numéro de téléphone ──
    const phone = (p['phone-number'] || p.phone_number || p.phone || '').replace(/\s/g, '');
    if (phone) {
      const phoneInput =
        document.querySelector('[data-automation-id="formField-phoneNumber"] input:not([type="hidden"])') ||
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

  // ─── ÉTAPE 2 : Mon expérience ─────────────────────────────────────────────────
  async function fillMonExperience(p) {
    log('📝 Étape 2 — Mon expérience');
    setBanner('📝 Mon expérience en cours...');

    // ── CV upload (OBLIGATOIRE) ──
    await uploadCV(p);

    // ── LinkedIn ──
    if (p.linkedin_url) {
      await fillField('formField-linkedInAccount', p.linkedin_url, 'LinkedIn');
    }

    // Note : Expérience pro, Études, Langues → sections "Ajouter" manuelles
    // Le filler ne les remplit pas automatiquement (Workday n'expose pas de formField-*)
    log('  ℹ️ Expérience pro / Études / Langues : sections "Ajouter" — remplissage manuel');
  }

  async function deleteExistingCV() {
    const deleteBtn = document.querySelector('[data-automation-id="delete-file"]') ||
      Array.from(document.querySelectorAll('button')).find(b =>
        /supprimer|delete|remove/i.test(b.getAttribute('aria-label') || b.innerText || '') &&
        b.closest('[data-automation-id*="upload"], [data-automation-id*="file"]')
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

    const filename    = p.cv_filename || 'cv.pdf';
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

    let waited = 0;
    while (waited < 10000 && !document.querySelector('[data-automation-id="file-upload-successful"]')) {
      await sleep(500); waited += 500;
    }
    const confirmed = !!document.querySelector('[data-automation-id="file-upload-successful"]');
    log(confirmed ? `  ✅ CV: "${filename}" uploadé` : `  ⚠️ CV: pas de confirmation après ${waited}ms`);
    if (!confirmed) {
      setBanner('⚠️ Vérifiez le CV manuellement puis continuez', '#e65100');
      await sleep(5000); // Laisser le temps à l'utilisateur de vérifier
    }
  }

  // ─── ÉTAPE 3 : Questions liées à la candidature ──────────────────────────────
  // Les IDs sont dynamiques (dc48a60e...) → scan par texte du label
  // Les options sont "Yes" / "No" (anglais même en fr-CA)
  async function fillApplicationQuestions(p, jobLocation) {
    log('📝 Étape 3 — Questions liées à la candidature');
    setBanner('📝 Questions candidature en cours...');

    await sleep(2000); // Laisser React charger

    const fields = Array.from(document.querySelectorAll('[data-automation-id^="formField-"]'));
    log(`  🔍 ${fields.length} question(s) détectée(s)`);

    for (const field of fields) {
      const legend = field.querySelector('legend [data-automation-id="richText"]') ||
                     field.querySelector('legend') || field.querySelector('label');
      const lower  = (legend?.textContent || '').toLowerCase().trim();
      const btn    = field.querySelector('button[aria-haspopup]');
      if (!btn) continue;

      const cur = (btn.innerText || '').trim();
      if (cur && !/sélectionnez|select a value/i.test(cur)) {
        log(`  ✓ ${lower.slice(0, 60)}: déjà "${cur}" → skip`);
        continue;
      }

      let answer = null;

      // Droit au travail → Yes (EU national travaillant en France)
      if (/légalement autorisé|legally authorized|right to work|autorisé.*travailler/i.test(lower)) {
        answer = deriveRightToWork(p, jobLocation) === 'No' ? 'No' : 'Yes';
      }
      // Sponsorship actuel → Non (citoyen français/UE)
      else if (/actuellement besoin.*sponsori|currently.*need.*sponsor|parrainage.*visa\s*\?|visa.*work.*now/i.test(lower)) {
        answer = deriveSponsorship(p) ? 'Yes' : 'No';
      }
      // Sponsorship futur → Non
      else if (/avenir.*parrainage|future.*sponsor|besoin.*futur/i.test(lower)) {
        answer = 'No';
      }
      // Employé gouvernement → Non
      else if (/employé du gouvernement|government.*official|official.*gouvernement|fonctionnaire/i.test(lower)) {
        answer = 'No';
      }
      // Famille fonctionnaire → Non
      else if (/famille immédiate|proche associé|immediate family|close associate/i.test(lower)) {
        answer = 'No';
      }
      // Recommandé par fonctionnaire → Non
      else if (/recommandé.*fonctionnaire|parrainé.*fonctionnaire|sponsored.*government.*official/i.test(lower)) {
        answer = 'No';
      }
      // Consentement SMS/WhatsApp Talent Acquisition → lu depuis le profil (ms_sms_consent)
      else if (/consent.*follow.*communication|consent.*sms|whatsapp|talent acquisition.*sms|recevoir.*communication/i.test(lower)) {
        answer = p.ms_sms_consent || 'Yes'; // Par défaut Yes (l'utilisateur veut recevoir les offres)
      }
      // Défaut compliance → No
      else {
        answer = 'No';
        log(`  ℹ️ Question non reconnue → "No" par défaut: "${lower.slice(0, 60)}"`);
      }

      const ok = await selectListbox(btn, answer, 3000);
      log(`  ${ok ? '✓' : '⚠️'} ${lower.slice(0, 60)} → ${answer}`);
    }
  }

  function deriveRightToWork(p, jobLocation) {
    const auths = Array.isArray(p.jp_morgan_work_authorizations) ? p.jp_morgan_work_authorizations : [];
    if (auths.length === 0) return 'Yes'; // Défaut EU

    const loc  = (jobLocation || '').toLowerCase();
    const isUK = /royaume.uni|united.kingdom|\buk\b|\blondon\b/i.test(loc);
    const isUS = /états.unis|united.states|\bnew.york\b|\bnyc\b/i.test(loc);

    for (const auth of auths) {
      const country    = (auth.country || '').toLowerCase();
      const authorized = String(auth.work_authorized || '').toLowerCase() !== 'no';
      if (!authorized) continue;
      if (isUK && /royaume.uni|united.kingdom|\buk\b/i.test(country)) return 'Yes';
      if (isUS && /états.unis|united.states|\bus\b/i.test(country))    return 'Yes';
      if (!isUK && !isUS && /union.europ|eea|europe|national/i.test(country)) return 'Yes';
    }
    if (isUK || isUS) return 'No';
    const wt = Array.isArray(p.work_authorization_type) ? p.work_authorization_type : [];
    if (wt.some(t => /national|eea|european/i.test(t))) return 'Yes';
    return 'Yes';
  }

  function deriveSponsorship(p) {
    const auths = Array.isArray(p.jp_morgan_work_authorizations) ? p.jp_morgan_work_authorizations : [];
    return auths.some(a => String(a.sponsorship_required || '').toLowerCase() === 'yes');
  }

  // ─── ÉTAPE 4 : Divulgations volontaires ──────────────────────────────────────
  // Réel (exploré) : 1 dropdown genre + 1 checkbox CGU obligatoire
  async function fillDivulgationsVolontaires(p) {
    log('📝 Étape 4 — Divulgations volontaires');
    setBanner('📝 Divulgations volontaires en cours...');

    await sleep(1500);

    // ── Genre (dropdown) ──
    // Options fr-CA : "Femme" / "Homme" / "Préfère de pas s'identifier"
    const genderField = document.querySelector('[data-automation-id$="d-gender"]');
    if (genderField) {
      const genderBtn = genderField.querySelector('button[aria-haspopup]');
      if (genderBtn) {
        const cur = (genderBtn.innerText || '').trim();
        if (!cur || /sélectionnez|select/i.test(cur)) {
          // Mapping genre Firebase → option fr-CA
          const genderMap = {
            'male':   'Homme',
            'female': 'Femme',
            'man':    'Homme',
            'woman':  'Femme',
          };
          const target = genderMap[(p.gender || '').toLowerCase()] || 'Préfère de pas s\'identifier';
          const ok = await selectListbox(genderBtn, target, 4000);
          log(`  ${ok ? '✓' : '⚠️'} Genre: "${target}"`);
        } else {
          log(`  ✓ Genre: déjà "${cur}" → skip`);
        }
      }
    }

    // ── Checkbox CGU "Oui, j'ai lu et j'accepte les termes et conditions" (OBLIGATOIRE) ──
    const cguContainer = document.querySelector('[data-automation-id$="reements"]');
    const cgu = cguContainer?.querySelector('input[type="checkbox"]');
    if (cgu) {
      if (!cgu.checked) {
        cgu.click();
        await sleep(300);
        log('  ✓ CGU: cochée');
      } else {
        log('  ✓ CGU: déjà cochée → skip');
      }
    } else {
      // Fallback : chercher par texte
      const allCheckboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
      const cguAlt = allCheckboxes.find(cb => {
        const lbl = cb.closest('[data-automation-id^="formField-"]')?.textContent || '';
        return /j'ai lu|termes et conditions|terms and conditions|j'accepte/i.test(lbl);
      });
      if (cguAlt && !cguAlt.checked) {
        cguAlt.click();
        log('  ✓ CGU (fallback): cochée');
      }
    }
  }

  // ─── Récupérer les données Firebase ─────────────────────────────────────────
  async function loadProfile() {
    const local = await chrome.storage.local.get([PENDING_KEY, TAB_KEY]).catch(() => ({}));
    const pending = local[PENDING_KEY];
    if (!pending) { log('⚠️ Pas de candidature MS en attente'); return null; }
    return pending;
  }

  // ─── Gérer la page de démarrage ("Commencer sa candidature") ─────────────────
  // MS Workday affiche une page intermédiaire avec 3 boutons avant le formulaire
  async function handleStartPage() {
    const waitMs = 6000;
    let waited = 0;
    while (waited < waitMs) {
      // Déjà sur le formulaire (progressBar présent) → rien à faire
      if (document.querySelector('[data-automation-id="progressBarActiveStep"]')) return;

      // Page "Commencer sa candidature" → cliquer "Postuler manuellement"
      const manualBtn = Array.from(document.querySelectorAll('button, a')).find(el =>
        el.offsetWidth > 0 && /postuler manuellement|apply manually/i.test((el.innerText || '').trim())
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

  // ─── Main ────────────────────────────────────────────────────────────────────
  async function main() {
    log('🚀 Morgan Stanley Workday Filler v2 démarré');

    const pending = await loadProfile();
    if (!pending) return;

    const p            = pending.profile || pending;
    const authEmail    = pending.email    || p.email;
    const authPassword = pending.password;
    const jobLocation  = pending.location || pending.jobLocation || '';

    setBanner('⏳ Taleos — Morgan Stanley en cours...');

    // ── Connexion ──
    const loggedIn = await handleSignIn(authEmail, authPassword);
    if (!loggedIn) return;

    // ── Page de démarrage (Postuler manuellement) ──
    await handleStartPage();

    // ── Attendre le formulaire ──
    let waitForm = 0;
    while (waitForm < 20000) {
      if (document.querySelector('[data-automation-id="progressBarActiveStep"]')) break;
      await sleep(500); waitForm += 500;
    }

    // ── Boucle sur les étapes ──
    for (let iter = 0; iter < 10; iter++) {
      const step = currentStep();
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
        setBanner('✅ Candidature prête — Vérifiez et cliquez "Soumettre" manuellement', '#1b5e20');
        log('✅ Étape Réviser atteinte — soumission manuelle requise (bouton "Soumettre")');
        return;

      } else {
        log(`⚠️ Étape inconnue "${step}" — tentative de continuer`);
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
