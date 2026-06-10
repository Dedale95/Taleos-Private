/**
 * Taleos — Morgan Stanley Eightfold Filler  v2
 * Portail : morganstanley.eightfold.ai/careers/job/*
 *
 * Flux :
 *   1. Page offre Eightfold → trouve le bouton "Postuler maintenant"
 *   2. Extrait l'URL Workday depuis le href du lien (param ?n=) ou depuis l'attribut href direct
 *   3. Navigue l'onglet courant vers Workday (évite l'ouverture d'un nouvel onglet)
 *   4. Le background.js injecte morgan-stanley-workday-filler.js dès que la page Workday est chargée
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

  /**
   * Extrait l'URL cible depuis un élément bouton/lien Eightfold.
   * Eightfold utilise un lien de tracking : /r?...&n=<url_encodée>
   * On extrait le paramètre `n` pour obtenir l'URL Workday directe.
   */
  function extractTargetUrl(el) {
    const href = el?.href || el?.getAttribute?.('href') || '';
    if (!href) {
      // Chercher un <a> parent ou enfant
      const anchor = el.closest('a') || el.querySelector('a');
      if (anchor) return extractTargetUrl(anchor);
      return null;
    }
    try {
      const url = new URL(href, location.origin);
      // Pattern Eightfold : /r?...&n=<encoded_workday_url>
      const n = url.searchParams.get('n');
      if (n) {
        const decoded = decodeURIComponent(n);
        log(`🔗 URL cible extraite du paramètre n= : ${decoded}`);
        return decoded;
      }
      // Href direct vers Workday
      if (href.includes('myworkdayjobs.com') || href.includes('wd5.myworkdayjobs')) {
        return href;
      }
    } catch (_) {}
    return null;
  }

  async function main() {
    log('🚀 Eightfold Filler v2 démarré — ' + location.href);

    // Vérifier qu'il y a une candidature en attente
    const local = await chrome.storage.local.get([PENDING_KEY]).catch(() => ({}));
    const pending = local[PENDING_KEY];
    if (!pending) {
      log('⚠️ Pas de candidature MS en attente — aucune action');
      return;
    }

    setBanner('⏳ Taleos — Morgan Stanley : recherche du bouton "Postuler maintenant"...');
    log('📋 Candidature en attente trouvée');

    await sleep(2000);

    // ── Trouver le bouton / lien Apply ──────────────────────────────────────
    const _applyTextRe = /^(apply|postuler|apply now|postuler maintenant|candidater|soumettre ma candidature|appliquer|je postule)$/i;
    const _findApplyBtn = () => {
      // 1. Sélecteurs data-test-id (Eightfold standard)
      const byTestId = document.querySelector('[data-test-id="apply-button"], [data-test-id="job-apply-button"]');
      if (byTestId && byTestId.offsetWidth > 0) return byTestId;
      // 2. Liens <a> dont le texte ou span enfant correspond (le bouton est souvent un <a>)
      for (const el of document.querySelectorAll('a, button, a[role="button"]')) {
        if (!el.offsetWidth) continue;
        const txt = (el.textContent || '').trim();
        if (_applyTextRe.test(txt)) return el;
        const span = el.querySelector('span');
        if (span && _applyTextRe.test((span.textContent || '').trim())) return el;
      }
      // 3. Fallback : span → remonter au lien parent
      for (const span of document.querySelectorAll('span')) {
        if (_applyTextRe.test((span.textContent || '').trim())) {
          const btn = span.closest('a, button');
          if (btn && btn.offsetWidth > 0) return btn;
        }
      }
      return null;
    };
    const applyBtn = await waitFor(_findApplyBtn, 15000);

    if (!applyBtn) {
      log('⚠️ Bouton Apply introuvable — bannière manuelle');
      setBanner('⏸️ Cliquez sur "Postuler maintenant" — Taleos prendra le relai automatiquement', '#c47900');
      return;
    }

    log(`✅ Bouton trouvé : "${(applyBtn.textContent || '').trim()}" | tag=${applyBtn.tagName} | href=${applyBtn.href || '(none)'}`);

    // ── Extraire l'URL Workday cible ─────────────────────────────────────────
    const workdayUrl = extractTargetUrl(applyBtn);

    if (workdayUrl && workdayUrl.includes('myworkdayjobs.com')) {
      log(`🚀 Navigation directe vers Workday : ${workdayUrl}`);
      setBanner('⏳ Redirection vers Workday — chargement du formulaire...', '#002D62');
      // Naviguer dans le même onglet — le background listener injectera le Workday filler
      window.location.href = workdayUrl;
      return;
    }

    // ── Le bouton est un <button> React sans href — son handler appelle window.open() ──
    // Le script morgan-stanley-eightfold-main-world.js (world: MAIN) patche window.open.
    // On pose le flag data-taleos-ms-intercept="1" sur <html> pour l'activer,
    // puis on clique. Le main-world script émet un CustomEvent avec l'URL Workday.
    log('ℹ️ Bouton sans href — activation flag main-world et clic');
    setBanner('🖱️ Ouverture de la candidature...', '#002D62');

    const workdayUrlFromMainWorld = await new Promise((resolve) => {
      const EVENT_NAME = '__taleos_ms_open_url__';
      let _done = false;

      window.addEventListener(EVENT_NAME, function handler(e) {
        window.removeEventListener(EVENT_NAME, handler);
        if (!_done) { _done = true; resolve(e.detail || ''); }
      });

      // Activer l'intercepteur main-world
      document.documentElement.setAttribute('data-taleos-ms-intercept', '1');

      // Déclencher le clic
      applyBtn.scrollIntoView({ block: 'center' });
      setTimeout(() => {
        applyBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        applyBtn.click();
      }, 100);

      // Timeout 8s — retirer le flag si pas de réponse
      setTimeout(() => {
        if (!_done) {
          _done = true;
          document.documentElement.removeAttribute('data-taleos-ms-intercept');
          resolve('');
        }
      }, 8000);
    });

    if (workdayUrlFromMainWorld) {
      log(`🔗 window.open intercepté : ${workdayUrlFromMainWorld}`);
      // Extraire l'URL Workday depuis le param n= du lien de tracking Eightfold
      let targetUrl = workdayUrlFromMainWorld;
      try {
        const u = new URL(workdayUrlFromMainWorld, location.origin);
        const n = u.searchParams.get('n');
        if (n) {
          targetUrl = decodeURIComponent(n);
          log(`🔗 URL Workday extraite du param n= : ${targetUrl}`);
        }
      } catch (_) {}
      setBanner('⏳ Redirection vers Workday — chargement du formulaire...', '#002D62');
      window.location.href = targetUrl;
    } else {
      log('⚠️ window.open non intercepté — navigation inchangée');
      setBanner('📝 Cliquez manuellement sur "Postuler maintenant"', '#c47900');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    setTimeout(main, 1500);
  }
})();
