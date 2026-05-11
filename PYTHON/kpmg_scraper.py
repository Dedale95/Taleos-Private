#!/usr/bin/env python3
"""
KPMG France — Job Scraper
=========================
Site      : https://emplois.kpmg.fr/
Plateforme: Radancy (TalentBrew) — HTML server-rendered, pas d'API JSON globale
Pagination : GET /recherche-d%27offres?k=&l=&p={N}, 15 offres/page, ~200 offres total
Champs listing  : titre, localisation (ville, région), type de contrat, catégorie, spécialité
Champs détail   : JSON-LD (date publication, description, localisation structurée)
Delta scraping  : seules les nouvelles URLs enrichissent depuis la page détail
"""

import json
import logging
import re
import sqlite3
import sys
import time
import unicodedata
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

import requests
from bs4 import BeautifulSoup

try:
    from job_family_classifier import classify_job_family
    from experience_extractor import extract_experience_level
    from country_normalizer import normalize_country
except ImportError:
    sys.path.append(str(Path(__file__).parent))
    from job_family_classifier import classify_job_family
    from experience_extractor import extract_experience_level
    from country_normalizer import normalize_country

# ─────────────────────────── Logging ────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)

# ─────────────────────────── Constantes ─────────────────────────────────────
BASE_URL        = "https://emplois.kpmg.fr"
SEARCH_PATH     = "/recherche-d%27offres"   # URL-encoded apostrophe
COMPANY_NAME    = "KPMG France"
JOBS_PER_PAGE   = 15
REQUEST_DELAY   = 1.2
DETAIL_DELAY    = 0.9
REQUEST_TIMEOUT = 30
MAX_RETRIES     = 3

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    "Referer": BASE_URL,
}

# ─────────────────────────── Normalisation contrat ──────────────────────────
_CONTRACT_MAP: Dict[str, str] = {
    "cdi":        "CDI",
    "cdd":        "CDD",
    "stage":      "Stage",
    "alternance": "Alternance",
    "libéral":    "Indépendant / Entrepreneur",
    "liberal":    "Indépendant / Entrepreneur",
    "freelance":  "Indépendant / Entrepreneur",
    "vie":        "V.I.E.",
    "v.i.e":      "V.I.E.",
    "intérim":    "Intérim",
    "interim":    "Intérim",
}

def parse_contract(raw: str) -> str:
    if not raw:
        return ""
    low = raw.strip().lower()
    for k, v in _CONTRACT_MAP.items():
        if k in low:
            return v
    return raw.strip()


# ─────────────────────────── Normalisation expérience ───────────────────────
# KPMG facets: "Expérimentés", "Etudiants", "Jeunes diplômés"
# Taleos canonical: "0 - 2 ans", "3 - 5 ans", "6 - 10 ans", "11 ans et plus"
def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "")
    return "".join(c for c in s if not unicodedata.combining(c)).lower()

_KPMG_EXP_MAP: Dict[str, str] = {
    "etudiant":       "0 - 2 ans",
    "jeune diplome":  "0 - 2 ans",
    "junior":         "0 - 2 ans",
    # "experimente" → trop large, NLP sera appliqué sur description
}

def parse_experience_tag(raw: str) -> str:
    """Convertit un libellé KPMG en niveau Taleos (si possible)."""
    n = _norm(raw)
    for k, v in _KPMG_EXP_MAP.items():
        if k in n:
            return v
    return ""


# ─────────────────────────── Famille de métier ──────────────────────────────
# KPMG catégories → familles Taleos
# On priorise la spécialité (plus précise) puis la catégorie générale.
_SPEC_FAMILY: Dict[str, str] = {
    "audit financier":            "Inspection / Audit",
    "commissariat aux comptes":   "Inspection / Audit",
    "audit interne":              "Inspection / Audit",
    "risk & compliance":          "Conformité / Sécurité financière",
    "risk and compliance":        "Conformité / Sécurité financière",
    "conformite":                 "Conformité / Sécurité financière",
    "transaction services":       "Financement et Investissement",
    "corporate finance":          "Finances / Comptabilité / Contrôle de gestion",
    "restructuring":              "Financement et Investissement",
    "fusion":                     "Financement et Investissement",
    "acquisition":                "Financement et Investissement",
    "data & ia":                  "IT, Digital et Data",
    "data et ia":                 "IT, Digital et Data",
    "intelligence artificielle":  "IT, Digital et Data",
    "deploiement solutions it":   "IT, Digital et Data",
    "solutions it":               "IT, Digital et Data",
    "infrastructure":             "IT, Digital et Data",
    "cybersecurite":              "IT, Digital et Data",
    "cyber":                      "IT, Digital et Data",
    "transfo business":           "Organisation / Qualité",
    "transformation":             "Organisation / Qualité",
    "organisation":               "Organisation / Qualité",
    "ressources humaines":        "Ressources Humaines",
    "talent":                     "Ressources Humaines",
    "comptabilite":               "Finances / Comptabilité / Contrôle de gestion",
    "finance":                    "Finances / Comptabilité / Contrôle de gestion",
    "consolidation":              "Finances / Comptabilité / Contrôle de gestion",
    "reporting":                  "Finances / Comptabilité / Contrôle de gestion",
    "fiscal":                     "Juridique",
    "fiscalite":                  "Juridique",
    "juridique":                  "Juridique",
    "droit":                      "Juridique",
    "marketing":                  "Marketing et Communication",
    "communication":              "Marketing et Communication",
    "immobilier":                 "Immobilier",
}

_CAT_FAMILY: Dict[str, str] = {
    "audit":                          "Inspection / Audit",
    "conseil deal":                   "Financement et Investissement",
    "conseil tech":                   "IT, Digital et Data",
    "conseil business":               "Organisation / Qualité",
    "droit et fiscalite":             "Juridique",
    "droit":                          "Juridique",
    "fiscalite":                      "Juridique",
    "fonctions corporate":            "Direction générale",
    "ressources humaines":            "Ressources Humaines",
}

def map_job_family(category: str, speciality: str) -> str:
    spec_n = _norm(speciality or "")
    cat_n  = _norm(category or "")
    # Spécialité d'abord (plus précise)
    for k, v in _SPEC_FAMILY.items():
        if k in spec_n:
            return v
    # Puis catégorie
    for k, v in _CAT_FAMILY.items():
        if k in cat_n:
            return v
    return ""  # NLP sera appliqué


# ─────────────────────────── Localisation ───────────────────────────────────
def parse_listing_location(raw: str) -> Tuple[str, str]:
    """
    'Nantes, Pays de la Loire' → ('Nantes - France', 'Pays de la Loire')
    'La Défense' → ('La Défense - France', '')
    """
    if not raw:
        return "", ""
    parts = [p.strip() for p in raw.split(",")]
    city   = parts[0] if parts else ""
    region = parts[1] if len(parts) > 1 else ""
    loc    = f"{city} - France" if city else "France"
    return loc, region


# ─────────────────────────── Éducation ──────────────────────────────────────
_EDUCATION_MAP: Dict[str, str] = {
    "bac +4/5": "Bac+5/Master 2",
    "bac+4/5":  "Bac+5/Master 2",
    "bac +5":   "Bac+5/Master 2",
    "bac+5":    "Bac+5/Master 2",
    "bac +4":   "Bac+4/Master 1",
    "bac+4":    "Bac+4/Master 1",
    "bac +2/3": "Bac+2",
    "bac+2/3":  "Bac+2",
    "bac +3":   "Bac+3/Licence",
    "bac+3":    "Bac+3/Licence",
    "bac +2":   "Bac+2",
    "bac+2":    "Bac+2",
    "master":   "Bac+5/Master 2",
    "doctorat": "Doctorat/PhD",
    "phd":      "Doctorat/PhD",
}

def parse_education(raw: str) -> str:
    if not raw:
        return ""
    low = raw.strip().lower()
    for k, v in _EDUCATION_MAP.items():
        if k in low:
            return v
    return ""


# ─────────────────────────── HTTP helpers ───────────────────────────────────
def fetch(url: str, session: requests.Session) -> Optional[str]:
    for attempt in range(MAX_RETRIES):
        try:
            r = session.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
            r.raise_for_status()
            return r.text
        except Exception as e:
            if attempt < MAX_RETRIES - 1:
                time.sleep(2 ** attempt)
            else:
                logger.warning(f"Échec fetch {url}: {e}")
    return None


# ─────────────────────────── Parsing listing ────────────────────────────────
def parse_listing_page(html: str) -> List[Dict]:
    """Extrait les jobs d'une page de listing KPMG."""
    soup = BeautifulSoup(html, "html.parser")
    jobs = []

    # Chaque offre porte un attribut data-job-id sur son conteneur
    cards = soup.find_all(attrs={"data-job-id": True})

    for card in cards:
        job_id_raw = str(card.get("data-job-id", "")).strip()
        if not job_id_raw:
            continue
        job_id = f"KPMG_{job_id_raw}"

        # Lien vers la page détail
        link = card.find("a", href=True)
        href = (link["href"] if link else "").strip()
        if href and not href.startswith("http"):
            href = BASE_URL + href

        # Titre
        title_el = card.find(class_=re.compile(r"\bjob[-_]list[_-]?title\b", re.I))
        if not title_el:
            title_el = card.find("h2") or card.find("h3")
        title = title_el.get_text(strip=True) if title_el else ""

        # Localisation
        loc_el = card.find(class_=re.compile(r"\bjob[-_]list[_-]?location\b", re.I))
        loc_raw = loc_el.get_text(strip=True) if loc_el else ""
        location, region = parse_listing_location(loc_raw)

        # Type de contrat
        ct_el = card.find(class_=re.compile(r"\bjob[-_]list[_-]?contract\b", re.I))
        ct_raw = ct_el.get_text(strip=True) if ct_el else ""

        # Catégorie / Département
        cat_el = card.find(class_=re.compile(r"\bjob[-_]list[_-]?category\b", re.I))
        category = cat_el.get_text(strip=True) if cat_el else ""

        # Spécialité
        spec_el = card.find(class_=re.compile(r"\bjob[-_]list[_-]?speciality\b", re.I))
        speciality = spec_el.get_text(strip=True) if spec_el else ""

        # Niveau d'expérience (si présent dans le listing)
        exp_el = card.find(class_=re.compile(r"\bjob[-_]list[_-]?experience\b|job[-_]experience", re.I))
        exp_raw = exp_el.get_text(strip=True) if exp_el else ""

        if not href or not title:
            continue

        contract = parse_contract(ct_raw)
        exp_level = parse_experience_tag(exp_raw)
        # Stage/Alternance → toujours "0 - 2 ans"
        if not exp_level and contract in ("Stage", "Alternance"):
            exp_level = "0 - 2 ans"

        jobs.append({
            "job_id":         job_id,
            "job_url":        href,
            "job_title":      title,
            "location":       location,
            "region":         region,
            "country":        "France",
            "contract_type":  contract,
            "job_family":     map_job_family(category, speciality),
            "experience_level": exp_level,
            "company_name":   COMPANY_NAME,
            # Champs internes (non stockés tels quels)
            "_category":      category,
            "_speciality":    speciality,
        })

    return jobs


def get_total_pages(html: str) -> int:
    """Estime le nombre de pages depuis la page 1."""
    soup = BeautifulSoup(html, "html.parser")
    max_page = 1
    for a in soup.find_all("a", href=True):
        m = re.search(r"[?&]p=(\d+)", a["href"])
        if m:
            max_page = max(max_page, int(m.group(1)))
    # Fallback : compter depuis le total affiché
    for el in soup.find_all(string=re.compile(r"\d+\s*(offre|emploi|résultat)", re.I)):
        m = re.search(r"(\d+)", el)
        if m:
            total = int(m.group(1))
            if 10 < total < 5000:
                max_page = max(max_page, (total + JOBS_PER_PAGE - 1) // JOBS_PER_PAGE)
                break
    return max_page


# ─────────────────────────── Parsing détail ─────────────────────────────────
def parse_detail_page(html: str, base_job: Dict) -> Dict:
    """Enrichit un job avec les données de sa page détail."""
    soup = BeautifulSoup(html, "html.parser")
    job = dict(base_job)
    # Supprimer les champs internes
    job.pop("_category", None)
    job.pop("_speciality", None)

    # ── JSON-LD ──────────────────────────────────────────────────────────────
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            raw = (script.string or "").strip()
            data = json.loads(raw)
            if isinstance(data, list):
                data = next((d for d in data if d.get("@type") == "JobPosting"), None) or {}
            if data.get("@type") != "JobPosting":
                continue

            # Date de publication
            if not job.get("publication_date") and data.get("datePosted"):
                dp = str(data["datePosted"])
                # Format KPMG : "2026-5-10" → "2026-05-10"
                try:
                    parts = [p.zfill(2) for p in dp.split("-")]
                    job["publication_date"] = "-".join(parts[:3])
                except Exception:
                    job["publication_date"] = dp[:10]

            # Description
            desc_raw = data.get("description", "")
            if desc_raw:
                desc_soup = BeautifulSoup(desc_raw, "html.parser")
                job["job_description"] = desc_soup.get_text(separator="\n", strip=True)

            # Localisation structurée (plus précise que le listing)
            locations = data.get("jobLocation", [])
            if isinstance(locations, dict):
                locations = [locations]
            if locations:
                addr = locations[0].get("address", {})
                city    = addr.get("addressLocality", "")
                region  = addr.get("addressRegion", "")
                country = addr.get("addressCountry", "France")
                country_norm = normalize_country(country) or country
                if city:
                    job["location"] = f"{city} - {country_norm}"
                    if region and not job.get("region"):
                        job["region"] = region
                elif country_norm:
                    job["location"] = country_norm
                job["country"] = country_norm

            # Type d'emploi (fallback)
            if not job.get("contract_type") and data.get("employmentType"):
                job["contract_type"] = parse_contract(data["employmentType"])

            break
        except Exception:
            continue

    # ── Champs sidebar (job-info) ─────────────────────────────────────────────
    for cls, handler in [
        (r"\bjob-contract-type\b",  lambda v: {"contract_type": parse_contract(v)}),
        (r"\bjob-location\b",       lambda v: {"location": v} if not job.get("location") else {}),
        (r"\bjob-education\b",      lambda v: {"education_level": parse_education(v)}),
        (r"\bjob-experience\b",     lambda v: {"experience_level": parse_experience_tag(v) or job.get("experience_level", "")}),
    ]:
        el = soup.find(class_=re.compile(cls, re.I))
        if el:
            val = el.get_text(strip=True)
            if val:
                updates = handler(val)
                for k, v in updates.items():
                    if v:
                        job[k] = v

    # ── NLP fallback ─────────────────────────────────────────────────────────
    title = job.get("job_title", "")
    desc  = job.get("job_description", "")

    if not job.get("job_family") and (title or desc):
        fam = classify_job_family(title, desc)
        if fam:
            job["job_family"] = fam

    if not job.get("experience_level"):
        contract = job.get("contract_type", "")
        if contract in ("Stage", "Alternance"):
            job["experience_level"] = "0 - 2 ans"
        elif title or desc:
            exp = extract_experience_level(title, desc, contract)
            if exp:
                job["experience_level"] = exp

    job.setdefault("country", "France")
    job.setdefault("publication_date", datetime.now().strftime("%Y-%m-%d"))
    return job


# ─────────────────────────── Base de données ────────────────────────────────
class Database:
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self._init()

    def _init(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS jobs (
                    job_url           TEXT PRIMARY KEY,
                    job_id            TEXT,
                    job_title         TEXT,
                    contract_type     TEXT,
                    publication_date  TEXT,
                    location          TEXT,
                    job_family        TEXT,
                    status            TEXT DEFAULT 'Live',
                    company_name      TEXT,
                    job_description   TEXT,
                    experience_level  TEXT,
                    education_level   TEXT,
                    country           TEXT,
                    region            TEXT,
                    source            TEXT DEFAULT 'KPMG',
                    first_seen        TEXT,
                    last_updated      TEXT,
                    is_valid          INTEGER DEFAULT 1
                )
            """)
            conn.commit()

    def get_live_urls(self) -> Set[str]:
        with sqlite3.connect(self.db_path) as conn:
            rows = conn.execute(
                "SELECT job_url FROM jobs WHERE status='Live' AND is_valid=1"
            ).fetchall()
        return {r[0] for r in rows}

    def get_all_urls(self) -> Set[str]:
        with sqlite3.connect(self.db_path) as conn:
            rows = conn.execute("SELECT job_url FROM jobs").fetchall()
        return {r[0] for r in rows}

    def expire_missing(self, current_urls: Set[str]):
        live = self.get_live_urls()
        to_expire = live - current_urls
        if not to_expire:
            return
        ph = ",".join("?" * len(to_expire))
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                f"UPDATE jobs SET status='Expired', last_updated=CURRENT_TIMESTAMP "
                f"WHERE job_url IN ({ph})",
                list(to_expire),
            )
            conn.commit()
        logger.info(f"  ⚰️  {len(to_expire)} offre(s) expirée(s)")

    def upsert(self, job: Dict):
        url = job.get("job_url", "")
        if not url:
            return
        # Supprimer les champs internes avant sauvegarde
        j = {k: v for k, v in job.items() if not k.startswith("_")}
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                INSERT INTO jobs (
                    job_url, job_id, job_title, contract_type, publication_date,
                    location, job_family, status, company_name, job_description,
                    experience_level, education_level, country, region, source,
                    first_seen, last_updated, is_valid
                ) VALUES (
                    :job_url, :job_id, :job_title, :contract_type, :publication_date,
                    :location, :job_family, 'Live', :company_name, :job_description,
                    :experience_level, :education_level, :country, :region, 'KPMG',
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1
                )
                ON CONFLICT(job_url) DO UPDATE SET
                    job_title        = excluded.job_title,
                    contract_type    = excluded.contract_type,
                    location         = excluded.location,
                    job_family       = excluded.job_family,
                    status           = 'Live',
                    job_description  = COALESCE(excluded.job_description, jobs.job_description),
                    experience_level = excluded.experience_level,
                    education_level  = excluded.education_level,
                    country          = excluded.country,
                    region           = excluded.region,
                    last_updated     = CURRENT_TIMESTAMP,
                    is_valid         = 1
            """, {
                "job_url":          url,
                "job_id":           j.get("job_id", ""),
                "job_title":        j.get("job_title", ""),
                "contract_type":    j.get("contract_type", ""),
                "publication_date": j.get("publication_date", ""),
                "location":         j.get("location", ""),
                "job_family":       j.get("job_family", ""),
                "company_name":     j.get("company_name", COMPANY_NAME),
                "job_description":  j.get("job_description", ""),
                "experience_level": j.get("experience_level", ""),
                "education_level":  j.get("education_level", ""),
                "country":          j.get("country", "France"),
                "region":           j.get("region", ""),
            })
            conn.commit()


# ─────────────────────────── Config ─────────────────────────────────────────
class Config:
    BASE_DIR = Path(__file__).parent
    DB_PATH  = BASE_DIR / "kpmg_jobs.db"


# ─────────────────────────── Main ───────────────────────────────────────────
def run():
    config = Config()
    db     = Database(config.DB_PATH)
    session = requests.Session()

    logger.info("=" * 55)
    logger.info("  KPMG France Scraper — emplois.kpmg.fr")
    logger.info("=" * 55)

    # ── 1. Listing : collecter toutes les offres ──────────────────────────
    logger.info("📋 Collecte des pages de listing…")
    all_jobs: List[Dict] = []
    seen_urls: Set[str] = set()

    # Page 1 sans paramètre p
    first_url = f"{BASE_URL}{SEARCH_PATH}?k=&l="
    first_html = fetch(first_url, session)
    total_pages = get_total_pages(first_html) if first_html else 1
    logger.info(f"  Total pages estimé : {total_pages}")

    for page in range(1, total_pages + 5):   # +5 de marge
        url = f"{BASE_URL}{SEARCH_PATH}?k=&l=&p={page}" if page > 1 else first_url
        html = first_html if page == 1 else fetch(url, session)
        if not html:
            logger.warning(f"  Page {page} : impossible de récupérer")
            break

        jobs = parse_listing_page(html)
        if not jobs:
            logger.info(f"  Page {page} : 0 offre — fin du listing")
            break

        new = [j for j in jobs if j["job_url"] not in seen_urls]
        seen_urls.update(j["job_url"] for j in jobs)
        all_jobs.extend(new)
        logger.info(f"  Page {page}/{total_pages} : {len(jobs)} offres ({len(new)} nouvelles)")

        if page > 1:
            time.sleep(REQUEST_DELAY)

    logger.info(f"✅ {len(all_jobs)} offres trouvées au total")

    # ── 2. Expirer les offres disparues ───────────────────────────────────
    current_urls = {j["job_url"] for j in all_jobs}
    db.expire_missing(current_urls)

    # ── 3. Enrichir les nouvelles offres depuis la page détail ───────────
    existing_urls = db.get_all_urls()
    to_enrich = [j for j in all_jobs if j["job_url"] not in existing_urls]
    to_update  = [j for j in all_jobs if j["job_url"] in existing_urls]

    logger.info(f"🔍 {len(to_enrich)} nouvelles offres à enrichir, {len(to_update)} à mettre à jour")

    # Mise à jour des offres existantes (statut + champs listing)
    for job in to_update:
        job.pop("_category", None)
        job.pop("_speciality", None)
        db.upsert(job)

    # Enrichissement complet des nouvelles offres
    for i, job in enumerate(to_enrich, 1):
        logger.info(f"  [{i}/{len(to_enrich)}] {job['job_title'][:65]}")
        html = fetch(job["job_url"], session)
        if html:
            enriched = parse_detail_page(html, job)
        else:
            job.pop("_category", None)
            job.pop("_speciality", None)
            enriched = job
        db.upsert(enriched)
        time.sleep(DETAIL_DELAY)

    logger.info(f"✅ KPMG France : {len(to_enrich)} nouvelles offres, {len(to_update)} mises à jour")


if __name__ == "__main__":
    run()
