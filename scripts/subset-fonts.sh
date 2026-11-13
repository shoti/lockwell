#!/usr/bin/env bash
# Rebuilds the subset FiraGO fonts in src/public/fonts/.
# Only needed when changing fonts or character ranges — the results are committed,
# so the normal build never needs this script or its tools.
#
# Requires: python3 with fonttools and brotli (pip install fonttools brotli)
# Usage:    scripts/subset-fonts.sh <dir-with-FiraGO-Regular.ttf-and-FiraGO-SemiBold.ttf>
# Source:   https://github.com/bBoxType/FiraGO (Fonts/FiraGO_TTF_1001/Roman/)
set -euo pipefail

SRC_DIR="${1:?Pass the folder that holds FiraGO-Regular.ttf and FiraGO-SemiBold.ttf}"
OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/src/public/fonts"

# Latin-1, common punctuation, € ₾ ™ arrows − ✓, Georgian (Mkhedruli + Asomtavruli) and Mtavruli.
UNICODES="U+0000-00FF,U+0131,U+0152-0153,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+20BE,U+2122,U+2190-2193,U+2212,U+2713,U+10A0-10FF,U+1C90-1CBF"

for weight in Regular SemiBold; do
  lower="$(echo "$weight" | tr '[:upper:]' '[:lower:]')"
  pyftsubset "$SRC_DIR/FiraGO-$weight.ttf" \
    --unicodes="$UNICODES" \
    --layout-features='kern,liga,calt,tnum,case' \
    --flavor=woff2 \
    --output-file="$OUT_DIR/firago-$lower.woff2"
  echo "Wrote $OUT_DIR/firago-$lower.woff2"
done
