"""
Mapping des familles de métier ODDO BHF (Domaine d'activité) → catégories Taleos existantes.
Harmonise avec job_family_classifier et offres.html familySynonyms.
"""

# ODDO BHF (Altays) → Taleos (job_family_classifier / offres.html)
ODDO_BHF_TO_TALEOS = {
    # Correspondances directes
    "asset management": "Financement et Investissement",
    "audit": "Inspection / Audit",
    "communication/marketing": "Marketing et Communication",
    "compliance": "Conformité / Sécurité financière",
    "corporate banking": "Financement et Investissement",
    "corporate finance": "Financement et Investissement",
    "corporate services": "Autres",
    "credit risk management": "Risques / Contrôles permanents",
    "equities and fixed income": "Financement et Investissement",
    "facilities management": "Organisation / Qualité",
    "finance": "Finances / Comptabilité / Contrôle de gestion",
    "foreign exchange & funds": "Financement et Investissement",
    "human resources": "Ressources Humaines",
    "independent financial advisors": "Commercial / Relations Clients",
    "innovation": "IT, Digital et Data",
    "international banking": "Financement et Investissement",
    "it": "IT, Digital et Data",
    "legal": "Juridique",
    "metals trading": "Financement et Investissement",
    "operations/account safekeeping and custodial services": "Gestion des opérations",
    "others": "Autres",
    "private equity": "Financement et Investissement",
    "private wealth management": "Commercial / Relations Clients",
    "risques": "Risques / Contrôles permanents",
    "transformation": "Organisation / Qualité",
}


def map_oddo_bhf_family(raw: str) -> str:
    """
    Mappe une famille de métier ODDO BHF vers une catégorie Taleos.

    Args:
        raw: Domaine d'activité brut du site ODDO (ex: "Private Wealth Management")

    Returns:
        Famille harmonisée Taleos ou valeur d'origine si non mappée
    """
    if not raw or not str(raw).strip():
        return "Autres"
    key = str(raw).strip().lower()
    return ODDO_BHF_TO_TALEOS.get(key, raw.strip())
