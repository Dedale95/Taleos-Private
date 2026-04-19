/**
 * Taleos - Blueprint Crédit Agricole
 * Décrit les signatures de pages attendues et aide à valider qu'on est bien
 * sur la bonne étape avant de remplir/interagir.
 */
(function () {
  'use strict';

  if (globalThis.__TALEOS_CA_BLUEPRINT__) return;

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

  function getPageText(doc) {
    return String(doc?.body?.textContent || '').toLowerCase();
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
    return result;
  }

  async function persistLastCheck(result) {
    try {
      await chrome.storage.local.set({
        taleos_ca_blueprint_last_check: {
          ...result,
          at: new Date().toISOString()
        }
      });
    } catch (_) {}
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
    return result;
  }

  globalThis.__TALEOS_CA_BLUEPRINT__ = {
    pageDefinitions: PAGE_DEFS,
    fieldMap: FIELD_MAP,
    textPatterns: TEXT_PATTERNS,
    detectPage,
    validateExpectedPage,
    getApplicationStructureReport,
    validateApplicationStructure
  };
})();
