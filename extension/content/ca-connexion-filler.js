/**
 * Taleos - Remplissage formulaire connexion CA
 * S'exécute sur la page /connexion/ ou /login/ après navigation (FR/EN)
 * Gère aussi candidature-validee (succès) et admin-ajax.php
 */
(function() {
  'use strict';
  const path = window.location.pathname.toLowerCase();
  let currentTabIdPromise = null;

  const BANNER_ID = 'taleos-ca-automation-banner';
  async function getCurrentTabId() {
    if (!currentTabIdPromise) {
      currentTabIdPromise = chrome.runtime.sendMessage({ action: 'taleos_get_current_tab_id' })
        .then((res) => res?.tabId || null)
        .catch(() => null);
    }
    return currentTabIdPromise;
  }

  async function isActiveCaApplyTab() {
    const currentTabId = await getCurrentTabId();
    const { taleos_ca_apply_tab_id } = await chrome.storage.local.get('taleos_ca_apply_tab_id');
    return !!(currentTabId && taleos_ca_apply_tab_id && currentTabId === taleos_ca_apply_tab_id);
  }

  function isUnavailablePage() {
    const txt = (document.body?.textContent || '').toLowerCase();
    const href = (window.location?.href || '').toLowerCase();
    const p = (window.location?.pathname || '').toLowerCase();
    if (p === '/404' || p === '/404/' || /\/404(\/|$)/.test(href)) return true;
    return /la page que vous recherchez est introuvable|page introuvable|offre non disponible|offre n'est plus en ligne|offre expirée|page not found|error 404|job position is no longer online|the requested page no longer exists/.test(txt);
  }

  function notifyUnavailableAndStop(reason) {
    chrome.storage.local.get(['taleos_pending_offer', 'taleos_redirect_fallback']).then((s) => {
      const pending = s.taleos_pending_offer || {};
      const jobId = pending?.profile?.__jobId || pending?.jobId || '';
      const jobTitle = pending?.profile?.__jobTitle || pending?.jobTitle || '';
      const offerUrl = pending?.offerUrl || s.taleos_redirect_fallback || window.location.href;
      chrome.storage.local.remove(['taleos_pending_offer', 'taleos_redirect_fallback']);
      if (jobId || offerUrl) {
        chrome.runtime.sendMessage({
          action: 'candidature_failure',
          jobId,
          jobTitle,
          offerUrl,
          offerExpired: true,
          error: reason || 'Offre non disponible (404) — L\'offre n\'est plus en ligne.'
        }).catch(() => {});
      }
    });
  }

  function showAutomationBanner() {
    if (document.getElementById(BANNER_ID)) return;
    const api = globalThis.__TALEOS_AUTOMATION_BANNER__;
    const banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.textContent = api ? api.getText() : '⏳ Automatisation Taleos en cours — Ne touchez à rien.';
    if (api) api.applyStyle(banner);
    else {
      Object.assign(banner.style, {
        position: 'fixed', top: '0', left: '0', right: '0', zIndex: '2147483647',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white',
        padding: '10px 20px', fontSize: '14px', fontWeight: '600', textAlign: 'center',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        boxShadow: '0 2px 10px rgba(0,0,0,0.2)'
      });
    }
    const root = document.body || document.documentElement;
    if (root) (root.firstChild ? root.insertBefore(banner, root.firstChild) : root.appendChild(banner));
  }

  if (isUnavailablePage()) {
    notifyUnavailableAndStop('Offre non disponible (404) — L\'offre n\'est plus en ligne.');
    return;
  }

  if (path.includes('candidature-validee')) {
    showAutomationBanner();
    const m = path.match(/candidature-validee\/([^/]+)/);
    const jobId = m ? m[1] : null;
    function trySendSuccess(retries = 0) {
      if (retries > 20) return;
      chrome.storage.local.get(['taleos_success_pending', 'taleos_redirect_fallback']).then((s) => {
        const pending = s.taleos_success_pending;
        const offerUrl = pending?.offerUrl || s.taleos_redirect_fallback;
        if (jobId && offerUrl) {
          chrome.runtime.sendMessage({
            action: 'candidature_success',
            jobId,
            jobTitle: pending?.jobTitle || '',
            companyName: pending?.companyName || 'Crédit Agricole',
            offerUrl
          });
          chrome.storage.local.remove('taleos_success_pending');
        } else if (jobId && retries < 20) {
          setTimeout(() => trySendSuccess(retries + 1), 300);
        }
      });
    }
    trySendSuccess();
    return;
  }

  if (path.includes('/candidature/') || path.includes('/application/') || path.includes('/apply/') ||
      path.includes('/nos-offres-emploi/') || path.includes('/our-offers/') || path.includes('/our-offres/')) {
    chrome.storage.local.get(['taleos_pending_offer', 'taleos_redirect_fallback', 'taleos_pending_tab']).then(async (s) => {
      if (!(await isActiveCaApplyTab())) return;
      if (s.taleos_pending_offer || s.taleos_redirect_fallback || s.taleos_pending_tab) showAutomationBanner();
    });
  }

  if (path.includes('admin-ajax')) {
    const delay = ms => new Promise(r => setTimeout(r, ms));
    chrome.storage.local.get(['taleos_pending_offer', 'taleos_redirect_fallback']).then(async (s) => {
      if (!(await isActiveCaApplyTab())) return;
      const url = s.taleos_pending_offer?.offerUrl || s.taleos_redirect_fallback;
      if (url) {
        await delay(8000);
        window.location.replace(url);
      }
    });
    return;
  }
  if (!path.includes('connexion') && !path.includes('login') && !path.includes('connection')) {
    const isOfferPage = path.includes('nos-offres-emploi') || path.includes('our-offers') || path.includes('our-offres');
    const isCandidaturePage = path.includes('/candidature/') || path.includes('/application/') || path.includes('/apply/');
    if (isUnavailablePage()) {
      notifyUnavailableAndStop('Offre non disponible (404) — L\'offre n\'est plus en ligne.');
      return;
    }
    chrome.storage.local.get(['taleos_pending_offer', 'taleos_redirect_fallback']).then(async (s) => {
      if (!(await isActiveCaApplyTab())) return;
      const url = s.taleos_pending_offer?.offerUrl || s.taleos_redirect_fallback;
      const normalized = String(url || '').toLowerCase();
      const is404Target = /\/404(\/|$)/.test(normalized);
      if (is404Target) {
        notifyUnavailableAndStop('Offre non disponible (404) — L\'offre n\'est plus en ligne.');
        return;
      }
      if (url && url.includes('groupecreditagricole.jobs') && !isOfferPage && !isCandidaturePage) {
        console.log('[Taleos CA Connexion] Redirection vers l\'offre après connexion (page d\'accueil détectée)...');
        window.location.replace(url);
      } else if (isOfferPage && s.taleos_pending_offer?.profile) {
        chrome.runtime.sendMessage({ action: 'ca_offer_page_ready' }).catch(() => {});
      }
    });
    return;
  }

  const delay = ms => new Promise(r => setTimeout(r, ms));
  const MAX_PENDING_AGE = 2 * 60 * 1000;

  function reportRunLog(message) {
    try {
      chrome.runtime.sendMessage({
        action: 'extension_run_log',
        source: 'ca-connexion-filler',
        level: 'info',
        message: String(message || ''),
        ts: new Date().toISOString()
      }).catch(() => {});
    } catch (_) {}
  }

  function log(msg) {
    const line = `[${new Date().toLocaleTimeString('fr-FR')}] [Taleos CA Connexion] ${msg}`;
    console.log(line);
    reportRunLog(line);
  }

  async function snapshot(tag, extra = {}) {
    const api = globalThis.__TALEOS_CA_BLUEPRINT__;
    if (!api?.capturePageSnapshot) return;
    await api.capturePageSnapshot(tag, { extra });
  }

  async function validateBlueprint(expected, fatalMessage) {
    const api = globalThis.__TALEOS_CA_BLUEPRINT__;
    if (!api?.validateExpectedPage) return true;
    const result = await api.validateExpectedPage(expected);
    if (result.ok) {
      log(`🧭 Blueprint OK : ${result.detected}`);
      return true;
    }
    log(`⚠️ Blueprint mismatch : attendu ${result.expected.join(', ')} / détecté ${result.detected}`);
    if (fatalMessage) {
      log(`❌ ${fatalMessage}`);
    }
    return false;
  }

  async function validateLoginStructure() {
    const api = globalThis.__TALEOS_CA_BLUEPRINT__;
    if (!api?.validateLoginStructure) return true;
    const result = await api.validateLoginStructure();
    if (result.ok) {
      log(`🧱 Structure login OK : textHits=${result.textHits}, helpfulVisible=${result.helpfulVisible}`);
      return true;
    }
    log(`⚠️ Structure login incomplète : champs critiques manquants [${result.criticalMissing.join(', ')}]`);
    return false;
  }

  function hideAutomationBanner() {
    document.getElementById(BANNER_ID)?.remove();
  }

  function dismissCookieBanner() {
    const acceptFirst = document.querySelector('button.rgpd-btn-accept, button[class*="rgpd"][class*="accept"]') ||
      Array.from(document.querySelectorAll('button')).find(b => /^accepter|^accept|tout accepter|accept all/i.test((b.textContent || '').trim()));
    const btn = acceptFirst || document.querySelector('button.rgpd-btn-refuse, button[class*="rgpd"]') ||
      Array.from(document.querySelectorAll('button')).find(b => /accepter|refuser|accept|refuse|fermer|close/i.test(b.textContent || ''));
    if (btn && btn.offsetParent !== null) {
      btn.click();
      return true;
    }
    return false;
  }

  /** Remplissage direct (copier-coller) - résout les problèmes AJAX */
  function fillInput(input, value) {
    if (!input || value == null) return;
    const str = String(value);
    input.focus();
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) nativeSetter.call(input, str);
    else input.value = str;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.blur();
  }

  function findLoginInputs() {
    const selectors = [
      ['#form-login-email', '#form-login-password', '#form-login-submit'],
      ['input[id*="login-email"]', 'input[id*="login-password"]', 'button[id*="login-submit"]'],
      ['input[name*="email"]', 'input[name*="password"]', 'button[type="submit"]'],
      ['input[type="email"]', 'input[type="password"]', 'button[type="submit"]'],
      ['input[type="email"]', 'input[type="password"]', 'input[type="submit"]']
    ];
    for (const [eSel, pSel, sSel] of selectors) {
      const e = document.querySelector(eSel);
      const p = document.querySelector(pSel);
      let s = document.querySelector(sSel);
      if (!s && e) {
        const form = e.closest('form');
        if (form) {
          s = form.querySelector('button[type="submit"], input[type="submit"]');
          if (!s) {
            const btns = form.querySelectorAll('button, input[type="submit"]');
            s = Array.from(btns).find(b => /connexion|se connecter|login|sign in|connect/i.test((b.value || b.textContent || '').trim()));
          }
        }
      }
      if (e && p) return { email: e, pass: p, submit: s };
    }
    return null;
  }

  async function waitForForm(maxWait = 12000) {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      const inputs = findLoginInputs();
      if (inputs?.email && inputs.email.offsetParent !== null) return inputs;
      await delay(300);
    }
    return null;
  }

  /** Attend que l'animation de chargement soit terminée (spinner, overlay, etc.) */
  async function waitForLoadingComplete(maxWait = 25000) {
    const loadingSelectors = [
      '.spinner.is-active',
      '[class*="loading"][class*="active"]',
      '[class*="spinner"][class*="active"]',
      '[class*="loader"][class*="active"]',
      '[aria-busy="true"]',
      '[class*="overlay"][class*="loading"]',
      '.page-loader',
      '[class*="page-loader"]'
    ];
    const isVisible = (el) => el && el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).opacity !== '0';
    const hasVisibleLoading = () => {
      for (const sel of loadingSelectors) {
        const els = document.querySelectorAll(sel);
        if (Array.from(els).some(isVisible)) return true;
      }
      return false;
    };
    let stableCount = 0;
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      if (!hasVisibleLoading()) {
        stableCount++;
        if (stableCount >= 4) {
          log('   ✅ Animation de chargement terminée.');
          return true;
        }
      } else {
        stableCount = 0;
      }
      await delay(500);
    }
    log('   ⚠️ Timeout attente chargement (navigation quand même).');
    return false;
  }

  async function run() {
    await snapshot('ca_login_script_start');
    if (!(await isActiveCaApplyTab())) {
      return;
    }
    const { taleos_pending_offer } = await chrome.storage.local.get('taleos_pending_offer');
    if (!taleos_pending_offer) return;
    const age = Date.now() - (taleos_pending_offer.timestamp || 0);
    if (age > MAX_PENDING_AGE) {
      chrome.storage.local.remove('taleos_pending_offer');
      return;
    }
    const { offerUrl, profile } = taleos_pending_offer;
    if (!profile?.auth_email || !profile?.auth_password) {
      log('❌ Identifiants manquants dans pending_offer');
      chrome.storage.local.remove('taleos_pending_offer');
      return;
    }
    if (!(await validateBlueprint('login', 'Page de connexion non reconnue par le blueprint CA'))) {
      await snapshot('ca_login_blueprint_mismatch');
      return;
    }
    if (!(await validateLoginStructure())) {
      await snapshot('ca_login_structure_mismatch');
      return;
    }
    await snapshot('ca_login_validated');
    chrome.storage.local.set({ taleos_redirect_fallback: offerUrl });
    showAutomationBanner();
    log('📧 Remplissage formulaire connexion...');
    if (dismissCookieBanner()) {
      await delay(1500);
    }
    const inputs = await waitForForm();
    if (!inputs) {
      log('❌ Formulaire non trouvé après 12s');
      return;
    }
    await delay(800);
    log('   📋 Remplissage email (copier-coller)...');
    fillInput(inputs.email, profile.auth_email);
    await delay(100);
    log('   📋 Remplissage mot de passe (copier-coller)...');
    fillInput(inputs.pass, profile.auth_password);
    const submitBtn = inputs.submit;
    if (!submitBtn) {
      log('⚠️ Bouton Connexion introuvable');
      return;
    }
    // Toujours cliquer sur le bouton "Connexion" (comme l'utilisateur manuel)
    // form.requestSubmit() déclenchait un flux AJAX différent → erreur 400 admin-ajax
    log('✅ Clic sur le bouton Connexion...');
    submitBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
    await delay(200);
    submitBtn.focus();
    await delay(100);
    submitBtn.click();
    log('⏳ Attente fin authentification (disparition chargement)...');
    await delay(3000);
    await waitForLoadingComplete(25000);
    log('📂 Navigation vers l\'offre...');
    window.location.href = offerUrl;
  }

  run().catch(e => console.error('[Taleos CA Connexion]', e));
})();
