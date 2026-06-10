/**
 * Taleos — Morgan Stanley Eightfold Main-World Interceptor
 * S'exécute dans le MAIN world (world: "MAIN" dans manifest.json).
 * Intercepte window.open() uniquement quand Taleos a posé le flag
 * data-taleos-ms-intercept="1" sur <html>, émet un CustomEvent avec l'URL,
 * et retourne null pour bloquer l'ouverture d'un nouvel onglet.
 */
(function () {
  'use strict';

  const EVENT_NAME = '__taleos_ms_open_url__';
  const FLAG_ATTR  = 'data-taleos-ms-intercept';

  const _origOpen = window.open.bind(window);

  window.open = function (url, target, features) {
    if (document.documentElement.getAttribute(FLAG_ATTR) === '1') {
      // Retirer le flag immédiatement pour ne pas bloquer les prochains window.open
      document.documentElement.removeAttribute(FLAG_ATTR);
      window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: String(url || '') }));
      return null; // bloque l'ouverture du nouvel onglet
    }
    return _origOpen(url, target, features);
  };
})();
