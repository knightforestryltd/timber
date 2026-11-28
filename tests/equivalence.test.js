'use strict';
// SAFETY: the v14.4 speed changes only change HOW data is read. Old and new script read the SAME sheet here,
// and every answer must be identical. Usage: node equivalence.test.js <new.gs> <old.gs>
const { build } = require('./bigdata');
const { group, check, summary } = require('./harness');
const B = build(process.argv[2]), NEW = B.rt, OLD = B.rt.twin(process.argv[3]), { key, at } = B;
const drivers = NEW.call('rows_', 'Drivers');
const toks = {}; drivers.forEach(d => { toks[d.name] = NEW.post({ svc: 'drivers' }, { action: 'driverLogin', name: d.name, passcode: '1234', dev: 'EQ' }).token; });
const strip = o => JSON.parse(JSON.stringify(o, (k, v) => (k === 'at' && typeof v === 'string' && /^\d{4}-/.test(v) ? '<now>' : v)));
function same(name, q, body) {
  const state = () => ({ props: JSON.stringify(NEW.state.props), tabs: NEW.ss().getSheets().map(s => s.getName() + ':' + s.getLastRow() + ':' + JSON.stringify(s._cells).length) });
  const s0 = state(); const a = strip(OLD.post(q, body)); const s1 = state(); const b = strip(NEW.post(q, body)); const s2 = state();
  const diff = (x, y) => { const d = []; Object.keys(JSON.parse(y.props)).forEach(k => { if (JSON.parse(x.props)[k] !== JSON.parse(y.props)[k]) d.push('property ' + k); }); y.tabs.forEach(t => { if (!x.tabs.includes(t)) d.push('tab ' + t); }); return d; };
  const oldChanged = diff(s0, s1); if (oldChanged.length) console.log('   (v14.3 itself changed, on ' + name + ': ' + oldChanged.join(', ') + ')');
  const snap = JSON.stringify(s1), after = JSON.stringify(s2);
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  let where = ''; if (sa !== sb) { let i = 0; while (sa[i] === sb[i]) i++; where = ' first difference at char ' + i + ': old ' + sa.slice(Math.max(0, i - 60), i + 60) + ' || new ' + sb.slice(Math.max(0, i - 60), i + 60); }
  check(sa === sb, name + ' (' + Math.round(sa.length / 1024) + ' KB answer)', where);
  check(snap === after, name + ': v14.4 changes nothing more than v14.3 did', diff(s1, s2).join(', '));
}
group('Old and new script give identical answers on two years of data', () => {
  const A = { adminToken: at, dev: 'EQ' };
  same('menu badges (alerts)', { svc: 'sync', k: key }, Object.assign({ action: 'alerts' }, A));
  same('Statistics summary, full range', { svc: 'money', k: key }, Object.assign({ action: 'summary' }, A));
  same('Statistics summary, one month', { svc: 'money', k: key }, Object.assign({ action: 'summary', from: '2026-10-01', to: '2026-10-31' }, A));
  same('Drivers admin: all shifts', { svc: 'drivers' }, Object.assign({ action: 'adminListShifts' }, A));
  same('Drivers admin: one driver, 300', { svc: 'drivers' }, Object.assign({ action: 'adminListShifts', driverId: B.openDriver.id, limit: 300 }, A));
  same('Drivers admin: open one shift', { svc: 'drivers' }, Object.assign({ action: 'adminGetShift', shiftId: 'EDIT1' }, A));
  same('Drivers admin: map / track', { svc: 'drivers' }, Object.assign({ action: 'adminTrack', driverId: B.openDriver.id, from: new Date(B.now - 10 * B.DAY).toISOString(), to: new Date(B.now).toISOString() }, A));
  Object.keys(toks).forEach(n => same('driver log in: ' + n, { svc: 'drivers' }, { action: 'driverLogin', token: toks[n], dev: 'EQ' }));
  Object.keys(toks).forEach(n => same('driver history: ' + n, { svc: 'drivers' }, { action: 'driverHistory', token: toks[n], dev: 'EQ', days: 31 }));
  same('loads', { svc: 'loads', k: key }, { action: 'x' });
});
const out = summary('EQUIVALENCE (v14.4 reads vs v14.3 reads)'); console.log(out.text); process.exitCode = out.fail ? 1 : 0;
