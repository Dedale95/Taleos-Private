/**
 * Taleos - La Banque Postale (offre → formulaire Lumesse)
 * Étape 1 : détecte la page offre LBP et navigue vers le formulaire Lumesse/TalentLink.
 * Le remplissage du formulaire est ensuite géré par lumesse-filler.js.
 */
(function () {
  'use strict';

  const MAX_PENDING_AGE = 10 * 60 * 1000;
  const BANNER_ID = 'taleos-lbp-automation-banner';
  let currentTabIdPromise = null;

  try {
    chrome.storage.local.set({
      taleos_lbp_script_ping: { script: 'la-banque-postale-careers-filler.js', url: location.href, at: new Date().toISOString() },
    });
  } catch (_) {}

  function reportRunLog(message) {
    try {
      chrome.runtime.sendMessage({
        action: 'extension_run_log',
        source: 'la-banque-postale-careers-filler',
        level: 'info',
        message: String(message || ''),
        ts: new Date().toISOString(),
      }).catch(() => {});
    } catch (_) {}
  }

  function log(msg) {
    const line = `[Taleos LBP] ${msg}`;
    console.log(line);
    reportRunLog(line);
  }

  async function getCurrentTabId() {
    if (!currentTabIdPromise) {
      currentTabIdPromise = chrome.runtime.sendMessage({ action: 'taleos_get_current_tab_id' })
        .then((res) => res?.tabId || null)
        .catch(() => null);
    }
    return currentTabIdPromise;
  }

  function showBanner(text) {
    const api = globalThis.__TALEOS_AUTOMATION_BANNER__;
    let el = document.getElementById(BANNER_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = BANNER_ID;
      if (api) api.applyStyle(el);
      else {
        Object.assign(el.style, {
          position: 'fixed', top: '0', left: '0', right: '0', zIndex: '2147483647',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white',
          padding: '10px 20px', fontSize: '14px', fontWeight: '600', textAlign: 'center',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
        });
      }
      document.body?.insertBefore(el, document.body.firstChild);
    }
    el.textContent = text || (api ? api.getText() : '⏳ Automatisation Taleos LBP — Ne touchez à rien.');
  }

  function hideBanner() {
    document.getElementById(BANNER_ID)?.remove();
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Cherche le lien Lumesse/"Postuler" sur la page offre LBP.
   * Priorité : blueprint (findApplyLink) → sélecteurs génériques.
   */
  function findLumesseApplyLink() {
    const blueprint = globalThis.__TALEOS_LBP_BLUEPRINT__;
    if (blueprint?.findApplyLink) {
      const el = blueprint.findApplyLink(document);
      if (el) return el;
    }
    // Fallbacks
    const direct = Array.from(document.querySelectorAll('a[href*="recruitmentplatform.com"]'))
      .find((el) => el.offsetParent !== null);
    if (direct) return direct;

    return Array.from(document.querySelectorAll('a[href]')).find((el) => {
      if (el.offsetParent === null) return false;
      const text = (el.textContent || '').toLowerCase().trim();
      return (/postuler|candidater|apply/i.test(text)) && el.href;
    }) || null;
  }

  async function waitForApplyLink(maxWait = 10000) {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      const el = findLumesseApplyLink();
      if (el) return el;
      await sleep(300);
    }
    return null;
  }

  /** Vérifie que c'est bien une page offre LBP (path contient .job-NNN.html ou /offres-d-emploi). */
  function isLbpOfferPage() {
    const path = location.pathname || '';
    const host = location.hostname || '';
    if (!host.includes('labanquepostale.com')) return false;
    return /\.job-\d+\.html/i.test(path) || /offres-d-emploi/i.test(path) || /nos-offres/i.test(path);
  }

  async function runAutomation() {
    const currentTabId = await getCurrentTabId();
    const { taleos_pending_bpce, taleos_bpce_tab_id } = await chrome.storage.local.get([
      'taleos_pending_bpce',
      'taleos_bpce_tab_id',
    ]);

    if (!taleos_pending_bpce) {
      log('⏭️  Pas de candidature en cours (taleos_pending_bpce absent) → skip');
      return;
    }

    const expectedTabId = taleos_pending_bpce.tabId || taleos_bpce_tab_id || null;
    if (!currentTabId || !expectedTabId || currentTabId !== expectedTabId) {
      log('⏭️  Onglet LBP non armé par "Candidater" → skip');
      return;
    }

    const age = Date.now() - (taleos_pending_bpce.timestamp || 0);
    if (age > MAX_PENDING_AGE) {
      log('⏭️  Pending expiré (>10 min) → skip');
      chrome.storage.local.remove(['taleos_pending_bpce', 'taleos_bpce_tab_id']);
      return;
    }

    if (!isLbpOfferPage()) {
      log('⏭️  Pas sur une page offre LBP → skip');
      return;
    }

    // Validation blueprint optionnelle
    const blueprint = globalThis.__TALEOS_LBP_BLUEPRINT__;
    if (blueprint) {
      const detected = blueprint.detectPage(document);
      await blueprint.logCheck('lbp_offer_loaded', { page: detected.page, score: detected.score });
      if (detected.page !== 'offer') {
        log(`⚠️ Blueprint LBP : page détectée « ${detected.page} » (attendu : offer) — on continue quand même`);
      } else {
        log(`✅ Blueprint LBP : offre confirmée (score ${detected.score})`);
      }
    }

    showBanner('⏳ Taleos LBP — recherche du lien de candidature…');
    log('📋 Étape 1 LBP : recherche du lien Lumesse/TalentLink sur la page offre');

    const applyLink = await waitForApplyLink(10000);
    if (!applyLink) {
      log('❌ Lien Postuler/Lumesse introuvable sur la page LBP');
      hideBanner();
      return;
    }

    const applyUrl = String(applyLink.href || applyLink.getAttribute('href') || '').trim();
    if (!applyUrl) {
      log('❌ URL du lien "Postuler" vide');
      hideBanner();
      return;
    }

    log(`✅ Lien candidature LBP détecté → navigation vers ${applyUrl.slice(0, 100)}`);
    hideBanner();
    window.location.assign(applyUrl);
  }

  log('👁️ Script chargé, en attente du DOM LBP…');

  function tick() {
    if (!isLbpOfferPage()) return;
    runAutomation().catch((e) => log(`❌ ${e?.message || e}`));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tick, { once: true });
  } else {
    tick();
  }

  // Retry si la page charge en SPA
  setTimeout(tick, 2000);
  setTimeout(tick, 5000);
})();
