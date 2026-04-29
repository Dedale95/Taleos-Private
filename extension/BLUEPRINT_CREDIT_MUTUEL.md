# Blueprint Crédit Mutuel

## Flux confirmé en live

0. `cookie_alert`
   - Overlay navigateur/consentement visible sous forme d'`alertdialog`
   - Texte: `Ce site utilise des cookies`
   - Boutons observés:
     - `Accepter les cookies`
     - `Refuser les cookies`
   - Point important:
     - tant que ce bandeau est présent, il peut bloquer l'interaction avec la checkbox RGPD

1. `public_offer`
   - URL type: `/fr/offre.html?annonce=...`
   - CTA principal: `#RHEC:C7:link`
   - Texte: `Postuler avec mon CV`

2. `rgpd`
   - URL type: `/fr/candidature_annonce.html`
   - Checkbox: `#C:pagePrincipale.cb1:DataEntry`
   - Hidden companion: `#C:pagePrincipale.cb1:DataEntry:cbhf`
   - Bouton: `#C:pagePrincipale.C:link`
   - Comportement confirmé en live:
     - après fermeture du bandeau cookies, la checkbox RGPD met bien le hidden companion à `true`
     - le clic `Valider` mène à `/fr/candidature_annonce.html?_tabi=C&_pid=Candidature`

3. `upload_cv`
   - URL réelle confirmée: `/fr/candidature_annonce.html?_tabi=C&_pid=Candidature`
   - Input fichier: `#C:pagePrincipale.PostulerAvecMonCv2:DataEntry`
   - Submit fallback: `input[name="_FID_DoUploadCv"]`
   - Bouton visible observé:
     - `Joignez votre CV`
     - libellé complet accessible: `Joignez votre CV Parcourir et ajouter une pièce jointe...`

4. `application_form`
   - Identité:
     - civilité `#C:pagePrincipale.M:DataEntry`
     - nom `#C:pagePrincipale.i-74-1`
     - prénom `#C:pagePrincipale.i-74-2`
     - email `#C:pagePrincipale.i135`
     - confirmation email `#C:pagePrincipale.i136`
     - téléphone `#C:pagePrincipale.i117`
   - Diplôme:
     - `#C:pagePrincipale.ddl1:DataEntry`
   - Langues:
     - conteneurs `#C:pagePrincipale.LesLangues.F1_X.G4:root:root`
     - ajout ligne `#C:pagePrincipale.C2:link`
     - suppression ligne `#C:pagePrincipale.LesLangues.F1_X.C1:link`
   - Origine candidature:
     - `#C:pagePrincipale.originePanel.ddl2:DataEntry`
   - Certification finale:
     - checkbox visible `#C:pagePrincipale.cb2:DataEntry`
     - hidden companion `#C:pagePrincipale.cb2:DataEntry:cbhf`
   - Validation:
     - `#C:pagePrincipale.C4:link`
   - Reset session complète:
     - `#C:pagePrincipale.C5:link`

5. `success`
   - URL réelle confirmée: `/fr/message.html?message=0`
   - Texte clé:
     - `Accusé de réception`
     - `Votre candidature à l'offre ... a été transmise ce jour`

## Spécificités importantes

- Le flux ne passe pas par un compte utilisateur email / mot de passe.
- Le CV charge un pré-remplissage serveur.
- Le bandeau cookies doit être fermé avant la RGPD, sinon la progression peut sembler bloquée alors que les contrôles sont masqués/interceptés.
- La certification finale doit synchroniser:
  - le checkbox visible
  - et le hidden booléen `Bool:Data_Certification=true`
- Le bouton `Réinitialiser` permet de nettoyer une session contenant déjà un CV / des pièces jointes avant un nouvel upload Firebase.
