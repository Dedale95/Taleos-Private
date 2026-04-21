# Blueprint Deloitte

## Objectif

Le runtime Deloitte sert a :

- reconnaitre les grandes etapes du flux Deloitte public + Workday
- verifier que l'extension est bien sur l'ecran attendu avant interaction
- auditer les champs reels de ce flux par rapport au profil Firebase
- remonter un diagnostic exploitable dans `chrome.storage.local`

## Etats reconnus

- `public_offer`
- `unavailable`
- `apply_choice`
- `login`
- `personal_details`
- `experience`
- `questionnaire`
- `success`

## Ecran public Deloitte

URL de reference inspectee :

- [Offre Deloitte R-1913](https://www.deloitte.com/fr/fr/careers/content/job/results/offer.html?ref=R-1913)

Le blueprint valide notamment :

- domaine `deloitte.com`
- chemin `.../careers/content/job/results/offer.html`
- presence d'un lien Workday ou d'un CTA `Postuler`

## Flux Workday attendu

### 1. Choix / connexion

Le flux peut presenter :

- un ecran `Postuler manuellement`
- un ecran `Connexion`
- un formulaire de creation de compte masquant le formulaire de connexion

Le filler Deloitte continue de privilegier :

- `Connexion`
- puis `Postuler manuellement`

### 2. Mes donnees personnelles

Champs audites :

- `civility`
- `firstname`
- `lastname`
- `address`
- `city`
- `zipcode`
- `phone_country_code`
- `phone_number`
- source attendue `Site Deloitte Careers`
- `deloitte_worked`
- `deloitte_old_office` si `deloitte_worked = yes`
- `deloitte_old_email` si `deloitte_worked = yes`

### 3. Mon experience

Champs audites :

- `establishment`
- `education_level`
- `diploma_year`
- `cv_storage_path`

### 4. Questions de candidature

Champs audites :

- `experience_level`
- `available_date`
- reponse attendue `Ne se prononce pas` pour la question bourse si elle est presente

## Champs du profil non exposes par ce flux

Le blueprint Deloitte les signale explicitement comme `unsupported` quand ils existent dans Firebase :

- `country`
- `job_families`
- `contract_types`
- `continents`
- `target_countries`
- `target_regions`
- `school_type`
- `diploma_status`
- `languages`
- `lm_storage_path`
- `deloitte_country`

Ca permet de distinguer :

- un vrai mismatch DOM / formulaire
- d'un champ profil simplement non demande sur cette offre Deloitte Workday

## Stockage local

- dernier check : `taleos_deloitte_blueprint_last_check`
- journal : `taleos_deloitte_blueprint_log`

## Fichiers relies

- [deloitte_blueprint.js](/Users/thibault/Documents/Projet TALEOS/Antigravity/extension/scripts/deloitte_blueprint.js)
- [deloitte-careers-filler.js](/Users/thibault/Documents/Projet TALEOS/Antigravity/extension/content/deloitte-careers-filler.js)
- [background.js](/Users/thibault/Documents/Projet TALEOS/Antigravity/extension/background.js)
- [popup.js](/Users/thibault/Documents/Projet TALEOS/Antigravity/extension/popup/popup.js)
