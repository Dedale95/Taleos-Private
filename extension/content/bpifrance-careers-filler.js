/**
 * Taleos - Bpifrance careers filler
 * Flux confirmé :
 * offre publique -> login éventuel -> upload CV -> formulaire -> succès
 */
(function () {
  'use strict';

  if (globalThis.__TALEOS_BPIFRANCE_FILLER__) return;
  globalThis.__TALEOS_BPIFRANCE_FILLER__ = true;

  const SESSION_PREFIX = 'taleos_bpi_';
  const MAX_SUBMIT_RETRIES = 2;
  let activeProfile = null;
  let runPromise = null;

  const blueprintApi = globalThis.__TALEOS_BPIFRANCE_BLUEPRINT__ || null;

  function reportRunLog(message) {
    try {
      chrome.runtime.sendMessage({
        action: 'extension_run_log',
        source: 'bpifrance-careers-filler',
        level: 'info',
        message: String(message || ''),
        ts: new Date().toISOString()
      }).catch(() => {});
    } catch (_) {}
  }

  function log(message) {
    const line = `[${new Date().toLocaleTimeString('fr-FR')}] [Taleos Bpifrance] ${String(message || '')}`;
    console.log(line);
    reportRunLog(line);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normalizeText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function showBanner() {
    if (document.getElementById('taleos-bpi-banner')) return;
    const api = globalThis.__TALEOS_AUTOMATION_BANNER__;
    const banner = document.createElement('div');
    banner.id = 'taleos-bpi-banner';
    banner.textContent = api ? api.getText() : '⏳ Automatisation Taleos en cours — Ne touchez à rien.';
    if (api) api.applyStyle(banner);
    document.body?.insertBefore(banner, document.body.firstChild);
  }

  function getSessionFlag(key) {
    try { return sessionStorage.getItem(SESSION_PREFIX + key) || ''; } catch (_) { return ''; }
  }

  function setSessionFlag(key, value) {
    try { sessionStorage.setItem(SESSION_PREFIX + key, String(value)); } catch (_) {}
  }

  function removeSessionFlag(key) {
    try { sessionStorage.removeItem(SESSION_PREFIX + key); } catch (_) {}
  }

  function formatLogValue(value) {
    const str = value == null ? '' : String(value).trim();
    return str || '(vide)';
  }

  function qs(selector) {
    try { return document.querySelector(selector); } catch (_) { return null; }
  }

  function isElementVisible(el) {
    if (!el) return false;
    const style = globalThis.getComputedStyle ? getComputedStyle(el) : null;
    const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
    return !!style && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && !!rect && rect.width > 0 && rect.height > 0;
  }

  function setInputValue(el, value) {
    if (!el) return false;
    const str = value != null ? String(value) : '';
    el.focus?.();
    try {
      const desc = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value');
      if (desc?.set) desc.set.call(el, str);
      else el.value = str;
    } catch (_) {
      el.value = str;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur?.();
    return true;
  }

  function setCheckbox(el, checked) {
    if (!el) return false;
    el.checked = !!checked;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function setSelectValue(el, value) {
    if (!el) return false;
    el.value = String(value || '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function getSelectedOptionText(selectEl) {
    if (!selectEl) return '';
    const option = selectEl.options?.[selectEl.selectedIndex];
    return String(option?.textContent || option?.label || '').trim();
  }

  function syncInputField(el, value, label) {
    if (!el) {
      log(`   ⚠️ ${label} : champ introuvable dans le formulaire`);
      return;
    }
    const target = value != null ? String(value).trim() : '';
    const current = String(el.value || '').trim();
    if (!target) {
      log(`   ℹ️ ${label} : aucune valeur Firebase exploitable -> Skip`);
      return;
    }
    if (current === target) {
      log(`   ✅ ${label} : formulaire='${formatLogValue(current)}' | Firebase='${formatLogValue(target)}' -> Skip`);
      return;
    }
    log(`   ✏️ ${label} : formulaire='${formatLogValue(current)}' | Firebase='${formatLogValue(target)}' -> Correction`);
    setInputValue(el, target);
  }

  function syncSelectField(selectEl, targetValue, label, targetLabel) {
    if (!selectEl) {
      log(`   ⚠️ ${label} : select introuvable dans le formulaire`);
      return;
    }
    const currentValue = String(selectEl.value || '').trim();
    const currentLabel = getSelectedOptionText(selectEl);
    const expectedValue = targetValue != null ? String(targetValue).trim() : '';
    const expectedLabel = String(targetLabel || '').trim() || expectedValue;
    if (!expectedValue) {
      log(`   ℹ️ ${label} : aucune valeur Firebase exploitable -> Skip`);
      return;
    }
    if (currentValue === expectedValue) {
      log(`   ✅ ${label} : formulaire='${formatLogValue(currentLabel)}' [${formatLogValue(currentValue)}] | Firebase='${formatLogValue(expectedLabel)}' [${formatLogValue(expectedValue)}] -> Skip`);
      return;
    }
    log(`   ✏️ ${label} : formulaire='${formatLogValue(currentLabel)}' [${formatLogValue(currentValue)}] | Firebase='${formatLogValue(expectedLabel)}' [${formatLogValue(expectedValue)}] -> Correction`);
    setSelectValue(selectEl, expectedValue);
  }

  function syncCheckboxField(checkboxEl, shouldBeChecked, label) {
    const checked = Boolean(checkboxEl?.checked);
    if (checked === !!shouldBeChecked) {
      log(`   ✅ ${label} : état attendu déjà présent -> Skip`);
      return;
    }
    log(`   ✏️ ${label} : formulaire='${checked ? 'coché' : 'non coché'}' | Firebase='${shouldBeChecked ? 'coché' : 'non coché'}' -> Correction`);
    setCheckbox(checkboxEl, shouldBeChecked);
  }

  function mapCivility(profile) {
    const raw = normalizeText(profile.civility || '');
    if (raw.includes('mme') || raw.includes('madame')) return 'mme';
    return 'm.';
  }

  function mapTalentPoolConsent(profile) {
    const raw = normalizeText(profile.bpifrance_talent_pool || '');
    if (['oui', 'yes', 'true'].includes(raw)) return true;
    if (['non', 'no', 'false'].includes(raw)) return false;
    return null;
  }

  async function setFileInputFromStorage(inputEl, storagePath, filename) {
    if (!inputEl || !storagePath) return false;
    const r = await chrome.runtime.sendMessage({ action: 'fetch_storage_file', storagePath }).catch(() => null);
    if (!r?.base64) return false;
    const bin = atob(r.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: r.type || 'application/pdf' });
    const file = new File([blob], filename || 'document.pdf', { type: blob.type });
    const dt = new DataTransfer();
    dt.items.add(file);
    inputEl.files = dt.files;
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function installApplyResponseProbe() {
    if (globalThis.__TALEOS_BPI_APPLY_PROBE__) return;
    globalThis.__TALEOS_BPI_APPLY_PROBE__ = true;
    globalThis.__TALEOS_BPI_LAST_APPLY_RESPONSE__ = null;

    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
      this.__taleosUrl = String(url || '');
      this.__taleosMethod = String(method || 'GET').toUpperCase();
      return origOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function patchedSend() {
      this.addEventListener('load', function onLoad() {
        try {
          if (!String(this.__taleosUrl || '').includes('/fr/a/apply')) return;
          let parsed = null;
          try { parsed = JSON.parse(String(this.responseText || '')); } catch (_) {}
          globalThis.__TALEOS_BPI_LAST_APPLY_RESPONSE__ = {
            at: Date.now(),
            status: Number(this.status || 0),
            url: String(this.__taleosUrl || ''),
            text: String(this.responseText || ''),
            json: parsed
          };
        } catch (_) {}
      });
      return origSend.apply(this, arguments);
    };
  }

  async function dismissCookieDialog() {
    const text = normalizeText(document.body?.innerText || '');
    if (!text.includes('nous nous soucions de votre vie privee') && !text.includes('tout refuser')) return false;
    const buttons = Array.from(document.querySelectorAll('button, [role="button"], a'));
    const rejectBtn = buttons.find((el) => {
      const label = normalizeText(el.textContent || el.getAttribute?.('aria-label') || '');
      return label === 'tout refuser' || label.includes('tout refuser');
    });
    if (rejectBtn) {
      log('🍪 Bpifrance → fermeture du bandeau cookies');
      rejectBtn.click();
      await sleep(600);
      return true;
    }
    return false;
  }

  async function validatePage(expected, profile, label) {
    if (!blueprintApi?.validateCurrentPage) return null;
    const res = await blueprintApi.validateCurrentPage(expected);
    log(`Blueprint Bpifrance ${label}: ${res.ok ? 'OK' : 'KO'} (${res.detected})`);
    await blueprintApi.recordLog?.({ kind: 'page_validation', label, expected, result: res });
    if (profile && blueprintApi.validateQuestionAudit && res.detected === 'apply_wizard') {
      const audit = blueprintApi.validateQuestionAudit(profile);
      log(`Audit Bpifrance formulaire: ${audit.ok ? 'OK' : 'KO'} (${audit.report?.unresolvedQuestionCount || 0} à traiter)`);
    }
    return res;
  }

  async function clickOfferApply() {
    const link = qs('a[href*="bpi.tzportal.io/fr/apply?job="]');
    if (!link) throw new Error('Lien Postuler Bpifrance introuvable');
    log('🔗 Offre Bpifrance → clic sur Postuler');
    location.assign(link.href);
  }

  async function fillLogin(profile) {
    const email = String(profile.auth_email || profile.email || '').trim();
    const password = String(profile.auth_password || '').trim();
    if (!email || !password) {
      await submitFailure(profile, 'Identifiants Bpifrance manquants. Configurez-les sur la page Connexions.');
      return;
    }
    if (getSessionFlag('login_submitted') === '1') {
      log('⏳ Bpifrance login déjà soumis, attente de redirection');
      return;
    }
    syncInputField(qs('input[type="email"], input[placeholder="Email"], #email'), email, 'Email de connexion');
    syncInputField(qs('input[type="password"], input[placeholder="Password"], #password'), password, 'Mot de passe');
    const submitBtn = Array.from(document.querySelectorAll('a, button')).find((el) => normalizeText(el.textContent || '') === 'login');
    if (!submitBtn) {
      await submitFailure(profile, 'Bouton LOGIN Bpifrance introuvable');
      return;
    }
    setSessionFlag('login_submitted', '1');
    log('➡️ Bpifrance → clic LOGIN');
    submitBtn.click();
  }

  async function uploadCv(profile) {
    if (getSessionFlag('uploaded_cv') === '1') return;
    const input = qs('#massivefileupload');
    if (!input) return;
    const ok = await setFileInputFromStorage(input, profile.cv_storage_path, profile.cv_filename || 'cv.pdf');
    if (!ok) {
      await submitFailure(profile, 'Impossible de charger le CV depuis Firebase');
      return;
    }
    setSessionFlag('uploaded_cv', '1');
    log(`✅ Bpifrance → CV chargé depuis Firebase (${profile.cv_filename || 'cv.pdf'})`);
    await sleep(2500);
  }

  async function fillApplicationForm(profile) {
    await uploadCv(profile);
    log('🧾 Bpifrance → audit détaillé Firebase vs formulaire');

    syncSelectField(document.getElementById('civility'), mapCivility(profile), 'Civilité', profile.civility || 'Monsieur');
    syncInputField(document.getElementById('firstName'), profile.firstname || '', 'Prénom');
    syncInputField(document.getElementById('lastName'), profile.lastname || '', 'Nom');
    syncInputField(document.getElementById('email'), profile.email || '', 'Email');
    syncInputField(document.getElementById('phone'), profile['phone-number'] || profile.phone_number || '', 'Téléphone');

    const messageEl = document.getElementById('message');
    if (messageEl) {
      log(`   ℹ️ Motivation : aucune consigne Firebase structurée -> formulaire='${formatLogValue(messageEl.value)}' -> Skip`);
    }
    const cooptedByEl = document.getElementById('cooptedBy');
    if (cooptedByEl) {
      log(`   ℹ️ Recommandation / matricule : non piloté par Firebase -> formulaire='${formatLogValue(cooptedByEl.value)}' -> Skip`);
    }

    syncCheckboxField(document.getElementById('consentement'), true, 'Consentement obligatoire');
    const optional = document.getElementById('optionnalConsentement');
    if (optional) {
      const targetOptional = mapTalentPoolConsent(profile);
      if (targetOptional == null) {
        log(`   ℹ️ Consentement vivier : aucune préférence Firebase exploitable -> formulaire='${optional.checked ? 'coché' : 'non coché'}' -> Skip`);
      } else {
        syncCheckboxField(optional, targetOptional, 'Consentement vivier');
      }
    }

    const audit = blueprintApi?.validateQuestionAudit?.(profile);
    if (audit) {
      log(`Audit Bpifrance formulaire après remplissage: ${audit.ok ? 'OK' : 'KO'} (${audit.report?.unresolvedQuestionCount || 0} à traiter)`);
    }
  }

  function getApplyResponse() {
    const raw = globalThis.__TALEOS_BPI_LAST_APPLY_RESPONSE__;
    if (!raw || Date.now() - Number(raw.at || 0) > 30000) return null;
    return raw;
  }

  function getOfferTitle() {
    const heading = Array.from(document.querySelectorAll('h1, h2, h3, .card-title, .wizard-title'))
      .map((el) => String(el.textContent || '').trim())
      .find((text) => normalizeText(text).startsWith('postuler au poste de'));
    if (!heading) return '';
    return heading.replace(/^Postuler au poste de\s*:\s*/i, '').trim();
  }

  function hasVisibleSuccessMessage() {
    const step3 = qs('#step3');
    const message = qs('#step3 #submitMessage .alert-text');
    if (!isElementVisible(step3) || !isElementVisible(message)) return false;
    return normalizeText(message.textContent || '').includes('votre candidature a bien ete prise en compte');
  }

  async function fetchMyPositioningsSnapshot() {
    try {
      const res = await fetch('/fr/mypositionings', { credentials: 'include' });
      if (!res.ok) return null;
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const bodyText = normalizeText(doc.body?.innerText || doc.body?.textContent || '');
      const countMatch = bodyText.match(/affichage de (\d+) elements sur (\d+)/);
      const total = countMatch ? Number(countMatch[2] || countMatch[1] || 0) : 0;
      const titles = Array.from(doc.querySelectorAll('td'))
        .map((cell) => String(cell.textContent || '').trim())
        .filter(Boolean)
        .filter((text) => {
          const norm = normalizeText(text);
          return norm && !/^\d+$/.test(norm) && !['portail', 'site talents'].includes(norm);
        });
      return {
        total,
        titles,
        titlesNormalized: titles.map((title) => normalizeText(title))
      };
    } catch (_) {
      return null;
    }
  }

  function hasNewApplication(beforeSnapshot, afterSnapshot) {
    const beforeTotal = Number(beforeSnapshot?.total || 0);
    const afterTotal = Number(afterSnapshot?.total || 0);
    return afterTotal > beforeTotal;
  }

  async function handleMyPositioningsPage(profile) {
    const submittedAt = Number(getSessionFlag('submitted_at') || '0');
    const beforeCount = Number(getSessionFlag('before_count') || '0');
    const successReported = getSessionFlag('success_reported') === '1';
    if (!submittedAt || successReported) {
      log('⏭️ Bpifrance → page Mes candidatures sans soumission récente à confirmer');
      return;
    }
    const ageMs = Date.now() - submittedAt;
    if (ageMs > 120000) {
      log('⏭️ Bpifrance → soumission trop ancienne pour confirmer via Mes candidatures');
      return;
    }
    const afterSnapshot = await fetchMyPositioningsSnapshot();
    if (!afterSnapshot) {
      log('⏭️ Bpifrance → impossible de lire Mes candidatures après redirection');
      return;
    }
    log(`📚 Bpifrance → Mes candidatures après redirection: ${afterSnapshot.total}`);
    if (afterSnapshot.total > beforeCount) {
      setSessionFlag('success_reported', '1');
      log('🎉 Bpifrance → succès confirmé après redirection vers Mes candidatures');
      await submitSuccess(profile);
      return;
    }
    log('⏭️ Bpifrance → aucune nouvelle candidature détectée après redirection');
  }

  async function submitApplication(profile) {
    const retries = Number(getSessionFlag('submit_retries') || '0');
    if (retries > MAX_SUBMIT_RETRIES) {
      await submitFailure(profile, 'Échec final Bpifrance après plusieurs tentatives');
      return;
    }
    const submitBtn = Array.from(document.querySelectorAll('button')).find((el) => normalizeText(el.textContent || '') === 'postuler');
    if (!submitBtn) {
      await submitFailure(profile, 'Bouton POSTULER Bpifrance introuvable');
      return;
    }
    const beforeSnapshot = await fetchMyPositioningsSnapshot();
    if (beforeSnapshot) {
      log(`📚 Bpifrance → Mes candidatures avant soumission: ${beforeSnapshot.total}`);
      setSessionFlag('before_count', beforeSnapshot.total);
    } else {
      log('ℹ️ Bpifrance → snapshot Mes candidatures indisponible avant soumission');
      removeSessionFlag('before_count');
    }

    setSessionFlag('submit_retries', String(retries + 1));
    setSessionFlag('submitted_at', Date.now());
    removeSessionFlag('success_reported');
    globalThis.__TALEOS_BPI_LAST_APPLY_RESPONSE__ = null;
    log(`➡️ Bpifrance → clic POSTULER (tentative ${retries + 1}/${MAX_SUBMIT_RETRIES + 1})`);
    submitBtn.click();

    for (let i = 0; i < 24; i++) {
      await sleep(500);
      const applyResponse = getApplyResponse();
      const mainAlert = String(applyResponse?.json?.formErrors?.mainAlert || '').trim();
      const emailError = String(applyResponse?.json?.formErrors?.email || '').trim();
      if (mainAlert) {
        const cleanAlert = mainAlert.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (normalizeText(cleanAlert).includes('deja candidate a cette offre')) {
          await submitFailure(profile, `Bpifrance : ${cleanAlert}`);
          return;
        }
        await submitFailure(profile, `Erreur Bpifrance: ${cleanAlert}`);
        return;
      }
      if (emailError) {
        const loginUrlMatch = emailError.match(/href=\\?"([^"]+)/i);
        const loginUrl = loginUrlMatch ? loginUrlMatch[1].replace(/\\\//g, '/') : '';
        if (normalizeText(emailError).includes('vous possedez deja un compte chez nous') && loginUrl) {
          log('🔐 Bpifrance → compte existant détecté, redirection vers la page de connexion');
          location.assign(loginUrl);
          return;
        }
        await submitFailure(profile, `Erreur Bpifrance: ${emailError.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}`);
        return;
      }

      const detected = blueprintApi?.detectPage ? blueprintApi.detectPage() : { key: 'unknown' };
      if (detected.key === 'success' || hasVisibleSuccessMessage()) {
        setSessionFlag('success_reported', '1');
        log('🎉 Bpifrance → confirmation visuelle de candidature détectée');
        await submitSuccess(profile);
        return;
      }

      if (i >= 5 && i % 4 === 1) {
        const afterSnapshot = await fetchMyPositioningsSnapshot();
        if (afterSnapshot) {
          log(`📚 Bpifrance → Mes candidatures après soumission: ${afterSnapshot.total}`);
          if (hasNewApplication(beforeSnapshot, afterSnapshot)) {
            const title = getOfferTitle();
            log(`🎉 Bpifrance → nouvelle candidature confirmée dans Mes candidatures${title ? ` (${title})` : ''}`);
            await submitSuccess(profile);
            return;
          }
        }
      }
    }

    await submitFailure(profile, 'Aucune confirmation Bpifrance détectée après soumission');
  }

  async function submitSuccess(profile) {
    await chrome.runtime.sendMessage({
      action: 'candidature_success',
      bankId: 'bpifrance',
      successType: 'submitted',
      successMessage: 'Votre candidature Bpifrance a été prise en compte.',
      status: 'envoyée',
      jobId: profile.__jobId || '',
      jobTitle: profile.__jobTitle || '',
      companyName: profile.__companyName || 'Bpifrance',
      offerUrl: profile.__offerUrl || location.href,
      location: profile.__offerMeta?.location || '',
      contractType: profile.__offerMeta?.contractType || '',
      experienceLevel: profile.__offerMeta?.experienceLevel || '',
      jobFamily: profile.__offerMeta?.jobFamily || '',
      publicationDate: profile.__offerMeta?.publicationDate || ''
    }).catch(() => {});
  }

  async function submitFailure(profile, error) {
    await chrome.runtime.sendMessage({
      action: 'candidature_failure',
      bankId: 'bpifrance',
      jobId: profile.__jobId || '',
      jobTitle: profile.__jobTitle || '',
      offerUrl: profile.__offerUrl || location.href,
      error: error || 'Erreur Bpifrance'
    }).catch(() => {});
  }

  async function run(profile) {
    if (!profile) return;
    activeProfile = profile;
    showBanner();
    installApplyResponseProbe();
    await dismissCookieDialog();

    const detected = blueprintApi?.detectPage ? blueprintApi.detectPage() : { key: 'unknown' };
    log(`🚀 Démarrage Bpifrance sur ${detected.key} (${location.pathname})`);

    if (detected.key === 'public_offer') {
      setSessionFlag('login_submitted', '');
      await validatePage(['public_offer'], profile, 'offre publique');
      await clickOfferApply();
      return;
    }

    if (detected.key === 'login') {
      await validatePage(['login'], profile, 'connexion');
      await fillLogin(profile);
      return;
    }

    if (detected.key === 'success') {
      await validatePage(['success'], profile, 'succès');
      setSessionFlag('success_reported', '1');
      log('🎉 Bpifrance → accusé de réception détecté');
      await submitSuccess(profile);
      return;
    }

    if (detected.key === 'my_positionings') {
      await validatePage(['my_positionings'], profile, 'mes candidatures');
      await handleMyPositioningsPage(profile);
      return;
    }

    if (detected.key === 'apply_wizard' || detected.key === 'account_exists_error') {
      await validatePage(['apply_wizard', 'account_exists_error'], profile, 'wizard candidature');
      await fillApplicationForm(profile);
      await submitApplication(profile);
      return;
    }

    log(`⏭️ Bpifrance page non gérée pour l'instant: ${detected.key}`);
  }

  globalThis.__taleosRun = function taleosRunBpifrance(profile) {
    activeProfile = profile || activeProfile;
    if (!activeProfile) return;
    runPromise = Promise.resolve(runPromise).catch(() => {}).then(() => run(activeProfile));
  };
})();
