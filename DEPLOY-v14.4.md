# Replacing v14 with v14.4

Tested on a sheet built by the real v14 script (a month of bookings, tickets, inventory, shifts with GPS, work orders,
payments and 14 nightly backups): v14.4 adds two header cells on the right (**Loads: Delivered At**, **Drivers: lastKph**)
and changes no data cell. Phones and office devices stay signed in. v14 can be put back at any time (step 6).

## Order: script first, then the website
Old v14 pages (still cached on a phone) work with the v14.4 script. Tested.

1. **Copy of the live sheet.** Open *Company Data* → **File → Make a copy**, and keep it somewhere OTHER than the
   "Company Data backups" folder. (Optional extra; your 14 v14 nightly backups are also kept.)
2. **Script.** script.google.com → your company project → select all, paste `company-apps-script.gs` (v14.4) → **Save** →
   **Deploy → Manage deployments → ✏ → Version: New version → Deploy**. The link does not change.
3. **Check.** In the editor choose **checkStructure** → **Run**. It should say *All checks passed*
   (columns "not added yet" are fine; they are added the first time each tab is used).
4. **Website.** Upload every file from `script_and_website-v14.4.zip`, then **delete `logo.jpg`** from the site (v14.4 has none).
   `app.apk` is unchanged.
5. **Logo.** On an admin device: **Billing → Settings → logo → Save**. Every page now shows that logo.
   (Until then the header shows only the company name.)
6. **Rollback if ever needed.** Deploy → Manage deployments → ✏ → choose the previous version → Deploy, and put the v14 website files back.
   v14 reads and writes the sheet normally after v14.4 has used it. Tested.

## What changes for people
- Quote: species boxes list your own species from Settings, all **un-ticked** each new quote; tick what the customer asks for
  (nothing ticked shows every species). Split also starts un-ticked.
- Booking: if the office sheet is busy, the page tries again by itself; it can never book twice.
- Dispatch: changes not sent yet (no signal / busy sheet) show an amber *Waiting for signal* label and a count. If the office
  deleted a load, the phone says the change was not saved. The notes pop-up shows once per load.
- Drivers: after log in the menu shows only Drivers and Trucks straight away.
- Sign in: the company name is already filled in.
- Faster: menu badges, driver log in, Drivers admin and Statistics (about 10–20x less reading on a large sheet).
- Backups: one rolling "BACKUP of Company Data" copy nightly. The 14 dated v14 backups stay until you delete them.

## Not in the website
The Android app's home-screen icon is built into `app.apk`. The new icon set is in `android-icons/` for the next app
build (it must be signed with the existing key).
