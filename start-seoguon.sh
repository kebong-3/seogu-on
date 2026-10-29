#!/bin/sh
set -eu

if ! CDPATH= cd "$(dirname "$0")"; then
  printf '%s\n' 'ERROR: Cannot open the project folder.' >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'ERROR: Node.js was not found. Install the latest Node.js 22.x and try again.' >&2
  exit 1
fi
if ! node -e 'const [major,minor]=process.versions.node.split(".").map(Number); if(major!==22||minor<9){console.error("ERROR: Node.js 22.9 or newer within 22.x is required. Found "+process.version); process.exit(1);}'; then
  exit 1
fi

for SEOGUON_FILE in package.json index.html scripts/dev.mjs scripts/ensure-runtime.mjs vendor/cesium-1.121.0.tar.gz vendor/cesium-manifest.json; do
  if [ ! -f "$SEOGUON_FILE" ]; then
    printf 'ERROR: Missing project file: %s\n' "$SEOGUON_FILE" >&2
    printf '%s\n' 'Extract the complete project ZIP before running this file.' >&2
    exit 1
  fi
done
for SEOGUON_FOLDER in src shared api server public/data; do
  if [ ! -d "$SEOGUON_FOLDER" ]; then
    printf 'ERROR: Missing project folder: %s\n' "$SEOGUON_FOLDER" >&2
    printf '%s\n' 'Extract the complete project ZIP before running this file.' >&2
    exit 1
  fi
done

printf '%s\n' \
  'Starting SEO:ON...' \
  'Default address: http://127.0.0.1:4173/' \
  'Use the address printed by the server below. PORT or .env.local may change it.' \
  'Keep this terminal open. Press Ctrl+C to stop the server.'
exec node --env-file-if-exists=.env.local scripts/dev.mjs
