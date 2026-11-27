const { makeEnv } = require('./gasmock');
const env = makeEnv(), A = require('assert');
let n = 0; const t = (c, m) => { n++; if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
// ----- v13-shaped data first (as the live sheet has it) -----
const ss = env.ss;
const L = ss.insertSheet('Loads'); L.data[0] = ['Trip Log']; L.data[3] = env.ctx.LOAD_HEADERS.slice();
L.data[4] = ['2026-11-01T10:00:00Z', 'Old Cust', '403', 'Addr 1', 'Sundre', 'Birch', 'Super B', 30, 16, 100, '2h', 4, 5.5, 50, 2100, 'Delivered', 'KF-2026-1101-01', 29.5, '', 'note'];
const Y = ss.insertSheet('Yards'); Y.data[0] = env.ctx.YARD_HEADERS.slice(); Y.data[1] = ['2026-10-01T00:00:00Z', 'North Yard', 'Birch', 'In', 20, '', 100, '', '', '', 'Sundre', ''];
const D = ss.insertSheet('Drivers'); D.data[0] = env.ctx.TABS.Drivers.slice(0, 16);
const S = ss.insertSheet('Shifts'); S.data[0] = env.ctx.TABS.Shifts.slice(0, 16);
env.props.drvConfig = JSON.stringify({ units: [{ id: 'u1', name: 'Truck 1', plate: 'ABC', trailerA: '', trailerB: '' }] });

// ----- company password + admin token -----
let r = env.post('sync', { action: 'setPassword', newPassword: 'secret1', deviceName: 'Owner' });
t(r.status === 'ok' && r.adminToken && r.key, 'setPassword returns key + admin token');
const KEY = r.key, TOK = r.adminToken;
r = env.post('sync', { action: 'makeAdmin', password: 'wrong', deviceName: 'X' }); t(r.status === 'badpassword', 'makeAdmin wrong password refused');
r = env.post('sync', { action: 'makeAdmin', password: 'secret1', deviceName: 'Office tablet' }); t(r.status === 'ok' && r.adminToken, 'makeAdmin ok');
const TOK2 = r.adminToken;
r = env.post('sync', { action: 'listAdmins', adminToken: TOK }); t(r.devices.length === 2 && r.devices.some(d => d.me), 'listAdmins shows 2 devices');
t(!JSON.stringify(env.ss.sheets.Log.data).includes(TOK), 'token never written to the Log');
// ----- settings merge guard -----
r = env.post('sync', { action: 'saveSettings', adminToken: TOK, settings: { locations: [{ id: 1, name: 'Sundre', species: [{ name: 'Birch', pricePerTonne: 50, splitPricePerCord: 300 }] }], units: [{ id: 9, name: 'Super B', hourly: 200, aliases: ['Old B'] }], money: { employerCostPct: 15 }, homeBase: 'Yard', yardPassword: 'knight' }, force: true });
t(r.status === 'saved', 'saveSettings with admin token');
// an OLD cached Quote page saves (no money/homeBase/aliases/split price) with the password
r = env.post('sync', { action: 'saveSettings', password: 'secret1', settings: { locations: [{ id: 1, name: 'Sundre', species: [{ name: 'Birch', pricePerTonne: 55 }] }], units: [{ id: 9, name: 'Super B', hourly: 210 }] }, force: true });
let st = env.ctx.readSettings_();
t(st.money && st.money.employerCostPct === 15 && st.homeBase === 'Yard', 'old page save keeps money + homeBase');
t(st.units[0].aliases[0] === 'Old B' && st.units[0].hourly === 210, 'unit aliases kept, new hourly applied');
t(st.locations[0].species[0].splitPricePerCord === 300 && st.locations[0].species[0].pricePerTonne === 55, 'split price kept, new price applied');
t(!('yardPassword' in st), 'yardPassword removed');
// ----- revoke a device -----
r = env.post('sync', { action: 'listAdmins', adminToken: TOK }); const other = r.devices.find(d => !d.me);
env.post('sync', { action: 'removeAdmin', adminToken: TOK, id: other.id });
r = env.post('sync', { action: 'saveDispatch', adminToken: TOK2, dispatch: { texts: true } }); t(r.status === 'noadmin', 'removed device gets noadmin');
// ----- loads: old rows read the same; new booking; idempotent; editLoad -----
r = env.get({ svc: 'loads', k: KEY }); t(r.rows.length === 1 && r.rows[0].total === 2100 && r.rows[0].netTonnes === 29.5, 'old load reads the same');
const booking = { bookingId: 'Babc', customerName: 'New Cust', address: 'A2', timestamp: '2026-11-20T10:00:00Z', notes: 'gate 12', options: [{ location: 'North Yard', species: 'Birch', truck: 'Super B', tonnes: 16, cords: 9, total: 1800, km: 80, totalHours: 5, quotedTotal: 1900, priceAdj: -95.24, adjReason: 'Deal', billedHours: 4.52, product: 'Logs', bookingData: { estProfit: 300 }, legs: { emptyOutKm: 10 } }] };
r = env.post('loads', booking, { k: KEY }); t(r.status === 'ok' && !r.duplicate, 'booking saved');
r = env.post('loads', booking, { k: KEY }); t(r.duplicate === true, 'resent booking not added twice');
// an OLD page booking (no bookingId) still works and writes 20 cols + blanks
r = env.post('loads', { customerName: 'Old Page', options: [{ location: 'Sundre', species: 'Birch', truck: 'Super B', total: 1 }] }, { k: KEY }); t(r.status === 'ok', 'old page booking ok');
r = env.get({ svc: 'loads', k: KEY }); const nb = r.rows.find(x => x.customerName === 'New Cust');
t(r.rows.length === 3 && nb.billedHours === 4.52 && nb.adjReason === 'Deal' && nb.bookingId === 'Babc-1' && nb.total === 1800 && nb.emptyOutKm === 10, 'new columns read back');
t(L.data[3][20] === 'Quoted Total' && L.data[3][36] === 'Empty Fuel L' && L.data[3][19] === 'Notes', 'Loads header extended on the right only');
r = env.post('loads', { action: 'editLoad', adminToken: TOK, find: { bookingId: 'Babc-1' }, changes: { totalHours: 6, billedHours: 5.52, requestedDate: '2026-11-28', status: 'Bogus' } }, { k: KEY }); t(r.status === 'error', 'bad status refused');
r = env.post('loads', { action: 'editLoad', adminToken: TOK, find: { bookingId: 'Babc-1' }, changes: { totalHours: 6, billedHours: 5.52, requestedDate: '2026-11-28' } }, { k: KEY }); t(r.status === 'ok' && r.changed === 3, 'editLoad writes 3 changed fields');
r = env.post('loads', { action: 'editLoad', find: { bookingId: 'Babc-1' }, changes: { total: 1 } }, { k: KEY }); t(r.status === 'badpassword', 'editLoad needs admin');
const lg = env.ss.sheets.Log.data.find(x => x && x[2] === 'load edited'); t(lg && /"before"/.test(lg[4]) && /Owner/.test(lg[4]), 'Log has before/after and who');
// updateStatus by old dispatch path (customer + timestamp) still finds the row; Delivered from a yard writes an Out row
r = env.post('loads', { action: 'updateStatus', customerName: 'New Cust', timestamp: '2026-11-20T10:00:00Z', location: 'North Yard', species: 'Birch', truck: 'Super B', loadId: 'KF-1', status: 'Started', netTonnes: 15 }, { k: KEY });
t(r.status === 'ok', 'updateStatus Started (old way)');
r = env.post('loads', { action: 'updateStatus', loadId: 'KF-1', status: 'Delivered', netTonnes: 15 }, { k: KEY });
let yr = env.ctx.yardRowsAll_(); const out = yr.filter(x => x.type === 'Out' && x.loadId === 'KF-1');
t(out.length === 1 && out[0].tonnes === 15 && out[0].costPerTonne === 100, 'delivery wrote one Out row at avg cost (15 t @ 100)');
env.post('loads', { action: 'updateStatus', loadId: 'KF-1', status: 'Delivered' }, { k: KEY });
t(env.ctx.yardRowsAll_().filter(x => x.type === 'Out' && x.loadId === 'KF-1' && x.status !== 'Void').length === 1, 'Delivered twice = still one Out row');
env.post('loads', { action: 'editLoad', adminToken: TOK, find: { loadId: 'KF-1' }, changes: { status: 'Started' } }, { k: KEY });
t(env.ctx.yardRowsAll_().filter(x => x.loadId === 'KF-1' && x.status === 'Void').length === 1, 'back to Started voids the Out row');
r = env.get({ svc: 'yards', k: KEY }); t(r.rows.length === 2 && r.rows[1].tonnes === 0 && r.rows[0].tonnes === 20, 'old Inventory read: void row shows 0 t');
// ----- drivers: passcode -> token, old page passcode still works -----
r = env.post('drivers', { action: 'adminSaveDriver', adminToken: TOK, driver: { name: 'Bob', passcode: '1111', roles: ['driver', 'mechanic'] } });
t(r.status === 'ok', 'driver added');
r = env.post('drivers', { action: 'driverLogin', name: 'Bob', passcode: '1111' });
t(r.status === 'ok' && r.token && r.roles.includes('mechanic') && r.units.length >= 1 && r.units[0].name === 'Truck 1', 'login returns token, roles, units from Units tab');
const PT = r.token;
const shift = { id: 'S1', date: '2026-11-26', startedAt: '2026-11-26T13:00:00Z', unit: 'Truck 1', startOdo: 5000, startHours: 300, events: [{ t: '2026-11-26T13:00:00Z', s: 'OFF' }], trips: [], fuel: [{ id: 'f1', litres: 200, cost: 300, gst: 15, pay: 'card', at: '2026-11-26T15:00:00Z' }], edits: [],
  pretrip: { done: true, at: '2026-11-26T13:30:00Z', defects: true, defectList: ['Horn'], defectItems: [{ item: 'Horn', severity: 'major', note: 'dead' }], items: {} } };
r = env.post('drivers', { action: 'saveShift', token: PT, shift }); t(r.status === 'ok', 'saveShift with token');
r = env.post('drivers', { action: 'saveShift', token: PT, shift }); t(r.status === 'ok', 'saveShift again (heartbeat)');
let wos = env.ctx.rows_('WorkOrders'); t(wos.length === 1 && wos[0].severity === 'major' && wos[0].source === 'pretrip', 'one WO from the major pre-trip defect');
let u1 = env.ctx.rows_('Units').find(u => u.name === 'Truck 1'); t(u1.status === 'Out of service' && Number(u1.currentOdo) === 5000 && Number(u1.currentHours) === 300, 'unit OOS + readings');
let fx = env.ctx.rows_('Expenses').filter(x => x.source === 'fuel'); t(fx.length === 1 && Number(fx[0].amount) === 300 && Number(fx[0].gst) === 15, 'fuel -> one Expenses row');
// old cached drivers page: passcode, no new fields
r = env.post('drivers', { action: 'saveShift', name: 'Bob', passcode: '1111', shift: Object.assign({}, shift, { id: 'S1', fuel: [] }) }); t(r.status === 'ok', 'old page (passcode) still saves');
fx = env.ctx.rows_('Expenses').filter(x => x.source === 'fuel'); t(Number(fx[0].amount) === 0, 'fuel removed on phone -> expense zeroed, not deleted');
r = env.post('drivers', { action: 'submitShift', token: PT, shift: Object.assign({}, shift, { endOdo: 5200, endHours: 310, remarks: 'none', signature: 'data:x', closedAt: '2026-11-26T23:00:00Z' }) }); t(r.status === 'ok' && r.submitted, 'submit');
// yard shift does not block / count
r = env.post('drivers', { action: 'saveShift', token: PT, shift: { id: 'Y1', type: 'yard', yard: 'North Yard', date: '2026-11-27', startedAt: '2026-11-27T13:00:00Z', events: [], trips: [], fuel: [], edits: [] } }); t(r.status === 'ok', 'yard shift saved');
r = env.post('drivers', { action: 'saveShift', token: PT, shift: { id: 'S2', date: '2026-11-27', startedAt: '2026-11-27T14:00:00Z', unit: 'Truck 1', startOdo: 5200, events: [], trips: [], fuel: [], edits: [] } }); t(r.status === 'ok', 'driving shift alongside an open yard shift');
r = env.post('drivers', { action: 'driverLogin', token: PT }); t(r.openShift && r.openShift.id === 'S2' && r.openYardShift && r.openYardShift.id === 'Y1', 'login returns both open shifts separately');
t(r.unitOdo['Truck 1'] === 5200, 'unitOdo from the driving shift');
// passcode change ends the token
env.post('drivers', { action: 'adminSaveDriver', adminToken: TOK, driver: { id: D.data[1][0], name: 'Bob', passcode: '2222' } });
r = env.post('drivers', { action: 'driverLogin', token: PT }); t(r.status === 'badpassword', 'old token rejected after passcode change');
// ----- trucks: mechanic closes the WO; one expense; back in service -----
r = env.post('drivers', { action: 'driverLogin', name: 'Bob', passcode: '2222' }); const PT2 = r.token;
r = env.post('trucks', { action: 'listWorkOrders', token: PT2, status: 'open' }); t(r.workOrders.length === 1 && !('laborCost' in r.workOrders[0]), 'mechanic sees WO without $');
const woId = r.workOrders[0].id;
env.post('trucks', { action: 'addPart', token: PT2, woId, part: { id: 'p1', part: 'Horn', qty: 1, unitCost: 45 } });
env.post('trucks', { action: 'addPart', token: PT2, woId, part: { id: 'p1', part: 'Horn', qty: 1, unitCost: 45 } });
env.post('money', { action: 'savePeople', adminToken: TOK, people: [{ id: D.data[1][0], name: 'Bob', role: 'mechanic', hourlyRate: 40, roles: ['driver', 'mechanic'], rates: { mechanic: 40, driver: 30 } }] });
r = env.post('trucks', { action: 'closeWorkOrder', token: PT2, woId, mechanicName: 'Bob', mechHours: 2.5, mechRate: 999, backInService: true });
t(r.status === 'ok' && r.openMajorLeft === 0, 'mechanic closes WO');
const woRow = env.ctx.rows_('WorkOrders')[0];  t(Number(woRow.mechRate) === 40 && Number(woRow.laborCost) === 115 && Number(woRow.total) === 160, 'rate from People (not the 999 typed), labour 2.5x40x1.15=115 (employer cost set to 15 above), total 160');
t(env.ctx.rows_('Expenses').filter(x => x.source === 'workorder').length === 1, 'one workorder expense');
t(env.ctx.rows_('Units').find(u => u.name === 'Truck 1').status === 'In service', 'unit back in service');
// ----- money: payments idempotent, summary -----
r = env.post('money', { action: 'savePayment', adminToken: TOK, payment: { id: 'pay1', loadId: 'KF-2026-1101-01', amount: 1000, method: 'cheque' } });
r = env.post('money', { action: 'savePayment', adminToken: TOK, payment: { id: 'pay1', loadId: 'KF-2026-1101-01', amount: 1000, method: 'cheque' } }); t(r.duplicate, 'payment resend not duplicated');
r = env.post('money', { action: 'summary', token: PT2 }); t(r.status === 'badpassword', 'summary refused to a person');
r = env.post('money', { action: 'summary', adminToken: TOK, from: '2026-11-01', to: '2026-11-30' }); t(r.status === 'ok' && r.shifts.length >= 2 && r.loads.length === 3 && !r.shifts[0].events, 'summary ok, compact shifts');
r = env.post('sync', { action: 'alerts', adminToken: TOK }); t(r.status === 'ok' && r.pages.drivers && r.pages.drivers.red >= 1, 'alerts: unseen defect on Drivers');
// ----- inspection -----
r = env.post('trucks', { action: 'listTemplates', token: PT2, unitId: u1.id }); const tpl = r.templates.find(x => x.id === 'T-PMB');
t(tpl.groups.length === 13 && tpl.groups[0].s.startsWith('A.'), 'PM-B includes PM-A groups (crane section hidden): ' + tpl.groups.length);
const items = []; tpl.groups.forEach(g => g.items.forEach(it => items.push({ t: it.t, a: 'ok' }))); items[3].a = 'defect'; items[3].sev = 'minor';
r = env.post('trucks', { action: 'saveInspection', token: PT2, inspection: { id: 'I1', unitId: u1.id, template: 'T-PMB', odo: 5300, hours: 320, items, signature: 'data:image/png;base64,AAAA' } });
t(r.status === 'ok' && r.workOrders.length === 1, 'inspection saved, defect -> WO');
r = env.post('trucks', { action: 'saveInspection', token: PT2, inspection: { id: 'I1', unitId: u1.id, template: 'T-PMB', items } }); t(r.duplicate, 'inspection resend ignored');
// ----- structure check -----
const res = env.ctx.testAll_(); t(/All checks passed/.test(res[0]), 'testAll_: ' + res[0]);
const res2 = env.ctx.testTrucksMoney_(); t(!res2.some(x => /^FAIL/.test(x)), 'testTrucksMoney_ all OK (' + res2.filter(x => /^OK/.test(x)).length + ' checks)');
res2.filter(x => /^FAIL/.test(x)).forEach(x => console.log('   ', x));
// ----- nightly -----
env.ctx.nightly = env.ctx.nightly; try { env.ctx.purgeOld_(); env.ctx.postRecurring_(); t(true, 'purge + recurring run'); } catch (e) { t(false, 'nightly parts: ' + e); }
console.log(n + ' checks');
