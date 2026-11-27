# Knight Forestry v14: build plan (Phase 1, no code yet)

Written after reading every file in v13: all pages, nav.js, theme.js, theme.css, sw.js, manifest.json, app.html, company-apps-script.gs and UPDATE-NOTES.txt. The legacy .gs files were read only as history.

**Status: waiting for your answers to the questions in section 7 before I write any code.**

---

## 0. What I found in v13 that changes how the spec is built

Most of the spec fits the code as written. These findings don't, and the plan below works around them.

| # | Finding | Effect on the plan |
|---|---|---|
| F1 | **"Complete Load" in Billing sets Status = Paid when the invoice is made**, not when money arrives. There is no "invoice sent" state. Paid really means "invoiced and finished". | Prompt 4 says "when fully paid, set Status to Paid the way the page does now". That would leave invoiced loads stuck in the Billing pending list. See **Q1**. |
| F2 | **Pending loads have no ID.** The Load ID column is the scale ticket number, filled only when Dispatch starts the load. findRow_ falls back to customer + timestamp + location + species + truck. | editLoad, assign and price adjustments can't find a pending load "by Load ID". New bookings get a **Booking ID** (new column, made on the phone, which also makes a resent booking safe). Old loads keep using findRow_ exactly as now. |
| F3 | **Dispatch has no "assign driver + truck" step.** Loads have no requested or delivery date either. | Prompt 6.2, the "no truck/driver for today/tomorrow" alert and comparison A12 all need both. See **Q3** and **Q4**. |
| F4 | **Any device holding the company key is automatically Drivers admin** (drvAdminOk_). Phones that connected through the company link also hold the key. | Prompt Q.6 makes admin = token or password only. Key devices keep working and lose only the automatic admin. See **Q5**. |
| F5 | **Driver phones store the passcode itself** (localStorage kfDrvSession = {name, passcode}) and send it on every save. | Q.6 says devices store only a token. I'll add a person session token and keep accepting passcodes from old cached pages. See **Q6**. |
| F6 | **Scale ticket "Purchase" is a $ total** for the load (the ticket page shows Profit = Sale − Purchase), not $/tonne. | Prompt 5 says "Purchase price × net tonnes". I'll use Purchase as the load's wood cost in $. See **Q7**. |
| F7 | **yards.html reads the wrong settings key** ('knightForestrySettings' instead of 'knightForestrySettings_v3'). New yards never reach Quote, and the transfer pickup list is always empty. Its manual unlock uses localStorage 'yardPass' or 'knight'. `settings.yardPassword` is only in Quote's defaults and is never sent to the company. | I'll fix the read to use _v3. The old key is not written to again and nothing is deleted. 'yardPass' and yardPassword are removed as Q.6 asks. |
| F8 | **Two different cord factors.** Dispatch and Billing use `sp.cvf` (default 1.3, never set in Quote settings). Quote uses `sp.tonnesPerCord` (default 1.8). | Prompt 7 uses tonnesPerCord, the location setting. I will **not** change Dispatch or Billing cords, since that would change existing invoices. Noted for you only. |
| F9 | **The "bottom menu" is the top header row** (7 buttons, the same markup copied into every page). Trucks is `href="#"` on every page, not only on index.html. | nav.js will take over that row on every page: Trucks link, Statistics (admins only), alert badges, and the same order everywhere. Each page's HTML stays as a fallback. |
| F10 | **Manual invoices (Billing → New Ticket Invoice) with no matching load are not stored anywhere.** completeNew answers "not found" and nothing is saved. | They can't show in Owing or Statistics. See **Q2**. |
| F11 | **Shifts and pre-trips older than 12 months are purged.** | Statistics "same period last year" and wages history need older shifts. See **Q8**. |
| F12 | **Every driver log stores HOS events and the GPS trail in the Shifts json.** The 45,000-character cap is applied in drvSaveShiftRow_. | Trip stages are stored compactly (times, lat/lon to 4 decimals, km), and the cap logic is extended so stages are trimmed before the signature or pre-trip are dropped. |

---

## 1. Sheet changes (exact names; every new column at the END)

### 1a. Loads tab (header row 4; columns A–T stay exactly as they are)

loadRows_ will read up to the last column instead of a fixed 20. Bookings write the new columns. updateStatus_ and saveInvoice_ keep their fixed columns 16–19. The header names are written into row 4 once, only into cells that are empty.

| Col | # | Header | Filled by |
|---|---|---|---|
| U | 21 | Quoted Total | booking (quote total before the adjustment) |
| V | 22 | Price Adj | booking / editLoad ($ before GST, + or −) |
| W | 23 | Adj Reason | booking / editLoad (internal only) |
| X | 24 | Billed Hours | booking / editLoad (= total hours + adj ÷ billed hourly, 2 decimals) |
| Y | 25 | Booking ID | booking (made on the phone; stops duplicates) |
| Z | 26 | Product | booking (Logs / Split; blank = Logs) |
| AA | 27 | Requested Date | booking / editLoad (**Q3**) |
| AB | 28 | Unit ID | Dispatch assign |
| AC | 29 | Driver Name | Dispatch assign |
| AD | 30 | Booking Data | booking. Compact json (capped at 20,000 characters): cost snapshot at booking (spCostTonne, costHourly, billed hourly, L/100, billed and cost fuel price, GST %, estimated profit, home base used, load/unload hrs). Statistics uses it for "booked vs actual". |
| AE | 31 | Empty Out km | booking (home base → pickup) |
| AF | 32 | Empty Out h | booking |
| AG | 33 | Loaded km | booking (pickup → customer) |
| AH | 34 | Loaded h | booking |
| AI | 35 | Empty Back km | booking (customer → home base) |
| AJ | 36 | Empty Back h | booking |
| AK | 37 | Empty Fuel L | booking (out + back) |

"Total (incl GST)" (col O) holds the adjusted total, so Dispatch and Billing pick it up with no other change.

### 1b. Yards tab (columns A–L stay exactly as they are)

| Col | # | Header | Notes |
|---|---|---|---|
| M | 13 | Product | Logs / Split. Blank = Logs. |
| N | 14 | CostPerTonne | Weighted cost for In rows. Cost at average for Out rows. |
| O | 15 | CostPerCord | Split |
| P | 16 | HaulCost | $ for this drop |
| Q | 17 | ProcessId | Shared by the Out (logs) and In (split) rows of one processing run |
| R | 18 | Status | Confirmed / Pending / **Void**. Blank = Confirmed. Void = undone (see Q9). |
| S | 19 | LoadId | Automatic Out row on delivery |
| T | 20 | PendingTonnes | The real tonnes of a Pending driver drop. Tonnes (E) stays 0 until the office confirms, so old cached pages show correct totals. |
| U | 21 | EntryId | Made on the phone, so a resent save never duplicates |
| V | 22 | By | Who saved it |

Type stays In / Out / Adjust. Split rows also fill Tonnes (E) with cords × t/cord, so old pages show sensible totals. A Void row gets Tonnes = 0, which old pages count as nothing.

### 1c. Tickets: no change.

### 1d. Existing keyed tabs (new keys appended to TABS; the header row is extended in place)

- **Drivers** (+): `roles` (comma list: driver, mechanic, yard; blank = driver), `tokenVer` (bumped to sign a person out everywhere).
- **Shifts** (+): `shiftType` (blank = driving, `yard`), `startHours`, `endHours`, `unitId`.
- Pretrips, Positions, Log, Places: unchanged.

### 1e. New keyed tabs (created on first use with the existing helpers)

Extra columns that are **not in the spec** are marked ✚, with the reason.

- **Units**: id, type, name, unitNo, plate, vin, year, make, model, purchaseDate, purchasePrice, trackHours, currentOdo, currentHours, regExpiry, insExpiry, cvipExpiry, status, outReason, notes, photo, updatedAt, ✚pricingUnit (the Quote unit name, Prompt 2), ✚hasCrane (picks the PM template), ✚fuelBurnLph, ✚fuelType, ✚wearPerHour (Prompt 7.8), ✚pmOverrides (json: per-unit PM intervals, Prompt 2b), ✚homeBase (Prompt 6.1a), ✚trailerA, ✚trailerB (so drvConfig.units can be rebuilt from Units), ✚oosOverrideUntil (office override, Q10)
- **WorkOrders**: id, unitId, unitName, openedAt, source, shiftId, driverName, defect, severity, status, where, shopName, mechanicName, mechHours, mechRate, laborCost, partsCost, shopLabor, shopParts, gst, total, odoAt, hoursAt, closedAt, closedBy, workDone, invoicePhoto, downDays, notes, ✚inspectionId, ✚itemName, ✚photo, ✚woKey (prevents duplicates: unit + defect text + source ref), ✚seenAt, ✚seenBy (Drivers "seen by office" alert)
- **WOParts**: woId, at, part, qty, unitCost, total, vendor, receiptPhoto, ✚id (prevents duplicates)
- **ServicePlans**: id, unitId, task, everyKm, everyHours, everyDays, lastDoneAt, lastDoneOdo, lastDoneHours, notes
- **UnitReadings**: at, unitId, unitName, odo, hours, source, shiftId, by, ✚id
- **Expenses**: id, at, date, amount, gst, total, category, vendor, payMethod, unitId, driverName, loadId, yard, recurringId, source, sourceRef, note, receiptPhoto, by
- **Recurring**: id, name, category, amount, gst, dayOfMonth, unitId, startDate, endDate, active, lastPostedFor
- **Payments**: id, loadId, invoiceNo, customer, paidAt, amount, method, note, by
- **People**: id (= Drivers.id when the person signs in), name, role, hourlyRate, active, ✚roles (several roles, Prompt 7.8), ✚rates (json: rate per role, if a person has different rates)
- **Inspections**: id, unitId, unitName, template, doneAt, doneBy, role, odo, hours, result, itemsJson, measurementsJson, signature, notes, woIds
- **InspectionTemplates**: id, name, appliesTo, intervalHours, intervalKm, intervalDays, includesTemplateId, itemsJson, active
- ✚**Invoices** (only if Q2 = yes): invoiceNo, at, customer, address, phone, loadId, ticket, sub, gst, total, product, trucking, fsc, json

### 1f. Script Properties (new)

- `adminTokens`: json list of {hash, deviceName, createdAt, lastSeen}. Only a SHA-256 of each token is stored. At most 50 tokens; lastSeen is written at most once an hour.
- `personSecret`: random key used to sign person session tokens. A token is `id.ver.sig`, so nothing is stored per phone. Changing a passcode or `tokenVer` ends it.
- `TEST_MODE` (set by you on the TEST copy only), `goLive` (the date v14 first ran; see Q1), `drvUnitsMigrated`, `templatesSeeded`.

### 1g. Settings blob (Company Sync)

New keys: `money` {employerCostPct 12, otWeeklyHours 50, otMultiplier 1.5, weekStartsOn 0, categories [...]}, `homeBase`, `offRoadFuelPrice`. New fields on `units[]`: `aliases`, `haulsSplit`, `splitCords`, `homeBase`. New fields on `locations[].species[]`: `splitPricePerCord`, `splitCostPerCord`.

**Merge guard in saveSettings:** if the stored copy has a key the incoming save lacks, keep the stored one. Units are matched by id and locations by id, field by field. `yardPassword` is deleted from the stored copy.

---

## 2. New script actions (company-apps-script.gs)

Every write takes a phone-made id and checks before appending. Every write goes through log_. Office actions use the new **isAdmin_(p, d)** (valid admin token OR company password OR "no password yet").

**sync (existing service)**
- `makeAdmin` (password → token)
- `listAdmins`, `removeAdmin`, `removeAllAdmins`, `stopAdmin`
- `whoami` (admin? person? which roles?)
- `alerts` (counts per page, worked out each time and never stored)
- `setPassword` (existing) now also clears all admin tokens
- `saveSettings` gains the merge guard and accepts a token
- `saveProfile` and `saveDispatch` accept a token

**loads**
- Booking: new optional fields (bookingId, quotedTotal, priceAdj, adjReason, billedHours, product, requestedDate, bookingData, legs). A resent booking with the same bookingId is ignored.
- `editLoad`: find by bookingId, else the same findRow_ query. Writes only changed fields. Logs before/after, device name and person.
- `assignLoad`: unitId + driverName. Warns if the unit is Out of service.
- On `updateStatus` to Delivered for a load from a yard: write the automatic Yards Out row once (idempotent by LoadId). A cancel or edit-back voids it.

**yards**
- `add` (unchanged, plus optional new fields)
- `drop`
- `confirmDrop`
- `process`
- `undoProcess`
- `voidEntry`
- `saveSplitPrice` (merges splitPricePerCord / splitCostPerCord into settings)

**trucks (new service)**
- Read with the company key or a person token: `listUnits`, `listWorkOrders`, `dueList`, `listServicePlans`, `listTemplates`, `unitHistory`.
- Admin only: `saveUnit`, `deleteUnit` (marks Sold, never deletes), `saveServicePlan`, `saveTemplate`, `setIntervals`.
- Admin or mechanic: `saveWorkOrder`, `addPart`, `closeWorkOrder` (writes ONE Expenses row, source = workorder, idempotent by WO id), `addReading`, `markSeen`.
- Any signed-in person: `saveInspection`.
- `uploadPhoto`: base64 in, Drive file link out. Folder "Company Data photos". The image is never stored in a cell.

**money (new service, admin only)**
- `listExpenses`, `saveExpense`, `deleteExpense` (confirm first; deletes the row)
- `listRecurring`, `saveRecurring`
- `savePayment`, `listPayments`, `deletePayment`
- `savePeople`, `listPeople`
- `summary`: one call returning compact rows for Statistics. Shifts come back as start/end/type/unit/driver/hours/km/fuel/trip stages, never the full json.
- `saveInvoice` (only if Q2 = yes)

**drivers (existing service)**
- `driverLogin` also returns: a session token, units with status, open major WOs and open WOs per unit, trackHours, last hours per unit, the person's roles, and PM-due notes for the units. **It never returns pay rates.**
- `saveShift` and `submitShift` accept a token or a passcode. They also:
  - make WorkOrders from pre-trip defects (no duplicate per shiftId + defect);
  - append UnitReadings and raise Units.currentOdo / currentHours;
  - write fuel Expenses (idempotent by shiftId + fuel entry id);
  - skip the odometer and pre-trip requirements for yard shifts.
- New `myTrips` (loads assigned to this person or started today, minimal fields), so drivers no longer need the company key to see trips.
- New `yardDrop` (makes a Pending Yards row).
- Admin actions accept a token.
- `adminSaveConfig` merges units by id/name into Units and never wipes them.
- `adminSavePerson` (roles + rate).
- `adminOverrideUnit`.

**nightly()**
- `backupNow()`, then `purgeOld_()` (narrowed), then `try { postRecurring_() } catch`.
- No new trigger.

**Editor functions**
- `testAll_()`: headers in place, no column moved, the TABS width matches the header.
- `testTrucksMoney_()`: makes sample rows and cleans them up by id (deletes only its own rows).

**OAuth scopes:** none new. DriveApp, MailApp, UrlFetchApp, Maps and ScriptApp are already used, and HMAC signing needs no scope. I'll still confirm in DEPLOY.md by checking the script's scope list.

---

## 3. Files and what changes in each

| File | Changes |
|---|---|
| **company-apps-script.gs** | Everything in sections 1–2. SCRIPT_VERSION 1 → 14 (so pages can feature-detect `v >= 14`). TEST_MODE email redirect. |
| **kf-config.js** (new) | `window.KF_COMPANY_URL`. Optional `window.KF_TEST`. Can be a list of {name, url}. |
| **nav.js** | Loads kf-config.js. Auto-connect. Sign-in screen (admin password, or person name + passcode). kfAuth helpers (admin token, person token, `kfIsAdmin()`, `kfPerson()`). Rebuilt menu row (same order, Trucks linked, Statistics for admins only, alert badges + "Needs action" list, 5-minute cache, never blocks loading). Admin badge. Red TEST banner. Hides kfLinks link cards (code kept). Shared photo shrink + upload helper. applyCompanySettings also copies money / homeBase / offRoadFuelPrice. Redirects a people-only device from office pages to drivers.html. |
| **index.html** (Quote) | Price adjustment + reason + requested date in the booking pop-up. Booking ID. Legs from home base. Cost snapshot. Product. Low-stock warning. Settings re-ordered (Units + Locations first, "Company settings" fold, ids unchanged). Edit / Update unit with aliases and rename warning. Confirm before Remove. Hauls split + capacity. Home base (company + per unit). Off-road diesel price. Split sub-checkbox per species (remembered). Split rows/chips for yards. Yard stock shown, and "needs a price" locations. "Use real costs" per unit. Profit per option. Admin devices list / "Make this device an admin" / no-password banner. Link fields hidden (read-only company link). companyPayload / applyCompanyData carry the new keys. |
| **dispatch.html** | "Edit load" form (every field, confirm, editLoad). Assign driver + truck (OOS in red, warn). Requested date shown. Price adj + reason shown (office only). Link card hidden. Customer-text save uses the admin token (no password box on admin devices). |
| **invoices.html** | rates() matches unit name **or alias**. calcInvoice uses Billed Hours when set (cents nudge, no new line). Invoice Data gains product / trucking / fsc / sub / gst numbers. Record payment. Unpaid / Part paid / Paid shown on screen only. "Owing" screen with ageing buckets. Company-info save via admin token. Link card hidden. |
| **scale.html** (Tickets) | Hard-coded 'knight' login removed. Admin device = unlocked, else the company password. Link card hidden. |
| **yards.html** (Inventory) | Reads _v3 settings (F7). Totals per yard + species + product, ignoring Pending and Void. Weighted average cost. Drop at yard (haul-cost maths shown and editable). Confirm driver drops. Process to split (uses yard clock time + equipment hours). Logs / Split shown separately, negatives in red. 'knight' / 'yardPass' removed (admin unlocks). Link card hidden. |
| **drivers.html** | Person token instead of the stored passcode (old sessions carried over). Mechanic + Yard roles + hourly rate (admin). Start: driving shift or yard work. Engine hours start/end on trackHours units. Out-of-service block. Known defects. Minor/major per pre-trip defect (major = hard stop). "Still there" for known defects. Fuel GST / pay method / receipt photo, and L/100 km. Trip stages with auto GPS geofences + manual buttons + "estimated" fill-in. Drop at yard button. PM sheets (any signed-in person). Unit alerts on the shift screen. Admin shift view extras (hours paid, km, hours, fuel, WO links). sessionStorage kfDrvAdmin replaced by the admin token. "Update link" box hidden. Yard shifts skipped by every HOS path (listed in section 5). |
| **trucks.html** (new) | Units list, unit detail (Info / History / Service plan / Costs / PM / Enter hours), work orders (office + mechanic Shop view), due soon, Trucks settings (PM intervals, templates). |
| **statistics.html** (new) | Graph (plain SVG), bottom line, add expense, recurring, breakdowns, comparisons A–E, quote accuracy, overhead, CSV/PDF export, offline cache. |
| **sw.js** | FILES gets trucks.html, statistics.html, kf-config.js, yards.html, invoices.html, scale.html. CACHE → kf-quotes-v14. |
| **theme.css** | A few shared classes (badge dot, alert list, TEST banner). The existing variables are reused. |
| **app.html** | Text only: "the app connects by itself" (no link to paste). |
| **UPDATE-NOTES.txt** | One v14 section. |
| **PLAN.md, TEST-PLAN.md, DEPLOY.md** | New docs. |
| Legacy .gs, manifest.json, html2pdf, icons, app.apk | **Not touched.** |

---

## 4. Build order (one commit per step, each revertible)

1. **Rule 0 groundwork**: kf-config.js, nav.js auth/menu/alerts skeleton, isAdmin_ / tokens / merge guard, SCRIPT_VERSION, testAll_.
2. **Q**: price adjustment, editLoad, settings layout, unit edit + aliases, no link fields, sign-in / admin.
3. **1**: script tabs + trucks / money services, tie-ins in saveShift, postRecurring_, photos, testTrucksMoney_.
4. **2**: trucks.html + unit migration + menu wiring + sw.js.
5. **2b**: Inspections + templates (seeded) + PM due maths + alerts.
6. **3**: drivers.html tie-ins (hours, OOS, defects, fuel, pay roles, trip stages, admin view).
7. **4**: Billing payments + Owing.
8. **7**: Inventory (drops, process, split, yard clock, Quote split, delivery Out row).
9. **5**: statistics.html.
10. **6**: Quote real costs + home base legs, Dispatch assign, Company Sync keys, menu order, full-story fixes.
11. **Docs**: TEST-PLAN.md, DEPLOY.md, UPDATE-NOTES.txt.

---

## 5. Existing behaviours each change touches, and why each keeps working

**Loads column positions.** A–T are never moved. Bookings still write A–T in the same order, plus U–AK after them. loadRows_ still maps r[0]..r[19] to the same names and adds the new fields only if those columns exist. importOld_ still writes 20 columns, and the new columns stay blank.

**findRow_.** Unchanged: it still reads columns 1–17 and uses the same matching. A new `findLoad_` tries the Booking ID first (a separate read of column Y) and only then calls findRow_ with the same query. updateStatus_ and saveInvoice_ keep their fixed columns 16, 17, 18 and 19.

**Status values.** Status stays Pending / Started / Delivered / Paid. Payment state (Unpaid / Part paid / Paid) is worked out on screen from the Payments tab and never written to Status. Dispatch's statusOf and the paid list are unchanged.

**Invoice rates() by unit name.** rates() still matches `x.name === l.truck` first. The alias match is only a fallback. Old loads with no Billed Hours use `totalHours` exactly as today. The same applies to dispatch getRates and Billing unitInfo (TM9).

**Yards Type values.** Type stays In / Out / Adjust. Product, Status and so on are new columns. Old cached pages sum Tonnes as before, and Pending and Void rows have Tonnes = 0.

**saveSettings replace behaviour.** saveSettings still replaces the whole object, with one exception: the merge guard keeps any key or unit/location field the stored copy has and the incoming save lacks. An old cached Quote page therefore can't wipe `money`, `homeBase`, aliases, split prices and so on. The rejection rules for an empty locations list and `baseRev` conflicts are unchanged.

**localStorage keys.** None are renamed or deleted, except the two passwords the spec removes ('yardPass' is ignored; yardPassword is dropped from settings). New keys are kfAdminToken, kfDeviceName, kfPersonToken, kfAlerts, kfStatsCache, kfTrucksCache, kfQuoteSplit, kfSettingsOpen and kfDrvQueue (the queue for photo uploads and inspections). kfDrvSession keeps its shape {name, passcode} and gains a `token`. The passcode is blanked once a token is held. Old shape plus passcode still works.

**Open driver shift carry-over.** kfDrvShift is loaded unchanged. New fields (startHours, endHours, trip.stages, shiftType, fuel[].gst / pay / photo) are optional, and normalize() fills missing arrays only. A shift started on the old page gets no hours prompt at end if it has no startHours. The server accepts a shift with none of the new fields.

**Offline cached pages talking to the new script.** Every new request field is optional. Old drivers.html sends a passcode, which is still accepted. Old Quote bookings have no bookingId or legs, so the row has blank new columns. Old Inventory `add` still appends a 12-column row. An old Dispatch updateStatus still works the same, and Delivered on a yard load also writes the Out row (idempotent). An old saveSettings is covered by the merge guard. An old Drivers adminSaveConfig with units merges into Units by name/id.

**New pages talking to the old script (pages are uploaded first).** Each new page reads `v` from meta or ping. If v < 14 or an action answers "Unknown action", the new feature is hidden and the old behaviour stays: no admin token (password boxes as today), no Trucks/Statistics data ("needs the script update" notice), no alerts badges, and booking sends the old payload fields plus the new ones (the old script ignores them).

**HOS paths that must skip yard shifts (Prompt 7.9).** Each of these is checked and changed:
- hos() and offStatus()
- the day totals in stamp()
- buildDay / dayPageHtml / PDF email
- last14 and openHistory
- drvOnBlocks_ and driverLogin history days
- unitOdo / kfDrvLastOdo
- adminListShifts and the map (a yard shift is labelled "Yard", with no map trail unless GPS is turned on)
- the submit pre-trip and odometer requirement
- purgeOld_ (treated the same as driving)

**Other existing behaviour**
- **Company password change:** still makes a new key (same as now) and also clears all admin tokens.
- **Places tab, customer texts, invoice numbering, ticket queue, printer and the scale page:** unchanged apart from the login.

---

## 6. Things I'll decide myself unless you say otherwise

- Admin token removal takes effect on that device's next request; the device then shows the sign-in screen.
- Statistics overhead spread is **on** by default, with a switch.
- **Geofences (Prompt 3.7).** Base, pickup and customer are 300 m circles. Pickup lat/lon is geocoded once by the script and cached in Places. Customer lat/lon comes from Places too.
- **PM templates.** I seed truck PM-A/PM-B, crane items (on when hasCrane), equipment PM-A/PM-B and trailer PM-A/PM-B, all editable.
- Photos are shrunk on the phone to 1600 px, JPEG 0.7, and queued offline.
- Expenses from scale tickets are **not** auto-created: wood cost comes from tickets via the load, so an Expenses row would count it twice. The "ticket" source value is accepted for manual use.
- **"Stop being admin"** removes this device's token locally and on the server.

---

## 7. Questions (please answer; each changes what I build)

**Q1. "Paid" meaning (F1).** Today "Complete Load" sets Status = Paid as soon as the invoice is made.
- **(A) recommended:** keep that. Status Paid = invoiced and finished. Payments are recorded separately, and Owing = Paid-status loads whose payments don't add up to the invoice total. Loads completed **before v14 goes live** count as fully paid, so the Owing screen doesn't fill with years of history.
- **(B):** "Complete Load" saves the invoice but leaves the load as Delivered, and Paid is set only when payments cover it. This changes what Dispatch's blue "Paid" means and keeps invoiced loads in Billing's pending list.

Which one? With A, is "before go-live counts as paid" right?

**Q2. Manual invoices with no load row (F10).** Should I add an **Invoices** tab so they show in Owing and Statistics (recommended), or leave them out of the numbers?

**Q3. Requested date.** Loads have no delivery date. May I add an optional **"Requested date"** in the booking pop-up (and in Edit load)? The Dispatch "today/tomorrow, no truck" alert and the on-time comparison use it. Loads without one are skipped and the screen says so.

**Q4. Assigning loads.** Dispatch has no assign step. May I add **"Assign driver + truck"** on the load screen? Assigned loads then show first in the driver's "Trips from Dispatch" list.

**Q5. Devices that hold the company key today (F4).** They are automatically Drivers admin, including any driver phone that ever connected with the company link. After v14 they keep reading data as today but must enter the company password once (or sign in as a person) to get admin. OK?

**Q6. Driver passcodes on phones (F5).** I'll replace the stored passcode with a session token on the next login with signal. An open shift carries over, and old cached pages keep working with the passcode. Should tokens last until the office changes the passcode or deactivates the person (recommended), or expire after N days?

**Q7. Scale ticket Purchase (F6).** Treat "Purchase" as the **$ total** for the load (what the ticket page does today), not $/tonne?

**Q8. 12-month purge vs Statistics (F11).**
- **(A) recommended:** keep Shift rows forever but, after 12 months, drop their json detail and the GPS trail. Wages and hours stay for year-over-year comparison.
- **(B):** keep today's purge, and accept that Statistics only covers the last 12 months of wages.

**Q9. Undo in Inventory.** For "cancelling a load removes its Out row" and "undo a process run", may I **mark the rows Void** (Tonnes = 0, kept as a record) instead of deleting them? Deleting rows in a tab read by position is riskier.

**Q10. Office override for an out-of-service unit (Prompt 3.2).** Override for **the rest of today only** (recommended), or until the office turns it off?

**Q11. The live company link for kf-config.js.** Please paste the live `/exec` link, or I'll leave a clearly marked placeholder for you to fill in before upload. Is it only Knight for now, or should I list the brothers' companies too (name + link each)?

**Q12. Size and risk.** This one release is very large: two new pages, five pages and the script heavily extended, roughly 8–12k new lines. I'll build it exactly as one deploy as asked, with one commit per step and the full TEST-PLAN on a copy. If you'd rather deploy in two halves (Q + 1 + 2 + 2b + 3 first, then 4 + 7 + 5 + 6), say so now. The code would be the same; only the deploy notes change.

---

## 8. Answers (owner, Phase 1 review)

- Q1 **A**: Paid = invoiced/finished (unchanged). Payments tracked separately. Loads completed before v14 go-live count as fully paid.
- Q2 **Yes**: Invoices tab for manual invoices.
- Q3 Requested date is set in **Dispatch → Edit load** (not in the booking pop-up).
- Q4 **Yes**: Assign driver + truck in Dispatch.
- Q5 OK (key devices keep data access; admin needs the password once).
- Q6 Tokens last until the office changes the passcode or deactivates the person.
- Q7 **Yes**: ticket Purchase = $ total wood cost of the load.
- Q8 **A**: keep Shift rows forever; after 12 months drop json detail + GPS trail.
- Q9 **Void** rows instead of deleting.
- Q10 Out-of-service override lasts **until the office turns it off**.
- Q11 Knight only. Live link not supplied: kf-config.js ships with a placeholder that is ignored until replaced.
- Q12 **One deploy.**
