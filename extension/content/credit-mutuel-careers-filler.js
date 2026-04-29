/**
 * Taleos - Crédit Mutuel careers filler
 * Flux réel confirmé :
 * offre publique -> RGPD -> upload CV -> formulaire final -> succès
 */
(function () {
  'use strict';

  const PENDING_KEY = 'taleos_pending_credit_mutuel';
  const TAB_ID_KEY = 'taleos_credit_mutuel_tab_id';
  const MAX_PENDING_AGE = 10 * 60 * 1000;
  const MAX_SUBMIT_RETRIES = 2;
  const MAX_NAVIGATION_RETRIES = 2;
  const SESSION_PREFIX = 'taleos_cm_';
  let currentTabIdPromise = null;

  const blueprintApi = globalThis.__TALEOS_CREDIT_MUTUEL_BLUEPRINT__ || null;

  const DIPLOMA_MAP = {
    'bac + 5 / m2 et plus': '5',
    'bac+5': '5',
    'bac + 4': '4',
    'bac + 3': '8',
    'bac + 2': '7',
    'bac': '2'
  };

  const LANGUAGE_MAP = {
    'anglais': '2',
    'allemand': '1',
    'arabe': '8',
    'chinois': '3',
    'espagnol': '4',
    'francais': '5',
    'français': '5',
    'italien': '6',
    'neerlandais': '9',
    'néerlandais': '9',
    'russe': '7',
    'portugais': '10',
    'hongrois': '11',
    'tcheque': '12',
    'tchèque': '12'
  };

  const LEVEL_MAP = {
    'langue maternelle': '4',
    'native': '4',
    'bilingue': '3',
    'courant': '3',
    'avance': '3',
    'avancé': '3',
    'intermediaire': '2',
    'intermédiaire': '2',
    'scolaire': '2',
    'debutant': '1',
    'débutant': '1',
    'notions': '1'
  };

  function reportRunLog(message) {
    try {
      chrome.runtime.sendMessage({
        action: 'extension_run_log',
        source: 'credit-mutuel-careers-filler',
        level: 'info',
        message: String(message || ''),
        ts: new Date().toISOString()
      }).catch(() => {});
    } catch (_) {}
  }

  function log(message) {
    const line = `[${new Date().toLocaleTimeString('fr-FR')}] [Taleos Crédit Mutuel] ${String(message || '')}`;
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
    if (document.getElementById('taleos-cm-banner')) return;
    const api = globalThis.__TALEOS_AUTOMATION_BANNER__;
    const banner = document.createElement('div');
    banner.id = 'taleos-cm-banner';
    banner.textContent = api ? api.getText() : '⏳ Automatisation Taleos en cours — Ne touchez à rien.';
    if (api) api.applyStyle(banner);
    document.body?.insertBefore(banner, document.body.firstChild);
  }

  async function dismissCookieDialog() {
    const overlay = document.getElementById('cookieLB');
    if (overlay) overlay.remove();

    const text = normalizeText(document.body?.innerText || '');
    if (!text.includes('ce site utilise des cookies')) return false;

    const buttons = Array.from(document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]'));
    const refuseBtn = buttons.find((el) => {
      const label = normalizeText(
        el.getAttribute?.('aria-label')
        || el.textContent
        || el.value
        || ''
      );
      return label.includes('refuser les cookies') || label === 'refuser';
    });

    if (refuseBtn) {
      log('🍪 Crédit Mutuel → fermeture du bandeau cookies');
      refuseBtn.click();
      await sleep(600);
      return true;
    }

    return false;
  }

  async function getCurrentTabId() {
    if (!currentTabIdPromise) {
      currentTabIdPromise = chrome.runtime.sendMessage({ action: 'taleos_get_current_tab_id' })
        .then((res) => res?.tabId || null)
        .catch(() => null);
    }
    return currentTabIdPromise;
  }

  async function getPending() {
    const out = await chrome.storage.local.get([PENDING_KEY, TAB_ID_KEY]);
    const pending = out[PENDING_KEY];
    const expectedTabId = out[TAB_ID_KEY] || pending?.tabId || null;
    if (!pending?.profile) {
      log('⏭️ Aucun contexte Crédit Mutuel pending trouvé');
      return null;
    }
    if (Date.now() - Number(pending.timestamp || 0) > MAX_PENDING_AGE) {
      log('⏭️ Contexte Crédit Mutuel pending expiré');
      return null;
    }
    const tabId = await getCurrentTabId();

    // Garde souple :
    // - si on connaît les 2 tabIds et qu'ils diffèrent, on n'agit pas
    // - si le tabId courant n'est pas résolu, on accepte quand même le pending
    //   car Chrome peut injecter le content script avant que l'ID ne soit
    //   récupérable de façon fiable.
    if (expectedTabId && tabId && expectedTabId !== tabId) {
      log(`⏭️ Onglet Crédit Mutuel non ciblé ignoré (tab ${tabId}, attendu ${expectedTabId})`);
      return null;
    }

    if (expectedTabId && !tabId) {
      log(`ℹ️ Tab courant non résolu, poursuite avec le contexte pending ciblé ${expectedTabId}`);
    }

    return pending;
  }

  function getSessionFlag(key) {
    try { return sessionStorage.getItem(SESSION_PREFIX + key) || ''; } catch (_) { return ''; }
  }

  function setSessionFlag(key, value) {
    try { sessionStorage.setItem(SESSION_PREFIX + key, String(value)); } catch (_) {}
  }

  function clearSessionFlags() {
    try {
      Object.keys(sessionStorage).forEach((key) => {
        if (key.startsWith(SESSION_PREFIX)) sessionStorage.removeItem(key);
      });
    } catch (_) {}
  }

  async function retryFromOffer(profile, reason) {
    const retries = Number(getSessionFlag('navigation_retry') || '0');
    if (retries >= MAX_NAVIGATION_RETRIES) {
      await submitFailure(profile, `${reason} (persistant après relance)`);
      return;
    }
    setSessionFlag('navigation_retry', String(retries + 1));
    const targetUrl = String(profile.__offerUrl || '').trim();
    log(`🔁 Crédit Mutuel → relance ${retries + 1}/${MAX_NAVIGATION_RETRIES} depuis l'offre (${reason})`);
    if (targetUrl && location.href !== targetUrl) {
      location.assign(targetUrl);
      return;
    }
    history.back();
  }

  async function validatePage(expected, profile, label) {
    if (!blueprintApi?.validateCurrentPage) return null;
    const res = await blueprintApi.validateCurrentPage(expected);
    log(`Blueprint Crédit Mutuel ${label}: ${res.ok ? 'OK' : 'KO'} (${res.detected})`);
    await blueprintApi.recordLog?.({ kind: 'page_validation', label, expected, result: res });
    if (profile && blueprintApi.validateQuestionAudit && res.detected === 'application_form') {
      const audit = await blueprintApi.validateQuestionAudit(profile, { pageKey: 'application_form' });
      log(`Audit Crédit Mutuel formulaire: ${audit.ok ? 'OK' : 'KO'} (${audit.report?.unresolvedQuestionCount || 0} à traiter)`);
    }
    return res;
  }

  function qs(selector) {
    try {
      return document.querySelector(selector);
    } catch (_) {
      return null;
    }
  }

  function setInputValue(el, value) {
    if (!el) return false;
    const str = value != null ? String(value) : '';
    el.focus();
    try {
      const desc = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value');
      if (desc?.set) desc.set.call(el, str);
      else el.value = str;
    } catch (_) {
      el.value = str;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
    return true;
  }

  function setCheckbox(checkboxEl, hiddenBoolEl) {
    if (checkboxEl) checkboxEl.checked = true;
    if (hiddenBoolEl) hiddenBoolEl.value = 'true';
    checkboxEl?.dispatchEvent(new Event('input', { bubbles: true }));
    checkboxEl?.dispatchEvent(new Event('change', { bubbles: true }));
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

  function mapDiploma(profile) {
    const raw = normalizeText(profile.education_level || '');
    for (const [needle, value] of Object.entries(DIPLOMA_MAP)) {
      if (raw.includes(needle)) return value;
    }
    return '5';
  }

  function mapOrigin(profile) {
    if (String(profile.linkedin_url || '').trim()) return '14';
    return '1';
  }

  function mapLanguages(profile) {
    const langs = Array.isArray(profile.languages) ? profile.languages : [];
    return langs
      .filter((item) => String(item?.name || '').trim())
      .slice(0, 5)
      .map((item) => ({
        id: LANGUAGE_MAP[normalizeText(item.name)] || '0',
        written: LEVEL_MAP[normalizeText(item.level)] || '1',
        oral: LEVEL_MAP[normalizeText(item.level)] || '1',
        name: item.name,
        level: item.level
      }))
      .filter((item) => item.id !== '0');
  }

  function getVisibleLanguageRows() {
    const rows = [];
    for (let i = 0; i < 5; i++) {
      const row = document.getElementById(`C:pagePrincipale.LesLangues.F1_${i}.G4:root:root`);
      if (row && !String(row.className || '').includes('ei_js_hidden')) rows.push(i);
    }
    return rows;
  }

  async function ensureVisibleLanguageRows(count) {
    let rows = getVisibleLanguageRows();
    while (rows.length < count) {
      const addBtn = document.getElementById('C:pagePrincipale.C2:link');
      if (!addBtn) break;
      addBtn.click();
      await sleep(1200);
      rows = getVisibleLanguageRows();
      log(`➕ Crédit Mutuel → lignes langues visibles: ${rows.length}`);
    }
    while (rows.length > count) {
      const rowIndex = rows[rows.length - 1];
      const removeBtn = document.getElementById(`C:pagePrincipale.LesLangues.F1_${rowIndex}.C1:link`);
      if (!removeBtn) break;
      removeBtn.click();
      await sleep(1200);
      rows = getVisibleLanguageRows();
      log(`➖ Crédit Mutuel → suppression ligne langue, reste ${rows.length}`);
    }
    return rows;
  }

  async function uploadCvStep(profile) {
    const input = document.getElementById('C:pagePrincipale.PostulerAvecMonCv2:DataEntry');
    if (!input) return;
    const ok = await setFileInputFromStorage(input, profile.cv_storage_path, profile.cv_filename || 'cv.pdf');
    if (!ok) {
      await submitFailure(profile, 'Impossible de charger le CV depuis Firebase');
      return;
    }
    log(`✅ Crédit Mutuel → CV chargé depuis Firebase (${profile.cv_filename || 'cv.pdf'})`);
    setSessionFlag('uploaded_cv', '1');
    await sleep(500);
    const uploadBtn = qs('input[name="_FID_DoUploadCv"]');
    if (uploadBtn) uploadBtn.click();
  }

  async function clickApplyLinkRobustly(applyLink) {
    const href = String(applyLink?.href || applyLink?.getAttribute?.('href') || '').trim();
    applyLink?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
    applyLink?.focus?.();
    await sleep(1200);
    const beforeHref = location.href;
    try {
      applyLink.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      applyLink.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      applyLink.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    } catch (_) {
      applyLink.click();
    }
    await sleep(1800);
    if (location.href === beforeHref && href) {
      log('↪️ Crédit Mutuel → clic sans navigation, fallback location.assign(href)');
      location.assign(new URL(href, location.href).href);
    }
  }

  async function uploadLetterIfNeeded(profile) {
    if (!profile.lm_storage_path || getSessionFlag('uploaded_letter') === '1') return false;
    const visible = normalizeText(qs('#C\\:pagePrincipale\\.Motivations')?.textContent || document.body?.textContent || '');
    const letterAlreadyVisible = String(document.getElementById('C:P5:F:14')?.value || '').toLowerCase() === 'true';
    if (letterAlreadyVisible) {
      setSessionFlag('uploaded_letter', '1');
      return false;
    }
    const input = document.getElementById('C:pagePrincipale.Motivations.IUP1:DataEntry');
    const submit = qs('input[name="_FID_AjouterLettreMotiv"]');
    if (!input || !submit || !visible.includes('joignez une lettre de motivation')) return false;
    const ok = await setFileInputFromStorage(input, profile.lm_storage_path, profile.lm_filename || 'lettre.pdf');
    if (!ok) return false;
    log(`✅ Crédit Mutuel → lettre de motivation chargée (${profile.lm_filename || 'lettre.pdf'})`);
    setSessionFlag('uploaded_letter', '1');
    await sleep(400);
    submit.click();
    return true;
  }

  async function fillApplicationForm(profile) {
    await dismissCookieDialog();

    if (String(document.getElementById('C:P5:F:0')?.value || '').toLowerCase() === 'true' && getSessionFlag('uploaded_cv') !== '1') {
      const resetHref = document.getElementById('C:pagePrincipale.C5:link')?.getAttribute('href');
      if (resetHref) {
        log('🧹 Crédit Mutuel → session avec pièces déjà présentes, reset avant reprise');
        clearSessionFlags();
        location.href = resetHref;
        return;
      }
    }

    if (await uploadLetterIfNeeded(profile)) return;

    document.getElementById('C:pagePrincipale.M:DataEntry')?.click();
    setInputValue(document.getElementById('C:pagePrincipale.i-74-1'), profile.lastname || '');
    setInputValue(document.getElementById('C:pagePrincipale.i-74-2'), profile.firstname || '');
    setInputValue(document.getElementById('C:pagePrincipale.i135'), profile.email || '');
    setInputValue(document.getElementById('C:pagePrincipale.i136'), profile.email || '');
    setInputValue(document.getElementById('C:pagePrincipale.i117'), profile['phone-number'] || profile.phone_number || '');

    const diploma = document.getElementById('C:pagePrincipale.ddl1:DataEntry');
    if (diploma) diploma.value = mapDiploma(profile);

    const origin = document.getElementById('C:pagePrincipale.originePanel.ddl2:DataEntry');
    if (origin) origin.value = mapOrigin(profile);

    const languages = mapLanguages(profile);
    const rows = await ensureVisibleLanguageRows(Math.max(1, languages.length));
    rows.forEach((rowIndex, index) => {
      const lang = languages[index];
      if (!lang) return;
      const prefix = `C:pagePrincipale.LesLangues.F1_${rowIndex}`;
      const langEl = document.getElementById(`${prefix}.i122:DataEntry`);
      const writtenEl = document.getElementById(`${prefix}.i123:DataEntry`);
      const oralEl = document.getElementById(`${prefix}.i124:DataEntry`);
      if (langEl) langEl.value = lang.id;
      if (writtenEl) writtenEl.value = lang.written;
      if (oralEl) oralEl.value = lang.oral;
      log(`🗣️ Crédit Mutuel → langue ${index + 1}: ${lang.name} (${lang.level})`);
    });

    setCheckbox(
      document.getElementById('C:pagePrincipale.cb2:DataEntry'),
      document.getElementById('C:pagePrincipale.cb2:DataEntry:cbhf')
    );

    const audit = await blueprintApi?.validateQuestionAudit?.(profile, { pageKey: 'application_form' });
    if (audit) {
      log(`Audit Crédit Mutuel formulaire après remplissage: ${audit.ok ? 'OK' : 'KO'} (${audit.report?.unresolvedQuestionCount || 0} à traiter)`);
    }

    const submitBtn = document.getElementById('C:pagePrincipale.C4:link');
    if (!submitBtn) {
      await submitFailure(profile, 'Bouton Valider la candidature introuvable');
      return;
    }
    const retries = Number(getSessionFlag('submit_retries') || '0');
    if (retries > MAX_SUBMIT_RETRIES) {
      await submitFailure(profile, 'Échec final Crédit Mutuel après plusieurs tentatives');
      return;
    }
    setSessionFlag('submit_retries', String(retries + 1));
    log(`➡️ Crédit Mutuel → clic Valider la candidature (tentative ${retries + 1}/${MAX_SUBMIT_RETRIES + 1})`);
    submitBtn.click();
  }

  async function submitSuccess(profile) {
    await chrome.runtime.sendMessage({
      action: 'candidature_success',
      bankId: 'credit_mutuel',
      successType: 'submitted',
      successMessage: "Votre candidature Crédit Mutuel a été transmise.",
      status: 'envoyée',
      jobId: profile.__jobId || '',
      jobTitle: profile.__jobTitle || '',
      companyName: profile.__companyName || 'Crédit Mutuel',
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
      bankId: 'credit_mutuel',
      jobId: profile.__jobId || '',
      jobTitle: profile.__jobTitle || '',
      offerUrl: profile.__offerUrl || location.href,
      error: error || 'Erreur Crédit Mutuel'
    }).catch(() => {});
  }

  async function run() {
    await dismissCookieDialog();
    showBanner();
    const pending = await getPending();
    if (!pending?.profile) return;
    const profile = pending.profile;
    const detected = blueprintApi?.detectPage ? blueprintApi.detectPage() : { key: 'unknown' };
    log(`🚀 Démarrage Crédit Mutuel sur ${detected.key} (${location.pathname})`);

    if (detected.key === 'public_offer') {
      clearSessionFlags();
      await validatePage(['public_offer'], profile, 'offre publique');
      const applyLink = document.getElementById('RHEC:C7:link') || qs('a[href*="postuleAvecCv=true"]');
      if (!applyLink) {
        await submitFailure(profile, 'Lien "Postuler avec mon CV" introuvable');
        return;
      }
      log('🔗 Offre Crédit Mutuel → clic sur Postuler avec mon CV');
      await clickApplyLinkRobustly(applyLink);
      return;
    }

    if (detected.key === 'navigation_error') {
      await validatePage(['navigation_error'], profile, 'erreur navigation');
      await retryFromOffer(profile, 'Erreur de navigation Crédit Mutuel');
      return;
    }

    if (detected.key === 'rgpd') {
      setSessionFlag('navigation_retry', '0');
      await validatePage(['rgpd'], profile, 'rgpd');
      setCheckbox(
        document.getElementById('C:pagePrincipale.cb1:DataEntry'),
        document.getElementById('C:pagePrincipale.cb1:DataEntry:cbhf')
      );
      log('✅ Crédit Mutuel → consentement RGPD accepté');
      document.getElementById('C:pagePrincipale.C:link')?.click();
      return;
    }

    if (detected.key === 'upload_cv') {
      setSessionFlag('navigation_retry', '0');
      await validatePage(['upload_cv'], profile, 'upload cv');
      await uploadCvStep(profile);
      return;
    }

    if (detected.key === 'application_form' || detected.key === 'technical_error') {
      setSessionFlag('navigation_retry', '0');
      await validatePage(['application_form', 'technical_error'], profile, 'formulaire');
      await fillApplicationForm(profile);
      return;
    }

    if (detected.key === 'success') {
      setSessionFlag('navigation_retry', '0');
      await validatePage(['success'], profile, 'succès');
      log('🎉 Crédit Mutuel → accusé de réception détecté');
      await submitSuccess(profile);
      return;
    }

    log(`⏭️ Crédit Mutuel page non gérée pour l'instant: ${detected.key}`);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(run, 500), { once: true });
  } else {
    setTimeout(run, 500);
  }

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    const newVal = changes[PENDING_KEY]?.newValue;
    if (!newVal) return;
    // Ne s'activer que sur l'onglet ouvert par "Candidater", pas sur les autres onglets Crédit Mutuel ouverts
    const expectedTabId = newVal.tabId ?? null;
    if (expectedTabId !== null) {
      const currentTabId = await getCurrentTabId();
      if (currentTabId !== null && Number(currentTabId) !== Number(expectedTabId)) {
        console.log(`[Taleos CM] ⏭️ onChanged ignoré (tab ${currentTabId}, attendu ${expectedTabId})`);
        return;
      }
    }
    setTimeout(run, 300);
  });
})();
