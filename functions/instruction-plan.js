/**
 * Plans d'instructions candidature — logique métier côté serveur, jamais un bundle JS monolithique.
 * Collection Firestore optionnelle : apply_instruction_sets/{scriptKey}
 */

const { getFirestore } = require("firebase-admin/firestore");

const ALLOWED_SCRIPT_KEYS = new Set([
  "credit_agricole",
  "societe_generale",
  "deloitte",
  "bpce",
]);

function defaultStepsForScriptKey(scriptKey) {
  const sk = ALLOWED_SCRIPT_KEYS.has(scriptKey) ? scriptKey : "credit_agricole";
  return [
    {
      op: "run_bundled_script",
      scriptKey: sk,
      phase: "any",
      note:
        "Délégation au bundle embarqué — remplacer progressivement par des opérations atomiques (click, fill, …)",
    },
  ];
}

function sanitizeStep(step) {
  if (!step || typeof step !== "object") return null;
  const op = String(step.op || "").trim();
  if (op === "run_bundled_script") {
    const sk = String(step.scriptKey || "").trim();
    if (!ALLOWED_SCRIPT_KEYS.has(sk)) return null;
    const ph = step.phase;
    const phase =
      ph === "any" || ph === undefined || ph === null
        ? "any"
        : typeof ph === "number" && ph >= 0 && ph < 20
          ? ph
          : "any";
    return {
      op,
      scriptKey: sk,
      phase,
      note: typeof step.note === "string" ? step.note.slice(0, 240) : undefined,
    };
  }
  if (op === "wait_ms") {
    const ms = Math.min(120000, Math.max(0, Math.floor(Number(step.ms) || 0)));
    return { op, ms };
  }
  if (op === "click" || op === "focus") {
    const selector = String(step.selector || "").trim().slice(0, 500);
    if (!selector) return null;
    return { op, selector };
  }
  if (op === "fill") {
    const selector = String(step.selector || "").trim().slice(0, 500);
    const valueFrom = String(step.valueFrom || "").trim().slice(0, 200);
    if (!selector || !valueFrom) return null;
    return { op, selector, valueFrom };
  }
  return null;
}

function sanitizeSteps(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const s of raw) {
    const c = sanitizeStep(s);
    if (c) out.push(c);
  }
  return out;
}

async function loadStepsFromFirestore(scriptKey) {
  try {
    const db = getFirestore();
    const snap = await db.collection("apply_instruction_sets").doc(scriptKey).get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    if (!Array.isArray(data.steps) || !data.steps.length) return null;
    return sanitizeSteps(data.steps);
  } catch (e) {
    console.warn("[getApplyPlan] Firestore apply_instruction_sets:", e.message);
    return null;
  }
}

async function buildInstructionSteps(scriptKey) {
  let steps = await loadStepsFromFirestore(scriptKey);
  if (!steps || !steps.length) {
    steps = sanitizeSteps(defaultStepsForScriptKey(scriptKey));
  }
  if (!steps.length) {
    steps = sanitizeSteps(defaultStepsForScriptKey("credit_agricole"));
  }
  return steps;
}

module.exports = {
  ALLOWED_SCRIPT_KEYS,
  buildInstructionSteps,
  sanitizeSteps,
  defaultStepsForScriptKey,
};
