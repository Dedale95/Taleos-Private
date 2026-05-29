/**
 * Taleos — Nomura Alert Interceptor
 * S'exécute dans le monde MAIN (même contexte JS que la page) à document_start.
 * Intercepte window.alert() sur careers.nomura.com pour supprimer automatiquement
 * le popup "We're sorry, the page you are trying to access has expired."
 * qui apparaît lors du redirect talentcommunity/apply → career4.successfactors.com.
 */
(function () {
  const _origAlert = window.alert.bind(window);
  window.alert = function (msg) {
    const s = String(msg || '');
    if (/expired|expire|sorry.*access|access.*expired/i.test(s)) {
      console.log('[Taleos Nomura] alert "expired" intercepté et ignoré automatiquement:', s);
      return; // Supprime le popup bloquant
    }
    return _origAlert(s);
  };
})();
