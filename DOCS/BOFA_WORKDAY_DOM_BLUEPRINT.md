# Blueprint DOM — Bank of America Workday

> URL cible : `ghr.wd1.myworkdayjobs.com`  
> Référence : `extension/content/bank-of-america-workday-filler.js`

---

## Architecture générale du formulaire

Le formulaire BofA Workday est une SPA React multi-étapes. La progression est linéaire :

```
Page offre → Sign In → Apply → Step 1 → Step 2 → Step 3 → Step 4 → Step 5 → Review → Submit
```

**Détection de l'étape courante :**
```js
// Sélecteur : labels[1] du progressBar actif
document.querySelector('[data-automation-id="progressBarActiveStep"]')
  ?.querySelectorAll('label')[1]?.textContent
```

| Valeur textuelle (lowercase) | Step interne |
|------------------------------|--------------|
| `my information`             | `my_information` |
| `my experience`              | `my_experience` |
| `application questions`      | `application_questions` |
| `voluntary`                  | `voluntary_disclosures` |
| `self identify` / `self-identify` | `self_identify` |
| `review`                     | `review` |

---

## Connexion (Sign In)

**Détection connecté :**
- `document.getElementById('accountSettingsButton')` → connecté
- Présence d'un élément texte `^sign\s*in$` visible → non connecté

**Formulaire login :**
```
input[data-automation-id="email"]           ← champ email
input[data-automation-id="password"]        ← champ mot de passe (ou input[type="password"])
[data-automation-id="click_filter"][aria-label="Sign In"]  ← bouton submit
[data-automation-id="signInSubmitButton"]   ← bouton submit (variante)
```

---

## Navigation vers le formulaire (Apply)

BofA peut afficher un popup "Apply Manually" vs "Apply with LinkedIn".  
**Stratégie** : toujours forcer `/apply/applyManually` pour avoir un formulaire vierge avec les wrappers `formField-*`.

```js
// Popup Apply Manually
[data-automation-id="applyManually"]   ← lien direct (si disponible)
// Boutons Apply sur la page offre
[data-automation-id="adventureButton"]
[data-automation-id="continueButton"]
[data-automation-id="applyNow"]
```

**Bouton Save and Continue / Next :**
```js
// Texte "Save and Continue" (insensible à la casse)
[data-automation-id="pageFooterNextButton"]   ← fallback
```

**Chargement du formulaire :**  
Attendre `[data-automation-id="progressBarActiveStep"]` (jusqu'à 12 secondes).

---

## Step 1 — My Information

**Attendre que React ait rendu les champs :**
```js
'[data-automation-id^="formField-legalName"] input, ' +
'input[name="legalName--firstName"], input[id*="legalName--firstName"]'
```

### Champs texte (wrappers `formField-*`)

| `data-automation-id` wrapper | Contenu | Firebase |
|------------------------------|---------|---------|
| `formField-legalName--firstName` | Prénom | `firstname` / `first_name` |
| `formField-legalName--lastName` | Nom | `lastname` / `last_name` |
| `formField-addressLine1` | Adresse | `address` |
| `formField-city` | Ville | `city` |
| `formField-postalCode` | Code postal | `zipcode` / `postal_code` |

**Fallback EMEA** (pas de wrapper `formField-*`) :
- `input[name="legalName--firstName"]`
- `input[id$="--firstName"]`
- `input[id*="firstName"]`

### How Did You Hear About Us ?

```
[data-automation-id="formField-source"]            ← wrapper
[data-automation-id="selectedItem"]                ← chips sélectionnés (US)
[data-automation-id="promptOption"]                ← chips sélectionnés (EMEA)
[data-automation-id="multiselectInputContainer"]   ← déclencheur du multiselect
[data-automation-id="multiSelectContainer"]        ← conteneur global
```
Valeur cible : `"Bank of America Careers Site"` (peut nécessiter 2 niveaux de sélection).

### Country

```
[data-automation-id="formField-country"] button[aria-haspopup]
```
Valeur : `"France"` (ou `p.country`).

### Previously employed by BofA ?

```
[data-automation-id="formField-candidateIsPreviousWorker"] input[value="false"]
[data-automation-id="formField-candidateIsPreviousWorker"] input[value="true"]
```
Firebase : `p.bofa_previously_employed` (`"Yes"` ou `"No"`, défaut `"No"`).

### Phone Device Type

```
[data-automation-id="formField-phoneType"] button[aria-haspopup]
#phoneNumber--phoneType   ← variante EMEA
```
Valeur : `"Mobile"`.

### Country Phone Code

```
[data-automation-id="formField-countryPhoneCode"]          ← wrapper
[data-automation-id="formField-phoneDeviceType"] button[aria-haspopup]
[id*="phoneNumber--"][id*="countryPhone"] button
[id*="phoneNumber--phoneCountry"] button
```
Valeur : `"France (+33)"`. Vérifier `innerText` avant de cliquer.

### Phone Number

```
[data-automation-id="formField-phoneNumber"] input:not([type="hidden"])
#phoneNumber--phoneNumber
input[name="phoneNumber"]
```
Firebase : `p['phone-number']` / `p.phone_number` / `p.phone` (supprimer les espaces).

---

## Step 2 — My Experience

### Education (section ignorée par défaut dans le filler)

```
[data-automation-id="formField-school"] input    ← champ école
input[id*="--school"]                            ← variante EMEA
[data-automation-id="formField-degree"] button[aria-haspopup]  ← niveau
[data-automation-id="formField-lastYearAttended"]              ← année
```
**Bouton Add Education** : 2ème bouton `button[text="Add"]` visible dans le DOM (le 1er est Work Experience).

Typeahead : utiliser `simulateTyping()` + attendre les suggestions `[role="option"]` / `[data-automation-id="promptLeafNode"]`.

Mapping niveau d'études → Workday :
| Firebase (regex) | Workday |
|------------------|---------|
| `bac\+5\|m\.?sc\|master\|m2\|grande.?école` | `Master's Degree` |
| `bac\+3\|bachelor\|licence\|bsc` | `Bachelor's Degree` |
| `phd\|doctorat\|doctorate\|bac\+8` | `Doctorate` |
| `bac\+2\|bts\|dut` | `Associate's Degree` |

### Languages

**Ancre fiable pour la section Languages :** `input[name="native"]` (un par ligne de langue).

**Structure d'une ligne de langue :**
```
button[aria-haspopup][aria-label^="Language"]         ← sélecteur de langue
button[aria-haspopup][aria-label^="Written and Spoken"] ← niveau
input[name="native"]                                  ← checkbox Fluent/Native
```

**Boutons Add :**
- Premier Add : remonter depuis `input[name="native"]` jusqu'à 14 niveaux ou chercher heading `"Languages"`.
- Add Another : même logique, bouton avec texte `/add another/i`.

**Mapping niveaux :**
| Firebase (keywords) | Workday |
|---------------------|---------|
| native, bilingual, fluent, courant, maternelle, bilingue | `Fluent` |
| intermediate, intermédiaire, conversational, professional, working | `Intermediate` |
| (autres) | `Basic` |

**Mapping noms de langues (extrait) :**
```
français/french/francais → French
anglais/english → English
espagnol/spanish → Spanish
allemand/german → German
```
(voir `LANG_NAME_MAP` dans le filler pour la liste complète)

### Upload CV

```
[data-automation-id="file-upload-item-name"]     ← nom du fichier affiché
[data-automation-id="file-upload-successful"]    ← confirmation Workday
[data-automation-id="delete-file"]              ← bouton suppression (direct)
input[type="file"]                               ← file input pour l'upload
```
Firebase : `p.cv_storage_path`, `p.cv_filename`.  
**Logique** : si `file-upload-item-name` contient déjà le nom du CV → skip. Sinon : delete → re-upload.

---

## Step 3 — Application Questions

### Structure des wrappers

Deux types de wrappers coexistent :

1. **`[data-automation-id^="formField-"]`** — standard Workday (steps 1/2 et certaines questions)
2. **Hors `formField-*`** — wrappers avec `id="primaryQuestionnaire--..."` (questions spécifiques BofA)

**Extraction du texte de la question :**
- Dans un `formField-*` : `legend [data-automation-id="richText"]` → `label` → `legend`
- Hors `formField-*` : remonter 12 niveaux en cherchant `legend [data-automation-id="richText"]`, `label`, ou frères précédents avec `innerText > 10 chars`

### Widget date Workday (segments)

```
[data-automation-id="dateSectionMonth-display"]   ← détection
[data-automation-id="dateSectionMonth-input"]     ← input (EMEA)
[data-automation-id="dateSectionMonth"]           ← input (US)
[data-automation-id="dateSectionDay-input"]
[data-automation-id="dateSectionYear-input"]
```
Setter via React (_valueTracker reset + Event input/change/keyup).

### Dropdowns

```js
button[aria-haspopup="listbox"]
button[aria-haspopup="true"]
```
Options : `[role="option"]`, `[data-automation-id="promptOption"]`, `[data-automation-id="menuItem"]`.

**Détection "déjà rempli" :** `innerText` non vide, pas `"Select One"` ni `"Select"`.

### Questions reconnues — mapping Firebase → réponses

| Pattern question (regex) | Firebase key | Valeurs possibles |
|--------------------------|-------------|-------------------|
| `right.to.work\|authorized.to.work` | `bofa_right_to_work` | `"Yes"` / `"No"` |
| `which option.*right.to.work` | `bofa_right_to_work_type` | `"Citizenship"`, `"Skilled Worker visa"`, ... |
| `relatives\|close personal relationship` | `bofa_has_relatives` | `"Yes"` / `"No"` |
| (si Yes) relatives details textarea | `bofa_relatives_details` | texte libre |
| `referred.*bank\|bank.*referred` | `bofa_referred` | `"No"`, `"Yes_employee"`, `"Yes_client"` |
| (si Yes_employee) | → | `"Yes, by a Bank of America employee"` |
| (si Yes_client) | → | `"Yes, by a Bank of America client/customer"` |
| `pricewaterhouse\|pwc` | `bofa_worked_at_pwc` | `"Yes"` / `"No"` |
| `finra.*license` | `bofa_finra_license` | ex. `"I do not hold a FINRA license"` |
| `vendor.worker` | `bofa_is_vendor_worker` | `"Yes"` / `"No"` |
| `previously applied` | `bofa_previously_applied` | `"Yes"` / `"No"` |
| `notice.period` | `sg_notice_period` | voir tableau ci-dessous |
| `other business.*proprietor` | `bofa_other_business` | `"Yes"` / `"No"` |
| (si Yes) détails | `bofa_other_business_details` | texte libre |
| `medical condition\|disability.*adjust` | `bofa_medical_condition` | `"Yes"` / `"No"` |
| (si Yes) détails | `bofa_medical_details` | texte libre |
| `additional information.*disclose` | `bofa_additional_info` | `"Yes"` / `"No"` |
| (si Yes) détails | `bofa_additional_info_details` | texte libre |
| `armed forces` | `jp_morgan_military_service` | `"No"`, `"Yes..."` |
| `most recent.*employer\|current.*employer` | `current_employer` | texte libre |
| `base.salary\|current.*salary` | `current_salary` + `current_salary_currency` | ex. `"50000 EUR"` |
| `minimum.*salary\|salary requirement` | `salary_expectations` / `min_salary` | texte libre |
| `incentive\|bonus` | `current_bonus` | nombre |
| `start.date.*employer` | `employment_start_date` | ISO date → `MM/DD/YYYY` |
| `start.date.*role` | `current_role_start_date` | ISO date |
| `referrer\|name.*refer` | `bofa_referrer_name` | texte libre |

**Mapping Notice Period Firebase → BofA :**
| Firebase | BofA |
|----------|------|
| `none` / vide | `Up to 4 weeks` |
| `1_month` / `4_weeks` | `Up to 4 weeks` |
| `2_months` | `5 to 8 weeks` |
| `3_months` | `9 to 12 weeks` |
| `more_than_3_months` | `12 weeks+` |

**Fallback inconnu :** tenter `"No"` si cette option existe dans le dropdown.

### Textareas (React)

Utiliser `document.execCommand('insertText')` (pas `reactSet`) pour que React reconnaisse la valeur :
```js
textarea.focus();
textarea.select();
document.execCommand('selectAll', false);
document.execCommand('delete', false);
document.execCommand('insertText', false, val);
textarea.blur();
```

---

## Step 4 — Voluntary Disclosures

```
input[name="acceptTermsAndAgreements"]            ← Terms & Conditions (EMEA)
input[type="checkbox"][aria-required="true"]      ← fallback
```

---

## Step 5 — Self Identify

Section optionnelle — laissée vide (aucun remplissage automatique).

---

## Step 6 — Review & Submit

```js
// Bouton Submit
Array.from(document.querySelectorAll('button')).find(b => /^submit$/i.test(b.innerText.trim()))
[data-automation-id*="submit"]   ← fallback
```

**Confirmation succès :** détecter `"thank you"` / `"application submitted"` / `"candidature"` dans `document.body.innerText`.

---

## Utilitaires DOM clés

### reactSet (inputs)
```js
const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
setter.call(el, value);
el.dispatchEvent(new Event('input', { bubbles: true }));
el.dispatchEvent(new Event('change', { bubbles: true }));
```

### simulateTyping (typeaheads)
Frappe caractère par caractère avec `_valueTracker` reset à chaque caractère. Délai 60ms/char, 200ms avant premier char.

### selectBestOption (dropdowns)
1. `btn.click()` → attendre options (max 2s)
2. Match exact lowercase → match partiel
3. Escape si aucune option trouvée

### Multiselect (How Did You Hear, Country Phone Code)
```
[data-automation-id="multiselectInputContainer"]  ← clic pour ouvrir
[data-uxi-widget-type="multiselect"]              ← variante
```

---

## Champs Firebase BofA spécifiques (`bofa_*`)

Ces champs doivent exister dans `HTML/profile.html` **et** dans `fetchProfile` du filler.

| Champ Firebase | Type | Valeurs |
|----------------|------|---------|
| `bofa_previously_employed` | select | `"Yes"` / `"No"` |
| `bofa_right_to_work` | select | `"Yes"` / `"No"` |
| `bofa_right_to_work_type` | select | `"Citizenship"`, `"Skilled Worker visa"`, ... |
| `bofa_has_relatives` | select | `"Yes"` / `"No"` |
| `bofa_relatives_details` | text | texte libre (si Yes) |
| `bofa_referred` | select | `"No"`, `"Yes_employee"`, `"Yes_client"` |
| `bofa_referrer_name` | text | texte libre (si Yes) |
| `bofa_worked_at_pwc` | select | `"Yes"` / `"No"` |
| `bofa_finra_license` | select | ex. `"I do not hold a FINRA license"` |
| `bofa_is_vendor_worker` | select | `"Yes"` / `"No"` |
| `bofa_previously_applied` | select | `"Yes"` / `"No"` |
| `bofa_other_business` | select | `"Yes"` / `"No"` |
| `bofa_other_business_details` | text | texte libre (si Yes) |
| `bofa_medical_condition` | select | `"Yes"` / `"No"` |
| `bofa_medical_details` | text | texte libre (si Yes) |
| `bofa_additional_info` | select | `"Yes"` / `"No"` |
| `bofa_additional_info_details` | text | texte libre (si Yes) |

---

## Variantes US vs EMEA

| Point | US | EMEA |
|-------|----|------|
| Wrappers formField-* | Présents | Absents → fallback `name=` / `id=` |
| Country Phone Code | `button[aria-haspopup]` standard | multiselect container |
| Questions Step 3 | Dans `formField-*` | `id="primaryQuestionnaire--..."` hors formField |
| Terms & Conditions | Absents | Step 4 : `input[name="acceptTermsAndAgreements"]` |
| getFieldLabel | `label` | `legend [data-automation-id="richText"]` |

---

## Bannière Taleos

```js
// Positionnée à top: 60px (sous le header BofA)
// Couleurs : #012169 (bleu BofA) | #c62828 (erreur) | #2e7d32 (succès) | #c47900 (avertissement)
document.getElementById('taleos-bofa-banner')
```
