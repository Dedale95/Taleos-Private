# Diagnostic : Front-end → Backend après changement d'IP AWS

**Nouvelle IP serveur :** `15.236.177.122`

---

## Résultat du scan du projet

### Le Front-end utilise le **domaine**, pas une IP directe

Aucune ancienne IP AWS n'est hardcodée dans le code. Le front-end appelle uniquement :
- **https://api.taleos.co** (domaine)

### Fichiers contenant l'URL de l'API

| Fichier | URL / Configuration |
|---------|---------------------|
| `HTML/offres.html` | `fetch('https://api.taleos.co/apply', ...)` |
| `HTML/filtres.html` | `fetch('https://api.taleos.co/apply', ...)` |
| `HTML/connexions.html` | `API_BASE_URL = 'https://api.taleos.co'` |
| `HTML/connexions.html` | `fetch('https://api.taleos.co/validate', ...)` |

### Fichiers .env / constants.js / config axios

- **Aucun fichier `.env`** trouvé dans le projet (probablement `.gitignore`)
- Pas de `constants.js` ou config axios centralisée : les URLs sont en dur dans les HTML

---

## Cause probable du problème

**Le domaine `api.taleos.co` pointe encore vers l’ancienne IP** du serveur.

Le front-end n’utilise pas d’IP directe. La résolution DNS de `api.taleos.co` doit donc être mise à jour pour pointer vers la nouvelle IP.

---

## 1. Vérifier et corriger le DNS

Sur ton bureau d’enregistrement (OVH, Gandi, Cloudflare, Route 53, etc.) :

1. Récupérer la **nouvelle IP** : `15.236.177.122`
2. Modifier l’enregistrement **A** ou **AAAA** du sous-domaine `api.taleos.co` pour qu’il pointe vers cette IP
3. Sauvegarder et attendre la propagation DNS (quelques minutes à 48 h)

### Vérification DNS (depuis ton poste)

```bash
# Linux / macOS
dig api.taleos.co +short
# ou
nslookup api.taleos.co
```

La réponse doit être `15.236.177.122`.

---

## 2. Configuration Nginx sur le serveur Debian

Après mise à jour du DNS, vérifier que Nginx écoute bien sur la nouvelle IP et sert l’API.

### Connexion SSH

```bash
ssh user@15.236.177.122
```

### Emplacements des configs Nginx

```bash
ls -la /etc/nginx/sites-enabled/
cat /etc/nginx/sites-enabled/default
# ou
cat /etc/nginx/nginx.conf
```

### Exemple de config pour api.taleos.co

```nginx
server {
    listen 80;
    listen 443 ssl;
    server_name api.taleos.co;

    # Certificat SSL (Let's Encrypt par ex.)
    ssl_certificate /etc/letsencrypt/live/api.taleos.co/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.taleos.co/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8000;   # ou le port de ton backend
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Important :
- Nginx doit écouter sur `0.0.0.0` ou sur la nouvelle IP (ou sans `server_name` pour écouter sur toutes les interfaces).
- Le `proxy_pass` doit cibler le port réel du backend (ex. 8000).

### Vérifications à faire sur le serveur

```bash
# Nginx actif
sudo systemctl status nginx

# Config valide
sudo nginx -t

# Ports écoutés
sudo ss -tlnp | grep -E '80|443|8000'

# Logs
sudo tail -f /var/log/nginx/error.log
sudo tail -f /var/log/nginx/access.log
```

### Renouveler le certificat SSL (si changement d’IP / domaine)

```bash
sudo certbot renew
```

---

## 3. Checklist

- [ ] Mettre à jour l’enregistrement DNS **A** de `api.taleos.co` vers `15.236.177.122`
- [ ] Vérifier la résolution DNS (`dig api.taleos.co`)
- [ ] Vérifier que Nginx écoute sur les ports 80/443
- [ ] Vérifier que le backend (ex. Gunicorn) tourne sur le port configuré dans Nginx
- [ ] Tester : `curl -I https://api.taleos.co/apply` (doit retourner 200 ou 405, pas de timeout)

---

## Aucune modification de code nécessaire

Le projet utilise déjà correctement `https://api.taleos.co`. Il suffit de :
1. Mettre à jour le DNS
2. Confirmer la config Nginx sur le serveur
3. S’assurer que le backend est démarré et accessible en local
