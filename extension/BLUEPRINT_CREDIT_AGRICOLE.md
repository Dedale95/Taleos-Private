# Blueprint Crédit Agricole

## Objectif

Formaliser le parcours d'automatisation Crédit Agricole pour :
- reconnaître l'état réel de la page avant toute action
- décider si l'étape attendue correspond au blueprint
- remplir uniquement quand la page détectée est conforme
- comparer les valeurs Firebase avec les champs déjà pré-remplis

## Flux cible

1. `taleos-injector.js` intercepte le clic depuis Taleos.
2. `background.js` récupère le profil + les identifiants depuis Firebase.
3. `background.js` ouvre un onglet CA sur `/fr/connexion/`.
4. `ca-connexion-filler.js` vérifie que la page correspond au blueprint `login`.
5. Le script remplit les identifiants CA puis redirige vers l'offre.
6. `credit_agricole.js` vérifie que la page correspond au blueprint `offer`.
7. Le script clique sur `Je postule`.
8. Si le formulaire est sur page séparée, la phase 3 vérifie le blueprint `application`.
9. Le script compare les valeurs visibles avec Firebase, remplit ce qui manque ou corrige ce qui diffère.
10. Le script coche RGPD, soumet, puis vérifie le blueprint `success`.

## Etats de page

### `login`
- URL attendue : contient `connexion`, `login` ou `connection`
- Signatures DOM :
  - `#form-login-email` ou `input[id*="login-email"]` ou `input[type="email"]`
  - `input[type="password"]`
- Signatures texte observées sur le site :
  - `Heureux de vous voir !`
  - `Connectez-vous ou créez votre compte`
  - `Adresse e-mail`
  - `Mot de passe oublié`

### `offer`
- URL attendue :
  - `/nos-offres-emploi/`
  - `/our-offers/`
  - `/our-offres/`
- Signatures DOM :
  - bouton `Je postule`
  - ou `button[data-popin="popin-application"]`
  - ou popin d'application visible
- Signatures texte observées sur le site :
  - `Comment souhaitez-vous postuler ?`
  - `Candidature express`
  - `Candidature détaillée`
  - `Postuler en tant qu'invité`
  - `Connexion`

### `application`
- URL attendue :
  - `/candidature/`
  - `/application/`
  - `/apply/`
- Signatures DOM :
  - `#form-apply-firstname`
  - `#form-apply-lastname`
  - `#applyBtn`
  - `form[id*="apply"]`
- Sections attendues :
  - `Mes informations`
  - `Mes documents`
  - `Mon profil`
  - `Mes formations`

### `success`
- URL attendue : `candidature-validee`
- ou texte de confirmation :
  - `Votre candidature a été envoyée avec succès`
  - `application sent successfully`

### `unavailable`
- URL ou texte de 404 / offre expirée

### `admin_ajax`
- URL contenant `admin-ajax`

## Mapping Firebase -> formulaire

### Section Mes informations
- `firstname` -> `#form-apply-firstname`
- `lastname` -> `#form-apply-lastname`
- `address` -> `#form-apply-address`
- `zipcode` -> `#form-apply-zipcode`
- `city` -> `#form-apply-city`
- `phone-number` -> `#form-apply-phone-number`
- `civility` -> `div[aria-controls="customSelect-civility"]`
- `country` -> `div[aria-controls="customSelect-country"]`

### Section Mes documents
- `cv_storage_path` -> `#form-apply-cv`
- `lm_storage_path` -> `#form-apply-lm`

### Section Mon profil
- `job_families` -> `#form-apply-input-families`
- `contract_types[0]` -> `div[aria-controls="customSelect-contract"]`
- `available_date` -> `#form-apply-available-date`
- `continents` -> `#form-apply-input-continents`
- `target_countries` -> `#form-apply-input-countries`
- `target_regions` -> `#form-apply-input-regions`
- `experience_level` -> `div[aria-controls="customSelect-experience-level"]`

### Section Mes formations
- `education_level` -> `div[aria-controls="customSelect-education-level"]`
- `school_type` -> `div[aria-controls="customSelect-school"]`
- `diploma_status` -> `div[aria-controls="customSelect-diploma-status"]`
- `diploma_year` -> `#form-apply-diploma-date-obtained`

## Règle de contrôle avant action

Avant chaque action importante, on valide le blueprint attendu :
- avant login : page `login`
- avant clic `Je postule` : page `offer`
- avant remplissage : page `application`
- après soumission : page `success` ou texte de succès

Si la page détectée ne correspond pas :
- ne pas remplir
- logger l'état détecté
- stocker le dernier check dans `chrome.storage.local.taleos_ca_blueprint_last_check`
- remonter une erreur de candidature si on est bloqué

## Audit structurel du formulaire

Avant remplissage, le blueprint peut aussi auditer la structure du formulaire :
- présence des champs critiques : `#form-apply-firstname`, `#form-apply-lastname`, `#applyBtn`
- couverture par section :
  - `personal`
  - `documents`
  - `profile`
  - `education`

Fonctions exposées :
- `getApplicationStructureReport()`
- `validateApplicationStructure()`

## Règle de remplissage

- si le champ est vide : remplir depuis Firebase
- si le champ est déjà égal à Firebase : skip
- si le champ diffère de Firebase : corriger
- si le composant est un select custom / multiselect : comparer la valeur visible au profil Firebase avant clic

## Fichier runtime associé

Le runtime partagé du blueprint est dans :
- [credit_agricole_blueprint.js](/Users/thibault/Documents/Projet TALEOS/Antigravity/extension/scripts/credit_agricole_blueprint.js)

Il expose :
- `detectPage()`
- `validateExpectedPage(expected)`
