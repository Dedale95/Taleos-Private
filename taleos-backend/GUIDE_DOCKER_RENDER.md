# Guide Détaillé : Migration vers Docker sur Render.com

## 📋 Prérequis
- Un compte Render.com (gratuit)
- Le service `taleos-connection-tester` déjà créé (ou à créer)
- Le Dockerfile et render.yaml dans le dossier `taleos-backend/`

## 🚀 Étapes Détaillées

### Étape 1 : Accéder à votre Dashboard Render
1. Allez sur https://dashboard.render.com
2. Connectez-vous avec votre compte GitHub
3. Vous devriez voir la liste de vos services

### Étape 2 : Trouver ou Créer le Service
**Si le service existe déjà :**
- Cliquez sur le service `taleos-connection-tester` dans la liste

**Si le service n'existe pas :**
- Cliquez sur le bouton **"New +"** en haut à droite
- Sélectionnez **"Web Service"** (⚠️ PAS "Background Worker")
- Connectez votre repository GitHub
- Render détectera automatiquement le `render.yaml` dans `taleos-backend/`

### Étape 3 : Vérifier la Configuration
1. Dans votre service, allez dans l'onglet **"Settings"**
2. Faites défiler jusqu'à la section **"Build & Deploy"**

### Étape 4 : Configurer Docker dans Settings

**IMPORTANT :** Si votre service existe déjà et n'utilise pas Docker :

1. Dans votre service, allez dans **"Settings"** (menu de gauche)
2. Faites défiler jusqu'à la section **"Build & Deploy"**
3. Cherchez le champ **"Environment"** ou **"Build Command"**

**Option A : Si vous voyez "Build Command" et "Start Command" :**
   - **Build Command** : Laissez VIDE (Render utilisera Docker automatiquement)
   - **Start Command** : Laissez VIDE (géré par le Dockerfile)
   - Cherchez un champ **"Dockerfile Path"** ou **"Dockerfile"** dans cette section
   - Si vous le trouvez, entrez : `taleos-backend/Dockerfile`

**Option B : Si vous ne voyez pas "Dockerfile Path" :**
   - Cherchez un champ **"Root Directory"** dans "Build & Deploy"
   - Entrez : `taleos-backend`
   - Render devrait alors détecter automatiquement le Dockerfile dans ce dossier

**Option C : Si Render utilise render.yaml automatiquement :**
   - Vérifiez que votre `render.yaml` contient bien `dockerfilePath: ./Dockerfile`
   - Render devrait le détecter automatiquement lors du prochain déploiement

### Étape 5 : Vérifier le Root Directory
1. Dans **"Settings"** → **"Build & Deploy"**
2. Cherchez **"Root Directory"**
3. Si votre `render.yaml` est dans `taleos-backend/`, mettez : `taleos-backend`
4. Sinon, laissez vide si tout est à la racine

### Étape 6 : Sauvegarder et Redéployer
1. Cliquez sur **"Save Changes"** en bas de la page Settings
2. Allez dans l'onglet **"Events"** ou **"Logs"**
3. Cliquez sur **"Manual Deploy"** → **"Deploy latest commit"**
4. Attendez 5-10 minutes pour le build Docker (première fois)

### Étape 7 : Vérifier les Logs
1. Allez dans l'onglet **"Logs"**
2. Vous devriez voir :
   ```
   Building Docker image...
   Step 1/8 : FROM python:3.11-slim
   Step 2/8 : RUN apt-get update...
   ...
   Installing Playwright...
   playwright install chromium
   ```
3. Si vous voyez des erreurs, vérifiez les logs complets

## ⚠️ Points Importants

### Différence entre "Web Service" et "Background Worker"
- **Web Service** : Pour les APIs HTTP (Flask, Express, etc.) - ✅ C'EST CE QU'IL FAUT
- **Background Worker** : Pour les tâches en arrière-plan (cron jobs, queues) - ❌ PAS POUR NOUS

### Structure du Repository
```
mon-site/
├── taleos-backend/
│   ├── Dockerfile          ← Dockerfile ici
│   ├── render.yaml         ← Configuration Render
│   ├── app.py
│   └── requirements.txt
└── HTML/
    └── connexions.html
```

### Si Render ne détecte pas Docker
**Option 1 : Déplacer le Dockerfile à la racine**
```bash
# À la racine du repo
cp taleos-backend/Dockerfile ./Dockerfile
# Modifier render.yaml pour pointer vers ./Dockerfile
```

**Option 2 : Spécifier le chemin dans Render**
- Dans Settings → Build & Deploy
- Dockerfile Path : `taleos-backend/Dockerfile`

## 🔍 Vérification du Déploiement

Une fois déployé, testez avec :
```bash
curl https://taleos-connection-tester.onrender.com/health
```

Vous devriez recevoir :
```json
{"status": "ok", "message": "Service is running"}
```

## 🐛 Dépannage

### Erreur : "Dockerfile not found"
- Vérifiez que le Dockerfile existe dans `taleos-backend/`
- Vérifiez le "Root Directory" dans Settings
- Vérifiez le "Dockerfile Path" dans Settings

### Erreur : "Executable doesn't exist"
- Le Dockerfile devrait installer Playwright correctement
- Vérifiez les logs de build pour voir si `playwright install chromium` a réussi

### Erreur : "Build timeout"
- Le build Docker peut prendre 10-15 minutes la première fois
- Augmentez le timeout dans Settings si nécessaire

## 📞 Support

Si vous avez des problèmes :
1. Vérifiez les logs complets dans Render
2. Vérifiez que le Dockerfile est correct
3. Vérifiez que render.yaml pointe vers le bon Dockerfile
