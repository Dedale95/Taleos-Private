# Blueprint BPCE

Ce blueprint couvre les variantes BPCE actuellement reconnues par l'extension :

- `offer` : page offre publique `recrutement.bpce.fr/job/...`
- `oracle_email` : page Oracle `.../apply/email` avec email + consentement
- `oracle_pin` : écran Oracle de vérification par code PIN
- `oracle_invalid_pin` : écran PIN Oracle avec message de code invalide / expiré
- `oracle_throttle` : limitation temporaire Oracle après trop de tentatives
- `oracle_form` : formulaire Oracle complet de candidature
- `lumesse_form` : formulaire Lumesse / TalentLink
- `success` : confirmation finale
- `unavailable` : offre indisponible

## Variante Natixis inspectée

Offre réelle inspectée :

- `https://recrutement.bpce.fr/job/technology-risk-management`
- `https://recrutement.bpce.fr/job/liquidity-steering-analyst-alm`

Signatures relevées :

- `h1` avec le titre de l'offre
- code offre visible dans la page : `WORKDAY_JR01140`
- CTA public : `.c-offer-sticky-button`
- lien candidature Oracle :
  - `https://ekez.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/fr/sites/CX/job/WORKDAY_JR01140/apply/email?...`

## Contrôles structurels

Le runtime `bpce_blueprint.js` vérifie désormais :

- que la page publique contient bien un titre + un code `WORKDAY_*` + au moins un vrai lien de candidature
- que la page Oracle email expose :
  - `#primary-email-0`
  - `.apply-flow-input-checkbox__button`
  - `button[title="Suivant"]`
- que la page PIN expose des champs `#pin-code-*`
- que la page PIN valide désormais la présence des `6` champs `#pin-code-1` à `#pin-code-6`
- que le message Oracle `Le code n'est pas valide. Entrez un code valide.` soit reconnu comme un état distinct `oracle_invalid_pin`
- que la page de blocage Oracle (`Trop de tentatives. Réessayez plus tard.`) soit reconnue explicitement
- que la page formulaire Oracle expose au moins :
  - `input[id*="lastName"]`
  - `input[id*="firstName"]`
  - `input[id*="siteLink"]`
  - et des sélecteurs utiles au remplissage
- que la variante Lumesse expose les champs de base `form_of_address`, `last_name`, `first_name`, `e-mail_address`

## Cartographie Natixis Oracle confirmée

Sur `Liquidity steering & analyst (ALM)`, le flux réel Oracle confirmé est :

- `oracle_email`
- `oracle_pin`
- `oracle_form`

La première page formulaire réelle observée est `étape 1 sur 3` avec les blocs :

- `Informations de contact`
- `Questions de candidature`
- `Documents annexes et URL (LINKEDIN...)`
- `Documents divers`

Questions / zones confirmées sur cette étape :

- `Nom`
- `Prénom`
- `Titre`
- `Adresse électronique`
- `Numéro de téléphone`
- `Code pays`
- `Travailleur en situation de handicap`
- `Disponibilité`
- `J'accepte que Natixis conserve mon profil dans le vivier Candidats`
- `CV`
- `Lettre de motivation`
- `URL de votre profil LinkedIn`
- `Ajouter un autre lien`
- `Documents divers`
- consentement `J'accepte de recevoir ...`

Le blueprint embarque maintenant un audit `questionAudit` pour cette étape Oracle Natixis et le content script logge aussi `Questions oracle formulaire` dans le stockage local.

## Variante BPCE Lease / Lumesse inspectée

Offre réelle inspectée :

- `https://recrutement.bpce.fr/job/analyste-risque-de-credit-f-h`

Vérité source confirmée via l'API BPCE :

- entreprise : `BPCE Lease`
- lien de candidature :
  - `https://emea3.recruitmentplatform.com/apply-app/pages/application-form?jobId=Q7SFK026203F3VBQB7V8N8MO5-5366826&langCode=fr_FR`

Cette variante n'est donc pas Oracle/Natixis mais `Lumesse / TalentLink`.

Structure formulaire réellement observée :

- `Informations Personnelles`
- `CV`
- `Motivation`
- `Questionnaire`
- `Préférences de communication`
- `Gestion des données personnelles`

Questions / zones confirmées :

- `Comment souhaitez-vous postuler ?`
- `Civilité`
- `Nom`
- `Prénom`
- `Adresse e-mail`
- `Téléphone`
- `Code Pays`
- `LinkedIn`
- `Avez-vous l’autorisation de travailler en France ?`
- `Veuillez télécharger votre CV`
- `Quelques mots sur vos motivations`
- `Sur quel site avez-vous consulté la 1ère fois l'annonce ?`
- préférence de communication email
- accords `dps`

Le blueprint :

- reconnaît désormais explicitement la branche `bpce_lumesse`
- n'exige plus un code `WORKDAY_*` pour considérer une offre BPCE Lumesse comme conforme
- embarque un audit `questionAudit` pour le formulaire Lumesse
- logge `Questions lumesse formulaire` dans le stockage local

## Logs stockage local

- dernier check : `taleos_bpce_blueprint_last_check`
- journal : `taleos_bpce_blueprint_log`

## Intégration

Le blueprint est branché dans :

- `extension/content/bpce-careers-filler.js`
- `extension/content/bpce-oracle-filler.js`
- `extension/content/bpce-lumesse-filler.js`
- `extension/background.js`

Objectif : éviter les faux départs, mieux distinguer Natixis/BPCE public vs Oracle vs Lumesse, et préparer l'audit question par question du flux BPCE.
