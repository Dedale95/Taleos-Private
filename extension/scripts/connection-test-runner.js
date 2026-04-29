/**
 * Taleos - Script de test de connexion bancaire (injecté dans l'onglet)
 * Gère le remplissage, la soumission et la détection du résultat pour CA, BNP, SG, Deloitte, Bpifrance
 */
(function() {
  'use strict';

  const CONFIG = {
    credit_agricole: {
      loginUrl: 'https://groupecreditagricole.jobs/fr/connexion/',
      emailSel: '#form-login-email',
      passwordSel: '#form-login-password',
      submitSel: '#form-login-submit',
      cookieSel: 'button.rgpd-btn-refuse',
      successCheck: (url, content) => !url.includes('connexion'),
      failureCheck: (url, content) => url.includes('connexion')
    },
    bnp_paribas: {
      loginUrl: 'https://bwelcome.hr.bnpparibas/fr_FR/externalcareers/Login',
      emailSel: '#tpt_loginUsername, input[name="username"]',
      passwordSel: '#tpt_loginPassword, input[name="password"]',
      submitSel: 'button[type="submit"][name="Connexion"], form[action*="/Login"] button[type="submit"]',
      cookieSel: null,
      successCheck: (url, content) => /\/profile\b/.test(url) || /mon profil/.test(content),
      failureCheck: (url, content) => /il se peut que le nom d'utilisateur ou le mot de passe soit incorrect, ou que l'accès soit limité\./.test(content)
    },
    societe_generale: {
      loginUrl: 'https://socgen.taleo.net/careersection/iam/accessmanagement/login.jsf?lang=fr-FR&redirectionURI=https%3A%2F%2Fsocgen.taleo.net%2Fcareersection%2Fsgcareers%2Fprofile.ftl%3Flang%3Dfr-FR%26src%3DCWS-1%26pcid%3Dmjlsx8hz6i4vn92z&TARGET=https%3A%2F%2Fsocgen.taleo.net%2Fcareersection%2Fsgcareers%2Fprofile.ftl%3Flang%3Dfr-FR%26src%3DCWS-1%26pcid%3Dmjlsx8hz6i4vn92z',
      emailSel: '#dialogTemplate-dialogForm-login-name1, input[id*="login-name"]',
      passwordSel: '#dialogTemplate-dialogForm-login-password',
      submitSel: '#dialogTemplate-dialogForm-login-defaultCmd',
      cookieSel: '#didomi-notice-disagree-button',
      successCheck: (url, content) => /profile|infojob|profil général/i.test(url + content),
      failureCheck: (url, content) => /errorMessageTitle/i.test(content)
    },
    deloitte: {
      loginUrl: 'https://fina.wd103.myworkdayjobs.com/fr-FR/DeloitteRecrute',
      emailSel: 'input[data-automation-id="email"]',
      passwordSel: 'input[data-automation-id="password"]',
      submitSel: '[data-automation-id="click_filter"][aria-label="Connexion"], [aria-label="Connexion"][role="button"], button[data-automation-id="signInSubmitButton"]',
      cookieSel: null,
      successCheck: (url, content) => {
        const html = (document.body?.innerHTML || '').toLowerCase();
        return /\/home\b|accueil candidat|navigationItem-Accueil/i.test(url + content) ||
          !!document.querySelector('[data-automation-id="navigationItem-Accueil candidat"]');
      },
      failureCheck: (url, content) => /errorMessage|data-automation-id="errorMessage"/i.test(content)
    },
    bpifrance: {
      loginUrl: 'https://bpi.tzportal.io//fr/login',
      emailSel: '#email, input[type="text"][name="email"], input[placeholder="Email"]',
      passwordSel: '#password, input[type="password"][name="password"], input[placeholder="Password"]',
      submitSel: 'a.btn.btn-primary, button[type="submit"], button',
      cookieSel: null,
      successCheck: (url, content) => /\/fr\/myaccount\b|se déconnecter|mon profil/i.test(url + content),
      failureCheck: (url, content) => /mot de passe incorrect|identifiants incorrects|se connecter/i.test(content)
    }
  };

  function fillAndSubmit(bankId, email, password) {
    const cfg = CONFIG[bankId];
    if (!cfg) return { done: false, error: 'Banque non supportée' };

    const qs = (sel) => {
      for (const part of sel.split(',')) {
        const e = document.querySelector(part.trim());
        if (e && e.offsetParent !== null) return e;
      }
      for (const part of sel.split(',')) {
        const e = document.querySelector(part.trim());
        if (e) return e;
      }
      return null;
    };

    try {
      if (cfg.cookieSel) {
        const cookieBtn = document.querySelector(cfg.cookieSel);
        if (cookieBtn && cookieBtn.offsetParent !== null) {
          cookieBtn.click();
        }
      }

      const emailEl = qs(cfg.emailSel);
      const passEl = document.querySelector(cfg.passwordSel);
      const submitEl = document.querySelector(cfg.submitSel);

      if (!emailEl || !passEl || !submitEl) {
        return { done: false, error: 'Formulaire de connexion non trouvé' };
      }

      emailEl.value = email;
      emailEl.dispatchEvent(new Event('input', { bubbles: true }));
      emailEl.dispatchEvent(new Event('change', { bubbles: true }));
      passEl.value = password;
      passEl.dispatchEvent(new Event('input', { bubbles: true }));
      passEl.dispatchEvent(new Event('change', { bubbles: true }));

      submitEl.click();
      return { done: true, submitted: true };
    } catch (e) {
      return { done: false, error: e.message };
    }
  }

  function checkResult(bankId) {
    const cfg = CONFIG[bankId];
    if (!cfg) return { success: false, message: 'Banque non supportée' };

    const url = (window.location?.href || '').toLowerCase();
    const content = (document.body?.innerText || document.body?.innerHTML || '').toLowerCase();

    if (cfg.successCheck(url, content)) {
      return { success: true, message: 'Connexion réussie' };
    }
    if (cfg.failureCheck(url, content)) {
      if (bankId === 'bnp_paribas' && /il se peut que le nom d'utilisateur ou le mot de passe soit incorrect, ou que l'accès soit limité\./i.test(document.body?.innerText || '')) {
        return { success: false, message: "Il se peut que le nom d'utilisateur ou le mot de passe soit incorrect, ou que l'accès soit limité." };
      }
      if (bankId === 'societe_generale' && /errorMessageTitle/i.test(document.body?.innerHTML || '')) {
        return { success: false, message: 'Email ou mot de passe incorrect.' };
      }
      if (bankId === 'deloitte' && document.querySelector('[data-automation-id="errorMessage"]')) {
        return { success: false, message: 'Identifiants Deloitte incorrects' };
      }
      if (bankId === 'bpifrance') {
        return { success: false, message: 'Identifiants Bpifrance incorrects' };
      }
      return { success: false, message: 'Email ou mot de passe incorrect.' };
    }

    return null;
  }

  window.__taleosConnectionTestFill = function() {
    const params = window.__taleosConnectionTestParams || {};
    const { bankId, email, password, phase } = params;
    if (bankId === 'deloitte' && phase === 1) {
      const connexionBtn = Array.from(document.querySelectorAll('span, button, a')).find(el => /^connexion$/i.test((el.textContent || '').trim()));
      if (connexionBtn && connexionBtn.offsetParent !== null) {
        connexionBtn.click();
        return { done: true, phase: 1, needPhase2: true };
      }
      return { done: false, error: 'Bouton Connexion non trouvé' };
    }
    if (!bankId || !email || !password) return { done: false, error: 'Paramètres manquants' };
    return fillAndSubmit(bankId, email, password);
  };

  window.__taleosConnectionTestCheck = function() {
    const params = window.__taleosConnectionTestParams || {};
    return checkResult(params.bankId || '');
  };
})();
