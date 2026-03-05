/**
 * Taleos - Automatisation Société Générale (socgen.taleo.net)
 * Flux : Login → Reset draft (si présent) → Skip étapes → Profil → CV → Envoi
 */
(function() {
  'use strict';

  const delay = ms => new Promise(r => setTimeout(r, ms));

  function log(msg) {
    const t = new Date().toLocaleTimeString('fr-FR');
    console.log(`[${t}] [Taleos SG] ${msg}`);
  }

  const BANNER_ID = 'taleos-sg-automation-banner';
  function showBanner() {
    if (document.getElementById(BANNER_ID)) return;
    const banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.innerHTML = '⚠️ Automatisation Taleos en cours — Ne touchez à rien, cela pourrait perturber le processus.';
    Object.assign(banner.style, {
      position: 'fixed', top: '0', left: '0', right: '0', zIndex: '2147483647',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white',
      padding: '10px 20px', fontSize: '14px', fontWeight: '600', textAlign: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      boxShadow: '0 2px 10px rgba(0,0,0,0.2)'
    });
    const root = document.body || document.documentElement;
    if (root) (root.firstChild ? root.insertBefore(banner, root.firstChild) : root.appendChild(banner));
  }

  function getSearchRoots() {
    const roots = [document];
    try {
      if (window.parent !== window && window.parent.document) roots.push(window.parent.document);
      const iframes = document.querySelectorAll('iframe');
      for (const f of iframes) {
        try {
          if (f.contentDocument) roots.push(f.contentDocument);
        } catch (_) {}
      }
    } catch (_) {}
    return roots;
  }

  function findByIdContains(partialId) {
    const sel = `input[id*="${partialId}"], input[name*="${partialId}"], a[id*="${partialId}"]`;
    for (const root of getSearchRoots()) {
      const el = root.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function findAllByIdContains(partialId) {
    return Array.from(document.querySelectorAll(`input[id*="${partialId}"], input[name*="${partialId}"]`));
  }

  async function setFileInputFromStorage(inputEl, storagePath, filename) {
    if (!inputEl || !storagePath) return false;
    try {
      const r = await new Promise(resolve => {
        chrome.runtime.sendMessage({ action: 'fetch_storage_file', storagePath }, resolve);
      });
      if (r?.error) throw new Error(r.error);
      if (!r?.base64) return false;
      const bin = atob(r.base64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const blob = new Blob([arr], { type: r.type || 'application/pdf' });
      const file = new File([blob], filename || 'cv.pdf', { type: blob.type });
      const dt = new DataTransfer();
      dt.items.add(file);
      inputEl.files = dt.files;
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    } catch (e) {
      log(`❌ Erreur upload fichier: ${e.message}`);
      return false;
    }
  }

  function dismissCookieBanner() {
    try {
      const host = document.querySelector('#didomi-host');
      const btn = host?.shadowRoot?.querySelector('#didomi-notice-disagree-button') ||
        document.querySelector('#didomi-notice-disagree-button') ||
        document.querySelector('button[class*="didomi"]');
      if (btn && btn.offsetParent !== null) {
        btn.click();
        return true;
      }
      document.body.style.setProperty('overflow', 'auto', 'important');
    } catch (_) {}
    return false;
  }

  async function main(profile) {
    log(`>>> main() appelé - frame: ${window === window.top ? 'main' : 'iframe'}, URL: ${(location.href || '').slice(0, 70)}...`);
    if (window !== window.top) {
      await delay(2000);
      const hasForm = !!(findByIdContains('FirstName') || findByIdContains('personal_info_FirstName'));
      if (!hasForm) return;
    }
    const loginName = document.querySelector('#dialogTemplate-dialogForm-login-name1') ||
      findByIdContains('login-name1') || findByIdContains('login-name');
    const loginPass = document.querySelector('#dialogTemplate-dialogForm-login-password') ||
      findByIdContains('login-password');
    const hasLoginForm = loginName && loginPass && loginName.offsetParent !== null && loginPass.offsetParent !== null;

    const url = (window.location?.href || '').toLowerCase();
    const isJobapply = url.includes('jobapply') || (window === window.top && url.includes('socgen.taleo.net'));
    if (isJobapply && !hasLoginForm) {
      log('   📄 Page candidature (sans formulaire de connexion) – attente du formulaire...');
      for (let w = 0; w < 5; w++) {
        const hasForm = findByIdContains('FirstName') || findByIdContains('personal_info_FirstName') ||
          findByIdContains('saveContinueCmdBottom');
        if (hasForm) {
          if (w > 0) log('   ✅ Formulaire chargé.');
          break;
        }
        log(`   ⏳ (${w + 1}/5)`);
        await delay(1500);
      }
    } else if (hasLoginForm) {
      log('   📄 Formulaire de connexion détecté – remplissage immédiat.');
    }
    showBanner();
    const jobId = profile.__jobId || '';
    const jobTitle = profile.__jobTitle || '';
    const companyName = profile.__companyName || 'Société Générale';
    const offerUrl = profile.__offerUrl || '';

    log('🚀 DÉMARRAGE AUTOMATISATION SOCIÉTÉ GÉNÉRALE');

    try {
      dismissCookieBanner();
      await delay(800);

      const loginName = document.querySelector('#dialogTemplate-dialogForm-login-name1') ||
        findByIdContains('login-name1') || findByIdContains('login-name');
      const loginPass = document.querySelector('#dialogTemplate-dialogForm-login-password') ||
        findByIdContains('login-password');
      const loginSubmit = document.querySelector('#dialogTemplate-dialogForm-login-defaultCmd') ||
        document.querySelector('input[id*="login-defaultCmd"]');

      if (loginName && loginPass && profile.auth_email && profile.auth_password) {
        log('🔑 Connexion Taleo...');
        loginName.focus();
        loginName.value = profile.auth_email;
        loginName.dispatchEvent(new Event('input', { bubbles: true }));
        await delay(100);
        loginPass.value = profile.auth_password;
        loginPass.dispatchEvent(new Event('input', { bubbles: true }));
        await delay(200);
        if (loginSubmit) {
          loginSubmit.click();
          log('   ✅ Connexion envoyée.');
        }
        await delay(6000);
      }

      function isFlowPage() {
        const url = (window.top?.location?.href || window.location?.href || '').toLowerCase();
        return url.includes('flow.jsf');
      }

      // Ne faire le reset que depuis la frame principale (éviter que l'iframe about:blank déclenche un reset en boucle)
      let resetLink = null;
      if (window === window.top && !isFlowPage()) {
        for (const root of getSearchRoots()) {
          resetLink = root.querySelector?.('a[id*="dtGotoPageLink"]');
          if (resetLink) break;
        }
        if (resetLink && resetLink.offsetParent !== null) {
          log('🔄 Reset du formulaire (draft détecté)...');
          resetLink.click();
          await delay(5000);
        }
      }

      function isPiecesJointesPage() {
        for (const root of getSearchRoots()) {
          const txt = (root.body?.innerText || root.body?.innerHTML || root.documentElement?.innerHTML || '').toLowerCase();
          if (/pièces jointes|attached files|attachedfilesblock|choisir un fichier|joindre/i.test(txt)) return true;
        }
        return false;
      }

      function findFlowStartOrContinueBtn() {
        const exclude = (el) => {
          if (el.closest?.('table')) return true;
          const t = ((el.textContent || el.innerText || el.value || '').trim()).toLowerCase();
          return /\.pdf|erreur|error|supprimer|delete|resume -/i.test(t);
        };
        for (const root of getSearchRoots()) {
          const byId = root.querySelector?.('input[id*="saveContinueCmdBottom"]');
          if (byId && byId.offsetParent !== null && !exclude(byId)) return byId;
          const btns = root.querySelectorAll?.('input[type="button"][value*="Sauvegarder"], input[type="submit"][value*="Sauvegarder"], button') || [];
          for (const el of btns) {
            if (!el || el.offsetParent === null || exclude(el)) continue;
            const t = ((el.value || el.textContent || '').trim()).toLowerCase();
            if (/sauvegarder et continuer|save and continue/i.test(t)) return el;
          }
        }
        return null;
      }

      if (window === window.top && isFlowPage() && !isPiecesJointesPage()) {
        log('   📄 Page flow.jsf détectée (après reset)...');
        await delay(2000);
        const flowBtn = findFlowStartOrContinueBtn();
        if (flowBtn) {
          log(`   🖱️ Clic pour démarrer le flux (${(flowBtn.value || flowBtn.textContent || '').trim().slice(0, 40)})...`);
          flowBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
          await delay(500);
          flowBtn.click();
          await delay(5000);
        } else {
          log('   ⚠️ Aucun bouton "Commencer/Continuer" trouvé sur flow.jsf.');
        }
      }

      function findDisclaimerCheckbox() {
        for (const root of getSearchRoots()) {
          const cbs = root.querySelectorAll?.('input[type="checkbox"]') || [];
          for (const cb of cbs) {
            const label = cb.closest('label') || root.querySelector?.(`label[for="${cb.id}"]`);
            const txt = ((label?.textContent || cb.getAttribute('aria-label') || '') + (cb.value || '')).toLowerCase();
            if (/accept|accepter|agree|consent|disclaimer|déclaration|confirm/i.test(txt) && cb.offsetParent !== null) return cb;
          }
        }
        return null;
      }

      function isConfidentialityAgreementPage() {
        const txt = (document.title + ' ' + (document.body?.innerText || '') + ' ' + (document.body?.innerHTML || '')).toLowerCase();
        return /accord de confidentialit|confidentiality agreement|vertraulichkeitsvereinbarung|acuerdo de confidencialidad|accordo di riservatezza/i.test(txt);
      }

      function findDisclaimerOrContinueBtn() {
        for (const root of getSearchRoots()) {
          const exactIds = [
            'et-ef-content-flowTemplate-LegalDisclaimerPage-legalDisclaimerContinueButton',
            'legalDisclaimerContinueButton'
          ];
          for (const id of exactIds) {
            const el = root.getElementById?.(id) || root.querySelector?.(`input[id*="${id}"], button[id*="${id}"]`);
            if (el && el.offsetParent !== null) return el;
          }
          const byId = [
            'legalDisclaimerAcceptButton',
            'legalDisclaimer',
            'saveContinueCmdBottom',
            'legalDisclaimerContinue',
            'disclaimerContinue'
          ];
          for (const partial of byId) {
            const el = root.querySelector?.(`input[id*="${partial}"], button[id*="${partial}"], a[id*="${partial}"]`);
            if (el && el.offsetParent !== null) return el;
          }
          const byValue = [
            "J'ai lu", "I have read", "I've read", "I read", "Read", "Lu", "Gelesen", "He leído", "Ho letto",
            'Continue', 'Continuer', 'Accept', 'Accepter', "J'accepte", 'I accept', 'Next', 'Suivant'
          ];
          for (const val of byValue) {
            const el = root.querySelector?.(`input[value="${val}"], input[value*="${val}"], button[value="${val}"], button[value*="${val}"]`);
            if (el && el.offsetParent !== null) return el;
          }
          const readBtns = root.querySelectorAll?.('input[type="button"][value], input[type="submit"][value], button[value]') || [];
          for (const b of readBtns) {
            const t = ((b.value || b.textContent || b.title || '') + '').toLowerCase();
            if (/\b(read|lu|gelesen|leído|letto)\b/i.test(t) && b.offsetParent !== null) return b;
          }
          const btns = root.querySelectorAll?.('input[type="submit"], input[type="button"], button, a[role="button"]') || [];
          for (const b of btns) {
            const t = ((b.value || b.textContent || '').trim()).toLowerCase();
            if (/continue|continuer|accept|accepter|suivant|next|valider|submit/i.test(t) && b.offsetParent !== null) return b;
          }
          const exactTexts = ["j'ai lu", "i have read", "gelesen", "he leído", "ho letto"];
          const clickables = root.querySelectorAll?.('a, button, input[type="button"], input[type="submit"], span[role="button"]') || [];
          for (const el of clickables) {
            if (!el || el.offsetParent === null) continue;
            const t = ((el.value || el.textContent || el.innerText || '').trim()).toLowerCase();
            if (exactTexts.some(txt => t.includes(txt))) return el;
          }
        }
        return null;
      }

      log('📋 Validation du disclaimer de candidature (peut apparaître 2 fois)...');
      let confidentialityPageLogged = false;
      for (let i = 0; i < 25; i++) {
        if (isPiecesJointesPage()) {
          log('   📄 Page PIÈCES JOINTES détectée – passage direct au CV.');
          break;
        }
        const firstNameInput = findByIdContains('personal_info_FirstName') || findByIdContains('FirstName');
        if (firstNameInput && firstNameInput.offsetParent !== null) {
          log('   ✅ Formulaire profil atteint.');
          break;
        }
        if (isConfidentialityAgreementPage() && !confidentialityPageLogged) {
          log('   📄 Page "Accord de confidentialité" détectée → clic sur "J\'ai lu".');
          confidentialityPageLogged = true;
        }
        const chk = findDisclaimerCheckbox();
        if (chk && !chk.checked) {
          log('   ☑️ Coche du disclaimer...');
          chk.click();
          await delay(1500);
        }
        const btn = findDisclaimerOrContinueBtn();
        if (btn) {
          log(`   🖱️ Clic disclaimer ${i + 1} (${(btn.value || btn.textContent || '').trim().slice(0, 30)})...`);
          btn.scrollIntoView({ behavior: 'instant', block: 'center' });
          await delay(300);
          btn.focus();
          if (typeof window.cmdSubmit === 'function' && btn.id) {
            try { window.cmdSubmit('et-ef', btn.id, null, null, true); } catch (_) { btn.click(); }
          } else {
            btn.click();
          }
          await delay(4500);
        } else {
          await delay(2000);
        }
      }

      function isInformationsPersonnellesPage() {
        const txt = (document.title + ' ' + (document.body?.innerText || '')).toLowerCase();
        return /informations personnelles|personal information|persönliche angaben|información personal|informazioni personali/i.test(txt);
      }

      function auditAndSetInput(inputEl, firebaseVal, label) {
        if (!inputEl) return;
        const current = (inputEl.value || '').trim();
        const expected = (firebaseVal || '').trim();
        if (expected === current) {
          log(`   ✅ ${label} : Aucune modification nécessaire (identique à Firebase).`);
          return;
        }
        log(`   ✏️ ${label} : Modification "${current || '(vide)'}" → "${expected}" (Firebase).`);
        inputEl.value = expected;
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      }

      async function auditAndSetCivility(expectedVal) {
        const expected = (expectedVal || '').trim();
        if (!expected) return;
        let chosenSpan = null, sel = null;
        for (const root of getSearchRoots()) {
          chosenSpan = chosenSpan || root.querySelector?.('#select2-chosen-1, .select2-chosen[id*="chosen"], span.select2-chosen');
          sel = sel || root.querySelector?.('select[id*="PersonalTitle"], select[name*="PersonalTitle"], select[id*="Title"][id*="personal"], select[id*="civility"]') ||
            Array.from(root.querySelectorAll?.('select') || []).find(s => {
              const opts = Array.from(s.options || []);
              return opts.some(o => /monsieur|madame/i.test(o.text || o.value));
            });
        }
        const current = (chosenSpan?.textContent || '').trim();
        if (current && expected && (current.toLowerCase() === expected.toLowerCase() || current.toLowerCase().includes(expected.toLowerCase()))) {
          log('   ✅ Civilité (Monsieur/Madame) : Aucune modification nécessaire (identique à Firebase).');
          return;
        }
        if (!sel) {
          log('   ⚠️ Civilité : Select non trouvé, skip.');
          return;
        }
        const opt = Array.from(sel.options || []).find(o =>
          (o.text || '').trim().toLowerCase() === expected.toLowerCase() ||
          (o.value || '').trim().toLowerCase() === expected.toLowerCase()
        );
        if (opt) {
          log(`   ✏️ Civilité : Modification "${current || '(vide)'}" → "${expected}" (Firebase).`);
          sel.value = opt.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          if (typeof jQuery !== 'undefined' && jQuery(sel).data('select2')) {
            try { jQuery(sel).trigger('change'); } catch (_) {}
          }
        } else {
          const container = sel.closest('.select2-container') || document.querySelector('.select2-container');
          if (container) {
            log(`   ✏️ Civilité : Ouverture select2 pour sélectionner "${expected}".`);
            container.click();
            await delay(600);
            const li = Array.from(document.querySelectorAll('.select2-results li, .select2-result, [id*="select2-result"]')).find(el =>
              (el.textContent || '').trim().toLowerCase().includes(expected.toLowerCase())
            );
            if (li) {
              li.click();
              await delay(400);
            } else {
              log(`   ⚠️ Civilité : Option "${expected}" non trouvée.`);
            }
          } else {
            log(`   ⚠️ Civilité : Option "${expected}" non trouvée dans le select.`);
          }
        }
      }

      if (!isPiecesJointesPage()) {
      log('📝 Remplissage du profil...');
      if (isInformationsPersonnellesPage()) {
        log('   📄 Page "Informations personnelles" détectée.');
      }
      const fn = findByIdContains('personal_info_FirstName') || findByIdContains('FirstName');
      const ln = findByIdContains('personal_info_LastName') || findByIdContains('LastName');
      const email = findByIdContains('personal_info_EmailAddress') || findByIdContains('EmailAddress');
      const phone = findByIdContains('personal_info_MobilePhone') || findByIdContains('MobilePhone');

      await auditAndSetCivility(profile.civility);
      auditAndSetInput(fn, profile.firstname || profile.first_name, 'Prénom');
      auditAndSetInput(ln, profile.lastname || profile.last_name, 'Nom');
      auditAndSetInput(email, profile.email || profile.auth_email || '', 'Email');
      auditAndSetInput(phone, profile['phone-number'] || profile.phone || '', 'Téléphone');

      for (const root of getSearchRoots()) {
        const personalInputs = root.querySelectorAll?.('input[id*="personal_info"], input[name*="personal_info"], input[id*="candidate_personal"]') || [];
        for (const inp of personalInputs) {
          if (inp.type === 'text' && !inp.value?.trim() && inp.offsetParent !== null) {
            const isRequired = inp.required || inp.getAttribute?.('aria-required') === 'true' ||
              (inp.closest?.('label')?.textContent || '').includes('*') ||
              /obligatoire|required/i.test(inp.getAttribute?.('aria-label') || '');
            if (isRequired || /maiden|jeunefille|formerlast|secondname|middlename/i.test((inp.id || inp.name || '').toLowerCase())) {
              inp.value = '-';
              inp.dispatchEvent(new Event('input', { bubbles: true }));
              inp.dispatchEvent(new Event('blur', { bubbles: true }));
              log(`   ✏️ Champ vide rempli (${(inp.id || inp.name || '?').slice(-40)}) : "-"`);
            }
          }
        }
      }
      [fn, ln, email, phone].filter(Boolean).forEach(el => {
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      });
      await delay(500);
      let saveProfile = null;
      for (const root of getSearchRoots()) {
        saveProfile = root.getElementById?.('et-ef-content-ftf-saveContinueCmdBottom') ||
          root.querySelector?.('input[id*="saveContinueCmdBottom"]') ||
          Array.from(root.querySelectorAll?.('input[type="button"], input[type="submit"], button') || []).find(el =>
            /sauvegarder et continuer|save and continue|save.*continue/i.test((el.value || el.textContent || '').trim())
          );
        if (saveProfile) break;
      }
      if (saveProfile) {
        log('   🖱️ Clic "Sauvegarder et continuer"...');
        saveProfile.scrollIntoView({ behavior: 'instant', block: 'center' });
        await delay(300);
        if (typeof window.cmdSubmit === 'function') {
          try { window.cmdSubmit('et-ef', 'et-ef-content-ftf-saveContinueCmdBottom', 'getOnClickAction()', null, true); } catch (_) { saveProfile.click(); }
        } else {
          saveProfile.click();
        }
        log('   ✅ Profil validé.');
      }
      await delay(5000);
      }

      log('📤 Étape CV...');
      const cvInput = document.querySelector('input[id*="AttachedFilesBlock-uploadedFile"]') ||
        document.querySelector('input[id*="uploadedFile"]');
      await delay(3000);

      // Si on ne télécharge pas de CV : cocher "Télécharger mon CV PLUS TARD" puis sauvegarder
      if (!profile.cv_storage_path) {
        let skipRadio = null, saveCvBtn = null;
        for (const root of getSearchRoots()) {
          if (!skipRadio) skipRadio = root.querySelector?.('input[id*="skipResumeUploadRadio"][value="1"]') || root.querySelector?.('input[name*="skipResumeUploadRadio"][value="1"]');
          if (!saveCvBtn) {
            saveCvBtn = root.getElementById?.('editTemplateMultipart-editForm-content-ftf-saveContinueCmdBottom') || root.querySelector?.('input[id*="saveContinueCmdBottom"]');
            if (!saveCvBtn) {
              saveCvBtn = Array.from(root.querySelectorAll?.('input[type="button"], input[type="submit"], button') || []).find(el =>
                /sauvegarder et continuer|save and continue/i.test((el.value || el.textContent || '').trim())
              );
            }
          }
        }
        if (skipRadio && !skipRadio.checked) {
          log('   ☑️ Coche "Télécharger mon CV PLUS TARD"...');
          skipRadio.click();
          await delay(800);
        } else if (skipRadio) {
          log('   ✅ "Télécharger mon CV PLUS TARD" déjà coché.');
        }
        if (saveCvBtn) {
          log('   🖱️ Clic "Sauvegarder et continuer"...');
          saveCvBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
          await delay(300);
          if (typeof window.cmdSubmit === 'function') {
            try { window.cmdSubmit('editTemplateMultipart-editForm', 'editTemplateMultipart-editForm-content-ftf-saveContinueCmdBottom', 'getOnClickAction()', null, true); } catch (_) { saveCvBtn.click(); }
          } else {
            saveCvBtn.click();
          }
          await delay(5000);
        }
      } else {
        // Éviter de supprimer le CV qu'on vient d'uploader (re-run après erreur de validation)
        const UPLOAD_COOLDOWN = 120000;
        const lastUpload = parseInt(sessionStorage.getItem('taleos_cv_uploaded_at') || '0', 10);
        const skipDeleteAndUpload = (Date.now() - lastUpload < UPLOAD_COOLDOWN);

        // Supprimer TOUS les documents existants – le clic Supprimer provoque une nav, le popup Oui/NON apparaît sur la page suivante
        const MAX_DELETE = 20;
        if (skipDeleteAndUpload) log('   ⏭️ CV déjà uploadé récemment – skip suppression.');
        for (let d = 0; d < MAX_DELETE && !skipDeleteAndUpload; d++) {
          // 1. Si le popup de confirmation est déjà visible (page rechargée après clic Supprimer), cliquer Oui en priorité
          let yesBtn = null;
          for (const root of getSearchRoots()) {
            const alertTitle = root.querySelector?.('.alert-title');
            const hasConfirmPopup = alertTitle && /voulez-vous vraiment supprimer/i.test(alertTitle.textContent || '');
            if (hasConfirmPopup) {
              yesBtn = root.querySelector?.('input[id*="YesDeleteAttachedFileCommand"]') ||
                root.querySelector?.('input[type="button"][value="Oui"]') ||
                root.querySelector?.('input[value="Oui"]') ||
                Array.from(root.querySelectorAll?.('input[type="button"], input[type="submit"], button') || []).find(el =>
                  /^oui$/i.test((el.value || el.textContent || '').trim())
                );
              if (yesBtn && yesBtn.offsetParent !== null) {
                log('   ✅ Popup de suppression détecté – clic sur "Oui"...');
                yesBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
                await delay(500);
                if (typeof window.cmdSubmit === 'function' && yesBtn.id) {
                  try { window.cmdSubmit('editTemplateMultipart-editForm', yesBtn.id, null, null, true); } catch (_) { yesBtn.click(); }
                } else {
                  yesBtn.click();
                }
                await delay(5000);
                break;
              }
            }
          }
          if (yesBtn) continue;

          // 2. Sinon, chercher le lien Supprimer et cliquer (provoquera une nav, le script reprendra sur la page suivante)
          let deleteLink = null;
          for (const root of getSearchRoots()) {
            const spans = root.querySelectorAll?.('span[id*="attachmentFileDelete"], a[id*="DeleteAttachedFile"]') || [];
            for (const el of spans) {
              if (el.offsetParent !== null && !/YesDelete/i.test(el.id || '')) {
                deleteLink = el;
                break;
              }
            }
            if (!deleteLink) {
              const links = root.querySelectorAll?.('a, span[role="button"]') || [];
              for (const el of links) {
                const t = (el.textContent || el.innerText || '').trim().toLowerCase();
                if (t === 'supprimer' && el.offsetParent !== null && el.closest?.('table')) {
                  deleteLink = el;
                  break;
                }
              }
            }
            if (deleteLink) break;
          }
          if (!deleteLink) {
            if (d > 0) log(`   ✅ ${d} document(s) supprimé(s).`);
            break;
          }
          log(`   🗑️ Suppression document ${d + 1}...`);
          deleteLink.scrollIntoView({ behavior: 'instant', block: 'center' });
          await delay(300);
          deleteLink.click();
          await delay(2000);
        }

        let fileInput = cvInput;
        if (!fileInput) {
          for (const root of getSearchRoots()) {
            fileInput = root.querySelector?.('input[id*="AttachedFilesBlock-uploadedFile"]') || root.querySelector?.('input[id*="uploadedFile"]');
            if (fileInput) break;
          }
        }
        if (fileInput) {
          let uploadOk = false;
          if (!skipDeleteAndUpload) {
            log('   📤 Upload CV depuis Firebase...');
            uploadOk = await setFileInputFromStorage(fileInput, profile.cv_storage_path, 'cv.pdf');
            if (uploadOk) {
              let attachBtn = null;
              for (const root of getSearchRoots()) {
                attachBtn = root.querySelector?.('input[id*="AttachedFilesBlock-attachFileCommand"]') || root.querySelector?.('input[id*="attachFileCommand"]');
                if (attachBtn) break;
              }
              if (attachBtn) {
                attachBtn.click();
                await delay(10000);
                try { sessionStorage.setItem('taleos_cv_uploaded_at', String(Date.now())); } catch (_) {}
              }
            }
          }

          if (skipDeleteAndUpload || uploadOk) {
            function checkResumeInAttachmentTable() {
              for (const root of getSearchRoots()) {
                const resumeChecks = root.querySelectorAll?.('input[id*="resumeselectionid"]') || [];
                for (const chk of resumeChecks) {
                  if (!chk.checked && chk.offsetParent !== null) {
                    const styled = chk.nextElementSibling;
                    const label = root.querySelector?.(`label[for="${chk.id}"]`);
                    const td = chk.closest?.('td');
                    ((styled && styled.classList?.contains?.('styled-checkbox')) ? styled : label || td || chk).click();
                    return true;
                  }
                }
              }
              return false;
            }

            log('   ☑️ Coche case "CV" dans le tableau des pièces jointes...');
            let checked = false;
            for (let i = 0; i < 6; i++) {
              let tableEl = null;
              for (const root of getSearchRoots()) {
                tableEl = root.querySelector?.('table.attachment-list');
                if (tableEl) break;
              }
              if (tableEl) {
                tableEl.scrollIntoView({ behavior: 'instant', block: 'center' });
                await delay(800);
              }
              if (checkResumeInAttachmentTable()) {
                log('   ✅ Case "Résumé" cochée.');
                checked = true;
                await delay(1000);
                break;
              }
              let links = [];
              for (const root of getSearchRoots()) {
                links = Array.from(root.querySelectorAll?.('a[id*="dtGotoPageLink"]') || []);
                if (links.length) break;
              }
              if (i < links.length && links[i]?.offsetParent !== null) {
                const lbl = (links[i].title || links[i].textContent || '').trim().slice(0, 50);
                log(`   📑 Navigation vers onglet "${lbl}"...`);
                links[i].click();
                await delay(2500);
              } else {
                break;
              }
            }
            if (!checked) log('   ⚠️ Aucune case "Résumé" non cochée trouvée.');

            await delay(1000);
            let finalSave = null;
            for (const root of getSearchRoots()) {
              finalSave = root.getElementById?.('editTemplateMultipart-editForm-content-ftf-saveContinueCmdBottom') || root.querySelector?.('input[id*="saveContinueCmdBottom"]');
              if (finalSave) break;
            }
            if (finalSave) {
              if (typeof window.cmdSubmit === 'function') {
                try { window.cmdSubmit('editTemplateMultipart-editForm', 'editTemplateMultipart-editForm-content-ftf-saveContinueCmdBottom', 'getOnClickAction()', null, true); } catch (_) { finalSave.click(); }
              } else {
                finalSave.click();
              }
              log('   ✅ Validation finale.');
            }
          }
        }
      }

      log('🏁 Automatisation terminée. Vérifiez la page.');
      await delay(10000);

      const successMsg = document.body?.textContent?.toLowerCase() || '';
      if (successMsg.includes('submitted') || successMsg.includes('envoyée') || successMsg.includes('success')) {
        log('🎉 Candidature envoyée avec succès !');
        if (jobId && offerUrl) {
          chrome.runtime.sendMessage({
            action: 'candidature_success',
            jobId,
            jobTitle,
            companyName,
            offerUrl
          });
        }
      }

    } catch (e) {
      log(`❌ Erreur : ${e.message}`);
      console.error(e);
      if (jobId && window === window.top) {
        try {
          chrome.runtime.sendMessage({
            action: 'candidature_failure',
            jobId,
            error: e.message || 'Erreur lors de l\'automatisation'
          });
        } catch (_) {}
      }
    } finally {
      document.getElementById(BANNER_ID)?.remove();
    }
  }

  window.__taleosRun = function(profile) {
    main(profile || {}).catch(e => console.error('[Taleos SG]', e));
  };
})();
