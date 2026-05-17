(function () {
  'use strict';

  const GS_HOSTS = ['higher.gs.com', 'hdpc.fa.us2.oraclecloud.com'];
  if (!GS_HOSTS.some((h) => (location.hostname || '').includes(h))) return;

  const BANNER_ID   = 'taleos-gs-banner';
  const PENDING_KEY = 'taleos_pending_goldman_sachs';
  const TAB_KEY     = 'taleos_gs_tab_id';
  const LOG_PREFIX  = '[Taleos Goldman Sachs]';
  const blueprint   = globalThis.__TALEOS_GOLDMAN_SACHS_BLUEPRINT__ || null;

  let isRunning = false;
  let currentTabIdPromise = null;
  let logged = new Set();

  // ── État session (one-shot guards) ──────────────────────────────────────────
  let state = {
    offerPageClicked:    false,   // one-shot : clic Apply sur higher.gs.com (évite onglets multiples)
    emailSubmitted:      false,
    privacyAgreed:       false,
    nextSection1:        false,
    nextSection2:        false,
    submitSection3:      false,
    attachmentsCleared:  false,   // one-shot : suppression avant réupload
    resumeUploadDone:    false,
    coverUploadDone:     false,
    successSent:         false
  };

  // ─── Utilitaires ─────────────────────────────────────────────────────────────

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function log(message, indent = 0) {
    const text = `${'   '.repeat(indent)}${message}`;
    if (logged.has(text)) return;
    logged.add(text);
    console.log(`${LOG_PREFIX} ${text}`);
  }

  function norm(v) { return String(v || '').replace(/\s+/g, ' ').trim().toLowerCase(); }

  function normText(v) {
    return String(v || '').replace(/[''‚‛′]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function getBannerApi() { return globalThis.__TALEOS_AUTOMATION_BANNER__ || null; }

  function ensureBanner(text) {
    let banner = document.getElementById(BANNER_ID);
    if (!banner) {
      banner = document.createElement('div');
      banner.id = BANNER_ID;
      const api = getBannerApi();
      if (api) api.applyStyle(banner);
      document.body?.insertBefore(banner, document.body.firstChild);
    }
    banner.textContent = text || '⏳ Automatisation Taleos en cours — Ne touchez à rien.';
  }

  async function getCurrentTabId() {
    if (!currentTabIdPromise) {
      currentTabIdPromise = chrome.runtime.sendMessage({ action: 'taleos_get_current_tab_id' })
        .then((r) => r?.tabId || null)
        .catch(() => null);
    }
    return currentTabIdPromise;
  }

  async function getPending() {
    const currentTabId = await getCurrentTabId();
    const local = await chrome.storage.local.get([PENDING_KEY, TAB_KEY]);
    const pending = local[PENDING_KEY];
    const expectedTabId = pending?.tabId || local[TAB_KEY] || null;
    if (!pending || !expectedTabId || !currentTabId || currentTabId !== expectedTabId) return null;
    return pending;
  }

  function isElementVisible(el) {
    if (!el) return false;
    const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
    const style = globalThis.getComputedStyle ? getComputedStyle(el) : null;
    return !!rect && rect.width > 0 && rect.height > 0 &&
      style?.display !== 'none' && style?.visibility !== 'hidden';
  }

  function visible(selector, root = document) {
    try {
      return Array.from(root.querySelectorAll(selector)).find(isElementVisible) || null;
    } catch (_) { return null; }
  }

  function getValue(el) {
    if (!el) return '';
    return String(el.value || el.textContent || '').trim();
  }

  function setInputValue(el, value) {
    if (!el) return false;
    const next = String(value ?? '').trim();
    const current = getValue(el);
    if (current === next) return 'skip';
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, next);
    else el.value = next;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
    return 'updated';
  }

  function auditAndFill(label, el, desiredValue) {
    if (!el) { log(`⚠️ ${label} : champ introuvable`, 1); return false; }
    const current = getValue(el);
    const desired = String(desiredValue ?? '').trim();
    if (norm(current) === norm(desired)) {
      log(`✅ ${label} : '${current || '(vide)'}' -> Skip`, 1);
      return true;
    }
    log(`✏️ ${label} : formulaire='${current || '(vide)'}' | Firebase='${desired}' -> Correction`, 1);
    setInputValue(el, desired);
    return true;
  }

  function findBySelectors(selectors, root = document) {
    for (const sel of selectors) {
      const el = visible(sel, root) || root.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function findButtonByText(text) {
    const target = norm(text);
    return Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]')).find((el) => {
      const content = norm(el.textContent || el.value || el.getAttribute('aria-label') || '');
      return content === target || content.includes(target);
    }) || null;
  }

  // ── Upload ────────────────────────────────────────────────────────────────────

  async function setFileInputFromStorage(inputEl, storagePath, filename) {
    if (!inputEl || !storagePath) return false;
    const r = await chrome.runtime.sendMessage({ action: 'fetch_storage_file', storagePath }).catch(() => null);
    if (!r || r.error || !r.base64) {
      log(`❌ Fichier Firebase introuvable : ${filename || storagePath}`, 1);
      return false;
    }
    const bin = atob(r.base64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const blob = new Blob([arr], { type: r.type || 'application/pdf' });
    const file = new File([blob], filename || 'document.pdf', { type: blob.type });
    const dt = new DataTransfer();
    dt.items.add(file);
    inputEl.files = dt.files;
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  /**
   * Trouve la zone d'upload pour un label donné ("resume" ou "cover letter").
   * Oracle HCM CX : les zones upload sont dans des sections labellisées.
   * On cherche le container englobant qui contient le texte ET un input[type="file"].
   */
  function findUploadRoot(keyword) {
    const target = norm(keyword);
    // Chercher du plus spécifique au plus général
    const candidates = Array.from(document.querySelectorAll(
      'section, fieldset, [class*="attachment"], [class*="upload"], [class*="document"], .oj-panel, .oj-flex, div'
    ));
    for (const el of candidates) {
      const text = norm(el.textContent || '');
      if (!text.includes(target)) continue;
      if (el.querySelector('input[type="file"]')) return el;
    }
    return document;
  }

  /**
   * Supprime TOUS les attachments existants sur la page avant réupload.
   * Cherche les boutons "Remove" visibles dans les zones d'upload.
   */
  async function removeAllAttachments() {
    let removed = 0;
    for (let pass = 0; pass < 10; pass++) {
      const btn = Array.from(document.querySelectorAll('button, [role="button"]')).find(b => {
        if (!isElementVisible(b)) return false;
        const t = norm(`${b.textContent || ''} ${b.getAttribute('aria-label') || ''}`);
        return /remove|supprimer|delete|trash/.test(t) &&
          b.closest('[class*="attachment"], [class*="upload"], [class*="file"], [class*="document"]');
      });
      if (!btn) break;
      btn.click();
      await sleep(600);
      removed++;
    }
    if (removed) log(`🗑️ Attachments : ${removed} pièce(s) supprimée(s)`, 1);
    return removed;
  }

  async function ensureUpload({ label, storagePath, filename, keyword, doneFlag }) {
    if (!storagePath) { log(`⏭️ ${label} : aucun fichier Firebase`, 1); return false; }
    if (state[doneFlag]) return true;

    const root = findUploadRoot(keyword);
    let input = visible('input[type="file"]', root) || root.querySelector('input[type="file"]');
    if (!input) {
      // Fallback global
      const allInputs = Array.from(document.querySelectorAll('input[type="file"]'));
      input = allInputs.find(i => isElementVisible(i) || i.offsetParent !== null) || allInputs[0] || null;
    }
    if (!input) { log(`⚠️ ${label} : champ upload introuvable`, 1); return false; }

    const ok = await setFileInputFromStorage(input, storagePath, filename);
    if (ok) {
      state[doneFlag] = true;
      log(`✅ ${label} : ${filename || storagePath.split('/').pop()} (Firebase)`, 1);
      await sleep(800);
      return true;
    }
    return false;
  }

  // ── Pill buttons / Radio ──────────────────────────────────────────────────────

  function findQuestionContainer(textNeedle) {
    const target = norm(textNeedle);
    const nodes = document.querySelectorAll('section, fieldset, .oj-form-layout, .oj-panel, .oj-flex, div');
    for (const node of nodes) {
      const text = norm(node.textContent || '');
      if (!text || !text.includes(target)) continue;
      if (node.querySelector('button, [role="radio"], [aria-pressed]')) return node;
    }
    return null;
  }

  function isPillSelected(pill) {
    const style = globalThis.getComputedStyle ? getComputedStyle(pill) : null;
    const bg = style?.backgroundColor || '';
    const isUnselected = bg === 'rgba(0, 0, 0, 0)' || bg === '' || bg === 'transparent' || bg === 'rgb(255, 255, 255)';
    return !isUnselected
      || pill.getAttribute('aria-checked') === 'true'
      || pill.getAttribute('aria-pressed') === 'true'
      || pill.classList.contains('selected')
      || pill.classList.contains('oj-selected')
      || pill.classList.contains('is-selected');
  }

  function auditAndClickPill(label, questionText, desiredValue) {
    if (!desiredValue) return false;
    const container = findQuestionContainer(questionText) || document;
    const pills = Array.from(container.querySelectorAll('button, [role="radio"], [aria-pressed]'));
    const target = norm(desiredValue);
    for (const pill of pills) {
      const pillText = norm(pill.innerText || pill.textContent || '');
      if (!pillText || pillText !== target) continue;
      if (isPillSelected(pill)) {
        log(`✅ ${label} : '${pill.innerText?.trim()}' -> Skip`, 1);
        return true;
      }
      log(`✏️ ${label} : -> '${desiredValue}'`, 1);
      pill.click();
      return true;
    }
    log(`⚠️ ${label} : option '${desiredValue}' introuvable pour "${questionText}"`, 1);
    return false;
  }

  // ── OJ Combobox (Oracle JET dropdown) ────────────────────────────────────────

  async function fillOJCombobox(labelOrSelector, value) {
    if (!value) return false;
    let input = null;
    if (labelOrSelector.startsWith('#') || labelOrSelector.startsWith('[') || labelOrSelector.startsWith('.')) {
      input = visible(labelOrSelector) || document.querySelector(labelOrSelector);
    }
    if (!input) {
      const target = norm(labelOrSelector);
      const labels = Array.from(document.querySelectorAll('label, span, div, oj-label')).filter((el) => {
        return norm(el.textContent || '') === target || norm(el.textContent || '').includes(target);
      });
      for (const lbl of labels) {
        const root = lbl.closest('.oj-form-layout, .oj-flex-item, .oj-form, .oj-panel, div') || lbl.parentElement;
        const found = root?.querySelector?.('input[role="combobox"], input[type="text"], [role="combobox"] input');
        if (found) { input = found; break; }
      }
    }
    if (!input) { log(`⚠️ OJ Combobox '${labelOrSelector}' introuvable`, 1); return false; }

    const current = getValue(input);
    if (norm(current) === norm(value)) {
      log(`✅ OJ Combobox '${labelOrSelector}' : '${current}' -> Skip`, 1);
      return true;
    }
    log(`✏️ OJ Combobox '${labelOrSelector}' : '${current}' -> '${value}'`, 1);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(500);
    // Cliquer sur la première option correspondante
    const options = Array.from(document.querySelectorAll('[role="option"], li[role="option"], .oj-listbox-result, .oj-listview-item'));
    const match = options.find(el => norm(el.textContent || '').includes(norm(value)));
    if (match) {
      for (const type of ['mousedown', 'mouseup', 'click']) {
        match.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      }
      await sleep(300);
      return true;
    }
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    await sleep(200);
    return true;
  }

  // ─── Handlers par page ───────────────────────────────────────────────────────

  async function handleOfferPage() {
    // Guard one-shot : le bouton Apply sur higher.gs.com ouvre un nouvel onglet
    // (target="_blank"). Sans ce guard, le setInterval reclique toutes les 1,5 s
    // et ouvre des dizaines d'onglets Oracle HCM CX.
    if (state.offerPageClicked) return;

    ensureBanner('⏳ Automatisation Taleos — Goldman Sachs : navigation vers le formulaire...');
    // L'URL Apply est dans le href de l'anchor <a href="...hdpc.fa.us2.oraclecloud.com/.../apply/email">
    const applyLink = document.querySelector('a[href*="hdpc.fa.us2.oraclecloud.com"][href*="/apply/email"]');
    if (applyLink) {
      state.offerPageClicked = true;
      log('🔗 Goldman Sachs → navigation via lien Apply direct');
      applyLink.click();
      return;
    }
    // Fallback : bouton Apply textuel
    const applyBtn = Array.from(document.querySelectorAll('a, button')).find(
      el => /^\s*apply\s*$/i.test(el.textContent || '')
    );
    if (applyBtn) {
      state.offerPageClicked = true;
      applyBtn.click();
      log('🔗 Goldman Sachs → clic sur bouton Apply');
    } else {
      log('⚠️ Goldman Sachs → bouton Apply introuvable sur la page offre');
    }
  }

  async function handleEmailStep(profile) {
    ensureBanner('⏳ Automatisation Taleos — Goldman Sachs : saisie de l\'email...');
    const report = blueprint?.getStructureReport?.('email');
    if (report) log(`Blueprint GS email: ${report.ok ? 'OK' : 'KO'} (${report.matchedSelectors.length} sélecteurs)`);

    // Gérer la modale de consentement vie privée GS si présente
    if (!state.privacyAgreed) {
      const agreeBtn = Array.from(document.querySelectorAll('button.app-dialog__footer-button')).find(
        b => norm(b.textContent) === 'agree' && isElementVisible(b)
      );
      if (agreeBtn) {
        agreeBtn.click();
        state.privacyAgreed = true;
        log('✅ Goldman Sachs : modale vie privée acceptée (Agree)', 1);
        await sleep(500);
      }
    }

    // Email — sélecteurs confirmés par analyse DOM réelle
    const emailInput = findBySelectors([
      'input#primary-email-0',
      'input[name="primary-email"]',
      'input[type="email"]',
      'input[aria-label*="Email Address" i]'
    ]);
    auditAndFill('Email', emailInput, profile.auth_email || profile.email || '');

    // T&C checkbox — id confirmé : legal-disclaimer-checkbox
    const checkbox = findBySelectors([
      'input#legal-disclaimer-checkbox',
      'input[type="checkbox"]',
      '[role="checkbox"]'
    ]);
    if (checkbox) {
      const checked = checkbox.checked || checkbox.getAttribute('aria-checked') === 'true';
      if (!checked) {
        checkbox.click();
        log('✅ Terms and conditions : case cochée', 1);
      } else {
        log('✅ Terms and conditions : déjà cochée -> Skip', 1);
      }
    } else {
      log('⚠️ Terms and conditions : checkbox introuvable', 1);
    }

    // Bouton Next
    const nextBtn = findBySelectors([
      'button.apply-flow-pagination__button.theme-color-1',
      'button.apply-flow-pagination__button'
    ]);
    const nextByText = findButtonByText('Next');
    const btn = (nextBtn && isElementVisible(nextBtn)) ? nextBtn : nextByText;

    if (btn && !state.emailSubmitted) {
      await sleep(400);
      state.emailSubmitted = true;
      btn.click();
      log('➡️ Goldman Sachs : clic sur Next après saisie email');
      ensureBanner('📧 Goldman Sachs — Vérifiez votre boîte email et cliquez le lien reçu (ou entrez le code). Taleos reprend automatiquement.');
    }
  }

  async function handleSection1(profile) {
    ensureBanner('⏳ Automatisation Taleos — Goldman Sachs : section 1 (documents & infos)...');
    const report = blueprint?.getStructureReport?.('section_1');
    if (report) log(`Blueprint GS section 1: ${report.ok ? 'OK' : 'KO'} (${report.matchedSelectors.length} sélecteurs)`);
    log('🧾 Goldman Sachs → audit Firebase vs formulaire (section 1)');

    // Email pré-rempli (vérification/correction)
    const emailInput = findBySelectors(['input[type="email"]', 'input#primary-email-0', 'input[name="primary-email"]']);
    if (emailInput) auditAndFill('Email', emailInput, profile.auth_email || profile.email || '');

    // LinkedIn URL
    const linkedinInput = findBySelectors([
      'input[aria-label*="LinkedIn" i]',
      'input[placeholder*="linkedin" i]',
      'input[id*="linkedin" i]',
      'input[name*="linkedin" i]'
    ]);
    auditAndFill('LinkedIn URL', linkedinInput, profile.linkedin_url || '');

    // ── Attachments — one-shot : supprimer tout puis réuploader ─────────────
    if (!state.attachmentsCleared) {
      state.attachmentsCleared = true;
      await removeAllAttachments();
      state.resumeUploadDone = false;
      state.coverUploadDone = false;
    }

    // CV / Resume — cherché par zone "resume" (pas d'ID fixe Oracle)
    await ensureUpload({
      label: 'CV',
      storagePath: profile.cv_storage_path,
      filename: profile.cv_filename,
      keyword: 'resume',
      doneFlag: 'resumeUploadDone'
    });

    // Lettre de motivation — cherché par zone "cover letter"
    // Supporte les deux nommages Firebase (letter_* et lm_*)
    await ensureUpload({
      label: 'Lettre de motivation',
      storagePath: profile.letter_storage_path || profile.lm_storage_path,
      filename: profile.letter_filename || profile.lm_filename,
      keyword: 'cover letter',
      doneFlag: 'coverUploadDone'
    });

    // T&C checkbox (peut réapparaître en section 1)
    const checkbox = findBySelectors(['input#legal-disclaimer-checkbox', 'input[type="checkbox"]']);
    if (checkbox && !checkbox.checked) {
      checkbox.click();
      log('✅ Terms and conditions section 1 : case cochée', 1);
    }

    // Bouton Next
    const nextBtn = findButtonByText('Next');
    if (nextBtn && !state.nextSection1) {
      await sleep(500);
      state.nextSection1 = true;
      nextBtn.click();
      log('➡️ Goldman Sachs : section 1 validée, clic sur Next');
    }
  }

  async function handleSection2(profile) {
    ensureBanner('⏳ Automatisation Taleos — Goldman Sachs : section 2 (questions)...');
    const report = blueprint?.getStructureReport?.('section_2');
    if (report) log(`Blueprint GS section 2: ${report.ok ? 'OK' : 'KO'} (${report.matchedSelectors.length} sélecteurs)`);
    log('🧾 Goldman Sachs → audit Firebase vs formulaire (section 2)');

    // ── Expérience ──────────────────────────────────────────────────────────
    const expMap = {
      '< 1 an':    'Less than 1 year',
      '1 - 5 ans': '1 - 3 years',
      '6 - 10 ans':'3+ years',
      '> 10 ans':  '3+ years'
    };
    const expValue = expMap[profile.experience_level] || '3+ years';
    auditAndClickPill('Années d\'expérience', 'years of relevant experience', expValue);

    // ── Work Authorization ──────────────────────────────────────────────────
    auditAndClickPill('Work auth pays', 'work authorisation for the countries', 'Yes');

    const authTypes = Array.isArray(profile.work_authorization_type) ? profile.work_authorization_type : [];
    for (const authType of authTypes) {
      auditAndClickPill(`Work auth type: ${authType}`, 'which of the following apply to you', authType);
    }

    auditAndClickPill('Visa sponsorship', 'require visa sponsorship', 'No');

    // ── Disclosures ─────────────────────────────────────────────────────────
    // GS history (réutilise profile.deloitte_worked pour l'instant — champ dédié GS à créer si besoin)
    const gsHistoryValue = profile.gs_previously_worked === 'yes'
      ? 'Yes - Full Time Employee'
      : (profile.gs_previously_interned === 'yes' ? 'Yes - Intern' : 'No');
    auditAndClickPill('GS history', 'previously interned or worked at goldman sachs', gsHistoryValue);

    auditAndClickPill('PwC/Mazars', 'pricewaterhousecoopers', 'No');
    auditAndClickPill('Contingent worker', 'current contingent worker at goldman sachs', 'No');
    auditAndClickPill('Government/regulatory', 'government, regulatory, or intergovernmental', 'No');

    // ── Diversité / Identité ────────────────────────────────────────────────
    const diversityConsent = profile.gs_diversity_consent || 'I do not consent';
    auditAndClickPill('Consentement diversité', 'sexual orientation and gender identity data', diversityConsent);

    if (norm(diversityConsent).includes('consent') && !norm(diversityConsent).includes('do not')) {
      // Remplir les champs diversité uniquement si consentement donné
      auditAndClickPill('Genre', 'please indicate your gender', profile.gender || 'Prefer not to say');
      auditAndClickPill('Transgenre', 'identify as transgender', profile.gs_transgender || 'I prefer not to say');
      auditAndClickPill('Orientation sexuelle', 'please indicate your sexual orientation', profile.gs_sexual_orientation || 'Prefer not to say');
      auditAndClickPill('Pronoms', 'please indicate your pronouns', profile.pronouns || 'Prefer Not To Say');
    }

    auditAndClickPill('Handicap', 'consider yourself to have a disability', profile.gs_disability || 'Prefer not to say');

    // Race / Ethnicité (OJ combobox)
    if (profile.gs_race_ethnicity) {
      await fillOJCombobox('race / ethnicity', profile.gs_race_ethnicity);
      if (profile.gs_race_ethnicity === 'Two or more races') {
        const origins = Array.isArray(profile.gs_race_additional_origins) ? profile.gs_race_additional_origins : [];
        for (let i = 0; i < origins.length && i < 3; i++) {
          await fillOJCombobox(`Additional origin ${i + 1}`, origins[i]);
        }
      }
    }

    // ── Bouton Next ─────────────────────────────────────────────────────────
    await sleep(300);
    const nextBtn = findButtonByText('Next');
    if (nextBtn && !state.nextSection2) {
      state.nextSection2 = true;
      nextBtn.click();
      log('➡️ Goldman Sachs : section 2 validée, clic sur Next');
    }
  }

  async function handleSection3(profile) {
    ensureBanner('⏳ Automatisation Taleos — Goldman Sachs : section 3 (langues & signature)...');
    const report = blueprint?.getStructureReport?.('section_3');
    if (report) log(`Blueprint GS section 3: ${report.ok ? 'OK' : 'KO'} (${report.matchedSelectors.length} sélecteurs)`);
    log('🧾 Goldman Sachs → audit Firebase vs formulaire (section 3)');

    // ── Langues ─────────────────────────────────────────────────────────────
    const languages = Array.isArray(profile.languages) ? profile.languages : [];
    const langMap = {
      'Français': 'French', 'Anglais': 'English', 'Espagnol': 'Spanish',
      'Allemand': 'German', 'Italien': 'Italian', 'Portugais': 'Portuguese',
      'Mandarin': 'Mandarin', 'Japonais': 'Japanese', 'Arabe': 'Arabic'
    };
    const pageText = norm(document.body?.innerText || '');

    for (const lang of languages) {
      const langName = langMap[lang.language] || lang.language || lang.name || '';
      if (!langName) continue;
      if (!pageText.includes(norm(langName))) {
        const addBtn = findButtonByText('Add Language') || findButtonByText('ADD LANGUAGE');
        if (addBtn) {
          addBtn.click();
          await sleep(600);
          await fillOJCombobox('language', langName);
          // Niveau de langue si présent
          if (lang.level || lang.proficiency) {
            const levelMap = {
              'Natif': 'Native', 'Courant': 'Fluent', 'Avancé': 'Advanced',
              'Intermédiaire': 'Intermediate', 'Débutant': 'Beginner'
            };
            const level = levelMap[lang.level] || levelMap[lang.proficiency] || lang.level || lang.proficiency || '';
            if (level) await fillOJCombobox('proficiency', level);
          }
          log(`✅ Langue ajoutée : ${langName}`, 1);
        } else {
          log(`⚠️ Langue : bouton "Add Language" introuvable`, 1);
        }
      } else {
        log(`✅ Langue présente : ${langName} -> Skip`, 1);
      }
    }

    // ── E-Signature Full Name ────────────────────────────────────────────────
    // Utilise first_name/last_name (snake_case Firebase) avec fallback legacy
    const firstName = profile.first_name || profile.firstname || '';
    const lastName = profile.last_name || profile.lastname || '';
    const fullName = `${firstName} ${lastName}`.trim();

    const signatureInput = findBySelectors([
      'input[name="fullName"]',
      'input[aria-label*="full name" i]',
      'input[placeholder*="full name" i]',
      'input[id*="fullName" i]'
    ]);
    auditAndFill('E-Signature (Full Name)', signatureInput, fullName);

    // ── Submit ───────────────────────────────────────────────────────────────
    await sleep(500);
    const submitBtn = findButtonByText('Submit') || findButtonByText('SUBMIT');
    if (submitBtn && !state.submitSection3) {
      state.submitSection3 = true;
      submitBtn.click();
      log('🚀 Goldman Sachs : clic final sur Submit');
    }
  }

  async function handleSuccess(pending) {
    if (state.successSent) return;

    const hasToast = blueprint?.checkToast?.() ||
      !!(document.querySelector('div.notifications[role="alert"]')?.innerText?.toLowerCase().includes('thank you for your job application'));
    const jobId = pending.jobId || '';
    const hasListEntry = blueprint?.checkApplicationInList?.(jobId) ||
      (/\/my-profile/i.test(location.pathname) && document.body?.innerText?.includes('Application Submitted'));

    if (!hasToast && !hasListEntry) return;

    state.successSent = true;
    log(`🎉 Succès Goldman Sachs : ${hasToast ? 'Toast "Thank you..."' : 'My Applications / Application Submitted'}`);

    await chrome.runtime.sendMessage({
      action: 'candidature_success',
      bankId: 'goldman_sachs',
      jobId: pending.jobId || '',
      jobTitle: pending.jobTitle || '',
      companyName: 'Goldman Sachs',
      offerUrl: pending.offerUrl || location.href,
      successType: hasToast ? 'toast' : 'my_applications',
      successMessage: hasToast ? 'Thank you for your job application.' : 'Application Submitted'
    }).catch(() => null);

    await chrome.storage.local.remove([PENDING_KEY, TAB_KEY]);
  }

  // ─── Boucle principale ────────────────────────────────────────────────────────

  async function run() {
    if (isRunning) return;
    isRunning = true;
    try {
      const pending = await getPending();
      if (!pending) return;

      const profile = pending.profile || {};
      const detected = blueprint?.detectPage?.() || { key: 'unknown', label: 'Inconnue' };
      log(`🚀 Démarrage Goldman Sachs sur ${detected.key} (${location.pathname})`);
      await blueprint?.recordLog?.({ page: detected.key, href: location.href });

      // Vérifier succès en premier
      await handleSuccess(pending);
      if (state.successSent) return;

      switch (detected.key) {
        case 'offer':      return await handleOfferPage();
        case 'email':      return await handleEmailStep(profile);
        case 'pin':
          // Code PIN — même logique que JP Morgan (l'utilisateur saisit manuellement)
          ensureBanner('📧 Goldman Sachs — Saisissez le code reçu par email puis Taleos reprend automatiquement.');
          log('🔐 Goldman Sachs → attente saisie code PIN par l\'utilisateur');
          return;
        case 'section_1':  return await handleSection1(profile);
        case 'section_2':  return await handleSection2(profile);
        case 'section_3':  return await handleSection3(profile);
        case 'already_applied':
          log('ℹ️ Goldman Sachs : candidature déjà soumise pour ce poste');
          return;
        case 'my_profile': return await handleSuccess(pending);
        default:
          log(`⚠️ Page non reconnue par le blueprint : '${detected.key}' (${location.href})`);
      }
    } catch (e) {
      log(`❌ Erreur Goldman Sachs : ${e?.message || e}`);
    } finally {
      isRunning = false;
    }
  }

  function init() {
    if (window.__taleosGsInit) return;
    window.__taleosGsInit = true;
    setInterval(run, 1500);
    const observer = new MutationObserver(() => {
      clearTimeout(window.__taleosGsDebounce);
      window.__taleosGsDebounce = setTimeout(run, 300);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    run();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
