'use strict';
// Backend battery for company-apps-script.gs (run: TZ=America/Edmonton node backend.test.js <path-to-gs>)
// Group 26 is a risk probe with strict grid limits (Google Sheets refuses ranges below the last row of a tab).
const path = require('path');
const { createRuntime } = require('./gasmock');
const { group, check, eq, summary } = require('./harness');
const SCRIPT = process.argv[2];
const DAY = 86400000;

function fresh(o) { return createRuntime(Object.assign({ script: SCRIPT }, o || {})); }
// a company that is set up: password, admin token, key, name, a location + a yard
function company(o) {
  const rt = fresh(o);
  const r = rt.post({ svc: 'sync' }, { action: 'setPassword', newPassword: 'secret1', deviceName: 'Office PC', dev: 'DEVOFFICE' });
  rt.key = r.key; rt.at = r.adminToken;
  rt.sync = (body) => rt.post({ svc: 'sync', k: rt.key }, Object.assign({ dev: 'DEVOFFICE', adminToken: rt.at }, body));
  rt.loads = (body) => rt.post({ svc: 'loads', k: rt.key }, Object.assign({ dev: 'DEVOFFICE' }, body));
  rt.loadsAdmin = (body) => rt.loads(Object.assign({ adminToken: rt.at }, body));
  rt.tickets = (body) => rt.post({ svc: 'tickets', k: rt.key }, Object.assign({ dev: 'DEVOFFICE' }, body));
  rt.yards = (body) => rt.post({ svc: 'yards', k: rt.key }, Object.assign({ dev: 'DEVOFFICE' }, body));
  rt.yardsAdmin = (body) => rt.yards(Object.assign({ adminToken: rt.at }, body));
  rt.trucks = (body, extra) => rt.post(Object.assign({ svc: 'trucks', k: rt.key }, extra || {}), Object.assign({ dev: 'DEVOFFICE', adminToken: rt.at }, body));
  rt.money = (body) => rt.post({ svc: 'money', k: rt.key }, Object.assign({ dev: 'DEVOFFICE', adminToken: rt.at }, body));
  rt.drv = (body) => rt.post({ svc: 'drivers' }, Object.assign({ dev: 'DEVPHONE' }, body));
  rt.drvAdmin = (body) => rt.drv(Object.assign({ adminToken: rt.at }, body));
  return rt;
}
const SETTINGS = () => ({
  companyName: 'Test Forestry', gst: 5, speed: 80, fuelPrice: 1.6,
  locations: [{ id: 'L1', name: 'North Block', address: '53.6, -113.4', species: [{ name: 'Spruce', costPerTonne: 20, pricePerTonne: 40, tonnesPerCord: 1.5, pricePerCord: 90 }] },
    { id: 'Y1', name: 'Home Yard', address: '53.5, -113.5', species: [{ name: 'Birch', costPerTonne: 30, pricePerTonne: 60, tonnesPerCord: 1.6, pricePerCord: 120 }] }],
  units: [{ id: 'TU1', name: 'Tandem', aliases: ['T1'] }], money: { employerCostPct: 10 }, homeBase: '53.5, -113.5',
});
function book(rt, extra, opts) {
  return rt.loads(Object.assign({ timestamp: new Date().toISOString(), customerName: 'Jane Doe', phone: '780-555-0101', address: '12 Main St, Testville', notes: 'gate code 1234',
    bookingId: 'B' + Math.random().toString(36).slice(2, 8), options: opts || [{ location: 'North Block', species: 'Spruce', truck: 'Tandem', tonnes: 10, cords: 6.7, km: 55, total: 820, quotedTotal: 800, priceAdj: 20, requestedDate: '2026-12-01', product: 'Logs' }] }, extra || {}));
}
function loadsOf(rt) { return rt.get({ svc: 'loads', k: rt.key }).rows; }

/* ======================================================================== */
group('1. First run / connect screen', () => {
  const rt = fresh();
  const g = rt.get({});
  eq([g.status, g.app, g.v, g.unified, g.hasPassword], ['ok', 'company', 14, true, false], 'GET with no svc answers version info');
  const cp = rt.post({ svc: 'sync' }, { action: 'checkPassword', password: 'x' });
  eq([cp.status, cp.hasPassword], ['ok', false], 'checkPassword before set-up says no password');
  check(rt.get({ svc: 'sync' }).locations === undefined, 'settings readable before a password exists (nothing to protect)');
  const short = rt.post({ svc: 'sync' }, { action: 'setPassword', newPassword: 'abc' });
  eq(short.status, 'error', 'password under 4 characters refused');
  const r = rt.post({ svc: 'sync' }, { action: 'setPassword', newPassword: 'secret1', deviceName: 'PC' });
  check(r.status === 'ok' && r.key && r.key.length === 64 && r.adminToken && r.adminToken.length === 64, 'setPassword returns 64-char key and admin token');
  eq(rt.state.triggers.map(t => t.fn), ['nightly'], 'nightly trigger installed once');
  rt.post({ svc: 'sync' }, { action: 'setPassword', password: 'secret1', newPassword: 'secret2' });
  eq(rt.state.triggers.length, 1, 'changing password does not add a second trigger');
  check(!JSON.stringify(rt.state.props).includes('secret1') && !JSON.stringify(rt.state.props).includes('secret2'), 'plain passwords never stored in Script Properties');
  check(!JSON.stringify(rt.state.props).includes(r.adminToken), 'admin token stored only as a hash');
});

group('2. Company key, password change, admin devices', () => {
  const rt = company();
  eq(rt.get({ svc: 'sync' }).status, 'nokey', 'settings GET without key -> nokey');
  eq(rt.get({ svc: 'loads' }).status, 'nokey', 'loads GET without key -> nokey');
  eq(rt.get({ svc: 'tickets' }).status, 'nokey', 'tickets GET without key -> nokey');
  eq(rt.get({ svc: 'yards' }).status, 'nokey', 'yards GET without key -> nokey');
  eq(rt.post({ svc: 'loads' }, { customerName: 'x', options: [{}] }).status, 'nokey', 'booking without key -> nokey');
  check(rt.get({ svc: 'sync', k: rt.key })._meta, 'settings GET with key works');
  const ok = rt.post({ svc: 'sync' }, { action: 'checkPassword', password: 'secret1' });
  eq([ok.status, ok.key], ['ok', rt.key], 'checkPassword returns the company key');
  const m = rt.post({ svc: 'sync' }, { action: 'makeAdmin', password: 'secret1', deviceName: 'Phone 2' });
  check(m.status === 'ok' && m.adminToken && m.adminToken !== rt.at, 'makeAdmin gives a second admin token');
  eq(rt.post({ svc: 'sync' }, { action: 'whoami', adminToken: m.adminToken }).admin, true, 'whoami: new token is admin');
  const la = rt.sync({ action: 'listAdmins' });
  eq(la.devices.length, 2, 'two admin devices listed');
  check(la.devices.filter(d => d.me).length === 1, 'listAdmins marks this device as me');
  const other = la.devices.find(d => !d.me);
  rt.sync({ action: 'removeAdmin', id: other.id });
  eq(rt.post({ svc: 'sync' }, { action: 'whoami', adminToken: m.adminToken }).admin, false, 'removed device is no longer admin');
  const na = rt.post({ svc: 'sync', k: rt.key }, { action: 'saveSettings', adminToken: m.adminToken, settings: { locations: [{ id: 1 }] } });
  eq(na.status, 'noadmin', 'removed device saving settings gets noadmin');
  // password change kills key + all admin devices
  const ch = rt.post({ svc: 'sync' }, { action: 'setPassword', password: 'secret1', newPassword: 'secret9' });
  eq(rt.get({ svc: 'loads', k: rt.key }).status, 'nokey', 'old key stops working after password change');
  eq(rt.post({ svc: 'sync' }, { action: 'whoami', adminToken: rt.at }).admin, false, 'old admin token stops working after password change');
  eq(rt.post({ svc: 'sync' }, { action: 'whoami', adminToken: ch.adminToken }).admin, true, 'device that changed the password is admin');
  const bad = rt.post({ svc: 'sync' }, { action: 'setPassword', password: 'wrong', newPassword: 'zzzz9' });
  eq(bad.status, 'badpassword', 'changing password with wrong old password refused');
  const stop = rt.post({ svc: 'sync' }, { action: 'stopAdmin', adminToken: ch.adminToken });
  eq([stop.status, rt.post({ svc: 'sync' }, { action: 'whoami', adminToken: ch.adminToken }).admin], ['ok', false], 'stopAdmin removes only this device');
});

group('3. v14.3 per-device password lockout', () => {
  const rt = company();
  for (let i = 0; i < 10; i++) rt.post({ svc: 'sync' }, { action: 'checkPassword', password: 'nope', dev: 'PHONEA' });
  eq(rt.post({ svc: 'sync' }, { action: 'checkPassword', password: 'secret1', dev: 'PHONEA' }).status, 'locked', 'device A locked after 10 wrong tries (even with right password)');
  eq(rt.post({ svc: 'sync' }, { action: 'checkPassword', password: 'secret1', dev: 'PHONEB' }).status, 'ok', 'device B is NOT locked out by device A');
  rt.advance(601 * 1000);
  eq(rt.post({ svc: 'sync' }, { action: 'checkPassword', password: 'secret1', dev: 'PHONEA' }).status, 'ok', 'device A unlocks after 10 minutes');
  for (let i = 0; i < 100; i++) rt.post({ svc: 'sync' }, { action: 'checkPassword', password: 'nope', dev: 'R' + i });
  eq(rt.post({ svc: 'sync' }, { action: 'checkPassword', password: 'secret1', dev: 'FRESH' }).status, 'locked', 'company-wide ceiling (100 per 10 min) applies across devices');
  rt.advance(601 * 1000);
  eq(rt.post({ svc: 'sync' }, { action: 'checkPassword', password: 'secret1', dev: 'FRESH' }).status, 'ok', 'ceiling clears after 10 minutes');
  const weird = rt.post({ svc: 'sync' }, { action: 'checkPassword', password: 'nope', dev: '../../<script>' + 'x'.repeat(200) });
  eq(weird.status, 'badpassword', 'hostile device id is sanitised, request still answered');
  check(Object.keys(rt.state.cache).every(k => k.length < 250), 'cache keys stay short');
});

group('4. Company settings: save, guards, conflicts, size', () => {
  const rt = company();
  eq(rt.sync({ action: 'saveSettings', settings: {} }).status, 'rejected', 'save without locations list rejected');
  const s1 = rt.sync({ action: 'saveSettings', settings: Object.assign(SETTINGS(), { apiKey: 'MAPSKEY', sheetsUrl: 'https://x', yardPassword: 'pw' }) });
  eq(s1.status, 'saved', 'settings saved');
  const g = rt.get({ svc: 'sync', k: rt.key });
  check(g.sheetsUrl === undefined && g.yardPassword === undefined, 'link keys and yardPassword are never stored');
  eq(g.locations.length, 2, 'locations round-trip');
  eq(rt.sync({ action: 'saveSettings', settings: { locations: [] } }).status, 'rejected', 'empty locations cannot wipe saved ones');
  eq(rt.sync({ action: 'saveSettings', baseRev: s1.rev - 1, settings: SETTINGS() }).status, 'conflict', 'stale baseRev -> conflict');
  // an old cached page saves without v14 fields
  const old = SETTINGS(); delete old.money; delete old.homeBase; old.units = [{ id: 'TU1', name: 'Tandem' }]; delete old.apiKey;
  rt.sync({ action: 'saveSettings', settings: old });
  const g2 = rt.get({ svc: 'sync', k: rt.key });
  check(g2.money && g2.money.employerCostPct === 10 && g2.homeBase, 'old page save keeps money + homeBase (mergeGuard)');
  eq(g2.units[0].aliases, ['T1'], 'old page save keeps unit aliases');
  eq(g2.apiKey, 'MAPSKEY', 'blank Maps key does not erase saved key');
  const same = rt.get({ svc: 'sync', k: rt.key, rev: String(g2._meta.rev) });
  eq(same.same, true, 'GET with current rev answers tiny "same"');
  check(JSON.stringify(same).length < 400, 'tiny answer really is small (' + JSON.stringify(same).length + ' bytes)');
  // large settings: many locations
  const big = SETTINGS(); for (let i = 0; i < 400; i++) big.locations.push({ id: 'X' + i, name: 'Location ' + i, address: i + ' Some Road, County of Somewhere, AB', species: [{ name: 'Spruce', costPerTonne: 20, pricePerTonne: 40, tonnesPerCord: 1.5 }, { name: 'Pine', costPerTonne: 18, pricePerTonne: 38 }] });
  const sb = rt.sync({ action: 'saveSettings', settings: big });
  eq(sb.status, 'saved', 'large settings (' + Math.round(JSON.stringify(big).length / 1024) + ' KB) saved in chunks');
  eq(rt.get({ svc: 'sync', k: rt.key }).locations.length, 402, 'large settings round-trip');
  rt.sync({ action: 'saveSettings', settings: SETTINGS(), allowEmpty: true });
  const n = Number(rt.state.props.companySettings_n);
  check(!Object.keys(rt.state.props).some(k => /^companySettings_\d+$/.test(k) && Number(k.split('_')[1]) >= n), 'shrinking settings deletes the old chunks');
  // Script Properties total quota (500 KB)
  const huge = SETTINGS(); for (let i = 0; i < 2600; i++) huge.locations.push({ id: 'H' + i, name: 'Location number ' + i, address: i + ' Some Long Road Name, County of Somewhere, Alberta T0A 0A0', species: [{ name: 'Spruce', costPerTonne: 20, pricePerTonne: 40, tonnesPerCord: 1.5 }] });
  const sh = rt.sync({ action: 'saveSettings', settings: huge });
  check(sh.status === 'saved' || /quota|too large/i.test(sh.message || ''), 'very large settings (' + Math.round(JSON.stringify(huge).length / 1024) + ' KB) either save or fail with a clear quota message: ' + (sh.status + ' ' + (sh.message || '')).slice(0, 120));
  const after = rt.get({ svc: 'sync', k: rt.key });
  check(after.locations && after.locations.length >= 2, 'a failed oversized save leaves earlier settings readable', JSON.stringify(after).slice(0, 300) + ' chunks n=' + rt.state.props.companySettings_n + ' keys=' + Object.keys(rt.state.props).filter(k => /^companySettings_/.test(k)).length);
});

group('5. Profile, logo, dispatch texts, invoice numbers', () => {
  const rt = company();
  rt.sync({ action: 'saveSettings', settings: SETTINGS() });
  eq(rt.sync({ action: 'saveProfile', profile: { name: 'Knight Test', logo: 'data:image/png;base64,' + 'A'.repeat(150001) } }).status, 'error', 'logo over 150 KB refused');
  const p = rt.sync({ action: 'saveProfile', profile: { name: 'Knight Test', gst: '12345 RT0001', logo: 'data:image/png;base64,' + 'A'.repeat(60000) } });
  eq(p.status, 'saved', 'profile with 60 KB logo saved');
  eq(rt.get({}).companyName, 'Knight Test', 'company name shows on connect screen');
  eq(rt.get({ svc: 'sync', k: rt.key }).locations.length, 2, 'saving profile keeps locations');
  rt.sync({ action: 'saveDispatch', dispatch: { texts: true, template: 'Hi {name}' } });
  eq(rt.get({ svc: 'sync', k: rt.key }).dispatch, { texts: true, template: 'Hi {name}' }, 'dispatch texts saved');
  rt.sync({ action: 'saveSettings', settings: SETTINGS() });
  check(rt.get({ svc: 'sync', k: rt.key }).profile.name === 'Knight Test', 'settings save keeps profile');
  const a = rt.sync({ action: 'nextInvoice', ymd: '20261128' }), b = rt.sync({ action: 'nextInvoice', ymd: '20261128' }), c = rt.sync({ action: 'nextInvoice', ymd: '20261129' });
  eq([a.n, b.n, c.n], [1, 2, 1], 'invoice numbers count per day');
  eq(rt.post({ svc: 'sync' }, { action: 'nextInvoice' }).status, 'nokey', 'invoice number needs company key');
});

group('6. Bookings (Loads tab)', () => {
  const rt = company();
  rt.sync({ action: 'saveSettings', settings: SETTINGS() });
  const r = book(rt, { bookingId: 'BK1' }, [{ location: 'North Block', species: 'Spruce', truck: 'Tandem', tonnes: 10, total: 820, requestedDate: '2026-12-01', product: 'Logs', legs: { emptyOutKm: 20, loadedKm: 55 } }, { location: 'Home Yard', species: 'Birch', truck: 'Tandem', tonnes: 8, total: 700, requestedDate: '2026-12-01' }]);
  eq(r.status, 'ok', 'booking with 2 options accepted');
  let rows = loadsOf(rt);
  eq(rows.length, 2, 'two load rows');
  eq(rows[0].status, 'Pending', 'new load is Pending');
  eq(rows[0].bookingId, 'BK1-1', 'booking id per option');
  eq(rows[0].requestedDate, '2026-12-01', 'requested date reads back as yyyy-MM-dd (even though Sheets turns it into a date)');
  eq(rows[0].notes, 'gate code 1234', 'notes saved');
  eq(rows[0].loadedKm, 55, 'v14 leg columns saved');
  check(rows[0].place, 'delivery place looked up for a new address (' + rows[0].place + ')');
  const again = book(rt, { bookingId: 'BK1' }, [{ location: 'North Block' }, { location: 'Home Yard' }]);
  eq([again.duplicate, loadsOf(rt).length], [true, 2], 'resent booking is never added twice');
  eq(rt.sheet('Loads').getRange(4, 1, 1, 38).getValues()[0][37], 'Delivered At', 'Loads header has 38 columns ending in Delivered At');
  // header on row 4, data from 5
  eq(rt.sheet('Loads').getRange(5, 2).getValue(), 'Jane Doe', 'first load on row 5');
  // a read without the lock never geocodes a new address
  const before = rt.sheet('Places').getLastRow();
  rt.sheet('Loads').getRange(7, 1, 1, 4).setValues([[new Date().toISOString(), 'Hand Typed', '', '99 Unknown Rd']]);
  loadsOf(rt);
  eq(rt.sheet('Places').getLastRow(), before, 'plain GET of loads does not geocode or write Places');
});

group('7. Status, Delivered At, edit / assign / delete', () => {
  const rt = company();
  rt.sync({ action: 'saveSettings', settings: SETTINGS() });
  book(rt, { bookingId: 'BK2', customerName: 'Bob' });
  const u = rt.loads({ action: 'updateStatus', customerName: 'Bob', status: 'Delivered', loadId: 'KF-2026-1128-01', netTonnes: 9.8 });
  eq(u.status, 'ok', 'updateStatus by customer name');
  let l = loadsOf(rt)[0];
  eq([l.status, l.loadId, Number(l.netTonnes)], ['Delivered', 'KF-2026-1128-01', 9.8], 'status, load id and net tonnes written');
  check(/^\d{4}-\d\d-\d\dT/.test(l.deliveredAt), 'Delivered At stamped');
  const first = l.deliveredAt; rt.advance(60000);
  rt.loads({ action: 'updateStatus', loadId: 'KF-2026-1128-01', status: 'Delivered' });
  eq(loadsOf(rt)[0].deliveredAt, first, 'Delivered At is stamped only once');
  eq(rt.loads({ action: 'editLoad', find: { loadId: 'KF-2026-1128-01' }, changes: { notes: 'x' } }).status, 'badpassword', 'editLoad without admin refused');
  eq(rt.loadsAdmin({ action: 'editLoad', find: { loadId: 'KF-2026-1128-01' }, changes: { status: 'Lost' } }).status, 'error', 'editLoad with invalid status refused');
  const e = rt.loadsAdmin({ action: 'editLoad', find: { bookingId: 'BK2-1' }, changes: { phone: '780-555-9999', requestedDate: '2026-12-01', total: 900 } });
  eq([e.status, e.changed], ['ok', 2], 'editLoad writes only changed cells (requestedDate unchanged)');
  eq(loadsOf(rt)[0].phone, '780-555-9999', 'edited phone reads back');
  const as = rt.loadsAdmin({ action: 'assignLoad', find: { bookingId: 'BK2-1' }, unitId: 'TU1', driverName: 'Dave' });
  eq(as.status, 'ok', 'assignLoad');
  eq([loadsOf(rt)[0].unitId, loadsOf(rt)[0].driverName], ['TU1', 'Dave'], 'truck + driver assigned');
  eq(rt.loadsAdmin({ action: 'deleteLoad', find: { bookingId: 'BK2-1' } }).status, 'error', 'delivered load cannot be deleted');
  book(rt, { bookingId: 'BK3', customerName: 'Carl' });
  eq(rt.loadsAdmin({ action: 'deleteLoad', find: { bookingId: 'BK3-1' } }).status, 'ok', 'pending load deleted by admin');
  check(loadsOf(rt).every(x => x.customerName !== 'Carl'), 'deleted load gone');
  check(rt.sheet('Log').getDataRange().getValues().some(r => r[2] === 'load deleted' && String(r[4]).includes('Carl')), 'deleted load copied into the Log');
  eq(rt.loads({ action: 'updateStatus', customerName: 'Nobody', status: 'Paid' }).status, 'notfound', 'unknown load -> notfound');
  eq(rt.loads({ action: 'bogus' }).status, 'error', 'unknown loads action -> error');
});

group('8. v14.3 kg -> tonnes fix (runs once, under the lock only)', () => {
  const rt = company();
  book(rt, { bookingId: 'KG' , customerName: 'Kilo' });
  rt.state.props.netTonnesFixed && delete rt.state.props.netTonnesFixed;
  rt.sheet('Loads').getRange(5, 18).setValue(30360);
  loadsOf(rt);   // plain read (no lock)
  eq(rt.sheet('Loads').getRange(5, 18).getValue(), 30360, 'a plain read does not change Net Tonnes');
  rt.loads({ action: 'updateStatus', customerName: 'Nobody' });   // any locked request
  eq(rt.sheet('Loads').getRange(5, 18).getValue(), 30.36, '30360 kg becomes 30.36 t');
  rt.sheet('Loads').getRange(5, 18).setValue(30360);
  rt.loads({ action: 'updateStatus', customerName: 'Nobody' });
  eq(rt.sheet('Loads').getRange(5, 18).getValue(), 30360, 'fix runs only once (later values left alone)');
});

group('9. Recent loads for Dispatch', () => {
  const rt = company();
  rt.setClock(Date.parse('2026-06-01T12:00:00Z'));
  book(rt, { bookingId: 'OLD', customerName: 'Old Paid', timestamp: '2026-06-01T12:00:00.000Z' });
  rt.loads({ action: 'updateStatus', customerName: 'Old Paid', status: 'Paid', loadId: 'OLD1' });
  book(rt, { bookingId: 'OPEN', customerName: 'Old Open', timestamp: '2026-06-01T12:00:00.000Z' });
  rt.setClock(Date.parse('2026-11-28T12:00:00Z'));
  book(rt, { bookingId: 'NEW', customerName: 'New' });
  const recent = rt.get({ svc: 'loads', k: rt.key, recent: '1' }).rows.map(r => r.customerName);
  check(!recent.includes('Old Paid'), 'paid load older than 60 days left out of recent');
  check(recent.includes('Old Open') && recent.includes('New'), 'open old load and new load kept');
  rt.setClock(null);
});

group('10. Invoice email', () => {
  const rt = company();
  rt.loads({ action: 'sendInvoice', to: 'cust@example.test', subject: 'Invoice 1', pdfBase64: Buffer.from('%PDF-1.4 test').toString('base64'), filename: 'inv.pdf' });
  const m = rt.state.mails.pop();
  check(m && m.to === 'cust@example.test' && m.attachments && m.attachments[0].getName() === 'inv.pdf', 'invoice emailed with PDF attachment');
  rt.state.props.TEST_MODE = '1';
  rt.loads({ action: 'sendInvoice', to: 'cust@example.test', subject: 'Invoice 2' });
  const t = rt.state.mails.pop();
  check(t.to === 'owner@example.test' && /^\[TEST\]/.test(t.subject), 'TEST_MODE sends every email only to the owner');
  const bad = rt.loads({ action: 'sendInvoice', to: 'c@x.test', pdfBase64: 'not base64 !!' });
  check(bad.status === 'error', 'garbage PDF data answers an error, not a crash (' + bad.status + ')');
});

group('11. Scale tickets', () => {
  const rt = company();
  const row = ['T100', 'Logs', 'Acme', 'North Block', 15000, 45000, 30000, 25, 40, '2026-11-28 10:00', ''];
  eq(rt.tickets({ action: 'save', row }).status, 'ok', 'new ticket saved');
  eq(rt.tickets({ action: 'save', row }).duplicate, true, 'same ticket resent -> duplicate, not added twice');
  const diff = row.slice(); diff[5] = 46000; diff[6] = 31000;
  eq(rt.tickets({ action: 'save', row: diff }).status, 'exists', 'same number different weights refused (v14.3: never overwritten)');
  eq(rt.get({ svc: 'tickets', k: rt.key }).rows.length, 1, 'one ticket in the sheet');
  const ed = row.slice(); ed[0] = 'T101'; ed[2] = 'Acme Ltd';
  eq(rt.tickets({ action: 'edit', original: 'T100', row: ed }).status, 'edited', 'edit can change the ticket number');
  const t = rt.get({ svc: 'tickets', k: rt.key }).rows;
  eq([t.length, t[0][0], t[0][2]], [1, 'T101', 'Acme Ltd'], 'edit replaced the row');
  eq(String(t[0][6]), '30000', 'net weight kept');
  eq(rt.tickets({ action: 'delete', ticket: 'T101' }).status, 'badpassword', 'delete without admin refused');
  eq(rt.tickets({ action: 'delete', ticket: 'T101', adminToken: rt.at }).status, 'deleted', 'admin deletes ticket');
  eq(rt.get({ svc: 'tickets', k: rt.key }).rows.length, 0, 'ticket gone');
  check(rt.sheet('Log').getDataRange().getValues().some(r => r[1] === 'tickets' && r[2] === 'deleted' && String(r[4]).includes('Acme')), 'deleted ticket copied into the Log');
  const zero = ['007', 'Logs', 'Z', '', 1, 2, 1, '', '', '', ''];
  rt.tickets({ action: 'save', row: zero });
  eq(String(rt.get({ svc: 'tickets', k: rt.key }).rows[0][0]), '007', 'ticket number with leading zeros kept as text');
});

group('12. Inventory: old add, v14 drop/confirm/process/undo, stock', () => {
  const rt = company();
  rt.sync({ action: 'saveSettings', settings: SETTINGS() });
  rt.yards({ action: 'add', yard: 'Home Yard', species: 'Birch', type: 'In', tonnes: 20, pricePerTonne: 30 });   // old page: 12 columns
  rt.yards({ action: 'add', yard: 'Home Yard', species: 'Birch', type: 'In', tonnes: 10, pricePerTonne: 60, entryId: 'E1', product: 'Logs' });
  rt.yards({ action: 'add', yard: 'Home Yard', species: 'Birch', type: 'In', tonnes: 10, pricePerTonne: 60, entryId: 'E1', product: 'Logs' });
  eq(rt.get({ svc: 'yards', k: rt.key, all: '1' }).rows.length, 2, 'entry with same entryId added once');
  let st = rt.yardsAdmin({ action: 'stock' }).stock['Home Yard|Birch|Logs'];
  eq(st, { qty: 30, avg: 40 }, 'stock 30 t at weighted average $40/t');
  eq(rt.yards({ action: 'drop', drop: { id: 'D1', tonnes: 5 } }).status, 'badpassword', 'v14 yard actions need admin');
  rt.yardsAdmin({ action: 'drop', drop: { id: 'D1', yard: 'Home Yard', species: 'Birch', tonnes: 10, woodPrice: 35, haulCost: 50 } });
  st = rt.yardsAdmin({ action: 'stock' }).stock['Home Yard|Birch|Logs'];
  eq(st, { qty: 40, avg: 40 }, 'office drop at $35 + $50 haul / 10 t = $40/t');
  eq(rt.yardsAdmin({ action: 'process', process: { id: 'P0', yard: 'Nowhere', species: 'Oak', cords: 5 } }).status, 'error', 'processing without tonnes-per-cord refused (no default)');
  const pr = rt.yardsAdmin({ action: 'process', process: { id: 'P1', yard: 'Home Yard', species: 'Birch', cords: 10, wastePct: 0, labour: 100, sellPerCord: 150 } });
  eq([pr.status, pr.rawTonnes, pr.costPerCord], ['ok', 16, 74], '10 cords x 1.6 t = 16 t of logs; (16 x $40 + $100) / 10 = $74/cord');
  st = rt.yardsAdmin({ action: 'stock' }).stock;
  eq([st['Home Yard|Birch|Logs'].qty, st['Home Yard|Birch|Split'].qty, st['Home Yard|Birch|Split'].avg], [24, 10, 74], 'logs down 16 t, split up 10 cords at $74');
  eq(rt.get({ svc: 'sync', k: rt.key }).locations[1].species[0].splitPricePerCord, 150, 'split sell price saved on the location species');
  eq(rt.yardsAdmin({ action: 'process', process: { id: 'P1', yard: 'Home Yard', species: 'Birch', cords: 10 } }).duplicate, true, 'resent process not done twice');
  eq(rt.yardsAdmin({ action: 'undoProcess', id: 'P1' }).voided, 2, 'undo voids both rows');
  st = rt.yardsAdmin({ action: 'stock' }).stock;
  eq([st['Home Yard|Birch|Logs'].qty, st['Home Yard|Birch|Split'].qty], [40, 0], 'stock back after undo');
  // driver drop is pending until confirmed
  const rows0 = rt.get({ svc: 'yards', k: rt.key }).rows.length;
  rt.call('yardDrop_', { drop: { id: 'DD1', yard: 'Home Yard', species: 'Birch', tonnes: 12 } }, { name: 'Dave' });
  eq(rt.yardsAdmin({ action: 'stock' }).stock['Home Yard|Birch|Logs'].qty, 40, 'pending driver drop does not count');
  eq(rt.get({ svc: 'yards', k: rt.key }).rows.length, rows0 + 1, 'old pages see the pending row with tonnes 0');
  rt.yardsAdmin({ action: 'confirmDrop', id: 'DD1', woodPrice: 40, haulCost: 0 });
  eq(rt.yardsAdmin({ action: 'stock' }).stock['Home Yard|Birch|Logs'].qty, 52, 'confirmed drop counts');
  eq(rt.yardsAdmin({ action: 'confirmDrop', id: 'DD1' }).status, 'error', 'confirming twice refused');
});

group('13. Delivery from a yard takes wood out (and puts it back)', () => {
  const rt = company();
  rt.sync({ action: 'saveSettings', settings: SETTINGS() });
  rt.yards({ action: 'add', yard: 'Home Yard', species: 'Birch', type: 'In', tonnes: 30, pricePerTonne: 30, entryId: 'S1', product: 'Logs' });
  book(rt, { bookingId: 'YD', customerName: 'Yard Cust' }, [{ location: 'Home Yard', species: 'Birch', tonnes: 8, total: 600, product: 'Logs' }]);
  rt.loads({ action: 'updateStatus', customerName: 'Yard Cust', status: 'Delivered', loadId: 'KF-YD-1', netTonnes: 7.5 });
  let st = rt.yardsAdmin({ action: 'stock' }).stock['Home Yard|Birch|Logs'];
  eq(st.qty, 22.5, 'delivered 7.5 net tonnes leave the yard');
  rt.loads({ action: 'updateStatus', loadId: 'KF-YD-1', status: 'Delivered' });
  eq(rt.yardsAdmin({ action: 'stock' }).stock['Home Yard|Birch|Logs'].qty, 22.5, 'second Delivered does not take wood out twice');
  rt.loadsAdmin({ action: 'editLoad', find: { loadId: 'KF-YD-1' }, changes: { status: 'Pending' } });
  eq(rt.yardsAdmin({ action: 'stock' }).stock['Home Yard|Birch|Logs'].qty, 30, 'back to Pending puts the wood back');
  rt.loadsAdmin({ action: 'editLoad', find: { loadId: 'KF-YD-1' }, changes: { status: 'Delivered' } });
  eq(rt.yardsAdmin({ action: 'stock' }).stock['Home Yard|Birch|Logs'].qty, 22.5, 'delivered again takes it out again (once)');
  book(rt, { bookingId: 'NB', customerName: 'Block Cust' }, [{ location: 'North Block', species: 'Spruce', tonnes: 8 }]);
  const before = rt.get({ svc: 'yards', k: rt.key, all: '1' }).rows.length;
  rt.loads({ action: 'updateStatus', customerName: 'Block Cust', status: 'Delivered', loadId: 'KF-NB-1' });
  eq(rt.get({ svc: 'yards', k: rt.key, all: '1' }).rows.length, before, 'delivery from a pickup location (not a yard) leaves inventory alone');
});

group('14. Drivers: admin, login, lockout, tokens', () => {
  const rt = company();
  eq(rt.drv({ action: 'adminSaveDriver', driver: { name: 'Dave', passcode: '1234' } }).status, 'badpassword', 'adding a driver needs admin');
  eq(rt.drvAdmin({ action: 'adminSaveDriver', driver: { name: 'Dave' } }).status, 'error', 'new driver needs a passcode');
  eq(rt.drvAdmin({ action: 'adminSaveDriver', driver: { name: 'Dave', passcode: '12' } }).status, 'error', 'passcode under 4 refused');
  const a = rt.drvAdmin({ action: 'adminSaveDriver', driver: { name: 'Dave', passcode: '1234', phone: '780-555-1111', licenseExpiry: '2027-05-01' } });
  eq(a.status, 'ok', 'driver added');
  eq(rt.drvAdmin({ action: 'adminSaveDriver', driver: { name: 'dave', passcode: '9999' } }).status, 'error', 'duplicate driver name refused (any case)');
  const dl = rt.get({ svc: 'drivers', action: 'drivers' });
  eq(dl.drivers, ['Dave'], 'public driver list has names only');
  check(!JSON.stringify(dl).includes('hash') && !JSON.stringify(dl).includes('salt'), 'driver list leaks no hashes');
  const cfg = rt.drvAdmin({ action: 'adminGetConfig' });
  check(cfg.status === 'ok' && cfg.drivers[0].hasPasscode && cfg.drivers[0].hash === undefined, 'admin view has no hash');
  eq(cfg.drivers[0].licenseExpiry, '2027-05-01', 'licence expiry reads back as a date string');
  const lg = rt.drv({ action: 'driverLogin', name: 'DAVE', passcode: '1234' });
  check(lg.status === 'ok' && lg.token, 'login by name (any case) + passcode returns a token');
  eq(rt.drv({ action: 'driverLogin', token: lg.token }).status, 'ok', 'token login works');
  eq(rt.drv({ action: 'driverLogin', token: lg.token.slice(0, -2) + 'xx' }).status, 'badpassword', 'tampered token refused');
  for (let i = 0; i < 10; i++) rt.drv({ action: 'driverLogin', name: 'Dave', passcode: '0000', dev: 'THIEF' });
  eq(rt.drv({ action: 'driverLogin', name: 'Dave', passcode: '1234', dev: 'THIEF' }).status, 'locked', 'phone locked after 10 wrong passcodes');
  eq(rt.drv({ action: 'driverLogin', name: 'Dave', passcode: '1234', dev: 'DAVESPHONE' }).status, 'ok', 'Dave\'s own phone is not locked out (v14.3)');
  const id = cfg.drivers[0].id;
  rt.drvAdmin({ action: 'adminSaveDriver', driver: { id, name: 'Dave', passcode: '5678' } });
  eq(rt.drv({ action: 'driverLogin', token: lg.token }).status, 'badpassword', 'new passcode ends old tokens');
  const lg2 = rt.drv({ action: 'driverLogin', name: 'Dave', passcode: '5678' });
  rt.drvAdmin({ action: 'adminSaveDriver', driver: { id, name: 'Dave', active: false } });
  eq(rt.drv({ action: 'driverLogin', token: lg2.token }).status, 'badpassword', 'deactivated driver token refused');
  eq(rt.get({ svc: 'drivers', action: 'drivers' }).drivers, [], 'inactive driver not listed');
  rt.drvAdmin({ action: 'adminSaveDriver', driver: { id, name: 'Dave', active: true } });
  const lg3 = rt.drv({ action: 'driverLogin', name: 'Dave', passcode: '5678' });
  eq(lg3.status, 'ok', 're-activated driver keeps passcode');
  const ps = rt.drvAdmin({ action: 'adminSavePerson', person: { id, roles: ['driver', 'mechanic', 'boss'], rates: { driver: 30, mechanic: 40 } } });
  eq(ps.people[0].roles, 'driver,mechanic', 'roles saved (unknown role dropped)');
  eq(rt.drv({ action: 'driverLogin', token: lg3.token }).roles, ['driver', 'mechanic'], 'login returns roles');
  check(!JSON.stringify(rt.drv({ action: 'driverLogin', token: lg3.token })).includes('"rates"'), 'driver login never contains pay rates');
});

function shiftOf(id, extra) {
  const now = new Date().toISOString();
  return Object.assign({ id, date: now.slice(0, 10), startedAt: now, unit: 'Tandem', unitId: '', startOdo: 100000, endOdo: '', events: [{ t: now, s: 'ON', label: 'On duty' }], trips: [], fuel: [], remarks: '', signature: '', drivingHrs: 0, onDutyHrs: 0 }, extra || {});
}
group('15. Shifts: open, blocked, submit, email, defects, fuel, ping', () => {
  const rt = company();
  rt.sync({ action: 'saveSettings', settings: SETTINGS() });
  rt.sync({ action: 'saveProfile', profile: { name: 'Test Forestry', email: 'office@example.test' } });
  rt.trucks({ action: 'saveUnit', unit: { name: 'Tandem', type: 'truck', trackHours: 'no' } });
  const unit = rt.trucks({ action: 'listUnits' }).units[0];
  rt.drvAdmin({ action: 'adminSaveDriver', driver: { name: 'Dave', passcode: '1234' } });
  const tok = rt.drv({ action: 'driverLogin', name: 'Dave', passcode: '1234' }).token;
  const s1 = rt.drv({ action: 'saveShift', token: tok, shift: shiftOf('S1', { unitId: unit.id }) });
  eq(s1.status, 'ok', 'shift started');
  eq(rt.drv({ action: 'saveShift', token: tok, shift: shiftOf('S2') }).status, 'blocked', 'a second shift while one is open is blocked');
  const login = rt.drv({ action: 'driverLogin', token: tok });
  eq(login.openShift && login.openShift.id, 'S1', 'login returns the open shift');
  eq(rt.drv({ action: 'submitShift', token: tok, shift: shiftOf('S1') }).status, 'error', 'submit without remarks / end odo / signature refused');
  // pre-trip with a major defect + fuel
  const pre = { done: true, at: new Date().toISOString(), items: [{ t: 'Brakes', a: 'defect' }], defects: true, defectNote: '', defectList: ['Brakes'], defectItems: [{ item: 'Brakes', severity: 'major', note: 'soft pedal', k: 'b' }], signature: 'data:image/png;base64,AAAA' };
  const fuel = [{ id: 'F1', at: new Date().toISOString(), litres: 200, cost: 300, pay: 'card', place: 'Esso' }];
  rt.drv({ action: 'saveShift', token: tok, shift: shiftOf('S1', { unitId: unit.id, pretrip: pre, fuel }) });
  let wos = rt.trucks({ action: 'listWorkOrders' }).workOrders;
  eq(wos.length, 1, 'major pre-trip defect opened one work order');
  eq(rt.trucks({ action: 'listUnits' }).units[0].status, 'Out of service', 'unit out of service after a major defect');
  // resend (cache cleared, like a later request after 6 h) -> still one WO
  rt.state.cache = {};
  rt.drv({ action: 'saveShift', token: tok, shift: shiftOf('S1', { unitId: unit.id, pretrip: pre, fuel }) });
  eq(rt.trucks({ action: 'listWorkOrders' }).workOrders.length, 1, 'resent shift does not open a second work order');
  let ex = rt.money({ action: 'listExpenses' }).expenses.filter(e => e.source === 'fuel');
  eq(ex.map(e => [+e.amount, +e.gst, +e.total]), [[300, 15, 315]], 'fuel -> one Expenses row, GST 5% from settings');
  // removing fuel on the phone zeroes it
  rt.drv({ action: 'saveShift', token: tok, shift: shiftOf('S1', { unitId: unit.id, pretrip: pre, fuel: [] }) });
  ex = rt.money({ action: 'listExpenses' }).expenses.filter(e => e.source === 'fuel');
  eq([ex.length, +ex[0].amount], [1, 0], 'fuel removed on phone is zeroed, not deleted');
  // GST from settings
  const s0 = SETTINGS(); s0.gst = 0; rt.sync({ action: 'saveSettings', settings: s0 });
  rt.drv({ action: 'saveShift', token: tok, shift: shiftOf('S1', { unitId: unit.id, pretrip: pre, fuel: [{ id: 'F2', at: new Date().toISOString(), litres: 10, cost: 20 }] }) });
  eq(+rt.money({ action: 'listExpenses' }).expenses.find(e => e.id.endsWith('F2')).gst, 0, 'GST rate 0 in settings -> no GST on fuel');
  // ping
  eq(rt.drv({ action: 'ping', token: tok, pos: { lat: 53.55, lon: -113.49, kph: 87.6, at: new Date().toISOString(), status: 'D' }, unit: 'Tandem' }).status, 'ok', 'ping accepted');
  const dv = rt.drvAdmin({ action: 'adminGetConfig' }).drivers[0];
  eq([Number(dv.lastLat), Number(dv.lastKph), dv.lastStatus], [53.55, 88, 'D'], 'ping stores last position + speed');
  check(!rt.sheet('Positions') || rt.sheet('Positions').getLastRow() <= 1, 'no GPS trail kept (v14.3)');
  rt.state.lockBusy = true;
  eq(rt.drv({ action: 'ping', token: tok, pos: { lat: 53.6, lon: -113.5 } }).status, 'ok', 'ping works while the sheet is busy (no lock)');
  eq(rt.drv({ action: 'saveShift', token: tok, shift: shiftOf('S1') }).status, 'busy', 'shift save while busy -> "busy" (phone retries)');
  rt.state.lockBusy = false;
  // submit
  const done = rt.drv({ action: 'submitShift', token: tok, pdfBase64: Buffer.from('%PDF').toString('base64'), shift: shiftOf('S1', { unitId: unit.id, pretrip: pre, endOdo: 100250, remarks: 'All good', signature: 'data:image/png;base64,AAAA', drivingHrs: 5, onDutyHrs: 8 }) });
  check(done.status === 'ok' && done.submitted && done.emailed, 'shift submitted and emailed to the office');
  const mail = rt.state.mails.pop();
  check(mail && mail.to === 'office@example.test' && mail.attachments && /Driver log/.test(mail.subject), 'email has the PDF log');
  eq(rt.drv({ action: 'submitShift', token: tok, shift: shiftOf('S1', { endOdo: 1, remarks: 'x', signature: 'x' }) }).alreadySubmitted, true, 'resent submit -> alreadySubmitted');
  const ur = rt.trucks({ action: 'unitCosts', unitId: unit.id }).readings;
  check(ur.some(r => Number(r.odo) === 100250), 'end odometer recorded as a unit reading');
  // escaping in email
  rt.drv({ action: 'saveShift', token: tok, shift: shiftOf('S9', { remarks: '<img src=x onerror=alert(1)>' }) });
  rt.drv({ action: 'submitShift', token: tok, shift: shiftOf('S9', { endOdo: 5, remarks: '<img src=x onerror=alert(1)>', signature: 's' }) });
  const m2 = rt.state.mails.pop();
  check(m2 && !m2.htmlBody.includes('<img src=x') && m2.htmlBody.includes('&lt;img'), 'driver text is HTML-escaped in the office email');
});

group('16. Office edits / deletes a shift while the phone has it', () => {
  const rt = company();
  rt.drvAdmin({ action: 'adminSaveDriver', driver: { name: 'Eve', passcode: '1234' } });
  const tok = rt.drv({ action: 'driverLogin', name: 'Eve', passcode: '1234' }).token;
  rt.drv({ action: 'saveShift', token: tok, shift: shiftOf('E1') });
  const list = rt.drvAdmin({ action: 'adminListShifts' }).shifts;
  eq(list.map(s => s.shiftId), ['E1'], 'office lists the shift');
  const full = rt.drvAdmin({ action: 'adminGetShift', shiftId: 'E1' }).shift;
  full.remarks = 'fixed by office';
  rt.drvAdmin({ action: 'adminSaveShift', shift: full });
  eq(rt.drv({ action: 'saveShift', token: tok, shift: shiftOf('E1') }).status, 'replaced', 'phone saving an office-edited shift gets the office copy');
  rt.drvAdmin({ action: 'adminDeleteShift', shiftId: 'E1' });
  eq(rt.drv({ action: 'saveShift', token: tok, shift: shiftOf('E1') }).status, 'deleted', 'phone saving a deleted shift is told it was deleted');
  eq(rt.drvAdmin({ action: 'adminListShifts' }).shifts.length, 0, 'deleted shift not re-created');
  eq(rt.drv({ action: 'saveShift', token: tok, shift: shiftOf('E2') }).status, 'ok', 'driver can start a new shift after delete');
  // yard shift can be open at the same time as a driving shift
  eq(rt.drv({ action: 'saveShift', token: tok, shift: shiftOf('Y1', { type: 'yard', yard: 'Home Yard' }) }).status, 'ok', 'yard shift can run next to a driving shift');
  eq(rt.drv({ action: 'submitShift', token: tok, shift: shiftOf('Y1', { type: 'yard', yard: 'Home Yard' }) }).submitted, true, 'yard shift submits without odometer/signature');
});

group('17. Trips for drivers (no company key)', () => {
  const rt = company();
  rt.sync({ action: 'saveSettings', settings: SETTINGS() });
  rt.drvAdmin({ action: 'adminSaveDriver', driver: { name: 'Dave', passcode: '1234' } });
  book(rt, { bookingId: 'T1', customerName: 'Mine' }); rt.loadsAdmin({ action: 'assignLoad', find: { bookingId: 'T1-1' }, unitId: 'x', driverName: 'Dave' });
  book(rt, { bookingId: 'T2', customerName: 'Someone else' });
  const tok = rt.drv({ action: 'driverLogin', name: 'Dave', passcode: '1234' }).token;
  const tr = rt.drv({ action: 'myTrips', token: tok });
  eq(tr.rows.map(r => r.customerName), ['Mine'], 'driver sees only loads assigned to them (or started / today)');
  check(tr.rows[0].pickupLat, 'pickup position from the location address');
  check(tr.rows[0].phone === undefined && tr.rows[0].total === undefined, 'trips list carries no phone number or price');
  eq(rt.drv({ action: 'myTrips', name: 'Dave', passcode: 'bad' }).status, 'badpassword', 'trips need the passcode');
  const yd = rt.drv({ action: 'yardDrop', token: tok, drop: { id: 'YD1', yard: 'Home Yard', species: 'Birch', tonnes: 9 } });
  eq(yd.status, 'ok', 'driver yard drop accepted');
  const al = rt.sync({ action: 'alerts' });
  check(al.pages.inventory && al.pages.inventory.amber >= 1, 'pending drop shows as an Inventory alert');
});

group('18. Trucks: units, roles, work orders, inspections, due', () => {
  const rt = company();
  rt.sync({ action: 'saveSettings', settings: SETTINGS() });
  eq(rt.post({ svc: 'trucks' }, { action: 'listUnits' }).status, 'nokey', 'trucks need a key, admin or person');
  rt.trucks({ action: 'saveUnit', unit: { name: 'Tandem', type: 'truck', trackHours: 'yes', purchasePrice: 90000, currentOdo: 5000, currentHours: 90, hasCrane: 'yes' } });
  eq(rt.trucks({ action: 'saveUnit', unit: { name: 'tandem' } }).status, 'error', 'duplicate unit name refused');
  const u = rt.trucks({ action: 'listUnits' }).units[0];
  eq([Number(u.currentOdo), Number(u.currentHours)], [5000, 90], 'starting odometer + hours recorded');
  check(u.due.some(x => x.task === 'PM-A'), 'PM-A due worked out for the truck (' + (u.due.map(x => x.text).join('; ')) + ')');
  // mechanic person
  rt.drvAdmin({ action: 'adminSaveDriver', driver: { name: 'Mo', passcode: '1234', roles: ['mechanic'] } });
  rt.drvAdmin({ action: 'adminSaveDriver', driver: { name: 'Dan', passcode: '1234' } });
  const mtok = rt.drv({ action: 'driverLogin', name: 'Mo', passcode: '1234' }).token;
  const dtok = rt.drv({ action: 'driverLogin', name: 'Dan', passcode: '1234' }).token;
  const asMech = (b) => rt.post({ svc: 'trucks' }, Object.assign({ token: mtok, dev: 'MECH' }, b));
  const asDrv = (b) => rt.post({ svc: 'trucks' }, Object.assign({ token: dtok, dev: 'DRV' }, b));
  check(asMech({ action: 'listUnits' }).units[0].purchasePrice === undefined, 'mechanic does not see purchase price');
  eq(asDrv({ action: 'saveWorkOrder', workOrder: { unitId: u.id, defect: 'x' } }).status, 'badpassword', 'plain driver cannot make work orders');
  eq(asMech({ action: 'saveUnit', unit: { name: 'Hack' } }).status, 'badpassword', 'mechanic cannot change units');
  const wo = asMech({ action: 'saveWorkOrder', workOrder: { unitId: u.id, defect: 'Leaking hose', severity: 'minor', mechRate: 999 } }).workOrder;
  check(wo && wo.mechRate === undefined, 'mechanic-set rate ignored / not shown');
  asMech({ action: 'addPart', woId: wo.id, part: { id: 'P1', part: 'Hose', qty: 2, unitCost: 12.5 } });
  asMech({ action: 'addPart', woId: wo.id, part: { id: 'P1', part: 'Hose', qty: 2, unitCost: 12.5 } });
  const ps = rt.trucks({ action: 'listWorkOrders' }).workOrders[0];
  eq([ps.parts.length, Number(ps.partsCost), ps.status], [1, 25, 'In progress'], 'part added once, total $25, WO in progress');
  rt.money({ action: 'savePeople', people: [{ id: 'MO', name: 'Mo', role: 'mechanic', hourlyRate: 40, roles: ['mechanic'] }] });
  const cl = asMech({ action: 'closeWorkOrder', woId: wo.id, mechanicName: 'Mo', mechHours: 2, shopLabor: 5000, backInService: true });
  check(cl.status === 'ok' && cl.workOrder.total === undefined, 'mechanic closes the WO without seeing $');
  const closed = rt.trucks({ action: 'listWorkOrders' }).workOrders[0];
  eq([Number(closed.laborCost), Number(closed.total), closed.shopLabor], [88, 113, ''], 'labour 2 h x $40 + 10% = $88, total $113, mechanic shop $ ignored');
  eq(rt.money({ action: 'listExpenses' }).expenses.filter(e => e.sourceRef === wo.id).length, 1, 'one Expenses row for the WO');
  eq(rt.money({ action: 'saveExpense', expense: { id: 'WO-EXP-' + wo.id, amount: 1 } }).status, 'error', 'WO expense cannot be edited in Money');
  // inspections
  const tpl = rt.trucks({ action: 'listTemplates', unitId: u.id }).templates.find(t => t.id === 'T-PMA');
  check(tpl.groups.some(g => g.crane), 'crane section included for a crane truck');
  const items = [].concat(...tpl.groups.map(g => g.items.map(i => ({ t: i.t, a: 'ok' }))));
  eq(rt.trucks({ action: 'saveInspection', inspection: { id: 'I1', unitId: u.id, template: 'T-PMA', items: items.slice(1) .concat([{ t: items[0].t }]) } }).status, 'error', 'unanswered items refused');
  items[3].a = 'defect'; items[3].sev = 'major'; items[3].note = 'cracked';
  const ins = rt.trucks({ action: 'saveInspection', inspection: { id: 'I1', unitId: u.id, template: 'T-PMA', items, odo: 5100, hours: 195 } });
  eq([ins.status, ins.workOrders.length], ['ok', 1], 'PM-A with one defect saved, one WO made');
  eq(rt.trucks({ action: 'saveInspection', inspection: { id: 'I1', unitId: u.id, template: 'T-PMA', items } }).duplicate, true, 'resent inspection not saved twice');
  const after = rt.trucks({ action: 'listUnits' }).units[0];
  eq(after.status, 'Out of service', 'major inspection defect -> out of service');
  check(after.due.find(x => x.templateId === 'T-PMA').text.includes('due in'), 'PM-A reset by the inspection (' + after.due.find(x => x.templateId === 'T-PMA').text + ')');
  eq(rt.trucks({ action: 'setOverride', unitId: u.id, on: true }).status, 'ok', 'office override for an out-of-service unit');
  rt.trucks({ action: 'deleteUnit', id: u.id });
  eq(rt.trucks({ action: 'listUnits' }).units[0].status, 'Sold', 'delete marks the unit Sold (row kept)');
});

group('19. Built-in editor tests (checkStructure + testTrucksMoney)', () => {
  const rt = company();
  rt.sync({ action: 'saveSettings', settings: SETTINGS() });
  book(rt); rt.tickets({ action: 'save', row: ['1', 'L', 'C', 'S', 1, 2, 1, '', '', '', ''] }); rt.yards({ action: 'add', yard: 'Y', species: 'S', tonnes: 1, entryId: 'e' });
  const tm0 = rt.call('testTrucksMoney');
  check(!tm0.some(l => /^FAIL/.test(l)), 'testTrucksMoney on a sheet where Trucks was never opened: ' + (tm0.filter(l => /^FAIL/.test(l)).join(' | ') || 'all OK'));
  rt.trucks({ action: 'listUnits' });
  const tm = rt.call('testTrucksMoney');
  const fails = tm.filter(l => /^FAIL/.test(l));
  check(!fails.length, 'testTrucksMoney: ' + tm.filter(l => /^(OK|FAIL)/.test(l)).length + ' checks, failures: ' + fails.join(' | '));
  const cs = rt.call('checkStructure');
  eq(cs[0], 'All checks passed', 'checkStructure: ' + cs[0]);
});

group('20. Money: expenses, recurring, payments, invoices, summary', () => {
  const rt = company();
  rt.sync({ action: 'saveSettings', settings: SETTINGS() });
  eq(rt.post({ svc: 'money', k: rt.key }, { action: 'summary' }).status, 'badpassword', 'Money needs admin (company key is not enough)');
  const e = rt.money({ action: 'saveExpense', expense: { id: 'X1', amount: 100, category: 'Office', date: '2026-11-02' } });
  eq([e.expense.gst, e.expense.total], [5, 105], 'GST defaults to settings rate');
  rt.money({ action: 'saveExpense', expense: { id: 'X1', amount: 200, gst: 0, category: 'Office', date: '2026-11-02' } });
  eq(rt.money({ action: 'listExpenses', from: '2026-11-01', to: '2026-11-30' }).expenses.map(x => +x.total), [200], 'edit replaces, date filter works');
  rt.money({ action: 'deleteExpense', id: 'X1' });
  eq(rt.money({ action: 'listExpenses' }).expenses.length, 0, 'expense deleted');
  rt.setClock(Date.parse('2026-11-15T18:00:00Z'));
  rt.money({ action: 'saveRecurring', recurring: { id: 'R1', name: 'Insurance', amount: 500, gst: 25, dayOfMonth: 10 } });
  rt.money({ action: 'saveRecurring', recurring: { id: 'R2', name: 'Lease', amount: 100, dayOfMonth: 31 } });
  rt.call('postRecurring_'); rt.call('postRecurring_');
  eq(rt.money({ action: 'listExpenses' }).expenses.map(x => x.vendor), ['Insurance'], 'bill due on the 10th posted once; the 31st not yet on the 15th');
  rt.setClock(Date.parse('2026-12-01T05:00:00Z'));   // Nov 30 22:00 Edmonton: last day of a 30-day month
  rt.call('postRecurring_');
  check(rt.money({ action: 'listExpenses' }).expenses.some(x => x.vendor === 'Lease'), 'day-31 bill posts on the last day of a 30-day month (script time zone)');
  rt.setClock(null);
  eq(rt.money({ action: 'savePayment', payment: { id: 'PM1', amount: 0 } }).status, 'error', 'payment of $0 refused');
  rt.money({ action: 'savePayment', payment: { id: 'PM1', loadId: 'L1', amount: 50 } });
  eq(rt.money({ action: 'savePayment', payment: { id: 'PM1', loadId: 'L1', amount: 50 } }).duplicate, true, 'payment resent not added twice');
  rt.money({ action: 'saveInvoice', invoice: { invoiceNo: 'INV-1', customer: 'Acme', total: 105, model: { lines: [1, 2] } } });
  const lp = rt.money({ action: 'listPayments' });
  eq([lp.payments.length, lp.invoices[0].model.lines.length], [1, 2], 'payments + manual invoices listed');
  const s = rt.money({ action: 'summary', from: '2026-01-01', to: '2026-12-31' });
  eq(['loads', 'tickets', 'yards', 'shifts', 'expenses', 'payments', 'invoices', 'workOrders', 'people', 'drivers', 'units', 'recurring', 'plans'].filter(k => !Array.isArray(s[k])), [], 'summary has every list Statistics needs');
});

group('21. Alerts (menu badges)', () => {
  const rt = company();
  rt.sync({ action: 'saveSettings', settings: SETTINGS() });
  const td = rt.call('today_');
  book(rt, { bookingId: 'AL', customerName: 'Today Cust' }, [{ location: 'North Block', requestedDate: td, tonnes: 5 }]);
  const a = rt.sync({ action: 'alerts' });
  check(a.pages.dispatch && a.pages.dispatch.red === 1, 'today\'s load with no truck/driver is a red Dispatch alert');
  eq(rt.post({ svc: 'sync' }, { action: 'alerts' }).pages, {}, 'alerts without key / admin / person are empty');
  rt.loads({ action: 'updateStatus', customerName: 'Today Cust', status: 'Delivered', loadId: 'AL1' });
  rt.advance(3 * DAY);
  const b = rt.sync({ action: 'alerts' });
  check(b.pages.billing && b.pages.billing.items.some(i => /Not invoiced/.test(i.t)), 'delivered 3 days ago and not invoiced -> Billing alert');
  rt.setClock(null);
});

group('22. Read-only requests skip the lock; busy answers', () => {
  const rt = company();
  rt.sync({ action: 'saveSettings', settings: SETTINGS() });
  rt.trucks({ action: 'listUnits' });  // first run seeds templates under the lock
  rt.sync({ action: 'alerts' });
  rt.state.lockBusy = true;
  eq(rt.sync({ action: 'alerts' }).status, 'ok', 'alerts work while busy');
  eq(rt.sync({ action: 'whoami' }).status, 'ok', 'whoami works while busy');
  eq(rt.trucks({ action: 'listUnits' }).status, 'ok', 'listUnits works while busy');
  eq(rt.money({ action: 'summary' }).status, 'ok', 'summary works while busy');
  eq(rt.get({ svc: 'loads', k: rt.key }).status, 'ok', 'GET loads works while busy');
  const b = book(rt);
  eq(b.status, 'busy', 'booking while busy -> busy (page sends again)');
  eq(rt.sync({ action: 'saveSettings', settings: SETTINGS() }).status, 'busy', 'settings save while busy -> busy');
  rt.state.lockBusy = false;
  const rt2 = company();   // brand new company: first trucks call must take the lock
  rt2.state.lockBusy = true;
  eq(rt2.trucks({ action: 'listUnits' }).status, 'busy', 'very first trucks request waits for the lock (it sets things up)');
});

group('23. Nightly: rolling backup, purge, log trim', () => {
  const rt = company();
  rt.sync({ action: 'saveSettings', settings: SETTINGS() });
  book(rt);
  rt.call('nightly');
  const folder = () => Object.values(rt.state.folders).find(f => f._name === 'Company Data backups');
  const live = () => Object.values(rt.state.files).filter(f => f._folder === folder() && !f._trashed);
  eq(live().length, 1, 'one backup file after the first night');
  check(/^BACKUP of Company Data · \d{4}-\d\d-\d\d \(not live\)$/.test(live()[0]._name), 'backup named "' + live()[0]._name + '"');
  rt.advance(DAY);
  eq(rt.call('backupNow'), 'unchanged', 'no change since last backup -> skipped');
  rt.ss()._updated = Date.now() + 2 * DAY; rt.advance(DAY);
  eq(rt.call('backupNow'), 'saved', 'changed sheet -> new backup');
  eq(live().length, 1, 'older backup trashed (rolling, one copy)');
  check(!rt.state.files[rt.state.props.ssId]._trashed, 'the live sheet is never trashed');
  // purge
  rt.drvAdmin({ action: 'adminSaveDriver', driver: { name: 'Old', passcode: '1234' } });
  const tok = rt.drv({ action: 'driverLogin', name: 'Old', passcode: '1234' }).token;
  rt.setClock(Date.now() - 400 * DAY);
  rt.drv({ action: 'saveShift', token: tok, shift: shiftOf('OLD1') });
  rt.drv({ action: 'submitShift', token: tok, shift: shiftOf('OLD1', { endOdo: 5, remarks: 'r', signature: 'data:image/png;base64,' + 'A'.repeat(1000) }) });
  rt.setClock(null);
  rt.call('purgeOld_');
  const sh = rt.drvAdmin({ action: 'adminListShifts' }).shifts;
  eq(sh.length, 1, 'shift older than 12 months is KEPT (only slimmed)');
  const full = rt.drvAdmin({ action: 'adminGetShift', shiftId: 'OLD1' });
  check(full.shift.purged === true && !full.row.signature, 'old shift slimmed (log detail + signature removed)');
  // log trim
  const log = rt.sheet('Log'); const n0 = log.getLastRow();
  const rows = []; for (let i = 0; i < 6000; i++) rows.push([new Date().toISOString(), 't', 'a', '', '']);
  log._maxRows = Math.max(log._maxRows, n0 + 6000); log.getRange(n0 + 1, 1, 6000, 5).setValues(rows);
  rt.call('trimLog_');
  eq(log.getLastRow() - 1, 5000, 'Log trimmed to the newest 5000 rows');
});

group('24. Robustness: bad input never crashes the script', () => {
  const rt = company();
  rt.sync({ action: 'saveSettings', settings: SETTINGS() });
  eq(rt.post({ svc: 'sync' }, '{not json').status, 'error', 'bad JSON -> "Bad request"');
  eq(rt.post({ svc: 'nope', k: rt.key }, {}).status, 'error', 'unknown service -> error');
  eq(rt.get({ svc: 'nope', k: rt.key }).status, 'error', 'unknown GET service -> error');
  const actions = {
    sync: ['registerCompany', 'findCompany', 'checkPassword', 'saveSettings', 'saveProfile', 'saveDispatch', 'nextInvoice', 'importOld', 'makeAdmin', 'adminKey', 'whoami', 'listAdmins', 'removeAdmin', 'stopAdmin', 'alerts', 'getLog'],
    loads: ['updateStatus', 'saveInvoice', 'editLoad', 'assignLoad', 'deleteLoad', 'sendInvoice', undefined],
    tickets: ['save', 'edit', 'delete', undefined], yards: ['add', 'drop', 'confirmDrop', 'process', 'undoProcess', 'voidEntry', 'saveSplitPrice', 'stock'],
    trucks: ['uploadPhoto', 'listUnits', 'dueList', 'listWorkOrders', 'listServicePlans', 'listTemplates', 'unitHistory', 'getPretrip', 'getInspection', 'unitCosts', 'saveInspection', 'addReading', 'saveWorkOrder', 'addPart', 'deletePart', 'closeWorkOrder', 'markSeen', 'saveUnit', 'deleteUnit', 'setOverride', 'saveServicePlan', 'saveTemplate'],
    money: ['listExpenses', 'saveExpense', 'deleteExpense', 'listRecurring', 'saveRecurring', 'savePayment', 'deletePayment', 'listPayments', 'listPeople', 'savePeople', 'saveInvoice', 'summary'],
    drivers: ['place', 'ping', 'adminCheck', 'adminGetConfig', 'adminSavePerson', 'adminSaveConfig', 'adminSaveDriver', 'adminListShifts', 'adminGetShift', 'adminSaveShift', 'adminDeleteShift', 'adminTrack', 'myTrips', 'yardDrop', 'driverLogin', 'saveShift', 'submitShift', 'driverHistory'],
  };
  const junk = [{}, { id: null, unit: null, drop: null, process: null, shift: null, expense: null, workOrder: null, inspection: null, recurring: null, payment: null, invoice: null, person: null, driver: null, plan: null, template: null, part: null, config: null, profile: null, settings: null, row: null, find: null, changes: null, people: null, ids: null, pos: null },
    { id: 7, unit: 'x', drop: 'x', process: 5, shift: [], expense: 'x', workOrder: 1, inspection: 'x', settings: 'x', row: 'abc', find: 3, changes: 'x', people: {}, ids: 'x', pos: 'x', items: 'x', lat: 'x', lon: 'y' }];
  const crashes = [];
  rt.drvAdmin({ action: 'adminSaveDriver', driver: { name: 'Fuzz', passcode: '1234' } });
  const tok = rt.drv({ action: 'driverLogin', name: 'Fuzz', passcode: '1234' }).token;
  Object.keys(actions).forEach(svc => actions[svc].forEach(a => junk.forEach((j, ji) => {
    const body = Object.assign({ dev: 'FUZZ', adminToken: rt.at, token: tok, action: a }, j);
    let r; try { r = rt.post({ svc, k: rt.key }, body); } catch (e) { crashes.push(svc + '.' + a + '#' + ji + ' THREW ' + e.message); return; }
    if (r.status === 'error' && /TypeError|ReferenceError|Cannot read|is not a function|undefined|null/.test(r.message || '')) crashes.push(svc + '.' + a + '#' + ji + ': ' + r.message);
  })));
  check(crashes.length === 0, 'malformed payloads give clean messages (' + crashes.length + ' raw JS errors)', crashes.join('\n         '));
  check(rt.get({ svc: 'loads', k: rt.key }).status === 'ok' && rt.call('checkStructure')[0] === 'All checks passed', 'sheet still healthy after fuzzing');
});

group('25. Company directory (sign in by company name)', () => {
  const other = company(); other.sync({ action: 'saveProfile', profile: { name: 'Other Co' } });
  const dir = company({ fetchHandler: (url) => ({ code: 200, body: JSON.stringify(other.get({})) }) });
  dir.sync({ action: 'saveProfile', profile: { name: 'Knight Forestry' } });
  eq(dir.post({ svc: 'sync' }, { action: 'registerCompany', url: 'https://evil.example/exec' }).status, 'error', 'only script.google.com/.../exec links accepted');
  eq(dir.post({ svc: 'sync' }, { action: 'registerCompany', url: 'https://script.google.com/macros/s/ABC123/exec' }).status, 'ok', 'company registers its link');
  eq(dir.post({ svc: 'sync' }, { action: 'findCompany', name: '  other   co. ' }).url, 'https://script.google.com/macros/s/ABC123/exec', 'find by name ignores case, spaces and dots');
  eq(dir.post({ svc: 'sync' }, { action: 'findCompany', name: 'knight forestry' }).self, true, 'directory finds its own company');
  eq(dir.post({ svc: 'sync' }, { action: 'findCompany', name: 'nobody' }).status, 'notfound', 'unknown name -> notfound');
  const dup = company(); dup.sync({ action: 'saveProfile', profile: { name: 'Other Co' } });
  const dir2 = dir; dir2.state.fetchHandler = () => ({ code: 200, body: JSON.stringify(dup.get({})) });
  eq(dir2.post({ svc: 'sync' }, { action: 'registerCompany', url: 'https://script.google.com/macros/s/XYZ/exec' }).status, 'taken', 'another company cannot take a registered name');
});

/* ---------- Sheets grid limit (needs confirming on a TEST copy) ---------- */
group('26. [risk probe] tabs growing past 1000 rows with strict grid limits', () => {
  const rt = company({ strictRows: true });
  rt.sync({ action: 'saveSettings', settings: SETTINGS() });
  let firstFail = null;
  for (let i = 0; i < 1100 && !firstFail; i++) {
    const r = rt.tickets({ action: 'save', row: ['N' + i, 'L', 'C', 'S', 1, 2, 1, '', '', '', ''] });
    if (r.status !== 'ok') firstFail = 'ticket #' + i + ': ' + r.status + ' ' + (r.message || '');
  }
  check(!firstFail, 'tickets (appendRow) keep working past row 1000', firstFail);
  const logRows = rt.sheet('Log').getLastRow();
  check(logRows > 1000, 'Log keeps growing past row 1000 under a strict grid (has ' + logRows + ' rows)', 'Log stopped at row ' + logRows + ' -> append_ uses getRange beyond the grid; log_() swallows the error');
  let expFail = null;
  for (let i = 0; i < 1100 && !expFail; i++) { const r = rt.money({ action: 'saveExpense', expense: { id: 'E' + i, amount: 1, date: '2026-11-01' } }); if (r.status !== 'ok') expFail = 'expense #' + i + ': ' + r.message; }
  check(!expFail, 'Expenses (append_ via getRange) keep working past row 1000', expFail);
});

group('27. Upgrade from a v14 sheet (new v14.3 columns added on the right, nothing moves)', () => {
  const rt = company();
  rt.sync({ action: 'saveSettings', settings: SETTINGS() });
  rt.drvAdmin({ action: 'adminSaveDriver', driver: { name: 'Dave', passcode: '1234' } });
  book(rt, { bookingId: 'UP', customerName: 'Upgrade Cust' });
  rt.trucks({ action: 'saveUnit', unit: { name: 'Tandem' } });
  rt.money({ action: 'saveExpense', expense: { id: 'U1', amount: 10 } });
  rt.tickets({ action: 'save', row: ['U1', 'L', 'C', 'S', 1, 2, 1, '', '', '', ''] });
  rt.yards({ action: 'add', yard: 'Home Yard', species: 'Birch', tonnes: 3, entryId: 'UY', product: 'Logs' });
  // make it look like v14: drop the last header cell of every tab (and Delivered At / lastKph data), as v14 wrote them
  const ss = rt.ss(); const snap = {};
  ss.getSheets().forEach(sh => {
    const name = sh.getName(), hr = name === 'Loads' ? 4 : 1, lastC = sh.getLastColumn(); if (!lastC || name === 'Log') return;
    snap[name] = sh.getRange(hr, 1, 1, lastC).getValues()[0].filter(String).slice(0, -1);
    sh.getRange(hr, lastC).setValue(''); rt.state.props['hdr_' + name] = String(lastC - 1);
  });
  rt.state.props.netTonnesFixed && delete rt.state.props.netTonnesFixed;
  rt.sheet('Loads').getRange(5, 18).setValue(28500);                   // a v14 row holding kilograms
  const before = rt.call('checkStructure');
  check(/not added yet/.test(before.join('\n')) && !/PROBLEM/.test(before.join('\n')), 'v14-shaped sheet: structure check reports only "new columns not added yet"');
  // use every part once with v14.3
  const tok = rt.drv({ action: 'driverLogin', name: 'Dave', passcode: '1234' }).token;
  rt.drv({ action: 'ping', token: tok, pos: { lat: 53.5, lon: -113.5, kph: 50 } });
  rt.loads({ action: 'updateStatus', customerName: 'Upgrade Cust', status: 'Delivered', loadId: 'UPL' });
  rt.trucks({ action: 'listUnits' }); rt.money({ action: 'summary' }); rt.get({ svc: 'yards', k: rt.key, all: '1' }); rt.sync({ action: 'alerts' });
  rt.drv({ action: 'saveShift', token: tok, shift: shiftOf('UPS') }); rt.drvAdmin({ action: 'adminGetConfig' });
  const after = rt.call('checkStructure');
  eq(after[0], 'All checks passed', 'after using v14.3 once, every tab has every column: ' + after[0]);
  const moved = []; Object.keys(snap).forEach(n => { const hr = n === 'Loads' ? 4 : 1, now = rt.sheet(n).getRange(hr, 1, 1, snap[n].length).getValues()[0]; snap[n].forEach((h, i) => { if (now[i] !== h) moved.push(n + ' col ' + (i + 1)); }); });
  eq(moved, [], 'no existing column moved or was renamed');
  const l = rt.get({ svc: 'loads', k: rt.key }).rows[0];
  eq(Number(l.netTonnes), 28.5, 'old kilogram Net Tonnes (28500) fixed to 28.5 t on first locked request');
  check(/^\d{4}-/.test(l.deliveredAt), 'Delivered At filled for a load delivered after the upgrade');
  eq(Number(rt.drvAdmin({ action: 'adminGetConfig' }).drivers[0].lastKph), 50, 'speed column added to Drivers and filled by the ping');
});

const out = summary('BACKEND (company-apps-script.gs v14.3)');
console.log(out.text);
require('fs').writeFileSync(path.join(__dirname, 'backend-results.json'), JSON.stringify(out.results, null, 1));
