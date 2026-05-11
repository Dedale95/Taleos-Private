/**
 * Bannière d'automatisation Taleos — partagée par toutes les banques (texte + style).
 * Chargé avant les scripts métier (injection ou content_scripts).
 */
(function () {
  'use strict';

  const DEFAULT_STYLE = {
    position: 'fixed',
    top: '0',
    left: '0',
    right: '0',
    zIndex: '2147483647',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    padding: '10px 20px',
    fontSize: '14px',
    fontWeight: '600',
    textAlign: 'center',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    boxShadow: '0 2px 10px rgba(0,0,0,0.2)'
  };

  function getManifestVersion() {
    try {
      return String(chrome.runtime.getManifest().version || '').trim();
    } catch (_) {
      return '';
    }
  }

  /** Texte unique pour toutes les automatisations (version lue depuis le manifest). */
  function getAutomationBannerText() {
    const v = getManifestVersion();
    return v
      ? `⏳ Automatisation Taleos en cours (v${v}) — Ne touchez à rien.`
      : '⏳ Automatisation Taleos en cours — Ne touchez à rien.';
  }

  function applyAutomationBannerStyle(el) {
    Object.assign(el.style, DEFAULT_STYLE);
  }

  globalThis.__TALEOS_AUTOMATION_BANNER__ = {
    getText: getAutomationBannerText,
    applyStyle: applyAutomationBannerStyle,
    getVersion: getManifestVersion
  };
})();
