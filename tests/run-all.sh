#!/usr/bin/env bash
# Full battery:  tests/run-all.sh <release.zip or site folder> [previous release .zip or folder, for the old-vs-new check]
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; export TZ="${TZ:-America/Edmonton}"; mkdir -p "$HERE/shots"
site() { if [ -d "$1" ]; then (cd "$1" && pwd); else local d; d="$(mktemp -d)/site"; mkdir -p "$d"; unzip -q -o "$1" -d "$d"; echo "$d"; fi; }
SITE="$(site "$1")"
echo "### 1. static checks";        node "$HERE/static-checks.js" "$SITE" | grep -v '^ok   '
echo; echo "### 2. lint";             node "$HERE/lint.mjs" "$SITE" | grep -v '^ok '
echo; echo "### 3. backend (Apps Script in a Google mock)"; node "$HERE/backend.test.js" "$SITE/company-apps-script.gs" | grep -v '^ok   '
if [ $# -ge 2 ]; then OLD="$(site "$2")"
  echo; echo "### 3b. old vs new: identical answers on two years of data"; node "$HERE/equivalence.test.js" "$SITE/company-apps-script.gs" "$OLD/company-apps-script.gs" | grep -v '^   ('
  echo; echo "### 3c. speed, old then new"; node "$HERE/profile.js" "$SITE/company-apps-script.gs" old "$OLD/company-apps-script.gs"; node "$HERE/profile.js" "$SITE/company-apps-script.gs" new
fi
echo; echo "### 4. every page cold";   node "$HERE/e2e-smoke.js" "$SITE" | sed -n '/page errors/,/dialogs/p'
echo; echo "### 5. workflows in a browser"; node "$HERE/e2e-flows.js" "$SITE" | sed -n '/== END-TO-END/,/^console errors/p'
echo; echo "### 6. app install check"; node "$HERE/pwa-check.js" "$SITE" | grep -i 'error'
echo; echo "Screenshots: $HERE/shots"
