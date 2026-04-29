/**
 * Cloud Functions (2nd gen) — Taleos
 *
 * Déploiement : GitHub Actions (voir .github/workflows/deploy-firebase-functions.yml)
 *   ou en local : cd functions && npm install && cd .. && firebase deploy --only functions
 *
 * Nécessite le plan Blaze pour les appels sortants hors quota gratuit.
 */

const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const crypto = require("crypto");

initializeApp();

setGlobalOptions({ region: "europe-west1", maxInstances: 100 });

const OUTLOOK_CLIENT_ID = process.env.OUTLOOK_CLIENT_ID || "";
const OUTLOOK_CLIENT_SECRET = process.env.OUTLOOK_CLIENT_SECRET || "";
const OUTLOOK_TOKEN_ENC_KEY = process.env.OUTLOOK_TOKEN_ENC_KEY || "";
const EXTENSION_RUNS_ADMIN_EMAILS = new Set([
  "thibault.giraudet@outlook.com",
  "thibault.giraudet94@gmail.com",
]);

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "3600",
  };
}

function b64urlToBuffer(s) {
  const pad = 4 - (s.length % 4 || 4);
  const normalized = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad % 4);
  return Buffer.from(normalized, "base64");
}

function assertOutlookConfig() {
  if (!OUTLOOK_CLIENT_ID || !OUTLOOK_CLIENT_SECRET || !OUTLOOK_TOKEN_ENC_KEY) {
    throw new Error("Configuration Outlook OAuth manquante (OUTLOOK_CLIENT_ID / OUTLOOK_CLIENT_SECRET / OUTLOOK_TOKEN_ENC_KEY).");
  }
}

function encryptText(plain, keyB64) {
  const key = b64urlToBuffer(String(keyB64 || ""));
  if (key.length !== 32) throw new Error("OUTLOOK_TOKEN_ENC_KEY invalide (32 bytes attendus).");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext_b64: ciphertext.toString("base64"),
    iv_b64: iv.toString("base64"),
    tag_b64: tag.toString("base64"),
  };
}

function decryptText(encObj, keyB64) {
  const key = b64urlToBuffer(String(keyB64 || ""));
  if (key.length !== 32) throw new Error("OUTLOOK_TOKEN_ENC_KEY invalide (32 bytes attendus).");
  const iv = Buffer.from(encObj.iv_b64 || "", "base64");
  const tag = Buffer.from(encObj.tag_b64 || "", "base64");
  const ciphertext = Buffer.from(encObj.ciphertext_b64 || "", "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString("utf8");
}

async function verifyBearerFirebaseUser(req) {
  const authHeader = String(req.headers.authorization || "");
  if (!authHeader.startsWith("Bearer ")) {
    throw new HttpsError("unauthenticated", "Token Firebase manquant.");
  }
  const idToken = authHeader.slice("Bearer ".length).trim();
  if (!idToken) throw new HttpsError("unauthenticated", "Token Firebase vide.");
  try {
    return await getAuth().verifyIdToken(idToken);
  } catch {
    throw new HttpsError("permission-denied", "Token Firebase invalide.");
  }
}

function jsonResponse(res, status, payload) {
  return res.status(status).set(corsHeaders()).json(payload);
}

async function saveOutlookSecureDoc(uid, data) {
  const admin = require("firebase-admin");
  const db = admin.firestore();
  await db.doc(`profiles/${uid}/secure_integrations/outlook`).set(data, { merge: true });
}

async function getOutlookSecureDoc(uid) {
  const admin = require("firebase-admin");
  const db = admin.firestore();
  const snap = await db.doc(`profiles/${uid}/secure_integrations/outlook`).get();
  return snap.exists ? snap.data() : null;
}

async function deleteOutlookSecureDoc(uid) {
  const admin = require("firebase-admin");
  const db = admin.firestore();
  await db.doc(`profiles/${uid}/secure_integrations/outlook`).delete().catch(() => {});
}

/**
 * Point d’entrée minimal pour valider Auth + latence.
 */
exports.ping = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Connexion requise.");
  }
  const uid = request.auth.uid;
  try {
    await getAuth().getUser(uid);
  } catch {
    throw new HttpsError("permission-denied", "Utilisateur invalide.");
  }
  return {
    ok: true,
    uid,
    serverTime: Date.now(),
    message: "Backend Taleos joignable (ping).",
  };
});

exports.outlookOAuthExchange = onRequest(async (req, res) => {
    try {
      assertOutlookConfig();
      if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method Not Allowed" });
      const decoded = await verifyBearerFirebaseUser(req);
      const { code, codeVerifier, redirectUri } = req.body || {};
      if (!code || !codeVerifier || !redirectUri) {
        return res.status(400).json({ ok: false, error: "Paramètres OAuth manquants." });
      }

      const params = new URLSearchParams();
      params.set("client_id", OUTLOOK_CLIENT_ID);
      params.set("client_secret", OUTLOOK_CLIENT_SECRET);
      params.set("grant_type", "authorization_code");
      params.set("code", String(code));
      params.set("redirect_uri", String(redirectUri));
      params.set("code_verifier", String(codeVerifier));
      params.set("scope", "offline_access Mail.Read User.Read openid profile email");

      const tokenRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      const tokenJson = await tokenRes.json();
      if (!tokenRes.ok || !tokenJson.refresh_token) {
        return res.status(400).json({ ok: false, error: tokenJson.error_description || "Exchange OAuth Outlook échoué." });
      }

      const enc = encryptText(tokenJson.refresh_token, OUTLOOK_TOKEN_ENC_KEY);
      await saveOutlookSecureDoc(decoded.uid, {
        provider: "outlook",
        status: "connected",
        scope: tokenJson.scope || "offline_access Mail.Read User.Read",
        refresh_token_enc: enc,
        outlook_email: tokenJson.id_token ? "linked" : "",
        updated_at: Date.now(),
      });
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message || "Erreur outlookOAuthExchange" });
    }
  });

exports.outlookOAuthConfig = onRequest(async (req, res) => {
  try {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method Not Allowed" });
    if (!OUTLOOK_CLIENT_ID) return res.status(500).json({ ok: false, error: "OUTLOOK_CLIENT_ID non configuré" });
    return res.json({ ok: true, clientId: OUTLOOK_CLIENT_ID, scope: "offline_access Mail.Read User.Read openid profile email" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || "Erreur outlookOAuthConfig" });
  }
});

exports.outlookFetchLatestOtp = onRequest(async (req, res) => {
    try {
      assertOutlookConfig();
      if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method Not Allowed" });
      const decoded = await verifyBearerFirebaseUser(req);
      const secureDoc = await getOutlookSecureDoc(decoded.uid);
      if (!secureDoc || secureDoc.status !== "connected" || !secureDoc.refresh_token_enc) {
        return res.json({ ok: true, pinCode: null });
      }
      const refreshToken = decryptText(secureDoc.refresh_token_enc, OUTLOOK_TOKEN_ENC_KEY);

      const refreshParams = new URLSearchParams();
      refreshParams.set("client_id", OUTLOOK_CLIENT_ID);
      refreshParams.set("client_secret", OUTLOOK_CLIENT_SECRET);
      refreshParams.set("grant_type", "refresh_token");
      refreshParams.set("refresh_token", refreshToken);
      refreshParams.set("scope", "offline_access Mail.Read User.Read openid profile email");
      const tokenRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: refreshParams.toString(),
      });
      const tokenJson = await tokenRes.json();
      if (!tokenRes.ok || !tokenJson.access_token) {
        return res.json({ ok: true, pinCode: null });
      }
      if (tokenJson.refresh_token) {
        const enc = encryptText(tokenJson.refresh_token, OUTLOOK_TOKEN_ENC_KEY);
        await saveOutlookSecureDoc(decoded.uid, { refresh_token_enc: enc, updated_at: Date.now() });
      }

      const msgsRes = await fetch(
        "https://graph.microsoft.com/v1.0/me/messages?$top=10&$select=subject,bodyPreview,from,receivedDateTime&$orderby=receivedDateTime desc",
        { headers: { Authorization: `Bearer ${tokenJson.access_token}` } }
      );
      const msgsJson = await msgsRes.json();
      const values = Array.isArray(msgsJson.value) ? msgsJson.value : [];
      const now = Date.now();
      for (const m of values) {
        const fromAddr = String(m?.from?.emailAddress?.address || "").toLowerCase();
        const subject = String(m?.subject || "");
        const preview = String(m?.bodyPreview || "");
        const received = new Date(m?.receivedDateTime || 0).getTime();
        if (!received || now - received > 15 * 60 * 1000) continue;
        if (!fromAddr.includes("workflow.mail.em2.cloud.oracle.com")) continue;
        if (!/confirmer votre identit/i.test(subject + " " + preview)) continue;
        const match = (subject + " " + preview).match(/\b(\d{6})\b/);
        if (match) return res.json({ ok: true, pinCode: match[1] });
      }
      return res.json({ ok: true, pinCode: null });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message || "Erreur outlookFetchLatestOtp" });
    }
  });

exports.outlookUnlinkSecure = onRequest(async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method Not Allowed" });
    const decoded = await verifyBearerFirebaseUser(req);
    await deleteOutlookSecureDoc(decoded.uid);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || "Erreur outlookUnlinkSecure" });
  }
});

exports.saveExtensionApplicationRun = onRequest(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return res.status(204).set(corsHeaders()).send("");
    if (req.method !== "POST") return jsonResponse(res, 405, { ok: false, error: "Method Not Allowed" });
    const decoded = await verifyBearerFirebaseUser(req);
    const run = req.body && typeof req.body === "object" ? req.body : {};
    const runId = String(run.runId || "").trim();
    if (!runId) return jsonResponse(res, 400, { ok: false, error: "runId requis" });

    const admin = require("firebase-admin");
    const db = admin.firestore();
    const payload = {
      ...run,
      userId: String(run.userId || decoded.uid || "").trim(),
      userEmail: String(run.userEmail || decoded.email || "").trim().toLowerCase(),
      updatedAt: Date.now(),
    };
    await db.collection("extension_application_runs").doc(runId).set(payload, { merge: true });
    return jsonResponse(res, 200, { ok: true, runId });
  } catch (e) {
    const code = e?.code === "permission-denied" || e?.code === "unauthenticated" ? 401 : 500;
    return jsonResponse(res, code, { ok: false, error: e.message || "Erreur saveExtensionApplicationRun" });
  }
});

exports.listExtensionApplicationRuns = onRequest(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return res.status(204).set(corsHeaders()).send("");
    if (req.method !== "GET" && req.method !== "POST") return jsonResponse(res, 405, { ok: false, error: "Method Not Allowed" });
    const decoded = await verifyBearerFirebaseUser(req);
    const email = String(decoded.email || "").trim().toLowerCase();
    if (!EXTENSION_RUNS_ADMIN_EMAILS.has(email)) {
      return jsonResponse(res, 403, { ok: false, error: "Accès non autorisé" });
    }

    const admin = require("firebase-admin");
    const db = admin.firestore();
    const snap = await db.collection("extension_application_runs")
      .orderBy("startedAt", "desc")
      .limit(200)
      .get();

    const runs = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    return jsonResponse(res, 200, { ok: true, runs });
  } catch (e) {
    const code = e?.code === "permission-denied" || e?.code === "unauthenticated" ? 401 : 500;
    return jsonResponse(res, code, { ok: false, error: e.message || "Erreur listExtensionApplicationRuns" });
  }
});

const SCRAPING_MONITOR_BANKS = [
  {
    id: "bpce",
    name: "Groupe BPCE",
    groupName: "Groupe BPCE",
    careerUrl: "https://recrutement.bpce.fr/offres-emploi?external=false",
    sourceLabel: "API BPCE",
  },
  {
    id: "bnp_paribas",
    name: "Groupe BNP Paribas",
    groupName: "Groupe BNP Paribas",
    careerUrl: "https://group.bnpparibas/emploi-carriere/toutes-offres-emploi",
    sourceLabel: "Page offres BNP Paribas",
  },
  {
    id: "credit_agricole",
    name: "Groupe Crédit Agricole",
    groupName: "Groupe Crédit Agricole",
    careerUrl: "https://groupecreditagricole.jobs/fr/nos-offres/",
    sourceLabel: "Page offres Crédit Agricole",
  },
  {
    id: "societe_generale",
    name: "Groupe Société Générale",
    groupName: "Groupe Société Générale",
    careerUrl: "https://careers.societegenerale.com/",
    sourceLabel: "Page carrière Société Générale",
  },
];

const TALEOS_PUBLIC_JOBS_JSON_URL = "https://raw.githubusercontent.com/Dedale95/Taleos-Public/main/scraped_jobs_live.json";

function parseNumericCount(raw) {
  const digitsOnly = String(raw || "").replace(/[^\d]/g, "");
  return digitsOnly ? Number.parseInt(digitsOnly, 10) : 0;
}

function normalizeTaleosCompanyGroup(companyName) {
  const raw = String(companyName || "").trim();
  if (!raw) return "Non spécifié";
  const normalized = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (
    normalized.includes("credit agricole") ||
    normalized.includes("amundi") ||
    normalized.includes("caceis") ||
    normalized.includes("lcl") ||
    normalized.includes("indosuez") ||
    normalized.includes("bforbank") ||
    normalized.includes("uptevia") ||
    normalized.includes("idia")
  ) {
    return "Groupe Crédit Agricole";
  }
  if (
    normalized.includes("bpce") ||
    normalized.includes("natixis") ||
    normalized.includes("caisse d epargne") ||
    normalized.includes("caisse d'epargne") ||
    normalized.includes("banque populaire") ||
    normalized.includes("credit cooperatif") ||
    normalized.includes("oney") ||
    normalized.includes("aew") ||
    normalized.includes("mirova") ||
    normalized.includes("ostrum") ||
    normalized.includes("banque palatine") ||
    normalized.includes("credit foncier") ||
    normalized.includes("casden") ||
    normalized.includes("capitole finance")
  ) {
    return "Groupe BPCE";
  }
  if (normalized.includes("societe generale") || normalized.includes("société générale")) {
    return "Groupe Société Générale";
  }
  if (
    normalized.includes("credit mutuel") ||
    normalized.includes("crédit mutuel") ||
    normalized.includes("cic") ||
    normalized.includes("cofidis") ||
    normalized.includes("euro information") ||
    normalized.includes("banque transatlantique") ||
    normalized.includes("lyonnaise de banque") ||
    normalized.includes("afedim") ||
    normalized.includes("creatis") ||
    normalized.includes("factofrance") ||
    normalized.includes("monabanq")
  ) {
    return "Groupe Crédit Mutuel";
  }
  if (normalized.includes("bnp")) return "Groupe BNP Paribas";
  if (normalized.includes("bpifrance")) return "Bpifrance";
  if (normalized.includes("oddo")) return "ODDO BHF";
  if (normalized.includes("deloitte")) return "Deloitte";
  return raw;
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "User-Agent": "Taleos-Monitor/1.0",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} sur ${url}`);
  }
  return response.text();
}

async function fetchBpceCareerCount() {
  const response = await fetch("https://recrutement.bpce.fr/app/wp-json/bpce/v1/search/jobs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Taleos-Monitor/1.0",
    },
    body: JSON.stringify({
      lang: "fr",
      keyword: "",
      tax_sector: "",
      tax_contract: "",
      tax_place: "",
      tax_job: "",
      tax_experience: "",
      tax_degree: "",
      tax_brands: "",
      tax_department: "",
      tax_city: "",
      tax_country: "",
      tax_channel: "",
      jobcode: "",
      tax_community_job: "",
      external: false,
      userID: "",
      from: 0,
      size: 1,
    }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} sur API BPCE`);
  const payload = await response.json();
  const total = Number(payload?.data?.total || 0);
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error("Total BPCE introuvable");
  }
  return total;
}

async function fetchBnpCareerCount() {
  const html = await fetchText("https://r.jina.ai/http://group.bnpparibas/emploi-carriere/toutes-offres-emploi");
  const match =
    html.match(/Nous avons\s+([\d\s\xa0\u202f]+)\s+offres/i) ||
    html.match(/Consultez les offres\s*\(([\d\s\xa0\u202f]+)\)/i);
  const total = parseNumericCount(match?.[1] || "");
  if (!total) throw new Error("Total BNP Paribas introuvable");
  return total;
}

async function fetchCreditAgricoleCareerCount() {
  const html = await fetchText("https://groupecreditagricole.jobs/fr/nos-offres/page/1/");
  const match =
    html.match(/js-searchOffersResults[\s\S]{0,260}?>([\s\S]*?)<\/h2>/i) ||
    html.match(/([\d\s\xa0\u202f]+)\s+offres disponibles/i);
  const total = parseNumericCount(match?.[1] || "");
  if (!total) throw new Error("Total Crédit Agricole introuvable");
  return total;
}

async function fetchSocieteGeneraleCareerCount() {
  const html = await fetchText("https://careers.societegenerale.com/");
  const match =
    html.match(/>\s*([\d\s\xa0\u202f]+)\s*<\/span>\s*<span[^>]*>\s*offres d[’']emploi/i) ||
    html.match(/([\d\s\xa0\u202f]+)\s+offres d[’']emploi/i);
  const total = parseNumericCount(match?.[1] || "");
  if (!total) throw new Error("Total Société Générale introuvable");
  return total;
}

async function fetchTaleosGroupCounts() {
  const rawJson = await fetchText(TALEOS_PUBLIC_JOBS_JSON_URL);
  const jobs = JSON.parse(rawJson);
  if (!Array.isArray(jobs)) {
    throw new Error("Catalogue Taleos invalide");
  }

  const counts = new Map();
  for (const job of jobs) {
    const group = normalizeTaleosCompanyGroup(job?.company_name || job?.companyName || "");
    counts.set(group, (counts.get(group) || 0) + 1);
  }
  return counts;
}

async function buildScrapingCoverageSnapshot() {
  const taleosCounts = await fetchTaleosGroupCounts();
  const siteCountFetchers = {
    bpce: fetchBpceCareerCount,
    bnp_paribas: fetchBnpCareerCount,
    credit_agricole: fetchCreditAgricoleCareerCount,
    societe_generale: fetchSocieteGeneraleCareerCount,
  };

  const siteResults = await Promise.allSettled(
    SCRAPING_MONITOR_BANKS.map(async (bank) => {
      const siteCount = await siteCountFetchers[bank.id]();
      const taleosCount = Number(taleosCounts.get(bank.groupName) || 0);
      const coveragePct = siteCount > 0 ? Math.min(100, Number(((taleosCount / siteCount) * 100).toFixed(1))) : 0;
      return {
        id: bank.id,
        name: bank.name,
        siteCount,
        taleosCount,
        coveragePct,
        missingCount: Math.max(siteCount - taleosCount, 0),
        careerUrl: bank.careerUrl,
        sourceLabel: bank.sourceLabel,
        status: "ok",
      };
    })
  );

  const banks = siteResults.map((result, index) => {
    const bank = SCRAPING_MONITOR_BANKS[index];
    if (result.status === "fulfilled") return result.value;
    return {
      id: bank.id,
      name: bank.name,
      siteCount: null,
      taleosCount: Number(taleosCounts.get(bank.groupName) || 0),
      coveragePct: null,
      missingCount: null,
      careerUrl: bank.careerUrl,
      sourceLabel: bank.sourceLabel,
      status: "error",
      error: result.reason?.message || `Impossible de lire ${bank.name}`,
    };
  });

  const totals = banks.reduce((acc, bank) => {
    if (Number.isFinite(bank.siteCount)) acc.siteCount += bank.siteCount;
    if (Number.isFinite(bank.taleosCount)) acc.taleosCount += bank.taleosCount;
    return acc;
  }, { siteCount: 0, taleosCount: 0 });

  return {
    generatedAt: Date.now(),
    taleosSourceUrl: TALEOS_PUBLIC_JOBS_JSON_URL,
    totals: {
      siteCount: totals.siteCount,
      taleosCount: totals.taleosCount,
      coveragePct: totals.siteCount > 0 ? Number(((totals.taleosCount / totals.siteCount) * 100).toFixed(1)) : 0,
    },
    banks,
  };
}

exports.getScrapingCoverageSnapshot = onRequest(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return res.status(204).set(corsHeaders()).send("");
    if (req.method !== "GET") return jsonResponse(res, 405, { ok: false, error: "Method Not Allowed" });
    const decoded = await verifyBearerFirebaseUser(req);
    const email = String(decoded.email || "").trim().toLowerCase();
    if (!EXTENSION_RUNS_ADMIN_EMAILS.has(email)) {
      return jsonResponse(res, 403, { ok: false, error: "Accès non autorisé" });
    }

    const snapshot = await buildScrapingCoverageSnapshot();
    return jsonResponse(res, 200, { ok: true, snapshot });
  } catch (e) {
    const code = e?.code === "permission-denied" || e?.code === "unauthenticated" ? 401 : 500;
    return jsonResponse(res, code, { ok: false, error: e.message || "Erreur getScrapingCoverageSnapshot" });
  }
});
