/**
 * Taleos - Blueprint Goldman Sachs
 * Cartographie le flux Oracle HCM (hdpc.fa.us2.oraclecloud.com) observé en production.
 * Offre publique sur higher.gs.com → candidature Oracle HCM.
 */
(function () {
  'use strict';

  if (globalThis.__TALEOS_GOLDMAN_SACHS_BLUEPRINT__) return;

  const LAST_CHECK_KEY = 'taleos_gs_blueprint_last_check';
  const LOG_KEY = 'taleos_gs_blueprint_log';
  const MAX_LOG_ENTRIES = 120;

  const TEXT = {
    offer: ['apply', 'job identification', 'global banking', 'goldman sachs'],
    otp_email: ['email address', 'next'],
    section1: ['resume', 'cover letter', 'linkedin profile url', 'terms and conditions', 'i agree with the terms'],
    section2: ['job application questions', 'years of relevant experience', 'work authorisation', 'sexual orientation', 'race / ethnicity', 'disclosures', 'government or regulatory'],
    section3: ['language skills', 'e-signature', 'full name', 'submit'],
    success: ['thank you for your job application', 'application submitted'],
    myProfile: ['my applications', 'active job applications', 'application submitted', 'inactive job applications']
  };

  const PAGE_DEFS = {
    offer: {
      label: 'Offre Goldman Sachs',
      hostIncludes: ['higher.gs.com'],
      pathMatches: [/\/roles\//],
      selectorsAny: ['a[href*="/apply"]', 'button', 'h1'],
      textPatterns: TEXT.offer
    },
    otp_email: {
      label: 'Email / OTP',
      hostIncludes: ['hdpc.fa.us2.oraclecloud.com'],
      pathMatches: [/\/apply\/email/],
      selectorsAny: ['input[type="email"]', 'button'],
      textPatterns: TEXT.otp_email
    },
    section1: {
      label: 'Section 1 - Documents & infos personnelles',
      hostIncludes: ['hdpc.fa.us2.oraclecloud.com'],
      pathMatches: [/\/apply\/?$/, /\/apply\/section\/1/],
      selectorsAny: [
        'input[type="email"]',
        'input#attachment-upload-50',
        'input#attachment-upload-7',
        'input[type="checkbox"]'
      ],
      textPatterns: TEXT.section1
    },
    section2: {
      label: 'Section 2 - Questions de candidature',
      hostIncludes: ['hdpc.fa.us2.oraclecloud.com'],
      pathMatches: [/\/apply\/section\/2/],
      selectorsAny: ['button', '[role="radio"]', '[aria-pressed]'],
      textPatterns: TEXT.section2
    },
    section3: {
      label: 'Section 3 - Langues & E-Signature',
      hostIncludes: ['hdpc.fa.us2.oraclecloud.com'],
      pathMatches: [/\/apply\/section\/3/],
      selectorsAny: ['button', 'input[type="text"]'],
      textPatterns: TEXT.section3
    },
    success_toast: {
      label: 'Succès (toast)',
      hostIncludes: ['hdpc.fa.us2.oraclecloud.com'],
      pathMatches: [/\/my-profile/],
      selectorsAny: ['div.notifications[role="alert"]', 'main'],
      textPatterns: TEXT.success
    },
    my_profile: {
      label: 'My Applications',
      hostIncludes: ['hdpc.fa.us2.oraclecloud.com'],
      pathMatches: [/\/my-profile/],
      selectorsAny: ['main', 'section', 'ul'],
      textPatterns: TEXT.myProfile
    }
  };

  function normalizeText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getPageText(doc = document) {
    return normalizeText(doc.body?.innerText || doc.body?.textContent || '');
  }

  function isVisible(el) {
    if (!el) return false;
    const style = globalThis.getComputedStyle ? getComputedStyle(el) : null;
    const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
    return !!rect && rect.width > 0 && rect.height > 0 && style?.display !== 'none' && style?.visibility !== 'hidden';
  }

  function queryVisible(doc, selector) {
    try {
      return Array.from(doc.querySelectorAll(selector)).find(isVisible) || null;
    } catch (_) {
      return null;
    }
  }

  function hostMatches(def, host) {
    return (def.hostIncludes || []).every((part) => host.includes(part));
  }

  function pathMatches(def, pathname) {
    if (!def.pathMatches?.length) return true;
    return def.pathMatches.some((re) => re.test(pathname));
  }

  function textMatches(def, pageText) {
    if (!def.textPatterns?.length) return true;
    return def.textPatterns.some((t) => pageText.includes(normalizeText(t)));
  }

  function selectorsMatch(def, doc) {
    if (!def.selectorsAny?.length) return true;
    return def.selectorsAny.some((sel) => {
      try { return !!queryVisible(doc, sel) || !!doc.querySelector(sel); } catch (_) { return false; }
    });
  }

  function getStructureReport(pageKey, doc = document) {
    const def = PAGE_DEFS[pageKey];
    if (!def) return { ok: false, pageKey, error: 'Unknown page' };
    const host = (doc.location || location).hostname || '';
    const pathname = (doc.location || location).pathname || '';
    const pageText = getPageText(doc);
    const hostsOk = hostMatches(def, host);
    const pathOk = pathMatches(def, pathname);
    const textsOk = textMatches(def, pageText);
    const matchedSelectors = (def.selectorsAny || []).filter((sel) => {
      try { return !!queryVisible(doc, sel) || !!doc.querySelector(sel); } catch (_) { return false; }
    });
    const selectorsOk = !def.selectorsAny?.length || matchedSelectors.length > 0;
    const ok = hostsOk && pathOk && textsOk && selectorsOk;
    return { ok, pageKey, label: def.label, hostsOk, pathOk, textsOk, selectorsOk, matchedSelectors };
  }

  function detectPage(doc = document) {
    const host = (doc.location || location).hostname || '';
    const pathname = (doc.location || location).pathname || '';
    const pageText = getPageText(doc);

    for (const [key, def] of Object.entries(PAGE_DEFS)) {
      const hOk = hostMatches(def, host);
      const pOk = pathMatches(def, pathname);
      const tOk = textMatches(def, pageText);
      const sOk = selectorsMatch(def, doc);
      if (hOk && pOk && tOk && sOk) return { key, label: def.label };
    }
    return { key: 'unknown', label: 'Page inconnue' };
  }

  function validateExpectedPage(expected, doc = document) {
    const detected = detectPage(doc);
    const ok = detected.key === expected;
    return { ok, expected, detected: detected.key, label: detected.label };
  }

  /**
   * Vérifie la présence du job dans la liste "Active Job Applications" après soumission.
   * @param {string|number} jobId
   * @param {Document} doc
   */
  function checkApplicationInList(jobId, doc = document) {
    const id = String(jobId);
    const listItems = doc.querySelectorAll('main li');
    for (const li of listItems) {
      const leafNodes = Array.from(li.querySelectorAll('*')).filter((el) => el.children.length === 0);
      const hasJobId = leafNodes.some((el) => el.textContent?.trim() === id);
      const hasStatus = (li.innerText || li.textContent || '').includes('Application Submitted');
      if (hasJobId && hasStatus) return true;
    }
    return false;
  }

  /**
   * Vérifie le toast de confirmation (visible ~5s après SUBMIT).
   */
  function checkToast(doc = document) {
    const notif = doc.querySelector('div.notifications[role="alert"]');
    return !!(notif?.innerText?.includes('Thank you for your job application'));
  }

  async function recordLog(entry) {
    try {
      const stored = await chrome.storage.local.get(LOG_KEY);
      const logs = Array.isArray(stored[LOG_KEY]) ? stored[LOG_KEY] : [];
      logs.unshift({ ...entry, ts: Date.now() });
      if (logs.length > MAX_LOG_ENTRIES) logs.length = MAX_LOG_ENTRIES;
      await chrome.storage.local.set({ [LOG_KEY]: logs });
      const checkEntry = { page: entry.page, href: entry.href, ts: Date.now() };
      await chrome.storage.local.set({ [LAST_CHECK_KEY]: checkEntry });
    } catch (_) {}
  }

  // Exposition globale
  const api = {
    detectPage,
    validateExpectedPage,
    getStructureReport,
    checkApplicationInList,
    checkToast,
    recordLog,
    PAGE_DEFS,
    TEXT
  };

  globalThis.__TALEOS_GOLDMAN_SACHS_BLUEPRINT__ = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
