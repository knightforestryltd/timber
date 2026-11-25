// Load Sheet Apps Script  -  v3
// v3 = v2 (bookings, dispatch status, billing, invoice email: UNCHANGED) plus:
//   * company password (stored only as a salted SHA-256 hash)
//   * password-protected saveSettings, with stale-save (revision) and empty-save protection
//   * settings stored in chunks so large location lists never hit the 9 KB property limit
//
// HOW TO UPDATE THE LIVE SCRIPT WITHOUT CHANGING ITS URL:
//   Paste this over the old code -> Deploy -> Manage deployments -> pencil icon ->
//   Version: "New version" -> Deploy.   (Do NOT choose "New deployment": that makes a new URL.)
//
// Deploy as Web app: Execute as Me, Who has access: Anyone.
// The "Trip Log" spreadsheet is created automatically the first time a load is booked.
// (Opening the app or loading settings before that does NOT create it.)

const SCRIPT_VERSION = 3;
const CHUNK = 8000;            // Script Properties allow ~9 KB per value

function props_() { return PropertiesService.getScriptProperties(); }

function readSettings_() {
  const p = props_();
  const n = parseInt(p.getProperty('companySettings_n') || '0', 10);
  let raw = '';
  if (n > 0) {
    for (let i = 0; i < n; i++) raw += (p.getProperty('companySettings_' + i) || '');
  } else {
    raw = p.getProperty('companySettings') || '';          // v2 format
  }
  try { return raw ? JSON.parse(raw) : {}; } catch (e) { return {}; }
}

function writeSettings_(obj) {
  const p = props_();
  const raw = JSON.stringify(obj);
  const oldN = parseInt(p.getProperty('companySettings_n') || '0', 10);
  const parts = [];
  for (let i = 0; i < raw.length; i += CHUNK) parts.push(raw.substr(i, CHUNK));
  const batch = {};
  parts.forEach((s, i) => { batch['companySettings_' + i] = s; });
  batch['companySettings_n'] = String(parts.length);
  p.setProperties(batch, false);
  for (let i = parts.length; i < oldN; i++) p.deleteProperty('companySettings_' + i);
  p.deleteProperty('companySettings');                      // retire the v2 single-value copy
}

function bytesToHex_(bytes) {
  return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}
function hashPw_(salt, pw) {
  return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + String(pw), Utilities.Charset.UTF_8));
}
function hasPassword_() { return !!props_().getProperty('companyPwHash'); }

// Returns { ok, locked }. 10 wrong tries in 10 minutes pauses password checks for everyone.
function checkPw_(pw) {
  const cache = CacheService.getScriptCache();
  const fails = parseInt(cache.get('pwFails') || '0', 10);
  if (fails >= 10) return { ok: false, locked: true };
  const p = props_();
  const salt = p.getProperty('companyPwSalt') || '';
  const ok = !!p.getProperty('companyPwHash') && hashPw_(salt, pw == null ? '' : pw) === p.getProperty('companyPwHash');
  if (!ok) cache.put('pwFails', String(fails + 1), 600);
  else cache.remove('pwFails');
  return { ok: ok, locked: false };
}

function currentRev_() { return parseInt(props_().getProperty('companyRev') || '0', 10) || 0; }

function getSheet(createIfMissing) {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('sheetId');
  if (id) {
    try { return SpreadsheetApp.openById(id).getSheets()[0]; } catch (e) { /* deleted or no access: fall through */ }
  }
  if (!createIfMissing) return null;
  const ss = SpreadsheetApp.create('Trip Log');
  props.setProperty('sheetId', ss.getId());
  const sheet = ss.getSheets()[0];
  setupSheet(sheet);
  return sheet;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  if (e && e.parameter && e.parameter.settings === '1') {
    const saved = readSettings_();
    saved._meta = { v: SCRIPT_VERSION, rev: currentRev_(), hasPassword: hasPassword_() };
    return ContentService.createTextOutput(JSON.stringify(saved)).setMimeType(ContentService.MimeType.JSON);
  }
  const sheet = getSheet(false);
  if (!sheet || sheet.getLastRow() < 5) return json({ status: 'ok', rows: [] });
  const lastRow = sheet.getLastRow();
  const data = sheet.getRange(5, 1, lastRow - 4, Math.min(20, sheet.getMaxColumns())).getValues();
  const rows = data.filter(r => r[1]).map(r => ({
    timestamp: r[0], customerName: r[1], phone: r[2], address: r[3],
    location: r[4], species: r[5], truck: r[6], tonnes: r[7], cords: r[8],
    km: r[9], duration: r[10], driveHours: r[11], totalHours: r[12],
    fuelLitres: r[13], total: r[14],
    status: r[15] || 'Pending', loadId: r[16] || '', netTonnes: r[17] || '', invoiceData: r[18] || '', notes: r[19] || ''
  }));
  return json({ status: 'ok', rows: rows });
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const isBooking = !data.action;                 // a booking has no action field
    const sheet = getSheet(isBooking);              // created here on the very first booking

    if (data.action === 'checkPassword') {
      if (!hasPassword_()) return json({ status: 'ok', hasPassword: false, v: SCRIPT_VERSION });
      const c = checkPw_(data.password);
      return json({ status: c.ok ? 'ok' : (c.locked ? 'locked' : 'badpassword'), hasPassword: true, v: SCRIPT_VERSION });
    }

    if (data.action === 'setPassword') {
      const lock = LockService.getScriptLock();
      lock.waitLock(10000);
      try {
        const np = String(data.newPassword == null ? '' : data.newPassword);
        if (np.length < 4) return json({ status: 'error', message: 'Password must be at least 4 characters.', v: SCRIPT_VERSION });
        if (hasPassword_()) {
          const c = checkPw_(data.password);
          if (!c.ok) return json({ status: c.locked ? 'locked' : 'badpassword', v: SCRIPT_VERSION });
        }
        const salt = Utilities.getUuid();
        props_().setProperties({ companyPwSalt: salt, companyPwHash: hashPw_(salt, np) }, false);
        return json({ status: 'ok', v: SCRIPT_VERSION });
      } finally { lock.releaseLock(); }
    }

    if (data.action === 'saveSettings') {
      const lock = LockService.getScriptLock();
      lock.waitLock(10000);
      try {
        if (hasPassword_()) {
          const c = checkPw_(data.password);
          if (!c.ok) return json({ status: c.locked ? 'locked' : 'badpassword', v: SCRIPT_VERSION });
        }
        const rev = currentRev_();
        if (!data.force && data.baseRev != null && rev > 0 && Number(data.baseRev) !== rev) {
          return json({ status: 'conflict', rev: rev, v: SCRIPT_VERSION });
        }
        const inc = data.settings || {};
        const cur = readSettings_();
        if (!Array.isArray(inc.locations)) {
          return json({ status: 'rejected', message: 'No locations list in the save; nothing was changed.', v: SCRIPT_VERSION });
        }
        if (inc.locations.length === 0 && Array.isArray(cur.locations) && cur.locations.length > 0 && !data.allowEmpty) {
          return json({ status: 'rejected', message: 'Refusing to replace saved locations with an empty list.', v: SCRIPT_VERSION });
        }
        // A blank link or key never erases a saved one.
        ['apiKey', 'scriptUrl', 'yardUrl', 'sheetsUrl'].forEach(k => {
          if (!inc[k] && cur[k]) { inc[k] = cur[k]; if (cur[k + 'At'] != null) inc[k + 'At'] = cur[k + 'At']; }
        });
        delete inc._meta;
        writeSettings_(inc);
        props_().setProperty('companyRev', String(rev + 1));
        return json({ status: 'saved', rev: rev + 1, v: SCRIPT_VERSION });
      } finally { lock.releaseLock(); }
    }

    if (data.action === 'updateStatus') {
      const found = sheet ? updateStatus(sheet, data) : false;
      return ContentService.createTextOutput(JSON.stringify({ status: found ? 'ok' : 'notfound' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (data.action === 'saveInvoice') {
      const found = sheet ? saveInvoice(sheet, data) : false;
      return ContentService.createTextOutput(JSON.stringify({ status: found ? 'ok' : 'notfound' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (data.action === 'sendInvoice') {
      const to = data.to || Session.getEffectiveUser().getEmail();
      const subject = data.subject || 'Invoice';
      const body = data.body || 'See attached invoice.';
      const options = { to: to, subject: subject, body: body };
      if (data.pdfBase64) {
        options.attachments = [Utilities.newBlob(Utilities.base64Decode(data.pdfBase64), 'application/pdf', data.filename || 'package.pdf')];
      } else if (data.html) {
        options.attachments = [Utilities.newBlob(data.html, 'text/html', (data.filename || 'package') + '.html')];
      }
      MailApp.sendEmail(options);
      return json({ status: 'sent', attached: !!(options.attachments && options.attachments.length && data.pdfBase64), version: 2 });
    }

    if (data.action) return json({ status: 'error', message: 'Unknown action: ' + data.action, v: SCRIPT_VERSION });

    const timestamp = data.timestamp || new Date().toISOString();
    const name = data.customerName || '';
    const phone = data.phone || '';
    const address = data.address || '';
    let nextRow = Math.max(sheet.getLastRow() + 1, 5);
    const notes = String(data.notes || '').slice(0, 1000);
    ensureNotesHeader_(sheet);

    (data.options || []).forEach(opt => {
      sheet.getRange(nextRow, 1, 1, 20).setValues([[
        timestamp, name, phone, address,
        opt.location || '', opt.species || '', opt.truck || '',
        opt.tonnes || '', opt.cords || '', opt.km || '',
        opt.duration || '', opt.driveHours || '', opt.totalHours || '',
        opt.fuelLitres || '', opt.total || '',
        'Pending', '', '', '', notes
      ]]);
      nextRow++;
    });

    return ContentService.createTextOutput(JSON.stringify({ status: 'ok', notesSaved: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Finds the sheet row for a load. Priority: Load ID, then customer+timestamp(+option), then customer only.
function findRow(sheet, q) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 5) return -1;
  const n = lastRow - 4;
  const vals = sheet.getRange(5, 1, n, 17).getValues();   // A..Q
  const norm = v => String(v == null ? '' : v).trim().toLowerCase();
  const sameTime = (a, b) => {
    if (!a || !b) return false;
    if (norm(a) === norm(b)) return true;
    const ta = new Date(a).getTime(), tb = new Date(b).getTime();
    return !isNaN(ta) && !isNaN(tb) && Math.abs(ta - tb) < 1000;
  };
  // 1) Load ID (col Q)
  if (q.loadId) {
    for (let i = 0; i < n; i++) if (norm(vals[i][16]) === norm(q.loadId)) return i + 5;
  }
  // 2) customer + timestamp, narrowed by location/species/truck when given
  const name = norm(q.customerName);
  if (name) {
    let cands = [];
    for (let i = 0; i < n; i++) {
      if (norm(vals[i][1]) !== name) continue;
      if (q.timestamp && !sameTime(vals[i][0], q.timestamp)) continue;
      cands.push(i);
    }
    const narrow = (idx, col, val) => { if (!val) return idx; const f = idx.filter(i => norm(vals[i][col]) === norm(val)); return f.length ? f : idx; };
    cands = narrow(cands, 4, q.location);
    cands = narrow(cands, 5, q.species);
    cands = narrow(cands, 6, q.truck);
    // prefer a row that is not Paid and has no Load ID yet
    const open = cands.filter(i => norm(vals[i][15]) !== 'paid' && !norm(vals[i][16]));
    if (open.length) return open[0] + 5;
    const notPaid = cands.filter(i => norm(vals[i][15]) !== 'paid');
    if (notPaid.length) return notPaid[0] + 5;
    if (cands.length) return cands[0] + 5;
  }
  return -1;
}

function updateStatus(sheet, q) {
  const row = findRow(sheet, q);
  if (row < 0) return false;
  if (q.status) sheet.getRange(row, 16).setValue(q.status);
  if (q.loadId) sheet.getRange(row, 17).setValue(q.loadId);
  if (q.netTonnes) sheet.getRange(row, 18).setValue(q.netTonnes);
  if (q.invoiceData) sheet.getRange(row, 19).setValue(typeof q.invoiceData === 'string' ? q.invoiceData : JSON.stringify(q.invoiceData));
  return true;
}

function saveInvoice(sheet, q) {
  const row = findRow(sheet, q);
  if (row < 0) return false;
  sheet.getRange(row, 19).setValue(typeof q.invoiceData === 'string' ? q.invoiceData : JSON.stringify(q.invoiceData));
  return true;
}

// Adds the "Notes" heading in column T the first time a booking with the new script arrives.
function ensureNotesHeader_(sheet) {
  try {
    if (sheet.getMaxColumns() < 20) sheet.insertColumnsAfter(sheet.getMaxColumns(), 20 - sheet.getMaxColumns());
    const c = sheet.getRange(4, 20);
    if (!c.getValue()) {
      c.setValue('Notes').setFontWeight('bold').setBackground('#166534').setFontColor('#ffffff').setHorizontalAlignment('center');
    }
  } catch (e) {}
}

function setupSheet(sheet) {
  sheet.getRange('A1').setValue('Trip Log');
  sheet.getRange('A1').setFontSize(18).setFontWeight('bold').setFontColor('#166534');
  sheet.getRange('A1:S1').merge();
  const headers = [
    'Timestamp', 'Customer Name', 'Phone', 'Address',
    'Source Location', 'Species', 'Truck Config', 'Tonnes', 'Cords',
    'One-way km', 'Trip Time', 'Drive Hours', 'Total Hours', 'Fuel Litres',
    'Total (incl GST)', 'Status', 'Load ID', 'Net Tonnes', 'Invoice Data'
  ];
  sheet.getRange(4, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(4, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground('#166534')
    .setFontColor('#ffffff')
    .setHorizontalAlignment('center');
  sheet.setFrozenRows(4);
  sheet.getRange(4, 1, 1, headers.length).createFilter();
  sheet.autoResizeColumns(1, headers.length);
}
