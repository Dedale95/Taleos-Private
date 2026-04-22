(function () {
  'use strict';

  if (window.__taleosBnpFillerLoaded) return;
  window.__taleosBnpFillerLoaded = true;

  const MAX_PENDING_AGE = 15 * 60 * 1000;
  const blueprintApi = globalThis.__TALEOS_BNP_BLUEPRINT__ || null;
  let currentTabIdPromise = null;

  function log(msg) {
    console.log(`[${new Date().toLocaleTimeString('fr-FR')}] [Taleos BNP] ${msg}`);
  }

  async function getCurrentTabId() {
    if (!currentTabIdPromise) {
      currentTabIdPromise = chrome.runtime.sendMessage({ action: 'taleos_get_current_tab_id' })
        .then((res) => res?.tabId || null)
        .catch(() => null);
    }
    return currentTabIdPromise;
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

  function isVisible(el) {
    if (!el) return false;
    const style = globalThis.getComputedStyle ? getComputedStyle(el) : null;
    return style?.display !== 'none' && style?.visibility !== 'hidden' && !el.hidden;
  }

  function qs(selectors, visibleOnly = false) {
    for (const selector of selectors || []) {
      try {
        const all = Array.from(document.querySelectorAll(selector));
        const found = visibleOnly ? all.find(isVisible) : all[0];
        if (found) return found;
      } catch (_) {}
    }
    return null;
  }

  async function getPendingEntry() {
    const state = await chrome.storage.local.get(['taleos_pending_bnp', 'taleos_bnp_tab_id']);
    const pending = state.taleos_pending_bnp;
    if (!pending || !pending.profile) return null;
    const expectedTabId = pending.tabId || state.taleos_bnp_tab_id || null;
    const currentTabId = await getCurrentTabId();
    if (expectedTabId && currentTabId && Number(expectedTabId) !== Number(currentTabId)) {
      log(`⏭️ Onglet BNP manuel ignoré (tab ${currentTabId}, attendu ${expectedTabId})`);
      return null;
    }
    const age = Date.now() - (pending.timestamp || 0);
    if (age > MAX_PENDING_AGE) {
      await chrome.storage.local.remove(['taleos_pending_bnp', 'taleos_bnp_tab_id']);
      log('⏭️ Pending BNP expiré → nettoyage');
      return null;
    }
    return pending;
  }

  function showBanner() {
    const api = globalThis.__TALEOS_AUTOMATION_BANNER__;
    if (api?.show) {
      api.show();
      return;
    }
    const id = 'taleos-bnp-banner';
    if (document.getElementById(id)) return;
    const el = document.createElement('div');
    el.id = id;
    el.textContent = '⏳ Automatisation Taleos BNP en cours — ne touchez à rien.';
    Object.assign(el.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      right: '0',
      zIndex: '2147483647',
      padding: '10px 18px',
      textAlign: 'center',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      color: '#fff',
      fontWeight: '700',
      fontFamily: '-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif'
    });
    document.body?.prepend(el);
  }

  function dismissCookieBanner() {
    const btn = Array.from(document.querySelectorAll('button, a')).find((el) => {
      const txt = String(el.textContent || '').trim().toLowerCase();
      return txt === 'tout accepter';
    });
    if (btn && isVisible(btn)) {
      try { btn.click(); } catch (_) {}
    }
  }

  async function validatePage(expected, profile, label) {
    if (!blueprintApi?.validateCurrentPage) return null;
    const res = await blueprintApi.validateCurrentPage(expected);
    log(`Blueprint BNP ${label || 'page'} : ${res.ok ? 'OK' : 'KO'} (${res.detected})`);
    if (profile && blueprintApi.snapshotCurrentPage) {
      await blueprintApi.snapshotCurrentPage({ profile });
    }
    return res;
  }

  async function auditQuestions(profile, pageKey, label) {
    if (!blueprintApi?.validateQuestionAudit) return null;
    const res = await blueprintApi.validateQuestionAudit(profile, { pageKey });
    log(`Audit BNP ${label || pageKey} : ${res.ok ? 'OK' : 'KO'} (${res.unresolvedQuestionCount || 0} à traiter)`);
    return res;
  }

  function dispatchTextInput(el, value) {
    if (!el) return;
    const str = String(value == null ? '' : value);
    el.focus();
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc?.set) desc.set.call(el, str);
    else el.value = str;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
  }

  function normalizePhone(profile) {
    const cc = String(profile.phone_country_code || '').trim();
    const num = String(profile.phone_number || profile['phone-number'] || '').trim().replace(/\s+/g, '');
    if (cc === '+33' && num.startsWith('0')) return num;
    if (cc === '+33' && !num.startsWith('0') && num.length === 9) return `0${num}`;
    return num || profile['phone-number'] || '';
  }

  function setFieldValue(selectors, value, label) {
    const el = qs(selectors, true) || qs(selectors, false);
    if (!el || value == null || value === '') return false;
    const target = String(value).trim();
    const current = String(el.value || '').trim();
    if (current === target) {
      log(`— ${label} déjà OK`);
      return false;
    }
    dispatchTextInput(el, target);
    log(`✅ ${label} → ${target}`);
    return true;
  }

  function setSelectValue(selectors, valueOrText, label) {
    const el = qs(selectors, true) || qs(selectors, false);
    if (!el || valueOrText == null || valueOrText === '') return false;
    const target = String(valueOrText).trim();
    if (el.tagName === 'SELECT') {
      const options = Array.from(el.options || []);
      const option = options.find((o) => o.value === target) ||
        options.find((o) => normalizeText(o.textContent) === normalizeText(target)) ||
        options.find((o) => normalizeText(o.textContent).includes(normalizeText(target)));
      if (!option) return false;
      if (String(el.value || '') === String(option.value || '')) {
        log(`— ${label} déjà OK`);
        return false;
      }
      el.value = option.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      log(`✅ ${label} → ${option.textContent.trim()}`);
      return true;
    }
    if (String(el.value || '') === target) {
      log(`— ${label} déjà OK`);
      return false;
    }
    dispatchTextInput(el, target);
    log(`✅ ${label} → ${target}`);
    return true;
  }

  async function setFileInputFromStorage(inputEl, storagePath, filename, label) {
    if (!inputEl || !storagePath) return false;
    const r = await chrome.runtime.sendMessage({ action: 'fetch_storage_file', storagePath }).catch(() => null);
    if (!r?.base64) {
      log(`⚠️ ${label} introuvable dans Firebase`);
      return false;
    }
    const bin = atob(r.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], filename || 'document.pdf', { type: r.type || 'application/pdf' });
    const dt = new DataTransfer();
    dt.items.add(file);
    inputEl.files = dt.files;
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    log(`✅ ${label} uploadé depuis Firebase (${file.name})`);
    return true;
  }

  function mapGenderValue(profile) {
    const civ = normalizeText(profile.civility || '');
    if (civ.includes('monsieur')) return '10115';
    if (civ.includes('madame')) return '10114';
    return '';
  }

  function mapDegreeValue(profile) {
    const raw = normalizeText(profile.education_level || '');
    if (raw.includes('doctorat') || raw.includes('phd')) return '8344';
    if (raw.includes('bac + 5') || raw.includes('m2') || raw.includes('master')) return '8342';
    if (raw.includes('bac + 3') || raw.includes('bac + 4') || raw.includes('licence') || raw.includes('bachelor')) return '8341';
    return '8342';
  }

  function mapStudyingValue(profile) {
    return normalizeText(profile.diploma_status || '').includes('en cours') ? '37' : '38';
  }

  function mapExperienceValue(profile) {
    const raw = normalizeText(profile.experience_level || '');
    if (raw.includes('0 - 2') || raw.includes('0-2') || raw.includes('0 - 1') || raw.includes('0-1')) return '473557';
    if (raw.includes('3 - 5') || raw.includes('3-5')) return '473558';
    if (raw.includes('5 - 7') || raw.includes('5-7') || raw.includes('6 - 10') || raw.includes('6-10') || raw.includes('11')) return '473559';
    return '473559';
  }

  function mapDataSharingValue(profile) {
    const raw = String(profile.group_data_sharing_scope || '').trim();
    if (!raw) return '4456_984636';
    const text = normalizeText(raw);
    if (text.includes('national')) return '4456_984637';
    if (text.includes('uniquement')) return '4456_984638';
    return '4456_984636';
  }

  function getGraduationDate(profile) {
    const year = String(profile.diploma_year || '').trim();
    if (!year) return '';
    return `${year}-06-30`;
  }

  async function fillApplicationForm(profile) {
    await auditQuestions(profile, 'application_form', 'formulaire');
    setFieldValue(['input[name="1449"]'], profile.firstname, 'Prénom');
    setFieldValue(['input[name="1450"]'], profile.lastname, 'Nom');
    setSelectValue(['select[name="2863"]', 'input[name="2863"]'], mapGenderValue(profile), 'Genre');
    setFieldValue(['input[name="1452"]'], profile.firstname, 'Nom / prénom de préférence');
    setFieldValue(['input[name="1453"]'], profile.email, 'Email');
    setFieldValue(['input[name="1454"]'], normalizePhone(profile), 'Téléphone');
    setSelectValue(['select[name="1457"]', 'input[name="1457"]'], '5', 'Langue préférée');

    const cvInput = qs(['input[name="file_1458"]'], true) || qs(['input[name="file_1458"]']);
    if (cvInput && profile.cv_storage_path) {
      const cvName = profile.cv_filename || 'cv.pdf';
      await setFileInputFromStorage(cvInput, profile.cv_storage_path, cvName, 'CV');
    }

    const lmInput = qs(['input[name="file_1459"]'], true) || qs(['input[name="file_1459"]']);
    if (lmInput && profile.lm_storage_path) {
      const lmName = profile.lm_filename || 'lettre.pdf';
      await setFileInputFromStorage(lmInput, profile.lm_storage_path, lmName, 'Autre fichier pertinent');
    }

    setSelectValue(['select[name="1461-1-0"]', 'select[name="1461-1-sample"]', 'input[name="1461-1-0"]'], mapDegreeValue(profile), 'Diplôme');
    setFieldValue(['input[name="1461-3-0"]', 'input[name="1461-3-sample"]'], profile.establishment, 'École / Université');
    setSelectValue(['select[name="1461-9-0"]', 'select[name="1461-9-sample"]', 'input[name="1461-9-0"]'], mapStudyingValue(profile), 'En cours d’études');
    setFieldValue(['input[name="1461-8-0"]', 'input[name="1461-8-sample"]'], getGraduationDate(profile), 'Date du diplôme');
    setSelectValue(['select[name="1462"]', 'input[name="1462"]'], mapExperienceValue(profile), 'Niveau d’expérience');

    const langLevelMap = {
      'langue maternelle': '34',
      'bilingue': '34',
      'courant': '34',
      'avance': '33',
      'avancé': '33',
      'intermediaire': '35',
      'intermédiaire': '35',
      'debutant': '36',
      'débutant': '36'
    };
    const languages = Array.isArray(profile.languages) ? profile.languages : [];
    const levelTargets = ['1467', '1469', '1471'];
    languages.slice(0, 3).forEach((lang, idx) => {
      const rawLevel = normalizeText(lang?.level || '');
      const value = langLevelMap[rawLevel];
      const name = levelTargets[idx];
      if (value && name) {
        setSelectValue([`select[name="${name}"]`, `input[name="${name}"]`], value, `Niveau langue ${idx + 1}`);
      }
    });

    setSelectValue(['select[name="1472"]', 'input[name="1472"]'], '8', 'Origine candidature');
    setSelectValue(['select[name="18289"]', 'input[name="18289"]'], '8', 'Source candidat');

    const sharingId = mapDataSharingValue(profile);
    const sharingRadio = qs([`input[id="${sharingId}"]`], true) || qs([`input[id="${sharingId}"]`]);
    if (sharingRadio && !sharingRadio.checked) {
      sharingRadio.click();
      log(`✅ Partage des données → ${sharingRadio.getAttribute('data-option-name') || sharingRadio.value}`);
    } else if (sharingRadio) {
      log('— Partage des données déjà OK');
    }

    const cgu = qs(['input[name="1474"]'], true) || qs(['input[name="1474"]']);
    if (cgu && !cgu.checked) {
      cgu.click();
      log('✅ Conditions générales acceptées');
    } else if (cgu) {
      log('— Conditions générales déjà OK');
    }

    await sleep(700);
    await auditQuestions(profile, 'application_form', 'formulaire après remplissage');
  }

  async function submitSuccess(payload) {
    try {
      await chrome.runtime.sendMessage({
        action: 'candidature_success',
        ...payload,
        bankId: 'bnp_paribas'
      });
    } catch (e) {
      log(`⚠️ Notification succès BNP impossible: ${e?.message || e}`);
    }
  }

  async function submitFailure(payload) {
    try {
      await chrome.runtime.sendMessage({
        action: 'candidature_failure',
        ...payload,
        bankId: 'bnp_paribas'
      });
    } catch (_) {}
  }

  async function handlePublicOffer() {
    const link = qs(['a[href*="bwelcome.hr.bnpparibas"]'], true) || qs(['a[href*="bwelcome.hr.bnpparibas"]']);
    if (!link) {
      log('❌ Lien BNP vers la candidature introuvable');
      return;
    }
    log('🔗 Offre publique BNP → clic sur Postuler');
    link.click();
  }

  async function handleJobDetails() {
    const link = qs(['a[href*="ApplicationMethods"]', 'a.button.button--primary'], true) || qs(['a[href*="ApplicationMethods"]']);
    if (!link) {
      log('❌ Bouton Postuler BNP introuvable sur JobDetails');
      return;
    }
    log('🔗 JobDetails BNP → clic sur Postuler');
    link.click();
  }

  async function handleApplicationMethods(profile) {
    const email = qs(['input[name="username"]'], true) || qs(['input[name="username"]']);
    const password = qs(['input[name="password"]'], true) || qs(['input[name="password"]']);
    const submit = qs(['button[name="Connexion"]', 'button[type="submit"][name="Connexion"]'], true) || qs(['button[name="Connexion"]']);
    if (!email || !password || !submit) {
      log('⏭️ Formulaire de connexion BNP non visible');
      return;
    }
    dispatchTextInput(email, profile.auth_email || profile.email || '');
    dispatchTextInput(password, profile.auth_password || '');
    log('🔐 Connexion BNP → soumission');
    submit.click();
  }

  async function handleReviewStep(pending) {
    const next = qs(['button[name="next"]'], true) || qs(['button[name="next"]']);
    if (!next) {
      log('❌ Bouton Envoyer ma candidature introuvable');
      return;
    }
    log('📨 BNP → clic sur Envoyer ma candidature');
    next.click();
    await sleep(1500);
    if (blueprintApi?.snapshotCurrentPage) {
      await blueprintApi.snapshotCurrentPage({ profile: pending.profile });
    }
  }

  async function run() {
    const pending = await getPendingEntry();
    if (!pending) return;
    showBanner();
    dismissCookieBanner();
    const profile = pending.profile;

    const detection = blueprintApi?.detectPage ? blueprintApi.detectPage() : { key: 'unknown' };
    log(`🚀 Démarrage BNP sur ${detection.key} (${location.pathname})`);

    if (detection.key === 'public_offer') {
      await validatePage(['public_offer'], profile, 'offre publique');
      await handlePublicOffer();
      return;
    }
    if (detection.key === 'job_details') {
      await validatePage(['job_details'], profile, 'job details');
      await handleJobDetails();
      return;
    }
    if (detection.key === 'application_methods') {
      await validatePage(['application_methods'], profile, 'login');
      await handleApplicationMethods(profile);
      return;
    }
    if (detection.key === 'application_form') {
      await validatePage(['application_form'], profile, 'formulaire');
      await fillApplicationForm(profile);
      const next = qs(['button[name="next"]'], true) || qs(['button[name="next"]']);
      if (next) {
        log('➡️ BNP → clic Continuer');
        next.click();
      }
      return;
    }
    if (detection.key === 'review_submit') {
      await validatePage(['review_submit'], profile, 'review');
      await handleReviewStep(pending);
      return;
    }
    if (detection.key === 'success') {
      await validatePage(['success'], profile, 'success');
      log('🎉 BNP → candidature envoyée');
      await submitSuccess({
        jobId: pending.jobId || profile.__jobId || '',
        jobTitle: pending.jobTitle || profile.__jobTitle || '',
        companyName: pending.companyName || profile.__companyName || 'BNP Paribas',
        offerUrl: pending.offerUrl || profile.__offerUrl || location.href,
        location: profile.__offerMeta?.location || '',
        contractType: profile.__offerMeta?.contractType || '',
        experienceLevel: profile.__offerMeta?.experienceLevel || '',
        jobFamily: profile.__offerMeta?.jobFamily || '',
        publicationDate: profile.__offerMeta?.publicationDate || ''
      });
      return;
    }
    if (detection.key === 'unavailable') {
      await validatePage(['unavailable'], profile, 'indisponible');
      await submitFailure({
        offerExpired: true,
        jobId: pending.jobId || profile.__jobId || '',
        jobTitle: pending.jobTitle || profile.__jobTitle || '',
        offerUrl: pending.offerUrl || profile.__offerUrl || location.href,
        error: 'Offre BNP indisponible'
      });
      return;
    }

    log(`⏭️ BNP page non gérée pour l'instant : ${detection.key}`);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(run, 700), { once: true });
  } else {
    setTimeout(run, 700);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.taleos_pending_bnp?.newValue) {
      setTimeout(run, 400);
    }
  });
})();
