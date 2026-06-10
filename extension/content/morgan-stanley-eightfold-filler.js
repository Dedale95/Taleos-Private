/**
 * Taleos — Morgan Stanley Eightfold Filler  v1
 * Portail : morganstanley.eightfold.ai/careers/job/*
 *
 * Ce script gère la phase 1 du flux Morgan Stanley :
 *   1. Page offre Eightfold → clic automatique sur le bouton Apply
 *   2. Si Apply redirige vers ms.wd5.myworkdayjobs.com (même onglet ou nouvel onglet),
 *      le background.js injecte morgan-stanley-workday-filler.js automatiquement.
 *   3. Si Apply ouvre un formulaire inline Eightfold, une bannière guide l'utilisateur.
 *
 * Données en attente : chrome.storage.local.taleos_pending_morgan_stanley_workday
 */
(function () {
  'use strict';

  if (!/morganstanley\.eightfold\.ai/i.test(location.hostname || '')) return;
  if (globalThis.__TALEOS_MS_EF_RUNNING__) return;
  globalThis.__TALEOS_MS_EF_RUNNING__ = true;

  const PENDING_KEY = 'taleos_pending_morgan_stanley_workday';
  const LOG_PREFIX  = '[Taleos MS Eightfold]';

  function log(msg) {
    console.log(`${LOG_PREFIX} ${msg}`);
    try {
      chrome.runtime.sendMessage({
        action: 'extension_run_log', source: 'morgan-stanley-eightfold-filler',
        level: /❌/.test(msg) ? 'error' : /⚠️/.test(msg) ? 'warn' : 'info',
        message: `${LOG_PREFIX} ${msg}`, ts: new Date().toISOString()
      }).catch(() => {});
    } catch (_) {}
  }

  function setBanner(text, color) {
    let el = document.getElementById('taleos-ms-ef-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'taleos-ms-ef-banner';
      Object.assign(el.style, {
        position: 'fixed', top: '0', left: '0', width: '100%', zIndex: '2147483647',
        background: '#002D62', color: '#fff', padding: '10px 16px',
        fontSize: '13px', fontWeight: '600', textAlign: 'center',
        boxShadow: '0 2px 6px rgba(0,0,0,0.3)', fontFamily: 'sans-serif'
      });
      document.documentElement.appendChild(el);
    }
    if (color) el.style.background = color;
    el.textContent = text;
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function waitFor(fn, timeoutMs = 12000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const el = fn();
      if (el) return el;
      await sleep(300);
    }
    return null;
  }

  async function clickEl(el) {
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    await sleep(150);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    el.click();
  }

  async function main() {
    log('🚀 Eightfold Filler v1 démarré — ' + location.href);

    // Vérifier qu'il y a une candidature en attente
    const local = await chrome.storage.local.get([PENDING_KEY]).catch(() => ({}));
    const pending = local[PENDING_KEY];
    if (!pending) {
      log('⚠️ Pas de candidature MS en attente — aucune action');
      return;
    }

    setBanner('⏳ Taleos — Morgan Stanley : recherche du bouton "Apply"...');
    log('📋 Candidature en attente trouvée');

    // Attendre que la page soit complètement chargée
    await sleep(2000);

    // ── Trouver le bouton Apply ──────────────────────────────────────────────
    // Eightfold utilise typiquement [data-test-id="apply-button"] ou un bouton
    // avec le texte Apply / Postuler / Apply Now
    const applyBtn = await waitFor(() =>
      document.querySelector('[data-test-id="apply-button"]') ||
      document.querySelector('[data-test-id="job-apply-button"]') ||
      document.querySelector('button[class*="apply"i]') ||
      Array.from(document.querySelectorAll('button, a[role="button"]')).find(el =>
        el.offsetWidth > 0 &&
        /^(apply|postuler|apply now|candidater|soumettre ma candidature)$/i.test((el.textContent || '').trim())
      ),
      15000
    );

    if (!applyBtn) {
      log('⚠️ Bouton Apply introuvable — affichage bannière manuelle');
      setBanner('⏸️ Cliquez sur "Apply" pour postuler — Taleos prendra le relai automatiquement', '#c47900');
      // Attendre que l'utilisateur navigue vers Workday manuellement
      // Le background listener _msInitListener s'en chargera
      return;
    }

    log(`✅ Bouton Apply trouvé : "${(applyBtn.textContent || '').trim()}"`);
    setBanner('🖱️ Clic sur Apply en cours...', '#002D62');

    // Observer la navigation avant de cliquer
    // Eightfold peut naviguer dans le même onglet ou ouvrir un nouvel onglet
    const beforeUrl = location.href;

    await clickEl(applyBtn);
    await sleep(2000);

    const afterUrl = location.href;

    if (afterUrl !== beforeUrl) {
      log(`✅ Navigation détectée : ${afterUrl}`);
      if (afterUrl.includes('ms.wd5.myworkdayjobs.com')) {
        setBanner('⏳ Workday détecté — chargement du formulaire...', '#002D62');
        // Le background listener va injecter le Workday filler dès que la page est chargée
      } else if (afterUrl.includes('morganstanley.eightfold.ai')) {
        // Même domaine — formulaire inline Eightfold
        setBanner('📝 Formulaire Eightfold détecté — remplissage à venir...', '#002D62');
        log('ℹ️ Application inline Eightfold — pas de redirection Workday');
        // Pour l'instant, on guide l'utilisateur manuellement
        await sleep(3000);
        setBanner('📝 Remplissez le formulaire — Taleos ne supporte pas encore l\'application inline Eightfold MS', '#c47900');
      }
    } else {
      // La page n'a pas changé — peut-être un modal ou une popup
      log('ℹ️ URL inchangée après clic Apply — vérification modal...');
      await sleep(1000);

      // Chercher un bouton "Continue" ou modal d'application
      const continueBtn = document.querySelector('[data-test-id="continue-button"]') ||
        document.querySelector('[data-test-id="submit-button"]') ||
        Array.from(document.querySelectorAll('button')).find(el =>
          el.offsetWidth > 0 && /^(continue|continuer|next|suivant)$/i.test((el.textContent || '').trim())
        );

      if (continueBtn) {
        log(`🖱️ Bouton "Continue" trouvé — clic`);
        setBanner('🖱️ Ouverture du formulaire de candidature...', '#002D62');
        await clickEl(continueBtn);
        await sleep(2000);
      }

      setBanner('📝 Suivez les instructions à l\'écran — Taleos a préparé vos données', '#4a5568');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    setTimeout(main, 1500);
  }
})();
