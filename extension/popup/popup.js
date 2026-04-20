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
const SG_BLUEPRINT_LAST_CHECK_KEY = 'taleos_sg_blueprint_last_check';
const SG_BLUEPRINT_LOG_KEY = 'taleos_sg_blueprint_log';

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
    const reloadLoginEl = document.getElementById('version-reload-login');
    if (badge) badge.textContent = versionLabel;
    if (badgeLogged) badgeLogged.textContent = `Version ${versionLabel.replace(/^v/, '')}`;
    const { taleosLastUpdate, taleosLastPopupReload } = await chrome.storage.local.get([
      'taleosLastUpdate',
      'taleosLastPopupReload'
    ]);
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
  if (key === 'application_questions' || key === 'validate_application_questions') return 'Questions formulaire';
  if (key === 'question_audit' || key === 'validate_question_audit') return 'Audit questions';
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


async function refreshCABlueprintPanel() {
  const statusEl = document.getElementById('ca-blueprint-status');
  if (!statusEl) return;
  try {
    const data = await chrome.storage.local.get([CA_BLUEPRINT_LAST_CHECK_KEY]);
    const lastCheck = data[CA_BLUEPRINT_LAST_CHECK_KEY];
    if (!lastCheck) {
      statusEl.textContent = 'Crédit Agricole : aucun diagnostic';
      statusEl.className = '';
      statusEl.classList.add('status-warn');
    } else {
      const label = toFrenchBlueprintKind(lastCheck.kind || 'validate_page');
      const time = formatIsoDate(lastCheck.at);
      const state = lastCheck.ok === true ? 'OK' : 'KO';
      const suffix = lastCheck.detected ? ` · ${lastCheck.detected}` : lastCheck.entryMode ? ` · ${lastCheck.entryMode}` : '';
      statusEl.textContent = `Crédit Agricole : ${label} ${state}${suffix}${time ? ` (${time})` : ''}`;
      statusEl.className = '';
      statusEl.classList.add(lastCheck.ok === true ? 'status-good' : 'status-bad');
    }
  } catch (e) {
    statusEl.textContent = `Crédit Agricole : erreur lecture (${(e?.message || 'unknown').slice(0, 40)})`;
    statusEl.className = '';
    statusEl.classList.add('status-bad');
  }
}

async function refreshSGBlueprintPanel() {
  const statusEl = document.getElementById('sg-blueprint-status');
  if (!statusEl) return;
  try {
    const data = await chrome.storage.local.get([SG_BLUEPRINT_LAST_CHECK_KEY]);
    const lastCheck = data[SG_BLUEPRINT_LAST_CHECK_KEY];
    if (!lastCheck) {
      statusEl.textContent = 'Société Générale : aucun diagnostic';
      statusEl.className = '';
      statusEl.classList.add('status-warn');
    } else {
      const label = toFrenchBlueprintKind(lastCheck.kind || 'validate_page');
      const time = formatIsoDate(lastCheck.at);
      const state = lastCheck.ok === true ? 'OK' : 'KO';
      const suffix =
        lastCheck.detected ? ` · ${lastCheck.detected}` :
        lastCheck.detectedPage ? ` · ${lastCheck.detectedPage}` :
        '';
      statusEl.textContent = `Société Générale : ${label} ${state}${suffix}${time ? ` (${time})` : ''}`;
      statusEl.className = '';
      statusEl.classList.add(lastCheck.ok === true ? 'status-good' : 'status-bad');
    }
  } catch (e) {
    statusEl.textContent = `Société Générale : erreur lecture (${(e?.message || 'unknown').slice(0, 40)})`;
    statusEl.className = '';
    statusEl.classList.add('status-bad');
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
  setupLogout();
  refreshPilotStatus();
  refreshCABlueprintPanel();
  refreshSGBlueprintPanel();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.taleos_last_pilot) {
      refreshPilotStatus();
    }
    if (area === 'local' && (changes[CA_BLUEPRINT_LAST_CHECK_KEY] || changes[CA_BLUEPRINT_LOG_KEY])) {
      refreshCABlueprintPanel();
    }
    if (area === 'local' && (changes[SG_BLUEPRINT_LAST_CHECK_KEY] || changes[SG_BLUEPRINT_LOG_KEY])) {
      refreshSGBlueprintPanel();
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
