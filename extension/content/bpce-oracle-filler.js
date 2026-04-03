/**
 * Taleos - Remplissage formulaire BPCE Oracle Cloud (ekez.fa.em2.oraclecloud.com)
 * Version 1.1.0 : Intégration GA4 Measurement Protocol pour tracking analytique.
 */
(function() {
  'use strict';

  const BANNER_ID = 'taleos-bpce-oracle-banner';
  let isAutomationRunning = false;
  let loggedMessages = new Set();
  let filledFields = new Set();
  /** Dernier cv_storage_path pour lequel l’upload Firebase a réussi (permet re-upload si le profil change). */
  let bpceCvUploadedStoragePath = null;

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
    const api = globalThis.__TALEOS_AUTOMATION_BANNER__;
    const banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.textContent = api ? api.getText() : '⏳ Automatisation Taleos en cours — Ne touchez à rien.';
    if (api) api.applyStyle(banner);
    else {
      Object.assign(banner.style, {
        position: 'fixed', top: '0', left: '0', right: '0', zIndex: '2147483647',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white',
        padding: '10px 20px', fontSize: '14px', fontWeight: '600', textAlign: 'center',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        boxShadow: '0 2px 10px rgba(0,0,0,0.2)'
      });
    }
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
      input.value = newVal;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
  }

  /** Numéro national seul pour le champ téléphone (Oracle valide souvent sans le 0 initial quand l’indicatif +33 est séparé). */
  function normalizeNationalPhoneDigits(rawPhone, countryCode) {
    let d = String(rawPhone || '').replace(/\D/g, '');
    const cc = String(countryCode || '+33').trim().replace(/\s/g, '');
    if (cc === '+33' || cc === '33') {
      if (d.length >= 10 && d.startsWith('0')) d = d.slice(1);
      if (d.length >= 11 && d.startsWith('33')) d = d.slice(2);
    }
    return d;
  }

  /** Case « alertes opportunités » — une seule fois (évite cocher/décocher en boucle). */
  function applyJobAlertsCheckboxOnce(profile) {
    if (filledFields.has('bpce_job_alerts_done')) return;
    const want = !!profile.bpce_job_alerts;
    for (const row of document.querySelectorAll('.apply-flow-block, .input-row, .apply-flow-question')) {
      const t = (row.textContent || '');
      if (!/mises à jour|opportunités|nouvelles opportunités|recevoir les mises/i.test(t)) continue;
      const btn = row.querySelector('.apply-flow-input-checkbox__button');
      if (!btn || btn.offsetParent === null) continue;
      const checked = btn.classList.contains('apply-flow-input-checkbox__button--checked');
      if (checked === want) {
        filledFields.add('bpce_job_alerts_done');
        logOnce(`   — Alertes emploi → déjà ${want ? 'coché' : 'décoché'} (Skip)`);
        return;
      }
      btn.click();
      filledFields.add('bpce_job_alerts_done');
      logOnce(`   ✅ Alertes emploi → ${want ? 'coché' : 'décoché'}`);
      return;
    }
  }

  /**
   * Une seule ligne de question (pas tout le bloc apply-flow) : sinon le 1er « Oui »/« Non »
   * du DOM peut appartenir à une autre question → faux « déjà Non » alors que le handicap est sur Oui.
   */
  function findHandicapQuestionRow() {
    for (const row of document.querySelectorAll('.apply-flow-block .input-row, .apply-flow-question, .input-row')) {
      const label = row.querySelector('.input-row__label, [class*="label"], label, legend, .apply-flow-question-title');
      const t = ((label?.textContent || '') + '\n' + (row.textContent || '')).toLowerCase();
      if (!/handicap|reconnaissance administrative|titre de reconnaissance/.test(t)) continue;
      if (/natixis|\bvivier\b|conserve mon profil|mises à jour|nouvelles opportunités/i.test(t)) continue;
      return row;
    }
    return null;
  }

  function findVivierQuestionRow() {
    for (const row of document.querySelectorAll('.apply-flow-block .input-row, .apply-flow-question, .input-row')) {
      const t = (row.textContent || '').toLowerCase();
      if (!/vivier|natixis|conserve mon profil/.test(t)) continue;
      return row;
    }
    return null;
  }

  /** Valeur profil Taleos → libellé pilule Oracle ; « Je ne souhaite pas répondre » → ne pas forcer le clic. */
  function resolveBpceOuiNonPill(raw, defaultPill) {
    const s = String(raw || '').trim();
    if (!s) return { pill: defaultPill, abstain: false };
    if (/^oui$/i.test(s)) return { pill: 'Oui', abstain: false };
    if (/^non$/i.test(s)) return { pill: 'Non', abstain: false };
    if (/je ne souhaite pas répondre/i.test(s)) return { pill: null, abstain: true };
    return { pill: defaultPill, abstain: false };
  }

  /** Télécharge le fichier depuis Firebase Storage (via background) et l’assigne à l’input file (comme Deloitte / CA). */
  async function setFileInputFromStorage(inputEl, storagePath, filename) {
    if (!inputEl || !storagePath) return false;
    try {
      const r = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'fetch_storage_file', storagePath }, resolve);
      });
      if (r && r.error) throw new Error(r.error);
      if (!r || !r.base64) {
        logOnce('   ❌ CV → fichier introuvable sur Firebase (réponse vide)');
        return false;
      }
      const bin = atob(r.base64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const blob = new Blob([arr], { type: r.type || 'application/pdf' });
      const file = new File([blob], filename || 'cv.pdf', { type: blob.type });
      const dt = new DataTransfer();
      dt.items.add(file);
      inputEl.files = dt.files;
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    } catch (e) {
      logOnce(`   ❌ CV / fichier → ${e && e.message ? e.message : 'erreur'}`);
      return false;
    }
  }

  function findBpceCvFileInput() {
    const tryVisible = (el) => (el && el.offsetParent !== null ? el : null);
    let el = tryVisible(document.querySelector('input.file-form-element__input.upload-button[type="file"]'));
    if (el) return el;
    el = tryVisible(document.querySelector('input[name="attachment-upload"][type="file"]'));
    if (el) return el;
    el = tryVisible(document.querySelector('input[id^="attachment-upload"][type="file"]'));
    if (el) return el;
    return Array.from(document.querySelectorAll('input[type="file"]')).find((inp) => {
      if (inp.offsetParent === null) return false;
      const id = inp.getAttribute('id');
      const esc = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/"/g, '\\"');
      const forLabel = id ? document.querySelector(`label[for="${esc}"]`) : null;
      const lab = (forLabel?.textContent || '').toLowerCase();
      return /c\.?\s*v|curriculum|resume|charger un/.test(lab);
    }) || null;
  }

  /**
   * Retire une pièce déjà listée par Oracle (bouton Supprimer / remove à proximité du champ CV).
   * Sinon l’ancien fichier reste et le nouveau n’est pas pris en compte.
   */
  async function removeExistingBpceCvNearInput(fileInput) {
    if (!fileInput) return false;
    const wrap = fileInput.closest('.file-form-element') || fileInput.parentElement;
    const roots = [wrap, wrap && wrap.parentElement].filter(Boolean);
    for (const root of roots) {
      const buttons = root.querySelectorAll('button, a[role="button"], [role="button"]');
      for (const btn of buttons) {
        if (btn.offsetParent === null) continue;
        const hint = `${btn.getAttribute('aria-label') || ''} ${btn.getAttribute('title') || ''} ${btn.textContent || ''}`;
        if (!/supprimer|retirer|remove|delete|effacer/i.test(hint)) continue;
        btn.click();
        await new Promise((r) => setTimeout(r, 500));
        return true;
      }
      const trash = root.querySelector('[class*="remove"][class*="attach"], [class*="delete"][class*="file"], .oj-button[aria-label*="Supprimer" i]');
      if (trash && trash.offsetParent !== null) {
        trash.click();
        await new Promise((r) => setTimeout(r, 500));
        return true;
      }
    }
    return false;
  }

  async function uploadBpceCvFromProfile(profile) {
    const storagePath = (profile && profile.cv_storage_path) ? String(profile.cv_storage_path).trim() : '';
    if (!storagePath) {
      logOnce('   ⏭️ CV → pas de cv_storage_path sur le profil Taleos');
      return;
    }
    if (filledFields.has('bpce_cv_upload_done') && bpceCvUploadedStoragePath === storagePath) return;
    if (bpceCvUploadedStoragePath !== storagePath) {
      filledFields.delete('bpce_cv_upload_done');
      filledFields.delete('bpce_cv_remove_tried');
    }

    const fileInput = findBpceCvFileInput();
    if (!fileInput) {
      logOnce('   ⏳ CV → champ « Charger un C.V. » non visible pour l’instant');
      return;
    }

    try {
      fileInput.scrollIntoView({ block: 'center', behavior: 'instant' });
    } catch (_) {}

    if (!filledFields.has('bpce_cv_remove_tried')) {
      const removed = await removeExistingBpceCvNearInput(fileInput);
      if (removed) logOnce('   ✅ CV → ancienne pièce retirée (Oracle)');
      filledFields.add('bpce_cv_remove_tried');
      await new Promise((r) => setTimeout(r, 200));
    }

    const cvName = (profile.cv_filename || storagePath.split('/').pop() || 'cv.pdf').trim();
    const inputAgain = findBpceCvFileInput() || fileInput;
    const ok = await setFileInputFromStorage(inputAgain, storagePath, cvName);
    if (ok) {
      filledFields.add('bpce_cv_upload_done');
      bpceCvUploadedStoragePath = storagePath;
      logOnce(`   ✅ CV → ${cvName} (Firebase)`);
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

  async function runAutomation() {
    if (isAutomationRunning) return;
    isAutomationRunning = true;

    try {
      const { taleos_pending_bpce } = await chrome.storage.local.get('taleos_pending_bpce');
      if (!taleos_pending_bpce) {
        isAutomationRunning = false;
        return;
      }
      const { profile, jobTitle, jobId } = taleos_pending_bpce;
      showBanner();

      // Track: Candidature initiée
      if (!filledFields.has('apply_start_tracked')) {
        chrome.runtime.sendMessage({
          action: 'track_event',
          eventName: 'apply_start',
          params: { site: 'bpce', job_title: jobTitle || 'Unknown', job_id: jobId || 'unknown' },
          userId: profile?.uid
        }).catch(() => {});
        filledFields.add('apply_start_tracked');
      }

      // --- Étape 1 : Email + CGU (uniquement avant le formulaire identité — sinon le 1er checkbox serait une autre case, ex. alertes emploi) ---
      const hasFullApplicationForm = !!document.querySelector('input[id*="lastName"]');
      const emailInput = document.querySelector('#primary-email-0') || document.querySelector('input[type="email"]');
      const onEmailStepOnly =
        emailInput &&
        emailInput.offsetParent !== null &&
        !document.querySelector('[id*="pin-code"]') &&
        !hasFullApplicationForm;
      if (onEmailStepOnly) {
        logOnce('📋 Étape 1 : Email + CGU', 1);
        smartFillInput('Email', emailInput, profile.email || profile.auth_email);
        const cguRow = Array.from(document.querySelectorAll('.apply-flow-block, .input-row')).find((el) =>
          /conditions|politique de confidentialité|cgu|terms|confidentialité/i.test(el.textContent || '')
        );
        const cgu = cguRow?.querySelector('.apply-flow-input-checkbox__button') ||
          document.querySelector('span.apply-flow-input-checkbox__button') ||
          document.querySelector('.apply-flow-input-checkbox__button');
        if (cgu && !cgu.classList.contains('apply-flow-input-checkbox__button--checked')) {
          cgu.click();
          logOnce('   ✅ CGU cochée');
        }
        const nextBtn = document.querySelector('button[title="Suivant"]') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Suivant'));
        if (nextBtn && !filledFields.has('step1_submitted')) {
          nextBtn.click();
          filledFields.add('step1_submitted');
          logOnce('✅ Clic Suivant → Code PIN');
          // Track: Email validé
          chrome.runtime.sendMessage({
            action: 'track_event',
            eventName: 'email_validated',
            params: { site: 'bpce' },
            userId: profile?.uid
          }).catch(() => {});
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
            // Track: PIN reçu et soumis
            chrome.runtime.sendMessage({
              action: 'track_event',
              eventName: 'pin_received',
              params: { site: 'bpce' },
              userId: profile?.uid
            }).catch(() => {});
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
        if (!filledFields.has('bpce_civility_done')) {
          let cr = false;
          if (civ.includes('monsieur')) cr = smartClickButton('Titre', 'M.');
          else if (civ.includes('madame')) cr = smartClickButton('Titre', 'Mme');
          if (cr === true || cr === 'already_selected') filledFields.add('bpce_civility_done');
        }

        const phoneCc = (profile.phone_country_code || '+33').trim();
        const nationalDigits = normalizeNationalPhoneDigits(profile.phone || profile.phone_number || '', phoneCc);
        const countryInput = document.querySelector('input[id*="country-codes-dropdown"]');
        const telInput = document.querySelector('input[type="tel"]');
        if (countryInput && countryInput.offsetParent !== null) {
          smartFillInput('Code Pays', countryInput, phoneCc);
          await new Promise((r) => setTimeout(r, 300));
        }
        if (telInput && telInput.offsetParent !== null && nationalDigits) {
          smartFillInput('Téléphone', telInput, nationalDigits);
        }

        logOnce('📋 Étape 2b : CV (Firebase)', 2);
        await uploadBpceCvFromProfile(profile);

        // Questions (une seule fois par champ pill — sinon setInterval reclique en boucle et bascule Oui/Non)
        logOnce('📋 Étape 3 : Questions de candidature', 3);
        if (!filledFields.has('bpce_handicap_done')) {
          const { pill: handicapPill, abstain: handicapAbstain } = resolveBpceOuiNonPill(profile.bpce_handicap, 'Non');
          let handicapRow = findHandicapQuestionRow();
          if (!handicapRow) {
            handicapRow = Array.from(document.querySelectorAll('.apply-flow-block, .input-row')).find((el) =>
              /titre de reconnaissance administrative|reconnaissance administrative.*situation de handicap/i.test(el.textContent || '')
            );
            if (!handicapRow) {
              handicapRow = Array.from(document.querySelectorAll('.apply-flow-block, .input-row')).find((el) => {
                const t = (el.textContent || '').toLowerCase();
                return t.includes('handicap') && !t.includes('natixis') && !/vivier|conserve mon profil/i.test(t);
              });
            }
          }
          if (handicapAbstain) {
            filledFields.add('bpce_handicap_done');
            logOnce('   — Handicap → « Je ne souhaite pas répondre » (profil), pilules non modifiées');
          } else if (handicapRow && handicapPill) {
            const hr = smartClickButton('Handicap', handicapPill, handicapRow);
            if (hr === true || hr === 'already_selected') filledFields.add('bpce_handicap_done');
          }
        }

        // Disponibilité
        const disponibiliteTextarea = document.querySelector('textarea[name="300000620007177"]') || 
                                     document.querySelector('textarea[id^="300000620007177"]') ||
                                     document.querySelector('.input-row__control--autoheight');
        
        const availableFrom = (profile.available_from || profile.available_date || profile.disponibilite || 'Immédiatement').trim();
        if (disponibiliteTextarea) {
          smartFillInput('Disponibilité', disponibiliteTextarea, availableFrom);
        }

        // Vivier Natixis
        if (!filledFields.has('bpce_vivier_done')) {
          const { pill: vivierPill } = resolveBpceOuiNonPill(profile.bpce_vivier_natixis, 'Oui');
          let vivierRow = findVivierQuestionRow();
          if (!vivierRow) {
            vivierRow = Array.from(document.querySelectorAll('.apply-flow-block, .input-row')).find((el) => {
              const t = el.textContent.toLowerCase();
              return t.includes('vivier') || t.includes('natixis') || t.includes('conserve mon profil');
            });
          }
          if (vivierRow && vivierPill) {
            const vr = smartClickButton('Vivier Natixis', vivierPill, vivierRow);
            if (vr === true || vr === 'already_selected') filledFields.add('bpce_vivier_done');
          }
        }

        // LinkedIn
        const linkedinInput = document.querySelector('input[id*="siteLink"]');
        if (linkedinInput) smartFillInput('LinkedIn', linkedinInput, profile.linkedin_url);

        applyJobAlertsCheckboxOnce(profile);

        logOnce('✅ Formulaire rempli ! Veuillez vérifier et SOUMETTRE.', 2);
        
        // Track: Formulaire rempli
        if (!filledFields.has('form_filled_tracked')) {
          chrome.runtime.sendMessage({
            action: 'track_event',
            eventName: 'form_filled',
            params: { site: 'bpce', job_title: jobTitle || 'Unknown' },
            userId: profile?.uid
          }).catch(() => {});
          filledFields.add('form_filled_tracked');
        }
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
    try {
      const v = chrome.runtime.getManifest().version;
      logOnce(`👁️  Surveillance Totale active (v${v}) avec GA4 Tracking`);
    } catch (_) {
      logOnce('👁️  Surveillance Totale active avec GA4 Tracking');
    }
    
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

  // Track: Détection du bouton Soumettre (candidature complète)
  const submitObserver = new MutationObserver(() => {
    const submitBtn = document.querySelector('button[title="Soumettre"]') || 
                      Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('SOUMETTRE'));
    if (submitBtn && !window.__taleosBpceSubmitTracked) {
      window.__taleosBpceSubmitTracked = true;
      submitBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({
          action: 'track_event',
          eventName: 'apply_success',
          params: { site: 'bpce' }
        }).catch(() => {});
      });
    }
  });
  submitObserver.observe(document.body, { childList: true, subtree: true });
})();
