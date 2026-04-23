(function () {
  'use strict';

  if (globalThis.__TALEOS_BNP_BLUEPRINT__) return;

  const LAST_CHECK_KEY = 'taleos_bnp_blueprint_last_check';
  const LOG_KEY = 'taleos_bnp_blueprint_log';
  const MAX_LOG_ENTRIES = 120;

  const TEXT = {
    publicOffer: [
      'nous recherchons un',
      'retour a la liste des offres',
      'retour à la liste des offres',
      'postuler'
    ],
    jobDetails: [
      'postuler',
      'contact',
      'connexion'
    ],
    applicationMethods: [
      'connexion : identifiant et mot de passe',
      'mot de passe oublie',
      'mot de passe oublié',
      'telecharger mon cv',
      'télécharger mon cv'
    ],
    applicationForm: [
      'completez vos informations',
      'complétez vos informations',
      'informations personnelles',
      'je suis d\'accord pour partager mes donnees',
      'je suis d\'accord pour partager mes données'
    ],
    reviewSubmit: [
      'en cliquant ci-dessous, vous finalisez votre candidature',
      'envoyer ma candidature'
    ],
    success: [
      'votre candidature a bien ete enregistree',
      'votre candidature a bien été enregistrée',
      'merci d’avoir postule',
      'merci d\'avoir postule',
      'aller a mon profil',
      'aller à mon profil'
    ],
    unavailable: [
      'offre introuvable',
      'this job is no longer available',
      'n\'est plus disponible',
      'plus disponible'
    ]
  };

  const PAGE_DEFS = {
    public_offer: {
      label: 'Offre publique BNP',
      hostIncludes: ['group.bnpparibas'],
      pathMatches: [/\/offre-emploi\//],
      selectorsAny: ['a[href*="bwelcome.hr.bnpparibas"]', 'h1'],
      textPatterns: TEXT.publicOffer
    },
    job_details: {
      label: 'JobDetails BNP',
      hostIncludes: ['bwelcome.hr.bnpparibas'],
      pathMatches: [/\/jobdetails/i],
      selectorsAny: ['a[href*="ApplicationMethods"]', 'a.button.button--primary'],
      textPatterns: TEXT.jobDetails
    },
    application_methods: {
      label: 'Choix de candidature BNP',
      hostIncludes: ['bwelcome.hr.bnpparibas'],
      pathMatches: [/\/applicationmethods/i],
      selectorsAny: ['input[name="username"]', 'input[name="password"]', 'button[name="Connexion"]'],
      textPatterns: TEXT.applicationMethods
    },
    application_form: {
      label: 'Formulaire candidature BNP',
      hostIncludes: ['bwelcome.hr.bnpparibas'],
      pathMatches: [/\/applicationconfirmation/i],
      selectorsAny: ['input[name="1449"]', 'input[name="1454"]', 'input[name="1474"]'],
      textPatterns: TEXT.applicationForm
    },
    review_submit: {
      label: 'Validation finale BNP',
      hostIncludes: ['bwelcome.hr.bnpparibas'],
      pathMatches: [/\/applicationconfirmation/i],
      selectorsAny: ['button[name="next"]'],
      textPatterns: TEXT.reviewSubmit
    },
    success: {
      label: 'Succès candidature BNP',
      hostIncludes: ['bwelcome.hr.bnpparibas'],
      pathMatches: [/\/success/i],
      selectorsAny: ['a[href*="/Profile"]', 'a[href*="/externalcareers/Profile"]'],
      textPatterns: TEXT.success
    },
    unavailable: {
      label: 'Offre indisponible BNP',
      textPatterns: TEXT.unavailable
    }
  };

  const QUESTION_SECTIONS = {
    application_form: [
      { key: 'firstname', label: 'Prénom', selectors: ['input[name="1449"]'], profileKey: 'firstname', type: 'input', critical: true },
      { key: 'lastname', label: 'Nom', selectors: ['input[name="1450"]'], profileKey: 'lastname', type: 'input', critical: true },
      { key: 'gender', label: 'Genre', selectors: ['select[name="2863"]', 'input[name="2863"]'], type: 'select_or_hidden', critical: true },
      { key: 'preferred_name', label: 'Nom / prénom de préférence', selectors: ['input[name="1452"]'], profileKey: 'firstname', type: 'input_optional' },
      { key: 'email', label: 'Email personnel', selectors: ['input[name="1453"]'], profileKey: 'email', type: 'input', critical: true },
      { key: 'phone', label: 'Téléphone personnel', selectors: ['input[name="1454"]'], profileKey: 'phone_number', type: 'input', critical: true },
      { key: 'preferred_language', label: 'Langue préférée', selectors: ['select[name="1457"]', 'input[name="1457"]'], type: 'select_or_hidden', critical: true },
      { key: 'cv', label: 'CV', selectors: ['input[name="file_1458"]', 'input[name="file_1458_fileNumber"]'], profileKey: 'cv_storage_path', type: 'file', critical: true },
      { key: 'letter', label: 'Autre fichier pertinent', selectors: ['input[name="file_1459"]', 'input[name="file_1459_fileNumber"]'], profileKey: 'lm_storage_path', type: 'file_optional' },
      { key: 'degree', label: 'Certificat / Diplôme', selectors: ['select[name="1461-1-0"]', 'select[name="1461-1-sample"]', 'input[name="1461-1-0"]'], type: 'select_or_hidden', critical: true },
      { key: 'school', label: 'École / Université', selectors: ['input[name="1461-3-0"]', 'input[name="1461-3-sample"]'], profileKey: 'establishment', type: 'input', critical: true },
      { key: 'studying', label: 'En cours d’études ?', selectors: ['select[name="1461-9-0"]', 'select[name="1461-9-sample"]', 'input[name="1461-9-0"]'], type: 'select_or_hidden', critical: true },
      { key: 'graduation_date', label: 'Date du diplôme', selectors: ['input[name="1461-8-0"]', 'input[name="1461-8-sample"]'], type: 'date', critical: true },
      { key: 'experience', label: 'Niveau d’expérience', selectors: ['select[name="1462"]', 'input[name="1462"]'], type: 'select_or_hidden', critical: true },
      { key: 'language_1', label: 'Langue 1', selectors: ['select[name="1466"]', 'input[name="1466"]'], type: 'dynamic_optional', criticalWhenPresent: true },
      { key: 'language_1_level', label: 'Niveau langue 1', selectors: ['select[name="1467"]', 'input[name="1467"]'], type: 'dynamic_optional', criticalWhenPresent: true },
      { key: 'language_2', label: 'Langue 2', selectors: ['select[name="1468"]', 'input[name="1468"]'], type: 'dynamic_optional', criticalWhenPresent: true },
      { key: 'language_2_level', label: 'Niveau langue 2', selectors: ['select[name="1469"]', 'input[name="1469"]'], type: 'dynamic_optional', criticalWhenPresent: true },
      { key: 'language_3', label: 'Langue 3', selectors: ['select[name="1470"]', 'input[name="1470"]'], type: 'dynamic_optional', criticalWhenPresent: true },
      { key: 'language_3_level', label: 'Niveau langue 3', selectors: ['select[name="1471"]', 'input[name="1471"]'], type: 'dynamic_optional', criticalWhenPresent: true },
      { key: 'application_source', label: 'Origine de la candidature', selectors: ['select[name="1472"]', 'input[name="1472"]'], type: 'select_or_hidden', critical: true },
      { key: 'candidate_source', label: 'Source du candidat', selectors: ['select[name="18289"]', 'input[name="18289"]'], type: 'select_or_hidden', critical: true },
      { key: 'data_sharing_scope', label: 'Partage des données', selectors: ['input[name="4456"]'], type: 'radio_group', critical: true },
      { key: 'terms', label: 'Conditions générales', selectors: ['input[name="1474"]'], expectedValue: true, type: 'checkbox', critical: true }
    ]
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
    return style?.display !== 'none' && style?.visibility !== 'hidden';
  }

  function queryAny(doc, selectors) {
    for (const selector of selectors || []) {
      try {
        const el = doc.querySelector(selector);
        if (el) return el;
      } catch (_) {}
    }
    return null;
  }

  function queryAnyVisible(doc, selectors) {
    for (const selector of selectors || []) {
      try {
        const el = Array.from(doc.querySelectorAll(selector)).find(isVisible);
        if (el) return el;
      } catch (_) {}
    }
    return null;
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
      score += Math.min(textMatches, 4);
      const matchedSelectors = (def.selectorsAny || []).filter((selector) => !!queryAny(doc, [selector]));
      if (matchedSelectors.length) score += 2;
      return { key, label: def.label, score, textMatches, matchedSelectors };
    }).sort((a, b) => b.score - a.score);

    const winner = scored[0] || { key: 'unknown', label: 'Inconnu', score: 0, textMatches: 0, matchedSelectors: [] };
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

  function mapGender(profile) {
    const civility = normalizeText(profile?.civility || '');
    if (civility.includes('monsieur')) return 'Homme';
    if (civility.includes('madame')) return 'Femme';
    return '';
  }

  function mapPreferredLanguage(profile) {
    const country = normalizeText(profile?.country || '');
    if (!country || country.includes('france')) return 'Français - France (fr_FR)';
    return 'Français - France (fr_FR)';
  }

  function mapDegree(profile) {
    const raw = normalizeText(profile?.education_level || '');
    if (!raw) return '';
    if (raw.includes('bac + 5') || raw.includes('m2') || raw.includes('master')) return "Master's degree";
    if (raw.includes('bac + 3') || raw.includes('bac + 4') || raw.includes('licence') || raw.includes('bachelor')) return "Bachelor's degree";
    if (raw.includes('doctorat') || raw.includes('phd')) return 'PHD';
    return "Master's degree";
  }

  function mapStudying(profile) {
    return normalizeText(profile?.diploma_status || '').includes('en cours') ? 'Oui' : 'Non';
  }

  function mapGraduationDate(profile) {
    const year = String(profile?.diploma_year || '').trim();
    if (!year) return '';
    return `${year}-06-30`;
  }

  function mapExperience(profile) {
    const raw = normalizeText(profile?.experience_level || '');
    if (!raw) return '';
    if (raw.includes('0 - 2') || raw.includes('0-2') || raw.includes('0 - 1') || raw.includes('0-1')) return 'Je recherche mon premier emploi';
    if (raw.includes('3 - 5') || raw.includes('3-5') || raw.includes('5 - 7') || raw.includes('5-7') || raw.includes('6 - 10') || raw.includes('6-10') || raw.includes('11')) return 'Je suis expérimenté';
    return 'Je suis expérimenté';
  }

  function mapBnpDataSharing(profile) {
    const raw = String(profile?.group_data_sharing_scope || '').trim();
    if (!raw) return 'International au sein du groupe BNP Paribas';
    return raw;
  }

  function mapBnpLanguageName(language) {
    const BNP_LANGUAGE_ALIASES = {
      'afrikaans': 'Afrikaans',
      'albanais': 'Albanais',
      'albanian': 'Albanais',
      'arabe': 'Arabe',
      'arabic': 'Arabe',
      'armenien': 'Arménien',
      'arménien': 'Arménien',
      'armenian': 'Arménien',
      'basque': 'Basque',
      'bengali': 'Bengali',
      'bulgare': 'Bulgare',
      'bulgarian': 'Bulgare',
      'catalan': 'Catalan',
      'cambodgien': 'Cambodgien',
      'cambodian': 'Cambodgien',
      'khmer': 'Cambodgien',
      'chinois': 'Chinois (mandarin)',
      'chinois mandarin': 'Chinois (mandarin)',
      'mandarin': 'Chinois (mandarin)',
      'mandarin chinese': 'Chinois (mandarin)',
      'chinese': 'Chinois (mandarin)',
      'croate': 'Croate',
      'croatian': 'Croate',
      'tcheque': 'Tchèque',
      'tchèque': 'Tchèque',
      'czech': 'Tchèque',
      'danois': 'Danois',
      'danish': 'Danois',
      'neerlandais': 'Néerlandais',
      'néerlandais': 'Néerlandais',
      'dutch': 'Néerlandais',
      'anglais': 'Anglais',
      'english': 'Anglais',
      'estonien': 'Estonien',
      'estonian': 'Estonien',
      'fidjien': 'Fidjien',
      'fijian': 'Fidjien',
      'finnois': 'Finnois',
      'finnish': 'Finnois',
      'francais': 'Français',
      'français': 'Français',
      'french': 'Français',
      'georgien': 'Géorgien',
      'géorgien': 'Géorgien',
      'georgian': 'Géorgien',
      'allemand': 'Allemand',
      'german': 'Allemand',
      'grec': 'Grec',
      'greek': 'Grec',
      'gujarati': 'Gujarati',
      'hebreu': 'Hébreu',
      'hébreu': 'Hébreu',
      'hebrew': 'Hébreu',
      'hindi': 'Hindi',
      'hongrois': 'Hongrois',
      'hungarian': 'Hongrois',
      'islandais': 'Islandais',
      'icelandic': 'Islandais',
      'indonesien': 'Indonésien',
      'indonésien': 'Indonésien',
      'indonesian': 'Indonésien',
      'irlandais': 'Irlandais',
      'irish': 'Irlandais',
      'italien': 'Italien',
      'italian': 'Italien',
      'japonais': 'Japonais',
      'japanese': 'Japonais',
      'javanais': 'Javanais',
      'javanese': 'Javanais',
      'coreen': 'Coréen',
      'coréen': 'Coréen',
      'korean': 'Coréen',
      'latin': 'Latin',
      'letton': 'Letton',
      'latvian': 'Letton',
      'lituanien': 'Lituanien',
      'lithuanian': 'Lituanien',
      'luxembourgeois': 'Luxembourgeois',
      'luxembourgish': 'Luxembourgeois',
      'macedonien': 'Macédonien',
      'macédonien': 'Macédonien',
      'macedonian': 'Macédonien',
      'malais': 'Malais',
      'malay': 'Malais',
      'malayalam': 'Malayalam',
      'maltais': 'Maltais',
      'maltese': 'Maltais',
      'maorie': 'Maorie',
      'maori': 'Maorie',
      'marathi': 'Marathi',
      'mongols': 'Mongols',
      'mongol': 'Mongols',
      'mongolian': 'Mongols',
      'nepalais': 'Népalais',
      'népalais': 'Népalais',
      'nepali': 'Népalais',
      'nepalese': 'Népalais',
      'norvegien': 'Norvégien',
      'norvégien': 'Norvégien',
      'norwegian': 'Norvégien',
      'persan': 'Persan',
      'persian': 'Persan',
      'farsi': 'Persan',
      'polonais': 'Polonais',
      'polish': 'Polonais',
      'portugais': 'Portugais',
      'portuguese': 'Portugais',
      'punjabi': 'Punjabi',
      'quechua': 'Quechua',
      'roumain': 'Roumain',
      'romanian': 'Roumain',
      'russe': 'Russe',
      'russian': 'Russe',
      'samoan': 'Samoan',
      'serbe': 'Serbe',
      'serbian': 'Serbe',
      'slovaque': 'Slovaque',
      'slovak': 'Slovaque',
      'slovene': 'Slovène',
      'slovenian': 'Slovène',
      'slovenee': 'Slovène',
      'slovène': 'Slovène',
      'espagnol': 'Espagnol',
      'spanish': 'Espagnol',
      'swahili': 'Swahili',
      'suedois': 'Suédois',
      'suédois': 'Suédois',
      'swedish': 'Suédois',
      'tamoul': 'Tamoul',
      'tamil': 'Tamoul',
      'tatar': 'Tatar',
      'telougou': 'Télougou',
      'télougou': 'Télougou',
      'telugu': 'Télougou',
      'thai': 'Thai',
      'tibetain': 'Tibétain',
      'tibétain': 'Tibétain',
      'tibetan': 'Tibétain',
      'tongien': 'Tongien',
      'tongan': 'Tongien',
      'turque': 'Turque',
      'turc': 'Turque',
      'turkish': 'Turque',
      'ukrainien': 'Ukrainien',
      'ukrainian': 'Ukrainien',
      'ourdou': 'Ourdou',
      'urdu': 'Ourdou',
      'ouzbek': 'Ouzbek',
      'uzbek': 'Ouzbek',
      'vietnamien': 'Viêtnamien',
      'viêtnamien': 'Viêtnamien',
      'vietnamese': 'Viêtnamien',
      'gallois': 'Gallois',
      'welsh': 'Gallois',
      'xhosa': 'Xhosa'
    };
    const raw = normalizeText(language || '');
    if (!raw) return '';
    return BNP_LANGUAGE_ALIASES[raw] || String(language).trim();
  }

  function getBnpOrderedLanguages(profile) {
    const seen = new Set();
    const base = Array.isArray(profile?.languages) ? profile.languages : [];
    const mapped = [];
    for (const lang of base) {
      const name = mapBnpLanguageName(lang?.language || lang?.name || '');
      if (!name) continue;
      const key = normalizeText(name);
      if (seen.has(key)) continue;
      seen.add(key);
      mapped.push({ ...lang, __mappedName: name });
    }
    return mapped;
  }

  function mapBnpLanguageLevel(level) {
    const raw = normalizeText(level || '');
    if (!raw) return '';
    if (raw.includes('langue maternelle') || raw.includes('bilingue') || raw.includes('courant')) return 'Courant';
    if (raw.includes('avance') || raw.includes('avancé') || raw.includes('operationnel') || raw.includes('opérationnel')) return 'Avancé';
    if (raw.includes('intermediaire') || raw.includes('intermédiaire')) return 'Intermédiaire';
    if (raw.includes('debutant') || raw.includes('débutant')) return 'Débutant';
    return '';
  }

  function expectedValue(question, profile) {
    const orderedLanguages = getBnpOrderedLanguages(profile);
    if (question.expectedValue !== undefined) return question.expectedValue;
    if (question.profileKey) return profile?.[question.profileKey] || '';
    if (question.key === 'gender') return mapGender(profile);
    if (question.key === 'preferred_language') return mapPreferredLanguage(profile);
    if (question.key === 'degree') return mapDegree(profile);
    if (question.key === 'studying') return mapStudying(profile);
    if (question.key === 'graduation_date') return mapGraduationDate(profile);
    if (question.key === 'experience') return mapExperience(profile);
    if (question.key === 'application_source' || question.key === 'candidate_source') return 'BNP Paribas website';
    if (question.key === 'data_sharing_scope') return mapBnpDataSharing(profile);
    if (question.key === 'language_1') return orderedLanguages[0]?.__mappedName || '';
    if (question.key === 'language_2') return orderedLanguages[1]?.__mappedName || '';
    if (question.key === 'language_3') return orderedLanguages[2]?.__mappedName || '';
    if (question.key === 'language_1_level') return mapBnpLanguageLevel(orderedLanguages[0]?.level || '');
    if (question.key === 'language_2_level') return mapBnpLanguageLevel(orderedLanguages[1]?.level || '');
    if (question.key === 'language_3_level') return mapBnpLanguageLevel(orderedLanguages[2]?.level || '');
    return '';
  }

  function readCurrentValue(question, doc) {
    if (question.type === 'radio_group') {
      const radios = Array.from(doc.querySelectorAll(question.selectors[0])).filter((el) => el.getAttribute('type') === 'radio');
      const checked = radios.find((el) => el.checked);
      return checked?.getAttribute('data-option-name') || checked?.value || '';
    }
    const el = queryAnyVisible(doc, question.selectors) || queryAny(doc, question.selectors);
    if (!el) return '';
    if (question.type === 'checkbox') return !!el.checked;
    if (question.type === 'file' || question.type === 'file_optional') return String(el.value || '').trim();
    if (question.type === 'select_or_hidden') {
      if (el.tagName === 'SELECT') {
        const option = el.options?.[el.selectedIndex];
        return option ? String(option.textContent || '').trim() : String(el.value || '').trim();
      }
      return String(el.value || '').trim();
    }
    if (question.type === 'dynamic_optional') {
      const directSelect = queryAny(doc, question.selectors);
      const selectName = directSelect?.getAttribute?.('name') || '';
      if (selectName && /^14(66|68|70)$/.test(selectName)) {
        const rendered = doc.getElementById(`select2-${selectName}-container`);
        const renderedText = String(rendered?.textContent || '').replace(/×/g, '').trim();
        if (renderedText && normalizeText(renderedText) !== normalizeText('Sélectionner une option')) {
          return renderedText;
        }
      }
      if (el.tagName === 'SELECT') {
        const option = el.options?.[el.selectedIndex];
        const optionText = String(option?.textContent || '').replace(/×/g, '').trim();
        if (optionText) return optionText;
      }
      const fieldSpec = el.closest('.fieldSpec');
      const rendered = fieldSpec?.querySelector('.select2-selection__rendered, .chosen-single span, [role="combobox"], input[type="text"]');
      const renderedText = String(rendered?.textContent || '').replace(/×/g, '').trim();
      const renderedValue = String(rendered?.value || '').trim();
      return renderedText || renderedValue || String(el.value || '').trim();
    }
    return String(el.value || '').trim();
  }

  async function setStorage(obj) {
    return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
  }

  async function getStorage(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  }

  async function recordLog(entry) {
    const cur = await getStorage([LOG_KEY]);
    const logs = Array.isArray(cur[LOG_KEY]) ? cur[LOG_KEY] : [];
    logs.unshift({ at: new Date().toISOString(), ...entry });
    if (logs.length > MAX_LOG_ENTRIES) logs.length = MAX_LOG_ENTRIES;
    await setStorage({ [LOG_KEY]: logs });
  }

  async function setLastCheck(entry) {
    await setStorage({ [LAST_CHECK_KEY]: { at: new Date().toISOString(), ...entry } });
  }

  async function validateCurrentPage(expected) {
    const detection = detectPage();
    const list = Array.isArray(expected) ? expected : [expected];
    const ok = list.includes(detection.key);
    const result = {
      kind: 'validate_page',
      ok,
      expected: list,
      detected: detection.key,
      href: detection.href,
      matchedSelectors: detection.matchedSelectors,
      textMatches: detection.textMatches
    };
    await setLastCheck(result);
    await recordLog(result);
    return result;
  }

  async function snapshotCurrentPage(ctx = {}) {
    const detection = detectPage(ctx);
    const entry = {
      kind: 'snapshot',
      ok: true,
      detected: detection.key,
      href: detection.href,
      matchedSelectors: detection.matchedSelectors,
      textMatches: detection.textMatches
    };
    await setLastCheck(entry);
    await recordLog(entry);
    return entry;
  }

  async function validateQuestionAudit(profile, opts = {}) {
    const pageKey = opts.pageKey || detectPage().key;
    const questions = QUESTION_SECTIONS[pageKey] || [];
    const report = [];
    let unresolvedQuestionCount = 0;
    for (const question of questions) {
      const el = queryAnyVisible(document, question.selectors) || queryAny(document, question.selectors);
      const expected = expectedValue(question, profile);
      const current = readCurrentValue(question, document);
      const exists = !!el || question.type === 'radio_group';
      const missing = !exists && question.critical;
      const empty = exists && !current && question.critical && question.type !== 'checkbox';
      const mismatch =
        exists &&
        current &&
        expected &&
        question.type !== 'file' &&
        question.type !== 'file_optional' &&
        question.type !== 'checkbox' &&
        normalizeText(current) !== normalizeText(expected);
      const fileMissing = question.type === 'file' && !current;
      const checkboxMismatch = question.type === 'checkbox' && expected === true && current !== true;
      const status = missing ? 'missing' : empty ? 'empty' : fileMissing ? 'empty' : checkboxMismatch ? 'mismatch' : mismatch ? 'mismatch' : 'ok';
      if (status !== 'ok' && (question.critical || (question.criticalWhenPresent && exists))) unresolvedQuestionCount += 1;
      report.push({
        key: question.key,
        label: question.label,
        exists,
        expected,
        current,
        status
      });
    }
    const entry = {
      kind: 'validate_question_audit',
      ok: unresolvedQuestionCount === 0,
      pageKey,
      unresolvedQuestionCount,
      report
    };
    await setLastCheck(entry);
    await recordLog(entry);
    return entry;
  }

  globalThis.__TALEOS_BNP_BLUEPRINT__ = {
    LAST_CHECK_KEY,
    LOG_KEY,
    detectPage,
    validateCurrentPage,
    validateQuestionAudit,
    snapshotCurrentPage,
    recordLog,
    setLastCheck,
    expectedValue
  };
})();
