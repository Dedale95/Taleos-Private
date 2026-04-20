/**
 * Taleos - Blueprint Crédit Agricole
 * Décrit les signatures de pages attendues et aide à valider qu'on est bien
 * sur la bonne étape avant de remplir/interagir.
 */
(function () {
  'use strict';

  if (globalThis.__TALEOS_CA_BLUEPRINT__) return;

  const LAST_CHECK_KEY = 'taleos_ca_blueprint_last_check';
  const LOG_KEY = 'taleos_ca_blueprint_log';
  const MAX_LOG_ENTRIES = 80;

  const TEXT_PATTERNS = {
    unavailable: [
      'la page que vous recherchez est introuvable',
      'page introuvable',
      'offre non disponible',
      'offre n\'est plus en ligne',
      'offre expirée',
      'page not found',
      'job position is no longer online',
      'the requested page no longer exists'
    ],
    success: [
      'votre candidature a été envoyée avec succès',
      'envoyée avec succès',
      'candidature validée',
      'your application has been sent',
      'application sent successfully',
      'application submitted'
    ],
    alreadyApplied: [
      'vous avez déjà postulé',
      'désolé',
      'suivre ma candidature',
      'you have already applied',
      'track my application',
      'already applied'
    ],
    login: [
      'heureux de vous voir',
      'connectez-vous ou créez votre compte',
      'adresse e-mail',
      'mot de passe oublié',
      'rester connecté',
      'attention, votre compte sera bloqué',
      'happy to see you',
      'sign in',
      'forgot password'
    ],
    offer: [
      'comment souhaitez-vous postuler',
      'candidature express',
      'candidature détaillée',
      'postuler en tant qu\'invité',
      'je crée mon compte',
      'type de contrat',
      'numéro de l\'offre',
      'description du poste'
    ],
    application: [
      'mes informations',
      'mes documents',
      'mon profil',
      'mes formations',
      'champ obligatoire',
      'champs obligatoires',
      'votre candidature',
      'suivant'
    ]
  };

  const PAGE_DEFS = {
    unavailable: {
      label: 'Offre indisponible',
      pathMatches: [/\/404(?:\/|$)/, /not[-_]?found/],
      textPatterns: TEXT_PATTERNS.unavailable
    },
    success: {
      label: 'Succès candidature',
      pathMatches: [/candidature-validee/, /application-submitted/, /apply\/success/],
      textPatterns: TEXT_PATTERNS.success
    },
    login: {
      label: 'Connexion',
      pathMatches: [/connexion/, /login/, /connection/],
      textPatterns: TEXT_PATTERNS.login,
      selectorsAny: [
        '#form-login-email',
        '#form-login-submit',
        'input[id*="login-email"]',
        'input[type="email"]'
      ],
      selectorsAll: [
        'input[type="password"]'
      ]
    },
    offer: {
      label: 'Offre',
      pathMatches: [/\/nos-offres-emploi\//, /\/our-offers\//, /\/our-offres\//],
      textPatterns: TEXT_PATTERNS.offer,
      selectorsAny: [
        'button.cta.primary[data-popin="popin-application"]',
        'button[data-popin="popin-application"]',
        '#popin-application',
        'a.cta.secondary.arrow[href*="connexion"]',
        'a[href*="connexion"]',
        'a[href*="candidature"]'
      ]
    },
    application: {
      label: 'Formulaire candidature',
      pathMatches: [/\/candidature\//, /\/application\//, /\/apply\//],
      textPatterns: TEXT_PATTERNS.application,
      selectorsAny: [
        '#form-apply-firstname',
        '#form-apply-lastname',
        '#applyBtn',
        'form[id*="apply"]',
        'button.cta.next-step'
      ]
    },
    admin_ajax: {
      label: 'Admin Ajax',
      pathMatches: [/admin-ajax/]
    }
  };

  const FIELD_MAP = {
    personal: [
      { profileKey: 'firstname', selector: '#form-apply-firstname', label: 'Prenom' },
      { profileKey: 'lastname', selector: '#form-apply-lastname', label: 'Nom' },
      { profileKey: 'address', selector: '#form-apply-address', label: 'Adresse' },
      { profileKey: 'zipcode', selector: '#form-apply-zipcode', label: 'Code postal' },
      { profileKey: 'city', selector: '#form-apply-city', label: 'Ville' },
      { profileKey: 'phone-number', selector: '#form-apply-phone-number', label: 'Telephone' },
      { profileKey: 'civility', selector: 'div[aria-controls="customSelect-civility"]', label: 'Civilite' },
      { profileKey: 'country', selector: 'div[aria-controls="customSelect-country"]', label: 'Pays' }
    ],
    documents: [
      { profileKey: 'cv_storage_path', selector: '#form-apply-cv', label: 'CV' },
      { profileKey: 'lm_storage_path', selector: '#form-apply-lm', label: 'Lettre de motivation' }
    ],
    profile: [
      { profileKey: 'job_families', selector: '#form-apply-input-families', label: 'Metiers' },
      { profileKey: 'contract_types', selector: 'div[aria-controls="customSelect-contract"]', label: 'Contrat' },
      { profileKey: 'available_date', selector: '#form-apply-available-date', label: 'Disponibilite' },
      { profileKey: 'continents', selector: '#form-apply-input-continents', label: 'Continents' },
      { profileKey: 'target_countries', selector: '#form-apply-input-countries', label: 'Pays cibles' },
      { profileKey: 'target_regions', selector: '#form-apply-input-regions', label: 'Regions' },
      { profileKey: 'experience_level', selector: 'div[aria-controls="customSelect-experience-level"]', label: 'Experience' }
    ],
    education: [
      { profileKey: 'education_level', selector: 'div[aria-controls="customSelect-education-level"]', label: 'Niveau d etudes' },
      { profileKey: 'school_type', selector: 'div[aria-controls="customSelect-school"]', label: 'Type d ecole' },
      { profileKey: 'diploma_status', selector: 'div[aria-controls="customSelect-diploma-status"]', label: 'Statut diplome' },
      { profileKey: 'diploma_year', selector: '#form-apply-diploma-date-obtained', label: 'Annee diplome' }
    ]
  };

  const LOGIN_STRUCTURE = {
    criticalSelectors: [
      'input[type="email"]',
      'input[type="password"]'
    ],
    helpfulSelectors: [
      '#form-login-submit',
      'button[type="submit"]',
      'a[href*="forgot"], a[href*="mot-de-passe"], a[href*="password"]'
    ],
    textPatterns: TEXT_PATTERNS.login
  };

  const APPLY_DIALOG_STRUCTURE = {
    criticalText: [
      'comment souhaitez-vous postuler',
      'candidature détaillée'
    ],
    helpfulText: [
      'candidature express',
      'postuler en tant qu\'invité',
      'connexion',
      'je crée mon compte',
      'je créé mon compte'
    ],
    helpfulSelectors: [
      'a[href*="connexion"]',
      'a[href*="login"]',
      'a[href*="compte"]'
    ]
  };

  const OFFER_STRUCTURE = {
    directApplySelectors: [
      'a[href*="/candidature/"]',
      'a[href*="/application/"]',
      'a[href*="/apply/"]'
    ],
    triggerSelectors: [
      'button.cta.primary[data-popin="popin-application"]',
      'button[data-popin="popin-application"]'
    ],
    dialogSelectors: [
      '#popin-application',
      '#popin-application.open',
      '#popin-application[aria-hidden="false"]'
    ],
    loginSelectors: [
      'a.cta.secondary.arrow[href*="connexion"]',
      'a[href*="connexion"]',
      'a[href*="login"]',
      'a[href*="sign-in"]'
    ],
    textPatterns: TEXT_PATTERNS.offer
  };

  const SUCCESS_STRUCTURE = {
    helpfulSelectors: [
      'a[href*="nos-offres"]',
      'a[href*="our-offers"]',
      'a[href*="offres"]',
      'button',
      'a'
    ],
    helpfulText: [
      'retourner sur les offres',
      'retour',
      'candidature validée',
      'votre candidature a été envoyée avec succès',
      'your application has been sent'
    ]
  };

  const APPLICATION_QUESTIONS = {
    personal: [
      { key: 'firstname', profileKey: 'firstname', selector: '#form-apply-firstname', type: 'input', label: 'Prenom', critical: true },
      { key: 'lastname', profileKey: 'lastname', selector: '#form-apply-lastname', type: 'input', label: 'Nom', critical: true },
      { key: 'address', profileKey: 'address', selector: '#form-apply-address', type: 'input', label: 'Adresse' },
      { key: 'zipcode', profileKey: 'zipcode', selector: '#form-apply-zipcode', type: 'input', label: 'Code postal' },
      { key: 'city', profileKey: 'city', selector: '#form-apply-city', type: 'input', label: 'Ville' },
      { key: 'phone_number', profileKey: 'phone-number', selector: '#form-apply-phone-number', type: 'input', label: 'Telephone' },
      { key: 'civility', profileKey: 'civility', selector: 'div[aria-controls="customSelect-civility"]', type: 'combobox', label: 'Civilite' },
      { key: 'country', profileKey: 'country', selector: 'div[aria-controls="customSelect-country"]', type: 'combobox', label: 'Pays' }
    ],
    documents: [
      { key: 'cv', profileKey: 'cv_storage_path', selector: '#form-apply-cv', type: 'file', label: 'CV' },
      { key: 'lm', profileKey: 'lm_storage_path', selector: '#form-apply-lm', type: 'file', label: 'Lettre de motivation' }
    ],
    profile: [
      { key: 'job_families', profileKey: 'job_families', selector: '#form-apply-input-families', type: 'multiselect', label: 'Metiers' },
      { key: 'contract_type', profileKey: 'contract_types', selector: 'div[aria-controls="customSelect-contract"]', type: 'combobox_first', label: 'Contrat' },
      { key: 'available_date', profileKey: 'available_date', selector: '#form-apply-available-date', type: 'input', label: 'Disponibilite' },
      { key: 'continents', profileKey: 'continents', selector: '#form-apply-input-continents', type: 'multiselect', label: 'Continents' },
      { key: 'target_countries', profileKey: 'target_countries', selector: '#form-apply-input-countries', type: 'multiselect', label: 'Pays cibles' },
      { key: 'target_regions', profileKey: 'target_regions', selector: '#form-apply-input-regions', type: 'multiselect', label: 'Regions' },
      { key: 'experience_level', profileKey: 'experience_level', selector: 'div[aria-controls="customSelect-experience-level"]', type: 'combobox', label: 'Experience' }
    ],
    education: [
      { key: 'education_level', profileKey: 'education_level', selector: 'div[aria-controls="customSelect-education-level"]', type: 'combobox', label: 'Niveau d etudes' },
      { key: 'school_type', profileKey: 'school_type', selector: 'div[aria-controls="customSelect-school"]', type: 'combobox', label: 'Type d ecole' },
      { key: 'diploma_status', profileKey: 'diploma_status', selector: 'div[aria-controls="customSelect-diploma-status"]', type: 'combobox', label: 'Statut diplome' },
      { key: 'diploma_year', profileKey: 'diploma_year', selector: '#form-apply-diploma-date-obtained', type: 'input', label: 'Annee diplome' }
    ],
    consent: [
      { key: 'rgpd_consent', profileKey: null, selector: '.checkbox-btn', type: 'checkbox', label: 'Consentement RGPD', optional: true }
    ]
  };

  function getPageText(doc) {
    return String(doc?.body?.textContent || '').toLowerCase();
  }

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

  function getRawProfileValue(profile, question) {
    if (!profile || !question?.profileKey) return undefined;
    return profile[question.profileKey];
  }

  function getExpectedProfileValue(profile, question) {
    const raw = getRawProfileValue(profile, question);
    if (question?.type === 'combobox_first') {
      return Array.isArray(raw) ? raw[0] : raw;
    }
    return raw;
  }

  function hasExpectedProfileValue(profile, question) {
    const value = getExpectedProfileValue(profile, question);
    if (Array.isArray(value)) return value.length > 0;
    return value != null && String(value).trim() !== '';
  }

  function normalizeExpectedValue(value) {
    if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean);
    return normalizeText(value);
  }

  function summarizeExpectedValue(value, question) {
    if (value == null) return '';
    if (Array.isArray(value)) return value.join(', ');
    if (question?.type === 'file') return String(value).split('/').pop() || 'fichier';
    return String(value);
  }

  function summarizeCurrentValue(question, element) {
    if (!element) return '';
    if (question.type === 'input') return String(element.value || '').trim();
    if (question.type === 'file') {
      if (element.files?.length) return Array.from(element.files).map((file) => file.name).join(', ');
      const containerText = String(element.parentElement?.textContent || '').trim();
      const fileMatch = containerText.match(/[A-Za-z0-9 _.-]+\.(pdf|doc|docx)/i);
      return fileMatch ? fileMatch[0] : '';
    }
    if (question.type === 'checkbox') {
      return element.classList.contains('checked') || element.classList.contains('active') ? 'checked' : 'unchecked';
    }
    return String(element.textContent || '').trim();
  }

  function valuesMatch(question, expected, current) {
    if (!expected) return true;
    if (question.type === 'file') {
      return !!current;
    }
    if (Array.isArray(expected)) {
      const cur = normalizeText(current);
      return expected.every((item) => !item || cur.includes(item));
    }
    const exp = normalizeText(expected);
    const cur = normalizeText(current);
    if (!exp) return true;
    if (!cur) return false;
    return cur.includes(exp) || exp.includes(cur);
  }

  function buildLanguageQuestions(profile) {
    const languages = Array.isArray(profile?.languages) ? profile.languages : [];
    return languages.flatMap((language, index) => {
      const slot = index + 1;
      return [
        {
          key: `language_${slot}_name`,
          profileKey: 'languages',
          selector: `div[aria-controls="customSelect-language-${slot}"]`,
          type: 'combobox',
          label: `Langue ${slot}`,
          expectedValue: language?.name || '',
          dynamicAdd: slot > 1,
          addButtonSelector: '#add-language-btn'
        },
        {
          key: `language_${slot}_level`,
          profileKey: 'languages',
          selector: `div[aria-controls="customSelect-language-level-${slot}"]`,
          type: 'combobox',
          label: `Niveau langue ${slot}`,
          expectedValue: language?.level || '',
          dynamicAdd: slot > 1,
          addButtonSelector: '#add-language-btn'
        }
      ];
    });
  }

  function getQuestionDefinitions(profile) {
    return {
      ...APPLICATION_QUESTIONS,
      languages: buildLanguageQuestions(profile)
    };
  }

  function getQuestionExpectedValue(profile, question) {
    if (question.expectedValue != null) return question.expectedValue;
    return getExpectedProfileValue(profile, question);
  }

  function getQuestionElement(doc, question) {
    return queryVisible(doc, question.selector) || doc.querySelector(question.selector);
  }

  function getQuestionState(doc, question, profile) {
    const element = getQuestionElement(doc, question);
    const expectedValue = getQuestionExpectedValue(profile, question);
    const expectedNormalized = normalizeExpectedValue(expectedValue);
    const currentValue = summarizeCurrentValue(question, element);
    const present = !!element;
    const visible = !!queryVisible(doc, question.selector);
    const expectedFromProfile = question.expectedValue != null
      ? normalizeText(question.expectedValue) !== ''
      : (question.profileKey ? hasExpectedProfileValue(profile, question) : false);
    const addButtonAvailable = question.dynamicAdd ? !!doc.querySelector(question.addButtonSelector || '') : false;
    const missingButAddable = !present && question.dynamicAdd && addButtonAvailable;
    const matches = present ? valuesMatch(question, expectedNormalized, currentValue) : false;

    let status = 'unmapped';
    if (!question.profileKey && question.type === 'checkbox') {
      status = present ? 'present' : 'missing';
    } else if (!expectedFromProfile) {
      status = present ? 'not_needed_present' : 'not_needed_missing';
    } else if (missingButAddable) {
      status = 'dynamic_slot_pending';
    } else if (!present) {
      status = 'missing';
    } else if (matches) {
      status = 'matching';
    } else if (!normalizeText(currentValue)) {
      status = 'empty';
    } else {
      status = 'different';
    }

    return {
      key: question.key,
      label: question.label,
      profileKey: question.profileKey,
      selector: question.selector,
      type: question.type,
      critical: !!question.critical,
      optional: !!question.optional,
      dynamicAdd: !!question.dynamicAdd,
      addButtonAvailable,
      expectedFromProfile,
      expectedValue: summarizeExpectedValue(expectedValue, question),
      currentValue,
      present,
      visible,
      matches,
      status
    };
  }

  function getApplicationQuestionAuditReport(profile = {}, doc = document) {
    const sections = Object.entries(getQuestionDefinitions(profile)).map(([sectionKey, questions]) => {
      const details = questions.map((question) => getQuestionState(doc, question, profile));
      const expectedQuestions = details.filter((detail) => detail.expectedFromProfile);
      const missingQuestions = details.filter((detail) => detail.status === 'missing');
      const mismatchedQuestions = details.filter((detail) => detail.status === 'different' || detail.status === 'empty');
      const dynamicPending = details.filter((detail) => detail.status === 'dynamic_slot_pending');
      return {
        key: sectionKey,
        total: details.length,
        expectedCount: expectedQuestions.length,
        presentCount: details.filter((detail) => detail.present).length,
        matchingCount: details.filter((detail) => detail.status === 'matching').length,
        missing: missingQuestions.map((detail) => detail.label),
        mismatched: mismatchedQuestions.map((detail) => detail.label),
        dynamicPending: dynamicPending.map((detail) => detail.label),
        details
      };
    });

    const expectedQuestions = sections.flatMap((section) => section.details).filter((detail) => detail.expectedFromProfile);
    const unresolvedExpected = expectedQuestions.filter((detail) => detail.status === 'missing' || detail.status === 'different' || detail.status === 'empty');
    const criticalMissing = expectedQuestions.filter((detail) => detail.critical && detail.status === 'missing').map((detail) => detail.label);

    return {
      ok: criticalMissing.length === 0,
      expectedQuestionCount: expectedQuestions.length,
      unresolvedQuestionCount: unresolvedExpected.length,
      criticalMissing,
      sections
    };
  }

  function pathMatches(def, pathname, href) {
    return (def.pathMatches || []).some((re) => re.test(pathname) || re.test(href));
  }

  function selectorsAnyMatch(def, doc) {
    const selectors = def.selectorsAny || [];
    if (!selectors.length) return false;
    return selectors.some((selector) => {
      try {
        return !!doc.querySelector(selector);
      } catch (_) {
        return false;
      }
    });
  }

  function selectorsAllMatch(def, doc) {
    const selectors = def.selectorsAll || [];
    return selectors.every((selector) => {
      try {
        return !!doc.querySelector(selector);
      } catch (_) {
        return false;
      }
    });
  }

  function textMatch(def, text) {
    const patterns = def.textPatterns || [];
    return patterns.some((pattern) => text.includes(pattern));
  }

  function collectSelectorMatches(def, doc) {
    const selectors = [...(def.selectorsAny || []), ...(def.selectorsAll || [])];
    const matched = [];
    const missing = [];
    for (const selector of selectors) {
      if (queryVisible(doc, selector)) matched.push(selector);
      else missing.push(selector);
    }
    return { matched, missing };
  }

  function detectPage(ctx = {}) {
    const doc = ctx.document || document;
    const loc = ctx.location || window.location;
    const href = String(loc?.href || '').toLowerCase();
    const pathname = String(loc?.pathname || '').toLowerCase();
    const text = getPageText(doc);

    const ranked = Object.entries(PAGE_DEFS).map(([key, def]) => {
      let score = 0;
      const evidence = [];
      if (pathMatches(def, pathname, href)) {
        score += 4;
        evidence.push('path');
      }
      if (selectorsAnyMatch(def, doc)) {
        score += 3;
        evidence.push('selectorsAny');
      }
      if (selectorsAllMatch(def, doc) && (def.selectorsAll || []).length) {
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
    const fallback = {
      key: 'unknown',
      label: 'Page inconnue',
      score: 0,
      evidence: [],
      selectors: { matched: [], missing: [] }
    };
    return best && best.score > 0 ? best : fallback;
  }

  function getApplicationStructureReport(doc = document) {
    const sections = Object.entries(FIELD_MAP).map(([sectionKey, fields]) => {
      const details = fields.map((field) => {
        const element = queryVisible(doc, field.selector) || doc.querySelector(field.selector);
        return {
          profileKey: field.profileKey,
          label: field.label,
          selector: field.selector,
          present: !!element,
          visible: !!queryVisible(doc, field.selector)
        };
      });
      const presentCount = details.filter((item) => item.present).length;
      return {
        key: sectionKey,
        total: details.length,
        presentCount,
        missing: details.filter((item) => !item.present).map((item) => item.label),
        details
      };
    });

    const critical = ['#form-apply-firstname', '#form-apply-lastname', '#applyBtn'];
    const criticalMissing = critical.filter((selector) => !doc.querySelector(selector));
    return {
      ok: criticalMissing.length === 0,
      criticalMissing,
      sections
    };
  }

  async function validateApplicationQuestions(profile = {}, options = {}) {
    const doc = options.document || document;
    const report = getApplicationQuestionAuditReport(profile, doc);
    const result = {
      ok: report.ok,
      kind: 'application_questions',
      url: String((options.location || window.location)?.href || ''),
      ...report
    };
    await persistLastCheck(result);
    await appendDiagnosticLog({ kind: 'validate_application_questions', ...result });
    return result;
  }

  function countVisibleSelectors(doc, selectors = []) {
    return selectors.reduce((acc, selector) => acc + (queryVisible(doc, selector) ? 1 : 0), 0);
  }

  function countTextMatches(text, patterns = []) {
    return patterns.reduce((acc, pattern) => acc + (text.includes(pattern) ? 1 : 0), 0);
  }

  function summarizeVisibleText(doc, selector, limit = 8) {
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

  function getLoginStructureReport(doc = document) {
    const text = getPageText(doc);
    const criticalMissing = LOGIN_STRUCTURE.criticalSelectors.filter((selector) => !doc.querySelector(selector));
    const helpfulVisible = countVisibleSelectors(doc, LOGIN_STRUCTURE.helpfulSelectors);
    const textHits = countTextMatches(text, LOGIN_STRUCTURE.textPatterns);
    return {
      ok: criticalMissing.length === 0,
      criticalMissing,
      helpfulVisible,
      textHits
    };
  }

  async function validateLoginStructure(options = {}) {
    const doc = options.document || document;
    const report = getLoginStructureReport(doc);
    const result = {
      ok: report.ok,
      kind: 'login_structure',
      url: String((options.location || window.location)?.href || ''),
      ...report
    };
    await persistLastCheck(result);
    await appendDiagnosticLog({ kind: 'validate_login_structure', ...result });
    return result;
  }

  function getApplyDialogStructureReport(doc = document) {
    const text = getPageText(doc);
    const criticalTextHits = countTextMatches(text, APPLY_DIALOG_STRUCTURE.criticalText);
    const helpfulTextHits = countTextMatches(text, APPLY_DIALOG_STRUCTURE.helpfulText);
    const helpfulSelectorHits = countVisibleSelectors(doc, APPLY_DIALOG_STRUCTURE.helpfulSelectors);
    return {
      ok: criticalTextHits >= 1 && (helpfulTextHits + helpfulSelectorHits) >= 2,
      criticalTextHits,
      helpfulTextHits,
      helpfulSelectorHits
    };
  }

  function getOfferStructureReport(doc = document) {
    const text = getPageText(doc);
    const visibleDirectApply = OFFER_STRUCTURE.directApplySelectors.filter((selector) => !!queryVisible(doc, selector));
    const anyDirectApply = OFFER_STRUCTURE.directApplySelectors.filter((selector) => !!doc.querySelector(selector));
    const visibleTriggers = OFFER_STRUCTURE.triggerSelectors.filter((selector) => !!queryVisible(doc, selector));
    const anyTriggers = OFFER_STRUCTURE.triggerSelectors.filter((selector) => !!doc.querySelector(selector));
    const visibleDialogs = OFFER_STRUCTURE.dialogSelectors.filter((selector) => !!queryVisible(doc, selector));
    const anyDialogs = OFFER_STRUCTURE.dialogSelectors.filter((selector) => !!doc.querySelector(selector));
    const visibleLogin = OFFER_STRUCTURE.loginSelectors.filter((selector) => !!queryVisible(doc, selector));
    const anyLogin = OFFER_STRUCTURE.loginSelectors.filter((selector) => !!doc.querySelector(selector));
    const textHits = countTextMatches(text, OFFER_STRUCTURE.textPatterns);

    let entryMode = 'unknown';
    if (visibleDirectApply.length) entryMode = 'direct_application';
    else if (visibleDialogs.length) entryMode = 'dialog_open';
    else if (visibleTriggers.length) entryMode = 'dialog_trigger';
    else if (visibleLogin.length) entryMode = 'login_only';

    const ok = Boolean(
      visibleDirectApply.length ||
      visibleTriggers.length ||
      visibleDialogs.length ||
      (textHits >= 2 && (anyDirectApply.length || anyTriggers.length || anyDialogs.length || anyLogin.length))
    );

    return {
      ok,
      entryMode,
      textHits,
      visibleDirectApply,
      anyDirectApply,
      visibleTriggers,
      anyTriggers,
      visibleDialogs,
      anyDialogs,
      visibleLogin,
      anyLogin
    };
  }

  async function validateOfferStructure(options = {}) {
    const doc = options.document || document;
    const report = getOfferStructureReport(doc);
    const result = {
      ok: report.ok,
      kind: 'offer_structure',
      url: String((options.location || window.location)?.href || ''),
      ...report
    };
    await persistLastCheck(result);
    await appendDiagnosticLog({ kind: 'validate_offer_structure', ...result });
    return result;
  }

  function getSuccessStructureReport(doc = document, loc = window.location) {
    const href = String(loc?.href || '').toLowerCase();
    const pathname = String(loc?.pathname || '').toLowerCase();
    const text = getPageText(doc);
    const helpfulTextHits = countTextMatches(text, SUCCESS_STRUCTURE.helpfulText);
    const visibleHelpfulSelectors = SUCCESS_STRUCTURE.helpfulSelectors
      .map((selector) => {
        const labels = summarizeVisibleText(doc, selector, 20);
        return { selector, labels };
      })
      .filter((entry) => entry.labels.length);

    return {
      ok: pathname.includes('candidature-validee') || href.includes('application-submitted') || helpfulTextHits >= 1,
      helpfulTextHits,
      visibleHelpfulSelectors
    };
  }

  async function validateSuccessStructure(options = {}) {
    const doc = options.document || document;
    const loc = options.location || window.location;
    const report = getSuccessStructureReport(doc, loc);
    const result = {
      ok: report.ok,
      kind: 'success_structure',
      url: String(loc?.href || ''),
      ...report
    };
    await persistLastCheck(result);
    await appendDiagnosticLog({ kind: 'validate_success_structure', ...result });
    return result;
  }

  async function validateApplyDialogStructure(options = {}) {
    const doc = options.document || document;
    const report = getApplyDialogStructureReport(doc);
    const result = {
      ok: report.ok,
      kind: 'apply_dialog_structure',
      url: String((options.location || window.location)?.href || ''),
      ...report
    };
    await persistLastCheck(result);
    await appendDiagnosticLog({ kind: 'validate_apply_dialog_structure', ...result });
    return result;
  }

  async function validateApplicationStructure(options = {}) {
    const doc = options.document || document;
    const report = getApplicationStructureReport(doc);
    const result = {
      ok: report.ok,
      kind: 'application_structure',
      url: String((options.location || window.location)?.href || ''),
      ...report
    };
    await persistLastCheck(result);
    await appendDiagnosticLog({ kind: 'validate_application_structure', ...result });
    return result;
  }

  async function persistLastCheck(result) {
    try {
      await chrome.storage.local.set({
        [LAST_CHECK_KEY]: {
          ...result,
          at: new Date().toISOString()
        }
      });
    } catch (_) {}
  }

  async function appendDiagnosticLog(entry) {
    try {
      const { [LOG_KEY]: current = [] } = await chrome.storage.local.get([LOG_KEY]);
      const next = [
        ...current,
        {
          ...entry,
          at: new Date().toISOString()
        }
      ].slice(-MAX_LOG_ENTRIES);
      await chrome.storage.local.set({ [LOG_KEY]: next });
    } catch (_) {}
  }

  function getPageSnapshot(tag, options = {}) {
    const doc = options.document || document;
    const loc = options.location || window.location;
    const detected = detectPage({ document: doc, location: loc });
    const text = getPageText(doc);
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
      buttons: summarizeVisibleText(doc, 'button, a[role="button"], .cta', 12),
      textHints: {
        login: countTextMatches(text, TEXT_PATTERNS.login),
        offer: countTextMatches(text, TEXT_PATTERNS.offer),
        application: countTextMatches(text, TEXT_PATTERNS.application),
        success: countTextMatches(text, TEXT_PATTERNS.success),
        unavailable: countTextMatches(text, TEXT_PATTERNS.unavailable)
      }
    };
    if (detected.key === 'login') {
      snapshot.loginStructure = getLoginStructureReport(doc);
    }
    if (detected.key === 'offer') {
      snapshot.offerStructure = getOfferStructureReport(doc);
    }
    if (detected.key === 'application') {
      snapshot.applicationStructure = getApplicationStructureReport(doc);
      if (options.profile) {
        snapshot.applicationQuestions = getApplicationQuestionAuditReport(options.profile, doc);
      }
    }
    if (detected.key === 'success') {
      snapshot.successStructure = getSuccessStructureReport(doc, loc);
    }
    return snapshot;
  }

  async function capturePageSnapshot(tag, options = {}) {
    const snapshot = getPageSnapshot(tag, options);
    await appendDiagnosticLog(snapshot);
    return snapshot;
  }

  async function validateExpectedPage(expected, options = {}) {
    const expectedList = Array.isArray(expected) ? expected : [expected];
    const detected = detectPage(options);
    const ok = expectedList.includes(detected.key);
    const result = {
      ok,
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
    await appendDiagnosticLog({ kind: 'validate_page', ...result });
    return result;
  }

  globalThis.__TALEOS_CA_BLUEPRINT__ = {
    pageDefinitions: PAGE_DEFS,
    fieldMap: FIELD_MAP,
    textPatterns: TEXT_PATTERNS,
    detectPage,
    getPageSnapshot,
    capturePageSnapshot,
    validateExpectedPage,
    getOfferStructureReport,
    validateOfferStructure,
    getApplicationStructureReport,
    validateApplicationStructure,
    getApplicationQuestionAuditReport,
    validateApplicationQuestions,
    getLoginStructureReport,
    validateLoginStructure,
    getApplyDialogStructureReport,
    validateApplyDialogStructure,
    getSuccessStructureReport,
    validateSuccessStructure
  };
})();
