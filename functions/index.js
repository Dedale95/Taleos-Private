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
const { buildInstructionSteps } = require("./instruction-plan");

initializeApp();

setGlobalOptions({ region: "europe-west1", maxInstances: 100 });

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

/** Même logique de routage que l’extension (fallback local) — à enrichir côté serveur. */
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
 * Plan de candidature : routage + scriptKey + pilot.mode = instructions (liste d’étapes).
 * Les étapes peuvent être surchargées dans Firestore : apply_instruction_sets/{scriptKey}
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
  const steps = await buildInstructionSteps(scriptKey);

  const pilot = {
    automationMode: "instructions",
    instructionSetVersion: 1,
    steps,
  };

  return {
    ok: true,
    planVersion: 4,
    routeAs,
    scriptKey,
    pilot,
    serverTime: Date.now(),
  };
});
