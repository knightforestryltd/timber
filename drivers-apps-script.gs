// ============================================================================
// Knight Forestry - DRIVERS back end (its own Apps Script project + its own link)
// Stores everything in a Google Sheet called "Driver Logs" that is created automatically
// on first use. Tabs: Drivers, Shifts, Pretrips, Positions.
// Company info, units and rules live in Script Properties (small JSON).
// Deploy: Deploy > New deployment > Web app > Execute as: Me > Access: Anyone.
// Later updates: Deploy > Manage deployments > pencil > New version (never New deployment).
// This script is separate from the quote / load log / sync scripts and does not touch them.
// ============================================================================
var SCRIPT_VERSION = 1;
var SHEET_NAME = 'Driver Logs';
var TABS = {
  Drivers:  ['id', 'name', 'salt', 'hash', 'active', 'licenseNo', 'licenseExpiry', 'licenseLink', 'expenseNotes', 'lastLat', 'lastLon', 'lastPlace', 'lastSeen', 'lastStatus', 'lastUnit'],
  Shifts:   ['shiftId', 'driverId', 'driverName', 'date', 'unit', 'startedAt', 'submittedAt', 'status', 'startOdo', 'endOdo', 'onDutyHrs', 'drivingHrs', 'remarks', 'json', 'signature'],
  Pretrips: ['shiftId', 'driverName', 'unit', 'at', 'result', 'json', 'signature'],
  Positions: ['at', 'driverName', 'unit', 'lat', 'lon', 'place', 'status']
};
var DEFAULT_CONFIG = {
  company: { name: 'Knight Forestry Ltd', address: '', phone: '', officeEmail: '' },
  units: [],
  rules: { cycleHours: 70, cycleDays: 7, maxDriving: 13, maxWindow: 14, maxElapsed: 16, resetOffHours: 8, stillMinutes: 15, stillMeters: 100 }
};

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function props_() { return PropertiesService.getScriptProperties(); }
function sha_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2); }).join('');
}
function hashPw_(salt, pw) { return sha_(salt + '|' + pw); }

// ---------- sheet access ----------
function ss_() {
  var id = props_().getProperty('ssId');
  var ss;
  if (id) { ss = SpreadsheetApp.openById(id); }
  else { ss = SpreadsheetApp.create(SHEET_NAME); props_().setProperty('ssId', ss.getId()); }
  return ss;
}
function tab_(name) {
  var ss = ss_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, TABS[name].length).setValues([TABS[name]]);
    try { sh.setFrozenRows(1); sh.getRange(1, 1, 1, TABS[name].length).setFontWeight('bold'); } catch (e) {}
    try { var d = ss.getSheetByName('Sheet1'); if (d && ss.getSheets().length > 1) ss.deleteSheet(d); } catch (e) {}
  }
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
function line_(name, o) { return TABS[name].map(function (c) { return o[c] == null ? '' : o[c]; }); }
function append_(name, o) {
  var sh = tab_(name);
  var r = Math.max(sh.getLastRow() + 1, 2);
  sh.getRange(r, 1, 1, TABS[name].length).setValues([line_(name, o)]);
  return r;
}
function write_(name, row, o) { tab_(name).getRange(row, 1, 1, TABS[name].length).setValues([line_(name, o)]); }

// ---------- config ----------
function readConfig_() {
  var raw = props_().getProperty('config');
  var c = raw ? JSON.parse(raw) : {};
  var out = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  if (c.company) for (var k in c.company) out.company[k] = c.company[k];
  if (c.rules) for (var r in c.rules) out.rules[r] = c.rules[r];
  if (c.units) out.units = c.units;
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

function driverPublic_(d) {
  return { id: d.id, name: d.name, active: String(d.active) !== 'false', licenseNo: d.licenseNo, licenseExpiry: d.licenseExpiry, licenseLink: d.licenseLink, expenseNotes: d.expenseNotes };
}
function driverAdminView_(d) {
  var o = driverPublic_(d);
  o.hasPasscode = !!d.hash; o.lastLat = d.lastLat; o.lastLon = d.lastLon; o.lastPlace = d.lastPlace; o.lastSeen = d.lastSeen; o.lastStatus = d.lastStatus; o.lastUnit = d.lastUnit;
  return o;
}

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
    lock.waitLock(20000);
    var d = JSON.parse(e.postData.contents);
    var a = d.action;

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
        var cfg = readConfig_();
        return json_({ status: 'ok', config: cfg, drivers: rows_('Drivers').map(driverAdminView_) });
      }
      if (a === 'adminSaveConfig') {
        var cur = readConfig_(), inc = d.config || {};
        if (inc.company) { cur.company = { name: cap_(inc.company.name, 120), address: cap_(inc.company.address, 300), phone: cap_(inc.company.phone, 40), officeEmail: cap_(inc.company.officeEmail, 120) }; }
        if (inc.units) {
          cur.units = inc.units.slice(0, 100).map(function (u) {
            return { id: cap_(u.id, 40) || Utilities.getUuid(), name: cap_(u.name, 60), plate: cap_(u.plate, 20), trailerA: cap_(u.trailerA, 20), trailerB: cap_(u.trailerB, 20), notes: cap_(u.notes, 300) };
          });
        }
        if (inc.rules) { for (var k in DEFAULT_CONFIG.rules) { var n = Number(inc.rules[k]); if (isFinite(n) && n > 0) cur.rules[k] = n; } }
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
        rec.licenseNo = cap_(dr.licenseNo, 40); rec.licenseExpiry = cap_(dr.licenseExpiry, 20);
        rec.licenseLink = cap_(dr.licenseLink, 500); rec.expenseNotes = cap_(dr.expenseNotes, 1000);
        rec.active = dr.active === false ? 'false' : 'true';
        if (dr.passcode) {
          var pc = String(dr.passcode);
          if (pc.length < 4) return json_({ status: 'error', message: 'Passcode must be at least 4 characters.' });
          rec.salt = Utilities.getUuid(); rec.hash = hashPw_(rec.salt, pc);
        } else if (!existing) { return json_({ status: 'error', message: 'Create a passcode for the new driver.' }); }
        if (existing) write_('Drivers', existing._row, rec); else append_('Drivers', rec);
        return json_({ status: 'ok', drivers: rows_('Drivers').map(driverAdminView_) });
      }
      if (a === 'adminListShifts') {
        var all = rows_('Shifts').reverse().slice(0, Math.min(Number(d.limit) || 60, 200));
        return json_({ status: 'ok', shifts: all.map(function (s) {
          return { shiftId: s.shiftId, driverName: s.driverName, date: s.date, unit: s.unit, status: s.status, startedAt: s.startedAt, submittedAt: s.submittedAt, startOdo: s.startOdo, endOdo: s.endOdo, onDutyHrs: s.onDutyHrs, drivingHrs: s.drivingHrs };
        }) });
      }
      if (a === 'adminGetShift') {
        var f = rows_('Shifts').filter(function (s) { return String(s.shiftId) === String(d.shiftId); })[0];
        if (!f) return json_({ status: 'error', message: 'Shift not found.' });
        var pt = rows_('Pretrips').filter(function (p) { return String(p.shiftId) === String(d.shiftId); })[0];
        return json_({ status: 'ok', shift: parse_(f.json), row: { status: f.status, submittedAt: f.submittedAt, signature: f.signature }, pretrip: pt ? { data: parse_(pt.json), signature: pt.signature, at: pt.at } : null });
      }
      return json_({ status: 'error', message: 'Unknown action: ' + a });
    }

    // ----- driver actions -----
    if (a === 'driverLogin' || a === 'saveShift' || a === 'submitShift') {
      var au = driverAuth_(d.name, d.passcode);
      if (!au.ok) return authFail_(au);
      var drv = au.driver, cfg2 = readConfig_();

      if (a === 'driverLogin') {
        var mine = rows_('Shifts').filter(function (s) { return String(s.driverId) === String(drv.id); });
        var open = mine.filter(function (s) { return s.status === 'Open'; }).pop();
        var cutoff = Date.now() - 16 * 86400000, days = {}, lastOdo = {};
        mine.forEach(function (s) {
          if (s.status !== 'Submitted') return;
          if (s.unit && s.endOdo !== '') lastOdo[s.unit] = s.endOdo;
          var sj = parse_(s.json);
          if (sj && sj.days) sj.days.forEach(function (x) { if (new Date(x.date + 'T12:00:00').getTime() >= cutoff) { days[x.date] = days[x.date] || { onDuty: 0, driving: 0 }; days[x.date].onDuty += Number(x.onDuty) || 0; days[x.date].driving += Number(x.driving) || 0; } });
        });
        // odometer for units across all drivers (the truck's last km, whoever drove it)
        var allOdo = {};
        rows_('Shifts').forEach(function (s) { if (s.status === 'Submitted' && s.unit && s.endOdo !== '') allOdo[s.unit] = s.endOdo; });
        return json_({
          status: 'ok', v: SCRIPT_VERSION, driver: driverPublic_(drv), company: cfg2.company, units: cfg2.units, rules: cfg2.rules,
          history: days, unitOdo: allOdo, openShift: open ? parse_(open.json) : null
        });
      }

      var sh = d.shift || {};
      var sid = cap_(sh.id, 80);
      if (!sid) return json_({ status: 'error', message: 'Missing shift id.' });
      var shifts = rows_('Shifts'), found = null, otherOpen = null;
      shifts.forEach(function (s) {
        if (String(s.shiftId) === sid) found = s;
        else if (String(s.driverId) === String(drv.id) && s.status === 'Open') otherOpen = s;
      });
      if (!found && otherOpen) return json_({ status: 'blocked', message: 'Submit your open shift before starting a new one.', openShift: parse_(otherOpen.json) });
      if (found && found.status === 'Submitted') return json_({ status: 'ok', alreadySubmitted: true });

      var isSubmit = a === 'submitShift';
      if (isSubmit) {
        var missing = [];
        if (!String(sh.remarks || '').trim()) missing.push('closing remarks');
        if (sh.endOdo === '' || sh.endOdo == null) missing.push('ending odometer');
        if (!sh.signature) missing.push('signature');
        if (missing.length) return json_({ status: 'error', message: 'Missing: ' + missing.join(', ') + '.' });
      }
      var js = JSON.stringify(sh);
      if (js.length > 45000) { sh.signature = ''; sh.pretrip = sh.pretrip ? { done: true, note: 'detail stored in Pretrips tab' } : null; js = JSON.stringify(sh); }
      var rec2 = {
        shiftId: sid, driverId: drv.id, driverName: drv.name, date: cap_(sh.date, 12), unit: cap_(sh.unit, 60), startedAt: cap_(sh.startedAt, 40),
        submittedAt: isSubmit ? new Date().toISOString() : '', status: isSubmit ? 'Submitted' : 'Open', startOdo: sh.startOdo == null ? '' : sh.startOdo, endOdo: sh.endOdo == null ? '' : sh.endOdo,
        onDutyHrs: Number(sh.onDutyHrs) || 0, drivingHrs: Number(sh.drivingHrs) || 0, remarks: cap_(sh.remarks, 2000), json: js, signature: isSubmit ? cap_(sh.signature, 40000) : ''
      };
      if (found) write_('Shifts', found._row, rec2); else append_('Shifts', rec2);

      if (sh.pretrip && sh.pretrip.done) {
        var pts = rows_('Pretrips'), pfound = null;
        pts.forEach(function (p) { if (String(p.shiftId) === sid) pfound = p; });
        var prec = { shiftId: sid, driverName: drv.name, unit: rec2.unit, at: cap_(sh.pretrip.at, 40), result: sh.pretrip.defects ? 'DEFECTS' : 'OK', json: cap_(JSON.stringify(sh.pretrip), 45000), signature: cap_(sh.pretrip.signature, 40000) };
        if (pfound) write_('Pretrips', pfound._row, prec); else append_('Pretrips', prec);
      }

      if (d.pos && isFinite(Number(d.pos.lat)) && isFinite(Number(d.pos.lon))) {
        var drows = rows_('Drivers'), mineRow = null;
        drows.forEach(function (x) { if (String(x.id) === String(drv.id)) mineRow = x; });
        if (mineRow) {
          mineRow.lastLat = Number(d.pos.lat); mineRow.lastLon = Number(d.pos.lon); mineRow.lastPlace = cap_(d.pos.place, 120);
          mineRow.lastSeen = cap_(d.pos.at, 40) || new Date().toISOString(); mineRow.lastStatus = cap_(d.pos.status, 20); mineRow.lastUnit = rec2.unit;
          write_('Drivers', mineRow._row, mineRow);
        }
        append_('Positions', { at: cap_(d.pos.at, 40) || new Date().toISOString(), driverName: drv.name, unit: rec2.unit, lat: Number(d.pos.lat), lon: Number(d.pos.lon), place: cap_(d.pos.place, 120), status: cap_(d.pos.status, 20) });
      }

      var emailed = false, emailError = '';
      if (isSubmit) {
        try { emailed = emailLog_(cfg2, drv, sh); } catch (err) { emailError = String(err); }
      }
      return json_({ status: 'ok', submitted: isSubmit, emailed: emailed, emailError: emailError });
    }

    return json_({ status: 'error', message: 'Unknown action: ' + a });
  } catch (err) {
    return json_({ status: 'error', message: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// ---------- email to office ----------
function emailLog_(cfg, drv, sh) {
  var to = cfg.company.officeEmail;
  if (!to) return false;
  var ev = (sh.events || []).map(function (x) {
    return '<tr><td>' + esc_(x.hm || x.t) + '</td><td>' + esc_(x.label || x.s) + '</td><td>' + esc_(x.place || '') + '</td><td>' + esc_(x.note || '') + '</td></tr>';
  }).join('');
  var trips = (sh.trips || []).map(function (t) { return '<li>' + esc_(t.loadId) + (t.customer ? ' - ' + esc_(t.customer) : '') + '</li>'; }).join('');
  var fuel = (sh.fuel || []).map(function (f) { return '<li>' + esc_(f.litres) + ' L, $' + esc_(f.cost) + (f.place ? ' at ' + esc_(f.place) : '') + (f.note ? ' (' + esc_(f.note) + ')' : '') + '</li>'; }).join('');
  var pre = sh.pretrip && sh.pretrip.done ? (sh.pretrip.defects ? 'DEFECTS REPORTED: ' + esc_(sh.pretrip.defectNote || '') : 'Pre-trip completed, no defects') : 'No pre-trip recorded';
  var html = '<div style="font-family:Arial,sans-serif;font-size:14px">' +
    '<h2>' + esc_(cfg.company.name) + ' - Driver Daily Log</h2>' +
    '<p><b>Driver:</b> ' + esc_(drv.name) + '<br><b>Unit:</b> ' + esc_(sh.unit) + ' &nbsp; <b>Plate:</b> ' + esc_(sh.plate) + ' &nbsp; <b>Trailers:</b> ' + esc_(sh.trailerA) + ' ' + esc_(sh.trailerB) + '<br>' +
    '<b>Date:</b> ' + esc_(sh.date) + '<br><b>Odometer:</b> ' + esc_(sh.startOdo) + ' to ' + esc_(sh.endOdo) + '<br>' +
    '<b>Driving:</b> ' + esc_(sh.drivingHrs) + ' h &nbsp; <b>On duty:</b> ' + esc_(sh.onDutyHrs) + ' h</p>' +
    '<p><b>Pre-trip:</b> ' + pre + '</p>' +
    '<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse"><tr><th>Time</th><th>Status</th><th>Location</th><th>Note</th></tr>' + ev + '</table>' +
    (trips ? '<p><b>Trips:</b></p><ul>' + trips + '</ul>' : '') + (fuel ? '<p><b>Fuel:</b></p><ul>' + fuel + '</ul>' : '') +
    '<p><b>Closing remarks:</b> ' + esc_(sh.remarks) + '</p>' +
    (sh.signature ? '<p><b>Driver signature:</b><br><img src="cid:sig" style="border:1px solid #999;max-width:300px"></p>' : '') + '</div>';
  var opts = { to: to, subject: 'Driver log - ' + drv.name + ' - ' + sh.date + ' - ' + sh.unit, htmlBody: html, name: cfg.company.name };
  if (sh.signature && String(sh.signature).indexOf('base64,') > -1) {
    opts.inlineImages = { sig: Utilities.newBlob(Utilities.base64Decode(String(sh.signature).split('base64,')[1]), 'image/png', 'signature.png') };
  }
  MailApp.sendEmail(opts);
  return true;
}
