#!/usr/bin/env python3
"""
CRÉDIT MUTUEL - JOB SCRAPER
Extrait les offres d'emploi depuis recrutement.creditmutuel.fr
Utilise Playwright pour le chargement progressif (Afficher plus) + requests pour les détails.
Tags: famille de métier, expérience, localisation, type de contrat
"""

import asyncio
import logging
import re
import sqlite3
import json
from pathlib import Path
from typing import List, Dict, Set, Optional
from playwright.async_api import async_playwright
from bs4 import BeautifulSoup
from tqdm.asyncio import tqdm
from urllib.parse import urljoin
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

try:
    from city_normalizer import normalize_city
    from country_normalizer import normalize_country, get_country_from_city
    from job_family_classifier import classify_job_family
    from experience_extractor import extract_experience_level
    from credit_mutuel_job_family_mapping import map_credit_mutuel_family
    from credit_mutuel_company_mapping import normalize_company_name
except ImportError:
    import sys
    sys.path.append(str(Path(__file__).parent))
    from city_normalizer import normalize_city
    from country_normalizer import normalize_country, get_country_from_city
    from job_family_classifier import classify_job_family
    from experience_extractor import extract_experience_level
    from credit_mutuel_job_family_mapping import map_credit_mutuel_family
    from credit_mutuel_company_mapping import normalize_company_name

# ================= Logging =================
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)

# ================= Constants =================
BASE_URL = "https://recrutement.creditmutuel.fr"
LISTING_URL = f"{BASE_URL}/fr/nos_offres.html"

# ================= Config =================
class Config:
    MAX_LOAD_MORE_ROUNDS = 100  # Clics sur "Afficher plus" par page tc
    PAGE_TIMEOUT = 45000
    WAIT_AFTER_CLICK = 1.0
    HEADLESS = True
    BASE_DIR = Path(__file__).parent
    DB_PATH = BASE_DIR / "credit_mutuel_jobs.db"
    CSV_PATH = BASE_DIR / "credit_mutuel_jobs.csv"
    MAX_WORKERS = 10
    REQUEST_TIMEOUT = 30

config = Config()


def extract_expected_offer_count(page_text: str) -> Optional[int]:
    text = str(page_text or "").replace("\xa0", " ")
    patterns = [
        r'(\d+)\s+offres?\s+affich(?:e|é)es?\s+sur\s+(\d+)',
        r'parmi\s+nos\s+(\d+)\s+offres',
        r'(\d+)\s+offres?\s+correspondent',
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if not match:
            continue
        if len(match.groups()) >= 2:
            return int(match.group(2))
        return int(match.group(1))
    return None

# ================= Contract type mapping =================
CONTRACT_MAPPING = {
    "cdi": "CDI",
    "cdd": "CDD",
    "stage": "Stage",
    "vie": "VIE",
    "alternance": "Alternance",
    "apprentissage": "Alternance",
    "contrat de professionnalisation": "Alternance",
    "contrat étudiant": "Contrat étudiant",
    "auxiliaire de vacances": "Stage",
    "reconversion professionnelle (cdi)": "CDI",
}

# Experience mapping (CM raw → Taleos format)
EXPERIENCE_MAPPING = {
    "débutant": "0 - 2 ans",
    "debutant": "0 - 2 ans",
    "junior": "0 - 2 ans",
    "confirmé": "6 - 10 ans",
    "confirme": "6 - 10 ans",
    "senior": "11 ans et plus",
    "expert": "11 ans et plus",
}


def normalize_contract(raw: str) -> str:
    if not raw:
        return ""
    cleaned = re.sub(r'\s*\([^)]*\)\s*', '', raw).strip().lower()
    return CONTRACT_MAPPING.get(cleaned, raw.strip())


def normalize_experience(raw: str) -> Optional[str]:
    if not raw:
        return None
    key = str(raw).strip().lower()
    return EXPERIENCE_MAPPING.get(key)


def normalize_location_cm(location_raw: str) -> str:
    """
    CM format: "LILLE (59)" ou "STRASBOURG (67)" ou "LUXEMBOURG (Luxembourg)"
    Output: "Lille - France" ou "Luxembourg - Luxembourg"
    """
    if not location_raw or not str(location_raw).strip():
        return ""
    loc = str(location_raw).strip()
    # Format: VILLE (XX) où XX = code département ou pays
    match = re.match(r'^(.+?)\s*\(([^)]+)\)\s*$', loc)
    if match:
        city_raw = match.group(1).strip()
        code = match.group(2).strip()
        # Luxembourg comme pays
        if code.upper() == "LUXEMBOURG":
            return f"{normalize_city(city_raw) or city_raw} - Luxembourg"
        # Code département français (01-95, 2A, 2B, 971-976)
        if re.match(r'^(0[1-9]|[1-8]\d|9[0-5]|2[AB]|97[1-6])$', code, re.I):
            city = normalize_city(city_raw) or city_raw
            return f"{city} - France"
    # Fallback: utiliser tel quel avec France
    city = normalize_city(loc) or loc
    return f"{city} - France"


# =========================================================
# DATABASE
# =========================================================
class JobDatabase:
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.init_db()

    def init_db(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS jobs (
                    job_url TEXT PRIMARY KEY,
                    job_id TEXT,
                    job_title TEXT,
                    contract_type TEXT,
                    publication_date TEXT,
                    location TEXT,
                    job_family TEXT,
                    duration TEXT,
                    management_position TEXT,
                    status TEXT DEFAULT 'Live',
                    education_level TEXT,
                    experience_level TEXT,
                    training_specialization TEXT,
                    technical_skills TEXT,
                    behavioral_skills TEXT,
                    tools TEXT,
                    languages TEXT,
                    job_description TEXT,
                    company_name TEXT,
                    company_description TEXT,
                    first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    scrape_attempts INTEGER DEFAULT 0,
                    is_valid INTEGER DEFAULT 1
                )
            """)
            conn.commit()

    def get_live_urls(self) -> Set[str]:
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(
                "SELECT job_url FROM jobs WHERE status = 'Live' AND is_valid = 1"
            )
            return {row[0] for row in cursor.fetchall()}

    def mark_error_pages_invalid(self) -> int:
        """Marque is_valid=0 pour les jobs dont le titre/description indique une page d'erreur."""
        error_patterns = ['erreur de navigation', 'accusé de réception', 'accuse de reception', 'page not found', 'page introuvable']
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(
                "SELECT job_url, job_title, job_description FROM jobs WHERE is_valid = 1 AND (job_title IS NOT NULL OR job_description IS NOT NULL)"
            )
            def _norm(s):
                return (s or '').lower().replace('\xa0', ' ')
            to_invalidate = []
            for row in cursor.fetchall():
                title = _norm(row[1])
                desc = _norm(row[2])
                if any(p in title for p in error_patterns) or any(p in desc for p in error_patterns):
                    to_invalidate.append(row[0])
            if to_invalidate:
                placeholders = ','.join('?' * len(to_invalidate))
                conn.execute(f"""
                    UPDATE jobs SET is_valid = 0, last_updated = CURRENT_TIMESTAMP
                    WHERE job_url IN ({placeholders})
                """, tuple(to_invalidate))
                conn.commit()
        return len(to_invalidate)

    def mark_as_expired(self, urls: Set[str]):
        if not urls:
            return
        with sqlite3.connect(self.db_path) as conn:
            placeholders = ','.join('?' * len(urls))
            conn.execute(f"""
                UPDATE jobs SET status = 'Expired', last_updated = CURRENT_TIMESTAMP
                WHERE job_url IN ({placeholders})
            """, tuple(urls))
            conn.commit()

    def insert_or_update_job(self, job: Dict):
        with sqlite3.connect(self.db_path) as conn:
            is_valid = 1 if (job.get('job_id') or job.get('job_title') or job.get('job_description')) else 0
            # Exclure les pages d'erreur (Erreur de navigation, Accusé de réception, etc.)
            title_lower = (job.get('job_title') or '').lower().replace('\xa0', ' ')
            desc_lower = (job.get('job_description') or '').lower().replace('\xa0', ' ')
            error_patterns = ['erreur de navigation', 'accusé de réception', 'accuse de reception', 'page not found', 'page introuvable']
            if any(err in title_lower for err in error_patterns) or any(err in desc_lower for err in error_patterns):
                is_valid = 0
            technical_skills = job.get('technical_skills') or '[]'
            behavioral_skills = job.get('behavioral_skills') or '[]'
            if isinstance(technical_skills, list):
                technical_skills = json.dumps(technical_skills, ensure_ascii=False)
            if isinstance(behavioral_skills, list):
                behavioral_skills = json.dumps(behavioral_skills, ensure_ascii=False)

            conn.execute("""
                INSERT INTO jobs (
                    job_url, job_id, job_title, contract_type, publication_date,
                    location, job_family, duration, management_position, status,
                    education_level, experience_level, training_specialization,
                    technical_skills, behavioral_skills, tools, languages,
                    job_description, company_name, company_description,
                    scrape_attempts, is_valid, last_updated
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(job_url) DO UPDATE SET
                    job_id = excluded.job_id,
                    job_title = excluded.job_title,
                    contract_type = excluded.contract_type,
                    publication_date = excluded.publication_date,
                    location = excluded.location,
                    job_family = excluded.job_family,
                    duration = excluded.duration,
                    management_position = excluded.management_position,
                    status = excluded.status,
                    education_level = excluded.education_level,
                    experience_level = excluded.experience_level,
                    training_specialization = excluded.training_specialization,
                    technical_skills = excluded.technical_skills,
                    behavioral_skills = excluded.behavioral_skills,
                    tools = excluded.tools,
                    languages = excluded.languages,
                    job_description = excluded.job_description,
                    company_name = excluded.company_name,
                    company_description = excluded.company_description,
                    scrape_attempts = scrape_attempts + 1,
                    is_valid = excluded.is_valid,
                    last_updated = CURRENT_TIMESTAMP
            """, (
                job.get('job_url'), job.get('job_id'), job.get('job_title'),
                job.get('contract_type'), job.get('publication_date'),
                job.get('location'), job.get('job_family'), job.get('duration'),
                job.get('management_position'), job.get('status', 'Live'),
                job.get('education_level'), job.get('experience_level'),
                job.get('training_specialization'), technical_skills,
                behavioral_skills, job.get('tools'), job.get('languages'),
                job.get('job_description'), job.get('company_name'),
                job.get('company_description'), is_valid
            ))
            conn.commit()


# =========================================================
# COLLECT JOB URLS (Playwright - par type de contrat + load more)
# =========================================================
async def _collect_urls_for_page(page, url: str) -> Set[str]:
    """Charge une page, clique sur Plus de résultats jusqu'au total attendu, retourne les IDs."""
    await page.goto(url, timeout=config.PAGE_TIMEOUT, wait_until='domcontentloaded')
    await asyncio.sleep(2)
    await page.evaluate("""
        () => {
            document.getElementById('cookieLB')?.remove();
            document.getElementById('bg_modal_name')?.remove();
            document.body?.style?.setProperty('overflow', 'auto', 'important');
        }
    """)
    await asyncio.sleep(0.3)

    all_ids = set()
    target_count = extract_expected_offer_count(await page.text_content("body"))
    stagnant_rounds = 0

    for round_idx in range(config.MAX_LOAD_MORE_ROUNDS):
        ids = await page.evaluate("""
            () => {
                const links = document.querySelectorAll('a[href*="offre.html?annonce="]');
                const s = new Set();
                links.forEach(a => {
                    const m = a.href.match(/annonce=(\\d+)/);
                    if (m) s.add(m[1]);
                });
                return Array.from(s);
            }
        """)
        previous_count = len(all_ids)
        all_ids.update(ids)
        current_count = len(all_ids)
        logging.info(f"Crédit Mutuel listing: {current_count} offres collectées"
                     + (f" / {target_count}" if target_count else "")
                     + f" (tour {round_idx + 1})")

        if target_count and current_count >= target_count:
            break

        if current_count == previous_count:
            stagnant_rounds += 1
        else:
            stagnant_rounds = 0

        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        await asyncio.sleep(0.2)

        clicked = False
        previous_visible_count = len(ids)
        try:
            load_more = page.locator('a[id*="plusDoffresAccessibilite:link"]').first
            if await load_more.count():
                await load_more.scroll_into_view_if_needed()
                await load_more.click(force=True)
                clicked = True
        except Exception:
            clicked = False

        if not clicked:
            logging.warning("Crédit Mutuel listing: bouton 'Plus de résultats' introuvable avant d'atteindre le total attendu")
            break

        try:
            await page.wait_for_function(
                """(previousVisibleCount) => {
                    const links = document.querySelectorAll('a[href*="offre.html?annonce="]');
                    return links.length > previousVisibleCount;
                }""",
                arg=previous_visible_count,
                timeout=15000
            )
        except Exception:
            await asyncio.sleep(config.WAIT_AFTER_CLICK)

        if stagnant_rounds >= 3:
            logging.warning(
                "Crédit Mutuel listing: arrêt après 3 tours sans progression"
                + (f" ({current_count}/{target_count})" if target_count else f" ({current_count})")
            )
            break

    return all_ids


async def collect_all_job_urls() -> List[str]:
    """Collecte toutes les URLs depuis le listing global CM."""
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=config.HEADLESS)
        page = await browser.new_page()
        all_ids = await _collect_urls_for_page(page, LISTING_URL)
        logging.info(f"listing global: {len(all_ids)} offres collectees")

        await browser.close()

    urls = [f"{BASE_URL}/fr/offre.html?annonce={aid}" for aid in all_ids]
    logging.info(f"Collecté {len(urls)} URLs d'offres (dédupliquées)")
    return urls


# =========================================================
# SCRAPE JOB DETAIL (requests + BeautifulSoup)
# =========================================================
def create_session() -> requests.Session:
    session = requests.Session()
    retry = Retry(total=3, backoff_factor=1, status_forcelist=[429, 500, 502, 503, 504])
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    })
    return session


def scrape_job_detail(url: str, session: requests.Session) -> Optional[Dict]:
    """Scrape le détail d'une offre (table avec Type contrat, Métier, Localisation, etc.)."""
    try:
        r = session.get(url, timeout=config.REQUEST_TIMEOUT)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")

        job = {
            "job_url": url,
            "job_id": "",
            "job_title": "",
            "contract_type": "",
            "publication_date": "",
            "location": "",
            "job_family": "",
            "duration": "",
            "management_position": "",
            "status": "Live",
            "education_level": "",
            "experience_level": "",
            "training_specialization": "",
            "technical_skills": [],
            "behavioral_skills": [],
            "tools": "",
            "languages": "",
            "job_description": "",
            "company_name": "Crédit Mutuel",
            "company_description": "",
        }

        # Filiale depuis .rhec_detailoffre .ei_subtitle (CIC, Cofidis, Euro Information, etc.)
        company_el = soup.select_one(".rhec_detailoffre .ei_subtitle")
        if company_el:
            raw_company = company_el.get_text(strip=True)
            if raw_company and "retour" not in raw_company.lower() and len(raw_company) > 3:
                job["company_name"] = normalize_company_name(raw_company)

        # job_id depuis URL
        m = re.search(r'annonce=(\d+)', url)
        if m:
            job["job_id"] = f"CM_{m.group(1)}"

        # Titre depuis h1
        h1 = soup.select_one("h1")
        if h1:
            job["job_title"] = h1.get_text(strip=True)

        # Tableau détail : label -> value (3 colonnes)
        for row in soup.select("table tr"):
            cells = row.find_all(["td", "th"])
            if len(cells) >= 3:
                label = (cells[0].get_text(strip=True) or "").lower()
                value = (cells[2].get_text(strip=True) or "").strip()
                if not value:
                    continue
                if "type de contrat" in label or "contrat" in label:
                    job["contract_type"] = normalize_contract(value) or value
                elif "métier" in label:
                    job["job_family"] = map_credit_mutuel_family(value)
                elif "localisation" in label:
                    job["location"] = normalize_location_cm(value)
                elif "niveau d'études" in label or "niveau d études" in label:
                    job["education_level"] = value
                elif "niveau d'expérience" in label or "niveau d expérience" in label:
                    job["experience_level"] = normalize_experience(value) or value
                elif "date de publication" in label:
                    # DD/MM/YYYY -> YYYY-MM-DD
                    dm = re.search(r'(\d{2})/(\d{2})/(\d{4})', value)
                    if dm:
                        job["publication_date"] = f"{dm.group(3)}-{dm.group(2)}-{dm.group(1)}"
                    else:
                        job["publication_date"] = value

        # Description : texte principal (éviter le bloc diversité en début)
        main_content = soup.select_one("main, .content, article, [role='main']") or soup
        desc_parts = []
        for p in main_content.find_all(["p", "div"], recursive=True):
            text = p.get_text(strip=True)
            if text and len(text) > 50 and "diversité" not in text.lower()[:100]:
                if "mission" in text.lower() or "vous " in text.lower() or "nous " in text.lower():
                    desc_parts.append(text)
        if desc_parts:
            job["job_description"] = "\n\n".join(desc_parts[:15])
        if not job["job_description"]:
            job["job_description"] = main_content.get_text(separator="\n", strip=True)[:15000]

        # Fallback job_family si vide
        if not job["job_family"]:
            job["job_family"] = classify_job_family(
                job.get("job_title", ""),
                job.get("job_description", "")
            )

        # Fallback experience_level si vide
        if not job["experience_level"]:
            job["experience_level"] = extract_experience_level(
                job.get("job_description", ""),
                job.get("contract_type"),
                job.get("job_title")
            )

        return job
    except Exception as e:
        logging.warning(f"Erreur scraping {url}: {e}")
        return None


def scrape_job_detail_with_retries(url: str, session: requests.Session, max_attempts: int = 3) -> Optional[Dict]:
    last_error = None
    for attempt in range(1, max_attempts + 1):
        job = scrape_job_detail(url, session)
        if job:
            return job
        last_error = f"tentative {attempt}/{max_attempts}"
    logging.warning(f"Échec définitif détail Crédit Mutuel {url} ({last_error})")
    return None


# =========================================================
# MAIN PIPELINE
# =========================================================
async def main_async():
    db = JobDatabase(config.DB_PATH)
    session = create_session()

    logging.info("=" * 60)
    logging.info("CRÉDIT MUTUEL - DÉBUT DU SCRAPING")
    logging.info("=" * 60)

    # 0. Marquer les pages d'erreur déjà en base comme invalides
    n_invalid = db.mark_error_pages_invalid()
    if n_invalid:
        logging.info(f"🧹 {n_invalid} offres (Erreur de navigation / Accusé de réception) marquées invalides")

    # 1. Collecter les URLs
    logging.info("Étape 1: Collecte des URLs...")
    urls = await collect_all_job_urls()
    if not urls:
        logging.error("Aucune URL collectée")
        return

    # 2. Déterminer les expirées
    existing_live = db.get_live_urls()
    current_set = set(urls)
    expired = existing_live - current_set
    if expired:
        db.mark_as_expired(expired)
        logging.info(f"Marquées expirées: {len(expired)}")

    # 3. Scraper les détails (parallèle avec requests)
    logging.info("Étape 2: Scraping des détails...")
    jobs = []
    failed_urls = []
    with ThreadPoolExecutor(max_workers=config.MAX_WORKERS) as executor:
        futures = {executor.submit(scrape_job_detail_with_retries, u, session): u for u in urls}
        for future in tqdm(as_completed(futures), total=len(futures), desc="Offres"):
            job = future.result()
            if job:
                jobs.append(job)
            else:
                failed_urls.append(futures[future])

    if failed_urls:
        logging.warning(f"Crédit Mutuel: {len(failed_urls)} détails ratés au premier passage, nouvelle tentative séquentielle")
        for url in failed_urls:
            job = scrape_job_detail_with_retries(url, session, max_attempts=2)
            if job:
                jobs.append(job)

    # 4. Sauvegarder
    for job in jobs:
        db.insert_or_update_job(job)

    logging.info(f"Terminé: {len(jobs)} offres traitées sur {len(urls)} URLs collectées")
    logging.info("=" * 60)


def main():
    asyncio.run(main_async())


if __name__ == "__main__":
    main()
