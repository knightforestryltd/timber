const { start, BASE } = require('./e2e');
(async () => {
  const h = await start({ log: !!process.env.LOG });
  const env = h.env; let n = 0, bad = 0; const t = (c, m) => { n++; if (!c) bad++; console.log((c ? 'ok   ' : 'FAIL ') + m); };
  env.props.drvConfig = JSON.stringify({ units: [{ id: 'u1', name: 'Truck 1', plate: 'ABC' }] });
  let r = env.post('sync', { action: 'setPassword', newPassword: 'secret1', deviceName: 'Owner' }); const KEY = r.key, TOK = r.adminToken;
  // ---- fresh device: sign-in screen, make admin ----
  let pg = await h.open('index.html');
  t(await pg.isVisible('#kfSignIn'), 'fresh device shows the sign-in screen');
  t(!(await pg.isVisible('#loginOverlay')), 'old Connect screen not shown (company known)');
  await pg.fill('#kfsPw', 'secret1'); await pg.fill('#kfsName', 'Test phone'); await pg.click('#kfsAdmin'); await pg.waitForTimeout(1500);
  const ls = await pg.evaluate(() => ({ tok: localStorage.getItem('kfAdminToken'), key: localStorage.getItem('kfKey'), url: localStorage.getItem('kfCompanyUrl') }));
  t(ls.tok && ls.key === KEY && ls.url === BASE, 'device became admin (token + key stored, no password stored)');
  t(!(await pg.evaluate(() => JSON.stringify(localStorage))).includes('secret1'), 'password not stored anywhere on the device');
  // ---- trucks page as admin ----
  pg = await h.open('trucks.html');
  await pg.waitForTimeout(800);
  t((await pg.textContent('#view')).includes('Truck 1'), 'Units list shows the migrated Truck 1');
  t(await pg.isVisible('#kfAdminBadge'), 'Admin badge in header');
  await pg.click('text=Truck 1'); await pg.waitForTimeout(300);
  await pg.click('text=Edit unit'); await pg.fill('#uf_unitNo', 'T1'); await pg.selectOption('#uf_trackHours', 'yes'); await pg.click('#ufGo'); await pg.waitForTimeout(800);
  t(env.ctx.rows_('Units')[0].unitNo === 'T1' && env.ctx.rows_('Units')[0].trackHours === 'yes', 'unit edited from the page');
  // new work order, major
  await pg.click('text=New work order'); await pg.fill('#nwD', 'Leaking hub'); await pg.selectOption('#nwS', 'major'); await pg.click('#nwGo'); await pg.waitForTimeout(900);
  t(env.ctx.rows_('Units')[0].status === 'Out of service', 'major work order put the unit out of service');
  await pg.fill('#wo_mechanicName', 'Mike'); await pg.fill('#wo_mechHours', '2.5'); await pg.fill('#wo_mechRate', '40'); await pg.fill('#wo_workDone', 'New seal');
  await pg.click('#woClose'); await pg.waitForTimeout(1200);
  const wo = env.ctx.rows_('WorkOrders')[0];
  t(wo.status === 'Done' && Number(wo.laborCost) === 112, 'closed from the page: labour 2.5 x 40 x 1.12 = ' + wo.laborCost);
  t(env.ctx.rows_('Units')[0].status === 'In service', 'back in service after confirm');
  t(env.ctx.rows_('Expenses').length === 1, 'one expense for the work order');
  // PM sheet
  await h.open('trucks.html').then(async p2 => {
    await p2.click('button[data-t="pm"]'); await p2.waitForTimeout(300);
    await p2.click('#view button.btn-outline'); await p2.waitForTimeout(900);
    await p2.click('text=PM-A'); await p2.waitForTimeout(400);
    await p2.click('#pmAllOk');
    await p2.locator('.item').nth(2).locator('button[data-a="defect"]').click();
    await p2.locator('#pmSig').scrollIntoViewIfNeeded(); const box = await p2.locator('#pmSig').boundingBox(); await p2.mouse.move(box.x + 20, box.y + 20); await p2.mouse.down(); await p2.mouse.move(box.x + 120, box.y + 60); await p2.mouse.up();
    await p2.click('#pmGo'); await p2.waitForTimeout(1500); 
    const ins = env.ctx.rows_('Inspections');
    t(ins.length === 1 && ins[0].result === 'DEFECTS', 'PM-A sheet saved with a defect');
    t(env.ctx.rows_('WorkOrders').length === 2, 'defect became a work order');
    await p2.close();
  });
  t(h.errs.length === 0, 'no page errors' + (h.errs.length ? ': ' + h.errs.join(' | ') : ''));
  console.log(n + ' checks, ' + bad + ' failed'); await h.browser.close(); process.exitCode = bad ? 1 : 0;
})();
