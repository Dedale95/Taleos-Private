/**
 * Taleos - Content Script (site Taleos)
 * Intercepte le clic sur "Candidater" et envoie à l'extension pour ouverture + automatisation
 */

(function() {
  'use strict';

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
    return null;
  }

  function extractJobIdFromOnClick(btn) {
    const onclick = btn.getAttribute?.('onclick') || '';
    const m = onclick.match(/applyToJob\s*\(\s*['"]([^'"]+)['"]/);
    return m ? m[1] : null;
  }

  function onApplyClick(e) {
    const btn = e.target.closest?.('.job-apply-btn');
    if (!btn) return;

    const found = findJobCard(btn);
    if (!found) return;

    const { card, jobUrl } = found;
    const jobId = extractJobIdFromOnClick(btn) || (card.querySelector('.job-id')?.textContent || '').trim();
    const jobTitle = (card.querySelector('.job-title')?.textContent || '').trim();
    const companyName = (card.querySelector('.company-name-wrapper span, .job-company span')?.textContent || '').trim();

    e.preventDefault();
    e.stopPropagation();

    const bankId = getBankIdFromUrl(jobUrl);

    chrome.runtime.sendMessage({
      action: 'taleos_apply',
      offerUrl: jobUrl,
      bankId,
      jobId,
      jobTitle,
      companyName
    }).catch(() => {
      console.warn('[Taleos] Extension non disponible, ouverture normale');
      window.open(jobUrl, '_blank');
    });
  }

  document.addEventListener('click', onApplyClick, true);

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'taleos_candidature_success') {
      window.dispatchEvent(new CustomEvent('taleos-extension-candidature-success', {
        detail: { jobId: msg.jobId, status: msg.status }
      }));
    }
  });
})();
