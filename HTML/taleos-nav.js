(function () {
  'use strict';

  function scrollCurrentPageToTop() {
    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (_) {
      window.scrollTo(0, 0);
    }
  }

  function bindLogoScrollToTop() {
    const logos = document.querySelectorAll('a.logo');
    if (!logos.length) return;

    logos.forEach((logo) => {
      if (logo.dataset.taleosLogoBound === '1') return;
      logo.dataset.taleosLogoBound = '1';
      logo.addEventListener('click', function (event) {
        event.preventDefault();
        scrollCurrentPageToTop();
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindLogoScrollToTop);
  } else {
    bindLogoScrollToTop();
  }
})();
