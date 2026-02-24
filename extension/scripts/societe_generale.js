/**
 * Taleos - Automatisation Société Générale (careers.societegenerale.com)
 * Placeholder - À compléter avec la logique spécifique SG (sélecteurs Taleo)
 *
 * Les portails Taleo utilisent des IDs dynamiques du type:
 *   document.querySelector('input[id*="personal_info_FirstName"]')
 */

(function() {
  'use strict';

  const delay = ms => new Promise(r => setTimeout(r, ms));

  function log(msg) {
    const t = new Date().toLocaleTimeString('fr-FR');
    console.log(`[${t}] [Taleos SG] ${msg}`);
  }

  function findByIdContains(partialId) {
    const inputs = document.querySelectorAll(`input[id*="${partialId}"], input[name*="${partialId}"]`);
    return inputs[0] || null;
  }

  async function main(profile) {
    log('🚀 DÉMARRAGE BOT SOCIÉTÉ GÉNÉRALE (placeholder)');
    log('   À implémenter : sélecteurs Taleo dynamiques');
    log('   Exemple: input[id*="personal_info_FirstName"]');

    await delay(2000);

    const firstNameInput = findByIdContains('FirstName') || findByIdContains('firstname');
    const lastNameInput = findByIdContains('LastName') || findByIdContains('lastname');

    if (firstNameInput && profile.firstname) {
      firstNameInput.value = profile.firstname;
      firstNameInput.dispatchEvent(new Event('input', { bubbles: true }));
      log('   ✏️ Prénom rempli');
    }
    if (lastNameInput && profile.lastname) {
      lastNameInput.value = profile.lastname;
      lastNameInput.dispatchEvent(new Event('input', { bubbles: true }));
      log('   ✏️ Nom rempli');
    }

    log('   ℹ️ Complétez societe_generale.js avec les sélecteurs du portail SG.');
  }

  window.__taleosRun = function(profile) {
    main(profile).catch(e => console.error('[Taleos SG]', e));
  };
})();
