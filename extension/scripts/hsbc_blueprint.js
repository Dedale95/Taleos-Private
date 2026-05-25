/**
 * Taleos — Blueprint HSBC
 * Couvre le flux Eightfold AI (portal.careers.hsbc.com) → SAP SuccessFactors (career2.successfactors.eu).
 *
 * Pages gérées :
 *   1. portal.careers.hsbc.com/careers/job/{eightfold_id}   — page offre (Eightfold)
 *   2. career2.successfactors.eu/careers?company=hsbcholdin  — listing SF (avant Apply)
 *   3. career2.successfactors.eu/career?_s.crb=…             — formulaire candidature SF
 */
(function () {
  'use strict';

  if (globalThis.__TALEOS_HSBC_BLUEPRINT__) return;
  globalThis.__TALEOS_HSBC_BLUEPRINT__ = true;

  const LAST_CHECK_KEY = 'taleos_hsbc_blueprint_last_check';
  const LOG_KEY        = 'taleos_hsbc_blueprint_log';
  const MAX_LOG_ENTRIES = 100;

  // ─── Patterns textuels ──────────────────────────────────────────────────────
  const TEXT = {
    eightfoldOffer: [
      'portal.careers.hsbc', 'equity derivatives', 'hsbc', 'corporate & institutional',
      'apply for this job', 'opening up a world of opportunity'
    ],
    sfListing: [
      'career opportunities', 'hsbcholdin', 'apply', 'job description',
      'opening up a world of opportunity'
    ],
    sfForm: [
      'legal first name', 'fbclc_fname', 'choose password', 'legal last name',
      'international calling code', 'do you have any relatives working with hsbc',
      'right to work', 'data privacy'
    ],
    sfSuccess: [
      'your application has been sent', 'thank you for expressing your interest',
      'please click on below link to visit your profile', 'back to job listings'
    ]
  };

  // ─── Définitions de pages ────────────────────────────────────────────────────
  const PAGE_DEFS = {
    eightfold_offer: {
      label: 'Offre HSBC (Eightfold)',
      hostIncludes: ['portal.careers.hsbc.com'],
      pathMatches: [/\/careers\/job\//],
      selectorsAny: ['#applyButton_top', '#applyButton_bottom', '[data-test-id="apply-button"]', '[class*="position-apply-button"]', 'button'],
      textPatterns: TEXT.eightfoldOffer
    },
    sf_listing: {
      label: 'Offre HSBC (SuccessFactors listing)',
      hostIncludes: ['career2.successfactors.eu'],
      urlIncludes: ['hsbcholdin'],
      pathMatches: [/^\/careers/],
      selectorsAny: ['#applyButton_top', '#applyButton_bottom'],
      textPatterns: TEXT.sfListing
    },
    sf_form: {
      label: 'Formulaire candidature HSBC (SuccessFactors)',
      hostIncludes: ['career2.successfactors.eu'],
      urlIncludes: ['hsbcholdin'],
      pathMatches: [/^\/career(\?|$)/],
      selectorsAny: ['#fbclc_fName', '#fbclc_userName', '#fbqa_apply', '#tor__fcust_PrefFName'],
      textPatterns: TEXT.sfForm
    },
    sf_success: {
      label: 'Candidature HSBC envoyée',
      hostIncludes: ['career2.successfactors.eu'],
      // URL réelle post-soumission : /portalcareer?isRedirectToAppSent=true&isQuickApplyPostLoginRedirect=true
      urlIncludes: ['isRedirectToAppSent=true', 'hsbcholdin'],
      pathMatches: [/^\/portalcareer/],
      selectorsAny: ['#fbja_jobSearch'],
      textPatterns: TEXT.sfSuccess
    }
  };

  // ─── Utilitaires ─────────────────────────────────────────────────────────────
  function normalizeText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/['']/g, "'")
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getPageText(doc = document) {
    return normalizeText(doc.body?.innerText || doc.body?.textContent || '');
  }

  function isVisible(el) {
    if (!el) return false;
    const style = typeof getComputedStyle !== 'undefined' ? getComputedStyle(el) : null;
    return el.offsetParent !== null && style?.visibility !== 'hidden' && style?.display !== 'none';
  }

  function matchesPage(def) {
    const host = location.hostname || '';
    const path = location.pathname || '';
    const href = location.href || '';
    const pageText = getPageText();

    if (def.hostIncludes?.length && !def.hostIncludes.some(h => host.includes(h))) return false;
    if (def.urlIncludes?.length && !def.urlIncludes.some(u => href.includes(u))) return false;
    if (def.pathMatches?.length && !def.pathMatches.some(r => r.test(path))) return false;

    const textOk = !def.textPatterns?.length || def.textPatterns.some(t => pageText.includes(normalizeText(t)));
    if (!textOk) return false;

    if (def.selectorsAny?.length) {
      const selectorOk = def.selectorsAny.some(s => {
        try { return !!document.querySelector(s); } catch { return false; }
      });
      if (!selectorOk) return false;
    }
    return true;
  }

  function detectPage() {
    for (const [key, def] of Object.entries(PAGE_DEFS)) {
      if (matchesPage(def)) return { key, label: def.label };
    }
    return null;
  }

  // ─── findApplyLink ────────────────────────────────────────────────────────────
  // Retourne l'URL de candidature SuccessFactors à partir d'une page Eightfold ou SF listing.
  function findApplyLink(doc = document) {
    // Sur la page Eightfold : extraire l'URL SF depuis l'onclick du bouton Apply
    const applyBtn = doc.getElementById('applyButton_top') || doc.getElementById('applyButton_bottom');
    if (applyBtn) {
      const onclick = applyBtn.getAttribute('onclick') || '';
      const reqMatch = onclick.match(/jobReqId\s*:\s*(\d+)/);
      if (reqMatch) {
        const jobReqId = reqMatch[1];
        return `https://career2.successfactors.eu/careers?company=hsbcholdin&career_ns=job_application&src=Eightfold&career_job_req_id=${jobReqId}&lang=en_GB`;
      }
    }

    // Sur la page SF listing : l'URL actuelle est déjà la bonne
    if (location.hostname.includes('career2.successfactors.eu') && location.href.includes('hsbcholdin')) {
      return location.href;
    }

    return null;
  }

  // ─── extractJobData ───────────────────────────────────────────────────────────
  function extractJobData(doc = document) {
    const title = (
      doc.querySelector('h1')?.textContent?.trim() ||
      doc.querySelector('.jobTitle, [class*="job-title"]')?.textContent?.trim() ||
      ''
    );

    // Sur SF listing : titre dans le <title>
    const pageTitle = doc.title || '';
    const sfMatch = pageTitle.match(/Career Opportunities:\s*(.+?)\s*\(/);
    const extractedTitle = sfMatch ? sfMatch[1].trim() : title;

    // Job Req ID depuis l'URL
    const reqMatch = location.search.match(/career_job_req_id=(\d+)/);
    const jobReqId = reqMatch ? reqMatch[1] : '';

    // Job ID Eightfold depuis l'URL path
    const pathMatch = location.pathname.match(/\/careers\/job\/(\d+)/);
    const eightfoldId = pathMatch ? pathMatch[1] : '';

    return {
      jobTitle: extractedTitle || '',
      jobId: jobReqId || eightfoldId || '',
      companyName: 'HSBC',
      location: doc.querySelector('[class*="location"]')?.textContent?.trim() || '',
      applyUrl: findApplyLink(doc)
    };
  }

  // ─── Logging ──────────────────────────────────────────────────────────────────
  function appendLog(entry) {
    try {
      const stored = JSON.parse(sessionStorage.getItem(LOG_KEY) || '[]');
      stored.push({ ts: new Date().toISOString(), ...entry });
      if (stored.length > MAX_LOG_ENTRIES) stored.splice(0, stored.length - MAX_LOG_ENTRIES);
      sessionStorage.setItem(LOG_KEY, JSON.stringify(stored));
    } catch (_) {}
  }

  // ─── Export public ────────────────────────────────────────────────────────────
  globalThis.__TALEOS_HSBC_BLUEPRINT__ = {
    detectPage,
    findApplyLink,
    extractJobData,
    PAGE_DEFS,
    TEXT,
    normalizeText,
    getPageText,
    isVisible,
    appendLog,
    LAST_CHECK_KEY,
    LOG_KEY
  };

  appendLog({ event: 'blueprint_loaded', url: location.href });
})();
