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

  // ── État session (one-shot guards) ──────────────────────────────────────────
  let state = {
    offerPageClicked:    false,   // one-shot : clic Apply sur higher.gs.com (évite onglets multiples)
    emailSubmitted:      false,
    privacyAgreed:       false,
    nextSection1:        false,
    nextSection2:        false,
    submitSection3:      false,
    alreadySent:         false,
    workAuthDone:        false,
    attachmentsCleared:  false,   // one-shot : suppression avant réupload
    resumeUploadDone:    false,
    coverUploadDone:     false,
    successSent:         false
  };

  // ─── Utilitaires ─────────────────────────────────────────────────────────────

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function log(message, indent = 0) {
    const text = `${'   '.repeat(indent)}${message}`;
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
      if (el) {
        console.log(`${LOG_PREFIX}    [findBySelectors] ✅ "${sel}" → <${el.tagName}${el.id ? '#' + el.id : ''}${el.className ? ' class="' + [...el.classList].slice(0, 3).join(' ') + '"' : ''}>`);
        return el;
      }
      console.log(`${LOG_PREFIX}    [findBySelectors] ❌ "${sel}" → rien`);
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

  function normPill(v) {
    // Normalise en ignorant les espaces, tirets, apostrophes, + et caractères spéciaux
    return String(v || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/['''‘’]/g, "'")
      .replace(/[-–—]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function findQuestionContainer(textNeedle) {
    const target = normPill(textNeedle);
    const PILL_SEL = 'button.cx-select-pill-section, button[aria-pressed], [role="radio"]';
    console.log(`${LOG_PREFIX}    [findQ] Recherche container pour : "${target}"`);

    // 1. Priorité : .input-row — container exact par question dans Oracle HCM CE
    const inputRows = document.querySelectorAll('.input-row');
    console.log(`${LOG_PREFIX}    [findQ] Strat 1 (.input-row) : ${inputRows.length} rows disponibles`);
    for (const row of inputRows) {
      const rowText = normPill(row.textContent || '');
      if (!rowText.includes(target)) continue;
      if (row.querySelector(PILL_SEL)) {
        const pills = row.querySelectorAll(PILL_SEL);
        console.log(`${LOG_PREFIX}    [findQ] ✅ Strat 1 → .input-row avec ${pills.length} pill(s) | texte="${rowText.slice(0, 80)}"`);
        return row;
      }
    }

    // 2. apply-flow-block dédié
    const blocks = document.querySelectorAll('apply-flow-block');
    console.log(`${LOG_PREFIX}    [findQ] Strat 2 (apply-flow-block) : ${blocks.length} blocs disponibles`);
    for (const block of blocks) {
      if (!normPill(block.textContent || '').includes(target)) continue;
      if (!block.querySelector(PILL_SEL)) continue;
      const pillCount = block.querySelectorAll('button.cx-select-pill-section').length;
      if (pillCount <= 6) {
        console.log(`${LOG_PREFIX}    [findQ] ✅ Strat 2 → apply-flow-block avec ${pillCount} pill(s) | class="${block.className}"`);
        return block;
      }
      console.log(`${LOG_PREFIX}    [findQ] ⏭️ Strat 2 : block ignoré (${pillCount} pills > 6)`);
    }

    // 3. Fallback TreeWalker
    console.log(`${LOG_PREFIX}    [findQ] Strat 3 (TreeWalker) en cours...`);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (!normPill(walker.currentNode.textContent || '').includes(target)) continue;
      let el = walker.currentNode.parentElement;
      while (el && el !== document.body) {
        if (el.querySelector(PILL_SEL)) {
          const pills = el.querySelectorAll(PILL_SEL);
          console.log(`${LOG_PREFIX}    [findQ] ✅ Strat 3 (TreeWalker) → <${el.tagName} class="${[...el.classList].slice(0, 3).join(' ')}">, ${pills.length} pill(s)`);
          return el;
        }
        el = el.parentElement;
      }
    }

    console.log(`${LOG_PREFIX}    [findQ] ❌ Aucun container trouvé pour "${target}"`);
    return null;
  }

  function isPillSelected(pill, verbose = false) {
    if (pill.getAttribute('aria-checked') === 'true') {
      if (verbose) console.log(`${LOG_PREFIX}       [isPillSelected] ✅ aria-checked=true`);
      return true;
    }
    if (pill.getAttribute('aria-pressed') === 'true') {
      if (verbose) console.log(`${LOG_PREFIX}       [isPillSelected] ✅ aria-pressed=true`);
      return true;
    }
    const cls = pill.classList;
    if (cls.contains('cx-select-pill-section--selected') ||
        cls.contains('selected') || cls.contains('oj-selected') || cls.contains('is-selected')) {
      if (verbose) console.log(`${LOG_PREFIX}       [isPillSelected] ✅ class sélection détectée : ${[...cls].join(' ')}`);
      return true;
    }
    const style = globalThis.getComputedStyle ? getComputedStyle(pill) : null;
    const bg = style?.backgroundColor || '';
    const unselected = ['rgba(0, 0, 0, 0)', '', 'transparent', 'rgb(255, 255, 255)'];
    const result = !unselected.includes(bg);
    if (verbose) console.log(`${LOG_PREFIX}       [isPillSelected] bg="${bg}" → ${result ? '✅ SELECTED (bgcolor)' : '⬜ non-sélectionné'}`);
    return result;
  }

  async function auditAndClickPill(label, questionText, desiredValue) {
    if (!desiredValue) { console.log(`${LOG_PREFIX}    [auditAndClickPill] "${label}" skippé (desiredValue vide)`); return false; }
    console.log(`${LOG_PREFIX}    [auditAndClickPill] ── "${label}" | question="${questionText}" | cible="${desiredValue}" ──`);

    const container = findQuestionContainer(questionText);
    if (!container) {
      log(`⚠️ ${label} : section "${questionText}" introuvable`, 1);
      return false;
    }

    const pills = Array.from(container.querySelectorAll('button, [role="radio"], [role="button"], [aria-pressed]'));
    console.log(`${LOG_PREFIX}    [auditAndClickPill] ${pills.length} pill(s) dans le container :`);
    pills.forEach((p, i) => {
      const txt = (p.innerText || p.textContent || '').replace(/\s+/g, ' ').trim();
      const sel = isPillSelected(p, false);
      console.log(`${LOG_PREFIX}       [pill ${i}] "${txt}" | aria-pressed=${p.getAttribute('aria-pressed')} | aria-checked=${p.getAttribute('aria-checked')} | selected=${sel} | bg="${(getComputedStyle(p).backgroundColor || '')}"`);
    });

    const target = normPill(desiredValue);
    const pill = pills.find(p => {
      const t = normPill(p.innerText || p.textContent || '');
      return t && (t === target || t.startsWith(target) || target.startsWith(t));
    });
    if (!pill) {
      log(`⚠️ ${label} : option '${desiredValue}' introuvable pour "${questionText}"`, 1);
      console.log(`${LOG_PREFIX}    [auditAndClickPill] target normalisé="${target}" — aucun match parmi : ${pills.map(p => `"${normPill(p.innerText || p.textContent || '')}"`).join(', ')}`);
      return false;
    }
    console.log(`${LOG_PREFIX}    [auditAndClickPill] Pill match trouvé : "${(pill.innerText || '').trim()}"`);
    if (isPillSelected(pill, true)) {
      log(`✅ ${label} : '${(pill.innerText || '').trim()}' -> déjà sélectionné, Skip`, 1);
      return true;
    }
    log(`✏️ ${label} : clic sur '${desiredValue}'`, 1);
    // Oracle CE nécessite mousedown + mouseup + click pour enregistrer la sélection
    for (const type of ['mousedown', 'mouseup', 'click']) {
      pill.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    await sleep(200);
    // Vérifier l'état après clic
    const nowSelected = isPillSelected(pill, true);
    console.log(`${LOG_PREFIX}    [auditAndClickPill] État après clic : ${nowSelected ? '✅ sélectionné' : '⚠️ toujours non-sélectionné'}`);
    return true;
  }

  // ── OJ Combobox (Oracle JET dropdown) ────────────────────────────────────────

  async function fillOJCombobox(labelOrSelector, value) {
    if (!value) return false;
    console.log(`${LOG_PREFIX}    [fillOJCombobox] ── label/selector="${labelOrSelector}" | valeur cible="${value}" ──`);
    let input = null;
    if (labelOrSelector.startsWith('#') || labelOrSelector.startsWith('[') || labelOrSelector.startsWith('.')) {
      input = visible(labelOrSelector) || document.querySelector(labelOrSelector);
      console.log(`${LOG_PREFIX}    [fillOJCombobox] Sélecteur CSS direct → ${input ? `<${input.tagName}${input.id ? '#' + input.id : ''} value="${input.value}">` : 'null'}`);
    }
    if (!input) {
      const target = norm(labelOrSelector);
      const labels = Array.from(document.querySelectorAll('label, oj-label')).filter((el) => {
        return norm(el.textContent || '') === target || norm(el.textContent || '').includes(target);
      });
      console.log(`${LOG_PREFIX}    [fillOJCombobox] ${labels.length} label(s) trouvé(s) pour "${target}"`);
      for (const lbl of labels) {
        const root = lbl.closest('.oj-form-layout, .oj-flex-item, .oj-form, .oj-panel, div') || lbl.parentElement;
        const found = root?.querySelector?.('input[role="combobox"], input[type="text"], [role="combobox"] input');
        if (found) { input = found; console.log(`${LOG_PREFIX}    [fillOJCombobox] Input trouvé via label : <${input.tagName}${input.id ? '#' + input.id : ''} value="${input.value}">`); break; }
      }
    }
    if (!input) { log(`⚠️ OJ Combobox '${labelOrSelector}' introuvable`, 1); return false; }

    const current = getValue(input);
    if (norm(current) === norm(value)) {
      log(`✅ OJ Combobox '${labelOrSelector}' : '${current}' -> Skip`, 1);
      return true;
    }
    log(`✏️ OJ Combobox '${labelOrSelector}' : '${current || '(vide)'}' -> '${value}'`, 1);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(500);
    // Lister toutes les options du dropdown
    const options = Array.from(document.querySelectorAll('[role="option"], li[role="option"], .oj-listbox-result, .oj-listview-item'));
    console.log(`${LOG_PREFIX}    [fillOJCombobox] ${options.length} option(s) dans le dropdown :`);
    options.slice(0, 25).forEach((o, i) => console.log(`${LOG_PREFIX}       [opt ${i}] "${(o.textContent || '').replace(/\s+/g, ' ').trim()}"`));
    if (options.length > 25) console.log(`${LOG_PREFIX}       ... et ${options.length - 25} autres`);
    const match = options.find(el => norm(el.textContent || '').includes(norm(value)));
    if (match) {
      console.log(`${LOG_PREFIX}    [fillOJCombobox] ✅ Match sélectionné : "${(match.textContent || '').trim()}"`);
      for (const type of ['mousedown', 'mouseup', 'click']) {
        match.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      }
      await sleep(300);
      return true;
    }
    console.log(`${LOG_PREFIX}    [fillOJCombobox] ⚠️ Aucune option ne contient "${norm(value)}" — fallback Enter`);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    await sleep(200);
    return true;
  }

  // ─── Handlers par page ───────────────────────────────────────────────────────

  async function handleOfferPage() {
    if (state.offerPageClicked) return;

    ensureBanner('⏳ Automatisation Taleos — Goldman Sachs : navigation vers le formulaire...');

    // Cas 1 : lien <a href="...hdpc.fa.us2.oraclecloud.com/.../apply/email"> directement accessible.
    // On utilise location.href pour rester dans le MÊME onglet (le lien a target="_blank").
    const applyLink = document.querySelector('a[href*="hdpc.fa.us2.oraclecloud.com"][href*="/apply/"]')
      || document.querySelector('a[href*="hdpc.fa.us2.oraclecloud.com"]');
    if (applyLink?.href) {
      state.offerPageClicked = true;
      log('🔗 Goldman Sachs → injection href dans onglet courant : ' + applyLink.href);
      location.href = applyLink.href;
      return;
    }

    // Cas 2 : bouton Apply GS (JS-driven, ouvre window.open).
    // On intercepte window.open pour récupérer l'URL et naviguer dans l'onglet courant.
    const applyBtn = Array.from(document.querySelectorAll('a, button')).find(
      el => /^\s*apply\s*$/i.test(el.textContent || '') && isElementVisible(el)
    );
    if (applyBtn) {
      state.offerPageClicked = true;
      log('🔗 Goldman Sachs → interception window.open via bouton Apply');
      const origOpen = window.open.bind(window);
      window.open = function (url, target, features) {
        window.open = origOpen; // restaurer immédiatement
        if (url) {
          log('🔗 Goldman Sachs → window.open intercepté → location.href = ' + url);
          location.href = url;
        } else {
          origOpen(url, target, features);
        }
      };
      applyBtn.click();
      // Timeout de sécurité : si window.open n'a pas été appelé en 3 s, restaurer
      setTimeout(() => { if (window.open !== origOpen) window.open = origOpen; }, 3000);
    } else {
      log('⚠️ Goldman Sachs → lien/bouton Apply introuvable sur la page offre');
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

    // Si la page n'est pas encore prête (0 sélecteurs reconnus), on attend le prochain tick
    // plutôt que de procéder et cliquer Next sur un formulaire vide.
    if (!report?.ok) {
      log('⏳ Section 1 : page pas encore prête — nouveau tick dans 1.5s...');
      return;
    }

    log('🧾 Goldman Sachs → audit Firebase vs formulaire (section 1)');
    console.log(`${LOG_PREFIX}    [Profile S1] email="${profile.auth_email || profile.email}" | linkedin="${profile.linkedin_url}" | cv_storage_path="${profile.cv_storage_path}" | cv_filename="${profile.cv_filename}" | letter_storage_path="${profile.letter_storage_path || profile.lm_storage_path}" | letter_filename="${profile.letter_filename || profile.lm_filename}"`);
    console.log(`${LOG_PREFIX}    [State S1] attachmentsCleared=${state.attachmentsCleared} | resumeUploadDone=${state.resumeUploadDone} | coverUploadDone=${state.coverUploadDone} | nextSection1=${state.nextSection1}`);

    // Email pré-rempli (vérification/correction)
    const emailInput = findBySelectors(['input[type="email"]', 'input#primary-email-0', 'input[name="primary-email"]']);
    if (emailInput) auditAndFill('Email', emailInput, profile.auth_email || profile.email || '');

    // LinkedIn URL
    const linkedinInput = findBySelectors([
      'input[aria-label*="LinkedIn" i]',
      'input[placeholder*="linkedin" i]',
      'input[id*="linkedin" i]',
      'input[name*="linkedin" i]',
      'input[name*="siteLink"]',   // GS: champ nommé siteLink-1, siteLink-2…
      'input[type="url"]'          // fallback générique
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
    console.log(`${LOG_PREFIX}    [Profile S2] experience_level="${profile.experience_level}" | gs_work_auth_type=${JSON.stringify(profile.gs_work_auth_type)} | work_authorization_type=${JSON.stringify(profile.work_authorization_type)} | gender="${profile.gender}" | gs_diversity_consent="${profile.gs_diversity_consent}" | gs_transgender="${profile.gs_transgender}" | gs_sexual_orientation="${profile.gs_sexual_orientation}" | gs_pronouns="${profile.gs_pronouns}" | pronouns="${profile.pronouns}" | gs_disability="${profile.gs_disability}" | gs_race_ethnicity="${profile.gs_race_ethnicity}" | gs_previously_worked="${profile.gs_previously_worked}" | gs_previously_interned="${profile.gs_previously_interned}"`);
    console.log(`${LOG_PREFIX}    [State S2] workAuthDone=${state.workAuthDone} | nextSection2=${state.nextSection2}`);

    // ── Expérience ──────────────────────────────────────────────────────────
    const expMap = {
      '< 1 an':    'Less than 1 year',
      '1 - 5 ans': '1 - 3 years',
      '6 - 10 ans':'3+ years',
      '> 10 ans':  '3+ years',
    };
    const expValue = expMap[profile.experience_level] || '3+ years';
    // Needle court pour matcher : "How many years of relevant work experience…"
    // et aussi "Years of relevant experience" (variations selon le posting)
    await auditAndClickPill('Années d\'expérience', 'years of relevant', expValue);

    // ── Work Authorization ──────────────────────────────────────────────────
    await auditAndClickPill('Work auth pays', 'work authorisation for the countries', 'Yes');
    // Attendre que la sous-question conditionnelle "which of the following" apparaisse
    await sleep(800);

    // Priorité : champ GS dédié gs_work_auth_type, sinon work_authorization_type générique
    // Valeurs attendues par GS : "National" | "Lawful Permanent Resident" |
    //   "EEA/Swiss National applying to work in an EEA location/Switzerland" |
    //   "Another Visa or Work / Residence Permit"
    // Radio group (choix unique) — on ne clique que la PREMIÈRE valeur, one-shot guard
    if (!state.workAuthDone) {
      const rawAuthTypes = profile.gs_work_auth_type || profile.work_authorization_type;
      const authTypesArr = Array.isArray(rawAuthTypes) ? rawAuthTypes : (rawAuthTypes ? [rawAuthTypes] : []);
      const authType = authTypesArr[0]; // radio → un seul choix
      if (authType) {
        const clicked = await auditAndClickPill(`Work auth type: ${authType}`, 'which of the following apply to you', authType);
        if (clicked) state.workAuthDone = true;
      }
    }

    await auditAndClickPill('Visa sponsorship', 'require visa sponsorship', 'No');

    // ── Disclosures ─────────────────────────────────────────────────────────
    const gsHistoryValue = profile.gs_previously_worked === 'yes'
      ? 'Yes - Full Time Employee'
      : (profile.gs_previously_interned === 'yes' ? 'Yes - Intern' : 'No');
    await auditAndClickPill('GS history', 'previously interned or worked at goldman sachs', gsHistoryValue);

    // PwC/Mazars — question longue, on cherche avec plusieurs needles
    const pwcClicked =
      await auditAndClickPill('PwC/Mazars', 'pricewaterhousecoopers, mazars', 'No') ||
      await auditAndClickPill('PwC/Mazars', 'pricewaterhousecoopers', 'No') ||
      await auditAndClickPill('PwC/Mazars', 'pwc', 'No');
    if (!pwcClicked) log('⚠️ PwC/Mazars : question introuvable', 1);

    await auditAndClickPill('Contingent worker', 'current contingent worker at goldman sachs', 'No');
    await auditAndClickPill('Government/regulatory', 'government, regulatory, or intergovernmental', 'No');

    // ── Genre (toujours présent, indépendant du consentement diversité) ─────
    await auditAndClickPill('Genre', 'please indicate your gender', profile.gender || 'Prefer not to say');

    // ── Diversité / Identité ────────────────────────────────────────────────
    const diversityConsent = profile.gs_diversity_consent || 'I do not consent';
    await auditAndClickPill('Consentement diversité', 'sexual orientation and gender identity data', diversityConsent);

    // Ces questions sont REQUISES même avec "I do not consent" — pas de garde consent
    await auditAndClickPill('Transgenre', 'identify as transgender', profile.gs_transgender || 'I prefer not to say');
    await auditAndClickPill('Orientation sexuelle', 'please indicate your sexual orientation', profile.gs_sexual_orientation || 'Prefer not to say');
    await auditAndClickPill('Pronoms', 'pronouns', profile.gs_pronouns || profile.pronouns || 'Prefer Not To Say');

    await auditAndClickPill('Handicap', 'consider yourself to have a disability', profile.gs_disability || 'Prefer not to say');

    // Race / Ethnicité (OJ combobox) — label réel peut être "Race/Ethnicity" (sans espaces)
    if (profile.gs_race_ethnicity) {
      await fillOJCombobox('Race/Ethnicity', profile.gs_race_ethnicity);
      if (profile.gs_race_ethnicity === 'Two or more races') {
        const origins = Array.isArray(profile.gs_race_additional_origins) ? profile.gs_race_additional_origins : [];
        for (let i = 0; i < origins.length && i < 3; i++) {
          await fillOJCombobox(`Additional origin ${i + 1}`, origins[i]);
        }
      }
    }

    // ── Langues (si présentes sur section 2 selon le posting) ─────────────────
    // Utiliser visible() pour ne pas matcher les boutons cachés (langues sur section/3)
    const addLangBtnS2 = visible('button') && Array.from(document.querySelectorAll('button'))
      .find(b => /add language/i.test(b.innerText) && isElementVisible(b));
    if (addLangBtnS2) {
      log('🌐 Section 2 : section langues visible détectée, traitement avant Next...');
      await handleLanguages(profile);
    }

    // ── E-Signature (si présente sur section 2 selon le posting) ──────────────
    const sig2Input = findBySelectors([
      'input[name="fullName"]', 'input[aria-label*="full name" i]',
      'input[placeholder*="full name" i]', 'input[id*="fullName" i]'
    ]);
    if (sig2Input) {
      const firstName = profile.first_name || profile.firstname || '';
      const lastName = profile.last_name || profile.lastname || '';
      auditAndFill('E-Signature (section 2)', sig2Input, `${firstName} ${lastName}`.trim());
    }

    // ── Bouton Next — attendre 2 s que Oracle enregistre toutes les sélections ──
    await sleep(2000);
    const nextBtn = findButtonByText('Next');
    if (nextBtn && !state.nextSection2) {
      state.nextSection2 = true;
      nextBtn.click();
      log('➡️ Goldman Sachs : section 2 validée, clic sur Next');
    }
  }

  // ── Langues & Proficiency (partagé section 2 et 3) ───────────────────────────
  const LANG_MAP = {
    'Français': 'French', 'Anglais': 'English', 'Espagnol': 'Spanish',
    'Allemand': 'German', 'Italien': 'Italian', 'Portugais': 'Portuguese',
    'Mandarin': 'Mandarin', 'Japonais': 'Japanese', 'Arabe': 'Arabic'
  };

  // GS HCM CE : proficiency via pill buttons (Reading, Writing, Speaking)
  // Speaking : None / Native / Fluent / Moderate / Conversational
  // Reading/Writing : Advanced / Intermediate / Basic
  const GS_SPEAK_MAP = {
    'Langue maternelle': 'Native',  'Natif': 'Native',   'Native': 'Native',
    'Bilingue': 'Fluent',           'Courant': 'Fluent',  'Fluent': 'Fluent',
    'Avancé': 'Moderate',           'Advanced': 'Moderate',
    'Intermédiaire': 'Conversational', 'Intermediate': 'Conversational',
    'Débutant': 'Conversational',   'Beginner': 'Conversational'
  };
  const GS_RW_MAP = {
    'Langue maternelle': 'Advanced', 'Natif': 'Advanced',   'Native': 'Advanced',
    'Bilingue': 'Advanced',          'Courant': 'Advanced',  'Fluent': 'Advanced',
    'Avancé': 'Intermediate',        'Advanced': 'Intermediate',
    'Intermédiaire': 'Intermediate', 'Intermediate': 'Intermediate',
    'Débutant': 'Basic',             'Beginner': 'Basic'
  };

  /** Clique un pill dans un .input-row dont le label correspond à rowLabel */
  async function clickLangPill(rowLabel, value) {
    if (!value) return;
    const row = Array.from(document.querySelectorAll('.input-row')).find(r => {
      const lbl = r.querySelector('label')?.innerText?.trim();
      return lbl === rowLabel && isElementVisible(r);
    });
    if (!row) { log(`⚠️ Langue : row "${rowLabel}" introuvable`, 2); return; }
    const pill = Array.from(row.querySelectorAll('button.cx-select-pill-section'))
      .find(b => norm(b.innerText) === norm(value) && isElementVisible(b));
    if (!pill) { log(`⚠️ Langue : pill "${value}" introuvable dans "${rowLabel}"`, 2); return; }
    if (pill.classList.contains('cx-select-pill-section--selected')) return; // déjà OK
    for (const t of ['mousedown', 'mouseup', 'click']) {
      pill.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
    }
    await sleep(150);
    log(`✅ ${rowLabel} : '${value}'`, 2);
  }

  /**
   * Remplit le formulaire d'édition langue (combobox Language + pills Reading/Writing/Speaking)
   * déjà ouvert (après click ADD LANGUAGE ou click Edit sur une tile).
   */
  async function fillLangEditForm(langName, level) {
    await sleep(800); // attendre que le formulaire soit rendu

    // 1. Combobox "Language"
    const langRow = Array.from(document.querySelectorAll('.input-row')).find(r => {
      const lbl = r.querySelector('label, oj-label')?.innerText?.trim();
      return (lbl === 'Language' || lbl === 'Langue') && isElementVisible(r);
    });
    const langCombo = langRow?.querySelector('input[role="combobox"], input.oj-inputtext-input, [role="combobox"] input, input[type="text"]');
    if (!langCombo) { log(`⚠️ Langue : combobox "Language" introuvable`, 1); return false; }

    if (norm(getValue(langCombo)) !== norm(langName)) {
      log(`✏️ Langue : '${getValue(langCombo) || '(vide)'}' -> '${langName}'`, 1);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(langCombo, langName); else langCombo.value = langName;
      langCombo.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(700);
      const opts = Array.from(document.querySelectorAll('[role="option"], li[role="option"]'));
      const match = opts.find(o => norm(o.textContent || '').includes(norm(langName)));
      if (match) {
        for (const t of ['mousedown', 'mouseup', 'click']) {
          match.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
        }
        await sleep(400);
      } else {
        log(`⚠️ Langue : option "${langName}" introuvable dans la liste`, 1);
      }
    } else {
      log(`✅ Langue : '${langName}' déjà sélectionnée`, 1);
    }

    // 2. Proficiency pills (Reading / Writing / Speaking)
    if (level) {
      const speakLevel = GS_SPEAK_MAP[level] || 'Conversational';
      const rwLevel    = GS_RW_MAP[level]    || 'Intermediate';
      await clickLangPill('Reading', rwLevel);
      await clickLangPill('Writing', rwLevel);
      await clickLangPill('Speaking', speakLevel);
    }

    // 3. SAVE
    await sleep(300);
    const saveBtn = Array.from(document.querySelectorAll('button'))
      .find(b => /^save$/i.test(b.innerText?.trim()) && isElementVisible(b));
    if (saveBtn) {
      saveBtn.click();
      await sleep(600);
      log(`✅ Langue '${langName}' sauvegardée`, 1);
      return true;
    }
    log(`⚠️ Langue : bouton SAVE introuvable`, 1);
    return false;
  }

  /** Résoudre un nom de langue brut (FR ou EN) vers le nom English GS via LANG_MAP */
  function resolveLangName(lang) {
    // Champs possibles : lang.language, lang.name, lang.langue
    const raw = lang.language || lang.name || lang.langue || '';
    if (!raw) return '';
    // Recherche exacte dans LANG_MAP
    if (LANG_MAP[raw]) return LANG_MAP[raw];
    // Recherche case-insensitive
    const lc = raw.toLowerCase();
    const key = Object.keys(LANG_MAP).find(k => k.toLowerCase() === lc);
    if (key) return LANG_MAP[key];
    // Déjà en anglais ? Retourner tel quel
    return raw;
  }

  async function handleLanguages(profile) {
    const languages = Array.isArray(profile.languages) ? profile.languages : [];
    console.log(`${LOG_PREFIX}    [handleLanguages] ${languages.length} langue(s) Firebase : ${JSON.stringify(languages.map(l => ({ name: resolveLangName(l), level: l.level || l.proficiency || l.niveau || '' })))}`);
    if (!languages.length) { console.log(`${LOG_PREFIX}    [handleLanguages] Aucune langue à traiter, sortie.`); return; }

    // ── 1. Supprimer les tiles fantômes ("Unnamed Language" / validation error) ──
    const getLangBlock = () => Array.from(document.querySelectorAll('apply-flow-block'))
      .find(b => /language skills/i.test(b.innerText || ''));
    const getRootTiles = (block) => Array.from(block?.querySelectorAll('.apply-flow-profile-item-tile') || [])
      .filter(t => !t.className.split(' ').some(c => c.includes('__'))); // tiles racine seulement

    const langBlockNow = getLangBlock();
    if (langBlockNow) {
      const existingTiles = getRootTiles(langBlockNow);
      console.log(`${LOG_PREFIX}    [handleLanguages] ${existingTiles.length} tile(s) existante(s) : ${existingTiles.map(t => `"${t.querySelector('.apply-flow-profile-item-tile__summary-title')?.innerText?.trim() || 'Unnamed'}"`).join(', ')}`);
      for (const tile of existingTiles) {
        const hasError = !!tile.querySelector('.apply-flow-profile-item-tile__summary-validation');
        const titleText = tile.querySelector('.apply-flow-profile-item-tile__summary-title')?.innerText?.trim() || '';
        if (hasError || /unnamed/i.test(titleText)) {
          const delBtn = tile.querySelector('[aria-label="Delete"], .apply-flow-profile-item-tile__delete-icon');
          if (delBtn && isElementVisible(delBtn)) {
            delBtn.click();
            await sleep(500);
            log(`🗑️ Tile fantôme supprimée : "${titleText || 'Unnamed'}"`, 1);
          }
        }
      }
    }

    // ── 2. Pour chaque langue Firebase : ajouter si absente, mettre à jour la proficiency ──
    for (const lang of languages) {
      const langName = resolveLangName(lang);
      if (!langName) continue;
      const level = lang.level || lang.proficiency || lang.niveau || '';

      const block = getLangBlock();
      const tiles = getRootTiles(block);
      const existingTile = tiles.find(t => {
        const title = t.querySelector('.apply-flow-profile-item-tile__summary-title')?.innerText?.trim() || '';
        return norm(title) === norm(langName);
      });

      if (!existingTile) {
        // Langue absente → ADD LANGUAGE + formulaire
        const addBtn = Array.from(document.querySelectorAll('button'))
          .find(b => /add language/i.test(b.innerText) && isElementVisible(b));
        if (!addBtn) { log(`⚠️ Langue : bouton "Add Language" introuvable`, 1); continue; }
        addBtn.click();
        await fillLangEditForm(langName, level);
      } else if (level) {
        // Langue présente → vérifier proficiency via Edit
        log(`🔍 Langue '${langName}' présente — vérification proficiency...`, 1);
        const editBtn = existingTile.querySelector('[aria-label="Edit"], .apply-flow-profile-item-tile__edit-item-icon');
        if (editBtn && isElementVisible(editBtn)) {
          editBtn.click();
          await fillLangEditForm(langName, level);
        } else {
          log(`✅ Langue présente : ${langName} -> Skip (pas de bouton Edit visible)`, 1);
        }
      } else {
        log(`✅ Langue présente : ${langName} -> Skip`, 1);
      }
    }
  }

  async function handleSection3(profile) {
    ensureBanner('⏳ Automatisation Taleos — Goldman Sachs : section 3 (langues & signature)...');
    const report = blueprint?.getStructureReport?.('section_3');
    if (report) log(`Blueprint GS section 3: ${report.ok ? 'OK' : 'KO'} (${report.matchedSelectors.length} sélecteurs)`);
    log('🧾 Goldman Sachs → audit Firebase vs formulaire (section 3)');
    console.log(`${LOG_PREFIX}    [Profile S3] first_name="${profile.first_name || profile.firstname}" | last_name="${profile.last_name || profile.lastname}" | languages=${JSON.stringify(profile.languages)} | submitSection3=${state.submitSection3}`);

    // ── Langues ─────────────────────────────────────────────────────────────
    await handleLanguages(profile);

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

    // ── Countdown 60 s avant Submit ──────────────────────────────────────────
    await sleep(500);
    const submitBtn = findButtonByText('Submit') || findButtonByText('SUBMIT');
    if (submitBtn && !state.submitSection3) {
      state.submitSection3 = true;
      const DELAY = 60;
      log(`⏱️ Goldman Sachs : soumission dans ${DELAY} secondes — vérifiez le formulaire.`);
      for (let i = DELAY; i > 0; i--) {
        ensureBanner(`🕐 Soumission Goldman Sachs dans ${i} seconde${i > 1 ? 's' : ''}… Vérifiez le formulaire avant envoi.`);
        await sleep(1000);
      }
      ensureBanner('🚀 Soumission Goldman Sachs en cours…');
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
      log(`🚀 Démarrage Goldman Sachs sur ${detected.key} (score=${detected.score}) — ${location.pathname}`);
      console.log(`${LOG_PREFIX} [run] État guards : ${JSON.stringify(state)}`);
      console.log(`${LOG_PREFIX} [run] Profile keys disponibles : ${Object.keys(profile).join(', ')}`);
      console.log(`${LOG_PREFIX} [run] pending.jobId="${pending.jobId}" | jobTitle="${pending.jobTitle}" | tabId=${pending.tabId}`);
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
          if (!state.alreadySent) {
            state.alreadySent = true;
            log('ℹ️ Goldman Sachs : candidature déjà soumise pour ce poste');
            ensureBanner('⚠️ Goldman Sachs — Vous avez déjà postulé à cette offre. Candidature ignorée.');
            await chrome.runtime.sendMessage({
              action: 'candidature_already_applied',
              bankId: 'goldman_sachs',
              jobId: pending.jobId || '',
              jobTitle: pending.jobTitle || '',
              companyName: 'Goldman Sachs',
              offerUrl: pending.offerUrl || location.href,
            }).catch(() => null);
            await chrome.storage.local.remove([PENDING_KEY, TAB_KEY]);
          }
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
