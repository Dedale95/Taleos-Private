# Blueprint Societe Generale

## Objectif

Formaliser le parcours Societe Generale en separant clairement :
- la page d'offre publique `careers.societegenerale.com`
- la redirection vers Taleo `socgen.taleo.net`
- les etapes internes du flux Taleo

Le point critique du blueprint SG est d'eviter les faux positifs sur les nombreux boutons et ancres de la page publique.

## Flux cible

1. Taleos ouvre l'offre publique SG.
2. Le helper public valide qu'on est bien sur une vraie page d'offre.
3. Le helper clique uniquement sur le lien `Postuler` qui correspond a `#taleo_url`.
4. Taleo redirige vers `jobapply.ftl`, puis vers `login.jsf` si besoin.
5. Le script SG pilote ensuite les etapes Taleo :
   - `login`
   - `disclaimer`
   - `screening`
   - `personal_information`
   - `attachments`
   - `review_submit`
   - `success`

## Etats de page

### `public_offer`
- hote attendu : `careers.societegenerale.com`
- URL attendue : `/offres-d-emploi/`
- signatures critiques :
  - `#taleo_url[data-value]`
  - `a.btnApply[href*="jobapply.ftl"]`
- regle stricte :
  - le bouton `Postuler` utilise doit pointer exactement vers l'URL de `#taleo_url`

### `taleo_redirect`
- hote attendu : `socgen.taleo.net`
- URL attendue : `jobapply.ftl`
- signatures observees :
  - page `htmlredirection`
  - script `redirectRequest()`
  - presence de `redirectionURI` et `TARGET`

### `login`
- hote attendu : `socgen.taleo.net`
- signatures critiques :
  - `#dialogTemplate-dialogForm-login-name1`
  - `#dialogTemplate-dialogForm-login-password`
  - bouton `#dialogTemplate-dialogForm-login-defaultCmd`

### `disclaimer`
- URL attendue : `flow.jsf`
- textes clefs :
  - `accord de confidentialite`
  - `confidentiality agreement`
  - `J'ai lu`
  - `I have read`

### `screening`
- URL attendue : `flow.jsf`
- textes clefs :
  - `Please answer the following questions`
  - `Are you authorized to work in the European Union`
  - `What is your notice period`
  - `What would be your start date`

### `personal_information`
- URL attendue : `flow.jsf`
- signatures critiques :
  - `input[id*="personal_info_FirstName"]`
  - `input[id*="LastName"]`
- textes clefs :
  - `Informations personnelles`
  - `Personal information`

### `attachments`
- URL attendue : `flow.jsf`
- signatures critiques :
  - `table.attachment-list`
  - `input[type="file"][id*="uploadedFile"]`
  - `input[id*="skipResumeUploadRadio"]`

### `review_submit`
- URL attendue : `flow.jsf`
- textes clefs :
  - `Verifier et postuler`
  - `Review and submit`
- signatures critiques :
  - `input[id*="submitCmdBottom"]`
  - ou bouton `Postuler`

### `success`
- textes clefs :
  - `C'est dans la boite`
  - `Votre candidature a bien ete`
  - `Your application has been submitted`
  - `We have received your application`

### `unavailable`
- textes clefs :
  - `Page not found`
  - `Error 404`
  - `Job position is no longer online`

## Questions mappees

Le blueprint SG audite maintenant uniquement les questions pertinentes pour l'etape active afin d'eviter les faux `missing` quand on est deja passe a l'etape suivante.

### Disclaimer
- case d'acceptation / lecture de l'accord de confidentialite
- bouton de continuation du disclaimer

### Screening
- `sg_eu_work_authorization` -> question autorisation UE
- `sg_notice_period` -> question preavis
- `available_date` -> question date de debut
- bouton `Continuer` apres les questions

### Informations personnelles
- `civility`
- `firstname`
- `lastname`
- `email`
- `phone-number`
- bouton `Sauvegarder et continuer`

### Pieces jointes
- `cv_storage_path` -> upload du CV
- case `CV plus tard`
- case de selection du `Resume`
- bouton `Sauvegarder et continuer`

### Validation finale
- bouton `Postuler` sur la page recap

## Règles anti-boucle

Le blueprint SG doit eviter :
- de cliquer sur un bouton public qui n'est pas le vrai `btnApply`
- de confondre la page `review_submit` avec `personal_information`
- de relancer le remplissage du profil sur le recap final
- de traiter les menus / ancres du haut de page comme des etapes de candidature
- de compter comme "manquantes" des questions d'une autre etape Taleo

## Diagnostic popup

La popup de l'extension expose maintenant un panneau `Blueprint Societe Generale` qui lit :
- `taleos_sg_blueprint_last_check`
- `taleos_sg_blueprint_log`

Le resume affiche l'etape detectee, les sections actives, le nombre de questions encore a traiter et les manques critiques.

## Runtime associe

- [societe_generale_blueprint.js](/Users/thibault/Documents/Projet TALEOS/Antigravity/extension/scripts/societe_generale_blueprint.js)
