/**
 * Taleos - Remplissage automatique Deloitte (Workday)
 * Flux: Connexion → Utiliser ma dernière candidature → Formulaire complet
 *
 * — Méthodologie Workday (étape 1 "Mes données personnelles") —
 * 1. Validation des champs : Workday ne met à jour l'état React qu'après focus puis blur.
 *    On simule le comportement utilisateur : pour chaque champ obligatoire, scroll en vue,
 *    clic sur le champ (focus), puis clic sur un élément neutre (ex. titre "Mes données personnelles")
 *    pour provoquer le blur. Voir workdayClickThenClickAway() et refreshWorkdayRequiredFields().
 * 2. Menus déroulants (listbox) : toujours SÉLECTIONNER une option (ouvrir le bouton, cliquer
 *    l'option) au lieu de remplir un input en dur. Ex. "Comment nous avez-vous connus" :
 *    ouvrir le champ → choisir "Site Deloitte Careers" dans la liste ; "Type d'appareil téléphonique" :
 *    ouvrir → "Mobile Personnel" ; "Indicatif de pays" : ouvrir → "France (+33)" ou "Royaume-Uni (+44)"
 *    selon Firebase. Un simple fillInput() sans sélection ne valide pas côté Workday.
 * 3. Indicatif pays téléphone : pris depuis Firebase (phone_country_code ou phoneCountryCode),
 *    ex. +33 = France (+33), +44 = Royaume-Uni (+44). Pas de défaut +33 si l'utilisateur a saisi +44.
 */
(function() {
  'use strict';

  const BANNER_ID = 'taleos-deloitte-automation-banner';
  const MAX_PENDING_AGE = 10 * 60 * 1000;
  const SITE_DELOITTE_CAREERS = 'Site Deloitte Careers';

  const STEP = (n, msg) => `[STEP ${n}] ${msg}`;
  function log(msg, stepNum) {
    const prefix = stepNum != null ? STEP(stepNum, '') : '';
    console.log(`[${new Date().toLocaleTimeString('fr-FR')}] [Taleos Deloitte] ${prefix}${msg}`);
  }

  const blueprintApi = globalThis.__TALEOS_DELOITTE_BLUEPRINT__ || null;

  async function logBlueprint(entry) {
    if (!blueprintApi?.recordLog) return;
    try {
      await blueprintApi.recordLog(entry);
    } catch (_) {}
  }

  async function snapshotBlueprint(profile, label) {
    if (!blueprintApi?.snapshotCurrentPage) return null;
    try {
      return await blueprintApi.snapshotCurrentPage({ profile });
    } catch (e) {
      log('Snapshot blueprint Deloitte impossible: ' + (e && e.message), 0);
      return null;
    }
  }

  async function validateBlueprintPage(expected, profile, label) {
    if (!blueprintApi?.validateCurrentPage) return null;
    try {
      const res = await blueprintApi.validateCurrentPage(expected);
      log(`Blueprint Deloitte ${label || 'page'}: ${res.ok ? 'OK' : 'KO'} (${res.detected})`, 0);
      if (!res.ok) {
        await logBlueprint({ kind: 'blueprint_mismatch', ok: false, expected, detected: res.detected, href: location.href, label: label || '' });
      }
      if (profile && blueprintApi.snapshotCurrentPage) {
        await snapshotBlueprint(profile, label);
      }
      return res;
    } catch (e) {
      log('Validation blueprint Deloitte impossible: ' + (e && e.message), 0);
      return null;
    }
  }

  async function auditBlueprintQuestions(profile, pageKey, label) {
    if (!blueprintApi?.validateQuestionAudit) return null;
    try {
      const res = await blueprintApi.validateQuestionAudit(profile, { pageKey });
      log(`Blueprint Deloitte ${label || pageKey}: ${res.ok ? 'OK' : 'KO'} (${res.report?.unresolvedQuestionCount || 0} a traiter)`, 5);
      return res;
    } catch (e) {
      log('Audit blueprint Deloitte impossible: ' + (e && e.message), 5);
      return null;
    }
  }

  function showBanner() {
    if (document.getElementById(BANNER_ID)) return;
    const api = globalThis.__TALEOS_AUTOMATION_BANNER__;
    const banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.textContent = api ? api.getText() : '⏳ Automatisation Taleos en cours — Ne touchez à rien.';
    if (api) api.applyStyle(banner);
    else {
      Object.assign(banner.style, {
        position: 'fixed', top: '0', left: '0', right: '0', zIndex: '2147483647',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white',
        padding: '10px 20px', fontSize: '14px', fontWeight: '600', textAlign: 'center',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        boxShadow: '0 2px 10px rgba(0,0,0,0.2)'
      });
    }
    document.body?.insertBefore(banner, document.body.firstChild);
  }

  function hideBanner() {
    document.getElementById(BANNER_ID)?.remove();
  }

  function fillInput(el, value) {
    if (!el || value == null || value === '') return;
    var str = String(value).trim();
    el.focus();
    el.click();
    var tracker = el._valueTracker;
    if (tracker) tracker.setValue('');
    var nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (nativeSetter && nativeSetter.set) nativeSetter.set.call(el, str);
    else el.value = str;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function normalizeCompact(value) {
    return String(value || '').trim().replace(/\s+/g, '');
  }

  function normalizeLoose(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function normalizeDigits(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function fillInputStrict(el, value, label, options) {
    if (!el) return false;
    var target = value != null ? String(value).trim() : '';
    if (!target) return false;

    var normalize = (options && options.normalize) || normalizeCompact;
    var current = normalize(el.value || '');
    var expected = normalize(target);
    if (current === expected) {
      log('   — ' + label + ' → déjà OK', 5);
      return false;
    }

    log('   ✅ ' + label + ' → ' + target, 5);
    fillInput(el, target);

    setTimeout(function() {
      var refreshed = normalize(el.value || '');
      if (refreshed !== expected) {
        fillInput(el, target);
        log('   🔁 ' + label + ' → seconde écriture forcée', 5);
      }
    }, 250);
    return true;
  }

  function parseAvailabilityDateParts(value) {
    var raw = String(value || '').trim();
    if (!raw) return null;

    var day = '';
    var month = '';
    var year = '';
    var parts;

    if (raw.includes('/')) {
      parts = raw.split('/');
      day = (parts[0] || '').replace(/\D/g, '');
      month = (parts[1] || '').replace(/\D/g, '');
      year = (parts[2] || '').replace(/\D/g, '');
    } else if (raw.includes('-')) {
      parts = raw.split('-');
      if ((parts[0] || '').length === 4) {
        year = (parts[0] || '').replace(/\D/g, '');
        month = (parts[1] || '').replace(/\D/g, '');
        day = (parts[2] || '').replace(/\D/g, '');
      } else {
        day = (parts[0] || '').replace(/\D/g, '');
        month = (parts[1] || '').replace(/\D/g, '');
        year = (parts[2] || '').replace(/\D/g, '');
      }
    }

    if (!day || !month || year.length !== 4) return null;
    return {
      day: day.padStart(2, '0'),
      month: month.padStart(2, '0'),
      year: year
    };
  }

  function mapFirebaseExperienceToDeloitteOption(value) {
    var raw = String(value || '').trim().toLowerCase();
    if (!raw) return null;
    var normalized = raw.replace(/\s+/g, ' ').replace(/\s*-\s*/g, '-');

    var directMap = {
      '0-1 an': '0-1 an',
      '1-3 ans': '1-3 ans',
      '0-2 ans': '1-3 ans',
      '3-5 ans': '3-5 ans',
      '5-7 ans': '5-7 ans',
      '6-10 ans': '7-10 ans',
      '7-10 ans': '7-10 ans',
      '11 ans et plus': '7-10 ans',
      '10 ans et plus': '7-10 ans'
    };

    if (directMap[normalized]) return directMap[normalized];
    if (normalized.includes('11') || normalized.includes('plus') || normalized.includes('+')) return '7-10 ans';
    if (normalized.includes('6-10')) return '7-10 ans';
    if (normalized.includes('5-7')) return '5-7 ans';
    if (normalized.includes('3-5')) return '3-5 ans';
    if (normalized.includes('1-3') || normalized.includes('0-2')) return '1-3 ans';
    if (normalized.includes('0-1')) return '0-1 an';
    return null;
  }

  function getAttachmentScope() {
    var dropZone = document.querySelector('[data-automation-id="file-upload-drop-zone"]');
    if (dropZone) {
      return dropZone.closest('[data-automation-id*="attachment"], [data-automation-id*="resume"], section, article, form, div') || dropZone.parentElement || document.body;
    }
    var fileInput = document.querySelector('input[type="file"]');
    if (fileInput) {
      return fileInput.closest('[data-automation-id*="attachment"], [data-automation-id*="resume"], section, article, form, div') || fileInput.parentElement || document.body;
    }
    return document.body;
  }

  function isFilenameVisible(expectedName) {
    var target = normalizeLoose(expectedName);
    if (!target) return false;
    var text = normalizeLoose(document.body?.textContent || '');
    return text.includes(target);
  }

  function isEstablishmentAlreadySet(inputEl, expectedValue) {
    var target = normalizeLoose(expectedValue);
    if (!target) return false;
    if (normalizeLoose(inputEl?.value || '').includes(target)) return true;
    var scope = inputEl?.closest('[data-automation-id*="school"], [data-automation-id*="education"], [data-fkit-id], section, form, div');
    var scopeText = normalizeLoose(scope?.textContent || '');
    return scopeText.includes(target);
  }

  function getVisibleAttachmentRemoveButtons(scope, expectedName) {
    var fileNameNorm = String(expectedName || '').trim().toLowerCase();
    return Array.from((scope || document).querySelectorAll('button, [role="button"], a'))
      .filter(function(btn) {
        if (!btn || btn.offsetParent === null) return false;
        var label = String(btn.textContent || btn.getAttribute('aria-label') || btn.getAttribute('title') || '').trim().toLowerCase();
        if (!/(supprimer|delete|remove|retirer)/i.test(label)) return false;
        if (!fileNameNorm) return true;
        var rowText = String((btn.closest('li, tr, [role="row"], section, article, div') || scope || document.body).textContent || '').toLowerCase();
        return rowText.includes(fileNameNorm);
      });
  }

  async function cleanupAttachmentConfirmDialog() {
    var confirmBtn = Array.from(document.querySelectorAll('button, [role="button"]')).find(function(btn) {
      if (!btn || btn.offsetParent === null) return false;
      var insideDialog = btn.closest('[role="dialog"], [aria-modal="true"], [data-automation-id*="dialog"], [data-automation-id*="modal"]');
      if (!insideDialog) return false;
      var label = String(btn.textContent || btn.getAttribute('aria-label') || '').trim().toLowerCase();
      return /^(oui|yes|supprimer|delete|remove|confirmer|confirm)$/.test(label);
    });
    if (confirmBtn) {
      try {
        scrollIntoViewIfNeeded(confirmBtn);
        confirmBtn.click();
      } catch (_) {}
      await new Promise(function(resolve) { setTimeout(resolve, 800); });
      return true;
    }
    return false;
  }

  async function cleanupExistingCvUploads(expectedName) {
    var scope = getAttachmentScope();
    var scopeText = String(scope?.textContent || '').toLowerCase();
    var fileName = String(expectedName || '').trim();
    var fileNameNorm = fileName.toLowerCase();
    var nameOccurrences = fileName ? (scopeText.match(new RegExp(fileNameNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length : 0;
    var removeButtons = getVisibleAttachmentRemoveButtons(scope, fileName);

    if (!removeButtons.length) {
      return {
        removed: 0,
        alreadyPresent: !!(fileNameNorm && scopeText.includes(fileNameNorm))
      };
    }

    var removed = 0;
    for (var i = 0; i < removeButtons.length; i++) {
      var btn = removeButtons[i];
      try {
        scrollIntoViewIfNeeded(btn);
        btn.click();
        removed++;
      } catch (_) {}
      await new Promise(function(resolve) { setTimeout(resolve, 700); });
      await cleanupAttachmentConfirmDialog();
      await new Promise(function(resolve) { setTimeout(resolve, 700); });
    }

    return {
      removed: removed,
      alreadyPresent: nameOccurrences > 0
    };
  }

  function pressEnterSequence(el) {
    if (!el) return;
    try {
      ['keydown', 'keypress', 'keyup'].forEach(function(type) {
        const ev = new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true });
        el.dispatchEvent(ev);
      });
    } catch (_) {}
  }

  /**
   * Simule la frappe clavier caractère par caractère (pour les champs search Workday
   * qui ne réagissent pas au nativeSetter). Chaque caractère : keydown → set value → input → keyup.
   */
  function simulateTyping(el, text, onComplete) {
    if (!el || !text) { if (onComplete) onComplete(); return; }
    var str = String(text).trim();
    if (!str) { if (onComplete) onComplete(); return; }
    var nativeDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    var nativeSet = nativeDesc && nativeDesc.set;
    el.focus();
    el.click();
    var i = 0;
    function next() {
      if (i >= str.length) {
        if (onComplete) setTimeout(onComplete, 100);
        return;
      }
      var ch = str[i++];
      var cur = el.value || '';
      var val = cur + ch;
      el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true }));
      var trk = el._valueTracker;
      if (trk) trk.setValue(cur);
      if (nativeSet) nativeSet.call(el, val);
      else el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
      setTimeout(next, 60);
    }
    setTimeout(next, 200);
  }

  /**
   * Clic sur "Enregistrer et continuer" (pageFooterNextButton) puis relance runAutomation
   * pour détecter l'étape suivante après transition Workday.
   */
  function clickNextAndContinue(delayMs) {
    setTimeout(function () {
      var nextBtn = document.querySelector('button[data-automation-id="pageFooterNextButton"]');
      if (nextBtn && nextBtn.offsetParent !== null) {
        scrollIntoViewIfNeeded(nextBtn);
        nextBtn.click();
        log('➡️  Clic "Enregistrer et continuer"', 0);
        setTimeout(runAutomation, 3000);
      } else {
        log('⏭️  Bouton "Enregistrer et continuer" non trouvé', 0);
      }
    }, delayMs || 2000);
  }

  /**
   * Valider les champs Workday comme en manuel : focus → (re-set value) → click-away → blur.
   * Si fieldsWithValues est fourni (avec .val), la valeur est ré-injectée avec le hack _valueTracker
   * pendant le focus pour que React/Workday l'enregistre dans cette session focus→blur.
   * Délai de 500ms entre chaque champ pour laisser Workday traiter la validation.
   */
  function workdayClickThenClickAway(fieldsWithValues) {
    try {
      var fields;
      if (fieldsWithValues && fieldsWithValues.length) {
        fields = fieldsWithValues.filter(function (x) { return x.el && x.el.offsetParent; });
      } else {
        fields = [
          { el: document.getElementById('name--legalName--firstName') || document.querySelector('input[name="legalName--firstName"]'), label: 'Prénom(s)' },
          { el: document.getElementById('name--legalName--lastName') || document.querySelector('input[name="legalName--lastName"]'), label: 'Nom de famille' },
          { el: document.getElementById('address--addressLine1') || document.querySelector('input[name="addressLine1"]'), label: 'Nature et nom de la voie' },
          { el: document.getElementById('address--city') || document.querySelector('input[name="city"]'), label: 'Ville' },
          { el: document.getElementById('address--postalCode') || document.querySelector('input[name="postalCode"]'), label: 'Code postal' },
          { el: document.getElementById('phoneNumber--phoneNumber') || document.querySelector('input[name="phoneNumber"][id*="phoneNumber"]') || document.querySelector('input[name="phoneNumber"]'), label: 'Numéro de téléphone' },
          { el: document.getElementById('previousWorker--location'), label: 'Ancien bureau Deloitte' },
          { el: document.getElementById('previousWorker--email'), label: 'Ancienne email Deloitte' }
        ].filter(function (x) { return x.el && x.el.offsetParent; });
      }
      var elsewhere = document.querySelector('h2[data-automation-id="sectionHeader"], [role="heading"][aria-level="2"], h2') || document.body;
      fields.forEach(function (item, index) {
        var delay = index * 500;
        setTimeout(function () {
          try {
            scrollIntoViewIfNeeded(item.el);
            item.el.focus();
            item.el.click();
            if (item.val) {
              var val = String(item.val).trim();
              if (val) {
                var tracker = item.el._valueTracker;
                if (tracker) tracker.setValue('');
                var desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
                if (desc && desc.set) desc.set.call(item.el, val);
                else item.el.value = val;
                item.el.dispatchEvent(new Event('input', { bubbles: true }));
                item.el.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }
            log('   🔁 Validation → ' + item.label, 5);
          } catch (_) {}
        }, delay);
        setTimeout(function () {
          try { elsewhere.click(); } catch (_) {}
        }, delay + 250);
        setTimeout(function () {
          try {
            if (document.activeElement === item.el) item.el.blur();
          } catch (_) {}
        }, delay + 350);
      });
    } catch (e) {
      log('   ❌ workdayClickThenClickAway: ' + (e && e.message), 5);
    }
  }

  /** Remplir seulement si vide ou différent de Firebase (log skip ou remplacer). Écrit la valeur telle quelle (avec espaces). */
  function fillInputIfNeeded(el, value, label) {
    if (!el) return false;
    const valueTrimmed = value != null ? String(value).trim() : '';
    if (!valueTrimmed) {
      return false;
    }
    const current = (el.value || '').trim();
    const currentNorm = current.replace(/\s/g, '');
    const targetNorm = valueTrimmed.replace(/\s/g, '');
    if (currentNorm === targetNorm || (currentNorm.length >= 10 && targetNorm.length >= 10 && currentNorm.slice(-10) === targetNorm.slice(-10))) {
      log('   — ' + label + ' → déjà OK', 5);
      return false;
    }
    log('   ✅ ' + label + ' → ' + valueTrimmed, 5);
    fillInput(el, valueTrimmed);
    return true;
  }

  /** Scroll élément en vue (évite "click intercepted" sur Workday). */
  function scrollIntoViewIfNeeded(el) {
    if (!el || typeof el.scrollIntoView !== 'function') return;
    try {
      el.scrollIntoView({ behavior: 'instant', block: 'center' });
    } catch (_) {}
  }

  /** Workday : ouvrir un bouton listbox (id, name ou selector) et cliquer l'option dont le label correspond (option cliquée après 400ms). */
  function clickWorkdayListboxOption(buttonSelector, optionLabelOrValue, label) {
    let btn = null;
    if (typeof buttonSelector === 'string') {
      if (!buttonSelector.includes(' ') && buttonSelector.length <= 50) {
        btn = document.getElementById(buttonSelector) || document.querySelector('button[name="' + buttonSelector + '"]');
        if (!btn && buttonSelector.indexOf('--') >= 0) {
          const namePart = buttonSelector.replace(/^[^-]+--/, '');
          if (namePart) btn = document.querySelector('button[name="' + namePart + '"]');
        }
      }
      if (!btn) btn = document.querySelector(buttonSelector);
    } else {
      btn = buttonSelector;
    }
    if (!btn || !btn.offsetParent) {
      log('   ⏭️  ' + label + ' : bouton non trouvé → Skip', 5);
      return false;
    }
    scrollIntoViewIfNeeded(btn);
    const currentAria = (btn.getAttribute('aria-label') || '').trim();
    const target = (optionLabelOrValue || '').trim().toLowerCase();
    const isPlaceholder = /sélectionnez une valeur|select a value/i.test(currentAria) || (btn.getAttribute('value') === '' || !btn.getAttribute('value'));
    if (!isPlaceholder && currentAria && target && (currentAria.toLowerCase().includes(target) || (target.includes('monsieur') && currentAria.includes('Monsieur')) || (target.includes('madame') && currentAria.includes('Madame')))) {
      log('   — ' + label + ' → déjà OK', 5);
      return false;
    }
    try {
      btn.click();
    } catch (e) {
      log('   ❌ ' + label + ' : erreur clic bouton ' + e.message, 5);
      return false;
    }
    const name = btn.getAttribute('name');
    setTimeout(function tryClickOption() {
      // NB: pas de sélecteur [value!=""] car non supporté par querySelectorAll → provoquait un SyntaxError et des boucles infinies
      const opts = document.querySelectorAll('[data-automation-id="promptOption"], [data-automation-id="menuItem"], [data-automation-id="selectedItem"], [role="option"]');
      var normalizedTarget = target.replace(/\s+/g, ' ').replace(/\s*-\s*/g, '-');
      for (const opt of opts) {
        const t = (opt.textContent || opt.getAttribute('aria-label') || opt.getAttribute('data-automation-label') || '').trim().toLowerCase();
        const v = (opt.getAttribute && opt.getAttribute('value')) || '';
        if (!t && !v) continue;
        if (label && /niveau d'?exp/i.test(label)) {
          var normalizedOption = t.replace(/\s+/g, ' ').replace(/\s*-\s*/g, '-');
          if (normalizedOption === normalizedTarget && opt.offsetParent !== null) {
            opt.click();
            log('   ✅ ' + label + ' → ' + (opt.textContent || opt.getAttribute('data-automation-label') || t).trim(), 5);
            return;
          }
          continue;
        }
        // Pour "Mobile Personnel" : exiger "mobile" dans l'option (éviter de cocher "Fixe Personnel")
        const match = t.includes(target) || (target.includes('monsieur') && t.includes('monsieur')) || (target.includes('madame') && t.includes('madame')) ||
            (target.includes('mobile') && t.includes('mobile')) ||
            (target.includes('personnel') && t.includes('personnel') && !target.includes('mobile')) ||
            (target.includes('+33') && t.includes('+33')) || (target.includes('+44') && t.includes('+44')) || (target.includes('france') && t.includes('france')) || (target.includes('royaume') && t.includes('royaume'));
        if (match && opt.offsetParent !== null) {
          opt.click();
          log('   ✅ ' + label + ' → ' + (opt.textContent || opt.getAttribute('data-automation-label') || t).trim(), 5);
          return;
        }
      }
      log('   ⏭️  ' + label + ' → option non trouvée', 5);
    }, 400);
    return true;
  }

  function fillSelect(el, value) {
    if (!el || value == null || value === '') return;
    const str = String(value).trim().toLowerCase();
    const opt = Array.from(el.options || []).find(o => {
      const v = (o.value || '').toLowerCase();
      const t = (o.textContent || '').trim().toLowerCase();
      return v === str || t === str || t.includes(str) || str.includes(t);
    });
    if (opt) {
      el.value = opt.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  // « Rafraîchir » un champ comme si l'utilisateur avait cliqué dedans
  function touchField(el, label) {
    if (!el || !el.offsetParent) return;
    try {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const mouseOpts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy };
      el.dispatchEvent(new MouseEvent('mousedown', mouseOpts));
      el.dispatchEvent(new MouseEvent('mouseup', mouseOpts));
      el.click();
      el.focus();
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
      log('   🔁 ' + label + ' : champ actualisé par clic simulé (Workday validation)', 5);
    } catch (_) {}
  }

  // Certains champs obligatoires gardent l'erreur tant qu'il n'y a pas eu de « vrai » clic / blur.
  // On simule un touch (focus + input/change + blur) sur tous les champs obligatoires pour que Workday valide.
  function refreshWorkdayRequiredFields() {
    try {
      const firstnameEl = document.getElementById('name--legalName--firstName') || document.querySelector('input[name="legalName--firstName"]');
      const lastnameEl = document.getElementById('name--legalName--lastName') || document.querySelector('input[name="legalName--lastName"]');
      const addressEl = document.querySelector('input[id*="address"], input[name*="address"]') || findInputByLabel(['nature et nom de la voie', 'address', 'adresse']);
      const cityEl = findInputByLabel(['ville', 'city']);
      const zipEl = findInputByLabel(['code postal', 'postal code', 'zip']);
      const phoneEl = document.getElementById('phoneNumber--phoneNumber') || document.querySelector('input[name="phoneNumber"][id*="phoneNumber"]') || document.querySelector('input[name="phoneNumber"]');
      const hearInput = findInputByLabel(['comment nous avez-vous connus', 'how did you hear about us']);

      if (firstnameEl) touchField(firstnameEl, 'Prénom (refresh)');
      if (lastnameEl) touchField(lastnameEl, 'Nom de famille (refresh)');
      if (addressEl) touchField(addressEl, 'Adresse (refresh)');
      if (cityEl) touchField(cityEl, 'Ville (refresh)');
      if (zipEl) touchField(zipEl, 'Code postal (refresh)');
      if (phoneEl) touchField(phoneEl, 'Numéro de téléphone (refresh)');
      if (hearInput) touchField(hearInput, 'Comment nous avez-vous connus ? (refresh)');

      // Cas Workday avec liste déroulante (screenshot) : bouton listbox + pill sélectionné.
      const hearTrigger = document.querySelector(
        'button[aria-haspopup="listbox"][aria-label*="Comment nous avez-vous connus"], ' +
        'button[aria-haspopup="listbox"][aria-label*="How did you hear about us"]'
      );
      if (hearTrigger && hearTrigger.offsetParent !== null) {
        try {
          // Premier clic : ouvrir la liste si besoin
          hearTrigger.click();
          setTimeout(function() {
            const selectedPill = document.querySelector(
              '[data-automation-id="selectedItem"][title*="Site Deloitte Careers"], ' +
              '[data-automation-id="selectedItem"][aria-label*="Site Deloitte Careers"]'
            );
            if (selectedPill && selectedPill.offsetParent !== null) {
              // Clic sur le pill (sélection réelle)
              selectedPill.click();
            }
            // Validation/fermeture exactement comme quand tu appuies sur Entrée.
            const enterEvent = new KeyboardEvent('keydown', {
              key: 'Enter',
              code: 'Enter',
              keyCode: 13,
              which: 13,
              bubbles: true
            });
            (document.activeElement || hearTrigger).dispatchEvent(enterEvent);
            log('   🔁 Comment nous avez-vous connus ? (listbox refresh) : sélection + touche Entrée simulée', 5);
          }, 250);
        } catch (_) {}
      }
    } catch (_) {}
  }

  function findLabelAndInput(labelTexts) {
    const labels = Array.from(document.querySelectorAll('label, [data-automation-id="label"], span[role="presentation"]'));
    for (const label of labels) {
      const text = (label.textContent || '').trim();
      const match = labelTexts.some(t => text.toLowerCase().includes(t.toLowerCase()));
      if (match) {
        const forId = label.getAttribute('for');
        const input = forId ? document.getElementById(forId) : null;
        if (input) return input;
        const parent = label.closest('div[data-automation-id], div[class*="input"], li');
        if (parent) {
          const inp = parent.querySelector('input, select, textarea');
          if (inp) return inp;
        }
        const next = label.nextElementSibling || label.parentElement?.querySelector('input, select, textarea');
        if (next) return next;
      }
    }
    return null;
  }

  function findAndClickByText(texts, contextLabel) {
    const all = Array.from(document.querySelectorAll('button, a, span[role="button"], div[role="button"], [data-automation-id="promptOption"], [data-automation-id="compositeHeader"], label'));
    for (const el of all) {
      const t = (el.textContent || '').trim();
      if (texts.some(x => t.toLowerCase().includes(x.toLowerCase()))) {
        if (el.offsetParent !== null) {
          log(`[${contextLabel}] findAndClickByText: clic sur élément texte="${t}"`);
          el.click();
          return true;
        }
      }
    }
    const reuseLink = document.querySelector('a[href*="reuse"], [data-automation-id*="reuse"], [data-automation-id*="lastApplication"]');
    if (reuseLink?.offsetParent !== null) {
      log(`[${contextLabel}] findAndClickByText: clic sur lien de réutilisation (reuse/lastApplication)`);
      reuseLink.click();
      return true;
    }
    log(`[${contextLabel}] findAndClickByText: aucun élément trouvé pour textes="${texts.join(', ')}"`);
    return false;
  }

  function findSelectByLabel(labelTexts) {
    const inp = findLabelAndInput(labelTexts);
    return inp && inp.tagName === 'SELECT' ? inp : null;
  }

  function findInputByLabel(labelTexts) {
    const inp = findLabelAndInput(labelTexts);
    return inp && (inp.tagName === 'INPUT' || inp.tagName === 'TEXTAREA') ? inp : null;
  }

  /** Workday : cliquer une option de liste (menuItem / promptOption) dont le libellé correspond */
  function clickWorkdayOptionByLabelAndValue(labelKeywords, valueText) {
    const labels = Array.from(document.querySelectorAll('label, [data-automation-id="label"], span[role="presentation"]'));
    for (const label of labels) {
      const text = (label.textContent || '').trim().toLowerCase();
      if (!labelKeywords.some(k => text.includes(k.toLowerCase()))) continue;
      const container = label.closest('li, div[data-automation-id], section, [role="listbox"]') || document.body;
      const options = container.querySelectorAll('[data-automation-id="promptOption"], [data-automation-id="menuItem"], [role="option"]');
      const target = (valueText || '').trim().toLowerCase();
      for (const opt of options) {
        const t = (opt.textContent || opt.getAttribute('aria-label') || '').trim().toLowerCase();
        if (t === target || t.includes(target) || (target === 'oui' && /^oui$/i.test(t)) || (target === 'non' && /^non$/i.test(t))) {
          if (opt.offsetParent !== null) {
            opt.click();
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Remplir l'étape 2 Workday "Mon expérience" (Études) depuis Firebase.
   * - Établissement ou université : type + Enter (même pattern que Indicatif pays)
   * - Diplôme : listbox (education_level → mapping vers options Workday)
   * - À (année) : graduation_year depuis Firebase
   * - Domaine d'études : ignoré (pas obligatoire)
   */
  /**
   * Étape 3 Workday "Questions de candidature" :
   * - Niveau d'expérience (listbox, mapping Firebase → Workday)
   * - Date de disponibilité (JJ/MM/AAAA spinbuttons)
   * - Bourse alternance (si présent) → "Ne se prononce pas"
   */
  function fillWorkdayStep3Questions(profile) {
    var expLevel = (profile.experience_level || '').trim().toLowerCase();
    var availDate = (profile.available_date || profile.available_from || '').trim();

    log('📋 Profil Firebase (Questions) :', 5);
    log('   Expérience: ' + (expLevel || '—') + '  |  Disponibilité: ' + (availDate || '—'), 5);

    // ——— Niveau d'expérience : mapping Firebase → Workday ———
    var expOption = mapFirebaseExperienceToDeloitteOption(expLevel);
    if (expOption) {
      var expBtns = Array.from(document.querySelectorAll('button[aria-haspopup="listbox"][id*="primaryQuestionnaire"]'));
      var expBtn = expBtns.find(function(b) {
        var field = b.closest('[data-fkit-id]');
        if (!field) return false;
        var legend = field.querySelector('legend');
        return legend && /niveau\s*(d.)?exp/i.test(legend.textContent || '');
      });
      if (expBtn && expBtn.offsetParent !== null) {
        clickWorkdayListboxOption(expBtn, expOption, 'Niveau d\'expérience');
      } else {
        log('   ⏭️  Niveau d\'expérience → bouton non trouvé', 5);
      }
    } else {
      log('   ⏭️  Niveau d\'expérience → pas de valeur Firebase', 5);
    }

    // ——— Date de disponibilité (JJ/MM/AAAA) ———
    var parsedDate = parseAvailabilityDateParts(availDate);
    if (parsedDate) {
      var dateFields = document.querySelectorAll('[id*="primaryQuestionnaire"][id*="dateSection"]');
      var dayInput = document.querySelector('[id*="primaryQuestionnaire"][data-automation-id="dateSectionDay-input"]');
      var monthInput = document.querySelector('[id*="primaryQuestionnaire"][data-automation-id="dateSectionMonth-input"]');
      var yearInput = document.querySelector('[id*="primaryQuestionnaire"][data-automation-id="dateSectionYear-input"]');
      if (!dayInput) dayInput = Array.from(dateFields).find(function(el) { return el.id && el.id.includes('Day-input'); });
      if (!monthInput) monthInput = Array.from(dateFields).find(function(el) { return el.id && el.id.includes('Month-input'); });
      if (!yearInput) yearInput = Array.from(dateFields).find(function(el) { return el.id && el.id.includes('Year-input'); });

      if (dayInput) {
        scrollIntoViewIfNeeded(dayInput);
        fillInputStrict(dayInput, parsedDate.day, 'Date dispo (jour)', { normalize: normalizeDigits });
      }
      setTimeout(function() {
        if (monthInput) {
          scrollIntoViewIfNeeded(monthInput);
          fillInputStrict(monthInput, parsedDate.month, 'Date dispo (mois)', { normalize: normalizeDigits });
        }
        setTimeout(function() {
          if (yearInput) {
            scrollIntoViewIfNeeded(yearInput);
            fillInputStrict(yearInput, parsedDate.year, 'Date dispo (année)', { normalize: normalizeDigits });
          }
        }, 300);
      }, 300);
    } else if (availDate) {
      log('   ⏭️  Date dispo → format non reconnu: "' + availDate + '"', 5);
    } else {
      log('   ⏭️  Date dispo → pas de valeur Firebase', 5);
    }

    // ——— Bourse alternance → "Ne se prononce pas" (si la question existe) ———
    setTimeout(function() {
      var allQBtns = Array.from(document.querySelectorAll('button[aria-haspopup="listbox"][id*="primaryQuestionnaire"]'));
      var bourseBtn = allQBtns.find(function(b) {
        var field = b.closest('[data-fkit-id]');
        if (!field) return false;
        var legend = field.querySelector('legend');
        return legend && /bourse/i.test(legend.textContent || '');
      });
      if (bourseBtn && bourseBtn.offsetParent !== null) {
        var currentLabel = (bourseBtn.getAttribute('aria-label') || '').trim();
        if (/ne se prononce pas/i.test(currentLabel)) {
          log('   — Bourse → déjà "Ne se prononce pas"', 5);
        } else {
          clickWorkdayListboxOption(bourseBtn, 'Ne se prononce pas', 'Bourse (alternance)');
        }
      }
    }, 1500);
  }

  function fillWorkdayStep2Education(profile) {
    var establishmentVal = (profile.establishment || '').trim();
    var diplomaYearRaw = profile.diploma_year != null ? profile.diploma_year : '';
    var diplomaYear = String(diplomaYearRaw).replace(/\D/g, '');
    var yearEnd = diplomaYear.length === 4 ? parseInt(diplomaYear, 10) : null;

    log('📋 Profil Firebase (Études) :', 5);
    log('   Établissement: ' + (establishmentVal || '—') + '  |  Diplôme: ' + (profile.education_level || '—') + '  |  Année fin: ' + (yearEnd || '—'), 5);

    // ——— Établissement ou université : simulateTyping → wait results → double Enter ———
    var estabInput = document.querySelector('input[data-automation-id="searchBox"][id*="school"]') ||
      document.querySelector('input[id*="school"][placeholder="Rechercher"]') ||
      findInputByLabel(['établissement ou université', 'institution']);
    if (estabInput && estabInput.offsetParent !== null && establishmentVal) {
      if (step2LastEstablishmentApplied && normalizeLoose(step2LastEstablishmentApplied) === normalizeLoose(establishmentVal)) {
        log('   — Établissement → déjà traité pendant cette session', 5);
      } else if (isEstablishmentAlreadySet(estabInput, establishmentVal)) {
        log('   — Établissement → déjà OK', 5);
        step2LastEstablishmentApplied = establishmentVal;
      } else {
        scrollIntoViewIfNeeded(estabInput);
        log('   ⌨️  Établissement → frappe "' + establishmentVal + '"…', 5);
        simulateTyping(estabInput, establishmentVal, function() {
          log('   ⌨️  Établissement → frappe terminée, attente résultats puis double Enter…', 5);
          setTimeout(function() {
            pressEnterSequence(estabInput);
            setTimeout(function() {
              pressEnterSequence(estabInput);
              step2LastEstablishmentApplied = establishmentVal;
              log('   ✅ Établissement → ' + establishmentVal + ' (double Enter)', 5);
            }, 400);
          }, 1500);
        });
      }
    } else if (!establishmentVal) {
      log('   ⏭️  Établissement → pas de valeur Firebase', 5);
    } else {
      log('   ⏭️  Établissement → champ non trouvé', 5);
    }

    // ——— Diplôme : listbox ———
    var diplomaMap = {
      'bac+1': 'BAC+1 / Baccalauréat / infra-BAC',
      'bac + 1': 'BAC+1 / Baccalauréat / infra-BAC',
      'baccalauréat': 'BAC+1 / Baccalauréat / infra-BAC',
      'bac+2': 'DUT / BTS / DEUG (BAC+2)',
      'bac + 2': 'DUT / BTS / DEUG (BAC+2)',
      'bts': 'DUT / BTS / DEUG (BAC+2)',
      'dut': 'DUT / BTS / DEUG (BAC+2)',
      'bac+3': 'License / Bachelor / DUT (BAC+3)',
      'bac + 3': 'License / Bachelor / DUT (BAC+3)',
      'licence': 'License / Bachelor / DUT (BAC+3)',
      'bachelor': 'License / Bachelor / DUT (BAC+3)',
      'bac+4': 'Master 1 / Maitrise (BAC+4)',
      'bac + 4': 'Master 1 / Maitrise (BAC+4)',
      'master 1': 'Master 1 / Maitrise (BAC+4)',
      'm1': 'Master 1 / Maitrise (BAC+4)',
      'bac+5': 'Master 2 / Master Spé / DSCG (BAC+5)',
      'bac + 5': 'Master 2 / Master Spé / DSCG (BAC+5)',
      'master 2': 'Master 2 / Master Spé / DSCG (BAC+5)',
      'm2': 'Master 2 / Master Spé / DSCG (BAC+5)',
      'master': 'Master 2 / Master Spé / DSCG (BAC+5)',
      'grande école': 'Programme Grande Ecole, MIM ou Formation Ingénieur',
      'grande ecole': 'Programme Grande Ecole, MIM ou Formation Ingénieur',
      'ingénieur': 'Programme Grande Ecole, MIM ou Formation Ingénieur',
      'ingenieur': 'Programme Grande Ecole, MIM ou Formation Ingénieur',
      'mim': 'Programme Grande Ecole, MIM ou Formation Ingénieur',
      'miage': 'Master MIAGE',
      'capa': 'CAPA (Certificat d\'Aptitude à la profession d\'Avocat)',
      'actuaire': 'Diplôme d\'Actuaire',
      'cafcac': 'CAFCAC (Commissariat aux comptes)',
      'dec': 'DEC (Diplôme d\'Expertise Comptable)',
      'expertise comptable': 'DEC (Diplôme d\'Expertise Comptable)',
      'doctorat': 'Doctorat',
      'phd': 'Doctorat'
    };
    var eduLevel = (profile.education_level || '').trim().toLowerCase();
    var diplomaOption = null;
    for (var k in diplomaMap) {
      if (eduLevel.includes(k) || eduLevel === k) {
        diplomaOption = diplomaMap[k];
        break;
      }
    }
    if (!diplomaOption && eduLevel) {
      diplomaOption = 'Master 2 / Master Spé / DSCG (BAC+5)';
    }
    if (diplomaOption) {
      var diplomaBtn = document.querySelector('button[aria-haspopup="listbox"][id*="degree"]') ||
        document.querySelector('button[aria-haspopup="listbox"][name="degree"]') ||
        document.querySelector('button[aria-haspopup="listbox"][aria-label*="Diplôme"]') ||
        Array.from(document.querySelectorAll('button[aria-haspopup="listbox"]')).find(function(b) {
          return /diplôme/i.test(b.getAttribute('aria-label') || '');
        });
      if (diplomaBtn && diplomaBtn.offsetParent !== null) {
        var currentLabel = (diplomaBtn.getAttribute('aria-label') || '').trim();
        if (currentLabel.toLowerCase().includes(diplomaOption.toLowerCase().substring(0, 10))) {
          log('   — Diplôme → déjà OK', 5);
        } else {
          scrollIntoViewIfNeeded(diplomaBtn);
          diplomaBtn.click();
          setTimeout(function() {
            var target = diplomaOption.toLowerCase();
            var opts = Array.from(document.querySelectorAll(
              '[data-automation-id="promptOption"], [role="option"], [data-automation-id="menuItem"]'
            )).filter(function(o) { return o.offsetParent !== null; });
            var match = opts.find(function(o) {
              var txt = (o.textContent || o.getAttribute('data-automation-label') || '').trim().toLowerCase();
              return txt.includes(target) || target.includes(txt);
            });
            if (!match) {
              var keywords = target.split(/[\s\/()]+/).filter(function(w) { return w.length >= 3; });
              match = opts.find(function(o) {
                var txt = (o.textContent || o.getAttribute('data-automation-label') || '').trim().toLowerCase();
                return keywords.filter(function(kw) { return txt.includes(kw); }).length >= Math.max(1, keywords.length - 1);
              });
            }
            if (!match) {
              var firstPart = target.split('/')[0].trim();
              match = opts.find(function(o) {
                var txt = (o.textContent || o.getAttribute('data-automation-label') || '').trim().toLowerCase();
                return txt.includes(firstPart);
              });
            }
            if (match) {
              match.click();
              log('   ✅ Diplôme → ' + (match.textContent || '').trim(), 5);
            } else {
              log('   ⏭️  Diplôme → option non trouvée (' + opts.length + ' options visibles, cible: "' + diplomaOption + '")', 5);
            }
          }, 800);
        }
      } else {
        log('   ⏭️  Diplôme → bouton non trouvé', 5);
      }
    }

    // ——— À (année réelle ou prévue) ———
    if (yearEnd != null) {
      setTimeout(function() {
        var yearInput = document.querySelector('input[id*="lastYearAttended"][id*="Year"]') ||
          document.querySelector('input[aria-label*="Année"][id*="lastYearAttended"]') ||
          document.querySelector('[role="spinbutton"][id*="lastYearAttended"]');
        if (!yearInput) {
          var yearInputs = Array.from(document.querySelectorAll('input[type="text"], [role="spinbutton"]')).filter(function(i) {
            var ph = (i.getAttribute('placeholder') || '').trim();
            var al = (i.getAttribute('aria-label') || '').toLowerCase();
            return ph === 'AAAA' || al.includes('year') || al.includes('année');
          });
          if (yearInputs.length > 0) yearInput = yearInputs[yearInputs.length - 1];
        }
        if (yearInput && yearInput.offsetParent !== null) {
          scrollIntoViewIfNeeded(yearInput);
          if (normalizeDigits(yearInput.value || yearInput.textContent || '') === String(yearEnd)) {
            log('   — Année fin → déjà OK', 5);
          } else {
            fillInput(yearInput, String(yearEnd));
            log('   ✅ Année fin → ' + yearEnd, 5);
          }
        } else {
          log('   ⏭️  Année → champ non trouvé', 5);
        }
      }, 1200);
    }
  }

  /** Récupère un fichier depuis Firebase Storage (message au background) et l’assigne à un input[type=file]. */
  async function setFileInputFromStorage(inputEl, storagePath, filename) {
    if (!inputEl || !storagePath) return false;
    try {
      const r = await new Promise(function (resolve) {
        chrome.runtime.sendMessage({ action: 'fetch_storage_file', storagePath }, resolve);
      });
      if (r && r.error) throw new Error(r.error);
      if (!r || !r.base64) return false;
      const bin = atob(r.base64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const blob = new Blob([arr], { type: (r.type || 'application/pdf') });
      const file = new File([blob], filename || 'cv.pdf', { type: blob.type });
      const dt = new DataTransfer();
      dt.items.add(file);
      inputEl.files = dt.files;
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    } catch (e) {
      log('   ❌ Erreur upload fichier: ' + (e && e.message), 5);
      return false;
    }
  }

  /** Étape 2 : upload du CV depuis Firebase si profil a cv_storage_path. */
  async function uploadCvInStep2(profile) {
    if (!profile || !profile.cv_storage_path) {
      log('   ⏭️  CV → pas de cv_storage_path Firebase', 5);
      return;
    }

    // Workday masque parfois le vrai input[type=file] pendant quelques centaines de ms.
    var dropZone = null;
    var fileInput = null;
    for (var attempt = 0; attempt < 6 && !fileInput; attempt++) {
      dropZone = document.querySelector('[data-automation-id="file-upload-drop-zone"]');
      if (dropZone) {
        fileInput = dropZone.querySelector('input[type="file"]');
        if (!fileInput) {
          var parent = dropZone.closest('[data-automation-id*="attachment"], [data-automation-id*="resume"], [data-automation-id*="file"], section, form, div');
          if (parent) {
            fileInput = parent.querySelector('input[type="file"]') ||
              parent.querySelector('input[type="file"][accept]') ||
              parent.querySelector('input[data-automation-id*="file"]');
          }
        }
      }

      if (!fileInput) {
        fileInput = document.querySelector('input[type="file"][id*="resumeAttachments"]') ||
          document.querySelector('input[type="file"][id*="uploadedFile"]') ||
          document.querySelector('input[type="file"][id*="file"]') ||
          document.querySelector('input[type="file"][accept*=".pdf"]') ||
          document.querySelector('input[type="file"][accept*="pdf"]') ||
          document.querySelector('input[type="file"]') ||
          document.querySelector('input[data-automation-id*="file"]');
      }

      if (!fileInput) {
        await new Promise(function(resolve) { setTimeout(resolve, 700); });
      }
    }

    if (!fileInput) {
      log('   ⏭️  CV → input file non trouvé', 5);
      return false;
    }

    var cvName = (profile.cv_filename || (profile.cv_storage_path || '').split('/').pop()) || 'cv.pdf';
    if (step2LastCvHandled && normalizeLoose(step2LastCvHandled) === normalizeLoose(cvName)) {
      log('   — CV → déjà traité pendant cette session, skip upload', 5);
      return true;
    }
    if (isFilenameVisible(cvName)) {
      log('   — CV → ' + cvName + ' déjà visible dans le formulaire, skip upload', 5);
      step2LastCvHandled = cvName;
      return true;
    }
    var cleanup = await cleanupExistingCvUploads(cvName);
    if (cleanup.removed > 0) {
      log('   🧹 CV → ' + cleanup.removed + ' ancienne(s) pièce(s) jointe(s) supprimée(s)', 5);
    } else if (cleanup.alreadyPresent) {
      log('   — CV → ' + cvName + ' déjà présent, skip upload pour éviter les doublons', 5);
      step2LastCvHandled = cvName;
      return true;
    }

    scrollIntoViewIfNeeded(fileInput);
    var ok = await setFileInputFromStorage(fileInput, profile.cv_storage_path, cvName);
    if (ok) {
      log('   ✅ CV → ' + cvName + ' uploadé depuis Firebase', 5);
      step2LastCvHandled = cvName;
      return true;
    } else {
      log('   ❌ CV → échec upload', 5);
      return false;
    }
  }

  async function notifyOfferUnavailable(jobId, jobTitle) {
    try {
      const { taleos_pending_tab } = await chrome.storage.local.get('taleos_pending_tab');
      let taleosTab = taleos_pending_tab;
      if (!taleosTab) {
        const tabs = await chrome.tabs.query({ url: ['*://*.taleos.co/*', '*://*.github.io/*', 'http://localhost/*'] });
        taleosTab = tabs[0]?.id;
      }
      if (taleosTab) {
        chrome.tabs.sendMessage(taleosTab, { action: 'taleos_offer_unavailable', jobId, jobTitle }).catch(() => {});
      }
      chrome.storage.local.remove('taleos_pending_deloitte');
      hideBanner();
      setTimeout(() => { try { chrome.tabs.remove(chrome.tabs.TAB_ID_NONE); } catch(_){} }, 4000);
    } catch (_) {}
  }

  async function runAutomation() {
    const { taleos_pending_deloitte, taleos_deloitte_did_login_click } = await chrome.storage.local.get(['taleos_pending_deloitte', 'taleos_deloitte_did_login_click']);
    if (!taleos_pending_deloitte) {
      log('Pending absent → skip', 0);
      return;
    }

    const age = Date.now() - (taleos_pending_deloitte.timestamp || 0);
    if (age > MAX_PENDING_AGE) {
      // Revivifier une fois : si on a un profil (ex. onglet ouvert via window.open, ancien pending en storage), mettre à jour le timestamp
      if (taleos_pending_deloitte.profile && (taleos_pending_deloitte.profile.auth_email || taleos_pending_deloitte.profile.email)) {
        log('Pending expiré → revivification du timestamp (une fois)', 0);
        chrome.storage.local.set({
          taleos_pending_deloitte: { ...taleos_pending_deloitte, timestamp: Date.now() }
        });
        setTimeout(runAutomation, 800);
        return;
      }
      log('Pending expiré (>10 min) et pas de profil → skip', 0);
      chrome.storage.local.remove(['taleos_pending_deloitte', 'taleos_deloitte_did_login_click']);
      return;
    }

    window.__taleosDeloitteDidLoginClick = !!taleos_deloitte_did_login_click;
    const url = window.location.href;
    log('URL: ' + url.replace(/^https?:\/\/[^/]+/, ''), 0);

    const { profile, tabId } = taleos_pending_deloitte;
    const jobId = taleos_pending_deloitte.jobId || '';
    const jobTitle = taleos_pending_deloitte.jobTitle || '';
    const email = profile?.auth_email || profile?.email || '';
    const password = profile?.auth_password || '';

    // Détection "Offre introuvable"
    const pageText = (document.body?.innerText || '').toLowerCase();
    if (pageText.includes('offre introuvable') || pageText.includes('job not found') || pageText.includes('this position is no longer available') || pageText.includes('cette offre est peut-être expirée')) {
      await validateBlueprintPage(['unavailable'], profile, 'offre_indisponible');
      log('Offre introuvable → notification Taleos', 0);
      await notifyOfferUnavailable(jobId, jobTitle);
      return;
    }

    const successDetected = blueprintApi?.detectPage?.({ document, location })?.key === 'success' ||
      pageText.includes('merci pour votre candidature') ||
      pageText.includes('thank you for applying') ||
      pageText.includes('application submitted');
    if (successDetected) {
      await validateBlueprintPage(['success'], profile, 'succes');
      log('Page Deloitte/Workday de confirmation detectee', 0);
      chrome.runtime.sendMessage({
        action: 'candidature_success',
        bankId: 'deloitte',
        jobId,
        jobTitle,
        companyName: taleos_pending_deloitte.companyName || 'Deloitte',
        offerUrl: taleos_pending_deloitte.offerUrl || url,
        location: taleos_pending_deloitte.location || '',
        contractType: taleos_pending_deloitte.contractType || '',
        experienceLevel: taleos_pending_deloitte.experienceLevel || '',
        jobFamily: taleos_pending_deloitte.jobFamily || '',
        publicationDate: taleos_pending_deloitte.publicationDate || ''
      }).catch(() => {});
      chrome.storage.local.remove(['taleos_pending_deloitte', 'taleos_deloitte_did_login_click']);
      hideBanner();
      return;
    }

    if (!email || !password) {
      log('Identifiants manquants → arrêt', 0);
      chrome.storage.local.remove('taleos_pending_deloitte');
      return;
    }

    showBanner();

    // Sur deloitte.com : d'abord essayer un lien direct Workday, sinon chercher le bouton Postuler
    if (url.includes('deloitte.com') && !url.includes('myworkdayjobs.com')) {
      await validateBlueprintPage(['public_offer', 'unavailable'], profile, 'offre_publique');
      const workdayLink = document.querySelector('a[href*="myworkdayjobs.com"][href*="apply"], a[href*="myworkdayjobs.com"]');
      if (workdayLink?.href) {
        log('Lien Workday trouvé → redirection', 1);
        window.location.href = workdayLink.href;
        return;
      }
    }

    // Étape 1 : Page offre sans /apply → cliquer Postuler (plusieurs sélecteurs, chargement dynamique possible)
    if (!url.includes('/apply') && !url.includes('/apply/')) {
      const bySelector = document.querySelector('a.deloitte-green-button.deloitte-banner-apply-button, a[href*="/apply"], a[href*="myworkdayjobs.com"]');
      const byText = Array.from(document.querySelectorAll('a, button, [role="button"]')).find(el => {
        const t = (el.textContent || '').trim();
        const isPostuler = /^postuler(\s|$)/i.test(t) || (t.toLowerCase().includes('postuler') && t.length < 60);
        return isPostuler && el.offsetParent !== null;
      });
      const btn = bySelector || byText;
      if (btn && btn.offsetParent !== null) {
        log('Clic sur Postuler', 1);
        try { btn.click(); } catch (e) { log('Erreur clic Postuler: ' + e.message, 1); }
        setTimeout(runAutomation, 2000);
        return;
      }
      if (url.includes('deloitte.com')) {
        const offerReport = blueprintApi?.getPublicOfferStructureReport?.(document, url);
        if (offerReport && !offerReport.ok) {
          await logBlueprint({ kind: 'offer_structure', ok: false, ...offerReport, href: url });
          await blueprintApi.storeLastCheck?.({ kind: 'offer_structure', ok: false, ...offerReport, at: new Date().toISOString() });
        }
        log('Bouton Postuler non trouvé → retry dans 2s', 1);
        maybeRetryForPostuler();
        return;
      }
    }

    // Étape 2 / 3 : Connexion d'abord (bouton ou formulaire), JAMAIS "Utiliser ma dernière candidature" avant
    let emailInput = document.querySelector('input[data-automation-id="email"]');
    let passwordInput = document.querySelector('input[data-automation-id="password"]');
    // Workday peut afficher un popup de connexion sans data-automation-id sur les inputs.
    // Dans ce cas, on repère les champs par leur label "Adresse e-mail" / "Mot de passe".
    const altEmailInput = emailInput || document.querySelector('input[aria-label*="Adresse e-mail"], input[placeholder*="Adresse e-mail"]');
    const altPasswordInput = passwordInput || document.querySelector('input[aria-label*="Mot de passe"], input[placeholder*="Mot de passe"]');
    emailInput = altEmailInput;
    passwordInput = altPasswordInput;

    // 2a-bis. Si on est sur le formulaire de CRÉATION de compte (pas connexion), cliquer d'abord sur "Connexion" pour afficher le formulaire de connexion
    let isCreationForm = document.querySelector('input[data-automation-id="confirmPassword"], input[name*="confirmPassword"], input[aria-label*="Confirmer"], input[aria-label*="Confirm "]') ||
      Array.from(document.querySelectorAll('button, [role="button"]')).some(el => /^créer un compte$/i.test((el.textContent || el.getAttribute('aria-label') || '').trim()));
    // Si un vrai formulaire de connexion (email + mot de passe) est visible (popup),
    // on considère qu'on n'est PAS en création de compte même si le DOM de création est présent derrière.
    if (emailInput && passwordInput && emailInput.offsetParent && passwordInput.offsetParent) {
      isCreationForm = false;
    }
    if (isCreationForm) {
      const connexionBtnToShow = document.querySelector('button[aria-label="Connexion"], [data-automation-id="click_filter"][aria-label="Connexion"], [role="button"][aria-label="Connexion"]') ||
        Array.from(document.querySelectorAll('button, [role="button"]')).find(el => /^connexion$/i.test((el.textContent || el.getAttribute('aria-label') || '').trim()));
      if (connexionBtnToShow && connexionBtnToShow.offsetParent !== null) {
        log('Formulaire création de compte détecté → clic sur Connexion pour afficher le formulaire de connexion', 2);
        try { connexionBtnToShow.click(); } catch (e) { log('Erreur clic Connexion: ' + e.message, 2); }
        setTimeout(runAutomation, 2000);
        return;
      }
    }

    // 2a. Si le formulaire CONNEXION est visible (sans champ "Confirmer mot de passe") → on le remplit et on envoie
    if (emailInput && passwordInput && !isCreationForm) {
      await validateBlueprintPage(['login', 'apply_choice'], profile, 'connexion');
      log('Formulaire connexion visible → remplissage email/mot de passe', 2);
      fillInput(emailInput, email);
      fillInput(passwordInput, password);

      const submitBtn = document.querySelector('[data-automation-id="click_filter"][aria-label="Connexion"], [aria-label="Connexion"][role="button"], button[data-automation-id="signInSubmitButton"]');
      if (submitBtn && submitBtn.offsetParent !== null) {
        log('Clic sur Connexion (soumission formulaire)', 2);
        chrome.storage.local.set({ taleos_deloitte_did_login_click: true });
        window.__taleosDeloitteDidLoginClick = true;
        try { submitBtn.click(); } catch (e) { log('Erreur clic submit: ' + e.message, 2); }
        setTimeout(runAutomation, 3000);
        return;
      }
    } else {
      // 2b. Sinon, on cherche le bouton / span "Connexion" pour afficher le formulaire
      await validateBlueprintPage(['apply_choice', 'login', 'personal_details'], profile, 'choix_candidature');
      const connexionSpan = Array.from(document.querySelectorAll('span')).find(s => /^connexion$/i.test((s.textContent || '').trim()));
      const connexionBtn = document.querySelector('[aria-label="Connexion"][role="button"], [data-automation-id="click_filter"][aria-label="Connexion"]');
      const btn = connexionSpan || connexionBtn;
      if (btn && btn.offsetParent !== null) {
        log('Clic sur bouton Connexion (affichage formulaire)', 2);
        chrome.storage.local.set({ taleos_deloitte_did_login_click: true });
        window.__taleosDeloitteDidLoginClick = true;
        try { btn.click(); } catch (e) { log('Erreur clic Connexion: ' + e.message, 2); }
        setTimeout(runAutomation, 2000);
        return;
      }
      log('Aucun bouton Connexion visible', 2);
    }

    // Étape 4 : après connexion, préférer "Postuler manuellement" (PAS "Utiliser ma dernière candidature")
    if (url.includes('/apply') && !url.includes('useMyLastApplication') && !url.includes('applyManually')) {
      const hasConnexionUi = document.querySelector('input[data-automation-id="email"]') ||
        document.querySelector('input[data-automation-id="password"]') ||
        document.querySelector('[aria-label="Connexion"][role="button"], [data-automation-id="click_filter"][aria-label="Connexion"]') ||
        Array.from(document.querySelectorAll('span')).some(s => /^connexion$/i.test((s.textContent || '').trim()));

      const manualBtn = Array.from(document.querySelectorAll('button, [role="button"]')).find(el => {
        const t = (el.textContent || el.getAttribute('aria-label') || '').trim().toLowerCase();
        return /postuler manuellement/.test(t);
      });

      log(`Connexion visible=${!!hasConnexionUi}, bouton "Postuler manuellement"=${!!manualBtn}`, 4);

      // On ne clique JAMAIS "Utiliser ma dernière candidature" ici : uniquement "Postuler manuellement"
      if (!hasConnexionUi && manualBtn && manualBtn.offsetParent !== null) {
        log('Clic sur "Postuler manuellement"', 4);
        try {
          manualBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
        } catch (e) {}
        try {
          manualBtn.click();
        } catch (e) {
          log('Erreur clic Postuler manuellement: ' + e.message, 4);
        }
        setTimeout(runAutomation, 2500);
        return;
      }

      if (!hasConnexionUi && !manualBtn) {
        // Le formulaire peut déjà être visible (Step 1, Step 2 ou autre)
        const formAlreadyVisible = document.querySelector('input[id="source--source"], input[name="legalName--firstName"], input[name="legalName--lastName"]') ||
          document.querySelector('input[name="candidateIsPreviousWorker"]') ||
          document.querySelector('button[name="legalName--title"]') ||
          document.querySelector('[data-automation-id="searchBox"][id="source--source"]') ||
          document.querySelector('button[aria-haspopup="listbox"][id*="degree"], button[aria-haspopup="listbox"][name="degree"]') ||
          document.querySelector('[data-automation-id="file-upload-drop-zone"]') ||
          document.querySelector('[id*="lastYearAttended"]') ||
          document.querySelector('[data-fkit-id*="primaryQuestionnaire"]');
        if (!formAlreadyVisible || !formAlreadyVisible.offsetParent) {
          log('Attente bouton "Postuler manuellement" ou formulaire → retry', 4);
          if (runCount < MAX_RETRIES) {
            runCount++;
            setTimeout(runAutomation, 2000);
            return;
          }
        }
      }
    }

    // Détection étape 3 "Questions de candidature" :
    var step3QuestionnaireEl = document.querySelector('[data-fkit-id*="primaryQuestionnaire"]');
    var step3HasExpField = step3QuestionnaireEl && Array.from(step3QuestionnaireEl.querySelectorAll('legend')).some(function(l) {
      return /niveau\s*(d.)?exp/i.test(l.textContent || '');
    });
    var step3HasDateField = !!document.querySelector('[id*="primaryQuestionnaire"][data-automation-id="dateSectionDay-input"]');
    var isStep3Form = !document.getElementById('name--legalName--firstName')?.offsetParent &&
      !document.querySelector('[data-automation-id="file-upload-drop-zone"]')?.offsetParent &&
      (step3HasExpField || step3HasDateField);
    if (isStep3Form) {
      if (step3AttemptCount >= MAX_STEP_ATTEMPTS) {
        log('📋 Étape 3 : ' + step3AttemptCount + ' tentatives → arrêt', 5);
        chrome.storage.local.remove(['taleos_pending_deloitte', 'taleos_deloitte_did_login_click']);
        setTimeout(hideBanner, 2000);
        return;
      }
      step3AttemptCount++;
      await validateBlueprintPage(['questionnaire'], profile, 'questions_candidature');
      await auditBlueprintQuestions(profile, 'questionnaire', 'questions_candidature');
      log('📋 Étape 3 "Questions de candidature" détectée (tentative ' + step3AttemptCount + '/' + MAX_STEP_ATTEMPTS + ')', 5);
      fillWorkdayStep3Questions(profile);
      clickNextAndContinue(4000);
      return;
    }

    // Détection étape 2 "Mon expérience" (Études) :
    var step1Visible = document.getElementById('name--legalName--firstName') && document.getElementById('name--legalName--firstName').offsetParent;
    var step2DiplomaBtn = document.querySelector('button[aria-haspopup="listbox"][id*="degree"], button[aria-haspopup="listbox"][name="degree"]') ||
      Array.from(document.querySelectorAll('button[aria-haspopup="listbox"]')).find(function(b) {
        return /diplôme/i.test(b.getAttribute('aria-label') || '');
      });
    var step2YearField = document.querySelector('[data-automation-id="dateSectionYear-display"]') ||
      document.querySelector('[id*="lastYearAttended"]');
    var step2DropZone = document.querySelector('[data-automation-id="file-upload-drop-zone"]');
    var isStep2Form = !step1Visible && (
      (step2DiplomaBtn && step2DiplomaBtn.offsetParent !== null) ||
      (step2YearField && step2YearField.offsetParent !== null) ||
      (step2DropZone && step2DropZone.offsetParent !== null)
    );
    if (isStep2Form) {
      if (step2AttemptCount >= MAX_STEP_ATTEMPTS) {
        log('📋 Étape 2 : ' + step2AttemptCount + ' tentatives → arrêt', 5);
        chrome.storage.local.remove(['taleos_pending_deloitte', 'taleos_deloitte_did_login_click']);
        setTimeout(hideBanner, 2000);
        return;
      }
      step2AttemptCount++;
      step3AttemptCount = 0;
      await validateBlueprintPage(['experience'], profile, 'experience');
      await auditBlueprintQuestions(profile, 'experience', 'experience');
      log('📋 Étape 2 "Mon expérience" détectée (tentative ' + step2AttemptCount + '/' + MAX_STEP_ATTEMPTS + ')', 5);
      fillWorkdayStep2Education(profile);
      uploadCvInStep2(profile).then(function (uploadOk) {
        setTimeout(refreshWorkdayRequiredFields, 800);
        clickNextAndContinue(uploadOk ? 7000 : 9000);
      }).catch(function () {
        setTimeout(refreshWorkdayRequiredFields, 800);
        clickNextAndContinue(9000);
      });
      return;
    }

    // Étape 1 : Remplir le formulaire de candidature (profil Firebase) — "Mes données personnelles"
    if (step1Attempts >= 3) {
      log('📋 Étape 1 : ' + step1Attempts + ' tentatives → arrêt', 5);
      chrome.storage.local.remove(['taleos_pending_deloitte', 'taleos_deloitte_did_login_click']);
      setTimeout(hideBanner, 2000);
      return;
    }

    await validateBlueprintPage(['personal_details', 'apply_choice', 'login'], profile, 'donnees_personnelles');
    if (isOnApplyForm) {
      await auditBlueprintQuestions(profile, 'personal_details', 'donnees_personnelles');
    }

    let filled = false;

    var rawWorked = (profile.deloitte_worked != null ? profile.deloitte_worked : profile.deloitteWorked) || 'no';
    var phoneRaw = profile.phone_number || profile['phone-number'] || profile.phone || '';
    var v = function(x) { return x != null && x !== '' ? x : '—'; };
    log('📋 Profil Firebase :', 5);
    log('   ' + v(profile.civility) + ' ' + v(profile.firstname) + ' ' + v(profile.lastname), 5);
    log('   ' + v(profile.address) + ', ' + v(profile.zipcode) + ' ' + v(profile.city), 5);
    log('   Tel: ' + v(profile.phone_country_code) + ' ' + v(phoneRaw) + '  |  Déjà travaillé Deloitte: ' + rawWorked, 5);
    if (rawWorked === 'yes') {
      log('   Ancien bureau: ' + v(profile.deloitte_old_office) + '  |  Ancienne email: ' + v(profile.deloitte_old_email), 5);
    }

    // ——— Champs texte (fillInputIfNeeded pour ne pas réécrire si déjà correct) ———
    const firstnameEl = document.getElementById('name--legalName--firstName');
    const lastnameEl = document.getElementById('name--legalName--lastName');
    const addressLine1El = document.getElementById('address--addressLine1');
    const cityEl = document.getElementById('address--city');
    const postalCodeEl = document.getElementById('address--postalCode');
    var textFields = [
      { el: firstnameEl, val: profile.firstname, label: 'Prénom' },
      { el: lastnameEl, val: profile.lastname, label: 'Nom' },
      { el: addressLine1El, val: profile.address, label: 'Adresse' },
      { el: cityEl, val: profile.city, label: 'Ville' },
      { el: postalCodeEl, val: profile.zipcode, label: 'Code postal' }
    ];
    textFields.forEach(function(f) {
      if (f.el && f.val) {
        if (fillInputIfNeeded(f.el, f.val, f.label)) filled = true;
      }
    });
    if (!firstnameEl && !lastnameEl && url.includes('/apply') && !url.includes('useMyLastApplication')) {
      log('   ⏳ Formulaire pas encore rendu → retry 1s', 5);
      setTimeout(runAutomation, 1000);
      return;
    }
    let hearAboutFilled = false;
    const hearField = document.getElementById('source--source') ||
      document.querySelector('input[data-automation-id="searchBox"][id="source--source"]');
    if (hearField && hearField.offsetParent !== null) {
      scrollIntoViewIfNeeded(hearField);
      try {
        hearField.focus();
        hearField.click();
      } catch (_) {}
      // 1) Premier clic : ligne simple "Site Deloitte Careers" dans la liste principale
      setTimeout(function () {
        const firstRow = Array.from(
          document.querySelectorAll('[data-automation-id="promptOption"][data-automation-label="Site Deloitte Careers"]')
        ).find(function (el) {
          if (!el.offsetParent) return false;
          const isChip = !!el.closest('[data-automation-id="selectedItem"]');
          // On veut la ligne du menu, pas le chip déjà sélectionné
          return !isChip;
        });
        if (!firstRow) {
          log('   ⏭️  Source → option non trouvée dans le menu', 5);
          return;
        }
        const firstClickable = firstRow.closest('[data-automation-id="menuItem"], li, div') || firstRow;
        try {
          firstClickable.click();
        } catch (e) {
          log('   ⏭️  Source → échec clic 1 (' + e.message + ')', 5);
          return;
        }
        // 2) Deuxième clic : ligne radio (promptLeafNode) avec le gros rond
        setTimeout(function () {
          const opt = Array.from(
            document.querySelectorAll('[data-automation-id="promptOption"][data-automation-label="Site Deloitte Careers"]')
          ).find(function (el) {
            if (!el.offsetParent) return false;
            const leaf = el.closest('[data-automation-id="promptLeafNode"]');
            return !!leaf;
          });
          if (!opt) {
            log('   ⏭️  Source → radio "Site Deloitte Careers" non trouvé', 5);
            return;
          }
          const leafRow = opt.closest('[data-automation-id="promptLeafNode"]') ||
            opt.closest('[data-automation-id="menuItem"], [role="menuitemradio"], li, div') || opt;
          try {
            leafRow.click();
            hearAboutFilled = true;
            filled = true;
            log('   ✅ Source → "Site Deloitte Careers"', 5);
          } catch (e) {
            log('   ⏭️  Source → échec clic radio (' + e.message + ')', 5);
          }
        }, 350);
      }, 350);
    }
    if (!hearAboutFilled) {
      log('   ⏭️  Source → champ non trouvé (retry)', 5);
    }

    // ——— Avez-vous déjà travaillé pour Deloitte? ———
    const workedRaw = profile.deloitte_worked || profile.deloitteWorked || 'no';
    const workedYesNo = workedRaw === 'yes' ? 'Oui' : 'Non';
    const workedSelect = findSelectByLabel(['avez-vous déjà travaillé pour deloitte', 'have you worked for deloitte']);
    if (workedSelect) {
      fillSelect(workedSelect, workedYesNo);
      filled = true;
    }
    var workedHandled = false;
    const workedRadioValues = workedRaw === 'yes' ? ['yes', '1', 'oui', 'true'] : ['no', '0', 'non', 'false'];
    const workedRadios = document.querySelectorAll('input[type="radio"][name*="worked"], input[type="radio"][name*="deloitte"], input[type="radio"][name*="previous"], input[name="candidateIsPreviousWorker"]');
    for (const r of workedRadios) {
      const rv = (r.value || '').toLowerCase();
      if (workedRadioValues.some(x => rv === x || rv.includes(x))) {
        if (!r.checked) {
          r.click();
          log('   ✅ Déjà travaillé Deloitte → ' + workedYesNo, 5);
          filled = true;
        } else {
          log('   — Déjà travaillé Deloitte → déjà ' + workedYesNo, 5);
        }
        workedHandled = true;
        break;
      }
    }
    if (!workedHandled) {
      const radioYes = document.querySelector('input[name="candidateIsPreviousWorker"][type="radio"][value="true"]') || document.querySelector('input[name="candidateIsPreviousWorker"][type="radio"][value="1"]');
      const radioNo = document.querySelector('input[name="candidateIsPreviousWorker"][type="radio"][value="false"]') || document.querySelector('input[name="candidateIsPreviousWorker"][type="radio"][value="0"]');
      const radio = workedRaw === 'yes' ? radioYes : radioNo;
      if (radio) {
        if (radio.checked) {
          log('   — Déjà travaillé Deloitte → déjà ' + workedYesNo, 5);
        } else {
          const style = typeof getComputedStyle !== 'undefined' ? getComputedStyle(radio) : null;
          const hidden = !radio.offsetParent || (style && (parseFloat(style.opacity) === 0 || style.visibility === 'hidden'));
          if (hidden) {
            const labelToClick = (radio.id && document.querySelector('label[for="' + radio.id + '"]')) || radio.closest('label') ||
              Array.from(document.querySelectorAll('label, span[role="presentation"], [data-automation-id="label"]')).find(el => /^(oui|non)$/i.test((el.textContent || '').trim()) && el.closest('div, li')?.querySelector('input[name="candidateIsPreviousWorker"]') === radio);
            if (labelToClick && labelToClick.offsetParent !== null) {
              scrollIntoViewIfNeeded(labelToClick);
              labelToClick.click();
              log('   ✅ Déjà travaillé Deloitte → ' + workedYesNo + ' (via label)', 5);
              filled = true;
            } else {
              radio.click();
              log('   ✅ Déjà travaillé Deloitte → ' + workedYesNo, 5);
              filled = true;
            }
          } else {
            radio.click();
            log('   ✅ Déjà travaillé Deloitte → ' + workedYesNo, 5);
            filled = true;
          }
        }
      } else {
        const sectionLabel = Array.from(document.querySelectorAll('h2, h3, h4')).find(function(h) {
          const t = (h.textContent || '').toLowerCase();
          return t.includes('avez-vous déjà travaillé pour deloitte') || t.includes('have you worked for deloitte');
        });
        if (sectionLabel) {
          const container = sectionLabel.closest('section, div') || document;
          const wanted = workedRaw === 'yes' ? /oui/i : /non/i;
          const label = Array.from(container.querySelectorAll('label, span')).find(function(el) {
            return wanted.test((el.textContent || '').trim());
          });
          if (label && label.offsetParent !== null) {
            scrollIntoViewIfNeeded(label);
            label.click();
            log('   ✅ Déjà travaillé Deloitte → ' + workedYesNo + ' (fallback label)', 5);
            filled = true;
          } else {
            log('   ⏭️  Déjà travaillé → radio non trouvé', 5);
          }
        } else {
          log('   ⏭️  Déjà travaillé → radio non trouvé', 5);
        }
      }
    }
    if (!workedHandled && !filled && clickWorkdayOptionByLabelAndValue(['avez-vous déjà travaillé pour deloitte', 'have you worked for deloitte'], workedYesNo)) {
      filled = true;
    }

    // Si oui : ancien bureau + ancienne adresse email (champs supplémentaires Workday)
    if (workedRaw === 'yes') {
      var oldOfficeVal = (profile.deloitte_old_office || '').trim();
      var oldEmailVal = (profile.deloitte_old_email || '').trim();

      var oldOfficeEl = document.getElementById('previousWorker--location') ||
        findInputByLabel(['votre ancien bureau', 'your previous office', 'ancien bureau']);
      if (oldOfficeEl && oldOfficeVal) {
        if (fillInputIfNeeded(oldOfficeEl, oldOfficeVal, 'Ancien bureau')) filled = true;
      } else if (!oldOfficeEl) {
        log('   ⏭️  Ancien bureau → champ non trouvé', 5);
      }

      var oldEmailEl = document.getElementById('previousWorker--email') ||
        findInputByLabel(['votre ancienne adresse email', 'your previous email', 'ancienne adresse email']);
      if (oldEmailEl && oldEmailVal) {
        if (fillInputIfNeeded(oldEmailEl, oldEmailVal, 'Ancienne email')) filled = true;
      } else if (!oldEmailEl) {
        log('   ⏭️  Ancienne email → champ non trouvé', 5);
      }
    }

    // ——— Titre (préfixe) : bouton Workday → Monsieur / Madame ———
    const titleCivility = (profile.civility || '').trim();
    if (titleCivility) {
      const titleOption = /madame|mme|mrs|female/i.test(titleCivility) ? 'Madame' : 'Monsieur';
      let titleBtn =
        document.getElementById('name--legalName--title') ||
        document.querySelector('button[name="legalName--title"]') ||
        document.querySelector('[role="button"][aria-label^="Titre (préfixe)"]') ||
        document.querySelector('button[aria-label^="Titre (préfixe)"]') ||
        document.querySelector('[role="combobox"][aria-label^="Titre (préfixe)"]') ||
        document.querySelector('button[aria-haspopup="listbox"][name*="legalName--title"]') ||
        document.querySelector('[role="combobox"][name*="legalName--title"]');
      if (titleBtn && titleBtn.offsetParent !== null) {
        scrollIntoViewIfNeeded(titleBtn);
        if (clickWorkdayListboxOption(titleBtn, titleOption, 'Titre (préfixe)')) filled = true;
      } else if (clickWorkdayListboxOption('name--legalName--title', titleOption, 'Titre (préfixe)')) {
        filled = true;
      } else {
        log('   ⏭️  Titre → bouton non trouvé', 5);
      }
    }

    // ——— Type d'appareil téléphonique : bouton listbox (menus à traiter plus tard) ———
    let phoneTypeBtn =
      document.getElementById('phoneNumber--phoneType') ||
      document.querySelector('button[name="phoneType"]') ||
      document.querySelector(
        '[role="button"][aria-label^="Type d\'appareil téléphonique"], ' +
        'button[aria-label^="Type d\'appareil téléphonique"], ' +
        '[role="combobox"][aria-label^="Type d\'appareil téléphonique"], ' +
        'button[aria-haspopup="listbox"][name*="phoneType"], ' +
        '[role="combobox"][name*="phoneType"]'
      );
    if (phoneTypeBtn && phoneTypeBtn.offsetParent !== null) {
      scrollIntoViewIfNeeded(phoneTypeBtn);
      if (clickWorkdayListboxOption(phoneTypeBtn, 'Mobile Personnel', 'Type d\'appareil téléphonique')) filled = true;
    } else if (clickWorkdayListboxOption('phoneNumber--phoneType', 'Mobile Personnel', 'Type d\'appareil téléphonique')) {
      filled = true;
    } else {
      log('   ⏭️  Type téléphone → bouton non trouvé', 5);
    }

    // ——— Numéro de téléphone : id="phoneNumber--phoneNumber" ou name="phoneNumber" ———
    const phoneVal = (profile.phone_number || profile['phone-number'] || profile.phone || '').trim().replace(/\s/g, '');
    const phoneEl = document.getElementById('phoneNumber--phoneNumber') || document.querySelector('input[name="phoneNumber"][id*="phoneNumber"]') || document.querySelector('input[name="phoneNumber"]');
    if (phoneEl && phoneVal && fillInputStrict(phoneEl, phoneVal, 'Numéro de téléphone', { normalize: normalizeDigits })) filled = true;

    // Détection : on est sur un formulaire de candidature (apply ou applyManually, mais pas useMyLastApplication)
    var isOnApplyForm = url.includes('/apply') && !url.includes('useMyLastApplication');

    if (isOnApplyForm) {
      var validationFields = [
        { el: firstnameEl, label: 'Prénom(s)', val: profile.firstname },
        { el: lastnameEl, label: 'Nom de famille', val: profile.lastname },
        { el: addressLine1El, label: 'Nature et nom de la voie', val: profile.address },
        { el: cityEl, label: 'Ville', val: profile.city },
        { el: postalCodeEl, label: 'Code postal', val: profile.zipcode },
        { el: phoneEl, label: 'Numéro de téléphone', val: phoneVal }
      ];
      if (rawWorked === 'yes') {
        var pvLocEl = document.getElementById('previousWorker--location');
        var pvEmailEl = document.getElementById('previousWorker--email');
        if (pvLocEl) validationFields.push({ el: pvLocEl, label: 'Ancien bureau', val: (profile.deloitte_old_office || '').trim() });
        if (pvEmailEl) validationFields.push({ el: pvEmailEl, label: 'Ancienne email', val: (profile.deloitte_old_email || '').trim() });
      }
      setTimeout(function() { workdayClickThenClickAway(validationFields); }, 800);
      if (phoneEl && phoneVal) {
        setTimeout(function() {
          fillInputStrict(phoneEl, phoneVal, 'Numéro de téléphone', { normalize: normalizeDigits });
        }, 1800);
      }

      // ——— Indicatif de pays (code téléphone) : exécuté EN DERNIER, après toutes les validations ———
      var phoneCountryCode = (profile.phone_country_code || '').trim().replace(/\s/g, '');
      if (phoneCountryCode) {
        var wantLabel = phoneCountryCode === '+44' ? 'Royaume-Uni (+44)' : phoneCountryCode === '+33' ? 'France (+33)' : phoneCountryCode;
        log('   ⏳ Indicatif pays → ' + wantLabel + ' (exécution différée 3s)', 5);
        setTimeout(function () {
          var indicatifTextbox = document.getElementById('phoneNumber--countryPhoneCode');
          if (!indicatifTextbox) {
            try {
              var searchInputs = Array.from(document.querySelectorAll('input[placeholder="Rechercher"]'));
              indicatifTextbox = searchInputs.find(function (inp) {
                var field = inp.closest('[data-automation-id^="formField-"], section, div');
                var txt = (field && field.textContent || '').toLowerCase();
                return txt.includes('indicatif de pays');
              }) || null;
            } catch (_) {}
          }
          if (!indicatifTextbox) {
            indicatifTextbox = document.querySelector('[role="textbox"][aria-label^="Indicatif de pays"]') ||
              document.querySelector('input[aria-label*="Indicatif de pays"]');
          }
          if (indicatifTextbox && indicatifTextbox.offsetParent !== null) {
            scrollIntoViewIfNeeded(indicatifTextbox);
            try {
              indicatifTextbox.focus();
              indicatifTextbox.click();
            } catch (_) {}
            fillInput(indicatifTextbox, wantLabel);
            setTimeout(function () {
              pressEnterSequence(indicatifTextbox);
              log('   ✅ Indicatif pays → ' + wantLabel, 5);
            }, 500);
          } else {
            log('   ⏭️  Indicatif pays → textbox non trouvée', 5);
          }
        }, 3000);
      }
    }

    if (filled && url.includes('useMyLastApplication')) {
      formFillRetryCount = 0;
      log('✅ Formulaire rempli (useMyLastApplication) → fin', 5);
      chrome.storage.local.remove(['taleos_pending_deloitte', 'taleos_deloitte_did_login_click']);
      setTimeout(hideBanner, 2000);
      return;
    }
    // Sur apply : toujours valider et cliquer "Enregistrer et continuer" (même si filled=false au retry)
    if (isOnApplyForm) {
      step1Attempts++;
      log('✅ Étape 1 tentative ' + step1Attempts + '/3 → clic auto "Enregistrer et continuer"', 5);
      clickNextAndContinue(6000);
      return;
    }
    if (filled) {
      formFillRetryCount = 0;
      log('Champs remplis → réessai dans 2s', 5);
      setTimeout(runAutomation, 2000);
      return;
    }

    if (url.includes('/apply') && (emailInput || filled)) {
      log('Formulaire en cours → pending conservé', 5);
      setTimeout(runAutomation, 3000);
      return;
    }

    // Sur useMyLastApplication : le formulaire peut se charger en différé → retry sans enlever le bandeau
    if (url.includes('useMyLastApplication') && formFillRetryCount < MAX_FORM_FILL_RETRIES) {
      formFillRetryCount++;
      log('Formulaire pas encore prêt → retry ' + formFillRetryCount + '/' + MAX_FORM_FILL_RETRIES + ' dans 2s (bandeau conservé)', 5);
      setTimeout(runAutomation, 2000);
      return;
    }

    formFillRetryCount = 0;
    chrome.storage.local.remove(['taleos_pending_deloitte', 'taleos_deloitte_did_login_click']);
    setTimeout(hideBanner, 2000);
  }

  let runCount = 0;
  const MAX_RETRIES = 8;
  let postulerRetryCount = 0;
  const MAX_POSTULER_RETRIES = 6;
  let formFillRetryCount = 0;
  const MAX_FORM_FILL_RETRIES = 12;
  var step1Attempts = 0;
  let step2AttemptCount = 0;
  let step3AttemptCount = 0;
  let step2LastEstablishmentApplied = '';
  let step2LastCvHandled = '';
  const MAX_STEP_ATTEMPTS = 4;

  function maybeRetryForPostuler() {
    if (postulerRetryCount >= MAX_POSTULER_RETRIES) return;
    if (!window.location.href.includes('deloitte.com') || window.location.href.includes('myworkdayjobs.com')) return;
    postulerRetryCount++;
    log('Retry ' + postulerRetryCount + '/' + MAX_POSTULER_RETRIES + ' (attente bouton Postuler)', 1);
    setTimeout(runAutomation, 2000);
  }

  function scheduleRun(delay) {
    chrome.storage.local.get('taleos_pending_deloitte').then((s) => {
      if (s.taleos_pending_deloitte) {
        runCount = 0;
        setTimeout(runAutomation, delay || 1500);
      }
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.taleos_pending_deloitte?.newValue) {
      runCount = 0;
      postulerRetryCount = 0;
      formFillRetryCount = 0;
      setTimeout(runAutomation, 1000);
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => scheduleRun(2000));
  } else {
    scheduleRun(1500);
  }

  window.addEventListener('pageshow', function(ev) {
    if (ev.persisted) scheduleRun(2000);
  });


  // Retry si on est sur /apply (URL de base) et que le bouton "Utiliser ma dernière candidature" n'est pas encore chargé
  function maybeRetryForUseLastApp() {
    const href = window.location.href;
    if (!href.includes('/apply') || href.includes('useMyLastApplication')) return;
    if (runCount >= MAX_RETRIES) return;
    runCount++;
    log('Retry ' + runCount + '/' + MAX_RETRIES + ' (attente bouton)', 4);
    setTimeout(runAutomation, 2000);
  }
})();
