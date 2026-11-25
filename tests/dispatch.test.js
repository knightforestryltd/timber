// Dispatch: place + cycle time on each load, status colours, pending / completed (paid) lists, customer text.
const { chromium, devices } = require('playwright');
const { makeEnv, registry } = require('./gasmock2');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), R = ROOT + '/';
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };
const server = http.createServer((req, res) => { const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0])); if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html' : f.endsWith('.css') ? 'text/css' : f.endsWith('.jpg') ? 'image/jpeg' : 'text/javascript' }); fs.createReadStream(f).pipe(res); });
const CO = 'https://script.google.com/macros/s/DSP/exec';
(async () => {
  await new Promise(r => server.listen(8129, r));
  const g = makeEnv({ file: R + 'company-apps-script.gs', url: CO });
  const K = g.post({ action: 'setPassword', newPassword: 'boss1' }, { svc: 'sync' }).key;
  g.post({ action: 'saveProfile', password: 'boss1', profile: { name: 'Knight Forestry Ltd' } }, { svc: 'sync' });
  g.post({ action: 'saveSettings', password: 'boss1', settings: { locations: [{ name: 'Barmac' }], companyName: 'Knight Forestry Ltd' }, force: true }, { svc: 'sync' });
  const book = (name, addr, extra) => g.post(Object.assign({ customerName: name, phone: '780 555 0199', address: addr, options: [{ location: 'Barmac', species: 'Birch', truck: 'Tandem', tonnes: 10, km: 62, driveHours: 1.6, totalHours: 10.6, total: 1050 }] }, extra || {}), { svc: 'loads', k: K });
  book('Bob Smith', '123 Main St, Blackie, AB'); book('Ann Lee', '1 Centre St, Calgary, AB'); book('Cal Ross', 'Nowhere road'); book('Dee Paid', '5 Rd, Blackie, AB');
  g.post({ action: 'updateStatus', customerName: 'Ann Lee', status: 'Delivered', loadId: 'KF-2026-1125-07', netTonnes: 9 }, { svc: 'loads', k: K });
  g.post({ action: 'updateStatus', customerName: 'Dee Paid', status: 'Paid', loadId: 'KF-2026-1120-01' }, { svc: 'loads', k: K });
  g.post({ action: 'save', row: ['KF-2026-1125-01', 'Birch', 'Bob Smith', 'Barmac', 15000, 25200, 10200, '', '', '', ''] }, { svc: 'tickets', k: K });
  // server: places
  const rows = g.get({ svc: 'loads', k: K }).rows, bob = rows.find(r => r.customerName === 'Bob Smith'), ann = rows.find(r => r.customerName === 'Ann Lee');
  ok(/^Blackie, AB · \d+ km S\w? of Calgary$/.test(bob.place), 'place line: ' + bob.place);
  ok(ann.place === 'Calgary, AB', 'in the city: ' + ann.place);
  ok(!rows.find(r => r.customerName === 'Cal Ross').place, 'unknown address: no place line');
  ok(g.tab('Places')._data().length === 5, 'addresses looked up once and remembered (4 different + header)');
  g.get({ svc: 'loads', k: K }); ok(g.tab('Places')._data().length === 5, 'no repeat lookups');
  // settings saved from the Quote page keep the customer-text setting
  g.post({ action: 'saveDispatch', password: 'boss1', dispatch: { texts: true, template: '' } }, { svc: 'sync' });
  g.post({ action: 'saveSettings', password: 'boss1', settings: { locations: [{ name: 'Barmac' }], companyName: 'Knight Forestry Ltd' }, force: true }, { svc: 'sync' });
  ok(g.get({ svc: 'sync', settings: '1', k: K }).dispatch.texts === true, 'Save to Company keeps the customer-text setting');
  g.post({ action: 'saveDispatch', password: 'boss1', dispatch: { texts: false } }, { svc: 'sync' });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 5'] });
  await ctx.route('https://script.google.com/**', async rt => { const req = rt.request(), u = new URL(req.url()), env = registry[u.origin + u.pathname]; env.reset(); const params = Object.fromEntries(u.searchParams); const out = req.method() === 'POST' ? env.env.doPost({ parameter: params, postData: { contents: req.postData() } }) : env.env.doGet({ parameter: params }); rt.fulfill({ status: 200, contentType: 'application/json', body: out.text }); });
  await ctx.addInitScript(({ CO, K, meta }) => { if (document.cookie.includes('seeded=1')) return; document.cookie = 'seeded=1; path=/';
    const url = svc => CO + '?svc=' + svc + '&k=' + K; localStorage.setItem('kfCompanyUrl', CO); localStorage.setItem('kfKey', K); localStorage.setItem('kfCompanyId', meta.companyId);
    localStorage.setItem('knightForestrySettings_v3', JSON.stringify({ syncUrl: url('sync'), sheetsUrl: url('loads'), companyName: 'Knight Forestry Ltd', locations: [{ name: 'Barmac' }] }));
    localStorage.setItem('scriptUrl', url('tickets')); localStorage.setItem('kfCompany', JSON.stringify({ name: 'Knight Forestry Ltd' })); localStorage.setItem('kfCompanyRev', '0');
    localStorage.setItem('kfDrvSession', JSON.stringify({ name: 'Kevin', passcode: 'x' })); localStorage.setItem('kfDrvCtx', JSON.stringify({ driver: { phone: '403 000 0000' } })); }, { CO, K, meta: g.get({ settings: '1' })._meta });
  const p = await ctx.newPage(); const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto('http://localhost:8129/dispatch.html'); await p.waitForTimeout(800);
  const cards = await p.$$eval('#loadList .ld', els => els.map(e => ({ cls: e.className, txt: e.textContent.replace(/\s+/g, ' ') })));
  ok(cards.length === 3, 'pending list: 3 loads (paid one not here)');
  const cb = cards.find(c => c.txt.includes('Bob Smith')), ca = cards.find(c => c.txt.includes('Ann Lee'));
  ok(/Blackie, AB · \d+ km S\w? of Calgary/.test(cb.txt) && /10\.6 hrs cycle/.test(cb.txt) && /62 km one way/.test(cb.txt), 'card shows place, cycle time, distance: ' + cb.txt);
  ok(/delivered/.test(ca.cls) && /Delivered · pending billing/.test(ca.txt), 'delivered load: amber card + label');
  ok(/waiting/.test(cb.cls), 'not started: plain card');
  ok(/1\s*waiting|2 waiting/.test(await p.textContent('#listCounts')) && /1 paid/.test(await p.textContent('#listCounts')), 'counts: ' + await p.textContent('#listCounts'));
  await p.click('#tabDone'); await p.waitForTimeout(200);
  const done = await p.$$eval('#loadList .ld', els => els.map(e => e.className + ' ' + e.textContent.replace(/\s+/g, ' ')));
  ok(done.length === 1 && /paid/.test(done[0]) && /Dee Paid/.test(done[0]) && /Paid · KF-2026-1120-01/.test(done[0]), 'completed list shows the paid load: ' + done[0]);
  await p.click('#tabPending');
  if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + '/dsp-list.png' });
  // turn customer texts on (company password) from Dispatch settings
  await p.evaluate(() => showDispatchSettings()); await p.check('#txOn'); await p.fill('#txPw', 'boss1'); await p.click('#txSave'); await p.waitForTimeout(400);
  ok((await p.textContent('#txMsg')).includes('every device') && g.get({ svc: 'sync', settings: '1', k: K }).dispatch.texts === true, 'texts switched on for every device');
  ok(await p.inputValue('#txDrvName') === 'Kevin' && await p.inputValue('#txDrvPhone') === '403 000 0000', "driver filled in from this phone's Drivers log-in");
  // start Bob's load with his ticket -> the text is offered
  await p.evaluate(() => showList()); await p.waitForTimeout(500);
  const bi = await p.evaluate(() => loads.findIndex(l => l.customerName === 'Bob Smith'));
  await p.evaluate(i => openLoad(i), bi); await p.evaluate(() => { const np = document.getElementById('notesPopup'); if (np) np.style.display = 'none'; });
  await p.fill('#ticketInput', 'KF-2026-1125-01'); await p.evaluate(() => checkTicket()); await p.waitForTimeout(600);
  ok(await p.evaluate(() => document.getElementById('textOv').classList.contains('show')), 'text offered when the load starts');
  if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + '/dsp-text.png' });
  const body = await p.inputValue('#txBody'), href = await p.getAttribute('#txGo', 'href');
  ok(/^Hi Bob, your load of birch is loaded and on its way\. Estimated arrival around \d{1,2}:\d{2}\s?[AP]M\. Your driver today is Kevin 403 000 0000\. - Knight Forestry Ltd$/.test(body), 'message: ' + body);
  ok(href.startsWith('sms:+17805550199?body=') && decodeURIComponent(href.split('body=')[1]) === body, 'opens the messaging app to the customer with the text ready');
  await p.click('#txNo');
  ok(!(await p.isHidden('#textBtn')), '"Text the customer" stays available on a started load');
  await p.evaluate(() => showList()); await p.waitForTimeout(600);
  const started = await p.$$eval('#loadList .ld.started', els => els.map(e => e.textContent.replace(/\s+/g, ' ')));
  if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + '/dsp-started.png' });
  ok(started.length === 1 && /Started · KF-2026-1125-01/.test(started[0]), 'started load: green card + label');
  // texts off -> nothing offered
  g.post({ action: 'saveDispatch', password: 'boss1', dispatch: { texts: false } }, { svc: 'sync' });
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('knightForestrySettings_v3')); s.dispatch = { texts: false }; localStorage.setItem('knightForestrySettings_v3', JSON.stringify(s)); });
  const ci = await p.evaluate(() => loads.findIndex(l => l.customerName === 'Cal Ross'));
  await p.evaluate(i => openLoad(i), ci); await p.fill('#ticketInput', 'KF-2026-1125-01'); await p.evaluate(() => checkTicket()); await p.waitForTimeout(500);
  ok(!(await p.evaluate(() => document.getElementById('textOv').classList.contains('show'))), 'texts off: nothing offered');
  ok(errors.length === 0, 'no page errors ' + errors.join(' | '));
  console.log(`dispatch tests: ${pass} passed, ${fail} failed`);
  await browser.close(); server.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
