#!/usr/bin/env python3
"""
Session BPCE / Natixis persistante pour OTP Oracle.

But:
- ouvrir une seule fois la page Oracle email
- déclencher l'envoi du code
- attendre un code OTP sur stdin
- saisir ce code sur la même page, sans recréer de session

Usage:
  python PYTHON/test_bpce_live_otp_flow.py \
    --offer-url "https://recrutement.bpce.fr/job/liquidity-steering-analyst-alm" \
    --email "thibault.giraudet@outlook.com"

Puis coller le code OTP quand le script affiche `READY_FOR_OTP`.
"""

import argparse
import asyncio
import json
import sys
from typing import Optional

from playwright.async_api import TimeoutError as PlaywrightTimeoutError
from playwright.async_api import async_playwright


def body_snippet(text: str, limit: int = 1500) -> str:
    return " ".join((text or "").split())[:limit]


async def dump_state(page, label: str):
    try:
        body = await page.locator("body").inner_text()
    except Exception as exc:
        body = f"<body unavailable: {exc}>"
    try:
        headings = await page.locator("h1,h2,h3").all_inner_texts()
    except Exception:
        headings = []
    try:
        buttons = await page.locator("button").evaluate_all(
            "(els) => els.map(e => e.innerText).filter(Boolean).slice(0, 40)"
        )
    except Exception:
        buttons = []

    payload = {
        "label": label,
        "url": page.url,
        "title": await page.title(),
        "body": body_snippet(body),
        "headings": headings,
        "buttons": buttons,
    }
    print(json.dumps(payload, ensure_ascii=False), flush=True)


async def fill_email_step(page, email: str):
    await page.locator("#primary-email-0").wait_for(state="visible", timeout=30000)
    await page.locator("#primary-email-0").fill(email)

    checkbox = page.locator(".apply-flow-input-checkbox__button").first
    if await checkbox.count():
        cls = await checkbox.get_attribute("class") or ""
        if "checked" not in cls:
            await checkbox.click()

    next_btn = page.get_by_role("button", name="Suivant")
    if not await next_btn.count():
        next_btn = page.locator('button[title="Suivant"]').first
    await next_btn.click()


async def wait_for_pin_or_lock(page) -> str:
    try:
        await page.locator("#pin-code-1").wait_for(state="visible", timeout=15000)
        return "pin"
    except PlaywrightTimeoutError:
        body = body_snippet(await page.locator("body").inner_text(), 2500).lower()
        if "trop de tentatives" in body or "nombre maximum de tentatives" in body:
            return "throttle"
        if "le code n'est pas valide" in body or "entrez un code valide" in body:
            return "invalid_pin"
        return "unknown"


async def submit_otp_on_same_page(page, otp: str) -> str:
    otp = "".join(ch for ch in str(otp).strip() if ch.isdigit())
    if len(otp) != 6:
        raise ValueError("Le code OTP doit contenir exactement 6 chiffres.")

    for idx, digit in enumerate(otp, start=1):
        field = page.locator(f"#pin-code-{idx}")
        await field.wait_for(state="visible", timeout=10000)
        await field.fill(digit)

    verify_btn = page.get_by_role("button", name="Vérifier")
    if not await verify_btn.count():
        verify_btn = page.locator('button:has-text("VÉRIFIER"), button[title="Vérifier"]').first
    await verify_btn.click()
    await page.wait_for_timeout(6000)

    body = body_snippet(await page.locator("body").inner_text(), 3000).lower()
    if "trop de tentatives" in body or "nombre maximum de tentatives" in body:
        return "throttle"
    if "le code n'est pas valide" in body or "entrez un code valide" in body:
        return "invalid_pin"
    if "merci d avoir postule" in body or "candidature envoyee" in body or "thank you for applying" in body:
        return "success"
    if "#pin-code-1" in await page.content():
        return "pin_still_visible"
    return "advanced"


async def run_session(offer_url: str, email: str, headless: bool):
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=headless)
        page = await browser.new_page(viewport={"width": 1440, "height": 1800})
        page.set_default_timeout(30000)

        print(f"OPEN_OFFER {offer_url}", flush=True)
        await page.goto(offer_url, wait_until="domcontentloaded")
        await page.wait_for_timeout(1500)
        apply_link = page.locator('a[href*="oraclecloud.com"][href*="/apply/"]').first
        href = await apply_link.get_attribute("href")
        if not href:
            raise RuntimeError("Lien Oracle de candidature introuvable sur la page offre.")

        print(f"OPEN_ORACLE {href}", flush=True)
        await page.goto(href, wait_until="domcontentloaded")
        await page.wait_for_timeout(1500)
        await dump_state(page, "oracle_email_start")

        await fill_email_step(page, email)
        await page.wait_for_timeout(3000)
        state = await wait_for_pin_or_lock(page)
        await dump_state(page, f"post_email_{state}")

        if state != "pin":
            await browser.close()
            return state

        print("READY_FOR_OTP", flush=True)
        otp = sys.stdin.readline().strip()
        if not otp:
            await browser.close()
            return "no_otp"

        result = await submit_otp_on_same_page(page, otp)
        await dump_state(page, f"post_otp_{result}")
        await browser.close()
        return result


def parse_args():
    parser = argparse.ArgumentParser(description="Session persistante OTP BPCE / Natixis")
    parser.add_argument("--offer-url", required=True, help="URL publique de l'offre BPCE / Natixis")
    parser.add_argument("--email", required=True, help="Email à utiliser sur la page Oracle")
    parser.add_argument(
        "--headed",
        action="store_true",
        help="Lance Chromium avec interface visible au lieu du mode headless",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    result = asyncio.run(run_session(args.offer_url, args.email, headless=not args.headed))
    print(f"FINAL_STATE {result}", flush=True)


if __name__ == "__main__":
    main()
