# Blueprint BNP Paribas

Flux pris en charge :

- `public_offer` : page publique `group.bnpparibas/emploi-carriere/offre-emploi/...`
- `job_details` : page `bwelcome.hr.bnpparibas/.../JobDetails`
- `application_methods` : page `.../ApplicationMethods` avec connexion candidat
- `application_form` : page `.../ApplicationConfirmation` avec formulaire
- `review_submit` : page de revue finale `.../ApplicationConfirmation`
- `success` : page `.../Success`
- `unavailable` : offre introuvable / indisponible

Champs mappés depuis Firebase :

- identité : prénom, nom, civilité -> genre, email, téléphone
- préférences : langue préférée, partage des données BNP
- documents : CV, autre fichier pertinent / lettre
- formation : diplôme, école, statut d'études, date du diplôme
- expérience : niveau d'expérience
- source : origine de candidature BNP website, source candidat
- conformité : acceptation des conditions générales

Question BNP spécifique :

- `JE SUIS D'ACCORD POUR PARTAGER MES DONNÉES *`
  - `International au sein du groupe BNP Paribas`
  - `National`
  - `Uniquement pour le poste auquel je postule`

Le profil Taleos utilise désormais `group_data_sharing_scope` pour piloter cette réponse.
