/**
 * Blueprint AXA / iCIMS
 * Sert de référentiel léger pour identifier les étapes clés du flow.
 */
(function() {
  'use strict';

  function detectAxaPage(doc = document, loc = window.location) {
    const host = loc.hostname || '';
    const path = loc.pathname || '';
    const href = loc.href || '';

    if (host.includes('careers.axa.com') && /\/careers-home\/jobs\/\d+/i.test(path)) {
      return 'public_job';
    }
    if (host.includes('careers-fr-axa.icims.com') && /\/jobs\/\d+\/login$/i.test(path) && !href.includes('in_iframe=1')) {
      return 'wrapper_login';
    }
    if (doc.querySelector('#enterEmailForm, input#email[name="css_loginName"]')) {
      return 'email_step';
    }
    if (doc.querySelector('input[type="password"]')) {
      return 'password_step';
    }
    if ((doc.body?.innerText || '').includes('Votre candidature a bien été transmise. Merci d\'avoir postulé.')) {
      return 'success';
    }
    if (doc.querySelector('input[name*="firstname" i], input[id*="firstName" i], select[name*="Q383" i], select[name*="Q389" i], input[name*="salary" i]')) {
      return 'candidate_form';
    }
    return 'unknown';
  }

  window.__TALEOS_AXA_BLUEPRINT__ = {
    name: 'AXA',
    detectPage: detectAxaPage,
    selectors: {
      wrapperIframe: '#icims_content_iframe[src]',
      emailInput: 'input#email[name="css_loginName"]',
      consentSelect: 'select[name="gdpr_consent_type"]',
      consentCheckbox: 'input#accept_gdpr[name="accept_gdpr"]',
      emailSubmit: '#enterEmailSubmitButton',
      passwordInput: 'input[type="password"]'
    }
  };
})();
