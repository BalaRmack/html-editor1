#!/bin/bash
# PineconeMC 1.1.1 — Linux / Mac Uninstaller

echo "╔════════════════════════════════════════════════════════════╗"
echo "║  P I N E C O N E  M C  1.1.1  —  UNINSTALLER              ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

rm -rf "$HOME/.local/share/pineconemc"
rm -f "$HOME/.local/share/applications/pineconemc.desktop"

echo "[OK] Файлы удалены"
echo "[OK] Ярлык удалён"
echo "[OK] Удаление завершено!"
