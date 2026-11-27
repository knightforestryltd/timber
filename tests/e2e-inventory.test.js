const { start, BASE } = require('./e2e');
(async () => {
  const h = await start({ log: !!process.env.LOG });
  const env = h.env; let n = 0, bad = 0; const t = (c, m) => { n++; if (!c) bad++; console.log((c ? 'ok   ' : 'FAIL ') + m); };
  let r = env.post('sync', { action: 'setPassword', newPassword: 'secret1' }); const KEY = r.key, TOK = r.adminToken;
  const settings = { locations: [{ id: 1, name: 'Sundre', address: '51.8, -114.6', species: [{ name: 'Birch', pricePerTonne: 60, costPerTonne: 50, tonnesPerCord: 1.8 }] },
    { id: 2, name: 'North Yard', address: '52.0, -114.0', species: [{ name: 'Birch', pricePerTonne: 90, costPerTonne: 70, tonnesPerCord: 1.6 }] }],
    units: [{ id: 7, name: 'Super B', hourly: 185, costHourly: 150, fuel: 50, tonnes: 30, hours: 1.5, haulsSplit: true, splitCords: 12 }], fuelPrice: 1.2, costFuelPrice: 1.1, gst: 5, speed: 90, money: { employerCostPct: 12 } };
  env.post('sync', { action: 'saveSettings', adminToken: TOK, settings, force: true });
  // an old v13 Yards row (12 columns) to start with
  env.ss.insertSheet('Yards').data[0] = env.ctx.YARD_HEADERS.slice(); env.ss.sheets.Yards.data[1] = ['2026-10-01T00:00:00Z', 'North Yard', 'Birch', 'In', 20, '', 100, '', '', '', 'Sundre', ''];
  const ls = { kfCompanyUrl: BASE, kfKey: KEY, kfAdminToken: TOK, kfServerV: '14', yardUrl: BASE + '?svc=yards&k=' + KEY, knightForestrySettings_v3: Object.assign({ sheetsUrl: BASE + '?svc=loads&k=' + KEY, syncUrl: BASE + '?svc=sync&k=' + KEY }, settings) };
  let pg = await h.open('yards.html', ls); await pg.waitForTimeout(800);
  // ---- drop at yard ----
  await pg.click('text=Drop at yard (logs)'); await pg.waitForTimeout(600);
  await pg.fill('#dpYard', 'North Yard'); await pg.fill('#dpSp', 'Birch'); await pg.selectOption('#dpSrc', 'Sundre'); await pg.waitForTimeout(300);
  t((await pg.inputValue('#dpW')) === '50.00', 'wood price pre-filled from Sundre cost per tonne ($50)');
  await pg.fill('#dpT', '15'); await pg.fill('#dpKm', '50'); await pg.dispatchEvent('#dpKm', 'input'); await pg.waitForTimeout(200);
  // full load: round 100 km, 100/90 + 1.5 = 2.611 h x 150 = 391.67 + 50 L x 1.10 = 55 -> 446.67 x 15/30 = 223.33
  t((await pg.inputValue('#dpH')) === '223.33', 'haul = full round trip at cost rates x 15/30 t = $' + await pg.inputValue('#dpH'));
  await pg.click('#dpGo'); await pg.waitForTimeout(1200);
  let st = env.ctx.yardStock_(env.ctx.yardRowsAll_(), 'North Yard', 'Birch', 'Logs');
  t(st.qty === 35 && Math.abs(st.avg - (20 * 100 + 15 * (50 + 223.33 / 15)) / 35) < 0.02, 'weighted average: 20 t @ 100 + 15 t @ 64.89 = ' + st.avg + '/t on 35 t');
  // ---- process 5 cords (1.6 t/cord, 10% waste) ----
  await pg.click('text=Process logs to split'); await pg.waitForTimeout(1200);
  await pg.selectOption('#prY', 'North Yard'); await pg.fill('#prS', 'Birch'); await pg.dispatchEvent('#prS', 'change'); await pg.waitForTimeout(300);
  t((await pg.inputValue('#prF')) === '1.6', 't/cord from the yard location settings (1.6)');
  await pg.fill('#prC', '5'); await pg.fill('#prW', '10'); await pg.fill('#prLh', '2'); await pg.fill('#prLr', '30'); await pg.fill('#prSell', '320'); await pg.dispatchEvent('#prSell', 'input');
  t((await pg.textContent('#prCalc')).includes('8.8 t'), 'raw used 5 x 1.6 x 1.1 = 8.8 t');
  await pg.click('#prGo'); await pg.waitForTimeout(1500);
  const rows = env.ctx.yardRowsAll_(), pid = rows.find(x => x.processId).processId;
  t(rows.filter(x => x.processId === pid).length === 2, 'one Out (logs) + one In (split) sharing a ProcessId');
  const S = env.ctx.yardStock_(rows, 'North Yard', 'Birch', 'Split'), Lg = env.ctx.yardStock_(rows, 'North Yard', 'Birch', 'Logs');
  t(S.qty === 5 && Lg.qty === 26.2, 'split 5 cords on hand; logs 35 - 8.8 = 26.2 t');
  const s0 = env.ctx.readSettings_(); t(s0.locations[1].species[0].splitPricePerCord === 320, 'split sell price saved on the yard location (merge)');
  // old cached Inventory page view: v13 sums Tonnes of non-Out rows minus Out rows
  r = env.get({ svc: 'yards', k: KEY }); const old = r.rows.reduce((s, x) => s + (x.type === 'Out' ? -1 : 1) * (+x.tonnes || 0), 0);
  t(Math.abs(old - (35 - 8.8 + 8)) < 0.01, 'old page total stays sane: split shown as tonne-equivalent (' + old.toFixed(2) + ' t)');
  // ---- driver drop: pending (0 t for old pages) then confirmed ----
  env.post('drivers', { action: 'adminSaveDriver', adminToken: TOK, driver: { name: 'Bob', passcode: '1111' } });
  const tok = env.post('drivers', { action: 'driverLogin', name: 'Bob', passcode: '1111' }).token;
  env.post('drivers', { action: 'yardDrop', token: tok, drop: { id: 'D1', yard: 'North Yard', species: 'Birch', tonnes: 10, source: 'Sundre' } });
  env.post('drivers', { action: 'yardDrop', token: tok, drop: { id: 'D1', yard: 'North Yard', species: 'Birch', tonnes: 10, source: 'Sundre' } });
  t(env.ctx.yardRowsAll_().filter(x => x.status === 'Pending').length === 1, 'driver drop saved once as Pending');
  t(env.ctx.yardStock_(env.ctx.yardRowsAll_(), 'North Yard', 'Birch', 'Logs').qty === 26.2, 'pending drop does not count');
  await pg.goto('file:///home/user/timber/yards.html'); await pg.waitForTimeout(900);
  await pg.click('#pendBtn'); await pg.waitForTimeout(300); await pg.click('#v14Box button:text-is("Confirm")'); await pg.waitForTimeout(800);
  await pg.fill('#dpKm', '50'); await pg.dispatchEvent('#dpKm', 'input'); await pg.click('#dpGo'); await pg.waitForTimeout(1200);
  t(env.ctx.yardStock_(env.ctx.yardRowsAll_(), 'North Yard', 'Birch', 'Logs').qty === 36.2, 'confirmed drop now counts (36.2 t)');
  // undo the processing run -> Void rows
  await pg.goto('file:///home/user/timber/yards.html'); await pg.waitForTimeout(900);
  await pg.click('text=North Yard'); await pg.waitForTimeout(200); await pg.click('.species-card'); await pg.waitForTimeout(300);
  t((await pg.textContent('#speciesSummary')).includes('5.0 cords'), 'species screen shows Logs and SPLIT separately');
  await pg.click('text=Undo this processing run'); await pg.waitForTimeout(1200);
  t(env.ctx.yardRowsAll_().filter(x => x.status === 'Void').length === 2, 'undo marks both rows VOID (nothing deleted)');
  await pg.close();
  // ---- Quote: split row + chips only for units that haul split; low stock note; needs a price ----
  env.post('yards', { action: 'process', adminToken: TOK, process: { id: 'PR2', yard: 'North Yard', species: 'Birch', cords: 5, factor: 1.6, sellPerCord: 320 } }, { k: KEY });
  env.post('yards', { action: 'add', timestamp: '2026-11-01T00:00:00Z', yard: 'North Yard', species: 'Tamarack', type: 'In', tonnes: 8, pricePerTonne: 55 }, { k: KEY });
  ls.knightForestrySettings_v3 = Object.assign({}, ls.knightForestrySettings_v3, { locations: env.ctx.readSettings_().locations });
  pg = await h.open('index.html', Object.assign({}, ls, { kfQuoteSplit: ['Birch'] }));
  const out = await pg.evaluate(async () => {
    const j = await (await fetch(localStorage.getItem('yardUrl') + '&all=1')).json(); setYardStock(j.rows);
    document.querySelectorAll('.species-cb').forEach(c => { c.checked = c.value === 'Birch' || c.value === 'Tamarack'; });
    const loc = settings.locations.find(l => l.name === 'North Yard');
    calcState = { focus: -1, origins: [{ loc, km: 60, durSec: 2400, durText: '40 min', routes: [] }] }; renderResults();
    const res = document.getElementById('results').textContent;
    return { res, split: lastCalcResults.filter(r => r.product === 'Split').map(r => [r.truck, r.cords, Math.round(r.total)]), low: document.querySelectorAll('.low-note').length };
  });
  t(out.split.length === 1 && out.split[0][1] === 12, 'one SPLIT chip (Super B, 12 cords): ' + JSON.stringify(out.split));
  t(/SPLIT/.test(out.res) && /cords on hand/.test(out.res), 'split row shows cords on hand');
  t(out.low >= 1, 'low stock note on chips (5 cords on hand < 12)');
  t(/Tamarack[\s\S]*needs a price/.test(out.res), 'yard stock with no price shows "needs a price"');
  // book the split option: low-stock warning then booked with Product = Split
  await pg.evaluate(() => { document.getElementById('customerName').value = 'Split Cust'; document.getElementById('addressInput').value = 'Somewhere'; const r = lastCalcResults.find(x => x.product === 'Split'); selectedOptions.add(r.id); window.__confirms = []; document.getElementById('quoteActions').classList.remove('hidden'); });
  await pg.click('#btnBookLoad'); await pg.waitForTimeout(300);
  t(!(await pg.isHidden('#lowStockNote')), 'booking pop-up shows the low stock note');
  await pg.click('#btnNotesOk'); await pg.waitForTimeout(1200);
  const conf = await pg.evaluate(() => window.__confirms);
  t(conf.some(c => /cords on hand, this load is 12/.test(c) && /Book anyway/.test(c)), 'one "Book anyway?" warning');
  const lr = env.ctx.loadRows_().find(x => x.customerName === 'Split Cust');
  t(lr && lr.product === 'Split' && +lr.cords === 12, 'load booked with Product = Split');
  // Billing invoices a split load per cord
  env.post('loads', { action: 'updateStatus', bookingId: lr.bookingId, customerName: 'Split Cust', timestamp: lr.timestamp, loadId: 'KF-SPLIT', status: 'Delivered' }, { k: KEY });
  t(env.ctx.yardRowsAll_().some(x => x.type === 'Out' && x.loadId === 'KF-SPLIT' && x.product === 'Split' && +x.cords === 12), 'delivery wrote the split Out row in cords');
  const bp = await h.open('invoices.html', ls); await bp.click('text=Pending Invoices'); await bp.waitForTimeout(800); await bp.click('text=Split Cust'); await bp.waitForTimeout(300);
  t(/12\.00 cords split @ \$320\.00\/cord/.test(await bp.textContent('#invLines')), 'Billing: split line is cords x $/cord');
  t(h.errs.length === 0, 'no page errors' + (h.errs.length ? ': ' + h.errs.join(' | ') : ''));
  console.log(n + ' checks, ' + bad + ' failed'); await h.browser.close(); process.exitCode = bad ? 1 : 0;
})();
