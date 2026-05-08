# Blueprint AXA

## Portail ciblé
- Domaine vitrine : `https://careers.axa.com/careers-home/jobs/<jobId>?lang=fr-fr`
- Domaine candidature : `https://careers-fr-axa.icims.com/jobs/<jobId>/login`

## Intention Taleos
- Depuis Taleos, ne pas laisser l’utilisateur sur la page vitrine AXA.
- Ouvrir directement l’URL iCIMS de candidature.
- Automatiser :
  - la redirection vers la vraie vue iframe iCIMS
  - l’étape email
  - le choix de consentement RGPD / communauté AXA
  - la validation de la case RGPD
  - l’étape mot de passe
- Stopper avant la soumission finale du formulaire candidat tant que le mapping complet n’est pas validé.

## Mapping profil Taleos utilisé
- `auth_email`
- `auth_password`
- `email`
- `firstname`
- `lastname`
- `phone_number`
- `phone-number`
- `axa_talent_pool`

## Pages / étapes reconnues

### 1. Page offre publique AXA
- Pattern : `careers.axa.com/careers-home/jobs/<jobId>`
- Action : redirection vers `https://careers-fr-axa.icims.com/jobs/<jobId>/login`

### 2. Wrapper iCIMS login
- Pattern : `careers-fr-axa.icims.com/jobs/<jobId>/login`
- Sélecteur clé : `#icims_content_iframe[src]`
- Action : ouverture directe de `iframe.src`

### 3. Étape email / consentement
- Sélecteurs confirmés :
  - formulaire : `#enterEmailForm`
  - email : `input#email[name="css_loginName"]`
  - consentement : `select[name="gdpr_consent_type"]`
  - case RGPD : `input#accept_gdpr[name="accept_gdpr"]`
  - submit : `#enterEmailSubmitButton`

#### Valeurs de consentement observées
- `37002057001`
  - accepte la candidature ET les opportunités futures / communauté AXA
- `37002057002`
  - accepte uniquement la candidature au poste courant

#### Règle Taleos
- si `axa_talent_pool = Oui` :
  - choisir `37002057001`
- sinon :
  - choisir `37002057002`

### 4. Étape mot de passe
- Sélecteur robuste actuel :
  - `input[type="password"]`
- Le bouton de validation varie selon la page :
  - `Se connecter`
  - `Connexion`
  - `Continue`
  - `Sign in`

### 5. Formulaire candidat
- Détection actuelle par présence d’au moins un des champs :
  - `firstName`
  - `lastName`
  - questions `Q383` / `Q389`
  - champs de salaire
- Comportement actuel :
  - audit minimal `Firebase vs formulaire`
  - pas de soumission automatique finale

### 6. Succès candidature
- Message métier capturé :
  - `Votre candidature a bien été transmise. Merci d'avoir postulé.`

## Logs attendus
- format type Crédit Agricole :
  - valeur du formulaire
  - valeur Firebase
  - `Skip` si identique
  - `Correction` sinon

Exemples :
- `✅ Email : formulaire='thibault.giraudet@outlook.com' | Firebase='thibault.giraudet@outlook.com' -> Skip`
- `✏️ Consentement AXA : formulaire='Effectuer une sélection' | Firebase='Communauté AXA = Oui' -> Correction`

## Limites connues à finaliser
- mapping complet du formulaire candidat AXA
- upload/remplacement CV et lettre de motivation
- arrêt sur écran de relecture éventuel si certaines offres AXA divergent
- persistance plus fine du `jobId` dans le signal de succès côté background
