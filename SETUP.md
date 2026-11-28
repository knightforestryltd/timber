# How a company sets up (v14.4)

Each company keeps its own data in its own Google account: one **Company Data** Google Sheet and one script.
Every company can use the same website. The Knight Forestry script (the link in `kf-config.js`) also keeps a
short **company list** (name → that company's script link) so phones can find a company by its name. No other
company's data, passwords or customers are ever stored there.

## 1. The company's script (once, about 10 minutes, on a computer)

1. Sign in to the Google account that should own the data (the owner's, not a staff account).
2. Go to **script.google.com → New project**. Delete what is there, paste all of `company-apps-script.gs`, **Save**.
3. **Deploy → New deployment → ⚙ Web app**
   - *Execute as:* **Me**
   - *Who has access:* **Anyone**
   - **Deploy**, then **Authorize access** and allow it (Sheets, Drive for photos and the nightly backup, Mail for invoices and driver logs, Maps for place names).
4. Copy the **Web app URL**. It starts `https://script.google.com/macros/s/` and ends in `/exec`. This is the company's *sheet link*.

The **Company Data** sheet is made in that Google Drive the first time it is used. A nightly backup starts on its own
when the company password is created.

## 2. The first office device becomes the company's admin

1. Open the website (or the Android app). The **Sign in** screen shows.
2. Tap **Setting up a new company? Use its sheet link**.
3. Paste the sheet link → **Save link**.
4. Type the **company name** (people type this to sign in) and create the **company password** (twice) → **Save link** again.
5. It says *Saved. New devices sign in with "…"*. This device is now an admin. The company is in the company list.

## 3. Fill in the company (on the admin device)

| Where | What |
|---|---|
| **Billing → Settings** | Company name, GST number, address, phone, email, **logo** (the logo shows at the top of every page and on invoices) |
| **Quote → Settings → Pickup Locations** | Each location or yard with its address and species: cost, price, tonnes per cord. These species become the tick boxes on the Quote page |
| **Quote → Settings** | Trucks (rate, fuel use, tonnes), GST %, fuel price, Google Maps key, home base. Then **Save to Company** |
| **Trucks** | Each truck, trailer and piece of equipment (odometer, hours, plate, expiry dates) |
| **Drivers → Admin** | Each driver, mechanic and yard worker: name, **passcode**, roles and pay rate |

## 4. Other devices

- **Office / owner devices:** Sign in screen → company name, **company password**, a name for the device → **Make this device an admin**.
  The password is checked once; the device keeps a key, never the password. Admin devices can be removed under Quote → Settings.
- **Drivers, mechanics, yard:** Sign in screen → company name → **I drive, fix trucks or work in the yard** → pick their name → their passcode.
  Their phone only shows Drivers and Trucks.
- On the Knight Forestry website the company name is already filled in; other companies type theirs over it.

## 5. Changing things later

- **Company password:** Quote → Settings. Changing it signs out every office device (each signs in again with the new password). Drivers are not affected.
- **A driver's passcode:** Drivers → Admin → edit the driver. Their phone asks them to log in again.
- **Updating the script** (keeps the same link): paste the new code over the old → **Save** → **Deploy → Manage deployments → ✏ → Version: New version → Deploy**.
  Never **New deployment** (that makes a new link and every phone would lose the company).
