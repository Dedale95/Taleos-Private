#!/usr/bin/env python3
"""
Marque l'email d'un utilisateur Firebase comme vérifié (emailVerified: true).
À exécuter une seule fois en local avec une clé de compte de service Firebase.

Usage:
  1. Téléchargez une clé de compte de service :
     Firebase Console → Project settings → Service accounts → Generate new private key
  2. Sauvegardez le JSON (ex. serviceAccountKey.json) et ajoutez-le au .gitignore
  3. Définissez la variable d'environnement :
     export GOOGLE_APPLICATION_CREDENTIALS="/chemin/vers/serviceAccountKey.json"
  4. Installez la dépendance : pip install firebase-admin
  5. Exécutez : python firebase_verify_user_email.py
"""

import os
import sys

# Utilisateur à valider (email marqué comme vérifié)
UID = "SzDQh1whC4UZae5D3tXBAdrkFrQ2"
EMAIL = "test@taleos.com"


def main():
    cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if not cred_path or not os.path.isfile(cred_path):
        print(
            "Erreur : définissez GOOGLE_APPLICATION_CREDENTIALS vers le fichier JSON\n"
            "de votre clé de compte de service Firebase.\n"
            "Firebase Console → Project settings → Service accounts → Generate new private key"
        )
        sys.exit(1)

    try:
        import firebase_admin
        from firebase_admin import credentials, auth
    except ImportError:
        print("Erreur : installez firebase-admin : pip install firebase-admin")
        sys.exit(1)

    if not firebase_admin._apps:
        cred = credentials.Certificate(cred_path)
        firebase_admin.initialize_app(cred)

    try:
        auth.update_user(UID, email_verified=True)
        print(f"OK : L'email de {EMAIL} (UID: {UID}) est maintenant marqué comme vérifié.")
        print("L'utilisateur peut se connecter sur le site.")
    except auth.UserNotFoundError:
        print(f"Erreur : utilisateur avec UID {UID} introuvable.")
        sys.exit(1)
    except Exception as e:
        print(f"Erreur : {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
