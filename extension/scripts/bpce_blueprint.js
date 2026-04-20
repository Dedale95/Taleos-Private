/**
 * Taleos - Blueprint BPCE
 * Couvre les variantes BPCE/Natixis sur portail public, Oracle Cloud et Lumesse.
 */
(function () {
  'use strict';

  if (globalThis.__TALEOS_BPCE_BLUEPRINT__) return;

  const LAST_CHECK_KEY = 'taleos_bpce_blueprint_last_check';
  const LOG_KEY = 'taleos_bpce_blueprint_log';
  const MAX_LOG_ENTRIES = 100;

  const TEXT_PATTERNS = {
    offer: [
      'postuler directement',
      'poste et missions',
      'profil et competences recherchees',
      'technology risk management',
      'workday_',
      'natixis',
      'bpce recrutement'
    ],
    oracleEmail: [
      'formulaire de candidature',
      'ecran d authentification',
      'adresse electronique',
      'bonjour, bienvenue sur notre site carrieres natixis',
      'il n est pas necessaire de creer un compte'
    ],
    oraclePin: [
      'code pin',
      'verification d identite',
      'verifier',
      'renvoyer le code',
      'confirmer votre identite'
    ],
    oracleThrottle: [
      'trop de tentatives',
      'reessayez plus tard',
      'nombre maximum de tentatives',
      'try again later',
      'maximum number of attempts'
    ],
    oracleForm: [
      'nom',
      'prenom',
      'linkedin',
      'disponibilite',
      'vivier natixis',
      'handicap',
      'origine de votre candidature'
    ],
    lumesseForm: [
      'comment souhaitez-vous postuler',
      'formulaire sans cv',
      'civilite',
      'autorisation de travail en france'
    ],
    success: [
      'merci d avoir postule',
      'candidature envoyee',
      'application submitted',
      'thank you for applying',
      'we have received your application'
    ],
    unavailable: [
      'offre non disponible',
      'page introuvable',
      'page not found',
      'job not found',
      'position no longer available'
    ]
  };

  const PAGE_DEFS = {
    offer: {
      label: 'Offre BPCE',
      hostIncludes: ['recrutement.bpce.fr', '.recrutement.bpce.fr'],
      pathMatches: [/\/job\//],
      textPatterns: TEXT_PATTERNS.offer,
      selectorsAll: ['h1'],
      selectorsAny: [
        '.c-offer-sticky-button',
        'a[href*="oraclecloud.com"][href*="/apply/"]',
        'a[href*="recruitmentplatform.com"]'
      ]
    },
    oracle_email: {
      label: 'Oracle email',
      hostIncludes: ['oraclecloud.com'],
      pathMatches: [/\/apply\/email/],
      textPatterns: TEXT_PATTERNS.oracleEmail,
      selectorsAny: [
        '#primary-email-0',
        'input[type="email"]',
        '.apply-flow-input-checkbox__button',
        'button[title="Suivant"]'
      ]
    },
    oracle_pin: {
      label: 'Oracle pin',
      hostIncludes: ['oraclecloud.com'],
      pathMatches: [/\/apply\/email/, /CandidateExperience/],
      textPatterns: TEXT_PATTERNS.oraclePin,
      selectorsAny: [
        '#pin-code-1',
        '#pin-code-2',
        'button[title="Vérifier"]',
        'button[title="Verifier"]'
      ]
    },
    oracle_throttle: {
      label: 'Oracle limitation temporaire',
      hostIncludes: ['oraclecloud.com'],
      pathMatches: [/\/apply\/email/, /CandidateExperience/],
      textPatterns: TEXT_PATTERNS.oracleThrottle,
      selectorsAny: [
        'button',
        'main'
      ]
    },
    oracle_form: {
      label: 'Oracle formulaire',
      hostIncludes: ['oraclecloud.com'],
      pathMatches: [/CandidateExperience/, /\/apply\//],
      textPatterns: TEXT_PATTERNS.oracleForm,
      selectorsAny: [
        'input[id*="lastName"]',
        'input[id*="firstName"]',
        'textarea[name="300000620007177"]',
        'input[id*="siteLink"]',
        'input[type="file"][id*="uploadedFile"]'
      ]
    },
    lumesse_form: {
      label: 'Lumesse formulaire',
      hostIncludes: ['recruitmentplatform.com'],
      textPatterns: TEXT_PATTERNS.lumesseForm,
      selectorsAny: [
        'form.apply-main-form',
        'select[name="form_of_address"]',
        'input[name="last_name"]',
        'input[name="first_name"]',
        'input[name="e-mail_address"]'
      ]
    },
    success: {
      label: 'Succes candidature',
      hostIncludes: ['oraclecloud.com', 'recruitmentplatform.com'],
      textPatterns: TEXT_PATTERNS.success
    },
    unavailable: {
      label: 'Offre indisponible',
      textPatterns: TEXT_PATTERNS.unavailable
    }
  };

  function normalizeText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
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

  function collectSelectorMatches(def, doc) {
    const selectors = [...(def.selectorsAny || []), ...(def.selectorsAll || [])];
    const matched = [];
    const missing = [];
    for (const selector of selectors) {
      const el = queryVisible(doc, selector) || doc.querySelector(selector);
      if (el) matched.push(selector);
      else missing.push(selector);
    }
    return { matched, missing };
  }

  function hostMatches(def, hostname) {
    const list = def.hostIncludes || [];
    if (!list.length) return true;
    return list.some((part) => hostname === part || hostname.includes(part));
  }

  function pathMatches(def, pathname, href) {
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

  function selectorsAllMatch(def, doc) {
    return (def.selectorsAll || []).every((selector) => {
      try {
        return !!doc.querySelector(selector);
      } catch (_) {
        return false;
      }
    });
  }

  function getTextMatches(def, text) {
    return (def.textPatterns || []).filter((pattern) => text.includes(pattern));
  }

  function scorePage(def, ctx) {
    let score = 0;
    const reasons = [];
    if (hostMatches(def, ctx.hostname)) {
      score += 3;
      reasons.push('host');
    }
    if (pathMatches(def, ctx.pathname, ctx.href)) {
      score += 3;
      reasons.push('path');
    }
    const textMatches = getTextMatches(def, ctx.text);
    if (textMatches.length) {
      score += Math.min(4, textMatches.length);
      reasons.push(`text:${textMatches.length}`);
    }
    if (selectorsAllMatch(def, ctx.doc) && (def.selectorsAll || []).length) {
      score += 3;
      reasons.push('selectorsAll');
    }
    if (selectorsAnyMatch(def, ctx.doc)) {
      score += 2;
      reasons.push('selectorsAny');
    }
    return { score, reasons, textMatches };
  }

  function detectPage(doc = document, href = location.href) {
    const url = new URL(href, location.origin);
    const ctx = {
      doc,
      href: url.href,
      hostname: url.hostname,
      pathname: url.pathname,
      text: getPageText(doc)
    };

    let best = { page: 'unknown', score: 0, label: 'Inconnu', reasons: [], textMatches: [] };
    for (const [page, def] of Object.entries(PAGE_DEFS)) {
      const res = scorePage(def, ctx);
      if (res.score > best.score) {
        best = {
          page,
          score: res.score,
          label: def.label,
          reasons: res.reasons,
          textMatches: res.textMatches
        };
      }
    }

    const selectorInfo = best.page !== 'unknown'
      ? collectSelectorMatches(PAGE_DEFS[best.page], doc)
      : { matched: [], missing: [] };

    return {
      page: best.page,
      label: best.label,
      score: best.score,
      reasons: best.reasons,
      textMatches: best.textMatches,
      selectorMatches: selectorInfo.matched,
      selectorMissing: selectorInfo.missing,
      url: url.href,
      hostname: url.hostname,
      pathname: url.pathname,
      title: doc.title || '',
      h1: doc.querySelector('h1')?.textContent?.trim() || ''
    };
  }

  function normalizeApplyUrl(raw) {
    try {
      const url = new URL(raw, location.href);
      const pathname = url.pathname;
      const jobMatch = pathname.match(/\/job\/([^/]+)\/apply\/email/i);
      return JSON.stringify({
        host: url.hostname,
        path: pathname.replace(/\/+$/, ''),
        jobRef: jobMatch ? jobMatch[1] : '',
        lang: url.searchParams.get('lang') || '',
        site: url.searchParams.get('site') || ''
      });
    } catch (_) {
      return '';
    }
  }

  function getVisibleApplyLinks(doc = document) {
    const links = Array.from(doc.querySelectorAll('a[href]')).filter(isVisible);
    return links.filter((el) => {
      const href = String(el.getAttribute('href') || '');
      const text = normalizeText(el.textContent || '');
      return /postuler|candidater|apply/.test(text) ||
        href.includes('oraclecloud.com') ||
        href.includes('recruitmentplatform.com');
    });
  }

  function inferOfferVariant(doc = document) {
    const text = getPageText(doc);
    const title = normalizeText(doc.querySelector('h1')?.textContent || doc.title || '');
    if (text.includes('natixis') || title.includes('natixis')) return 'natixis_oracle';
    if (text.includes('banque populaire') || text.includes('caisse d epargne') || text.includes('bpce')) return 'bpce_oracle';
    return 'bpce_unknown';
  }

  function getOfferStructureReport(doc = document) {
    const visibleApplyLinks = getVisibleApplyLinks(doc);
    const oracleLinks = visibleApplyLinks.filter((el) => String(el.href || '').includes('oraclecloud.com'));
    const lumesseLinks = visibleApplyLinks.filter((el) => String(el.href || '').includes('recruitmentplatform.com'));
    const matchingOracleGroups = new Set(oracleLinks.map((el) => normalizeApplyUrl(el.href)));
    const h1 = doc.querySelector('h1');
    const pageText = getPageText(doc);
    const workdayCodeMatch = (doc.body?.innerText || '').match(/\bWORKDAY_[A-Z0-9_-]+\b/);
    const titleOk = !!(h1 && normalizeText(h1.textContent).length > 3);
    const codeOk = !!workdayCodeMatch;
    const applyCount = oracleLinks.length + lumesseLinks.length;
    return {
      kind: 'offer_structure',
      ok: titleOk && codeOk && applyCount > 0,
      variant: inferOfferVariant(doc),
      title: h1?.textContent?.trim() || '',
      workdayCode: workdayCodeMatch ? workdayCodeMatch[0] : '',
      oracleApplyCount: oracleLinks.length,
      lumesseApplyCount: lumesseLinks.length,
      matchingApplyCount: matchingOracleGroups.has('') ? oracleLinks.length - 1 : matchingOracleGroups.size,
      visibleApplyCount: visibleApplyLinks.length,
      sampleApplyUrls: visibleApplyLinks.slice(0, 3).map((el) => String(el.href || '')),
      textSignals: {
        postulerDirectement: pageText.includes('postuler directement'),
        posteEtMissions: pageText.includes('poste et missions'),
        profil: pageText.includes('profil et competences recherchees')
      }
    };
  }

  function getOracleEmailStructureReport(doc = document) {
    return {
      kind: 'oracle_email_structure',
      ok: !!(
        queryVisible(doc, '#primary-email-0') &&
        queryVisible(doc, '.apply-flow-input-checkbox__button') &&
        queryVisible(doc, 'button[title="Suivant"]')
      ),
      hasEmailInput: !!queryVisible(doc, '#primary-email-0'),
      hasConsentCheckbox: !!queryVisible(doc, '.apply-flow-input-checkbox__button'),
      hasNextButton: !!queryVisible(doc, 'button[title="Suivant"]'),
      hasPinInput: !!queryVisible(doc, '#pin-code-1')
    };
  }

  function getOraclePinStructureReport(doc = document) {
    const pinCount = Array.from({ length: 6 }, (_, idx) => idx + 1)
      .filter((n) => !!queryVisible(doc, `#pin-code-${n}`))
      .length;
    return {
      kind: 'oracle_pin_structure',
      ok: pinCount >= 1,
      pinInputCount: pinCount,
      hasVerifyButton: !!(
        queryVisible(doc, 'button[title="Vérifier"]') ||
        queryVisible(doc, 'button[title="Verifier"]') ||
        Array.from(doc.querySelectorAll('button')).find((el) => isVisible(el) && /verifier|verify/i.test(el.textContent || ''))
      ),
      hasResendButton: !!Array.from(doc.querySelectorAll('button, a')).find((el) => isVisible(el) && /renvoyer|resend/i.test(el.textContent || ''))
    };
  }

  function getOracleFormStructureReport(doc = document) {
    const criticalSelectors = [
      'input[id*="lastName"]',
      'input[id*="firstName"]'
    ];
    const helpfulSelectors = [
      'textarea[name="300000620007177"]',
      'input[id*="siteLink"]',
      'input[type="file"][id*="uploadedFile"]',
      '.apply-flow-block',
      '.input-row'
    ];
    const matchedCritical = criticalSelectors.filter((selector) => !!queryVisible(doc, selector));
    const matchedHelpful = helpfulSelectors.filter((selector) => !!queryVisible(doc, selector));
    return {
      kind: 'oracle_form_structure',
      ok: matchedCritical.length >= 1 && matchedHelpful.length >= 1,
      matchedCritical,
      missingCritical: criticalSelectors.filter((selector) => !matchedCritical.includes(selector)),
      matchedHelpful
    };
  }

  function getLumesseStructureReport(doc = document) {
    const criticalSelectors = [
      'select[name="form_of_address"]',
      'input[name="last_name"]',
      'input[name="first_name"]',
      'input[name="e-mail_address"]'
    ];
    const matched = criticalSelectors.filter((selector) => !!queryVisible(doc, selector) || !!doc.querySelector(selector));
    return {
      kind: 'lumesse_structure',
      ok: matched.length >= 2,
      matched,
      missing: criticalSelectors.filter((selector) => !matched.includes(selector))
    };
  }

  function getSuccessStructureReport(doc = document) {
    const text = getPageText(doc);
    const patterns = TEXT_PATTERNS.success.filter((pattern) => text.includes(pattern));
    return {
      kind: 'bpce_success_structure',
      ok: patterns.length > 0,
      matchedText: patterns
    };
  }

  function getPageStructureReport(page, doc = document) {
    if (page === 'offer') return getOfferStructureReport(doc);
    if (page === 'oracle_email') return getOracleEmailStructureReport(doc);
    if (page === 'oracle_pin') return getOraclePinStructureReport(doc);
    if (page === 'oracle_throttle') return {
      kind: 'oracle_throttle_structure',
      ok: true,
      matchedText: TEXT_PATTERNS.oracleThrottle.filter((pattern) => getPageText(doc).includes(pattern))
    };
    if (page === 'oracle_form') return getOracleFormStructureReport(doc);
    if (page === 'lumesse_form') return getLumesseStructureReport(doc);
    if (page === 'success') return getSuccessStructureReport(doc);
    return null;
  }

  function validatePage(expectedPages, doc = document) {
    const expected = Array.isArray(expectedPages) ? expectedPages : [expectedPages];
    const detected = detectPage(doc);
    return {
      ok: expected.includes(detected.page),
      expected,
      detected
    };
  }

  async function persist(key, value) {
    try {
      await chrome.storage.local.set({ [key]: value });
    } catch (_) {}
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
      ...payload
    };
    await persist(LAST_CHECK_KEY, entry);
    await appendLog(entry);
    return entry;
  }

  globalThis.__TALEOS_BPCE_BLUEPRINT__ = {
    LAST_CHECK_KEY,
    LOG_KEY,
    detectPage,
    validatePage,
    logCheck,
    getOfferStructureReport,
    getOracleEmailStructureReport,
    getOraclePinStructureReport,
    getOracleFormStructureReport,
    getLumesseStructureReport,
    getSuccessStructureReport,
    getPageStructureReport,
    normalizeApplyUrl,
    inferOfferVariant
  };
})();
