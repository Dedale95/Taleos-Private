/**
 * Taleos - Remplissage automatique BPCE (recrutement.bpce.fr)
 * Étape 1 : Clic sur "Postuler directement" pour ouvrir le formulaire Oracle
 * (Le formulaire email/CGU/Suivant est géré par bpce-oracle-filler.js sur Oracle Cloud)
 */
(function() {
  'use strict';

  const MAX_PENDING_AGE = 10 * 60 * 1000;
  const BANNER_ID = 'taleos-bpce-automation-banner';
  try { chrome.storage.local.set({ taleos_bpce_script_ping: { script: 'bpce-careers-filler.js', url: location.href, at: new Date().toISOString() } }); } catch (_) {}

  const STEP = (n, msg) => `[STEP ${n}] ${msg}`;
  function log(msg, stepNum) {
    const prefix = stepNum != null ? STEP(stepNum, '') : '';
    console.log(`[${new Date().toLocaleTimeString('fr-FR')}] [Taleos BPCE] ${prefix}${msg}`);
  }
  const bpceBlueprint = globalThis.__TALEOS_BPCE_BLUEPRINT__ || null;

  function showBanner() {
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
    document.body?.insertBefore(banner, document.body.firstChild);
  }

  function hideBanner() {
    document.getElementById(BANNER_ID)?.remove();
  }

  function findPostulerButton() {
    const links = document.querySelectorAll('a[href*="oraclecloud.com"][href*="apply"], a[title="Postuler"], a.c-button--big, a.c-offer-sticky-button');
    for (const a of links) {
      const text = (a.textContent || '').trim();
      if (/postuler|postulez|candidater/i.test(text)) return a;
    }
    return document.querySelector('a[href*="oraclecloud.com"][href*="apply"]');
  }

  function inferApplyVariantFromUrl(url) {
    const raw = String(url || '').toLowerCase();
    if (raw.includes('recruitmentplatform.com')) return 'bpce_lumesse';
    if (raw.includes('oraclecloud.com')) return raw.includes('natixis') ? 'natixis_oracle' : 'bpce_oracle';
    return 'bpce_unknown';
  }

  async function fetchOfferApiPayload() {
    try {
      const path = window.location.pathname || '';
      if (!path.startsWith('/job/')) return null;
      const base = `${window.location.origin}/app/wp-json/bpce/v1`;
      const routesRes = await fetch(`${base}/routes/?lang=fr`, { credentials: 'omit' });
      if (!routesRes.ok) return null;
      const routes = await routesRes.json();
      const route = Array.isArray(routes)
        ? routes.find((entry) => entry && entry.path === path && entry.exact === true && entry._uid)
        : null;
      if (!route?._uid) return null;

      const postRes = await fetch(`${base}/posts/?lang=fr&_uid=${encodeURIComponent(route._uid)}`, { credentials: 'omit' });
      if (!postRes.ok) return null;
      const post = await postRes.json();
      const postulate = post?.content?.top?.postulate?.link?.url || '';
      const title = post?.content?.top?.title || '';
      const company = post?.content?.top?.criteria?.brand || '';
      if (!postulate) return null;
      return {
        ok: true,
        title,
        company,
        applyUrl: String(postulate).trim(),
        variant: inferApplyVariantFromUrl(postulate),
        uid: route._uid
      };
    } catch (_) {
      return null;
    }
  }

  async function waitForElement(selectorFn, maxWait = 8000) {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      const el = selectorFn();
      if (el && el.offsetParent !== null) return el;
      await new Promise(r => setTimeout(r, 300));
    }
    return null;
  }

  async function runAutomation() {
    const { taleos_pending_bpce } = await chrome.storage.local.get('taleos_pending_bpce');
    if (!taleos_pending_bpce) {
      log('⏭️  Pas de candidature BPCE en cours (taleos_pending_bpce absent) → skip', 1);
      return;
    }

    const age = Date.now() - (taleos_pending_bpce.timestamp || 0);
    if (age > MAX_PENDING_AGE) {
      log('⏭️  Pending expiré (>10 min) → skip', 1);
      chrome.storage.local.remove(['taleos_pending_bpce', 'taleos_bpce_tab_id']);
      return;
    }

    const isOfferPage = /\/job\//.test(window.location.pathname || '');
    if (!isOfferPage) {
      log('⏭️  Pas sur une page offre (/job/) → skip', 1);
      return;
    }

    let apiOffer = null;
    if (bpceBlueprint) {
      const pageValidation = bpceBlueprint.validatePage('offer');
      await bpceBlueprint.logCheck('bpce_offer_phase1_loaded', {
        expected: ['offer'],
        detected: pageValidation.detected.page
      });
      if (!pageValidation.ok) {
        log(`❌ Blueprint BPCE mismatch : attendu offer / detecte ${pageValidation.detected.page}`, 1);
        return;
      }
      const report = bpceBlueprint.getOfferStructureReport();
      await bpceBlueprint.logCheck('Structure offre BPCE', report);
      if (!report.ok) {
        apiOffer = await fetchOfferApiPayload();
        if (!apiOffer?.ok) {
          log(`❌ Offre BPCE non conforme au blueprint: ${JSON.stringify(report)}`, 1);
          hideBanner();
          return;
        }
        await bpceBlueprint.logCheck('Structure offre BPCE (fallback API)', apiOffer);
        log(`✅ Fallback API BPCE OK — variante ${apiOffer.variant} — ${apiOffer.title || 'titre inconnu'}`, 1);
      } else {
        log(`✅ Blueprint offre OK — variante ${report.variant}`, 1);
      }
    }

    showBanner();
    log('📋 Étape 1 recrutement.bpce.fr : ouverture du vrai lien de candidature BPCE', 1);
    log('   Recherche du bouton public ou fallback API...', 1);

    const postulerBtn = apiOffer?.applyUrl ? null : await waitForElement(findPostulerButton);
    if (!postulerBtn && !apiOffer?.applyUrl) {
      log('❌ Bouton Postuler non trouvé', 1);
      hideBanner();
      return;
    }

    const applyUrl = String(apiOffer?.applyUrl || postulerBtn.href || postulerBtn.getAttribute('href') || '').trim();
    if (!applyUrl) {
      log('❌ URL du bouton "Postuler directement" introuvable', 1);
      hideBanner();
      return;
    }

    log(`✅ URL candidature détectée (${inferApplyVariantFromUrl(applyUrl)}) → navigation dans l’onglet courant`, 1);
    window.location.assign(applyUrl);
    hideBanner();
  }

  function init() {
    if (window.__taleosBpceInit) return;
    window.__taleosBpceInit = true;

    chrome.storage.local.get('taleos_pending_bpce').then((s) => {
      if (s.taleos_pending_bpce) {
        setTimeout(runAutomation, 800);
      }
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.taleos_pending_bpce?.newValue) {
        setTimeout(runAutomation, 800);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
