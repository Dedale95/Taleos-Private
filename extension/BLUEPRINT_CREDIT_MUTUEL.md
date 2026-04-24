# Blueprint Crédit Mutuel

## Flux confirmé en live

1. `public_offer`
   - URL type: `/fr/offre.html?annonce=...`
   - CTA principal: `#RHEC:C7:link`
   - Texte: `Postuler avec mon CV`

2. `rgpd`
   - URL type: `/fr/candidature_annonce.html`
   - Checkbox: `#C:pagePrincipale.cb1:DataEntry`
   - Hidden companion: `#C:pagePrincipale.cb1:DataEntry:cbhf`
   - Bouton: `#C:pagePrincipale.C:link`

3. `upload_cv`
   - Input fichier: `#C:pagePrincipale.PostulerAvecMonCv2:DataEntry`
   - Submit fallback: `input[name="_FID_DoUploadCv"]`

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
- La certification finale doit synchroniser:
  - le checkbox visible
  - et le hidden booléen `Bool:Data_Certification=true`
- Le bouton `Réinitialiser` permet de nettoyer une session contenant déjà un CV / des pièces jointes avant un nouvel upload Firebase.
