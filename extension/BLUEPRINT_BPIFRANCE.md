# Blueprint Bpifrance

Date d'inspection live : `2026-04-29`
Offre test : `https://talents.bpifrance.fr/opportunites/charge-d-investissement-senior-fonds-patient-autonome-f-h/?id=7464-51`

## Flux confirmé

1. Offre publique `talents.bpifrance.fr/opportunites/...`
2. Bouton / lien `Postuler`
3. Portail candidat `https://bpi.tzportal.io/fr/apply?job=7464-51&source=site-talents`
4. Si compte existant non connecté : page login `https://bpi.tzportal.io//fr/login?...`
5. Wizard candidature :
   - `1. Upload CV`
   - `2. Informations personnelles`
   - `3. Confirmation`

## Sélecteurs utiles

### Offre publique

- lien candidature : `a[href*="bpi.tzportal.io/fr/apply?job="]`
- bandeau cookies : texte `Nous nous soucions de votre vie privée`
- bouton de rejet cookies : texte `Tout refuser`

### Login

Le formulaire est injecté dynamiquement après :

- `POST /fr/m/agents/ajax/login`

Sélecteurs confirmés après chargement :

- email : `#email`
- mot de passe : `#password`
- bouton login : lien visible `LOGIN`

Comportement observé :

- `thibault.giraudet@oulook.com` + `PI3twQSh` : échec
- `thibault.giraudet@outlook.com` + `PI3twQSh` : redirection réussie vers l'offre

## Wizard de candidature

### Upload CV

- input file : `#massivefileupload`
- nom de fichier visible après upload : ex. `resume-thibault-giraudet.pdf`

Upload réseau observé :

- initialisation : `POST /fr/m/agents/ajax/apply`
- upload jQuery File Upload : `POST /assets/libs/jupload/`

### Champs du formulaire

- civilité : `#civility`
  - options observées :
    - vide : `...`
    - `m.` => `M.`
    - `mme` => `Mme`
- prénom : `#firstName`
- nom : `#lastName`
- email : `#email`
- téléphone : `#phone`
- motivation : `#message`
- consentement obligatoire : `#consentement`
- consentement vivier optionnel : `#optionnalConsentement`

Payload final observé vers `POST /fr/a/apply` :

```txt
table=agents
url_redirect=
formid=form_apply_agents
formMode=ajax
modulename=agents
index=<dynamique>
jobID=7464-51
civility=m.
firstName=Thibault
lastName=Giraudet
email=thibault.giraudet@outlook.com
phone=0758953565
message=
consentement=on
```

## Réponses serveur réelles

### Compte existant non connecté

Réponse JSON observée :

```json
{
  "formErrors": {
    "email": "Vous possédez déjà un compte chez nous. Connectez-vous ici ..."
  }
}
```

Conséquence :

- l'automatisation doit rediriger vers l'URL de login fournie dans la réponse

### Déjà candidaté

Réponse JSON observée :

```json
{
  "formErrors": {
    "mainAlert": "vous avez déjà candidaté à cette offre"
  }
}
```

Important :

- l'étape `3. Confirmation` peut devenir visible même en cas d'échec métier
- il ne faut donc **pas** considérer `#step3` comme un succès suffisant
- il faut prioriser l'analyse de la réponse Ajax `POST /fr/a/apply`

### Succès visuel

Texte confirmé dans `#step3` :

- `Votre candidature a bien été prise en compte`

Mais ce texte seul n'est pas discriminant tant qu'on n'a pas vérifié l'absence de `formErrors` dans la réponse Ajax.

## Logs Taleos attendus

Le filler Bpifrance doit logguer en mode Crédit Agricole :

- valeur Firebase
- valeur actuelle du formulaire
- décision `Skip` ou `Correction`

Champs pilotés :

- `Civilité`
- `Prénom`
- `Nom`
- `Email`
- `Téléphone`
- `Consentement obligatoire`

Champs non pilotés actuellement :

- `Motivation`
- `Consentement vivier`

## Fichiers extension concernés

- `extension/scripts/bpifrance_blueprint.js`
- `extension/content/bpifrance-careers-filler.js`
- `extension/background.js`
- `extension/content/taleos-injector.js`
- `HTML/connexions.html`
- `extension/scripts/connection-test-runner.js`
- `extension/manifest.json`
