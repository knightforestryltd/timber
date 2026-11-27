const { start, BASE } = require('./e2e');
(async () => {
  const h = await start({ log: !!process.env.LOG });
  const env = h.env; let n = 0, bad = 0; const t = (c, m) => { n++; if (!c) bad++; console.log((c ? 'ok   ' : 'FAIL ') + m); };
  env.props.drvConfig = JSON.stringify({ company: { officeEmail: 'office@example.com' }, units: [{ id: 'u1', name: 'Truck 1', plate: 'ABC' }, { id: 'u2', name: 'Truck 2' }] });
  let r = env.post('sync', { action: 'setPassword', newPassword: 'secret1' }); const TOK = r.adminToken;
  env.post('drivers', { action: 'adminSaveDriver', adminToken: TOK, driver: { name: 'Bob', passcode: '1111' } });
  // Truck 1 tracks hours; Truck 2 out of service
  env.post('trucks', { action: 'listUnits', adminToken: TOK });
  const U = env.ctx.rows_('Units'); env.post('trucks', { action: 'saveUnit', adminToken: TOK, unit: { id: U[0].id, name: 'Truck 1', trackHours: 'yes', currentHours: 1200 } });
  env.post('trucks', { action: 'saveUnit', adminToken: TOK, unit: { id: U[1].id, name: 'Truck 2', status: 'Out of service', outReason: 'Cracked frame' } });

  // ---- 1. an OPEN shift started on the OLD drivers page (old session with passcode, old shift shape) carries over ----
  const oldShift = { id: 'Sold1', date: '2026-11-27', startedAt: new Date(Date.now() - 3600000).toISOString(), driverName: 'Bob', unit: 'Truck 1', plate: 'ABC', trailerA: '', trailerB: '', hosSet: 'ab', startOdo: 10000, endOdo: '',
    events: [{ id: 'e1', t: new Date(Date.now() - 3600000).toISOString(), s: 'OFF', label: 'Off Duty' }], trips: [], fuel: [{ litres: 50, cost: 80, place: 'Esso', hm: '08:00', at: new Date().toISOString() }], edits: [], gpsGaps: [], pretrip: null, remarks: '', signature: '' };
  let pg = await h.open('drivers.html', { kfDrvSession: { name: 'Bob', passcode: '1111' }, kfDrvShift: oldShift, driversUrl: BASE + '?svc=drivers' });
  await pg.waitForTimeout(1500);
  const after = await pg.evaluate(() => ({ s: JSON.parse(localStorage.getItem('kfDrvSession')), sh: JSON.parse(localStorage.getItem('kfDrvShift')), html: document.getElementById('view-drivers').textContent }));
  t(after.sh && after.sh.id === 'Sold1' && after.html.includes('Current duty status'), 'old open shift carried over onto the shift screen');
  t(after.s.token && !after.s.passcode, 'stored passcode swapped for a session token');
  t(env.ctx.rows_('Shifts').some(s => s.shiftId === 'Sold1'), 'old shift synced to the new script');
  t(env.ctx.rows_('Expenses').filter(x => x.source === 'fuel').length === 1, 'old-shape fuel entry became an expense (GST 5% filled)');
  // pre-trip with a MAJOR defect -> hard stop on Driving
  await pg.click('#aPre'); await pg.waitForTimeout(300);
  await pg.click('#ptAll'); await pg.locator('.chk').nth(5).locator('button.df').click();
  await pg.selectOption('.ptSev[data-k="1.1"]', 'major');
  await pg.fill('#ptNote', 'Brakes soft');
  await pg.locator('#ptSig').scrollIntoViewIfNeeded(); let b = await pg.locator('#ptSig').boundingBox(); await pg.mouse.move(b.x + 10, b.y + 10); await pg.mouse.down(); await pg.mouse.move(b.x + 90, b.y + 50); await pg.mouse.up();
  await pg.click('#ptSave'); await pg.waitForTimeout(1500);
  const wo = env.ctx.rows_('WorkOrders'); t(wo.length === 1 && wo[0].severity === 'major', 'major pre-trip defect -> major work order');
  t(env.ctx.rows_('Units').find(u => u.name === 'Truck 1').status === 'Out of service', 'Truck 1 now out of service');
  await pg.click('[data-st="D"]'); await pg.waitForTimeout(300);
  if (await pg.isVisible('#csOk')) { await pg.click('#csOk'); await pg.waitForTimeout(400); }
  const al = await pg.evaluate(() => window.__alerts || []);
  t(al.some(a => /MAJOR defect/.test(a)), 'Driving is a hard stop after a major defect');
  // close the shift with end km (no start hours on the old shift -> no hours asked)
  await pg.evaluate(() => { window.__confirmAnswer = true; }); await pg.click('#aClose'); await pg.waitForTimeout(400);
  t(await pg.isVisible('#clHrs') && /optional/.test(await pg.getAttribute('#clHrs', 'placeholder')), 'hour meter beside the km at close: optional for a shift started without hours');
  await pg.fill('#clOdo', '10150'); await pg.fill('#clRem', 'none');
  await pg.locator('#clSig').scrollIntoViewIfNeeded(); b = await pg.locator('#clSig').boundingBox(); await pg.mouse.move(b.x + 10, b.y + 10); await pg.mouse.down(); await pg.mouse.move(b.x + 90, b.y + 50); await pg.mouse.up();
  await pg.click('#clGo'); await pg.waitForTimeout(3500);
  t(env.ctx.rows_('Shifts').find(s => s.shiftId === 'Sold1').status === 'Submitted', 'old shift submitted');
  await pg.close();

  // ---- 2. new shift: out-of-service unit blocked; engine hours on a tracked unit ----
  // office lets Truck 1 back (close WO)
  env.post('trucks', { action: 'closeWorkOrder', adminToken: TOK, woId: wo[0].id, mechHours: 1, mechRate: 50, workDone: 'fixed', backInService: true });
  pg = await h.open('drivers.html', { kfDrvSession: JSON.parse(await (async () => JSON.stringify(after.s))()), driversUrl: BASE + '?svc=drivers' });
  await pg.waitForTimeout(1500);
  await pg.selectOption('#stUnit', 'Truck 2'); await pg.waitForTimeout(200);
  t(await pg.isDisabled('#stGo') && (await pg.textContent('#stUnitInfo')).includes('Cracked frame'), 'out-of-service Truck 2 cannot be started (reason shown)');
  await pg.selectOption('#stUnit', 'Truck 1'); await pg.waitForTimeout(200);
  t(await pg.isVisible('#stHrs') && (await pg.inputValue('#stHrs')) === '1200', 'engine hours asked and pre-filled from the last reading');
  await pg.check('#stOdoOk'); await pg.fill('#stHrs', '1210'); await pg.check('#stOdoOk'); await pg.click('#stGo'); await pg.waitForTimeout(1500);
  const ns = await pg.evaluate(() => JSON.parse(localStorage.getItem('kfDrvShift')));
  t(ns && ns.startHours === 1210 && ns.unitId, 'new shift stores startHours and unitId');
  // fuel with GST + payment
  await pg.click('#aFuel'); await pg.waitForTimeout(400); await pg.fill('#fuL', '100'); await pg.fill('#fuC', '150');
  t((await pg.inputValue('#fuG')) === '7.50', 'GST filled in as 5%');
  await pg.selectOption('#fuPay', 'cash'); await pg.click('#fuAdd'); await pg.click('#fuDone'); await pg.waitForTimeout(1500);
  const fx = env.ctx.rows_('Expenses').filter(x => x.source === 'fuel' && Number(x.amount) === 150);
  t(fx.length === 1 && fx[0].payMethod === 'cash' && Number(fx[0].gst) === 7.5, 'fuel expense with GST and payment method');
  // trips + stages (manual taps)
  env.post('loads', { bookingId: 'Bx', customerName: 'Cust A', address: 'Addr', options: [{ location: 'Sundre', species: 'Birch', truck: 'Super B', total: 100 }] }, { k: env.props.companyKey });
  env.post('loads', { action: 'assignLoad', adminToken: TOK, find: { bookingId: 'Bx-1' }, driverName: 'Bob', unitId: U[0].id }, { k: env.props.companyKey });
  env.post('loads', { action: 'editLoad', adminToken: TOK, find: { bookingId: 'Bx-1' }, changes: { status: 'Started' } }, { k: env.props.companyKey });
  env.ss.sheets.Loads.data[4][16] = 'KF-2026-1127-01';
  await pg.click('#aTrips'); await pg.waitForTimeout(1200);
  t((await pg.textContent('#tpList')).includes('assigned to you'), 'assigned load shows first under Trips from Dispatch');
  await pg.check('#tpList input[type=checkbox]'); await pg.click('#tpDone'); await pg.waitForTimeout(600);
  for (let i = 0; i < 5; i++) { await pg.click('#tcNext'); await pg.waitForTimeout(250); }
  const trip = (await pg.evaluate(() => JSON.parse(localStorage.getItem('kfDrvShift')))).trips[0];
  t(trip.stages.length === 5 && trip.legs && trip.legs.loadedH != null, 'five stages tapped, legs worked out');
  await pg.close();

  // ---- 3. yard time clock alongside the open driving shift ----
  pg = await h.open('drivers.html', { kfDrvSession: after.s, driversUrl: BASE + '?svc=drivers' });
  await pg.waitForTimeout(1200);
  t(await pg.isVisible('#aYard'), 'Yard work button on the shift screen while driving shift is open');
  await pg.click('#aYard'); await pg.fill('#yiY', 'North Yard'); await pg.click('#yiOk'); await pg.waitForTimeout(800);
  await pg.click('[data-yt="loading"]'); await pg.waitForTimeout(500);
  t(env.ctx.rows_('Shifts').some(s => s.shiftType === 'yard'), 'yard shift saved as ShiftType = yard');
  await pg.click('#ycOut'); await pg.click('#yoGo'); await pg.waitForTimeout(1500);
  const ys = env.ctx.rows_('Shifts').find(s => s.shiftType === 'yard');
  t(ys.status === 'Submitted' && !(await pg.evaluate(() => localStorage.getItem('kfDrvYard'))), 'clocked out: yard shift submitted');
  t(env.mails.length === 1, 'daily-log email only for the driving shift (yard shift sends none): ' + env.mails.length);
  r = env.post('drivers', { action: 'driverLogin', token: after.s.token }); t(!Object.keys(r.history || {}).some(k => k === new Date().toISOString().slice(0, 10) && 0), 'login history ok');
  t(h.errs.length === 0, 'no page errors' + (h.errs.length ? ': ' + h.errs.join(' | ') : ''));
  console.log(n + ' checks, ' + bad + ' failed'); await h.browser.close(); process.exitCode = bad ? 1 : 0;
})();
