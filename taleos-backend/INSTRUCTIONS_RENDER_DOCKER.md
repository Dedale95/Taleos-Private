# Instructions Détaillées : Configurer Docker sur Render.com

## 🎯 Objectif
Configurer votre service Render pour utiliser Docker au lieu de l'environnement Python natif.

## 📍 Où trouver les paramètres Docker dans Render

### Méthode 1 : Via Settings → Build & Deploy

1. **Allez dans votre service** `taleos-connection-tester` sur Render.com
2. **Cliquez sur "Settings"** dans le menu de gauche
3. **Faites défiler jusqu'à "Build & Deploy"**

### Ce que vous devriez voir :

```
Build & Deploy
├── Root Directory: [vide ou un chemin]
├── Build Command: [vide ou une commande]
├── Start Command: [vide ou une commande]
└── Environment: [Python, Node, Docker, etc.]
```

### Configuration à faire :

#### Si vous voyez un champ "Root Directory" :
1. Cliquez sur "Edit" à côté de "Root Directory"
2. Entrez : `taleos-backend`
3. Cliquez sur "Save"

#### Si vous voyez un champ "Environment" ou "Language" :
1. Cliquez sur "Edit"
2. Changez de "Python" à **"Docker"**
3. Cliquez sur "Save"

#### Si vous voyez "Build Command" :
1. Cliquez sur "Edit"
2. **Laissez VIDE** (Render utilisera Docker automatiquement)
3. Cliquez sur "Save"

#### Si vous voyez "Start Command" :
1. Cliquez sur "Edit"
2. **Laissez VIDE** (géré par le Dockerfile)
3. Cliquez sur "Save"

### Méthode 2 : Via render.yaml (Recommandé)

Si Render détecte automatiquement votre `render.yaml`, il devrait utiliser Docker automatiquement.

**Vérifiez que votre `render.yaml` contient :**
```yaml
services:
  - type: web
    name: taleos-connection-tester
    dockerfilePath: ./Dockerfile
    region: frankfurt
    plan: free
```

**Pour forcer Render à utiliser render.yaml :**
1. Dans Settings → Build & Deploy
2. Cherchez "Root Directory"
3. Entrez : `taleos-backend`
4. Render devrait alors lire le `render.yaml` dans ce dossier

## 🔍 Comment savoir si Docker est activé ?

Après avoir sauvegardé, allez dans l'onglet **"Logs"** et déclenchez un nouveau déploiement.

**Si Docker est activé, vous verrez dans les logs :**
```
Building Docker image...
Step 1/8 : FROM python:3.11-slim
Step 2/8 : RUN apt-get update...
```

**Si Docker n'est PAS activé, vous verrez :**
```
Installing dependencies...
pip install -r requirements.txt
```

## ⚠️ Si vous ne trouvez pas ces options

**Option 1 : Recréer le service**
1. Supprimez l'ancien service
2. Créez un nouveau "Web Service"
3. Lors de la création, sélectionnez **"Docker"** comme Language/Environment
4. Spécifiez le "Root Directory" : `taleos-backend`

**Option 2 : Contacter le support Render**
- Si l'interface a changé, le support peut vous aider

## ✅ Checklist de vérification

- [ ] Service créé en tant que "Web Service" (pas Background Worker)
- [ ] Root Directory = `taleos-backend` (si visible)
- [ ] Environment/Language = "Docker" (si visible)
- [ ] Build Command = VIDE (si visible)
- [ ] Start Command = VIDE (si visible)
- [ ] render.yaml présent dans `taleos-backend/` avec `dockerfilePath: ./Dockerfile`
- [ ] Dockerfile présent dans `taleos-backend/`

## 🚀 Après configuration

1. **Sauvegardez tous les changements**
2. Allez dans l'onglet **"Events"** ou **"Manual Deploy"**
3. Cliquez sur **"Manual Deploy"** → **"Deploy latest commit"**
4. Attendez 5-10 minutes pour le build
5. Vérifiez les logs pour confirmer que Docker est utilisé

## 📸 Où cliquer exactement

1. **Dashboard Render** → Cliquez sur votre service `taleos-connection-tester`
2. **Menu de gauche** → Cliquez sur **"Settings"**
3. **Section "Build & Deploy"** → Faites défiler jusqu'à cette section
4. **Cherchez** :
   - "Root Directory" → Cliquez "Edit" → Entrez `taleos-backend`
   - OU "Environment" → Cliquez "Edit" → Sélectionnez "Docker"
   - OU "Build Command" → Cliquez "Edit" → Laissez vide

## ❓ Questions fréquentes

**Q : Je ne vois pas "Dockerfile Path"**
R : C'est normal ! Render le détecte automatiquement si le Root Directory est correct.

**Q : Je ne vois pas "Root Directory"**
R : Votre service utilise peut-être render.yaml automatiquement. Vérifiez les logs lors du déploiement.

**Q : Comment savoir si ça marche ?**
R : Regardez les logs de build. Si vous voyez "Building Docker image...", c'est bon !
