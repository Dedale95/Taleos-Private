/**
 * Taleos - Blueprint Bpifrance
 * Cartographie le flux talents.bpifrance.fr -> bpi.tzportal.io.
 */
(function () {
  'use strict';

  if (globalThis.__TALEOS_BPIFRANCE_BLUEPRINT__) return;

  const LAST_CHECK_KEY = 'taleos_bpifrance_blueprint_last_check';
  const LOG_KEY = 'taleos_bpifrance_blueprint_log';
  const MAX_LOG_ENTRIES = 100;

  const TEXT = {
    publicOffer: ['postuler', 'talents bpifrance', 'charge d investissement senior'],
    login: ['se connecter', 'email', 'password', 'login'],
    applyWizard: ['upload cv', 'informations personnelles', 'confirmation', 'telechargez votre cv'],
    success: ['votre candidature a bien ete prise en compte'],
    accountExists: ['vous possedez deja un compte chez nous', 'connectez-vous ici']
  };

  const PAGE_DEFS = {
    public_offer: {
      label: 'Offre publique Bpifrance',
      hostIncludes: ['talents.bpifrance.fr'],
      pathMatches: [/\/opportunites\//],
      selectorsAny: ['a[href*="bpi.tzportal.io/fr/apply?job="]', 'button'],
      textPatterns: TEXT.publicOffer
    },
    login: {
      label: 'Connexion Bpifrance',
      hostIncludes: ['bpi.tzportal.io'],
      pathMatches: [/\/fr\/login/],
      selectorsAny: ['input[type="email"]', 'input[type="password"]', 'button[type="submit"]'],
      textPatterns: TEXT.login
    },
    apply_wizard: {
      label: 'Wizard candidature Bpifrance',
      hostIncludes: ['bpi.tzportal.io'],
      pathMatches: [/\/fr\/apply/],
      selectorsAny: ['#massivefileupload', '#firstName', '#consentement', '#kt_wizard'],
      textPatterns: TEXT.applyWizard
    },
    success: {
      label: 'Succès candidature Bpifrance',
      hostIncludes: ['bpi.tzportal.io'],
      pathMatches: [/\/fr\/apply/],
      selectorsAny: ['#step3'],
      textPatterns: TEXT.success
    },
    account_exists_error: {
      label: 'Compte existant Bpifrance',
      hostIncludes: ['bpi.tzportal.io'],
      pathMatches: [/\/fr\/apply/],
      selectorsAny: ['#email'],
      textPatterns: TEXT.accountExists
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
    return style?.display !== 'none' && style?.visibility !== 'hidden' && style?.opacity !== '0';
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

    if (queryVisible('#step3') && text.includes(normalizeText(TEXT.success[0]))) {
      return { key: 'success', score: 99, label: PAGE_DEFS.success.label };
    }

    let best = { key: 'unknown', score: 0, label: 'Inconnue' };
    for (const [key, def] of Object.entries(PAGE_DEFS)) {
      let score = 0;
      if (hostMatches(def, host)) score += 2;
      if (pathMatches(def, pathname, href)) score += 2;
      score += countTextMatches(text, def.textPatterns);
      if ((def.selectorsAny || []).some((selector) => queryVisible(selector))) score += 2;
      if (score > best.score) best = { key, score, label: def.label };
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

  function getSelectedText(selectId) {
    const el = document.getElementById(selectId);
    if (!el) return '';
    const idx = el.selectedIndex;
    if (idx < 0 || !el.options[idx]) return '';
    return normalizeText(el.options[idx].textContent || '');
  }

  function validateQuestionAudit(profile) {
    const unresolved = [];
    const valueOf = (id) => String(document.getElementById(id)?.value || '').trim();

    if (!valueOf('firstName')) unresolved.push('Prénom');
    if (!valueOf('lastName')) unresolved.push('Nom');
    if (!valueOf('email')) unresolved.push('Email');
    if (!valueOf('phone')) unresolved.push('Téléphone');
    if (!getSelectedText('civility') || getSelectedText('civility') === '...') unresolved.push('Civilité');
    if (!document.getElementById('consentement')?.checked) unresolved.push('Consentement obligatoire');

    return {
      ok: unresolved.length === 0,
      report: {
        unresolvedQuestionCount: unresolved.length,
        unresolved,
        profileSummary: {
          firstname: String(profile?.firstname || '').trim(),
          lastname: String(profile?.lastname || '').trim(),
          email: String(profile?.email || '').trim(),
          phone: String(profile?.['phone-number'] || profile?.phone_number || '').trim()
        }
      }
    };
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

  globalThis.__TALEOS_BPIFRANCE_BLUEPRINT__ = {
    detectPage,
    validateCurrentPage,
    validateQuestionAudit,
    recordLog
  };
})();
