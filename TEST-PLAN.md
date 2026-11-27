# v14 test plan: on a COPY of the real data, before the one deploy

Nothing in this plan touches the live sheet, the live script or the live website.

## A. Set up the TEST copy (about 20 minutes, once)

1. **Copy the sheet.** Open *Company Data* → File → **Make a copy** → name it `Company Data TEST`. Copy its id from the address bar (the long part between `/d/` and `/edit`).
2. **A separate TEST script.** Easiest way, the one the owner used: open `Company Data TEST` → **Extensions → Apps Script** → paste the new `company-apps-script.gs` → Save. A script made this way uses the copy it belongs to by itself (no `ssId` needed). Then do steps 2.2–2.5 below, skipping the `ssId` line.
   Or, the other way:
   1. script.google.com → **New project** → name it `Company TEST` → paste the new `company-apps-script.gs` → Save.
   2. Project Settings (gear) → **Script Properties** → Add:
      - `ssId` = the id of `Company Data TEST`;
      - `TEST_MODE` = `1`. With this, every email (invoices, driver logs) goes only to you, with `[TEST]` in the subject.
   3. Copy these Script Properties from the LIVE script (Project Settings → Script Properties) so the copy has the same password, settings and drivers settings: `companyPwSalt`, `companyPwHash`, `companyKey`, `companyId`, `companyRev`, `companySettings_n`, every `companySettings_0`, `companySettings_1` …, and `drvConfig`. Do **not** copy `adminTokens`.
   4. Run **`checkStructure`** once (Run menu). Authorize when Google asks: this is the test project, not the live one. The log must start with **All checks passed**.
   5. Deploy → **New deployment** → Web app → Execute as: Me → Who has access: Anyone → Deploy. Copy the link: this is the **TEST link**. A new deployment is right here, because this is a new, separate project.
3. **A separate TEST website** (e.g. `timber-test.<account>.workers.dev`).
   1. Upload all site files.
   2. In its `kf-config.js`, set `window.KF_COMPANY_URL = '<TEST link>';` and remove the `//` in front of `window.KF_TEST = true;`. Every page then shows a red **TEST** banner.
   3. Add the test worker address to the Google Maps key's allowed websites (Google Cloud → Credentials → the key → Website restrictions). Without it, maps and distances fail on the test site.
   4. A different worker address has its own phone storage, so the test site never mixes with live devices.
   5. Test in **Chrome** (or Chrome → Add to Home screen), **not in the APK**: the APK always opens the live site.

## B. Automatic tests (already run during the build; run again after any change)

From the repo folder: `node tests/script.test.js` and `node tests/e2e-*.test.js` (needs Node 18+ and Playwright).
They run the real script against an in-memory copy of the sheet (v13-shaped data first), and the real pages in a headless browser.

Last run: every test passed.

| Test | Checks | What it covers |
|---|---|---|
| `script.test.js` | 56 | Tokens, merge guard, loads, editLoad, delivery Out rows, drivers, work orders, payments, alerts, inspections, `checkStructure`, `testTrucksMoney` |
| `e2e-trucks` | 14 | Sign-in on a fresh device, Trucks, work order close, PM-A sheet |
| `e2e-drivers` | 22 | An old open shift carries over, passcode swapped for a token, major defect hard stop, engine hours, fuel GST, trip stages, yard clock |
| `e2e-billing` | 10 | An existing load invoices to the same total in v13 and v14, a renamed unit, billed hours, payments, Owing |
| `e2e-inventory` | 24 | Drop, haul cost, weighted average, process to split, pending drop, Void, Quote split chips, low stock, split invoice |
| `e2e-companies` | 14 | A second company sets up with its own sheet link and registers its name; new phones sign in with company name + password; drivers find it by name; a taken name is refused |
| `e2e-story` | 20 | The full story below, dollar by dollar, every Statistics screen, "Use real costs" |

## C. By hand on the TEST site: the full story (one office phone, one driver phone, the mechanic on a third)

Write down what you see; anything different from "Expect" is a fail.

| # | Do | Expect |
|---|---|---|
| 1 | Office phone: open the test site | Red TEST banner. The sign-in screen asks the **company name**, then "I drive…" or the company password + a device name. |
| 2 | Type the company name (as in Billing → Settings, e.g. Knight Forestry), the company password, device name "Office test" | Yellow **Admin** badge in the header. Quote → Settings → Company settings → Admin devices lists "Office test". |
| 3 | Quote → Settings | Truck Units and Pickup Locations first. "Company settings" folded. No link boxes anywhere. |
| 4 | Edit a unit, rename it | A warning shows how many loads use the old name; the old name is remembered ("was: …"). |
| 5 | Drivers → Settings → add a person "Test Mechanic" with role Mechanic, $40/h; your driver with role Driver, $30/h | Saved. No rates show anywhere on a driver phone. |
| 6 | Trucks → Truck 1 → Edit → Tracks engine hours = Yes, hours now 1000 | Saved; the unit card shows km and hours. |
| 7 | Driver phone: open the test site → "I drive…" → log in | Shift start. Pick Truck 1: engine hours asked, pre-filled 1000. |
| 8 | Start the shift (km + hours, tick both boxes) → Pre-trip → mark one item Defect → **MAJOR** → save | Asks to confirm the major defect. Office: Trucks shows Truck 1 **Out of service**; red badges on Trucks and Drivers. |
| 9 | Driver taps **Driving** | Hard stop: "A MAJOR defect was reported…". No Driving status is added. |
| 10 | Mechanic phone: log in on Drivers → Trucks (Shop view) → the work order → hours 2.5, add a part $120 with a receipt photo → Close job | The mechanic sees no labour $ or rates. Closing asks "put it back IN SERVICE?" → yes. |
| 11 | Office: Drivers → Admin → Defects → **Seen** | The red badge on Drivers goes away (within 5 min, or reopen the page). |
| 12 | Office: Quote a load from a real address → Book Load with a price adjustment of −$50 "Deal" | The pop-up shows quoted → adjusted total and the billed hours, plus "Empty driving … not billed" if a home base is set. |
| 13 | Dispatch → the load → **Assign** driver + Truck 1 → **Edit load** → Requested date = today | Saved after confirming; Log tab has before/after. |
| 14 | Dispatch: check the ticket (start) | As before. Driver phone → Trips from Dispatch shows the load "assigned to you". Tick it. |
| 15 | Driver: tap through the trip stages (or drive past base / pickup / customer for the automatic ones). Add fuel: 100 L, $150 → GST 7.50 filled in, company card, receipt photo | Stages show times. Fuel saved with "receipt ✓". |
| 16 | Driver: close the shift (end km + end hours) | The L/100 km shows; submitted. The daily log email arrives at YOUR address with **[TEST]** in the subject. |
| 17 | Dispatch: Delivered → Billing → Pending → the load | The trucking line shows the billed hours (e.g. "4.99 h"); **no** adjustment line, no reason. Complete Load. |
| 18 | Billing → Share to Office | Email to you only, with [TEST]. |
| 19 | Billing → Owing | Before payment the load is not here, because it counts as invoiced before go-live. To test: in the TEST script's properties set `goLive` to a date before today, reopen Owing, record a part payment, then the rest. Owing shows Part paid → disappears. |
| 20 | Statistics | Graph with 3 lines. Sales = the invoice before GST. Costs include wood, driver wages (8 h × $30 × 1.12), fuel $150, repair (2.5 × 40 × 1.12 + $120). Tap each number to see the rows and the receipt. |

## D. The extra checks the owner asked for

| Check | How | Expect |
|---|---|---|
| An open shift started on the OLD drivers page carries over | Before uploading the new pages to the test site, start a shift on the test site with the v13 `drivers.html`. Then upload v14 and reopen. | Same shift on screen; "Not yet synced" clears; the phone's session now holds a token, not the passcode (also covered by `e2e-drivers`). |
| An old cached Quote page doing **Save to Company** does not wipe new settings | Set money settings + a unit's "Hauls split" on v14. Then on a device still showing v13 `index.html`, Save to Company with the password. | Settings → Company settings still shows the wages/OT values; the unit still hauls split (merge guard). |
| Existing loads invoice with the same totals as before | Open 3 delivered loads in Billing on v13 (live) and on v14 (test); compare the totals. | Identical (also tested automatically). |
| Existing inventory totals unchanged | Inventory on live vs test: each yard + species. | Same tonnes on hand (v14 shows Logs and Split separately; with no split yet, Logs = the old figure). |
| `nightly()` runs | TEST script → Run → `nightly`. | No error. A backup copy in Drive ("Company Data TEST backups"). Recurring bills posted once (run it twice: still once). |
| Second company (only if the brothers will use this site) | Make a second TEST script (own sheet, its own New deployment). On a fresh Chrome profile: sign-in screen → "Setting up a new company? Use its sheet link" → paste its link → name + new password → Save link. On another fresh profile: sign in with that company name + password. | Each phone lands in its own company; the first company's data never shows. |
| Structure | Run `checkStructure` again after all of the above. | **All checks passed** (new columns only on the right). |
| `testTrucksMoney` | Run it on the TEST script only. | Every line starts OK; it removes its own TEST- rows. |

If anything fails: write down the step and what you saw. It gets fixed and the tests are run again before the deploy.
