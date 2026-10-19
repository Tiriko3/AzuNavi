#!/usr/bin/env bash
# Baut AzuNavi lokal unter Linux (.deb und .AppImage). Aufruf: ./build-linux.sh
set -euo pipefail
cd "$(dirname "$0")"
VERSION=$(node -p "require('./package.json').version")
echo "== AzuNavi $VERSION für Linux bauen =="

# Systempakete (Debian/Ubuntu/Mint). Auf Fedora: webkit2gtk4.1-devel gtk3-devel openssl-devel librsvg2-devel libxdo-devel
if command -v apt-get >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf
fi

command -v cargo >/dev/null 2>&1 || { echo "Rust fehlt. Installieren: https://rustup.rs"; exit 1; }
command -v node  >/dev/null 2>&1 || { echo "Node.js fehlt (Version 20 oder neuer)."; exit 1; }

npm ci
npm run tauri build

OUT="$HOME/AzuNavi-$VERSION"
mkdir -p "$OUT"
cp -v src-tauri/target/release/bundle/deb/*.deb "$OUT"/ 2>/dev/null || true
cp -v src-tauri/target/release/bundle/appimage/*.AppImage "$OUT"/ 2>/dev/null || true
echo "Fertig. Dateien liegen in $OUT"
