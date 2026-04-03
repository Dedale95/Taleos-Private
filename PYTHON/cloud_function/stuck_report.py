"""
Cloud Function HTTP : envoi par e-mail des rapports « candidature bloquée » (capture + métadonnées).
Déployer avec --entry-point=report_stuck_main

Variables d'environnement (optionnelles, sinon 200 sans envoi mail) :
  SMTP_HOST, SMTP_PORT (défaut 587), SMTP_USER, SMTP_PASSWORD, SMTP_FROM
Destinataire fixe : contact@taleos.co
"""

import base64
import json
import os
import smtplib
from email.mime.image import MIMEImage
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText


def _cors_headers():
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "3600",
    }


def _send_email_smtp(subject, body_text, jpeg_bytes=None):
    host = os.environ.get("SMTP_HOST", "").strip()
    user = os.environ.get("SMTP_USER", "").strip()
    password = os.environ.get("SMTP_PASSWORD", "").strip()
    from_addr = os.environ.get("SMTP_FROM", user).strip() or user
    port = int(os.environ.get("SMTP_PORT", "587"))

    if not host or not user or not password:
        return False, "SMTP non configuré (SMTP_HOST / SMTP_USER / SMTP_PASSWORD)"

    msg = MIMEMultipart()
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = "contact@taleos.co"
    msg.attach(MIMEText(body_text, "plain", "utf-8"))

    if jpeg_bytes:
        img = MIMEImage(jpeg_bytes, _subtype="jpeg")
        img.add_header("Content-Disposition", "attachment", filename="candidature-bloquee.jpg")
        msg.attach(img)

    try:
        with smtplib.SMTP(host, port, timeout=30) as server:
            server.starttls()
            server.login(user, password)
            server.sendmail(from_addr, ["contact@taleos.co"], msg.as_string())
    except Exception as e:
        return False, str(e)

    return True, "ok"


def report_stuck_main(request):
    """Point d'entrée Cloud Functions (Gen2 / Flask request)."""
    headers_json = {"Content-Type": "application/json; charset=utf-8", **_cors_headers()}

    if request.method == "OPTIONS":
        return ("", 204, headers_json)

    if request.method != "POST":
        return (json.dumps({"success": False, "message": "POST only"}), 405, headers_json)

    try:
        if hasattr(request, "get_json"):
            data = request.get_json(silent=True) or {}
        else:
            raw = getattr(request, "data", None) or b"{}"
            data = json.loads(raw.decode("utf-8") if isinstance(raw, bytes) else raw)
    except Exception as e:
        return (json.dumps({"success": False, "message": str(e)}), 400, headers_json)

    user_id = (data.get("userId") or data.get("user_id") or "").strip()
    job_id = (data.get("jobId") or data.get("job_id") or "").strip()
    offer_url = (data.get("offerUrl") or data.get("offer_url") or "").strip()
    page_url = (data.get("pageUrl") or data.get("page_url") or "").strip()
    bank_id = (data.get("bankId") or data.get("bank_id") or "").strip()
    b64 = data.get("screenshotBase64") or data.get("screenshot_base64") or ""

    if not user_id and not job_id:
        return (json.dumps({"success": False, "message": "userId ou jobId requis"}), 400, headers_json)

    body = f"""[Taleos] Rapport automatique : candidature non terminée après 2 minutes

Utilisateur (Firebase UID) : {user_id or '—'}
ID offre : {job_id or '—'}
Banque / flux : {bank_id or '—'}
URL page (onglet) : {page_url or '—'}
URL offre Taleos : {offer_url or '—'}

---
Message généré par l'extension Taleos (watchdog 2 min).
"""

    subject = f"[Taleos] Candidature bloquée — {job_id or 'offre inconnue'}"

    jpeg_bytes = None
    if b64:
        try:
            if "," in b64:
                b64 = b64.split(",", 1)[1]
            jpeg_bytes = base64.b64decode(b64)
            if len(jpeg_bytes) > 6 * 1024 * 1024:
                jpeg_bytes = None
        except Exception:
            jpeg_bytes = None

    ok, detail = _send_email_smtp(subject, body, jpeg_bytes=jpeg_bytes)

    return (
        json.dumps({"success": ok, "message": detail}, ensure_ascii=False),
        200 if ok or "non configuré" in detail else 500,
        headers_json,
    )
