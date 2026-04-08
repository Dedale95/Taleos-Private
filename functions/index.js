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
