#!/usr/bin/env bash
# Dev-only A+ module design-preview renderer.
#
# Renders sample modules to PNG via the dev sample endpoint (no auth / no S3),
# so the design system can be iterated on visually.
#
# Usage:
#   tools/aplus-render.sh <module|all> [style] [viewport]
#
#   module   one of the gallery kinds, or "all"   (default: three-image-text)
#   style    editorial | modern | bold | minimal  (default: editorial)
#   viewport desktop | mobile                      (default: desktop)
#
# Env:
#   APLUS_RENDER_BASE  dev server origin (default https://local.sellavant.com:9443)
#   APLUS_RENDER_OUT   output dir        (default /tmp/aplus)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE="${APLUS_RENDER_BASE:-https://local.sellavant.com:9443}"
OUT="${APLUS_RENDER_OUT:-$SCRIPT_DIR/render-out}"
mkdir -p "$OUT"

MODULES=(company-logo image-text-overlay image-and-text three-image-text \
  four-image-text-quadrant comparison-table tech-specs text-only dual-use-split)

module="${1:-three-image-text}"
style="${2:-editorial}"
viewport="${3:-desktop}"

render() {
  local m="$1"
  local f="$OUT/${m}-${style}-${viewport}.png"
  local code
  code=$(curl -sk -o "$f" -w '%{http_code}' \
    "$BASE/api/a-plus/module-image?sample=1&module=${m}&style=${style}&viewport=${viewport}")
  if [ "$code" = "200" ]; then
    echo "$f"
  else
    echo "FAILED ($code): $m" >&2
  fi
}

if [ "$module" = "all" ]; then
  for m in "${MODULES[@]}"; do render "$m"; done
else
  render "$module"
fi
