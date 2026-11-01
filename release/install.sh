#!/bin/bash
# PineconeMC 1.1.1 — Linux / Mac Installer

echo "╔════════════════════════════════════════════════════════════╗"
echo "║  P I N E C O N E  M C  1.1.1  —  INSTALLER                  ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

DEST="$HOME/.local/share/pineconemc"
mkdir -p "$DEST"
cp PineconeMC_Launcher.exe index.html launcher_config.json "$DEST/" 2>/dev/null || true

echo "[OK] Файлы скопированы в $DEST"
echo "[OK] Ярлык создан: $HOME/.local/share/applications/pineconemc.desktop"
cat > "$HOME/.local/share/applications/pineconemc.desktop" <<EOF
[Desktop Entry]
Name=PineconeMC
Exec=$DEST/PineconeMC_Launcher.exe launch
Icon=$DEST/index.html
Type=Application
Terminal=false
EOF
chmod +x "$HOME/.local/share/applications/pineconemc.desktop"
echo "[OK] Установка завершена!"
