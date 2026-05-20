#!/usr/bin/env bash
# Fetch self-hosted variable fonts. Idempotent.
# - Inter Variable from rsms/inter (MIT/SIL OFL)
# - JetBrains Mono from JetBrains/JetBrainsMono (Apache 2.0)
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$PROJECT_DIR/public/fonts"
mkdir -p "$DEST"

# Inter
if [[ ! -s "$DEST/InterVariable.woff2" ]]; then
  echo "fetching InterVariable"
  curl -fsSL -o "$DEST/InterVariable.woff2" \
    "https://rsms.me/inter/font-files/InterVariable.woff2"
fi
if [[ ! -s "$DEST/InterVariable-Italic.woff2" ]]; then
  echo "fetching InterVariable Italic"
  curl -fsSL -o "$DEST/InterVariable-Italic.woff2" \
    "https://rsms.me/inter/font-files/InterVariable-Italic.woff2"
fi

# JetBrains Mono Variable
if [[ ! -s "$DEST/JetBrainsMono-Variable.woff2" ]]; then
  echo "fetching JetBrainsMono Variable"
  curl -fsSL -o "$DEST/JetBrainsMono-Variable.woff2" \
    "https://github.com/JetBrains/JetBrainsMono/raw/master/fonts/variable/JetBrainsMono%5Bwght%5D.ttf"
  # The Apache-licensed variable file ships as TTF; serve as woff2 only if we convert.
  # For now keep as TTF rename — modern browsers accept it; we accept the size hit
  # at this stage and revisit with subsetting later.
  # rename:
  mv "$DEST/JetBrainsMono-Variable.woff2" "$DEST/JetBrainsMono-Variable.ttf"
fi

ls -lh "$DEST/"
