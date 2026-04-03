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
