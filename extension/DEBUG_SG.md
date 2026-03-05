# Debug automatisation Société Générale

## Où regarder

### 1. Console de la page (F12 → Console)
Filtrez par `Taleos` pour voir :
- **`[Taleos SG Runner]`** : le content script s'exécute-t-il sur cette page ?
- **`[Taleos SG]`** : le script d'automatisation s'exécute-t-il ?

Si après navigation vers jobapply.ftl vous ne voyez **aucun** log `[Taleos SG Runner]`, le content script ne se charge pas sur cette page.

### 2. Service Worker de l'extension
1. Allez sur `chrome://extensions`
2. Activez "Mode développeur"
3. Cliquez sur "Inspecter les vues : service worker" pour Taleos
4. Onglet Console : cherchez `[Taleos SG]`
   - `sg_page_loaded reçu` = le content script a bien envoyé le message
   - `Injection dans tab X` = on tente d'injecter
   - `Injection OK` = succès
   - `Erreur injection` = échec (détails dans l'erreur)

### 3. Ce que chaque cas indique

| Console page | Service worker | Problème probable |
|--------------|----------------|-------------------|
| Pas de Runner | - | Content script pas chargé (vérifier manifest, recharger l'extension) |
| Runner "Pas de taleos_pending_sg" | - | taleos_pending_sg supprimé trop tôt |
| Runner "Envoi sg_page_loaded" | Pas de "sg_page_loaded reçu" | Message pas reçu (extension mal rechargée ?) |
| Runner OK | "sg_page_loaded reçu" mais "Injection ignorée" | Debounce 3s - attendre ou réduire |
| Runner OK | "Injection OK" | Script injecté - si pas de log [Taleos SG] sur la page, le script ne s'exécute pas dans le bon frame |

## Recharger l'extension après modification
`chrome://extensions` → bouton ⟳ sur Taleos
