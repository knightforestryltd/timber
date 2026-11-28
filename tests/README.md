# Test battery

Tests a release zip (`script_and_website-vX.zip`) without touching the live Google script or sheet.

```
tests/run-all.sh ~/Downloads/script_and_website-v14.4.zip ~/Downloads/script_and_website-v14.3.zip
```
The second zip is optional: with it, the old and new script read the same two-year sheet and must give identical answers, and both are timed.

Needs Node 18+, Playwright with Chromium (`npm i -g playwright && npx playwright install chromium`) and ESLint (`npm i -g eslint`).

| Part | What it does |
|---|---|
| `static-checks.js` | Syntax of every script (also the `<script>` blocks inside pages), duplicate / missing element ids, broken local links, service-worker file list, app icons |
| `lint.mjs` | ESLint over each page with the shared scripts it loads (undefined names, duplicate keys, unreachable code) |
| `backend.test.js` | Runs `company-apps-script.gs` inside `gasmock.js` (an in-memory Sheets / Drive / Properties / Cache / Lock / Mail mock) and checks every service: sign-in, admin devices, lockouts, settings, loads, tickets, yards, drivers, shifts, trucks, money, alerts, nightly backup, upgrade from a v14 sheet, malformed input. Group 26 is a *risk probe*: it turns on strict sheet grid limits. |
| `e2e-smoke.js` | Opens every page on a brand-new device, desktop and phone size |
| `e2e-flows.js` | Real browser workflows: office sign-in, quote and book, busy sheet, Dispatch ticket and delivered, Billing invoice, Tickets, driver phone, mechanic phone, settings reaching a second device, page vs script maths |
| `equivalence.test.js` | Old and new script on the same sheet: every read-only answer must be identical, and nothing may be written |
| `profile.js` / `bigdata.js` | Sheet reads, cells and text read per request on a company with ~2 years of data |
| `pwa-check.js` | Asks Chrome whether the site installs as an app |

In the browser tests the pages are served from a temporary local folder. Requests to `script.google.com` go to the mock backend, and Google Maps / Routes are replaced by fixed fake answers (55 km, 40 min).
