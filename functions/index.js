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
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");

initializeApp();

// Région proche de tes utilisateurs FR ; modifiable.
setGlobalOptions({ region: "europe-west1", maxInstances: 100 });

/**
 * Point d’entrée minimal pour valider Auth + latence.
 * Appel depuis le client : httpsCallable(functions, 'ping') avec utilisateur connecté.
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

/** Même logique de routage que l’extension (fallback local) — à enrichir côté serveur sans mettre à jour le client. */
function legacyRouteAs(bankId, offerUrl) {
  const url = String(offerUrl || "").toLowerCase();
  const bid = String(bankId || "").toLowerCase();
  if (bid === "credit_agricole" || url.includes("groupecreditagricole.jobs")) return "ca";
  if (bid === "deloitte" || (url.includes("myworkdayjobs.com") && url.includes("deloitte")))
    return "deloitte";
  if (
    bid === "societe_generale" ||
    url.includes("careers.societegenerale.com") ||
    url.includes("socgen.taleo.net")
  )
    return "sg";
  if (bid === "bpce" || url.includes("recrutement.bpce.fr")) return "bpce";
  return "other";
}

const ALLOWED_SCRIPT_KEYS = new Set([
  "credit_agricole",
  "societe_generale",
  "deloitte",
  "bpce",
]);

function legacyScriptKey(bankId, offerUrl) {
  const r = legacyRouteAs(bankId, offerUrl);
  const byRoute = {
    ca: "credit_agricole",
    deloitte: "deloitte",
    sg: "societe_generale",
    bpce: "bpce",
  };
  if (byRoute[r]) return byRoute[r];
  const bid = String(bankId || "").trim();
  if (bid && ALLOWED_SCRIPT_KEYS.has(bid)) return bid;
  return "credit_agricole";
}

/**
 * Plan de candidature : routage + clé script extension (fichiers toujours locaux pour l’instant).
 * L’extension appelle en priorité ; peut évoluer (règles métier, abonnement) sans publier une nouvelle extension.
 */
exports.getApplyPlan = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Connexion requise.");
  }
  const uid = request.auth.uid;
  try {
    await getAuth().getUser(uid);
  } catch {
    throw new HttpsError("permission-denied", "Utilisateur invalide.");
  }

  const data = request.data || {};
  const bankId = String(data.bankId || "").trim();
  const offerUrl = String(data.offerUrl || "").trim();

  const routeAs = legacyRouteAs(bankId, offerUrl);
  const scriptKey = legacyScriptKey(bankId, offerUrl);

  return {
    ok: true,
    planVersion: 1,
    routeAs,
    scriptKey,
    serverTime: Date.now(),
  };
});
