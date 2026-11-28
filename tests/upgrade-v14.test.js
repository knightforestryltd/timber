'use strict';
// UPGRADE SAFETY: a company that has been running v14 switches to v14.4.
// 1. The real v14 script (tests/fixtures/company-apps-script-v14.gs) builds the sheet through its own requests.
// 2. Every cell and property is photographed.
// 3. v14.4 runs on that same sheet: page opens, then real work. Every changed cell must be one we expected.
// 4. Rollback: v14 still reads and writes the sheet after v14.4 has used it.
// Usage: node upgrade-v14.test.js <v14.4 company-apps-script.gs> [<v14 script>]
const path = require('path');
const { createRuntime } = require('./gasmock');
const { group, check, eq, summary } = require('./harness');
const NEW = process.argv[2], OLD = process.argv[3] || path.join(__dirname, 'fixtures', 'company-apps-script-v14.gs');
const DAY = 86400000;

const v14 = createRuntime({ script: OLD });
const v144 = v14.twin(NEW);
const pw = 'secret1';
const r0 = v14.post({ svc: 'sync' }, { action: 'setPassword', newPassword: pw, deviceName: 'Office', dev: 'OFF' });
const key = r0.key, at = r0.adminToken;
const call = (rt, svc, b, q) => rt.post(Object.assign({ svc, k: key }, q || {}), Object.assign({ dev: 'OFF', adminToken: at }, b));
const O = (svc, b) => call(v14, svc, b);

/* ---------------- 1. a month of v14 use ---------------- */
const log = [];
const must = (r, what) => { if (!r || /error|nokey|badpassword|busy/.test(r.status || '')) log.push(what + ': ' + JSON.stringify(r).slice(0, 160)); return r; };
v14.setClock(Date.parse('2026-10-25T15:00:00Z'));
must(O('sync', { action: 'saveSettings', settings: { companyName: 'Knight Forestry', gst: 5, speed: 80, fuelPrice: 1.6, apiKey: 'K',
  locations: [{ id: 'L1', name: 'North Block', address: '53.6, -113.4', species: [{ name: 'Spruce', costPerTonne: 20, pricePerTonne: 40, tonnesPerCord: 1.5 }] },
    { id: 'Y1', name: 'Home Yard', address: '53.5, -113.5', species: [{ name: 'Birch', costPerTonne: 30, pricePerTonne: 60, tonnesPerCord: 1.6, pricePerCord: 120 }] }],
  units: [{ id: 'TU1', name: 'Tandem', hourly: 120, fuel: 45, tonnes: 20, hours: 1 }], money: { employerCostPct: 10 }, homeBase: '53.5, -113.5' } }), 'settings');
must(O('sync', { action: 'saveProfile', profile: { name: 'Knight Forestry', email: 'office@example.test', logo: 'data:image/png;base64,' + 'iVBORw0KGgo'.repeat(2000) } }), 'profile');
['Tandem', 'Tri-axle'].forEach(n => must(O('trucks', { action: 'saveUnit', unit: { name: n, type: 'truck', trackHours: 'yes', currentOdo: 120000, currentHours: 4000 } }), 'unit'));
must(O('trucks', { action: 'saveUnit', unit: { name: 'Loader', type: 'equipment', trackHours: 'yes', currentHours: 900 } }), 'unit');
const units = O('trucks', { action: 'listUnits' }).units;
[['Dave', ['driver']], ['Eve', ['driver']], ['Mo', ['mechanic', 'driver']], ['Yuri', ['yard']]].forEach(([n, roles]) => must(O('drivers', { action: 'adminSaveDriver', driver: { name: n, passcode: '1234', roles, phone: '780-555-01' + n.length } }), 'driver ' + n));
const people = O('drivers', { action: 'adminGetConfig' }).drivers;
people.forEach(p => O('drivers', { action: 'adminSavePerson', person: { id: p.id, roles: p.roles, rates: { driver: 32, mechanic: 45, yard: 25 } } }));
O('yards', { action: 'add', yard: 'Home Yard', species: 'Birch', type: 'In', tonnes: 400, pricePerTonne: 28, entryId: 'Y0', product: 'Logs' });
for (let day = 0; day < 30; day++) {
  v14.setClock(Date.parse('2026-10-26T14:00:00Z') + day * DAY);
  for (let k = 0; k < 6; k++) {
    const i = day * 6 + k, yard = i % 3 === 0;
    must(call(v14, 'loads', { timestamp: new Date(Date.now() + k * 60000).toISOString(), customerName: 'Customer ' + i, phone: '780-555-' + String(1000 + i), address: (i % 40) + ' Range Rd, County', notes: i % 5 ? '' : 'Gate code ' + i,
      bookingId: 'BK' + i, options: [{ location: yard ? 'Home Yard' : 'North Block', species: yard ? 'Birch' : 'Spruce', truck: 'Tandem', tonnes: 20, cords: 12.5, km: 40 + k, total: 1500 + i, quotedTotal: 1500 + i, product: 'Logs', requestedDate: new Date(Date.now() + DAY).toISOString().slice(0, 10), legs: { loadedKm: 40 + k } }] }), 'book ' + i);
    const t = 'T' + (5000 + i), net = 18000 + (i % 7) * 500;
    must(call(v14, 'tickets', { action: 'save', row: [t, yard ? 'Birch' : 'Spruce', 'Customer ' + i, yard ? 'Home Yard' : 'North Block', 14000, 14000 + net, net, 25, 40, new Date().toISOString(), ''] }), 'ticket ' + i);
    if (day < 27) {
      must(call(v14, 'loads', { action: 'updateStatus', customerName: 'Customer ' + i, status: 'Started', loadId: t, netTonnes: net / 1000 }), 'started ' + i);
      must(call(v14, 'loads', { action: 'updateStatus', loadId: t, status: 'Delivered', netTonnes: net / 1000 }), 'delivered ' + i);
    }
    if (day < 20) must(call(v14, 'loads', { action: 'updateStatus', loadId: t, status: 'Paid', invoiceData: JSON.stringify({ paidAt: Date.now(), model: { invNo: 'INV-' + i, sub: 1500, gst: 75, total: 1575 } }) }), 'invoiced ' + i);
    if (day < 15 && k === 0) must(O('money', { action: 'savePayment', payment: { id: 'PAY' + i, loadId: t, amount: 1575, method: 'Etrans' } }), 'payment');
  }
  // two drivers work every day: shift with pre-trip, GPS trail points, fuel, then submit
  ['Dave', 'Eve'].forEach((n, di) => {
    const lg = v14.post({ svc: 'drivers' }, { action: 'driverLogin', name: n, passcode: '1234', dev: 'PH' + n });
    const tok = lg.token, u = units[di], sid = 'S' + n + day, start = new Date().toISOString();
    const pre = { done: true, at: start, items: [{ t: 'Brakes', a: day === 3 && di === 0 ? 'defect' : 'ok' }, { t: 'Lights', a: 'ok' }], defects: day === 3 && di === 0, defectNote: '', defectList: day === 3 && di === 0 ? ['Brakes'] : [],
      defectItems: day === 3 && di === 0 ? [{ item: 'Brakes', severity: 'major', note: 'soft pedal' }] : [], signature: 'data:image/png;base64,' + 'S'.repeat(3000) };
    const sh = { id: sid, date: start.slice(0, 10), startedAt: start, unit: u.name, unitId: u.id, startOdo: 120000 + day * 300, endOdo: '', events: [{ t: start, s: 'ON', label: 'On duty', place: 'Yard' }], trips: [], fuel: [{ id: 'F' + day, at: start, litres: 150, cost: 240, pay: 'card', place: 'Esso' }], pretrip: pre, remarks: '', signature: '' };
    const pts = Array.from({ length: 12 }, (_, j) => ({ t: new Date(Date.now() + j * 900000).toISOString(), lat: 53.5 + j / 100, lon: -113.5, s: 'D', kph: 70 }));
    must(v14.post({ svc: 'drivers' }, { action: 'saveShift', token: tok, dev: 'PH' + n, shift: sh, pts, pos: { lat: 53.6, lon: -113.4, at: new Date().toISOString() } }), 'shift ' + n);
    if (day < 29) {
      v14.advance(10 * 3600000);
      must(v14.post({ svc: 'drivers' }, { action: 'submitShift', token: tok, dev: 'PH' + n, shift: Object.assign({}, sh, { endOdo: sh.startOdo + 280, remarks: 'All good', signature: 'data:image/png;base64,' + 'G'.repeat(4000), drivingHrs: 7, onDutyHrs: 10, closedAt: new Date().toISOString(),
        days: [{ date: start.slice(0, 10), onDuty: 10, driving: 7 }] }) }), 'submit ' + n);
      v14.advance(-10 * 3600000);
    }
  });
  if (day % 7 === 0) must(O('money', { action: 'saveExpense', expense: { id: 'EX' + day, amount: 500 + day, category: 'Insurance', vendor: 'Co-op', date: new Date().toISOString().slice(0, 10) } }), 'expense');
  if (day === 5) must(O('yards', { action: 'process', process: { id: 'PR1', yard: 'Home Yard', species: 'Birch', cords: 20, wastePct: 5, labour: 300, sellPerCord: 160 } }), 'process');
  if (day === 6) must(O('yards', { action: 'drop', drop: { id: 'DR1', yard: 'Home Yard', species: 'Birch', tonnes: 25, woodPrice: 30, haulCost: 200 } }), 'drop');
  if (day === 10) { const wo = O('trucks', { action: 'listWorkOrders' }).workOrders[0]; if (wo) { O('trucks', { action: 'addPart', woId: wo.id, part: { id: 'P1', part: 'Brake can', qty: 1, unitCost: 180 } }); must(O('trucks', { action: 'closeWorkOrder', woId: wo.id, mechanicName: 'Mo', mechHours: 3, mechRate: 45, backInService: true }), 'close WO'); } }
  if (day === 12) must(O('money', { action: 'saveRecurring', recurring: { id: 'R1', name: 'Truck lease', amount: 2100, gst: 105, dayOfMonth: 1, category: 'Lease' } }), 'recurring');
  if (day === 14) must(O('money', { action: 'saveInvoice', invoice: { invoiceNo: 'M-1', customer: 'Cash sale', total: 315, sub: 300, gst: 15, model: { lines: [] } } }), 'manual invoice');
  try { v14.call('nightly'); } catch (e) { log.push('nightly: ' + e.message); }
}
const tabsOf = () => v14.ss().getSheets().map(s => s.getName());

group('U1. v14 built a realistic month of data (no errors from v14 itself)', () => {
  eq(log, [], 'every v14 request succeeded');
  const L = call(v14, 'loads', {}, {}); // noop
  const rows = v14.get({ svc: 'loads', k: key }).rows;
  eq(rows.length, 180, '180 loads');
  eq(v14.get({ svc: 'tickets', k: key }).rows.length, 180, '180 tickets');
  check(v14.sheet('Positions').getLastRow() > 600, 'v14 GPS trail: ' + (v14.sheet('Positions').getLastRow() - 1) + ' points');
  check(v14.sheet('Shifts').getLastRow() - 1 === 60, '60 shifts (2 still open)');
  check(tabsOf().length >= 18, 'tabs: ' + tabsOf().join(', '));
  eq(v14.call('checkStructure')[0], 'All checks passed', 'v14 structure check passes');
});

/* ---------------- 2. photograph ---------------- */
const photo = () => { const o = {}; v14.ss().getSheets().forEach(s => { o[s.getName()] = JSON.parse(JSON.stringify(s._cells.slice(0, s.getLastRow()).map(r => (r || []).map(v => (v instanceof Object && v.getTime ? 'D:' + v.getTime() : v))))); }); return o; };
const before = photo(), propsBefore = JSON.parse(JSON.stringify(v14.state.props));
function cellDiff(a, b) {
  const out = [];
  Object.keys(a).forEach(t => { const A = a[t], B = b[t] || []; A.forEach((row, r) => { const br = B[r] || []; const n = Math.max(row.length, br.length); for (let c = 0; c < n; c++) { const x = row[c] == null ? '' : row[c], y = br[c] == null ? '' : br[c]; if (JSON.stringify(x) !== JSON.stringify(y)) out.push({ tab: t, row: r + 1, col: c + 1, was: String(x).slice(0, 40), now: String(y).slice(0, 40) }); } }); });
  return out;
}

/* ---------------- 3. v14.4 takes over ---------------- */
v14.setClock(Date.parse('2026-11-28T16:00:00Z'));
const A = (svc, b) => call(v144, svc, b);
group('U2. v14.4 opening every page on the v14 sheet changes nothing except two header cells + first-use set-up', () => {
  // what each page asks for when it opens
  v144.get({ svc: 'sync', k: key, settings: '1' }); A('sync', { action: 'alerts' }); v144.get({ svc: 'loads', k: key, recent: '1' }); v144.get({ svc: 'loads', k: key });
  v144.get({ svc: 'tickets', k: key }); v144.get({ svc: 'yards', k: key, all: '1' }); A('trucks', { action: 'listUnits' }); A('trucks', { action: 'listWorkOrders' });
  A('money', { action: 'summary' }); A('money', { action: 'listPayments' }); A('drivers', { action: 'adminGetConfig' }); A('drivers', { action: 'adminListShifts' });
  const d = cellDiff(before, photo());
  const expected = c => (c.tab === 'Loads' && c.row === 4 && c.col === 38 && c.now === 'Delivered At') || (c.tab === 'Drivers' && c.row === 1 && c.col === 19 && c.now === 'lastKph');
  eq(d.filter(c => !expected(c)), [], 'no data cell changed (' + d.length + ' header cell(s) added: ' + d.map(c => c.tab + ' ' + c.now).join(', ') + ')');
  const pd = Object.keys(Object.assign({}, propsBefore, v14.state.props)).filter(k => propsBefore[k] !== v14.state.props[k]);
  const noSeen = j => JSON.stringify((JSON.parse(j || '[]')).map(x => { const c = Object.assign({}, x); delete c.seen; return c; }));
  check(pd.every(k => /^hdr_|^netTonnesFixed$|^lastPurge$|^goLive$|^adminTokens$/.test(k)), 'only bookkeeping properties changed: ' + pd.join(', '));
  eq(noSeen(v14.state.props.adminTokens), noSeen(propsBefore.adminTokens), 'admin devices: same devices, only their "last seen" time updated');
  check(!pd.some(k => /companySettings|companyPw|companyKey|personSecret|drvConfig|companyId|inv_/.test(k)), 'settings, password, key, driver sign-ins untouched');
});

group('U3. v14.4 reads the v14 data the same way v14 does', () => {
  const firstDiff = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const x = a[i] || {}, y = b[i] || {}; for (const k of Object.keys(x)) if (JSON.stringify(x[k]) !== JSON.stringify(y[k])) return 'row ' + i + ' field ' + k + ': v14 ' + JSON.stringify(x[k]).slice(0, 80) + ' | v14.4 ' + JSON.stringify(y[k]).slice(0, 80); } return ''; };
  const sameOn = (name, a, b, keys) => { if (keys) { const fd = firstDiff(a.map(o => { const p = {}; keys.forEach(k => p[k] = o[k]); return p; }), b); if (fd) { check(false, name, fd); return; } } const pick = o => keys ? keys.map(k => o[k]) : o; const x = JSON.stringify(a.map(pick)), y = JSON.stringify(b.map(pick)); check(x === y, name, x === y ? '' : 'v14 ' + x.slice(0, 200) + ' || v14.4 ' + y.slice(0, 200)); };
  for (let i = 0, n = -1; i < 12 && n !== v14.sheet('Places').getLastRow(); i++) { n = v14.sheet('Places').getLastRow(); v14.get({ svc: 'loads', k: key }); }   // v14 looks up a few new addresses on every plain read: let it finish
  const lo = v14.get({ svc: 'loads', k: key }).rows, ln = v144.get({ svc: 'loads', k: key }).rows;
  sameOn('loads: every v14 field identical (' + lo.length + ' rows)', lo, ln, Object.keys(lo[0]));
  sameOn('tickets identical', v14.get({ svc: 'tickets', k: key }).rows, v144.get({ svc: 'tickets', k: key }).rows);
  sameOn('inventory identical', v14.get({ svc: 'yards', k: key, all: '1' }).rows, v144.get({ svc: 'yards', k: key, all: '1' }).rows);
  eq(JSON.stringify(call(v14, 'yards', { action: 'stock' }).stock), JSON.stringify(A('yards', { action: 'stock' }).stock), 'yard stock + average cost identical');
  const so = call(v14, 'money', { action: 'summary' }), sn = A('money', { action: 'summary' });
  ['expenses', 'payments', 'invoices', 'workOrders', 'units', 'recurring', 'people', 'tickets', 'yards'].forEach(k => sameOn('Statistics ' + k + ' identical', so[k], sn[k]));
  sameOn('Statistics shifts: hours, km, fuel identical', so.shifts, sn.shifts, ['id', 'driverName', 'startedAt', 'startOdo', 'endOdo', 'drivingHrs', 'onDutyHrs', 'fuel']);
  const go = call(v14, 'drivers', { action: 'adminListShifts', limit: 300 }).shifts, gn = A('drivers', { action: 'adminListShifts', limit: 300 }).shifts;
  sameOn('Drivers admin shift list identical (' + go.length + ')', go, gn);
  sameOn('work orders identical', call(v14, 'trucks', { action: 'listWorkOrders' }).workOrders, A('trucks', { action: 'listWorkOrders' }).workOrders);
  sameOn('units identical (status, odometer, hours)', call(v14, 'trucks', { action: 'listUnits' }).units, A('trucks', { action: 'listUnits' }).units, ['id', 'name', 'status', 'currentOdo', 'currentHours', 'openWOs']);
  const dl = v14.post({ svc: 'drivers' }, { action: 'driverLogin', name: 'Dave', passcode: '1234', dev: 'X' }), dn = v144.post({ svc: 'drivers' }, { action: 'driverLogin', name: 'Dave', passcode: '1234', dev: 'X' });
  eq([dn.status, dn.openShift && dn.openShift.id, JSON.stringify(dn.history), JSON.stringify(dn.unitOdo), dn.lastClose], [dl.status, dl.openShift && dl.openShift.id, JSON.stringify(dl.history), JSON.stringify(dl.unitOdo), dl.lastClose], 'driver log in: open shift, 14-day hours, odometers, last close identical');
  eq(v144.post({ svc: 'drivers' }, { action: 'driverLogin', token: dl.token, dev: 'X' }).status, 'ok', 'a driver phone signed in under v14 stays signed in (same token)');
  eq(v144.post({ svc: 'sync' }, { action: 'whoami', adminToken: at }).admin, true, 'office admin devices from v14 stay admins');
  eq(v144.get({ svc: 'loads', k: key }).status, 'ok', 'company key from v14 still works');
  eq(v144.post({ svc: 'sync' }, { action: 'checkPassword', password: pw }).status, 'ok', 'company password unchanged');
});

group('U4. Net Tonnes: v14 already wrote tonnes, so the one-time kg fix changes nothing', () => {
  const nets = v14.sheet('Loads').getRange(5, 18, 180, 1).getValues().map(r => r[0]).filter(v => v !== '');
  check(nets.length > 100 && nets.every(v => Number(v) > 0 && Number(v) < 100), nets.length + ' Net Tonnes values, all between 0 and 100 t (e.g. ' + nets.slice(0, 3).join(', ') + ')');
  A('loads', { action: 'updateStatus', customerName: 'Nobody' });   // first locked request runs the one-time fix
  eq(v14.sheet('Loads').getRange(5, 18, 180, 1).getValues().map(r => r[0]).filter(v => v !== ''), nets, 'after the fix ran: every Net Tonnes value identical');
});

group('U5. Real work on v14.4: only the cells that work should touch change', () => {
  const p0 = photo();
  const t = 'T' + (5000 + 170);                       // load 170 (day 28) was booked but not started under v14
  eq(A('loads', { action: 'updateStatus', customerName: 'Customer 170', status: 'Started', loadId: t, netTonnes: 19 }).status, 'ok', 'Dispatch: start an old v14 load');
  eq(A('loads', { action: 'updateStatus', loadId: t, status: 'Delivered', netTonnes: 19 }).status, 'ok', 'Dispatch: deliver it');
  const tok = v144.post({ svc: 'drivers' }, { action: 'driverLogin', name: 'Eve', passcode: '1234', dev: 'PHEve' }).token;
  eq(v144.post({ svc: 'drivers' }, { action: 'ping', token: tok, dev: 'PHEve', pos: { lat: 53.7, lon: -113.2, kph: 88, at: new Date().toISOString() } }).status, 'ok', 'v14.4 position ping on a v14 driver row');
  const d = cellDiff(p0, photo());
  const row170 = 5 + 170;
  const ok = c => (c.tab === 'Loads' && c.row === row170) || (c.tab === 'Drivers') || c.tab === 'Yards' || c.tab === 'Log';
  eq(d.filter(c => !ok(c)), [], 'changed cells: ' + d.length + ', all in Loads row ' + row170 + ', Eve\'s Drivers row, new Yards/Log rows');
  check(d.filter(c => c.tab === 'Drivers').every(c => c.row === 1 + 1 + people.findIndex(p => p.name === 'Eve') && [10, 11, 13, 19].includes(c.col)), 'Drivers: only Eve\'s last position/seen/speed cells');
  check(d.filter(c => c.tab === 'Yards' || c.tab === 'Log').every(c => c.was === ''), 'Yards + Log: only new rows added below, nothing overwritten');
  const l = v144.get({ svc: 'loads', k: key }).rows[170];
  check(l.status === 'Delivered' && /^2026-11-28/.test(l.deliveredAt), 'Delivered At stamped on the old v14 load');
  const b = call(v144, 'loads', { timestamp: new Date().toISOString(), customerName: 'New 14.4 customer', address: '1 Main', bookingId: 'NEW1', options: [{ location: 'Home Yard', species: 'Birch', tonnes: 20, total: 1600 }] });
  eq(b.status, 'ok', 'a new booking on v14.4');
  eq(v144.get({ svc: 'loads', k: key }).rows.length, 181, '181 loads');
  eq(v144.call('checkStructure')[0], 'All checks passed', 'v14.4 structure check passes on the upgraded sheet');
});

group('U5b. Backups: the v14 nightly backups survive the first v14.4 night', () => {
  const folder = Object.values(v14.state.folders).find(f => f._name === 'Company Data backups');
  const live = () => Object.values(v14.state.files).filter(f => f._folder === folder && !f._trashed);
  const old = live().filter(f => /^Company Data backup \d/.test(f._name)).map(f => f._id);
  eq(old.length, 14, 'v14 kept 14 dated backups');
  v14.ss()._updated = Date.now() + 1000; v144.call('nightly');
  v14.ss()._updated = Date.now() + 2 * DAY; v14.advance(DAY); v144.call('nightly');
  const now = live();
  eq(old.filter(id => now.some(f => f._id === id)).length, 14, 'all 14 v14 backups still there after two v14.4 nights');
  eq(now.filter(f => /^BACKUP of Company Data/.test(f._name)).length, 1, 'plus exactly one rolling v14.4 backup');
});

group('U6. Rollback: v14 still works on the sheet after v14.4 used it', () => {
  eq(v14.get({ svc: 'loads', k: key }).rows.length, 181, 'v14 reads all 181 loads (incl. the one booked by v14.4)');
  eq(call(v14, 'loads', { timestamp: new Date().toISOString(), customerName: 'Back on v14', address: '2 Main', bookingId: 'OLD1', options: [{ location: 'North Block', species: 'Spruce', tonnes: 10, total: 700 }] }).status, 'ok', 'v14 can still book');
  eq(v14.post({ svc: 'drivers' }, { action: 'driverLogin', name: 'Dave', passcode: '1234', dev: 'X' }).status, 'ok', 'v14 driver log in still works');
  const cs = v14.call('checkStructure'); check(!/PROBLEM/.test(cs.join('\n')), 'v14 structure check: ' + cs[0]);
});

const out = summary('UPGRADE v14 -> v14.4 (real v14 script + v14.4 on the same sheet)');
console.log(out.text); process.exitCode = out.fail || out.err ? 1 : 0;
