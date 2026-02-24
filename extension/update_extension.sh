#!/bin/bash
# Mise à jour de l'extension Taleos
# Exécute: git pull puis rappelle de cliquer "Mettre à jour" dans la popup

cd "$(dirname "$0")/.."
echo "📥 Récupération des dernières modifications..."
git pull origin main
echo ""
echo "✅ Code à jour."
echo "👉 Ouvrez la popup Taleos et cliquez sur « Mettre à jour l'extension » pour recharger."
echo ""
