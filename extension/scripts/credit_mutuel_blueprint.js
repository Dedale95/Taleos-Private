/**
 * Taleos - Blueprint Crédit Mutuel
 * Cartographie le flux recrutement.creditmutuel.fr et fournit un audit léger
 * des étapes clés pour le filler.
 */
(function () {
  'use strict';

  if (globalThis.__TALEOS_CREDIT_MUTUEL_BLUEPRINT__) return;

  const LAST_CHECK_KEY = 'taleos_credit_mutuel_blueprint_last_check';
  const LOG_KEY = 'taleos_credit_mutuel_blueprint_log';
  const MAX_LOG_ENTRIES = 100;

  const TEXT = {
    publicOffer: ['postuler avec mon cv', 'gérant d’actifs', 'gérant d\'actifs', 'votre candidature en 4 étapes'],
    rgpd: ['je reconnais avoir pris connaissance', 'charte relative aux données personnelles', 'vous vous apprêtez à postuler'],
    uploadCv: ['postuler avec mon cv', 'joignez votre cv', 'avec mon cv en pièce jointe'],
    applicationForm: ['votre cv', 'votre identité', 'origine de votre candidature', 'valider la candidature'],
    success: ['accusé de réception', "votre candidature à l'offre", 'a été transmise ce jour'],
    technicalError: ['une erreur technique s\'est produite', "veuillez confirmer l'exactitude des informations saisies"],
    navigationError: ['erreur de navigation']
  };

  const PAGE_DEFS = {
    public_offer: {
      label: 'Offre publique Crédit Mutuel',
      hostIncludes: ['recrutement.creditmutuel.fr'],
      pathMatches: [/\/fr\/offre\.html/],
      selectorsAny: ['#RHEC\\:C7\\:link', 'a[href*="postuleAvecCv=true"]'],
      textPatterns: TEXT.publicOffer
    },
    rgpd: {
      label: 'Consentement RGPD',
      hostIncludes: ['recrutement.creditmutuel.fr'],
      pathMatches: [/\/fr\/candidature_annonce\.html/],
      selectorsAny: ['#C\\:pagePrincipale\\.cb1\\:DataEntry', '#C\\:pagePrincipale\\.C\\:link'],
      textPatterns: TEXT.rgpd
    },
    upload_cv: {
      label: 'Upload CV',
      hostIncludes: ['recrutement.creditmutuel.fr'],
      pathMatches: [/\/fr\/candidature_annonce\.html/],
      selectorsAny: ['#C\\:pagePrincipale\\.PostulerAvecMonCv2\\:DataEntry', 'input[name="_FID_DoUploadCv"]'],
      textPatterns: TEXT.uploadCv
    },
    application_form: {
      label: 'Formulaire de candidature',
      hostIncludes: ['recrutement.creditmutuel.fr'],
      pathMatches: [/\/fr\/candidature_annonce\.html/],
      selectorsAny: ['#C\\:pagePrincipale\\.i135', '#C\\:pagePrincipale\\.cb2\\:DataEntry', '#C\\:pagePrincipale\\.C4\\:link'],
      textPatterns: TEXT.applicationForm
    },
    success: {
      label: 'Succès candidature',
      hostIncludes: ['recrutement.creditmutuel.fr'],
      pathMatches: [/\/fr\/message\.html/],
      selectorsAny: ['main', 'body'],
      textPatterns: TEXT.success
    },
    technical_error: {
      label: 'Erreur technique Crédit Mutuel',
      hostIncludes: ['recrutement.creditmutuel.fr'],
      pathMatches: [/\/fr\/candidature_annonce\.html/],
      selectorsAny: ['#errctxjs2', '.__e_MessageBlock .blocmsg.err'],
      textPatterns: TEXT.technicalError
    },
    navigation_error: {
      label: 'Erreur de navigation Crédit Mutuel',
      hostIncludes: ['recrutement.creditmutuel.fr'],
      pathMatches: [/\/fr\/candidature_annonce\.html/],
      selectorsAny: ['main', 'body'],
      textPatterns: TEXT.navigationError
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

  function isVisible(el) {
    if (!el) return false;
    const style = globalThis.getComputedStyle ? getComputedStyle(el) : null;
    return style?.display !== 'none' && style?.visibility !== 'hidden';
  }

  function queryVisible(selector) {
    try {
      return Array.from(document.querySelectorAll(selector)).find(isVisible) || null;
    } catch (_) {
      return null;
    }
  }

  function getPageText() {
    return normalizeText(document.body?.innerText || document.body?.textContent || '');
  }

  function hostMatches(def, host) {
    return (def.hostIncludes || []).every((part) => host.includes(part));
  }

  function pathMatches(def, pathname, href) {
    return (def.pathMatches || []).some((re) => re.test(pathname) || re.test(href));
  }

  function countTextMatches(text, patterns) {
    return (patterns || []).filter((pattern) => text.includes(normalizeText(pattern))).length;
  }

  function detectPage() {
    const host = String(location.hostname || '').toLowerCase();
    const pathname = String(location.pathname || '').toLowerCase();
    const href = String(location.href || '').toLowerCase();
    const text = getPageText();

    let best = { key: 'unknown', score: 0, label: 'Inconnue' };
    for (const [key, def] of Object.entries(PAGE_DEFS)) {
      let score = 0;
      if (hostMatches(def, host)) score += 2;
      if (pathMatches(def, pathname, href)) score += 2;
      score += countTextMatches(text, def.textPatterns);
      if ((def.selectorsAny || []).some((selector) => queryVisible(selector))) score += 2;
      if (score > best.score) {
        best = { key, score, label: def.label };
      }
    }
    return best;
  }

  function validateCurrentPage(expected) {
    const detected = detectPage();
    const targets = Array.isArray(expected) ? expected : [expected];
    const ok = targets.includes(detected.key);
    const result = {
      ok,
      detected: detected.key,
      label: detected.label,
      href: location.href,
      checkedAt: new Date().toISOString()
    };
    try {
      chrome.storage.local.set({ [LAST_CHECK_KEY]: result });
    } catch (_) {}
    return result;
  }

  function getVisibleLanguageRows() {
    const rows = [];
    for (let i = 0; i < 5; i++) {
      const row = document.getElementById(`C:pagePrincipale.LesLangues.F1_${i}.G4:root:root`);
      if (row && !String(row.className || '').includes('ei_js_hidden')) rows.push(i);
    }
    return rows;
  }

  function getSelectedText(selectId) {
    const el = document.getElementById(selectId);
    if (!el) return '';
    const idx = el.selectedIndex;
    if (idx < 0 || !el.options[idx]) return '';
    return normalizeText(el.options[idx].textContent || '');
  }

  function auditApplicationForm(profile) {
    const unresolved = [];
    const visibleRows = getVisibleLanguageRows();
    const languageCount = Array.isArray(profile?.languages) ? profile.languages.filter((l) => (l?.name || '').trim()).length : 0;

    const checkValue = (id, label) => {
      const el = document.getElementById(id);
      const value = (el?.value || '').trim();
      if (!value) unresolved.push(label);
    };

    checkValue('C:pagePrincipale.i-74-1', 'Nom');
    checkValue('C:pagePrincipale.i-74-2', 'Prénom');
    checkValue('C:pagePrincipale.i135', 'Email');
    checkValue('C:pagePrincipale.i136', 'Confirmation email');
    checkValue('C:pagePrincipale.i117', 'Téléphone');

    if (getSelectedText('C:pagePrincipale.ddl1:DataEntry').includes('choisissez')) unresolved.push('Diplôme');
    if (getSelectedText('C:pagePrincipale.originePanel.ddl2:DataEntry').includes('choisissez')) unresolved.push('Origine candidature');

    const cert = document.getElementById('C:pagePrincipale.cb2:DataEntry');
    if (!cert?.checked) unresolved.push('Certification');

    visibleRows.forEach((rowIndex) => {
      if (getSelectedText(`C:pagePrincipale.LesLangues.F1_${rowIndex}.i122:DataEntry`).includes('choisissez')) unresolved.push(`Langue ${rowIndex + 1}`);
      if (getSelectedText(`C:pagePrincipale.LesLangues.F1_${rowIndex}.i123:DataEntry`).includes('choisissez')) unresolved.push(`Niveau écrit ${rowIndex + 1}`);
      if (getSelectedText(`C:pagePrincipale.LesLangues.F1_${rowIndex}.i124:DataEntry`).includes('choisissez')) unresolved.push(`Niveau oral ${rowIndex + 1}`);
    });

    return {
      ok: unresolved.length === 0,
      report: {
        unresolvedQuestionCount: unresolved.length,
        unresolved
      },
      visibleLanguageRows: visibleRows.length,
      expectedLanguageRows: languageCount
    };
  }

  async function validateQuestionAudit(profile, context) {
    if (String(context?.pageKey || '') !== 'application_form') {
      return { ok: true, report: { unresolvedQuestionCount: 0, unresolved: [] } };
    }
    return auditApplicationForm(profile || {});
  }

  async function recordLog(entry) {
    try {
      const out = await chrome.storage.local.get([LOG_KEY]);
      const current = Array.isArray(out[LOG_KEY]) ? out[LOG_KEY] : [];
      current.push({
        at: new Date().toISOString(),
        href: location.href,
        entry
      });
      while (current.length > MAX_LOG_ENTRIES) current.shift();
      await chrome.storage.local.set({ [LOG_KEY]: current });
    } catch (_) {}
  }

  globalThis.__TALEOS_CREDIT_MUTUEL_BLUEPRINT__ = {
    detectPage,
    validateCurrentPage,
    validateQuestionAudit,
    recordLog
  };
})();
