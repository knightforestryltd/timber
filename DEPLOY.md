# v14 deploy: one time, about 20 minutes

Do this only after TEST-PLAN.md passed on the test copy.

## 1. Before

- [ ] Every driver has submitted or synced (no "Not yet synced" badge), and nobody is booking.
- [ ] Script editor (LIVE project) → Run → **backupNow** (or Company Data → File → Make a copy).
- [ ] Deploy → Manage deployments: note the live **version number** (for rollback).
- [ ] Keep a copy of the current website files (the v13 zip).

## 2. Permissions

No new Google permission is needed: the script uses the same services as v13 (Sheets, Drive, Mail, Maps, URL fetch, triggers).
If Google ever says "Authorization required" when you save: Run → **checkStructure** once and Allow, **before** step 4.

## 3. Upload all website files

Upload every file in the folder except `tests/`, `PLAN.md`, `TEST-PLAN.md` and `DEPLOY.md`. New files are `trucks.html`, `statistics.html`, `kf-config.js`, `kf-stock.js` and `kf-stats.js`.

Before uploading, open `kf-config.js` and:

- put the **LIVE** company link between the quotes (Deploy → Manage deployments → the web app URL, ending in `/exec`);
- make sure the `window.KF_TEST` line still starts with `//`.

The pages keep working with the old script until step 4. New features stay hidden until then.

## 4. Update the script (same link)

1. Open the LIVE script → select all → paste the new `company-apps-script.gs` → **Save**.
2. Deploy → **Manage deployments** → pencil → Version: **New version** → **Deploy**.
3. **NEVER** choose "New deployment": that makes a new link and every phone would point at a dead one.
4. Run → **checkStructure**. The log must start with **All checks passed**. New columns show as "not added yet" until each tab is first used; that is fine.

## 5. Check on one office phone and one driver phone

**Office phone** (open the app):

1. Tap through the sign-in: the **company name** exactly as in Billing → Settings (e.g. Knight Forestry), the company password and "Office phone". The yellow **Admin** badge shows.
2. Quote: book a test load (customer "TEST").
3. Dispatch: open it → Edit load → change the notes → Save → Assign a driver and truck.
4. Billing: Owing opens. Trucks: units show (copied from Drivers → Settings). Statistics: the graph shows.

**Driver phone:**

1. Open Drivers. An already-connected phone logs in by itself (the passcode is swapped for a token). A brand-new phone types the company name, then the driver's name and passcode.
2. Start a short shift: pick a unit, enter km, do the pre-trip (all OK).
3. Close and submit. The office gets the daily log email as before.

Then in Dispatch, set the "TEST" load to Paid or delete its row in the sheet.

## 6. Rollback (if anything is wrong)

1. Script: Deploy → Manage deployments → pencil → pick the **previous version** → Deploy.
2. Website: put the previous files back.

The new columns are all on the right, and the old version ignores them, so nothing is lost. After a rollback, drivers may have to log in once more with their passcode; their open shift stays on the phone.

## After the deploy (once)

- **Quote → Settings → Company settings:**
  - check the wages / overtime / categories values and the home base;
  - tap **Save to Company** from this updated device;
  - this also removes the old Inventory password from the stored settings.
- **Drivers → Settings:** set each person's roles and pay rate (Mechanic, Yard).
- **Trucks:**
  - check each unit: type, engine hours yes/no, loader crane, expiry dates, and Pricing unit (to link it to the Quote unit for "Use real costs");
  - PM intervals: **PM intervals & sheets**.
- **Every other office device:** asked once for the company password ("Make this device an admin"). "Later" works; nothing is lost.

## Another company on this same website (e.g. a brother)

Do these steps whenever another company wants to use this website.

1. In THEIR Google account: script.google.com → New project → paste `company-apps-script.gs` → Deploy → **New deployment** → Web app, Execute as Me, Anyone → copy their link.
2. On one of their phones, open this site → sign-in screen → **"Setting up a new company? Use its sheet link"** → paste the link → enter their company name and create their company password → **Save link**. That phone is their first admin device.
3. Their name is now in the sign-in list (kept in Knight's script). Every other phone of theirs signs in with that **company name + their company password**; their drivers type the company name, then their own name and passcode.
4. Each company's data stays in its own sheet. A name already used by another company is refused (add the town to make it different).
