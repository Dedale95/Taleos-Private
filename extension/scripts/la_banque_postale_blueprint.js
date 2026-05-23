/**
 * Taleos - Blueprint La Banque Postale (LBP)
 * Couvre : page offre www.labanquepostale.com + formulaire Lumesse/TalentLink.
 */
(function () {
  'use strict';

  if (globalThis.__TALEOS_LBP_BLUEPRINT__) return;

  const LAST_CHECK_KEY = 'taleos_lbp_blueprint_last_check';
  const LOG_KEY = 'taleos_lbp_blueprint_log';
  const MAX_LOG_ENTRIES = 100;

  const TEXT_PATTERNS = {
    offer: [
      'la banque postale',
      'nos offres d emploi',
      'nos offres d alternance',
      'rejoindre la banque postale',
      'postuler a cette offre',
      'offre d emploi',
    ],
    lumesseForm: [
      'comment souhaitez-vous postuler',
      'formulaire sans cv',
      'civilite',
      'autorisation de travail en france',
    ],
    success: [
      'nous avons bien recu votre candidature',
      'merci d avoir postule',
      'candidature envoyee',
      'votre candidature a bien ete envoyee',
    ],
    unavailable: [
      'offre non disponible',
      'page introuvable',
      'cette offre n est plus disponible',
    ],
  };

  const PAGE_DEFS = {
    offer: {
      label: 'Offre LBP',
      hostIncludes: ['www.labanquepostale.com', 'labanquepostale.com'],
      pathMatches: [/\.job-\d+\.html/, /offres-d-emploi/, /nos-offres/],
      textPatterns: TEXT_PATTERNS.offer,
      selectorsAny: [
        'a[href*="recruitmentplatform.com"]',
        'h1',
        '[class*="postuler"], [class*="apply"], [class*="candidature"]',
      ],
    },
    lumesse_form: {
      label: 'Lumesse formulaire LBP',
      hostIncludes: ['labanquepostale.recruitmentplatform.com'],
      textPatterns: TEXT_PATTERNS.lumesseForm,
      selectorsAny: [
        'form.apply-main-form',
        'select[name="form_of_address"]',
        'input[name="last_name"]',
        'input[name="e-mail_address"]',
      ],
    },
    success: {
      label: 'Succès candidature LBP',
      hostIncludes: ['labanquepostale.recruitmentplatform.com'],
      textPatterns: TEXT_PATTERNS.success,
    },
    unavailable: {
      label: 'Offre indisponible LBP',
      textPatterns: TEXT_PATTERNS.unavailable,
    },
  };

  function normalizeText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getPageText(doc) {
    return normalizeText(doc?.body?.innerText || doc?.body?.textContent || '');
  }

  function isVisible(el) {
    if (!el) return false;
    const style = globalThis.getComputedStyle ? getComputedStyle(el) : null;
    return el.offsetParent !== null && style?.visibility !== 'hidden' && style?.display !== 'none';
  }

  function queryVisible(doc, selector) {
    try {
      return Array.from(doc.querySelectorAll(selector)).find(isVisible) || null;
    } catch (_) {
      return null;
    }
  }

  function hostMatches(def, hostname) {
    const list = def.hostIncludes || [];
    if (!list.length) return true;
    return list.some((part) => hostname === part || hostname.includes(part));
  }

  function pathMatchesDef(def, pathname, href) {
    return (def.pathMatches || []).some((re) => re.test(pathname) || re.test(href));
  }

  function selectorsAnyMatch(def, doc) {
    return (def.selectorsAny || []).some((selector) => {
      try {
        return !!doc.querySelector(selector);
      } catch (_) {
        return false;
      }
    });
  }

  function getTextMatches(def, text) {
    return (def.textPatterns || []).filter((pattern) => text.includes(normalizeText(pattern)));
  }

  function scorePage(def, ctx) {
    let score = 0;
    const reasons = [];
    if (hostMatches(def, ctx.hostname)) { score += 3; reasons.push('host'); }
    if (pathMatchesDef(def, ctx.pathname, ctx.href)) { score += 3; reasons.push('path'); }
    const textMatches = getTextMatches(def, ctx.text);
    if (textMatches.length) {
      score += Math.min(4, textMatches.length);
      reasons.push(`text:${textMatches.length}`);
    }
    if (selectorsAnyMatch(def, ctx.doc)) { score += 2; reasons.push('selectorsAny'); }
    return { score, reasons, textMatches };
  }

  function detectPage(doc = document, href = location.href) {
    const url = new URL(href, location.origin);
    const ctx = {
      doc,
      href: url.href,
      hostname: url.hostname,
      pathname: url.pathname,
      text: getPageText(doc),
    };

    let best = { page: 'unknown', score: 0, label: 'Inconnu', reasons: [], textMatches: [] };
    for (const [page, def] of Object.entries(PAGE_DEFS)) {
      const res = scorePage(def, ctx);
      if (res.score > best.score) {
        best = { page, score: res.score, label: def.label, reasons: res.reasons, textMatches: res.textMatches };
      }
    }

    return {
      page: best.page,
      label: best.label,
      score: best.score,
      reasons: best.reasons,
      textMatches: best.textMatches,
      url: url.href,
      hostname: url.hostname,
      pathname: url.pathname,
      title: doc.title || '',
      h1: doc.querySelector('h1')?.textContent?.trim() || '',
    };
  }

  /**
   * Extrait les métadonnées d'une offre LBP depuis l'URL et le DOM.
   * jobId : "LBP_{number}" extrait du pattern ".job-{number}.html".
   */
  function getJobMetadata(doc = document, href = location.href) {
    const url = new URL(href, location.origin);
    const jobIdMatch = url.pathname.match(/\.job-(\d+)\.html/i);
    const jobId = jobIdMatch ? `LBP_${jobIdMatch[1]}` : '';

    const h1 = doc.querySelector('h1');
    const title = h1?.textContent?.trim() || doc.title?.trim() || '';

    // Lien Lumesse sur la page offre
    const applyLink = Array.from(doc.querySelectorAll('a[href*="recruitmentplatform.com"]')).find(isVisible);
    const applyUrl = applyLink?.href || '';

    return {
      jobId,
      jobTitle: title,
      jobUrl: url.href,
      companyName: 'La Banque Postale',
      applyUrl,
    };
  }

  /**
   * Trouve le lien Lumesse/"Postuler" sur la page offre LBP.
   * Retourne l'élément <a> visible ou null.
   */
  function findApplyLink(doc = document) {
    // 1) Lien direct vers recruitmentplatform.com (le plus fiable)
    const directLink = Array.from(doc.querySelectorAll('a[href*="recruitmentplatform.com"]')).find(isVisible);
    if (directLink) return directLink;

    // 2) Lien dont le texte contient "postuler"
    const textLink = Array.from(doc.querySelectorAll('a[href]')).find((el) => {
      if (!isVisible(el)) return false;
      const text = normalizeText(el.textContent || '');
      return /postuler|candidater|apply/.test(text) && el.href;
    });
    return textLink || null;
  }

  function getLumesseStructureReport(doc = document) {
    const criticalSelectors = [
      'select[name="form_of_address"]',
      'input[name="last_name"]',
      'input[name="first_name"]',
      'input[name="e-mail_address"]',
    ];
    const lbpSpecific = [
      'select[name="custom_question_407"]',
      'select[name="custom_question_474"]',
      'input[id^="upload_cover_letter_"][type="file"]',
      'form[id^="form_cover_letter_"] input[type="file"]',
    ];
    const matched = criticalSelectors.filter((s) => {
      try { return !!doc.querySelector(s); } catch (_) { return false; }
    });
    const matchedLbp = lbpSpecific.filter((s) => {
      try { return !!doc.querySelector(s); } catch (_) { return false; }
    });
    return {
      kind: 'lbp_lumesse_structure',
      ok: matched.length >= 3,
      matched,
      missing: criticalSelectors.filter((s) => !matched.includes(s)),
      lbpSpecificFields: matchedLbp,
    };
  }

  function getSuccessStructureReport(doc = document) {
    const text = getPageText(doc);
    const patterns = TEXT_PATTERNS.success.map(normalizeText).filter((p) => text.includes(p));
    return {
      kind: 'lbp_success_structure',
      ok: patterns.length > 0,
      matchedText: patterns,
    };
  }

  function validatePage(expectedPages, doc = document) {
    const expected = Array.isArray(expectedPages) ? expectedPages : [expectedPages];
    const detected = detectPage(doc);
    return { ok: expected.includes(detected.page), expected, detected };
  }

  async function persist(key, value) {
    try { await chrome.storage.local.set({ [key]: value }); } catch (_) {}
  }

  async function appendLog(entry) {
    try {
      const store = await chrome.storage.local.get(LOG_KEY);
      const arr = Array.isArray(store[LOG_KEY]) ? store[LOG_KEY] : [];
      arr.unshift(entry);
      await chrome.storage.local.set({ [LOG_KEY]: arr.slice(0, MAX_LOG_ENTRIES) });
    } catch (_) {}
  }

  async function logCheck(label, payload = {}) {
    const detected = detectPage(document);
    const entry = {
      at: new Date().toISOString(),
      label,
      page: detected.page,
      url: location.href,
      title: document.title || '',
      ...payload,
    };
    await persist(LAST_CHECK_KEY, entry);
    await appendLog(entry);
    return entry;
  }

  globalThis.__TALEOS_LBP_BLUEPRINT__ = {
    LAST_CHECK_KEY,
    LOG_KEY,
    detectPage,
    validatePage,
    logCheck,
    getJobMetadata,
    findApplyLink,
    getLumesseStructureReport,
    getSuccessStructureReport,
  };
})();
