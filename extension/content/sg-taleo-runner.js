/**
 * Taleos - Déclencheur SG sur socgen.taleo.net
 * S'exécute à chaque chargement de page et demande l'injection du script d'automatisation.
 */
(function() {
  'use strict';
  const DEBUG = false;
  const log = (msg) => { if (DEBUG) console.log(`[Taleos SG Runner] ${msg}`); };

  async function triggerInjection() {
    try {
      const frame = window !== window.top ? 'iframe' : 'main';
      log(`Exécution (${frame}) - URL: ${location.href.slice(0, 80)}...`);
      const { taleos_pending_sg } = await chrome.storage.local.get('taleos_pending_sg');
      if (!taleos_pending_sg) {
        log('Pas de taleos_pending_sg → skip');
        return;
      }
      const age = Date.now() - (taleos_pending_sg.timestamp || 0);
      if (age > 3 * 60 * 1000) {
        chrome.storage.local.remove('taleos_pending_sg');
        log('taleos_pending_sg expiré → skip');
        return;
      }
      log('Envoi sg_page_loaded au background');
      chrome.runtime.sendMessage({ action: 'sg_page_loaded' });
    } catch (e) {
      log(`Erreur: ${e.message}`);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(triggerInjection, 800));
  } else {
    setTimeout(triggerInjection, 800);
  }
})();
