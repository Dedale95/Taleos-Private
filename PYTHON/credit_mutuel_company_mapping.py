"""
Mapping des noms d'entreprises/filiales Crédit Mutuel (site) → nom d'affichage Taleos.
"""

# Raw (site) → Display (Taleos)
COMPANY_DISPLAY_MAPPING = {
    "caisse federale de credit mutuel": "Caisse Fédérale du Crédit Mutuel",
    "caisse fédérale de crédit mutuel": "Caisse Fédérale du Crédit Mutuel",
    "cofidis": "Cofidis",
    "euro-information": "Euro Information",
    "euro-information developpements": "Euro Information",
    "euro information": "Euro Information",
    "cic": "CIC",
    "credit industriel et commercial": "CIC",
    "becm": "BECM",
    "banque federative du credit mutuel": "BFCM",
    "credit mutuel alliance federale": "Crédit Mutuel Alliance Fédérale",
    "credit mutuel arkéa": "Crédit Mutuel Arkéa",
    "monext": "Monext",
    "assurances du credit mutuel": "ACM",
    "acm": "ACM",
    "lyonnaise de banque": "Lyonnaise de Banque",
    "credit mutuel factoring": "Crédit Mutuel Factoring",
    "credit mutuel leasing": "Crédit Mutuel Leasing",
    "credit mutuel gestion": "Crédit Mutuel Gestion",
    "credit mutuel asset management": "Crédit Mutuel Asset Management",
    "banque europeenne du credit mutuel": "BECM",
    "centre de conseil et de service": "CCS",
    "synergie": "Synergie",
}

def normalize_company_name(raw: str) -> str:
    """
    Normalise le nom d'entreprise pour affichage.
    Ex: "EURO-INFORMATION DEVELOPPEMENTS" → "Euro Information"
    """
    if not raw or not str(raw).strip():
        return "Crédit Mutuel"
    key = str(raw).strip().lower()
    key_clean = key.replace("-", " ").replace("  ", " ")
    if key_clean in COMPANY_DISPLAY_MAPPING:
        return COMPANY_DISPLAY_MAPPING[key_clean]
    for k, display in COMPANY_DISPLAY_MAPPING.items():
        if k in key_clean or key_clean in k:
            return display
    # Fédérations: "FEDERATION DU CREDIT MUTUEL MAINE ANJOU BASSE NORMANDIE" → "Crédit Mutuel Maine Anjou Basse Normandie"
    if "federation" in key_clean and "credit mutuel" in key_clean:
        parts = key_clean.replace("federation du credit mutuel", "").replace("fédération du crédit mutuel", "").strip()
        if parts:
            return f"Crédit Mutuel {parts.title()}"
    # CIC variations
    if "credit industriel" in key_clean and "commercial" in key_clean:
        return "CIC"
    # Caisses régionales: extraire la région après "credit mutuel"
    if "caisse regionale" in key_clean or "caisse de credit mutuel" in key_clean:
        for sep in [" credit mutuel ", " du credit mutuel ", " de credit mutuel "]:
            if sep in key_clean:
                parts = key_clean.split(sep, 1)
                if len(parts) >= 2:
                    region = parts[1].replace("cmlaco", "").strip(" -")
                    if region and len(region) > 2:
                        return f"Crédit Mutuel {region.title()}"
    return raw.strip()
