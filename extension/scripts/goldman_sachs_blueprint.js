/**
 * Taleos - Blueprint Goldman Sachs
 * Cartographie le flux Oracle HCM CX observé en production.
 *
 * Domaines :
 *   higher.gs.com                          → page offre publique
 *   hdpc.fa.us2.oraclecloud.com            → Oracle HCM CX (candidature)
 *
 * Site Oracle CE : LateralHiring
 * URL type : /hcmUI/CandidateExperience/en/sites/LateralHiring/job/{ID}/apply/...
 *
 * ── Flux complet (analysé DOM réel) ──────────────────────────────────────────
 *
 * 1. PAGE OFFRE (higher.gs.com/roles/{id})
 *    Bouton Apply → <a href="https://hdpc.fa.us2.oraclecloud.com/…/apply/email">
 *    ou <button class="gs-uitk-c-…--button-root gs-button">Apply</button>
 *
 * 2. EMAIL / AUTH (/apply/email)
 *    - input#primary-email-0  (name="primary-email", ariaLabel="Email Address", type=email)
 *    - input#honey-pot-1      (name="honey-pot")  ← NE PAS REMPLIR
 *    - input#legal-disclaimer-checkbox (type=checkbox) ← T&C
 *    - <a id="legal-disclaimer-link">terms and conditions</a>
 *    - <a href="…/applicant-fpn.html">here</a>  ← politique confidentialité GS
 *    - button.app-dialog__footer-button.theme-color-1 "Agree" ← modal privacy
 *    - button.apply-flow-pagination__button.theme-color-1 "Next"
 *    - button.apply-flow-pagination__button.text-color-secondary "Cancel"
 *    Après Next → Oracle CE envoie un lien/code par email (authentification).
 *    Le candidat doit cliquer le lien ou saisir le code dans sa boîte mail.
 *
 * 3. CODE EMAIL / PIN (/apply/email — même URL, DOM différent)
 *    Apparaît si Oracle envoie un code OTP plutôt qu'un lien magique.
 *    Détecté par : texte "confirm your identity" ou "verify" + champs #pin-code-N
 *    (même pattern que JP Morgan - Oracle CE standard)
 *
 * 4. SECTION 1 — Informations personnelles + Documents (/apply/section/1)
 *    Texte : "resume", "cover letter", "linkedin profile", "terms and conditions"
 *    Champs confirmés :
 *    - Email (pré-rempli) : input[type="email"]
 *    - LinkedIn : input[aria-label*="LinkedIn" i] ou input[placeholder*="linkedin" i]
 *    - CV upload : input[type="file"] dans la zone "Resume"
 *      → PAS d'ID fixe (Oracle génère des IDs de session). Trouver par contexte.
 *    - LM upload : input[type="file"] dans la zone "Cover Letter"
 *    - T&C checkbox : input[type="checkbox"] (id="legal-disclaimer-checkbox" ou autre)
 *    - Next button : button.apply-flow-pagination__button.theme-color-1
 *
 * 5. SECTION 2 — Questions de candidature (/apply/section/2)
 *    Texte : "job application questions", "years of relevant experience", etc.
 *    Questions (pill buttons / radio buttons) :
 *    - "Years of relevant experience" → "Less than 1 year" | "1 - 3 years" | "3+ years"
 *    - "Work authorisation for the countries" → "Yes" | "No"
 *    - "Which of the following apply to you" (multi-sélection) :
 *        "National" | "EEA/Swiss National" | "Other"
 *    - "Require visa sponsorship" → "Yes" | "No"
 *    - "Previously interned or worked at Goldman Sachs" → "No" | "Yes - Full Time Employee" | "Yes - Intern"
 *    - "PricewaterhouseCoopers" → "Yes" | "No"
 *    - "Current contingent worker at Goldman Sachs" → "Yes" | "No"
 *    - "Government, regulatory, or intergovernmental" → "Yes" | "No"
 *    Diversité (optionnel, consentement requis) :
 *    - "Sexual orientation and gender identity data" (consentement) → "I consent" | "I do not consent"
 *    - "Please indicate your gender" → "Male" | "Female" | "Non-binary" | "Prefer not to say" | etc.
 *    - "Identify as transgender" → "Yes" | "No" | "I prefer not to say"
 *    - "Please indicate your sexual orientation" → options diverses | "Prefer not to say"
 *    - "Please indicate your pronouns" → "He/Him" | "She/Her" | "They/Them" | "Prefer Not To Say"
 *    - "Consider yourself to have a disability" → "Yes" | "No" | "Prefer not to say"
 *    - "Race / ethnicity" (OJ combobox) → liste déroulante Oracle JET
 *    - Next button
 *
 * 6. SECTION 3 — Langues & E-Signature (/apply/section/3)
 *    Texte : "language skills", "e-signature", "full name", "submit"
 *    Champs :
 *    - Langue : OJ combobox (label "Language" ou "Add Language" button)
 *    - Niveau : OJ combobox (label "Proficiency Level")
 *    - E-Signature Full Name : input[name="fullName"] ou input[aria-label*="full name" i]
 *    - Submit button : button.apply-flow-pagination__button.theme-color-1 "Submit"
 *
 * 7. SUCCÈS (/my-profile ou toast)
 *    - Toast : div.notifications[role="alert"] contenant "Thank you for your job application"
 *    - My Applications : texte "Application Submitted" sur /my-profile
 *
 * ── Sélecteurs Oracle HCM CX communs ────────────────────────────────────────
 *   Options dropdown : [role="option"], .oj-listbox-result, .oj-listview-item
 *   Pill/radio        : button[aria-pressed], [role="radio"], button.cx-select-pill-section
 *   Champ texte       : input.input-row__control, textarea.input-row__control
 *   File upload       : input[type="file"]
 *   Bouton Next/Submit: button.apply-flow-pagination__button.theme-color-1
 */
(function () {
  'use strict';

  if (globalThis.__TALEOS_GOLDMAN_SACHS_BLUEPRINT__) return;

  const LAST_CHECK_KEY = 'taleos_gs_blueprint_last_check';
  const LOG_KEY = 'taleos_gs_blueprint_log';
  const MAX_LOG_ENTRIES = 120;

  // ── Patterns texte confirmés (DOM réel) ─────────────────────────────────────
  const TEXT = {
    offer: ['apply', 'goldman sachs', 'corporate title', 'office location'],
    email: ['email address', 'terms and conditions', 'next', 'get started right away'],
    pin: ['confirm your identity', 'send new code', 'verify', 'pin-code'],
    section1: ['resume', 'cover letter', 'linkedin profile', 'terms and conditions'],
    section2: ['job application questions', 'years of relevant experience', 'work authorisation', 'visa sponsorship'],
    section3: ['language skills', 'e-signature', 'full name', 'submit'],
    success: ['thank you for your job application', 'application submitted'],
    alreadyApplied: ['you already applied', 'you may also view other jobs'],
    myProfile: ['my applications', 'active job applications', 'application submitted']
  };

  const PAGE_DEFS = {
    offer: {
      label: 'Offre Goldman Sachs',
      hostIncludes: ['higher.gs.com'],
      pathMatches: [/\/roles\//],
      selectorsAny: ['a[href*="hdpc.fa.us2.oraclecloud.com"]', 'button.gs-button', 'h1'],
      textPatterns: TEXT.offer
    },
    // Étape email / auth — URL : /apply/email
    // DOM confirmé : input#primary-email-0 + input#legal-disclaimer-checkbox + button "Next"
    email: {
      label: 'Email / Auth',
      hostIncludes: ['hdpc.fa.us2.oraclecloud.com'],
      pathMatches: [/\/apply\/email/],
      selectorsAny: ['input#primary-email-0', 'input[name="primary-email"]', 'input[type="email"]'],
      textPatterns: TEXT.email
    },
    // Code PIN — même URL /apply/email, DOM différent (champs OTP visibles)
    pin: {
      label: 'Code PIN email',
      hostIncludes: ['hdpc.fa.us2.oraclecloud.com'],
      pathMatches: [/\/apply\/email/],
      selectorsAny: ['#pin-code-1', 'input[id*="pin-code"]', 'input[name*="pin"]'],
      textPatterns: TEXT.pin
    },
    section_1: {
      label: 'Section 1 — Documents & infos',
      hostIncludes: ['hdpc.fa.us2.oraclecloud.com'],
      pathMatches: [/\/apply\/section\/1/, /\/apply\/?$/],
      selectorsAny: [
        'input[type="file"]',
        'input[type="email"]',
        'input[aria-label*="LinkedIn" i]',
        'input[type="checkbox"]'
      ],
      textPatterns: TEXT.section1
    },
    section_2: {
      label: 'Section 2 — Questions candidature',
      hostIncludes: ['hdpc.fa.us2.oraclecloud.com'],
      pathMatches: [/\/apply\/section\/2/],
      selectorsAny: ['button[aria-pressed]', '[role="radio"]', 'button'],
      textPatterns: TEXT.section2
    },
    section_3: {
      label: 'Section 3 — Langues & E-Signature',
      hostIncludes: ['hdpc.fa.us2.oraclecloud.com'],
      pathMatches: [/\/apply\/section\/3/],
      selectorsAny: ['input[name="fullName"]', 'input[aria-label*="full name" i]', 'button'],
      textPatterns: TEXT.section3
    },
    success: {
      label: 'Succès',
      hostIncludes: ['hdpc.fa.us2.oraclecloud.com'],
      selectorsAny: ['div.notifications[role="alert"]', 'main'],
      textPatterns: TEXT.success
    },
    already_applied: {
      label: 'Déjà candidaté',
      hostIncludes: ['hdpc.fa.us2.oraclecloud.com'],
      selectorsAny: ['main'],
      textPatterns: TEXT.alreadyApplied
    },
    my_profile: {
      label: 'My Applications',
      hostIncludes: ['hdpc.fa.us2.oraclecloud.com'],
      pathMatches: [/\/my-profile/],
      selectorsAny: ['main', 'ul', 'section'],
      textPatterns: TEXT.myProfile
    }
  };

  function normalizeText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getPageText(doc = document) {
    return normalizeText(doc.body?.innerText || doc.body?.textContent || '');
  }

  function isVisible(el) {
    if (!el) return false;
    const style = globalThis.getComputedStyle ? getComputedStyle(el) : null;
    const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
    return !!rect && rect.width > 0 && rect.height > 0 &&
      style?.display !== 'none' && style?.visibility !== 'hidden';
  }

  function queryVisible(doc, selector) {
    try {
      return Array.from(doc.querySelectorAll(selector)).find(isVisible) || null;
    } catch (_) { return null; }
  }

  function countTextMatches(text, patterns) {
    return (patterns || []).filter(p => text.includes(normalizeText(p))).length;
  }

  function detectPage(doc = document, href = location.href) {
    const url = new URL(href, location.origin);
    const host = String(url.hostname || '').toLowerCase();
    const pathname = String(url.pathname || '').toLowerCase();
    const text = getPageText(doc);

    // Priorités absolues : succès, déjà candidaté, PIN
    if (text.includes(normalizeText(TEXT.success[0]))) return { key: 'success', score: 100, label: PAGE_DEFS.success.label };
    // Détection déjà candidaté : innerText + textContent (shadow DOM / aria-live)
    const rawText = normalizeText(doc.body?.textContent || '');
    if (text.includes('you already applied') || rawText.includes('you already applied') ||
        queryVisible(doc, '[class*="already"], [class*="alreadyApplied"]')) {
      return { key: 'already_applied', score: 100, label: PAGE_DEFS.already_applied.label };
    }
    // PIN avant email (même URL, texte différent)
    if (/\/apply\/email/.test(pathname) && (
      queryVisible(doc, '#pin-code-1') || queryVisible(doc, 'input[id*="pin-code"]') ||
      text.includes('confirm your identity') || text.includes('send new code')
    )) return { key: 'pin', score: 100, label: PAGE_DEFS.pin.label };

    let best = { key: 'unknown', score: 0, label: 'Inconnue' };
    for (const [key, def] of Object.entries(PAGE_DEFS)) {
      let score = 0;
      if ((def.hostIncludes || []).every(p => host.includes(p))) score += 2;
      if ((def.pathMatches || []).some(re => re.test(pathname))) score += 3;
      score += countTextMatches(text, def.textPatterns);
      if ((def.selectorsAny || []).some(sel => queryVisible(doc, sel))) score += 2;
      if (score > best.score) best = { key, score, label: def.label };
    }
    return best;
  }

  function getStructureReport(pageKey, doc = document) {
    const def = PAGE_DEFS[pageKey];
    if (!def) return { ok: false, pageKey, error: 'Unknown blueprint page' };
    const matchedSelectors = (def.selectorsAny || []).filter(sel => {
      try { return !!queryVisible(doc, sel) || !!doc.querySelector(sel); } catch (_) { return false; }
    });
    return {
      ok: matchedSelectors.length > 0,
      pageKey,
      label: def.label,
      matchedSelectors,
      missingSelectors: (def.selectorsAny || []).filter(s => !matchedSelectors.includes(s)),
      textMatches: (def.textPatterns || []).filter(p => getPageText(doc).includes(normalizeText(p))),
      href: location.href
    };
  }

  function checkToast(doc = document) {
    const notif = doc.querySelector('div.notifications[role="alert"]');
    return !!(notif?.innerText?.toLowerCase().includes('thank you for your job application'));
  }

  function checkApplicationInList(jobId, doc = document) {
    const id = String(jobId);
    const items = doc.querySelectorAll('main li, [class*="application-item"], [class*="job-item"]');
    for (const item of items) {
      const t = item.textContent || '';
      if (t.includes(id) && /application submitted/i.test(t)) return true;
    }
    return false;
  }

  async function recordLog(entry) {
    try {
      const stored = await chrome.storage.local.get(LOG_KEY);
      const logs = Array.isArray(stored[LOG_KEY]) ? stored[LOG_KEY] : [];
      logs.unshift({ ...entry, ts: Date.now() });
      if (logs.length > MAX_LOG_ENTRIES) logs.length = MAX_LOG_ENTRIES;
      await chrome.storage.local.set({ [LOG_KEY]: logs });
      await chrome.storage.local.set({ [LAST_CHECK_KEY]: { page: entry.page, href: entry.href, ts: Date.now() } });
    } catch (_) {}
  }

  const api = {
    detectPage,
    getStructureReport,
    checkToast,
    checkApplicationInList,
    recordLog,
    PAGE_DEFS,
    TEXT
  };

  globalThis.__TALEOS_GOLDMAN_SACHS_BLUEPRINT__ = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
