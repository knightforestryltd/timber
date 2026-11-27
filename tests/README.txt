Developer tests (do NOT upload this folder to the website).
  node tests/script.test.js   -> runs company-apps-script.gs against an in-memory copy of Google Sheets
                                 (old v13-shaped data first, then every v14 path). Needs Node 18+.
  node tests/e2e-trucks.test.js -> opens the real pages in headless Chromium (Playwright) with every script call
                                 answered by the in-memory script: sign-in, Trucks, work orders, PM sheet.
