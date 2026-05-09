(function () {
  'use strict';

  // Fonctionne sur les deux domaines GS : higher.gs.com (offre) + hdpc.fa.us2.oraclecloud.com (HCM)
  const GS_HOSTS = ['higher.gs.com', 'hdpc.fa.us2.oraclecloud.com'];
  if (!GS_HOSTS.some((h) => (location.hostname || '').includes(h))) return;

  const BANNER_ID    = 'taleos-gs-banner';
  const PENDING_KEY  = 'taleos_pending_goldman_sachs';
  const TAB_KEY      = 'taleos_gs_tab_id';
  const LOG_PREFIX   = '[Taleos Goldman Sachs]';
  const blueprint    = globalThis.__TALEOS_GOLDMAN_SACHS_BLUEPRINT__ || null;

  let isRunning = false;
  let currentTabIdPromise = null;
  let logged = new Set();
  let state = {
    emailSubmitted: false,
    nextSection1: false,
    nextSection2: false,
    submitSection3: false,
    resumeUploadDone: false,
    coverUploadDone: false,
    successSent: false
  };

  // ─── Utilitaires ─────────────────────────────────────────────────────────────

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function log(message, indent = 0) {
    const text = `${'   '.repeat(indent)}${message}`;
    if (logged.has(text)) return;
    logged.add(text);
    console.log(`${LOG_PREFIX} ${text}`);
  }

  function norm(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
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
        .then((res) => res?.tabId || null)
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

  function visible(selector, root = document) {
    try {
      return Array.from(root.querySelectorAll(selector)).find((el) => {
        const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
        const style = globalThis.getComputedStyle ? getComputedStyle(el) : null;
        return !!rect && rect.width > 0 && rect.height > 0 && style?.display !== 'none' && style?.visibility !== 'hidden';
      }) || null;
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
      log(`✅ ${label} : formulaire='${current || '(vide)'}' | Firebase='${desired || '(vide)'}' -> Skip`, 1);
      return true;
    }
    log(`✏️ ${label} : formulaire='${current || '(vide)'}' | Firebase='${desired || '(vide)'}' -> Correction`, 1);
    setInputValue(el, desired);
    return true;
  }

  function findBySelectors(selectors) {
    for (const sel of selectors) {
      const el = visible(sel) || document.querySelector(sel);
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

  /**
   * Cliquer un pill button Oracle JET par texte de question + texte de valeur.
   * Les pills GS n'ont pas d'attribut aria-checked fiable — on détecte la sélection
   * par la couleur de fond (classe CSS distincte ou inline style).
   */
  function findQuestionContainer(textNeedle) {
    const target = norm(textNeedle);
    const nodes = document.querySelectorAll(
      'section, fieldset, .oj-form-layout, .oj-panel, .oj-flex, [data-testid], div'
    );
    for (const node of nodes) {
      const text = norm(node.textContent || '');
      if (!text || !text.includes(target)) continue;
      const hasButtons = node.querySelector('button, [role="radio"], [aria-pressed]');
      if (hasButtons) return node;
    }
    return null;
  }

  function isPillSelected(pill) {
    // GS indique la sélection par le background — on détecte via computed style
    const style = globalThis.getComputedStyle ? getComputedStyle(pill) : null;
    const bg = style?.backgroundColor || '';
    // Bleu foncé GS sélectionné ≈ rgb(30,30,60) ou similaire — on vérifie si ≠ transparent/blanc
    const isWhiteOrTransparent = bg === 'rgba(0, 0, 0, 0)' || bg === '' || bg === 'transparent'
      || bg === 'rgb(255, 255, 255)';
    // Attributs alternatifs
    const ariaChecked = pill.getAttribute('aria-checked');
    const ariaPressed = pill.getAttribute('aria-pressed');
    const classSelected = pill.classList.contains('selected') || pill.classList.contains('oj-selected')
      || pill.classList.contains('is-selected');
    return (!isWhiteOrTransparent) || ariaChecked === 'true' || ariaPressed === 'true' || classSelected;
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
        log(`✅ ${label} : formulaire='${pill.innerText?.trim()}' | Firebase='${desiredValue}' -> Skip`, 1);
        return true;
      }
      log(`✏️ ${label} : formulaire='(autre)' | Firebase='${desiredValue}' -> Correction`, 1);
      pill.click();
      return true;
    }
    log(`⚠️ ${label} : option '${desiredValue}' introuvable pour "${questionText}"`, 1);
    return false;
  }

  async function fillOJCombobox(labelOrSelector, value) {
    if (!value) return false;
    let input = null;
    // Essai par sélecteur direct
    if (labelOrSelector.startsWith('#') || labelOrSelector.startsWith('[') || labelOrSelector.startsWith('.')) {
      input = visible(labelOrSelector) || document.querySelector(labelOrSelector);
    }
    // Sinon chercher par texte de label adjacent
    if (!input) {
      const target = norm(labelOrSelector);
      const labels = Array.from(document.querySelectorAll('label, span, div, oj-label')).filter((el) => {
        const text = norm(el.textContent || '');
        return text === target || text.includes(target);
      });
      for (const lbl of labels) {
        const root = lbl.closest('.oj-form-layout, .oj-flex-item, .oj-form, .oj-panel, .oj-flex, div') || lbl.parentElement;
        const found = root?.querySelector?.('input[role="combobox"], input[type="text"], [role="combobox"] input');
        if (found) { input = found; break; }
      }
    }
    if (!input) { log(`⚠️ OJ Combobox '${labelOrSelector}' : champ introuvable`, 1); return false; }

    const current = getValue(input);
    if (norm(current) === norm(value)) {
      log(`✅ OJ Combobox '${labelOrSelector}' : formulaire='${current}' | Firebase='${value}' -> Skip`, 1);
      return true;
    }
    log(`✏️ OJ Combobox '${labelOrSelector}' : formulaire='${current}' | Firebase='${value}' -> Correction`, 1);
    // Injection de la valeur + ouverture dropdown + clic option
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(400);
    // Cliquer sur la première option correspondante
    const options = Array.from(document.querySelectorAll('[role="option"], li[role="option"], .oj-listbox-result, .oj-listview-item'));
    const match = options.find((el) => norm(el.textContent || '') === norm(value) || norm(el.textContent || '').includes(norm(value)));
    if (match) {
      match.click();
      await sleep(300);
      return true;
    }
    // Fallback : touche Enter
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    await sleep(200);
    return true;
  }

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

  async function ensureAttachment({ label, storagePath, filename, inputSelector, doneFlag }) {
    if (!storagePath) { log(`⏭️ ${label} : aucun fichier Firebase`, 1); return false; }
    if (state[doneFlag]) return true;

    // Vérifier si un fichier est déjà uploadé (nom affiché dans le DOM)
    const existingName = document.querySelector('[class*="file-name"], [class*="attachment-name"], [class*="upload-name"]');
    if (existingName && norm(existingName.textContent).includes(norm(filename || ''))) {
      log(`✅ ${label} : fichier déjà présent -> Skip`, 1);
      state[doneFlag] = true;
      return true;
    }

    // Chercher l'input file par sélecteur ou par zone contextuelle
    let input = null;
    if (inputSelector) {
      input = visible(inputSelector) || document.querySelector(inputSelector);
    }
    if (!input) {
      input = visible('input[type="file"]') || document.querySelector('input[type="file"]');
    }
    if (!input) { log(`⚠️ ${label} : champ upload introuvable`, 1); return false; }

    const ok = await setFileInputFromStorage(input, storagePath, filename);
    if (ok) {
      state[doneFlag] = true;
      log(`✅ ${label} : ${filename || storagePath.split('/').pop()} (Firebase Storage)`, 1);
      await sleep(700);
      return true;
    }
    return false;
  }

  // ─── Handlers par page ───────────────────────────────────────────────────────

  async function handleOfferPage() {
    ensureBanner('⏳ Automatisation Taleos — Goldman Sachs : navigation vers le formulaire...');
    const applyBtn = findButtonByText('Apply') || findButtonByText('Apply Now')
      || Array.from(document.querySelectorAll('a, button')).find((el) => /\bapply\b/i.test(el.textContent || ''));
    if (applyBtn) {
      applyBtn.click();
      log('🔗 Goldman Sachs → clic sur Apply');
    } else {
      log('⚠️ Goldman Sachs → bouton Apply introuvable sur la page offre');
    }
  }

  async function handleOtpEmailStep(profile) {
    ensureBanner('⏳ Automatisation Taleos — Goldman Sachs : saisie de l\'email...');
    const report = blueprint?.getStructureReport?.('otp_email');
    if (report) log(`Blueprint GS email: ${report.ok ? 'OK' : 'KO'} (${report.matchedSelectors.length} sélecteurs)`);

    const emailInput = findBySelectors(['input[type="email"]', 'input[id*="email" i]', 'input[aria-label*="Email" i]']);
    auditAndFill('Email', emailInput, profile.email || profile.auth_email);

    const nextBtn = findButtonByText('Next');
    if (nextBtn && !state.emailSubmitted) {
      await sleep(300);
      state.emailSubmitted = true;
      nextBtn.click();
      log('➡️ Goldman Sachs : clic sur Next après saisie email');
      // Le code OTP sera envoyé par email — l'utilisateur le saisira manuellement
      ensureBanner('📧 Code OTP Goldman Sachs envoyé par email — saisissez-le sur la page puis Taleos reprend automatiquement.');
    }
  }

  async function handleSection1(profile) {
    ensureBanner('⏳ Automatisation Taleos — Goldman Sachs : section 1 (documents & infos)...');
    const report = blueprint?.getStructureReport?.('section1');
    if (report) log(`Blueprint GS section 1: ${report.ok ? 'OK' : 'KO'} (${report.matchedSelectors.length} sélecteurs)`);
    log('🧾 Goldman Sachs → audit Firebase vs formulaire (section 1)');

    // Email (pré-rempli)
    const emailInput = findBySelectors(['input[type="email"]']);
    if (emailInput) {
      auditAndFill('Email', emailInput, profile.email || profile.auth_email);
    }

    // LinkedIn URL
    const linkedinInput = findBySelectors([
      'input[aria-label*="LinkedIn" i]',
      'input[placeholder*="linkedin" i]',
      'input[id*="linkedin" i]'
    ]);
    auditAndFill('LinkedIn URL', linkedinInput, profile.linkedin_url || '');

    // CV / Resume — input#attachment-upload-50
    await ensureAttachment({
      label: 'CV',
      storagePath: profile.cv_storage_path,
      filename: profile.cv_filename,
      inputSelector: 'input#attachment-upload-50',
      doneFlag: 'resumeUploadDone'
    });

    // Lettre de motivation — input#attachment-upload-7
    await ensureAttachment({
      label: 'Lettre de motivation',
      storagePath: profile.lm_storage_path,
      filename: profile.lm_filename,
      inputSelector: 'input#attachment-upload-7',
      doneFlag: 'coverUploadDone'
    });

    // T&C checkbox
    const checkbox = findBySelectors(['input[type="checkbox"]', '[role="checkbox"]']);
    if (checkbox) {
      const checked = checkbox.checked || checkbox.getAttribute('aria-checked') === 'true';
      if (!checked) {
        checkbox.click();
        log('✅ Terms and conditions : case cochée', 1);
      } else {
        log('✅ Terms and conditions : case déjà cochée -> Skip', 1);
      }
    } else {
      log('⚠️ Terms and conditions : checkbox introuvable', 1);
    }

    // Bouton NEXT
    const nextBtn = findButtonByText('Next');
    if (nextBtn && !state.nextSection1) {
      await sleep(500);
      state.nextSection1 = true;
      nextBtn.click();
      log('➡️ Goldman Sachs : section 1 validée, clic sur Next');
    }
  }

  async function handleSection2(profile) {
    ensureBanner('⏳ Automatisation Taleos — Goldman Sachs : section 2 (questions de candidature)...');
    const report = blueprint?.getStructureReport?.('section2');
    if (report) log(`Blueprint GS section 2: ${report.ok ? 'OK' : 'KO'} (${report.matchedSelectors.length} sélecteurs)`);
    log('🧾 Goldman Sachs → audit Firebase vs formulaire (section 2)');

    // — EXPÉRIENCE —
    const expMap = {
      '< 1 an': 'Less than 1 year',
      '1 - 5 ans': '1 - 3 years',
      '6 - 10 ans': '3+ years',
      '> 10 ans': '3+ years'
    };
    const expValue = expMap[profile.experience_level] || '3+ years';
    auditAndClickPill('Années d\'expérience', 'years of relevant experience', expValue);

    // — WORK AUTHORIZATION —
    auditAndClickPill('Work auth (pays)', 'work authorisation for the countries', 'Yes');

    // work_authorization_type : liste multi-sélection (ex. ["National", "EEA/Swiss National..."])
    const authTypes = Array.isArray(profile.work_authorization_type) ? profile.work_authorization_type : [];
    for (const authType of authTypes) {
      auditAndClickPill(`Work auth type: ${authType}`, 'which of the following apply to you', authType);
    }

    // Visa sponsorship
    auditAndClickPill('Visa sponsorship', 'require visa sponsorship', 'No');

    // — DISCLOSURES —
    // GS history
    const gsWorked = profile.deloitte_worked === 'yes' ? 'Yes - Full Time Employee' : 'No';
    auditAndClickPill('GS history', 'previously interned or worked at goldman sachs', gsWorked);
    // PwC / Mazars
    auditAndClickPill('PwC/Mazars', 'pricewaterhousecoopers', 'No');
    // Contingent worker
    auditAndClickPill('Contingent worker', 'current contingent worker at goldman sachs', 'No');
    // Government/regulatory
    auditAndClickPill('Government/regulatory', 'government, regulatory, or intergovernmental', 'No');

    // — DIVERSITÉ / IDENTITÉ —
    const diversityConsent = profile.gs_diversity_consent || 'I do not consent';
    auditAndClickPill('Consentement diversité', 'sexual orientation and gender identity data', diversityConsent);
    auditAndClickPill('Genre', 'please indicate your gender', profile.gender || 'Prefer not to say');
    auditAndClickPill('Transgenre', 'identify as transgender', profile.gs_transgender || 'I prefer not to say');
    auditAndClickPill('Orientation sexuelle', 'please indicate your sexual orientation', profile.gs_sexual_orientation || 'Prefer not to say');
    auditAndClickPill('Pronoms', 'please indicate your pronouns', profile.pronouns || 'Prefer Not To Say');
    auditAndClickPill('Handicap', 'consider yourself to have a disability', profile.gs_disability || 'Prefer not to say');

    // — RACE / ETHNICITÉ — (OJ combobox)
    await fillOJCombobox('race / ethnicity', profile.gs_race_ethnicity || '');
    // Si "Two or more races" → remplir origines additionnelles
    if (profile.gs_race_ethnicity === 'Two or more races') {
      const origins = Array.isArray(profile.gs_race_additional_origins) ? profile.gs_race_additional_origins : [];
      for (let i = 0; i < origins.length && i < 3; i++) {
        await fillOJCombobox(`Additional origin ${i + 1}`, origins[i]);
      }
    }

    // — Bouton NEXT —
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
    const report = blueprint?.getStructureReport?.('section3');
    if (report) log(`Blueprint GS section 3: ${report.ok ? 'OK' : 'KO'} (${report.matchedSelectors.length} sélecteurs)`);
    log('🧾 Goldman Sachs → audit Firebase vs formulaire (section 3)');

    // Langues — vérifier les langues déjà présentes, ajouter les manquantes
    const languages = Array.isArray(profile.languages) ? profile.languages : [];
    if (languages.length > 0) {
      // Compter les lignes langue existantes
      const languageRows = document.querySelectorAll('[class*="language-row"], [class*="language-item"], .oj-flex-item');
      const existingCount = languageRows.length;
      const languageMap = { 'Français': 'French', 'Anglais': 'English', 'Espagnol': 'Spanish', 'Allemand': 'German', 'Italien': 'Italian', 'Portugais': 'Portuguese' };
      for (const lang of languages) {
        const langName = languageMap[lang.language] || lang.language || lang.name || '';
        if (!langName) continue;
        // Vérifier si déjà présente
        const pageText = norm(document.body?.innerText || '');
        if (!pageText.includes(norm(langName))) {
          // Ajouter langue
          const addBtn = findButtonByText('Add Language') || findButtonByText('ADD LANGUAGE');
          if (addBtn) {
            addBtn.click();
            await sleep(500);
            await fillOJCombobox('language', langName);
            log(`✅ Langue ajoutée : ${langName}`, 1);
          }
        } else {
          log(`✅ Langue présente : ${langName} -> Skip`, 1);
        }
      }
    }

    // E-Signature : "Full Name"
    const fullName = `${profile.firstname || ''} ${(profile.lastname || '').toUpperCase()}`.trim();
    const signatureInput = findBySelectors([
      'input[id*="fullName" i]',
      'input[aria-label*="Full Name" i]',
      'input[placeholder*="full name" i]'
    ]) || findFieldByLabel('Full Name');
    auditAndFill('E-Signature (Full Name)', signatureInput, fullName);

    // — SUBMIT —
    await sleep(500);
    const submitBtn = findButtonByText('Submit') || findButtonByText('SUBMIT');
    if (submitBtn && !state.submitSection3) {
      state.submitSection3 = true;
      submitBtn.click();
      log('🚀 Goldman Sachs : clic final sur Submit');
    }
  }

  function findFieldByLabel(labelNeedle) {
    const target = norm(labelNeedle);
    const labels = Array.from(document.querySelectorAll('label, span, div, oj-label')).filter((el) => {
      const text = norm(el.textContent || '');
      return el.children.length === 0 && text === target;
    });
    for (const label of labels) {
      const forId = label.getAttribute?.('for');
      if (forId) {
        const direct = document.getElementById(forId);
        if (direct) return direct;
      }
      const root = label.closest('.oj-form-layout, .oj-flex-item, .oj-form, div') || label.parentElement;
      const field = root?.querySelector?.('input[type="text"], input[type="email"], textarea');
      if (field) return field;
    }
    return null;
  }

  async function handleSuccess(pending) {
    if (state.successSent) return;

    // ① Toast
    const hasToast = blueprint?.checkToast?.() || (
      document.querySelector('div.notifications[role="alert"]')?.innerText?.includes('Thank you for your job application')
    );
    // ② Liste My Applications
    const jobId = pending.jobId || '';
    const hasListEntry = blueprint?.checkApplicationInList?.(jobId)
      || (/\/my-profile/i.test(location.pathname) && document.body?.innerText?.includes('Application Submitted'));

    if (!hasToast && !hasListEntry) return;

    state.successSent = true;
    log(`🎉 Succès Goldman Sachs détecté : ${hasToast ? 'Toast "Thank you..."' : 'My Applications / Application Submitted'}`);

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
      log(`🚀 Démarrage Goldman Sachs sur '${detected.key}' (${location.pathname})`);
      await blueprint?.recordLog?.({ page: detected.key, href: location.href });

      // Vérifier succès en premier (avant toute action)
      await handleSuccess(pending);
      if (state.successSent) return;

      switch (detected.key) {
        case 'offer':      return await handleOfferPage();
        case 'otp_email':  return await handleOtpEmailStep(profile);
        case 'section1':   return await handleSection1(profile);
        case 'section2':   return await handleSection2(profile);
        case 'section3':   return await handleSection3(profile);
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
    // Polling + MutationObserver pour réagir aux transitions Oracle HCM
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
