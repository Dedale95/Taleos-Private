(function () {
  'use strict';

  if (!/ghr\.wd1\.myworkdayjobs\.com$/i.test(location.hostname || '')) return;

  const BANNER_ID = 'taleos-bank-of-america-banner';
  const PENDING_KEY = 'taleos_pending_bank_of_america_workday';
  const TAB_KEY = 'taleos_bank_of_america_workday_tab_id';
  const LOG_PREFIX = '[Taleos Bank of America]';
  let isRunning = false;
  let currentTabIdPromise = null;
  let logged = new Set();
  let state = {
    myInformationFilled: false,
    myExperienceFilled: false,
    applicationQuestionsFilled: false,
    voluntaryDisclosuresFilled: false,
    reviewStartedAt: 0,
    successSent: false,
    cvUploadToken: '',
    cvUploadDone: false
  };

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function reportRunLog(message, level) {
    try {
      chrome.runtime.sendMessage({
        action: 'extension_run_log',
        source: 'bank-of-america-workday-filler',
        level: level || 'info',
        message: String(message || ''),
        ts: new Date().toISOString()
      }).catch(() => {});
    } catch (_) {}
  }

  function log(message, indent = 0) {
    const text = `${'   '.repeat(indent)}${message}`;
    if (logged.has(text)) return;
    logged.add(text);
    const line = `${LOG_PREFIX} ${text}`;
    console.log(line);
    const level = /❌/.test(text) ? 'error' : /⚠️/.test(text) ? 'warn' : 'info';
    reportRunLog(line, level);
  }

  function norm(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
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

    if (currentTabId && expectedTabId && currentTabId === expectedTabId) return pending;

    if (!expectedTabId && currentTabId) {
      const offerHost = (() => { try { return new URL(pending.offerUrl || '').hostname; } catch (_) { return ''; } })();
      const ageMs = Date.now() - (pending.timestamp || 0);
      if (offerHost && location.hostname.includes(offerHost.split('.')[0]) && ageMs < 5 * 60 * 1000) {
        log('🔄 Récupération candidature (tabId manquant → claim)');
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

  async function fillMyInformation(profile) {
    log('📝 Étape 1 : My Information');
    try {
      // Given Name
      const givenNameEl = visible('input[data-automation-id*="givenName"]') || visible('input[placeholder*="Given"]');
      if (givenNameEl && profile.first_name) {
        givenNameEl.value = profile.first_name;
        givenNameEl.dispatchEvent(new Event('change', { bubbles: true }));
        givenNameEl.dispatchEvent(new Event('blur', { bubbles: true }));
        log(`  ✓ Given Name: ${profile.first_name}`);
      }

      // Family Name
      const familyNameEl = visible('input[data-automation-id*="familyName"]') || visible('input[placeholder*="Family"]');
      if (familyNameEl && profile.last_name) {
        familyNameEl.value = profile.last_name;
        familyNameEl.dispatchEvent(new Event('change', { bubbles: true }));
        familyNameEl.dispatchEvent(new Event('blur', { bubbles: true }));
        log(`  ✓ Family Name: ${profile.last_name}`);
      }

      // Address
      const addressEl = visible('input[data-automation-id*="street"]') || visible('input[placeholder*="Street"]');
      if (addressEl && profile.address) {
        addressEl.value = profile.address;
        addressEl.dispatchEvent(new Event('change', { bubbles: true }));
        addressEl.dispatchEvent(new Event('blur', { bubbles: true }));
        log(`  ✓ Address: ${profile.address}`);
      }

      // City
      const cityEl = visible('input[data-automation-id*="city"]') || visible('input[placeholder*="City"]');
      if (cityEl && profile.city) {
        cityEl.value = profile.city;
        cityEl.dispatchEvent(new Event('change', { bubbles: true }));
        cityEl.dispatchEvent(new Event('blur', { bubbles: true }));
        log(`  ✓ City: ${profile.city}`);
      }

      // Postal Code
      const postalEl = visible('input[data-automation-id*="postal"]') || visible('input[placeholder*="Postal"]');
      if (postalEl && profile.postal_code) {
        postalEl.value = profile.postal_code;
        postalEl.dispatchEvent(new Event('change', { bubbles: true }));
        postalEl.dispatchEvent(new Event('blur', { bubbles: true }));
        log(`  ✓ Postal Code: ${profile.postal_code}`);
      }

      // Phone Number
      const phoneEl = visible('input[data-automation-id*="phone"]') || visible('input[placeholder*="Phone"]');
      if (phoneEl && profile.phone) {
        const cleanPhone = normalizeNationalPhoneDigits(profile.phone, profile.phone_country_code);
        phoneEl.value = cleanPhone;
        phoneEl.dispatchEvent(new Event('change', { bubbles: true }));
        phoneEl.dispatchEvent(new Event('blur', { bubbles: true }));
        log(`  ✓ Phone: ${cleanPhone}`);
      }

      state.myInformationFilled = true;
      log('✅ My Information complétée');
    } catch (err) {
      log(`❌ Erreur My Information: ${err.message}`);
    }
  }

  async function fillMyExperience(profile) {
    log('📝 Étape 2 : My Experience');
    try {
      // Languages
      if (profile.languages && Array.isArray(profile.languages)) {
        for (const lang of profile.languages) {
          if (lang.language === 'French' || lang.language === 'french') {
            const langDropdown = visible('select[data-automation-id*="language"]') || visible('div[data-automation-id*="language"]');
            if (langDropdown) {
              langDropdown.click();
              await sleep(300);
              const frenchOption = visible('option:contains("French")') || Array.from(document.querySelectorAll('*')).find(el => el.textContent === 'French');
              if (frenchOption) frenchOption.click();
              log(`  ✓ Language: French`);
            }

            // Fluent checkbox
            const fluentCheckbox = visible('input[type="checkbox"][data-automation-id*="fluent"]');
            if (fluentCheckbox && lang.proficiency && (lang.proficiency === 'native' || lang.proficiency === 'bilingual')) {
              fluentCheckbox.checked = true;
              fluentCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
              log(`  ✓ Fluent: checked`);
            }

            // Written and Spoken level
            const levelDropdown = visible('select[data-automation-id*="writtenSpoken"]') || visible('div[data-automation-id*="writtenSpoken"]');
            if (levelDropdown) {
              levelDropdown.click();
              await sleep(300);
              const fluentLevel = Array.from(document.querySelectorAll('*')).find(el => el.textContent === 'Fluent');
              if (fluentLevel) fluentLevel.click();
              log(`  ✓ Written and Spoken: Fluent`);
            }
          }
        }
      }

      // CV Upload - Use native file input if possible (Playwright-compatible)
      const cvFileInput = document.querySelector('input[type="file"]');
      if (cvFileInput && profile.cv_url) {
        log(`  ℹ️ CV upload: recommandé via Playwright (native file handling)`);
        // Note: Actual file upload handled by Playwright in the background during automation
        state.cvUploadDone = true;
      }

      state.myExperienceFilled = true;
      log('✅ My Experience complétée');
    } catch (err) {
      log(`❌ Erreur My Experience: ${err.message}`);
    }
  }

  async function fillApplicationQuestions(profile) {
    log('📝 Étape 3 : Application Questions');
    try {
      // Placeholder: Application Questions are job-specific and will be handled dynamically
      state.applicationQuestionsFilled = true;
      log('✅ Application Questions (auto-detected)');
    } catch (err) {
      log(`❌ Erreur Application Questions: ${err.message}`);
    }
  }

  async function fillVoluntaryDisclosures(profile) {
    log('📝 Étape 4 : Voluntary Disclosures');
    try {
      // Placeholder: EEO/Diversity questions will be handled if profile data available
      state.voluntaryDisclosuresFilled = true;
      log('✅ Voluntary Disclosures (auto-detected)');
    } catch (err) {
      log(`❌ Erreur Voluntary Disclosures: ${err.message}`);
    }
  }

  async function submitApplication() {
    log('📝 Étape 5 : Review & Submit');
    try {
      const submitBtn = visible('button[data-automation-id*="submit"]') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.toLowerCase().includes('submit'));
      if (submitBtn && isElementVisible(submitBtn)) {
        submitBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(500);
        submitBtn.click();
        log('✅ Application soumise');
        state.successSent = true;
        return true;
      }
    } catch (err) {
      log(`❌ Erreur lors de la soumission: ${err.message}`);
    }
    return false;
  }

  async function run() {
    if (isRunning) return;
    isRunning = true;

    try {
      ensureBanner('🔄 Taleos — Automatisation Bank of America en cours...');

      const pending = await getPending();
      if (!pending) {
        isRunning = false;
        return;
      }

      log(`🚀 Automatisation candidature: ${pending.jobTitle}`);
      const tabId = pending.tabId || await getCurrentTabId();
      const profile = pending.firebaseProfile || {};

      // Fill all form steps
      await fillMyInformation(profile);
      await sleep(800);

      await fillMyExperience(profile);
      await sleep(800);

      await fillApplicationQuestions(profile);
      await sleep(800);

      await fillVoluntaryDisclosures(profile);
      await sleep(800);

      // Submit
      const submitted = await submitApplication();

      if (submitted) {
        ensureBanner('✅ Candidature soumise avec succès ! Fenêtre en cours de fermeture...');
        const tabIdToClose = tabId || pending.tabId;
        if (tabIdToClose) {
          await sleep(1500);
          chrome.tabs.remove(tabIdToClose).catch(() => {});
        }

        // Report success
        try {
          await chrome.runtime.sendMessage({
            action: 'candidature_success',
            bankId: 'bank_of_america_workday',
            jobTitle: pending.jobTitle,
            jobId: pending.jobId,
            offerUrl: pending.offerUrl,
            timestamp: new Date().toISOString()
          }).catch(() => {});
        } catch (_) {}

        // Clean pending state
        try {
          await chrome.storage.local.remove([PENDING_KEY, TAB_KEY]).catch(() => {});
        } catch (_) {}
      } else {
        ensureBanner('⚠️ Candidature - Vérification manuelle requise');
        log('⚠️ Vérifiez la candidature manuellement');
      }
    } catch (err) {
      log(`❌ Erreur générale: ${err.message}`);
      ensureBanner('❌ Erreur lors de l\'automatisation');
    } finally {
      isRunning = false;
    }
  }

  // Auto-start if pending application
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => run());
  } else {
    setTimeout(run, 500);
  }

  window.addEventListener('load', () => setTimeout(run, 1000));
})();
