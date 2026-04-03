# Déploiement sur Google Cloud Functions

Ce guide vous explique comment déployer le script de test de connexion bancaire sur Google Cloud Functions.

## 📋 Prérequis

1. **Compte Google Cloud** (gratuit avec crédit de $300)
2. **Google Cloud SDK (gcloud)** installé
3. **Projet Google Cloud** créé
4. **Facturation activée** (nécessaire pour Cloud Functions, même si gratuit)

## 🚀 Étapes de déploiement

### 1. Installer Google Cloud SDK

**Sur macOS :**
```bash
# Avec Homebrew
brew install google-cloud-sdk

# Ou télécharger depuis: https://cloud.google.com/sdk/docs/install
```

**Initialiser gcloud :**
```bash
gcloud init
```

### 2. Créer un projet Google Cloud

```bash
# Créer un nouveau projet (remplacez YOUR_PROJECT_ID par un ID unique)
gcloud projects create YOUR_PROJECT_ID

# Ou utiliser un projet existant
gcloud config set project YOUR_PROJECT_ID
```

### 3. Activer les APIs nécessaires

```bash
# Activer Cloud Functions API
gcloud services enable cloudfunctions.googleapis.com

# Activer Cloud Build API (nécessaire pour le déploiement)
gcloud services enable cloudbuild.googleapis.com

# Activer Cloud Run API (pour les fonctions 2nd gen)
gcloud services enable run.googleapis.com
```

### 4. Copier les fichiers nécessaires

Depuis le répertoire `cloud_function`, vous devez avoir :
- `main.py` ✅
- `requirements.txt` ✅
- `test_bank_connection.py` (depuis le répertoire parent)

**Option A : Copier test_bank_connection.py dans cloud_function**
```bash
cd cloud_function
cp ../test_bank_connection.py .
```

**Option B : Modifier main.py pour pointer vers le répertoire parent**
(Le code actuel utilise cette option)

### 5. Déployer la fonction

**Pour Cloud Functions 2nd gen (recommandé - plus rapide et moderne) :**

```bash
gcloud functions deploy test-bank-connection \
  --gen2 \
  --runtime=python311 \
  --region=europe-west1 \
  --source=. \
  --entry-point=main \
  --trigger-http \
  --allow-unauthenticated \
  --timeout=540s \
  --memory=2GB \
  --max-instances=10
```

**Paramètres importants :**
- `--timeout=540s` : 9 minutes max (nécessaire pour les tests Selenium)
- `--memory=2GB` : Mémoire nécessaire pour Chrome/Selenium
- `--allow-unauthenticated` : Permet d'appeler la fonction sans authentification
- `--region=europe-west1` : Changez selon votre localisation

**Pour Cloud Functions 1st gen (si 2nd gen ne fonctionne pas) :**

```bash
gcloud functions deploy test-bank-connection \
  --runtime=python311 \
  --region=europe-west1 \
  --source=. \
  --entry-point=main \
  --trigger-http \
  --allow-unauthenticated \
  --timeout=540s \
  --memory=2GB \
  --max-instances=10
```

### 5 bis. (Optionnel) Rapports « candidature bloquée » → e-mail contact@taleos.co

L’extension envoie après **2 minutes** une capture JPEG + métadonnées (UID, URL, id offre) vers une seconde fonction HTTP `report-stuck-automation` (fichier `stuck_report.py`). Les e-mails partent vers **contact@taleos.co** si vous configurez SMTP (sinon la fonction répond 200 avec un message indiquant que SMTP n’est pas configuré).

Variables d’environnement : `SMTP_HOST`, `SMTP_PORT` (défaut 587), `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`.

```bash
cd PYTHON/cloud_function
gcloud functions deploy report-stuck-automation \
  --gen2 \
  --runtime=python311 \
  --region=europe-west1 \
  --source=. \
  --entry-point=report_stuck_main \
  --trigger-http \
  --allow-unauthenticated \
  --timeout=60s \
  --memory=256MB \
  --set-env-vars="SMTP_HOST=...,SMTP_USER=...,SMTP_PASSWORD=...,SMTP_FROM=..."
```

L’URL attendue par l’extension est : `https://europe-west1-project-taleos.cloudfunctions.net/report-stuck-automation` (adapter le projet / région si besoin). En parallèle, l’extension enregistre aussi un document Firestore dans la collection `stuck_automation_reports` (et éventuellement une image dans Storage) pour consultation si l’e-mail échoue.

### 6. Récupérer l'URL de la fonction

Après le déploiement, vous verrez l'URL de la fonction dans la sortie, ou récupérez-la avec :

```bash
gcloud functions describe test-bank-connection \
  --gen2 \
  --region=europe-west1 \
  --format="value(serviceConfig.uri)"
```

L'URL ressemblera à :
```
https://test-bank-connection-XXXXX-ew.a.run.app
```

### 7. Mettre à jour le frontend

Dans `HTML/connexions.html`, remplacez `GOOGLE_APPS_SCRIPT_URL` par l'URL de votre Cloud Function :

```javascript
const CLOUD_FUNCTION_URL = 'https://test-bank-connection-XXXXX-ew.a.run.app';
```

## ⚠️ Limitations importantes

### Selenium dans Cloud Functions

**Cloud Functions n'est PAS idéal pour Selenium car :**
- Chrome nécessite beaucoup de mémoire et de CPU
- Les timeouts sont limités
- Les coûts peuvent être élevés

**Alternatives recommandées :**
1. **Cloud Run** (meilleur pour Selenium)
2. **Compute Engine** (machine virtuelle dédiée)
3. **App Engine** (plus de ressources)

### Si Selenium ne fonctionne pas dans Cloud Functions

Vous devrez peut-être utiliser **Cloud Run** à la place :

```bash
# Créer un Dockerfile pour Cloud Run
# Voir README_CLOUD_RUN.md pour plus d'infos
```

## 💰 Coûts

- **Gratuit jusqu'à 2 millions d'invocations/mois**
- **Gratuit jusqu'à 400,000 GB-secondes/mois**
- **Au-delà :** ~$0.40 par million d'invocations + coûts de calcul

Avec Selenium (gourmand en ressources), vous pourriez atteindre les limites gratuites rapidement.

## 🧪 Tester la fonction

```bash
# Tester avec curl
curl -X POST https://YOUR_FUNCTION_URL \
  -H "Content-Type: application/json" \
  -d '{
    "bank_id": "credit_agricole",
    "email": "test@example.com",
    "password": "test123"
  }'
```

## 📝 Logs

Voir les logs de la fonction :

```bash
gcloud functions logs read test-bank-connection \
  --gen2 \
  --region=europe-west1 \
  --limit=50
```

## 🔄 Mise à jour

Pour mettre à jour la fonction :

```bash
# Faire vos modifications
# Puis redéployer avec la même commande
gcloud functions deploy test-bank-connection \
  --gen2 \
  --runtime=python311 \
  --region=europe-west1 \
  --source=. \
  --entry-point=main \
  --trigger-http \
  --allow-unauthenticated \
  --timeout=540s \
  --memory=2GB
```

## 🐛 Dépannage

### Erreur : "Selenium/ChromeDriver not found"
- Vérifiez que `selenium` et `webdriver-manager` sont dans `requirements.txt`
- Cloud Functions doit télécharger ChromeDriver à chaque invocation (peut être lent)

### Erreur : "Timeout"
- Augmentez `--timeout` (max 540s pour HTTP)
- Réduisez les attentes dans le script

### Erreur : "Out of memory"
- Augmentez `--memory` (jusqu'à 8GB pour Gen2)
- Chrome nécessite au moins 1-2GB

## 📚 Ressources

- [Documentation Cloud Functions](https://cloud.google.com/functions/docs)
- [Cloud Functions Pricing](https://cloud.google.com/functions/pricing)
- [Cloud Functions Quotas](https://cloud.google.com/functions/quotas)
