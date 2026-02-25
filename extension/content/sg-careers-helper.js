/**
 * Taleos - Helper Société Générale (careers.societegenerale.com)
 * Affiche le bandeau et clique sur "Apply" quand l'automatisation est lancée depuis Taleos
 */
(function() {
  'use strict';

  const BANNER_ID = 'taleos-sg-automation-banner';
  function showBanner() {
    if (document.getElementById(BANNER_ID)) return;
    const banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.innerHTML = '⚠️ Automatisation Taleos en cours — Ne touchez à rien, cela pourrait perturber le processus.';
    Object.assign(banner.style, {
      position: 'fixed', top: '0', left: '0', right: '0', zIndex: '2147483647',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white',
      padding: '10px 20px', fontSize: '14px', fontWeight: '600', textAlign: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      boxShadow: '0 2px 10px rgba(0,0,0,0.2)'
    });
    const root = document.body || document.documentElement;
    if (root) (root.firstChild ? root.insertBefore(banner, root.firstChild) : root.appendChild(banner));
  }

  async function run() {
    const { taleos_pending_sg } = await chrome.storage.local.get('taleos_pending_sg');
    if (!taleos_pending_sg) return;
    const age = Date.now() - (taleos_pending_sg.timestamp || 0);
    if (age > 3 * 60 * 1000) {
      chrome.storage.local.remove('taleos_pending_sg');
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
        btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await delay(500);
        btn.click();
        return;
      }
      await delay(500);
    }
  }

  run().catch(e => console.error('[Taleos SG Careers]', e));
})();
