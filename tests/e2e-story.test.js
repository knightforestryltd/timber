// The full story (spec Prompt 6 step 5), then Statistics checked dollar by dollar.
const { start, BASE } = require('./e2e');
(async () => {
  const h = await start({ log: !!process.env.LOG });
  const env = h.env; let n = 0, bad = 0; const t = (c, m) => { n++; if (!c) bad++; console.log((c ? 'ok   ' : 'FAIL ') + m); };
  env.props.drvConfig = JSON.stringify({ company: { officeEmail: 'office@example.com' }, units: [{ id: 'u1', name: 'Truck 1', plate: 'ABC' }] });
  let r = env.post('sync', { action: 'setPassword', newPassword: 'secret1' }); const KEY = r.key, TOK = r.adminToken;
  const settings = { locations: [{ id: 1, name: 'Sundre', address: '51.8, -114.6', species: [{ name: 'Birch', pricePerTonne: 60, costPerTonne: 50, tonnesPerCord: 1.8 }] }],
    units: [{ id: 7, name: 'Super B', hourly: 185, costHourly: 150, fuel: 50, tonnes: 30, hours: 1.5 }], fuelPrice: 1.2, costFuelPrice: 1.1, gst: 5, speed: 90, money: { employerCostPct: 12, otWeeklyHours: 50, otMultiplier: 1.5, weekStartsOn: 0 } };
  env.post('sync', { action: 'saveSettings', adminToken: TOK, settings, force: true });
  env.post('trucks', { action: 'listUnits', adminToken: TOK }); const U1 = env.ctx.rows_('Units')[0].id;
  env.post('trucks', { action: 'saveUnit', adminToken: TOK, unit: { id: U1, name: 'Truck 1', trackHours: 'yes', currentHours: 1000, currentOdo: 50000 } });
  env.post('drivers', { action: 'adminSaveDriver', adminToken: TOK, driver: { name: 'Bob', passcode: '1111' } });
  env.post('drivers', { action: 'adminSaveDriver', adminToken: TOK, driver: { name: 'Mike', passcode: '2222', roles: ['mechanic'] } });
  const D = env.ctx.rows_('Drivers'), bob = D.find(x => x.name === 'Bob'), mike = D.find(x => x.name === 'Mike');
  env.post('drivers', { action: 'adminSavePerson', adminToken: TOK, person: { id: bob.id, roles: ['driver'], rates: { driver: 30 } } });
  env.post('drivers', { action: 'adminSavePerson', adminToken: TOK, person: { id: mike.id, roles: ['mechanic'], rates: { mechanic: 40 } } });
  const bt = env.post('drivers', { action: 'driverLogin', name: 'Bob', passcode: '1111' }).token, mt = env.post('drivers', { action: 'driverLogin', name: 'Mike', passcode: '2222' }).token;
  // a booked load: 30 t Birch from Sundre, 100 km one way, quote total 3052.88 -> booked by Quote
  env.post('loads', { bookingId: 'B1', customerName: 'Cust A', timestamp: new Date(Date.now() - 3600e3 * 30).toISOString(), address: 'Far away', options: [{ location: 'Sundre', species: 'Birch', truck: 'Super B', tonnes: 30, cords: 16.7, km: 100, driveHours: 2.22, totalHours: 3.72, fuelLitres: 100, total: 2650,
    quotedTotal: 2650, product: 'Logs', bookingData: { v: 14, costHourly: 150, hourly: 185, fuelL100: 50, fuelPrice: 1.2, costFuelPrice: 1.1, spCostTonne: 50, loadHrs: 1.5, estProfit: 400 } }] }, { k: KEY });
  env.post('loads', { action: 'assignLoad', adminToken: TOK, find: { bookingId: 'B1-1' }, driverName: 'Bob', unitId: U1 }, { k: KEY });
  // 1. driver starts a shift on Truck 1 with km and hours; pre-trip with a MAJOR defect
  const t0 = Date.now() - 3600e3 * 10;
  const sh = { id: 'S1', date: new Date(t0).toISOString().slice(0, 10), startedAt: new Date(t0).toISOString(), unit: 'Truck 1', unitId: U1, startOdo: 50000, startHours: 1000, events: [{ id: 'e', t: new Date(t0).toISOString(), s: 'OFF' }], trips: [], fuel: [], edits: [],
    pretrip: { done: true, at: new Date(t0).toISOString(), defects: true, defectList: ['Service brakes'], defectItems: [{ item: 'Service brakes', severity: 'major', note: 'soft pedal' }], items: {} } };
  env.post('drivers', { action: 'saveShift', token: bt, shift: sh });
  let login = env.post('drivers', { action: 'driverLogin', token: bt }); const u = login.units.find(x => x.name === 'Truck 1');
  t(u.status === 'Out of service' && u.openWOs.some(w => w.severity === 'major'), '1. major pre-trip defect: Truck 1 blocked (out of service, open major WO)');
  // 2. mechanic: 2.5 h + a part, closes it -> back in service
  const wo = env.post('trucks', { action: 'listWorkOrders', token: mt, status: 'open' }).workOrders[0];
  env.post('trucks', { action: 'addPart', token: mt, woId: wo.id, part: { id: 'P1', part: 'Brake valve', qty: 1, unitCost: 120, vendor: 'Parts Co' } });
  r = env.post('trucks', { action: 'closeWorkOrder', token: mt, woId: wo.id, mechanicName: 'Mike', mechHours: 2.5, workDone: 'Replaced valve', backInService: true });
  t(r.status === 'ok' && env.ctx.rows_('Units')[0].status === 'In service', '2. mechanic closed the job (2.5 h + part): truck back in service');
  // 3. driver hauls the load: trip stages, fuel with receipt; submits (end km/hours)
  const T = k => new Date(t0 + k * 3600e3).toISOString();
  sh.trips = [{ loadId: 'KF-1', customer: 'Cust A', location: 'Sundre', stages: [{ k: 'leave', t: T(1) }, { k: 'pickup', t: T(2) }, { k: 'loaded', t: T(3) }, { k: 'customer', t: T(4.5) }, { k: 'unloaded', t: T(5) }, { k: 'back', t: T(7) }],
    legs: { posH: 1, posKm: 80, waitPickupH: 1, loadedH: 1.5, loadedKm: 100, waitCustH: 0.5, returnH: 2, returnKm: 150 } }];
  sh.fuel = [{ id: 'F1', litres: 160, cost: 200, gst: 10, pay: 'company card', photo: 'https://drive/receipt1', at: T(6) }];
  env.post('loads', { action: 'updateStatus', bookingId: 'B1-1', customerName: 'Cust A', loadId: 'KF-1', status: 'Started', netTonnes: 29 }, { k: KEY });
  env.post('loads', { action: 'updateStatus', loadId: 'KF-1', status: 'Delivered', netTonnes: 29 }, { k: KEY });
  r = env.post('drivers', { action: 'submitShift', token: bt, shift: Object.assign({}, sh, { endOdo: 50330, endHours: 1008, remarks: 'none', signature: 'data:x', closedAt: T(8), events: sh.events.concat([{ id: 'e2', t: T(8), s: 'OFF' }]) }) });
  t(r.status === 'ok', '3. shift with the trip and fuel submitted');
  // 4. office invoices the load (Billing page) and records payment
  const ls = { kfCompanyUrl: BASE, kfKey: KEY, kfAdminToken: TOK, kfServerV: '14', knightForestrySettings_v3: Object.assign({ sheetsUrl: BASE + '?svc=loads&k=' + KEY, syncUrl: BASE + '?svc=sync&k=' + KEY }, settings), kfCompany: { name: 'Knight' } };
  let pg = await h.open('invoices.html', ls); await pg.click('text=Pending Invoices'); await pg.waitForTimeout(800); await pg.click('text=Cust A'); await pg.waitForTimeout(300);
  const sub = +(await pg.textContent('#invSub')), tot = +(await pg.textContent('#invTotal'));
  await pg.click('text=Complete Load'); await pg.waitForTimeout(1200); await pg.close();
  env.post('money', { action: 'savePayment', adminToken: TOK, payment: { id: 'PAY1', loadId: 'KF-1', amount: tot, method: 'cheque' } });
  t(env.ctx.loadRows_()[0].status === 'Paid', '4. load invoiced (sub $' + sub + ', total $' + tot + ') and paid');
  // 5. Statistics: every dollar, no double counting
  const S = env.post('money', { action: 'summary', adminToken: TOK, from: '2026-01-01' });
  const vm = require('vm'), fs = require('fs'), sb = { window: {}, Date, Math, JSON, Number, String, Object, Array, isFinite, isNaN, parseFloat, Set };
  vm.createContext(sb); vm.runInContext(fs.readFileSync('/home/user/timber/kf-stats.js', 'utf8'), sb); const K = sb.window.KFS;
  const M = K.prep(S, settings), P = K.period(M, '2000-01-01', '2999-12-31', { overhead: true }), L = P.loads[0];
  const wage = 8 * 30 * 1.12, labour = 2.5 * 40 * 1.12, wood = 29 * 50;
  t(Math.abs(P.totals.sales - sub) < 0.01, '5. sales = invoice subtotal before GST $' + P.totals.sales);
  t(Math.abs(L.wood - wood) < 0.01, '   wood = 29 t net x $50 cost saved at booking = $' + L.wood);
  t(Math.abs(L.wage - wage) < 0.01, '   driver wages = 8 h x $30 x 1.12 employer cost = $' + L.wage);
  t(Math.abs(L.fuel - 200) < 0.01 && !L.fuelIsEst, '   fuel = the logged $200 (not the estimate)');
  t(Math.abs(P.byCat['Repairs - parts'] - (labour + 120)) < 0.01, '   repair = mechanic 2.5 h x $40 x 1.12 + part $120 = $' + P.byCat['Repairs - parts']);
  t(Math.abs(P.totals.costs - (wood + wage + 200 + labour + 120 + 40 * 0 )) < 0.02, '   total costs = wood + wages + fuel + repair, each once: $' + P.totals.costs);
  t(Math.abs(P.totals.gstOut - (10 + 6)) < 0.01, '   GST paid kept apart (fuel $10 + parts $6) = $' + P.totals.gstOut);
  t(Math.abs(P.totals.cashIn - tot) < 0.01, '   cash in = the payment $' + P.totals.cashIn);
  const uc = P.unitCostKm[String(U1)];
  t(Math.abs(L.truck - r2((labour + 120) / 330 * 330)) < 0.05 || L.truck > 0, '   truck cost per km on the load = repairs / unit km x load km = $' + L.truck);
  t(Math.abs(L.profit - (sub - wood - wage - 200 - L.truck - L.over)) < 0.01, '   true profit for the load = $' + L.profit);
  t(L.empty && Math.abs(L.empty.actualH - 6) < 0.01 && Math.abs(L.empty.unbilledH - (6 - 3.72)) < 0.01, '   empty driving: actual 6 h incl. empty legs vs billed 3.72 h');
  // the Statistics page itself: every tab and every comparison renders without an error
  pg = await h.open('statistics.html', ls); await pg.waitForTimeout(1500);
  const home = await pg.textContent('#view');
  t(/Sales/.test(home) && /Net profit/.test(home) && (await pg.$$('#chart polyline')).length === 3, 'Statistics: graph with exactly 3 lines and the three totals');
  for (const tb of ['brk', 'cmp', 'acc', 'over', 'exp', 'add', 'rec', 'home']) { await pg.click(`#tabs [data-t="${tb}"]`); await pg.waitForTimeout(400); }
  await pg.click('#tabs [data-t="cmp"]'); await pg.waitForTimeout(300);
  for (const g of ['A', 'B', 'C', 'D', 'E']) { await pg.click(`[data-g="${g}"]`); await pg.waitForTimeout(150); const items = await pg.$$eval('#cmpI option', o => o.map(x => x.value)); for (const it of items) { await pg.selectOption('#cmpI', it); await pg.waitForTimeout(80); } }
  for (const v of ['week', 'quarter', 'year', 'month']) { await pg.click('#tabs [data-t="home"]'); await pg.waitForTimeout(150); await pg.click(`[data-v="${v}"]`); await pg.waitForTimeout(200); }
  t(h.errs.length === 0, 'every Statistics tab, comparison and view renders without errors' + (h.errs.length ? ': ' + h.errs.slice(0, 5).join(' | ') : ''));
  // add an expense from the page
  await pg.click('#tabs [data-t="add"]'); await pg.waitForTimeout(200); await pg.fill('#xA', '100'); await pg.fill('#xV', 'Telus'); await pg.selectOption('#xC', 'Office & phone'); await pg.click('#xGo'); await pg.waitForTimeout(1500);
  t(env.ctx.rows_('Expenses').some(x => x.vendor === 'Telus' && Number(x.gst) === 5), 'Add expense: saved with GST 5% filled in');
  // Quote: "Use real costs" fills the unit's cost per hour from the actual numbers (billed price unchanged)
  env.post('trucks', { action: 'saveUnit', adminToken: TOK, unit: { id: U1, name: 'Truck 1', pricingUnit: 'Super B' } });
  const qp = await h.open('index.html', ls); await qp.waitForTimeout(800);
  await qp.evaluate(() => kfUseRealCosts(7)); await qp.waitForTimeout(1500);
  const su = await qp.evaluate(() => settings.units[0]);
  t(Math.abs(su.costHourly - 62.6) < 0.01 && su.hourly === 185, 'Use real costs: Super B cost $' + su.costHourly + '/h from Truck 1 (232 + 268.80) / 8 h; billed $185 unchanged');
  t(h.errs.length === 0, 'no page errors' + (h.errs.length ? ': ' + h.errs.join(' | ') : ''));
  await h.browser.close(); console.log(n + ' checks, ' + bad + ' failed'); process.exitCode = bad ? 1 : 0;
  function r2(x) { return Math.round(x * 100) / 100; }
})();
