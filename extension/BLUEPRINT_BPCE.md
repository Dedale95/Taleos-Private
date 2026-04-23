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

## Conclusion actuelle par entité

Après inspection DOM/API sur des offres live, le bon découpage n'est pas `1 entité = 1 blueprint` mais :

- `oracle_natixis_family` partagé :
  - `Natixis`
  - `AEW`
  - `Mirova`
  - `Ostrum`
- `lumesse_shared` partagé :
  - `BPCE SA`
  - `BPCE Assurances IARD`
  - `BPCE Lease`
  - `Caisse d'Épargne`
  - `Banque Populaire`
  - `Crédit Coopératif`
  - `Oney`
  - `Banque Palatine`
  - `Crédit Foncier`
  - `Casden`

Donc, à ce stade :

- pas besoin d'un blueprint Oracle séparé pour `AEW`, `Mirova` ou `Ostrum`
- pas besoin d'un blueprint Lumesse séparé pour chaque banque régionale
- en revanche il faut distinguer des sous-types de questionnaire `Lumesse`

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

## Oracle partagé : Natixis / AEW / Mirova / Ostrum

Inspection live confirmée sur :

- `Natixis`
- `AEW`
- `Mirova`
- `Ostrum`

Constat :

- même domaine Oracle `ekez.fa.em2.oraclecloud.com`
- même écran email
- même wording `Bonjour, bienvenue sur notre site Carrières Natixis`
- même consentement email / PIN

Conclusion :

- ces entités réutilisent aujourd'hui un même socle Oracle `Natixis-family`
- le blueprint expose donc désormais `oracleFamily = oracle_natixis_family`
- les futures différences devront être cherchées plutôt dans les questions du formulaire Oracle que dans la page email/PIN

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
- force explicitement les sélections `select[name="dps"]` pour la `Gestion des données personnelles`
- tente ensuite la soumission automatique et attend la confirmation pour notifier Taleos

## Lumesse partagé : entités comparées

Inspection DOM live confirmée sur :

- `BPCE SA`
- `BPCE Assurances IARD`
- `Caisse d'Épargne`
- `Banque Populaire`
- `Crédit Coopératif`
- `Oney`
- `Banque Palatine`
- `Crédit Foncier`
- `Casden`

Constat :

- même moteur `emea3.recruitmentplatform.com`
- même bloc coeur :
  - `Informations Personnelles`
  - `CV`
  - `Préférences de communication`
  - `Gestion des données personnelles`
- mêmes champs structurants :
  - `Comment souhaitez-vous postuler ?`
  - `Civilité`
  - `Nom`
  - `Prénom`
  - `Adresse e-mail`
  - `Téléphone`
  - `Code Pays`
  - `LinkedIn`
  - `dps`

Les différences observées sont surtout des micro-variantes de questionnaire :

- `lumesse_core`
  - seulement les champs coeur + CV
- `lumesse_core_plus_questionnaire`
  - ajoute par exemple :
    - `Avez-vous l’autorisation de travailler en France ?`
    - `Source candidature`
    - parfois `handicap`
    - parfois `motivation`
- `lumesse_extended_education`
  - ajoute des questions de type alternance / campus :
    - `établissement d’enseignement`
    - `niveau à l’issue de votre alternance`
    - `durée du contrat`
    - `rythme d’alternance`
    - bloc `Langue / niveaux de compétence`

Important :

- cette variante riche n'est pas strictement liée à une entité
- elle semble surtout dépendre du type d'offre / du questionnaire métier
- donc on garde un blueprint Lumesse partagé avec détection de sous-type, au lieu d'un blueprint par marque

## Robustesse page offre BPCE

Certaines pages `recrutement.bpce.fr/job/...` chargent d'abord un shell React vide avant l'hydratation, ce qui peut masquer temporairement :

- le titre de l'offre
- le bouton `Postuler`
- les liens Oracle / Lumesse

Pour éviter les faux `offer_structure: ok=false`, le helper `bpce-careers-filler.js` sait maintenant faire un fallback via l'API BPCE :

- `GET /app/wp-json/bpce/v1/routes/?lang=fr`
- puis `GET /app/wp-json/bpce/v1/posts/?lang=fr&_uid=...`

Ce fallback permet de récupérer :

- le vrai titre de l'offre
- la marque (`BPCE Lease`, etc.)
- le vrai lien de candidature `postulate.link.url`

Donc une page shell BPCE encore non hydratée n'est plus rejetée si l'API confirme l'offre et son lien de candidature.

Le runtime `bpce_blueprint.js` remonte maintenant aussi :

- `oracleFamily`
- `lumesseSubtype`

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
