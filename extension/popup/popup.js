/**
 * Taleos Extension - Popup
 * Authentification Firebase (mêmes identifiants que le site web)
 */

const firebaseConfig = {
  apiKey: "AIzaSyAGeNfIevsaNjfbKTYWMaURhJWdfzWMjmc",
  authDomain: "project-taleos.firebaseapp.com",
  projectId: "project-taleos",
  storageBucket: "project-taleos.firebasestorage.app",
  messagingSenderId: "974062127016",
  appId: "1:974062127016:web:b6cffae44f1bae56f03f9d",
  measurementId: "G-4PZJ4QXMJ0"
};

const loadingView = document.getElementById('loading-view');
const loginView = document.getElementById('login-view');
const loggedView = document.getElementById('logged-view');
const loginForm = document.getElementById('login-form');
let pendingLoginTimeout = null;
const loginError = document.getElementById('login-error');
const loginLoading = document.getElementById('login-loading');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const passwordInput = document.getElementById('password');
const passwordToggleBtn = document.getElementById('password-toggle-btn');
const CA_BLUEPRINT_LAST_CHECK_KEY = 'taleos_ca_blueprint_last_check';
const CA_BLUEPRINT_LOG_KEY = 'taleos_ca_blueprint_log';

/** Si l’init reste bloquée sur « Vérification de la connexion… », on débloque après ce délai. */
let loadingWatchdog = null;

function setupPasswordToggle() {
  if (!passwordInput || !passwordToggleBtn) return;
  passwordToggleBtn.addEventListener('click', () => {
    const visible = passwordInput.type === 'text';
    passwordInput.type = visible ? 'password' : 'text';
    passwordToggleBtn.classList.toggle('is-visible', !visible);
    passwordToggleBtn.setAttribute('aria-label', visible ? 'Afficher le mot de passe' : 'Masquer le mot de passe');
  });
}

function showLogin() {
  if (loadingWatchdog) {
    clearTimeout(loadingWatchdog);
    loadingWatchdog = null;
  }
  if (pendingLoginTimeout) {
    clearTimeout(pendingLoginTimeout);
    pendingLoginTimeout = null;
  }
  if (loadingView) loadingView.classList.add('hidden');
  if (loginView) loginView.classList.remove('hidden');
  if (loggedView) loggedView.classList.add('hidden');
}

function showLogged(user) {
  if (loadingWatchdog) {
    clearTimeout(loadingWatchdog);
    loadingWatchdog = null;
  }
  if (pendingLoginTimeout) {
    clearTimeout(pendingLoginTimeout);
    pendingLoginTimeout = null;
  }
  if (loadingView) loadingView.classList.add('hidden');
  if (loginView) loginView.classList.add('hidden');
  if (loggedView) loggedView.classList.remove('hidden');
  const emailEl = document.getElementById('user-email');
  const initialEl = document.getElementById('user-initial');
  if (emailEl) emailEl.textContent = user.email || '';
  if (initialEl) initialEl.textContent = (user.email || user.displayName || '?')[0].toUpperCase();
}

function showError(msg) {
  if (loginError) {
    loginError.textContent = msg || '';
    loginError.classList.toggle('hidden', !msg);
  }
  if (loginLoading) loginLoading.classList.add('hidden');
  if (loginBtn) {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Se connecter';
  }
}

function setLoading(loading) {
  if (loginLoading) loginLoading.classList.toggle('hidden', !loading);
  if (loginError) loginError.classList.add('hidden');
  if (loginBtn) {
    loginBtn.disabled = loading;
    loginBtn.textContent = loading ? 'Connexion...' : 'Se connecter';
  }
}

async function setVersion() {
  try {
    const manifest = chrome?.runtime?.getManifest?.() || {};
    const v = manifest.version || '?';
    const versionName = manifest.version_name || '';
    const versionLabel = versionName ? `v${v} (${versionName})` : `v${v}`;
    const badge = document.getElementById('version-badge');
    const badgeLogged = document.getElementById('version-badge-logged');
    const dateEl = document.getElementById('version-date');
    const reloadLoginEl = document.getElementById('version-reload-login');
    if (badge) badge.textContent = versionLabel;
    if (badgeLogged) badgeLogged.textContent = `Version ${versionLabel.replace(/^v/, '')}`;
    const { taleosLastUpdate, taleosLastPopupReload } = await chrome.storage.local.get([
      'taleosLastUpdate',
      'taleosLastPopupReload'
    ]);
    if (dateEl) {
      let line = taleosLastUpdate ? `Mise à jour : ${taleosLastUpdate}` : '';
      if (taleosLastPopupReload?.at && taleosLastPopupReload?.label) {
        line = line ? `${line} · ` : '';
        line += `Bouton « Mettre à jour » : ${taleosLastPopupReload.at} (${taleosLastPopupReload.label})`;
      }
      dateEl.textContent = line;
    }
    if (reloadLoginEl) {
      reloadLoginEl.textContent =
        taleosLastPopupReload?.at && taleosLastPopupReload?.label
          ? `Dernier rechargement : ${taleosLastPopupReload.at} — ${taleosLastPopupReload.label}`
          : '';
    }
  } catch (_) {}
}

function setupLogout() {
  logoutBtn?.addEventListener('click', () => {
    chrome.storage.local.remove(['taleosUserId', 'taleosIdToken', 'taleosUserEmail']);
    if (typeof firebase !== 'undefined' && firebase.auth) {
      firebase.auth().signOut();
    }
    showLogin();
  });
}

async function runDiagnostic() {
  const statusEl = document.getElementById('diagnostic-status');
  if (!statusEl) return;
  statusEl.textContent = 'Test en cours...';
  statusEl.style.color = '#6b7280';
  try {
    const t0 = Date.now();
    await chrome.runtime.sendMessage({ action: 'ping' });
    const ms = Date.now() - t0;
    statusEl.textContent = `✅ Connexion OK (${ms} ms)`;
    statusEl.style.color = '#059669';
  } catch (e) {
    const msg = (e?.message || String(e)).toLowerCase();
    const invalidated = /context invalidated|receiving end does not exist/i.test(msg);
    statusEl.textContent = invalidated
      ? '❌ Extension déconnectée — Rafraîchissez les pages Taleos'
      : `❌ Erreur : ${(e?.message || String(e)).slice(0, 50)}`;
    statusEl.style.color = '#dc2626';
  }
}

function formatLastEventTime(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleTimeString('fr-FR');
  } catch (_) {
    return '';
  }
}

function toFrenchAnalyticsLabel(eventName) {
  const key = String(eventName || '').toLowerCase();
  if (key === 'apply_start') return 'Démarrage de candidature';
  if (key === 'apply_success') return 'Candidature envoyée';
  if (key === 'apply_error') return 'Erreur de candidature';
  if (key === 'apply_expired') return 'Offre expirée';
  if (key === 'pin_received') return 'Code PIN reçu';
  if (key === 'form_filled') return 'Formulaire rempli';
  if (key === 'apply_blocked_profile') return 'Candidature bloquée (profil incomplet)';
  return 'Événement analytique';
}

function formatIsoDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('fr-FR');
  } catch (_) {
    return '';
  }
}

function toFrenchBlueprintKind(kind) {
  const key = String(kind || '').toLowerCase();
  if (key === 'validate_page') return 'Validation page';
  if (key === 'login_structure' || key === 'validate_login_structure') return 'Structure login';
  if (key === 'offer_structure' || key === 'validate_offer_structure') return 'Structure offre';
  if (key === 'apply_dialog_structure' || key === 'validate_apply_dialog_structure') return 'Dialogue candidature';
  if (key === 'application_structure' || key === 'validate_application_structure') return 'Structure formulaire';
  if (key === 'success_structure' || key === 'validate_success_structure') return 'Structure succès';
  if (key === 'snapshot') return 'Snapshot';
  return kind || 'Entrée';
}

function compactUrl(url) {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search || ''}`;
  } catch (_) {
    return url || '';
  }
}

function summarizeBlueprintEntry(entry) {
  const time = formatIsoDate(entry.at);
  if (entry.kind === 'snapshot') {
    const tag = entry.tag || 'snapshot';
    const detected = entry.detected || 'unknown';
    const bits = [`${time} | ${tag}`, `page=${detected}`];
    if (entry.offerStructure?.entryMode) bits.push(`mode=${entry.offerStructure.entryMode}`);
    if (entry.applicationStructure?.ok === true) bits.push('form=ok');
    if (entry.successStructure?.ok === true) bits.push('success=ok');
    const url = compactUrl(entry.url);
    return `${bits.join(' | ')}${url ? `\n${url}` : ''}`;
  }
  const label = toFrenchBlueprintKind(entry.kind);
  const state = entry.ok === true ? 'OK' : entry.ok === false ? 'KO' : 'INFO';
  const bits = [`${time} | ${label}`, state];
  if (entry.detected) bits.push(`detecté=${entry.detected}`);
  if (entry.expected?.length) bits.push(`attendu=${entry.expected.join(',')}`);
  if (entry.entryMode) bits.push(`mode=${entry.entryMode}`);
  if (Array.isArray(entry.criticalMissing) && entry.criticalMissing.length) {
    bits.push(`missing=${entry.criticalMissing.join(',')}`);
  }
  if (typeof entry.textHits === 'number') bits.push(`text=${entry.textHits}`);
  const url = compactUrl(entry.url);
  return `${bits.join(' | ')}${url ? `\n${url}` : ''}`;
}

const PILOT_TIER_STYLE = {
  local_only: { color: '#6b7280', hint: 'Scripts embarqués dans l’extension (routage local).' },
  firebase_remote: { color: '#059669', hint: 'Script chargé depuis l’URL (ancien mode, si session).' },
  firebase_bundled: { color: '#2563eb', hint: 'Ancien libellé pilotage Firebase.' },
  fallback_routing: { color: '#d97706', hint: 'Ancien libellé (fallback routage).' },
  fallback_automation: { color: '#dc2626', hint: 'Ancien libellé (fallback automation).' }
};

async function refreshPilotStatus() {
  const el = document.getElementById('pilot-status');
  if (!el) return;
  try {
    const { taleos_last_pilot } = await chrome.storage.local.get('taleos_last_pilot');
    if (!taleos_last_pilot || !taleos_last_pilot.tier) {
      el.textContent = 'Pilotage : aucune candidature enregistrée depuis l’ouverture du popup.';
      el.style.color = '#6b7280';
      el.title = '';
      return;
    }
    const t = taleos_last_pilot.at ? formatLastEventTime(taleos_last_pilot.at) : '';
    const tier = taleos_last_pilot.tier;
    const st = PILOT_TIER_STYLE[tier] || { color: '#6b7280', hint: '' };
    el.style.color = st.color;
    el.title = st.hint || '';
    const line = `${taleos_last_pilot.label || tier}${t ? ` (${t})` : ''}`;
    el.textContent = 'Pilotage : ' + line;
  } catch (e) {
    el.textContent = 'Pilotage : erreur lecture';
    el.style.color = '#dc2626';
  }
}

async function refreshAnalyticsStatus() {
  const analyticsEl = document.getElementById('analytics-status');
  if (!analyticsEl) return;
  try {
    const { taleos_ga4_last_event } = await chrome.storage.local.get('taleos_ga4_last_event');
    if (!taleos_ga4_last_event) {
      analyticsEl.textContent = 'Analytics: aucun événement encore';
      analyticsEl.style.color = '#6b7280';
      return;
    }
    const t = formatLastEventTime(taleos_ga4_last_event.at);
    const eventName = taleos_ga4_last_event.name || 'unknown';
    const eventLabel = toFrenchAnalyticsLabel(eventName);
    if (taleos_ga4_last_event.ok) {
      if (taleos_ga4_last_event.debug_valid === false) {
        const issue = (taleos_ga4_last_event.debug_issue || 'événement à corriger').slice(0, 70);
        analyticsEl.textContent = `Analytics: ${eventLabel} envoyé, mais invalide (${issue})`;
        analyticsEl.style.color = '#d97706';
      } else {
        analyticsEl.textContent = `Analytics: ${eventLabel} validé (${t})`;
        analyticsEl.style.color = '#059669';
      }
    } else {
      const reason = taleos_ga4_last_event.status || taleos_ga4_last_event.error || 'erreur';
      analyticsEl.textContent = `Analytics: ${eventLabel} en échec (${reason})`;
      analyticsEl.style.color = '#dc2626';
    }
  } catch (e) {
    analyticsEl.textContent = `Analytics: erreur lecture (${(e?.message || 'unknown').slice(0, 40)})`;
    analyticsEl.style.color = '#dc2626';
  }
}


async function refreshBpceScriptStatus() {
  const el = document.getElementById('bpce-script-status');
  if (!el) return;
  try {
    const { taleos_bpce_script_ping } = await chrome.storage.local.get('taleos_bpce_script_ping');
    if (!taleos_bpce_script_ping?.script) {
      el.textContent = 'BPCE script: aucun ping détecté';
      el.style.color = '#6b7280';
      return;
    }
    const t = taleos_bpce_script_ping.at ? formatLastEventTime(taleos_bpce_script_ping.at) : 'maintenant';
    const script = String(taleos_bpce_script_ping.script || 'unknown');
    const phase = String(taleos_bpce_script_ping.phase || '');
    const topFr = taleos_bpce_script_ping.topFrame === true ? 'top' : taleos_bpce_script_ping.topFrame === false ? 'iframe' : '';
    const detail = String(taleos_bpce_script_ping.detail || '').slice(0, 60);
    const url = String(taleos_bpce_script_ping.url || '');
    const phaseBit = phase ? ` · ${phase}` : '';
    const frameBit = topFr ? ` · ${topFr}` : '';
    el.textContent = `BPCE script: ${script} (${t})${phaseBit}${frameBit}`;
    el.title = [url, detail].filter(Boolean).join('\n');
    el.style.color = phase === 'error' ? '#dc2626' : phase === 'done' ? '#059669' : '#2563eb';
  } catch (e) {
    el.textContent = 'BPCE script: erreur lecture';
    el.style.color = '#dc2626';
  }
}

async function refreshAnalyticsLog() {
  const logEl = document.getElementById('analytics-log');
  if (!logEl) return;
  try {
    const { taleos_ga4_event_log = [] } = await chrome.storage.local.get('taleos_ga4_event_log');
    if (!taleos_ga4_event_log.length) {
      logEl.textContent = 'Aucun envoi enregistré.';
      return;
    }
    const lines = taleos_ga4_event_log.slice(0, 8).map((e) => {
      const t = formatLastEventTime(e.at);
      const label = toFrenchAnalyticsLabel(e.name);
      const state = e.ok ? 'OK' : 'KO';
      const status = e.status ? `HTTP ${e.status}` : '';
      const dbg = e.debug_valid === false ? 'debug invalide' : 'debug ok';
      const errType = e.error_type ? ` | ${e.error_type}` : '';
      return `${t} | ${label} | ${state} ${status} | ${dbg}${errType}`;
    });
    logEl.textContent = lines.join('\n');
  } catch (e) {
    logEl.textContent = `Erreur log analytics: ${(e?.message || 'unknown').slice(0, 40)}`;
  }
}

async function refreshCABlueprintPanel() {
  const statusEl = document.getElementById('ca-blueprint-status');
  const logEl = document.getElementById('ca-blueprint-log');
  if (!statusEl || !logEl) return;
  try {
    const data = await chrome.storage.local.get([CA_BLUEPRINT_LAST_CHECK_KEY, CA_BLUEPRINT_LOG_KEY]);
    const lastCheck = data[CA_BLUEPRINT_LAST_CHECK_KEY];
    const log = Array.isArray(data[CA_BLUEPRINT_LOG_KEY]) ? data[CA_BLUEPRINT_LOG_KEY] : [];
    if (!lastCheck) {
      statusEl.textContent = 'CA blueprint: aucun diagnostic encore';
      statusEl.className = '';
      statusEl.classList.add('status-warn');
    } else {
      const label = toFrenchBlueprintKind(lastCheck.kind || 'validate_page');
      const time = formatIsoDate(lastCheck.at);
      const state = lastCheck.ok === true ? 'OK' : 'KO';
      const suffix = lastCheck.detected ? ` · ${lastCheck.detected}` : lastCheck.entryMode ? ` · ${lastCheck.entryMode}` : '';
      statusEl.textContent = `CA blueprint: ${label} ${state}${suffix}${time ? ` (${time})` : ''}`;
      statusEl.className = '';
      statusEl.classList.add(lastCheck.ok === true ? 'status-good' : 'status-bad');
    }
    if (!log.length) {
      logEl.textContent = 'Aucun log CA enregistré.';
      return;
    }
    logEl.textContent = log.slice().reverse().slice(0, 12).map(summarizeBlueprintEntry).join('\n\n');
  } catch (e) {
    statusEl.textContent = `CA blueprint: erreur lecture (${(e?.message || 'unknown').slice(0, 40)})`;
    statusEl.className = '';
    statusEl.classList.add('status-bad');
    logEl.textContent = 'Impossible de lire les logs CA.';
  }
}

async function clearCABlueprintPanel() {
  const statusEl = document.getElementById('ca-blueprint-status');
  const logEl = document.getElementById('ca-blueprint-log');
  try {
    await chrome.storage.local.remove([CA_BLUEPRINT_LAST_CHECK_KEY, CA_BLUEPRINT_LOG_KEY]);
    if (statusEl) {
      statusEl.textContent = 'CA blueprint: logs effacés';
      statusEl.className = '';
      statusEl.classList.add('status-good');
    }
    if (logEl) logEl.textContent = 'Aucun log CA enregistré.';
  } catch (e) {
    if (statusEl) {
      statusEl.textContent = `CA blueprint: erreur suppression (${(e?.message || 'unknown').slice(0, 40)})`;
      statusEl.className = '';
      statusEl.classList.add('status-bad');
    }
  }
}

async function refreshTaleosTabs() {
  try {
    const [t1, t2, t3] = await Promise.all([
      chrome.tabs.query({ url: 'https://*.taleos.co/*' }),
      chrome.tabs.query({ url: 'https://*.github.io/*' }),
      chrome.tabs.query({ url: 'http://localhost/*' })
    ]);
    const seen = new Set();
    const tabs = [].concat(t1, t2, t3).filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true; });
    for (const tab of tabs) {
      chrome.tabs.reload(tab.id).catch(() => {});
    }
    const statusEl = document.getElementById('diagnostic-status');
    if (statusEl) {
      statusEl.textContent = tabs.length ? `✅ ${tabs.length} page(s) Taleos rafraîchie(s)` : 'Aucune page Taleos ouverte';
      statusEl.style.color = '#059669';
    }
  } catch (e) {
    const statusEl = document.getElementById('diagnostic-status');
    if (statusEl) {
      statusEl.textContent = '❌ ' + (e?.message || 'Erreur');
      statusEl.style.color = '#dc2626';
    }
  }
}

async function init() {
  loadingWatchdog = setTimeout(() => {
    loadingWatchdog = null;
    if (loadingView && !loadingView.classList.contains('hidden')) {
      showLogin();
      showError('Initialisation trop longue. Ouvrez chrome://extensions et cliquez sur Actualiser sur Taleos.');
    }
  }, 12000);

  try {
  await setVersion();
  setupPasswordToggle();
  /** Recharge l’extension depuis le disque (dossier non empaqueté) + trace en storage pour vérifier la version au prochain clic. */
  const doReload = async () => {
    const manifest = chrome.runtime.getManifest();
    const label = `${manifest.version}${manifest.version_name ? ` (${manifest.version_name})` : ''}`;
    const now = new Date();
    const at = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    try {
      await chrome.storage.local.set({
        taleosLastUpdate: at,
        taleosLastPopupReload: { at, label, ts: now.getTime() }
      });
    } catch (_) {}
    const btn = document.getElementById('reload-btn');
    const btnLogin = document.getElementById('reload-btn-login');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Rechargement…';
    }
    if (btnLogin) {
      btnLogin.disabled = true;
      btnLogin.textContent = '⏳ Rechargement…';
    }
    if (chrome?.runtime?.reload) chrome.runtime.reload();
  };
  document.getElementById('reload-btn')?.addEventListener('click', () => { void doReload(); });
  document.getElementById('reload-btn-login')?.addEventListener('click', () => { void doReload(); });
  document.getElementById('diagnostic-btn')?.addEventListener('click', runDiagnostic);
  document.getElementById('refresh-taleos-btn')?.addEventListener('click', refreshTaleosTabs);
  document.getElementById('refresh-ca-blueprint-btn')?.addEventListener('click', () => { void refreshCABlueprintPanel(); });
  document.getElementById('clear-ca-blueprint-btn')?.addEventListener('click', () => { void clearCABlueprintPanel(); });
  setupLogout();
  runDiagnostic();
  refreshPilotStatus();
  refreshAnalyticsStatus();
  refreshBpceScriptStatus();
  refreshAnalyticsLog();
  refreshCABlueprintPanel();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.taleos_ga4_last_event) {
      refreshAnalyticsStatus();
    }
    if (area === 'local' && changes.taleos_ga4_event_log) {
      refreshAnalyticsLog();
    }
    if (area === 'local' && changes.taleos_bpce_script_ping) {
      refreshBpceScriptStatus();
    }
    if (area === 'local' && changes.taleos_last_pilot) {
      refreshPilotStatus();
    }
    if (area === 'local' && (changes[CA_BLUEPRINT_LAST_CHECK_KEY] || changes[CA_BLUEPRINT_LOG_KEY])) {
      refreshCABlueprintPanel();
    }
  });

  const { taleosUserId, taleosIdToken, taleosUserEmail } = await chrome.storage.local.get(['taleosUserId', 'taleosIdToken', 'taleosUserEmail']);
  if (taleosUserId && taleosIdToken) {
    showLogged({ email: taleosUserEmail || '(connecté)', uid: taleosUserId });
    return;
  }
  if (typeof firebase === 'undefined') {
    showLogin();
    showError('Firebase non chargé. Rechargez l\'extension.');
    return;
  }
  if (!firebase.apps?.length) {
    firebase.initializeApp(firebaseConfig);
  }
  const auth = firebase.auth();

  auth.onAuthStateChanged(async (user) => {
    if (user) {
      showLogged(user);
      try {
        const token = await user.getIdToken();
        if (chrome?.storage?.local) {
          await chrome.storage.local.set({
            taleosUserId: user.uid,
            taleosIdToken: token,
            taleosUserEmail: user.email || ''
          });
        }
      } catch (e) {
        console.warn('Token storage:', e);
      }
    } else {
      if (pendingLoginTimeout) clearTimeout(pendingLoginTimeout);
      pendingLoginTimeout = setTimeout(() => {
        pendingLoginTimeout = null;
        showLogin();
        if (chrome?.storage?.local) {
          chrome.storage.local.remove(['taleosUserId', 'taleosIdToken', 'taleosUserEmail']);
        }
      }, 450);
    }
  });

  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    const email = document.getElementById('email')?.value?.trim();
    const password = document.getElementById('password')?.value;
    if (!email || !password) {
      showError('Email et mot de passe requis.');
      return;
    }
    setLoading(true);
    try {
      await auth.signInWithEmailAndPassword(email, password);
    } catch (err) {
      const msg = err.code === 'auth/invalid-credential' ? 'Email ou mot de passe incorrect.' :
        err.code === 'auth/user-not-found' ? 'Aucun compte avec cet email.' :
        err.message || 'Erreur de connexion';
      showError(msg);
    } finally {
      setLoading(false);
    }
  });
  } catch (e) {
    console.error('[Taleos popup] init', e);
    showLogin();
    showError('Erreur d’initialisation. Rechargez l’extension (chrome://extensions → Actualiser).');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
