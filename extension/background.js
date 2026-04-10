/**
 * Taleos Extension - Background Service Worker
 * Orchestre : ouverture onglet, récupération profil Firestore, injection du script banque
 */

/** Après 2 min, si une candidature est encore « en cours », capture + rapport (Firestore + e-mail contact@taleos.co via Cloud Function). */
const APPLY_STUCK_ALARM = 'taleos_apply_stuck_2min';
const STUCK_REPORT_CF_URL = 'https://europe-west1-project-taleos.cloudfunctions.net/report-stuck-automation';

chrome.alarms.create('taleos-keepalive', { periodInMinutes: 4 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'taleos-keepalive') { /* keep service worker warm */ }
  if (alarm.name === APPLY_STUCK_ALARM) {
    handleApplyStuckAlarm().catch((e) => console.error('[Taleos] Stuck watchdog:', e));
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  chrome.alarms.create('taleos-keepalive', { periodInMinutes: 4 });
  if (details.reason === 'update') {
    const patterns = ['https://*.taleos.co/*', 'http://localhost/*', 'http://127.0.0.1/*'];
    patterns.forEach((url) => {
      chrome.tabs.query({ url }, (tabs) => {
        tabs.forEach((tab) => { try { chrome.tabs.reload(tab.id); } catch (_) {} });
      });
    });
  }
});

(function setLastUpdate() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  chrome.storage.local.set({ taleosLastUpdate: `${dd}/${mm}/${yyyy} ${hh}:${min}` });
})();

const BANK_SCRIPT_MAP = {
  credit_agricole: 'scripts/credit_agricole.js',
  societe_generale: 'scripts/societe_generale.js',
  deloitte: 'scripts/credit_agricole.js',
  bpce: 'content/bpce-careers-filler.js'
};

const PROJECT_ID = 'project-taleos';
const GMAIL_STORAGE_KEY_PREFIX = 'taleos_gmail_auth_';
const OUTLOOK_LINK_STATE_KEY_PREFIX = 'taleos_outlook_link_state_';
const GMAIL_REQUIRED_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const OUTLOOK_OAUTH_SCOPE = 'offline_access Mail.Read User.Read openid profile email';
const OUTLOOK_CONFIG_CF_URL = 'https://europe-west1-project-taleos.cloudfunctions.net/outlookOAuthConfig';
const OUTLOOK_EXCHANGE_CF_URL = 'https://europe-west1-project-taleos.cloudfunctions.net/outlookOAuthExchange';
const OUTLOOK_FETCH_OTP_CF_URL = 'https://europe-west1-project-taleos.cloudfunctions.net/outlookFetchLatestOtp';
const OUTLOOK_UNLINK_CF_URL = 'https://europe-west1-project-taleos.cloudfunctions.net/outlookUnlinkSecure';

/** Injecté avant chaque script d'automatisation banque (bannière commune). */
const TALEOS_BANNER_SCRIPT = 'scripts/taleos-automation-banner.js';

function injectFilesWithBanner(mainFiles) {
  const arr = Array.isArray(mainFiles) ? mainFiles : [mainFiles];
  if (arr[0] === TALEOS_BANNER_SCRIPT) return arr;
  return [TALEOS_BANNER_SCRIPT, ...arr];
}

let authSyncResolve = null;
const sgLastInject = new Map();
const caLastInject = new Map();

async function scheduleApplyStuckWatchdog() {
  try {
    const { taleosUserId } = await chrome.storage.local.get(['taleosUserId']);
    if (!taleosUserId) return;
    await chrome.storage.local.remove('taleos_stuck_report_sent');
    await chrome.alarms.clear(APPLY_STUCK_ALARM);
    await chrome.alarms.create(APPLY_STUCK_ALARM, { delayInMinutes: 2 });
  } catch (e) {
    console.error('[Taleos] scheduleApplyStuckWatchdog:', e);
  }
}

async function clearApplyStuckWatchdog() {
  try {
    await chrome.alarms.clear(APPLY_STUCK_ALARM);
  } catch (_) {}
}

/**
 * Résout l’onglet de candidature et les métadonnées pour la capture (SG, CA, Deloitte, BPCE).
 */
async function resolveTabAndMetaForStuckReport() {
  const s = await chrome.storage.local.get([
    'taleos_pending_sg',
    'taleos_sg_tab_id',
    'taleos_pending_bpce',
    'taleos_bpce_tab_id',
    'taleos_pending_deloitte',
    'taleos_pending_offer',
    'taleos_ca_apply_tab_id'
  ]);
  if (s.taleos_pending_sg?.profile && s.taleos_sg_tab_id) {
    const tab = await chrome.tabs.get(s.taleos_sg_tab_id).catch(() => null);
    if (tab?.id) {
      return {
        tabId: tab.id,
        bankId: 'societe_generale',
        jobId: s.taleos_pending_sg.jobId || s.taleos_pending_sg.profile?.__jobId || '',
        offerUrl: s.taleos_pending_sg.offerUrl || s.taleos_pending_sg.profile?.__offerUrl || ''
      };
    }
    const q = await chrome.tabs.query({ url: '*://socgen.taleo.net/*' });
    if (q[0]?.id) {
      return {
        tabId: q[0].id,
        bankId: 'societe_generale',
        jobId: s.taleos_pending_sg.jobId || '',
        offerUrl: s.taleos_pending_sg.offerUrl || ''
      };
    }
  }
  if (s.taleos_pending_bpce && s.taleos_bpce_tab_id) {
    const tab = await chrome.tabs.get(s.taleos_bpce_tab_id).catch(() => null);
    if (tab?.id) {
      return {
        tabId: tab.id,
        bankId: 'bpce',
        jobId: s.taleos_pending_bpce.jobId || '',
        offerUrl: s.taleos_pending_bpce.offerUrl || ''
      };
    }
  }
  if (s.taleos_pending_deloitte?.profile) {
    const tid = s.taleos_pending_deloitte.tabId;
    if (tid) {
      const tab = await chrome.tabs.get(tid).catch(() => null);
      if (tab?.id) {
        return {
          tabId: tab.id,
          bankId: 'deloitte',
          jobId: s.taleos_pending_deloitte.jobId || '',
          offerUrl: s.taleos_pending_deloitte.offerUrl || ''
        };
      }
    }
  }
  if (s.taleos_pending_offer?.profile && s.taleos_ca_apply_tab_id) {
    const tab = await chrome.tabs.get(s.taleos_ca_apply_tab_id).catch(() => null);
    if (tab?.id) {
      return {
        tabId: tab.id,
        bankId: 'credit_agricole',
        jobId: s.taleos_pending_offer.profile?.__jobId || '',
        offerUrl: s.taleos_pending_offer.offerUrl || s.taleos_pending_offer.profile?.__offerUrl || ''
      };
    }
    const q = await chrome.tabs.query({ url: '*://groupecreditagricole.jobs/*' });
    if (q[0]?.id) {
      return {
        tabId: q[0].id,
        bankId: 'credit_agricole',
        jobId: s.taleos_pending_offer.profile?.__jobId || '',
        offerUrl: s.taleos_pending_offer.offerUrl || ''
      };
    }
  }
  return null;
}

function dataUrlToJpegBase64(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return '';
  const i = dataUrl.indexOf('base64,');
  return i >= 0 ? dataUrl.slice(i + 7) : dataUrl.replace(/^data:image\/\w+;base64,/, '');
}

async function saveStuckAutomationReportToFirestore(payload) {
  const { taleosUserId, taleosIdToken } = await chrome.storage.local.get(['taleosUserId', 'taleosIdToken']);
  if (!taleosUserId || !taleosIdToken) return;
  const docId = `stuck_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const fields = {
    userId: { stringValue: String(taleosUserId) },
    jobId: { stringValue: String(payload.jobId || '') },
    offerUrl: { stringValue: String(payload.offerUrl || '') },
    pageUrl: { stringValue: String(payload.pageUrl || '') },
    bankId: { stringValue: String(payload.bankId || '') },
    createdAt: { timestampValue: new Date().toISOString() }
  };
  const b64 = payload.screenshotBase64 || '';
  if (b64 && b64.length < 900000) {
    fields.screenshotBase64 = { stringValue: b64 };
  } else if (payload.screenshotStoragePath) {
    fields.screenshotStoragePath = { stringValue: String(payload.screenshotStoragePath) };
  }
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/stuck_automation_reports/${docId}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${taleosIdToken}` },
    body: JSON.stringify({ fields })
  });
  if (!res.ok) console.error('[Taleos] Stuck report Firestore:', await res.text());
}

async function uploadStuckScreenshotToStorage(base64Jpeg, userId, token) {
  const path = `stuck_reports/${userId}/${Date.now()}.jpg`;
  const binStr = atob(base64Jpeg);
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
  const bucket = 'project-taleos.firebasestorage.app';
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o?name=${encodeURIComponent(path)}&uploadType=media`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg' },
    body: bytes
  });
  if (!res.ok) throw new Error(`Storage ${res.status}`);
  return path;
}

async function sendStuckReportToCloudFunction(payload, idToken) {
  const body = {
    reportType: 'stuck_automation',
    userId: payload.userId,
    jobId: payload.jobId,
    offerUrl: payload.offerUrl,
    pageUrl: payload.pageUrl,
    bankId: payload.bankId,
    screenshotBase64: payload.screenshotBase64 || ''
  };
  const res = await fetch(STUCK_REPORT_CF_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
    body: JSON.stringify(body)
  });
  return res.ok;
}

async function handleApplyStuckAlarm() {
  const pending = await chrome.storage.local.get([
    'taleos_pending_sg',
    'taleos_pending_offer',
    'taleos_pending_deloitte',
    'taleos_pending_bpce'
  ]);
  const hasPending =
    !!pending.taleos_pending_sg ||
    !!pending.taleos_pending_offer ||
    !!pending.taleos_pending_deloitte ||
    !!pending.taleos_pending_bpce;
  if (!hasPending) return;

  const { taleosUserId, taleosIdToken, taleos_stuck_report_sent } = await chrome.storage.local.get([
    'taleosUserId',
    'taleosIdToken',
    'taleos_stuck_report_sent'
  ]);
  if (!taleosUserId) return;

  const meta = await resolveTabAndMetaForStuckReport();
  if (!meta?.tabId) {
    console.warn('[Taleos] Stuck watchdog : onglet candidature introuvable');
    return;
  }

  const pendingTs =
    pending.taleos_pending_sg?.timestamp ||
    pending.taleos_pending_offer?.timestamp ||
    pending.taleos_pending_deloitte?.timestamp ||
    pending.taleos_pending_bpce?.timestamp ||
    '';
  const dedupKey = `${meta.jobId || ''}|${meta.offerUrl || ''}|${pendingTs}`;
  if (taleos_stuck_report_sent === dedupKey) return;

  let pageUrl = '';
  let screenshotBase64 = '';
  let prevActiveId = null;
  try {
    const cur = await chrome.tabs.query({ active: true, currentWindow: true });
    prevActiveId = cur[0]?.id;
    await chrome.tabs.update(meta.tabId, { active: true });
    await new Promise((r) => setTimeout(r, 450));
    const tab = await chrome.tabs.get(meta.tabId);
    pageUrl = tab?.url || '';
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 52 });
    screenshotBase64 = dataUrlToJpegBase64(dataUrl);
  } catch (e) {
    console.error('[Taleos] Capture écran stuck:', e);
  } finally {
    if (prevActiveId && prevActiveId !== meta.tabId) {
      try {
        await chrome.tabs.update(prevActiveId, { active: true });
      } catch (_) {}
    }
  }

  const payload = {
    userId: taleosUserId,
    jobId: meta.jobId,
    offerUrl: meta.offerUrl,
    pageUrl,
    bankId: meta.bankId,
    screenshotBase64
  };

  try {
    if (screenshotBase64.length > 700000 && taleosIdToken) {
      const path = await uploadStuckScreenshotToStorage(screenshotBase64, taleosUserId, taleosIdToken);
      payload.screenshotStoragePath = path;
      payload.screenshotBase64 = '';
    }
    await saveStuckAutomationReportToFirestore({
      ...payload,
      screenshotBase64: payload.screenshotBase64 || undefined,
      screenshotStoragePath: payload.screenshotStoragePath
    });
  } catch (e) {
    console.error('[Taleos] Stuck Firestore/Storage:', e);
  }

  try {
    await sendStuckReportToCloudFunction(
      { ...payload, userId: taleosUserId, screenshotBase64: payload.screenshotBase64 || '' },
      taleosIdToken
    );
  } catch (e) {
    console.error('[Taleos] Stuck e-mail CF:', e);
  }

  try {
    await chrome.storage.local.set({ taleos_stuck_report_sent: dedupKey });
  } catch (_) {}
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const keys = ['taleos_pending_sg', 'taleos_pending_offer', 'taleos_pending_deloitte', 'taleos_pending_bpce'];
  for (const k of keys) {
    const ch = changes[k];
    if (ch && (ch.newValue === undefined || ch.newValue === null)) {
      clearApplyStuckWatchdog();
      if (k === 'taleos_pending_offer') {
        chrome.storage.local.remove('taleos_ca_apply_tab_id').catch(() => {});
      }
      return;
    }
  }
});

async function injectSgAutomation(tabId, profile) {
  const now = Date.now();
  if (sgLastInject.get(tabId) && now - sgLastInject.get(tabId) < 3000) {
    console.log('[Taleos SG] Injection ignorée (debounce 3s)');
    return;
  }
  sgLastInject.set(tabId, now);
  console.log('[Taleos SG] Injection dans tab', tabId);
  try {
    await new Promise(r => setTimeout(r, 1500));
    const target = { tabId, allFrames: true };
    let sessionRa = null;
    try {
      const s = await chrome.storage.session.get('taleos_remote_automation');
      sessionRa = s.taleos_remote_automation;
    } catch (_) {}
    const useRemoteSg =
      sessionRa &&
      sessionRa.scriptKey === 'societe_generale' &&
      sessionRa.remoteSource &&
      typeof sessionRa.until === 'number' &&
      Date.now() < sessionRa.until;
    if (useRemoteSg) {
      await chrome.scripting.executeScript({
        target,
        files: injectFilesWithBanner(['scripts/job-family-mapping.js', 'scripts/remote-loader.js'])
      });
      await chrome.scripting.executeScript({
        target,
        func: (payload) => {
          if (window.__taleosInjectRemote) window.__taleosInjectRemote(payload.source, payload.data);
        },
        args: [{ source: sessionRa.remoteSource, data: profile }]
      });
      console.log('[Taleos SG] OK — script distant (legacy URL)');
    } else {
      await chrome.scripting.executeScript({
        target,
        files: injectFilesWithBanner(['scripts/job-family-mapping.js', BANK_SCRIPT_MAP.societe_generale])
      });
      await chrome.scripting.executeScript({
        target,
        func: (data) => { if (window.__taleosRun) window.__taleosRun(data); },
        args: [profile]
      });
      console.log('[Taleos SG] OK — bundle local');
    }
  } catch (e) {
    console.error('[Taleos SG] Erreur injection:', e);
  }
}

/** Injection programmatique du taleos-injector (fallback si content_scripts ne s'exécute pas) */
const TALEOS_SITE_PATTERNS = [
  'taleos.co',
  'github.io',
  'localhost',
  '127.0.0.1'
];
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete') return;
  const url = (tab?.url || '');
  const urlLower = url.toLowerCase();
  const isTaleosSite = TALEOS_SITE_PATTERNS.some(p => urlLower.includes(p));
  if (isTaleosSite && (urlLower.startsWith('https://') || urlLower.startsWith('http://'))) {
    const inject = async (retry) => {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content/taleos-injector.js']
        });
      } catch (e) {
        if (retry < 2) setTimeout(() => inject(retry + 1), 800);
      }
    };
    inject(0);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete') return;
  const url = (tab?.url || '').toLowerCase();
  if (!url.includes('socgen.taleo.net')) return;
  const { taleos_pending_sg, taleos_sg_tab_id } = await chrome.storage.local.get(['taleos_pending_sg', 'taleos_sg_tab_id']);
  if (!taleos_pending_sg) return;
  if (tabId !== taleos_sg_tab_id) return;
  const age = Date.now() - (taleos_pending_sg.timestamp || 0);
  if (age > 3 * 60 * 1000) {
    chrome.storage.local.remove(['taleos_pending_sg', 'taleos_sg_tab_id']);
    return;
  }
  const { profile } = taleos_pending_sg;
  if (!profile) return;
  injectSgAutomation(tabId, profile);
});

/** Listener persistant CA candidature : injecte phase 3 après reload (fallback si handleApply listener perdu) */
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete') return;
  const url = (tab?.url || '').toLowerCase();
  if (!url.includes('groupecreditagricole.jobs')) return;
  if (!url.includes('/candidature/') && !url.includes('/application/') && !url.includes('/apply/')) return;
  const { taleos_ca_candidature_pending } = await chrome.storage.local.get('taleos_ca_candidature_pending');
  if (!taleos_ca_candidature_pending?.profile || taleos_ca_candidature_pending.tabId !== tabId) return;
  const age = Date.now() - (taleos_ca_candidature_pending.timestamp || 0);
  if (age > 2 * 60 * 1000) {
    chrome.storage.local.remove(['taleos_ca_candidature_pending', 'taleos_ca_candidature_reloaded']);
    return;
  }
  if (caLastInject.get(tabId) && Date.now() - caLastInject.get(tabId) < 8000) return;
  caLastInject.set(tabId, Date.now());
  chrome.storage.local.remove(['taleos_ca_candidature_pending', 'taleos_ca_candidature_reloaded']);
  console.log('[Taleos CA] Injection phase 3 (listener persistant candidature)');
  await new Promise(r => setTimeout(r, 6000));
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: injectFilesWithBanner([BANK_SCRIPT_MAP.credit_agricole])
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (data) => { if (window.__taleosRun) window.__taleosRun(data); },
      args: [taleos_ca_candidature_pending.profile]
    });
  } catch (e) {
    console.error('[Taleos CA] Injection phase 3:', e);
  }
});

/** Listener persistant CA : injecte sur page offre après connexion (fallback si handleApply listener perdu) */
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete') return;
  const url = (tab?.url || '').toLowerCase();
  if (!url.includes('groupecreditagricole.jobs')) return;
  if (!url.includes('/nos-offres-emploi/') && !url.includes('/our-offers/') && !url.includes('/our-offres/')) return;
  const { taleos_pending_offer } = await chrome.storage.local.get('taleos_pending_offer');
  if (!taleos_pending_offer?.profile) return;
  const age = Date.now() - (taleos_pending_offer.timestamp || 0);
  if (age > 3 * 60 * 1000) {
    chrome.storage.local.remove(['taleos_pending_offer', 'taleos_redirect_fallback']);
    return;
  }
  if (caLastInject.get(tabId) && Date.now() - caLastInject.get(tabId) < 5000) return;
  caLastInject.set(tabId, Date.now());
  const { profile } = taleos_pending_offer;
  chrome.storage.local.remove('taleos_pending_offer');
  console.log('[Taleos CA] Injection page offre (listener persistant)');
  await new Promise(r => setTimeout(r, 2000));
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: injectFilesWithBanner([BANK_SCRIPT_MAP.credit_agricole])
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (data) => { if (window.__taleosRun) window.__taleosRun(data); },
      args: [{ ...profile, __phase: 2 }]
    });
  } catch (e) {
    console.error('[Taleos CA] Injection:', e);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'ping') {
    sendResponse({ ok: true });
    return true;
  }
  if (msg.action === 'ca_offer_page_ready') {
    const tabId = sender.tab?.id;
    if (!tabId) return;
    chrome.storage.local.get('taleos_pending_offer').then(async (s) => {
      const { taleos_pending_offer } = s;
      if (!taleos_pending_offer?.profile) return;
      const age = Date.now() - (taleos_pending_offer.timestamp || 0);
      if (age > 3 * 60 * 1000) {
        chrome.storage.local.remove(['taleos_pending_offer', 'taleos_redirect_fallback']);
        return;
      }
      if (caLastInject.get(tabId) && Date.now() - caLastInject.get(tabId) < 5000) return;
      caLastInject.set(tabId, Date.now());
      const { profile } = taleos_pending_offer;
      chrome.storage.local.remove('taleos_pending_offer');
      console.log('[Taleos CA] Injection page offre (message ca_offer_page_ready)');
      await new Promise(r => setTimeout(r, 1500));
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: injectFilesWithBanner([BANK_SCRIPT_MAP.credit_agricole])
        });
        await chrome.scripting.executeScript({
          target: { tabId },
          func: (data) => { if (window.__taleosRun) window.__taleosRun(data); },
          args: [{ ...profile, __phase: 2 }]
        });
      } catch (e) {
        console.error('[Taleos CA] Injection:', e);
      }
    });
    sendResponse({ ok: true });
    return true;
  }
  if (msg.action === 'sg_page_loaded') {
    const tabId = sender.tab?.id;
    console.log('[Taleos SG] sg_page_loaded reçu, tabId:', tabId);
    if (tabId) {
      chrome.storage.local.get(['taleos_pending_sg', 'taleos_sg_tab_id']).then(({ taleos_pending_sg, taleos_sg_tab_id }) => {
        if (!taleos_pending_sg?.profile) return;
        if (tabId !== taleos_sg_tab_id) return;
        const age = Date.now() - (taleos_pending_sg.timestamp || 0);
        if (age > 3 * 60 * 1000) {
          chrome.storage.local.remove(['taleos_pending_sg', 'taleos_sg_tab_id']);
          return;
        }
        injectSgAutomation(tabId, taleos_pending_sg.profile);
      });
    }
    return;
  }
  if (msg.action === 'after_login_submit') {
      const { offerUrl, bankId, profile } = msg;
    chrome.storage.local.set({ taleos_redirect_fallback: offerUrl });
    chrome.storage.local.remove('taleos_pending_offer');
    const tabId = sender.tab?.id;
    if (tabId) {
      const scriptPath = BANK_SCRIPT_MAP[bankId] || BANK_SCRIPT_MAP.credit_agricole;
      const injectAndRun = (phase) => {
        const p = { ...profile, __phase: phase, __jobId: profile.__jobId, __jobTitle: profile.__jobTitle, __companyName: profile.__companyName, __offerUrl: offerUrl };
        chrome.scripting.executeScript({ target: { tabId }, files: injectFilesWithBanner([scriptPath]) }).then(() =>
          chrome.scripting.executeScript({
            target: { tabId },
            func: (data) => { if (window.__taleosRun) window.__taleosRun(data); },
            args: [p]
          })
        ).catch(e => console.error('[Taleos] Inject après login:', e));
      };
      let done = false;
      const handleUrl = (url) => {
        if (done) return;
        const u = (url || '').toLowerCase();
        if (u.includes('/candidature/') || u.includes('/application/') || u.includes('/apply/')) { done = true; chrome.storage.local.remove('taleos_redirect_fallback'); injectAndRun(3); return; }
        if (u.includes('/nos-offres-emploi/') || u.includes('/our-offers/') || u.includes('/our-offres/')) { done = true; chrome.storage.local.remove('taleos_redirect_fallback'); injectAndRun(2); return; }
        if (offerUrl && !done) {
          done = true;
          chrome.tabs.update(tabId, { url: offerUrl });
          chrome.tabs.onUpdated.addListener(function rel(id, inf) {
            if (id !== tabId || inf.status !== 'complete') return;
            chrome.tabs.onUpdated.removeListener(rel);
            injectAndRun(2);
          });
        }
      };
      chrome.tabs.get(tabId).then(t => {
        const url = (t?.url || '').toLowerCase();
        if (!url.includes('/connexion') && !url.includes('/login') && !url.includes('/connection')) handleUrl(t?.url || '');
      }).catch(() => {});
      const listener = async (id, info) => {
        if (id !== tabId || info.status !== 'complete') return;
        try {
          const t = await chrome.tabs.get(tabId);
          const url = (t?.url || '').toLowerCase();
          if (url.includes('/connexion') || url.includes('/login') || url.includes('/connection')) return;
          if (url.includes('admin-ajax')) {
            chrome.tabs.onUpdated.removeListener(listener);
            setTimeout(() => {
              chrome.tabs.get(tabId).then(t => {
                if (t?.url?.toLowerCase().includes('admin-ajax')) {
                  chrome.tabs.update(tabId, { url: offerUrl });
                }
              }).catch(() => {});
            }, 8000);
            return;
          }
          chrome.tabs.onUpdated.removeListener(listener);
          handleUrl(url);
        } catch (_) {}
      };
      chrome.tabs.onUpdated.addListener(listener);
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        if (!done) chrome.tabs.get(tabId).then(t => handleUrl(t?.url || '')).catch(() => {});
      }, 35000);
      setTimeout(() => {
        if (done) return;
        chrome.tabs.get(tabId).then(async (t) => {
          const url = (t?.url || '').toLowerCase();
          if (url.includes('/connexion') || url.includes('/login') || url.includes('/connection') || url.includes('admin-ajax')) {
            chrome.tabs.update(tabId, { url: offerUrl });
          }
        }).catch(() => {});
      }, 10000);
    }
    sendResponse({ ok: true });
    return true;
  }
  if (msg.action === 'inject_auth_sync') {
    const tabId = sender.tab?.id;
    if (tabId) {
      const forceRefresh = !!msg.forceRefresh;
      chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: function(doRefresh) {
          if (typeof firebase === 'undefined' || !firebase.auth) return;
          function sendToken(u, r) {
            if (!u) return;
            u.getIdToken(!!r).then(function(t) {
              window.dispatchEvent(new CustomEvent('__TALEOS_AUTH_SYNC__', {
                detail: { token: t, uid: u.uid, email: u.email || '' }
              }));
            });
          }
          var u = firebase.auth().currentUser;
          if (u) sendToken(u, doRefresh);
          else firebase.auth().onAuthStateChanged(function(user) { if (user) sendToken(user, doRefresh); });
        },
        args: [forceRefresh]
      }).catch(function() {});
    }
    sendResponse({ ok: true });
    return true;
  }
  if (msg.action === 'sync_auth_from_site') {
    const { taleosUserId, taleosIdToken, taleosUserEmail } = msg;
    if (taleosUserId && taleosIdToken) {
      chrome.storage.local.set({
        taleosUserId,
        taleosIdToken,
        taleosUserEmail: taleosUserEmail || ''
      });
      if (authSyncResolve) {
        authSyncResolve();
        authSyncResolve = null;
      }
    }
    sendResponse({ ok: true });
    return true;
  }
  if (msg.action === 'gmail_get_link_status') {
    (async () => {
      try {
        const { taleosUserId, taleosIdToken } = await chrome.storage.local.get(['taleosUserId', 'taleosIdToken']);
        if (!taleosUserId) {
          sendResponse({ ok: false, message: 'Utilisateur non connecté' });
          return;
        }
        const status = await getGmailAuthState(taleosUserId, taleosIdToken);
        sendResponse({ ok: true, ...status });
      } catch (e) {
        sendResponse({ ok: false, message: e.message || 'Erreur statut Gmail' });
      }
    })();
    return true;
  }
  if (msg.action === 'gmail_link_save_token') {
    (async () => {
      try {
        const { taleosUserId, taleosIdToken } = await chrome.storage.local.get(['taleosUserId', 'taleosIdToken']);
        if (!taleosUserId || !taleosIdToken) {
          sendResponse({ ok: false, message: 'Session Taleos manquante' });
          return;
        }
        const accessToken = String(msg.accessToken || '').trim();
        if (!accessToken) {
          sendResponse({ ok: false, message: 'Token Gmail manquant' });
          return;
        }
        const ttl = Number(msg.expiresInSec || 3600);
        const authObj = {
          access_token: accessToken,
          gmail_email: String(msg.gmailEmail || '').trim(),
          scope: GMAIL_REQUIRED_SCOPE,
          created_at: Date.now(),
          expires_at: Date.now() + Math.max(300, ttl) * 1000
        };
        await chrome.storage.local.set({ [getGmailStorageKey(taleosUserId)]: authObj });
        await saveGmailIntegrationToFirestore(taleosUserId, taleosIdToken, {
          status: 'connected',
          gmail_email: authObj.gmail_email
        });
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, message: e.message || 'Erreur liaison Gmail' });
      }
    })();
    return true;
  }
  if (msg.action === 'gmail_unlink') {
    (async () => {
      try {
        const { taleosUserId, taleosIdToken } = await chrome.storage.local.get(['taleosUserId', 'taleosIdToken']);
        if (!taleosUserId || !taleosIdToken) {
          sendResponse({ ok: false, message: 'Session Taleos manquante' });
          return;
        }
        const key = getGmailStorageKey(taleosUserId);
        const oldAuth = (await chrome.storage.local.get(key))[key] || null;
        await chrome.storage.local.remove(key);
        if (oldAuth && oldAuth.access_token) {
          fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(oldAuth.access_token)}`, { method: 'POST' }).catch(() => {});
        }
        await saveGmailIntegrationToFirestore(taleosUserId, taleosIdToken, { status: 'disconnected', gmail_email: '' });
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, message: e.message || 'Erreur déliaison Gmail' });
      }
    })();
    return true;
  }
  if (msg.action === 'outlook_get_link_status') {
    (async () => {
      try {
        const { taleosUserId, taleosIdToken } = await chrome.storage.local.get(['taleosUserId', 'taleosIdToken']);
        if (!taleosUserId || !taleosIdToken) {
          sendResponse({ ok: false, message: 'Session Taleos manquante' });
          return;
        }
        const st = await getOutlookIntegrationState(taleosUserId, taleosIdToken);
        sendResponse({ ok: true, ...st });
      } catch (e) {
        sendResponse({ ok: false, message: e.message || 'Erreur statut Outlook' });
      }
    })();
    return true;
  }
  if (msg.action === 'outlook_link') {
    (async () => {
      try {
        const { taleosUserId, taleosIdToken } = await chrome.storage.local.get(['taleosUserId', 'taleosIdToken']);
        if (!taleosUserId || !taleosIdToken) {
          sendResponse({ ok: false, message: 'Session Taleos manquante' });
          return;
        }
        const { verifier, challenge } = await buildPkce();
        const outlookClientId = await getOutlookOAuthClientId();
        const redirectUri = chrome.identity.getRedirectURL('microsoft');
        const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${encodeURIComponent(outlookClientId)}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&response_mode=query&scope=${encodeURIComponent(OUTLOOK_OAUTH_SCOPE)}&code_challenge=${encodeURIComponent(challenge)}&code_challenge_method=S256&prompt=select_account`;
        const redirected = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
        if (!redirected) throw new Error('Redirection OAuth Outlook absente');
        const u = new URL(redirected);
        const code = u.searchParams.get('code');
        if (!code) throw new Error('Code OAuth Outlook introuvable');
        await exchangeOutlookCodeWithBackend(code, verifier, redirectUri);
        await setOutlookLocalState(taleosUserId, { connected: true, outlook_email: '' });
        try {
          await saveOutlookIntegrationToFirestore(taleosUserId, taleosIdToken, { status: 'connected', outlook_email: '' });
        } catch (_) {
          // Le lien OAuth est déjà actif côté backend; on garde un état local si Firestore refuse.
        }
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, message: e.message || 'Erreur liaison Outlook' });
      }
    })();
    return true;
  }
  if (msg.action === 'outlook_unlink') {
    (async () => {
      try {
        const { taleosUserId, taleosIdToken } = await chrome.storage.local.get(['taleosUserId', 'taleosIdToken']);
        if (!taleosUserId || !taleosIdToken) {
          sendResponse({ ok: false, message: 'Session Taleos manquante' });
          return;
        }
        fetch(OUTLOOK_UNLINK_CF_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${taleosIdToken}` },
          body: JSON.stringify({})
        }).catch(() => {});
        await setOutlookLocalState(taleosUserId, { connected: false, outlook_email: '' });
        try {
          await saveOutlookIntegrationToFirestore(taleosUserId, taleosIdToken, {
            status: 'disconnected',
            outlook_email: ''
          });
        } catch (_) {
          // Non bloquant: la déliaison backend est demandée et l'état local est vidé.
        }
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, message: e.message || 'Erreur déliaison Outlook' });
      }
    })();
    return true;
  }
  if (msg.action === 'bpce_pin_code') {
    const pinCode = String(msg.pinCode || '').trim();
    if (/^\d{6}$/.test(pinCode)) {
      chrome.storage.local.set({ taleos_bpce_pin_code: pinCode });
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false, message: 'PIN invalide' });
    }
    return true;
  }
  if (msg.action === 'test_credentials') {
    testCredentials(msg.bankId).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg.action === 'test_connection') {
    runTestConnection(msg).then(sendResponse).catch(e => sendResponse({ success: false, message: e.message || 'Erreur' }));
    return true;
  }
  if (msg.action === 'taleos_check_profile_complete') {
    checkProfileCompletenessFromFirestore(msg.bankId)
      .then((res) => sendResponse(typeof res === 'object' ? res : { complete: !!res }))
      .catch(e => sendResponse({ complete: false, error: e.message, missingFields: [] }));
    return true;
  }
  if (msg.action === 'taleos_apply') {
    const taleosTabId = sender.tab?.id;
    // Tracking non bloquant du démarrage de candidature.
    trackApplyStart(msg.bankId, msg.jobTitle, msg.jobId, msg.offerUrl).catch(() => {});
    handleApply(msg.offerUrl, msg.bankId, msg.jobId, msg.jobTitle, msg.companyName, taleosTabId, msg.offerMeta || null)
      .then((result) => {
        if (result?.error) sendResponse({ error: result.error, openUrl: true });
        else {
          sendResponse({
            ok: true,
            pilotTier: result.pilotTier,
            pilotLabel: result.pilotLabel,
            routingSource: result.routingSource,
            automationSource: result.automationSource,
          });
        }
      })
      .catch(e => sendResponse({ error: e.message || 'Erreur', openUrl: true }));
    return true;
  }
  if (msg.action === 'taleos_setup_for_open_tab') {
    const careersTabId = sender.tab?.id;
    if (!careersTabId) {
      sendResponse({ error: 'Onglet introuvable' });
      return false;
    }
    const { offerUrl, bankId, jobId, jobTitle, companyName } = msg;
    chrome.storage.local.remove('taleos_apply_fallback');
    (async () => {
      try {
        const { taleosUserId, taleosIdToken } = await chrome.storage.local.get(['taleosUserId', 'taleosIdToken']);
        if (!taleosUserId) {
          sendResponse({ error: 'Utilisateur non connecté' });
          return;
        }
        const profileCheck = await checkProfileCompletenessFromFirestore(bankId || 'societe_generale');
        if (!profileCheck?.complete) {
          sendResponse({
            error: 'Profil incomplet. Complétez toutes les informations requises dans Mon profil sur Taleos avant de candidater.',
            missingFields: profileCheck?.missingFields || []
          });
          return;
        }
        const profile = await fetchProfile(taleosUserId, bankId || 'societe_generale', taleosIdToken);
        profile.__jobId = jobId;
        profile.__jobTitle = jobTitle || '';
        profile.__companyName = companyName || 'Société Générale';
        profile.__offerUrl = offerUrl;
        chrome.storage.local.remove('taleos_sg_navigate_profile_attempted');
        chrome.storage.local.set({
          taleos_pending_sg: {
            profile: { ...profile, __jobId: jobId, __jobTitle: jobTitle, __companyName: companyName, __offerUrl: offerUrl },
            offerUrl, jobId, jobTitle, companyName,
            timestamp: Date.now()
          },
          taleos_sg_tab_id: careersTabId
        });
        scheduleApplyStuckWatchdog();
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ error: e.message || 'Erreur profil' });
      }
    })();
    return true;
  }
  if (msg.action === 'candidature_success') {
    clearApplyStuckWatchdog();
    chrome.storage.local.remove(['taleos_pending_sg', 'taleos_sg_tab_id']);
    if (sender.tab?.id) sgLastInject.delete(sender.tab.id);
    const tabIdToClose = sender.tab?.id;
    trackApplySuccess(msg.bankId, msg.jobTitle, msg.jobId, msg.offerUrl).catch(() => {});
    saveCandidatureAndNotifyTaleos(msg, tabIdToClose).then(sendResponse).catch(e => sendResponse({ error: e.message }));
    return true;
  }
  if (msg.action === 'candidature_failure') {
    const { offerExpired, jobId, jobTitle, error } = msg;
    const isExpired = !!offerExpired || /404|non disponible|expirée|n'est plus en ligne/i.test(error || '');
    if (isExpired) {
      trackApplyExpired(msg.bankId, jobTitle, jobId, msg.offerUrl, error).catch(() => {});
      upsertGlobalExpiredJobSignal({
        jobId,
        jobTitle,
        offerUrl: msg.offerUrl || '',
        source: msg.bankId || ''
      }).catch(() => {});
    } else {
      trackError('apply_failure', error || 'Erreur candidature', msg.bankId, jobId, msg.offerUrl).catch(() => {});
    }
    clearApplyStuckWatchdog();
    chrome.storage.local.remove(['taleos_pending_sg', 'taleos_sg_tab_id']);
    if (sender.tab?.id) {
      sgLastInject.delete(sender.tab.id);
      if (isExpired) chrome.tabs.remove(sender.tab.id).catch(() => {});
    }
    if (isExpired && jobId) {
      notifyTaleosOfferUnavailable({ jobId, jobTitle: jobTitle || '' }).then(() => sendResponse({ ok: true })).catch(e => sendResponse({ error: e.message }));
    } else {
      notifyTaleosCandidatureFailure(msg).then(() => sendResponse({ ok: true })).catch(e => sendResponse({ error: e.message }));
    }
    return true;
  }
  if (msg.action === 'reload_and_continue') {
    reloadAndContinue(sender.tab.id, msg.offerUrl, msg.bankId, msg.profile)
      .then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }
  if (msg.action === 'fetch_storage_file') {
    fetchStorageFileAsBase64(msg.storagePath).then(sendResponse).catch(e => sendResponse({ error: e.message }));
    return true;
  }
});

async function reloadAndContinue(tabId, offerUrl, bankId, profile) {
  await chrome.tabs.update(tabId, { url: offerUrl });
  const listener = (id, info) => {
    if (id !== tabId || info.status !== 'complete') return;
    chrome.tabs.onUpdated.removeListener(listener);
    const scriptPath = BANK_SCRIPT_MAP[bankId] || BANK_SCRIPT_MAP.credit_agricole;
    chrome.scripting.executeScript({ target: { tabId }, files: injectFilesWithBanner([scriptPath]) }).then(() =>
      chrome.scripting.executeScript({
        target: { tabId },
        func: (data) => { if (window.__taleosRun) window.__taleosRun(data); },
        args: [{ ...profile, __phase: 2 }]
      })
    ).catch(e => console.error('[Taleos] Re-inject:', e));
  };
  chrome.tabs.onUpdated.addListener(listener);
}

const CA_CONNEXION_URL = 'https://groupecreditagricole.jobs/fr/connexion/';

const CONNECTION_TEST_URLS = {
  credit_agricole: 'https://groupecreditagricole.jobs/fr/connexion/',
  societe_generale: 'https://socgen.taleo.net/careersection/iam/accessmanagement/login.jsf?lang=fr-FR&redirectionURI=https%3A%2F%2Fsocgen.taleo.net%2Fcareersection%2Fsgcareers%2Fprofile.ftl%3Flang%3Dfr-FR%26src%3DCWS-1%26pcid%3Dmjlsx8hz6i4vn92z&TARGET=https%3A%2F%2Fsocgen.taleo.net%2Fcareersection%2Fsgcareers%2Fprofile.ftl%3Flang%3Dfr-FR%26src%3DCWS-1%26pcid%3Dmjlsx8hz6i4vn92z',
  deloitte: 'https://fina.wd103.myworkdayjobs.com/fr-FR/DeloitteRecrute'
};

async function saveCareerConnectionToFirestore(uid, token, bankId, bankName, email, passwordEncoded) {
  const base = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const docPath = `profiles/${uid}/career_connections/${bankId}`;
  const body = {
    fields: {
      bankName: { stringValue: bankName || '' },
      bankId: { stringValue: bankId || '' },
      email: { stringValue: email || '' },
      password: { stringValue: passwordEncoded || '' },
      status: { stringValue: 'connected' },
      timestamp: { timestampValue: new Date().toISOString() }
    }
  };
  let res = await fetch(`${base}/${docPath}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
  if (res.status === 404) {
    const parentPath = `profiles/${uid}/career_connections`;
    res = await fetch(`${base}/${parentPath}?documentId=${encodeURIComponent(bankId)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });
  }
  if (!res.ok) throw new Error(await res.text());
}

function getGmailStorageKey(uid) {
  return `${GMAIL_STORAGE_KEY_PREFIX}${uid}`;
}

function getOfferMetaUrlKey(url) {
  return String(url || '').trim().toLowerCase().replace(/#.*$/, '');
}

function getOutlookStorageKey(uid) {
  return `${OUTLOOK_LINK_STATE_KEY_PREFIX}${uid}`;
}

async function setOutlookLocalState(uid, state) {
  if (!uid) return;
  const key = getOutlookStorageKey(uid);
  await chrome.storage.local.set({
    [key]: {
      connected: !!(state && state.connected),
      outlook_email: String((state && state.outlook_email) || ''),
      updated_at: Date.now()
    }
  });
}

async function getOutlookLocalState(uid) {
  if (!uid) return { connected: false, outlook_email: '' };
  const key = getOutlookStorageKey(uid);
  const local = (await chrome.storage.local.get(key))[key] || null;
  if (!local) return { connected: false, outlook_email: '' };
  return {
    connected: !!local.connected,
    outlook_email: String(local.outlook_email || '')
  };
}

async function saveGmailIntegrationToFirestore(uid, idToken, data) {
  const base = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const docPath = `profiles/${uid}/integrations/gmail`;
  const body = {
    fields: {
      provider: { stringValue: 'gmail' },
      status: { stringValue: data.status || 'connected' },
      gmail_email: { stringValue: String(data.gmail_email || '') },
      scope: { stringValue: GMAIL_REQUIRED_SCOPE },
      linked_at: { timestampValue: new Date().toISOString() },
      updated_at: { timestampValue: new Date().toISOString() }
    }
  };
  const res = await fetch(`${base}/${docPath}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('Erreur sauvegarde intégration Gmail');
}

async function saveOutlookIntegrationToFirestore(uid, idToken, data) {
  const base = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const docPaths = [
    `profiles/${uid}/career_connections/outlook`,
    `profiles/${uid}/integrations/outlook`,
    `profiles/${uid}/mail_connections/outlook`
  ];
  const body = {
    fields: {
      bankName: { stringValue: 'Outlook' },
      bankId: { stringValue: 'outlook' },
      provider: { stringValue: 'outlook' },
      status: { stringValue: data.status || 'connected' },
      outlook_email: { stringValue: String(data.outlook_email || '') },
      email: { stringValue: String(data.outlook_email || '') },
      timestamp: { timestampValue: new Date().toISOString() },
      linked_at: { timestampValue: new Date().toISOString() },
      updated_at: { timestampValue: new Date().toISOString() }
    }
  };
  let lastStatus = 0;
  let lastText = '';
  for (const docPath of docPaths) {
    const res = await fetch(`${base}/${docPath}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify(body)
    });
    if (res.ok) return true;
    lastStatus = res.status || 0;
    lastText = await res.text().catch(() => '');
  }
  if (lastStatus === 401) {
    throw new Error('Session expirée. Déconnectez/reconnectez Taleos puis réessayez.');
  }
  if (lastStatus === 403) {
    throw new Error('Permissions Firestore insuffisantes pour enregistrer Outlook.');
  }
  throw new Error(`Erreur sauvegarde intégration Outlook (${lastStatus || 'inconnue'})${lastText ? `: ${lastText}` : ''}`);
}

async function getOutlookIntegrationState(uid, idToken) {
  const base = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const paths = [`profiles/${uid}/career_connections/outlook`, `profiles/${uid}/mail_connections/outlook`, `profiles/${uid}/integrations/outlook`];
  for (const docPath of paths) {
    const res = await fetch(`${base}/${docPath}`, { headers: { Authorization: `Bearer ${idToken}` } });
    if (!res.ok) continue;
    const data = parseFirestoreDoc(await res.json());
    return {
      connected: (data.status || '') === 'connected',
      outlook_email: data.outlook_email || data.email || ''
    };
  }
  return getOutlookLocalState(uid);
}

function b64UrlEncode(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function buildPkce() {
  const verifierArr = crypto.getRandomValues(new Uint8Array(32));
  const verifier = b64UrlEncode(verifierArr);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = b64UrlEncode(new Uint8Array(digest));
  return { verifier, challenge };
}

async function exchangeOutlookCodeWithBackend(code, verifier, redirectUri) {
  const { taleosIdToken } = await chrome.storage.local.get(['taleosIdToken']);
  if (!taleosIdToken) throw new Error('Session Taleos manquante');
  const res = await fetch(OUTLOOK_EXCHANGE_CF_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${taleosIdToken}`
    },
    body: JSON.stringify({ code, codeVerifier: verifier, redirectUri })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok !== true) throw new Error(json.error || 'Échec exchange Outlook OAuth');
  return true;
}

async function getOutlookOAuthClientId() {
  let res;
  try {
    res = await fetch(OUTLOOK_CONFIG_CF_URL, { method: 'GET' });
  } catch (e) {
    throw new Error(
      `Impossible de joindre outlookOAuthConfig (réseau ou extension). Vérifiez la connexion et que l’URL est autorisée dans le manifest. Détails : ${e?.message || e}`
    );
  }
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch (_) {
    json = {};
  }
  if (!res.ok || json.ok !== true || !json.clientId) {
    if (res.status === 404) {
      throw new Error(
        'Outlook OAuth : la Cloud Function outlookOAuthConfig est introuvable (HTTP 404). ' +
        'Déployez les fonctions sur Firebase : firebase deploy --only functions --project project-taleos ' +
        '(ou lancez le workflow GitHub « Deploy Firebase Functions »). ' +
        'Sans déploiement, l’URL europe-west1-project-taleos.cloudfunctions.net/outlookOAuthConfig ne répond pas.'
      );
    }
    const looksHtml = /<html[\s>]/i.test(text || '') || /<title>.*404/i.test(text || '');
    const serverMsg = json.error
      || (looksHtml ? 'réponse HTML inattendue (serveur)' : (text || '').slice(0, 180).trim())
      || 'réponse invalide';
    if (res.status === 500 && /OUTLOOK_CLIENT_ID/i.test(serverMsg)) {
      throw new Error(
        `${serverMsg} — À faire côté prod : Firebase Console → Functions → outlookOAuthConfig / variables d’environnement, définir OUTLOOK_CLIENT_ID (ID d’application Azure AD), puis redéployer les fonctions.`
      );
    }
    throw new Error(
      serverMsg && serverMsg !== 'réponse invalide'
        ? `Configuration Outlook OAuth : ${serverMsg} (HTTP ${res.status})`
        : `Configuration Outlook OAuth indisponible (HTTP ${res.status || '?'})`
    );
  }
  return String(json.clientId);
}

async function getGmailAuthState(uid, idToken) {
  const key = getGmailStorageKey(uid);
  const local = (await chrome.storage.local.get(key))[key] || null;
  let firestoreState = null;
  if (idToken) {
    const base = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
    const docPath = `profiles/${uid}/integrations/gmail`;
    const res = await fetch(`${base}/${docPath}`, { headers: { Authorization: `Bearer ${idToken}` } });
    if (res.ok) {
      const data = parseFirestoreDoc(await res.json());
      firestoreState = {
        status: data.status || 'connected',
        gmail_email: data.gmail_email || ''
      };
    }
  }
  const now = Date.now();
  const tokenValid = !!(local && local.access_token && local.expires_at && local.expires_at > now + 60 * 1000);
  return {
    connected: !!((firestoreState && firestoreState.status === 'connected') || tokenValid),
    tokenValid,
    gmail_email: (local && local.gmail_email) || (firestoreState && firestoreState.gmail_email) || '',
    expires_at: local && local.expires_at ? local.expires_at : null
  };
}

async function runTestConnection(msg) {
  const { bankId, email, password, firebaseUserId, taleosTabId, bankName } = msg;
  const loginUrl = CONNECTION_TEST_URLS[bankId];
  if (!loginUrl || !email || !password || !firebaseUserId) {
    return { success: false, message: 'Paramètres manquants' };
  }

  const { taleosIdToken } = await chrome.storage.local.get(['taleosIdToken']);
  if (!taleosIdToken) {
    return { success: false, message: 'Vous devez être connecté à Taleos' };
  }

  const tab = await chrome.tabs.create({ url: loginUrl, active: true });
  const tabId = tab.id;

  await chrome.storage.local.set({
    taleos_connection_test: { bankId, tabId, firebaseUserId, taleosTabId, bankName, timestamp: Date.now() }
  });

  const params = { bankId, email, password }
  const runFill = (phase) => chrome.scripting.executeScript({
    target: { tabId },
    func: (p, ph) => {
      window.__taleosConnectionTestParams = { ...p, phase: ph };
      if (typeof window.__taleosConnectionTestFill === 'function') {
        return window.__taleosConnectionTestFill();
      }
      return { done: false, error: 'Script non chargé' };
    },
    args: [params, phase || 0]
  });

  const runCheck = () => chrome.scripting.executeScript({
    target: { tabId },
    func: (bkId) => {
      window.__taleosConnectionTestParams = { bankId: bkId };
      if (typeof window.__taleosConnectionTestCheck === 'function') {
        return window.__taleosConnectionTestCheck();
      }
      return null;
    },
    args: [bankId]
  });

  const waitForLoad = () => new Promise((resolve) => {
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 15000);
  });

  try {
    await waitForLoad();
    await new Promise(r => setTimeout(r, 1500));

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['scripts/connection-test-runner.js']
    });

    if (bankId === 'deloitte') {
      const r1 = await runFill(1);
      if (r1?.[0]?.result?.needPhase2) {
        await new Promise(r => setTimeout(r, 2500));
      }
    }

    const fillRes = await runFill(bankId === 'deloitte' ? 2 : 0);
    if (fillRes?.[0]?.result?.error && !fillRes[0].result?.submitted) {
      await chrome.tabs.remove(tabId).catch(() => {});
      chrome.storage.local.remove('taleos_connection_test');
      return { success: false, message: fillRes[0].result.error };
    }

    await new Promise(r => setTimeout(r, 8000));

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['scripts/connection-test-runner.js']
      });
    } catch (_) {}

    const checkRes = await runCheck();
    const result = checkRes?.[0]?.result?.success !== undefined ? checkRes[0].result : null;

    await chrome.tabs.remove(tabId).catch(() => {});
    chrome.storage.local.remove('taleos_connection_test');

    if (result && result.success) {
      const encryptedPassword = btoa(password);
      await saveCareerConnectionToFirestore(
        firebaseUserId,
        taleosIdToken,
        bankId,
        bankName || bankId,
        email,
        encryptedPassword
      );
      return { success: true, message: result.message || 'Connexion réussie' };
    }

    return {
      success: false,
      message: (result && result.message) || 'Échec de connexion (état inconnu).'
    };
  } catch (e) {
    await chrome.tabs.remove(tabId).catch(() => {});
    chrome.storage.local.remove('taleos_connection_test');
    return { success: false, message: e.message || 'Erreur technique' };
  }
}

/** Routage local selon banque / URL d’offre */
function computeLegacyRouteAs(bankId, offerUrl) {
  const url = String(offerUrl || '').toLowerCase();
  const bid = String(bankId || '').toLowerCase();
  if (bid === 'credit_agricole' || url.includes('groupecreditagricole.jobs')) return 'ca';
  if (bid === 'deloitte' || (url.includes('myworkdayjobs.com') && url.includes('deloitte'))) return 'deloitte';
  if (bid === 'societe_generale' || url.includes('careers.societegenerale.com') || url.includes('socgen.taleo.net')) return 'sg';
  if (bid === 'bpce' || url.includes('recrutement.bpce.fr')) return 'bpce';
  return 'other';
}

/** Pilotage local uniquement : pas d’appel Cloud Function pour le plan de candidature. */
function buildLocalPilotExecution(scriptKey, scriptPath) {
  return {
    scriptKey,
    scriptPath,
    planVersion: null,
    tier: 'local_only',
    label: 'Scripts embarqués (extension)',
    detail: '',
    routingSource: 'local',
    automationSource: 'bundled',
    useRemote: false,
    remoteSource: null
  };
}

async function persistLastPilot(exec, meta) {
  const record = {
    tier: exec.tier,
    label: exec.label,
    detail: exec.detail || '',
    routingSource: exec.routingSource,
    automationSource: exec.automationSource,
    scriptKey: meta.scriptKey,
    planVersion: exec.planVersion ?? null,
    routeAs: meta.routeAs,
    bankId: meta.bankId,
    jobId: meta.jobId,
    jobTitle: (meta.jobTitle || '').slice(0, 120),
    at: Date.now(),
    offerUrlPreview: (meta.offerUrl || '').slice(0, 160)
  };
  await chrome.storage.local.set({ taleos_last_pilot: record });
  try {
    await chrome.storage.session.remove('taleos_instruction_plan');
  } catch (_) {}
  try {
    await chrome.storage.session.remove('taleos_remote_automation');
  } catch (_) {}
  console.warn('[Taleos Pilot]', exec.tier, '|', exec.label, exec.detail ? '| ' + exec.detail : '');
}

async function injectAutomationTab(tabId, profile, scriptPath, pilotExec) {
  if (pilotExec.useRemote && pilotExec.remoteSource) {
    await chrome.scripting.executeScript({ target: { tabId }, files: injectFilesWithBanner(['scripts/remote-loader.js']) });
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (payload) => {
        if (window.__taleosInjectRemote) window.__taleosInjectRemote(payload.source, payload.data);
      },
      args: [{ source: pilotExec.remoteSource, data: profile }]
    });
    return;
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: injectFilesWithBanner([scriptPath]) });
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (data) => { if (window.__taleosRun) window.__taleosRun(data); },
    args: [profile]
  });
}

async function handleApply(offerUrl, bankId, jobId, jobTitle, companyName, taleosTabId, offerMeta = null) {
  let { taleosUserId, taleosIdToken } = await chrome.storage.local.get(['taleosUserId', 'taleosIdToken']);
  if (!taleosUserId && taleosTabId) {
    try {
      await chrome.tabs.sendMessage(taleosTabId, { action: 'taleos_request_auth' });
      await new Promise((resolve) => {
        authSyncResolve = () => { authSyncResolve = null; resolve(); };
        setTimeout(() => { if (authSyncResolve) authSyncResolve(); }, 5000);
      });
      const stored = await chrome.storage.local.get(['taleosUserId', 'taleosIdToken']);
      taleosUserId = stored.taleosUserId;
      taleosIdToken = stored.taleosIdToken;
    } catch (_) {}
  }
  if (!taleosUserId) {
    console.warn('[Taleos] Utilisateur non connecté');
    try {
      await chrome.tabs.sendMessage(taleosTabId, { action: 'taleos_auth_required' });
    } catch (_) {}
    return { error: 'Utilisateur non connecté' };
  }

  const profileCheck = await checkProfileCompletenessFromFirestore(bankId);
  if (!profileCheck?.complete) {
    const missing = profileCheck?.missingFields?.length ? profileCheck.missingFields.join(', ') : 'informations manquantes';
    return { error: `Profil incomplet. Complétez toutes les informations requises dans Mon profil avant de lancer une candidature : ${missing}` };
  }

  let profile;
  try {
    profile = await fetchProfile(taleosUserId, bankId, taleosIdToken);
  } catch (e) {
    console.error('[Taleos] Profil:', e);
    return { error: e.message || 'Profil introuvable' };
  }
  profile.__jobId = jobId;
  profile.__jobTitle = jobTitle || '';
  profile.__companyName = companyName || 'Crédit Agricole';
  profile.__offerUrl = offerUrl;
  profile.__offerMeta = offerMeta || {};

  // Conserver les métadonnées d'offre pour enrichir l'enregistrement final de candidature
  if (jobId) {
    try {
      const key = String(jobId).trim();
      const urlKey = getOfferMetaUrlKey(offerUrl);
      const { taleos_offer_meta_by_job = {}, taleos_offer_meta_by_url = {} } = await chrome.storage.local.get(['taleos_offer_meta_by_job', 'taleos_offer_meta_by_url']);
      const mergedMeta = {
        ...(offerMeta || {}),
        offerUrl: offerUrl || '',
        companyName: companyName || '',
        updatedAt: Date.now()
      };
      taleos_offer_meta_by_job[key] = {
        ...(taleos_offer_meta_by_job[key] || {}),
        ...mergedMeta
      };
      if (urlKey) {
        taleos_offer_meta_by_url[urlKey] = {
          ...(taleos_offer_meta_by_url[urlKey] || {}),
          ...mergedMeta
        };
      }
      const entries = Object.entries(taleos_offer_meta_by_job).sort((a, b) => (b[1]?.updatedAt || 0) - (a[1]?.updatedAt || 0)).slice(0, 300);
      const urlEntries = Object.entries(taleos_offer_meta_by_url).sort((a, b) => (b[1]?.updatedAt || 0) - (a[1]?.updatedAt || 0)).slice(0, 500);
      await chrome.storage.local.set({
        taleos_offer_meta_by_job: Object.fromEntries(entries),
        taleos_offer_meta_by_url: Object.fromEntries(urlEntries)
      });
    } catch (_) {}
  }

  const routeAs = computeLegacyRouteAs(bankId, offerUrl);
  const scriptKey = Object.prototype.hasOwnProperty.call(BANK_SCRIPT_MAP, bankId) ? bankId : 'credit_agricole';
  const scriptPath = BANK_SCRIPT_MAP[scriptKey] || BANK_SCRIPT_MAP.credit_agricole;
  const pilotExec = buildLocalPilotExecution(scriptKey, scriptPath);
  await persistLastPilot(pilotExec, { bankId, jobId, jobTitle, routeAs, offerUrl, scriptKey });
  chrome.storage.local.set({ taleos_pending_tab: taleosTabId });

  if (routeAs === 'ca') {
    chrome.storage.local.set({
      taleos_pending_offer: {
        offerUrl,
        bankId,
        profile: { ...profile, __phase: 2, __jobId: jobId, __jobTitle: jobTitle, __companyName: companyName, __offerUrl: offerUrl },
        timestamp: Date.now()
      }
    });
    // Ouvrir la candidature dans un sous-onglet, jamais dans la page Taleos
    const caCreateOpts = { url: CA_CONNEXION_URL, active: false };
    if (taleosTabId) {
      try {
        const taleosTab = await chrome.tabs.get(taleosTabId);
        if (taleosTab?.index != null) caCreateOpts.index = taleosTab.index + 1;
      } catch (_) {}
    }
    const tab = await chrome.tabs.create(caCreateOpts);
    const tabId = tab.id;
    chrome.storage.local.set({ taleos_ca_apply_tab_id: tabId });
    scheduleApplyStuckWatchdog();
    chrome.storage.local.remove(['taleos_ca_candidature_reloaded', 'taleos_ca_candidature_pending']);
    if (taleosTabId) {
      chrome.tabs.update(taleosTabId, { active: true }).catch(() => {});
      [100, 300, 600].forEach(ms => setTimeout(() => {
        chrome.tabs.update(taleosTabId, { active: true }).catch(() => {});
      }, ms));
    }

    const injectAndRun = (phase) => {
      const ph = phase ?? 2;
      const p = { ...profile, __phase: ph };
      injectAutomationTab(tabId, p, scriptPath, pilotExec).catch(e => console.error('[Taleos] Injection:', e));
    };

    const listener = async (id, info) => {
      if (id !== tabId || info.status !== 'complete') return;
      try {
        const t = await chrome.tabs.get(tabId);
        const url = (t?.url || '').toLowerCase();
        if (url.includes('/connexion') || url.includes('/login') || url.includes('/connection')) return;
        if (url.includes('admin-ajax')) return;
        if (url.includes('/candidature-validee')) {
          chrome.tabs.onUpdated.removeListener(listener);
          chrome.storage.local.remove('taleos_pending_offer');
          await new Promise(r => setTimeout(r, 2000));
          injectAndRun(3);
          return;
        }
        if (url.includes('/candidature/') || url.includes('/application/') || url.includes('/apply/')) {
          chrome.storage.local.remove('taleos_pending_offer');
          const { taleos_ca_candidature_reloaded } = await chrome.storage.local.get('taleos_ca_candidature_reloaded');
          if (taleos_ca_candidature_reloaded !== tabId) {
            chrome.storage.local.set({
              taleos_ca_candidature_reloaded: tabId,
              taleos_ca_candidature_pending: { tabId, profile: { ...profile, __phase: 3, __jobId: jobId, __jobTitle: jobTitle, __companyName: companyName, __offerUrl: offerUrl }, timestamp: Date.now() }
            });
            chrome.tabs.reload(tabId);
            return;
          }
          chrome.storage.local.remove(['taleos_ca_candidature_reloaded', 'taleos_ca_candidature_pending']);
          if (caLastInject.get(tabId) && Date.now() - caLastInject.get(tabId) < 8000) return;
          caLastInject.set(tabId, Date.now());
          await new Promise(r => setTimeout(r, 5000));
          injectAndRun(3);
          return;
        }
        if (url.includes('/nos-offres-emploi/') || url.includes('/our-offers/') || url.includes('/our-offres/')) {
          if (caLastInject.get(tabId) && Date.now() - caLastInject.get(tabId) < 5000) return;
          caLastInject.set(tabId, Date.now());
          chrome.storage.local.remove('taleos_pending_offer');
          await new Promise(r => setTimeout(r, 2000));
          injectAndRun(2);
        }
      } catch (_) {}
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => chrome.tabs.onUpdated.removeListener(listener), 120000);
  } else if (routeAs === 'deloitte') {
    chrome.storage.local.set({ taleos_pending_tab: taleosTabId });
    const deloitteCreateOpts = { url: offerUrl, active: false };
    if (taleosTabId) {
      try {
        const taleosTab = await chrome.tabs.get(taleosTabId);
        if (taleosTab?.index != null) deloitteCreateOpts.index = taleosTab.index + 1;
      } catch (_) {}
    }
    const tab = await chrome.tabs.create(deloitteCreateOpts);
    chrome.storage.local.set({
      taleos_pending_deloitte: {
        profile: { ...profile, auth_email: profile.auth_email || profile.email, auth_password: profile.auth_password },
        tabId: tab.id,
        jobId,
        jobTitle,
        companyName,
        offerUrl,
        timestamp: Date.now()
      }
    });
    scheduleApplyStuckWatchdog();
    if (taleosTabId) {
      chrome.tabs.update(taleosTabId, { active: true }).catch(() => {});
    }
  } else if (routeAs === 'sg') {
    chrome.storage.local.set({ taleos_pending_tab: taleosTabId });
    const createOpts = { url: offerUrl, active: false };
    if (taleosTabId) {
      try {
        const taleosTab = await chrome.tabs.get(taleosTabId);
        if (taleosTab?.index != null) createOpts.index = taleosTab.index + 1;
      } catch (_) {}
    }
    const tab = await chrome.tabs.create(createOpts);
    if (taleosTabId) {
      chrome.tabs.update(taleosTabId, { active: true }).catch(() => {});
      [100, 300, 600].forEach(ms => setTimeout(() => {
        chrome.tabs.update(taleosTabId, { active: true }).catch(() => {});
      }, ms));
    }
    chrome.storage.local.remove('taleos_sg_navigate_profile_attempted');
    chrome.storage.local.set({
      taleos_pending_sg: {
        profile: { ...profile, __jobId: jobId, __jobTitle: jobTitle, __companyName: companyName, __offerUrl: offerUrl },
        offerUrl, jobId, jobTitle, companyName,
        timestamp: Date.now()
      },
      taleos_sg_tab_id: tab.id
    });
    scheduleApplyStuckWatchdog();
  } else if (routeAs === 'bpce') {
    chrome.storage.local.set({ taleos_pending_tab: taleosTabId });
    const createOpts = { url: offerUrl, active: false };
    if (taleosTabId) {
      try {
        const taleosTab = await chrome.tabs.get(taleosTabId);
        if (taleosTab?.index != null) createOpts.index = taleosTab.index + 1;
      } catch (_) {}
    }
    const tab = await chrome.tabs.create(createOpts);
    if (taleosTabId) {
      chrome.tabs.update(taleosTabId, { active: true }).catch(() => {});
      [100, 300, 600].forEach(ms => setTimeout(() => {
        chrome.tabs.update(taleosTabId, { active: true }).catch(() => {});
      }, ms));
    }
    chrome.storage.local.set({
      taleos_pending_bpce: {
        profile: { ...profile, __jobId: jobId, __jobTitle: jobTitle, __companyName: companyName || 'BPCE', __offerUrl: offerUrl },
        offerUrl, jobId, jobTitle, companyName: companyName || 'BPCE',
        tabId: tab.id,
        timestamp: Date.now()
      },
      taleos_bpce_tab_id: tab.id
    });
    scheduleApplyStuckWatchdog();
  } else {
    // Ouvrir la candidature dans un sous-onglet, jamais dans la page Taleos
    const otherCreateOpts = { url: offerUrl, active: false };
    if (taleosTabId) {
      try {
        const taleosTab = await chrome.tabs.get(taleosTabId);
        if (taleosTab?.index != null) otherCreateOpts.index = taleosTab.index + 1;
      } catch (_) {}
    }
    const tab = await chrome.tabs.create(otherCreateOpts);
    const tabId = tab.id;
    if (taleosTabId) {
      chrome.tabs.update(taleosTabId, { active: true }).catch(() => {});
    }
    const listener = async (id, info) => {
      if (id !== tabId || info.status !== 'complete') return;
      chrome.tabs.onUpdated.removeListener(listener);
      await new Promise(r => setTimeout(r, 1500));
      try {
        await injectAutomationTab(tabId, profile, scriptPath, pilotExec);
      } catch (e) {
        console.error('[Taleos] Injection:', e);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  }
  return {
    ok: true,
    pilotTier: pilotExec.tier,
    pilotLabel: pilotExec.label,
    routingSource: pilotExec.routingSource,
    automationSource: pilotExec.automationSource
  };
}

async function saveCandidatureAndNotifyTaleos(msg, tabIdToClose) {
  const { jobId, jobTitle, companyName, offerUrl } = msg;
  const { taleosUserId, taleosIdToken, taleos_pending_tab, taleos_offer_meta_by_job = {}, taleos_offer_meta_by_url = {} } = await chrome.storage.local.get(['taleosUserId', 'taleosIdToken', 'taleos_pending_tab', 'taleos_offer_meta_by_job', 'taleos_offer_meta_by_url']);
  chrome.storage.local.remove('taleos_pending_tab');
  if (!taleosUserId || !taleosIdToken) return;

  const safe = (s) => (s || '').trim().replace(/[/\\.]/g, '_').replace(/\s+/g, '_').slice(0, 150) || 'inconnu';
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  const datePart = dd + '\uFF0F' + mm + '\uFF0F' + yyyy;
  const docId = (datePart + ' \u203A ' + safe(companyName) + ' \u203A ' + safe(jobTitle) + ' \u203A ' + (jobId || 'unknown')).slice(0, 1500);

  const metaFromStore = taleos_offer_meta_by_job[String(jobId || '').trim()] || {};
  const metaFromUrl = taleos_offer_meta_by_url[getOfferMetaUrlKey(offerUrl)] || {};
  const mergedMeta = { ...metaFromUrl, ...metaFromStore };
  const location = (msg.location || mergedMeta.location || '').trim();
  const contractType = (msg.contractType || mergedMeta.contractType || '').trim();
  const experienceLevel = (msg.experienceLevel || mergedMeta.experienceLevel || '').trim();
  const jobFamily = (msg.jobFamily || mergedMeta.jobFamily || '').trim();
  const publicationDate = (msg.publicationDate || mergedMeta.publicationDate || '').trim();

  const doc = {
    jobId: String(jobId || '').trim(),
    jobTitle: (jobTitle || '').trim(),
    jobUrl: offerUrl || '',
    companyName: companyName || 'Non spécifié',
    location: location || 'Non spécifié',
    contractType: contractType || 'Non spécifié',
    experienceLevel: experienceLevel || 'Non spécifié',
    jobFamily: jobFamily || 'Non spécifié',
    publicationDate: publicationDate || 'Non spécifié',
    appliedDate: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 },
    status: 'envoyée'
  };

  const base = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const docPath = `profiles/${taleosUserId}/job_applications/${encodeURIComponent(docId)}`;
  const fields = {};
  for (const [k, v] of Object.entries(doc)) {
    if (typeof v === 'string') fields[k] = { stringValue: v };
    else if (typeof v === 'number') fields[k] = { integerValue: String(v) };
    else if (v && typeof v === 'object' && 'seconds' in v) fields[k] = { timestampValue: new Date(v.seconds * 1000).toISOString() };
  }
  const res = await fetch(`${base}/${docPath}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${taleosIdToken}`
    },
    body: JSON.stringify({ fields })
  });
  if (!res.ok) console.error('[Taleos] Firestore save:', await res.text());

  let taleosTab = taleos_pending_tab;
  if (!taleosTab) {
    const taleosTabs = await chrome.tabs.query({ url: '*://*.taleos.co/*' });
    taleosTab = taleosTabs[0]?.id;
  }
  if (!taleosTab) {
    const ghTabs = await chrome.tabs.query({ url: '*://*.github.io/*' });
    taleosTab = ghTabs[0]?.id;
  }
  if (taleosTab) {
    try {
      await chrome.tabs.sendMessage(taleosTab, { action: 'taleos_candidature_success', jobId, status: 'envoyée' });
      chrome.tabs.update(taleosTab, { active: true }).catch(() => {});
    } catch (_) {}
  }
  if (tabIdToClose) {
    setTimeout(() => {
      chrome.tabs.remove(tabIdToClose).catch(() => {});
    }, 3000);
  }
}

async function notifyTaleosCandidatureFailure(msg) {
  const { jobId, error } = msg;
  const { taleos_pending_tab } = await chrome.storage.local.get(['taleos_pending_tab']);
  let taleosTab = taleos_pending_tab;
  if (!taleosTab) {
    const taleosTabs = await chrome.tabs.query({ url: '*://*.taleos.co/*' });
    taleosTab = taleosTabs[0]?.id;
  }
  if (!taleosTab) {
    const ghTabs = await chrome.tabs.query({ url: '*://*.github.io/*' });
    taleosTab = ghTabs[0]?.id;
  }
  if (taleosTab) {
    try {
      await chrome.tabs.sendMessage(taleosTab, { action: 'taleos_candidature_failure', jobId, error: error || 'Erreur' });
    } catch (_) {}
  }
}

async function notifyTaleosOfferUnavailable(msg) {
  const { jobId, jobTitle } = msg;
  const { taleos_pending_tab } = await chrome.storage.local.get(['taleos_pending_tab']);
  let taleosTab = taleos_pending_tab;
  if (!taleosTab) {
    const taleosTabs = await chrome.tabs.query({ url: '*://*.taleos.co/*' });
    taleosTab = taleosTabs[0]?.id;
  }
  if (!taleosTab) {
    const ghTabs = await chrome.tabs.query({ url: '*://*.github.io/*' });
    taleosTab = ghTabs[0]?.id;
  }
  if (taleosTab) {
    try {
      await chrome.tabs.sendMessage(taleosTab, { action: 'taleos_offer_unavailable', jobId, jobTitle: jobTitle || '' });
    } catch (_) {}
  }
}

async function upsertGlobalExpiredJobSignal(msg) {
  const jobId = String(msg?.jobId || '').trim();
  if (!jobId) return;
  const { taleosIdToken, taleosUserId } = await chrome.storage.local.get(['taleosIdToken', 'taleosUserId']);
  if (!taleosIdToken) return;
  const nowIso = new Date().toISOString();
  const doc = {
    jobId,
    jobTitle: String(msg?.jobTitle || '').trim(),
    offerUrl: String(msg?.offerUrl || '').trim(),
    source: String(msg?.source || '').trim(),
    status: 'expired',
    detectedBy: String(taleosUserId || 'unknown'),
    lastDetectedAt: nowIso
  };
  const fields = {};
  for (const [k, v] of Object.entries(doc)) fields[k] = { stringValue: String(v || '') };
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/expired_jobs/${encodeURIComponent(jobId)}`;
  await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${taleosIdToken}`
    },
    body: JSON.stringify({ fields })
  }).catch(() => {});
}

async function testCredentials(bankId) {
  const { taleosUserId, taleosIdToken } = await chrome.storage.local.get(['taleosUserId', 'taleosIdToken']);
  if (!taleosUserId || !taleosIdToken) throw new Error('Non connecté. Connectez-vous d\'abord.');
  const profile = await fetchProfile(taleosUserId, bankId, taleosIdToken);
  return { ok: true, email: profile.auth_email || '(vide)' };
}

const PROFILE_FIELD_LABELS = {
  civility: 'Civilité',
  firstName: 'Prénom',
  lastName: 'Nom',
  phoneCountryCode: 'Indicatif pays',
  phone: 'Téléphone',
  address: 'Adresse',
  postalCode: 'Code postal',
  city: 'Ville',
  country: 'Pays',
  jobs: 'Métiers qui m\'intéressent',
  contractType: 'Type de contrat',
  availableFrom: 'Disponible à partir de',
  continents: 'Continents',
  preferredCountries: 'Pays préférés',
  experienceLevel: 'Niveau d\'expérience',
  educationLevel: 'Niveau d\'études',
  institutionType: 'Type d\'établissement',
  diplomaStatus: 'Statut du diplôme',
  deloitteWorked: 'Avez-vous déjà travaillé pour Deloitte ?',
  sg_eu_work_authorization: 'Autorisation de travail dans l’UE',
  sg_notice_period: 'Préavis de départ',
  cv: 'CV (Documents)',
  bpcePreferences: 'Préférences BPCE'
};

/** Vérifie si le profil utilisateur est complet (même logique que offres.html) */
async function checkProfileCompletenessFromFirestore(bankId) {
  const { taleosUserId, taleosIdToken } = await chrome.storage.local.get(['taleosUserId', 'taleosIdToken']);
  if (!taleosUserId || !taleosIdToken) return { complete: false, missingFields: ['Connexion'] };
  const base = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const profileRes = await fetch(`${base}/profiles/${taleosUserId}`, { headers: { Authorization: `Bearer ${taleosIdToken}` } });
  if (!profileRes.ok) return { complete: false, missingFields: ['Profil'] };
  const profile = parseFirestoreDoc(await profileRes.json());
  const isBpce = bankId === 'bpce' || (typeof bankId === 'string' && bankId.toLowerCase().includes('bpce'));
  const bpceHasContent = !!((profile.bpce_handicap || '').trim() || (profile.bpce_vivier_natixis || '').trim() || (profile.bpce_application_source || '').trim() || (profile.linkedin_url || '').trim() || profile.bpce_job_alerts);
  const required = {
    civility: profile.civility,
    firstName: profile.first_name,
    lastName: profile.last_name,
    phoneCountryCode: profile.phone_country_code,
    phone: profile.phone,
    address: profile.address,
    postalCode: profile.postal_code,
    city: profile.city,
    country: profile.country,
    jobs: profile.jobs && Array.isArray(profile.jobs) && profile.jobs.length > 0,
    contractType: profile.contract_type,
    availableFrom: profile.available_from || profile.available_from_raw,
    continents: profile.continents && Array.isArray(profile.continents) && profile.continents.length > 0,
    preferredCountries: profile.preferred_countries && Array.isArray(profile.preferred_countries) && profile.preferred_countries.length > 0,
    experienceLevel: profile.experience_level,
    educationLevel: profile.education_level,
    institutionType: profile.institution_type,
    diplomaStatus: profile.diploma_status,
    deloitteWorked: profile.deloitte_worked === 'yes' || profile.deloitte_worked === 'no',
    sg_eu_work_authorization: profile.sg_eu_work_authorization === 'yes' || profile.sg_eu_work_authorization === 'no',
    sg_notice_period: ['none', '1_month', '2_months', '3_months', 'more_than_3_months'].includes(
      String(profile.sg_notice_period || '').trim()
    ),
    cv: !!((profile.cv_storage_path || profile.cv_url || '').trim())
  };
  if (isBpce) {
    required.bpcePreferences = bpceHasContent;
  }
  const missingFields = [];
  for (const [k, v] of Object.entries(required)) {
    if (v === undefined || v === null || v === '' || v === false || (typeof v === 'string' && v.trim() === '')) {
      missingFields.push(PROFILE_FIELD_LABELS[k] || k);
    }
  }
  return { complete: missingFields.length === 0, missingFields };
}

async function fetchProfile(uid, bankId, token) {
  const base = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const headers = { Authorization: `Bearer ${token}` };

  const profileRes = await fetch(`${base}/profiles/${uid}`, { headers });
  if (!profileRes.ok) throw new Error('Profil introuvable');
  const profile = parseFirestoreDoc(await profileRes.json());

  let creds = null;
  const directRes = await fetch(`${base}/profiles/${uid}/career_connections/${bankId}`, { headers });
  if (directRes.ok) {
    creds = parseFirestoreDoc(await directRes.json());
  } else {
    const listRes = await fetch(`${base}/profiles/${uid}/career_connections`, { headers });
    if (listRes.ok) {
      const listJson = await listRes.json();
      const docs = listJson.documents || [];
      for (const d of docs) {
        const data = parseFirestoreDoc(d);
        if ((data.bankId || '').toLowerCase() === bankId.toLowerCase()) {
          creds = data;
          break;
        }
      }
    }
  }
  // BPCE : fallback sur email du profil ou taleosUserEmail si pas de career_connection
  if (bankId === 'bpce' && (!creds || !creds.email)) {
    const { taleosUserEmail } = await chrome.storage.local.get(['taleosUserEmail']);
    const fallbackEmail = (profile.email || taleosUserEmail || '').trim();
    if (fallbackEmail) creds = { email: fallbackEmail };
  }
  if (!creds || !creds.email) throw new Error(`Identifiants ${bankId} introuvables. Configurez-les sur la page Connexions.`);

  const authPassword = creds.password ? decodeBase64(creds.password) : '';

  const cvStoragePath = profile.cv_storage_path || null;
  const lmStoragePath = profile.letter_storage_path || null;
  const cvFilename = profile.cv_filename || (cvStoragePath ? cvStoragePath.split('/').pop() : null);
  const lmFilename = profile.letter_filename || (lmStoragePath ? lmStoragePath.split('/').pop() : null);

  const cType = profile.contract_type;
  const contractList = Array.isArray(cType) ? cType : (cType ? [cType] : []);
  const languages = (profile.languages || []).map(l => ({
    name: l.language || l.name || '',
    level: l.level || ''
  }));

  const phone = String(profile.phone || '').trim().replace(/\s/g, '');
  // Indicatif pays : priorité à Firebase (phone_country_code ou phoneCountryCode), pas de défaut +33 si l'utilisateur a mis +44
  let phoneCountryCode = (profile.phone_country_code || profile.phoneCountryCode || '').trim().replace(/\s/g, '');
  let phoneNumber = phone;
  if (!phoneCountryCode && phone) {
    if (phone.startsWith('+')) {
      const match = phone.match(/^(\+\d{1,4})(.*)$/);
      if (match) {
        phoneCountryCode = match[1];
        phoneNumber = (match[2] || '').replace(/\D/g, '') || phone;
      }
    } else if (phone.startsWith('0') && phone.length >= 10) {
      phoneCountryCode = '+33';
      phoneNumber = phone.slice(1).replace(/\D/g, '');
    }
  }
  if (!phoneCountryCode) phoneCountryCode = '+33';

  return {
    civility: profile.civility || '',
    firstname: profile.first_name || '',
    lastname: profile.last_name || '',
    email: profile.email || creds.email || '',
    address: profile.address || '',
    zipcode: String(profile.postal_code || ''),
    city: profile.city || '',
    country: profile.country || '',
    phone_country_code: phoneCountryCode,
    phone_number: phoneNumber || phone,
    'phone-number': profile.phone || '',
    job_families: profile.jobs || [],
    contract_types: contractList,
    available_date: profile.available_from || profile.available_from_raw || profile.availableFrom || '',
    available_from_raw: profile.available_from_raw || profile.availableFrom || '',
    continents: profile.continents || [],
    target_countries: profile.preferred_countries || [],
    target_regions: profile.regions || [],
    experience_level: profile.experience_level || '',
    education_level: profile.education_level || '',
    establishment: (profile.establishment || profile.institution_name || '').trim(),
    school_type: profile.institution_type || '',
    diploma_status: profile.diploma_status || '',
    diploma_year: String(profile.graduation_year ?? profile.graduationYear ?? ''),
    languages,
    cv_storage_path: cvStoragePath,
    lm_storage_path: lmStoragePath,
    cv_filename: cvFilename,
    lm_filename: lmFilename,
    auth_email: (creds.email || '').trim(),
    auth_password: authPassword,
    deloitte_worked: profile.deloitte_worked || 'no',
    deloitte_old_office: profile.deloitte_old_office || '',
    deloitte_old_email: profile.deloitte_old_email || '',
    deloitte_country: profile.deloitte_country || '',
    bpce_handicap: profile.bpce_handicap || '',
    bpce_vivier_natixis: profile.bpce_vivier_natixis || '',
    bpce_application_source: (profile.bpce_application_source || '').trim(),
    linkedin_url: (profile.linkedin_url || '').trim(),
    bpce_job_alerts: !!profile.bpce_job_alerts,
    sg_eu_work_authorization: profile.sg_eu_work_authorization || '',
    sg_notice_period: profile.sg_notice_period || ''
  };
}

function parseFirestoreDoc(json) {
  const fields = json.fields || {};
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v.stringValue !== undefined) out[k] = v.stringValue;
    else if (v.integerValue !== undefined) out[k] = parseInt(v.integerValue, 10);
    else if (v.booleanValue !== undefined) out[k] = v.booleanValue;
    else if (v.doubleValue !== undefined) out[k] = v.doubleValue;
    else if (v.arrayValue?.values) {
      out[k] = v.arrayValue.values.map(x => {
        if (x.mapValue?.fields) return parseFirestoreDoc({ fields: x.mapValue.fields });
        if (x.stringValue !== undefined) return x.stringValue;
        return null;
      });
    } else if (v.mapValue?.fields) out[k] = parseFirestoreDoc({ fields: v.mapValue.fields });
  }
  return out;
}

function decodeBase64(str) {
  try {
    str = String(str).trim();
    let pad = str.length % 4;
    if (pad) str += '='.repeat(4 - pad);
    return atob(str);
  } catch {
    return str;
  }
}

async function getStorageDownloadUrl(storagePath, token) {
  const url = `https://firebasestorage.googleapis.com/v0/b/project-taleos.firebasestorage.app/o/${encodeURIComponent(storagePath)}?alt=media`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    return res.url;
  } catch {
    return null;
  }
}

async function fetchStorageFileAsBase64(storagePath) {
  const { taleosIdToken } = await chrome.storage.local.get(['taleosIdToken']);
  if (!taleosIdToken) throw new Error('Non connecté');
  const url = `https://firebasestorage.googleapis.com/v0/b/project-taleos.firebasestorage.app/o/${encodeURIComponent(storagePath)}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${taleosIdToken}` } });
  if (!res.ok) throw new Error(`Storage ${res.status}`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ base64: r.result.split(',')[1], type: blob.type || 'application/pdf' });
    r.onerror = () => reject(new Error('Lecture fichier'));
    r.readAsDataURL(blob);
  });
}

/**
 * Interception automatique du code PIN BPCE/Oracle via l'API Gmail
 */
async function checkGmailForBpcePin(tabId) {
  try {
    const { taleosUserId, taleosIdToken } = await chrome.storage.local.get(['taleosUserId', 'taleosIdToken']);
    if (!taleosUserId) return;
    const key = getGmailStorageKey(taleosUserId);
    const gmailAuth = (await chrome.storage.local.get(key))[key] || null;
    const hasGmailToken = !!(gmailAuth && gmailAuth.access_token && gmailAuth.expires_at > Date.now() + 30 * 1000);
    const bearerToken = hasGmailToken ? gmailAuth.access_token : taleosIdToken;
    if (!bearerToken) return;
    if (!hasGmailToken) {
      console.warn('[Taleos BPCE] Gmail non lié ou token expiré - liaison Gmail recommandée dans Connexions.');
    }

    console.log('[Taleos BPCE] Recherche du code PIN dans Gmail...');
    
    // Requête Gmail : chercher les emails de l'expéditeur Oracle BPCE reçus récemment
    const q = encodeURIComponent('from:ekez.fa.sender@workflow.mail.em2.cloud.oracle.com "Confirmer votre identité"');
    const res = await fetch(`https://www.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=1`, {
      headers: { Authorization: `Bearer ${bearerToken}` }
    });
    
    if (!res.ok) return;
    const data = await res.json();
    
    if (data.messages && data.messages.length > 0) {
      const msgId = data.messages[0].id;
      const msgRes = await fetch(`https://www.googleapis.com/gmail/v1/users/me/messages/${msgId}`, {
        headers: { Authorization: `Bearer ${bearerToken}` }
      });
      const msgData = await msgRes.json();
      
      // Extraction du corps du message (snippet ou body)
      const snippet = msgData.snippet || '';
      const pinMatch = snippet.match(/\b(\d{6})\b/);
      
      if (pinMatch) {
        const pinCode = pinMatch[1];
        console.log('[Taleos BPCE] Code PIN intercepté :', pinCode);
        chrome.tabs.sendMessage(tabId, { action: 'bpce_pin_code', pinCode });
        // Stockage temporaire pour le content script
        chrome.storage.local.set({ taleos_bpce_pin_code: pinCode });
      }
    }
  } catch (e) {
    console.error('[Taleos BPCE] Erreur interception Gmail:', e);
  }
}

async function checkOutlookForBpcePin(tabId) {
  try {
    const { taleosIdToken } = await chrome.storage.local.get(['taleosIdToken']);
    if (!taleosIdToken) return;
    const res = await fetch(OUTLOOK_FETCH_OTP_CF_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${taleosIdToken}`
      },
      body: JSON.stringify({})
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.ok !== true) return;
    const pinCode = String(json.pinCode || '').trim();
    if (!/^\d{6}$/.test(pinCode)) return;
    chrome.tabs.sendMessage(tabId, { action: 'bpce_pin_code', pinCode });
    chrome.storage.local.set({ taleos_bpce_pin_code: pinCode });
  } catch (_) {}
}

// Surveillance des onglets pour déclencher la recherche du PIN
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete' && tab.url?.includes('oraclecloud.com') && tab.url?.includes('/apply/email')) {
    // On lance une recherche toutes les 5 secondes pendant 2 minutes max
    let attempts = 0;
    const interval = setInterval(() => {
      checkGmailForBpcePin(tabId);
      checkOutlookForBpcePin(tabId);
      if (++attempts > 24) clearInterval(interval);
    }, 5000);
  }
});


/**
 * === GA4 TRACKING VIA MEASUREMENT PROTOCOL ===
 * Version 1.1.0 : Intégration du suivi analytique pour les candidatures
 */

const GA4_CONFIG = {
  MEASUREMENT_ID: 'G-4PZJ4QXMJ0',
  API_SECRET: 'S_nZvZMxQ1Kv9w_80lWorw'
};

/** Versions manifest (MP GA4 : à déclarer en dimensions personnalisées « événement » : extension_version, extension_version_name). */
function getExtensionVersionForGa4() {
  try {
    const m = chrome.runtime.getManifest();
    const v = String(m.version || 'unknown');
    const vn = String(m.version_name || m.version || '');
    return {
      extension_version: v.length > 100 ? v.slice(0, 100) : v,
      extension_version_name: vn.length > 100 ? vn.slice(0, 100) : vn
    };
  } catch (_) {
    return { extension_version: 'unknown', extension_version_name: '' };
  }
}

async function appendGa4EventLog(entry) {
  try {
    const { taleos_ga4_event_log = [] } = await chrome.storage.local.get('taleos_ga4_event_log');
    const next = [entry, ...taleos_ga4_event_log].slice(0, 20);
    await chrome.storage.local.set({ taleos_ga4_event_log: next });
  } catch (_) {}
}

async function getTrackingUserContext() {
  try {
    const { taleosUser, taleosUserId, taleosUserEmail } = await chrome.storage.local.get([
      'taleosUser',
      'taleosUserId',
      'taleosUserEmail'
    ]);
    const uid = taleosUser?.uid || taleosUserId || 'anonymous';
    return {
      uid: String(uid || 'anonymous'),
      email: String(taleosUserEmail || '').trim().toLowerCase()
    };
  } catch (_) {
    return { uid: 'anonymous', email: '' };
  }
}

const GA4_SESSION_KEYS = { id: 'ga4_mp_session_id', at: 'ga4_mp_session_at' };
const GA4_SESSION_TTL_MS = 30 * 60 * 1000;

/** session_id GA4 MP : entier (secondes), stable ~30 min — évite des sessions fantômes par événement. */
async function getGa4SessionIdForPayload() {
  const now = Date.now();
  const sid = Math.floor(now / 1000);
  try {
    if (chrome.storage?.session) {
      const o = await chrome.storage.session.get([GA4_SESSION_KEYS.id, GA4_SESSION_KEYS.at]);
      if (o[GA4_SESSION_KEYS.id] != null && o[GA4_SESSION_KEYS.at] != null && now - o[GA4_SESSION_KEYS.at] < GA4_SESSION_TTL_MS) {
        return Number(o[GA4_SESSION_KEYS.id]);
      }
      await chrome.storage.session.set({
        [GA4_SESSION_KEYS.id]: sid,
        [GA4_SESSION_KEYS.at]: now
      });
      return sid;
    }
  } catch (_) {}
  try {
    const o = await chrome.storage.local.get([GA4_SESSION_KEYS.id, GA4_SESSION_KEYS.at]);
    if (o[GA4_SESSION_KEYS.id] != null && o[GA4_SESSION_KEYS.at] != null && now - o[GA4_SESSION_KEYS.at] < GA4_SESSION_TTL_MS) {
      return Number(o[GA4_SESSION_KEYS.id]);
    }
    await chrome.storage.local.set({
      [GA4_SESSION_KEYS.id]: sid,
      [GA4_SESSION_KEYS.at]: now
    });
    return sid;
  } catch (_) {
    return sid;
  }
}

/**
 * Envoie un événement à Google Analytics 4 via le Measurement Protocol
 * @param {string} eventName - Nom de l'événement (ex: 'apply_start', 'apply_success')
 * @param {object} params - Paramètres additionnels (ex: {site: 'bpce', job_title: 'Risk Analyst'})
 * @param {string} userId - ID utilisateur Firebase (optionnel)
 */
async function sendGA4Event(eventName, params = {}, userId = null) {
  let userUid = String(userId || 'anonymous');
  try {
    // Récupération du user_id depuis Firebase si non fourni
    if (!userId) {
      const userCtx = await getTrackingUserContext();
      userId = userCtx.uid || 'anonymous';
    }
    const userCtx = await getTrackingUserContext();
    userUid = userCtx.uid || String(userId || 'anonymous');

    const extVer = getExtensionVersionForGa4();
    const sessionIdNum = await getGa4SessionIdForPayload();

    // MP GA4 : engagement_time_msec + session_id numérique requis pour la prise en compte fiable des rapports.
    // Ne pas envoyer timestamp_micros dans params (réservé / rejets possibles côté validation).
    const payload = {
      client_id: userUid,
      user_id: userUid,
      events: [
        {
          name: eventName,
          params: {
            ...params,
            ...extVer,
            user_uid: userUid,
            engagement_time_msec: 100,
            session_id: sessionIdNum
          }
        }
      ]
    };

    const collectUrl = `https://www.google-analytics.com/mp/collect?measurement_id=${GA4_CONFIG.MEASUREMENT_ID}&api_secret=${GA4_CONFIG.API_SECRET}`;
    const debugUrl = `https://www.google-analytics.com/debug/mp/collect?measurement_id=${GA4_CONFIG.MEASUREMENT_ID}&api_secret=${GA4_CONFIG.API_SECRET}`;

    // Envoi réel + validation debug pour diagnostiquer la qualité des événements.
    const response = await fetch(collectUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    let validationMessages = [];
    try {
      const debugRes = await fetch(debugUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const debugJson = await debugRes.json().catch(() => ({}));
      validationMessages = Array.isArray(debugJson?.validationMessages) ? debugJson.validationMessages : [];
    } catch (_) {
      validationMessages = [{ description: 'Validation debug GA4 indisponible' }];
    }

    const debugValid = validationMessages.length === 0;
    const firstValidationIssue = validationMessages[0]?.description || '';

    if (response.ok) {
      console.log(`[Taleos Analytics] Événement "${eventName}" envoyé à GA4`);
      await appendGa4EventLog({
        at: Date.now(),
        name: eventName,
        ok: true,
        status: response.status,
        debug_valid: debugValid,
        debug_issue: firstValidationIssue || '',
        site: params?.site || 'unknown',
        job_id: params?.job_id || '',
        user_uid: userUid,
        extension_version: extVer.extension_version,
        error_type: params?.error_type || ''
      });
      await chrome.storage.local.set({
        taleos_ga4_last_event: {
          name: eventName,
          at: Date.now(),
          userId: userId || 'anonymous',
          user_uid: userUid,
          params: params || {},
          ok: true,
          debug_valid: debugValid,
          debug_issue: firstValidationIssue
        }
      });
    } else {
      console.warn(`[Taleos Analytics] Erreur envoi GA4:`, response.status);
      await appendGa4EventLog({
        at: Date.now(),
        name: eventName,
        ok: false,
        status: response.status,
        debug_valid: debugValid,
        debug_issue: firstValidationIssue || '',
        site: params?.site || 'unknown',
        job_id: params?.job_id || '',
        user_uid: userUid,
        extension_version: extVer.extension_version,
        error_type: params?.error_type || ''
      });
      await chrome.storage.local.set({
        taleos_ga4_last_event: {
          name: eventName,
          at: Date.now(),
          userId: userId || 'anonymous',
          user_uid: userUid,
          params: params || {},
          ok: false,
          status: response.status,
          debug_valid: debugValid,
          debug_issue: firstValidationIssue
        }
      });
    }
  } catch (e) {
    console.error('[Taleos Analytics] Erreur:', e);
    await appendGa4EventLog({
      at: Date.now(),
      name: eventName,
      ok: false,
      status: 0,
      debug_valid: false,
      debug_issue: '',
      site: params?.site || 'unknown',
      job_id: params?.job_id || '',
      user_uid: userUid,
      extension_version: getExtensionVersionForGa4().extension_version,
      error_type: params?.error_type || '',
      error: e?.message || String(e)
    });
    await chrome.storage.local.set({
      taleos_ga4_last_event: {
        name: eventName,
        at: Date.now(),
        userId: userId || 'anonymous',
        params: params || {},
        ok: false,
        error: e?.message || String(e)
      }
    });
  }
}

/**
 * Envoie un événement de candidature au démarrage
 */
function normalizeSite(site, offerUrl) {
  const raw = (site || '').toLowerCase();
  if (raw.includes('credit') || raw.includes('agricole')) return 'credit_agricole';
  if (raw.includes('societe') || raw.includes('socgen')) return 'societe_generale';
  if (raw.includes('bpce')) return 'bpce';
  if (raw.includes('deloitte')) return 'deloitte';
  const url = (offerUrl || '').toLowerCase();
  if (url.includes('groupecreditagricole.jobs')) return 'credit_agricole';
  if (url.includes('societegenerale') || url.includes('socgen.taleo.net')) return 'societe_generale';
  if (url.includes('recrutement.bpce.fr') || url.includes('oraclecloud.com')) return 'bpce';
  if (url.includes('myworkdayjobs.com') || url.includes('deloitte.com')) return 'deloitte';
  return 'unknown';
}

async function resolveTrackingContext(bankId, jobId, offerUrl) {
  const directSite = normalizeSite(bankId, offerUrl);
  if (directSite !== 'unknown') {
    return { site: directSite, offerUrl: offerUrl || '' };
  }
  try {
    const key = String(jobId || '').trim();
    if (!key) return { site: directSite, offerUrl: offerUrl || '' };
    const { taleos_offer_meta_by_job = {} } = await chrome.storage.local.get(['taleos_offer_meta_by_job']);
    const meta = taleos_offer_meta_by_job[key] || {};
    const resolvedOfferUrl = offerUrl || meta.offerUrl || '';
    return { site: normalizeSite(bankId, resolvedOfferUrl), offerUrl: resolvedOfferUrl };
  } catch (_) {
    return { site: directSite, offerUrl: offerUrl || '' };
  }
}

function getLocalDateTimeParts() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris';
  return { event_local_date: date, event_local_time: time, event_local_datetime: `${date} ${time}`, event_timezone: tz };
}

async function getOfferMetaForTracking(jobId) {
  try {
    const key = String(jobId || '').trim();
    if (!key) return {};
    const { taleos_offer_meta_by_job = {} } = await chrome.storage.local.get(['taleos_offer_meta_by_job']);
    return taleos_offer_meta_by_job[key] || {};
  } catch (_) {
    return {};
  }
}

async function trackApplyStart(site, jobTitle, jobId, offerUrl) {
  const ctx = await resolveTrackingContext(site, jobId, offerUrl);
  const meta = await getOfferMetaForTracking(jobId);
  const dt = getLocalDateTimeParts();
  await sendGA4Event('apply_start', {
    site: ctx.site,
    job_title: jobTitle || 'Unknown Position',
    job_id: jobId || 'unknown',
    offer_url: ctx.offerUrl || '',
    company_name: meta.companyName || '',
    location: meta.location || '',
    contract_type: meta.contractType || '',
    experience_level: meta.experienceLevel || '',
    job_family: meta.jobFamily || '',
    publication_date: meta.publicationDate || '',
    ...dt
  });
}

/**
 * Envoie un événement quand le code PIN est reçu
 */
async function trackPinReceived(site, offerUrl) {
  await sendGA4Event('pin_received', {
    site: normalizeSite(site, offerUrl)
  });
}

/**
 * Envoie un événement quand le formulaire est rempli
 */
async function trackFormFilled(site, jobTitle, jobId, offerUrl) {
  const ctx = await resolveTrackingContext(site, jobId, offerUrl);
  const meta = await getOfferMetaForTracking(jobId);
  const dt = getLocalDateTimeParts();
  await sendGA4Event('form_filled', {
    site: ctx.site,
    job_title: jobTitle || 'Unknown Position',
    job_id: jobId || 'unknown',
    offer_url: ctx.offerUrl || '',
    company_name: meta.companyName || '',
    location: meta.location || '',
    contract_type: meta.contractType || '',
    experience_level: meta.experienceLevel || '',
    job_family: meta.jobFamily || '',
    publication_date: meta.publicationDate || '',
    ...dt
  });
}

/**
 * Envoie un événement quand la candidature est soumise
 */
async function trackApplySuccess(site, jobTitle, jobId, offerUrl) {
  const ctx = await resolveTrackingContext(site, jobId, offerUrl);
  const meta = await getOfferMetaForTracking(jobId);
  const dt = getLocalDateTimeParts();
  await sendGA4Event('apply_success', {
    site: ctx.site,
    job_title: jobTitle || 'Unknown Position',
    job_id: jobId || 'unknown',
    offer_url: ctx.offerUrl || '',
    company_name: meta.companyName || '',
    location: meta.location || '',
    contract_type: meta.contractType || '',
    experience_level: meta.experienceLevel || '',
    job_family: meta.jobFamily || '',
    publication_date: meta.publicationDate || '',
    ...dt
  });
}

function classifyApplyError(errorMessage) {
  const raw = String(errorMessage || '');
  const msg = raw.toLowerCase();
  if (!raw.trim()) return { code: 'unknown', hint: 'Erreur non renseignée' };
  if (/404|introuvable|non disponible|n'est plus en ligne|expired|no longer online/.test(msg)) {
    return { code: 'offer_expired', hint: 'Offre expirée ou retirée' };
  }
  if (/question|mapping|mapp|non gér|non pris en charge|unsupported/.test(msg)) {
    return { code: 'unmapped_question', hint: 'Question non mappée dans le formulaire cible' };
  }
  if (/obligatoire|required|champ manquant|missing field|validation/.test(msg)) {
    return { code: 'required_field', hint: 'Champ obligatoire non complété ou validation échouée' };
  }
  if (/login|connexion|mot de passe|password|auth/.test(msg)) {
    return { code: 'auth', hint: 'Échec d’authentification sur le site carrière' };
  }
  if (/timeout|timed out|délai|attente/.test(msg)) {
    return { code: 'timeout', hint: 'Timeout pendant le parcours automatisé' };
  }
  if (/captcha|robot|verification/.test(msg)) {
    return { code: 'anti_bot', hint: 'Blocage anti-bot/captcha détecté' };
  }
  if (/network|fetch|net::|cors/.test(msg)) {
    return { code: 'network', hint: 'Erreur réseau/API pendant l’automatisation' };
  }
  return { code: 'other', hint: 'Erreur non catégorisée' };
}

async function trackApplyExpired(site, jobTitle, jobId, offerUrl, errorMessage) {
  const ctx = await resolveTrackingContext(site, jobId, offerUrl);
  const meta = await getOfferMetaForTracking(jobId);
  const dt = getLocalDateTimeParts();
  await sendGA4Event('apply_expired', {
    site: ctx.site,
    job_title: jobTitle || 'Unknown Position',
    job_id: jobId || 'unknown',
    offer_url: ctx.offerUrl || '',
    reason: String(errorMessage || 'Offre expirée').slice(0, 300),
    company_name: meta.companyName || '',
    location: meta.location || '',
    contract_type: meta.contractType || '',
    experience_level: meta.experienceLevel || '',
    job_family: meta.jobFamily || '',
    publication_date: meta.publicationDate || '',
    ...dt
  });
}

/**
 * Envoie un événement d'erreur
 */
async function trackError(errorType, errorMessage, site, jobId, offerUrl) {
  const ctx = await resolveTrackingContext(site, jobId, offerUrl);
  const meta = await getOfferMetaForTracking(jobId);
  const dt = getLocalDateTimeParts();
  const classified = classifyApplyError(errorMessage);
  await sendGA4Event('apply_error', {
    error_type: errorType || classified.code || 'unknown',
    error_code: classified.code || 'unknown',
    error_hint: classified.hint || 'Erreur inconnue',
    error_message: String(errorMessage || 'Unknown error').slice(0, 300),
    site: ctx.site,
    job_id: jobId || 'unknown',
    offer_url: ctx.offerUrl || '',
    company_name: meta.companyName || '',
    location: meta.location || '',
    contract_type: meta.contractType || '',
    experience_level: meta.experienceLevel || '',
    job_family: meta.jobFamily || '',
    publication_date: meta.publicationDate || '',
    ...dt
  });
}

// Exposition des fonctions GA4 pour les content scripts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'track_event') {
    sendGA4Event(msg.eventName, msg.params, msg.userId).then(() => {
      sendResponse({ ok: true });
    }).catch(e => {
      console.error('[Taleos Analytics] Erreur tracking:', e);
      sendResponse({ ok: false, error: e.message });
    });
    return true; // Indique que la réponse sera asynchrone
  }
});
