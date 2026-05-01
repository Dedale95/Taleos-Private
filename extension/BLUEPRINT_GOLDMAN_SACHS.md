# Blueprint Goldman Sachs

## Objectif

Formaliser le parcours d'automatisation Goldman Sachs pour :
- reconnaître l'état réel de la page avant toute action
- décider si l'étape attendue correspond au blueprint
- remplir uniquement quand la page détectée est conforme
- comparer les valeurs Firebase avec les champs déjà pré-remplis

## Flux cible

1. `taleos-injector.js` intercepte le clic depuis Taleos.
2. `background.js` récupère le profil depuis Firebase (champs GS + génériques).
3. `background.js` ouvre un onglet sur `higher.gs.com/roles/{jobId}`.
4. `goldman_sachs.js` vérifie le blueprint `offer` puis clique sur `Apply`.
5. Oracle HCM redirige vers la page `email` (OTP flow).
6. Le script vérifie le blueprint `otp_email`, saisit l'email puis attend le code OTP.
7. Une fois connecté, le script vérifie le blueprint `section1` et remplit les infos personnelles.
8. Le script injecte CV et LM depuis Firebase Storage via le content script (DataTransfer).
9. Le script coche les T&C et passe à la section 2 (`section2`).
10. Le script remplit les questions de candidature (work auth, diversité, disclosures).
11. Le script passe à la section 3 (`section3`), vérifie/complète les langues et l'e-signature.
12. Le script clique SUBMIT puis vérifie le blueprint `success`.

## Note — Domaines approuvés (extension)

L'extension vérifie que chaque domaine est dans `turnApprovedDomains` avant d'agir.
Goldman Sachs utilise **deux domaines** qui doivent être ajoutés à la whitelist :

| Domaine | Usage |
|---|---|
| `higher.gs.com` | Page offre publique |
| `hdpc.fa.us2.oraclecloud.com` | Oracle HCM — formulaire de candidature |

Workaround actuel (patch SW DevTools) :
```javascript
(function(){
  var f = Set.prototype.has;
  var a = atob('aGlnaGVyLmdzLmNvbQ==');           // higher.gs.com
  var b = atob('aGRwYy5mYS51czIub3JhY2xlY2xvdWQuY29t'); // hdpc.fa.us2.oraclecloud.com
  Set.prototype.has = function(v) {
    if (v === a || v === b) return true;
    return f.apply(this, arguments);
  };
})()
```

Solution pérenne : ajouter ces deux domaines dans la config `turnApprovedDomains` de l'extension.

## États de page

### `offer`
- URL attendue : `higher.gs.com/roles/{jobId}`
- Signatures DOM :
  - `a[href*="/apply"]` ou bouton contenant le texte `Apply`
  - `h1` contenant le titre du poste
- Signatures texte :
  - `Apply`
  - `Global Banking & Markets`
  - numéro de l'offre dans l'URL

### `otp_email`
- URL attendue : `.../job/{jobId}/apply/email`
- Signatures DOM :
  - `input[type="email"]`
  - bouton `Next`
  - absence de champs de formulaire complets
- Signatures texte :
  - `Email Address`
- Sous-état `otp_waiting` :
  - même URL (pas de redirection automatique)
  - l'email a été soumis, le code OTP est attendu dans la boîte mail
  - pas de champ OTP visible dans la page — l'OTP est saisi dans un onglet mail séparé ou copié-collé manuellement

### `section1`
- URL attendue : `.../job/{jobId}/apply/` ou `.../apply/section/1`
- Titre page : contient `Apply`
- Signatures DOM :
  - `input[type="email"]` (pré-rempli avec l'email du compte)
  - `input#attachment-upload-50` — file input Resume/CV
  - `input#attachment-upload-7` — file input Cover Letter
  - `input[type="checkbox"]` avec label contenant `I agree with the terms`
- Sections attendues :
  - `Resume / CV`
  - `Cover Letter` (optionnel selon offre)
  - `LinkedIn Profile URL`
  - `Terms and Conditions`

### `section2`
- URL attendue : `.../apply/section/2`
- Titre page : `Job Application Questions`
- Signatures DOM :
  - pill buttons (pas de `input[type="radio"]` — Oracle JET custom)
  - textes de questions présents dans le DOM
- Sections attendues :
  - `EXPERIENCE` — nombre d'années
  - `WORK AUTHORIZATION`
  - `DISCLOSURES` — GS, PwC/Mazars, contingent worker
  - `GOVERNMENT OR REGULATORY ENTITY`
  - `OTHER INFORMATION` — Latest Employer
  - `CONSENT` — diversité (orientation, genre)
  - `RACE/ETHNICITY`

### `section3`
- URL attendue : `.../apply/section/3`
- Titre page : `Experience`
- Signatures DOM :
  - `ADD LANGUAGE` button
  - `input[type="text"]` adjacent au label `Full Name` (e-signature)
  - bouton `SUBMIT`
- Sections attendues :
  - `Language Skills`
  - `E-Signature`

### `success`
- URL attendue : `.../LateralHiring/my-profile`
- Titre page : `My Applications - Candidate Experience Site - Lateral Careers`
- Toast (disparaît ~5 s après SUBMIT) :
  - `div.notifications[role="alert"]` contenant `Thank you for your job application.`
- Confirmation persistante dans le DOM :
  - `main > region > heading "Active Job Applications" > list > listitem`
  - `listitem` contenant un `link[href*="/job/{jobId}"]`
  - `button` ou `generic` contenant le texte `Application Submitted`
  - `generic` contenant le job ID exact (ex. `142214`)
  - `generic` contenant `Applied on {MM/DD/YYYY}`

### `already_applied`
- Même URL `.../my-profile` mais le job est déjà en liste `Active Job Applications`
- ou présence d'un message d'erreur dans le formulaire indiquant une candidature existante

### `unavailable`
- URL ou texte de 404 / offre expirée / `No longer accepting applications`

## Mapping Firebase → formulaire

### Section 1 — Informations personnelles (pré-remplies par Oracle HCM)

Ces champs sont généralement pré-remplis depuis le compte GS existant.
Le script doit **vérifier** et **corriger** si nécessaire.

| Champ Firebase | Sélecteur DOM | Notes |
|---|---|---|
| `email` | `input[type="email"]` | Pré-rempli — vérifier uniquement |
| `firstname` | pré-rempli depuis compte GS | Pas d'input visible en section 1 |
| `lastname` | pré-rempli depuis compte GS | Pas d'input visible en section 1 |
| `phone-number` | pré-rempli depuis compte GS | Pas d'input visible en section 1 |
| `linkedin_url` | `input[placeholder*="LinkedIn"]` ou champ près du label `LinkedIn Profile URL` | Injection JS + event dispatch |

### Section 1 — Documents (upload depuis Firebase Storage)

**Stratégie obligatoire** : l'upload depuis la page (CSP Oracle HCM) bloque `fetch` depuis localhost.
L'injection doit se faire depuis le **content script** (pas soumis au CSP de la page) via `DataTransfer`.

```javascript
// Dans le content script (goldman_sachs_content.js)
async function injectFileFromStorage(inputSelector, storageUrl, filename) {
  const response = await fetch(storageUrl);  // fetch Firebase Storage URL — CORS ok depuis content script
  const blob = await response.blob();
  const file = new File([blob], filename, { type: blob.type });
  const dt = new DataTransfer();
  dt.items.add(file);
  const input = document.querySelector(inputSelector);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
```

| Champ Firebase | Sélecteur DOM | Notes |
|---|---|---|
| `cv_storage_path` → URL Firebase | `input#attachment-upload-50` | File input Resume — injection DataTransfer content script |
| `lm_storage_path` → URL Firebase | `input#attachment-upload-7` | File input Cover Letter — même stratégie |

Si un fichier est déjà uploadé (nom affiché dans le DOM), comparer avec `cv_filename` / `lm_filename` avant de remplacer.

### Section 1 — Consentement

| Champ Firebase | Sélecteur DOM | Notes |
|---|---|---|
| *(toujours cocher)* | `input[type="checkbox"]` avec label `I agree with the terms and conditions` | Cocher si non coché |

### Section 2 — Expérience

Tous les contrôles sont des **pill buttons Oracle JET** (pas de `input[type="radio"]`).
Stratégie : `document.querySelector('[text content = valeur]').click()` — mais le texte est dans un nœud enfant.
Utiliser : `[...document.querySelectorAll('button, .pill, [role="radio"]')].find(el => el.innerText.trim() === valeur)?.click()`

| Champ Firebase | Question DOM | Valeurs possibles |
|---|---|---|
| `experience_level` (à mapper) | `How many years of relevant experience do you have?` | `Less than 1 year` / `1 - 3 years` / `3+ years` |

Mapping `experience_level` Firebase → valeur GS :
- `< 1 an` → `Less than 1 year`
- `1 - 5 ans` → `1 - 3 years`
- `6 - 10 ans` → `3+ years`
- `> 10 ans` → `3+ years`

### Section 2 — Work Authorization

| Champ Firebase | Question DOM | Valeurs possibles |
|---|---|---|
| `sg_eu_work_authorization` ou dérivé | `Do you have work authorisation for the countries you are applying to?` | `Yes` / `No` |
| `work_authorization_type` (liste) | `Please indicate which of the following apply to you` | `National` / `Lawful Permanent Resident` / `EEA/Swiss National applying to work in an EEA location/Switzerland` / `Another Visa or Work / Residence Permit` |
| *(dérivé profil)* | `Do you now or will you in the future require visa sponsorship…?` | `Yes` / `No` |

`work_authorization_type` est une **liste** (multi-sélection possible) — cliquer chaque valeur correspondante.

### Section 2 — Disclosures

| Champ Firebase | Question DOM | Valeurs possibles |
|---|---|---|
| `deloitte_worked` (adapter) | `Have you previously interned or worked at Goldman Sachs?` | `Yes - Full Time Employee` / `Yes - Intern` / `Yes - Contingent Worker` / `No` |
| *(non en Firebase actuellement)* | `Are you a current or former intern/employee of PricewaterhouseCoopers, Mazars, Diamond Management & Technology Consulting, or Strategy&…?` | `No` / `Yes - current/former employee` / `Yes - current/former intern` |
| *(défaut : No)* | `Are you a current contingent worker at Goldman Sachs?` | `Yes` / `No` |

### Section 2 — Government or Regulatory Entity

| Champ Firebase | Question DOM | Valeurs possibles |
|---|---|---|
| *(défaut : No)* | `Do you currently hold, or have you held in the past five years, a position with a government, regulatory, or Intergovernmental Organization (IGO)?` | `No` / `Yes` |

Si `Yes` → section dynamique `ADD GOVERNMENT OR REGULATORY ENTITY EXPERIENCE` s'affiche.

### Section 2 — Other Information

| Champ Firebase | Sélecteur DOM | Notes |
|---|---|---|
| *(dernier employeur)* | `Name of Latest Employer` — OJ combobox | Pré-rempli depuis compte GS — vérifier uniquement. Stratégie : `form_input` sur le combobox ou laisser tel quel. |

### Section 2 — Diversité & Identité (champs Firebase préfixe `gs_`)

| Champ Firebase | Question DOM | Valeurs possibles |
|---|---|---|
| `gs_diversity_consent` | `I hereby consent that Goldman Sachs can use and/or internally disclose my self-identified Sexual Orientation and Gender identity data…` | `I consent` / `I do not consent` |
| `gender` | `Please indicate your gender.` | `Female` / `Male` / `Non-binary` / `Other` / `Prefer not to say` |
| `gs_transgender` | `Please indicate if you identify as Transgender.` | `Yes` / `No` / `I prefer not to say` |
| `gs_sexual_orientation` | `Please indicate your sexual orientation.` | `Bisexual` / `Gay` / `Lesbian` / `Heterosexual/Straight` / `Other` / `Prefer not to say` |
| `pronouns` | `Please indicate your pronouns.` | `He / Him` / `She / Her` / `They / Them` / `Other` / `Prefer Not To Say` |
| `gs_disability` | `Do you consider yourself to have a disability?` | `Yes` / `No` / `Prefer not to say` |

### Section 2 — Race / Ethnicité

| Champ Firebase | Sélecteur DOM | Notes |
|---|---|---|
| `gs_race_ethnicity` | `Please indicate your race / ethnicity` — OJ combobox | Stratégie : `form_input(ref, valeur)` puis clic sur l'option dans le dropdown |
| `gs_race_additional_origins` (liste) | `Additional origin 1/2/3` — OJ comboboxes (apparaissent seulement si `gs_race_ethnicity === "Two or more races"`) | Jusqu'à 3 origines requises |

Valeurs possibles pour `gs_race_ethnicity` :
`Two or more races` / `Arab` / `Asian - Bangladeshi` / `Asian - Chinese` / `Asian - Indian` / `Asian - Japanese` / `Asian - Korean` / `Asian - Other` / `Asian - Pakistani` / `Asian - Vietnamese` / `Black - African` / `Black - Caribbean` / `Black - Other` / `Hispanic or Latino` / `Other` / `Prefer not to say` / `White`

### Section 3 — Language Skills

Oracle HCM pré-remplit les langues depuis le compte GS existant.
Le script doit **vérifier** que toutes les langues Firebase sont présentes et **ajouter** les manquantes.

| Champ Firebase | Sélecteur DOM | Notes |
|---|---|---|
| `languages[i].name` | OJ combobox (type="combobox") dans chaque ligne langue | Stratégie : `form_input(ref, nom_langue)` puis `key: Return` |
| *(niveaux reading/writing/speaking)* | OJ select dans la même ligne | Pré-remplis depuis compte GS — vérifier |
| *(ajouter langue)* | bouton `ADD LANGUAGE` | Cliquer si nombre de langues Firebase > nombre de lignes présentes |

Langues connues à mapper (nom Firebase → nom GS) :
- `Français` / `French` → `French`
- `Anglais` / `English` → `English`
- `Espagnol` / `Spanish` → `Spanish`

### Section 3 — E-Signature

| Champ Firebase | Sélecteur DOM | Notes |
|---|---|---|
| `firstname` + `lastname` | `input[type="text"]` identifié par le label `Full Name` | Valeur : `{firstname} {LASTNAME}` en majuscules pour le nom. Injection JS : `input.value = val; input.dispatchEvent(new Event('input', {bubbles:true})); input.dispatchEvent(new Event('change', {bubbles:true}));` |

## Règle de contrôle avant action

Avant chaque action importante, valider le blueprint attendu :

| Moment | Blueprint attendu |
|---|---|
| Avant clic Apply | `offer` |
| Avant saisie email | `otp_email` |
| Avant remplissage section 1 | `section1` |
| Avant remplissage section 2 | `section2` |
| Avant remplissage section 3 + SUBMIT | `section3` |
| Après SUBMIT | `success` |

Si la page détectée ne correspond pas :
- ne pas remplir
- logger l'état détecté
- stocker dans `chrome.storage.local.taleos_gs_blueprint_last_check`
- remonter une erreur de candidature

## Règle de remplissage (pill buttons Oracle JET)

Goldman Sachs utilise des **pill buttons custom** (pas de `<input type="radio">`).
La valeur sélectionnée est indiquée par une classe CSS différente (background bleu foncé) ou un attribut `aria-pressed`.

Stratégie générique :
```javascript
function clickPill(questionText, value) {
  // Trouver le groupe de pills associé à la question
  const allText = [...document.querySelectorAll('*')];
  const label = allText.find(el =>
    el.children.length === 0 && el.textContent.trim() === questionText
  );
  const group = label?.closest('[class*="question"], section, fieldset, div') 
    || label?.parentElement;
  const pills = group?.querySelectorAll('button, [role="radio"], [class*="pill"]');
  const target = [...(pills||[])].find(p => p.innerText?.trim() === value);
  target?.click();
}
```

## Règle de remplissage (OJ combobox)

Pour les `oj-select-one` et comboboxes Oracle JET :
```javascript
// Via MCP : find(query) → ref → form_input(ref, value) → key: Return
// Via extension content script :
async function fillOJCombobox(selector, value) {
  const input = document.querySelector(selector);
  if (!input) return false;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(300);
  // Cliquer sur la première option du dropdown
  const option = document.querySelector('[role="option"], .oj-listbox-result');
  option?.click();
  return true;
}
```

## Règle de remplissage (champs texte)

Pour les `<input type="text">` et `<input type="email">` :
```javascript
function fillInput(selector, value) {
  const input = document.querySelector(selector);
  if (!input || input.value === value) return false;  // skip si déjà correct
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}
```

## Audit structurel — Page de confirmation

Après SUBMIT, vérifier le succès en deux temps :

```javascript
// ① Toast (fiable ~3 s post-SUBMIT)
function checkToast() {
  const notif = document.querySelector('div.notifications[role="alert"]');
  return notif?.innerText?.includes('Thank you for your job application') ?? false;
}

// ② Liste "My Applications" (fiable après chargement complet)
function checkApplicationInList(jobId) {
  const listItems = document.querySelectorAll('main li');
  for (const li of listItems) {
    const leafNodes = [...li.querySelectorAll('*')].filter(el => el.children.length === 0);
    const hasJobId = leafNodes.some(el => el.textContent.trim() === String(jobId));
    const hasStatus = li.innerText?.includes('Application Submitted');
    if (hasJobId && hasStatus) return true;
  }
  return false;
}

// ③ Stratégie combinée recommandée
async function detectSubmissionSuccess(jobId, timeoutMs = 10000) {
  // Attendre la redirection vers my-profile
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (location.pathname.includes('/my-profile')) break;
    await sleep(500);
  }
  if (!location.pathname.includes('/my-profile')) return false;
  if (!document.title.includes('My Applications')) return false;
  // Vérifier la liste
  return checkApplicationInList(jobId);
}
```

## Audit question par question — Section 2

Le blueprint maintient un registre des questions de candidature section 2.

Pour chaque question, l'audit compare :
- si la question est présente dans le DOM
- la valeur Firebase attendue
- la valeur actuellement sélectionnée (pill active = background distinct)
- si la valeur est déjà conforme → skip ; sinon → cliquer la bonne pill

Fonctions exposées :
- `getSection2AuditReport(profile)`
- `validateSection2(profile)`

## Audit structurel de l'offre

Fonctions exposées :
- `getOfferStructureReport()` — vérifie présence du bouton Apply, titre, URL
- `validateOfferStructure()`

## Audit structurel de la section 1

Fonctions exposées :
- `getSection1StructureReport()` — vérifie file inputs, email, checkbox T&C
- `validateSection1Structure()`

## Audit structurel du succès

Fonctions exposées :
- `getSuccessStructureReport()` — vérifie URL, titre, toast, liste My Applications
- `validateSuccessStructure(jobId)`

## Fichier runtime associé

Le runtime du blueprint sera dans :
- `extension/scripts/goldman_sachs_blueprint.js`

Il exposera :
- `detectPage()` → `'offer' | 'otp_email' | 'section1' | 'section2' | 'section3' | 'success' | 'already_applied' | 'unavailable' | 'unknown'`
- `validateExpectedPage(expected)`
- `getSection1StructureReport()`
- `getSection2AuditReport(profile)`
- `getSection3AuditReport(profile)`
- `getSuccessStructureReport(jobId)`
