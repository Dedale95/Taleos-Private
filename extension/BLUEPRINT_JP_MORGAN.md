# Blueprint JP Morgan

Flux confirmé en live sur `jpmc.fa.oraclecloud.com` avec candidature réelle.

## Pages

- `offer`
  - URL type : `/job/<jobId>`
  - signal : bouton `Apply Now`
- `email`
  - URL type : `/apply/email`
  - champs : `Email Address`, checkbox `I agree with the terms and conditions`, bouton `Next`
  - point critique : cliquer uniquement la case à gauche, jamais le lien `terms and conditions`
- `pin`
  - URL type : `/apply/email`
  - champs : `#pin-code-1` à `#pin-code-6`
  - CTA : `Verify`, `Send New Code`
  - UX Taleos : bannière spécifique demandant à l’utilisateur de saisir le code reçu par email
- `section_1`
  - URL type : `/apply/section/1`
  - contenu : identité, email, téléphone, adresse
  - point critique : Oracle peut préremplir un ancien profil UK (`+44`, Londres) ; le filler doit corriger agressivement avec Firebase
- `section_2`
  - URL type : `/apply/section/2`
  - questions :
    - `Are you at least 18 years of age?` -> `Yes`
    - `Are you legally authorized to work in this country?` -> `Yes`
    - `Will you now or in the future require sponsorship...` -> `No`
- `section_3`
  - URL type : `/apply/section/3`
  - contenu : éducation / expérience Oracle existantes
  - logique Taleos : audit visuel puis `Skip` tant qu’il n’existe pas de référentiel Firebase détaillé
- `section_4`
  - URL type : `/apply/section/4`
  - contenu :
    - `Resume or Additional Documents`
    - `Upload Cover Letter`
    - `Link 1`
    - `Gender`
    - question militaire
    - `E-Signature`
  - logique Taleos :
    - supprimer CV existant puis recharger le CV Firebase
    - ajouter/remplacer la lettre de motivation Firebase
    - comparer LinkedIn / Gender / Military / signature puis `Skip` ou `Correction`
- `success`
  - signal métier principal : `Thank you for your job application.`
- `my_profile_success`
  - fallback robuste : `My Applications` + statut `Under Consideration`

## Données Firebase utilisées

- identité : `civility`, `firstname`, `lastname`, `email`
- téléphone :
  - `phone_country_code`
  - `phone-number`
  - pour `+33`, le champ Oracle attend le numéro national sans le `0` initial
- adresse : `address`, `zipcode`, `city`, `country`
- LinkedIn : `linkedin_url`
- documents :
  - `cv_storage_path`, `cv_filename`
  - `lm_storage_path`, `lm_filename`
- JP Morgan :
  - `jp_morgan_military_service`
  - `jp_morgan_work_authorizations[]`
    - `country`
    - `work_authorized` (`Yes` / `No`)
    - `sponsorship_required` (`Yes` / `No`)

## Confirmation métier capturée

- toast / message :
  - `Thank you for your job application.`
- fallback post-redirection :
  - page `My Applications`
  - statut `Under Consideration`

## Logs attendus

Style Crédit Agricole :

- `🧾 JP Morgan → audit détaillé Firebase vs formulaire`
- `✅ <champ> : formulaire='...' | Firebase='...' -> Skip`
- `✏️ <champ> : formulaire='...' | Firebase='...' -> Correction`
- `🗑️ CV : ancienne pièce supprimée`
- `✅ CV : <filename> (Firebase)`
- `✅ Lettre de motivation : <filename> (Firebase)`
- `🔐 JP Morgan → code email : 0/6 chiffre(s) saisi(s)`
- `🚀 JP Morgan : clic final sur Submit`

## Règle de réponse aux questions pays / visa

- Taleos lit le pays de l’offre depuis la localisation remontée par l’offre (`Paris - France` -> `France`)
- il cherche ensuite dans le profil JP Morgan une ligne pays correspondante
- s’il trouve une ligne, il répond avec :
  - `Are you legally authorized to work in this country?` -> `work_authorized`
  - `Will you now or in the future require sponsorship...?` -> `sponsorship_required`
- fallback actuel :
  - ligne `France` si présente
  - sinon première ligne configurée
  - sinon `Yes / No`
