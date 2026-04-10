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
      /** Préférence Firebase `bpce_application_source` ; défaut BPCE Lumesse : formulaire sans pièce jointe CV. */
      sourceCandidature: String(raw.bpce_application_source || "Formulaire sans CV").trim(),
      /** Firebase : case « alertes opportunités » (bool). */
      jobAlerts: !!raw.bpce_job_alerts,
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

  setPing("loaded", isTop ? "frame principale" : "iframe");

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

  /** Remplit un champ texte ; journalise remplissage, skip si identique, ou échec. */
  function fillInput(selector, value, humanLabel) {
    const label = humanLabel || selector;
    const el = document.querySelector(selector);
    if (!el) {
      log(`⚠️ ${label} — élément introuvable : ${selector}`);
      return false;
    }
    if (value == null || value === "") {
      log(`⏭️ ${label} — valeur vide dans le profil (skip)`);
      return false;
    }
    const next = String(value).trim();
    const current = String(el.value || "").trim();
    if (current === next) {
      log(`⏭️ ${label} — déjà « ${next} » (skip)`);
      return true;
    }
    el.focus();
    el.value = next;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    log(`✅ ${label} — saisi « ${next} »`);
    return true;
  }

  function selectByTextContains(selector, wantedText, humanLabel) {
    const select = document.querySelector(selector);
    const label = humanLabel || selector;
    if (!select) {
      log(`⚠️ ${label} — liste déroulante introuvable : ${selector}`);
      return false;
    }
    return selectByTextContainsOnElement(select, wantedText, label);
  }

  /**
   * Sélectionne une option dont le libellé contient `wantedText` (insensible à la casse).
   * Journalise skip si l’option active correspond déjà.
   */
  function selectByTextContainsOnElement(select, wantedText, humanLabel) {
    if (!select || select.tagName !== "SELECT") {
      log(`⚠️ ${humanLabel || "Liste"} — élément SELECT invalide`);
      return false;
    }
    const label = humanLabel || select.getAttribute("name") || "Liste";
    const target = String(wantedText || "").toLowerCase().trim();
    if (!target) {
      log(`⚠️ ${label} — texte d’option attendu vide (skip)`);
      return false;
    }
    const curIdx = select.selectedIndex;
    const curOpt = curIdx >= 0 ? select.options[curIdx] : null;
    const curText = curOpt ? String(curOpt.textContent || "").toLowerCase().trim() : "";
    if (curText.includes(target)) {
      log(`⏭️ ${label} — déjà « ${(curOpt.textContent || "").trim().slice(0, 120)} » (correspond à « ${wantedText} », skip)`);
      return true;
    }
    const option = Array.from(select.options || []).find((o) =>
      String(o.textContent || "").toLowerCase().includes(target)
    );
    if (!option) {
      log(`⚠️ ${label} — aucune option ne contient « ${wantedText} » (options visibles : ${select.options.length})`);
      return false;
    }
    select.value = option.value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    log(`✅ ${label} — choisi « ${(option.textContent || "").trim().slice(0, 120)} »`);
    return true;
  }

  /**
   * Essaie plusieurs fragments l’un après l’auté ; une seule ligne de log en cas d’échec total
   * (évite le bruit quand plusieurs synonymes sont possibles).
   */
  function selectFirstMatchingFragment(select, fragments, humanLabel) {
    if (!select || select.tagName !== "SELECT") {
      log(`⚠️ ${humanLabel || "Liste"} — SELECT invalide`);
      return false;
    }
    const label = humanLabel || select.getAttribute("name") || "Liste";
    for (const fragment of fragments) {
      const target = String(fragment || "").toLowerCase().trim();
      if (!target) continue;
      const curIdx = select.selectedIndex;
      const curOpt = curIdx >= 0 ? select.options[curIdx] : null;
      const curText = curOpt ? String(curOpt.textContent || "").toLowerCase().trim() : "";
      if (curText.includes(target)) {
        log(
          `⏭️ ${label} — déjà « ${(curOpt.textContent || "").trim().slice(0, 120)} » (correspond à « ${fragment} », skip)`
        );
        return true;
      }
      const option = Array.from(select.options || []).find((o) =>
        String(o.textContent || "").toLowerCase().includes(target)
      );
      if (option) {
        select.value = option.value;
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
        log(
          `✅ ${label} — choisi « ${(option.textContent || "").trim().slice(0, 120)} » (critère : « ${fragment} »)`
        );
        return true;
      }
    }
    log(`⚠️ ${label} — aucune option ne correspond aux critères : ${fragments.map((f) => `« ${f} »`).join(", ")}`);
    return false;
  }

  /** Texte de la question associée au &lt;select&gt; (label / aria / conteneur). */
  function getQuestionLabelText(selectEl) {
    if (!selectEl) return "";
    const ids = (selectEl.getAttribute("aria-labelledby") || "").trim().split(/\s+/).filter(Boolean);
    if (ids.length) {
      const t = ids.map((id) => document.getElementById(id)?.textContent || "").join(" ").trim();
      if (t) return t;
    }
    const lid = selectEl.getAttribute("id");
    if (lid) {
      const lab = document.querySelector(`label[for="${CSS.escape(lid)}"]`);
      if (lab?.textContent) return lab.textContent.trim();
    }
    const container =
      selectEl.closest(".form-group, .form-row, .control-group, fieldset, [class*='form-control']") ||
      selectEl.parentElement?.parentElement;
    return (container?.textContent || "").trim();
  }

  /**
   * Questions RGPD / opportunités sur les custom_question_* (libellés variables selon l’offre).
   */
  function fillBpceCustomConsentSelects(profile) {
    const skipNames = new Set(["custom_question_7344", "custom_question_14065"]);
    for (const sel of document.querySelectorAll('select[name^="custom_question"]')) {
      const name = sel.getAttribute("name") || "";
      if (skipNames.has(name)) continue;
      const lab = getQuestionLabelText(sel);

      if (/gestion des données personnelles|données personnelles\s*\(obligatoire\)/i.test(lab)) {
        selectFirstMatchingFragment(sel, ["j'accepte", "accepte"], "Gestion des données personnelles (obligatoire)");
        continue;
      }

      if (
        /si vous souhaitez que l'on puisse vous proposer|nouvelles offres|mises à jour|nouvelles opportunit|informations sur nos métiers|correspondant à votre profil/i.test(
          lab
        )
      ) {
        const lbl = "Alertes opportunités / offres (bpce_job_alerts Firebase)";
        if (profile.jobAlerts) {
          selectFirstMatchingFragment(
            sel,
            [
              "j'accepte de recevoir les mises à jour",
              "mises à jour concernant les nouvelles opportunités",
              "nouvelles opportunités d'emploi",
              "groupe bpce",
              "j'accepte",
              "accepte",
            ],
            `${lbl} — intention : accepter`
          );
        } else {
          selectFirstMatchingFragment(sel, ["je refuse", "refus", "non", "n'accepte pas"], `${lbl} — intention : refuser`);
        }
        continue;
      }
    }
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

  function injectFile(inputSelector, file, humanLabel) {
    const label = humanLabel || "Pièce jointe CV";
    const input = document.querySelector(inputSelector);
    if (!input) {
      log(`⚠️ ${label} — champ fichier introuvable : ${inputSelector}`);
      return false;
    }
    if (!file) {
      log(`⚠️ ${label} — aucun fichier à injecter`);
      return false;
    }
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    log(`✅ ${label} — fichier attaché « ${file.name} » (${file.size} octets, ${file.type || "type ?"})`);
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
    log(
      `📋 Profil normalisé — mode : « ${profile.sourceCandidature} » | alertes emploi (Firebase) : ${profile.jobAlerts ? "oui" : "non"} | CV Firebase : ${profile.cvStoragePath ? "oui" : "non"}`
    );

    await waitForElement("select[name='form_of_address']");
    log("📋 Section champs identité / coordonnées…");

    selectByTextContains(
      "select[name='custom_question_7344']",
      profile.sourceCandidature || "Formulaire sans CV",
      "Comment souhaitez-vous postuler ?"
    );
    await sleep(200);

    selectByTextContains("select[name='form_of_address']", profile.civilite, "Civilité");
    fillInput("input[name='last_name']", profile.nom, "Nom");
    fillInput("input[name='first_name']", profile.prenom, "Prénom");
    fillInput("input[name='e-mail_address']", profile.email, "E-mail");

    selectByTextContains(
      "select[data-talentlink-apply-number='country_code']",
      `(${profile.phoneCountryCode})`,
      "Indicatif téléphone"
    );
    fillInput(
      "input[data-talentlink-apply-number='phone_number']",
      profile.telephone,
      "Numéro de téléphone (national)"
    );

    if (profile.linkedin) {
      fillInput(
        "input[name='social_networking_and_instant_messaging_accounts_linkedin']",
        profile.linkedin,
        "LinkedIn"
      );
    } else {
      log("⏭️ LinkedIn — vide dans le profil (skip)");
    }

    selectByTextContains(
      "select[name='custom_question_14065']",
      profile.autorisationTravailFrance || "OUI",
      "Autorisation de travail en France"
    );

    await sleep(200);
    log("📋 Consentements / questions complémentaires (RGPD, alertes)…");
    fillBpceCustomConsentSelects(profile);
  }

  async function fillCv(profile) {
    if (/formulaire sans cv|sans cv/i.test(profile.sourceCandidature || "")) {
      log("⏭️ Upload CV — mode « Formulaire sans CV », aucun fichier (skip)");
      return;
    }
    if (!profile.cvStoragePath) {
      log("⏭️ Upload CV — pas de cv_storage_path dans le profil (skip)");
      return;
    }
    log(`📎 Upload CV — téléchargement depuis Firebase : ${profile.cvStoragePath} (nom affiché : ${profile.cvFileName || "cv.pdf"})`);
    const fileInputSelector =
      "form[id^='form_attached_resume_'] input[type='file'], input[id^='upload_attached_resume_'][type='file']";
    await waitForElement(fileInputSelector);
    const file = await fetchCvAsFileFromFirebase(profile.cvStoragePath, profile.cvFileName);
    log(`📎 Upload CV — fichier reçu, injection dans le formulaire…`);
    injectFile(fileInputSelector, file, "Upload CV (pièce jointe)");
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
      log("🚀 Démarrage remplissage Lumesse (logs détaillés pour chaque champ)");

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
