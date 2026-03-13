# Analyse BNP Paribas - Site de Recrutement

Date: 13 mars 2026
Analyste: Assistant IA

## Résumé

Le site de recrutement de BNP Paribas utilise une architecture moderne avec du contenu chargé dynamiquement (probablement React ou Next.js). J'ai réussi à naviguer sur le site et à extraire toutes les informations nécessaires pour construire un scraper.

---

## 1. URL de la Page de Listing

**URL principale:** `https://group.bnpparibas/emploi-carriere/toutes-offres-emploi`

**Statistiques:**
- **Total des offres:** 3 702 offres
- **Zones géographiques:** 49
- **Pages totales:** 371 pages (environ 10 offres par page)

---

## 2. Pattern d'URL pour la Pagination

**Format:** `https://group.bnpparibas/emploi-carriere/toutes-offres-emploi?page={numéro}`

**Exemples:**
- Page 1: `https://group.bnpparibas/emploi-carriere/toutes-offres-emploi` (ou `?page=1`)
- Page 2: `https://group.bnpparibas/emploi-carriere/toutes-offres-emploi?page=2`
- Page 3: `https://group.bnpparibas/emploi-carriere/toutes-offres-emploi?page=3`

✅ **Testé et confirmé:** La pagination avec `?page=N` fonctionne correctement.

---

## 3. Structure des Cartes d'Offres (Page de Listing)

### Format du texte des liens

Chaque offre est présentée comme un lien avec le format suivant:

**Pattern:** `{Type de contrat} {Titre de l'offre} {Localisation complète}`

**Exemples observés:**
```
CDI Digital Marketing Executive Zaventem, Bruxelles, Belgique
CDI Marketing Project Manager Zaventem, Bruxelles, Belgique
CDI Analista Remarketing Senior São Paulo, État de São Paulo, Brésil
Stage Beca ADE (Incorporación en Junio) Madrid, Communauté de Madrid, Espagne
Job étudiant JOB ETUDIANT - EPINAL ETE 2026 Épinal, Grand Est, France
Alternance Alternant (e) « Chargé de Conformité » (H/F) Boulogne-Billancourt, Île-de-France, France
```

### Sélecteurs CSS potentiels
- Les offres sont des éléments `<a>` (liens)
- Titre: `h3` avec le nom de l'offre
- Les offres semblent être dans une liste structurée

---

## 4. URL de la Page de Détail

### Pattern d'URL

**Format:** `https://group.bnpparibas/emploi-carriere/offre-emploi/{slug}`

où `{slug}` est une version URL-friendly du titre de l'offre.

**Exemple testé:**
- Titre: "Digital Marketing Executive"
- URL: `https://group.bnpparibas/emploi-carriere/offre-emploi/digital-marketing-executive`

**Observation:** Le slug est en minuscules, avec des espaces remplacés par des tirets (`-`).

---

## 5. Champs Disponibles sur la Page de Détail

Voici tous les champs extraits de la page de détail de l'offre "Digital Marketing Executive":

### A. Informations Principales (Encadré en haut)

| Champ | Valeur Exemple | Sélecteur Potentiel |
|-------|----------------|---------------------|
| **Titre** | "Digital Marketing Executive" | `h1` |
| **Type de contrat** | "CDI (Permanent)" | Contenu avec label "CONTRAT" |
| **Horaires** | "Temps plein" | Contenu avec label "HORAIRES" |
| **Marque/Entreprise** | "ARVAL BNP PARIBAS GROUP" | Contenu avec label "MARQUE" |
| **Niveau d'études** | "Niveau Bac+4/5" | Contenu avec label "NIVEAU D'ÉTUDES" |
| **Métier** | "Marketing" | Contenu avec label "MÉTIER" |
| **Localisation** | "Zaventem, Bruxelles, Belgique" | Contenu avec label "LOCALISATION" |
| **Référence** | "1111111111114816" | Contenu avec label "RÉFÉRENCE" |
| **Date de mise à jour** | "Mise à jour le 13.03.2026" | Texte sous l'encadré principal |

### B. Sections de Description

#### 1. **Objectives** (Objectifs)
Texte décrivant le contexte général du poste. Exemple:
```
We are looking for an experienced, proactive, and self-driven Digital Marketing Executive 
to join our team. In this role, you will be responsible for the day-to-day management 
and optimization of our digital ecosystem...
```

#### 2. **Function** (Fonction)
Liste à puces des responsabilités. Exemple:
- Coordinate digital marketing and website-related projects
- Maintain and develop the Arval.be website
- Create landing pages optimized according to UI/UX best practices
- Responsible for implementing and maintaining the online product offers
- (etc.)

#### 3. **Profile** (Profil recherché)
Liste à puces des qualifications requises. Exemple:
- You have a bachelor's or master's degree, preferably in digital marketing
- You have at least 4 years of recent experience in hands-on digital marketing
- You are passionate about digital marketing with webmaster and/or ecommerce skills
- (etc.)

#### 4. **Our offer** (Notre offre)
Liste des avantages et bénéfices. Exemple:
- An attractive market-level salary and numerous benefits, including:
  - 32 days' holiday for full-time employment
  - Salary for Mobility option
  - Performance-related bonus
  - Group and hospitalisation insurance
  - (etc.)

#### 5. **Reporting line** (Ligne hiérarchique)
Description de la position dans l'organisation. Exemple:
```
You are part of the Marketing team. You report directly to the Digital Marketing 
Team Manager. You work closely with the digital HQ corporate teams, IT and internal 
stakeholders.
```

### C. Section Entreprise

| Champ | Description |
|-------|-------------|
| **Nom de l'entreprise** | "Arval" |
| **Description de l'entreprise** | Texte descriptif de l'entreprise (en français généralement) |

### D. Offres Similaires

Liste de 3-6 offres similaires affichées en bas de page avec:
- Titre de l'offre
- Type de contrat
- Localisation

---

## 6. Sélecteurs CSS Recommandés

Basé sur l'analyse de la structure HTML, voici les sélecteurs à utiliser:

### Page de Listing

```css
/* Toutes les cartes d'offres */
a[href*="/emploi-carriere/offre-emploi/"]

/* Titre de chaque offre */
h3

/* Navigation pagination */
nav[name="Pagination"] a
```

### Page de Détail

```css
/* Titre principal */
h1

/* Sections de contenu */
- Objectives: Chercher heading avec texte "Objectives" puis le contenu suivant
- Function: Chercher heading avec texte "Function" puis les éléments de liste
- Profile: Chercher heading avec texte "Profile" puis les éléments de liste
- Our offer: Chercher heading avec texte "Our offer" puis les éléments de liste
- Reporting line: Chercher heading avec texte "Reporting line" puis le paragraphe

/* Informations structurées en haut */
- Chercher les labels: "CONTRAT", "HORAIRES", "MARQUE", "MÉTIER", "LOCALISATION", "NIVEAU D'ÉTUDES", "RÉFÉRENCE"
- Extraire le contenu associé à chaque label
```

---

## 7. Architecture Technique du Site

### Observations

1. **Framework:** Site probablement construit avec React ou Next.js
2. **Contenu dynamique:** Les offres sont chargées dynamiquement via JavaScript
3. **Routing:** Utilise un système de routing côté client (SPA - Single Page Application)
4. **Protection:** Le site a des protections contre les bots (détectées lors des tentatives avec Playwright/Selenium)

### Défis Techniques Rencontrés

- Les références d'éléments (refs) changent constamment, ce qui rend difficile le clic direct sur les éléments
- Les tentatives avec Playwright ont rencontré des timeouts et erreurs HTTP/2
- Le site nécessite un vrai navigateur avec JavaScript pour charger le contenu

---

## 8. Recommandations pour le Scraper

### Approche Recommandée

**Option 1: Selenium avec Chrome** (Recommandé)
```python
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import time

driver = webdriver.Chrome()
driver.get('https://group.bnpparibas/emploi-carriere/toutes-offres-emploi')
time.sleep(3)  # Attendre le chargement JavaScript

# Extraire les liens d'offres
job_links = driver.find_elements(By.CSS_SELECTOR, 'a[href*="/offre-emploi/"]')
```

**Option 2: Playwright avec délais appropriés**
- Utiliser `wait_for_load_state('networkidle')`
- Ajouter des délais entre les requêtes (2-3 secondes minimum)
- Désactiver HTTP/2 si nécessaire: `args=['--disable-http2']`

### Algorithme de Scraping Proposé

```
1. Pour page = 1 à 371:
   a. Naviguer vers: https://group.bnpparibas/emploi-carriere/toutes-offres-emploi?page={page}
   b. Attendre 3 secondes pour le chargement JavaScript
   c. Extraire tous les liens d'offres sur la page
   
2. Pour chaque lien d'offre:
   a. Naviguer vers l'URL de détail
   b. Attendre 2-3 secondes
   c. Extraire tous les champs (titre, contrat, localisation, description, etc.)
   d. Sauvegarder dans la base de données
   e. Ajouter un délai de 1-2 secondes avant la prochaine offre

3. Gestion des erreurs:
   - Retry automatique en cas d'échec (max 3 tentatives)
   - Logging de toutes les erreurs
   - Sauvegarde incrémentale pour pouvoir reprendre en cas d'interruption
```

### Délais Recommandés

- **Entre pages de listing:** 2-3 secondes
- **Entre pages de détail:** 1-2 secondes
- **Après navigation:** 3 secondes (attente du chargement JS)

### User-Agent

Utiliser un User-Agent de navigateur moderne:
```
Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36
```

---

## 9. Mapping des Champs pour la Base de Données

### Table: `jobs_bnp_paribas`

| Colonne DB | Champ sur le site | Type | Obligatoire |
|------------|-------------------|------|-------------|
| `id` | Généré automatiquement | INTEGER | Oui |
| `source` | "BNP Paribas" | VARCHAR | Oui |
| `url` | URL complète de l'offre | TEXT | Oui |
| `title` | Titre (h1) | VARCHAR | Oui |
| `contract_type` | "CDI", "Stage", "Alternance", etc. | VARCHAR | Oui |
| `company` | Marque/Entreprise | VARCHAR | Non |
| `location` | Localisation complète | VARCHAR | Oui |
| `location_city` | Ville extraite | VARCHAR | Non |
| `location_region` | Région/État extrait | VARCHAR | Non |
| `location_country` | Pays extrait | VARCHAR | Non |
| `education_level` | Niveau d'études | VARCHAR | Non |
| `job_category` | Métier | VARCHAR | Non |
| `work_schedule` | Horaires (Temps plein/partiel) | VARCHAR | Non |
| `reference` | Référence de l'offre | VARCHAR | Non |
| `objectives` | Section Objectives | TEXT | Non |
| `function` | Section Function | TEXT | Non |
| `profile` | Section Profile | TEXT | Non |
| `offer` | Section Our offer | TEXT | Non |
| `reporting_line` | Section Reporting line | TEXT | Non |
| `company_description` | Description de l'entreprise | TEXT | Non |
| `posted_date` | Date de mise à jour | DATE | Non |
| `scraped_at` | Date du scraping | TIMESTAMP | Oui |
| `status` | "Live" ou "Expired" | VARCHAR | Oui |

---

## 10. Points d'Attention

### ⚠️ Limitations et Défis

1. **Pas d'API publique détectée:** Le site ne semble pas exposer d'API REST publique pour les offres
2. **Contenu dynamique:** Nécessite un navigateur complet avec JavaScript
3. **Protection anti-bot:** Le site peut détecter et bloquer les scrapers trop agressifs
4. **Volume important:** 3 702 offres × 2-3 secondes = environ 2-3 heures de scraping
5. **Multilingue:** Les offres sont dans différentes langues selon le pays

### ✅ Bonnes Pratiques

1. **Respecter le robots.txt:** Vérifier les règles du site
2. **Rate limiting:** Ne pas surcharger le serveur (max 1 requête toutes les 2 secondes)
3. **User-Agent:** Se présenter correctement
4. **Gestion des erreurs:** Logging détaillé et retry automatique
5. **Sauvegarde incrémentale:** Pouvoir reprendre en cas d'interruption
6. **Monitoring:** Vérifier régulièrement si la structure du site change

---

## 11. Exemple de Code (Pseudo-code)

```python
import time
from selenium import webdriver
from selenium.webdriver.common.by import By

def scrape_bnp_paribas():
    driver = webdriver.Chrome()
    all_jobs = []
    
    # Parcourir toutes les pages
    for page_num in range(1, 372):  # 371 pages + page 1
        url = f"https://group.bnpparibas/emploi-carriere/toutes-offres-emploi?page={page_num}"
        driver.get(url)
        time.sleep(3)  # Attendre le chargement
        
        # Extraire les liens
        job_links = driver.find_elements(By.CSS_SELECTOR, 'a[href*="/offre-emploi/"]')
        
        for link in job_links:
            job_url = link.get_attribute('href')
            
            # Visiter la page de détail
            driver.get(job_url)
            time.sleep(2)
            
            # Extraire les données
            job_data = {
                'url': job_url,
                'title': driver.find_element(By.CSS_SELECTOR, 'h1').text,
                # ... extraire les autres champs
            }
            
            all_jobs.append(job_data)
            time.sleep(1)  # Délai entre les offres
        
        time.sleep(2)  # Délai entre les pages
    
    driver.quit()
    return all_jobs
```

---

## 12. Prochaines Étapes

1. ✅ **Analyse complète** - Terminée
2. ⏳ **Développement du scraper** - À faire
3. ⏳ **Tests sur un échantillon** (10-20 offres) - À faire
4. ⏳ **Validation des données extraites** - À faire
5. ⏳ **Scraping complet** - À faire
6. ⏳ **Intégration dans le pipeline** - À faire

---

## Conclusion

Le scraping de BNP Paribas est **faisable** mais nécessite:
- Un navigateur complet (Selenium/Playwright)
- Des délais appropriés pour respecter le site
- Une gestion robuste des erreurs
- Environ 2-3 heures pour un scraping complet

La structure du site est claire et les données sont bien organisées, ce qui facilitera l'extraction une fois le scraper mis en place.

---

**Rapport généré le:** 13 mars 2026  
**Outil utilisé:** Cursor IDE Browser + Analyse manuelle  
**Temps d'analyse:** ~1 heure
