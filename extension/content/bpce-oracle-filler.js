/**
 * Taleos - Remplissage formulaire BPCE Oracle Cloud (ekez.fa.em2.oraclecloud.com)
 * Version 1.0.61 : Sélection Oracle stabilisée par question, date DD-MM-YYYY, vivier Natixis robuste.
 */
(function() {
  'use strict';

  const BANNER_ID = 'taleos-bpce-oracle-banner';
  let isAutomationRunning = false;
  let loggedMessages = new Set();
  let filledFields = new Set();

  function logOnce(msg, stepNum) {
    const prefix = stepNum ? `[STEP ${stepNum}] ` : '';
    const fullMsg = `${prefix}${msg}`;
    if (!loggedMessages.has(fullMsg)) {
      console.log(`[${new Date().toLocaleTimeString('fr-FR')}] [Taleos BPCE Oracle] ${fullMsg}`);
      loggedMessages.add(fullMsg);
    }
  }

  function showBanner() {
    if (document.getElementById(BANNER_ID)) return;
    const banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.textContent = '⏳ Automatisation Taleos active (V1.0.61) — Ne touchez à rien.';
    Object.assign(banner.style, {
      position: 'fixed', top: '0', left: '0', right: '0', zIndex: '2147483647',
      background: 'linear-gradient(135deg, #003366 0%, #0055a4 100%)', color: 'white',
      padding: '10px 20px', fontSize: '14px', fontWeight: '600', textAlign: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      boxShadow: '0 2px 10px rgba(0,0,0,0.2)'
    });
    document.body?.insertBefore(banner, document.body.firstChild);
  }

  function smartFillInput(label, input, value) {
    if (!input || value == null) return false;
    const newVal = String(value).trim();
    const currentVal = (input.value || '').trim();

    if (currentVal === newVal) {
      logOnce(`   — ${label} → déjà "${currentVal}" (Skip)`);
      return false;
    }

    try {
      input.focus();
      // Utilisation d'une méthode de remplissage plus robuste pour éviter "Illegal invocation"
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set || 
                           Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      
      if (nativeSetter) {
        nativeSetter.call(input, newVal);
      } else {
        input.value = newVal;
      }
      
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.blur();
      logOnce(`   ✅ ${label} → "${newVal}" (Mis à jour)`);
      return true;
    } catch (e) {
      // Fallback simple si le setter natif échoue
      input.value = newVal;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
  }

  function smartClickButton(label, textToFind, container = document) {
    const elements = container.querySelectorAll('button, .cx-select-pill-section, .cx-select-pill-name, [role="button"]');
    const target = String(textToFind || '').trim().toLowerCase();
    
    for (const el of elements) {
      const elText = (el.textContent || '').trim().toLowerCase();
      if (elText === target) {
        const btn = el.closest('button') || el.closest('.cx-select-pill-section') || el;
        const isSelected = btn.classList.contains('cx-select-pill-section--selected') || 
                           btn.getAttribute('aria-pressed') === 'true' ||
                           btn.getAttribute('aria-checked') === 'true' ||
                           btn.classList.contains('active');
        
        if (isSelected) {
          logOnce(`   — ${label} → déjà "${textToFind}" (Skip)`);
          return 'already_selected';
        } else {
          btn.click();
          logOnce(`   ✅ ${label} → "${textToFind}" (Cliqué)`);
          return true;
        }
      }
    }
    return false;
  }

  function normalizeText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function findQuestionContainer(fragments) {
    const normalizedFragments = (fragments || []).map(normalizeText).filter(Boolean);
    if (!normalizedFragments.length) return null;
    const candidates = Array.from(document.querySelectorAll('.apply-flow-block, .input-row, .apply-flow-section, [data-bind*="cx-select-pills"]'))
      .map(el => el.closest('.apply-flow-block, .input-row, .apply-flow-section') || el)
      .filter(Boolean);
    for (const el of candidates) {
      const text = normalizeText(el.textContent || '');
      if (normalizedFragments.every(fragment => text.includes(fragment))) {
        return el;
      }
    }
    return null;
  }

  function formatOracleAvailability(value) {
    const raw = String(value || '').trim();
    if (!raw) return 'Immédiatement';
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`;
    const slash = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (slash) return `${slash[1]}-${slash[2]}-${slash[3]}`;
    return raw;
  }

  async function runAutomation() {
    if (isAutomationRunning) return;
    isAutomationRunning = true;

    try {
      const { taleos_pending_bpce } = await chrome.storage.local.get('taleos_pending_bpce');
      if (!taleos_pending_bpce) {
        isAutomationRunning = false;
        return;
      }
      const { profile } = taleos_pending_bpce;
      showBanner();

      // --- Étape 1 : Email + CGU ---
      const emailInput = document.querySelector('#primary-email-0') || document.querySelector('input[type="email"]');
      if (emailInput && emailInput.offsetParent !== null && !document.querySelector('[id*="pin-code"]')) {
        logOnce('📋 Étape 1 : Email + CGU', 1);
        smartFillInput('Email', emailInput, profile.email || profile.auth_email);
        const cgu = document.querySelector('span.apply-flow-input-checkbox__button') || document.querySelector('.apply-flow-input-checkbox__button');
        if (cgu && !cgu.classList.contains('apply-flow-input-checkbox__button--checked')) {
          cgu.click();
          logOnce('   ✅ CGU cochée');
        }
        const nextBtn = document.querySelector('button[title="Suivant"]') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Suivant'));
        if (nextBtn && !filledFields.has('step1_submitted')) {
          nextBtn.click();
          filledFields.add('step1_submitted');
          logOnce('✅ Clic Suivant → Code PIN');
        }
      }

      // --- Étape 1b : Code PIN ---
      const pinInput = document.querySelector('#pin-code-1');
      if (pinInput && pinInput.offsetParent !== null) {
        logOnce('📋 Étape 1b : Vérification d\'identité (Code PIN)', 1.5);
        const { taleos_bpce_pin_code } = await chrome.storage.local.get('taleos_bpce_pin_code');
        if (taleos_bpce_pin_code && String(taleos_bpce_pin_code).length === 6) {
          const pin = String(taleos_bpce_pin_code);
          for (let i = 0; i < 6; i++) {
            const field = document.querySelector(`#pin-code-${i + 1}`);
            if (field) smartFillInput(`Digit ${i+1}`, field, pin[i]);
          }
          const verifyBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('VÉRIFIER'));
          if (verifyBtn && !filledFields.has('pin_submitted')) {
            verifyBtn.click();
            filledFields.add('pin_submitted');
            logOnce('✅ Code PIN soumis');
          }
        } else {
          logOnce('   ⏳ En attente du code PIN...');
        }
      }

      // --- Étape 2 : Formulaire complet ---
      const lastNameInput = document.querySelector('input[id*="lastName"]') || document.querySelector('input[autocomplete="family-name"]');
      if (lastNameInput && lastNameInput.offsetParent !== null) {
        logOnce('📋 Étape 2 : Formulaire complet détecté !', 2);
        
        // Contact
        smartFillInput('Nom', lastNameInput, profile.last_name || profile.lastname);
        smartFillInput('Prénom', document.querySelector('input[id*="firstName"]') || document.querySelector('input[autocomplete="given-name"]'), profile.first_name || profile.firstname);
        
        const civ = (profile.civility || '').toLowerCase();
        if (civ.includes('monsieur')) smartClickButton('Titre', 'M.');
        else if (civ.includes('madame')) smartClickButton('Titre', 'Mme');

        smartFillInput('Téléphone', document.querySelector('input[type="tel"]'), profile.phone || profile.phone_number);
        smartFillInput('Code Pays', document.querySelector('input[id*="country-codes-dropdown"]'), profile.phone_country_code || '+33');

        // Questions
        logOnce('📋 Étape 3 : Questions de candidature', 3);
        const handicapVal = (profile.bpce_handicap || 'Non').trim();
        const handicapContainer = findQuestionContainer([
          'travailleur en situation de handicap',
          'reconnaissance administrative'
        ]) || findQuestionContainer(['handicap']);
        if (handicapContainer) smartClickButton('Handicap', handicapVal, handicapContainer);

        // Disponibilité Oracle attendue en DD-MM-YYYY si une date est fournie.
        const disponibiliteTextarea = document.querySelector('textarea[name="300000620007177"]') || 
                                     document.querySelector('textarea[id^="300000620007177"]') ||
                                     document.querySelector('.input-row__control--autoheight');
        
        const availableFrom = formatOracleAvailability(profile.available_from || profile.available_date || profile.disponibilite || 'Immédiatement');
        if (disponibiliteTextarea) {
          smartFillInput('Disponibilité', disponibiliteTextarea, availableFrom);
        }

        const vivierVal = (profile.bpce_vivier_natixis || 'Oui').trim();
        const vivierContainer = findQuestionContainer([
          'natixis conserve mon profil'
        ]) || findQuestionContainer([
          'conserve mon profil dans le vivier candidats'
        ]) || findQuestionContainer([
          'proposer de nouvelles offres d emploi'
        ]) || findQuestionContainer([
          'natixis'
        ]);
        if (vivierContainer) {
          smartClickButton('Vivier Natixis', vivierVal, vivierContainer);
        }

        // LinkedIn
        const linkedinInput = document.querySelector('input[id*="siteLink"]');
        if (linkedinInput) smartFillInput('LinkedIn', linkedinInput, profile.linkedin_url);

        logOnce('✅ Formulaire rempli ! Veuillez vérifier et SOUMETTRE.', 2);
      }
    } catch (e) {
      logOnce('❌ Erreur automation: ' + e.message);
    } finally {
      isAutomationRunning = false;
    }
  }

  function init() {
    if (window.__taleosBpceOracleInit) return;
    window.__taleosBpceOracleInit = true;
    logOnce('👁️  Surveillance Totale active (V1.0.61)');
    
    setInterval(runAutomation, 1500);

    const observer = new MutationObserver(() => {
      clearTimeout(window.__taleosBpceDebounce);
      window.__taleosBpceDebounce = setTimeout(runAutomation, 500);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    runAutomation();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
