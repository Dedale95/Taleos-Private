# Mise à jour des offres d'emploi (processus local)

Le processus complet fonctionne **en local** comme sur GitHub Actions.

## Processus complet (toutes les sources, dont BNP)

```bash
cd PYTHON
python update_all_jobs.py
```

Ce script exécute dans l'ordre :
1. Crédit Agricole
2. Société Générale
3. Deloitte
4. **BNP Paribas** (~2600 offres, ~20-25 min)
5. BPCE
6. Bpifrance
7. Crédit Mutuel
8. ODDO BHF
9. Fusion des bases SQLite → CSV
10. Export JSON pour le site
11. Stats Live / Expired

**Durée totale** : ~1h30 à 2h (selon la machine et la connexion).

## Processus partiel (sans BNP, plus rapide)

Si vous voulez tester rapidement sans BNP :

```bash
cd PYTHON
python credit_agricole_scraper.py
python societe_generale_scraper_improved.py
python deloitte_scraper.py
python bpce_scraper.py
python bpifrance_scraper.py
python credit_mutuel_scraper.py
python oddo_bhf_scraper.py
python fix_data_issues.py
python export_sqlite_to_json.py
```

Dans ce cas, l'export **préserve les offres BNP** déjà présentes dans le JSON (si `bnp_paribas_jobs.db` est absent).

## BNP uniquement (one-off)

Pour mettre à jour uniquement BNP sans relancer les autres scrapers :

```bash
cd PYTHON
python bnp_paribas_scraper.py
python merge_bnp_into_json.py
```

## Prérequis

- Python 3.11+
- `pip install -r requirements_scrapers.txt`
- `playwright install chromium firefox`
