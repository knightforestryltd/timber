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
var SCRIPT_VERSION = 14;     // pages check v >= 14 for the Trucks / Statistics / admin-token features
var APP = 'company';
var SHEET_NAME = 'Company Data';
var CHUNK = 8000;              // Script Properties hold ~9 KB per value
var KEEP_GPS_DAYS = 365;       // GPS trail + driver logs older than this are removed (loads/tickets/invoices are kept)
var KEEP_BACKUPS = 14;

var LOAD_HEADERS = ['Timestamp', 'Customer Name', 'Phone', 'Address', 'Source Location', 'Species', 'Truck Config', 'Tonnes', 'Cords',
  'One-way km', 'Trip Time', 'Drive Hours', 'Total Hours', 'Fuel Litres', 'Total (incl GST)', 'Status', 'Load ID', 'Net Tonnes', 'Invoice Data', 'Notes'];
var TICKET_HEADERS = ['Ticket', 'Product', 'Customer', 'Source', 'Tare', 'Gross', 'Net', 'Purchase', 'Sale', 'Time', 'Notes'];
var YARD_HEADERS = ['Timestamp', 'Yard', 'Species', 'Type', 'Tonnes', 'Cords', 'Price/Tonne', 'Price/Cord', 'Ticket', 'Notes', 'Source', 'Unit'];
// v14: new columns are only ever added on the RIGHT. Columns A..T (Loads) and A..L (Yards) never move.
var LOAD_HEADERS_V14 = ['Quoted Total', 'Price Adj', 'Adj Reason', 'Billed Hours', 'Booking ID', 'Product', 'Requested Date', 'Unit ID', 'Driver Name',
  'Booking Data', 'Empty Out km', 'Empty Out h', 'Loaded km', 'Loaded h', 'Empty Back km', 'Empty Back h', 'Empty Fuel L'];
var LOAD_ALL = LOAD_HEADERS.concat(LOAD_HEADERS_V14);              // 37 columns
var YARD_HEADERS_V14 = ['Product', 'CostPerTonne', 'CostPerCord', 'HaulCost', 'ProcessId', 'Status', 'LoadId', 'PendingTonnes', 'EntryId', 'By'];
var YARD_ALL = YARD_HEADERS.concat(YARD_HEADERS_V14);              // 22 columns
var TABS = {   // keyed tabs (row 1 = these keys). New keys go at the END of each list only.
  Drivers:  ['id', 'name', 'salt', 'hash', 'active', 'licenseNo', 'licenseExpiry', 'licenseLink', 'expenseNotes', 'lastLat', 'lastLon', 'lastPlace', 'lastSeen', 'lastStatus', 'lastUnit', 'phone',
    'roles', 'tokenVer'],
  Shifts:   ['shiftId', 'driverId', 'driverName', 'date', 'unit', 'startedAt', 'submittedAt', 'status', 'startOdo', 'endOdo', 'onDutyHrs', 'drivingHrs', 'remarks', 'json', 'signature', 'editedAt',
    'shiftType', 'startHours', 'endHours', 'unitId'],
  Pretrips: ['shiftId', 'driverName', 'unit', 'at', 'result', 'json', 'signature'],
  Positions: ['at', 'driverName', 'unit', 'lat', 'lon', 'place', 'status', 'shiftId', 'kph', 'driverId'],
  Log:      ['at', 'svc', 'action', 'ref', 'detail'],
  Places:   ['address', 'place', 'lat', 'lon', 'at'],       // delivery addresses already looked up (village + nearest city)
  // ---- v14: Trucks & Equipment ----
  Units:    ['id', 'type', 'name', 'unitNo', 'plate', 'vin', 'year', 'make', 'model', 'purchaseDate', 'purchasePrice', 'trackHours', 'currentOdo', 'currentHours', 'regExpiry', 'insExpiry', 'cvipExpiry',
    'status', 'outReason', 'notes', 'photo', 'updatedAt', 'pricingUnit', 'hasCrane', 'fuelBurnLph', 'fuelType', 'wearPerHour', 'pmOverrides', 'homeBase', 'trailerA', 'trailerB', 'oosOverride'],
  WorkOrders: ['id', 'unitId', 'unitName', 'openedAt', 'source', 'shiftId', 'driverName', 'defect', 'severity', 'status', 'where', 'shopName', 'mechanicName', 'mechHours', 'mechRate', 'laborCost',
    'partsCost', 'shopLabor', 'shopParts', 'gst', 'total', 'odoAt', 'hoursAt', 'closedAt', 'closedBy', 'workDone', 'invoicePhoto', 'downDays', 'notes', 'inspectionId', 'itemName', 'photo', 'woKey', 'seenAt', 'seenBy'],
  WOParts:  ['woId', 'at', 'part', 'qty', 'unitCost', 'total', 'vendor', 'receiptPhoto', 'id'],
  ServicePlans: ['id', 'unitId', 'task', 'everyKm', 'everyHours', 'everyDays', 'lastDoneAt', 'lastDoneOdo', 'lastDoneHours', 'notes'],
  UnitReadings: ['at', 'unitId', 'unitName', 'odo', 'hours', 'source', 'shiftId', 'by', 'id'],
  Inspections: ['id', 'unitId', 'unitName', 'template', 'doneAt', 'doneBy', 'role', 'odo', 'hours', 'result', 'itemsJson', 'measurementsJson', 'signature', 'notes', 'woIds'],
  InspectionTemplates: ['id', 'name', 'appliesTo', 'intervalHours', 'intervalKm', 'intervalDays', 'includesTemplateId', 'itemsJson', 'active'],
  // ---- v14: Money ----
  Expenses: ['id', 'at', 'date', 'amount', 'gst', 'total', 'category', 'vendor', 'payMethod', 'unitId', 'driverName', 'loadId', 'yard', 'recurringId', 'source', 'sourceRef', 'note', 'receiptPhoto', 'by'],
  Recurring: ['id', 'name', 'category', 'amount', 'gst', 'dayOfMonth', 'unitId', 'startDate', 'endDate', 'active', 'lastPostedFor'],
  Payments: ['id', 'loadId', 'invoiceNo', 'customer', 'paidAt', 'amount', 'method', 'note', 'by'],
  People:   ['id', 'name', 'role', 'hourlyRate', 'active', 'roles', 'rates'],
  Invoices: ['invoiceNo', 'at', 'customer', 'address', 'phone', 'loadId', 'ticket', 'sub', 'gst', 'total', 'product', 'trucking', 'fsc', 'json']
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

/* =============================== v14: admin devices + people sign-in =============================== */
// ADMIN = the company password, or a random admin token that a device got by entering the password once.
// Only a SHA-256 of each token is kept (Script Property adminTokens). Tokens are never logged.
// Before a company password exists, every device is admin (same as keyOk_).
function same_(a, b) { a = String(a == null ? '' : a); b = String(b == null ? '' : b); var x = a.length ^ b.length, n = Math.max(a.length, b.length); for (var i = 0; i < n; i++) x |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return x === 0; }
function adminTokens_() { return parse_(props_().getProperty('adminTokens') || '[]') || []; }
function saveAdminTokens_(l) { props_().setProperty('adminTokens', JSON.stringify(l.slice(-40))); }
function newToken_() { return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); }
function tokenAdmin_(t) {
  if (!t) return null;
  var h = sha_(String(t)), list = adminTokens_(), hit = null;
  list.forEach(function (x) { if (same_(x.h, h)) hit = x; });            // checks every entry (constant time per entry)
  if (hit && Date.now() - (Number(hit.seen) || 0) > 3600000) { hit.seen = Date.now(); try { saveAdminTokens_(list); } catch (e) {} }
  return hit;
}
function isAdmin_(p, d) {
  if (!hasPassword_()) return { ok: true, none: true };
  var t = (d && d.adminToken) || (p && p.at);
  if (t && tokenAdmin_(t)) return { ok: true, token: true };
  if (d && d.password != null && d.password !== '') { var c = checkPw_(d.password); return { ok: c.ok, locked: c.locked }; }
  return { ok: false, noadmin: !!t };
}
function adminFail_(a) { return json_({ status: a.locked ? 'locked' : a.noadmin ? 'noadmin' : 'badpassword', message: a.noadmin ? 'This device is no longer an admin. Enter the company password.' : 'Wrong company password.', v: SCRIPT_VERSION }); }
function adminName_(d) { var t = d && d.adminToken; if (!t) return d && d.password ? 'company password' : ''; var h = tokenAdmin_(t); return h ? h.name : ''; }

// PEOPLE (drivers, mechanic, yard) sign in with name + passcode and get a session token that is signed with a secret
// (nothing stored per phone). Changing the person's passcode or deactivating them ends every token.
function personSecret_() { var s = props_().getProperty('personSecret'); if (!s) { s = newToken_(); props_().setProperty('personSecret', s); } return s; }
function personSig_(d) { return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(String(d.id) + '|' + String(d.tokenVer || 0) + '|' + String(d.hash || ''), personSecret_())).replace(/=+$/, ''); }
function personToken_(d) { return String(d.id) + '.' + personSig_(d); }
function personFromToken_(t, list) {
  t = String(t || ''); var i = t.lastIndexOf('.'); if (i < 1) return null;
  var id = t.slice(0, i), sig = t.slice(i + 1), rows = list || rows_('Drivers');
  for (var j = 0; j < rows.length; j++) { var x = rows[j]; if (String(x.id) === id) return (String(x.active) !== 'false' && x.hash && same_(personSig_(x), sig)) ? x : null; }
  return null;
}
// name + passcode (old cached pages) OR token (v14 pages)
function personAuth_(d) {
  if (d && d.token) { var x = personFromToken_(d.token); return x ? { ok: true, driver: x } : { bad: true }; }
  return drvAuth_(d && d.name, d && d.passcode);
}
function rolesOf_(drv) { var r = String((drv && drv.roles) || '').toLowerCase().split(/[,\s]+/).filter(String); return r.length ? r : ['driver']; }

// TEST copy: Script Property TEST_MODE=1 sends EVERY email only to the owner with [TEST] in the subject.
function testMode_() { return String(props_().getProperty('TEST_MODE') || '') === '1'; }
function sendMail_(opts) {
  if (testMode_()) { opts.subject = '[TEST] ' + (opts.subject || '') + ' (would have gone to ' + opts.to + ')'; opts.to = Session.getEffectiveUser().getEmail(); }
  MailApp.sendEmail(opts);
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
  return { v: SCRIPT_VERSION, app: APP, unified: true, rev: rev_(), hasPassword: hasPassword_(), companyId: companyId_(), companyName: pr.name || s.companyName || '', test: testMode_() };
}
// Link fields are derived on each device from this script's own link, so they are never stored.
var LINK_KEYS = ['sheetsUrl', 'sheetsUrlAt', 'syncUrl', 'scriptUrl', 'scriptUrlAt', 'yardUrl', 'yardUrlAt', 'driversUrl', 'driversUrlAt', 'trucksUrl', 'trucksUrlAt', 'movedTo'];

/* =============================== spreadsheet =============================== */
var ss__ = null, tabs__ = {};
function ss_() {
  if (ss__) return ss__;
  var id = props_().getProperty('ssId');
  // A script made from the sheet itself (Extensions → Apps Script, e.g. on a TEST copy) uses that sheet when there is
  // no ssId, when it is the same sheet, or in TEST_MODE. A live script with an ssId always keeps using the ssId sheet.
  try {
    var active = SpreadsheetApp.getActiveSpreadsheet();
    if (active && (!id || active.getId() === id || testMode_())) { ss__ = active; if (!id) props_().setProperty('ssId', active.getId()); return ss__; }
  } catch (e) {}
  if (id) { try { ss__ = SpreadsheetApp.openById(id); return ss__; } catch (e) { /* deleted: make a new one */ } }
  ss__ = SpreadsheetApp.create(SHEET_NAME); props_().setProperty('ssId', ss__.getId());
  return ss__;
}
function styleHeader_(rng) { try { rng.setFontWeight('bold').setBackground('#166534').setFontColor('#ffffff'); } catch (e) {} }
// The header a tab should have (v14 names included). Loads keeps its header on row 4.
function headOf_(name) { return name === 'Loads' ? LOAD_ALL : name === 'Tickets' ? TICKET_HEADERS : name === 'Yards' ? YARD_ALL : TABS[name]; }
// A new tab starts with 26 columns; make room on the RIGHT only (existing columns never move).
function ensureCols_(sh, n) { var m = sh.getMaxColumns(); if (m < n) sh.insertColumnsAfter(m, n - m); }
// Write the header names of NEW columns into an existing tab, once. Only empty header cells are written,
// so nothing that is already there is ever changed.
function extendHeader_(name, sh) {
  var head = headOf_(name), row = name === 'Loads' ? 4 : 1, key = 'hdr_' + name;
  if (String(props_().getProperty(key)) === String(head.length)) return;
  ensureCols_(sh, head.length);
  var cur = sh.getRange(row, 1, 1, head.length).getValues()[0], wrote = false;
  for (var i = 0; i < head.length; i++) {
    if (cur[i] === '' || cur[i] == null) { sh.getRange(row, i + 1).setValue(head[i]); styleHeader_(sh.getRange(row, i + 1)); wrote = true; }
  }
  if (wrote) try { log_('sync', 'columns added', name, head.length + ' columns'); } catch (e) {}
  props_().setProperty(key, String(head.length));
}
function sheet_(name) {
  if (tabs__[name]) return tabs__[name];
  var ss = ss_(), sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    var head = headOf_(name);
    ensureCols_(sh, head.length);
    if (name === 'Loads') {
      sh.getRange(1, 1).setValue('Trip Log');
      try { sh.getRange(1, 1).setFontSize(18).setFontWeight('bold').setFontColor('#166534'); } catch (e) {}
      sh.getRange(4, 1, 1, head.length).setValues([head]); styleHeader_(sh.getRange(4, 1, 1, head.length));
      try { sh.setFrozenRows(4); } catch (e) {}
    } else {
      try { sh.getRange(1, 1, sh.getMaxRows(), head.length).setNumberFormat('@'); } catch (e) {}
      sh.getRange(1, 1, 1, head.length).setValues([head]); styleHeader_(sh.getRange(1, 1, 1, head.length));
      try { sh.setFrozenRows(1); } catch (e) {}
    }
    try { var d = ss.getSheetByName('Sheet1'); if (d && ss.getSheets().length > 1) ss.deleteSheet(d); } catch (e) {}
    props_().setProperty('hdr_' + name, String(head.length));
  } else if (name !== 'Log') {
    extendHeader_(name, sh);
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
      if (!svc) return json_({ status: 'ok', app: APP, v: SCRIPT_VERSION, unified: true, hasPassword: m.hasPassword, companyName: m.companyName, companyId: m.companyId });
      if (!keyOk_(p.k)) return json_({ _meta: m, status: 'nokey' });              // Connect screen: who is this company, is there a password
      var s = readSettings_(); LINK_KEYS.forEach(function (k) { delete s[k]; });
      if (p.profile === '1') return json_({ status: 'ok', profile: s.profile || {}, companyName: m.companyName, _meta: m });
      s._meta = m; return json_(s);
    }
    if (!keyOk_(p.k)) return json_({ status: 'nokey', message: 'This device is not connected to the company (enter the company password on the Quote page).', rows: [] });
    if (svc === 'loads') return json_({ status: 'ok', rows: loadRows_() });
    if (svc === 'tickets') return json_({ rows: ticketRows_() });
    if (svc === 'yards') return json_({ status: 'ok', rows: p.all === '1' ? yardRowsAll_() : yardRows_() });
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
    if (svc === 'trucks') return trucksPost_(p, d);          // v14: company key, admin token or a signed-in person
    if (svc === 'money') return moneyPost_(p, d);            // v14: office only (admin token or company password)
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
/* =============================== v14: company directory (company name -> company link) ===============================
   The script named in the website's kf-config.js also keeps a short list of companies, so a new device can sign in with
   just the company NAME + company password. A company registers its own link: this script opens that link and only
   accepts it when it really is a company script with that name and a password set (no password is ever sent here).
   A name already used by a different company (other company id) is refused. */
function companyDir_() { return parse_(props_().getProperty('companyDir') || '{}') || {}; }
var DIR_URL_RE = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;
function dirNorm_(n) { return String(n || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.,]/g, ''); }
function registerCompany_(d) {
  var url = String(d.url || '').trim().split('?')[0];
  if (!DIR_URL_RE.test(url)) return { status: 'error', message: 'That is not a company script link (it ends in /exec).' };
  var cache = CacheService.getScriptCache(), n = Number(cache.get('dirReg') || 0); if (n > 30) return { status: 'error', message: 'Too many tries. Wait a few minutes.' };
  cache.put('dirReg', String(n + 1), 600);
  var m = null; try { m = parse_(UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true }).getContentText()); } catch (e) { m = null; }
  if (!m || m.app !== 'company' || !m.unified) return { status: 'error', message: 'That link did not answer as a company script. Check it is deployed as a web app for Anyone.' };
  if (!m.hasPassword) return { status: 'error', message: 'Create the company password first.' };
  var name = String(m.companyName || '').trim(); if (!name) return { status: 'error', message: 'Give the company a name first (Company settings → Company Name, then Save to Company).' };
  var dir = companyDir_(), key = dirNorm_(name), cur = dir[key];
  if (cur && cur.companyId && m.companyId && cur.companyId !== m.companyId) return { status: 'taken', message: '"' + name + '" is already used by another company. Change the company name a little (e.g. add the town).' };
  Object.keys(dir).forEach(function (k) { if (k !== key && dir[k].companyId && dir[k].companyId === m.companyId) delete dir[k]; });   // renamed company: old name goes
  dir[key] = { name: name, url: url, companyId: m.companyId || '', at: nowIso_() };
  var js = JSON.stringify(dir); if (js.length > 9000) return { status: 'error', message: 'The company list is full.' };
  props_().setProperty('companyDir', js); log_('sync', cur ? 'company link updated in directory' : 'company registered in directory', name, '');
  return { status: 'ok', name: name };
}
function findCompany_(d) {
  var cache = CacheService.getScriptCache(), n = Number(cache.get('dirFind') || 0); if (n > 120) return { status: 'error', message: 'Too many tries. Wait a minute.' };
  cache.put('dirFind', String(n + 1), 60);
  var hit = companyDir_()[dirNorm_(d.name)];
  if (!hit) { var self = meta_(); if (self.companyName && dirNorm_(self.companyName) === dirNorm_(d.name)) return { status: 'ok', self: true, name: self.companyName }; return { status: 'notfound' }; }
  return { status: 'ok', name: hit.name, url: hit.url };
}
function syncPost_(p, d) {
  var a = d.action;
  if (a === 'registerCompany') return json_(registerCompany_(d));
  if (a === 'findCompany') return json_(findCompany_(d));
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
    // v14: changing the password removes every admin device; the device that set it becomes admin
    var tok = newToken_(); saveAdminTokens_([{ h: sha_(tok), id: Utilities.getUuid().slice(0, 8), name: cap_(d.deviceName, 60) || 'Device that set the password', at: Date.now(), seen: Date.now() }]);
    log_('sync', first ? 'company created' : 'password changed', '', first ? '' : 'all admin devices removed');
    return json_({ status: 'ok', v: SCRIPT_VERSION, unified: true, key: key, adminToken: tok, companyId: companyId_(), meta: meta_() });
  }
  if (a === 'saveSettings') {
    var c3 = isAdmin_(p, d); if (!c3.ok) return adminFail_(c3);
    var rev = rev_();
    if (!d.force && d.baseRev != null && rev > 0 && Number(d.baseRev) !== rev) return json_({ status: 'conflict', rev: rev, v: SCRIPT_VERSION });
    var inc = d.settings || {}, cur = readSettings_();
    if (!Array.isArray(inc.locations)) return json_({ status: 'rejected', message: 'No locations list in the save; nothing was changed.' });
    if (inc.locations.length === 0 && Array.isArray(cur.locations) && cur.locations.length > 0 && !d.allowEmpty) return json_({ status: 'rejected', message: 'Refusing to replace saved locations with an empty list.' });
    LINK_KEYS.forEach(function (k) { delete inc[k]; });
    delete inc._meta;
    if (!inc.profile && cur.profile) inc.profile = cur.profile;        // company profile is saved separately (Billing → Settings)
    if (!inc.dispatch && cur.dispatch) inc.dispatch = cur.dispatch;    // customer-text settings are saved from Dispatch → Settings
    if (!inc.apiKey && cur.apiKey) inc.apiKey = cur.apiKey;            // a blank Maps key never erases the saved one
    mergeGuard_(inc, cur);                                             // an old cached Quote page cannot wipe v14 settings
    writeSettings_(inc);
    var r2 = bumpRev_(); log_('sync', 'settings saved', 'rev ' + r2, '');
    return json_({ status: 'saved', rev: r2, v: SCRIPT_VERSION });
  }
  if (a === 'saveProfile') {
    var c4 = isAdmin_(p, d); if (!c4.ok) return adminFail_(c4);
    var pr = d.profile || {}, s = readSettings_();
    if (pr.logo && String(pr.logo).length > 150000) return json_({ status: 'error', message: 'The logo picture is too large to store. Choose it again (the app shrinks it).' });
    s.profile = { name: cap_(pr.name, 120), gst: cap_(pr.gst, 40), wcb: cap_(pr.wcb, 40), email: cap_(pr.email, 120), phone: cap_(pr.phone, 40),
      addr: cap_(pr.addr, 300), mail: cap_(pr.mail, 300), etNote: cap_(pr.etNote, 300), logo: String(pr.logo || '') };
    if (pr.name) s.companyName = s.profile.name;
    if (!Array.isArray(s.locations)) s.locations = [];
    writeSettings_(s);
    var r3 = bumpRev_(); log_('sync', 'company info saved', s.profile.name, '');
    return json_({ status: 'saved', rev: r3, profile: s.profile, v: SCRIPT_VERSION });
  }
  if (a === 'saveDispatch') {
    var c6 = isAdmin_(p, d); if (!c6.ok) return adminFail_(c6);
    var ds = d.dispatch || {}, s2 = readSettings_();
    s2.dispatch = { texts: !!ds.texts, template: cap_(ds.template, 600) };
    if (!Array.isArray(s2.locations)) s2.locations = [];
    writeSettings_(s2);
    var r6 = bumpRev_(); log_('sync', 'customer texts ' + (ds.texts ? 'on' : 'off'), '', '');
    return json_({ status: 'saved', rev: r6, dispatch: s2.dispatch, v: SCRIPT_VERSION });
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
  // ---- v14: admin devices ----
  if (a === 'makeAdmin') {
    if (!hasPassword_()) return json_({ status: 'nopassword', v: SCRIPT_VERSION, meta: meta_() });
    var cm = checkPw_(d.password); if (!cm.ok) return pwFail_(cm);
    var t1 = newToken_(), list1 = adminTokens_(), nm = cap_(d.deviceName, 60) || 'Device';
    list1.push({ h: sha_(t1), id: Utilities.getUuid().slice(0, 8), name: nm, at: Date.now(), seen: Date.now() });
    saveAdminTokens_(list1); log_('sync', 'admin device added', nm, '');
    return json_({ status: 'ok', v: SCRIPT_VERSION, adminToken: t1, key: companyKey_(), companyId: companyId_(), meta: meta_() });
  }
  // an admin device that lost its company key (old website bug) gets it back with its admin token
  if (a === 'adminKey') {
    var ak = isAdmin_(p, d); if (!ak.ok) return adminFail_(ak);
    return json_({ status: 'ok', v: SCRIPT_VERSION, key: companyKey_(), companyId: companyId_(), meta: meta_() });
  }
  if (a === 'whoami') {
    var wa = isAdmin_(p, { adminToken: d.adminToken }), pe = d.token ? personFromToken_(d.token) : null;
    return json_({ status: 'ok', v: SCRIPT_VERSION, admin: !!wa.ok, noPassword: !hasPassword_(), person: pe ? { id: pe.id, name: pe.name, roles: rolesOf_(pe) } : null, meta: meta_() });
  }
  if (a === 'listAdmins' || a === 'removeAdmin' || a === 'removeAllAdmins') {
    var ca = isAdmin_(p, d); if (!ca.ok) return adminFail_(ca);
    var list2 = adminTokens_(), mine = d.adminToken ? sha_(String(d.adminToken)) : '';
    if (a === 'removeAdmin') { var gone = list2.filter(function (x) { return x.id === d.id; })[0]; list2 = list2.filter(function (x) { return x.id !== d.id; }); saveAdminTokens_(list2); log_('sync', 'admin device removed', gone ? gone.name : d.id, ''); }
    if (a === 'removeAllAdmins') { list2 = []; saveAdminTokens_(list2); log_('sync', 'admin removed from all devices', '', ''); }
    return json_({ status: 'ok', v: SCRIPT_VERSION, devices: list2.map(function (x) { return { id: x.id, name: x.name, at: x.at, seen: x.seen, me: !!mine && same_(x.h, mine) }; }) });
  }
  if (a === 'stopAdmin') {
    var h3 = d.adminToken ? sha_(String(d.adminToken)) : '', l3 = adminTokens_(), me3 = l3.filter(function (x) { return same_(x.h, h3); })[0];
    if (me3) { saveAdminTokens_(l3.filter(function (x) { return x !== me3; })); log_('sync', 'admin device removed', me3.name, 'by itself'); }
    return json_({ status: 'ok', v: SCRIPT_VERSION });
  }
  if (a === 'alerts') return json_(alerts_(p, d));
  if (a === 'getLog') {
    if (!keyOk_(p.k || d.k)) return json_({ status: 'nokey' });
    var lg = rows_('Log'); return json_({ status: 'ok', rows: lg.slice(-Math.min(Number(d.limit) || 200, 2000)) });
  }
  return json_({ status: 'error', message: 'Unknown action: ' + a, v: SCRIPT_VERSION });
}

// v14 settings that an OLD cached Quote page does not know about. If a save is missing them, the stored value is kept.
var GUARD_KEYS = ['money', 'homeBase', 'offRoadFuelPrice'];
var GUARD_UNIT_FIELDS = ['aliases', 'haulsSplit', 'splitCords', 'homeBase'];
var GUARD_SPECIES_FIELDS = ['splitPricePerCord', 'splitCostPerCord'];
function mergeGuard_(inc, cur) {
  GUARD_KEYS.forEach(function (k) { if (!(k in inc) && cur[k] != null) inc[k] = cur[k]; });
  if (Array.isArray(inc.units) && Array.isArray(cur.units)) inc.units.forEach(function (u) {
    var old = cur.units.filter(function (x) { return String(x.id) === String(u.id); })[0]; if (!old) return;
    GUARD_UNIT_FIELDS.forEach(function (f) { if (!(f in u) && old[f] != null) u[f] = old[f]; });
  });
  if (Array.isArray(inc.locations) && Array.isArray(cur.locations)) inc.locations.forEach(function (l) {
    var old = cur.locations.filter(function (x) { return String(x.id) === String(l.id); })[0]; if (!old || !Array.isArray(l.species)) return;
    l.species.forEach(function (sp) {
      var os = (old.species || []).filter(function (x) { return String(x.name) === String(sp.name); })[0]; if (!os) return;
      GUARD_SPECIES_FIELDS.forEach(function (f) { if (!(f in sp) && os[f] != null) sp[f] = os[f]; });
    });
  });
  delete inc.yardPassword;                                             // v14: no saved passwords in settings
  return inc;
}

/* =============================== loads (Quote bookings, Dispatch, Billing) =============================== */
function loadRows_() {
  var sh = sheet_('Loads'), last = sh.getLastRow();
  if (last < 5) return [];
  // Columns A..T are read exactly as before (r[0]..r[19]); v14 columns U.. are added when the sheet has them.
  var w = Math.max(20, Math.min(sh.getLastColumn(), LOAD_ALL.length));
  var rows = sh.getRange(5, 1, last - 4, w).getValues().filter(function (r) { return r[1]; }).map(function (r) {
    var o = { timestamp: r[0], customerName: r[1], phone: r[2], address: r[3], location: r[4], species: r[5], truck: r[6], tonnes: r[7], cords: r[8],
      km: r[9], duration: r[10], driveHours: r[11], totalHours: r[12], fuelLitres: r[13], total: r[14],
      status: r[15] || 'Pending', loadId: r[16] || '', netTonnes: r[17] || '', invoiceData: r[18] || '', notes: r[19] || '' };
    if (w > 20) {
      var x = function (i) { var v = r[i]; return v == null ? '' : (v instanceof Date ? day_(v) : v); };
      o.quotedTotal = x(20); o.priceAdj = x(21); o.adjReason = x(22); o.billedHours = x(23); o.bookingId = x(24); o.product = x(25);
      o.requestedDate = x(26); o.unitId = x(27); o.driverName = x(28); o.bookingData = x(29);
      o.emptyOutKm = x(30); o.emptyOutH = x(31); o.loadedKm = x(32); o.loadedH = x(33); o.emptyBackKm = x(34); o.emptyBackH = x(35); o.emptyFuelL = x(36);
    }
    return o;
  });
  try { addPlaces_(rows); } catch (e) {}
  return rows;
}

/* =============================== delivery place: "Blackie, AB · 55 km S of Calgary" =============================== */
var MAJOR_CITIES = [['Calgary', 51.045, -114.057], ['Edmonton', 53.546, -113.491], ['Red Deer', 52.268, -113.811], ['Lethbridge', 49.694, -112.833],
  ['Medicine Hat', 50.04, -110.677], ['Grande Prairie', 55.171, -118.795], ['Fort McMurray', 56.727, -111.381], ['Lloydminster', 53.278, -110.006],
  ['Saskatoon', 52.134, -106.67], ['Regina', 50.445, -104.619], ['Prince Albert', 53.203, -105.753], ['Kelowna', 49.888, -119.496], ['Kamloops', 50.674, -120.327],
  ['Prince George', 53.917, -122.749], ['Dawson Creek', 55.761, -120.236], ['Cranbrook', 49.512, -115.769]];
function km_(a, b, c, d) { var R = 6371, t = function (x) { return x * Math.PI / 180; }, dLa = t(c - a), dLo = t(d - b); var h = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(t(a)) * Math.cos(t(c)) * Math.sin(dLo / 2) * Math.sin(dLo / 2); return 2 * R * Math.asin(Math.sqrt(h)); }
function dir_(a, b, c, d) { var t = function (x) { return x * Math.PI / 180; }, y = Math.sin(t(d - b)) * Math.cos(t(c)), x = Math.cos(t(a)) * Math.sin(t(c)) - Math.sin(t(a)) * Math.cos(t(c)) * Math.cos(t(d - b)); var deg = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8]; }
function describePlace_(town, prov, lat, lon) {
  var best = null, bd = 1e9;
  MAJOR_CITIES.forEach(function (c) { var k = km_(c[1], c[2], lat, lon); if (k < bd) { bd = k; best = c; } });
  var head = town ? town + (prov ? ', ' + prov : '') : '';
  if (!best) return head;
  if (bd < 15) return town && town.toLowerCase() !== best[0].toLowerCase() ? head + ' · ' + best[0] + ' area' : best[0] + (prov ? ', ' + prov : '');
  return (head ? head + ' · ' : '') + Math.round(bd / 5) * 5 + ' km ' + dir_(best[1], best[2], lat, lon) + ' of ' + best[0];
}
function geocodePlace_(address) {
  var res = Maps.newGeocoder().setRegion('ca').geocode(address);
  if (!res || res.status !== 'OK' || !res.results.length) return null;
  var r = res.results[0], comp = r.address_components || [], pick = function (types) { for (var i = 0; i < types.length; i++) for (var j = 0; j < comp.length; j++) if ((comp[j].types || []).indexOf(types[i]) > -1) return comp[j]; return null; };
  var town = pick(['locality', 'sublocality', 'administrative_area_level_3', 'neighborhood']), prov = pick(['administrative_area_level_1']);
  var lat = r.geometry.location.lat, lon = r.geometry.location.lng;
  return { place: describePlace_(town ? town.long_name : '', prov ? prov.short_name : '', lat, lon), lat: lat, lon: lon };
}
// Adds .place to each load. Addresses are looked up once (a few new ones per request) and remembered in the Places tab.
function addPlaces_(rows) {
  var known = {}, norm = function (a) { return String(a || '').trim().toLowerCase().replace(/\s+/g, ' '); };
  rows_('Places').forEach(function (p) { known[norm(p.address)] = p; });
  var added = [], budget = 6;
  rows.forEach(function (r) {
    var k = norm(r.address); if (!k) return;
    var hit = known[k];
    if (!hit && budget > 0) {
      budget--;
      var g = null; try { g = geocodePlace_(r.address); } catch (e) { g = null; }
      hit = { address: r.address, place: g ? g.place : '', lat: g ? g.lat : '', lon: g ? g.lon : '', at: new Date().toISOString() };
      known[k] = hit; added.push(hit);
    }
    if (hit && hit.place) { r.place = hit.place; r.placeLat = hit.lat; r.placeLon = hit.lon; }
  });
  if (added.length) appendMany_('Places', added);
}
// v14: lat/lon of any address (pickup locations, home base), looked up once and kept in the Places tab
function geoOf_(address) {
  var a = String(address || '').trim(); if (!a) return null;
  var m = a.match(/^(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)$/); if (m) return { lat: Number(m[1]), lon: Number(m[2]) };
  var norm = a.toLowerCase().replace(/\s+/g, ' '), hit = rows_('Places').filter(function (x) { return String(x.address).trim().toLowerCase().replace(/\s+/g, ' ') === norm; })[0];
  if (hit) return hit.lat !== '' ? { lat: Number(hit.lat), lon: Number(hit.lon) } : null;
  var g = null; try { g = geocodePlace_(a); } catch (e) {}
  append_('Places', { address: a, place: g ? g.place : '', lat: g ? g.lat : '', lon: g ? g.lon : '', at: nowIso_() });
  return g ? { lat: g.lat, lon: g.lon } : null;
}
function loadsPost_(d) {
  var sh = sheet_('Loads');
  if (d.action === 'updateStatus') {
    var ok = updateStatus_(sh, d);
    if (ok) { log_('loads', 'status ' + (d.status || ''), d.loadId || d.customerName, { netTonnes: d.netTonnes || '' }); if (d.status) deliveryOut_(sh, findRow_(sh, d)); }
    return json_({ status: ok ? 'ok' : 'notfound' });
  }
  if (d.action === 'saveInvoice') { var ok2 = saveInvoice_(sh, d); if (ok2) log_('loads', 'invoice saved', d.loadId || d.customerName, ''); return json_({ status: ok2 ? 'ok' : 'notfound' }); }
  if (d.action === 'editLoad' || d.action === 'assignLoad') {
    var ad = isAdmin_({}, d); if (!ad.ok) return adminFail_(ad);
    var who = adminName_(d) || 'office';
    if (d.action === 'assignLoad') d.changes = { unitId: cap_(d.unitId, 60), driverName: cap_(d.driverName, 80) };
    return json_(editLoad_(sh, d, who));
  }
  // Dispatch -> Delete load (office only). Only loads not yet delivered: a delivered or paid load has already taken wood
  // out of inventory and may be billed. The whole row is written to the Log first, so it can be put back by hand.
  if (d.action === 'deleteLoad') {
    var adl = isAdmin_({}, d); if (!adl.ok) return adminFail_(adl);
    var rowD = findLoad_(sh, d.find || {}); if (rowD < 0) return json_({ status: 'notfound', message: 'That load was not found in the sheet. Refresh Dispatch.' });
    var vD = sh.getRange(rowD, 1, 1, LOAD_ALL.length).getValues()[0], stD = String(vD[15] || '').toLowerCase();
    if (stD === 'delivered' || stD === 'paid') return json_({ status: 'error', message: 'A ' + stD + ' load cannot be deleted (it is already out of inventory / billed). Use Edit load instead.' });
    var keepD = {}; LOAD_ALL.forEach(function (hd, i) { var x = vD[i]; if (x !== '' && x != null && hd !== 'Booking Data') keepD[hd] = cap_(x instanceof Date ? x.toISOString() : x, 200); });
    log_('loads', 'load deleted', vD[16] || vD[24] || vD[1], { by: adminName_(d) || 'office', row: keepD });
    sh.deleteRow(rowD);
    return json_({ status: 'ok', v: SCRIPT_VERSION });
  }
  if (d.action === 'sendInvoice') {
    var opts = { to: d.to || Session.getEffectiveUser().getEmail(), subject: d.subject || 'Invoice', body: d.body || 'See attached invoice.' };
    if (d.pdfBase64) opts.attachments = [Utilities.newBlob(Utilities.base64Decode(d.pdfBase64), 'application/pdf', d.filename || 'package.pdf')];
    else if (d.html) opts.attachments = [Utilities.newBlob(d.html, 'text/html', (d.filename || 'package') + '.html')];
    sendMail_(opts); log_('loads', 'invoice emailed', d.subject || '', opts.to);
    return json_({ status: 'sent', attached: !!(opts.attachments && d.pdfBase64), version: 2 });
  }
  if (d.action) return json_({ status: 'error', message: 'Unknown action: ' + d.action });
  // a booking (no action field). Columns A..T are written exactly as before; v14 fields (all optional) go to U..AK.
  var ts = d.timestamp || new Date().toISOString(), next = Math.max(sh.getLastRow() + 1, 5), notes = String(d.notes || '').slice(0, 1000);
  var known = {}, bid0 = cap_(d.bookingId, 40);
  if (bid0 && sh.getLastRow() >= 5 && sh.getLastColumn() >= 25) sh.getRange(5, 25, sh.getLastRow() - 4, 1).getValues().forEach(function (v) { if (v[0]) known[String(v[0])] = 1; });
  var n0 = function (v) { return v === '' || v == null || isNaN(Number(v)) ? '' : Number(v); };
  var rows = (d.options || []).map(function (o, i) {
    var bid = bid0 ? bid0 + '-' + (i + 1) : '';
    if (bid && known[bid]) return null;                                  // a resent booking is never added twice
    var lg = o.legs || {};
    return [ts, d.customerName || '', d.phone || '', d.address || '', o.location || '', o.species || '', o.truck || '', o.tonnes || '', o.cords || '', o.km || '',
      o.duration || '', o.driveHours || '', o.totalHours || '', o.fuelLitres || '', o.total || '', 'Pending', '', '', '', notes,
      n0(o.quotedTotal), n0(o.priceAdj), cap_(o.adjReason, 200), n0(o.billedHours), bid, cap_(o.product, 20), cap_(o.requestedDate, 12), '', '',
      o.bookingData ? cap_(typeof o.bookingData === 'string' ? o.bookingData : JSON.stringify(o.bookingData), 4000) : '',
      n0(lg.emptyOutKm), n0(lg.emptyOutH), n0(lg.loadedKm), n0(lg.loadedH), n0(lg.emptyBackKm), n0(lg.emptyBackH), n0(lg.emptyFuelL)];
  }).filter(function (r) { return r; });
  if (rows.length) sh.getRange(next, 1, rows.length, LOAD_ALL.length).setValues(rows);
  log_('loads', 'booked', d.customerName || '', rows.length + ' option(s)' + (bid0 ? ' ' + bid0 : ''));
  return json_({ status: 'ok', notesSaved: true, v: SCRIPT_VERSION, duplicate: !rows.length && !!(d.options || []).length });
}

// v14: find a load by its Booking ID (new bookings), else exactly the old way (findRow_: Load ID, then customer + time + ...).
function findLoad_(sheet, q) {
  if (q && q.bookingId && sheet.getLastRow() >= 5 && sheet.getLastColumn() >= 25) {
    var ids = sheet.getRange(5, 25, sheet.getLastRow() - 4, 1).getValues();
    for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(q.bookingId)) return i + 5;
  }
  return findRow_(sheet, q || {});
}
// Dispatch -> Edit load: every field by hand. Only changed cells are written; the Log gets before and after.
var LOAD_EDIT_COLS = { customerName: 2, phone: 3, address: 4, location: 5, species: 6, truck: 7, tonnes: 8, cords: 9, km: 10, duration: 11, driveHours: 12,
  totalHours: 13, fuelLitres: 14, total: 15, status: 16, netTonnes: 18, notes: 20, priceAdj: 22, adjReason: 23, billedHours: 24, product: 26, requestedDate: 27,
  unitId: 28, driverName: 29 };
var LOAD_STATUSES = ['Pending', 'Started', 'Delivered', 'Paid'];
function editLoad_(sh, d, who) {
  var row = findLoad_(sh, d.find || {}); if (row < 0) return { status: 'notfound', message: 'That load was not found in the sheet.' };
  var ch = d.changes || {}, vals = sh.getRange(row, 1, 1, LOAD_ALL.length).getValues()[0], before = {}, after = {}, n = 0;
  if (ch.status != null && LOAD_STATUSES.indexOf(String(ch.status)) < 0) return { status: 'error', message: 'Status must be one of ' + LOAD_STATUSES.join(', ') + '.' };
  Object.keys(ch).forEach(function (k) {
    var col = LOAD_EDIT_COLS[k]; if (!col) return;
    var old = vals[col - 1], nv = ch[k] == null ? '' : ch[k];
    if (k === 'notes') nv = String(nv).slice(0, 1000); else if (typeof nv === 'string') nv = cap_(nv, 300);
    var oldS = old instanceof Date ? (k === 'requestedDate' ? day_(old) : old.toISOString()) : String(old);
    if (oldS === String(nv)) return;
    sh.getRange(row, col).setValue(nv); before[k] = oldS; after[k] = nv; n++;
  });
  if (n) log_('loads', 'load edited', vals[16] || vals[24] || vals[1], { by: who, before: before, after: after });
  if (ch.status != null || ch.netTonnes != null) deliveryOut_(sh, row);
  return { status: 'ok', changed: n, v: SCRIPT_VERSION };
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
  // edit: find the ticket by the number it had when the edit started (the number itself may have been changed)
  // save: a ticket number that already exists is updated, never added twice (a resent save cannot duplicate)
  if ((d.action === 'edit' || d.action === 'save') && d.row && d.row[0]) {
    var row = d.row.slice(0, 11); while (row.length < 11) row.push('');
    var find = function (key) { if (last < 2 || !key) return -1; var nn = sh.getRange(2, 1, last - 1, 1).getValues(); for (var j = 0; j < nn.length; j++) if (String(nn[j][0]) === String(key)) return j + 2; return -1; };
    var at = find(d.action === 'edit' ? (d.original || d.row[0]) : d.row[0]);
    if (at < 0 && d.action === 'edit') at = find(d.row[0]);
    if (at > 0) { sh.getRange(at, 1, 1, 11).setValues([row]); log_('tickets', 'edited', row[0], { was: d.original || '', net: row[6] }); return json_({ status: 'edited' }); }
    sh.appendRow(row); log_('tickets', 'saved', row[0], { net: row[6], customer: row[2] }); return json_({ status: 'ok' });
  }
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
// v14: every Yards column (A..L exactly as before, then the v14 columns when the sheet has them)
function yardRowsAll_() {
  var sh = sheet_('Yards'), last = sh.getLastRow(); if (last < 2) return [];
  var w = Math.max(12, Math.min(sh.getLastColumn(), YARD_ALL.length));
  return sh.getRange(2, 1, last - 1, w).getValues().map(function (r, i) {
    var o = { _row: i + 2, timestamp: r[0], yard: r[1], species: r[2], type: r[3], tonnes: r[4], cords: r[5], pricePerTonne: r[6], pricePerCord: r[7], ticket: r[8], notes: r[9], source: r[10], unit: r[11] };
    if (w > 12) { o.product = r[12]; o.costPerTonne = r[13]; o.costPerCord = r[14]; o.haulCost = r[15]; o.processId = r[16]; o.status = r[17]; o.loadId = r[18]; o.pendingTonnes = r[19]; o.entryId = r[20]; o.by = r[21]; }
    if (o.timestamp instanceof Date) o.timestamp = o.timestamp.toISOString();
    return o;
  }).filter(function (o) { return o.timestamp !== '' && o.timestamp != null; });
}
function yardsPost_(d) {
  if (d.action === 'add') {
    // unchanged for old pages (12 columns); v14 pages also send an entryId (never added twice) and the product
    if (d.entryId && yardHasEntry_(yardRowsAll_(), d.entryId)) return json_({ status: 'ok', duplicate: true });
    var base = [d.timestamp || new Date().toISOString(), d.yard || '', d.species || '', d.type || 'In', d.tonnes || 0, d.cords || 0,
      d.pricePerTonne || 0, d.pricePerCord || 0, d.ticket || '', d.notes || '', d.source || '', d.unit || ''];
    if (d.entryId || d.product) base = base.concat([d.product || 'Logs', d.costPerTonne || '', d.costPerCord || '', d.haulCost || '', '', 'Confirmed', d.loadId || '', '', d.entryId || '', cap_(d.by, 80)]);
    sheet_('Yards').appendRow(base);
    log_('yards', d.type || 'In', d.yard, { species: d.species, tonnes: d.tonnes, product: d.product || '' });
    return json_({ status: 'ok' });
  }
  if (d.action) {
    var ad = isAdmin_({}, d); if (!ad.ok) return adminFail_(ad);
    var r = yardsV14_(d, adminName_(d) || 'office'); if (r) return json_(r);
    return json_({ status: 'error', message: 'Unknown action: ' + d.action, v: SCRIPT_VERSION });
  }
  return json_({ status: 'ok' });
}


/* =============================== v14: shared helpers for the new tabs =============================== */
function num_(v) { var n = Number(v); return isFinite(n) ? n : 0; }
function r2_(n) { return Math.round(num_(n) * 100) / 100; }
function nowIso_() { return new Date().toISOString(); }
function today_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function str_(v) { return v instanceof Date ? v.toISOString() : String(v == null ? '' : v); }
function plain_(o) { var c = {}; Object.keys(o || {}).forEach(function (k) { if (k !== '_row') c[k] = o[k] instanceof Date ? o[k].toISOString() : o[k]; }); return c; }
// write only the given fields of one row (other columns, possibly changed by another step, are left alone)
function setCells_(name, row, fields, obj) {
  var cols = TABS[name], sh = tab_(name);
  Object.keys(fields).forEach(function (k) { var i = cols.indexOf(k); if (i < 0) return; var v = fields[k] == null ? '' : fields[k]; var c = sh.getRange(row, i + 1); try { c.setNumberFormat('@'); } catch (e) {} c.setValue(v); if (obj) obj[k] = v; });
}
function byKey_(list, key, val) { for (var i = 0; i < list.length; i++) if (String(list[i][key]) === String(val)) return list[i]; return null; }
// insert or update one keyed row; the record is merged into what is there (unknown fields stay as they are)
function upsert_(name, key, rec, list) {
  var all = list || rows_(name), f = byKey_(all, key, rec[key]);
  if (f) { var m = plain_(f); Object.keys(rec).forEach(function (k) { if (rec[k] !== undefined) m[k] = rec[k]; }); write_(name, f._row, m); return { row: f._row, rec: m, isNew: false }; }
  append_(name, rec); return { row: -1, rec: rec, isNew: true };
}
function money_() {
  var m = readSettings_().money || {};
  return { employerCostPct: m.employerCostPct != null ? num_(m.employerCostPct) : 12, otWeeklyHours: m.otWeeklyHours != null ? num_(m.otWeeklyHours) : 50,
    otMultiplier: m.otMultiplier != null ? num_(m.otMultiplier) : 1.5, weekStartsOn: num_(m.weekStartsOn), categories: m.categories || [] };
}
// the date v14 first ran: loads invoiced before it count as fully paid (owner's decision)
function goLive_() { var g = props_().getProperty('goLive'); if (!g) { g = nowIso_(); props_().setProperty('goLive', g); } return g; }
// who is asking: admin device, office device holding the company key, or a signed-in person
function who_(p, d) {
  var ad = isAdmin_(p, d), person = d && d.token ? personFromToken_(d.token) : null;
  return { admin: !!ad.ok, office: !!ad.ok || keyOk_((p && p.k) || (d && d.k)), person: person, roles: person ? rolesOf_(person) : [], name: person ? person.name : (adminName_(d) || 'office'), ad: ad };
}

/* =============================== v14: photos go to Drive; the sheet keeps only the link =============================== */
function photoFolder_() { var it = DriveApp.getFoldersByName(SHEET_NAME + ' photos'); return it.hasNext() ? it.next() : DriveApp.createFolder(SHEET_NAME + ' photos'); }
function savePhoto_(dataUrl, name) {
  var m = /^data:([^;]+);base64,(.*)$/.exec(String(dataUrl || '')); if (!m) throw new Error('No picture received.');
  if (m[2].length > 11000000) throw new Error('The picture is too large.');
  var ext = /pdf/.test(m[1]) ? '.pdf' : /png/.test(m[1]) ? '.png' : '.jpg';
  var f = photoFolder_().createFile(Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], cap_(String(name || 'photo').replace(/[\\/:*?"<>|]/g, '-'), 80) + ext));
  try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}   // so office phones can open it from the app
  return /pdf/.test(m[1]) ? f.getUrl() : 'https://drive.google.com/thumbnail?sz=w1600&id=' + f.getId();
}

/* =============================== v14: Units (physical trucks, trailers, equipment) =============================== */
var UNIT_FIELDS = ['type', 'name', 'unitNo', 'plate', 'vin', 'year', 'make', 'model', 'purchaseDate', 'purchasePrice', 'trackHours', 'regExpiry', 'insExpiry', 'cvipExpiry',
  'status', 'outReason', 'notes', 'photo', 'pricingUnit', 'hasCrane', 'fuelBurnLph', 'fuelType', 'wearPerHour', 'pmOverrides', 'homeBase', 'trailerA', 'trailerB'];
// Once: copy the units from Drivers -> Settings into the Units tab (same names, so old shifts still match).
function migrateUnits_() {
  if (props_().getProperty('drvUnitsMigrated')) return;
  var raw = parse_(props_().getProperty('drvConfig') || '{}') || {}, have = rows_('Units'), add = [];
  (raw.units || []).forEach(function (u) {
    if (!u || !u.name || have.some(function (x) { return String(x.name).toLowerCase() === String(u.name).toLowerCase(); })) return;
    add.push({ id: u.id || Utilities.getUuid(), type: 'truck', name: u.name, plate: u.plate || '', trailerA: u.trailerA || '', trailerB: u.trailerB || '', notes: u.notes || '', status: 'In service', trackHours: 'no', updatedAt: nowIso_() });
  });
  if (add.length) appendMany_('Units', add);
  props_().setProperty('drvUnitsMigrated', nowIso_());
  if (add.length) log_('trucks', 'units copied from Drivers settings', '', add.length + ' unit(s)');
}
// Drivers settings keep a copy of the truck list (old cached Drivers pages and old logins read it).
function syncDrvUnits_() {
  var raw = parse_(props_().getProperty('drvConfig') || '{}') || {}, units = rows_('Units').filter(function (u) { return u.status !== 'Sold' && (u.type || 'truck') === 'truck'; });
  raw.units = units.slice(0, 100).map(function (u) { return { id: cap_(u.id, 40), name: cap_(u.name, 60), plate: cap_(u.plate, 20), trailerA: cap_(u.trailerA, 20), trailerB: cap_(u.trailerB, 20), notes: cap_(u.notes, 300) }; });
  props_().setProperty('drvConfig', JSON.stringify(raw));
}
// An OLD Drivers page saving its units list: merge by id / name into Units; never removes anything.
function mergeDrvUnits_(list) {
  var have = rows_('Units');
  (list || []).forEach(function (u) {
    if (!u || !String(u.name || '').trim()) return;
    var f = (u.id && byKey_(have, 'id', u.id)) || have.filter(function (x) { return String(x.name).toLowerCase() === String(u.name).toLowerCase(); })[0];
    if (f) setCells_('Units', f._row, { name: cap_(u.name, 60), plate: cap_(u.plate, 20), trailerA: cap_(u.trailerA, 20), trailerB: cap_(u.trailerB, 20), notes: cap_(u.notes, 300), updatedAt: nowIso_() }, f);
    else { var n = { id: cap_(u.id, 40) || Utilities.getUuid(), type: 'truck', name: cap_(u.name, 60), plate: cap_(u.plate, 20), trailerA: cap_(u.trailerA, 20), trailerB: cap_(u.trailerB, 20), notes: cap_(u.notes, 300), status: 'In service', trackHours: 'no', updatedAt: nowIso_() }; append_('Units', n); have.push(n); }
  });
}
function unitByName_(units, name) { var n = String(name || '').toLowerCase(); return units.filter(function (u) { return String(u.name).toLowerCase() === n; })[0] || null; }
function setUnitStatus_(unitId, status, reason, units) {
  var all = units || rows_('Units'), u = byKey_(all, 'id', unitId); if (!u || u.status === 'Sold' || (u.status === status && String(u.outReason) === String(reason || ''))) return;
  setCells_('Units', u._row, { status: status, outReason: status === 'Out of service' ? cap_(reason, 300) : '', updatedAt: nowIso_() }, u);
  log_('trucks', 'unit ' + status, u.name, reason || '');
}
// a new reading (odometer and/or engine hours); the unit keeps the highest seen
function addReading_(r, units) {
  var id = cap_(r.id, 80) || Utilities.getUuid(), all = units || rows_('Units'), u = (r.unitId && byKey_(all, 'id', r.unitId)) || unitByName_(all, r.unitName);
  if (!u) return false;
  if (r.id && rows_('UnitReadings').some(function (x) { return String(x.id) === String(r.id); })) return false;
  var odo = r.odo === '' || r.odo == null ? '' : num_(r.odo), hrs = r.hours === '' || r.hours == null ? '' : num_(r.hours);
  if (odo === '' && hrs === '') return false;
  append_('UnitReadings', { at: r.at || nowIso_(), unitId: u.id, unitName: u.name, odo: odo, hours: hrs, source: cap_(r.source, 20), shiftId: cap_(r.shiftId, 80), by: cap_(r.by, 80), id: id });
  var f = {};
  if (odo !== '' && odo > num_(u.currentOdo)) f.currentOdo = odo;
  if (hrs !== '' && hrs > num_(u.currentHours)) f.currentHours = hrs;
  if (Object.keys(f).length) setCells_('Units', u._row, f, u);
  return true;
}

/* =============================== v14: PM-A / PM-B inspection templates (seeded once, editable) =============================== */
function tplItems_(groups) { return groups.map(function (g) { return { s: g[0], crane: !!g[2], items: g[1].map(function (t) { var m = / \(M\)$/.test(t); return { t: t.replace(/ \(M\)$/, ''), m: m }; }) }; }); }
var PM_TRUCK_A = [
  ['A. Paperwork & cab', ['Registration, insurance and CVIP decal current', 'Open defects from pre-trips reviewed', 'Gauges and warning lights', 'Horn', 'Wipers and washer', 'Heater / defroster', 'Mirrors and glass (cracks)', 'Seat and seat belt', 'Doors and latches', 'Fire extinguisher, triangles and first aid kit', 'Dash fault codes read and recorded']],
  ['B. Engine (engine off)', ['Engine oil level', 'Coolant level and condition', 'Power steering fluid', 'DEF level', 'Fuel / oil / coolant leaks', 'Belts (cracks, tension)', 'Hoses and clamps', 'Air filter restriction indicator', 'Fuel / water separator drained', 'Radiator and charge-air cooler (debris, damage)']],
  ['C. Electrical', ['Batteries secure, terminals clean', 'Cables and harness (chafing, corrosion)', 'All lights, signals, 4-ways, brake, marker and clearance lights, reflectors', 'Trailer cord and plug']],
  ['D. Brakes & air', ['Air pressure build-up time and governor cut-in / cut-out (M)', 'Air leak-down test (M)', 'Low-air warning', 'Air tanks drained, air dryer purging', 'Hoses and lines (chafing, leaks)', 'Gladhands and seals', 'Brake chambers and pushrods', 'Slack adjusters and pushrod stroke at every wheel (M)', 'Brake lining thickness at every wheel (M)', 'Drums / rotors (cracks, scoring)', 'Parking brake holds', 'ABS light check']],
  ['E. Steering & suspension', ['Steering free play (M)', 'Tie rod ends, drag link, pitman arm', 'King pins', 'Steering box leaks and mounting', 'Springs (cracked / shifted leaves)', 'U-bolts tight', 'Air bags and height control', 'Shocks', 'Torque rods and bushings']],
  ['F. Tires, wheels & hubs', ['Tread depth every tire (M)', 'Pressure every tire (M)', 'Sidewalls (cuts, bulges)', 'Duals not touching, no debris between', 'Wheel nuts tight, rust streaks, missing nuts', 'Rims and wheels (cracks)', 'Hub oil levels / seals leaking']],
  ['G. Driveline & frame', ['Driveshaft and U-joints (play)', 'Transmission and differential leaks', 'Clutch free play (manual)', 'Frame rails and crossmembers (cracks)', 'Exhaust leaks, hangers, heat shields', 'DPF / aftertreatment warnings', 'Mud flaps', 'Bunks, stakes, headache rack and binders / straps']],
  ['H. Coupling', ['Fifth wheel / pintle hook and safety latch', 'Kingpin or drawbar, eye and safety chains', 'Trailer air and electrical connections']],
  ['I. Grease', ['Grease all chassis fittings (steering, suspension, driveline, fifth wheel)']],
  ['J. Loader crane', ['Hydraulic oil level', 'Hoses and fittings (leaks, chafing)', 'Cylinders (leaks, drift)', 'Boom, pins and bushings (cracks, play, keepers)', 'Slew / rotator', 'Grapple and tines', 'Stabilizers / outriggers hold', 'Operator seat, controls and guards', 'Grease all crane points'], true],
  ['K. Test drive', ['Brakes stop straight', 'Steering', 'Transmission shifting', 'Gauges in normal range', 'No new warning lights']]];
var PM_TRUCK_B = [
  ['L. Service', ['Change engine oil and oil filter (record oil type and litres)', 'Take oil sample (optional)', 'Replace fuel filters', 'Inspect / replace air filter', 'Inspect / replace cabin air filter', 'Transmission and differential oil levels (change if due)', 'Coolant concentration test (M)', 'DEF filter if due']],
  ['M. Deeper checks', ['Alternator output (M)', 'Battery load test (M)', 'Starter draw', 'Wheel bearing play every hub', 'Driveshaft yokes and centre bearing', 'Engine and transmission mounts', 'Turbo and exhaust connections', 'ECM download and act on codes', 'DPF regeneration history', 'Crane hydraulic filter change if due (crane units)']],
  ['N. Reset', ['"Next oil change due at ___ h" sticker updated']]];
var PM_EQUIP_A = [
  ['A. Engine', ['Engine oil level', 'Coolant level', 'Fuel / oil / coolant leaks', 'Belts and hoses', 'Air filter indicator', 'Fuel / water separator drained']],
  ['B. Hydraulics', ['Hydraulic oil level', 'Hoses and fittings (leaks, chafing)', 'Cylinders (leaks, drift)']],
  ['C. Boom / attachment', ['Boom, pins and bushings (cracks, play)', 'Attachment / saw / grapple condition', 'Quick coupler locks']],
  ['D. Tracks or tires', ['Track tension / tire pressure (M)', 'Rollers, idlers, sprockets / wheel nuts', 'Damage and wear']],
  ['E. Cab / ROPS', ['ROPS / FOPS and glass', 'Seat belt', 'Controls, gauges, lights, horn', 'Fire extinguisher']],
  ['F. Grease', ['Grease all fittings']]];
var PM_EQUIP_B = [['G. Service', ['Change engine oil and filter (record litres)', 'Replace fuel filters', 'Hydraulic filter if due', 'Inspect / replace air filter', 'Coolant concentration test (M)']]];
var PM_TRAILER_A = [
  ['A. Lights', ['All lights, markers and reflectors', 'Cord and plug']],
  ['B. Brakes & air', ['Brake chambers and pushrods', 'Slack adjuster stroke every wheel (M)', 'Lining thickness every wheel (M)', 'Air lines, gladhands, tanks drained', 'ABS light']],
  ['C. Tires & wheels', ['Tread depth (M)', 'Pressure (M)', 'Wheel nuts, rims, hub seals']],
  ['D. Frame & bunks', ['Frame and crossmembers (cracks)', 'Bunks, stakes and headache rack', 'Mud flaps', 'Suspension and U-bolts']],
  ['E. Coupling', ['Kingpin / drawbar, eye and safety chains', 'Landing gear']]];
var PM_TRAILER_B = [['F. Service', ['Wheel bearing play every hub', 'Grease all fittings', 'Brake drums / rotors (cracks)']]];
function seedTemplates_() {
  if (props_().getProperty('templatesSeeded')) return;
  if (!rows_('InspectionTemplates').length) appendMany_('InspectionTemplates', [
    { id: 'T-PMA', name: 'PM-A', appliesTo: 'truck', intervalHours: 100, intervalKm: '', intervalDays: '', includesTemplateId: '', itemsJson: JSON.stringify(tplItems_(PM_TRUCK_A)), active: 'yes' },
    { id: 'T-PMB', name: 'PM-B', appliesTo: 'truck', intervalHours: 400, intervalKm: '', intervalDays: '', includesTemplateId: 'T-PMA', itemsJson: JSON.stringify(tplItems_(PM_TRUCK_B)), active: 'yes' },
    { id: 'E-PMA', name: 'PM-A', appliesTo: 'equipment', intervalHours: 100, intervalKm: '', intervalDays: '', includesTemplateId: '', itemsJson: JSON.stringify(tplItems_(PM_EQUIP_A)), active: 'yes' },
    { id: 'E-PMB', name: 'PM-B', appliesTo: 'equipment', intervalHours: 400, intervalKm: '', intervalDays: '', includesTemplateId: 'E-PMA', itemsJson: JSON.stringify(tplItems_(PM_EQUIP_B)), active: 'yes' },
    { id: 'R-PMA', name: 'PM-A', appliesTo: 'trailer', intervalHours: '', intervalKm: 10000, intervalDays: 90, includesTemplateId: '', itemsJson: JSON.stringify(tplItems_(PM_TRAILER_A)), active: 'yes' },
    { id: 'R-PMB', name: 'PM-B', appliesTo: 'trailer', intervalHours: '', intervalKm: 40000, intervalDays: 365, includesTemplateId: 'R-PMA', itemsJson: JSON.stringify(tplItems_(PM_TRAILER_B)), active: 'yes' }]);
  props_().setProperty('templatesSeeded', nowIso_());
}
// The full item list of a template (PM-B = every PM-A item first, then its own). Crane sections only when the unit has a crane.
function templateGroups_(tpl, tpls, unit) {
  var own = parse_(tpl.itemsJson) || [], inc = tpl.includesTemplateId ? byKey_(tpls, 'id', tpl.includesTemplateId) : null;
  var all = (inc ? templateGroups_(inc, tpls, unit) : []).concat(own);
  return all.filter(function (g) { return !g.crane || !unit || String(unit.hasCrane) === 'yes'; });
}
function unitTypeOf_(u) { return String(u.type || 'truck'); }

/* =============================== v14: what is due (service plans, PM sheets, documents) =============================== */
// Returns every item with how far away it is; callers decide what counts as "due soon".
function dueRaw_(units, plans, inspections, tpls, readingsMax) {
  var out = [], now = Date.now(), DAY = 86400000;
  units.forEach(function (u) {
    if (u.status === 'Sold') return;
    var odo = num_(u.currentOdo), hrs = num_(u.currentHours), track = String(u.trackHours) === 'yes';
    // service plan tasks
    plans.filter(function (p) { return String(p.unitId) === String(u.id); }).forEach(function (p) {
      var rem = [];
      if (num_(p.everyKm) > 0 && odo) rem.push({ unit: 'km', left: num_(p.lastDoneOdo) + num_(p.everyKm) - odo });
      if (num_(p.everyHours) > 0 && track) rem.push({ unit: 'h', left: num_(p.lastDoneHours) + num_(p.everyHours) - hrs });
      if (num_(p.everyDays) > 0) rem.push({ unit: 'days', left: ((ms_(p.lastDoneAt) || ms_(u.updatedAt) || now) + num_(p.everyDays) * DAY - now) / DAY });
      if (rem.length) out.push({ kind: 'service', unitId: u.id, unitName: u.name, unitNo: u.unitNo, task: p.task, planId: p.id, rem: rem });
    });
    // PM sheets by template (unit override first). PM-B done also resets PM-A.
    var over = parse_(u.pmOverrides) || {};
    tpls.filter(function (t) { return String(t.active) !== 'no' && String(t.appliesTo) === unitTypeOf_(u); }).forEach(function (t) {
      var o = over[t.id] || {}, ih = o.hours != null && o.hours !== '' ? num_(o.hours) : num_(t.intervalHours), ik = o.km != null && o.km !== '' ? num_(o.km) : num_(t.intervalKm), id = o.days != null && o.days !== '' ? num_(o.days) : num_(t.intervalDays);
      if (!(ih || ik || id)) return;
      var resetBy = tpls.filter(function (x) { return x.id === t.id || x.includesTemplateId === t.id; }).map(function (x) { return x.id; });
      var last = inspections.filter(function (x) { return String(x.unitId) === String(u.id) && resetBy.indexOf(String(x.template)) > -1; }).sort(function (a, b) { return ms_(b.doneAt) - ms_(a.doneAt); })[0];
      var rem = [];
      if (ih && track) rem.push({ unit: 'h', left: (last ? num_(last.hours) : 0) + ih - hrs, at: (last ? num_(last.hours) : 0) + ih });
      if (ik && odo) rem.push({ unit: 'km', left: (last ? num_(last.odo) : 0) + ik - odo, at: (last ? num_(last.odo) : 0) + ik });
      if (id) rem.push({ unit: 'days', left: (((last ? ms_(last.doneAt) : 0) || ms_(u.updatedAt) || now) + id * DAY - now) / DAY });
      if (rem.length) out.push({ kind: 'pm', unitId: u.id, unitName: u.name, unitNo: u.unitNo, task: t.name, templateId: t.id, never: !last, rem: rem });
    });
    // documents
    [['regExpiry', 'Registration'], ['insExpiry', 'Insurance'], ['cvipExpiry', 'CVIP']].forEach(function (x) {
      var t = ms_(u[x[0]]); if (!t) return;
      out.push({ kind: 'doc', unitId: u.id, unitName: u.name, unitNo: u.unitNo, task: x[1] + ' expires ' + day_(u[x[0]]), rem: [{ unit: 'days', left: (t - now) / DAY }] });
    });
  });
  return out;
}
// "due soon" thresholds: dueList (Trucks page) 1000 km / 25 h / 14 days (documents 30 days); alerts 500 km / 10 h / 7 days.
function dueLevel_(it, soonKm, soonH, soonDays) {
  var lvl = '';
  it.rem.forEach(function (r) {
    var soon = r.unit === 'km' ? soonKm : r.unit === 'h' ? soonH : (it.kind === 'doc' ? 30 : soonDays);
    if (r.left <= 0) lvl = 'red'; else if (r.left <= soon && lvl !== 'red') lvl = 'amber';
  });
  return lvl;
}
function dueText_(it) {
  var near = it.rem.slice().sort(function (a, b) { return a.left - b.left; })[0], left = near.left;
  var fmt = function (r) { var v = Math.abs(Math.round(r.left)); return v + (r.unit === 'days' ? (v === 1 ? ' day' : ' days') : ' ' + r.unit); };
  if (it.kind === 'doc') return (it.unitNo || it.unitName) + ': ' + it.task + (left <= 0 ? ' (EXPIRED)' : ' (in ' + fmt(near) + ')');
  return (it.unitNo ? it.unitNo + ' ' : '') + it.unitName + ': ' + it.task + (it.never ? ' (no sheet on record)' : '') + (left <= 0 ? ' overdue by ' + fmt(near) : ' due in ' + fmt(near)) +
    (near.at != null && near.unit !== 'days' ? ' (at ' + Math.round(near.at).toLocaleString() + ' ' + near.unit + ')' : '');
}
function dueAll_() {
  seedTemplates_();
  return dueRaw_(rows_('Units'), rows_('ServicePlans'), rows_('Inspections'), rows_('InspectionTemplates'));
}

/* =============================== v14: work orders =============================== */
function woKey_(unitId, defect) { return String(unitId) + '|' + String(defect || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80); }
function openWOs_(wos, unitId) { return wos.filter(function (w) { return String(w.unitId) === String(unitId) && w.status !== 'Done'; }); }
// One work order per new defect. No second one while the same defect is still open on the same unit,
// and never two for the same shift + defect text (pre-trip) or the same inspection + item.
function defectWO_(o, units, wos) {
  var u = (o.unitId && byKey_(units, 'id', o.unitId)) || unitByName_(units, o.unitName); if (!u) return null;
  var key = woKey_(u.id, o.itemName || o.defect);
  if (wos.some(function (w) { return w.woKey === key && w.status !== 'Done'; })) return null;
  if (o.shiftId && wos.some(function (w) { return String(w.shiftId) === String(o.shiftId) && w.woKey === key; })) return null;
  if (o.inspectionId && wos.some(function (w) { return String(w.inspectionId) === String(o.inspectionId) && w.woKey === key; })) return null;
  var w = { id: 'WO-' + Utilities.getUuid().slice(0, 8), unitId: u.id, unitName: u.name, openedAt: nowIso_(), source: o.source, shiftId: o.shiftId || '', driverName: o.driverName || '',
    defect: cap_(o.defect, 500), severity: o.severity === 'major' ? 'major' : 'minor', status: 'Open', where: '', inspectionId: o.inspectionId || '', itemName: cap_(o.itemName, 200), photo: cap_(o.photo, 500), woKey: key,
    notes: cap_(o.notes, 20000), odoAt: o.odo == null ? '' : o.odo, hoursAt: o.hours == null ? '' : o.hours };
  append_('WorkOrders', w); wos.push(w);
  log_('trucks', 'work order opened', u.name, { id: w.id, defect: w.defect, severity: w.severity, source: w.source });
  if (w.severity === 'major') setUnitStatus_(u.id, 'Out of service', w.defect, units);
  return w;
}
function partsOf_(woId, parts) { return (parts || rows_('WOParts')).filter(function (p) { return String(p.woId) === String(woId); }); }
// Closing a work order writes ONE matching Expenses row (source = workorder), so repair costs are never counted twice.
function closeWO_(w, d, who, units) {
  if (!who.admin) { delete d.shopLabor; delete d.shopParts; delete d.gst; delete d.mechRate; }   // the mechanic never sets $ or rates
  w = byKey_(rows_('WorkOrders'), 'id', w.id) || w;
  var mo = money_(), parts = partsOf_(w.id), partsCost = r2_(parts.reduce(function (s, p) { return s + num_(p.total); }, 0));
  var m = plain_(w), inHouse = (d.where || w.where || 'in-house') !== 'shop';
  ['where', 'shopName', 'mechanicName', 'workDone', 'invoicePhoto', 'odoAt', 'hoursAt', 'notes'].forEach(function (k) { if (d[k] !== undefined) m[k] = cap_(d[k], k === 'notes' ? 20000 : 2000); });
  if (d.mechHours !== undefined) m.mechHours = num_(d.mechHours);
  if (who.admin && d.mechRate !== undefined && d.mechRate !== '') m.mechRate = num_(d.mechRate);
  if (inHouse && (m.mechRate === '' || m.mechRate == null) && m.mechanicName) { var pp = rows_('People').filter(function (x) { return String(x.name).toLowerCase() === String(m.mechanicName).toLowerCase(); })[0]; if (pp) m.mechRate = rateFor_(pp, 'mechanic'); }
  if (inHouse) {
    m.laborCost = r2_(num_(m.mechHours) * num_(m.mechRate) * (1 + mo.employerCostPct / 100));
    m.partsCost = partsCost; m.gst = d.gst !== undefined && d.gst !== '' ? r2_(d.gst) : r2_(partsCost * 0.05);
    m.total = r2_(m.laborCost + m.partsCost);
  } else {
    if (d.shopLabor !== undefined) m.shopLabor = r2_(d.shopLabor); if (d.shopParts !== undefined) m.shopParts = r2_(d.shopParts);
    m.gst = d.gst !== undefined && d.gst !== '' ? r2_(d.gst) : r2_((num_(m.shopLabor) + num_(m.shopParts)) * 0.05);
    m.partsCost = partsCost; m.total = r2_(num_(m.shopLabor) + num_(m.shopParts) + partsCost);
  }
  m.status = 'Done'; m.closedAt = d.closedAt || nowIso_(); m.closedBy = cap_(d.closedBy || who.name, 80);
  m.downDays = w.severity === 'major' ? Math.round((ms_(m.closedAt) - ms_(w.openedAt)) / 8640000) / 10 : 0;
  write_('WorkOrders', w._row, m);
  upsert_('Expenses', 'id', { id: 'WO-EXP-' + w.id, at: nowIso_(), date: String(m.closedAt).slice(0, 10), amount: m.total, gst: m.gst, total: r2_(num_(m.total) + num_(m.gst)),
    category: inHouse ? 'Repairs - parts' : 'Repairs - shop', vendor: inHouse ? (m.mechanicName || 'In-house') : m.shopName, payMethod: '', unitId: w.unitId, driverName: '', loadId: '', yard: '',
    recurringId: '', source: 'workorder', sourceRef: w.id, note: cap_(w.defect, 300), receiptPhoto: m.invoicePhoto || '', by: who.name });
  if (m.odoAt !== '' || m.hoursAt !== '') addReading_({ id: 'WO-' + w.id, unitId: w.unitId, odo: m.odoAt, hours: m.hoursAt, source: 'workorder', by: who.name }, units);
  if (d.planId) { var pl = byKey_(rows_('ServicePlans'), 'id', d.planId); if (pl) { var pf = { lastDoneAt: m.closedAt }; if (m.odoAt !== '') pf.lastDoneOdo = m.odoAt; if (m.hoursAt !== '') pf.lastDoneHours = m.hoursAt; setCells_('ServicePlans', pl._row, pf); } }
  log_('trucks', 'work order closed', w.unitName, { id: w.id, total: m.total, by: m.closedBy });
  // back in service only when no other open MAJOR work order is left (the page asks first)
  if (d.backInService) {
    var others = openWOs_(rows_('WorkOrders'), w.unitId).filter(function (x) { return x.severity === 'major'; });
    if (!others.length) setUnitStatus_(w.unitId, 'In service', '', units);
  }
  return m;
}
// pay rate for a role (People.rates json per role, else hourlyRate)
function rateFor_(person, role) { var r = parse_(person.rates) || {}; return r[role] != null && r[role] !== '' ? num_(r[role]) : num_(person.hourlyRate); }
// what a mechanic (not admin) may see of a work order: no labour $, rates or totals
function woView_(w, admin, parts) {
  var o = plain_(w); o.parts = partsOf_(w.id, parts).map(plain_);
  if (!admin) { ['mechRate', 'laborCost', 'total', 'shopLabor', 'shopParts', 'gst'].forEach(function (k) { delete o[k]; }); }
  return o;
}

/* =============================== v14: TRUCKS service =============================== */
function trucksPost_(p, d) {
  var a = d.action, w = who_(p, d);
  if (!w.office && !w.person) return json_({ status: 'nokey', message: 'Sign in first.' });
  var mech = w.admin || w.roles.indexOf('mechanic') > -1;
  migrateUnits_(); seedTemplates_();
  if (a === 'uploadPhoto') { try { return json_({ status: 'ok', url: savePhoto_(d.data, d.name) }); } catch (e) { return json_({ status: 'error', message: String(e.message || e) }); } }
  if (a === 'listUnits') {
    var wos = rows_('WorkOrders'), due = dueAll_();
    return json_({ status: 'ok', v: SCRIPT_VERSION, admin: w.admin, units: rows_('Units').map(function (u) {
      var o = plain_(u), open = openWOs_(wos, u.id); if (!w.admin) delete o.purchasePrice;
      o.openWOs = open.length; o.openMajor = open.filter(function (x) { return x.severity === 'major'; }).length;
      var mine = due.filter(function (x) { return String(x.unitId) === String(u.id); });
      o.due = mine.map(function (x) { return { lvl: dueLevel_(x, 1000, 25, 14), text: dueText_(x), kind: x.kind, task: x.task, templateId: x.templateId, planId: x.planId, rem: x.rem }; });
      return o;
    }) });
  }
  if (a === 'dueList') {
    return json_({ status: 'ok', items: dueAll_().map(function (x) { return { lvl: dueLevel_(x, 1000, 25, 14), text: dueText_(x), unitId: x.unitId, kind: x.kind, templateId: x.templateId, planId: x.planId }; }).filter(function (x) { return x.lvl; }) });
  }
  if (a === 'listWorkOrders') {
    var parts = rows_('WOParts');
    var list = rows_('WorkOrders').filter(function (x) { return (!d.status || x.status === d.status || (d.status === 'open' && x.status !== 'Done')) && (!d.unitId || String(x.unitId) === String(d.unitId)); });
    return json_({ status: 'ok', admin: w.admin, workOrders: list.reverse().slice(0, Math.min(num_(d.limit) || 300, 1000)).map(function (x) { return woView_(x, w.admin, parts); }) });
  }
  if (a === 'listServicePlans') return json_({ status: 'ok', plans: rows_('ServicePlans').filter(function (x) { return !d.unitId || String(x.unitId) === String(d.unitId); }).map(plain_) });
  if (a === 'listTemplates') {
    var tp = rows_('InspectionTemplates'), u0 = d.unitId ? byKey_(rows_('Units'), 'id', d.unitId) : null;
    return json_({ status: 'ok', templates: tp.map(function (t) { var o = plain_(t); o.items = parse_(t.itemsJson) || []; if (u0) o.groups = templateGroups_(t, tp, u0); return o; }) });
  }
  if (a === 'unitHistory') {
    var un = byKey_(rows_('Units'), 'id', d.unitId); if (!un) return json_({ status: 'error', message: 'Unit not found.' });
    var nm = String(un.name).toLowerCase(), ev = [];
    rows_('Pretrips').forEach(function (x) { if (String(x.unit).toLowerCase() === nm) ev.push({ at: str_(x.at), kind: 'pretrip', text: 'Pre-trip by ' + x.driverName + ': ' + x.result, shiftId: x.shiftId }); });
    rows_('WorkOrders').forEach(function (x) { if (String(x.unitId) === String(un.id)) ev.push({ at: str_(x.openedAt), kind: 'wo', text: (x.source === 'service' ? 'Service: ' : 'Work order: ') + x.defect + ' (' + x.status + ')' + (w.admin && x.total !== '' ? ' $' + x.total : ''), id: x.id }); });
    rows_('Inspections').forEach(function (x) { if (String(x.unitId) === String(un.id)) ev.push({ at: str_(x.doneAt), kind: 'inspection', text: x.template + ' by ' + x.doneBy + ': ' + x.result, id: x.id }); });
    rows_('UnitReadings').forEach(function (x) { if (String(x.unitId) === String(un.id)) ev.push({ at: str_(x.at), kind: 'reading', text: (x.odo !== '' ? x.odo + ' km ' : '') + (x.hours !== '' ? x.hours + ' h ' : '') + '(' + x.source + (x.by ? ', ' + x.by : '') + ')' }); });
    if (w.admin) rows_('Expenses').forEach(function (x) { if (String(x.unitId) === String(un.id) && num_(x.amount)) ev.push({ at: str_(x.date || x.at), kind: 'cost', text: x.category + ': $' + x.amount + (x.vendor ? ' ' + x.vendor : ''), photo: x.receiptPhoto }); });
    ev.sort(function (x, y) { return ms_(y.at) - ms_(x.at); });
    return json_({ status: 'ok', events: ev.slice(0, 400) });
  }
  if (a === 'getPretrip') {
    var pt = rows_('Pretrips').filter(function (x) { return String(x.shiftId) === String(d.shiftId); })[0];
    return json_(pt ? { status: 'ok', pretrip: parse_(pt.json), signature: pt.signature, driverName: pt.driverName, unit: pt.unit, at: str_(pt.at) } : { status: 'error', message: 'Not found.' });
  }
  if (a === 'getInspection') { var ins = byKey_(rows_('Inspections'), 'id', d.id); return json_(ins ? { status: 'ok', inspection: plain_(ins) } : { status: 'error', message: 'Not found.' }); }
  if (a === 'unitCosts') {
    if (!w.admin) return adminFail_(w.ad);
    return json_({ status: 'ok', expenses: rows_('Expenses').filter(function (x) { return String(x.unitId) === String(d.unitId); }).map(plain_), readings: rows_('UnitReadings').filter(function (x) { return String(x.unitId) === String(d.unitId); }).map(plain_),
      workOrders: rows_('WorkOrders').filter(function (x) { return String(x.unitId) === String(d.unitId); }).map(plain_) });
  }
  // ---- inspections: anyone signed in ----
  if (a === 'saveInspection') return json_(saveInspection_(d, w));
  if (a === 'addReading') {
    if (!w.office && !w.person) return json_({ status: 'nokey' });
    var ok = addReading_({ id: d.id, unitId: d.unitId, odo: d.odo, hours: d.hours, source: d.source || 'manual', by: w.name, at: d.at });
    log_('trucks', 'reading', d.unitId, { odo: d.odo, hours: d.hours, by: w.name });
    return json_({ status: 'ok', added: ok });
  }
  // ---- work orders: office or mechanic ----
  if (a === 'saveWorkOrder' || a === 'addPart' || a === 'closeWorkOrder' || a === 'deletePart') {
    if (!mech) return adminFail_(w.ad);
    var units = rows_('Units'), all = rows_('WorkOrders');
    if (a === 'saveWorkOrder') {
      var inc = d.workOrder || {}, ex = inc.id ? byKey_(all, 'id', inc.id) : null;
      if (ex && ex.status === 'Done' && !w.admin) return json_({ status: 'error', message: 'This work order is closed.' });
      var u1 = byKey_(units, 'id', inc.unitId || (ex && ex.unitId)); if (!u1) return json_({ status: 'error', message: 'Pick the unit.' });
      var rec = ex ? plain_(ex) : { id: cap_(inc.id, 40) || 'WO-' + Utilities.getUuid().slice(0, 8), openedAt: nowIso_(), source: inc.source || 'manual', status: 'Open', driverName: w.person ? w.person.name : '' };
      rec.unitId = u1.id; rec.unitName = u1.name;
      ['defect', 'severity', 'status', 'where', 'shopName', 'mechanicName', 'workDone', 'invoicePhoto', 'notes', 'photo'].forEach(function (k) { if (inc[k] !== undefined) rec[k] = cap_(inc[k], k === 'notes' ? 20000 : 2000); });
      (w.admin ? ['mechHours', 'odoAt', 'hoursAt', 'shopLabor', 'shopParts', 'gst'] : ['mechHours', 'odoAt', 'hoursAt']).forEach(function (k) { if (inc[k] !== undefined) rec[k] = inc[k] === '' ? '' : num_(inc[k]); });
      if (w.admin && inc.mechRate !== undefined) rec.mechRate = inc.mechRate === '' ? '' : num_(inc.mechRate);
      if (['Open', 'In progress', 'Done'].indexOf(rec.status) < 0) rec.status = 'Open';
      if (rec.status === 'Done' && (!ex || ex.status !== 'Done')) rec.status = ex ? ex.status : 'Open';   // closing goes through closeWorkOrder
      rec.severity = rec.severity === 'major' ? 'major' : 'minor'; rec.woKey = rec.woKey || woKey_(rec.unitId, rec.defect);
      if (ex) write_('WorkOrders', ex._row, rec); else append_('WorkOrders', rec);
      log_('trucks', ex ? 'work order saved' : 'work order opened', u1.name, { id: rec.id, severity: rec.severity, by: w.name });
      if (rec.severity === 'major' && rec.status !== 'Done') setUnitStatus_(u1.id, 'Out of service', rec.defect, units);
      return json_({ status: 'ok', workOrder: woView_(rec, w.admin) });
    }
    var wo = byKey_(all, 'id', d.woId || d.id); if (!wo) return json_({ status: 'error', message: 'Work order not found.' });
    if (a === 'addPart') {
      var pid = cap_(d.part && d.part.id, 60) || Utilities.getUuid(), pr = d.part || {};
      if (!rows_('WOParts').some(function (x) { return String(x.id) === String(pid); })) {
        append_('WOParts', { woId: wo.id, at: nowIso_(), part: cap_(pr.part, 200), qty: num_(pr.qty) || 1, unitCost: r2_(pr.unitCost), total: r2_((num_(pr.qty) || 1) * num_(pr.unitCost)), vendor: cap_(pr.vendor, 120), receiptPhoto: cap_(pr.receiptPhoto, 500), id: pid });
        log_('trucks', 'part added', wo.unitName, { wo: wo.id, part: pr.part, by: w.name });
      }
      setCells_('WorkOrders', wo._row, { partsCost: r2_(partsOf_(wo.id).reduce(function (s, x) { return s + num_(x.total); }, 0)), status: wo.status === 'Open' ? 'In progress' : wo.status }, wo);
      return json_({ status: 'ok', workOrder: woView_(wo, w.admin) });
    }
    if (a === 'deletePart') {
      var sh = tab_('WOParts'), pl = rows_('WOParts'), hit = pl.filter(function (x) { return String(x.id) === String(d.partId) && String(x.woId) === String(wo.id); })[0];
      if (hit) { sh.deleteRow(hit._row); log_('trucks', 'part removed', wo.unitName, { wo: wo.id, part: hit.part, by: w.name }); }
      return json_({ status: 'ok' });
    }
    if (a === 'closeWorkOrder') {
      if (wo.status === 'Done' && !w.admin) return json_({ status: 'ok', already: true });
      var done = closeWO_(wo, d, w, units);
      var still = openWOs_(rows_('WorkOrders'), wo.unitId).filter(function (x) { return x.severity === 'major'; }).length;
      return json_({ status: 'ok', workOrder: woView_(done, w.admin), openMajorLeft: still });
    }
  }
  if (a === 'markSeen') {
    if (!w.office) return adminFail_(w.ad);
    var ids = d.ids || [], allw = rows_('WorkOrders'), n = 0;
    allw.forEach(function (x) { if (ids.indexOf(x.id) > -1 && !x.seenAt) { setCells_('WorkOrders', x._row, { seenAt: nowIso_(), seenBy: w.name }); n++; } });
    return json_({ status: 'ok', seen: n });
  }
  // ---- office only ----
  if (!w.admin) return adminFail_(w.ad);
  if (a === 'saveUnit') {
    var uu = d.unit || {}, allu = rows_('Units'), ex2 = uu.id ? byKey_(allu, 'id', uu.id) : null;
    var name = cap_(uu.name, 60).trim(); if (!name) return json_({ status: 'error', message: 'Enter the unit name.' });
    if (allu.some(function (x) { return x !== ex2 && String(x.name).toLowerCase() === name.toLowerCase() && x.status !== 'Sold'; })) return json_({ status: 'error', message: 'Another unit already has that name.' });
    var rec2 = ex2 ? plain_(ex2) : { id: cap_(uu.id, 40) || Utilities.getUuid(), status: 'In service', currentOdo: '', currentHours: '' };
    UNIT_FIELDS.forEach(function (k) { if (uu[k] !== undefined) rec2[k] = typeof uu[k] === 'object' ? JSON.stringify(uu[k]) : cap_(uu[k], k === 'notes' ? 2000 : 500); });
    rec2.name = name; rec2.updatedAt = nowIso_(); if (['truck', 'trailer', 'equipment'].indexOf(rec2.type) < 0) rec2.type = 'truck';
    if (['In service', 'Out of service', 'Sold'].indexOf(rec2.status) < 0) rec2.status = 'In service';
    if (ex2) write_('Units', ex2._row, rec2); else append_('Units', rec2);
    if (uu.currentOdo !== undefined || uu.currentHours !== undefined) addReading_({ id: 'SET-' + rec2.id + '-' + Date.now(), unitId: rec2.id, odo: uu.currentOdo, hours: uu.currentHours, source: 'manual', by: w.name });
    syncDrvUnits_(); log_('trucks', ex2 ? 'unit saved' : 'unit added', name, { by: w.name, status: rec2.status });
    return json_({ status: 'ok', unit: rec2 });
  }
  if (a === 'deleteUnit') {      // never deletes the row: marks it Sold
    var u2 = byKey_(rows_('Units'), 'id', d.id); if (!u2) return json_({ status: 'error', message: 'Unit not found.' });
    setCells_('Units', u2._row, { status: 'Sold', updatedAt: nowIso_() }, u2); syncDrvUnits_(); log_('trucks', 'unit sold', u2.name, { by: w.name });
    return json_({ status: 'ok' });
  }
  if (a === 'setOverride') {     // office lets drivers use an out-of-service unit, until the office turns it off
    var u3 = byKey_(rows_('Units'), 'id', d.unitId); if (!u3) return json_({ status: 'error', message: 'Unit not found.' });
    var m3 = { oosOverride: d.on ? 'yes · ' + w.name + ' · ' + today_() : '' }; setCells_('Units', u3._row, m3, u3);
    log_('trucks', d.on ? 'out-of-service override ON' : 'out-of-service override OFF', u3.name, { by: w.name });
    return json_({ status: 'ok', oosOverride: m3.oosOverride });
  }
  if (a === 'saveServicePlan') {
    var sp = d.plan || {}; if (!sp.unitId || !String(sp.task || '').trim()) return json_({ status: 'error', message: 'Pick the unit and name the task.' });
    var rec3 = { id: cap_(sp.id, 40) || Utilities.getUuid(), unitId: sp.unitId, task: cap_(sp.task, 200), everyKm: sp.everyKm === '' ? '' : num_(sp.everyKm), everyHours: sp.everyHours === '' ? '' : num_(sp.everyHours),
      everyDays: sp.everyDays === '' ? '' : num_(sp.everyDays), lastDoneAt: cap_(sp.lastDoneAt, 40), lastDoneOdo: sp.lastDoneOdo === '' || sp.lastDoneOdo == null ? '' : num_(sp.lastDoneOdo), lastDoneHours: sp.lastDoneHours === '' || sp.lastDoneHours == null ? '' : num_(sp.lastDoneHours), notes: cap_(sp.notes, 1000) };
    upsert_('ServicePlans', 'id', rec3); log_('trucks', 'service plan saved', sp.task, { unit: sp.unitId, by: w.name });
    return json_({ status: 'ok', plan: rec3 });
  }
  if (a === 'saveTemplate') {    // changes the template for FUTURE sheets only (every completed sheet keeps its own copy of the items)
    var t = d.template || {}, ex4 = byKey_(rows_('InspectionTemplates'), 'id', t.id); if (!ex4) return json_({ status: 'error', message: 'Template not found.' });
    var m4 = plain_(ex4);
    ['intervalHours', 'intervalKm', 'intervalDays'].forEach(function (k) { if (t[k] !== undefined) m4[k] = t[k] === '' ? '' : num_(t[k]); });
    if (t.items) { var js = JSON.stringify(t.items); if (js.length > 45000) return json_({ status: 'error', message: 'Too many items.' }); m4.itemsJson = js; }
    if (t.active !== undefined) m4.active = t.active ? 'yes' : 'no';
    write_('InspectionTemplates', ex4._row, m4); log_('trucks', 'template saved', ex4.name + ' (' + ex4.appliesTo + ')', { by: w.name });
    return json_({ status: 'ok' });
  }
  return json_({ status: 'error', message: 'Unknown action: ' + a, v: SCRIPT_VERSION });
}

// A completed PM sheet. Every Defect makes a work order (same de-duplication as pre-trip defects); Major = out of service.
function saveInspection_(d, w) {
  var ins = d.inspection || {}, id = cap_(ins.id, 60); if (!id) return { status: 'error', message: 'Missing id.' };
  if (rows_('Inspections').some(function (x) { return String(x.id) === id; })) return { status: 'ok', duplicate: true };
  var units = rows_('Units'), u = byKey_(units, 'id', ins.unitId); if (!u) return { status: 'error', message: 'Unit not found.' };
  var items = ins.items || [], unanswered = items.filter(function (x) { return !x.a; }).length;
  if (unanswered) return { status: 'error', message: unanswered + ' item(s) have no answer.' };
  var sig = ins.signature && /^data:/.test(ins.signature) ? savePhoto_(ins.signature, 'Signature ' + u.name + ' ' + today_()) : cap_(ins.signature, 500);
  var by = w.person ? w.person.name : cap_(ins.doneBy, 80) || w.name, role = w.person ? (rolesOf_(w.person).indexOf('mechanic') > -1 ? 'mechanic' : rolesOf_(w.person)[0]) : 'office';
  var defects = items.filter(function (x) { return x.a === 'defect'; }), wos = rows_('WorkOrders'), made = [];
  defects.forEach(function (x) {
    var wo = defectWO_({ source: 'inspection', inspectionId: id, unitId: u.id, itemName: x.t, defect: x.t + (x.note ? ': ' + x.note : ''), severity: x.sev, photo: x.photo, driverName: by, odo: ins.odo, hours: ins.hours }, units, wos);
    if (wo) made.push(wo.id);
  });
  var itemsJs = JSON.stringify(items);
  if (itemsJs.length > 45000) itemsJs = JSON.stringify(items.map(function (x) { return { t: x.t, a: x.a, sev: x.sev, v: x.v, note: cap_(x.note, 80) }; })).slice(0, 45000);
  append_('Inspections', { id: id, unitId: u.id, unitName: u.name, template: cap_(ins.template, 40), doneAt: ins.doneAt || nowIso_(), doneBy: by, role: role, odo: ins.odo === '' ? '' : num_(ins.odo),
    hours: ins.hours === '' ? '' : num_(ins.hours), result: defects.length ? 'DEFECTS' : 'OK', itemsJson: itemsJs, measurementsJson: cap_(JSON.stringify(ins.measurements || {}), 20000),
    signature: sig, notes: cap_(ins.notes, 2000), woIds: made.join(',') });
  addReading_({ id: 'INS-' + id, unitId: u.id, odo: ins.odo, hours: ins.hours, source: 'inspection', by: by }, units);
  log_('trucks', 'inspection ' + (ins.templateName || ins.template), u.name, { by: by, result: defects.length ? 'DEFECTS' : 'OK', workOrders: made });
  return { status: 'ok', workOrders: made };
}

/* =============================== v14: driver shifts feed Trucks and Money =============================== */
// Runs after every saved shift. Only does work when the defects, readings or fuel changed (cheap on the 15-minute heartbeat).
function tieShift_(drv, sh, isSubmit) {
  try {
    var pt = sh.pretrip || {}, sig = JSON.stringify([pt.done ? (pt.defectItems || pt.defectList || []) : [], sh.startOdo, sh.endOdo, sh.startHours, sh.endHours, (sh.fuel || []).map(function (f) { return [f.id, f.litres, f.cost, f.gst, f.pay, f.photo]; }), isSubmit]);
    var cache = CacheService.getScriptCache(), ck = 'tie_' + String(sh.id).slice(0, 200), h = sha_(sig);
    if (cache.get(ck) === h) return;
    migrateUnits_();
    var units = rows_('Units'), u = (sh.unitId && byKey_(units, 'id', sh.unitId)) || unitByName_(units, sh.unit), yard = sh.type === 'yard';
    // pre-trip defects -> work orders (a defect the driver marked "still there" is not entered again)
    if (!yard && u && pt.done && pt.defects) {
      var wos = rows_('WorkOrders'), list = pt.defectItems && pt.defectItems.length ? pt.defectItems : (pt.defectList || []).map(function (t) { return { item: t, severity: 'minor', note: pt.defectNote }; });
      list.forEach(function (x) {
        if (x.known) return;
        defectWO_({ source: 'pretrip', shiftId: sh.id, unitId: u.id, itemName: x.item, defect: x.item + (x.note || pt.defectNote ? ': ' + (x.note || pt.defectNote) : ''), severity: x.severity, driverName: drv.name, odo: sh.startOdo, hours: sh.startHours, notes: cap_(JSON.stringify({ pretrip: { at: pt.at, items: pt.items, defectList: pt.defectList, defectNote: pt.defectNote } }), 20000) }, units, wos);
      });
    }
    // readings
    if (!yard && u) {
      if (sh.startOdo !== '' && sh.startOdo != null || sh.startHours != null && sh.startHours !== '') addReading_({ id: sh.id + '-start', unitId: u.id, odo: sh.startOdo, hours: sh.startHours, source: 'shift-start', shiftId: sh.id, by: drv.name, at: sh.startedAt }, units);
      if (sh.endOdo !== '' && sh.endOdo != null || sh.endHours != null && sh.endHours !== '') addReading_({ id: sh.id + '-end', unitId: u.id, odo: sh.endOdo, hours: sh.endHours, source: 'shift-end', shiftId: sh.id, by: drv.name, at: sh.closedAt }, units);
    }
    (sh.equip || []).forEach(function (e, i) {      // yard work: equipment engine hours
      var eu = byKey_(units, 'id', e.unitId); if (!eu) return;
      if (e.startHours !== '' && e.startHours != null) addReading_({ id: sh.id + '-eq' + i + '-start', unitId: eu.id, hours: e.startHours, source: 'shift-start', shiftId: sh.id, by: drv.name }, units);
      if (e.endHours !== '' && e.endHours != null) addReading_({ id: sh.id + '-eq' + i + '-end', unitId: eu.id, hours: e.endHours, source: 'shift-end', shiftId: sh.id, by: drv.name }, units);
    });
    // fuel -> Expenses (source = fuel). An entry removed on the phone is zeroed, never deleted.
    var exps = rows_('Expenses'), seen = {};
    (sh.fuel || []).forEach(function (f, i) {
      var fid = 'FUEL-' + sh.id + '-' + (f.id || (i + '-' + String(f.at || '').replace(/[^0-9]/g, '').slice(-6))); seen[fid] = 1;
      var cost = r2_(f.cost), gst = f.gst !== undefined && f.gst !== '' ? r2_(f.gst) : r2_(cost * 0.05), fu = (f.unitId && byKey_(units, 'id', f.unitId)) || u;
      upsert_('Expenses', 'id', { id: fid, at: f.at || nowIso_(), date: String(f.at || sh.date || '').slice(0, 10), amount: cost, gst: gst, total: r2_(cost + gst), category: 'Fuel', vendor: cap_(f.place, 120),
        payMethod: cap_(f.pay, 30), unitId: fu ? fu.id : '', driverName: drv.name, loadId: '', yard: cap_(sh.yard, 80), recurringId: '', source: 'fuel', sourceRef: sh.id, note: cap_((f.litres || '') + ' L ' + (f.note || ''), 300), receiptPhoto: cap_(f.photo, 500), by: drv.name }, exps);
    });
    exps.forEach(function (x) { if (x.source === 'fuel' && String(x.sourceRef) === String(sh.id) && !seen[x.id] && num_(x.amount)) { var m = plain_(x); m.amount = 0; m.gst = 0; m.total = 0; m.note = 'removed from the shift · ' + m.note; write_('Expenses', x._row, m); } });
    cache.put(ck, h, 21600);
  } catch (e) { log_('drivers', 'tie-in error', sh.id, String(e)); }
}
// Units for a driver phone: status, open work orders, engine-hour tracking. Never pay rates.
function drvUnits_() {
  var units = rows_('Units'); if (!units.length) return null;
  var wos = rows_('WorkOrders'), due = []; try { due = dueAll_(); } catch (e) {}
  return units.filter(function (u) { return u.status !== 'Sold'; }).map(function (u) {
    var open = openWOs_(wos, u.id), mine = due.filter(function (x) { return String(x.unitId) === String(u.id) && x.kind !== 'doc'; });
    return { id: u.id, name: u.name, unitNo: u.unitNo, type: u.type || 'truck', plate: u.plate, trailerA: u.trailerA, trailerB: u.trailerB, notes: u.notes, status: u.status || 'In service', outReason: u.outReason,
      override: !!u.oosOverride, trackHours: String(u.trackHours) === 'yes', currentHours: u.currentHours, currentOdo: u.currentOdo, hasCrane: String(u.hasCrane) === 'yes',
      openWOs: open.map(function (x) { return { id: x.id, defect: x.defect, severity: x.severity, itemName: x.itemName }; }),
      alerts: mine.map(function (x) { return { lvl: dueLevel_(x, 500, 10, 7), text: dueText_(x) }; }).filter(function (x) { return x.lvl; }) };
  });
}

/* =============================== v14: MONEY service (office only) =============================== */
function moneyPost_(p, d) {
  var a = d.action, ad = isAdmin_(p, d); if (!ad.ok) return adminFail_(ad);
  var who = adminName_(d) || 'office';
  goLive_();
  if (a === 'listExpenses') { var f0 = d.from || '', t0 = d.to || '9999'; return json_({ status: 'ok', expenses: rows_('Expenses').filter(function (x) { var dt = day_(x.date) || str_(x.at).slice(0, 10); return dt >= f0 && dt <= t0; }).map(plain_) }); }
  if (a === 'saveExpense') {
    var e = d.expense || {}, id = cap_(e.id, 60); if (!id) return json_({ status: 'error', message: 'Missing id.' });
    var ex = byKey_(rows_('Expenses'), 'id', id);
    if (ex && (ex.source === 'workorder' || ex.source === 'fuel')) return json_({ status: 'error', message: 'This cost comes from a ' + ex.source + '. Change it there.' });
    var amt = r2_(e.amount), gst = e.gst === '' || e.gst == null ? r2_(amt * 0.05) : r2_(e.gst);
    var photo = e.receiptPhoto && /^data:/.test(e.receiptPhoto) ? savePhoto_(e.receiptPhoto, 'Receipt ' + (e.vendor || '') + ' ' + (e.date || today_())) : cap_(e.receiptPhoto, 500);
    var rec = { id: id, at: ex ? str_(ex.at) : nowIso_(), date: cap_(e.date, 10) || today_(), amount: amt, gst: gst, total: r2_(amt + gst), category: cap_(e.category, 80), vendor: cap_(e.vendor, 120), payMethod: cap_(e.payMethod, 30),
      unitId: cap_(e.unitId, 60), driverName: cap_(e.driverName, 80), loadId: cap_(e.loadId, 80), yard: cap_(e.yard, 80), recurringId: ex ? ex.recurringId : '', source: ex ? (ex.source || 'manual') : (e.source === 'ticket' ? 'ticket' : 'manual'),
      sourceRef: cap_(e.sourceRef, 80), note: cap_(e.note, 500), receiptPhoto: photo, by: who };
    upsert_('Expenses', 'id', rec); log_('money', ex ? 'expense edited' : 'expense added', rec.vendor || rec.category, { amount: amt, gst: gst, by: who });
    return json_({ status: 'ok', expense: rec });
  }
  if (a === 'deleteExpense') {
    var ex2 = byKey_(rows_('Expenses'), 'id', d.id); if (!ex2) return json_({ status: 'ok' });
    if (ex2.source === 'workorder' || ex2.source === 'fuel') return json_({ status: 'error', message: 'This cost comes from a ' + ex2.source + '. Change it there.' });
    tab_('Expenses').deleteRow(ex2._row); log_('money', 'expense deleted', ex2.vendor || ex2.category, { amount: ex2.amount, by: who });
    return json_({ status: 'ok' });
  }
  if (a === 'listRecurring') return json_({ status: 'ok', recurring: rows_('Recurring').map(plain_) });
  if (a === 'saveRecurring') {
    var r = d.recurring || {}; if (!r.id || !String(r.name || '').trim()) return json_({ status: 'error', message: 'Name the bill.' });
    var amt2 = r2_(r.amount);
    var rec2 = { id: cap_(r.id, 60), name: cap_(r.name, 120), category: cap_(r.category, 80), amount: amt2, gst: r.gst === '' || r.gst == null ? 0 : r2_(r.gst), dayOfMonth: Math.min(31, Math.max(1, num_(r.dayOfMonth) || 1)),
      unitId: cap_(r.unitId, 60), startDate: cap_(r.startDate, 10), endDate: cap_(r.endDate, 10), active: r.active === false || r.active === 'no' ? 'no' : 'yes' };
    upsert_('Recurring', 'id', rec2); log_('money', 'recurring bill saved', rec2.name, { amount: amt2, by: who });
    return json_({ status: 'ok', recurring: rec2 });
  }
  if (a === 'savePayment') {
    var pm = d.payment || {}, pid = cap_(pm.id, 60); if (!pid) return json_({ status: 'error', message: 'Missing id.' });
    if (byKey_(rows_('Payments'), 'id', pid)) return json_({ status: 'ok', duplicate: true });
    var rec3 = { id: pid, loadId: cap_(pm.loadId, 80), invoiceNo: cap_(pm.invoiceNo, 80), customer: cap_(pm.customer, 120), paidAt: cap_(pm.paidAt, 10) || today_(), amount: r2_(pm.amount), method: cap_(pm.method, 20), note: cap_(pm.note, 300), by: who };
    if (!(rec3.amount > 0)) return json_({ status: 'error', message: 'Enter the amount paid.' });
    append_('Payments', rec3); log_('money', 'payment recorded', rec3.invoiceNo || rec3.loadId, { amount: rec3.amount, method: rec3.method, by: who });
    return json_({ status: 'ok', payment: rec3 });
  }
  if (a === 'deletePayment') {
    var p2 = byKey_(rows_('Payments'), 'id', d.id); if (p2) { tab_('Payments').deleteRow(p2._row); log_('money', 'payment deleted', p2.invoiceNo || p2.loadId, { amount: p2.amount, by: who }); }
    return json_({ status: 'ok' });
  }
  if (a === 'listPayments') return json_({ status: 'ok', payments: rows_('Payments').map(plain_), invoices: rows_('Invoices').map(function (x) { var o = plain_(x); o.model = parse_(x.json); delete o.json; return o; }), goLive: goLive_() });
  if (a === 'listPeople') return json_({ status: 'ok', people: rows_('People').map(plain_) });
  if (a === 'savePeople') {
    (d.people || []).forEach(function (x) {
      if (!x.id) return;
      upsert_('People', 'id', { id: cap_(x.id, 60), name: cap_(x.name, 80), role: cap_(x.role, 20), hourlyRate: r2_(x.hourlyRate), active: x.active === false ? 'false' : 'true', roles: cap_((x.roles || []).join ? x.roles.join(',') : x.roles, 60), rates: x.rates ? JSON.stringify(x.rates) : '' });
    });
    log_('money', 'pay rates saved', '', (d.people || []).length + ' people');       // the rates themselves are not logged
    return json_({ status: 'ok' });
  }
  if (a === 'saveInvoice') {   // manual invoices (no load row) so Owing and Statistics see them
    var iv = d.invoice || {}, no = cap_(iv.invoiceNo, 80); if (!no) return json_({ status: 'error', message: 'Missing invoice number.' });
    upsert_('Invoices', 'invoiceNo', { invoiceNo: no, at: nowIso_(), customer: cap_(iv.customer, 120), address: cap_(iv.address, 300), phone: cap_(iv.phone, 40), loadId: cap_(iv.loadId, 80), ticket: cap_(iv.ticket, 80),
      sub: r2_(iv.sub), gst: r2_(iv.gst), total: r2_(iv.total), product: r2_(iv.product), trucking: r2_(iv.trucking), fsc: r2_(iv.fsc), json: cap_(JSON.stringify(iv.model || {}), 40000) });
    log_('money', 'manual invoice saved', no, { total: iv.total, by: who });
    return json_({ status: 'ok' });
  }
  if (a === 'summary') return json_(summary_(d));
  return json_({ status: 'error', message: 'Unknown action: ' + a, v: SCRIPT_VERSION });
}
// Everything the Statistics page needs for a date range, in one call. Shifts are sent compact (never the full log json).
function summary_(d) {
  var from = String(d.from || '2000-01-01'), to = String(d.to || '9999-12-31'), fromMs = ms_(from + 'T00:00:00') - 8 * 86400000, toMs = ms_(to + 'T23:59:59') + 86400000;
  var inRange = function (v) { var t = ms_(v); return !t || (t >= fromMs && t <= toMs); };
  var shifts = rows_('Shifts').filter(function (s) { return inRange(s.startedAt); }).map(function (s) {
    var j = parse_(s.json) || {};
    return { id: s.shiftId, driverId: s.driverId, driverName: s.driverName, type: s.shiftType || j.type || 'driving', unit: s.unit, unitId: s.unitId || j.unitId || '', startedAt: iso_(s.startedAt), closedAt: j.closedAt || iso_(s.submittedAt), status: s.status,
      startOdo: s.startOdo, endOdo: s.endOdo, startHours: s.startHours !== '' ? s.startHours : j.startHours, endHours: s.endHours !== '' ? s.endHours : j.endHours, drivingHrs: s.drivingHrs, onDutyHrs: s.onDutyHrs, yard: j.yard || '',
      fuel: (j.fuel || []).map(function (f) { return { litres: f.litres, cost: f.cost, gst: f.gst, unitId: f.unitId }; }), trips: (j.trips || []).map(function (t) { return { loadId: t.loadId, stages: t.stages || [], legs: t.legs || null }; }),
      tasks: j.tasks || [], equip: j.equip || [], defects: j.pretrip && j.pretrip.defects ? (j.pretrip.defectList || []).length : 0 };
  });
  var ticketsAll = ticketRows_();
  return { status: 'ok', v: SCRIPT_VERSION, from: from, to: to, goLive: goLive_(), money: money_(), loads: loadRows_().map(function (l) { delete l.notes; return l; }),
    tickets: ticketsAll, yards: yardRowsAll_(), shifts: shifts, expenses: rows_('Expenses').map(plain_), payments: rows_('Payments').map(plain_), invoices: rows_('Invoices').map(function (x) { var o = plain_(x); delete o.json; return o; }),
    workOrders: rows_('WorkOrders').map(function (x) { var o = plain_(x); delete o.notes; return o; }), people: rows_('People').map(plain_), drivers: rows_('Drivers').map(function (x) { return { id: x.id, name: x.name, roles: rolesOf_(x) }; }),
    units: rows_('Units').map(plain_), recurring: rows_('Recurring').map(plain_), plans: rows_('ServicePlans').map(plain_) };
}
// Posts each active recurring bill once a month on its day (lastPostedFor = yyyy-MM, so it never posts twice). Runs inside nightly().
function postRecurring_() {
  var now = new Date(), ym = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM'), dom = Number(Utilities.formatDate(now, Session.getScriptTimeZone(), 'd'));
  var last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(), td = today_(), exps = rows_('Expenses');
  rows_('Recurring').forEach(function (r) {
    if (String(r.active) === 'no' || String(r.lastPostedFor) === ym) return;
    if (r.startDate && day_(r.startDate) > td) return; if (r.endDate && day_(r.endDate) < td) return;
    if (dom < Math.min(num_(r.dayOfMonth) || 1, last)) return;
    var id = 'REC-' + r.id + '-' + ym;
    if (!byKey_(exps, 'id', id)) append_('Expenses', { id: id, at: nowIso_(), date: td, amount: r2_(r.amount), gst: r2_(r.gst), total: r2_(num_(r.amount) + num_(r.gst)), category: r.category, vendor: r.name, payMethod: '', unitId: r.unitId || '',
      driverName: '', loadId: '', yard: '', recurringId: r.id, source: 'recurring', sourceRef: ym, note: 'Monthly bill', receiptPhoto: '', by: 'nightly' });
    var m = plain_(r); m.lastPostedFor = ym; write_('Recurring', r._row, m);
    log_('money', 'recurring bill posted', r.name, { month: ym, amount: r.amount });
  });
}


/* =============================== v14: Inventory (yard drops, logs -> split, delivery Out rows) =============================== */
// Stock per yard + species + product, at WEIGHTED AVERAGE cost (logs per tonne, split per cord). Pending and Void rows never count.
function yardNames_() { var o = {}; yardRowsAll_().forEach(function (r) { if (r.yard) o[r.yard] = 1; }); return Object.keys(o); }
function yardCounts_(r) { var st = String(r.status || ''); return st !== 'Pending' && st !== 'Void'; }
function yardStock_(rows, yard, species, product) {
  var split = product === 'Split', q = 0, val = 0, lastAvg = 0;
  rows.filter(function (r) { return r.yard === yard && String(r.species) === String(species) && (String(r.product || 'Logs') === (split ? 'Split' : 'Logs')) && yardCounts_(r); })
    .sort(function (a, b) { return ms_(a.timestamp) - ms_(b.timestamp); }).forEach(function (r) {
      var qty = split ? num_(r.cords) : num_(r.tonnes), unit = split ? (num_(r.costPerCord) || num_(r.pricePerCord)) : (num_(r.costPerTonne) || num_(r.pricePerTonne));
      if (r.type === 'Out') { var avg = q > 0 ? val / q : lastAvg; q -= qty; val -= qty * avg; if (q <= 0) val = 0; }
      else if (qty >= 0) { if (q < 0) { q += qty; val = Math.max(q, 0) * unit; } else { q += qty; val += qty * unit; } if (unit) lastAvg = unit; }
      else { var a2 = q > 0 ? val / q : lastAvg; q += qty; val += qty * a2; }
      if (q > 0) lastAvg = val / q || lastAvg;
    });
  return { qty: Math.round(q * 100) / 100, avg: q > 0 ? Math.round(val / q * 100) / 100 : Math.round(lastAvg * 100) / 100 };
}
function yardRow_(o) {
  return [o.timestamp || nowIso_(), o.yard || '', o.species || '', o.type || 'In', o.tonnes || 0, o.cords || 0, o.pricePerTonne || 0, o.pricePerCord || 0, o.ticket || '', o.notes || '', o.source || '', o.unit || '',
    o.product || 'Logs', o.costPerTonne === undefined ? '' : o.costPerTonne, o.costPerCord === undefined ? '' : o.costPerCord, o.haulCost === undefined ? '' : o.haulCost, o.processId || '', o.status || 'Confirmed',
    o.loadId || '', o.pendingTonnes === undefined ? '' : o.pendingTonnes, o.entryId || '', o.by || ''];
}
function yardAppend_(list) {
  if (!list.length) return; var sh = sheet_('Yards'), r = Math.max(sh.getLastRow() + 1, 2);
  sh.getRange(r, 1, list.length, YARD_ALL.length).setValues(list.map(yardRow_));
}
function yardHasEntry_(rows, id) { return !!id && rows.some(function (r) { return String(r.entryId) === String(id); }); }
// set some v14 cells of one Yards row (columns M.. only, plus Tonnes/Cords when confirming or voiding)
function yardSet_(row, fields) {
  var sh = sheet_('Yards'), col = { tonnes: 5, cords: 6, pricePerTonne: 7, pricePerCord: 8, notes: 10, costPerTonne: 14, costPerCord: 15, haulCost: 16, status: 18, pendingTonnes: 20 };
  Object.keys(fields).forEach(function (k) { if (col[k]) sh.getRange(row, col[k]).setValue(fields[k]); });
}
// A driver's drop at a yard waits as Pending (Tonnes = 0, so old pages never count it) until the office confirms it.
function yardDrop_(d, drv) {
  var x = d.drop || {}, rows = yardRowsAll_(), id = cap_(x.id, 60); if (!id) return { status: 'error', message: 'Missing id.' };
  if (yardHasEntry_(rows, id)) return { status: 'ok', duplicate: true };
  var t = num_(x.tonnes); if (!(t > 0) || !x.yard || !x.species) return { status: 'error', message: 'Yard, species and tonnes are needed.' };
  yardAppend_([{ yard: cap_(x.yard, 80), species: cap_(x.species, 60), type: 'In', tonnes: 0, cords: 0, notes: cap_('Driver drop: ' + drv.name + (x.note ? ' · ' + x.note : ''), 300), source: cap_(x.source, 120), unit: cap_(x.unit, 60),
    product: 'Logs', status: 'Pending', loadId: cap_(x.loadId, 80), pendingTonnes: t, entryId: id, by: drv.name }]);
  log_('yards', 'drop waiting for office', x.yard, { species: x.species, tonnes: t, by: drv.name });
  return { status: 'ok' };
}
function yardsV14_(d, who) {
  var a = d.action, rows = yardRowsAll_();
  if (a === 'drop') {          // office: a confirmed drop with wood price + haul cost worked out on the page (editable)
    var x = d.drop || {}; if (yardHasEntry_(rows, x.id)) return { status: 'ok', duplicate: true };
    var t = num_(x.tonnes); if (!(t > 0)) return { status: 'error', message: 'Enter the tonnes.' };
    var wood = r2_(x.woodPrice), haul = r2_(x.haulCost), cpt = r2_(wood + (t ? haul / t : 0));
    yardAppend_([{ yard: cap_(x.yard, 80), species: cap_(x.species, 60), type: 'In', tonnes: t, cords: x.cords || '', pricePerTonne: cpt, ticket: cap_(x.ticket, 80), notes: cap_(x.notes, 300), source: cap_(x.source, 120), unit: cap_(x.unit, 60),
      product: 'Logs', costPerTonne: cpt, haulCost: haul, status: 'Confirmed', loadId: cap_(x.loadId, 80), entryId: cap_(x.id, 60), by: who }]);
    log_('yards', 'drop at yard', x.yard, { species: x.species, tonnes: t, wood: wood, haul: haul, by: who });
    return { status: 'ok' };
  }
  if (a === 'confirmDrop') {
    var p = rows.filter(function (r) { return String(r.entryId) === String(d.id) && r.status === 'Pending'; })[0]; if (!p) return { status: 'error', message: 'That drop is not waiting any more.' };
    var t2 = num_(d.tonnes != null && d.tonnes !== '' ? d.tonnes : p.pendingTonnes), wood2 = r2_(d.woodPrice), haul2 = r2_(d.haulCost), cpt2 = r2_(wood2 + (t2 ? haul2 / t2 : 0));
    yardSet_(p._row, { tonnes: t2, pricePerTonne: cpt2, costPerTonne: cpt2, haulCost: haul2, status: 'Confirmed' });
    log_('yards', 'drop confirmed', p.yard, { species: p.species, tonnes: t2, wood: wood2, haul: haul2, by: who });
    return { status: 'ok' };
  }
  if (a === 'process') {       // logs -> split: one Out row (logs) + one In row (split) sharing a ProcessId
    var pr = d.process || {}, pid = cap_(pr.id, 60); if (!pid) return { status: 'error', message: 'Missing id.' };
    if (rows.some(function (r) { return String(r.processId) === pid; })) return { status: 'ok', duplicate: true };
    var cords = num_(pr.cords), f = num_(pr.factor) || 1.8, waste = num_(pr.wastePct), raw = Math.round(cords * f * (1 + waste / 100) * 100) / 100;
    if (!(cords > 0)) return { status: 'error', message: 'Enter the cords produced.' };
    var st = yardStock_(rows, pr.yard, pr.species, 'Logs'), avgT = num_(pr.logCostPerTonne) || st.avg;
    var other = r2_(num_(pr.labour) + num_(pr.equipFuel) + num_(pr.equipWear) + num_(pr.otherCost)), cpc = r2_((raw * avgT + other) / cords);
    var ts = nowIso_(), detail = JSON.stringify({ raw: raw, avgT: avgT, labourHours: pr.labourHours, labour: pr.labour, equipHours: pr.equipHours, equipFuel: pr.equipFuel, equipWear: pr.equipWear, other: pr.otherCost, waste: waste, factor: f, sell: pr.sellPerCord }).slice(0, 900);
    yardAppend_([
      { timestamp: ts, yard: pr.yard, species: pr.species, type: 'Out', tonnes: raw, cords: '', pricePerTonne: avgT, notes: 'Processed to split', product: 'Logs', costPerTonne: avgT, processId: pid, status: 'Confirmed', entryId: pid + '-out', by: who },
      { timestamp: ts, yard: pr.yard, species: pr.species, type: 'In', tonnes: Math.round(cords * f * 100) / 100, cords: cords, pricePerTonne: r2_(cpc / f), pricePerCord: cpc, notes: cap_('Processed from logs ' + detail, 1000), product: 'Split', costPerCord: cpc, processId: pid, status: 'Confirmed', entryId: pid + '-in', by: who }]);
    if (pr.sellPerCord !== undefined && pr.sellPerCord !== '') setSplitPrice_(pr.yard, pr.species, pr.sellPerCord, cpc);
    log_('yards', 'processed to split', pr.yard, { species: pr.species, cords: cords, rawTonnes: raw, costPerCord: cpc, by: who, short: st.qty < raw });
    return { status: 'ok', costPerCord: cpc, rawTonnes: raw, logsOnHand: st.qty };
  }
  if (a === 'undoProcess' || a === 'voidEntry') {     // undone rows are marked Void (kept as a record, Tonnes 0)
    var hits = rows.filter(function (r) { return a === 'undoProcess' ? String(r.processId) === String(d.id) : String(r.entryId) === String(d.id); }).filter(function (r) { return r.status !== 'Void'; });
    hits.forEach(function (r) { yardSet_(r._row, { status: 'Void', tonnes: 0, cords: 0, notes: cap_('VOID (was ' + r.tonnes + ' t ' + (r.cords || '') + ' cords) ' + (r.notes || ''), 1000) }); });
    log_('yards', a === 'undoProcess' ? 'process undone' : 'entry voided', d.id, { rows: hits.length, by: who });
    return { status: 'ok', voided: hits.length };
  }
  if (a === 'saveSplitPrice') { setSplitPrice_(d.yard, d.species, d.splitPricePerCord, d.splitCostPerCord); log_('yards', 'split price saved', d.yard, { species: d.species, sell: d.splitPricePerCord, by: who }); return { status: 'ok', rev: rev_() }; }
  if (a === 'stock') {
    var out = {}; rows.forEach(function (r) { if (!r.yard) return; var k = r.yard + '|' + r.species + '|' + (r.product || 'Logs'); if (!out[k]) out[k] = yardStock_(rows, r.yard, r.species, r.product || 'Logs'); });
    return { status: 'ok', stock: out };
  }
  return null;
}
// split prices live on the species in that yard's location settings (merge, never a full replace)
function setSplitPrice_(yard, species, sell, cost) {
  var s = readSettings_(), loc = (s.locations || []).filter(function (l) { return String(l.name) === String(yard); })[0]; if (!loc) return;
  loc.species = loc.species || []; var sp = loc.species.filter(function (x) { return String(x.name) === String(species); })[0];
  if (!sp) { sp = { name: species, costPerTonne: 0, marginPct: 0, pricePerTonne: 0, tonnesPerCord: 1.8, costPerCord: 0, pricePerCord: 0 }; loc.species.push(sp); }
  if (sell !== undefined && sell !== '') sp.splitPricePerCord = r2_(sell); if (cost !== undefined && cost !== '') sp.splitCostPerCord = r2_(cost);
  writeSettings_(s); bumpRev_();
}
// When a load booked from a YARD is Delivered, its wood leaves the yard at the current average cost (once per load).
// If the load goes back to Pending/Started, that Out row is marked Void.
function deliveryOut_(sheet, row) {
  try {
    var w = Math.min(sheet.getLastColumn(), LOAD_ALL.length), v = sheet.getRange(row, 1, 1, w).getValues()[0];
    var yard = String(v[4] || ''), status = String(v[15] || ''), key = String(v[16] || v[24] || ''), product = String(v[25] || '') === 'Split' ? 'Split' : 'Logs';
    if (!yard || !key) return;
    var rows = yardRowsAll_(); if (yardNames_().indexOf(yard) < 0) return;          // only yards (not ordinary pickup locations)
    var mine = rows.filter(function (r) { return r.type === 'Out' && String(r.loadId) === key && r.status !== 'Void'; });
    if (status === 'Delivered' || status === 'Paid') {
      if (mine.length) return;
      var st = yardStock_(rows, yard, v[5], product), set = readSettings_(), loc = (set.locations || []).filter(function (l) { return l.name === yard; })[0];
      var sp = loc && (loc.species || []).filter(function (x) { return String(x.name) === String(v[5]); })[0], f = sp ? num_(sp.tonnesPerCord) || 1.8 : 1.8;
      var net = num_(v[17]); if (net > 500) net = net / 1000;
      var tonnes = net || num_(v[7]), cords = num_(v[8]) || (tonnes / f);
      var cost = st.avg || (sp ? (product === 'Split' ? num_(sp.splitCostPerCord) || num_(sp.costPerCord) : num_(sp.costPerTonne) || num_(sp.pricePerTonne)) : 0);
      yardAppend_([product === 'Split'
        ? { yard: yard, species: v[5], type: 'Out', tonnes: Math.round(cords * f * 100) / 100, cords: cords, pricePerCord: cost, pricePerTonne: r2_(cost / f), notes: 'Delivered: ' + v[1], product: 'Split', costPerCord: cost, status: 'Confirmed', loadId: key, entryId: 'LOAD-' + key, by: 'dispatch' }
        : { yard: yard, species: v[5], type: 'Out', tonnes: Math.round(tonnes * 100) / 100, cords: Math.round(cords * 10) / 10, pricePerTonne: cost, notes: 'Delivered: ' + v[1], product: 'Logs', costPerTonne: cost, status: 'Confirmed', loadId: key, entryId: 'LOAD-' + key, by: 'dispatch' }]);
      log_('yards', 'out on delivery', yard, { load: key, species: v[5], product: product, tonnes: tonnes, cost: cost });
    } else if (mine.length) {
      mine.forEach(function (r) { yardSet_(r._row, { status: 'Void', tonnes: 0, cords: 0, notes: 'VOID: load ' + key + ' no longer delivered' }); });
      log_('yards', 'out row voided', yard, { load: key });
    }
  } catch (e) { log_('yards', 'delivery out error', '', String(e)); }
}

/* =============================== v14: action alerts (worked out each time, never stored) =============================== */
// Counts per menu page: red = needs action, amber = due soon. Each item links to the screen that fixes it.
function alerts_(p, d) {
  var w = who_(p, d), pages = {}, add = function (pg, lvl, t, href) {
    var x = pages[pg] = pages[pg] || { red: 0, amber: 0, items: [] };
    if (lvl === 'red') x.red++; else x.amber++;
    if (x.items.length < 60) x.items.push({ lvl: lvl, t: t, href: href });
  };
  if (!w.office && !w.person) return { status: 'ok', v: SCRIPT_VERSION, pages: {} };
  try { migrateUnits_(); } catch (e) {}
  var units = rows_('Units'), wos = rows_('WorkOrders'), now = Date.now(), DAY = 86400000;
  // ---- Trucks ----
  if (w.office || w.roles.indexOf('mechanic') > -1) {
    if (w.office) units.forEach(function (u) { if (u.status === 'Out of service') add('trucks', 'red', (u.unitNo ? u.unitNo + ' ' : '') + u.name + ' is out of service' + (u.outReason ? ': ' + u.outReason : ''), 'trucks.html#unit=' + encodeURIComponent(u.id)); });
    wos.forEach(function (x) {
      if (x.status === 'Done') return;
      if (x.severity === 'major') add('trucks', 'red', 'Major: ' + x.unitName + ' · ' + x.defect, 'trucks.html#wo=' + encodeURIComponent(x.id));
      else if (now - ms_(x.openedAt) > 7 * DAY) add('trucks', 'amber', 'Open over 7 days: ' + x.unitName + ' · ' + x.defect, 'trucks.html#wo=' + encodeURIComponent(x.id));
    });
    if (w.office) {
      var plans = rows_('ServicePlans'), insp = rows_('Inspections'); seedTemplates_();
      dueRaw_(units, plans, insp, rows_('InspectionTemplates')).forEach(function (it) {
        var lvl = dueLevel_(it, 500, 10, 7); if (lvl) add('trucks', lvl, dueText_(it), 'trucks.html#unit=' + encodeURIComponent(it.unitId));
      });
    }
  }
  if (w.office) {
    // ---- Drivers (office view) ----
    rows_('Shifts').forEach(function (s) {
      if (s.status === 'Open' && now - ms_(s.startedAt) > DAY) add('drivers', 'amber', s.driverName + ': ' + (s.shiftType === 'yard' ? 'yard shift' : 'shift') + ' of ' + day_(s.date) + ' not submitted yet', 'drivers.html#admin');
    });
    wos.forEach(function (x) { if ((x.source === 'pretrip' || x.source === 'inspection') && !x.seenAt) add('drivers', 'red', 'New defect (' + x.source + '): ' + x.unitName + ' · ' + x.defect + (x.driverName ? ' · ' + x.driverName : ''), 'drivers.html#seen=' + encodeURIComponent(x.id)); });
    // ---- Dispatch: booked for today / tomorrow with no truck or driver ----
    var loads = loadRows_(), td = today_(), tm = Utilities.formatDate(new Date(now + DAY), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    loads.forEach(function (l) {
      var st = String(l.status).toLowerCase(), rd = String(l.requestedDate || '').slice(0, 10);
      if ((st === 'pending' || st === '') && (rd === td || rd === tm) && (!l.unitId || !l.driverName)) add('dispatch', 'red', l.customerName + ' (' + (rd === td ? 'today' : 'tomorrow') + '): no ' + (!l.driverName && !l.unitId ? 'truck or driver' : !l.unitId ? 'truck' : 'driver'), 'dispatch.html');
    });
    // ---- Billing: delivered and not invoiced after 2 days; invoiced and unpaid after 30 days ----
    var deliveredAt = {}, gl = ms_(goLive_());
    rows_('Log').slice(-3000).forEach(function (x) { if (x.svc === 'loads' && /^status Delivered/.test(String(x.action))) deliveredAt[String(x.ref)] = ms_(x.at); });
    var pays = {}; rows_('Payments').forEach(function (x) { var k = String(x.loadId || x.invoiceNo); pays[k] = (pays[k] || 0) + num_(x.amount); });
    loads.forEach(function (l) {
      var st = String(l.status).toLowerCase();
      if (st === 'delivered') { var t = deliveredAt[String(l.loadId)] || deliveredAt[String(l.customerName)]; if (t && now - t > 2 * DAY) add('billing', 'amber', 'Not invoiced: ' + (l.loadId || '') + ' ' + l.customerName + ' (delivered ' + Math.floor((now - t) / DAY) + ' days ago)', 'invoices.html'); }
      if (st === 'paid') {
        var inv = parse_(l.invoiceData) || {}, at = num_(inv.paidAt), total = num_(inv.model && inv.model.total);
        if (!at || at < gl || !total) return;                                 // invoiced before v14 went live: counted as paid
        if (now - at > 30 * DAY && (pays[String(l.loadId)] || 0) < total - 0.009) add('billing', 'red', 'Unpaid ' + Math.floor((now - at) / DAY) + ' days: ' + (l.loadId || '') + ' ' + l.customerName + ' $' + r2_(total - (pays[String(l.loadId)] || 0)), 'invoices.html#owing');
      }
    });
    rows_('Invoices').forEach(function (iv) { var at = ms_(iv.at); if (at && now - at > 30 * DAY && (pays[String(iv.invoiceNo)] || 0) < num_(iv.total) - 0.009) add('billing', 'red', 'Unpaid ' + Math.floor((now - at) / DAY) + ' days: ' + iv.invoiceNo + ' ' + iv.customer, 'invoices.html#owing'); });
    // ---- Inventory: drops waiting; stock below zero ----
    var yr = yardRowsAll_(), seen = {};
    yr.forEach(function (r) { if (r.status === 'Pending') add('inventory', 'amber', 'Drop to confirm: ' + r.yard + ' · ' + r.species + ' ' + r.pendingTonnes + ' t', 'yards.html#pending'); });
    yr.forEach(function (r) {
      var k = r.yard + '|' + r.species + '|' + (r.product || 'Logs'); if (seen[k] || !r.yard) return; seen[k] = 1;
      var st2 = yardStock_(yr, r.yard, r.species, r.product || 'Logs'); if (st2.qty < 0) add('inventory', 'red', r.yard + ' · ' + r.species + ' ' + (r.product || 'Logs') + ': ' + st2.qty + (r.product === 'Split' ? ' cords' : ' t') + ' (below zero)', 'yards.html');
    });
  }
  return { status: 'ok', v: SCRIPT_VERSION, at: nowIso_(), pages: pages };
}

/* =============================== nightly backup + clean-up =============================== */
function ensureTriggers_() {
  try {
    var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'nightly'; });
    if (!has) ScriptApp.newTrigger('nightly').timeBased().everyDays(1).atHour(2).create();
  } catch (e) {}
}
// Runs every night: a copy of the whole sheet in Drive (14 kept) + removes GPS/driver records older than 12 months.
function nightly() {
  backupNow();
  try { purgeOld_(); } catch (e) { log_('sync', 'nightly purge error', '', String(e)); }
  try { postRecurring_(); } catch (e) { log_('money', 'recurring bills error', '', String(e)); }
}
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
// v14 (narrowed): Shift rows are KEPT (hours, km and pay history for Statistics); after 12 months only their log detail
// (duty events, signature) is slimmed. GPS trail older than 12 months is removed as before. Pre-trips older than 12 months
// are removed unless they created a work order (their json is copied into the work order notes first).
// Units, WorkOrders, WOParts, ServicePlans, UnitReadings, Inspections, Expenses, Recurring, Payments, People, Invoices are never touched.
function purgeOld_() {
  var cutoff = Date.now() - KEEP_GPS_DAYS * 86400000, slimmed = 0;
  rows_('Shifts').forEach(function (s) {
    if (slimmed >= 300) return;
    var t = ms_(s.submittedAt) || ms_(s.startedAt); if (s.status === 'Open' || !t || t >= cutoff) return;
    var j = parse_(s.json); if (!j || j.purged) return;
    var keep = { id: j.id, date: j.date, type: j.type, unit: j.unit, unitId: j.unitId, yard: j.yard, startedAt: j.startedAt, closedAt: j.closedAt, startOdo: j.startOdo, endOdo: j.endOdo, startHours: j.startHours, endHours: j.endHours,
      drivingHrs: j.drivingHrs, onDutyHrs: j.onDutyHrs, days: j.days, fuel: j.fuel, trips: (j.trips || []).map(function (x) { return { loadId: x.loadId, legs: x.legs || null }; }), tasks: j.tasks, equip: j.equip, purged: true };
    var m = plain_(s); m.json = JSON.stringify(keep).slice(0, 45000); m.signature = ''; write_('Shifts', s._row, m); slimmed++;
  });
  var wos = rows_('WorkOrders'), withWO = {};
  wos.forEach(function (w) { if (w.shiftId) withWO[String(w.shiftId)] = w; });
  rows_('Pretrips').forEach(function (p) {
    var w = withWO[String(p.shiftId)]; if (!w || String(w.notes || '').indexOf('"pretripCopy"') > -1 || !(ms_(p.at) && ms_(p.at) < cutoff)) return;
    var m = plain_(w); m.notes = cap_(JSON.stringify({ pretripCopy: parse_(p.json) }), 45000); write_('WorkOrders', w._row, m);
  });
  keepRows_('Pretrips', function (p) { return !!withWO[String(p.shiftId)] || !ms_(p.at) || ms_(p.at) >= cutoff; });
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
  try { migrateUnits_(); var vu = drvUnits_(); if (vu && vu.length) out.units = vu.filter(function (u) { return u.type === 'truck'; }); out.allUnits = vu || []; } catch (e) {}
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
  // v14: admin = admin token or the company password. Holding the company key alone no longer makes a device admin.
  // Before a company password exists every device is admin.
  var a = isAdmin_(p, d);
  return { ok: a.ok, locked: a.locked, noadmin: a.noadmin };
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
function drvAdminView_(d) { var o = drvPublic_(d); o.roles = rolesOf_(d); o.hasPasscode = !!d.hash; o.lastLat = d.lastLat; o.lastLon = d.lastLon; o.lastPlace = d.lastPlace; o.lastSeen = iso_(d.lastSeen); o.lastStatus = d.lastStatus; o.lastUnit = d.lastUnit; return o; }
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
      var okp = drvAdminOk_(p, d).ok || ((d.token || d.name) && personAuth_(d).ok);
      if (!okp) return json_({ status: 'badpassword' });
      try { return json_(drvPlace_(d.lat, d.lon)); } catch (err) { return json_({ status: 'error', message: String(err) }); }
    }
    lock.waitLock(25000);
    if (a === 'adminSetPassword') return json_({ status: 'error', message: 'Drivers admin uses the company password. Change it on the Quote page → Settings.' });
    if (a && a.indexOf('admin') === 0) {
      var ok = drvAdminOk_(p, d);
      if (!ok.ok) return ok.none ? json_({ status: 'nopassword' }) : drvAuthFail_(ok);
      if (a === 'adminCheck') return json_({ status: 'ok', v: 3 });
      if (a === 'adminGetConfig') { try { var last = Number(props_().getProperty('lastPurge') || 0); if (Date.now() - last > 86400000) { props_().setProperty('lastPurge', String(Date.now())); purgeOld_(); } } catch (e) {} return json_({ status: 'ok', v: 3, sv: SCRIPT_VERSION, config: drvConfig_(), drivers: rows_('Drivers').map(drvAdminView_), people: rows_('People').map(plain_) }); }
      if (a === 'adminSavePerson') {          // v14: roles (driver / mechanic / yard) + hourly rate per role. Rates live only in People.
        var ps = d.person || {}, dl = rows_('Drivers'), dx = byKey_(dl, 'id', ps.id); if (!dx) return json_({ status: 'error', message: 'Person not found.' });
        var roles = (ps.roles || []).filter(function (r) { return ['driver', 'mechanic', 'yard'].indexOf(r) > -1; }); if (!roles.length) roles = ['driver'];
        var dm = plain_(dx); dm.roles = roles.join(','); write_('Drivers', dx._row, dm);
        var rates = ps.rates || {}, first = roles[0];
        upsert_('People', 'id', { id: dx.id, name: dx.name, role: first, hourlyRate: r2_(rates[first]), active: String(dx.active) !== 'false' ? 'true' : 'false', roles: roles.join(','), rates: JSON.stringify(rates) });
        log_('drivers', 'roles and pay saved', dx.name, { roles: roles });                     // rates are never logged
        return json_({ status: 'ok', drivers: rows_('Drivers').map(drvAdminView_), people: rows_('People').map(plain_) });
      }
      if (a === 'adminSaveConfig') {
        var raw = parse_(props_().getProperty('drvConfig') || '{}') || {}, inc = d.config || {};
        if (inc.company) raw.company = { name: cap_(inc.company.name, 120), address: cap_(inc.company.address, 300), phone: cap_(inc.company.phone, 40), officeEmail: cap_(inc.company.officeEmail, 120) };
        if (inc.units) raw.units = inc.units.slice(0, 100).map(function (u) { return { id: cap_(u.id, 40) || Utilities.getUuid(), name: cap_(u.name, 60), plate: cap_(u.plate, 20), trailerA: cap_(u.trailerA, 20), trailerB: cap_(u.trailerB, 20), notes: cap_(u.notes, 300) }; });
        if (inc.units) { props_().setProperty('drvConfig', JSON.stringify(raw)); migrateUnits_(); mergeDrvUnits_(raw.units); syncDrvUnits_(); raw = parse_(props_().getProperty('drvConfig') || '{}') || {}; }   // v14: merged into Units, never wiped
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
        if (Array.isArray(dr.roles)) rec.roles = dr.roles.filter(function (r) { return ['driver', 'mechanic', 'yard'].indexOf(r) > -1; }).join(',');
        if (rec.lastSeen instanceof Date) rec.lastSeen = rec.lastSeen.toISOString();
        if (dr.passcode) { if (String(dr.passcode).length < 4) return json_({ status: 'error', message: 'Passcode must be at least 4 characters.' }); rec.salt = Utilities.getUuid(); rec.hash = drvHash_(rec.salt, String(dr.passcode)); rec.tokenVer = num_(rec.tokenVer) + 1; }
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
          var paid = ((ms_(j.closedAt) || (s.status === 'Open' ? Date.now() : ms_(s.submittedAt))) - ms_(j.startedAt || s.startedAt)) / 3600000;
          return { shiftId: s.shiftId, driverId: s.driverId, driverName: s.driverName, date: j.date || day_(s.date), unit: s.unit, status: s.status, startedAt: iso_(s.startedAt), submittedAt: iso_(s.submittedAt), startOdo: s.startOdo, endOdo: s.endOdo, onDutyHrs: s.onDutyHrs, drivingHrs: s.drivingHrs, edited: !!s.editedAt,
            type: s.shiftType || j.type || 'driving', yard: j.yard || '', startHours: j.startHours, endHours: j.endHours, paidHrs: paid > 0 ? Math.round(paid * 100) / 100 : 0,
            fuelL: (j.fuel || []).reduce(function (t, f) { return t + num_(f.litres); }, 0), fuelCost: (j.fuel || []).reduce(function (t, f) { return t + num_(f.cost); }, 0) };
        }) });
      }
      if (a === 'adminGetShift') {
        var f = rows_('Shifts').filter(function (s) { return String(s.shiftId) === String(d.shiftId); })[0];
        if (!f) return json_({ status: 'error', message: 'Shift not found.' });
        var fs = drvFullShift_(f);
        fs._workOrders = rows_('WorkOrders').filter(function (x) { return String(x.shiftId) === String(f.shiftId); }).map(function (x) { return { id: x.id, defect: x.defect, severity: x.severity, status: x.status }; });
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

    if (a === 'myTrips' || a === 'yardDrop') {
      var au2 = personAuth_(d); if (!au2.ok) return drvAuthFail_(au2);
      if (a === 'myTrips') {     // loads a driver may pick under "Trips from Dispatch" (no company key needed)
        var me = String(au2.driver.name).toLowerCase(), td = today_();
        var set0 = readSettings_(), locGeo = {}, geoLoc = function (name) { if (!(name in locGeo)) { var lc = (set0.locations || []).filter(function (x) { return x.name === name; })[0]; locGeo[name] = lc ? geoOf_(lc.address) : null; } return locGeo[name]; };
        return json_({ status: 'ok', base: geoOf_(set0.homeBase), rows: loadRows_().filter(function (l) { var st = String(l.status).toLowerCase(); return st !== 'paid' && (String(l.driverName || '').toLowerCase() === me || st === 'started' || (l.loadId && String(l.loadId).indexOf(td.slice(0, 4)) > -1)); })
          .map(function (l) { var pg = geoOf_ && l.location ? geoLoc(l.location) : null; return { loadId: l.loadId, bookingId: l.bookingId, customerName: l.customerName, location: l.location, species: l.species, status: l.status, address: l.address, placeLat: l.placeLat, placeLon: l.placeLon, pickupLat: pg ? pg.lat : '', pickupLon: pg ? pg.lon : '', driverName: l.driverName, unitId: l.unitId, requestedDate: l.requestedDate, product: l.product }; }) });
      }
      return json_(yardDrop_(d, au2.driver));
    }
    if (a === 'driverLogin' || a === 'saveShift' || a === 'submitShift' || a === 'driverHistory') {
      var au = personAuth_(d); if (!au.ok) return drvAuthFail_(au);
      var drv = au.driver, cfg = drvConfig_();
      if (a === 'driverLogin') {
        var mine = rows_('Shifts').filter(function (s) { return String(s.driverId) === String(drv.id); });
        var isYard = function (s) { return s.shiftType === 'yard'; };
        var open = mine.filter(function (s) { return s.status === 'Open' && !isYard(s); }).pop(), openYard = mine.filter(function (s) { return s.status === 'Open' && isYard(s); }).pop(), cutoff = Date.now() - 16 * 86400000, days = {}, lastClose = '';
        mine.forEach(function (s) {
          if (s.status !== 'Submitted' || isYard(s)) return;
          var sj = parse_(s.json); if (sj && sj.closedAt && ms_(sj.closedAt) > ms_(lastClose)) lastClose = sj.closedAt;
          if (sj && sj.days) sj.days.forEach(function (x) { if (new Date(x.date + 'T12:00:00').getTime() >= cutoff) { days[x.date] = days[x.date] || { onDuty: 0, driving: 0 }; days[x.date].onDuty += Number(x.onDuty) || 0; days[x.date].driving += Number(x.driving) || 0; } });
        });
        var allOdo = {}, odoAt = {};
        rows_('Shifts').forEach(function (s) { if (s.status !== 'Submitted' || !s.unit || s.endOdo === '' || s.shiftType === 'yard') return; var tt = ms_(s.submittedAt); if (!odoAt[s.unit] || tt >= odoAt[s.unit]) { allOdo[s.unit] = s.endOdo; odoAt[s.unit] = tt; } });
        var ob = drvOnBlocks_(mine.filter(function (s) { return !isYard(s); }), Date.now() - 40 * 86400000);
        return json_({ status: 'ok', v: 3, sv: SCRIPT_VERSION, token: personToken_(drv), roles: rolesOf_(drv), driver: drvPublic_(drv), company: cfg.company, units: cfg.units, rules: cfg.rules, history: days, unitOdo: allOdo, lastClose: lastClose, openShift: open ? drvFullShift_(open) : null, openYardShift: openYard ? drvFullShift_(openYard) : null, onBlocks: ob.blocks, knownSince: ob.knownSince,
          allUnits: cfg.allUnits || [], yards: yardNames_(), base: (function () { try { return geoOf_(readSettings_().homeBase); } catch (e) { return null; } })() });
      }
      if (a === 'driverHistory') {
        var since = Date.now() - Math.min(Number(d.days) || 15, 31) * 86400000, pret2 = rows_('Pretrips');
        return json_({ status: 'ok', v: 3, shifts: rows_('Shifts').filter(function (s) { return String(s.driverId) === String(drv.id) && s.shiftType !== 'yard' && (s.status === 'Open' || (ms_(s.submittedAt) || ms_(s.startedAt)) >= since); }).map(function (s) { return drvFullShift_(s, pret2); }) });
      }
      var sh = d.shift || {}, sid = cap_(sh.id, 80);
      if (!sid) return json_({ status: 'error', message: 'Missing shift id.' });
      if (drvTombstones_().indexOf(sid) > -1) return json_({ status: 'deleted', message: 'The office deleted this shift.' });
      var found = null, otherOpen = null;
      var wantYard = sh.type === 'yard';
      rows_('Shifts').forEach(function (s) { if (String(s.shiftId) === sid) found = s; else if (String(s.driverId) === String(drv.id) && s.status === 'Open' && (s.shiftType === 'yard') === wantYard) otherOpen = s; });
      if (!found && otherOpen) return json_({ status: 'blocked', message: 'Submit your open shift before starting a new one.', openShift: drvFullShift_(otherOpen) });
      if (found && found.status === 'Submitted') return json_({ status: 'ok', alreadySubmitted: true });
      drvSavePoints_(drv, d.pts, sid, sh.unit);
      if (d.pos) drvLastSeen_(drv, d.pos, sh.unit);
      if (found) { var srv = parse_(found.json) || {}; if (srv.adminEditAt && srv.adminEditAt !== sh.adminEditAt) return json_({ status: 'replaced', message: 'The office edited this shift. This phone now has the office copy.', shift: drvFullShift_(found) }); }
      var isSubmit = a === 'submitShift';
      if (isSubmit && sh.type !== 'yard') {
        var missing = [];
        if (!String(sh.remarks || '').trim()) missing.push('closing remarks');
        if (sh.endOdo === '' || sh.endOdo == null) missing.push('ending odometer');
        if (!sh.signature) missing.push('signature');
        if (missing.length) return json_({ status: 'error', message: 'Missing: ' + missing.join(', ') + '.' });
      }
      drvSaveShiftRow_(found, sh, { driverId: drv.id, driverName: drv.name, status: isSubmit ? 'Submitted' : 'Open', submittedAt: isSubmit ? new Date().toISOString() : '' });
      tieShift_(drv, sh, isSubmit);                                       // v14: defects -> work orders, readings, fuel -> Expenses
      if (!found) log_('drivers', sh.type === 'yard' ? 'yard shift started' : 'shift started', drv.name + ' ' + (sh.unit || sh.yard || ''), '');
      var emailed = false, emailError = '';
      if (isSubmit && sh.type === 'yard') { log_('drivers', 'yard shift submitted', drv.name + ' ' + (sh.date || ''), { yard: sh.yard }); return json_({ status: 'ok', v: 3, submitted: true, emailed: false }); }
      if (isSubmit) { log_('drivers', 'shift submitted', drv.name + ' ' + (sh.date || ''), { drivingHrs: sh.drivingHrs, onDutyHrs: sh.onDutyHrs, km: (Number(sh.endOdo) || 0) - (Number(sh.startOdo) || 0) }); try { emailed = drvEmail_(cfg, drv, sh, d.pdfBase64); } catch (err) { emailError = String(err); } }
      return json_({ status: 'ok', v: 3, submitted: isSubmit, emailed: emailed, emailError: emailError });
    }
    return json_({ status: 'error', message: 'Unknown action: ' + a });
  } catch (err) { return json_({ status: 'error', message: String(err) }); }
  finally { try { lock.releaseLock(); } catch (e) {} }
}
function drvSaveShiftRow_(found, sh, meta) {
  var sid = String(sh.id), js = JSON.stringify(sh);
  if (js.length > 45000 && sh.trips) {           // v14: trip stages are trimmed first (positions dropped, times kept)
    var t1 = JSON.parse(js); (t1.trips || []).forEach(function (t) { (t.stages || []).forEach(function (g) { delete g.lat; delete g.lon; delete g.place; }); }); js = JSON.stringify(t1);
  }
  if (js.length > 45000) { var slim = JSON.parse(js); slim.signature = ''; slim.pretrip = sh.pretrip ? { done: true, at: sh.pretrip.at, defects: sh.pretrip.defects, defectNote: sh.pretrip.defectNote, defectList: sh.pretrip.defectList, note: 'detail stored in Pretrips tab' } : null; js = JSON.stringify(slim); }
  var rec = { shiftId: sid, driverId: meta.driverId, driverName: meta.driverName, date: cap_(sh.date, 12), unit: cap_(sh.unit, 60), startedAt: cap_(sh.startedAt, 40), submittedAt: meta.submittedAt || '', status: meta.status,
    startOdo: sh.startOdo == null ? '' : sh.startOdo, endOdo: sh.endOdo == null ? '' : sh.endOdo, onDutyHrs: Number(sh.onDutyHrs) || 0, drivingHrs: Number(sh.drivingHrs) || 0, remarks: cap_(sh.remarks, 2000), json: js,
    signature: sh.signature ? cap_(sh.signature, 40000) : '', editedAt: meta.editedAt || (found ? iso_(found.editedAt) : ''),
    shiftType: sh.type === 'yard' ? 'yard' : '', startHours: sh.startHours == null ? '' : sh.startHours, endHours: sh.endHours == null ? '' : sh.endHours, unitId: cap_(sh.unitId, 60) };
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
  sendMail_(opts);
  return true;
}

/* =============================== v14: structure check (run from the editor: testAll_) =============================== */
// Read-only. Checks every tab's header is where the code expects it (no column moved or renamed).
// Columns the new version adds on the right show as "not added yet" until the tab is next used; that is fine.
function testAll_() {
  var out = [], problems = 0, ss = ss_();
  var check = function (name, row, head) {
    var sh = ss.getSheetByName(name);
    if (!sh) { out.push('·  ' + name + ': not created yet (it is made the first time it is used)'); return; }
    var w = Math.min(sh.getMaxColumns(), head.length), cur = sh.getRange(row, 1, 1, w).getValues()[0], missing = 0;
    head.forEach(function (h, i) {
      if (i >= w || cur[i] === '' || cur[i] == null) { missing++; return; }
      if (String(cur[i]).trim() !== String(h)) { problems++; out.push('PROBLEM ' + name + ' column ' + (i + 1) + ': expected "' + h + '" but found "' + cur[i] + '"'); }
    });
    out.push((missing ? '·  ' : 'OK ') + name + ': ' + (head.length - missing) + ' of ' + head.length + ' columns in place' + (missing ? ' (' + missing + ' new columns not added yet)' : ''));
  };
  check('Loads', 4, LOAD_ALL); check('Tickets', 1, TICKET_HEADERS); check('Yards', 1, YARD_ALL);
  Object.keys(TABS).forEach(function (n) { check(n, 1, TABS[n]); });
  try { var t = adminTokens_(); out.push('OK admin devices: ' + t.length); } catch (e) { problems++; out.push('PROBLEM admin device list: ' + e); }
  try { var s = readSettings_(); out.push('OK settings: ' + ((s.locations || []).length) + ' locations, ' + ((s.units || []).length) + ' units' + (s.yardPassword ? ' (old yardPassword still stored; removed on next Save to Company)' : '')); } catch (e) { problems++; out.push('PROBLEM settings: ' + e); }
  out.push('Script version ' + SCRIPT_VERSION + (testMode_() ? '  ·  TEST MODE (emails only go to the owner)' : ''));
  out.unshift(problems ? problems + ' PROBLEM(S) FOUND' : 'All checks passed');
  Logger.log(out.join('\n'));
  return out;
}

/* =============================== v14: editor test for Trucks + Money (creates sample rows and removes them again) =============================== */
// Run testTrucksMoney_ from the editor ON THE TEST COPY. It only deletes the rows it made itself (ids start with TEST-).
function testTrucksMoney_() {
  var out = [], ok = function (c, m) { out.push((c ? 'OK  ' : 'FAIL ') + m); };
  var tag = 'TEST-' + Date.now().toString(36), w = { admin: true, office: true, name: 'testTrucksMoney_', roles: [] };
  append_('Units', { id: tag + '-U', type: 'truck', name: tag + ' truck', status: 'In service', trackHours: 'yes', currentOdo: 1000, currentHours: 100, updatedAt: nowIso_() });
  var units = rows_('Units');
  ok(addReading_({ id: tag + '-R1', unitId: tag + '-U', odo: 1100, hours: 110, source: 'manual', by: 'test' }, units), 'reading added');
  ok(num_(byKey_(rows_('Units'), 'id', tag + '-U').currentOdo) === 1100, 'unit odometer raised to 1100');
  var wos = rows_('WorkOrders'), wo = defectWO_({ source: 'pretrip', shiftId: tag + '-S', unitId: tag + '-U', itemName: 'Brake lights', defect: 'Brake lights: out', severity: 'major', driverName: 'test' }, rows_('Units'), wos);
  ok(!!wo, 'work order made from a major defect');
  ok(!defectWO_({ source: 'pretrip', shiftId: tag + '-S', unitId: tag + '-U', itemName: 'Brake lights', defect: 'Brake lights: out', severity: 'major' }, rows_('Units'), rows_('WorkOrders')), 'same defect not made twice');
  ok(byKey_(rows_('Units'), 'id', tag + '-U').status === 'Out of service', 'unit out of service');
  append_('WOParts', { woId: wo.id, at: nowIso_(), part: 'Bulb', qty: 2, unitCost: 5, total: 10, vendor: 'test', id: tag + '-P' });
  var closed = closeWO_(byKey_(rows_('WorkOrders'), 'id', wo.id), { where: 'in-house', mechanicName: 'Test', mechHours: 2.5, mechRate: 40, backInService: true }, w, rows_('Units'));
  var emp = money_().employerCostPct;
  ok(Math.abs(num_(closed.laborCost) - r2_(2.5 * 40 * (1 + emp / 100))) < 0.01, 'labour = 2.5 h x $40 + ' + emp + '% = ' + closed.laborCost);
  ok(num_(closed.total) === r2_(num_(closed.laborCost) + 10), 'work order total = labour + parts');
  var ex = rows_('Expenses').filter(function (x) { return x.sourceRef === wo.id; });
  ok(ex.length === 1, 'exactly one Expenses row for the work order');
  closeWO_(byKey_(rows_('WorkOrders'), 'id', wo.id), { mechHours: 2.5, mechRate: 40 }, w, rows_('Units'));
  ok(rows_('Expenses').filter(function (x) { return x.sourceRef === wo.id; }).length === 1, 'closing again does not add a second Expenses row');
  ok(byKey_(rows_('Units'), 'id', tag + '-U').status === 'In service', 'unit back in service');
  append_('Recurring', { id: tag + '-REC', name: tag + ' bill', category: 'Insurance', amount: 100, gst: 5, dayOfMonth: 1, active: 'yes', lastPostedFor: '' });
  postRecurring_(); postRecurring_();
  ok(rows_('Expenses').filter(function (x) { return x.recurringId === tag + '-REC'; }).length === 1, 'recurring bill posted once (run twice)');
  ok(dueRaw_(rows_('Units'), [], [], rows_('InspectionTemplates')).some(function (x) { return x.unitId === tag + '-U' && x.kind === 'pm'; }), 'PM-A / PM-B due worked out for the test truck');
  // clean up only TEST rows (bottom up so row numbers stay right)
  ['Expenses', 'WOParts', 'WorkOrders', 'UnitReadings', 'Recurring', 'Units'].forEach(function (n) {
    var sh = tab_(n), l = rows_(n).filter(function (x) { return JSON.stringify(plain_(x)).indexOf(tag) > -1; }).map(function (x) { return x._row; }).sort(function (a, b) { return b - a; });
    l.forEach(function (r) { sh.deleteRow(r); }); out.push('cleaned ' + l.length + ' test row(s) from ' + n);
  });
  Logger.log(out.join('\n')); return out;
}

/* Runnable from the editor's function list (names ending in _ are hidden there). */
function checkStructure() { return testAll_(); }           // read-only structure check: safe on the live script
function testTrucksMoney() { return testTrucksMoney_(); }  // TEST COPY ONLY: makes sample rows and removes them again
