/**
 * Taleos - Blueprint Societe Generale
 * Detecte les etapes SG et Taleo avec des signatures strictes pour eviter
 * les faux positifs sur les nombreux CTA du site public.
 */
(function () {
  'use strict';

  if (globalThis.__TALEOS_SG_BLUEPRINT__) return;

  const LAST_CHECK_KEY = 'taleos_sg_blueprint_last_check';
  const LOG_KEY = 'taleos_sg_blueprint_log';
  const MAX_LOG_ENTRIES = 100;

  const TEXT_PATTERNS = {
    offer: [
      'postuler',
      'finance',
      'informations complementaires',
      'description',
      'profil recherche',
      'informations cles'
    ],
    login: [
      'me connecter',
      'create your profile',
      'creer mon profil',
      'suivre mes candidatures',
      'programmer mes alertes'
    ],
    redirect: [
      'htmlredirection',
      'redirectrequest',
      'redirectionuri',
      'target='
    ],
    disclaimer: [
      'accord de confidentialite',
      'confidentiality agreement',
      'j\'ai lu',
      'i have read'
    ],
    screening: [
      'please answer the following questions',
      'are you authorized to work in the european union',
      'what is your notice period',
      'what would be your start date',
      'quel est votre preavis',
      'etes-vous autorise a travailler dans l\'union europeenne'
    ],
    personalInformation: [
      'informations personnelles',
      'personal information',
      'merci de verifier',
      'verify and complete'
    ],
    attachments: [
      'pieces jointes',
      'attachments',
      'resume / cv',
      'telecharger mon cv plus tard',
      'upload'
    ],
    reviewSubmit: [
      'verifier et postuler',
      'review and submit',
      'postuler',
      'submit application'
    ],
    success: [
      'c\'est dans la boite',
      'votre candidature a bien ete',
      'your application has been submitted',
      'we have received your application'
    ],
    unavailable: [
      'page not found',
      'error 404',
      'job position is no longer online',
      'the requested page no longer exists'
    ]
  };

  const PAGE_DEFS = {
    public_offer: {
      label: 'Offre publique SG',
      hostIncludes: ['careers.societegenerale.com'],
      pathMatches: [/\/offres-d-emploi\//],
      textPatterns: TEXT_PATTERNS.offer,
      selectorsAll: ['#taleo_url'],
      selectorsAny: [
        'a.btnApply[href*="jobapply.ftl"]',
        'a[data-gtm-label="postuler"][href*="jobapply.ftl"]'
      ]
    },
    taleo_redirect: {
      label: 'Redirection Taleo',
      hostIncludes: ['socgen.taleo.net'],
      pathMatches: [/\/careersection\/sgcareers\/jobapply\.ftl/],
      textPatterns: TEXT_PATTERNS.redirect
    },
    login: {
      label: 'Connexion Taleo',
      hostIncludes: ['socgen.taleo.net'],
      pathMatches: [/login\.jsf/, /profile\.ftl/],
      textPatterns: TEXT_PATTERNS.login,
      selectorsAny: [
        '#dialogTemplate-dialogForm-login-name1',
        '#dialogTemplate-dialogForm-login-password',
        'input[id*="login-name1"]',
        'input[id*="login-password"]'
      ]
    },
    disclaimer: {
      label: 'Disclaimer',
      hostIncludes: ['socgen.taleo.net'],
      pathMatches: [/flow\.jsf/],
      textPatterns: TEXT_PATTERNS.disclaimer
    },
    screening: {
      label: 'Questions ecranage',
      hostIncludes: ['socgen.taleo.net'],
      pathMatches: [/flow\.jsf/],
      textPatterns: TEXT_PATTERNS.screening,
      selectorsAny: ['textarea', 'input[type="radio"]']
    },
    personal_information: {
      label: 'Informations personnelles',
      hostIncludes: ['socgen.taleo.net'],
      pathMatches: [/flow\.jsf/],
      textPatterns: TEXT_PATTERNS.personalInformation,
      selectorsAny: [
        'input[id*="personal_info_FirstName"]',
        'input[id*="FirstName"]',
        'input[id*="LastName"]'
      ]
    },
    attachments: {
      label: 'Pieces jointes',
      hostIncludes: ['socgen.taleo.net'],
      pathMatches: [/flow\.jsf/],
      textPatterns: TEXT_PATTERNS.attachments,
      selectorsAny: [
        'table.attachment-list',
        'input[type="file"][id*="uploadedFile"]',
        'input[id*="skipResumeUploadRadio"]'
      ]
    },
    review_submit: {
      label: 'Recap postuler',
      hostIncludes: ['socgen.taleo.net'],
      pathMatches: [/flow\.jsf/],
      textPatterns: TEXT_PATTERNS.reviewSubmit,
      selectorsAny: [
        'input[id*="submitCmdBottom"]',
        'input[value="Postuler"]',
        'input[value*="Submit"]'
      ]
    },
    success: {
      label: 'Succes candidature',
      hostIncludes: ['socgen.taleo.net'],
      pathMatches: [/flow\.jsf/],
      textPatterns: TEXT_PATTERNS.success
    },
    unavailable: {
      label: 'Offre indisponible',
      textPatterns: TEXT_PATTERNS.unavailable
    }
  };

  const QUESTION_SECTIONS = {
    disclaimer: [
      { key: 'legal_disclaimer_ack', profileKey: null, selector: 'input[type="checkbox"], input[id*="legalDisclaimer"], input[name*="legalDisclaimer"]', label: 'Accord de confidentialite', type: 'checkbox', critical: true },
      { key: 'disclaimer_continue', profileKey: null, selector: 'input[id*="legalDisclaimerContinueButton"], input[id*="legalDisclaimerAcceptButton"], input[id*="disclaimerContinue"], input[id*="saveContinueCmdBottom"], button[id*="legalDisclaimer"], button[id*="disclaimerContinue"]', label: 'Continuer apres disclaimer', type: 'submit', critical: true }
    ],
    screening: [
      { key: 'eu_work_authorization', profileKey: 'sg_eu_work_authorization', label: 'Autorisation UE', type: 'radio', critical: true },
      { key: 'notice_period', profileKey: 'sg_notice_period', label: 'Preavis', type: 'radio', critical: true },
      { key: 'start_date', profileKey: 'available_date', label: 'Date de debut', type: 'textarea', critical: true },
      { key: 'screening_continue', profileKey: null, selector: 'input[id*="saveContinueCmdBottom"], button[id*="saveContinueCmdBottom"], input[value*="Continue"], input[value*="Continuer"]', label: 'Continuer apres questions', type: 'submit', critical: true }
    ],
    personal_information: [
      { key: 'civility', profileKey: 'civility', selector: 'select[id*="PersonalTitle"], select[name*="PersonalTitle"], select[id*="Title"][id*="personal"], select[id*="civility"]', label: 'Civilite', type: 'select' },
      { key: 'firstname', profileKey: 'firstname', selector: 'input[id*="personal_info_FirstName"], input[id*="FirstName"]', label: 'Prenom', type: 'input', critical: true },
      { key: 'lastname', profileKey: 'lastname', selector: 'input[id*="personal_info_LastName"], input[id*="LastName"]', label: 'Nom', type: 'input', critical: true },
      { key: 'email', profileKey: 'email', selector: 'input[id*="personal_info_EmailAddress"], input[id*="EmailAddress"]', label: 'Email', type: 'input' },
      { key: 'phone', profileKey: 'phone-number', selector: 'input[id*="personal_info_MobilePhone"], input[id*="MobilePhone"]', label: 'Telephone', type: 'input' },
      { key: 'save_continue_profile', profileKey: null, selector: 'input[id*="saveContinueCmdBottom"], button[id*="saveContinueCmdBottom"]', label: 'Sauvegarder et continuer profil', type: 'submit', critical: true }
    ],
    attachments: [
      { key: 'cv_upload', profileKey: 'cv_storage_path', selector: 'input[type="file"][id*="uploadedFile"]', label: 'Upload CV', type: 'file', critical: true },
      { key: 'skip_cv_later', profileKey: null, selector: 'input[id*="skipResumeUploadRadio"][value="1"]', label: 'CV plus tard', type: 'radio_optional' },
      { key: 'resume_checkbox', profileKey: 'cv_storage_path', selector: 'input[id*="resumeselectionid"]', label: 'Case Resume', type: 'checkbox_optional' },
      { key: 'save_continue_attachments', profileKey: null, selector: 'input[id*="saveContinueCmdBottom"], button[id*="saveContinueCmdBottom"]', label: 'Sauvegarder et continuer pieces jointes', type: 'submit', critical: true }
    ],
    review_submit: [
      { key: 'final_submit', profileKey: null, selector: 'input[id*="submitCmdBottom"], input[value="Postuler"], input[value*="Submit"]', label: 'Bouton Postuler', type: 'submit', critical: true }
    ]
  };

  const PAGE_TO_QUESTION_SECTIONS = {
    disclaimer: ['disclaimer'],
    screening: ['screening'],
    personal_information: ['personal_information'],
    attachments: ['attachments'],
    review_submit: ['review_submit']
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
    return normalizeText(doc?.body?.textContent || '');
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

  function textMatch(def, text) {
    return (def.textPatterns || []).some((pattern) => text.includes(pattern));
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

  function pathMatches(def, pathname, href) {
    return (def.pathMatches || []).some((re) => re.test(pathname) || re.test(href));
  }

  function hostMatches(def, hostname) {
    const list = def.hostIncludes || [];
    if (!list.length) return true;
    return list.some((part) => hostname.includes(part));
  }

  function detectPage(ctx = {}) {
    const doc = ctx.document || document;
    const loc = ctx.location || window.location;
    const href = String(loc?.href || '').toLowerCase();
    const pathname = String(loc?.pathname || '').toLowerCase();
    const hostname = String(loc?.hostname || '').toLowerCase();
    const text = getPageText(doc);

    const ranked = Object.entries(PAGE_DEFS).map(([key, def]) => {
      let score = 0;
      const evidence = [];
      if (hostMatches(def, hostname)) {
        score += 2;
        evidence.push('host');
      }
      if (pathMatches(def, pathname, href)) {
        score += 4;
        evidence.push('path');
      }
      if ((def.selectorsAny || []).length && selectorsAnyMatch(def, doc)) {
        score += 3;
        evidence.push('selectorsAny');
      }
      if ((def.selectorsAll || []).length && selectorsAllMatch(def, doc)) {
        score += 2;
        evidence.push('selectorsAll');
      }
      if (textMatch(def, text)) {
        score += 4;
        evidence.push('text');
      }
      return {
        key,
        label: def.label,
        score,
        evidence,
        selectors: collectSelectorMatches(def, doc)
      };
    }).sort((a, b) => b.score - a.score);

    const best = ranked[0];
    if (best && best.score > 0) return best;
    return { key: 'unknown', label: 'Page inconnue', score: 0, evidence: [], selectors: { matched: [], missing: [] } };
  }

  function summarizeVisibleText(doc, selector, limit = 12) {
    try {
      return Array.from(doc.querySelectorAll(selector))
        .filter(isVisible)
        .map((el) => String(el.textContent || '').trim())
        .filter(Boolean)
        .slice(0, limit);
    } catch (_) {
      return [];
    }
  }

  function decodeHtmlEntities(value) {
    return String(value || '')
      .replace(/&amp;/gi, '&')
      .replace(/&#38;/gi, '&');
  }

  function normalizeTaleoApplyUrl(rawUrl) {
    const value = decodeHtmlEntities(rawUrl).trim();
    if (!value) return null;
    try {
      const url = new URL(value, window.location.href);
      if (!/socgen\.taleo\.net$/i.test(url.hostname)) return null;
      if (!/\/careersection\/sgcareers\/jobapply\.ftl$/i.test(url.pathname)) return null;
      return {
        href: url.href,
        pathname: url.pathname,
        job: url.searchParams.get('job') || '',
        src: url.searchParams.get('src') || '',
        lang: url.searchParams.get('lang') || ''
      };
    } catch (_) {
      return null;
    }
  }

  function isEquivalentTaleoApplyUrl(candidateUrl, blueprintUrl) {
    const candidate = normalizeTaleoApplyUrl(candidateUrl);
    const blueprint = normalizeTaleoApplyUrl(blueprintUrl);
    if (!candidate || !blueprint) return false;
    return candidate.pathname === blueprint.pathname &&
      candidate.job === blueprint.job &&
      candidate.src === blueprint.src &&
      candidate.lang === blueprint.lang;
  }

  function getOfferStructureReport(doc = document) {
    const taleoUrlEl = doc.querySelector('#taleo_url');
    const taleoUrl = decodeHtmlEntities(String(taleoUrlEl?.getAttribute('data-value') || '').trim());
    const applyLinks = Array.from(doc.querySelectorAll('a.btnApply[href*="jobapply.ftl"], a[data-gtm-label="postuler"][href*="jobapply.ftl"]'));
    const visibleApplyLinks = applyLinks.filter(isVisible);
    const matchingApplyLinks = visibleApplyLinks.filter((link) => {
      const href = String(link.getAttribute('href') || '');
      return taleoUrl && isEquivalentTaleoApplyUrl(href, taleoUrl);
    });
    const wrongApplyLinks = visibleApplyLinks
      .filter((link) => !matchingApplyLinks.includes(link))
      .map((link) => String(link.getAttribute('href') || ''));

    return {
      ok: !!taleoUrl && matchingApplyLinks.length > 0,
      taleoUrl,
      normalizedTaleoUrl: normalizeTaleoApplyUrl(taleoUrl)?.href || '',
      visibleApplyCount: visibleApplyLinks.length,
      matchingApplyCount: matchingApplyLinks.length,
      wrongApplyLinks
    };
  }

  function getLoginStructureReport(doc = document) {
    const criticalSelectors = [
      '#dialogTemplate-dialogForm-login-name1',
      '#dialogTemplate-dialogForm-login-password'
    ];
    const criticalMissing = criticalSelectors.filter((selector) => !doc.querySelector(selector));
    return {
      ok: criticalMissing.length === 0,
      criticalMissing,
      submitVisible: !!queryVisible(doc, '#dialogTemplate-dialogForm-login-defaultCmd')
    };
  }

  function getStepStructureReport(doc = document) {
    const detected = detectPage({ document: doc });
    const pageText = getPageText(doc);
    const currentStepTexts = summarizeVisibleText(doc, 'a[id*="dtGotoPageLink"], .selected a[id*="dtGotoPageLink"], .current a[id*="dtGotoPageLink"]', 10);
    return {
      detected: detected.key,
      currentStepTexts,
      hasFlowUrl: String(window.location?.href || '').toLowerCase().includes('flow.jsf'),
      pageTextHints: {
        disclaimer: TEXT_PATTERNS.disclaimer.filter((pattern) => pageText.includes(pattern)).length,
        screening: TEXT_PATTERNS.screening.filter((pattern) => pageText.includes(pattern)).length,
        personalInformation: TEXT_PATTERNS.personalInformation.filter((pattern) => pageText.includes(pattern)).length,
        attachments: TEXT_PATTERNS.attachments.filter((pattern) => pageText.includes(pattern)).length,
        reviewSubmit: TEXT_PATTERNS.reviewSubmit.filter((pattern) => pageText.includes(pattern)).length
      }
    };
  }

  function summarizeExpectedValue(value) {
    if (Array.isArray(value)) return value.join(', ');
    return String(value || '').trim();
  }

  function getQuestionExpectedValue(profile, question) {
    if (!profile || !question.profileKey) return '';
    if (question.key === 'start_date') return profile.available_date || profile.available_from || profile.available_from_raw || '';
    return profile[question.profileKey] || '';
  }

  function getQuestionCurrentValue(doc, question) {
    if (question.type === 'radio') {
      const text = getPageText(doc);
      if (question.key === 'eu_work_authorization') {
        const hasYes = /yes|oui/.test(text);
        const hasNo = /no|non/.test(text);
        return hasYes || hasNo ? 'radio_present' : '';
      }
      if (question.key === 'notice_period') {
        return /month|mois|preavis|notice period/.test(text) ? 'radio_present' : '';
      }
    }
    if (question.type === 'textarea') {
      const textarea = queryVisible(doc, 'textarea') || doc.querySelector('textarea');
      return String(textarea?.value || '').trim();
    }
    if (question.type === 'checkbox' || question.type === 'checkbox_optional' || question.type === 'radio_optional') {
      const el = queryVisible(doc, question.selector) || doc.querySelector(question.selector);
      return el ? (el.checked ? 'checked' : 'unchecked') : '';
    }
    const el = queryVisible(doc, question.selector) || doc.querySelector(question.selector);
    if (!el) return '';
    if (question.type === 'input' || question.type === 'file') {
      return String(el.value || '').trim();
    }
    if (question.type === 'select') {
      if (el.tagName === 'SELECT') {
        return String(el.options?.[el.selectedIndex]?.text || el.value || '').trim();
      }
      return String(el.textContent || '').trim();
    }
    if (question.type === 'submit') {
      return String(el.value || el.textContent || '').trim();
    }
    return String(el.textContent || '').trim();
  }

  function getQuestionPresence(doc, question) {
    if (question.type === 'radio') {
      const text = getPageText(doc);
      if (question.key === 'eu_work_authorization') {
        return /authorized to work|union europeenne|european union/.test(text);
      }
      if (question.key === 'notice_period') {
        return /notice period|preavis/.test(text);
      }
    }
    if (question.type === 'textarea') {
      const text = getPageText(doc);
      return /start date|date de debut|prise en poste/.test(text) || !!doc.querySelector('textarea');
    }
    return !!(queryVisible(doc, question.selector) || doc.querySelector(question.selector));
  }

  function getRelevantQuestionSections(doc = document, explicitDetectedPage = '') {
    const detectedPage = explicitDetectedPage || detectPage({ document: doc }).key;
    return PAGE_TO_QUESTION_SECTIONS[detectedPage] || [];
  }

  function getQuestionAuditReport(profile = {}, doc = document, options = {}) {
    const detectedPage = options.detectedPage || detectPage({ document: doc }).key;
    const relevantSections = new Set(options.sectionKeys || getRelevantQuestionSections(doc, detectedPage));
    const sections = Object.entries(QUESTION_SECTIONS).map(([sectionKey, questions]) => {
      const active = relevantSections.size === 0 ? true : relevantSections.has(sectionKey);
      const details = questions.map((question) => {
        const expectedValue = summarizeExpectedValue(getQuestionExpectedValue(profile, question));
        const currentValue = getQuestionCurrentValue(doc, question);
        const present = getQuestionPresence(doc, question);
        const expectedFromProfile = !!question.profileKey && expectedValue !== '';
        let status = 'not_needed';
        if (!question.profileKey) {
          status = present ? 'present' : 'missing';
        } else if (!expectedFromProfile) {
          status = present ? 'not_needed_present' : 'not_needed_missing';
        } else if (!present) {
          status = 'missing';
        } else if (!normalizeText(currentValue)) {
          status = 'empty';
        } else if (question.type === 'radio' || question.type === 'submit' || question.type === 'file') {
          status = 'present';
        } else if (normalizeText(currentValue).includes(normalizeText(expectedValue)) || normalizeText(expectedValue).includes(normalizeText(currentValue))) {
          status = 'matching';
        } else {
          status = 'different';
        }
        return {
          key: question.key,
          label: question.label,
          profileKey: question.profileKey,
          expectedValue,
          currentValue,
          present,
          critical: !!question.critical,
          status,
          active
        };
      });
      const activeDetails = details.filter((item) => item.active);
      return {
        key: sectionKey,
        active,
        total: details.length,
        expectedCount: activeDetails.filter((item) => item.profileKey && item.expectedValue).length,
        presentCount: activeDetails.filter((item) => item.present).length,
        matchingCount: activeDetails.filter((item) => item.status === 'matching').length,
        missing: activeDetails.filter((item) => item.status === 'missing').map((item) => item.label),
        unresolvedCount: activeDetails.filter((item) => ['missing', 'different', 'empty'].includes(item.status)).length,
        ok: active ? activeDetails.every((item) => !(item.critical && item.status === 'missing')) : true,
        details
      };
    });

    const criticalMissing = sections
      .flatMap((section) => section.details)
      .filter((item) => item.active && item.critical && item.status === 'missing')
      .map((item) => item.label);

    const unresolvedQuestionCount = sections
      .flatMap((section) => section.details)
      .filter((item) => item.active && ['missing', 'different', 'empty'].includes(item.status))
      .length;

    return {
      ok: criticalMissing.length === 0,
      detectedPage,
      relevantSections: Array.from(relevantSections),
      criticalMissing,
      unresolvedQuestionCount,
      sections
    };
  }

  async function persistLastCheck(result) {
    try {
      await chrome.storage.local.set({
        [LAST_CHECK_KEY]: { ...result, at: new Date().toISOString() }
      });
    } catch (_) {}
  }

  async function appendDiagnosticLog(entry) {
    try {
      const { [LOG_KEY]: current = [] } = await chrome.storage.local.get([LOG_KEY]);
      const next = [...current, { ...entry, at: new Date().toISOString() }].slice(-MAX_LOG_ENTRIES);
      await chrome.storage.local.set({ [LOG_KEY]: next });
    } catch (_) {}
  }

  async function validateExpectedPage(expected, options = {}) {
    const expectedList = Array.isArray(expected) ? expected : [expected];
    const detected = detectPage(options);
    const result = {
      ok: expectedList.includes(detected.key),
      kind: 'validate_page',
      expected: expectedList,
      detected: detected.key,
      detectedLabel: detected.label,
      score: detected.score,
      evidence: detected.evidence,
      matchedSelectors: detected.selectors?.matched || [],
      missingSelectors: detected.selectors?.missing || [],
      url: String((options.location || window.location)?.href || '')
    };
    await persistLastCheck(result);
    await appendDiagnosticLog(result);
    return result;
  }

  async function validateOfferStructure(options = {}) {
    const report = getOfferStructureReport(options.document || document);
    const result = { kind: 'offer_structure', url: String((options.location || window.location)?.href || ''), ...report };
    await persistLastCheck(result);
    await appendDiagnosticLog(result);
    return result;
  }

  async function validateLoginStructure(options = {}) {
    const report = getLoginStructureReport(options.document || document);
    const result = { kind: 'login_structure', url: String((options.location || window.location)?.href || ''), ...report };
    await persistLastCheck(result);
    await appendDiagnosticLog(result);
    return result;
  }

  async function validateQuestionAudit(profile = {}, options = {}) {
    const report = getQuestionAuditReport(profile, options.document || document, options);
    const result = { kind: 'question_audit', url: String((options.location || window.location)?.href || ''), ...report };
    await persistLastCheck(result);
    await appendDiagnosticLog(result);
    return result;
  }

  function getPageSnapshot(tag, options = {}) {
    const doc = options.document || document;
    const loc = options.location || window.location;
    const detected = detectPage({ document: doc, location: loc });
    const snapshot = {
      kind: 'snapshot',
      tag,
      url: String(loc?.href || ''),
      title: String(doc?.title || ''),
      detected: detected.key,
      detectedLabel: detected.label,
      score: detected.score,
      evidence: detected.evidence,
      matchedSelectors: detected.selectors?.matched || [],
      headings: summarizeVisibleText(doc, 'h1, h2, h3'),
      buttons: summarizeVisibleText(doc, 'button, a, input[type="submit"], input[type="button"]', 16),
      stepStructure: getStepStructureReport(doc)
    };
    if (detected.key === 'public_offer') snapshot.offerStructure = getOfferStructureReport(doc);
    if (detected.key === 'login') snapshot.loginStructure = getLoginStructureReport(doc);
    if (options.profile) snapshot.questionAudit = getQuestionAuditReport(options.profile, doc);
    return snapshot;
  }

  async function capturePageSnapshot(tag, options = {}) {
    const snapshot = getPageSnapshot(tag, options);
    await appendDiagnosticLog(snapshot);
    return snapshot;
  }

  globalThis.__TALEOS_SG_BLUEPRINT__ = {
    textPatterns: TEXT_PATTERNS,
    pageDefinitions: PAGE_DEFS,
    detectPage,
    getPageSnapshot,
    capturePageSnapshot,
    validateExpectedPage,
    normalizeTaleoApplyUrl,
    isEquivalentTaleoApplyUrl,
    getOfferStructureReport,
    validateOfferStructure,
    getLoginStructureReport,
    validateLoginStructure,
    getRelevantQuestionSections,
    getQuestionAuditReport,
    validateQuestionAudit
  };
})();
