/**
 * Taleos - Polyfill AT_click pour socgen.taleo.net (évite l'erreur application.js)
 * application.js appelle AT_click.tag() - on fournit un objet compatible.
 */
(function() {
  if (window.AT_click && typeof window.AT_click.tag === 'function') return;
  const noop = function() {};
  window.AT_click = window.AT_click || noop;
  if (typeof window.AT_click.tag !== 'function') {
    window.AT_click.tag = noop;
  }
})();
