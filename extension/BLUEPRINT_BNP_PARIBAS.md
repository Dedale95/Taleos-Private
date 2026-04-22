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
- langues : langue 1/2/3 + niveau 1/2/3, avec sélection robuste via widget auto-complété `select2`
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

Point de robustesse important :

- les champs `Langue 1/2/3` BNP ne sont pas des `select` simples ; ce sont des widgets `select2` auto-complétés
- le filler ouvre le widget, tape la langue attendue, choisit la proposition visible, puis vérifie que le `select` caché BNP a bien reçu la valeur finale
- l'audit blueprint considère désormais les questions de langues comme obligatoires dès lors qu'elles sont effectivement présentes dans le formulaire
