# Créer un utilisateur de test Firebase pour vérifier les pages protégées

Ce guide permet de créer un compte de **test** dans Firebase pour se connecter au site et vérifier les pages qui nécessitent une connexion (Mon Profil, Recherche avancée, Mes candidatures, Connexions, etc.).

---

## Comportement du site : vérification d'email obligatoire

Sur ce site, **on ne peut pas se connecter sans avoir préalablement vérifié son email**. Si l'email n'est pas vérifié (`emailVerified: false`), la connexion est refusée avec le message « Veuillez vérifier votre email… ».

- **Inscription via le formulaire du site** : Firebase envoie un email de vérification ; l'utilisateur doit cliquer sur le lien pour que le compte soit considéré comme vérifié, puis il peut se connecter.
- **Utilisateur créé dans la console Firebase** : Firebase crée souvent le compte avec `emailVerified: false`. La connexion sera donc bloquée tant que l'email n'est pas marqué comme vérifié (voir ci‑dessous).

---

## Créer l’utilisateur de test dans la console Firebase

1. **Ouvrez** [Firebase Console](https://console.firebase.google.com) et sélectionnez votre projet (ex. `project-taleos`).
2. **Menu de gauche** → **Authentication** (Authentification).
3. **Onglet "Users"** (Utilisateurs).
4. **Cliquez** sur **"Add user"** / **"Ajouter un utilisateur"**.
5. **Renseignez** :
   - **Email** : par ex. `test@test.com` (Option B) ou une adresse à laquelle vous avez accès (Option A)
   - **Mot de passe** : au moins 6 caractères (ex. un mot de passe dédié au test, que vous notez dans un fichier local **non versionné**).
6. **Validez** avec **"Add user"** / **"Ajouter un utilisateur"**.

Pour pouvoir vous connecter sur le site avec ce compte, l’email doit être marqué comme vérifié. Deux possibilités :

**Option A – Utiliser une vraie adresse email**  
Créez l’utilisateur avec une adresse à laquelle vous avez accès (ex. votre Gmail). Créez le compte via le formulaire d’inscription du site avec cette adresse, puis cliquez sur le lien reçu dans l’email. Une fois l’email vérifié, vous pourrez vous connecter.

**Option B – Marquer l’email comme vérifié avec l’Admin SDK (sans boîte mail)**  
Si vous voulez un compte test avec une adresse « bidon » (ex. `test@test.com`) sans ouvrir d’email : créez l’utilisateur dans la console comme ci‑dessus, récupérez son **UID** dans la console Firebase, puis utilisez le **Firebase Admin SDK** (Node.js ou Python) pour appeler `updateUser(uid, { emailVerified: true })`. Il faut une clé de compte de service (Project settings → Service accounts). La console Firebase ne permet pas de modifier « Email verified » à la main.

---

## (Optionnel) Stocker les identifiants de test en local

Pour ne pas oublier les identifiants et les utiliser facilement (sans les mettre dans le dépôt) :

1. **Créez** un fichier local **`TEST_CREDENTIALS.txt`** à la racine du projet (ou dans un dossier de votre choix).
2. **Écrivez** dedans par exemple :
   ```
   Email : test@votredomaine.com
   Mot de passe : (votre mot de passe de test)
   ```
3. **Ajoutez** ce fichier au `.gitignore` pour qu’il ne soit **jamais** commité :

   ```
   TEST_CREDENTIALS.txt
   ```

Vous pourrez ensuite vous connecter sur le site (page Inscription / Connexion) avec ces identifiants pour tester Mon Profil, Recherche avancée, Mes candidatures, Connexions, etc.

---

## Rappel

- Ces identifiants sont **uniquement pour le test** (vous, ou un outil qui ouvrirait le site en étant connecté).
- Ne commitez **jamais** de vrais mots de passe dans le dépôt.
- L’assistant (IA) n’a **pas accès** à votre projet Firebase : seul vous pouvez créer ou modifier des utilisateurs dans la console.
