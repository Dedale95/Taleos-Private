/**
 * Taleos - Content Script (site Taleos)
 * Intercepte le clic sur "Candidater" et envoie à l'extension pour ouverture + automatisation
 * Synchronise aussi l'auth depuis le site vers l'extension (connexion automatique)
 */

(function() {
  'use strict';

  function syncAuthFromPage(forceRefresh) {
    try {
      if (!chrome?.runtime?.id) return;
      chrome.runtime.sendMessage({ action: 'inject_auth_sync', forceRefresh: !!forceRefresh }).catch(function() {});
    } catch (_) {}
  }

  function isExtensionValid() {
    try { return !!chrome?.runtime?.id; } catch (_) { return false; }
  }

  window.addEventListener('__TALEOS_AUTH_SYNC__', function(e) {
    const { token, uid, email } = e.detail || {};
    if (token && uid) {
      chrome.runtime.sendMessage({
        action: 'sync_auth_from_site',
        taleosUserId: uid,
        taleosIdToken: token,
        taleosUserEmail: email || ''
      }).catch(function() {});
    }
  });

  function scheduleSync() {
    syncAuthFromPage(false);
    setTimeout(function() { syncAuthFromPage(true); }, 2500);
    setTimeout(function() { syncAuthFromPage(true); }, 6000);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleSync);
  } else {
    scheduleSync();
  }

  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') {
      syncAuthFromPage(true);
    }
  });

  function getBankIdFromUrl(url) {
    if (!url) return null;
    if (url.includes('groupecreditagricole.jobs') || url.includes('creditagricole')) return 'credit_agricole';
    if (url.includes('careers.societegenerale.com') || url.includes('societegenerale')) return 'societe_generale';
    if (url.includes('deloitte.com')) return 'deloitte';
    return 'credit_agricole'; // défaut
  }

  function findJobCard(el) {
    let node = el;
    while (node && node !== document.body) {
      const url = node.getAttribute?.('data-job-url');
      if (url) return { card: node, jobUrl: url };
      node = node.parentElement;
    }
    // Fallback : chercher le lien "Voir l'offre" à côté du bouton
    const actions = el.closest?.('.job-actions, .job-footer');
    const link = actions?.querySelector?.('a.job-link[href]');
    if (link?.href) {
      const card = actions?.closest?.('.job-card') || actions?.parentElement?.closest?.('.job-card') || actions;
      return { card, jobUrl: link.href };
    }
    return null;
  }

  function extractJobIdFromOnClick(btn) {
    const onclick = btn.getAttribute?.('onclick') || '';
    const m = onclick.match(/applyToJob\s*\(\s*['"]([^'"]+)['"]/);
    return m ? m[1] : null;
  }

  // Anti-spam + retry : empêcher les clics multiples, permettre retry si échec
  const COOLDOWN_MS = 2500;
  const FAILURE_TIMEOUT_MS = 4 * 60 * 1000;
  const processingJobs = new Map();

  function clearProcessing(jobId, reEnableButton) {
    const entry = processingJobs.get(jobId);
    if (entry) {
      if (entry.timeoutId) clearTimeout(entry.timeoutId);
      processingJobs.delete(jobId);
      if (reEnableButton && entry.btn && entry.btn.isConnected) {
        entry.btn.disabled = false;
        entry.btn.removeAttribute('data-taleos-processing');
        const orig = entry.btn.getAttribute('data-taleos-original-text');
        if (orig) entry.btn.textContent = orig;
      }
    }
  }

  function setButtonProcessing(btn, jobId) {
    if (!btn.dataset.taleosOriginalText) btn.dataset.taleosOriginalText = btn.textContent || '📝 Candidater';
    btn.textContent = '⏳ En cours...';
    btn.disabled = true;
    btn.dataset.taleosProcessing = '1';
    const timeoutId = setTimeout(function() {
      clearProcessing(jobId, true);
    }, FAILURE_TIMEOUT_MS);
    processingJobs.set(jobId, { btn, timestamp: Date.now(), timeoutId });
  }

  async function onApplyClick(e) {
    const btn = e.target.closest?.('.job-apply-btn');
    if (!btn) return;

    const found = findJobCard(btn);
    if (!found) return;

    const { card, jobUrl } = found;
    const jobId = extractJobIdFromOnClick(btn) || (card.querySelector('.job-id')?.textContent || '').trim();
    const jobTitle = (card.querySelector('.job-title')?.textContent || '').trim();
    const companyName = (card.querySelector('.company-name-wrapper span, .job-company span')?.textContent || '').trim();
    let bankId = getBankIdFromUrl(jobUrl);
    if (jobUrl && String(jobUrl).toLowerCase().includes('groupecreditagricole.jobs')) {
      bankId = 'credit_agricole';
    }

    e.preventDefault();
    e.stopPropagation();

    if (!jobId) return;

    const now = Date.now();
    const entry = processingJobs.get(jobId);
    if (entry) {
      if (now - entry.timestamp < COOLDOWN_MS) return;
      clearProcessing(jobId, false);
    }

    if (!isExtensionValid()) {
      const openUrl = (bankId === 'credit_agricole' || jobUrl.includes('groupecreditagricole.jobs'))
        ? 'https://groupecreditagricole.jobs/fr/connexion/'
        : jobUrl;
      window.open(openUrl, '_blank');
      return;
    }

    setButtonProcessing(btn, jobId);
    syncAuthFromPage(true);

    try {
      await chrome.runtime.sendMessage({
        action: 'taleos_apply',
        offerUrl: jobUrl,
        bankId,
        jobId,
        jobTitle,
        companyName
      });
    } catch (err) {
      clearProcessing(jobId, true);
      const openUrl = (bankId === 'credit_agricole' || jobUrl.includes('groupecreditagricole.jobs'))
        ? 'https://groupecreditagricole.jobs/fr/connexion/'
        : jobUrl;
      window.open(openUrl, '_blank');
    }
  }

  document.addEventListener('click', onApplyClick, true);

  chrome.runtime.onMessage.addListener(function(msg) {
    if (msg.action === 'taleos_candidature_success') {
      clearProcessing(msg.jobId || '', false);
      window.dispatchEvent(new CustomEvent('taleos-extension-candidature-success', {
        detail: { jobId: msg.jobId, status: msg.status }
      }));
    }
    if (msg.action === 'taleos_candidature_failure') {
      clearProcessing(msg.jobId || '', true);
      window.dispatchEvent(new CustomEvent('taleos-extension-candidature-failure', {
        detail: { jobId: msg.jobId, error: msg.error }
      }));
    }
    if (msg.action === 'taleos_request_auth') {
      syncAuthFromPage(true);
    }
    if (msg.action === 'taleos_auth_required') {
      window.dispatchEvent(new CustomEvent('taleos-extension-auth-required'));
    }
  });
})();
