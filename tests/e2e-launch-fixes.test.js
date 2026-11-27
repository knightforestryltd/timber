// Launch fixes (after the v14 go-live):
//  1. Quote → Company settings: saving (e.g. fuel price) kept asking to sign in again and the change did not stick.
//  2. Drivers: hour meter beside the km at shift start and close, on every truck.
//  3. Quote → View Quote: Money tab + Dispatch view tab (the load as it will show in Dispatch → Pending).
//  4. Dispatch: delete a load that is not delivered yet.
const { start, BASE } = require('./e2e');
(async () => {
  const h = await start({ log: !!process.env.LOG });
  const env = h.env; let n = 0, bad = 0; const t = (c, m) => { n++; if (!c) bad++; console.log((c ? 'ok   ' : 'FAIL ') + m); };
  env.props.drvConfig = JSON.stringify({ company: { officeEmail: 'office@example.com' }, units: [{ id: 'u1', name: 'Truck 1', plate: 'ABC' }, { id: 'u2', name: 'Truck 2' }] });
  let r = env.post('sync', { action: 'setPassword', newPassword: 'knightpw' }); const TOK = r.adminToken;
  env.post('sync', { action: 'saveProfile', adminToken: TOK, profile: { name: 'Knight Forestry' } });
  env.post('sync', { action: 'saveSettings', adminToken: TOK, force: true, settings: { locations: [{ id: 'l1', name: 'Sundre', address: 'Sundre, AB', species: [{ name: 'Birch', pricePerTonne: 100 }] }], units: [], fuelPrice: 1.5, gst: 5 } });
  const lsSettings = pg => pg.evaluate(() => JSON.parse(localStorage.getItem('knightForestrySettings_v3') || '{}'));

  // ---- 1. company settings ----
  let pg = await h.open('index.html');
  await pg.fill('#kfsCoName', 'Knight Forestry'); await pg.fill('#kfsPw', 'knightpw'); await pg.fill('#kfsName', 'Office'); await pg.click('#kfsAdmin'); await pg.waitForTimeout(2000);
  await pg.click('#nav-settings'); await pg.waitForTimeout(800);
  if (!(await pg.isVisible('#coSettingsWrap'))) await pg.click('#btnCoSettings');
  t(!(await pg.isVisible('#pwEnterBox')), 'admin device: no company password box');
  await pg.fill('#setFuelPrice', '1.99'); await pg.click('#btnSaveSettings'); await pg.waitForTimeout(2000);
  t(env.ctx.readSettings_().fuelPrice === 1.99, 'Save Settings on an admin device saves the fuel price to the company in one tap');
  t(!(await pg.isVisible('#loginOverlay')) && !(await pg.isVisible('#kfSignIn')), 'no sign-in / connect screen after saving');
  t(!(await pg.isVisible('#pwEnterBox')), 'still no password box after a change');
  t((await lsSettings(pg)).syncUrl.includes('&k='), 'the device keeps its company key in its links');
  await pg.reload(); await pg.waitForTimeout(1500);
  t((await lsSettings(pg)).fuelPrice === 1.99 && !(await pg.isVisible('#loginOverlay')), 'after reload: fuel price stuck, still signed in');
  await pg.click('#nav-settings'); await pg.waitForTimeout(400);
  await pg.fill('#unitName', 'Tri-axle'); await pg.click('#btnAddUnit'); await pg.waitForTimeout(2500);
  t((env.ctx.readSettings_().units || []).some(u => u.name === 'Tri-axle'), 'admin device: a new truck unit goes to the company by itself');
  // a phone already hit by the old bug: bare link, company key deleted -> repaired with its admin token, no password
  await pg.evaluate(b => { const s = JSON.parse(localStorage.getItem('knightForestrySettings_v3')); s.syncUrl = b; localStorage.setItem('knightForestrySettings_v3', JSON.stringify(s)); localStorage.removeItem('kfKey'); }, BASE);
  await pg.reload(); await pg.waitForTimeout(2500);
  let st = await pg.evaluate(() => ({ key: !!localStorage.getItem('kfKey'), sync: JSON.parse(localStorage.getItem('knightForestrySettings_v3')).syncUrl }));
  t(st.key && st.sync.includes('&k=') && !(await pg.isVisible('#loginOverlay')), 'phone broken by the old bug reconnects by itself (admin token)');
  await pg.evaluate(b => { const s = JSON.parse(localStorage.getItem('knightForestrySettings_v3')); s.syncUrl = b; localStorage.setItem('knightForestrySettings_v3', JSON.stringify(s)); }, BASE);
  await pg.reload(); await pg.waitForTimeout(1500);
  t((await lsSettings(pg)).syncUrl.includes('&k=') && !(await pg.isVisible('#loginOverlay')), 'bare link with the key still there: repaired on load');
  // a device that is not an admin is asked for the password once, and the save sticks
  await pg.evaluate(() => localStorage.removeItem('kfAdminToken')); await pg.reload(); await pg.waitForTimeout(1200);
  await pg.evaluate(() => { window.__promptAnswer = 'knightpw'; }); await pg.click('#nav-settings'); await pg.waitForTimeout(800);
  if (!(await pg.isVisible('#coSettingsWrap'))) await pg.click('#btnCoSettings');
  await pg.fill('#setFuelPrice', '2.25'); await pg.click('#btnSaveSettings'); await pg.waitForTimeout(2000);
  t(env.ctx.readSettings_().fuelPrice === 2.25 && /Saved to company/.test(await pg.textContent('#saveSettingsMsg')), 'non-admin device: asked for the password, saved to the company');
  await pg.evaluate(() => { window.__promptAnswer = ''; });
  await pg.fill('#setFuelPrice', '2.50'); await pg.click('#btnSaveSettings'); await pg.waitForTimeout(1200);
  t(env.ctx.readSettings_().fuelPrice === 2.25 && /this device only/.test(await pg.textContent('#saveSettingsMsg')), 'password prompt cancelled: kept on this device only, says so');
  // a real password change still asks to connect again
  env.post('sync', { action: 'setPassword', password: 'knightpw', newPassword: 'newpw99' });
  await pg.reload(); await pg.waitForTimeout(1800);
  t(await pg.isVisible('#loginOverlay'), 'after a real password change the device is asked to connect again');
  await pg.close();

  // ---- 3. View Quote: Money + Dispatch view ----
  const ADM = env.post('sync', { action: 'makeAdmin', password: 'newpw99', deviceName: 'Office 2' });
  const office = { kfCompanyUrl: BASE, kfKey: ADM.key, kfAdminToken: ADM.adminToken, coLoggedIn: '1', knightForestrySettings_v3: { syncUrl: BASE + '?svc=sync&k=' + ADM.key, sheetsUrl: BASE + '?svc=loads&k=' + ADM.key, locations: [], units: [], gst: 5, fuelPrice: 2.25 } };
  pg = await h.open('index.html', office); await pg.waitForTimeout(800);
  await pg.fill('#customerName', 'Jane Test'); await pg.fill('#customerPhone', '403-555-0000'); await pg.fill('#addressInput', '12 Pine Rd');
  await pg.evaluate(() => {
    lastCalcResults.push({ id: 'x1', location: 'Sundre', species: 'Birch', truck: 'Tri-axle', tonnes: 16, cords: 8.9, total: 1234.5, km: 42.3, totalHours: 3.4, duration: '45 min', product: 'Logs',
      cost: { productCost: 900, productBilled: 1000, truckCost: 100, truckBilled: 150, fuelCost: 20, fuelBilled: 25, hrs: 3.4, litres: 40, gstPct: 5 } });
    selectedOptions.add('x1'); document.getElementById('quoteActions').classList.remove('hidden');
  });
  await pg.click('#btnViewQuote'); await pg.waitForTimeout(300);
  t(await pg.isVisible('#costBody') && /TOTAL NET/.test(await pg.textContent('#costBody')), 'View Quote opens on the Money tab');
  await pg.click('#vqTabDispatch'); await pg.waitForTimeout(200);
  const dv = await pg.textContent('#dispatchBody');
  t(await pg.isVisible('#dispatchBody') && !(await pg.isVisible('#costBody')) && /Jane Test/.test(dv) && /12 Pine Rd/.test(dv) && /Waiting/.test(dv) && /from Sundre/.test(dv) && /42\.3 km one way/.test(dv) && /\$1234\.50/.test(dv), 'Dispatch view tab shows the load as Dispatch → Pending does');
  await pg.click('#vqTabMoney'); t(await pg.isVisible('#costBody'), 'back to the Money tab');
  await pg.close();

  // ---- 4. Dispatch: delete a pending load ----
  const K = { k: env.props.companyKey };
  env.post('loads', { bookingId: 'BD', customerName: 'Delete Me', address: 'A', options: [{ location: 'Sundre', species: 'Birch', truck: 'Tri-axle', total: 100 }] }, K);
  env.post('loads', { bookingId: 'BK', customerName: 'Keep Me', address: 'B', options: [{ location: 'Sundre', species: 'Birch', truck: 'Tri-axle', total: 200 }] }, K);
  env.post('loads', { bookingId: 'BV', customerName: 'Delivered One', address: 'C', options: [{ location: 'Sundre', species: 'Birch', truck: 'Tri-axle', total: 300 }] }, K);
  env.post('loads', { action: 'editLoad', adminToken: ADM.adminToken, find: { bookingId: 'BV-1' }, changes: { status: 'Delivered' } }, K);
  pg = await h.open('dispatch.html', office); await pg.waitForTimeout(1200);
  const cards = pg.locator('#loadList .ld');
  t(await cards.count() === 3, 'three loads in Dispatch → Pending');
  await pg.locator('#loadList .ld', { hasText: 'Delivered One' }).click(); await pg.waitForTimeout(300);
  t(!(await pg.isVisible('#delLoadBtn')), 'no Delete button on a delivered load');
  await pg.click('#detailView .btn >> text=Back'); await pg.waitForTimeout(800);
  await pg.locator('#loadList .ld', { hasText: 'Delete Me' }).click(); await pg.waitForTimeout(300);
  t(await pg.isVisible('#delLoadBtn'), 'Delete button on a waiting load');
  await pg.click('#delLoadBtn'); await pg.waitForTimeout(1500);
  const names = env.ctx.rows_ ? null : null;
  const sheet = env.ss.sheets.Loads.data.slice(4).map(rw => rw[1]);
  t(!sheet.includes('Delete Me') && sheet.includes('Keep Me') && sheet.includes('Delivered One'), 'only that load was removed from the Load Log sheet');
  t(env.ctx.rows_('Log').some(x => x.action === 'load deleted' && /Delete Me/.test(x.detail)), 'a copy of the deleted row is in the Log tab');
  t(await pg.isVisible('#listView') && !(await pg.textContent('#loadList')).includes('Delete Me'), 'back on the list, the load is gone');
  r = env.post('loads', { action: 'deleteLoad', adminToken: ADM.adminToken, find: { bookingId: 'BV-1' } }, K);
  t(r.status === 'error' && env.ss.sheets.Loads.data.slice(4).some(rw => rw[1] === 'Delivered One'), 'the script refuses to delete a delivered load');
  r = env.post('loads', { action: 'deleteLoad', find: { bookingId: 'BK-1' } }, K);
  t(r.status !== 'ok', 'deleting needs an admin device or the company password');
  await pg.close();

  // ---- 2. Drivers: hour meter beside the km on every truck ----
  pg = await h.open('drivers.html', { kfDrvSession: { name: 'Bob', passcode: '1111' }, driversUrl: BASE + '?svc=drivers' });
  env.post('drivers', { action: 'adminSaveDriver', password: 'newpw99', driver: { name: 'Bob', passcode: '1111' } });
  await pg.reload(); await pg.waitForTimeout(1500);
  if (!(await pg.isVisible('#stUnit'))) { await pg.selectOption('#lgName', 'Bob').catch(() => {}); await pg.fill('#lgPass', '1111').catch(() => {}); await pg.click('#lgGo').catch(() => {}); await pg.waitForTimeout(1500); }
  await pg.selectOption('#stUnit', 'Truck 2'); await pg.waitForTimeout(200);
  const box = async s => pg.locator(s).boundingBox();
  const bo = await box('#stOdo'), bh = await box('#stHrs');
  t(await pg.isVisible('#stHrs') && bo && bh && Math.abs(bo.y - bh.y) < 5 && bh.x > bo.x, 'hour meter shows beside the km at shift start (truck not tracking hours)');
  t(/optional/.test(await pg.getAttribute('#stHrs', 'placeholder')), 'optional on a truck that does not track hours');
  await pg.fill('#stOdo', '5000'); await pg.fill('#stHrs', '812.5'); await pg.check('#stOdoOk'); await pg.click('#stGo'); await pg.waitForTimeout(1500);
  const sh = await pg.evaluate(() => JSON.parse(localStorage.getItem('kfDrvShift')));
  t(sh && sh.startOdo === 5000 && sh.startHours === 812.5, 'shift stores the starting km and hour meter');
  await pg.evaluate(() => { window.__confirmAnswer = true; }); await pg.click('#aClose'); await pg.waitForTimeout(400);
  const co = await box('#clOdo'), ch = await box('#clHrs');
  t(co && ch && Math.abs(co.y - ch.y) < 5 && /required/.test(await pg.getAttribute('#clHrs', 'placeholder')), 'close: ending hour meter beside the ending km, required when it was started');
  await pg.fill('#clOdo', '5100'); await pg.fill('#clRem', 'none');
  await pg.locator('#clSig').scrollIntoViewIfNeeded(); const b = await pg.locator('#clSig').boundingBox(); await pg.mouse.move(b.x + 10, b.y + 10); await pg.mouse.down(); await pg.mouse.move(b.x + 90, b.y + 50); await pg.mouse.up();
  await pg.click('#clGo'); await pg.waitForTimeout(500);
  t(/ending hour meter/i.test(await pg.textContent('#clErr')), 'cannot submit without the ending hour meter');
  await pg.fill('#clHrs', '820'); await pg.click('#clGo'); await pg.waitForTimeout(3500);
  const row = env.ctx.rows_('Shifts').find(s => s.shiftId === sh.id);
  t(row && Number(row.startHours) === 812.5 && Number(row.endHours) === 820, 'hour meter start and end saved on the shift in the sheet');
  await pg.close();

  t(h.errs.length === 0, 'no page errors' + (h.errs.length ? ': ' + h.errs.join(' | ') : ''));
  console.log(n + ' checks, ' + bad + ' failed'); await h.browser.close(); process.exitCode = bad ? 1 : 0;
})();
