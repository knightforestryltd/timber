#!/usr/bin/env bash
# Full battery for a Knight Forestry release zip:  tests/run-all.sh path/to/script_and_website-vX.zip
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; ZIP="$1"; SITE="$(mktemp -d)/site"; mkdir -p "$SITE" "$HERE/shots"
unzip -q -o "$ZIP" -d "$SITE"
export TZ="${TZ:-America/Edmonton}"
echo "### 1. static checks";       node "$HERE/static-checks.js" "$SITE"
echo; echo "### 2. lint";            node "$HERE/lint.mjs" "$SITE"
echo; echo "### 3. backend (Apps Script in a Google mock)"; node "$HERE/backend.test.js" "$SITE/company-apps-script.gs" | grep -v '^ok   '
echo; echo "### 4. every page cold";  node "$HERE/e2e-smoke.js" "$SITE" | head -25
echo; echo "### 5. workflows in a browser"; node "$HERE/e2e-flows.js" "$SITE" | sed -n '/== END-TO-END/,/^console errors/p'
echo; echo "### 6. app install check"; node "$HERE/pwa-check.js" "$SITE"
echo; echo "Screenshots: $HERE/shots"
