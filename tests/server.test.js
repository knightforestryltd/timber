const { makeEnv } = require('./gasmock');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };
const call = (g, b) => { g.reset(); return g.post(b); };

const g = makeEnv();
ok(call(g, { action: 'adminSetPassword', newPassword: 'boss1' }).status === 'ok', 'set admin pw');
ok(call(g, { action: 'adminCheck', password: 'nope' }).status === 'badpassword', 'bad admin pw');
let r = call(g, { action: 'adminGetConfig', password: 'boss1' });
const R0 = r.config.rules;
ok(r.status === 'ok' && R0.defaultSet === 'ab' && R0.ab.maxOnDuty === 15 && R0.ab.maxElapsed === 0 && R0.ab.cycleHours === 0 && R0.ab.offCount === 1 && R0.ab.offDays === 24, 'Alberta: 15 on duty, no elapsed, no cycle, 24 h off / 24 days');
ok(R0.sk.maxOnDuty === 15 && R0.sk.offCount === 0 && R0.sk.cycleHours === 0, 'Saskatchewan: 15 on duty, no 24/24, no cap');
ok(R0.c1.cycleHours === 70 && R0.c1.cycleDays === 7 && R0.c2.cycleHours === 120 && R0.c2.cycleDays === 14, '70/7 and 120/14');
r = call(g, { action: 'adminSaveConfig', password: 'boss1', config: { company: { name: 'KF', address: 'Box 1, Drayton Valley AB', officeEmail: 'office@example.com' }, units: [{ name: 'T1', plate: 'ABC1' }], rules: { v: 3, defaultSet: 'sk', ab: { maxOnDuty: 15.5, offCount: 3 }, sk: { maxElapsed: 0 }, offMinutes: 40, autoStatus: 0 } } });
ok(r.status === 'ok' && r.config.rules.defaultSet === 'sk' && r.config.rules.ab.maxOnDuty === 15.5 && r.config.rules.ab.offCount === 3 && r.config.rules.offMinutes === 40 && r.config.rules.autoStatus === 0, 'save rules');
r = call(g, { action: 'adminSaveDriver', password: 'boss1', driver: { name: 'Sam', phone: '780-555-1234', passcode: '1111' } });
ok(r.status === 'ok' && r.drivers[0].phone === '780-555-1234', 'driver phone saved');
const sam = r.drivers[0];
r = call(g, { action: 'driverLogin', name: 'Sam', passcode: '1111' });
ok(r.status === 'ok' && r.v === 3 && r.rules.ab && r.openShift === null && r.lastClose === '', 'login');

// place lookup
r = call(g, { action: 'place', name: 'Sam', passcode: '1111', lat: 50.5, lon: -113.9 });
ok(r.status === 'ok' && r.name === 'Okotoks' && r.prov === 'AB', 'place via Maps');
ok(call(g, { action: 'place', name: 'Sam', passcode: 'x', lat: 50.5, lon: -113.9 }).status === 'badpassword', 'place needs auth');

// save shift with trail points
const t0 = Date.now() - 3 * 3600000;
const shift = { id: 'S1', date: '2026-11-25', startedAt: new Date(t0).toISOString(), driverName: 'Sam', unit: 'T1', startOdo: 1000, endOdo: '', events: [{ id: 'e1', t: new Date(t0).toISOString(), s: 'OFF' }, { id: 'e2', t: new Date(t0 + 3600000).toISOString(), s: 'ON' }], pretrip: { done: true, at: new Date(t0 + 3600000).toISOString(), items: { '0.0': 'ok' }, signature: 'data:image/png;base64,AAAA' } };
r = call(g, { action: 'saveShift', name: 'Sam', passcode: '1111', shift, pos: { lat: 50.5, lon: -113.9, at: new Date().toISOString(), status: 'ON', place: 'near Okotoks' }, pts: [{ t: new Date(t0 + 3600000).toISOString(), lat: 50.5, lon: -113.9, kph: 0, s: 'ON', shiftId: 'S1' }, { t: new Date(t0 + 4500000).toISOString(), lat: 50.6, lon: -113.9, kph: 70, s: 'D', shiftId: 'S1' }] });
ok(r.status === 'ok', 'save shift');
ok(g.sheets.Positions._data().length === 3, 'two trail points + header');
ok(g.sheets.Pretrips._data().length === 2, 'pretrip row');
// a second shift while one is open is blocked
r = call(g, { action: 'saveShift', name: 'Sam', passcode: '1111', shift: Object.assign({}, shift, { id: 'S2' }) });
ok(r.status === 'blocked' && r.openShift.id === 'S1', 'second open shift blocked');
// login returns open shift
r = call(g, { action: 'driverLogin', name: 'Sam', passcode: '1111' });
ok(r.openShift && r.openShift.id === 'S1' && r.openShift.pretrip.items, 'open shift returned with pretrip');
// history
r = call(g, { action: 'driverHistory', name: 'Sam', passcode: '1111', days: 15 });
ok(r.status === 'ok' && r.shifts.length === 1, 'history');
// admin track
const from = new Date(t0 - 3600000).toISOString(), to = new Date(Date.now() + 3600000).toISOString();
r = call(g, { action: 'adminTrack', password: 'boss1', driverId: sam.id, from, to });
ok(r.status === 'ok' && r.points.length === 2 && r.points[1].kph === 70 && r.shifts.length === 1 && r.driver.phone, 'admin track');
// admin edit -> driver gets replaced
const edited = JSON.parse(JSON.stringify(shift)); edited.events.push({ id: 'e3', t: new Date(t0 + 7200000).toISOString(), s: 'D', edited: true, editReason: 'office' });
r = call(g, { action: 'adminSaveShift', password: 'boss1', shift: edited, status: 'Open' });
ok(r.status === 'ok' && r.editedAt, 'admin save shift');
r = call(g, { action: 'saveShift', name: 'Sam', passcode: '1111', shift, pts: [{ t: new Date().toISOString(), lat: 1, lon: 2, s: 'ON' }] });
ok(r.status === 'replaced' && r.shift.events.length === 3 && r.shift.adminEditAt, 'driver gets office copy');
ok(g.sheets.Positions._data().length === 4, 'points still saved when replaced');
const sh2 = r.shift; delete sh2._status; delete sh2._submittedAt;
// submit with pdf -> email with attachment
sh2.endOdo = 1200; sh2.remarks = 'none'; sh2.signature = 'data:image/png;base64,AAAA'; sh2.closedAt = new Date().toISOString();
r = call(g, { action: 'submitShift', name: 'Sam', passcode: '1111', shift: sh2, pdfBase64: Buffer.from('%PDF-1.4 test').toString('base64') });
ok(r.status === 'ok' && r.emailed, 'submitted + emailed');
ok(g.mails[0].attachments && g.mails[0].attachments[0].type === 'application/pdf', 'pdf attached');
r = call(g, { action: 'driverLogin', name: 'Sam', passcode: '1111' });
ok(!r.openShift && r.lastClose === sh2.closedAt && String(r.unitOdo.T1) === '1200', 'login after submit: lastClose + unit km');
ok(Array.isArray(r.onBlocks) && r.onBlocks.length >= 1 && r.knownSince, 'on-duty blocks for the 24 h off check');
// admin list / get / delete
r = call(g, { action: 'adminListShifts', password: 'boss1', driverId: sam.id });
ok(r.shifts.length === 1 && r.shifts[0].edited && r.shifts[0].date === '2026-11-25', 'list shifts');
r = call(g, { action: 'adminDeleteShift', password: 'boss1', shiftId: 'S1' });
ok(r.status === 'ok' && g.sheets.Shifts._data().filter(x => x[0]).length === 1 && g.sheets.Pretrips._data().filter(x => x[0]).length === 1, 'delete shift + pretrip');
ok(g.sheets.Positions._data().filter(x => x[0] && x[7] === 'S1').length === 0, 'delete trail');
r = call(g, { action: 'saveShift', name: 'Sam', passcode: '1111', shift: Object.assign({}, shift) });
ok(r.status === 'deleted', 'deleted shift cannot come back from a phone');

// 12-month purge
const old = new Date(Date.now() - 400 * 86400000).toISOString();
const sh3 = { id: 'OLD', date: '2025-10-01', startedAt: old, events: [{ t: old, s: 'ON' }], endOdo: 5, remarks: 'x', signature: 's', closedAt: old };
call(g, { action: 'submitShift', name: 'Sam', passcode: '1111', shift: sh3, pts: [{ t: old, lat: 1, lon: 1, s: 'ON' }] });
// make its submittedAt old
const rows = g.sheets.Shifts._data(); rows.forEach(row => { if (row[0] === 'OLD') row[6] = old; });
g.props.lastPurge = '0';
call(g, { action: 'adminGetConfig', password: 'boss1' });
ok(!g.sheets.Shifts._data().some(x => x[0] === 'OLD'), 'old shift purged');
ok(!g.sheets.Positions._data().some(x => x[0] === old), 'old positions purged');

// v1 sheet upgrade: Drivers tab with 15 columns gets the phone column
const g2 = makeEnv();
g2.reset(); g2.env.tab_('Drivers');
const d1 = g2.sheets.Drivers; d1._data()[0] = d1._data()[0].slice(0, 15);
g2.props.config = JSON.stringify({ rules: { cycleHours: 70, cycleDays: 7, maxDriving: 13, maxWindow: 14, maxElapsed: 16, resetOffHours: 8 } });
g2.reset();
r = call(g2, { action: 'adminSetPassword', newPassword: 'pw12' });
r = call(g2, { action: 'adminGetConfig', password: 'pw12' });
ok(r.status === 'ok' && d1._data()[0][15] === 'phone', 'phone header added to v1 sheet');
ok(r.config.rules.c1.maxOnDuty === 14 && r.config.rules.ab.maxOnDuty === 15 && r.config.rules.ab.maxElapsed === 0, 'old rules replaced by the four choices');

console.log(`server tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
