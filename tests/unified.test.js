const { chromium, devices } = require('playwright');
const { makeEnv, registry } = require('./gasmock2');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = require('path').resolve(__dirname, '..'), R = ROOT + '/';
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'text/javascript' : f.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
const B = 'http://localhost:8126/';
const U = id => 'https://script.google.com/macros/s/' + id + '/exec';

(async () => {
  await new Promise(r => server.listen(8126, r));
  // Knight's old separate scripts with data
  const oq = makeEnv({ file: R + 'quote-apps-script-v3.gs', url: U('OLDQ') }), ot = makeEnv({ file: R + 'tickets-apps-script.gs', url: U('OLDT') });
  const oy = makeEnv({ file: R + 'yard-apps-script.gs', url: U('OLDY') }), od = makeEnv({ file: R + 'drivers-apps-script.gs', url: U('OLDD') });
  oq.post({ action: 'setPassword', newPassword: 'knight1' });
  const KN_SETTINGS = { locations: [{ id: 1, name: 'Barmac', address: 'Barmac AB', species: [{ name: 'Birch', pricePerTonne: 90 }] }], units: [{ id: 9, name: 'Tandem', hourly: 150, fuel: 40 }], companyName: 'Knight Forestry Ltd', speed: 90, fuelPrice: 1.5, gst: 5 };
  oq.post({ action: 'saveSettings', password: 'knight1', settings: KN_SETTINGS });
  oq.post({ customerName: 'Bob', options: [{ location: 'Barmac', species: 'Birch', truck: 'Tandem', tonnes: 10, total: 1050 }] });
  ot.post({ action: 'save', row: ['KF-1', 'Birch', 'Bob', 'Barmac', 1, 2, 1, '', '', '', ''] });
  oy.post({ action: 'add', yard: 'Home', species: 'Birch', tonnes: 40 });
  od.post({ action: 'adminSetPassword', newPassword: 'drvadmin' });
  od.post({ action: 'adminSaveDriver', password: 'drvadmin', driver: { name: 'Sam', passcode: '2468' } });
  const kn = makeEnv({ file: R + 'company-apps-script.gs', url: U('KNNEW') });     // Knight's new single script
  const bro = makeEnv({ file: R + 'company-apps-script.gs', url: U('BRO') });       // a brother's new single script

  const browser = await chromium.launch();
  const route = async ctx => {
    await ctx.route('https://script.google.com/**', async rt => {
      const req = rt.request(), u = new URL(req.url()), base = u.origin + u.pathname, env = registry[base];
      if (!env) return rt.fulfill({ status: 404, body: '' });
      env.reset(); const params = Object.fromEntries(u.searchParams);
      const out = req.method() === 'POST' ? env.env.doPost({ parameter: params, postData: { contents: req.postData() } }) : env.env.doGet({ parameter: params });
      rt.fulfill({ status: 200, contentType: 'application/json', body: out.text });
    });
    await ctx.route(/googleapis|gstatic|cdnjs/, rt => rt.abort());
  };
  const phone = async (init) => { const ctx = await browser.newContext({ ...devices['Pixel 5'] }); await route(ctx); if (init) await ctx.addInitScript(init.fn, init.arg); const p = await ctx.newPage(); p.errors = []; p.on('pageerror', e => p.errors.push(p.url() + ' ' + e.message)); p.on('dialog', d => { p.lastDialog = d.message(); d.accept(); }); return p; };

  // ======== A) a brother's brand-new phone ========
  let p = await phone();
  await p.goto(B + 'index.html');
  ok(await p.evaluate(() => !document.getElementById('loginOverlay').classList.contains('hidden')) && !(await p.textContent('#companyNameBanner')).includes('Knight'), 'fresh phone: connect screen, no Knight name');
  ok(await p.evaluate(() => getComputedStyle(document.getElementById('companyLogo')).visibility) === 'hidden', 'no Knight logo before set-up');
  await p.fill('#coUrl', U('BRO')); await p.$eval('#btnConnect', b => b.click());
  await p.waitForSelector('#setupBox:not(.hidden)');
  ok(true, 'new link -> Set up your company');
  await p.fill('#suName', 'Smith Hauling'); await p.fill('#suPw', 'smith1'); await p.fill('#suPw2', 'smith1'); await p.fill('#suEmail', 'office@smith.example');
  await p.setInputFiles('#suLogo', R + 'icon-192.png');
  await Promise.all([p.waitForNavigation(), p.$eval('#btnSetup', b => b.click())]);
  await p.waitForLoadState('load'); await p.waitForTimeout(600);
  ok((await p.textContent('#companyNameBanner')) === 'Smith Hauling', 'banner shows the new company');
  ok(await p.evaluate(() => (document.getElementById('companyLogo').src || '').startsWith('data:image')), 'their logo shows');
  ok(await p.evaluate(() => settings.units.length === 0 && settings.locations.length === 0), 'no sample trucks, no Knight locations');
  ok(await p.evaluate(() => kfCo.unified() && /svc=loads&k=/.test(settings.sheetsUrl) && /svc=tickets&k=/.test(localStorage.getItem('scriptUrl'))), 'every page link filled from the one link');
  ok(await p.evaluate(() => document.getElementById('loginOverlay').classList.contains('hidden')), 'connected');
  ok(await p.isVisible('#unifiedBox') && (await p.textContent('#unifiedName')).includes('Smith'), 'settings show the single company link');
  const brProfile = bro.get({ svc: 'sync', profile: '1', k: bro.props.companyKey }).profile;
  ok(brProfile.name === 'Smith Hauling' && brProfile.email === 'office@smith.example' && brProfile.logo.startsWith('data:image/png'), 'profile saved in their sheet');
  // add a truck and save to company
  await p.evaluate(() => { settings.units.push({ id: 1, name: 'Smith Tri', hourly: 160, fuel: 45, tonnes: 30 }); saveSettings(); markDirty(); });
  await p.fill('#pwCurrent', 'smith1'); await p.click('#btnSaveCompany'); await p.waitForFunction(() => /Saved to company/.test(document.getElementById('syncStatus').textContent));
  ok(bro.get({ svc: 'sync', settings: '1', k: bro.props.companyKey }).units[0].name === 'Smith Tri', 'Save to Company -> their sheet');
  // tickets: no "knight" password on a company device
  await p.goto(B + 'scale.html');
  ok(await p.isVisible('#home') && !(await p.isVisible('#login')), 'Tickets opens without the old password');
  await p.evaluate(async () => { await fetch(SCRIPT_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ action: 'save', row: ['SM-1', 'Birch', 'Joe', 'Pit', 1, 2, 1, '', '', '', ''] }) }); });
  ok(bro.get({ svc: 'tickets', k: bro.props.companyKey }).rows[0][0] === 'SM-1', 'ticket saved to their sheet');
  // billing: company info shared, invoice numbers from the sheet
  await p.goto(B + 'invoices.html'); await p.waitForTimeout(400);
  ok((await p.textContent('#companyNameBanner')) === 'Smith Hauling', 'billing banner');
  await p.click('#menu button:nth-child(3)');
  ok(await p.isVisible('#coPwWrap') && await p.inputValue('#coName') === 'Smith Hauling', 'billing settings: shared company info');
  await p.fill('#coGst', '999'); await p.fill('#coPw', 'smith1'); await p.click('#coPwWrap ~ button'); await p.waitForTimeout(500);
  ok(bro.get({ svc: 'sync', profile: '1', k: bro.props.companyKey }).profile.gst === '999', 'GST# saved for every device');
  await p.evaluate(() => showMenu()); await p.click('#menu button:nth-child(2)'); await p.waitForFunction(() => document.getElementById('newInvNum').value);
  const inv1 = await p.inputValue('#newInvNum'); await p.evaluate(() => genNewInvNum(true)); await p.waitForFunction(v => document.getElementById('newInvNum').value !== v, inv1);
  const inv2 = await p.inputValue('#newInvNum');
  ok(/^SM-\d{4}-\d{4}-01$/.test(inv1) && /-02$/.test(inv2), 'invoice numbers from the sheet: ' + inv1 + ', ' + inv2);
  ok(!(await p.evaluate(() => invoiceHtml(calcNew()))).includes('Knight'), 'invoice has no Knight text');
  // drivers: admin opens on a company device, add a driver
  await p.goto(B + 'drivers.html#settings'); await p.waitForSelector('#drvNew');
  ok(true, 'drivers settings open without a separate admin password');
  await p.click('#drvNew'); await p.fill('#dfName', 'Joe'); await p.fill('#dfPass', '1357'); await p.click('#dfOk'); await p.waitForTimeout(400);
  ok(bro.get({ svc: 'drivers', action: 'drivers' }).drivers.includes('Joe'), 'driver added to their sheet');
  ok(p.errors.length === 0, 'A: no page errors ' + p.errors.join(' | '));

  // a driver's own phone: just the link + passcode
  const dp = await phone();
  await dp.goto(B + 'drivers.html'); await dp.fill('#urlIn', U('BRO')); await dp.click('#urlSave');
  await dp.waitForSelector('#lgName option:nth-child(2)', { state: 'attached' });
  await dp.selectOption('#lgName', 'Joe'); await dp.fill('#lgPass', '1357'); await dp.click('#lgGo'); await dp.waitForSelector('#stUnit');
  ok(true, 'driver phone: company link + passcode is enough');
  ok(dp.errors.length === 0, 'driver phone: no page errors ' + dp.errors.join(' | '));

  // ======== B) Knight moves from the separate scripts ========
  const legacy = (o) => { if (document.cookie.includes('seeded=1')) return; document.cookie = 'seeded=1; path=/';
    localStorage.setItem('knightForestrySettings_v3', JSON.stringify(Object.assign({ syncUrl: o.q, sheetsUrl: o.q, apiKey: '' }, o.s)));
    localStorage.setItem('scriptUrl', o.t); localStorage.setItem('yardUrl', o.y); localStorage.setItem('driversUrl', o.d); localStorage.setItem('kfCompanyRev', '1');
    localStorage.setItem('kfCompany', JSON.stringify({ name: 'Knight Forestry Ltd', gst: 'KN-GST' })); localStorage.setItem('coLoggedIn', '1'); };
  const legacyArgs = { q: U('OLDQ'), t: U('OLDT'), y: U('OLDY'), d: U('OLDD'), s: KN_SETTINGS };
  const kp = await phone({ fn: legacy, arg: legacyArgs });
  await kp.goto(B + 'index.html#'); await kp.click('#nav-settings'); await kp.waitForTimeout(500);
  ok(await kp.isVisible('#moveBox'), 'old set-up shows "Move to one company sheet"');
  ok((await kp.textContent('#companyNameBanner')) === 'Knight Forestry Ltd' && await kp.evaluate(() => document.getElementById('companyLogo').src.endsWith('logo.jpg')), 'old set-up keeps the Knight name and logo');
  await kp.evaluate(() => document.getElementById('moveBox').open = true);
  await kp.fill('#mvUrl', U('KNNEW')); await kp.fill('#mvPw', 'knight1'); await kp.fill('#mvDrvPw', 'drvadmin'); await kp.click('#btnMove');
  await kp.waitForFunction(() => /Done\.|Could not/.test(document.getElementById('mvMsg').textContent), null, { timeout: 30000 });
  const mv = await kp.textContent('#mvMsg');
  ok(/1 loads, 1 tickets, 1 inventory entries, 1 drivers/.test(mv) && /other devices will be asked/.test(mv), 'move: ' + mv);
  const KK = kn.props.companyKey;
  ok(kn.get({ svc: 'loads', k: KK }).rows[0].customerName === 'Bob' && kn.get({ svc: 'sync', settings: '1', k: KK }).locations[0].name === 'Barmac', 'Knight data in the new sheet');
  const kprof = kn.get({ svc: 'sync', profile: '1', k: KK }).profile;
  ok(kprof.name === 'Knight Forestry Ltd' && kprof.gst === 'KN-GST' && kprof.logo.startsWith('data:image'), 'Knight company info + logo moved');
  ok(await kp.evaluate(() => kfCo.unified() && settings.locations[0].name === 'Barmac' && localStorage.getItem('kfCompanyId')), 'this phone now uses the single link, data kept');
  ok(oq.get({ settings: '1' }).movedTo === U('KNNEW'), 'old Company Sync points to the new link');
  // Knight's second phone (still on the old scripts) gets the switch prompt, keeps its data
  const kp2 = await phone({ fn: legacy, arg: legacyArgs });
  await kp2.goto(B + 'index.html'); await kp2.waitForFunction(() => !document.getElementById('loginOverlay').classList.contains('hidden'), null, { timeout: 10000 });
  ok((await kp2.textContent('#coMsg')).includes('moved'), 'second phone: "your company moved" prompt');
  await kp2.fill('#coPass', 'knight1'); await Promise.all([kp2.waitForNavigation(), kp2.$eval('#btnConnect', b => b.click())]); await kp2.waitForTimeout(500);
  ok(await kp2.evaluate(() => kfCo.unified() && kfCo.base().includes('KNNEW') && settings.locations.length === 1 && !!localStorage.getItem('kfCompany')), 'second phone switched without losing anything');
  ok(!kp2.lastDialog || !/removes it from this device/.test(kp2.lastDialog), 'no wipe warning for the same company');

  // ======== C) a Knight phone connected to the brother's company: guard ========
  // Knight changes the company password: this phone's key stops working and it is sent back to Connect
  kn.post({ action: 'setPassword', password: 'knight1', newPassword: 'knight2' }, { svc: 'sync' });
  await kp2.goto(B + 'index.html'); await kp2.waitForFunction(() => !document.getElementById('loginOverlay').classList.contains('hidden'), null, { timeout: 10000 });
  ok(await kp2.inputValue('#coUrl') === U('KNNEW'), 'old key refused -> Connect again (link filled in)');
  // ... and someone types the brother's link instead
  await kp2.fill('#coUrl', U('BRO')); await kp2.fill('#coPass', 'smith1'); kp2.lastDialog = '';
  await Promise.all([kp2.waitForNavigation(), kp2.$eval('#btnConnect', b => b.click())]); await kp2.waitForTimeout(500);
  ok(/still holds data for Knight Forestry Ltd/.test(kp2.lastDialog || ''), 'warning before mixing companies: ' + kp2.lastDialog);
  ok(await kp2.evaluate(() => settings.locations.length === 0 && settings.units[0].name === 'Smith Tri' && JSON.parse(localStorage.getItem('kfCompany')).name === 'Smith Hauling'), 'Knight data removed, Smith data loaded: ' + JSON.stringify(await kp2.evaluate(() => ({ l: settings.locations, u: settings.units, co: localStorage.getItem('kfCompany') && JSON.parse(localStorage.getItem('kfCompany')).name, base: kfCo.base() }))));
  ok(kn.get({ svc: 'sync', settings: '1', k: kn.props.companyKey }).locations.length === 1, "Knight's sheet untouched");

  // switch company button
  await kp2.click('#nav-settings'); await kp2.waitForTimeout(300);
  await Promise.all([kp2.waitForNavigation(), kp2.click('#btnSwitchCo')]); await kp2.waitForTimeout(300);
  ok(await kp2.evaluate(() => !document.getElementById('loginOverlay').classList.contains('hidden')) && await kp2.evaluate(() => !localStorage.getItem('kfKey') && !localStorage.getItem('kfCompany')), 'Switch company: device cleared, connect screen');

  for (const pg of [kp, kp2]) ok(pg.errors.length === 0, 'B/C: no page errors ' + pg.errors.join(' | '));
  console.log(`single-link tests: ${pass} passed, ${fail} failed`);
  await browser.close(); server.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
