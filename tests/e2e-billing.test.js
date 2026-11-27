const { start, BASE } = require('./e2e');
const fs = require('fs'), { execSync } = require('child_process');
(async () => {
  const h = await start({ log: !!process.env.LOG });
  const env = h.env; let n = 0, bad = 0; const t = (c, m) => { n++; if (!c) bad++; console.log((c ? 'ok   ' : 'FAIL ') + m); };
  let r = env.post('sync', { action: 'setPassword', newPassword: 'secret1', deviceName: 'Owner' }); const KEY = r.key, TOK = r.adminToken;
  const settings = { locations: [{ id: 1, name: 'Sundre', address: 'Sundre, AB', species: [{ name: 'Birch', pricePerTonne: 60, costPerTonne: 50, tonnesPerCord: 1.8 }] }],
    units: [{ id: 7, name: 'Super B', hourly: 185, costHourly: 150, fuel: 50, tonnes: 30, hours: 1.5, aliases: ['Old Super B'] }], fuelPrice: 1.2, gst: 5, speed: 90, sheetsUrl: BASE + '?svc=loads&k=' + KEY };
  env.post('sync', { action: 'saveSettings', adminToken: TOK, settings, force: true });
  // v13-style load (no new columns) and a v14 load with a price adjustment, both Delivered
  env.post('loads', { customerName: 'Old Customer', timestamp: '2026-11-20T10:00:00Z', address: 'A1', options: [{ location: 'Sundre', species: 'Birch', truck: 'Super B', tonnes: 30, cords: 16, km: 100, totalHours: 5.5, total: 2900 }] }, { k: KEY });
  env.post('loads', { customerName: 'Renamed Unit Customer', timestamp: '2026-11-19T10:00:00Z', address: 'A3', options: [{ location: 'Sundre', species: 'Birch', truck: 'Old Super B', tonnes: 30, cords: 16, km: 100, totalHours: 5.5, total: 2900 }] }, { k: KEY });
  env.post('loads', { action: 'updateStatus', customerName: 'Renamed Unit Customer', timestamp: '2026-11-19T10:00:00Z', loadId: 'KF-REN-1', status: 'Delivered', netTonnes: 29.5 }, { k: KEY });
  env.post('loads', { action: 'updateStatus', customerName: 'Old Customer', timestamp: '2026-11-20T10:00:00Z', loadId: 'KF-OLD-1', status: 'Delivered', netTonnes: 29.5 }, { k: KEY });
  env.post('loads', { bookingId: 'Badj', customerName: 'Deal Customer', timestamp: '2026-11-21T10:00:00Z', address: 'A2', options: [{ location: 'Sundre', species: 'Birch', truck: 'Super B', tonnes: 30, cords: 16, km: 100, totalHours: 5.5, total: 2800, quotedTotal: 2900, priceAdj: -95.24, adjReason: 'Deal', billedHours: 4.99 }] }, { k: KEY });
  env.post('loads', { action: 'updateStatus', bookingId: 'Badj-1', customerName: 'Deal Customer', timestamp: '2026-11-21T10:00:00Z', loadId: 'KF-ADJ-1', status: 'Delivered', netTonnes: 30 }, { k: KEY });
  const ls = { kfCompanyUrl: BASE, kfKey: KEY, kfAdminToken: TOK, kfServerV: '14', knightForestrySettings_v3: Object.assign({ syncUrl: BASE + '?svc=sync&k=' + KEY }, settings), kfCompany: { name: 'Knight Forestry' } };
  // ---- same old load: v13 page vs v14 page give the same invoice total ----
  execSync('git -C /home/user/timber show 4be9795:invoices.html > /home/user/timber/__v13_invoices.html');
  const totalOn = async (page, who) => { const pg = await h.open(page, ls); await pg.click('text=Pending Invoices'); await pg.waitForTimeout(800); await pg.click('text=' + who); await pg.waitForTimeout(300); const v = await pg.textContent('#invTotal'); const lines = await pg.textContent('#invLines'); await pg.close(); return { v, lines }; };
  const a = await totalOn('__v13_invoices.html', 'Old Customer'), b = await totalOn('invoices.html', 'Old Customer');
  t(a.v === b.v && +a.v > 0, 'existing load invoices the same in v13 and v14: $' + a.v + ' / $' + b.v);
  fs.unlinkSync('/home/user/timber/__v13_invoices.html');
  const rn = await totalOn('invoices.html', 'Renamed Unit Customer');
  t(rn.v === b.v, 'a load booked under the unit\'s OLD name still finds its rates (alias): $' + rn.v);
  // ---- adjusted load: billed hours folded into trucking, no adjustment line ----
  const c = await totalOn('invoices.html', 'Deal Customer');
  t(/4\.99 h @ \$185\.00/.test(c.lines) && !/adjust|deal/i.test(c.lines), 'trucking line uses 4.99 billed hours; no adjustment line or reason: ' + c.lines.slice(0, 160));
  // ---- complete the adjusted load, record a part payment, check Owing ----
  let pg = await h.open('invoices.html', ls);
  await pg.click('text=Pending Invoices'); await pg.waitForTimeout(800); await pg.click('text=Deal Customer'); await pg.waitForTimeout(300);
  const total = +(await pg.textContent('#invTotal'));
  await pg.click('text=Complete Load'); await pg.waitForTimeout(1200);
  const row = env.ctx.loadRows_().find(x => x.loadId === 'KF-ADJ-1'), inv = JSON.parse(row.invoiceData);
  t(row.status === 'Paid' && inv.model.product > 0 && inv.model.trucking > 0 && inv.model.fsc > 0 && Math.abs(inv.model.product + inv.model.trucking + inv.model.fsc - inv.model.sub) < 0.011, 'Invoice Data keeps product / trucking / FSC (add up to the subtotal)');
  // invoices made before go-live count as paid; push goLive back so this one is "new"
  env.props.goLive = '2026-01-01T00:00:00Z';
  await pg.goto('file:///home/user/timber/invoices.html'); await pg.waitForTimeout(1200);
  await pg.click('#owingBtn'); await pg.waitForTimeout(1200);
  t((await pg.textContent('#owingList')).includes('Deal Customer'), 'Owing lists the unpaid invoice');
  await pg.click('#owingList [data-k]'); await pg.fill('#rpA', '1000'); await pg.click('#rpGo'); await pg.waitForTimeout(1500);
  t(env.ctx.rows_('Payments').length === 1 && Number(env.ctx.rows_('Payments')[0].amount) === 1000, 'part payment saved');
  const ow = await pg.textContent('#owingList');
  t(ow.includes('Part paid') && ow.includes((total - 1000).toFixed(2)), 'Owing shows Part paid and the rest owing');
  t(env.ctx.loadRows_().find(x => x.loadId === 'KF-ADJ-1').status === 'Paid', 'Status column untouched by payments (still the existing value)');
  await pg.click('#owingList [data-k]'); await pg.click('#rpGo'); await pg.waitForTimeout(1500);
  t(!(await pg.textContent('#owingList')).includes('Deal Customer'), 'fully paid: gone from Owing');
  t(h.errs.length === 0, 'no page errors' + (h.errs.length ? ': ' + h.errs.join(' | ') : ''));
  console.log(n + ' checks, ' + bad + ' failed'); await h.browser.close(); process.exitCode = bad ? 1 : 0;
})();
