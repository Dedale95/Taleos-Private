/**
 * Taleos - Helper Société Générale (careers.societegenerale.com)
 * Affiche le bandeau et clique sur "Apply" quand l'automatisation est lancée depuis Taleos
 */
(function() {
  'use strict';

  const BANNER_ID = 'taleos-sg-automation-banner';
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
    const root = document.body || document.documentElement;
    if (root) (root.firstChild ? root.insertBefore(banner, root.firstChild) : root.appendChild(banner));
  }

  function is404OfferPage() {
    const txt = (document.body?.innerText || document.body?.innerHTML || document.documentElement?.innerHTML || '').toLowerCase();
    return /page not found|page introuvable|erreur 404|error 404|job position is no longer online|the requested page no longer exists|offre d'emploi ne soit plus en ligne|n'existe plus|il semblerait que la page/i.test(txt);
  }

  function urlMatchesOffer(currentUrl, offerUrl) {
    if (!offerUrl || !currentUrl) return false;
    const cur = String(currentUrl).toLowerCase().replace(/\/$/, '');
    const off = String(offerUrl).toLowerCase().replace(/\/$/, '');
    return cur === off || cur.startsWith(off) || off.startsWith(cur) ||
      (cur.includes('careers.societegenerale.com') && off.includes('careers.societegenerale.com'));
  }

  async function run() {
    let { taleos_pending_sg, taleos_apply_fallback } = await chrome.storage.local.get(['taleos_pending_sg', 'taleos_apply_fallback']);
    if (!taleos_pending_sg && taleos_apply_fallback) {
      const age = Date.now() - (taleos_apply_fallback.timestamp || 0);
      if (age > 5 * 60 * 1000) {
        chrome.storage.local.remove('taleos_apply_fallback');
        console.log('[Taleos SG Careers] Fallback expiré.');
        return;
      }
      if (urlMatchesOffer(window.location.href, taleos_apply_fallback.offerUrl)) {
        console.log('[Taleos SG Careers] Récupération depuis fallback (taleos_apply_fallback)...');
        try {
          await chrome.runtime.sendMessage({
            action: 'taleos_setup_for_open_tab',
            offerUrl: taleos_apply_fallback.offerUrl,
            bankId: taleos_apply_fallback.bankId,
            jobId: taleos_apply_fallback.jobId,
            jobTitle: taleos_apply_fallback.jobTitle,
            companyName: taleos_apply_fallback.companyName
          });
          await new Promise(r => setTimeout(r, 2500));
          const s = await chrome.storage.local.get('taleos_pending_sg');
          taleos_pending_sg = s.taleos_pending_sg;
        } catch (e) {
          console.warn('[Taleos SG Careers] Erreur setup fallback:', e);
          return;
        }
      }
    }
    if (!taleos_pending_sg) {
      console.log('[Taleos SG Careers] Pas de candidature en cours (taleos_pending_sg absent).');
      return;
    }
    const age = Date.now() - (taleos_pending_sg.timestamp || 0);
    if (age > 3 * 60 * 1000) {
      chrome.storage.local.remove('taleos_pending_sg');
      return;
    }

    if (is404OfferPage()) {
      const jobId = taleos_pending_sg?.profile?.__jobId || taleos_pending_sg?.jobId || '';
      const jobTitle = taleos_pending_sg?.profile?.__jobTitle || taleos_pending_sg?.jobTitle || '';
      const offerUrl = taleos_pending_sg?.profile?.__offerUrl || taleos_pending_sg?.offerUrl || '';
      chrome.storage.local.remove(['taleos_pending_sg', 'taleos_sg_tab_id']);
      try {
        if (jobId || offerUrl) {
          chrome.runtime.sendMessage({
            action: 'candidature_failure',
            jobId,
            jobTitle,
            offerUrl,
            error: 'Offre non disponible (404) — L\'offre n\'est plus en ligne.',
            offerExpired: true
          });
        }
      } catch (_) {}
      const banner = document.createElement('div');
      banner.id = BANNER_ID;
      banner.innerHTML = '⛔ Offre non disponible (404) — L\'offre n\'est plus en ligne. Candidature annulée.';
      Object.assign(banner.style, {
        position: 'fixed', top: '0', left: '0', right: '0', zIndex: '2147483647',
        background: 'linear-gradient(135deg, #c53030 0%, #9b2c2c 100%)', color: 'white',
        padding: '12px 20px', fontSize: '14px', fontWeight: '600', textAlign: 'center',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        boxShadow: '0 2px 10px rgba(0,0,0,0.2)'
      });
      (document.body?.firstChild ? document.body.insertBefore(banner, document.body.firstChild) : document.body?.appendChild(banner));
      return;
    }

    showBanner();
    const delay = ms => new Promise(r => setTimeout(r, ms));

    try {
      const host = document.querySelector('#didomi-host');
      const btn = host?.shadowRoot?.querySelector('#didomi-notice-disagree-button') ||
        document.querySelector('#didomi-notice-disagree-button');
      if (btn) btn.click();
      document.body.style.setProperty('overflow', 'auto', 'important');
    } catch (_) {}
    await delay(2000);

    const applySelectors = [
      'a[data-gtm-label="postuler"]',
      'a[data-gtm-label="apply"]',
      'a:has-text("Postuler")',
      'a:has-text("Apply")',
      'button:has-text("Postuler")',
      'button:has-text("Apply")',
      '[href*="postuler"], [href*="apply"]'
    ];

    for (let i = 0; i < 30; i++) {
      const btn = document.querySelector('a[data-gtm-label="postuler"]') ||
        document.querySelector('a[data-gtm-label="apply"]') ||
        Array.from(document.querySelectorAll('a, button')).find(el => {
          const t = (el.textContent || '').trim().toLowerCase();
          const label = (el.getAttribute('data-gtm-label') || '').toLowerCase();
          return /^postuler$|^apply$/i.test(t) || label === 'postuler' || label === 'apply';
        });
      if (btn && btn.offsetParent !== null) {
        console.log('[Taleos SG Careers] Clic sur Postuler...');
        btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await delay(500);
        btn.click();
        return;
      }
      await delay(500);
    }
    console.warn('[Taleos SG Careers] Bouton Postuler non trouvé après 15s.');
  }

  run().catch(e => console.error('[Taleos SG Careers]', e));
})();
