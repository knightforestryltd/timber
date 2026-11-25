// ============================================================================
// COMPANY APPS SCRIPT - one script + one Google Sheet for the whole app
// (Quote / Load Log, Company Sync, Dispatch, Billing, Tickets, Inventory, Drivers)
//
// SET UP (each company does this once, in its own Google account):
//   1. script.google.com -> New project -> paste this file -> Save.
//   2. Deploy -> New deployment -> Web app -> Execute as: Me -> Who has access: Anyone -> Deploy.
//      Authorize (Sheets, Drive for the nightly backup, Mail, Maps for village names).
//   3. Open the app on a phone, paste this ONE link on the Connect screen and follow "Set up your company".
//   A Google Sheet called "Company Data" is created in your Drive with a tab for each part of the app.
//
// UPDATING later (keeps the same link): paste over the code -> Save -> Deploy -> Manage deployments ->
//   pencil -> Version: "New version" -> Deploy.   Never "New deployment" (that makes a new link).
//
// HOW THE PAGES TALK TO IT
//   Every request carries ?svc=sync|loads|tickets|yards|drivers and, for company data, &k=<company key>.
//   A device gets the company key by entering the company password once (Connect / Set up).
//   Changing the company password makes a new key: every device must connect again.
//   Drivers' phones only need the link + their own passcode (no company key).
// ============================================================================
var SCRIPT_VERSION = 1;
var APP = 'company';
var SHEET_NAME = 'Company Data';
var CHUNK = 8000;              // Script Properties hold ~9 KB per value
var KEEP_GPS_DAYS = 365;       // GPS trail + driver logs older than this are removed (loads/tickets/invoices are kept)
var KEEP_BACKUPS = 14;

var LOAD_HEADERS = ['Timestamp', 'Customer Name', 'Phone', 'Address', 'Source Location', 'Species', 'Truck Config', 'Tonnes', 'Cords',
  'One-way km', 'Trip Time', 'Drive Hours', 'Total Hours', 'Fuel Litres', 'Total (incl GST)', 'Status', 'Load ID', 'Net Tonnes', 'Invoice Data', 'Notes'];
var TICKET_HEADERS = ['Ticket', 'Product', 'Customer', 'Source', 'Tare', 'Gross', 'Net', 'Purchase', 'Sale', 'Time', 'Notes'];
var YARD_HEADERS = ['Timestamp', 'Yard', 'Species', 'Type', 'Tonnes', 'Cords', 'Price/Tonne', 'Price/Cord', 'Ticket', 'Notes', 'Source', 'Unit'];
var TABS = {   // keyed tabs (row 1 = these keys)
  Drivers:  ['id', 'name', 'salt', 'hash', 'active', 'licenseNo', 'licenseExpiry', 'licenseLink', 'expenseNotes', 'lastLat', 'lastLon', 'lastPlace', 'lastSeen', 'lastStatus', 'lastUnit', 'phone'],
  Shifts:   ['shiftId', 'driverId', 'driverName', 'date', 'unit', 'startedAt', 'submittedAt', 'status', 'startOdo', 'endOdo', 'onDutyHrs', 'drivingHrs', 'remarks', 'json', 'signature', 'editedAt'],
  Pretrips: ['shiftId', 'driverName', 'unit', 'at', 'result', 'json', 'signature'],
  Positions: ['at', 'driverName', 'unit', 'lat', 'lon', 'place', 'status', 'shiftId', 'kph', 'driverId'],
  Log:      ['at', 'svc', 'action', 'ref', 'detail']
};

/* =============================== basics =============================== */
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function props_() { return PropertiesService.getScriptProperties(); }
function hex_(bytes) { return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join(''); }
function sha_(s) { return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)); }
function parse_(s) { try { return JSON.parse(s); } catch (e) { return null; } }
function cap_(s, n) { s = s == null ? '' : String(s); return s.length > n ? s.slice(0, n) : s; }
function esc_(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
function ms_(v) { if (v instanceof Date) return v.getTime(); var t = Date.parse(v); return isNaN(t) ? 0 : t; }
function iso_(v) { return v instanceof Date ? v.toISOString() : String(v == null ? '' : v); }
function day_(v) { return v instanceof Date ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(v == null ? '' : v); }

/* =============================== company password + key =============================== */
function hasPassword_() { return !!props_().getProperty('companyPwHash'); }
function pwHash_(salt, pw) { return sha_(salt + ':' + String(pw)); }
function checkPw_(pw) {
  var cache = CacheService.getScriptCache(), fails = parseInt(cache.get('pwFails') || '0', 10);
  if (fails >= 10) return { ok: false, locked: true };
  var p = props_(), ok = hasPassword_() && pwHash_(p.getProperty('companyPwSalt') || '', pw == null ? '' : pw) === p.getProperty('companyPwHash');
  if (!ok) cache.put('pwFails', String(fails + 1), 600); else cache.remove('pwFails');
  return { ok: ok, locked: false };
}
function pwFail_(c) { return json_({ status: c.locked ? 'locked' : 'badpassword', v: SCRIPT_VERSION }); }
function companyKey_() { return props_().getProperty('companyKey') || ''; }
// Before a company password exists (first set-up) there is nothing to protect yet.
function keyOk_(k) { if (!hasPassword_()) return true; var ck = companyKey_(); return !!ck && String(k || '') === ck; }
function companyId_() {
  var id = props_().getProperty('companyId');
  if (!id) { id = Utilities.getUuid(); props_().setProperty('companyId', id); }
  return id;
}

/* =============================== company settings blob (Quote page "Company Sync") =============================== */
function readSettings_() {
  var p = props_(), n = parseInt(p.getProperty('companySettings_n') || '0', 10), raw = '';
  for (var i = 0; i < n; i++) raw += (p.getProperty('companySettings_' + i) || '');
  return raw ? (parse_(raw) || {}) : {};
}
function writeSettings_(obj) {
  var p = props_(), raw = JSON.stringify(obj), oldN = parseInt(p.getProperty('companySettings_n') || '0', 10), batch = {}, parts = [];
  for (var i = 0; i < raw.length; i += CHUNK) parts.push(raw.substr(i, CHUNK));
  parts.forEach(function (s, j) { batch['companySettings_' + j] = s; });
  batch.companySettings_n = String(parts.length);
  p.setProperties(batch, false);
  for (var k = parts.length; k < oldN; k++) p.deleteProperty('companySettings_' + k);
}
function rev_() { return parseInt(props_().getProperty('companyRev') || '0', 10) || 0; }
function bumpRev_() { var r = rev_() + 1; props_().setProperty('companyRev', String(r)); return r; }
function meta_() {
  var s = readSettings_(), pr = s.profile || {};
  return { v: SCRIPT_VERSION, app: APP, unified: true, rev: rev_(), hasPassword: hasPassword_(), companyId: companyId_(), companyName: pr.name || s.companyName || '' };
}
// Link fields are derived on each device from this script's own link, so they are never stored.
var LINK_KEYS = ['sheetsUrl', 'sheetsUrlAt', 'syncUrl', 'scriptUrl', 'scriptUrlAt', 'yardUrl', 'yardUrlAt', 'driversUrl', 'driversUrlAt', 'trucksUrl', 'trucksUrlAt', 'movedTo'];

/* =============================== spreadsheet =============================== */
var ss__ = null, tabs__ = {};
function ss_() {
  if (ss__) return ss__;
  var id = props_().getProperty('ssId');
  if (id) { try { ss__ = SpreadsheetApp.openById(id); return ss__; } catch (e) { /* deleted: make a new one */ } }
  ss__ = SpreadsheetApp.create(SHEET_NAME); props_().setProperty('ssId', ss__.getId());
  return ss__;
}
function styleHeader_(rng) { try { rng.setFontWeight('bold').setBackground('#166534').setFontColor('#ffffff'); } catch (e) {} }
function sheet_(name) {
  if (tabs__[name]) return tabs__[name];
  var ss = ss_(), sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (name === 'Loads') {
      sh.getRange(1, 1).setValue('Trip Log');
      try { sh.getRange(1, 1).setFontSize(18).setFontWeight('bold').setFontColor('#166534'); } catch (e) {}
      sh.getRange(4, 1, 1, LOAD_HEADERS.length).setValues([LOAD_HEADERS]); styleHeader_(sh.getRange(4, 1, 1, LOAD_HEADERS.length));
      try { sh.setFrozenRows(4); } catch (e) {}
    } else {
      var head = name === 'Tickets' ? TICKET_HEADERS : name === 'Yards' ? YARD_HEADERS : TABS[name];
      try { sh.getRange(1, 1, sh.getMaxRows(), head.length).setNumberFormat('@'); } catch (e) {}
      sh.getRange(1, 1, 1, head.length).setValues([head]); styleHeader_(sh.getRange(1, 1, 1, head.length));
      try { sh.setFrozenRows(1); } catch (e) {}
    }
    try { var d = ss.getSheetByName('Sheet1'); if (d && ss.getSheets().length > 1) ss.deleteSheet(d); } catch (e) {}
  }
  tabs__[name] = sh;
  return sh;
}
function tab_(name) { return sheet_(name); }
function rows_(name) {
  var sh = tab_(name), cols = TABS[name], last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, cols.length).getValues().map(function (v, i) {
    var o = { _row: i + 2 }; cols.forEach(function (c, j) { o[c] = v[j]; }); return o;
  });
}
function line_(name, o) {
  return TABS[name].map(function (c) {
    var v = o[c]; if (v == null) return '';
    if (v instanceof Date) return (c === 'date' || c === 'licenseExpiry') ? day_(v) : v.toISOString();
    return v;
  });
}
function appendMany_(name, list) {
  if (!list.length) return;
  var sh = tab_(name), r = Math.max(sh.getLastRow() + 1, 2), cols = TABS[name].length, rng = sh.getRange(r, 1, list.length, cols);
  try { rng.setNumberFormat('@'); } catch (e) {}
  rng.setValues(list.map(function (o) { return line_(name, o); }));
}
function append_(name, o) { appendMany_(name, [o]); }
function write_(name, row, o) { var rng = tab_(name).getRange(row, 1, 1, TABS[name].length); try { rng.setNumberFormat('@'); } catch (e) {} rng.setValues([line_(name, o)]); }
function keepRows_(name, keep) {
  var sh = tab_(name), all = rows_(name), cols = TABS[name].length, kept = all.filter(keep);
  if (kept.length === all.length) return 0;
  sh.getRange(2, 1, all.length, cols).clearContent();
  if (kept.length) { var rng = sh.getRange(2, 1, kept.length, cols); try { rng.setNumberFormat('@'); } catch (e) {} rng.setValues(kept.map(function (o) { return line_(name, o); })); }
  return all.length - kept.length;
}
// Change log: who did what, when. The statistics page will read this.
function log_(svc, action, ref, detail) {
  try { append_('Log', { at: new Date().toISOString(), svc: svc, action: action, ref: cap_(ref, 120), detail: cap_(typeof detail === 'string' ? detail : JSON.stringify(detail || ''), 2000) }); } catch (e) {}
}

/* =============================== entry points =============================== */
function doGet(e) {
  var p = (e && e.parameter) || {}, svc = p.svc || (p.settings === '1' ? 'sync' : '');
  try {
    if (svc === 'drivers') return drvGet_(p);
    if (svc === 'sync' || !svc) {
      var m = meta_();
      if (!svc) return json_({ status: 'ok', app: APP, v: SCRIPT_VERSION, unified: true, hasPassword: m.hasPassword, companyName: m.companyName });
      if (!keyOk_(p.k)) return json_({ _meta: m, status: 'nokey' });              // Connect screen: who is this company, is there a password
      var s = readSettings_(); LINK_KEYS.forEach(function (k) { delete s[k]; });
      if (p.profile === '1') return json_({ status: 'ok', profile: s.profile || {}, companyName: m.companyName, _meta: m });
      s._meta = m; return json_(s);
    }
    if (!keyOk_(p.k)) return json_({ status: 'nokey', message: 'This device is not connected to the company (enter the company password on the Quote page).', rows: [] });
    if (svc === 'loads') return json_({ status: 'ok', rows: loadRows_() });
    if (svc === 'tickets') return json_({ rows: ticketRows_() });
    if (svc === 'yards') return json_({ status: 'ok', rows: yardRows_() });
    return json_({ status: 'error', message: 'Unknown part: ' + svc });
  } catch (err) { return json_({ status: 'error', message: String(err), rows: [] }); }
}

function doPost(e) {
  var p = (e && e.parameter) || {}, lock = LockService.getScriptLock(), d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return json_({ status: 'error', message: 'Bad request' }); }
  var svc = p.svc || d.svc || 'sync';
  if (svc === 'drivers') return drvPost_(p, d);
  try {
    lock.waitLock(25000);
    if (svc === 'sync') return syncPost_(p, d);
    if (!keyOk_(p.k || d.k)) return json_({ status: 'nokey', message: 'This device is not connected to the company.' });
    if (svc === 'loads') return loadsPost_(d);
    if (svc === 'tickets') return ticketsPost_(d);
    if (svc === 'yards') return yardsPost_(d);
    return json_({ status: 'error', message: 'Unknown part: ' + svc });
  } catch (err) {
    return json_({ status: 'error', message: String(err) });
  } finally { try { lock.releaseLock(); } catch (e2) {} }
}

/* =============================== sync: password, settings, profile, invoice numbers, import =============================== */
function syncPost_(p, d) {
  var a = d.action;
  if (a === 'checkPassword') {
    if (!hasPassword_()) return json_({ status: 'ok', hasPassword: false, v: SCRIPT_VERSION, unified: true, companyId: companyId_() });
    var c = checkPw_(d.password); if (!c.ok) return pwFail_(c);
    return json_({ status: 'ok', hasPassword: true, v: SCRIPT_VERSION, unified: true, key: companyKey_(), companyId: companyId_(), meta: meta_() });
  }
  if (a === 'setPassword') {
    var np = String(d.newPassword == null ? '' : d.newPassword);
    if (np.length < 4) return json_({ status: 'error', message: 'Password must be at least 4 characters.' });
    var first = !hasPassword_();
    if (!first) { var c2 = checkPw_(d.password); if (!c2.ok) return pwFail_(c2); }
    var salt = Utilities.getUuid(), key = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props_().setProperties({ companyPwSalt: salt, companyPwHash: pwHash_(salt, np), companyKey: key }, false);
    companyId_(); ensureTriggers_();
    log_('sync', first ? 'company created' : 'password changed', '', '');
    return json_({ status: 'ok', v: SCRIPT_VERSION, unified: true, key: key, companyId: companyId_(), meta: meta_() });
  }
  if (a === 'saveSettings') {
    if (hasPassword_()) { var c3 = checkPw_(d.password); if (!c3.ok) return pwFail_(c3); }
    var rev = rev_();
    if (!d.force && d.baseRev != null && rev > 0 && Number(d.baseRev) !== rev) return json_({ status: 'conflict', rev: rev, v: SCRIPT_VERSION });
    var inc = d.settings || {}, cur = readSettings_();
    if (!Array.isArray(inc.locations)) return json_({ status: 'rejected', message: 'No locations list in the save; nothing was changed.' });
    if (inc.locations.length === 0 && Array.isArray(cur.locations) && cur.locations.length > 0 && !d.allowEmpty) return json_({ status: 'rejected', message: 'Refusing to replace saved locations with an empty list.' });
    LINK_KEYS.forEach(function (k) { delete inc[k]; });
    delete inc._meta;
    if (!inc.profile && cur.profile) inc.profile = cur.profile;        // company profile is saved separately (Billing → Settings)
    if (!inc.apiKey && cur.apiKey) inc.apiKey = cur.apiKey;            // a blank Maps key never erases the saved one
    writeSettings_(inc);
    var r2 = bumpRev_(); log_('sync', 'settings saved', 'rev ' + r2, '');
    return json_({ status: 'saved', rev: r2, v: SCRIPT_VERSION });
  }
  if (a === 'saveProfile') {
    if (hasPassword_()) { var c4 = checkPw_(d.password); if (!c4.ok) return pwFail_(c4); }
    var pr = d.profile || {}, s = readSettings_();
    s.profile = { name: cap_(pr.name, 120), gst: cap_(pr.gst, 40), wcb: cap_(pr.wcb, 40), email: cap_(pr.email, 120), phone: cap_(pr.phone, 40),
      addr: cap_(pr.addr, 300), mail: cap_(pr.mail, 300), etNote: cap_(pr.etNote, 300), logo: cap_(pr.logo, 120000) };
    if (pr.name) s.companyName = s.profile.name;
    if (!Array.isArray(s.locations)) s.locations = [];
    writeSettings_(s);
    var r3 = bumpRev_(); log_('sync', 'company info saved', s.profile.name, '');
    return json_({ status: 'saved', rev: r3, profile: s.profile, v: SCRIPT_VERSION });
  }
  if (a === 'nextInvoice') {
    if (!keyOk_(p.k || d.k)) return json_({ status: 'nokey' });
    var ymd = String(d.ymd || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd')).replace(/[^0-9]/g, '').slice(0, 8);
    var n = (parseInt(props_().getProperty('inv_' + ymd) || '0', 10) || 0) + 1;
    props_().setProperty('inv_' + ymd, String(n));
    log_('sync', 'invoice number', ymd + '-' + n, '');
    return json_({ status: 'ok', n: n });
  }
  if (a === 'importOld') {
    if (!hasPassword_()) return json_({ status: 'error', message: 'Set the company password first.' });
    var c5 = checkPw_(d.password); if (!c5.ok) return pwFail_(c5);
    return json_(importOld_(d));
  }
  if (a === 'getLog') {
    if (!keyOk_(p.k || d.k)) return json_({ status: 'nokey' });
    var lg = rows_('Log'); return json_({ status: 'ok', rows: lg.slice(-Math.min(Number(d.limit) || 200, 2000)) });
  }
  return json_({ status: 'error', message: 'Unknown action: ' + a, v: SCRIPT_VERSION });
}

/* =============================== loads (Quote bookings, Dispatch, Billing) =============================== */
function loadRows_() {
  var sh = sheet_('Loads'), last = sh.getLastRow();
  if (last < 5) return [];
  return sh.getRange(5, 1, last - 4, 20).getValues().filter(function (r) { return r[1]; }).map(function (r) {
    return { timestamp: r[0], customerName: r[1], phone: r[2], address: r[3], location: r[4], species: r[5], truck: r[6], tonnes: r[7], cords: r[8],
      km: r[9], duration: r[10], driveHours: r[11], totalHours: r[12], fuelLitres: r[13], total: r[14],
      status: r[15] || 'Pending', loadId: r[16] || '', netTonnes: r[17] || '', invoiceData: r[18] || '', notes: r[19] || '' };
  });
}
function loadsPost_(d) {
  var sh = sheet_('Loads');
  if (d.action === 'updateStatus') { var ok = updateStatus_(sh, d); if (ok) log_('loads', 'status ' + (d.status || ''), d.loadId || d.customerName, { netTonnes: d.netTonnes || '' }); return json_({ status: ok ? 'ok' : 'notfound' }); }
  if (d.action === 'saveInvoice') { var ok2 = saveInvoice_(sh, d); if (ok2) log_('loads', 'invoice saved', d.loadId || d.customerName, ''); return json_({ status: ok2 ? 'ok' : 'notfound' }); }
  if (d.action === 'sendInvoice') {
    var opts = { to: d.to || Session.getEffectiveUser().getEmail(), subject: d.subject || 'Invoice', body: d.body || 'See attached invoice.' };
    if (d.pdfBase64) opts.attachments = [Utilities.newBlob(Utilities.base64Decode(d.pdfBase64), 'application/pdf', d.filename || 'package.pdf')];
    else if (d.html) opts.attachments = [Utilities.newBlob(d.html, 'text/html', (d.filename || 'package') + '.html')];
    MailApp.sendEmail(opts); log_('loads', 'invoice emailed', d.subject || '', opts.to);
    return json_({ status: 'sent', attached: !!(opts.attachments && d.pdfBase64), version: 2 });
  }
  if (d.action) return json_({ status: 'error', message: 'Unknown action: ' + d.action });
  // a booking (no action field)
  var ts = d.timestamp || new Date().toISOString(), next = Math.max(sh.getLastRow() + 1, 5), notes = String(d.notes || '').slice(0, 1000);
  var rows = (d.options || []).map(function (o) {
    return [ts, d.customerName || '', d.phone || '', d.address || '', o.location || '', o.species || '', o.truck || '', o.tonnes || '', o.cords || '', o.km || '',
      o.duration || '', o.driveHours || '', o.totalHours || '', o.fuelLitres || '', o.total || '', 'Pending', '', '', '', notes];
  });
  if (rows.length) sh.getRange(next, 1, rows.length, 20).setValues(rows);
  log_('loads', 'booked', d.customerName || '', rows.length + ' option(s)');
  return json_({ status: 'ok', notesSaved: true });
}
function findRow_(sheet, q) {
  var lastRow = sheet.getLastRow(); if (lastRow < 5) return -1;
  var n = lastRow - 4, vals = sheet.getRange(5, 1, n, 17).getValues();
  var norm = function (v) { return String(v == null ? '' : v).trim().toLowerCase(); };
  var sameTime = function (a, b) { if (!a || !b) return false; if (norm(a) === norm(b)) return true; var ta = new Date(a).getTime(), tb = new Date(b).getTime(); return !isNaN(ta) && !isNaN(tb) && Math.abs(ta - tb) < 1000; };
  if (q.loadId) for (var i = 0; i < n; i++) if (norm(vals[i][16]) === norm(q.loadId)) return i + 5;
  var name = norm(q.customerName);
  if (name) {
    var cands = [];
    for (var j = 0; j < n; j++) { if (norm(vals[j][1]) !== name) continue; if (q.timestamp && !sameTime(vals[j][0], q.timestamp)) continue; cands.push(j); }
    var narrow = function (idx, col, val) { if (!val) return idx; var f = idx.filter(function (x) { return norm(vals[x][col]) === norm(val); }); return f.length ? f : idx; };
    cands = narrow(cands, 4, q.location); cands = narrow(cands, 5, q.species); cands = narrow(cands, 6, q.truck);
    var open = cands.filter(function (x) { return norm(vals[x][15]) !== 'paid' && !norm(vals[x][16]); }); if (open.length) return open[0] + 5;
    var notPaid = cands.filter(function (x) { return norm(vals[x][15]) !== 'paid'; }); if (notPaid.length) return notPaid[0] + 5;
    if (cands.length) return cands[0] + 5;
  }
  return -1;
}
function updateStatus_(sheet, q) {
  var row = findRow_(sheet, q); if (row < 0) return false;
  if (q.status) sheet.getRange(row, 16).setValue(q.status);
  if (q.loadId) sheet.getRange(row, 17).setValue(q.loadId);
  if (q.netTonnes) sheet.getRange(row, 18).setValue(q.netTonnes);
  if (q.invoiceData) sheet.getRange(row, 19).setValue(typeof q.invoiceData === 'string' ? q.invoiceData : JSON.stringify(q.invoiceData));
  return true;
}
function saveInvoice_(sheet, q) {
  var row = findRow_(sheet, q); if (row < 0) return false;
  sheet.getRange(row, 19).setValue(typeof q.invoiceData === 'string' ? q.invoiceData : JSON.stringify(q.invoiceData));
  return true;
}

/* =============================== tickets (scale) =============================== */
function ticketRows_() {
  var sh = sheet_('Tickets'), last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 11).getValues().filter(function (r) { return r[0]; });
}
function ticketsPost_(d) {
  var sh = sheet_('Tickets'), last = sh.getLastRow();
  if (d.action === 'delete' && d.ticket) {
    if (last >= 2) { var nums = sh.getRange(2, 1, last - 1, 1).getValues(); for (var i = nums.length - 1; i >= 0; i--) if (String(nums[i][0]) === String(d.ticket)) sh.deleteRow(i + 2); }
    log_('tickets', 'deleted', d.ticket, ''); return json_({ status: 'deleted' });
  }
  if (d.action === 'edit' && d.row && d.row[0]) {
    if (last >= 2) { var n2 = sh.getRange(2, 1, last - 1, 1).getValues(); for (var j = 0; j < n2.length; j++) if (String(n2[j][0]) === String(d.row[0])) { sh.getRange(j + 2, 1, 1, d.row.length).setValues([d.row]); break; } }
    log_('tickets', 'edited', d.row[0], { net: d.row[6] }); return json_({ status: 'edited' });
  }
  if (d.action === 'save' && d.row) { sh.appendRow(d.row); log_('tickets', 'saved', d.row[0], { net: d.row[6], customer: d.row[2] }); return json_({ status: 'ok' }); }
  return json_({ status: 'unknown' });
}

/* =============================== yards (inventory) =============================== */
function yardRows_() {
  var sh = sheet_('Yards'), last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 12).getValues().filter(function (r) { return r[0]; }).map(function (r) {
    return { timestamp: r[0], yard: r[1], species: r[2], type: r[3], tonnes: r[4], cords: r[5], pricePerTonne: r[6], pricePerCord: r[7], ticket: r[8], notes: r[9], source: r[10], unit: r[11] };
  });
}
function yardsPost_(d) {
  if (d.action === 'add') {
    sheet_('Yards').appendRow([d.timestamp || new Date().toISOString(), d.yard || '', d.species || '', d.type || 'In', d.tonnes || 0, d.cords || 0,
      d.pricePerTonne || 0, d.pricePerCord || 0, d.ticket || '', d.notes || '', d.source || '', d.unit || '']);
    log_('yards', d.type || 'In', d.yard, { species: d.species, tonnes: d.tonnes });
  }
  return json_({ status: 'ok' });
}

/* =============================== nightly backup + clean-up =============================== */
function ensureTriggers_() {
  try {
    var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'nightly'; });
    if (!has) ScriptApp.newTrigger('nightly').timeBased().everyDays(1).atHour(2).create();
  } catch (e) {}
}
// Runs every night: a copy of the whole sheet in Drive (14 kept) + removes GPS/driver records older than 12 months.
function nightly() { backupNow(); purgeOld_(); }
function backupNow() {
  var file = DriveApp.getFileById(ss_().getId()), it = DriveApp.getFoldersByName(SHEET_NAME + ' backups');
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder(SHEET_NAME + ' backups');
  file.makeCopy(SHEET_NAME + ' backup ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'), folder);
  var copies = [], f = folder.getFiles();
  while (f.hasNext()) copies.push(f.next());
  copies.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  copies.slice(KEEP_BACKUPS).forEach(function (c) { c.setTrashed(true); });
}
// Run once from the editor (Run → setup) if you want to authorize and start the nightly backup right away.
function setup() { ss_(); ensureTriggers_(); backupNow(); }
function purgeOld_() {
  var cutoff = Date.now() - KEEP_GPS_DAYS * 86400000, gone = {};
  keepRows_('Shifts', function (s) { var t = ms_(s.submittedAt) || ms_(s.startedAt), keep = s.status === 'Open' || !t || t >= cutoff; if (!keep) gone[String(s.shiftId)] = 1; return keep; });
  keepRows_('Pretrips', function (p) { return !gone[String(p.shiftId)] && (!ms_(p.at) || ms_(p.at) >= cutoff); });
  keepRows_('Positions', function (p) { return !ms_(p.at) || ms_(p.at) >= cutoff; });
}

/* =============================== moving from the old separate scripts =============================== */
// Copies everything from the old scripts into this sheet. Each part is only copied into an EMPTY tab,
// so running it twice never duplicates anything. The old scripts and sheets are not changed.
function importOld_(d) {
  var out = { status: 'ok', settings: false, loads: 0, tickets: 0, yards: 0, drivers: 0, shifts: 0, driverConfig: false, notes: [] };
  var getJ = function (url, extra) {
    var r = UrlFetchApp.fetch(url + (url.indexOf('?') > -1 ? '&' : '?') + (extra || 't=' + Date.now()), { muteHttpExceptions: true, followRedirects: true });
    return parse_(r.getContentText());
  };
  // company settings (locations, prices, trucks, Maps key ...)
  if (d.oldSyncUrl) {
    try {
      var s = getJ(d.oldSyncUrl, 'settings=1');
      if (s && Array.isArray(s.locations)) {
        var cur = readSettings_();
        if (!Array.isArray(cur.locations) || !cur.locations.length) {
          delete s._meta; LINK_KEYS.forEach(function (k) { delete s[k]; });
          if (cur.profile) s.profile = cur.profile;
          writeSettings_(s); bumpRev_(); out.settings = true;
        } else out.notes.push('Settings were already saved here; left as they are.');
      } else out.notes.push('Could not read the old company settings.');
    } catch (e) { out.notes.push('Settings: ' + e); }
  }
  // loads
  if (d.loadsUrl) {
    try {
      var sh = sheet_('Loads');
      if (sh.getLastRow() >= 5) out.notes.push('Loads tab already has data; skipped.');
      else {
        var lj = getJ(d.loadsUrl), rows = (lj && lj.rows || []).map(function (r) {
          return [r.timestamp, r.customerName, r.phone, r.address, r.location, r.species, r.truck, r.tonnes, r.cords, r.km, r.duration, r.driveHours, r.totalHours, r.fuelLitres, r.total, r.status, r.loadId, r.netTonnes, r.invoiceData, r.notes]
            .map(function (v) { return v == null ? '' : v; });
        });
        if (rows.length) sh.getRange(5, 1, rows.length, 20).setValues(rows);
        out.loads = rows.length;
      }
    } catch (e) { out.notes.push('Loads: ' + e); }
  }
  // tickets
  if (d.ticketsUrl) {
    try {
      var ts = sheet_('Tickets');
      if (ts.getLastRow() >= 2) out.notes.push('Tickets tab already has data; skipped.');
      else {
        var tr = ((getJ(d.ticketsUrl) || {}).rows || []).map(function (r) { var a = r.slice(0, 11); while (a.length < 11) a.push(''); return a; });
        if (tr.length) ts.getRange(2, 1, tr.length, 11).setValues(tr);
        out.tickets = tr.length;
      }
    } catch (e) { out.notes.push('Tickets: ' + e); }
  }
  // yards
  if (d.yardsUrl) {
    try {
      var ys = sheet_('Yards');
      if (ys.getLastRow() >= 2) out.notes.push('Yards tab already has data; skipped.');
      else {
        var yr = ((getJ(d.yardsUrl) || {}).rows || []).map(function (r) { return [r.timestamp, r.yard, r.species, r.type, r.tonnes, r.cords, r.pricePerTonne, r.pricePerCord, r.ticket, r.notes, r.source, r.unit].map(function (v) { return v == null ? '' : v; }); });
        if (yr.length) ys.getRange(2, 1, yr.length, 12).setValues(yr);
        out.yards = yr.length;
      }
    } catch (e) { out.notes.push('Yards: ' + e); }
  }
  // drivers: the old "Driver Logs" sheet (same Google account), found by name unless a link is given
  try {
    var src = null;
    if (d.driverLogsSheetUrl) src = SpreadsheetApp.openByUrl(d.driverLogsSheetUrl);
    else { var it = DriveApp.getFilesByName('Driver Logs'); if (it.hasNext()) src = SpreadsheetApp.openById(it.next().getId()); }
    if (src) {
      if (rows_('Shifts').length || rows_('Drivers').length) out.notes.push('Driver tabs already have data; skipped.');
      else ['Drivers', 'Shifts', 'Pretrips', 'Positions'].forEach(function (name) {
        var sh2 = src.getSheetByName(name); if (!sh2 || sh2.getLastRow() < 2) return;
        var vals = sh2.getRange(1, 1, sh2.getLastRow(), sh2.getLastColumn()).getValues(), head = vals[0].map(String);
        var list = vals.slice(1).filter(function (r) { return r.some(function (v) { return v !== ''; }); }).map(function (r) { var o = {}; head.forEach(function (h, i) { o[h] = r[i]; }); return o; });
        appendMany_(name, list);
        if (name === 'Drivers') out.drivers = list.length; if (name === 'Shifts') out.shifts = list.length;
      });
    } else if (d.oldDriversUrl) out.notes.push('No "Driver Logs" sheet found in this Google account.');
  } catch (e) { out.notes.push('Driver logs: ' + e); }
  // drivers settings (units, rules, office email) from the old Drivers script
  if (d.oldDriversUrl && d.oldDriversPassword) {
    try {
      var r = UrlFetchApp.fetch(d.oldDriversUrl, { method: 'post', contentType: 'text/plain', payload: JSON.stringify({ action: 'adminGetConfig', password: d.oldDriversPassword }), muteHttpExceptions: true, followRedirects: true });
      var cj = parse_(r.getContentText());
      if (cj && cj.status === 'ok' && cj.config) { props_().setProperty('drvConfig', JSON.stringify(cj.config)); out.driverConfig = true; }
      else out.notes.push('Old Drivers admin password was not accepted; enter units and rules again in Drivers → Settings.');
    } catch (e) { out.notes.push('Driver settings: ' + e); }
  }
  log_('sync', 'imported from old scripts', '', out);
  return out;
}

/* =============================== DRIVERS =============================== */
// Admin = the company password, or a device that is connected to the company (has the key).
var DRV_RULE_IDS = ['c1', 'c2', 'ab', 'sk'];
var DRV_RULE_KEYS = ['maxDriving', 'maxOnDuty', 'maxElapsed', 'resetOffHours', 'cycleHours', 'cycleDays', 'offCount', 'offHours', 'offDays'];
var DRV_DEFAULT_RULES = {
  v: 3, defaultSet: 'ab',
  c1: { maxDriving: 13, maxOnDuty: 14, maxElapsed: 16, resetOffHours: 8, cycleHours: 70, cycleDays: 7, offCount: 0, offHours: 24, offDays: 24 },
  c2: { maxDriving: 13, maxOnDuty: 14, maxElapsed: 16, resetOffHours: 8, cycleHours: 120, cycleDays: 14, offCount: 0, offHours: 24, offDays: 24 },
  ab: { maxDriving: 13, maxOnDuty: 15, maxElapsed: 0, resetOffHours: 8, cycleHours: 0, cycleDays: 0, offCount: 1, offHours: 24, offDays: 24 },
  sk: { maxDriving: 13, maxOnDuty: 15, maxElapsed: 0, resetOffHours: 8, cycleHours: 0, cycleDays: 0, offCount: 0, offHours: 24, offDays: 24 },
  autoStatus: 1, stillMinutes: 15, offMinutes: 30, driveKph: 40, stillMeters: 100
};
function drvHash_(salt, pw) { return sha_(salt + '|' + pw); }    // same as the old Drivers script, so imported passcodes keep working
function drvConfig_() {
  var c = parse_(props_().getProperty('drvConfig') || '{}') || {}, out = { company: { name: '', address: '', phone: '', officeEmail: '' }, units: c.units || [], rules: JSON.parse(JSON.stringify(DRV_DEFAULT_RULES)) };
  if (c.company) for (var k in c.company) out.company[k] = c.company[k];
  var r = c.rules || {};
  ['autoStatus', 'stillMinutes', 'offMinutes', 'driveKph', 'stillMeters'].forEach(function (x) { if (r[x] != null && r[x] !== '') out.rules[x] = r[x]; });
  if (r.v === 3) {
    if (DRV_RULE_IDS.indexOf(r.defaultSet) > -1) out.rules.defaultSet = r.defaultSet;
    DRV_RULE_IDS.forEach(function (id) { if (r[id]) DRV_RULE_KEYS.forEach(function (k2) { if (r[id][k2] != null && r[id][k2] !== '') out.rules[id][k2] = Number(r[id][k2]); }); });
  }
  // the company profile (Billing → Settings) wins for name / address / phone / office email
  var pr = readSettings_().profile || {};
  if (pr.name) out.company.name = pr.name; if (pr.addr) out.company.address = pr.addr; if (pr.phone) out.company.phone = pr.phone;
  if (!out.company.officeEmail && pr.email) out.company.officeEmail = pr.email;
  return out;
}
function drvAdminOk_(p, d) {
  if (keyOk_(p.k) && hasPassword_()) return { ok: true };
  if (!hasPassword_()) return { ok: false, none: true };
  var c = checkPw_(d.password); return { ok: c.ok, locked: c.locked };
}
function drvLocked_(who) { return Number(CacheService.getScriptCache().get('fail_' + who) || 0) >= 10; }
function drvFail_(who) { var c = CacheService.getScriptCache(); c.put('fail_' + who, String(Number(c.get('fail_' + who) || 0) + 1), 600); }
function drvAuth_(name, pass) {
  var key = 'drv_' + String(name || '').toLowerCase();
  if (drvLocked_(key)) return { locked: true };
  var list = rows_('Drivers');
  for (var i = 0; i < list.length; i++) {
    var d = list[i];
    if (String(d.name).toLowerCase() === String(name || '').toLowerCase() && String(d.active) !== 'false') {
      if (d.hash && drvHash_(d.salt, String(pass || '')) === d.hash) { CacheService.getScriptCache().remove('fail_' + key); return { ok: true, driver: d }; }
      drvFail_(key); return { bad: true };
    }
  }
  drvFail_(key); return { bad: true };
}
function drvAuthFail_(a) { return json_({ status: a.locked ? 'locked' : 'badpassword', v: 3 }); }
function drvPublic_(d) { return { id: d.id, name: d.name, active: String(d.active) !== 'false', phone: String(d.phone || ''), licenseNo: d.licenseNo, licenseExpiry: day_(d.licenseExpiry), licenseLink: d.licenseLink, expenseNotes: d.expenseNotes }; }
function drvAdminView_(d) { var o = drvPublic_(d); o.hasPasscode = !!d.hash; o.lastLat = d.lastLat; o.lastLon = d.lastLon; o.lastPlace = d.lastPlace; o.lastSeen = iso_(d.lastSeen); o.lastStatus = d.lastStatus; o.lastUnit = d.lastUnit; return o; }
function drvFullShift_(row, pretrips) {
  var sh = parse_(row.json) || {};
  if (!sh.pretrip || !sh.pretrip.items) {
    var pt = (pretrips || rows_('Pretrips')).filter(function (p) { return String(p.shiftId) === String(row.shiftId); })[0];
    if (pt) { var pd = parse_(pt.json); if (pd) { sh.pretrip = pd; if (!sh.pretrip.signature) sh.pretrip.signature = pt.signature; } }
  }
  if (!sh.signature && row.signature) sh.signature = row.signature;
  sh.id = sh.id || row.shiftId; sh.driverName = sh.driverName || row.driverName; sh._status = row.status; sh._submittedAt = iso_(row.submittedAt);
  return sh;
}
function drvTombstones_() { return parse_(props_().getProperty('deletedShifts') || '[]') || []; }
function drvPlace_(lat, lon) {
  lat = Number(lat); lon = Number(lon);
  if (!isFinite(lat) || !isFinite(lon)) return { status: 'error', message: 'bad position' };
  var key = 'pl_' + lat.toFixed(2) + '_' + lon.toFixed(2), cache = CacheService.getScriptCache(), hit = cache.get(key); if (hit) return parse_(hit);
  var res = Maps.newGeocoder().reverseGeocode(lat, lon);
  if (!res || res.status !== 'OK') return { status: 'error', message: 'Google Maps: ' + (res && res.status) };
  var want = ['locality', 'sublocality', 'neighborhood', 'administrative_area_level_3', 'colloquial_area'], best = null, prov = '';
  for (var w = 0; w < want.length && !best; w++) for (var i = 0; i < res.results.length && !best; i++) if ((res.results[i].types || []).indexOf(want[w]) > -1) best = res.results[i];
  res.results.some(function (r) { return (r.address_components || []).some(function (c) { if ((c.types || []).indexOf('administrative_area_level_1') > -1) { prov = c.short_name; return true; } return false; }); });
  var out = best ? { status: 'ok', name: best.address_components[0].long_name, prov: prov, lat: best.geometry.location.lat, lon: best.geometry.location.lng, source: 'google' }
    : { status: 'ok', name: res.results[0] ? res.results[0].formatted_address : '', prov: '', lat: lat, lon: lon, source: 'google-address' };
  cache.put(key, JSON.stringify(out), 21600);
  return out;
}
function drvOnBlocks_(shiftRows, since) {
  var list = [], known = 0;
  shiftRows.forEach(function (s) {
    var st = ms_(s.startedAt); if (st && (!known || st < known)) known = st;
    if (s.status === 'Open') return;
    var end = ms_(s.submittedAt) || Date.now(); if (end < since) return;
    var sj = parse_(s.json); if (!sj || !sj.events) return;
    var ev = sj.events.slice().sort(function (a, b) { return ms_(a.t) - ms_(b.t); }), close = sj.closedAt ? ms_(sj.closedAt) : end;
    var first = ev.length ? ms_(ev[0].t) : 0; if (first && (!known || first < known)) known = first;
    for (var i = 0; i < ev.length; i++) { if (ev[i].s !== 'D' && ev[i].s !== 'ON') continue; var a = ms_(ev[i].t), b = i + 1 < ev.length ? ms_(ev[i + 1].t) : close; if (b > a && b >= since) list.push([a, b]); }
  });
  list.sort(function (x, y) { return x[0] - y[0]; });
  var out = []; list.forEach(function (x) { var l = out[out.length - 1]; if (l && x[0] <= l[1]) l[1] = Math.max(l[1], x[1]); else out.push([x[0], x[1]]); });
  return { blocks: out, knownSince: known ? new Date(known).toISOString() : '' };
}
function drvGet_(p) {
  if (p.action === 'drivers') {
    var names = rows_('Drivers').filter(function (d) { return String(d.active) !== 'false' && d.hash; }).map(function (d) { return d.name; });
    return json_({ status: 'ok', v: 3, hasAdmin: hasPassword_(), unified: true, drivers: names, company: drvConfig_().company.name });
  }
  return json_({ status: 'ok', v: 3, hasAdmin: hasPassword_(), unified: true, app: 'drivers' });
}
function drvPost_(p, d) {
  var a = d.action, lock = LockService.getScriptLock();
  try {
    if (a === 'place') {
      var okp = drvAdminOk_(p, d).ok || (d.name && drvAuth_(d.name, d.passcode).ok);
      if (!okp) return json_({ status: 'badpassword' });
      try { return json_(drvPlace_(d.lat, d.lon)); } catch (err) { return json_({ status: 'error', message: String(err) }); }
    }
    lock.waitLock(25000);
    if (a === 'adminSetPassword') return json_({ status: 'error', message: 'Drivers admin uses the company password. Change it on the Quote page → Settings.' });
    if (a && a.indexOf('admin') === 0) {
      var ok = drvAdminOk_(p, d);
      if (!ok.ok) return ok.none ? json_({ status: 'nopassword' }) : drvAuthFail_(ok);
      if (a === 'adminCheck') return json_({ status: 'ok', v: 3 });
      if (a === 'adminGetConfig') { try { var last = Number(props_().getProperty('lastPurge') || 0); if (Date.now() - last > 86400000) { props_().setProperty('lastPurge', String(Date.now())); purgeOld_(); } } catch (e) {} return json_({ status: 'ok', v: 3, config: drvConfig_(), drivers: rows_('Drivers').map(drvAdminView_) }); }
      if (a === 'adminSaveConfig') {
        var raw = parse_(props_().getProperty('drvConfig') || '{}') || {}, inc = d.config || {};
        if (inc.company) raw.company = { name: cap_(inc.company.name, 120), address: cap_(inc.company.address, 300), phone: cap_(inc.company.phone, 40), officeEmail: cap_(inc.company.officeEmail, 120) };
        if (inc.units) raw.units = inc.units.slice(0, 100).map(function (u) { return { id: cap_(u.id, 40) || Utilities.getUuid(), name: cap_(u.name, 60), plate: cap_(u.plate, 20), trailerA: cap_(u.trailerA, 20), trailerB: cap_(u.trailerB, 20), notes: cap_(u.notes, 300) }; });
        if (inc.rules) {
          var cur = drvConfig_().rules, ir = inc.rules; cur.v = 3;
          if (DRV_RULE_IDS.indexOf(ir.defaultSet) > -1) cur.defaultSet = ir.defaultSet;
          ['stillMinutes', 'offMinutes', 'driveKph', 'stillMeters'].forEach(function (k) { var n = Number(ir[k]); if (isFinite(n) && n > 0) cur[k] = n; });
          if (ir.autoStatus != null) cur.autoStatus = ir.autoStatus ? 1 : 0;
          DRV_RULE_IDS.forEach(function (id) { if (ir[id]) DRV_RULE_KEYS.forEach(function (k) { var n = Number(ir[id][k]); if (ir[id][k] !== '' && ir[id][k] != null && isFinite(n) && n >= 0) cur[id][k] = n; }); });
          raw.rules = cur;
        }
        props_().setProperty('drvConfig', JSON.stringify(raw)); log_('drivers', 'settings saved', '', '');
        return json_({ status: 'ok', config: drvConfig_() });
      }
      if (a === 'adminSaveDriver') {
        var dr = d.driver || {}, name = cap_(dr.name, 80).trim();
        if (!name) return json_({ status: 'error', message: 'Driver name is required.' });
        var list = rows_('Drivers'), existing = null;
        list.forEach(function (x) { if (dr.id && String(x.id) === String(dr.id)) existing = x; });
        if (list.some(function (x) { return x !== existing && String(x.name).toLowerCase() === name.toLowerCase(); })) return json_({ status: 'error', message: 'A driver with that name already exists.' });
        var rec = existing || { id: Utilities.getUuid(), active: true };
        rec.name = name; rec.phone = cap_(dr.phone, 30); rec.licenseNo = cap_(dr.licenseNo, 40); rec.licenseExpiry = cap_(dr.licenseExpiry, 20);
        rec.licenseLink = cap_(dr.licenseLink, 500); rec.expenseNotes = cap_(dr.expenseNotes, 1000); rec.active = dr.active === false ? 'false' : 'true';
        if (rec.lastSeen instanceof Date) rec.lastSeen = rec.lastSeen.toISOString();
        if (dr.passcode) { if (String(dr.passcode).length < 4) return json_({ status: 'error', message: 'Passcode must be at least 4 characters.' }); rec.salt = Utilities.getUuid(); rec.hash = drvHash_(rec.salt, String(dr.passcode)); }
        else if (!existing) return json_({ status: 'error', message: 'Create a passcode for the new driver.' });
        if (existing) write_('Drivers', existing._row, rec); else append_('Drivers', rec);
        log_('drivers', existing ? 'driver updated' : 'driver added', name, '');
        return json_({ status: 'ok', drivers: rows_('Drivers').map(drvAdminView_) });
      }
      if (a === 'adminListShifts') {
        var all = rows_('Shifts').reverse();
        if (d.driverId) all = all.filter(function (s) { return String(s.driverId) === String(d.driverId); });
        return json_({ status: 'ok', shifts: all.slice(0, Math.min(Number(d.limit) || 80, 300)).map(function (s) {
          var j = parse_(s.json) || {};
          return { shiftId: s.shiftId, driverId: s.driverId, driverName: s.driverName, date: j.date || day_(s.date), unit: s.unit, status: s.status, startedAt: iso_(s.startedAt), submittedAt: iso_(s.submittedAt), startOdo: s.startOdo, endOdo: s.endOdo, onDutyHrs: s.onDutyHrs, drivingHrs: s.drivingHrs, edited: !!s.editedAt };
        }) });
      }
      if (a === 'adminGetShift') {
        var f = rows_('Shifts').filter(function (s) { return String(s.shiftId) === String(d.shiftId); })[0];
        if (!f) return json_({ status: 'error', message: 'Shift not found.' });
        var fs = drvFullShift_(f);
        return json_({ status: 'ok', shift: fs, row: { status: f.status, submittedAt: iso_(f.submittedAt), signature: f.signature, editedAt: iso_(f.editedAt) }, pretrip: fs.pretrip ? { data: fs.pretrip, signature: fs.pretrip.signature, at: fs.pretrip.at } : null });
      }
      if (a === 'adminSaveShift') {
        var ns = d.shift || {}, row = rows_('Shifts').filter(function (s) { return String(s.shiftId) === String(ns.id); })[0];
        if (!row) return json_({ status: 'error', message: 'Shift not found (it may have been deleted).' });
        var st = d.status === 'Open' || d.status === 'Submitted' ? d.status : row.status;
        ns.adminEditAt = new Date().toISOString(); delete ns._status; delete ns._submittedAt;
        drvSaveShiftRow_(row, ns, { driverId: row.driverId, driverName: row.driverName, status: st, submittedAt: st === 'Submitted' ? (iso_(row.submittedAt) || new Date().toISOString()) : '', editedAt: ns.adminEditAt });
        log_('drivers', 'shift edited by office', row.driverName + ' ' + (ns.date || ''), '');
        return json_({ status: 'ok', editedAt: ns.adminEditAt });
      }
      if (a === 'adminDeleteShift') {
        var sid0 = String(d.shiftId || ''); if (!sid0) return json_({ status: 'error', message: 'Missing shift id.' });
        var n1 = keepRows_('Shifts', function (s) { return String(s.shiftId) !== sid0; });
        keepRows_('Pretrips', function (pp) { return String(pp.shiftId) !== sid0; });
        if (d.withTrail !== false) keepRows_('Positions', function (pp) { return String(pp.shiftId) !== sid0; });
        var t = drvTombstones_(); t.push(sid0); props_().setProperty('deletedShifts', JSON.stringify(t.slice(-300)));
        log_('drivers', 'shift deleted', sid0, '');
        return json_({ status: n1 ? 'ok' : 'error', message: n1 ? '' : 'Shift not found.' });
      }
      if (a === 'adminTrack') {
        var from = ms_(d.from), to = ms_(d.to); if (!from || !to) return json_({ status: 'error', message: 'Missing date range.' });
        var drv0 = rows_('Drivers').filter(function (x) { return String(x.id) === String(d.driverId); })[0];
        if (!drv0) return json_({ status: 'error', message: 'Driver not found.' });
        var pts = rows_('Positions').filter(function (pp) { var tt = ms_(pp.at); return tt >= from && tt < to && (String(pp.driverId) === String(drv0.id) || (!pp.driverId && String(pp.driverName) === String(drv0.name))); })
          .map(function (pp) { return { at: iso_(pp.at), lat: Number(pp.lat), lon: Number(pp.lon), place: pp.place, status: pp.status, unit: pp.unit, kph: pp.kph === '' ? null : Number(pp.kph), shiftId: pp.shiftId }; });
        var pret = rows_('Pretrips');
        var shifts = rows_('Shifts').filter(function (s) { if (String(s.driverId) !== String(drv0.id)) return false; var a0 = ms_(s.startedAt) - 2 * 86400000, b0 = s.status === 'Open' ? Date.now() : (ms_(s.submittedAt) || Date.now()); return a0 < to && b0 >= from; })
          .map(function (s) { return drvFullShift_(s, pret); });
        return json_({ status: 'ok', driver: drvAdminView_(drv0), points: pts, shifts: shifts });
      }
      return json_({ status: 'error', message: 'Unknown action: ' + a });
    }

    if (a === 'driverLogin' || a === 'saveShift' || a === 'submitShift' || a === 'driverHistory') {
      var au = drvAuth_(d.name, d.passcode); if (!au.ok) return drvAuthFail_(au);
      var drv = au.driver, cfg = drvConfig_();
      if (a === 'driverLogin') {
        var mine = rows_('Shifts').filter(function (s) { return String(s.driverId) === String(drv.id); });
        var open = mine.filter(function (s) { return s.status === 'Open'; }).pop(), cutoff = Date.now() - 16 * 86400000, days = {}, lastClose = '';
        mine.forEach(function (s) {
          if (s.status !== 'Submitted') return;
          var sj = parse_(s.json); if (sj && sj.closedAt && ms_(sj.closedAt) > ms_(lastClose)) lastClose = sj.closedAt;
          if (sj && sj.days) sj.days.forEach(function (x) { if (new Date(x.date + 'T12:00:00').getTime() >= cutoff) { days[x.date] = days[x.date] || { onDuty: 0, driving: 0 }; days[x.date].onDuty += Number(x.onDuty) || 0; days[x.date].driving += Number(x.driving) || 0; } });
        });
        var allOdo = {}, odoAt = {};
        rows_('Shifts').forEach(function (s) { if (s.status !== 'Submitted' || !s.unit || s.endOdo === '') return; var tt = ms_(s.submittedAt); if (!odoAt[s.unit] || tt >= odoAt[s.unit]) { allOdo[s.unit] = s.endOdo; odoAt[s.unit] = tt; } });
        var ob = drvOnBlocks_(mine, Date.now() - 40 * 86400000);
        return json_({ status: 'ok', v: 3, driver: drvPublic_(drv), company: cfg.company, units: cfg.units, rules: cfg.rules, history: days, unitOdo: allOdo, lastClose: lastClose, openShift: open ? drvFullShift_(open) : null, onBlocks: ob.blocks, knownSince: ob.knownSince });
      }
      if (a === 'driverHistory') {
        var since = Date.now() - Math.min(Number(d.days) || 15, 31) * 86400000, pret2 = rows_('Pretrips');
        return json_({ status: 'ok', v: 3, shifts: rows_('Shifts').filter(function (s) { return String(s.driverId) === String(drv.id) && (s.status === 'Open' || (ms_(s.submittedAt) || ms_(s.startedAt)) >= since); }).map(function (s) { return drvFullShift_(s, pret2); }) });
      }
      var sh = d.shift || {}, sid = cap_(sh.id, 80);
      if (!sid) return json_({ status: 'error', message: 'Missing shift id.' });
      if (drvTombstones_().indexOf(sid) > -1) return json_({ status: 'deleted', message: 'The office deleted this shift.' });
      var found = null, otherOpen = null;
      rows_('Shifts').forEach(function (s) { if (String(s.shiftId) === sid) found = s; else if (String(s.driverId) === String(drv.id) && s.status === 'Open') otherOpen = s; });
      if (!found && otherOpen) return json_({ status: 'blocked', message: 'Submit your open shift before starting a new one.', openShift: drvFullShift_(otherOpen) });
      if (found && found.status === 'Submitted') return json_({ status: 'ok', alreadySubmitted: true });
      drvSavePoints_(drv, d.pts, sid, sh.unit);
      if (d.pos) drvLastSeen_(drv, d.pos, sh.unit);
      if (found) { var srv = parse_(found.json) || {}; if (srv.adminEditAt && srv.adminEditAt !== sh.adminEditAt) return json_({ status: 'replaced', message: 'The office edited this shift. This phone now has the office copy.', shift: drvFullShift_(found) }); }
      var isSubmit = a === 'submitShift';
      if (isSubmit) {
        var missing = [];
        if (!String(sh.remarks || '').trim()) missing.push('closing remarks');
        if (sh.endOdo === '' || sh.endOdo == null) missing.push('ending odometer');
        if (!sh.signature) missing.push('signature');
        if (missing.length) return json_({ status: 'error', message: 'Missing: ' + missing.join(', ') + '.' });
      }
      drvSaveShiftRow_(found, sh, { driverId: drv.id, driverName: drv.name, status: isSubmit ? 'Submitted' : 'Open', submittedAt: isSubmit ? new Date().toISOString() : '' });
      if (!found) log_('drivers', 'shift started', drv.name + ' ' + (sh.unit || ''), '');
      var emailed = false, emailError = '';
      if (isSubmit) { log_('drivers', 'shift submitted', drv.name + ' ' + (sh.date || ''), { drivingHrs: sh.drivingHrs, onDutyHrs: sh.onDutyHrs, km: (Number(sh.endOdo) || 0) - (Number(sh.startOdo) || 0) }); try { emailed = drvEmail_(cfg, drv, sh, d.pdfBase64); } catch (err) { emailError = String(err); } }
      return json_({ status: 'ok', v: 3, submitted: isSubmit, emailed: emailed, emailError: emailError });
    }
    return json_({ status: 'error', message: 'Unknown action: ' + a });
  } catch (err) { return json_({ status: 'error', message: String(err) }); }
  finally { try { lock.releaseLock(); } catch (e) {} }
}
function drvSaveShiftRow_(found, sh, meta) {
  var sid = String(sh.id), js = JSON.stringify(sh);
  if (js.length > 45000) { var slim = JSON.parse(js); slim.signature = ''; slim.pretrip = sh.pretrip ? { done: true, at: sh.pretrip.at, defects: sh.pretrip.defects, defectNote: sh.pretrip.defectNote, defectList: sh.pretrip.defectList, note: 'detail stored in Pretrips tab' } : null; js = JSON.stringify(slim); }
  var rec = { shiftId: sid, driverId: meta.driverId, driverName: meta.driverName, date: cap_(sh.date, 12), unit: cap_(sh.unit, 60), startedAt: cap_(sh.startedAt, 40), submittedAt: meta.submittedAt || '', status: meta.status,
    startOdo: sh.startOdo == null ? '' : sh.startOdo, endOdo: sh.endOdo == null ? '' : sh.endOdo, onDutyHrs: Number(sh.onDutyHrs) || 0, drivingHrs: Number(sh.drivingHrs) || 0, remarks: cap_(sh.remarks, 2000), json: js,
    signature: sh.signature ? cap_(sh.signature, 40000) : '', editedAt: meta.editedAt || (found ? iso_(found.editedAt) : '') };
  if (found) write_('Shifts', found._row, rec); else append_('Shifts', rec);
  if (sh.pretrip && sh.pretrip.done && sh.pretrip.items) {
    var pf = rows_('Pretrips').filter(function (pp) { return String(pp.shiftId) === sid; })[0];
    var prec = { shiftId: sid, driverName: meta.driverName, unit: rec.unit, at: cap_(sh.pretrip.at, 40), result: sh.pretrip.defects ? 'DEFECTS' : 'OK', json: cap_(JSON.stringify(sh.pretrip), 45000), signature: cap_(sh.pretrip.signature, 40000) };
    if (pf) write_('Pretrips', pf._row, prec); else append_('Pretrips', prec);
  }
}
function drvSavePoints_(drv, pts, sid, unit) {
  if (!pts || !pts.length) return;
  appendMany_('Positions', pts.slice(0, 500).filter(function (pp) { return pp && isFinite(Number(pp.lat)) && isFinite(Number(pp.lon)); }).map(function (pp) {
    return { at: cap_(pp.t, 40), driverName: drv.name, unit: cap_(pp.unit || unit, 60), lat: Number(pp.lat), lon: Number(pp.lon), place: cap_(pp.place, 120), status: cap_(pp.s, 4), shiftId: cap_(pp.shiftId || sid, 80), kph: pp.kph == null ? '' : Math.round(Number(pp.kph)), driverId: drv.id };
  }));
}
function drvLastSeen_(drv, pos, unit) {
  if (!isFinite(Number(pos.lat)) || !isFinite(Number(pos.lon))) return;
  var r = rows_('Drivers').filter(function (x) { return String(x.id) === String(drv.id); })[0]; if (!r) return;
  r.lastLat = Number(pos.lat); r.lastLon = Number(pos.lon); r.lastPlace = cap_(pos.place, 120); r.lastSeen = cap_(pos.at, 40) || new Date().toISOString(); r.lastStatus = cap_(pos.status, 20); r.lastUnit = cap_(unit, 60);
  write_('Drivers', r._row, r);
}
function drvEmail_(cfg, drv, sh, pdfBase64) {
  var to = cfg.company.officeEmail; if (!to) return false;
  var ev = (sh.events || []).slice().sort(function (a, b) { return ms_(a.t) - ms_(b.t); }).map(function (x) { return '<tr><td>' + esc_(x.hm || x.t) + '</td><td>' + esc_(x.label || x.s) + (x.edited ? ' *' : '') + '</td><td>' + esc_(x.place || '') + '</td><td>' + esc_(x.note || '') + '</td></tr>'; }).join('');
  var pre = sh.pretrip && sh.pretrip.done ? (sh.pretrip.defects ? 'DEFECTS REPORTED: ' + esc_((sh.pretrip.defectList || []).join(', ')) + ' - ' + esc_(sh.pretrip.defectNote || '') : 'Pre-trip completed, no defects') : 'No pre-trip recorded';
  var html = '<div style="font-family:Arial,sans-serif;font-size:14px"><h2>' + esc_(cfg.company.name) + ' - Driver Daily Log</h2>' + (pdfBase64 ? '<p>The signed daily log (graph and pre-trip) is attached as a PDF.</p>' : '') +
    '<p><b>Driver:</b> ' + esc_(drv.name) + '<br><b>Unit:</b> ' + esc_(sh.unit) + ' &nbsp; <b>Plate:</b> ' + esc_(sh.plate) + ' &nbsp; <b>Trailers:</b> ' + esc_(sh.trailerA) + ' ' + esc_(sh.trailerB) + '<br><b>Date:</b> ' + esc_(sh.date) +
    '<br><b>Odometer:</b> ' + esc_(sh.startOdo) + ' to ' + esc_(sh.endOdo) + '<br><b>Driving:</b> ' + esc_(sh.drivingHrs) + ' h &nbsp; <b>On duty:</b> ' + esc_(sh.onDutyHrs) + ' h</p><p><b>Pre-trip:</b> ' + pre + '</p>' +
    '<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse"><tr><th>Time</th><th>Status</th><th>Location</th><th>Note</th></tr>' + ev + '</table><p><b>Closing remarks:</b> ' + esc_(sh.remarks) + '</p></div>';
  var opts = { to: to, subject: 'Driver log - ' + drv.name + ' - ' + sh.date + ' - ' + sh.unit, htmlBody: html, name: cfg.company.name || 'Driver log' };
  if (pdfBase64) opts.attachments = [Utilities.newBlob(Utilities.base64Decode(String(pdfBase64)), 'application/pdf', 'Driver log ' + drv.name + ' ' + sh.date + '.pdf')];
  MailApp.sendEmail(opts);
  return true;
}
