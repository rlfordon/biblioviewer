#!/usr/bin/env bash
# Package the skill for claude.ai upload (Settings → Capabilities → Skills).
#
# claude.ai rejects zips containing paths with characters like the "@" in npm's
# scoped-package directories, and its sandbox can't npm-install. So instead of
# bundling node_modules, this script esbuild-bundles each script into a single
# self-contained file. Run from the repo root:  bash scripts/make_skill_zip.sh
set -euo pipefail

cd "$(dirname "$0")/.."
STAGE="$(mktemp -d)/biblioviewer"
mkdir -p "$STAGE/scripts"

BANNER='import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);'
for s in fetch_snapshots build extract_data smoke_test; do
  npx -y esbuild "scripts/$s.mjs" --bundle --platform=node --format=esm \
    --banner:js="$BANNER" --external:canvas --external:./xhr-sync-worker.js \
    --log-level=error --outfile="$STAGE/scripts/$s.mjs"
done
# jsdom eagerly require.resolve()s its sync-XHR worker; biblioviewer never uses
# sync XHR, so a stub next to the bundles satisfies the resolve.
printf '// Stub for jsdom sync-XHR worker (never used; satisfies require.resolve in the bundles).\n' \
  > "$STAGE/scripts/xhr-sync-worker.js"

cp SKILL.md template.html "$STAGE/"

OUT="$PWD/biblioviewer-skill.zip"
rm -f "$OUT"
(cd "$STAGE/.." && zip -rq "$OUT" biblioviewer)

# Guard: claude.ai's validator only accepts conservative path characters.
BAD=$(unzip -l "$OUT" | awk 'NR>3 {print $4}' | grep -vE '^[A-Za-z0-9._/-]*$' || true)
if [ -n "$BAD" ]; then
  echo "ERROR: zip contains paths claude.ai will reject:" >&2
  echo "$BAD" >&2
  exit 1
fi
echo "Wrote $OUT ($(du -h "$OUT" | cut -f1 | tr -d ' '))"
