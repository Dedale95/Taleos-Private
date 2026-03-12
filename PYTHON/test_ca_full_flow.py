#!/usr/bin/env python3
"""
Test du flux COMPLET Crédit Agricole - comme l'extension
1. Page offre -> Cookies -> Je postule -> Connexion -> Login -> Vérifier redirection
"""
import time
import sys
from pathlib import Path

try:
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.common.exceptions import TimeoutException, NoSuchElementException
    try:
        from webdriver_manager.chrome import ChromeDriverManager
        from selenium.webdriver.chrome.service import Service
    except ImportError:
        ChromeDriverManager = None
        Service = None
except ImportError:
    print("pip install selenium webdriver-manager")
    sys.exit(1)

OFFER_URL = "https://groupecreditagricole.jobs/fr/nos-offres-emploi/577-170470-127-cdi---analyste-risque-credit-senior-hf-reference--2025-101695--/"
EMAIL = "thibault.parisien@laposte.net"
PASSWORD = "292df9cd52-AAA"

def main():
    opts = Options()
    opts.add_argument("--start-maximized")
    opts.add_argument("--disable-blink-features=AutomationControlled")
    opts.add_argument("--no-sandbox")
    
    if ChromeDriverManager and Service:
        driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=opts)
    else:
        driver = webdriver.Chrome(options=opts)
    
    wait = WebDriverWait(driver, 20)
    try:
        print("1. Navigation vers l'offre...")
        driver.get(OFFER_URL)
        time.sleep(3)
        
        print("2. Fermeture bandeau cookies...")
        try:
            cookie_btn = WebDriverWait(driver, 3).until(
                EC.element_to_be_clickable((By.CSS_SELECTOR, "button.rgpd-btn-refuse, button.rgpd-btn-accept"))
            )
            driver.execute_script("arguments[0].click();", cookie_btn)
            time.sleep(1)
        except TimeoutException:
            print("   Pas de bandeau cookies")
        
        print("3. Clic 'Je postule'...")
        postule_selectors = [
            "button.cta.primary[data-popin='popin-application']",
            "button[data-popin='popin-application']",
            "//button[contains(., 'Je postule') and not(contains(., 'Comment'))]",
            "//a[contains(., 'Je postule') and not(contains(., 'Comment'))]",
        ]
        clicked = False
        for sel in postule_selectors:
            try:
                if sel.startswith("//"):
                    el = driver.find_element(By.XPATH, sel)
                else:
                    el = driver.find_element(By.CSS_SELECTOR, sel)
                if el and el.is_displayed():
                    driver.execute_script("arguments[0].scrollIntoView({block:'center'});", el)
                    time.sleep(0.5)
                    driver.execute_script("arguments[0].click();", el)
                    clicked = True
                    print(f"   Clic via: {sel[:50]}...")
                    break
            except NoSuchElementException:
                continue
        if not clicked:
            print("   ERREUR: Bouton Je postule non trouvé")
            driver.save_screenshot("/tmp/ca_step3.png")
            return
        
        time.sleep(2)
        
        print("4. Clic lien Connexion (DANS la popin)...")
        try:
            popin = driver.find_element(By.ID, "popin-application")
            login_link = popin.find_element(By.CSS_SELECTOR, "a.cta.secondary.arrow[href*='connexion'], a[href*='connexion']")
            driver.execute_script("arguments[0].click();", login_link)
            time.sleep(3)
        except NoSuchElementException:
            print("   Lien connexion non trouvé dans popin - essai global")
            try:
                login_link = driver.find_element(By.CSS_SELECTOR, "#popin-application a[href*='connexion']")
                driver.execute_script("arguments[0].click();", login_link)
                time.sleep(3)
            except NoSuchElementException:
                print("   Échec")
                print("   URL actuelle:", driver.current_url)
        
        if "connexion" in driver.current_url.lower():
            print("5. Remplissage formulaire connexion...")
            email_el = wait.until(EC.presence_of_element_located((By.ID, "form-login-email")))
            pass_el = driver.find_element(By.ID, "form-login-password")
            email_el.clear()
            email_el.send_keys(EMAIL)
            time.sleep(0.3)
            pass_el.clear()
            pass_el.send_keys(PASSWORD)
            time.sleep(0.5)
            
            submit_el = driver.find_element(By.ID, "form-login-submit")
            driver.execute_script("arguments[0].click();", submit_el)
            print("   Formulaire soumis, attente 10s...")
            for i in range(10):
                time.sleep(1)
                url = driver.current_url
                if "connexion" not in url.lower() and "login" not in url.lower():
                    print(f"   Redirection détectée après {i+1}s")
                    break
        
        print("6. URL finale:", driver.current_url)
        if "connexion" in driver.current_url.lower():
            print("   ÉCHEC: Resté sur page connexion")
            errs = driver.find_elements(By.CSS_SELECTOR, ".error, .alert, [role=alert], [class*='error'], [class*='alert']")
            for e in errs:
                try:
                    if e.is_displayed() and e.text.strip():
                        print("   Message erreur:", e.text[:150])
                except: pass
            try:
                driver.save_screenshot(Path(__file__).parent / "ca_login_fail.png")
                print("   Screenshot: ca_login_fail.png")
            except: pass
        elif "candidature" in driver.current_url.lower() or "nos-offres-emploi" in driver.current_url.lower():
            print("   SUCCÈS: Redirection OK")
        
    finally:
        time.sleep(2)
        driver.quit()

if __name__ == "__main__":
    main()
