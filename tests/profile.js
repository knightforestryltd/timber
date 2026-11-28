'use strict';
// Cost of the common requests on a company with ~2 years of data: sheet reads, cells, text read, property reads.
const { build } = require('./bigdata');
const B = build(process.argv[2]), { key, at, tok } = B;
// argv[4] (optional): measure ANOTHER version of the script reading this same data
const R = process.argv[4] ? B.rt.twin(process.argv[4]) : B.rt, rt = { get: R.get, post: R.post, state: B.rt.state };
const S = (svc, b, extra) => R.post(Object.assign({ svc, k: key }, extra || {}), Object.assign({ dev: 'P', adminToken: at }, b));
// the requests
const cases = [
  ['every page open: settings check (unchanged)', () => rt.get({ svc: 'sync', k: key, settings: '1', rev: rt.state.props.companyRev })],
  ['every page open: alerts (menu badges)', () => S('sync', { action: 'alerts' })],
  ['Dispatch open: recent loads', () => rt.get({ svc: 'loads', k: key, recent: '1' })],
  ['Billing open: all loads', () => rt.get({ svc: 'loads', k: key })],
  ['Tickets open', () => rt.get({ svc: 'tickets', k: key })],
  ['Yards open (all)', () => rt.get({ svc: 'yards', k: key, all: '1' })],
  ['Trucks open: listUnits', () => S('trucks', { action: 'listUnits' })],
  ['Statistics: summary', () => S('money', { action: 'summary', from: '2026-01-01', to: '2026-12-31' })],
  ['booking', () => rt.post({ svc: 'loads', k: key }, { customerName: 'New', address: '1 Road, Testville', bookingId: 'NB' + Math.random(), options: [{ location: 'Loc 1', species: 'Birch', tonnes: 20 }] })],
  ['status -> Delivered', () => rt.post({ svc: 'loads', k: key }, { action: 'updateStatus', loadId: 'KF-2950', status: 'Delivered' })],
  ['driver: log in', () => rt.post({ svc: 'drivers' }, { action: 'driverLogin', token: tok, dev: 'P' })],
  ['driver: 5-minute ping', () => rt.post({ svc: 'drivers' }, { action: 'ping', token: tok, pos: { lat: 53.5, lon: -113.5, kph: 80 }, dev: 'P' })],
  ['driver: save shift (heartbeat)', () => rt.post({ svc: 'drivers' }, { action: 'saveShift', token: tok, dev: 'P', shift: { id: 'LIVE', date: '2026-11-28', startedAt: new Date().toISOString(), unit: 'Unit 1', startOdo: 5, events: [], fuel: [] } })],
  ['driver: trips', () => rt.post({ svc: 'drivers' }, { action: 'myTrips', token: tok, dev: 'P' })],
  ['office: list shifts (Drivers admin)', () => S('drivers', { action: 'adminListShifts' })],
  ['office: driver config (Drivers admin)', () => S('drivers', { action: 'adminGetConfig' })],
];
S('trucks', { action: 'listUnits' });  // first-run set-up out of the way
const out = [];
cases.forEach(([name, fn]) => {
  fn();  // warm: first use of a tab, places, etc.
  rt.state.calls = { getValues: 0, setValues: 0, getRange: 0, cells: 0, bytes: 0, props: 0 };
  const t0 = process.hrtime.bigint(); const res = fn(); const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const c = rt.state.calls;
  // rough Apps Script estimate: ~40 ms per sheet read call + ~1 s per 5 MB of text + 5 ms per property read
  const est = Math.round(c.getValues * 40 + c.bytes / 5000 + c.props * 5 + c.setValues * 60);
  out.push({ request: name, status: res.status || (res.rows ? 'rows' : res._meta ? 'settings' : '?'), 'sheet reads': c.getValues, cells: c.cells, 'text read KB': Math.round(c.bytes / 1024), 'prop reads': c.props, writes: c.setValues, 'est. ms': est });
});
console.table(out);
require('fs').writeFileSync(require('path').join(__dirname, 'profile-' + (process.argv[3] || 'run') + '-results.json'), JSON.stringify(out, null, 1));
