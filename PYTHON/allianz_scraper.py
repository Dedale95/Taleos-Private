#!/usr/bin/env python3
"""
ALLIANZ Careers Scraper — careers.allianz.com
==============================================
Plateforme : PhenomPeople (tenant AISAIPGB)
API        : POST https://careers.allianz.com/widgets
Auth       : CSRF token extrait du cookie JWT PLAY_SESSION
Filtre     : aucun filtre pays (≈ 1 973 offres globales en mai 2026, 49 pays)
Pagination : l'offset est lu dans l'en-tête HTTP **Referer** (PAS dans le corps POST).
            → Avant chaque POST, on fixe :
              Referer: https://careers.allianz.com/global/en/search-results?from=<offset>&s=1
            Le champ `from` du corps POST est ignoré par le serveur.
            La taille de page (`size=100`) est respectée dans le POST.
Delta      : seules les nouvelles URLs passent par la page détail

Schema DB identique aux autres scrapers Taleos.
"""

import base64
import json
import logging
import re
import sqlite3
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Set

import requests

# ─────────────────────────── Imports partagés ───────────────────────────────
try:
    from job_family_classifier import classify_job_family
except ImportError:
    def classify_job_family(title: str, desc: str = "") -> Optional[str]:  # type: ignore
        return None

try:
    from experience_extractor import extract_experience_level
except ImportError:
    def extract_experience_level(title: str, desc: str = "", contract: str = "") -> Optional[str]:  # type: ignore
        return None

# ─────────────────────────── Logging ────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)

# ─────────────────────────── Constantes ─────────────────────────────────────
WIDGETS_URL   = "https://careers.allianz.com/widgets"
SEARCH_PAGE   = "https://careers.allianz.com/global/en/search-results"
SEARCH_PAGE_PAGED = "https://careers.allianz.com/global/en/search-results?from={from_offset}&s=1"
DETAIL_URL    = "https://careers.allianz.com/global/en/job/{req_id}"
COMPANY_NAME  = "Allianz"     # Fallback
SOURCE_NAME   = "Allianz"
REF_NUM       = "AISAIPGB"

PAGE_SIZE     = 100
REQUEST_DELAY = 1.0           # secondes entre pages listing
DETAIL_DELAY  = 0.8           # secondes entre pages détail
REQUEST_TIMEOUT = 40
MAX_RETRIES   = 3

HEADERS_BASE = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
    "Referer": SEARCH_PAGE,
    "Origin": "https://careers.allianz.com",
}

# ─────────────────────────── Config ─────────────────────────────────────────
class Config:
    DB_PATH = Path(__file__).parent / "allianz_jobs.db"


# ─────────────────────────── Normalisation contrat ──────────────────────────
_CONTRACT_MAP: Dict[str, str] = {
    "permanent":    "CDI",
    "temporary":    "CDD",
    "apprenticeship": "Alternance",
    "internship":   "Stage",
    "freelance":    "Indépendant / Entrepreneur",
    "vie":          "V.I.E.",
}

def normalize_contract(raw: str) -> str:
    key = (raw or "").strip().lower()
    # Correspondance exacte
    if key in _CONTRACT_MAP:
        return _CONTRACT_MAP[key]
    # Correspondance partielle
    for k, v in _CONTRACT_MAP.items():
        if k in key:
            return v
    return raw.strip() if raw else ""


# ─────────────────────────── Normalisation entité ───────────────────────────
_ENTITY_MAP: Dict[str, str] = {
    "allianz france":                           "Allianz France",
    "allianz global corporate & specialty":     "AGCS",
    "allianz global corporate and specialty":   "AGCS",
    "allianz trade":                            "Allianz Trade",
    "euler hermes":                             "Allianz Trade",
    "allianz partners":                         "Allianz Partners",
    "allianz investment management":            "Allianz Investment Management",
    "allianz real estate":                      "Allianz Real Estate",
    "allianz technology":                       "Allianz Technology",
    "allianz life luxembourg":                  "Allianz Life Luxembourg",
    "allianz benelux":                          "Allianz Benelux",
    "allianz se":                               "Allianz SE",
}

def normalize_allianz_entity(raw: str) -> str:
    """Normalise une unité/entité Allianz vers un nom canonique."""
    if not raw:
        return COMPANY_NAME
    n = raw.strip().lower()
    # Correspondance préfixe (ordre décroissant de spécificité)
    for key in sorted(_ENTITY_MAP, key=len, reverse=True):
        if key in n:
            return _ENTITY_MAP[key]
    # Fallback : retourner tel quel en title-case
    return raw.strip() or COMPANY_NAME


# ─────────────────────────── Normalisation expérience ───────────────────────
_JOB_LEVEL_MAP: Dict[str, str] = {
    "student":           "Étudiant / Stage",
    "apprenticeship":    "Alternant",
    "entry level":       "Junior (0-3 ans)",
    "professional":      "Confirmé (3-7 ans)",
    "management":        "Senior (7+ ans)",
    "executive":         "Senior (7+ ans)",
}

def normalize_job_level(raw: str) -> str:
    key = (raw or "").strip().lower()
    return _JOB_LEVEL_MAP.get(key, "")


# ─────────────────────────── Nettoyage HTML ─────────────────────────────────
_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE  = re.compile(r"\s+")

def strip_html(html: str) -> str:
    if not html:
        return ""
    text = _TAG_RE.sub(" ", html)
    return _WS_RE.sub(" ", text).strip()


# ─────────────────────────── Date ───────────────────────────────────────────
def parse_date(raw: str) -> str:
    if not raw:
        return datetime.now().strftime("%Y-%m-%d")
    try:
        normalized = raw.replace("+0000", "+00:00").replace("Z", "+00:00")
        return datetime.fromisoformat(normalized).strftime("%Y-%m-%d")
    except Exception:
        m = re.search(r"(\d{4}-\d{2}-\d{2})", raw)
        return m.group(1) if m else datetime.now().strftime("%Y-%m-%d")


# ─────────────────────────── Session + CSRF ─────────────────────────────────
def _extract_csrf_from_play_session(cookie_value: str) -> Optional[str]:
    """
    Le cookie PLAY_SESSION est un JWT custom Phenompeople :
    <hmac>.<base64url(json)>
    On décode la deuxième partie pour extraire csrfToken.
    """
    if not cookie_value:
        return None
    parts = cookie_value.split(".", 1)
    if len(parts) < 2:
        return None
    b64_part = parts[1]
    # Rembourrage base64
    b64_part += "=" * (-len(b64_part) % 4)
    try:
        decoded = base64.b64decode(b64_part).decode("utf-8", errors="replace")
        # Format : {"data":{"csrfToken":"XXXX",...},...}
        data = json.loads(decoded)
        csrf = (data.get("data") or {}).get("csrfToken") or data.get("csrfToken")
        if csrf:
            return str(csrf)
    except Exception:
        pass
    # Fallback regex
    m = re.search(r'"csrfToken"\s*:\s*"([^"]+)"', decoded if 'decoded' in dir() else "")
    return m.group(1) if m else None


def build_session() -> tuple[requests.Session, str]:
    """
    Crée une session requests, récupère les cookies et extrait le CSRF token.
    Retourne (session, csrf_token).
    """
    session = requests.Session()
    session.headers.update(HEADERS_BASE)

    for attempt in range(MAX_RETRIES):
        try:
            resp = session.get(SEARCH_PAGE, timeout=REQUEST_TIMEOUT)
            resp.raise_for_status()
            break
        except Exception as exc:
            logger.warning(f"  GET {SEARCH_PAGE} — tentative {attempt + 1}: {exc}")
            if attempt < MAX_RETRIES - 1:
                time.sleep(2 ** attempt)
    else:
        raise RuntimeError("Impossible d'obtenir la page de recherche Allianz")

    play_session = session.cookies.get("PLAY_SESSION") or ""
    csrf = _extract_csrf_from_play_session(play_session)
    if not csrf:
        # Parfois le token est dans un cookie dédié
        csrf = session.cookies.get("csrfToken") or session.cookies.get("csrf") or ""

    if not csrf:
        logger.warning("⚠️  CSRF token non trouvé — certaines requêtes peuvent échouer")

    if csrf:
        session.headers["X-CSRF-TOKEN"] = csrf

    logger.info(f"  🔑 Session Allianz établie (csrf={'présent' if csrf else 'absent'})")
    return session, csrf


# ─────────────────────────── Requêtes API ───────────────────────────────────
def _search_payload(from_offset: int, size: int = PAGE_SIZE) -> dict:
    return {
        "ddoKey": "eagerLoadRefineSearch",
        "from": from_offset,
        "size": size,
        "jobs": True,
        "counts": True,
        "all_fields": ["category", "country", "state", "city", "remote",
                       "employmentType", "jobLevel", "type", "unit"],
        "selected_fields": {},
        "keywords": "",
        "sortBy": "",
        "jdsource": "facets",
        "pageName": "search-results",
        "pageId": "page3",
        "siteType": "external",
        "lang": "en_global",
        "deviceType": "desktop",
        "country": "global",
        "refNum": REF_NUM,
        "s": "1",
        "global": True,
        "isSliderEnable": True,
        "locationData": {"sliderRadius": 50, "aboveMaxRadius": False, "LocationUnit": "miles"},
    }


def _detail_payload(job_seq_no: str) -> dict:
    return {
        "ddoKey": "jobDetail",
        "jobSeqNo": job_seq_no,
        "pageId": "page3",
        "siteType": "external",
        "lang": "en_global",
        "deviceType": "desktop",
        "country": "global",
        "refNum": REF_NUM,
    }


def _post(session: requests.Session, payload: dict) -> Optional[dict]:
    for attempt in range(MAX_RETRIES):
        try:
            resp = session.post(
                WIDGETS_URL,
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=REQUEST_TIMEOUT,
            )
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:
            logger.warning(f"  POST Allianz — tentative {attempt + 1}: {exc}")
            if attempt < MAX_RETRIES - 1:
                time.sleep(2 ** attempt)
    return None


# ─────────────────────────── Parsing listing ────────────────────────────────
def parse_job_listing(raw: dict) -> dict:
    """Transforme un objet job du listing en dict Taleos."""
    req_id     = str(raw.get("reqId") or "")
    seq_no     = str(raw.get("jobSeqNo") or "")
    job_id     = f"ALZ_{req_id}" if req_id else seq_no
    job_url    = DETAIL_URL.format(req_id=req_id) if req_id else ""

    # Localisation : city, state, country
    city       = (raw.get("city") or "").strip()
    state      = (raw.get("state") or "").strip()
    country    = (raw.get("country") or "France").strip()
    location_parts = [p for p in [city, state] if p]
    location   = ", ".join(location_parts) + (f" - {country}" if country else "")

    # Entité
    unit       = (raw.get("unit") or raw.get("employing_entity") or "").strip()
    company    = normalize_allianz_entity(unit)

    # Type de contrat
    contract   = normalize_contract(raw.get("employmentType") or "")

    # Niveau d'expérience depuis jobLevel
    exp_level  = normalize_job_level(raw.get("jobLevel") or "")

    # Famille de métier depuis category
    raw_cat    = (raw.get("category") or "").strip()

    # Date
    pub_date   = parse_date(raw.get("postedDate") or raw.get("dateCreated") or "")

    return {
        "job_url":          job_url,
        "job_id":           job_id,
        "_seq_no":          seq_no,       # clé interne pour la page détail
        "job_title":        (raw.get("title") or "").strip(),
        "contract_type":    contract,
        "publication_date": pub_date,
        "location":         location,
        "job_family":       raw_cat,      # sera raffiné par le classifieur NLP
        "company_name":     company,
        "experience_level": exp_level,
        "education_level":  "",
        "job_description":  (raw.get("descriptionTeaser") or "").strip(),
        "country":          country,
        "region":           state,
        "source":           SOURCE_NAME,
        "status":           "Live",
        "is_valid":         1,
    }


# ─────────────────────────── Scraping listing ───────────────────────────────
def fetch_all_listings(session: requests.Session) -> List[dict]:
    """Récupère toutes les offres globales depuis l'API listing.

    Mécanisme de pagination PhenomPeople (découverte mai 2026) :
    ─────────────────────────────────────────────────────────────
    Le paramètre `from` du corps POST est IGNORÉ par le serveur.
    L'offset réel est lu par le serveur dans l'en-tête **Referer** :
        Referer: https://careers.allianz.com/global/en/search-results?from=<offset>&s=1
    La taille de page (`size` dans le POST) est bien respectée (on utilise 100).
    """
    # Page 1 : Referer pointe sur from=0 (valeur initiale dans HEADERS_BASE)
    logger.info("  📋 Page 1 (offset 0)…")
    session.headers["Referer"] = SEARCH_PAGE_PAGED.format(from_offset=0)
    data = _post(session, _search_payload(0, PAGE_SIZE))
    if not data:
        logger.error("  ❌ Réponse vide sur la première page listing")
        return []

    root = data.get("eagerLoadRefineSearch", {})
    total = root.get("totalHits", 0)
    jobs_raw = (root.get("data") or {}).get("jobs") or []
    logger.info(f"  → {len(jobs_raw)} offres | total annoncé : {total}")

    results = [parse_job_listing(j) for j in jobs_raw]

    total_pages = max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE)
    consecutive_empty = 0
    MAX_CONSECUTIVE_EMPTY = 3

    for page_num in range(1, total_pages):
        from_offset = page_num * PAGE_SIZE
        # ← clé du fix : mettre à jour le Referer AVANT le POST
        session.headers["Referer"] = SEARCH_PAGE_PAGED.format(from_offset=from_offset)
        time.sleep(REQUEST_DELAY)
        logger.info(f"  📋 Page {page_num + 1}/{total_pages} (offset {from_offset})…")
        data = _post(session, _search_payload(from_offset, PAGE_SIZE))
        if not data:
            logger.warning(f"  ⚠️  Réponse vide offset={from_offset}, on continue")
            consecutive_empty += 1
            if consecutive_empty >= MAX_CONSECUTIVE_EMPTY:
                logger.warning(f"  ⚠️  {consecutive_empty} pages vides consécutives — arrêt pagination")
                break
            continue
        jobs_raw = (data.get("eagerLoadRefineSearch", {}).get("data") or {}).get("jobs") or []
        if not jobs_raw:
            top_keys = list(data.keys())
            logger.warning(f"  ⚠️  0 jobs offset={from_offset} — clés réponse : {top_keys}")
            consecutive_empty += 1
            if consecutive_empty >= MAX_CONSECUTIVE_EMPTY:
                logger.warning(f"  ⚠️  {consecutive_empty} pages vides consécutives — arrêt pagination")
                break
            continue
        consecutive_empty = 0
        results.extend(parse_job_listing(j) for j in jobs_raw)
        logger.info(f"  → {len(jobs_raw)} offres (cumul : {len(results)})")

    return results


# ─────────────────────────── Scraping détail ────────────────────────────────
def fetch_detail(session: requests.Session, job: dict) -> dict:
    """Enrichit un job avec la description complète depuis la page détail."""
    seq_no = job.get("_seq_no") or ""
    if not seq_no:
        return job

    data = _post(session, _detail_payload(seq_no))
    if not data:
        return job

    detail_root = data.get("jobDetail", {})
    job_data    = (detail_root.get("data") or {}).get("job") or {}

    # Description complète (HTML → texte)
    desc_html = job_data.get("description") or ""
    if desc_html:
        job["job_description"] = strip_html(desc_html)

    # Education (rarement fourni)
    edu = (job_data.get("educationLevel") or "").strip()
    if edu:
        job["education_level"] = edu

    return job


# ─────────────────────────── Base de données ────────────────────────────────
_CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS jobs (
    job_url           TEXT PRIMARY KEY,
    job_id            TEXT,
    job_title         TEXT,
    contract_type     TEXT,
    publication_date  TEXT,
    location          TEXT,
    job_family        TEXT,
    duration          TEXT,
    management_position INTEGER DEFAULT 0,
    status            TEXT DEFAULT 'Live',
    company_name      TEXT,
    job_description   TEXT,
    experience_level  TEXT,
    education_level   TEXT,
    company_description TEXT,
    training_specialization TEXT,
    technical_skills  TEXT,
    behavioral_skills TEXT,
    tools             TEXT,
    languages         TEXT,
    country           TEXT,
    region            TEXT,
    source            TEXT,
    first_seen        TEXT DEFAULT (CURRENT_TIMESTAMP),
    last_updated      TEXT DEFAULT (CURRENT_TIMESTAMP),
    is_valid          INTEGER DEFAULT 1
)
"""

_UPSERT = """
INSERT INTO jobs (
    job_url, job_id, job_title, contract_type, publication_date,
    location, job_family, company_name, job_description, experience_level,
    education_level, country, region, source, status, is_valid,
    first_seen, last_updated
) VALUES (
    :job_url, :job_id, :job_title, :contract_type, :publication_date,
    :location, :job_family, :company_name, :job_description, :experience_level,
    :education_level, :country, :region, :source, :status, :is_valid,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT(job_url) DO UPDATE SET
    job_title        = excluded.job_title,
    contract_type    = excluded.contract_type,
    location         = excluded.location,
    job_family       = excluded.job_family,
    company_name     = excluded.company_name,
    job_description  = CASE WHEN excluded.job_description != '' THEN excluded.job_description ELSE jobs.job_description END,
    experience_level = excluded.experience_level,
    education_level  = CASE WHEN excluded.education_level != '' THEN excluded.education_level ELSE jobs.education_level END,
    country          = excluded.country,
    region           = excluded.region,
    status           = excluded.status,
    last_updated     = CURRENT_TIMESTAMP,
    is_valid         = excluded.is_valid
"""


class Database:
    def __init__(self, db_path: Path):
        self.db_path = db_path
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(_CREATE_TABLE)
            conn.commit()

    def get_all_urls(self) -> Set[str]:
        with sqlite3.connect(self.db_path) as conn:
            rows = conn.execute("SELECT job_url FROM jobs").fetchall()
        return {r[0] for r in rows}

    def get_live_urls(self) -> Set[str]:
        with sqlite3.connect(self.db_path) as conn:
            rows = conn.execute(
                "SELECT job_url FROM jobs WHERE status='Live'"
            ).fetchall()
        return {r[0] for r in rows}

    def expire_missing(self, current_urls: Set[str]):
        live = self.get_live_urls()
        to_expire = live - current_urls
        if not to_expire:
            return
        placeholders = ",".join("?" * len(to_expire))
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                f"UPDATE jobs SET status='Expired', last_updated=CURRENT_TIMESTAMP "
                f"WHERE job_url IN ({placeholders})",
                list(to_expire),
            )
            conn.commit()
        logger.info(f"  ⚰️  {len(to_expire)} offre(s) expirée(s)")

    def upsert_batch(self, jobs: List[dict]):
        """Upsert toutes les offres en une seule transaction (plus fiable et rapide)."""
        valid = [j for j in jobs if j.get("job_url")]
        if not valid:
            return
        params_list = [
            {
                "job_url":          j["job_url"],
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
                "country":          j.get("country", ""),
                "region":           j.get("region", ""),
                "source":           SOURCE_NAME,
                "status":           j.get("status", "Live"),
                "is_valid":         int(j.get("is_valid", 1)),
            }
            for j in valid
        ]
        with sqlite3.connect(self.db_path) as conn:
            conn.executemany(_UPSERT, params_list)
            conn.commit()
        logger.info(f"  💾 {len(params_list)} offres upsertées en batch")

    def count_live(self) -> int:
        with sqlite3.connect(self.db_path) as conn:
            return conn.execute(
                "SELECT COUNT(*) FROM jobs WHERE status='Live' AND is_valid=1"
            ).fetchone()[0]


# ─────────────────────────── Enrichissement NLP ─────────────────────────────
def enrich_nlp(job: dict) -> dict:
    """Applique le classifieur NLP sur titre + description."""
    title = job.get("job_title", "")
    desc  = job.get("job_description", "")
    contract = job.get("contract_type", "")

    if not job.get("job_family"):
        fam = classify_job_family(title, desc)
        if fam:
            job["job_family"] = fam

    if not job.get("experience_level"):
        exp = extract_experience_level(title, desc, contract)
        if exp:
            job["experience_level"] = exp

    return job


# ─────────────────────────── Main ───────────────────────────────────────────
def main():
    logger.info("🏢 Démarrage scraper Allianz Careers")
    db      = Database(Config.DB_PATH)
    session, _ = build_session()

    # 1. Listing complet (global)
    all_jobs_raw = fetch_all_listings(session)
    if not all_jobs_raw:
        logger.error("  ❌ Aucune offre récupérée — arrêt")
        return

    # Dédupliquer par job_url (la pagination PhenomPeople peut retourner des doublons)
    seen: Dict[str, dict] = {}
    for j in all_jobs_raw:
        url = j.get("job_url")
        if url and url not in seen:
            seen[url] = j
    all_jobs = list(seen.values())
    logger.info(f"  ✅ {len(all_jobs)} offres uniques live sur le site ({len(all_jobs_raw)} brutes)")

    current_urls = set(seen.keys())

    # 2. Marquer expirées
    db.expire_missing(current_urls)

    # 3. Delta : nouvelles URLs seulement → page détail
    existing_urls = db.get_all_urls()
    new_jobs  = [j for j in all_jobs if j["job_url"] not in existing_urls]
    old_jobs  = [j for j in all_jobs if j["job_url"] in existing_urls]

    logger.info(f"  🔍 {len(new_jobs)} nouvelles offres à enrichir / {len(old_jobs)} déjà en base")

    enriched: List[dict] = list(old_jobs)  # anciens : mise à jour via listing seulement
    for idx, job in enumerate(new_jobs, 1):
        if idx % 100 == 0 or idx == 1:
            logger.info(f"  [{idx}/{len(new_jobs)}] Détail en cours…")
        enriched_job = fetch_detail(session, dict(job))
        enriched.append(enrich_nlp(enriched_job))
        time.sleep(DETAIL_DELAY)

    # NLP sur les anciens aussi
    for job in old_jobs:
        enrich_nlp(job)

    # 4. Upsert en batch (une seule transaction SQLite)
    logger.info(f"  💾 Upsert batch de {len(enriched)} offres…")
    db.upsert_batch(enriched)

    logger.info(f"  ✅ {db.count_live()} offres live en base")
    logger.info("✅ Scraping Allianz terminé")


if __name__ == "__main__":
    main()
