(function () {
  'use strict';

  if (!/jpmc\.fa\.oraclecloud\.com$/i.test(location.hostname || '')) return;

  const BANNER_ID = 'taleos-jp-morgan-banner';
  const PENDING_KEY = 'taleos_pending_jp_morgan';
  const TAB_KEY = 'taleos_jp_morgan_tab_id';
  const LOG_PREFIX = '[Taleos JP Morgan]';
  const blueprint = globalThis.__TALEOS_JP_MORGAN_BLUEPRINT__ || null;
  let isRunning = false;
  let currentTabIdPromise = null;
  let logged = new Set();
  let state = {
    termsAccepted: false,
    emailSubmitted: false,
    pinSubmitted: false,
    nextSection1: false,
    nextSection2: false,
    nextSection3: false,
    educationFilled: false,
    submitSection4: false,
    reviewStartedAt: 0,
    successSent: false,
    resumeUploadToken: '',
    coverUploadToken: '',
    attachmentsCleared: false   // one-shot : suppression+réupload faits une seule fois par session
  };

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function log(message, indent = 0) {
    const text = `${'   '.repeat(indent)}${message}`;
    if (logged.has(text)) return;
    logged.add(text);
    console.log(`${LOG_PREFIX} ${text}`);
  }

  function norm(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  // Comme norm() mais normalise aussi les apostrophes typographiques Unicode
  // (U+2018 ' U+2019 ' U+201A ‚ U+201B ‛ U+2032 ′) en apostrophe ASCII U+0027.
  // Indispensable pour comparer "Master's Degree" (Oracle) avec "Master's Degree" (notre code).
  function normText(value) {
    return String(value || '')
      .replace(/[''‚‛′]/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function normalizeNationalPhoneDigits(rawPhone, countryCode) {
    let d = String(rawPhone || '').replace(/\D/g, '');
    const cc = String(countryCode || '+33').trim().replace(/\s/g, '');
    if (cc === '+33' || cc === '33') {
      if (d.length >= 10 && d.startsWith('0')) d = d.slice(1);
      if (d.length >= 11 && d.startsWith('33')) d = d.slice(2);
    }
    return d;
  }

  function getBannerApi() {
    return globalThis.__TALEOS_AUTOMATION_BANNER__ || null;
  }

  function ensureBanner(text) {
    let banner = document.getElementById(BANNER_ID);
    if (!banner) {
      banner = document.createElement('div');
      banner.id = BANNER_ID;
      const api = getBannerApi();
      if (api) api.applyStyle(banner);
      document.body?.insertBefore(banner, document.body.firstChild);
    }
    banner.textContent = text || (getBannerApi()?.getText() || '⏳ Automatisation Taleos en cours — Ne touchez à rien.');
  }

  async function getCurrentTabId() {
    if (!currentTabIdPromise) {
      currentTabIdPromise = chrome.runtime.sendMessage({ action: 'taleos_get_current_tab_id' })
        .then((res) => res?.tabId || null)
        .catch(() => null);
      // Si le message échoue (background redémarré après rechargement extension),
      // on réinitialise pour que le prochain run() réessaie.
      currentTabIdPromise.then((id) => { if (!id) currentTabIdPromise = null; });
    }
    return currentTabIdPromise;
  }

  async function getPending() {
    const currentTabId = await getCurrentTabId();
    const local = await chrome.storage.local.get([PENDING_KEY, TAB_KEY]);
    const pending = local[PENDING_KEY];
    if (!pending) return null;

    const expectedTabId = pending?.tabId || local[TAB_KEY] || null;

    // Cas normal : le tabId correspond
    if (currentTabId && expectedTabId && currentTabId === expectedTabId) return pending;

    // Récupération : le pending existe mais sans tabId (service worker crashé entre
    // la création de l'onglet et l'écriture du tabId) → on "claim" cet onglet.
    // Condition de sécurité : l'offerUrl doit correspondre à l'URL courante ET
    // le pending doit être récent (< 5 min) pour éviter les faux positifs.
    if (!expectedTabId && currentTabId) {
      const offerHost = (() => { try { return new URL(pending.offerUrl || '').hostname; } catch (_) { return ''; } })();
      const ageMs = Date.now() - (pending.timestamp || 0);
      if (offerHost && location.hostname.includes(offerHost.split('.')[0]) && ageMs < 5 * 60 * 1000) {
        log('🔄 JP Morgan : récupération candidature (tabId manquant → claim) — extension redémarrée pendant le lancement');
        await chrome.storage.local.set({ [TAB_KEY]: currentTabId, [PENDING_KEY]: { ...pending, tabId: currentTabId } }).catch(() => {});
        return { ...pending, tabId: currentTabId };
      }
    }

    return null;
  }

  function visible(selector, root = document) {
    try {
      return Array.from(root.querySelectorAll(selector)).find((el) => {
        const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
        const style = globalThis.getComputedStyle ? getComputedStyle(el) : null;
        return !!rect && rect.width > 0 && rect.height > 0 && style?.display !== 'none' && style?.visibility !== 'hidden';
      }) || null;
    } catch (_) {
      return null;
    }
  }

  function isElementVisible(el) {
    if (!el) return false;
    const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
    const style = globalThis.getComputedStyle ? getComputedStyle(el) : null;
    return !!rect && rect.width > 0 && rect.height > 0 && style?.display !== 'none' && style?.visibility !== 'hidden';
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

  function auditAndFill(label, el, desiredValue, { transformCurrent = (v) => v, transformDesired = (v) => v } = {}) {
    if (!el) {
      log(`⚠️ ${label} : champ introuvable`, 1);
      return false;
    }
    const currentRaw = getValue(el);
    const current = transformCurrent(currentRaw);
    const desired = transformDesired(desiredValue);
    if (String(current) === String(desired)) {
      log(`✅ ${label} : formulaire='${currentRaw || '(vide)'}' | Firebase='${desiredValue || '(vide)'}' -> Skip`, 1);
      return true;
    }
    log(`✏️ ${label} : formulaire='${currentRaw || '(vide)'}' | Firebase='${desiredValue || '(vide)'}' -> Correction`, 1);
    setInputValue(el, desired);
    return true;
  }

  function auditAndSelectButton(label, container, desiredText) {
    if (!container || !desiredText) return false;
    const target = norm(desiredText);
    const options = Array.from(container.querySelectorAll('button, [role="radio"], [aria-pressed], [aria-checked]'));
    for (const option of options) {
      const text = norm(option.textContent || option.getAttribute('aria-label') || '');
      if (!text || text !== target) continue;
      const selected = option.getAttribute('aria-checked') === 'true' ||
        option.getAttribute('aria-pressed') === 'true' ||
        option.classList.contains('cx-select-pill-section--selected') ||
        option.classList.contains('selected') ||
        option.classList.contains('oj-selected') ||
        option.parentElement?.classList?.contains?.('cx-select-pill-section--selected');
      if (selected) {
        log(`✅ ${label} : formulaire='${option.textContent.trim()}' | Firebase='${desiredText}' -> Skip`, 1);
        return true;
      }
      log(`✏️ ${label} : formulaire='${option.textContent.trim() || '(autre)'}' | Firebase='${desiredText}' -> Correction`, 1);
      option.click();
      return true;
    }
    log(`⚠️ ${label} : option '${desiredText}' introuvable`, 1);
    return false;
  }

  function findBySelectors(selectors) {
    for (const selector of selectors) {
      const el = visible(selector) || document.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  function findFieldByLabel(labelNeedle) {
    const target = norm(labelNeedle);
    const labels = Array.from(document.querySelectorAll('label, legend, p, span, div')).filter((el) => {
      const text = norm(el.textContent || '');
      return text && text.includes(target);
    });
    const candidates = [];
    for (const label of labels) {
      const forId = label.getAttribute?.('for');
      if (forId) {
        const direct = document.getElementById(forId);
        if (direct) {
          candidates.push({ field: direct, score: 1000 });
          continue;
        }
      }
      let current = label;
      for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
        const fields = Array.from(current.querySelectorAll('input, textarea, select, [role="combobox"] input'))
          .filter((el) => isElementVisible(el) || el === document.activeElement);
        if (!fields.length) continue;
        const currentText = norm(current.textContent || '');
        if (!currentText.includes(target)) continue;
        const field = fields[0];
        const exact = currentText === target ? 100 : 0;
        const score = exact + Math.max(0, 40 - currentText.length) + Math.max(0, 20 - fields.length * 4) - depth;
        candidates.push({ field, score });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]?.field || null;
  }

  function findQuestionRow(textNeedle) {
    const target = norm(textNeedle);
    const nodes = Array.from(document.querySelectorAll('label, legend, h1, h2, h3, h4, h5, h6, p, span, div'));
    const candidates = [];
    for (const node of nodes) {
      const text = norm(node.textContent || '');
      if (!text || !text.includes(target)) continue;
      let current = node;
      for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
        const row = current.closest?.('.input-row, .oj-form-layout, .oj-flex-item, .oj-form, .oj-panel, .oj-flex');
        const scoped = row || current;
        const fields = scoped.querySelectorAll('input, textarea, select, [role="combobox"]');
        if (!fields.length) continue;
        const currentText = norm(scoped.textContent || '');
        if (!currentText.includes(target)) continue;
        candidates.push({ node: scoped, score: Math.max(0, 60 - currentText.length) - depth });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]?.node || null;
  }

  function findPhoneInputs() {
    const row = findQuestionRow('phone number') || findQuestionRow('phone');
    if (!row) return { countryCodeInput: null, phoneInput: null };
    const inputs = Array.from(row.querySelectorAll('input')).filter((el) => isElementVisible(el) || el === document.activeElement);
    if (!inputs.length) return { countryCodeInput: null, phoneInput: null };
    const countryCodeInput = inputs.find((el) => /country code/i.test(el.getAttribute('aria-label') || '') || /country code/i.test(el.placeholder || '')) || inputs[0];
    const phoneInput = inputs.find((el) => el !== countryCodeInput) || inputs[inputs.length - 1];
    return { countryCodeInput, phoneInput };
  }

  async function selectDropdownValue(label, desiredValue, aliases = []) {
    const row = findQuestionRow(label);
    if (!row || !desiredValue) {
      log(`⚠️ ${label} : menu déroulant introuvable`, 1);
      return false;
    }
    const input = row.querySelector('input[role="combobox"], input[type="text"], select');
    if (!input) {
      log(`⚠️ ${label} : champ dropdown introuvable`, 1);
      return false;
    }
    const desiredNorm = normText(desiredValue);
    const currentRaw = getValue(input);
    if (normText(currentRaw) === desiredNorm) {
      log(`✅ ${label} : formulaire='${currentRaw || '(vide)'}' | Firebase='${desiredValue}' -> Skip`, 1);
      return true;
    }
    const isCxSelect2 = input.classList.contains('cx-select-input') ||
      input.classList.contains('cx-select-input--disabled');
    log(`✏️ ${label} : formulaire='${currentRaw || '(vide)'}' | Firebase='${desiredValue}' | isCxSelect=${isCxSelect2} classes="${input.className}" -> Correction`, 1);
    // Oracle JET uses aria-label button; Oracle CX uses the input itself as toggle
    const toggleBtn2 = row.querySelector('button[aria-label*="Open the drop-down list" i], button.icon-dropdown-arrow');
    if (toggleBtn2) toggleBtn2.click();
    else { input.click(); input.focus?.(); }
    await sleep(300);
    if (!isCxSelect2) {
      setInputValue(input, desiredValue);
      input.focus?.();
      await sleep(200);
    }
    for (const candidate of [desiredValue, ...aliases]) {
      if (await pickVisibleOption(candidate)) return true;
    }
    if (!isCxSelect2) {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    log(`⚠️ ${label} : aucune option sélectionnée pour '${desiredValue}'`, 1);
    return true;
  }

  function getDropdownField(selectors = [], label = '') {
    const direct = selectors.length ? findBySelectors(selectors) : null;
    if (direct) {
      const row = direct.closest?.('.input-row, .oj-form-layout, .oj-flex-item, .oj-form, .oj-panel, .oj-flex') || direct.parentElement || document;
      return { row, input: direct };
    }
    const row = label ? findQuestionRow(label) : null;
    if (!row) return { row: null, input: null };
    const input = row.querySelector('input[role="combobox"], input[type="text"], select');
    return { row, input };
  }

  async function selectDropdownValueWithSelectors(label, selectors, desiredValue, aliases = []) {
    const { row, input } = getDropdownField(selectors, label);
    if (!row || !input || !desiredValue) {
      log(`⚠️ ${label} : menu déroulant introuvable`, 1);
      return false;
    }
    const desiredNorm = normText(desiredValue);
    const currentRaw = getValue(input);
    if (normText(currentRaw) === desiredNorm) {
      log(`✅ ${label} : formulaire='${currentRaw || '(vide)'}' | Firebase='${desiredValue}' -> Skip`, 1);
      return true;
    }
    const isCxSelect = input.classList.contains('cx-select-input') ||
      input.classList.contains('cx-select-input--disabled');
    log(`✏️ ${label} : formulaire='${currentRaw || '(vide)'}' | Firebase='${desiredValue}' | isCxSelect=${isCxSelect} classes="${input.className}" -> Correction`, 1);
    // Oracle CX cx-select : NE PAS appeler setInputValue — les events input/change déclenchent
    // la logique interne Oracle qui peut sélectionner la mauvaise option (ex. "Female" quand on cherche "Male").
    // Oracle JET uses aria-label button; Oracle CX uses the input itself as toggle
    const toggleBtn = row.querySelector('button[aria-label*="Open the drop-down list" i], button.icon-dropdown-arrow');
    if (toggleBtn) { log(`   [dropdown] ouverture via toggleBtn`, 2); toggleBtn.click(); }
    else { log(`   [dropdown] ouverture via input.click()`, 2); input.click(); input.focus?.(); }
    await sleep(300);
    if (!isCxSelect) {
      setInputValue(input, desiredValue);
      input.focus?.();
      await sleep(200);
    }
    for (const candidate of [desiredValue, ...aliases]) {
      if (await pickVisibleOption(candidate)) return true;
    }
    if (!isCxSelect) {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    log(`⚠️ ${label} : aucune option sélectionnée pour '${desiredValue}'`, 1);
    return true;
  }

  function mapEducationLevelToDegree(educationLevel, schoolType = '') {
    const lvl = norm(educationLevel);
    const school = norm(schoolType);
    if (!lvl && !school) return '';
    if (school.includes('engineer')) return "Engineer's Degree";
    if (lvl.includes('bac + 5') || lvl.includes('m2') || lvl.includes('master')) return "Master's Degree";
    if (lvl.includes('bac + 4') || lvl.includes('bac + 3') || lvl.includes('l3') || lvl.includes('l4') || lvl.includes('bachelor')) return "Bachelor's Degree";
    if (lvl.includes('bac + 2') || lvl.includes('l2') || lvl.includes('associate')) return "Associate's Degree";
    if (lvl === 'bac' || lvl.includes('high school')) return 'High School Diploma/GED';
    return '';
  }

  function getEducationBlockForField(field) {
    let current = field;
    let best = null;
    for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
      const inputs = current.querySelectorAll('input, textarea, select, [role="combobox"]');
      const text = norm(current.textContent || '');
      if (!inputs.length || !text.includes('degree')) continue;
      best = current;
      const degreeInputs = current.querySelectorAll('input[name*="DEGREE" i], input[id*="DEGREE" i]');
      if (degreeInputs.length > 1) break;
    }
    return best || field.parentElement || null;
  }

  async function removeEducationEntry(block, degreeLabel) {
    if (!block) return false;
    const btn = Array.from(block.querySelectorAll('button, [role="button"], a')).find((el) => {
      const hint = `${el.textContent || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`;
      return /remove|delete|trash|supprimer|retirer/i.test(hint);
    });
    if (!btn) {
      log(`⚠️ Education (${degreeLabel || 'bloc'}) : bouton supprimer introuvable`, 1);
      return false;
    }
    btn.click();
    await sleep(500);
    log(`🗑️ Education : bloc '${degreeLabel || 'autre diplôme'}' supprimé`, 1);
    return true;
  }

  function findQuestionContainer(textNeedle) {
    const target = norm(textNeedle);
    const nodes = Array.from(document.querySelectorAll('label, legend, h1, h2, h3, h4, h5, h6, p, span, div'));
    const candidates = [];
    for (const node of nodes) {
      const text = norm(node.textContent || '');
      if (!text || !text.includes(target)) continue;
      let current = node;
      for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
        const hasButtons = current.querySelector('button, [role="radio"], [aria-pressed], [aria-checked]');
        if (!hasButtons) continue;
        const currentText = norm(current.textContent || '');
        if (!currentText.includes(target)) continue;
        const optionCount = current.querySelectorAll('button, [role="radio"], [aria-pressed], [aria-checked]').length;
        candidates.push({ node: current, textLength: currentText.length, optionCount });
      }
    }
    candidates.sort((a, b) => {
      if (a.optionCount !== b.optionCount) return a.optionCount - b.optionCount;
      return a.textLength - b.textLength;
    });
    return candidates[0]?.node || null;
  }

  function findButtonByText(text) {
    const target = norm(text);
    return Array.from(document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]')).find((el) => {
      const content = norm(el.textContent || el.value || el.getAttribute('aria-label') || '');
      return content === target || content.includes(target);
    }) || null;
  }

  async function pickVisibleOption(textNeedle) {
    // normText : apostrophes Unicode normalisées → évite le mismatch "Master's" (U+2019) vs "Master's" (U+0027)
    const target = normText(textNeedle);

    function tryMatch(collection, strategyLabel) {
      // Priorité 1 : correspondance exacte (évite ex. 'female'.includes('male'))
      const exact = collection.find((el) => normText(el.textContent || '') === target);
      if (exact) {
        log(`   [pickOption S${strategyLabel}] exact match: "${normText(exact.textContent || '')}" tag=${exact.tagName} class="${exact.className}"`, 2);
        return exact;
      }
      // Priorité 2 : l'option contient la cible
      const contains = collection.find((el) => normText(el.textContent || '').includes(target));
      if (contains) {
        log(`   [pickOption S${strategyLabel}] contains match: "${normText(contains.textContent || '').slice(0, 60)}" tag=${contains.tagName}`, 2);
        return contains;
      }
      // Priorité 3 : la cible contient le texte de l'option (ex. option abrégée)
      const abbr = collection.find((el) => { const t = normText(el.textContent || ''); return t.length > 2 && target.includes(t); });
      if (abbr) {
        log(`   [pickOption S${strategyLabel}] abbr match: "${normText(abbr.textContent || '')}"`, 2);
        return abbr;
      }
      return null;
    }

    // Stratégie 1 : sélecteurs Oracle connus (cx-select, OJet, role="option")
    const s1candidates = Array.from(document.querySelectorAll(
      '[role="option"], li[role="option"], .oj-listbox-result, .oj-listview-item, .cx-select__list-item--content, [class*="cx-select__list-item"]'
    ));
    log(`   [pickOption] cible="${target}" — S1: ${s1candidates.length} candidat(s)`, 2);
    let option = tryMatch(s1candidates, '1');

    // Stratégie 2 : chercher dans tout conteneur listbox/dropdown ouvert
    if (!option) {
      const openContainers = Array.from(document.querySelectorAll(
        '[role="listbox"], [class*="cx-select__list"]:not([class*="__list-item"]), [class*="cx-select__dropdown"], [class*="select-list"], [class*="select-dropdown"]'
      )).filter(isElementVisible);
      log(`   [pickOption] S2: ${openContainers.length} conteneur(s) listbox ouvert(s)`, 2);
      for (const container of openContainers) {
        const items = Array.from(container.querySelectorAll('li, div, span')).filter(isElementVisible);
        log(`   [pickOption] S2 conteneur class="${container.className.slice(0, 60)}" → ${items.length} items visibles`, 2);
        option = tryMatch(items, '2');
        if (option) break;
      }
    }

    // Stratégie 3 (filet de sécurité) : tout élément visible avec texte exact.
    // EXCLUSIONS : éléments dans les tile cards (.apply-flow-profile-item-tile)
    // pour éviter de cliquer sur le résumé d'une carte éducation existante.
    if (!option) {
      const s3candidates = Array.from(document.querySelectorAll(
        'li, [class*="item"], [class*="option"], [class*="result"], [class*="choice"]'
      )).filter((el) => {
        if (!isElementVisible(el)) return false;
        if (el.closest?.('.apply-flow-profile-item-tile')) return false; // ← exclure tiles
        return normText(el.textContent || '') === target;
      });
      log(`   [pickOption] S3: ${s3candidates.length} candidat(s) texte-exact (tiles exclus)`, 2);
      option = s3candidates[0] || null;
      if (option) log(`   [pickOption S3] trouvé: tag=${option.tagName} class="${option.className}"`, 2);
    }

    if (option) {
      // Walk up to find clickable ancestor (max 2 niveaux)
      let clickTarget = option;
      for (let i = 0; i < 2 && clickTarget; i++) {
        if (clickTarget.tagName === 'LI' || clickTarget.getAttribute('role') === 'option' || clickTarget.getAttribute('tabindex') !== null) break;
        const parent = clickTarget.parentElement;
        if (!parent || parent.tagName === 'UL' || parent.tagName === 'BODY') break;
        clickTarget = parent;
      }
      log(`   [pickOption] clic sur tag=${clickTarget.tagName} class="${clickTarget.className.slice(0, 60)}"`, 2);
      clickTarget.click();
      await sleep(300);
      return true;
    }
    log(`   [pickOption] ❌ aucune option trouvée pour "${target}"`, 2);
    return false;
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
    for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
    const blob = new Blob([arr], { type: r.type || 'application/pdf' });
    const file = new File([blob], filename || 'document.pdf', { type: blob.type });
    const dt = new DataTransfer();
    dt.items.add(file);
    inputEl.files = dt.files;
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function findAttachmentRoot(keyword) {
    const target = norm(keyword);
    const nodes = document.querySelectorAll('section, fieldset, .oj-form-layout, .oj-panel, .oj-flex, div');
    for (const node of nodes) {
      const text = norm(node.textContent || '');
      if (!text || !text.includes(target)) continue;
      if (node.querySelector('input[type="file"], button, [role="button"]')) return node;
    }
    return null;
  }

  async function removeExistingAttachment(root, kinds) {
    if (!root) return false;
    const buttons = Array.from(root.querySelectorAll('button, [role="button"], a'));
    for (const btn of buttons) {
      const text = `${btn.textContent || ''} ${btn.getAttribute('aria-label') || ''} ${btn.getAttribute('title') || ''}`;
      const normalized = norm(text);
      if (!/remove attachment|remove|delete|supprimer|retirer/.test(normalized)) continue;
      if (kinds.some((kind) => normalized.includes(norm(kind))) || !kinds.length) {
        btn.click();
        await sleep(400);
        return true;
      }
    }
    return false;
  }

  /**
   * Supprime TOUS les attachments existants sur la page (CV + lettre de motivation)
   * en cliquant sur chaque bouton "Remove Attachment" jusqu'à ce qu'il n'en reste plus.
   * Appeler avant tout upload pour éviter les doublons.
   */
  async function removeAllAttachments() {
    let removed = 0;
    for (let pass = 0; pass < 10; pass++) {
      const btn = Array.from(document.querySelectorAll('button, [role="button"], a')).find(b => {
        if (!isElementVisible(b)) return false;
        const text = norm(`${b.textContent || ''} ${b.getAttribute('aria-label') || ''} ${b.getAttribute('title') || ''}`);
        return /remove attachment|remove resume|remove cover|remove file|remove document/.test(text)
          || (text.includes('remove') && b.closest('[class*="attachment"], [class*="upload"], [class*="file"]'));
      });
      if (!btn) break;
      btn.click();
      await sleep(600);
      removed++;
    }
    if (removed) log(`🗑️ Attachments : ${removed} pièce(s) supprimée(s) avant réupload`, 1);
    return removed;
  }

  async function ensureAttachment({ label, storagePath, filename, rootKeywords, uploadButtonText, token }) {
    if (!storagePath) {
      log(`⏭️ ${label} : aucun fichier Firebase`, 1);
      return false;
    }
    if (state[token] === `${storagePath}|done`) return true;

    let root = null;
    for (const keyword of rootKeywords) {
      root = findAttachmentRoot(keyword);
      if (root) break;
    }
    if (!root) root = document;

    const removed = await removeExistingAttachment(root, rootKeywords);
    if (removed) log(`🗑️ ${label} : ancienne pièce supprimée`, 1);

    let input = visible('input[type="file"]', root) || root.querySelector('input[type="file"]');
    if (!input && uploadButtonText) {
      const uploadBtn = findButtonByText(uploadButtonText);
      if (uploadBtn) {
        uploadBtn.click();
        await sleep(500);
        input = visible('input[type="file"]', root) || visible('input[type="file"]');
      }
    }
    if (!input) {
      log(`⚠️ ${label} : champ upload introuvable`, 1);
      return false;
    }
    const ok = await setFileInputFromStorage(input, storagePath, filename);
    if (ok) {
      state[token] = `${storagePath}|done`;
      log(`✅ ${label} : ${filename || storagePath.split('/').pop()} (Firebase)`, 1);
      await sleep(700);
      return true;
    }
    return false;
  }

  function deriveGender(profile) {
    const civ = norm(profile.civility || '');
    if (civ.includes('monsieur')) return 'Male';
    if (civ.includes('madame')) return 'Female';
    return '';
  }

  function extractCountryFromLocation(locationValue) {
    const raw = String(locationValue || '').trim();
    if (!raw) return '';
    const parts = raw.split('-').map((part) => part.trim()).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : raw;
  }

  const EUROPEAN_UNION_COUNTRIES = new Set([
    'allemagne', 'autriche', 'belgique', 'bulgarie', 'chypre', 'croatie', 'danemark',
    'espagne', 'estonie', 'finlande', 'france', 'grece', 'hongrie', 'irlande', 'italie',
    'lettonie', 'lituanie', 'luxembourg', 'malte', 'pays-bas', 'pologne', 'portugal',
    'republique tcheque', 'roumanie', 'slovaquie', 'slovenie', 'suede'
  ]);

  function resolveJpMorganWorkAuth(profile, pending) {
    const rows = Array.isArray(profile.jp_morgan_work_authorizations) ? profile.jp_morgan_work_authorizations : [];
    const targetCountry = extractCountryFromLocation(pending?.location || '') || 'France';
    const normCountry = norm(targetCountry);
    const exact = rows.find((row) => norm(row?.country || '') === normCountry);
    const euFallback = EUROPEAN_UNION_COUNTRIES.has(normCountry)
      ? rows.find((row) => norm(row?.country || '') === 'union europeenne')
      : null;
    const fallback = euFallback || rows.find((row) => norm(row?.country || '') === 'france') || rows[0] || null;
    const selected = exact || fallback;
    return {
      country: targetCountry,
      workAuthorized: selected?.work_authorized || 'Yes',
      sponsorshipRequired: selected?.sponsorship_required || 'No'
    };
  }

  async function handleSuccess(pending) {
    if (state.successSent) return;
    const text = norm(document.body?.innerText || '');
    const hasSuccessText = text.includes('thank you for your job application');
    const hasAlreadyApplied = text.includes('you already applied for this job') || text.includes('you may also view other jobs');
    const hasMyApplications = /\/my-profile/i.test(location.pathname || '') && text.includes('under consideration');
    if (!hasSuccessText && !hasAlreadyApplied && !hasMyApplications) return;
    state.successSent = true;
    const successLabel = hasSuccessText
      ? 'Thank you for your job application.'
      : hasAlreadyApplied
        ? 'You already applied for this job.'
        : 'My Applications / Under Consideration';
    log(`🎉 Succès JP Morgan détecté : ${successLabel}`);
    await chrome.runtime.sendMessage({
      action: 'candidature_success',
      bankId: 'jp_morgan',
      jobId: pending.jobId || pending.profile?.__jobId || '',
      jobTitle: pending.jobTitle || pending.profile?.__jobTitle || '',
      companyName: pending.companyName || pending.profile?.__companyName || 'J.P. Morgan',
      offerUrl: pending.offerUrl || pending.profile?.__offerUrl || location.href,
      successType: hasSuccessText ? 'toast' : (hasAlreadyApplied ? 'already_applied' : 'my_applications'),
      successMessage: hasSuccessText ? 'Thank you for your job application.' : (hasAlreadyApplied ? 'You already applied for this job.' : 'Under Consideration')
    }).catch(() => null);
    await chrome.storage.local.remove([PENDING_KEY, TAB_KEY]);
  }

  async function handleTermsAndConditions() {
    ensureBanner(getBannerApi()?.getText() || '⏳ Automatisation Taleos en cours — Ne touchez à rien.');
    const report = blueprint?.getStructureReport?.('terms');
    if (report) log(`Blueprint JP Morgan terms: ${report.ok ? 'OK' : 'KO'} (${report.matchedSelectors.length} sélecteurs)`);
    log('📋 JP Morgan → page Conditions générales');
    if (state.termsAccepted) return;
    // Bouton AGREE : texte exact "AGREE" (majuscules dans l'UI Oracle)
    const agreeBtn = Array.from(document.querySelectorAll('button')).find(
      (b) => /^agree$/i.test(b.textContent.trim())
    );
    if (agreeBtn) {
      state.termsAccepted = true;
      agreeBtn.click();
      log('✅ JP Morgan : Conditions générales acceptées (AGREE)');
    } else {
      log('⚠️ JP Morgan : bouton AGREE introuvable sur la page T&C', 1);
    }
  }

  async function handleEmailStep(profile) {
    ensureBanner(getBannerApi()?.getText() || '⏳ Automatisation Taleos en cours — Ne touchez à rien.');
    const report = blueprint?.getStructureReport?.('email');
    if (report) log(`Blueprint JP Morgan email: ${report.ok ? 'OK' : 'KO'} (${report.matchedSelectors.length} sélecteurs)`);
    const emailInput = findBySelectors([
      'input[type="email"]',
      'input[aria-label*="Email Address" i]',
      'input[id*="email" i]'
    ]);
    auditAndFill('Email', emailInput, profile.email || profile.auth_email);

    const checkbox = findBySelectors([
      'input[type="checkbox"]',
      '[role="checkbox"]',
      'label input[type="checkbox"]'
    ]);
    if (checkbox) {
      const checked = checkbox.checked || checkbox.getAttribute('aria-checked') === 'true';
      if (!checked) {
        checkbox.click();
        log('✅ Terms and conditions : case cochée sans ouvrir le lien', 1);
      } else {
        log('✅ Terms and conditions : case déjà cochée -> Skip', 1);
      }
    } else {
      log('⚠️ Terms and conditions : checkbox introuvable', 1);
    }

    const nextBtn = findButtonByText('Next');
    if (nextBtn && !state.emailSubmitted) {
      state.emailSubmitted = true;
      nextBtn.click();
      log('➡️ JP Morgan : clic sur Next après email/consentement');
    }
  }

  async function handlePinStep() {
    ensureBanner('⏳ Code JP Morgan requis — renseignez les 6 chiffres reçus par email, puis laissez Taleos reprendre automatiquement.');
    const report = blueprint?.getStructureReport?.('pin');
    if (report) log(`Blueprint JP Morgan code: ${report.ok ? 'OK' : 'KO'} (${report.matchedSelectors.length} sélecteurs)`);
    const digits = Array.from({ length: 6 }, (_, idx) => findBySelectors([`#pin-code-${idx + 1}`, `input[id*="pin-code-${idx + 1}"]`]));
    const values = digits.map((el) => String(el?.value || '').trim());
    const filled = values.filter((v) => /^\d$/.test(v)).length;
    log(`🔐 JP Morgan → code email : ${filled}/6 chiffre(s) saisi(s)`);
    if (filled === 6 && !state.pinSubmitted) {
      const verifyBtn = findButtonByText('Verify');
      if (verifyBtn) {
        state.pinSubmitted = true;
        verifyBtn.click();
        log('✅ JP Morgan : clic sur Verify après saisie complète du code');
      }
    }
  }

  async function selectPostalSuggestion() {
    const option = Array.from(document.querySelectorAll('[role="option"], li[role="option"], .oj-listbox-result')).find((el) => {
      const text = norm(el.textContent || '');
      return text.includes('95110') && text.includes('sannois');
    });
    if (option) {
      option.click();
      await sleep(500);
      log('✅ Code postal : suggestion 95110, Sannois, Val-d\'Oise sélectionnée', 1);
      return true;
    }
    return false;
  }

  async function handleSection1(profile) {
    ensureBanner(getBannerApi()?.getText() || '⏳ Automatisation Taleos en cours — Ne touchez à rien.');
    const report = blueprint?.getStructureReport?.('section_1');
    if (report) log(`Blueprint JP Morgan section 1: ${report.ok ? 'OK' : 'KO'} (${report.matchedSelectors.length} sélecteurs)`);
    log('🧾 JP Morgan → audit détaillé Firebase vs formulaire (section 1)');

    // --- Title (Doctor / Miss / Mr. / Mrs. / Ms.) ---
    const civility = norm(profile.civility || '');
    const titleMap = { monsieur: 'Mr.', madame: 'Mrs.', mme: 'Mrs.', miss: 'Miss', ms: 'Ms.' };
    const desiredTitle = titleMap[civility] || (civility.includes('monsieur') ? 'Mr.' : civility.includes('madame') ? 'Mrs.' : '');
    if (desiredTitle) {
      const titleBtns = Array.from(document.querySelectorAll('button.cx-select-pill-section, button[class*="cx-select-pill"]'));
      const titleBtn = titleBtns.find((b) => norm(b.textContent) === norm(desiredTitle));
      if (titleBtn) {
        const alreadySelected = titleBtn.getAttribute('aria-pressed') === 'true' || titleBtn.classList.contains('cx-select-pill-section--selected');
        if (!alreadySelected) { titleBtn.click(); log(`✏️ Titre : → ${desiredTitle}`, 1); }
        else { log(`✅ Titre : ${desiredTitle} -> Skip`, 1); }
      } else {
        log(`⚠️ Titre : bouton '${desiredTitle}' introuvable`, 1);
      }
    }

    // --- Prénom / Middle Name (vider) / Nom ---
    // Firebase uses first_name / last_name (snake_case), legacy: firstname / lastname
    const firstName = profile.first_name || profile.firstname || '';
    const lastName = profile.last_name || profile.lastname || '';
    auditAndFill('Prénom', findBySelectors(['input[name="firstName"]', 'input[id*="firstName" i]', 'input[name*="firstName" i]', 'input[aria-label*="First Name" i]']), firstName);
    // Middle Name MUST be empty — a previous bug could have filled it with the phone number
    const middleNameEl = findBySelectors(['input[name="middleNames"]', 'input[id*="middleNames" i]', 'input[name*="middleNames" i]']);
    if (middleNameEl && getValue(middleNameEl) !== '') {
      log(`🗑️ Middle Name : '${getValue(middleNameEl)}' → vidé (champ non utilisé)`, 1);
      setInputValue(middleNameEl, '');
    }
    auditAndFill('Nom', findBySelectors(['input[name="lastName"]', 'input[id*="lastName" i]', 'input[name*="lastName" i]', 'input[aria-label*="Last Name" i]']), lastName);
    auditAndFill('Email', findBySelectors(['input[name="email"]', 'input[id*="email" i]', 'input[name*="email" i]', 'input[aria-label*="Email" i]']), profile.email || profile.auth_email);

    // --- Téléphone ---
    // The phone field: country code combobox id="country-codes-dropdownphoneNumber" (name="phoneNumber")
    // The digits input has NO id/name — class="input-row__control phone-row__input"
    // Using findPhoneInputs() is reliable; fallback to .phone-row__input class selector
    const { countryCodeInput: phoneCcEl, phoneInput: phoneDigitsEl } = findPhoneInputs();
    const rawPhone = profile.phone || profile['phone-number'] || profile.phone_number || '';
    const phoneNational = normalizeNationalPhoneDigits(rawPhone, profile.phone_country_code || '+33');
    auditAndFill('Indicatif pays', phoneCcEl, profile.phone_country_code || '+33');
    await pickVisibleOption(profile.phone_country_code || '+33');
    // Prefer DOM-traversal result, fallback to class selector — NEVER use id*="phoneNumber" which matches country code combobox
    const phoneInputEl = phoneDigitsEl || findBySelectors(['input.phone-row__input', 'input[aria-label*="Phone Number" i]']);
    auditAndFill('Téléphone', phoneInputEl, phoneNational);

    // --- Adresse ---
    auditAndFill('Pays', findBySelectors(['input[name="country"]', 'input[id*="country-" i]']), profile.country || 'France');
    await pickVisibleOption(profile.country || 'France');
    auditAndFill('Numéro', findBySelectors(['input[name="addressLine1"]', 'input[id*="addressLine1" i]']), (profile.address || '').match(/^\s*(\d+[A-Za-z\-]*)/)?.[1] || '30');
    auditAndFill('Rue', findBySelectors(['input[name="addressLine2"]', 'input[id*="addressLine2" i]']), (profile.address || '').replace(/^\s*\d+[A-Za-z\-]*\s+/, '') || 'rue des Garonnes');
    // postal_code (Firebase snake_case) or legacy zipcode
    const postalCode = profile.postal_code || profile.zipcode || '';
    auditAndFill('Code postal', findBySelectors(['input[name="postalCode"]', 'input[id*="postalCode" i]']), postalCode);
    await sleep(300);
    await selectPostalSuggestion();
    auditAndFill('Ville', findBySelectors(['input[name="city"]', 'input[id*="city-" i]']), profile.city);
    const departmentEl = findBySelectors(['input[name="region2"]', 'input[id*="region2" i]', 'input[name*="region" i]', 'input[id*="region" i]']);
    if (departmentEl) {
      log(`ℹ️ Département : formulaire='${getValue(departmentEl) || '(vide)'}' | Firebase='(piloté via code postal)' -> Skip`, 1);
    }

    const nextBtn = findButtonByText('Next');
    if (nextBtn && !state.nextSection1) {
      state.nextSection1 = true;
      nextBtn.click();
      log('➡️ JP Morgan : section 1 validée, clic sur Next');
    }
  }

  async function handleSection2(profile, pending) {
    ensureBanner(getBannerApi()?.getText() || '⏳ Automatisation Taleos en cours — Ne touchez à rien.');
    const report = blueprint?.getStructureReport?.('section_2');
    if (report) log(`Blueprint JP Morgan section 2: ${report.ok ? 'OK' : 'KO'} (${report.matchedSelectors.length} sélecteurs)`);
    const workAuth = resolveJpMorganWorkAuth(profile, pending);

    auditAndSelectButton('At least 18 years of age', findQuestionContainer('are you at least 18 years of age'), 'Yes');
    auditAndSelectButton(
      'Legally authorized to work in this country',
      findQuestionContainer('for the position you are applying to, are you legally authorized to work in this country'),
      workAuth.workAuthorized
    );
    auditAndSelectButton(
      'Require sponsorship',
      findQuestionContainer('will you now or in the future require sponsorship for an employment-based visa status'),
      workAuth.sponsorshipRequired
    );

    const nextBtn = findButtonByText('Next');
    if (nextBtn && !state.nextSection2) {
      state.nextSection2 = true;
      nextBtn.click();
      log('➡️ JP Morgan : section 2 validée, clic sur Next');
    }
  }

  // ──────────────────────────────────────────────────────────────────────────────
  // Helpers spécifiques au formulaire inline Education / Experience (section 3)
  // ──────────────────────────────────────────────────────────────────────────────

  /**
   * Ouvre un cx-select dans le formulaire inline et sélectionne l'option souhaitée.
   * Gère les deux cas :
   *  - disabled (ex. Degree "contentItemId") → clic sur .cx-select-container
   *  - normal (Month, Year, Country) → clic sur l'input puis typing pour filtrer
   */
  async function selectCxDropdownInForm(label, input, desiredValue, aliases = []) {
    if (!input || !desiredValue) {
      log(`⚠️ ${label} : champ cx-select introuvable dans le formulaire inline`, 1);
      return false;
    }
    const currentRaw = getValue(input);
    if (normText(currentRaw) === normText(desiredValue)) {
      log(`✅ ${label} : '${currentRaw}' -> Skip`, 1);
      return true;
    }
    // cx-select-input (disabled ou non) : NE PAS appeler setInputValue.
    // Les events input/change déclenchent la logique Oracle interne (400 Bad Request, mauvaise option).
    const isCxSelect = input.classList.contains('cx-select-input') ||
      input.classList.contains('cx-select-input--disabled');
    // "vraiment readonly" = disabled HTML OU classe --disabled Oracle (pas juste cx-select-input)
    const isTrulyDisabled = input.classList.contains('cx-select-input--disabled') || input.readOnly || input.disabled;
    const cxContainer = input.closest('.cx-select-container');
    log(`✏️ ${label} : '${currentRaw || '(vide)'}' → '${desiredValue}' | isCxSelect=${isCxSelect} trulyDisabled=${isTrulyDisabled} hasCxContainer=${!!cxContainer}`, 1);
    // Ouverture du dropdown :
    //   - cx-select VRAIMENT disabled  → clic sur le container (le seul élément cliquable)
    //   - cx-select normal (éditable)  → clic sur l'INPUT (prouvé : ouvre le dropdown, S1=36 candidats)
    //   - input ordinaire              → clic sur l'input
    if (isTrulyDisabled && cxContainer) {
      cxContainer.click();
    } else {
      input.click();
      input.focus?.();
    }
    await sleep(400);
    // Pas de setInputValue pour les cx-select (déclenche des événements Oracle indésirables)
    if (!isCxSelect) {
      setInputValue(input, desiredValue);
      await sleep(300);
    }
    for (const candidate of [desiredValue, ...aliases]) {
      if (await pickVisibleOption(candidate)) return true;
    }
    if (!isCxSelect) {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    log(`⚠️ ${label} : aucune option sélectionnée pour '${desiredValue}'`, 1);
    return false;
  }

  /**
   * Remplit le formulaire inline d'éducation une fois qu'il est ouvert.
   * Champs Oracle CX confirmés en production (session 2026-05-12) :
   *   input[name="contentItemId"]          — Diplôme (cx-select disabled)
   *   input[name="educationalEstablishment"] — École (cx-select autocomplete)
   *   input[name="endDate"][0] (id=month-endDate-N) — Mois de fin
   *   input[name="endDate"][1] (id=year-endDate-N)  — Année de fin
   *   input[name="countryCode"]            — Pays
   *   input[name="areaOfStudy"]            — Domaine d'études (texte libre)
   *   button.save-btn                      — Sauvegarder
   */
  /**
   * Trouve le formulaire inline d'éducation Oracle HCM (plusieurs sélecteurs possibles).
   * Oracle peut rendre le formulaire inline OU en modal selon la version/contexte.
   */
  function findOpenEduForm() {
    // 1. Sélecteurs directs Oracle HCM (classes observées)
    const direct =
      document.querySelector('.profile-item-content--form') ||
      document.querySelector('[class*="profile-item-content"][class*="form"]') ||
      document.querySelector('[class*="apply-flow-profile-item"][class*="form"]') ||
      document.querySelector('[class*="profile-item"][class*="edit"]') ||
      document.querySelector('[class*="profile-item"][class*="open"]') ||
      document.querySelector('[class*="education"][class*="form"]') ||
      document.querySelector('[class*="edu"][class*="inline"]');
    if (direct) return direct;

    // 2. Degree input visible → on remonte au formulaire
    const degreeInput =
      document.querySelector('input[name="contentItemId"]') ||
      document.querySelector('input.cx-select-input--disabled');
    if (degreeInput && isElementVisible(degreeInput)) {
      return (
        degreeInput.closest('[class*="profile-item-content"]') ||
        degreeInput.closest('[class*="profile-item"]') ||
        degreeInput.closest('[role="dialog"]') ||
        degreeInput.closest('form') ||
        degreeInput.parentElement
      );
    }

    // 3. Bouton Save visible → remonter
    const saveBtn =
      document.querySelector('button.save-btn') ||
      Array.from(document.querySelectorAll('button')).find(b => /^save$/i.test((b.textContent || '').trim()) && isElementVisible(b));
    if (saveBtn && isElementVisible(saveBtn)) {
      return (
        saveBtn.closest('[class*="profile-item-content"]') ||
        saveBtn.closest('[class*="education"]') ||
        saveBtn.closest('[role="dialog"]') ||
        saveBtn.parentElement
      );
    }

    // 4. Dialog Oracle ouvert
    const dialog = document.querySelector('[role="dialog"]:not([aria-hidden="true"])');
    if (dialog && isElementVisible(dialog)) return dialog;

    return null;
  }

  /**
   * Ouvre un dropdown cx-select (disabled ou non) en utilisant la séquence
   * complète mousedown/mouseup/click sur le bon élément déclencheur.
   * Retourne true si un listbox est visible après l'ouverture.
   */
  async function openCxDropdown(input) {
    const container = input?.closest?.('.cx-select-container') || input?.closest?.('[class*="cx-select"]') || input?.parentElement;
    // Chercher un bouton déclencheur explicite (flèche ▼) dans le container
    const triggerBtn = container?.querySelector('button[class*="cx-select"], button[aria-label*="open" i], button[aria-expanded], button[class*="trigger"], button[class*="dropdown"]');
    // Cibles à essayer dans l'ordre
    const targets = [triggerBtn, container, input].filter(Boolean);

    for (const target of targets) {
      for (const type of ['mousedown', 'mouseup', 'click']) {
        target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      }
      await sleep(700);
      // Vérifier si un listbox s'est ouvert
      const listbox = document.querySelector(
        '[role="listbox"]:not([aria-hidden="true"]), [class*="cx-select__list"]:not([aria-hidden]), [class*="cx-select__dropdown"]:not([aria-hidden])'
      );
      if (listbox && isElementVisible(listbox)) return true;
    }
    return false;
  }

  async function fillEducationInlineForm(degree, school, gradMonth, gradYear, country, areaOfStudy) {
    // Attendre que le formulaire soit rendu (Oracle HCM peut prendre >2 s après ADD/EDIT)
    let formEl = null;
    for (let attempt = 0; attempt < 30 && !formEl; attempt++) {
      await sleep(400);
      formEl = findOpenEduForm();
    }
    if (!formEl) {
      // Diagnostic : logguer ce qui existe vraiment dans le DOM pour identifier les bons sélecteurs
      const diagSelectors = [
        '.profile-item-content--form',
        '[class*="profile-item-content"][class*="form"]',
        '[class*="apply-flow-profile-item"][class*="form"]',
        'button.save-btn',
        '[role="dialog"]',
        'input[name="contentItemId"]',
        'input[name="schoolName"]',
        '[class*="education"][class*="form"]',
        '[class*="edu"][class*="form"]',
        '[class*="profile-item"][class*="edit"]',
        '[class*="profile-item"][class*="open"]',
        '[data-education]',
        'form[id*="edu"]',
      ];
      const found = diagSelectors.filter(s => { try { return !!document.querySelector(s); } catch(_) { return false; } });
      log(`⚠️ JP Morgan : formulaire inline éducation non apparu après 12 s. Présents dans DOM : [${found.join(', ') || 'AUCUN'}]`, 1);
      // Logguer aussi les classes des éléments visibles contenant "save" ou "education"
      const saveBtn = Array.from(document.querySelectorAll('button')).find(b => /save|enregistr/i.test(b.textContent || b.getAttribute('aria-label') || ''));
      if (saveBtn) log(`   → bouton Save trouvé : class="${saveBtn.className}" parent="${saveBtn.parentElement?.className?.slice(0,80)}"`, 1);
      const inputEdu = document.querySelector('input[placeholder*="school" i], input[placeholder*="établissement" i], input[id*="school" i], input[name*="school" i]');
      if (inputEdu) log(`   → input école trouvé : id="${inputEdu.id}" name="${inputEdu.name}" class="${inputEdu.className?.slice(0,60)}"`, 1);
      return false;
    }
    log(`📋 fillEducationInlineForm formEl="${formEl.className.slice(0, 60)}" degree='${degree}' school='${school}' month='${gradMonth}' year='${gradYear}'`, 1);

    // ── Diplôme ─────────────────────────────────────────────────────────────
    // cx-select DISABLED : cliquer le container pour ouvrir la liste,
    // puis cliquer l'option via MouseEvent complet (mousedown+mouseup+click).
    // Blueprint : options dans .cx-select__list-item--content (PAS role="option").
    let degreeOk = !degree; // true si pas de valeur cible (optionnel)
    if (degree) {
      const degreeInput =
        formEl.querySelector('input[name="contentItemId"]') ||
        document.querySelector('input[name="contentItemId"]') ||
        formEl.querySelector('input.cx-select-input--disabled') ||
        document.querySelector('input.cx-select-input--disabled');

      log(`   [degree] input trouvé=${!!degreeInput} cible="${degree}"`, 1);

      if (degreeInput) {
        const currentDeg = getValue(degreeInput);
        const targetNorm = normText(degree).replace(/['']/g, "'");
        const currentNorm = normText(currentDeg).replace(/['']/g, "'");
        if (currentNorm && (currentNorm === targetNorm || currentNorm.includes(targetNorm) || targetNorm.includes(currentNorm))) {
          log(`✅ Diplôme : '${currentDeg}' -> Skip`, 1);
          degreeOk = true;
        } else {
          // Container cx-select à cliquer pour ouvrir le dropdown
          const container =
            degreeInput.closest('.cx-select-container') ||
            degreeInput.closest('[class*="cx-select"]') ||
            degreeInput.parentElement;

          for (let attempt = 0; attempt < 4 && !degreeOk; attempt++) {
            // Séquence MouseEvent complète sur le bouton interne OU le container
            // (container.click() = event synthétique ignoré par certains handlers Oracle)
            const triggerEl = container.querySelector('button') || container;
            for (const evType of ['mousedown', 'mouseup', 'click']) {
              triggerEl.dispatchEvent(new MouseEvent(evType, { bubbles: true, cancelable: true, view: window }));
            }
            await sleep(2000); // Oracle peut être lent à rendre la liste

            // Collecter toutes les options depuis n'importe quel listbox ouvert
            const itemSet = new Set();
            // A) Sélecteurs ciblés Oracle cx-select
            document.querySelectorAll(
              '.cx-select__list-item--content, [class*="cx-select__list-item"], [role="option"]'
            ).forEach(el => { if (isElementVisible(el) && el.textContent.trim()) itemSet.add(el); });
            // B) Tout listbox/dropdown ouvert → li, div, span enfants visibles
            document.querySelectorAll(
              '[role="listbox"], [class*="cx-select__list"]:not([class*="__list-item"]), [class*="cx-select__dropdown"], [class*="cx-select-dropdown--open"]'
            ).forEach(lb => {
              if (!isElementVisible(lb)) return;
              lb.querySelectorAll('li, div, span').forEach(el => {
                if (isElementVisible(el) && el.textContent.trim().length > 1) itemSet.add(el);
              });
            });
            const items = Array.from(itemSet);

            log(`   [degree] tentative ${attempt + 1}: ${items.length} options. "${items.slice(0, 6).map(e => e.textContent.trim()).join(' | ')}"`, 1);

            const match = items.find(el => {
              const t = normText(el.textContent || '').replace(/['']/g, "'");
              return t === targetNorm || t.includes(targetNorm) || targetNorm.includes(t);
            });

            if (match) {
              // Séquence MouseEvent complète pour garantir la sélection Oracle HCM
              for (const type of ['mousedown', 'mouseup', 'click']) {
                match.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
              }
              await sleep(500);
              degreeOk = true;
              log(`✅ Diplôme : '${match.textContent.trim()}' sélectionné`, 1);
            } else {
              // Fermer et réessayer
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
              await sleep(800);
            }
          }
          if (!degreeOk) log(`❌ Diplôme : échec après 4 tentatives — SAVE bloqué`, 1);
        }
      } else {
        log(`⚠️ Diplôme : input[name="contentItemId"] introuvable dans le formulaire`, 1);
      }
    }

    // ── École (cx-select autocomplete serveur) ───────────────────────────────
    // NOTE : Oracle HCM accepte une saisie libre même sans correspondance dans sa base.
    // Si aucune suggestion ne correspond, blur() confirme quand même la valeur tapée.
    // BUG CORRIGÉ : setInputValue() appelle blur() immédiatement → ferme les suggestions
    // avant pickVisibleOption → on type sans blur, on attend les suggestions, puis on blur.
    if (school) {
      const schoolInput = formEl.querySelector('input[name="educationalEstablishment"]') ||
        document.querySelector('input[name="educationalEstablishment"]');
      if (schoolInput) {
        const currentSchool = getValue(schoolInput);
        if (normText(currentSchool) === normText(school)) {
          log(`✅ École : '${currentSchool}' -> Skip`, 1);
        } else {
          // Ouvrir le champ et taper sans blur pour laisser les suggestions s'afficher
          schoolInput.click();
          schoolInput.focus?.();
          await sleep(200);
          // Injection native sans blur (contrairement à setInputValue qui blur trop tôt)
          const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
          if (nativeSetter) nativeSetter.call(schoolInput, school);
          else schoolInput.value = school;
          schoolInput.dispatchEvent(new Event('input', { bubbles: true }));
          await sleep(1000); // attendre les suggestions serveur (réseau)
          const picked = await pickVisibleOption(school);
          if (picked) {
            log(`✏️ École : '${school}' → suggestion sélectionnée`, 1);
          } else {
            // Aucune correspondance dans la base Oracle → texte libre accepté par blur
            schoolInput.dispatchEvent(new Event('change', { bubbles: true }));
            schoolInput.blur();
            log(`✏️ École : '${school}' → aucune suggestion Oracle, valeur libre confirmée par blur`, 1);
          }
        }
      }
    }

    // ── Mois de fin (1er input[name="endDate"]) ─────────────────────────────
    if (gradMonth) {
      const endDateInputs = (formEl || document).querySelectorAll('input[name="endDate"]');
      const monthInput = endDateInputs[0] || document.querySelector('input[id^="month-endDate"]');
      await selectCxDropdownInForm('Mois de diplôme', monthInput, gradMonth);
    }

    // ── Année de fin (2e input[name="endDate"]) ──────────────────────────────
    if (gradYear) {
      const endDateInputs = (formEl || document).querySelectorAll('input[name="endDate"]');
      const yearInput = endDateInputs[1] || document.querySelector('input[id^="year-endDate"]');
      await selectCxDropdownInForm('Année de diplôme', yearInput, String(gradYear));
    }

    // ── Pays (cx-select) ────────────────────────────────────────────────────
    if (country) {
      const countryInput = formEl.querySelector('input[name="countryCode"]') ||
        document.querySelector('input[name="countryCode"]');
      await selectCxDropdownInForm('Pays (éducation)', countryInput, country);
    }

    // ── Domaine d'études (texte libre) ──────────────────────────────────────
    const areaInput = formEl.querySelector('input[name="areaOfStudy"]') ||
      document.querySelector('input[name="areaOfStudy"]');
    if (areaInput) {
      if (areaOfStudy) auditAndFill("Domaine d'études", areaInput, areaOfStudy);
      else log("ℹ️ Domaine d'études : non renseigné dans Firebase -> Skip", 1);
    }

    // ── Sauvegarder — GARDE : ne pas cliquer Save si Degree obligatoire est vide ──
    // Oracle refuserait le formulaire et le laisserait ouvert avec l'erreur rouge.
    if (degree && !degreeOk) {
      log('❌ JP Morgan : Degree toujours vide → SAVE annulé pour éviter la boucle d\'erreur', 1);
      return false;
    }
    const saveBtn = document.querySelector('button.save-btn');
    if (saveBtn) {
      saveBtn.click();
      await sleep(800);
      log('💾 JP Morgan : formulaire éducation sauvegardé', 1);
      return true;
    }
    log('⚠️ JP Morgan : bouton Save introuvable dans le formulaire éducation', 1);
    return false;
  }

  async function handleSection3(profile) {
    ensureBanner(getBannerApi()?.getText() || '⏳ Automatisation Taleos en cours — Ne touchez à rien.');
    const report = blueprint?.getStructureReport?.('section_3');
    if (report) log(`Blueprint JP Morgan section 3: ${report.ok ? 'OK' : 'KO'} (${report.matchedSelectors.length} sélecteurs)`);
    log('🧾 JP Morgan → audit éducation & expérience (section 3)');

    // ── Trouver les conteneurs Education / Experience ────────────────────────
    // Chaque section est dans un .profile-item-container distinct identifié par
    // le texte de son bouton "Add Education" ou "Add Experience".
    const allContainers = document.querySelectorAll('[class*="standard-apply-flow-profile-item-"]');
    let eduContainer = null;
    allContainers.forEach((c) => {
      const addBtn = c.querySelector('button[class*="new-tile"]');
      if (norm(addBtn?.textContent || '').includes('add education')) eduContainer = c;
    });

    // ── Paramètres éducation depuis Firebase ────────────────────────────────
    const degreeValue = mapEducationLevelToDegree(profile.education_level, profile.school_type);
    // background.js envoie le champ "establishment" (profile.establishment || profile.institution_name)
    // mais l'ancien code lisait "school" qui n'existe pas → toujours vide → isTaleosTile() ne matchait jamais
    const school = profile.school || profile.university || profile.education_school || profile.establishment || '';
    // background.js envoie "diploma_year" (from profile.graduation_year), filler doit lire les deux
    const gradYear = String(profile.graduation_year || profile.grad_year || profile.diploma_year || '');
    const gradMonth = profile.graduation_month || profile.grad_month || '';
    const eduCountry = profile.education_country || profile.country || 'France';
    const areaOfStudy = profile.area_of_study || profile.major || profile.field_of_study || '';

    // ── Remplissage éducation ────────────────────────────────────────────────
    if (!eduContainer) {
      log('⚠️ JP Morgan section 3 : conteneur Education introuvable', 1);
    } else if (state.educationFilled) {
      log('✅ JP Morgan section 3 : éducation déjà remplie -> Skip', 1);
    } else if (state.nextSection3) {
      // Ne plus toucher à l'éducation : Next déjà cliqué dans un run précédent
      log('⚠️ JP Morgan section 3 : Next déjà envoyé, on ne relance pas l\'édition', 1);
    } else {
      // Vérifier si le formulaire inline est déjà ouvert (save-btn ET .profile-item-content--form visibles)
      const openForm = document.querySelector('.profile-item-content--form');
      const isEditOpen = !!openForm && !!document.querySelector('button.save-btn');
      if (isEditOpen) {
        // Formulaire ouvert (ex. état persisté par Oracle) → remplir directement
        log('ℹ️ JP Morgan section 3 : formulaire éducation déjà ouvert -> remplissage direct', 1);
        const ok = await fillEducationInlineForm(degreeValue, school, gradMonth, gradYear, eduCountry, areaOfStudy);
        if (ok) state.educationFilled = true;
      } else {
        // ── Supprimer UNIQUEMENT les tiles qui ne correspondent PAS au profil Taleos ──
        // Oracle HCM pré-remplit parfois des formations issues d'un profil antérieur (ex. "Unnamed Major / ESCP Europe").
        // On conserve la tile qui correspond à l'école Taleos et on supprime les autres.
        // Si la tile Taleos est déjà présente, on évite de la re-créer (on saute le "Add Education").

        /**
         * Vérifie si une tile correspond au profil Taleos (école présente dans le sous-titre).
         */
        function isTaleosTile(tile, targetSchool) {
          if (!targetSchool) return false;
          const subtitle = tile.querySelector('.apply-flow-profile-item-tile__summary-subtitle')?.textContent || '';
          const tileText = tile.textContent || '';
          const targetNorm = targetSchool.toLowerCase().trim();
          return subtitle.toLowerCase().includes(targetNorm) || tileText.toLowerCase().includes(targetNorm);
        }

        /**
         * Vérifie si la tile Taleos est COMPLÈTE : école ET diplôme présents.
         * summary-title = diplôme, summary-subtitle = école + date.
         */
        function isTaleosTileComplete(tile, targetSchool, targetDegree) {
          if (!isTaleosTile(tile, targetSchool)) return false;
          if (!targetDegree) return true;
          const title = tile.querySelector('.apply-flow-profile-item-tile__summary-title')?.textContent || '';
          const degNorm = normText(targetDegree).replace(/['']/g, "'");
          const titleNorm = normText(title).replace(/['']/g, "'");
          return titleNorm.includes(degNorm) || (degNorm.length > 4 && titleNorm.includes(degNorm.split("'")[0].trim()));
        }

        const existingTiles = Array.from(eduContainer.querySelectorAll('.apply-flow-profile-item-tile'));
        let taloesAlreadyPresent = false;

        if (existingTiles.length > 0) {
          const tilesToDelete = [];
          for (const tile of existingTiles) {
            if (isTaleosTile(tile, school)) {
              const tileTitle = tile.querySelector('.apply-flow-profile-item-tile__summary-title')?.textContent?.trim() || '';
              const tileSub = tile.querySelector('.apply-flow-profile-item-tile__summary-subtitle')?.textContent?.trim() || '';
              const isComplete = isTaleosTileComplete(tile, school, degreeValue);

              if (isComplete) {
                taloesAlreadyPresent = true;
                log(`✅ JP Morgan section 3 : tile Taleos complète ("${tileTitle} / ${tileSub}") → conservée`, 1);
              } else {
                // École présente mais diplôme absent/incorrect → ouvrir Edit et corriger
                log(`✏️ JP Morgan section 3 : tile Taleos incomplète (diplôme="${tileTitle || '(vide)'}", attendu="${degreeValue}") → correction via Edit`, 1);
                const editBtn = tile.querySelector('button[aria-label="Edit"]');
                if (editBtn) {
                  for (const evType of ['mousedown', 'mouseup', 'click']) {
                    editBtn.dispatchEvent(new MouseEvent(evType, { bubbles: true, cancelable: true, view: window }));
                  }
                  await sleep(1200);
                  const ok = await fillEducationInlineForm(degreeValue, school, gradMonth, gradYear, eduCountry, areaOfStudy);
                  if (ok) {
                    taloesAlreadyPresent = true;
                    log('✅ JP Morgan section 3 : tile Taleos corrigée (diplôme ajouté)', 1);
                  } else {
                    log('⚠️ JP Morgan section 3 : correction via Edit échouée → suppression + recréation', 1);
                    // Fermer le formulaire si ouvert
                    const cancelBtn = document.querySelector('button.cancel-btn');
                    if (cancelBtn && isElementVisible(cancelBtn)) { cancelBtn.click(); await sleep(500); }
                    tilesToDelete.push(tile); // sera supprimée pour recréation propre
                  }
                } else {
                  log('⚠️ JP Morgan section 3 : bouton Edit introuvable — suppression + recréation', 1);
                  tilesToDelete.push(tile);
                }
              }
            } else {
              const tileSub = tile.querySelector('.apply-flow-profile-item-tile__summary-subtitle')?.textContent?.trim() || '';
              log(`🗑️ JP Morgan section 3 : tile non-Taleos ("${tileSub}") → suppression`, 1);
              tilesToDelete.push(tile);
            }
          }

          // Supprimer les tiles non-Taleos / incomplètes non corrigées
          for (let i = 0; i < tilesToDelete.length; i++) {
            const currentTiles = Array.from(eduContainer.querySelectorAll('.apply-flow-profile-item-tile'));
            const target = currentTiles.find(t => !isTaleosTileComplete(t, school, degreeValue));
            if (!target) break;
            const delBtn = target.querySelector('button[aria-label="Delete"]');
            if (!delBtn) { log('⚠️ JP Morgan section 3 : bouton Delete introuvable, arrêt suppression', 1); break; }
            delBtn.click();
            await sleep(700);
            const confirmBtn = Array.from(document.querySelectorAll('button')).find(
              (b) => /^(yes|confirm|delete|ok|oui)$/i.test((b.textContent || '').trim()) && isElementVisible(b)
            );
            if (confirmBtn) { confirmBtn.click(); await sleep(500); }
          }

          if (tilesToDelete.length > 0) {
            log(`✅ JP Morgan section 3 : ${tilesToDelete.length} tile(s) supprimée(s)`, 1);
            // Attendre qu'Oracle HCM re-rende le conteneur après suppression
            await sleep(1500);
            // Re-requêter le conteneur (référence DOM peut être périmée après re-render Oracle)
            eduContainer = null;
            document.querySelectorAll('[class*="standard-apply-flow-profile-item-"]').forEach((c) => {
              const b = c.querySelector('button[class*="new-tile"]');
              if (norm(b?.textContent || '').includes('add education')) eduContainer = c;
            });
            if (!eduContainer) {
              log('⚠️ JP Morgan section 3 : conteneur Education introuvable après re-query post-suppression', 1);
            }
          }
        }

        if (taloesAlreadyPresent) {
          log('✅ JP Morgan section 3 : entrée éducation Taleos complète → pas de recréation', 1);
          state.educationFilled = true;
        } else if (eduContainer) {
          // Ajouter l'entrée éducation depuis Firebase
          // Utiliser une référence fraîche du bouton Add (l'ancienne peut être périmée)
          const addBtn = eduContainer.querySelector('button[class*="new-tile"]');
          if (addBtn) {
            // Séquence complète pour contourner les handlers Oracle qui ignorent .click() synthétique
            for (const evType of ['mousedown', 'mouseup', 'click']) {
              addBtn.dispatchEvent(new MouseEvent(evType, { bubbles: true, cancelable: true, view: window }));
            }
            await sleep(1000); // Oracle peut être lent à rendre le formulaire inline
            log("➕ JP Morgan : ajout entrée éducation depuis Firebase", 1);
            const ok = await fillEducationInlineForm(degreeValue, school, gradMonth, gradYear, eduCountry, areaOfStudy);
            if (ok) state.educationFilled = true;
          } else {
            log('⚠️ JP Morgan section 3 : bouton Add Education introuvable après purge', 1);
          }
        }
      }
    }

    // ── Expérience : laisser inchangé (Oracle HCM récupère le profil existant) ─
    const expTiles = document.querySelectorAll('.apply-flow-profile-item-tile').length - (eduContainer?.querySelectorAll('.apply-flow-profile-item-tile').length || 0);
    log(`ℹ️ JP Morgan → section 3 : ${expTiles} carte(s) expérience laissée(s) inchangée(s)`, 1);

    const nextBtn = findButtonByText('Next');
    if (nextBtn && !state.nextSection3) {
      state.nextSection3 = true;
      nextBtn.click();
      log('➡️ JP Morgan : section 3 validée, clic sur Next');
    }
  }

  async function handleSection4(profile) {
    ensureBanner(getBannerApi()?.getText() || '⏳ Automatisation Taleos en cours — Ne touchez à rien.');
    const report = blueprint?.getStructureReport?.('section_4');
    if (report) log(`Blueprint JP Morgan section 4: ${report.ok ? 'OK' : 'KO'} (${report.matchedSelectors.length} sélecteurs)`);
    log('🧾 JP Morgan → audit détaillé Firebase vs formulaire (section 4)');

    // Supprimer TOUS les attachments existants avant de recharger CV + lettre
    // → évite les doublons. Guard one-shot : on ne refait pas ça à chaque appel
    //   (handleSection4 est appelé plusieurs fois par le mutation observer).
    if (!state.attachmentsCleared) {
      state.resumeUploadToken = '';
      state.coverUploadToken = '';
      await removeAllAttachments();
      state.attachmentsCleared = true;
    }

    await ensureAttachment({
      label: 'CV',
      storagePath: profile.cv_storage_path,
      filename: profile.cv_filename,
      rootKeywords: ['resume', 'cv'],
      uploadButtonText: 'Upload Resume',
      token: 'resumeUploadToken'
    });
    // Firebase uses letter_storage_path / letter_filename (snake_case); legacy: lm_storage_path / lm_filename
    await ensureAttachment({
      label: 'Lettre de motivation',
      storagePath: profile.letter_storage_path || profile.lm_storage_path,
      filename: profile.letter_filename || profile.lm_filename,
      rootKeywords: ['cover letter', 'motivation'],
      uploadButtonText: 'Upload Cover Letter',
      token: 'coverUploadToken'
    });

    auditAndFill('LinkedIn', findBySelectors(['input[id*="siteLink" i]', 'input[aria-label*="Link 1" i]']), profile.linkedin_url || '');

    const gender = deriveGender(profile) || profile.gender || '';
    log(`🔎 Gender : civility='${profile.civility || '—'}' → derivé='${deriveGender(profile)}' | profile.gender='${profile.gender || '—'}' → utilisé='${gender}'`, 1);
    if (gender) {
      await selectDropdownValueWithSelectors('Gender', ['input[name*="ORA_GENDER" i]', 'input[id*="ORA_GENDER" i]'], gender, [gender === 'Male' ? 'Male' : 'Female']);
    } else {
      log('⚠️ Gender : impossible à déduire depuis Firebase', 1);
    }
    const militaryTarget = profile.jp_morgan_military_service || 'No';
    await selectDropdownValueWithSelectors(
      'Have you ever served as a member of the armed forces of any country?',
      ['input[name*="emeaMilitaryStatus" i]', 'input[id*="emeaMilitaryStatus" i]'],
      militaryTarget,
      [militaryTarget]
    );

    // Firebase snake_case (first_name/last_name) avec fallback legacy (firstname/lastname)
    const fullName = `${profile.first_name || profile.firstname || ''} ${profile.last_name || profile.lastname || ''}`.trim();
    auditAndFill('E-signature', findBySelectors(['input[name="fullName"]', 'input[id*="fullName" i]', 'input[aria-label*="Full Name" i]']), fullName);

    const submitBtn = findButtonByText('Submit');
    if (submitBtn && !state.submitSection4) {
      if (!state.reviewStartedAt) {
        state.reviewStartedAt = Date.now();
        log('⏳ JP Morgan : pause de 60 secondes pour relecture avant soumission');
        ensureBanner('⏳ Relecture JP Morgan en cours — 60 secondes avant soumission automatique.');
        return;
      }
      const elapsed = Date.now() - state.reviewStartedAt;
      if (elapsed < 60000) {
        const remaining = Math.max(1, Math.ceil((60000 - elapsed) / 1000));
        ensureBanner(`⏳ Relecture JP Morgan en cours — soumission automatique dans ${remaining}s.`);
        return;
      }
      state.submitSection4 = true;
      submitBtn.click();
      log('🚀 JP Morgan : clic final sur Submit après 60 secondes de relecture');
    }
  }

  async function run() {
    if (isRunning) return;
    isRunning = true;
    try {
      const pending = await getPending();
      if (!pending) return;
      const profile = pending.profile || {};
      const detected = blueprint?.detectPage?.() || { key: 'unknown', label: 'Inconnue' };
      log(`🚀 Démarrage JP Morgan sur ${detected.key} (${location.pathname})`);
      await blueprint?.recordLog?.({ page: detected.key, href: location.href });

      await handleSuccess(pending);
      if (state.successSent) return;

      // IMPORTANT : utiliser `await` (pas `return`) pour que `finally { isRunning = false }`
      // ne s'exécute qu'APRÈS la fin du handler — évite les runs concurrents sur section 3.
      if (detected.key === 'terms') { await handleTermsAndConditions(); return; }
      if (detected.key === 'email') { await handleEmailStep(profile); return; }
      if (detected.key === 'pin') { await handlePinStep(); return; }
      if (detected.key === 'section_1') { await handleSection1(profile); return; }
      if (detected.key === 'section_2') { await handleSection2(profile, pending); return; }
      if (detected.key === 'section_3') { await handleSection3(profile); return; }
      if (detected.key === 'section_4') { await handleSection4(profile); return; }
      if (detected.key === 'offer') {
        ensureBanner(getBannerApi()?.getText() || '⏳ Automatisation Taleos en cours — Ne touchez à rien.');
        const applyBtn = Array.from(document.querySelectorAll('a, button')).find((el) => /apply now/i.test(el.textContent || ''));
        if (applyBtn) {
          applyBtn.click();
          log('🔗 JP Morgan → clic sur Apply Now');
        }
      }
      if (detected.key === 'my_profile_success' || detected.key === 'already_applied' || detected.key === 'success') {
        await handleSuccess(pending);
      }
    } catch (e) {
      log(`❌ Erreur JP Morgan : ${e?.message || e}`);
    } finally {
      isRunning = false;
    }
  }

  function init() {
    if (window.__taleosJpMorganInit) return;
    window.__taleosJpMorganInit = true;
    setInterval(run, 1500);
    const observer = new MutationObserver(() => {
      clearTimeout(window.__taleosJpMorganDebounce);
      window.__taleosJpMorganDebounce = setTimeout(run, 300);
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
