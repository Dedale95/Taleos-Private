/**
 * Taleos - Blueprint Deloitte
 * Cartographie le flux Deloitte public + Workday et audite les champs
 * reelement relies au profil Firebase.
 */
(function () {
  'use strict';

  if (globalThis.__TALEOS_DELOITTE_BLUEPRINT__) return;

  const LAST_CHECK_KEY = 'taleos_deloitte_blueprint_last_check';
  const LOG_KEY = 'taleos_deloitte_blueprint_log';
  const MAX_LOG_ENTRIES = 100;

  const TEXT_PATTERNS = {
    publicOffer: [
      'offer | deloitte france',
      'deloitte france',
      'careers'
    ],
    unavailable: [
      'offre introuvable',
      'job not found',
      'this position is no longer available',
      'cette offre est peut-etre expiree',
      'cette offre est peut être expirée'
    ],
    applyChoice: [
      'postuler manuellement',
      'utiliser ma derniere candidature',
      'utiliser ma dernière candidature'
    ],
    login: [
      'connexion',
      'adresse e-mail',
      'mot de passe',
      'creer un compte',
      'créer un compte'
    ],
    personalDetails: [
      'mes donnees personnelles',
      'mes données personnelles',
      'comment nous avez-vous connus',
      'nature et nom de la voie'
    ],
    experience: [
      'mon experience',
      'mon expérience',
      'etablissement ou universite',
      'établissement ou université',
      'diplome',
      'diplôme'
    ],
    questionnaire: [
      'questions de candidature',
      'niveau d experience',
      'niveau d\'experience',
      'bourse'
    ],
    success: [
      'merci pour votre candidature',
      'thank you for applying',
      'application submitted',
      'we have received your application'
    ]
  };

  const PAGE_DEFS = {
    public_offer: {
      label: 'Offre Deloitte',
      hostIncludes: ['deloitte.com'],
      pathMatches: [/\/careers\/content\/job\/results\/offer\.html/],
      selectorsAny: ['h1', 'main', 'a[href*="myworkdayjobs.com"]'],
      textPatterns: TEXT_PATTERNS.publicOffer
    },
    unavailable: {
      label: 'Offre indisponible',
      textPatterns: TEXT_PATTERNS.unavailable
    },
    apply_choice: {
      label: 'Choix de candidature Workday',
      hostIncludes: ['myworkdayjobs.com'],
      pathMatches: [/\/apply/],
      selectorsAny: ['button', '[role="button"]'],
      textPatterns: TEXT_PATTERNS.applyChoice
    },
    login: {
      label: 'Connexion Workday',
      hostIncludes: ['myworkdayjobs.com'],
      pathMatches: [/\/apply/],
      selectorsAny: [
        'input[data-automation-id="email"]',
        'input[data-automation-id="password"]',
        'input[aria-label*="Adresse e-mail"]',
        '[aria-label="Connexion"][role="button"]'
      ],
      textPatterns: TEXT_PATTERNS.login
    },
    personal_details: {
      label: 'Mes donnees personnelles',
      hostIncludes: ['myworkdayjobs.com'],
      pathMatches: [/\/apply/],
      selectorsAny: [
        '#name--legalName--firstName',
        '#name--legalName--lastName',
        '#source--source',
        '#phoneNumber--phoneNumber'
      ],
      textPatterns: TEXT_PATTERNS.personalDetails
    },
    experience: {
      label: 'Mon experience',
      hostIncludes: ['myworkdayjobs.com'],
      pathMatches: [/\/apply/],
      selectorsAny: [
        'button[aria-haspopup="listbox"][id*="degree"]',
        'input[data-automation-id="searchBox"][id*="school"]',
        '[data-automation-id="file-upload-drop-zone"]'
      ],
      textPatterns: TEXT_PATTERNS.experience
    },
    questionnaire: {
      label: 'Questions de candidature',
      hostIncludes: ['myworkdayjobs.com'],
      pathMatches: [/\/apply/],
      selectorsAny: [
        '[data-fkit-id*="primaryQuestionnaire"]',
        '[data-automation-id="dateSectionDay-input"]'
      ],
      textPatterns: TEXT_PATTERNS.questionnaire
    },
    success: {
      label: 'Succes candidature',
      hostIncludes: ['myworkdayjobs.com'],
      pathMatches: [/\/submission/, /\/apply\//],
      textPatterns: TEXT_PATTERNS.success
    }
  };

  const QUESTION_SECTIONS = {
    personal_details: [
      { key: 'civility', label: 'Titre (prefixe)', profileKey: 'civility', selectors: ['#name--legalName--title', 'button[name="legalName--title"]'], type: 'listbox', critical: true },
      { key: 'firstname', label: 'Prenom', profileKey: 'firstname', selectors: ['#name--legalName--firstName'], type: 'input', critical: true },
      { key: 'lastname', label: 'Nom', profileKey: 'lastname', selectors: ['#name--legalName--lastName'], type: 'input', critical: true },
      { key: 'address', label: 'Adresse', profileKey: 'address', selectors: ['#address--addressLine1'], type: 'input', critical: true },
      { key: 'city', label: 'Ville', profileKey: 'city', selectors: ['#address--city'], type: 'input', critical: true },
      { key: 'zipcode', label: 'Code postal', profileKey: 'zipcode', selectors: ['#address--postalCode'], type: 'input', critical: true },
      { key: 'phone_country_code', label: 'Indicatif pays telephone', profileKey: 'phone_country_code', selectors: ['#phoneNumber--countryPhoneCode', 'input[aria-label*="Indicatif de pays"]'], type: 'input', critical: true },
      { key: 'phone_number', label: 'Numero de telephone', profileKey: 'phone_number', selectors: ['#phoneNumber--phoneNumber', 'input[name="phoneNumber"]'], type: 'input', critical: true },
      { key: 'source', label: 'Source Deloitte Careers', expectedValue: 'Site Deloitte Careers', selectors: ['#source--source', 'input[data-automation-id="searchBox"][id="source--source"]'], type: 'input', critical: true },
      { key: 'deloitte_worked', label: 'Deja travaille chez Deloitte', profileKey: 'deloitte_worked', selectors: ['input[name="candidateIsPreviousWorker"]'], type: 'radio', critical: true },
      { key: 'deloitte_old_office', label: 'Ancien bureau Deloitte', profileKey: 'deloitte_old_office', selectors: ['#previousWorker--location'], type: 'input', when: (profile) => String(profile.deloitte_worked || '').toLowerCase() === 'yes' },
      { key: 'deloitte_old_email', label: 'Ancienne adresse email Deloitte', profileKey: 'deloitte_old_email', selectors: ['#previousWorker--email'], type: 'input', when: (profile) => String(profile.deloitte_worked || '').toLowerCase() === 'yes' }
    ],
    experience: [
      { key: 'establishment', label: 'Etablissement ou universite', profileKey: 'establishment', selectors: ['input[data-automation-id="searchBox"][id*="school"]', 'input[id*="school"][placeholder="Rechercher"]'], type: 'input', critical: true },
      { key: 'education_level', label: 'Diplome', profileKey: 'education_level', selectors: ['button[aria-haspopup="listbox"][id*="degree"]', 'button[aria-haspopup="listbox"][name="degree"]'], type: 'listbox', critical: true },
      { key: 'diploma_year', label: 'Annee de fin', profileKey: 'diploma_year', selectors: ['input[id*="lastYearAttended"][id*="Year"]', '[data-automation-id="dateSectionYear-display"]'], type: 'input', critical: true },
      { key: 'cv_storage_path', label: 'CV', profileKey: 'cv_storage_path', selectors: ['[data-automation-id="file-upload-drop-zone"]', 'input[type="file"]'], type: 'file', critical: true }
    ],
    questionnaire: [
      { key: 'experience_level', label: 'Niveau d experience', profileKey: 'experience_level', selectors: ['[data-fkit-id*="primaryQuestionnaire"]'], type: 'questionnaire', critical: true },
      { key: 'available_date', label: 'Date de disponibilite', profileKey: 'available_date', selectors: ['[data-automation-id="dateSectionDay-input"]', '[data-automation-id="dateSectionMonth-input"]', '[data-automation-id="dateSectionYear-input"]'], type: 'date', critical: true },
      { key: 'apprenticeship_grant', label: 'Bourse alternance', expectedValue: 'Ne se prononce pas', selectors: ['[data-fkit-id*="primaryQuestionnaire"]'], type: 'questionnaire' }
    ]
  };

  const UNSUPPORTED_PROFILE_FIELDS = {
    personal_details: ['country'],
    experience: ['school_type', 'diploma_status', 'lm_storage_path'],
    questionnaire: ['job_families', 'contract_types', 'continents', 'target_countries', 'target_regions', 'languages', 'deloitte_country']
  };

  function normalizeText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
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

  function getPageText(doc) {
    return normalizeText(doc?.body?.innerText || doc?.body?.textContent || '');
  }

  function hostMatches(def, hostname) {
    return (def.hostIncludes || []).every((part) => hostname.includes(part));
  }

  function pathMatches(def, pathname, href) {
    return (def.pathMatches || []).some((re) => re.test(pathname) || re.test(href));
  }

  function countTextMatches(text, patterns) {
    return (patterns || []).filter((pattern) => text.includes(normalizeText(pattern))).length;
  }

  function detectPage(ctx = {}) {
    const doc = ctx.document || document;
    const loc = ctx.location || location;
    const href = String(loc.href || '');
    const hostname = String(loc.hostname || '').toLowerCase();
    const pathname = String(loc.pathname || '').toLowerCase();
    const text = getPageText(doc);

    const scored = Object.entries(PAGE_DEFS).map(([key, def]) => {
      let score = 0;
      if (hostMatches(def, hostname)) score += 2;
      if (pathMatches(def, pathname, href)) score += 2;
      const textMatches = countTextMatches(text, def.textPatterns);
      score += Math.min(textMatches, 3);
      const matchedSelectors = (def.selectorsAny || []).filter((selector) => !!queryVisible(doc, selector) || !!doc.querySelector(selector));
      if (matchedSelectors.length) score += 2;
      return { key, score, textMatches, matchedSelectors, label: def.label };
    }).sort((a, b) => b.score - a.score);

    const winner = scored[0] || { key: 'unknown', score: 0, label: 'Inconnu', textMatches: 0, matchedSelectors: [] };
    return {
      key: winner.score > 0 ? winner.key : 'unknown',
      label: winner.score > 0 ? winner.label : 'Inconnu',
      score: winner.score || 0,
      textMatches: winner.textMatches || 0,
      matchedSelectors: winner.matchedSelectors || [],
      candidates: scored.slice(0, 4),
      href
    };
  }

  function summarizeValue(value) {
    if (value == null) return '';
    if (Array.isArray(value)) return value.map(summarizeValue).filter(Boolean).join(', ');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value).trim();
  }

  function getExpectedValue(profile, question) {
    if (typeof question.expectedValue !== 'undefined') return summarizeValue(question.expectedValue);
    return summarizeValue(profile?.[question.profileKey]);
  }

  function getQuestionElement(doc, question) {
    for (const selector of question.selectors || []) {
      const el = queryVisible(doc, selector) || doc.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  function getCurrentValue(doc, question) {
    const el = getQuestionElement(doc, question);
    if (!el) return '';
    if (question.type === 'radio') {
      const radios = Array.from(doc.querySelectorAll('input[name="candidateIsPreviousWorker"]'));
      const checked = radios.find((radio) => radio.checked);
      return checked ? String(checked.value || '').trim() : '';
    }
    if (question.type === 'file') {
      const fileInput = el.matches?.('input[type="file"]') ? el : doc.querySelector('input[type="file"]');
      if (fileInput?.files?.[0]?.name) return fileInput.files[0].name;
      return normalizeText(el.textContent || '').includes('upload') ? 'zone_visible' : '';
    }
    if (question.type === 'listbox') {
      return String(el.getAttribute('aria-label') || el.textContent || '').trim();
    }
    if (question.type === 'questionnaire') {
      return normalizeText(el.textContent || '');
    }
    if (question.type === 'date') {
      const values = (question.selectors || []).map((selector) => {
        const node = queryVisible(doc, selector) || doc.querySelector(selector);
        return node?.value || node?.textContent || '';
      }).filter(Boolean);
      return values.join('/');
    }
    return String(el.value || el.textContent || '').trim();
  }

  function valuesRoughlyMatch(expected, current) {
    const exp = normalizeText(expected);
    const cur = normalizeText(current);
    if (!exp) return true;
    if (!cur) return false;
    if (cur.includes(exp) || exp.includes(cur)) return true;
    if (questionLooksBoolean(exp, cur)) return true;
    return false;
  }

  function questionLooksBoolean(expected, current) {
    const booleanPairs = [
      [['yes', 'oui', 'true', '1'], ['yes', 'oui', 'true', '1']],
      [['no', 'non', 'false', '0'], ['no', 'non', 'false', '0']]
    ];
    return booleanPairs.some(([a, b]) => a.includes(expected) && b.includes(current));
  }

  function buildQuestionState(profile, doc, question) {
    const applicable = typeof question.when === 'function' ? !!question.when(profile || {}) : true;
    const expected = getExpectedValue(profile || {}, question);
    const present = applicable ? !!getQuestionElement(doc, question) : false;
    const current = present ? getCurrentValue(doc, question) : '';
    let status = 'not_expected';

    if (!applicable) {
      status = 'not_applicable';
    } else if (expected) {
      if (!present) status = 'missing';
      else if (!current) status = 'empty';
      else if (valuesRoughlyMatch(expected, current)) status = 'ok';
      else status = 'different';
    } else if (present) {
      status = current ? 'present_without_profile' : 'empty';
    } else {
      status = 'missing_without_profile';
    }

    return {
      key: question.key,
      label: question.label,
      status,
      expectedValue: expected,
      currentValue: current,
      present,
      critical: !!question.critical,
      applicable,
      profileKey: question.profileKey || null
    };
  }

  function getQuestionAuditReport(profile = {}, doc = document, options = {}) {
    const pageKey = options.pageKey || detectPage({ document: doc }).key;
    const sections = [];
    for (const [sectionKey, questions] of Object.entries(QUESTION_SECTIONS)) {
      if (pageKey !== sectionKey && !options.includeAllSections) continue;
      const details = questions.map((question) => buildQuestionState(profile, doc, question));
      const unresolved = details.filter((detail) => ['missing', 'empty', 'different'].includes(detail.status));
      sections.push({
        key: sectionKey,
        label: sectionKey.replace(/_/g, ' '),
        details,
        expectedCount: details.filter((detail) => detail.applicable && detail.expectedValue).length,
        presentCount: details.filter((detail) => detail.present).length,
        unresolvedCount: unresolved.length,
        unresolved: unresolved.map((detail) => detail.label)
      });
    }

    const unsupported = (UNSUPPORTED_PROFILE_FIELDS[pageKey] || []).map((field) => ({
      profileKey: field,
      value: summarizeValue(profile?.[field]),
      reason: 'Champ du profil non expose sur ce flux Deloitte/Workday'
    })).filter((entry) => entry.value);

    const unresolvedQuestionCount = sections.reduce((sum, section) => sum + section.unresolvedCount, 0);
    return {
      pageKey,
      sections,
      unsupported,
      unresolvedQuestionCount
    };
  }

  function getPublicOfferStructureReport(doc = document, href = location.href) {
    const detected = detectPage({ document: doc, location: new URL(href, location.origin) });
    const applyLinks = Array.from(doc.querySelectorAll('a[href], button, [role="button"]'))
      .filter((el) => isVisible(el))
      .map((el) => ({
        text: (el.textContent || el.getAttribute('aria-label') || '').trim(),
        href: el.href || ''
      }));
    const workdayLinks = applyLinks.filter((entry) => /myworkdayjobs\.com/i.test(entry.href));
    const postulerButtons = applyLinks.filter((entry) => /postuler/i.test(entry.text));
    return {
      kind: 'offer_structure',
      ok: detected.key === 'public_offer' && (workdayLinks.length > 0 || postulerButtons.length > 0),
      detected: detected.key,
      workdayLinkCount: workdayLinks.length,
      postulerCount: postulerButtons.length,
      sampleWorkdayLink: workdayLinks[0]?.href || ''
    };
  }

  function getLoginStructureReport(doc = document) {
    const email = queryVisible(doc, 'input[data-automation-id="email"]') || queryVisible(doc, 'input[aria-label*="Adresse e-mail"]');
    const password = queryVisible(doc, 'input[data-automation-id="password"]') || queryVisible(doc, 'input[aria-label*="Mot de passe"]');
    const submit = queryVisible(doc, '[aria-label="Connexion"][role="button"]') || queryVisible(doc, '[data-automation-id="click_filter"][aria-label="Connexion"]');
    return {
      kind: 'login_structure',
      ok: !!(email && password && submit),
      email: !!email,
      password: !!password,
      submit: !!submit
    };
  }

  function getApplyChoiceReport(doc = document) {
    const manual = Array.from(doc.querySelectorAll('button, [role="button"]')).find((el) => isVisible(el) && /postuler manuellement/i.test(el.textContent || ''));
    const reuse = Array.from(doc.querySelectorAll('button, [role="button"], a')).find((el) => isVisible(el) && /derniere candidature|dernière candidature/i.test(el.textContent || ''));
    return {
      kind: 'apply_choice',
      ok: !!(manual || reuse),
      manual: !!manual,
      reuse: !!reuse
    };
  }

  function getPersonalDetailsReport(doc = document, profile = {}) {
    return {
      kind: 'personal_details',
      ok: detectPage({ document: doc }).key === 'personal_details',
      questionAudit: getQuestionAuditReport(profile, doc, { pageKey: 'personal_details' })
    };
  }

  function getExperienceReport(doc = document, profile = {}) {
    return {
      kind: 'experience',
      ok: detectPage({ document: doc }).key === 'experience',
      questionAudit: getQuestionAuditReport(profile, doc, { pageKey: 'experience' })
    };
  }

  function getQuestionnaireReport(doc = document, profile = {}) {
    return {
      kind: 'questionnaire',
      ok: detectPage({ document: doc }).key === 'questionnaire',
      questionAudit: getQuestionAuditReport(profile, doc, { pageKey: 'questionnaire' })
    };
  }

  function getSuccessStructureReport(doc = document) {
    const detected = detectPage({ document: doc });
    return {
      kind: 'success_structure',
      ok: detected.key === 'success',
      detected: detected.key
    };
  }

  async function readLog() {
    try {
      const data = await chrome.storage.local.get([LOG_KEY]);
      return Array.isArray(data[LOG_KEY]) ? data[LOG_KEY] : [];
    } catch (_) {
      return [];
    }
  }

  async function recordLog(entry) {
    const line = {
      at: new Date().toISOString(),
      ...entry
    };
    try {
      const current = await readLog();
      current.unshift(line);
      await chrome.storage.local.set({ [LOG_KEY]: current.slice(0, MAX_LOG_ENTRIES) });
    } catch (_) {}
    return line;
  }

  async function storeLastCheck(entry) {
    const line = {
      at: new Date().toISOString(),
      ...entry
    };
    try {
      await chrome.storage.local.set({ [LAST_CHECK_KEY]: line });
    } catch (_) {}
    return line;
  }

  async function validateCurrentPage(expectedKeys, options = {}) {
    const doc = options.document || document;
    const detected = detectPage({ document: doc, location: options.location || location });
    const expected = Array.isArray(expectedKeys) ? expectedKeys : [expectedKeys];
    const ok = expected.includes(detected.key);
    const entry = {
      kind: 'validate_page',
      ok,
      expected,
      detected: detected.key,
      score: detected.score,
      href: detected.href
    };
    await storeLastCheck(entry);
    await recordLog(entry);
    return entry;
  }

  async function validateQuestionAudit(profile = {}, options = {}) {
    const report = getQuestionAuditReport(profile, options.document || document, options);
    const ok = report.unresolvedQuestionCount === 0;
    const entry = {
      kind: 'question_audit',
      ok,
      pageKey: report.pageKey,
      unresolvedQuestionCount: report.unresolvedQuestionCount,
      unsupportedCount: report.unsupported.length,
      report
    };
    await storeLastCheck(entry);
    await recordLog(entry);
    return entry;
  }

  async function snapshotCurrentPage(options = {}) {
    const doc = options.document || document;
    const profile = options.profile || null;
    const detected = detectPage({ document: doc, location: options.location || location });
    const snapshot = {
      kind: 'snapshot',
      detectedPage: detected.key,
      href: String((options.location || location).href || ''),
      publicOffer: detected.key === 'public_offer' ? getPublicOfferStructureReport(doc) : null,
      login: detected.key === 'login' ? getLoginStructureReport(doc) : null,
      applyChoice: detected.key === 'apply_choice' ? getApplyChoiceReport(doc) : null,
      personalDetails: detected.key === 'personal_details' ? getPersonalDetailsReport(doc, profile || {}) : null,
      experience: detected.key === 'experience' ? getExperienceReport(doc, profile || {}) : null,
      questionnaire: detected.key === 'questionnaire' ? getQuestionnaireReport(doc, profile || {}) : null,
      success: detected.key === 'success' ? getSuccessStructureReport(doc) : null
    };
    if (profile && ['personal_details', 'experience', 'questionnaire'].includes(detected.key)) {
      snapshot.questionAudit = getQuestionAuditReport(profile, doc, { pageKey: detected.key });
    }
    await storeLastCheck(snapshot);
    await recordLog(snapshot);
    return snapshot;
  }

  globalThis.__TALEOS_DELOITTE_BLUEPRINT__ = {
    LAST_CHECK_KEY,
    LOG_KEY,
    detectPage,
    getPublicOfferStructureReport,
    getLoginStructureReport,
    getApplyChoiceReport,
    getPersonalDetailsReport,
    getExperienceReport,
    getQuestionnaireReport,
    getSuccessStructureReport,
    getQuestionAuditReport,
    validateCurrentPage,
    validateQuestionAudit,
    snapshotCurrentPage,
    recordLog,
    storeLastCheck
  };
})();
