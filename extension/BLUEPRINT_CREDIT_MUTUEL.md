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
   - Name backend fichier: `Data_CvFile_File`
   - Submit fallback: `input[name="_FID_DoUploadCv"]`
   - Submit backend: `_FID_DoUploadCv=Ajouter`
   - Bouton visible observé:
     - `Joignez votre CV`
     - libellé complet accessible: `Joignez votre CV Parcourir et ajouter une pièce jointe...`
   - Effet confirmé:
     - l'upload fait rester sur `/fr/candidature_annonce.html?_tabi=C&_pid=Candidature`
     - le serveur passe `Data_CvFile_Visible=true`
     - le serveur positionne `Data_ProfilOk=true`
     - le formulaire final est alors rendu

4. `application_form`
   - Même URL que l'étape upload:
     - `/fr/candidature_annonce.html?_tabi=C&_pid=Candidature`
   - Identité:
     - civilité `#C:pagePrincipale.M:DataEntry`
       - radio backend `Data_Civilite=M`
       - radio backend `Data_Civilite=Mme`
     - nom `#C:pagePrincipale.i-74-1`
       - name backend `[t:xsd%3astring;]Data_Nom`
     - prénom `#C:pagePrincipale.i-74-2`
       - name backend `[t:xsd%3astring;]Data_Prenom`
     - email `#C:pagePrincipale.i135`
       - name backend `[t:xsd%3astring;]Data_Email`
     - confirmation email `#C:pagePrincipale.i136`
       - name backend `[t:xsd%3astring;]Data_EmailConf`
     - téléphone `#C:pagePrincipale.i117`
       - name backend `[t:xsd%3astring;]Data_Phone`
   - Diplôme:
     - `#C:pagePrincipale.ddl1:DataEntry`
     - name backend `Data_NiveauChoisi`
     - options confirmées:
       - `1` = `Inférieur au Baccalauréat`
       - `2` = `BAC validé`
       - `7` = `BAC + 2 validé`
       - `8` = `BAC + 3 validé`
       - `4` = `BAC + 4 validé`
       - `5` = `BAC + 5 validé ou en cours`
   - Langues:
     - conteneurs `#C:pagePrincipale.LesLangues.F1_X.G4:root:root`
     - ajout ligne `#C:pagePrincipale.C2:link`
     - suppression ligne `#C:pagePrincipale.LesLangues.F1_X.C1:link`
     - selects backend confirmés:
       - langue `Data_Langues_LangueVm(_N)__Id`
       - niveau écrit `Data_Langues_LangueVm(_N)__NiveauEcrit`
       - niveau oral `Data_Langues_LangueVm(_N)__NiveauOral`
     - mapping options confirmé:
       - langues: `Anglais=2`, `Allemand=1`, `Arabe=8`, `Chinois=3`, `Espagnol=4`, `Français=5`, `Italien=6`, `Néerlandais=9`, `Russe=7`, `Portugais=10`, `Hongrois=11`, `Tchèque=12`
       - niveaux: `Notions=1`, `Scolaire=2`, `Courant=3`, `Langue maternelle=4`
     - rendu confirmé après upload CV:
       - 2 lignes langues visibles par défaut
   - Origine candidature:
     - `#C:pagePrincipale.originePanel.ddl2:DataEntry`
     - name backend `Data_OrigineChoisie`
     - option utile confirmée:
       - `Linkedin=14`
   - Certification finale:
     - checkbox visible `#C:pagePrincipale.cb2:DataEntry`
     - hidden companion `#C:pagePrincipale.cb2:DataEntry:cbhf`
     - libellé exact confirmé:
       - `Je certifie que les renseignements fournis ci-dessus sont exacts.`
   - Validation:
     - `#C:pagePrincipale.C4:link`
     - submit backend `_FID_DoValidate`
     - bouton reset `#C:pagePrincipale.C5:link`
     - lien reset backend `?_fid=DoReset`
     - lien abandon `#C:pagePrincipale.btnAbandon:link`
     - abandon backend `?_fid=DoCancel`
   - Reset session complète:
     - `#C:pagePrincipale.C5:link`
   - Pièces jointes additionnelles confirmées:
     - lettre de motivation:
       - input `#C:pagePrincipale.Motivations.IUP1:DataEntry`
       - name backend `Data_LettreMotiv_File`
       - submit `_FID_AjouterLettreMotiv`
     - document libre:
       - input `#C:pagePrincipale.IUP2:DataEntry`
       - name backend `Data_Doc_File`
       - submit `_FID_AjouterDoc`

5. `success`
   - URL réelle confirmée: `/fr/message.html?message=0`
   - Texte clé:
     - `Accusé de réception`
     - `Votre candidature à l'offre ... a été transmise ce jour`

## Spécificités importantes

- Le flux ne passe pas par un compte utilisateur email / mot de passe.
- Le CV charge un pré-remplissage serveur.
- Le bandeau cookies doit être fermé avant la RGPD, sinon la progression peut sembler bloquée alors que les contrôles sont masqués/interceptés.
- Le passage `upload_cv -> application_form` peut être rejoué côté HTTP classique:
  - champ fichier CV `Data_CvFile_File`
  - submit `_FID_DoUploadCv`
- Après upload, le serveur peut préremplir des valeurs imparfaites issues du parsing CV (ex: téléphone). Le filler doit continuer à écraser explicitement les champs cibles avec les valeurs Taleos.
- La certification finale doit synchroniser:
  - le checkbox visible
  - et le hidden booléen `Bool:Data_Certification=true`
- Le bouton `Réinitialiser` permet de nettoyer une session contenant déjà un CV / des pièces jointes avant un nouvel upload Firebase.
