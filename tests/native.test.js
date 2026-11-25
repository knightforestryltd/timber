// Runs the pages as the Android app would see them: a fake window.Capacitor with the
// BackgroundGeolocation, Filesystem and Share plugins.
const { chromium, devices } = require('playwright');
const { makeEnv } = require('./gasmock');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = require('path').resolve(__dirname, '..');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
(async () => {
  await new Promise(r => server.listen(8125, r));
  const g = makeEnv(); const call = b => { g.reset(); return g.post(b); };
  call({ action: 'adminSetPassword', newPassword: 'boss1' });
  call({ action: 'adminSaveConfig', password: 'boss1', config: { units: [{ name: 'T1' }] } });
  call({ action: 'adminSaveDriver', password: 'boss1', driver: { name: 'Sam', passcode: '1111' } });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 5'], geolocation: { latitude: 53.2, longitude: -114.9 }, permissions: ['geolocation'] });
  await ctx.route('https://script.google.com/**', async route => { const req = route.request(); g.reset(); const out = req.method() === 'POST' ? g.post(JSON.parse(req.postData())) : g.get(Object.fromEntries(new URL(req.url()).searchParams)); route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) }); });
  await ctx.addInitScript(() => {
    window.__bg = { watchers: [], removed: [] }; window.__shared = [];
    window.Capacitor = { isNativePlatform: () => true, Plugins: {
      BackgroundGeolocation: { addWatcher(opts, cb) { window.__bg.watchers.push({ opts, cb }); return Promise.resolve('W' + window.__bg.watchers.length); }, removeWatcher(o) { window.__bg.removed.push(o.id); return Promise.resolve(); }, openSettings() { return Promise.resolve(); } },
      Filesystem: { writeFile(o) { window.__written = o; return Promise.resolve({ uri: 'file:///cache/' + o.path }); } },
      Share: { share(o) { window.__shared.push(o); return Promise.resolve({}); } }
    } };
    if (!localStorage.getItem('t')) { localStorage.setItem('t', '1'); localStorage.setItem('kfDrvUrl', JSON.stringify('https://script.google.com/macros/s/T/exec')); }
    window.__kfAutoTickMs = 1e9;
  });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(page.url() + ' ' + e.stack)); page.on('dialog', d => d.accept());
  await page.goto('http://localhost:8125/drivers.html');
  ok(await page.evaluate(() => window.kfNative === true), 'app detected');
  await page.waitForSelector('#lgName option:nth-child(2)', { state: 'attached' });
  await page.selectOption('#lgName', 'Sam'); await page.fill('#lgPass', '1111'); await page.click('#lgGo');
  await page.waitForSelector('#stUnit'); await page.selectOption('#stUnit', 'T1'); await page.fill('#stOdo', '100'); await page.check('#stOdoOk'); await page.click('#stGo');
  await page.waitForSelector('#aPre'); await page.waitForTimeout(300);
  const w = await page.evaluate(() => window.__bg.watchers.map(x => x.opts));
  ok(w.length === 1 && w[0].backgroundMessage && w[0].requestPermissions, 'background GPS watcher started at shift start: ' + JSON.stringify(w));
  ok((await page.textContent('#wakeBadge')).includes('screen off'), 'badge: GPS runs with screen off');
  ok((await page.textContent('#view-drivers')).includes('Shift in progress'), 'app GPS help shown');
  // GPS fixes from the native plugin drive the auto status
  await page.evaluate(() => { const cb = window.__bg.watchers[0].cb; const t = Date.now(); cb({ latitude: 53.3, longitude: -114.9, accuracy: 8, speed: 20, time: t }); cb({ latitude: 53.31, longitude: -114.9, accuracy: 8, speed: 21, time: t + 5000 }); });
  ok(await page.evaluate(() => curStatus()) === 'D', 'native fixes over 40 km/h -> Driving');
  await page.evaluate(() => pushShift());
  ok(g.sheets.Positions && g.sheets.Positions._data().length - 1 >= 2, 'trail points from background fixes reach the office');
  // hidden page is not a GPS gap in the app
  await page.evaluate(() => { LS.set('kfDrvHiddenAt', Date.now() - 20 * 60000); document.dispatchEvent(new Event('visibilitychange')); });
  ok(await page.evaluate(() => (shift.gpsGaps || []).length) === 0, 'no GPS gap recorded while the app runs in the background');
  // print / share goes to the phone share screen
  await page.evaluate(() => { document.querySelector('#toast').classList.remove('show'); });
  await page.click('#aPrint'); await page.click('#prToday'); await page.waitForSelector('#psShare', { timeout: 30000 });
  ok(!(await page.$('#psPrint')) && !(await page.$('#psDown')), 'browser-only print/download hidden in the app');
  await page.click('#psShare'); await page.waitForTimeout(500);
  const sh = await page.evaluate(() => ({ s: window.__shared[0], w: window.__written && { path: window.__written.path, dir: window.__written.directory, len: window.__written.data.length } }));
  ok(sh.s && sh.s.files[0].startsWith('file:///cache/Driver log') && sh.w.dir === 'CACHE' && sh.w.len > 20000, 'PDF written and shared natively: ' + JSON.stringify(sh));
  // back button closes the sheet
  await page.evaluate(() => history.back()); await page.waitForTimeout(300);
  ok(!(await page.evaluate(() => document.getElementById('sheetOv').classList.contains('show'))), 'back closes the pop-up');
  // stopping the watcher when the shift goes away
  await page.evaluate(() => stopWatch());
  ok(await page.evaluate(() => window.__bg.removed.length === 1), 'GPS watcher removed');
  // invoices in the app: preview in-page, PDF via share
  await page.goto('http://localhost:8125/invoices.html'); await page.click('#menu');
  await page.evaluate(() => openPreview(['<p>Hello invoice</p>']));
  ok(await page.$('iframe') !== null, 'invoice preview opens inside the app');
  await page.evaluate(() => history.back()); await page.waitForTimeout(300);
  ok(await page.$('iframe') === null, 'back closes the preview');
  await page.evaluate(() => deliverPdf(new Blob(['%PDF-1.4'], { type: 'application/pdf' }), 'Invoice KF-1.pdf', 'Invoice'));
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => window.__shared.some(s => s.files[0].endsWith('Invoice KF-1.pdf'))), 'invoice PDF shared natively');
  ok(errors.length === 0, 'no page errors: ' + errors.join(' | '));
  console.log(`app (native) tests: ${pass} passed, ${fail} failed`);
  await browser.close(); server.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
