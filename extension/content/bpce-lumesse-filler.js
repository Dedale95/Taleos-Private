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
  const bpceBlueprint = globalThis.__TALEOS_BPCE_BLUEPRINT__ || null;
  let running = false;
  /** Verrou synchrone pour éviter deux remplissages en parallèle (await avant running=true). */
  let filling = false;
  let done = false;
  let submitTriggered = false;
  let successSent = false;
  let lastWaitLog = 0;
  let lastPingPhase = "";
  let currentTabIdPromise = null;

  async function getCurrentTabId() {
    if (!currentTabIdPromise) {
      currentTabIdPromise = chrome.runtime.sendMessage({ action: 'taleos_get_current_tab_id' })
        .then((res) => res?.tabId || null)
        .catch(() => null);
    }
    return currentTabIdPromise;
  }

  async function getPendingBpceEntry() {
    const currentTabId = await getCurrentTabId();
    const { taleos_pending_bpce, taleos_bpce_tab_id } = await chrome.storage.local.get(["taleos_pending_bpce", "taleos_bpce_tab_id"]);
    if (!taleos_pending_bpce || !taleos_pending_bpce.profile) return null;
    const expectedTabId = taleos_pending_bpce.tabId || taleos_bpce_tab_id || null;
    if (!currentTabId || !expectedTabId || currentTabId !== expectedTabId) return null;
    return taleos_pending_bpce;
  }

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
    return !!(await getPendingBpceEntry());
  }

  async function getPendingBpceProfile() {
    const taleos_pending_bpce = await getPendingBpceEntry();
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
      /**
       * BPCE Lumesse / recruitmentplatform : toujours « Formulaire sans CV » (ne pas utiliser bpce_application_source LinkedIn ici).
       */
      sourceCandidature: "Formulaire sans CV",
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

  function normText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
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

  /** Texte de la question associée au &lt;select&gt; (label / aria / conteneur / bloc question). */
  function getQuestionLabelText(selectEl) {
    if (!selectEl) return "";
    const ids = (selectEl.getAttribute("aria-labelledby") || "").trim().split(/\s+/).filter(Boolean);
    if (ids.length) {
      const t = ids.map((id) => document.getElementById(id)?.textContent || "").join(" ").trim();
      if (t.length > 5) return t;
    }
    const aria = selectEl.getAttribute("aria-label");
    if (aria && aria.trim().length > 5) return aria.trim();
    const lid = selectEl.getAttribute("id");
    if (lid && typeof CSS !== "undefined" && CSS.escape) {
      try {
        const lab = document.querySelector(`label[for="${CSS.escape(lid)}"]`);
        if (lab?.textContent?.trim()) return lab.textContent.trim();
      } catch (_) {}
    }
    const fieldset = selectEl.closest("fieldset");
    const leg = fieldset?.querySelector("legend");
    if (leg?.textContent?.trim()) return leg.textContent.trim();

    const container =
      selectEl.closest(
        "[class*='question'], [class*='application'], .form-group, .form-row, .control-group, fieldset"
      ) || selectEl.parentElement?.parentElement;
    const inner = (container?.innerText || container?.textContent || "").trim();
    if (inner.length > 10) return inner.slice(0, 900);
    return inner;
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

      // 1) Origine de l’annonce (BPCE institutionnel)
      if (
        /sur quel site|consulté.*(première|1[eè]re|premiere|1\s*ère)\s*fois|site.*consulté|où.*consulté|annonce à laquelle vous postulez/i.test(
          lab
        )
      ) {
        selectFirstMatchingFragment(
          sel,
          ["Site institutionnel BPCE", "institutionnel BPCE", "site institutionnel", "BPCE"],
          "Sur quel site avez-vous consulté l’annonce ?"
        );
        continue;
      }

      // 2) Alertes emploi / métiers (texte long — avant RGPD pour éviter confusion)
      if (
        /si vous souhaitez que l'on puisse vous proposer|nouvelles offres d.?emploi|mises à jour.*opportunit|informations sur nos métiers|correspondant à votre profil|cliquez pour lire le texte complet/i.test(
          lab
        ) &&
        !/gestion des données personnelles|^données personnelles\s*\(obligatoire\)/i.test(lab)
      ) {
        const lbl = "Alertes opportunités / offres (bpce_job_alerts Firebase)";
        if (profile.jobAlerts) {
          selectFirstMatchingFragment(
            sel,
            [
              "j'accepte de recevoir les mises à jour concernant les nouvelles opportunités d'emploi",
              "mises à jour concernant les nouvelles opportunités d'emploi",
              "nouvelles opportunités d'emploi",
              "pour le groupe bpce",
              "groupe bpce",
              "j'accepte de recevoir les mises à jour",
              "j'accepte",
              "accepte",
            ],
            `${lbl} — intention : accepter`
          );
        } else {
          selectFirstMatchingFragment(
            sel,
            ["je n'accepte pas", "n'accepte pas", "je refuse", "refus", "non"],
            `${lbl} — intention : refuser`
          );
        }
        continue;
      }

      // 3) RGPD — gestion des données personnelles
      if (
        /gestion des données personnelles/i.test(lab) ||
        (/données personnelles/i.test(lab) &&
          /obligatoire/i.test(lab) &&
          !/nouvelles offres|mises à jour|opportunités|si vous souhaitez/i.test(lab))
      ) {
        selectFirstMatchingFragment(sel, ["j'accepte", "accepte"], "Gestion des données personnelles (obligatoire)");
        continue;
      }

      log(
        `⏭️ Liste ${name} — non classée automatiquement (libellé détecté : « ${lab.slice(0, 160).replace(/\s+/g, " ")}${lab.length > 160 ? "…" : ""} »)`
      );
    }
  }

  /** Si la plateforme utilise des radios pour les consentements (au lieu de &lt;select&gt;). */
  function fillBpceConsentRadioGroups(profile) {
    const blocks = document.querySelectorAll("fieldset, [role='group'], .form-group, [class*='question']");
    for (const block of blocks) {
      const t = (block.textContent || "").replace(/\s+/g, " ").trim();
      if (t.length < 20 || t.length > 1200) continue;

      const radios = block.querySelectorAll('input[type="radio"]');
      if (!radios.length) continue;

      if (/gestion des données personnelles/i.test(t) && !/nouvelles offres|mises à jour.*opportunit/i.test(t)) {
        for (const r of radios) {
          const rt = (r.closest("label")?.textContent || r.value || "").toLowerCase();
          const isRefuse = rt.includes("n'accepte pas") || rt.includes("je n'accepte");
          if ((rt.includes("j'accepte") || /^accepte\b/i.test(rt.trim())) && !isRefuse) {
            if (!r.checked) {
              r.click();
              log("✅ Gestion des données personnelles (radio) — « J'accepte »");
            } else log("⏭️ Gestion des données personnelles (radio) — déjà accepté (skip)");
            break;
          }
        }
        continue;
      }

      if (
        /si vous souhaitez que l'on puisse|nouvelles offres|mises à jour.*opportunit|informations sur nos métiers/i.test(t) &&
        !/consulté.*fois|sur quel site/i.test(t)
      ) {
        const wantAccept = profile.jobAlerts;
        for (const r of radios) {
          const rt = (r.closest("label")?.textContent || r.value || "").toLowerCase();
          const isRefuse =
            rt.includes("n'accepte pas") || rt.includes("je n'accepte") || /^refus|^non\b/i.test(rt.trim());
          const isAccept =
            /j'accepte de recevoir|mises à jour.*opportunit|pour le groupe bpce/i.test(rt) ||
            (rt.includes("j'accepte") && !isRefuse);
          if (wantAccept && isAccept && !isRefuse) {
            if (!r.checked) {
              r.click();
              log("✅ Alertes opportunités (radio) — acceptation (profil Firebase)");
            } else log("⏭️ Alertes opportunités (radio) — déjà accepté (skip)");
            break;
          }
          if (!wantAccept && isRefuse) {
            if (!r.checked) {
              r.click();
              log("✅ Alertes opportunités (radio) — refus (profil Firebase)");
            } else log("⏭️ Alertes opportunités (radio) — déjà refusé (skip)");
            break;
          }
        }
      }
    }
  }

  /** Blocs « Veuillez indiquer votre accord » (souvent des radios, pas des &lt;select&gt;). */
  function fillBpceVeuillezIndiquerAccord(profile) {
    const candidates = document.querySelectorAll(
      "fieldset, section, div[class*='question'], div[class*='application'], .application-question, [role='group']"
    );
    for (const sec of candidates) {
      const t = (sec.textContent || "").replace(/\s+/g, " ");
      if (!/veuillez indiquer votre accord/i.test(t)) continue;

      const isGdpr =
        /gestion des données personnelles|exploitation de vos données personnelles|principes d.exploitation/i.test(
          t
        ) && /données personnelles/i.test(t);
      const isJobs =
        /nouvelles offres|informations sur nos métiers|correspondant à votre profil|envoyer des informations sur nos métiers/i.test(
          t
        ) && !/exploitation de vos données personnelles|gestion des données personnelles/i.test(t);

      if (isGdpr) {
        clickAcceptRadiosInContainer(sec, "Accord — gestion des données personnelles (RGPD)", true);
        continue;
      }
      if (isJobs) {
        clickAcceptRadiosInContainer(
          sec,
          "Accord — offres d'emploi / métiers (bpce_job_alerts)",
          !!profile.jobAlerts
        );
        continue;
      }
    }
  }

  function fillBpceDirectDpsSelects() {
    const selects = Array.from(document.querySelectorAll('select[name="dps"]'));
    if (!selects.length) return;
    let matched = 0;
    for (const sel of selects) {
      const label = getQuestionLabelText(sel);
      const logLabel =
        /gestion des données personnelles|principes d.exploitation|donnees personnelles/i.test(label)
          ? "Gestion des données personnelles (obligatoire)"
          : "Accord données personnelles";
      const ok = selectFirstMatchingFragment(sel, ["j'accepte", "accepte"], logLabel);
      if (ok) matched++;
    }
    if (!matched) {
      log("⚠️ Gestion des données personnelles — select[name='dps'] détecté mais aucune option d'accord reconnue");
    }
  }

  function clickAcceptRadiosInContainer(container, logLabel, wantAccept) {
    const radios = container.querySelectorAll('input[type="radio"]');
    if (!radios.length) return;

    for (const r of radios) {
      const raw = (r.closest("label")?.textContent || r.getAttribute("aria-label") || r.value || "").trim();
      const low = raw.toLowerCase();
      const isNeg =
        low.includes("n'accepte pas") ||
        low.includes("je n'accepte") ||
        /^non\b/i.test(low) ||
        low.includes("refus");
      const isPos =
        !isNeg &&
        ((/j'accepte/i.test(raw) && !/n'accepte/i.test(raw)) ||
          /^oui\s*$/i.test(raw.trim()) ||
          /^accepte\s*$/i.test(low));

      if (wantAccept && isPos) {
        if (!r.checked) {
          r.click();
          log(`✅ ${logLabel} — option « ${raw.slice(0, 100)} »`);
        } else log(`⏭️ ${logLabel} — déjà « ${raw.slice(0, 80)} » (skip)`);
        return;
      }
      if (!wantAccept && isNeg) {
        if (!r.checked) {
          r.click();
          log(`✅ ${logLabel} — refus « ${raw.slice(0, 100)} »`);
        } else log(`⏭️ ${logLabel} — déjà refus (skip)`);
        return;
      }
    }

    if (wantAccept && radios.length) {
      const first = radios[0];
      if (!first.checked) {
        first.click();
        log(`⚠️ ${logLabel} — premier bouton radio coché (fallback, libellés non reconnus)`);
      }
    }
  }

  /** Cases « Préférences de communication » (email BPCE, évènements…). */
  function fillBpceCommunicationPreferences(profile) {
    const want = !!profile.jobAlerts;
    if (!want) {
      log("⏭️ Préférences communication — bpce_job_alerts = non, pas de cases « oui » cochées");
      return;
    }

    const header = Array.from(
      document.querySelectorAll("h1, h2, h3, h4, legend, strong, .section-title, [class*='title'], [class*='heading'], .panel-title")
    ).find((h) => /préférences de communication/i.test(h.textContent || ""));
    let root =
      header?.closest("section, fieldset, form, div[class*='section'], div[class*='panel'], .application-body") ||
      document.body;
    if (!header) {
      log("⚠️ Préférences communication — titre de section introuvable, recherche des cases sur toute la page");
    }

    let n = 0;
    for (const cb of root.querySelectorAll('input[type="checkbox"]')) {
      if (cb.disabled || cb.checked) continue;
      const row = (cb.closest("tr, li, .form-group, label, td")?.textContent || "").replace(/\s+/g, " ");
      if (
        /évènements|communications diverses|communications par email|forums|salons|offres d.emploi correspondant|entreprises du groupe bpce|adresse email/i.test(
          row
        )
      ) {
        cb.click();
        n++;
        log(`✅ Préférences communication — case cochée (${row.slice(0, 100).trim()}…)`);
      }
    }

    for (const r of root.querySelectorAll('input[type="radio"]')) {
      if (r.disabled || r.checked) continue;
      const lab = (r.closest("label")?.textContent || "").trim().toLowerCase();
      const row = (r.closest("tr, .form-group, fieldset, li, td")?.textContent || "").replace(/\s+/g, " ");
      if (
        /adresse email|communication|groupe bpce|email/i.test(row) &&
        (lab === "oui" || /^oui\b/.test(lab))
      ) {
        r.click();
        n++;
        log("✅ Préférences communication — « Oui » (ligne email / communications)");
      }
    }

    if (!n) log("⏭️ Préférences communication — rien à cocher de nouveau (déjà fait ou structure inconnue)");
  }

  /** Passe plusieurs fois : sections parfois injectées après l’identité. */
  async function fillAllConsentAndCommunication(profile) {
    log("📋 Préférences de communication, listes custom_question & accords (plusieurs passes DOM)…");
    for (let pass = 1; pass <= 7; pass++) {
      try {
        document.querySelector(".application-body, main, form, #content")?.scrollTo?.(0, 99999);
      } catch (_) {}
      window.scrollTo?.(0, document.body?.scrollHeight || 99999);

      fillBpceCustomConsentSelects(profile);
      fillBpceDirectDpsSelects();
      fillBpceConsentRadioGroups(profile);
      fillBpceCommunicationPreferences(profile);
      fillBpceVeuillezIndiquerAccord(profile);

      if (pass < 7) await sleep(550);
    }
  }

  function getVisibleInvalidElements() {
    return Array.from(document.querySelectorAll(":invalid")).filter((el) => el.offsetParent !== null);
  }

  function getInvalidFieldHints() {
    return getVisibleInvalidElements()
      .map((el) => getQuestionLabelText(el) || el.getAttribute("name") || el.id || el.tagName)
      .filter(Boolean)
      .slice(0, 8);
  }

  function findSubmitControl() {
    return (
      Array.from(document.querySelectorAll('input[type="submit"], button[type="submit"], button')).find((el) => {
        if (el.offsetParent === null || el.disabled) return false;
        const text = normText(el.textContent || el.value || el.getAttribute("aria-label") || "");
        return /soumettre|envoyer|postuler|submit/.test(text);
      }) || null
    );
  }

  function detectLumesseSuccess() {
    const text = normText(document.body?.innerText || document.body?.textContent || "");
    return (
      !detectLumesseForm() &&
      /merci|candidature envoyee|application submitted|thank you for applying|votre candidature a bien ete envoyee|nous avons bien recu/.test(text)
    );
  }

  async function maybeNotifyLumesseSuccess() {
    if (successSent || !detectLumesseSuccess()) return;
    successSent = true;
    const taleos_pending_bpce = await getPendingBpceEntry();
    const pending = taleos_pending_bpce || {};
    log("🎉 Confirmation Lumesse détectée — notification de succès à Taleos");
    chrome.runtime.sendMessage({
      action: "candidature_success",
      bankId: "bpce",
      jobId: pending.jobId || "",
      jobTitle: pending.jobTitle || "",
      companyName: pending.companyName || "BPCE",
      offerUrl: pending.offerUrl || location.href
    }).catch((e) => log(`⚠️ Notification Taleos impossible: ${e?.message || e}`));
  }

  async function maybeSubmitLumesseApplication(rawProfile) {
    if (submitTriggered) return;
    const invalidHints = getInvalidFieldHints();
    if (invalidHints.length) {
      log(`⚠️ Soumission Lumesse bloquée — champs invalides visibles : ${invalidHints.join(" | ")}`);
      return;
    }
    const submit = findSubmitControl();
    if (!submit) {
      log("⚠️ Soumission Lumesse — bouton Soumettre introuvable");
      return;
    }
    submitTriggered = true;
    const label = (submit.textContent || submit.value || "Soumettre").trim();
    log(`🚀 Soumission Lumesse — clic sur « ${label} »`);
    submit.click();
    chrome.runtime.sendMessage({
      action: 'track_event',
      eventName: 'apply_success',
      params: { site: 'bpce' },
      userId: rawProfile?.uid
    }).catch(() => {});
    await sleep(3000);
    const remaining = getInvalidFieldHints();
    if (remaining.length) {
      submitTriggered = false;
      log(`⚠️ Après clic Soumettre, des champs restent invalides : ${remaining.join(" | ")}`);
      return;
    }
    log("⏳ Soumission Lumesse lancée — attente de la confirmation finale…");
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
      `📋 Profil — mode « Comment postuler ? » : « ${profile.sourceCandidature} » (imposé Lumesse, indép. Firebase) | alertes emploi : ${profile.jobAlerts ? "oui" : "non"} | CV en base : ${profile.cvStoragePath ? "oui" : "non"}`
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

  }

  /**
   * Liste déroulante « Formulaire sans CV » = sans pièce jointe obligatoire dans l’UI,
   * mais si un CV est en base Firebase on l’envoie quand même.
   */
  async function fillCv(profile) {
    if (!profile.cvStoragePath) {
      log("⏭️ Upload CV — pas de cv_storage_path dans le profil (skip)");
      return;
    }
    log(
      `📎 Upload CV — envoi du fichier Firebase (liste « ${profile.sourceCandidature} » n’empêche pas l’upload si CV présent)`
    );
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
    await maybeNotifyLumesseSuccess();
    if (successSent) return;
    if (filling || done) return;

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

    if (bpceBlueprint) {
      const pageValidation = bpceBlueprint.validatePage('lumesse_form');
      await bpceBlueprint.logCheck('bpce_lumesse_form_detected', {
        expected: ['lumesse_form'],
        detected: pageValidation.detected.page
      });
      const report = bpceBlueprint.getLumesseStructureReport();
      await bpceBlueprint.logCheck('Structure lumesse formulaire', report);
      if (!pageValidation.ok || !report.ok) {
        log(`❌ Blueprint Lumesse mismatch : ${pageValidation.detected.page}`);
        setPing("error", `blueprint mismatch ${pageValidation.detected.page}`);
        return;
      }
      if (typeof bpceBlueprint.getLumesseQuestionAudit === 'function') {
        const audit = bpceBlueprint.getLumesseQuestionAudit();
        await bpceBlueprint.logCheck('Questions lumesse formulaire', audit);
      }
    }

    if (filling || done) return;
    filling = true;
    running = true;
    setPing("form_detected", "début remplissage");
    try {
      const raw = await getPendingBpceProfile();
      const profile = normalizeProfile(raw);
      showBanner("⏳ Taleos — remplissage du formulaire Lumesse…");
      log("🚀 Démarrage remplissage Lumesse (logs détaillés pour chaque champ)");

      await fillPersonalInfo(profile);
      await sleep(250);
      await fillCv(profile);
      await fillAllConsentAndCommunication(profile);
      await maybeSubmitLumesseApplication(raw);

      if (submitTriggered) {
        done = true;
        showBanner("✅ Taleos — formulaire Lumesse traité. Soumission en cours ou terminée.");
        log("✅ Filler Lumesse terminé.");
        setPing("done", "ok");
      } else {
        showBanner("⚠️ Taleos — formulaire rempli mais soumission bloquée par un champ requis.");
        log("⚠️ Filler Lumesse terminé, mais la soumission n'a pas pu partir.");
        setPing("waiting_submit", "champ requis restant ou bouton indisponible");
      }
    } catch (e) {
      const msg = e?.message || String(e);
      log(`❌ ${msg}`);
      showBanner(`❌ Taleos Lumesse : ${msg.slice(0, 120)}`);
      setPing("error", msg.slice(0, 200));
    } finally {
      running = false;
      filling = false;
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
