/**
 * Taleos - Déclencheur SG sur socgen.taleo.net
 * S'exécute à chaque chargement de page et demande l'injection du script d'automatisation.
 */
(function() {
  'use strict';
  const DEBUG = false;
  const log = (msg) => { if (DEBUG) console.log(`[Taleos SG Runner] ${msg}`); };

  async function getCurrentTabId() {
    try {
      const res = await chrome.runtime.sendMessage({ action: 'taleos_get_current_tab_id' });
      return res?.tabId || null;
    } catch (_) { return null; }
  }

  async function triggerInjection() {
    try {
      const frame = window !== window.top ? 'iframe' : 'main';
      log(`Exécution (${frame}) - URL: ${location.href.slice(0, 80)}...`);
      const { taleos_pending_sg, taleos_sg_tab_id } = await chrome.storage.local.get(['taleos_pending_sg', 'taleos_sg_tab_id']);
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
      // Guard tabId : n'envoyer sg_page_loaded que si cet onglet est bien le tab de candidature
      if (taleos_sg_tab_id) {
        const currentTabId = await getCurrentTabId();
        if (currentTabId && currentTabId !== taleos_sg_tab_id) {
          log(`Onglet SG Taleo non armé par "Candidater" → skip (tab ${currentTabId}, attendu ${taleos_sg_tab_id})`);
          return;
        }
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
