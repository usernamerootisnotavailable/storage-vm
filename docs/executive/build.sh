#!/usr/bin/env bash
# Regenerate the executive diagrams and deck.
#
# Dependencies:
#   - D2 0.9.0 (set D2_BIN if it is not on PATH)
#   - Node.js and npm
#   - LibreOffice for the PDF companion (optional)
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exports="${root}/exports"
deck="${root}/deck"
d2_bin="${D2_BIN:-d2}"

if ! command -v "${d2_bin}" >/dev/null 2>&1; then
  echo "D2 not found. Install D2 0.9.0 or set D2_BIN." >&2
  exit 1
fi

d2_version="$("${d2_bin}" --version | sed 's/^v//')"
if [[ "${d2_version}" != "0.9.0" ]]; then
  echo "Expected D2 0.9.0, found ${d2_version}." >&2
  exit 1
fi

"${d2_bin}" fmt --check \
  "${root}/diagrams/01-high-level.d2" \
  "${root}/diagrams/02-mid-level.d2"

mkdir -p "${exports}"

"${d2_bin}" --layout=tala --theme=0 --scale=2 --pad=30 \
  "${root}/diagrams/01-high-level.d2" "${exports}/01-high-level.png"
"${d2_bin}" --layout=tala --theme=0 --pad=30 \
  "${root}/diagrams/01-high-level.d2" "${exports}/01-high-level.svg"
"${d2_bin}" --layout=elk --theme=0 --scale=2 --pad=30 \
  "${root}/diagrams/02-mid-level.d2" "${exports}/02-mid-level.png"
"${d2_bin}" --layout=elk --theme=0 --pad=30 \
  "${root}/diagrams/02-mid-level.d2" "${exports}/02-mid-level.svg"

if [[ ! -d "${deck}/node_modules" ]]; then
  npm --prefix "${deck}" ci --ignore-scripts --no-audit --no-fund
fi

node "${deck}/build-deck.mjs"

pptx="${exports}/Storage-Host-Executive-Update-2026-11-22.pptx"
pdf="${exports}/Storage-Host-Executive-Update-2026-11-22.pdf"
office=""
if command -v libreoffice >/dev/null 2>&1; then
  office="libreoffice"
elif command -v soffice >/dev/null 2>&1; then
  office="soffice"
fi

if [[ -n "${office}" ]]; then
  profile="$(mktemp -d)"
  trap 'rm -rf "${profile}"' EXIT
  rm -f "${pdf}"
  "${office}" -env:UserInstallation="file://${profile}" --headless --norestore \
    --convert-to pdf --outdir "${exports}" "${pptx}"
else
  echo "LibreOffice not found; skipped PDF companion." >&2
fi

echo "Generated:"
echo "  ${exports}/01-high-level.png"
echo "  ${exports}/01-high-level.svg"
echo "  ${exports}/02-mid-level.png"
echo "  ${exports}/02-mid-level.svg"
echo "  ${pptx}"
if [[ -f "${pdf}" ]]; then
  echo "  ${pdf}"
fi
