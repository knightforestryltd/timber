# Automated checks

They run the real Apps Scripts in an in-memory copy of Google (sheets, Drive, mail, triggers) and drive
the real pages in a headless phone browser (Playwright + Chromium).

```
node tests/server.test.js      # Drivers script
node tests/company.test.js     # single company script, incl. moving from the old scripts
node tests/page.test.js        # Drivers page (needs Leaflet 1.9.4 in tests/leaflet: cd tests/leaflet && npm pack leaflet@1.9.4 && tar xzf leaflet-1.9.4.tgz)
node tests/nav.test.js         # back button, page settings, invoices
node tests/native.test.js      # Android app features (fake app plugins)
node tests/unified.test.js     # set-up, single link on every page, move, company-switch guard
node tests/dispatch.test.js    # dispatch: places, status colours, pending/completed, customer text
node tests/live.test.js        # two devices: live refresh, settings arrive, ticket edits, copies + receipt printer
# DEVICE="Desktop Chrome" node tests/<name>.test.js runs a browser test as a laptop
```
