/**
 * Taleos - Blueprint BPCE Lumesse/TalentLink
 * ------------------------------------------------------------
 * Source des données:
 * - chrome.storage.local.taleos_pending_bpce.profile (alimenté par background.js)
 * - CV récupéré via action background: fetch_storage_file
 */
(async () => {
  "use strict";
  const BANNER_ID = "taleos-bpce-lumesse-banner";
  const isTop = window === window.top;
  let running = false;
  let done = false;
  let lastWaitLog = 0;
  let lastPingPhase = "";

  function setPing(phase, detail) {
    try {
      const payload = {
        script: "bpce-lumesse-filler.js",
        url: location.href,
        at: new Date().toISOString(),
        topFrame: isTop,
        phase: phase || "boot",
        detail: detail || ""
      };
      chrome.storage.local.set({ taleos_bpce_script_ping: payload });
      if (phase && phase !== lastPingPhase) {
        lastPingPhase = phase;
        log(`📡 ${phase}${detail ? ` — ${detail}` : ""}`);
      }
    } catch (_) {}
  }

  setPing("loaded", isTop ? "frame principale" : "iframe");

  // =========================
  // 1) Chargement du profil
  // =========================
  async function hasPendingBpce() {
    const { taleos_pending_bpce } = await chrome.storage.local.get("taleos_pending_bpce");
    return !!(taleos_pending_bpce && taleos_pending_bpce.profile);
  }

  async function getPendingBpceProfile() {
    const { taleos_pending_bpce } = await chrome.storage.local.get("taleos_pending_bpce");
    if (!taleos_pending_bpce || !taleos_pending_bpce.profile) {
      throw new Error("Profil BPCE introuvable (taleos_pending_bpce.profile)");
    }
    return taleos_pending_bpce.profile;
  }

  function normalizeProfile(raw) {
    const civility = String(raw.civility || raw.civilite || "").trim();
    const phoneCountryCode = String(raw.phone_country_code || "+33").trim();
    const phoneDigits = String(raw.phone_number || raw.phone || "").replace(/\D/g, "");
    const profile = {
      civilite: civility.toLowerCase().includes("mad") ? "Mme" : "M.",
      nom: String(raw.last_name || raw.lastname || "").trim(),
      prenom: String(raw.first_name || raw.firstname || "").trim(),
      email: String(raw.email || raw.auth_email || "").trim(),
      telephone: phoneDigits,
      phoneCountryCode,
      linkedin: String(raw.linkedin_url || "").trim(),
      disponibilite: String(
        raw.available_from ||
          raw.available_from_raw ||
          raw.available_date ||
          raw.disponibilite ||
          "Immédiatement"
      )
        .replace(/^disponible\s+a\s+partir\s+de\s*/i, "")
        .replace(/^disponible à partir de\s*/i, "")
        .trim(),
      autorisationTravailFrance: "OUI",
      sourceCandidature: String(raw.bpce_application_source || "Avec mon CV").trim(),
      cvStoragePath: String(raw.cv_storage_path || "").trim(),
      cvFileName: String(raw.cv_filename || "cv.pdf").trim(),
    };
    return profile;
  }

  // =========================
  // 2) Utilitaires DOM
  // =========================
  function log(msg) {
    console.log(`[BPCE Lumesse] ${msg}`);
  }

  function showBanner(text) {
    const api = globalThis.__TALEOS_AUTOMATION_BANNER__;
    let el = document.getElementById(BANNER_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = BANNER_ID;
      if (api) api.applyStyle(el);
      else {
        Object.assign(el.style, {
          position: "fixed",
          top: "0",
          left: "0",
          right: "0",
          zIndex: "2147483647",
          background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
          color: "white",
          padding: "10px 20px",
          fontSize: "14px",
          fontWeight: "600",
          textAlign: "center",
        });
      }
      document.body?.insertBefore(el, document.body.firstChild);
    }
    el.textContent = text || (api ? api.getText() : "⏳ Automatisation Taleos Lumesse — Ne touchez à rien.");
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitForElement(selector, timeout = 12000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const el = document.querySelector(selector);
      if (el) return el;
      await sleep(150);
    }
    throw new Error(`Timeout: ${selector} introuvable`);
  }

  function fillInput(selector, value) {
    const el = document.querySelector(selector);
    if (!el || value == null) return false;
    const next = String(value).trim();
    const current = String(el.value || "").trim();
    if (current === next) return true;
    el.focus();
    el.value = next;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    return true;
  }

  function selectByTextContains(selector, wantedText) {
    const select = document.querySelector(selector);
    if (!select) return false;
    const target = String(wantedText || "").toLowerCase().trim();
    const option = Array.from(select.options || []).find((o) =>
      String(o.textContent || "").toLowerCase().includes(target)
    );
    if (!option) return false;
    select.value = option.value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  async function fetchCvAsFileFromFirebase(storagePath, filename) {
    const payload = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "fetch_storage_file", storagePath }, resolve);
    });
    if (!payload || payload.error || !payload.base64) {
      throw new Error(payload?.error || "CV Firebase introuvable");
    }
    const bin = atob(payload.base64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const blob = new Blob([arr], { type: payload.type || "application/pdf" });
    return new File([blob], filename || "cv.pdf", { type: blob.type });
  }

  function injectFile(inputSelector, file) {
    const input = document.querySelector(inputSelector);
    if (!input || !file) return false;
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  /** Détection élargie (variantes TalentLink / Lumesse / Oracle). */
  function detectLumesseForm() {
    const sels = [
      "form.apply-main-form",
      "select[name='form_of_address']",
      "select[name='custom_question_7344']",
      "input[name='last_name']",
      "input[name='first_name']",
      "input[name='e-mail_address']",
      "[data-talentlink-apply-number='country_code']",
      "input[id*='lastName']",
      "input[id*='firstName']",
      "select[name^='custom_question_']",
    ];
    const hits = sels.filter((s) => {
      try {
        return !!document.querySelector(s);
      } catch {
        return false;
      }
    });
    const hasName = !!document.querySelector(
      "input[name='last_name'], input[name='first_name'], input[id*='lastName'], input[id*='firstName'], input[id*='LastName'], input[id*='FirstName']"
    );
    const hasCivility = !!document.querySelector("select[name='form_of_address'], select[id*='form_of_address'], select[id*='Form_of_address']");
    return hits.length >= 2 || (hasName && hasCivility);
  }

  // =========================
  // 3) Mapping champs Lumesse
  // =========================
  async function fillPersonalInfo(profile) {
    await waitForElement("select[name='form_of_address']");

    selectByTextContains("select[name='custom_question_7344']", profile.sourceCandidature || "Avec mon CV");
    await sleep(150);

    selectByTextContains("select[name='form_of_address']", profile.civilite);
    fillInput("input[name='last_name']", profile.nom);
    fillInput("input[name='first_name']", profile.prenom);
    fillInput("input[name='e-mail_address']", profile.email);

    selectByTextContains("select[data-talentlink-apply-number='country_code']", `(${profile.phoneCountryCode})`);
    fillInput("input[data-talentlink-apply-number='phone_number']", profile.telephone);

    if (profile.linkedin) {
      fillInput("input[name='social_networking_and_instant_messaging_accounts_linkedin']", profile.linkedin);
    }

    selectByTextContains("select[name='custom_question_14065']", profile.autorisationTravailFrance || "OUI");
  }

  async function fillCv(profile) {
    if (!profile.cvStoragePath) {
      log("⏭️ Pas de cv_storage_path, upload CV ignoré");
      return;
    }
    const fileInputSelector =
      "form[id^='form_attached_resume_'] input[type='file'], input[id^='upload_attached_resume_'][type='file']";
    await waitForElement(fileInputSelector);
    const file = await fetchCvAsFileFromFirebase(profile.cvStoragePath, profile.cvFileName);
    injectFile(fileInputSelector, file);
  }

  // =========================
  // 4) Orchestrateur
  // =========================
  async function run() {
    if (running || done) return;

    const pending = await hasPendingBpce();
    const onBpceApplyHost =
      /oraclecloud\.com$/i.test(location.hostname || "") ||
      /recruitmentplatform\.com$/i.test(location.hostname || "");

    if (isTop && pending && onBpceApplyHost && document.body) {
      showBanner(
        "⏳ Taleos — chargement du formulaire de candidature BPCE… (ne fermez pas l’onglet)"
      );
      setPing("waiting_form", "profil OK, recherche des champs Lumesse");
    }

    if (!detectLumesseForm()) {
      if (pending && onBpceApplyHost) {
        const now = Date.now();
        if (now - lastWaitLog > 4000) {
          lastWaitLog = now;
          log(
            "⏳ Formulaire Lumesse pas encore détecté dans ce document (sélecteurs élargis). " +
              "Si la page affiche encore l’étape e-mail / code PIN, c’est normal — l’automatisation Oracle continue."
          );
          setPing("waiting_form", "pas de select[name=form_of_address] dans ce frame");
        }
      }
      return;
    }

    running = true;
    setPing("form_detected", "début remplissage");
    try {
      const raw = await getPendingBpceProfile();
      const profile = normalizeProfile(raw);
      showBanner("⏳ Taleos — remplissage du formulaire Lumesse…");
      log("🚀 Démarrage filler Lumesse");

      await fillPersonalInfo(profile);
      await sleep(300);
      await fillCv(profile);

      done = true;
      showBanner("✅ Taleos — formulaire Lumesse traité. Vérifiez les champs avant envoi.");
      log("✅ Filler Lumesse terminé.");
      setPing("done", "ok");
    } catch (e) {
      const msg = e?.message || String(e);
      log(`❌ ${msg}`);
      showBanner(`❌ Taleos Lumesse : ${msg.slice(0, 120)}`);
      setPing("error", msg.slice(0, 200));
    } finally {
      running = false;
    }
  }

  log("👁️ Script chargé, attente formulaire Lumesse…");
  const tick = () => {
    run().catch((e) => {
      running = false;
      log(`❌ ${e.message || e}`);
      setPing("error", String(e?.message || e).slice(0, 200));
    });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", tick, { once: true });
  tick();
  setInterval(tick, 1200);
  const mo = new MutationObserver(() => tick());
  if (document.body) mo.observe(document.body, { childList: true, subtree: true });
})();
