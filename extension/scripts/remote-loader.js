/**
 * Chargeur minimal : le code d'automation est fourni par Firebase (fetch dans le service worker).
 * Le script distant doit définir window.__taleosRun comme les bundles locaux.
 */
(function () {
  if (window.__taleosInjectRemote) return;
  window.__taleosInjectRemote = function (source, data) {
    try {
      (0, eval)(source);
      if (typeof window.__taleosRun === 'function') {
        window.__taleosRun(data);
      } else {
        console.error('[Taleos Remote] Le script distant n’a pas défini window.__taleosRun');
      }
    } catch (e) {
      console.error('[Taleos Remote] Erreur exécution script distant', e);
      throw e;
    }
  };
})();
