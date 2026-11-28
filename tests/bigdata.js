'use strict';
// A company with about two years of data, written straight into the tabs (shaped like real rows).
const { createRuntime } = require('./gasmock');
function build(SCRIPT) {
const rt = createRuntime({ script: SCRIPT });
const r = rt.post({ svc: 'sync' }, { action: 'setPassword', newPassword: 'secret1' }); const key = r.key, at = r.adminToken;
const S = (svc, b, extra) => rt.post(Object.assign({ svc, k: key }, extra || {}), Object.assign({ dev: 'P', adminToken: at }, b));
const locs = []; for (let i = 0; i < 30; i++) locs.push({ id: 'L' + i, name: 'Loc ' + i, address: (53 + i / 100) + ', -113.4', species: [{ name: 'Birch', costPerTonne: 30, pricePerTonne: 60, tonnesPerCord: 1.6 }, { name: 'Spruce', pricePerTonne: 40, tonnesPerCord: 1.5 }] });
S('sync', { action: 'saveSettings', settings: { companyName: 'Big Co', gst: 5, locations: locs, units: [{ id: 'T', name: 'Tandem', hourly: 120, fuel: 45, tonnes: 20, hours: 1 }] } });
S('sync', { action: 'saveProfile', profile: { name: 'Big Co', email: 'o@x.test', logo: 'data:image/jpeg;base64,' + 'A'.repeat(60000) } });
for (let i = 0; i < 6; i++) S('trucks', { action: 'saveUnit', unit: { name: 'Unit ' + i, trackHours: 'yes', currentOdo: 100000, currentHours: 1000 } });
for (let i = 0; i < 8; i++) S('drivers', { action: 'adminSaveDriver', driver: { name: 'Driver ' + i, passcode: '1234' } });
// bulk data written straight into the tabs (fast), shaped like real rows
const now = Date.now(), DAY = 86400000, sh = n => rt.sheet(n) || (rt.call('tab_', n), rt.sheet(n));
const drv = rt.call('rows_', 'Drivers');
const bigJson = JSON.stringify({ events: Array.from({ length: 60 }, (_, k) => ({ t: new Date(now - k * 600000).toISOString(), s: k % 2 ? 'D' : 'ON', place: 'Somewhere, AB', lat: 53.5, lon: -113.5 })), fuel: [{ litres: 200, cost: 300 }], trips: [{ loadId: 'X', stages: [] }], days: [{ date: '2026-11-01', onDuty: 10, driving: 7 }] });
const shifts = []; for (let i = 0; i < 3000; i++) { const d = drv[i % 8], t = now - (3000 - i) * 6 * 3600000; shifts.push({ shiftId: 'S' + i, driverId: d.id, driverName: d.name, date: new Date(t).toISOString().slice(0, 10), unit: 'Unit ' + (i % 6), startedAt: new Date(t).toISOString(), submittedAt: new Date(t + 10 * 3600000).toISOString(), status: 'Submitted', startOdo: 1000 + i, endOdo: 1200 + i, onDutyHrs: 10, drivingHrs: 7, remarks: 'ok', json: '{"closedAt":"' + new Date(t + 9.5 * 3600000).toISOString() + '",' + bigJson.slice(1), signature: 'data:image/png;base64,' + 'B'.repeat(8000), editedAt: '', shiftType: '', startHours: '', endHours: '', unitId: '' }); }
rt.call('appendMany_', 'Shifts', shifts);
const L = sh('Loads'); const lrows = []; for (let i = 0; i < 3000; i++) { const row = Array(38).fill(''); Object.assign(row, { 0: new Date(now - (3000 - i) * 5 * 3600000).toISOString(), 1: 'Cust ' + i, 3: (i % 200) + ' Road, Testville', 4: 'Loc ' + (i % 30), 5: 'Birch', 6: 'Tandem', 7: 20, 14: 1600, 15: i < 2900 ? 'Paid' : 'Pending', 16: 'KF-' + i, 17: 19.5, 18: i < 2900 ? JSON.stringify({ paidAt: now - 40 * DAY, model: { total: 1600, lines: Array(5).fill({ d: 'line', a: 100 }) } }) : '', 24: 'B' + i + '-1' }); lrows.push(row); }
rt.call('ensureRows_', L, 5 + 3000); L.getRange(5, 1, 3000, 38).setValues(lrows);
const places = []; for (let i = 0; i < 200; i++) places.push({ address: i + ' Road, Testville', place: 'Testville', lat: 53.5, lon: -113.5, at: '' }); rt.call('appendMany_', 'Places', places);
const logs = []; for (let i = 0; i < 5000; i++) logs.push({ at: new Date(now - i * 60000).toISOString(), svc: 'loads', action: 'status Delivered', ref: 'KF-' + i, detail: '{}' }); rt.call('appendMany_', 'Log', logs);
const T = sh('Tickets'); const trows = []; for (let i = 0; i < 3000; i++) trows.push(['T' + i, 'Birch', 'Cust', 'Loc', 14000, 44000, 30000, 25, 40, new Date().toISOString(), '']); rt.call('ensureRows_', T, 3001); T.getRange(2, 1, 3000, 11).setValues(trows);
const yr = []; for (let i = 0; i < 2000; i++) yr.push({ id: 'Y' + i, yard: 'Loc ' + (i % 3), species: 'Birch', tonnes: 5, woodPrice: 20 }); rt.call('yardAppend_', yr.map((d, i) => ({ timestamp: new Date(now - i * 1000).toISOString(), yard: d.yard, species: d.species, type: 'In', tonnes: 5, pricePerTonne: 20, product: 'Logs', status: 'Confirmed', entryId: d.id })));
const ex = []; for (let i = 0; i < 4000; i++) ex.push({ id: 'E' + i, at: new Date().toISOString(), date: '2026-10-01', amount: 10, gst: 0.5, total: 10.5, category: 'Fuel', source: 'manual' }); rt.call('appendMany_', 'Expenses', ex);
  // edge cases: a driver with nothing in 6 weeks, an open shift, an office-edited shift, a shift whose pre-trip lives only in Pretrips
  const old = rt.call('rows_', 'Drivers')[7], openD = rt.call('rows_', 'Drivers')[2];
  rt.call('keepRows_', 'Shifts', s => !(String(s.driverId) === String(old.id) && Date.parse(s.startedAt) > now - 60 * DAY));
  rt.call('appendMany_', 'Shifts', [{ shiftId: 'OPEN1', driverId: openD.id, driverName: openD.name, date: '2026-11-28', unit: 'Unit 2', startedAt: new Date(now - 3600000).toISOString(), status: 'Open', startOdo: 5, endOdo: '', json: JSON.stringify({ id: 'OPEN1', events: [{ t: new Date(now - 3600000).toISOString(), s: 'ON' }] }), signature: '', shiftType: '' },
    { shiftId: 'EDIT1', driverId: openD.id, driverName: openD.name, date: '2026-11-20', unit: 'Unit 2', startedAt: new Date(now - 8 * DAY).toISOString(), submittedAt: new Date(now - 8 * DAY + 36e6).toISOString(), editedAt: new Date(now - DAY).toISOString(), status: 'Submitted', endOdo: 9999, json: JSON.stringify({ id: 'EDIT1', closedAt: new Date(now - 8 * DAY + 35e6).toISOString(), adminEditAt: 'x', events: [{ t: new Date(now - 8 * DAY).toISOString(), s: 'D' }], days: [{ date: new Date(now - 8 * DAY).toISOString().slice(0, 10), onDuty: 9, driving: 6 }] }), signature: 'SIG', shiftType: '' },
    { shiftId: 'YARD1', driverId: openD.id, driverName: openD.name, date: '2026-11-28', startedAt: new Date(now - 7200000).toISOString(), status: 'Open', json: JSON.stringify({ id: 'YARD1', type: 'yard' }), shiftType: 'yard' }]);
  rt.call('appendMany_', 'Pretrips', [{ shiftId: 'EDIT1', driverName: openD.name, unit: 'Unit 2', at: new Date(now - 8 * DAY).toISOString(), result: 'OK', json: JSON.stringify({ done: true, items: [{ t: 'Brakes', a: 'ok' }] }), signature: 'PSIG' }]);
  const tok = rt.post({ svc: 'drivers' }, { action: 'driverLogin', name: 'Driver 1', passcode: '1234', dev: 'P' }).token;
  return { rt, key, at, S, tok, now, DAY, oldDriver: old, openDriver: openD };
}
module.exports = { build };
