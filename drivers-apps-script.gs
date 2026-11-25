// ============================================================================
// Knight Forestry - DRIVERS back end (its own Apps Script project + its own link)
// Stores everything in a Google Sheet called "Driver Logs" that is created automatically
// on first use. Tabs: Drivers, Shifts, Pretrips, Positions.
// Company info, units and rules live in Script Properties (small JSON).
//
// FIRST TIME: Deploy > New deployment > Web app > Execute as: Me > Access: Anyone.
// UPDATING (keeps the same link): paste this over the old code > Save >
//   Deploy > Manage deployments > pencil > Version: "New version" > Deploy.
//   The first time after this update Google asks you to authorize again (Maps, for village names).
//
// v3: four rule choices (70/7, 120/14, Alberta provincial, Saskatchewan provincial) and the
//     Alberta "24 consecutive hours off in every 24 calendar days" check.
// v2: Alberta provincial rules, duty-status edits (logged), 15-minute GPS trail, village names
//     from Google Maps (no API key needed), 14-day history for drivers, admin map, admin edit /
//     delete shift, driver phone numbers, PDF log attached to the office email, and automatic
//     removal of records older than 12 months.
// This script is separate from the quote / load log / sync scripts and does not touch them.
// ============================================================================
var SCRIPT_VERSION = 3;
var SHEET_NAME = 'Driver Logs';
var KEEP_DAYS = 365;            // records older than this are removed automatically
var TABS = {
  Drivers:  ['id', 'name', 'salt', 'hash', 'active', 'licenseNo', 'licenseExpiry', 'licenseLink', 'expenseNotes', 'lastLat', 'lastLon', 'lastPlace', 'lastSeen', 'lastStatus', 'lastUnit', 'phone'],
  Shifts:   ['shiftId', 'driverId', 'driverName', 'date', 'unit', 'startedAt', 'submittedAt', 'status', 'startOdo', 'endOdo', 'onDutyHrs', 'drivingHrs', 'remarks', 'json', 'signature', 'editedAt'],
  Pretrips: ['shiftId', 'driverName', 'unit', 'at', 'result', 'json', 'signature'],
  Positions: ['at', 'driverName', 'unit', 'lat', 'lon', 'place', 'status', 'shiftId', 'kph', 'driverId']
};
// Four rule choices. 0 means "not enforced". offCount = how many periods of offHours consecutive
// hours off duty are needed in every offDays calendar days.
var RULE_IDS = ['c1', 'c2', 'ab', 'sk'];
var RULE_KEYS = ['maxDriving', 'maxOnDuty', 'maxElapsed', 'resetOffHours', 'cycleHours', 'cycleDays', 'offCount', 'offHours', 'offDays'];
var DEFAULT_RULES = {
  v: 3, defaultSet: 'ab',
  c1: { maxDriving: 13, maxOnDuty: 14, maxElapsed: 16, resetOffHours: 8, cycleHours: 70, cycleDays: 7, offCount: 0, offHours: 24, offDays: 24 },   // 70 h / 7 days
  c2: { maxDriving: 13, maxOnDuty: 14, maxElapsed: 16, resetOffHours: 8, cycleHours: 120, cycleDays: 14, offCount: 0, offHours: 24, offDays: 24 }, // 120 h / 14 days
  ab: { maxDriving: 13, maxOnDuty: 15, maxElapsed: 0, resetOffHours: 8, cycleHours: 0, cycleDays: 0, offCount: 1, offHours: 24, offDays: 24 },     // Alberta provincial
  sk: { maxDriving: 13, maxOnDuty: 15, maxElapsed: 0, resetOffHours: 8, cycleHours: 0, cycleDays: 0, offCount: 0, offHours: 24, offDays: 24 },     // Saskatchewan provincial
  autoStatus: 1, stillMinutes: 15, offMinutes: 30, driveKph: 40, stillMeters: 100
};
var DEFAULT_CONFIG = {
  company: { name: 'Knight Forestry Ltd', address: '', phone: '', officeEmail: '' },
  units: [],
  rules: DEFAULT_RULES
};

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function props_() { return PropertiesService.getScriptProperties(); }
function sha_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2); }).join('');
}
function hashPw_(salt, pw) { return sha_(salt + '|' + pw); }

// ---------- sheet access ----------
var ss__ = null, tabs__ = {};
function ss_() {
  if (ss__) return ss__;
  var id = props_().getProperty('ssId');
  if (id) { ss__ = SpreadsheetApp.openById(id); }
  else { ss__ = SpreadsheetApp.create(SHEET_NAME); props_().setProperty('ssId', ss__.getId()); }
  return ss__;
}
function tab_(name) {
  if (tabs__[name]) return tabs__[name];
  var ss = ss_(), cols = TABS[name];
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    try { sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@'); } catch (e) {}
    sh.getRange(1, 1, 1, cols.length).setValues([cols]);
    try { sh.setFrozenRows(1); sh.getRange(1, 1, 1, cols.length).setFontWeight('bold'); } catch (e) {}
    try { var d = ss.getSheetByName('Sheet1'); if (d && ss.getSheets().length > 1) ss.deleteSheet(d); } catch (e) {}
  } else if (sh.getLastColumn() < cols.length) {
    // v1 sheet: add the new column headings on the right, nothing else moves
    if (sh.getMaxColumns() < cols.length) sh.insertColumnsAfter(sh.getMaxColumns(), cols.length - sh.getMaxColumns());
    sh.getRange(1, 1, 1, cols.length).setValues([cols]);
    try { sh.getRange(1, 1, 1, cols.length).setFontWeight('bold'); } catch (e) {}
  }
  tabs__[name] = sh;
  return sh;
}
function rows_(name) {
  var sh = tab_(name), cols = TABS[name], last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, cols.length).getValues();
  return vals.map(function (v, i) {
    var o = { _row: i + 2 };
    cols.forEach(function (c, j) { o[c] = v[j]; });
    return o;
  });
}
function line_(name, o) {
  return TABS[name].map(function (c) {
    var v = o[c];
    if (v == null) return '';
    if (v instanceof Date) return (c === 'date' || c === 'licenseExpiry') ? day_(v) : v.toISOString();
    return v;
  });
}
function append_(name, o) { appendMany_(name, [o]); }
function appendMany_(name, list) {
  if (!list.length) return;
  var sh = tab_(name), r = Math.max(sh.getLastRow() + 1, 2), cols = TABS[name].length;
  var rng = sh.getRange(r, 1, list.length, cols);
  try { rng.setNumberFormat('@'); } catch (e) {}
  rng.setValues(list.map(function (o) { return line_(name, o); }));
}
function write_(name, row, o) {
  var rng = tab_(name).getRange(row, 1, 1, TABS[name].length);
  try { rng.setNumberFormat('@'); } catch (e) {}
  rng.setValues([line_(name, o)]);
}
// Keep only the rows for which keep(row) is true (rewrites the tab in one go). Returns rows removed.
function keepRows_(name, keep) {
  var sh = tab_(name), all = rows_(name), cols = TABS[name].length;
  var kept = all.filter(keep);
  if (kept.length === all.length) return 0;
  sh.getRange(2, 1, all.length, cols).clearContent();
  if (kept.length) {
    var rng = sh.getRange(2, 1, kept.length, cols);
    try { rng.setNumberFormat('@'); } catch (e) {}
    rng.setValues(kept.map(function (o) { return line_(name, o); }));
  }
  return all.length - kept.length;
}

// ---------- config ----------
function readConfig_() {
  var raw = props_().getProperty('config');
  var c = raw ? JSON.parse(raw) : {};
  var out = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  if (c.company) for (var k in c.company) out.company[k] = c.company[k];
  if (c.units) out.units = c.units;
  var r = c.rules || {};
  ['autoStatus', 'stillMinutes', 'offMinutes', 'driveKph', 'stillMeters'].forEach(function (x) { if (r[x] != null && r[x] !== '') out.rules[x] = r[x]; });
  if (r.v === 3) {                          // older saved rule layouts are replaced by the four choices
    if (RULE_IDS.indexOf(r.defaultSet) > -1) out.rules.defaultSet = r.defaultSet;
    RULE_IDS.forEach(function (id) { if (r[id]) RULE_KEYS.forEach(function (k) { if (r[id][k] != null && r[id][k] !== '') out.rules[id][k] = Number(r[id][k]); }); });
  }
  return out;
}

// ---------- passwords + lockout ----------
function locked_(who) { var c = CacheService.getScriptCache(); return Number(c.get('fail_' + who) || 0) >= 10; }
function fail_(who) { var c = CacheService.getScriptCache(); c.put('fail_' + who, String(Number(c.get('fail_' + who) || 0) + 1), 600); }
function clear_(who) { CacheService.getScriptCache().remove('fail_' + who); }
function hasAdmin_() { return !!props_().getProperty('adminHash'); }
function adminOk_(pw) {
  if (!hasAdmin_()) return { ok: false, none: true };
  if (locked_('admin')) return { ok: false, locked: true };
  var ok = hashPw_(props_().getProperty('adminSalt'), String(pw || '')) === props_().getProperty('adminHash');
  if (ok) clear_('admin'); else fail_('admin');
  return { ok: ok };
}
function driverAuth_(name, pass) {
  var key = 'drv_' + String(name || '').toLowerCase();
  if (locked_(key)) return { locked: true };
  var list = rows_('Drivers');
  for (var i = 0; i < list.length; i++) {
    var d = list[i];
    if (String(d.name).toLowerCase() === String(name || '').toLowerCase() && String(d.active) !== 'false') {
      if (d.hash && hashPw_(d.salt, String(pass || '')) === d.hash) { clear_(key); return { ok: true, driver: d }; }
      fail_(key); return { bad: true };
    }
  }
  fail_(key); return { bad: true };
}
function authFail_(a) { return json_({ status: a.locked ? 'locked' : 'badpassword', v: SCRIPT_VERSION }); }

// ---------- helpers ----------
function parse_(s) { try { return JSON.parse(s); } catch (e) { return null; } }
function cap_(s, n) { s = s == null ? '' : String(s); return s.length > n ? s.slice(0, n) : s; }
function esc_(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
function ms_(v) { if (v instanceof Date) return v.getTime(); var t = Date.parse(v); return isNaN(t) ? 0 : t; }
function iso_(v) { return v instanceof Date ? v.toISOString() : String(v == null ? '' : v); }
function day_(v) { return v instanceof Date ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(v == null ? '' : v); }

function driverPublic_(d) {
  return { id: d.id, name: d.name, active: String(d.active) !== 'false', phone: String(d.phone || ''), licenseNo: d.licenseNo, licenseExpiry: day_(d.licenseExpiry), licenseLink: d.licenseLink, expenseNotes: d.expenseNotes };
}
function driverAdminView_(d) {
  var o = driverPublic_(d);
  o.hasPasscode = !!d.hash; o.lastLat = d.lastLat; o.lastLon = d.lastLon; o.lastPlace = d.lastPlace; o.lastSeen = iso_(d.lastSeen); o.lastStatus = d.lastStatus; o.lastUnit = d.lastUnit;
  return o;
}
// The full shift (pre-trip detail is stored separately when the shift JSON was too big for one cell).
function fullShift_(row, pretrips) {
  var sh = parse_(row.json) || {};
  if (!sh.pretrip || (sh.pretrip && !sh.pretrip.items)) {
    var pt = (pretrips || rows_('Pretrips')).filter(function (p) { return String(p.shiftId) === String(row.shiftId); })[0];
    if (pt) { var pd = parse_(pt.json); if (pd) { sh.pretrip = pd; if (!sh.pretrip.signature) sh.pretrip.signature = pt.signature; } }
  }
  if (!sh.signature && row.signature) sh.signature = row.signature;
  sh.id = sh.id || row.shiftId; sh.driverName = sh.driverName || row.driverName;
  sh._status = row.status; sh._submittedAt = iso_(row.submittedAt);
  return sh;
}
function tombstones_() { return parse_(props_().getProperty('deletedShifts') || '[]') || []; }
function addTombstone_(id) { var t = tombstones_(); t.push(String(id)); props_().setProperty('deletedShifts', JSON.stringify(t.slice(-300))); }

// ---------- village names (Google Maps from inside Apps Script: no API key needed) ----------
function place_(lat, lon) {
  lat = Number(lat); lon = Number(lon);
  if (!isFinite(lat) || !isFinite(lon)) return { status: 'error', message: 'bad position' };
  var key = 'pl_' + lat.toFixed(2) + '_' + lon.toFixed(2), cache = CacheService.getScriptCache();
  var hit = cache.get(key); if (hit) return parse_(hit);
  var res = Maps.newGeocoder().reverseGeocode(lat, lon);
  if (!res || res.status !== 'OK') return { status: 'error', message: 'Google Maps: ' + (res && res.status) };
  var want = ['locality', 'sublocality', 'neighborhood', 'administrative_area_level_3', 'colloquial_area'], best = null;
  for (var w = 0; w < want.length && !best; w++) {
    for (var i = 0; i < res.results.length && !best; i++) {
      var r = res.results[i];
      if ((r.types || []).indexOf(want[w]) > -1) best = r;
    }
  }
  var prov = '';
  res.results.some(function (r) { return (r.address_components || []).some(function (c) { if ((c.types || []).indexOf('administrative_area_level_1') > -1) { prov = c.short_name; return true; } return false; }); });
  var out;
  if (best) {
    var name = best.address_components && best.address_components[0] ? best.address_components[0].long_name : best.formatted_address;
    out = { status: 'ok', name: name, prov: prov, lat: best.geometry.location.lat, lon: best.geometry.location.lng, source: 'google' };
  } else {
    var f = res.results[0];
    out = { status: 'ok', name: f ? f.formatted_address : '', prov: '', lat: lat, lon: lon, source: 'google-address' };
  }
  cache.put(key, JSON.stringify(out), 21600);
  return out;
}

// ---------- 12-month clean-up (runs at most once a day, on its own) ----------
function purgeIfDue_() {
  var last = Number(props_().getProperty('lastPurge') || 0);
  if (Date.now() - last < 86400000) return;
  props_().setProperty('lastPurge', String(Date.now()));
  purgeOld_();
}
function purgeOld_() {
  var cutoff = Date.now() - KEEP_DAYS * 86400000, gone = {};
  keepRows_('Shifts', function (s) {
    var t = ms_(s.submittedAt) || ms_(s.startedAt);
    var keep = s.status === 'Open' || !t || t >= cutoff;
    if (!keep) gone[String(s.shiftId)] = 1;
    return keep;
  });
  keepRows_('Pretrips', function (p) { return !gone[String(p.shiftId)] && (!ms_(p.at) || ms_(p.at) >= cutoff); });
  keepRows_('Positions', function (p) { return !ms_(p.at) || ms_(p.at) >= cutoff; });
}
// Optional: run this once from the editor (Run > dailyCleanup) to remove old records right now.
function dailyCleanup() { purgeOld_(); }

// ---------- entry points ----------
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'drivers') {
    var names = rows_('Drivers').filter(function (d) { return String(d.active) !== 'false' && d.hash; }).map(function (d) { return d.name; });
    return json_({ status: 'ok', v: SCRIPT_VERSION, hasAdmin: hasAdmin_(), drivers: names, company: readConfig_().company.name });
  }
  return json_({ status: 'ok', v: SCRIPT_VERSION, hasAdmin: hasAdmin_(), app: 'drivers' });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var d = JSON.parse(e.postData.contents);
    var a = d.action;

    // village name lookup: no sheet access, no lock needed
    if (a === 'place') {
      var okp = false;
      if (d.password) okp = adminOk_(d.password).ok;
      if (!okp && d.name) okp = !!driverAuth_(d.name, d.passcode).ok;
      if (!okp) return json_({ status: 'badpassword' });
      try { return json_(place_(d.lat, d.lon)); } catch (err) { return json_({ status: 'error', message: String(err) }); }
    }

    lock.waitLock(25000);

    if (a === 'adminSetPassword') {
      var np = String(d.newPassword || '');
      if (np.length < 4) return json_({ status: 'error', message: 'Admin password must be at least 4 characters.' });
      if (hasAdmin_()) { var c = adminOk_(d.password); if (!c.ok) return authFail_(c); }
      var salt = Utilities.getUuid();
      props_().setProperties({ adminSalt: salt, adminHash: hashPw_(salt, np) }, false);
      return json_({ status: 'ok' });
    }

    // ----- admin actions -----
    if (a && a.indexOf('admin') === 0) {
      var ok = adminOk_(d.password);
      if (!ok.ok) return ok.none ? json_({ status: 'nopassword' }) : authFail_(ok);

      if (a === 'adminCheck') return json_({ status: 'ok', v: SCRIPT_VERSION });

      if (a === 'adminGetConfig') {
        try { purgeIfDue_(); } catch (err) {}
        return json_({ status: 'ok', v: SCRIPT_VERSION, config: readConfig_(), drivers: rows_('Drivers').map(driverAdminView_) });
      }
      if (a === 'adminSaveConfig') {
        var cur = readConfig_(), inc = d.config || {};
        if (inc.company) { cur.company = { name: cap_(inc.company.name, 120), address: cap_(inc.company.address, 300), phone: cap_(inc.company.phone, 40), officeEmail: cap_(inc.company.officeEmail, 120) }; }
        if (inc.units) {
          cur.units = inc.units.slice(0, 100).map(function (u) {
            return { id: cap_(u.id, 40) || Utilities.getUuid(), name: cap_(u.name, 60), plate: cap_(u.plate, 20), trailerA: cap_(u.trailerA, 20), trailerB: cap_(u.trailerB, 20), notes: cap_(u.notes, 300) };
          });
        }
        if (inc.rules) {
          var ir = inc.rules;
          cur.rules.v = 3;
          if (RULE_IDS.indexOf(ir.defaultSet) > -1) cur.rules.defaultSet = ir.defaultSet;
          ['stillMinutes', 'offMinutes', 'driveKph', 'stillMeters'].forEach(function (k) { var n = Number(ir[k]); if (isFinite(n) && n > 0) cur.rules[k] = n; });
          if (ir.autoStatus != null) cur.rules.autoStatus = ir.autoStatus ? 1 : 0;
          RULE_IDS.forEach(function (id) {
            if (!ir[id]) return;
            RULE_KEYS.forEach(function (k) { var n = Number(ir[id][k]); if (ir[id][k] !== '' && ir[id][k] != null && isFinite(n) && n >= 0) cur.rules[id][k] = n; });
          });
        }
        props_().setProperty('config', JSON.stringify(cur));
        return json_({ status: 'ok', config: cur });
      }
      if (a === 'adminSaveDriver') {
        var dr = d.driver || {};
        var name = cap_(dr.name, 80).trim();
        if (!name) return json_({ status: 'error', message: 'Driver name is required.' });
        var list = rows_('Drivers'), existing = null;
        list.forEach(function (x) { if (dr.id && String(x.id) === String(dr.id)) existing = x; });
        var dup = list.some(function (x) { return x !== existing && String(x.name).toLowerCase() === name.toLowerCase(); });
        if (dup) return json_({ status: 'error', message: 'A driver with that name already exists.' });
        var rec = existing ? existing : { id: Utilities.getUuid(), active: true };
        rec.name = name;
        rec.phone = cap_(dr.phone, 30);
        rec.licenseNo = cap_(dr.licenseNo, 40); rec.licenseExpiry = cap_(dr.licenseExpiry, 20);
        rec.licenseLink = cap_(dr.licenseLink, 500); rec.expenseNotes = cap_(dr.expenseNotes, 1000);
        rec.active = dr.active === false ? 'false' : 'true';
        if (rec.lastSeen instanceof Date) rec.lastSeen = rec.lastSeen.toISOString();
        if (dr.passcode) {
          var pc = String(dr.passcode);
          if (pc.length < 4) return json_({ status: 'error', message: 'Passcode must be at least 4 characters.' });
          rec.salt = Utilities.getUuid(); rec.hash = hashPw_(rec.salt, pc);
        } else if (!existing) { return json_({ status: 'error', message: 'Create a passcode for the new driver.' }); }
        if (existing) write_('Drivers', existing._row, rec); else append_('Drivers', rec);
        return json_({ status: 'ok', drivers: rows_('Drivers').map(driverAdminView_) });
      }
      if (a === 'adminListShifts') {
        var all = rows_('Shifts').reverse();
        if (d.driverId) all = all.filter(function (s) { return String(s.driverId) === String(d.driverId); });
        all = all.slice(0, Math.min(Number(d.limit) || 80, 300));
        return json_({ status: 'ok', shifts: all.map(function (s) {
          var j = parse_(s.json) || {};
          return { shiftId: s.shiftId, driverId: s.driverId, driverName: s.driverName, date: j.date || day_(s.date), unit: s.unit, status: s.status, startedAt: iso_(s.startedAt), submittedAt: iso_(s.submittedAt), startOdo: s.startOdo, endOdo: s.endOdo, onDutyHrs: s.onDutyHrs, drivingHrs: s.drivingHrs, edited: !!s.editedAt };
        }) });
      }
      if (a === 'adminGetShift') {
        var f = rows_('Shifts').filter(function (s) { return String(s.shiftId) === String(d.shiftId); })[0];
        if (!f) return json_({ status: 'error', message: 'Shift not found.' });
        var fs = fullShift_(f);
        return json_({ status: 'ok', shift: fs, row: { status: f.status, submittedAt: iso_(f.submittedAt), signature: f.signature, editedAt: iso_(f.editedAt) }, pretrip: fs.pretrip ? { data: fs.pretrip, signature: fs.pretrip.signature, at: fs.pretrip.at } : null });
      }
      if (a === 'adminSaveShift') {
        var ns = d.shift || {};
        var row = rows_('Shifts').filter(function (s) { return String(s.shiftId) === String(ns.id); })[0];
        if (!row) return json_({ status: 'error', message: 'Shift not found (it may have been deleted).' });
        var st = d.status === 'Open' || d.status === 'Submitted' ? d.status : row.status;
        ns.adminEditAt = new Date().toISOString();
        delete ns._status; delete ns._submittedAt;
        saveShiftRow_(row, ns, { driverId: row.driverId, driverName: row.driverName, status: st, submittedAt: st === 'Submitted' ? (iso_(row.submittedAt) || new Date().toISOString()) : '', editedAt: ns.adminEditAt });
        return json_({ status: 'ok', editedAt: ns.adminEditAt });
      }
      if (a === 'adminDeleteShift') {
        var sid0 = String(d.shiftId || '');
        if (!sid0) return json_({ status: 'error', message: 'Missing shift id.' });
        var n1 = keepRows_('Shifts', function (s) { return String(s.shiftId) !== sid0; });
        keepRows_('Pretrips', function (p) { return String(p.shiftId) !== sid0; });
        if (d.withTrail !== false) keepRows_('Positions', function (p) { return String(p.shiftId) !== sid0; });
        addTombstone_(sid0);
        return json_({ status: n1 ? 'ok' : 'error', message: n1 ? '' : 'Shift not found.' });
      }
      if (a === 'adminTrack') {
        var from = ms_(d.from), to = ms_(d.to);
        if (!from || !to) return json_({ status: 'error', message: 'Missing date range.' });
        var drows = rows_('Drivers'), drv0 = drows.filter(function (x) { return String(x.id) === String(d.driverId); })[0];
        if (!drv0) return json_({ status: 'error', message: 'Driver not found.' });
        var pts = rows_('Positions').filter(function (p) {
          var t = ms_(p.at);
          return t >= from && t < to && (String(p.driverId) === String(drv0.id) || (!p.driverId && String(p.driverName) === String(drv0.name)));
        }).map(function (p) { return { at: iso_(p.at), lat: Number(p.lat), lon: Number(p.lon), place: p.place, status: p.status, unit: p.unit, kph: p.kph === '' ? null : Number(p.kph), shiftId: p.shiftId }; });
        var pret = rows_('Pretrips');
        var shifts = rows_('Shifts').filter(function (s) {
          if (String(s.driverId) !== String(drv0.id)) return false;
          var a0 = ms_(s.startedAt) - 2 * 86400000, b0 = s.status === 'Open' ? Date.now() : (ms_(s.submittedAt) || Date.now());
          return a0 < to && b0 >= from;
        }).map(function (s) { return fullShift_(s, pret); });
        return json_({ status: 'ok', driver: driverAdminView_(drv0), points: pts, shifts: shifts });
      }
      return json_({ status: 'error', message: 'Unknown action: ' + a });
    }

    // ----- driver actions -----
    if (a === 'driverLogin' || a === 'saveShift' || a === 'submitShift' || a === 'driverHistory') {
      var au = driverAuth_(d.name, d.passcode);
      if (!au.ok) return authFail_(au);
      var drv = au.driver, cfg2 = readConfig_();

      if (a === 'driverLogin') {
        try { purgeIfDue_(); } catch (err) {}
        var mine = rows_('Shifts').filter(function (s) { return String(s.driverId) === String(drv.id); });
        var open = mine.filter(function (s) { return s.status === 'Open'; }).pop();
        var cutoff = Date.now() - 16 * 86400000, days = {}, lastClose = '';
        mine.forEach(function (s) {
          if (s.status !== 'Submitted') return;
          var sj = parse_(s.json);
          if (sj && sj.closedAt && ms_(sj.closedAt) > ms_(lastClose)) lastClose = sj.closedAt;
          if (sj && sj.days) sj.days.forEach(function (x) { if (new Date(x.date + 'T12:00:00').getTime() >= cutoff) { days[x.date] = days[x.date] || { onDuty: 0, driving: 0 }; days[x.date].onDuty += Number(x.onDuty) || 0; days[x.date].driving += Number(x.driving) || 0; } });
        });
        // the truck's last km, whoever drove it (latest submitted shift per unit)
        var allOdo = {}, odoAt = {};
        rows_('Shifts').forEach(function (s) {
          if (s.status !== 'Submitted' || !s.unit || s.endOdo === '') return;
          var t = ms_(s.submittedAt);
          if (!odoAt[s.unit] || t >= odoAt[s.unit]) { allOdo[s.unit] = s.endOdo; odoAt[s.unit] = t; }
        });
        var ob = onBlocks_(mine, Date.now() - 40 * 86400000);
        return json_({
          status: 'ok', v: SCRIPT_VERSION, driver: driverPublic_(drv), company: cfg2.company, units: cfg2.units, rules: cfg2.rules,
          history: days, unitOdo: allOdo, lastClose: lastClose, openShift: open ? fullShift_(open) : null,
          onBlocks: ob.blocks, knownSince: ob.knownSince
        });
      }

      if (a === 'driverHistory') {
        var since = Date.now() - (Math.min(Number(d.days) || 15, 31)) * 86400000, pret2 = rows_('Pretrips');
        var hist = rows_('Shifts').filter(function (s) {
          if (String(s.driverId) !== String(drv.id)) return false;
          return s.status === 'Open' || (ms_(s.submittedAt) || ms_(s.startedAt)) >= since;
        }).map(function (s) { return fullShift_(s, pret2); });
        return json_({ status: 'ok', v: SCRIPT_VERSION, shifts: hist });
      }

      var sh = d.shift || {};
      var sid = cap_(sh.id, 80);
      if (!sid) return json_({ status: 'error', message: 'Missing shift id.' });
      if (tombstones_().indexOf(sid) > -1) return json_({ status: 'deleted', message: 'The office deleted this shift.' });
      var shifts = rows_('Shifts'), found = null, otherOpen = null;
      shifts.forEach(function (s) {
        if (String(s.shiftId) === sid) found = s;
        else if (String(s.driverId) === String(drv.id) && s.status === 'Open') otherOpen = s;
      });
      if (!found && otherOpen) return json_({ status: 'blocked', message: 'Submit your open shift before starting a new one.', openShift: fullShift_(otherOpen) });
      if (found && found.status === 'Submitted') return json_({ status: 'ok', alreadySubmitted: true });

      // trail points always go in, even if the office edited the shift
      savePoints_(drv, d.pts, sid, sh.unit);
      if (d.pos) updateLastSeen_(drv, d.pos, sh.unit);

      if (found) {
        var srv = parse_(found.json) || {};
        if (srv.adminEditAt && srv.adminEditAt !== sh.adminEditAt) {
          return json_({ status: 'replaced', message: 'The office edited this shift. This phone now has the office copy.', shift: fullShift_(found) });
        }
      }

      var isSubmit = a === 'submitShift';
      if (isSubmit) {
        var missing = [];
        if (!String(sh.remarks || '').trim()) missing.push('closing remarks');
        if (sh.endOdo === '' || sh.endOdo == null) missing.push('ending odometer');
        if (!sh.signature) missing.push('signature');
        if (missing.length) return json_({ status: 'error', message: 'Missing: ' + missing.join(', ') + '.' });
      }
      saveShiftRow_(found, sh, { driverId: drv.id, driverName: drv.name, status: isSubmit ? 'Submitted' : 'Open', submittedAt: isSubmit ? new Date().toISOString() : '' });

      var emailed = false, emailError = '';
      if (isSubmit) {
        try { emailed = emailLog_(cfg2, drv, sh, d.pdfBase64); } catch (err) { emailError = String(err); }
      }
      return json_({ status: 'ok', v: SCRIPT_VERSION, submitted: isSubmit, emailed: emailed, emailError: emailError });
    }

    return json_({ status: 'error', message: 'Unknown action: ' + a });
  } catch (err) {
    return json_({ status: 'error', message: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// On-duty (driving + on duty) time from a driver's shifts since `since`, merged, for the
// "24 consecutive hours off" check. knownSince = start of the driver's first shift on record.
function onBlocks_(shiftRows, since) {
  var list = [], known = 0;
  shiftRows.forEach(function (s) {
    var st = ms_(s.startedAt); if (st && (!known || st < known)) known = st;
    if (s.status === 'Open') return;          // the phone adds its open shift itself, live
    var end = ms_(s.submittedAt) || Date.now();
    if (end < since) return;
    var sj = parse_(s.json); if (!sj || !sj.events) return;
    var ev = sj.events.slice().sort(function (a, b) { return ms_(a.t) - ms_(b.t); });
    var close = sj.closedAt ? ms_(sj.closedAt) : end;
    var first = ev.length ? ms_(ev[0].t) : 0; if (first && (!known || first < known)) known = first;
    for (var i = 0; i < ev.length; i++) {
      if (ev[i].s !== 'D' && ev[i].s !== 'ON') continue;
      var a = ms_(ev[i].t), b = i + 1 < ev.length ? ms_(ev[i + 1].t) : close;
      if (b > a && b >= since) list.push([a, b]);
    }
  });
  list.sort(function (x, y) { return x[0] - y[0]; });
  var out = [];
  list.forEach(function (x) { var l = out[out.length - 1]; if (l && x[0] <= l[1]) l[1] = Math.max(l[1], x[1]); else out.push([x[0], x[1]]); });
  return { blocks: out, knownSince: known ? new Date(known).toISOString() : '' };
}

function saveShiftRow_(found, sh, meta) {
  var sid = String(sh.id);
  var js = JSON.stringify(sh);
  if (js.length > 45000) {
    var slim = JSON.parse(js); slim.signature = ''; slim.pretrip = sh.pretrip ? { done: true, at: sh.pretrip.at, defects: sh.pretrip.defects, defectNote: sh.pretrip.defectNote, defectList: sh.pretrip.defectList, note: 'detail stored in Pretrips tab' } : null;
    js = JSON.stringify(slim);
  }
  var rec = {
    shiftId: sid, driverId: meta.driverId, driverName: meta.driverName, date: cap_(sh.date, 12), unit: cap_(sh.unit, 60), startedAt: cap_(sh.startedAt, 40),
    submittedAt: meta.submittedAt || '', status: meta.status, startOdo: sh.startOdo == null ? '' : sh.startOdo, endOdo: sh.endOdo == null ? '' : sh.endOdo,
    onDutyHrs: Number(sh.onDutyHrs) || 0, drivingHrs: Number(sh.drivingHrs) || 0, remarks: cap_(sh.remarks, 2000), json: js,
    signature: sh.signature ? cap_(sh.signature, 40000) : '', editedAt: meta.editedAt || (found ? iso_(found.editedAt) : '')
  };
  if (found) write_('Shifts', found._row, rec); else append_('Shifts', rec);

  if (sh.pretrip && sh.pretrip.done && sh.pretrip.items) {
    var pfound = rows_('Pretrips').filter(function (p) { return String(p.shiftId) === sid; })[0];
    var prec = { shiftId: sid, driverName: meta.driverName, unit: rec.unit, at: cap_(sh.pretrip.at, 40), result: sh.pretrip.defects ? 'DEFECTS' : 'OK', json: cap_(JSON.stringify(sh.pretrip), 45000), signature: cap_(sh.pretrip.signature, 40000) };
    if (pfound) write_('Pretrips', pfound._row, prec); else append_('Pretrips', prec);
  }
}

function savePoints_(drv, pts, sid, unit) {
  if (!pts || !pts.length) return;
  var list = pts.slice(0, 500).filter(function (p) { return p && isFinite(Number(p.lat)) && isFinite(Number(p.lon)); }).map(function (p) {
    return { at: cap_(p.t, 40), driverName: drv.name, unit: cap_(p.unit || unit, 60), lat: Number(p.lat), lon: Number(p.lon), place: cap_(p.place, 120), status: cap_(p.s, 4), shiftId: cap_(p.shiftId || sid, 80), kph: p.kph == null ? '' : Math.round(Number(p.kph)), driverId: drv.id };
  });
  appendMany_('Positions', list);
}
function updateLastSeen_(drv, pos, unit) {
  if (!isFinite(Number(pos.lat)) || !isFinite(Number(pos.lon))) return;
  var mineRow = rows_('Drivers').filter(function (x) { return String(x.id) === String(drv.id); })[0];
  if (!mineRow) return;
  mineRow.lastLat = Number(pos.lat); mineRow.lastLon = Number(pos.lon); mineRow.lastPlace = cap_(pos.place, 120);
  mineRow.lastSeen = cap_(pos.at, 40) || new Date().toISOString(); mineRow.lastStatus = cap_(pos.status, 20); mineRow.lastUnit = cap_(unit, 60);
  if (mineRow.licenseExpiry instanceof Date) mineRow.licenseExpiry = day_(mineRow.licenseExpiry);
  write_('Drivers', mineRow._row, mineRow);
}

// ---------- email to office ----------
function emailLog_(cfg, drv, sh, pdfBase64) {
  var to = cfg.company.officeEmail;
  if (!to) return false;
  var ev = (sh.events || []).slice().sort(function (a, b) { return ms_(a.t) - ms_(b.t); }).map(function (x) {
    return '<tr><td>' + esc_(x.hm || x.t) + '</td><td>' + esc_(x.label || x.s) + (x.edited ? ' *' : '') + '</td><td>' + esc_(x.place || '') + '</td><td>' + esc_(x.note || '') + '</td></tr>';
  }).join('');
  var pre = sh.pretrip && sh.pretrip.done ? (sh.pretrip.defects ? 'DEFECTS REPORTED: ' + esc_((sh.pretrip.defectList || []).join(', ')) + ' - ' + esc_(sh.pretrip.defectNote || '') : 'Pre-trip completed, no defects') : 'No pre-trip recorded';
  var html = '<div style="font-family:Arial,sans-serif;font-size:14px">' +
    '<h2>' + esc_(cfg.company.name) + ' - Driver Daily Log</h2>' +
    (pdfBase64 ? '<p>The signed daily log (graph and pre-trip) is attached as a PDF.</p>' : '') +
    '<p><b>Driver:</b> ' + esc_(drv.name) + '<br><b>Unit:</b> ' + esc_(sh.unit) + ' &nbsp; <b>Plate:</b> ' + esc_(sh.plate) + ' &nbsp; <b>Trailers:</b> ' + esc_(sh.trailerA) + ' ' + esc_(sh.trailerB) + '<br>' +
    '<b>Date:</b> ' + esc_(sh.date) + '<br><b>Odometer:</b> ' + esc_(sh.startOdo) + ' to ' + esc_(sh.endOdo) + '<br>' +
    '<b>Driving:</b> ' + esc_(sh.drivingHrs) + ' h &nbsp; <b>On duty:</b> ' + esc_(sh.onDutyHrs) + ' h</p>' +
    '<p><b>Pre-trip:</b> ' + pre + '</p>' +
    '<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse"><tr><th>Time</th><th>Status</th><th>Location</th><th>Note</th></tr>' + ev + '</table>' +
    ((sh.events || []).some(function (x) { return x.edited; }) ? '<p style="font-size:12px">* edited by the driver or office after it was first recorded</p>' : '') +
    '<p><b>Closing remarks:</b> ' + esc_(sh.remarks) + '</p></div>';
  var opts = { to: to, subject: 'Driver log - ' + drv.name + ' - ' + sh.date + ' - ' + sh.unit, htmlBody: html, name: cfg.company.name };
  if (pdfBase64) {
    opts.attachments = [Utilities.newBlob(Utilities.base64Decode(String(pdfBase64)), 'application/pdf', 'Driver log ' + drv.name + ' ' + sh.date + '.pdf')];
  } else if (sh.signature && String(sh.signature).indexOf('base64,') > -1) {
    opts.htmlBody += '<p><b>Driver signature:</b><br><img src="cid:sig" style="border:1px solid #999;max-width:300px"></p>';
    opts.inlineImages = { sig: Utilities.newBlob(Utilities.base64Decode(String(sh.signature).split('base64,')[1]), 'image/png', 'signature.png') };
  }
  MailApp.sendEmail(opts);
  return true;
}
