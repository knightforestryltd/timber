const { chromium, devices } = require('playwright');
const { makeEnv } = require('./gasmock');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = process.env.SITE || require('path').resolve(__dirname, '..'), OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('FAIL:', m); } };
const SURL = 'https://script.google.com/macros/s/TEST/exec';

const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  const type = f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type }); fs.createReadStream(f).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(8123, r));
  const g = makeEnv(); const log = [];
  const call = b => { g.reset(); return g.post(b); };
  call({ action: 'adminSetPassword', newPassword: 'boss1' });
  call({ action: 'adminSaveConfig', password: 'boss1', config: { company: { name: 'Knight Forestry Ltd', address: 'Box 100, Drayton Valley AB', officeEmail: 'office@example.com' }, units: [{ name: 'Truck 7', plate: 'BX1234', trailerA: 'TA1', trailerB: 'TB2' }] } });
  call({ action: 'adminSaveDriver', password: 'boss1', driver: { name: 'Sam Driver', phone: '780-555-0100', passcode: '2468', licenseNo: 'AB123' } });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices[process.env.DEVICE || 'Pixel 5'], geolocation: { latitude: 53.223, longitude: -114.977, accuracy: 10 }, permissions: ['geolocation'] });
  let offline = false;
  await ctx.route('https://script.google.com/**', async route => {
    if (offline) return route.abort('internetdisconnected');
    const req = route.request(); let out;
    if (req.method() === 'POST') { const b = JSON.parse(req.postData()); log.push(b); g.reset(); out = g.post(b); }
    else { const u = new URL(req.url()); g.reset(); out = g.get(Object.fromEntries(u.searchParams)); }
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) });
  });
  await ctx.route('https://maps.googleapis.com/**', r => r.abort());
  const LF = path.join(__dirname, 'leaflet/package/dist');
  await ctx.route('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/**', r => { const f = r.request().url().split('/1.9.4/')[1]; r.fulfill({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.png') ? 'image/png' : 'text/javascript', body: fs.readFileSync(path.join(LF, f)) }); });
  await ctx.route('https://tile.openstreetmap.org/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: fs.readFileSync(path.join(ROOT, 'icon-192.png')) }));
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept(d.type() === 'prompt' ? 'DELETE' : undefined));
  await page.addInitScript(u => { if (!localStorage.getItem('kfInit')) { localStorage.setItem('kfInit', '1'); localStorage.setItem('kfDrvUrl', JSON.stringify(u)); } window.__kfAutoTickMs = 1000000; }, SURL);
  await page.goto('http://localhost:8123/drivers.html');

  // ---- log in ----
  await page.waitForSelector('#lgName option:nth-child(2)', { state: 'attached' });
  await page.selectOption('#lgName', 'Sam Driver'); await page.fill('#lgPass', '2468'); await page.click('#lgGo');
  await page.waitForSelector('#stUnit');
  ok(await page.$eval('#stSet', e => e.value) === 'ab', 'Alberta is the default rule set');
  const opts = await page.$$eval('#stSet option', o => o.map(x => x.value + '=' + x.textContent));
  ok(opts.length === 4 && /c1=70 h \/ 7 days/.test(opts[0]) && /c2=120 h \/ 14 days/.test(opts[1]) && /ab=Alberta provincial — 13 h driving · 15 h on duty · 24 h off per 24 d/.test(opts[2]) && /sk=Saskatchewan provincial — 13 h driving · 15 h on duty$/.test(opts[3]), 'four rule choices: ' + opts.join(' | '));
  ok(!(await page.$('#stRule')), 'no separate cycle list');
  await page.selectOption('#stUnit', 'Truck 7');
  ok(await page.$eval('#stTa', e => e.value) === 'TA1', 'trailer plates load');
  await page.fill('#stOdo', '250000'); await page.click('#stGo'); ok((await page.textContent('#stErr')).includes('Check the km'), 'must confirm odometer');
  await page.check('#stOdoOk'); await page.click('#stGo');
  await page.waitForSelector('#aPre');
  let sh = await page.evaluate(() => shift);
  ok(sh.events.length === 1 && sh.events[0].s === 'OFF', 'shift starts Off Duty');
  ok(sh.hosSet === 'ab', 'shift uses Alberta rules');
  const mt = await page.textContent('.meters');
  ok(mt.includes('On duty (15 h)') && mt.includes('Driving (13 h)') && !mt.includes('Elapsed') && !mt.includes('Cycle'), 'Alberta meters: 13 driving, 15 on duty, no elapsed, no cycle');
  ok(mt.includes('24 h off in 24 days'), '24 h off meter for Alberta: ' + mt);
  // ---- 24 h off in 24 calendar days ----
  const off = await page.evaluate(() => {
    const H = 3600000, D = 24 * H, now = Date.now();
    const L = limitsFor({ hosSet: 'ab' });
    const sh = (id, a, b) => ({ id, startedAt: new Date(a).toISOString(), closedAt: new Date(b).toISOString(), events: [{ id: id + 'a', t: new Date(a).toISOString(), s: 'ON' }, { id: id + 'b', t: new Date(b).toISOString(), s: 'OFF' }] });
    const saved = ctx.onBlocks; ctx.onBlocks = null; ctx.knownSince = '';
    // worked 12 h every day for 30 days, 12 h off between: never 24 h off
    const daily = []; for (let i = 30; i >= 1; i--) daily.push(sh('d' + i, now - i * D, now - i * D + 12 * H));
    const a = offStatus(L, now, daily);
    // same, but one 40 h break 10 days ago
    const brk = daily.filter(x => !['d10', 'd11'].includes(x.id));
    const b = offStatus(L, now, brk);
    // only 5 days on record: not yet due
    const c = offStatus(L, now, daily.slice(-5));
    // the break 23 days ago drops out on day 24
    const old = daily.filter(x => !['d23'].includes(x.id)); const d = offStatus(L, now, old);
    ctx.onBlocks = saved;
    const sk = offStatus(limitsFor({ hosSet: 'sk' }), now, daily);
    return { a: [a.have, a.overdue], b: [b.have, b.overdue, b.mustStartBy > now], c: [c.have, c.overdue, c.tracked, c.mustStartBy > now], d: [d.have, Math.round((d.mustStartBy - now) / D)], sk };
  });
  ok(off.a[0] === 0 && off.a[1], '12 h breaks only: 24 h off is overdue');
  ok(off.b[0] === 1 && !off.b[1] && off.b[2], 'a 36 h break 10 days ago counts, next due later');
  ok(off.c[0] === 0 && !off.c[1] && !off.c[2] && off.c[3], 'short history: not overdue, shows due date');
  ok(off.d[0] === 1 && off.d[1] <= 1, 'a break 22-23 days ago is about to drop out: ' + JSON.stringify(off.d));
  ok(off.sk === null, 'Saskatchewan has no 24 h off check');
  await page.waitForFunction(() => shift.events[0].place);
  ok(/Okotoks/.test(await page.evaluate(() => shift.events[0].place)), 'village name from script geocoder: ' + await page.evaluate(() => shift.events[0].place));

  // driving is blocked until pre-trip
  await page.click('[data-st="D"]'); await page.waitForSelector('#ptSave');
  ok(true, 'driving opens pre-trip');
  await page.click('#ptAll');
  await (await page.$('#ptSig')).scrollIntoViewIfNeeded(); const box = await (await page.$('#ptSig')).boundingBox();
  await page.mouse.move(box.x + 20, box.y + 40); await page.mouse.down(); await page.mouse.move(box.x + 120, box.y + 80); await page.mouse.move(box.x + 200, box.y + 30); await page.mouse.up();
  await page.click('#ptSave'); await page.waitForTimeout(1500); if (await page.$('#ptErr')) console.log('ptErr:', await page.textContent('#ptErr')); await page.waitForSelector('#aPre .tag.ok');
  sh = await page.evaluate(() => shift);
  const on = sh.events[sh.events.length - 1];
  ok(on.s === 'ON' && Math.abs(Date.now() - 30 * 60000 - new Date(on.t)) < 120000, 'pre-trip logs On Duty from 30 min ago');
  ok(await page.evaluate(() => curStatus()) === 'ON', 'stays on duty after pre-trip');

  // ---- automatic status from GPS ----
  await page.evaluate(() => { autoCheck({ lat: 53.3, lon: -114.9, at: new Date().toISOString(), kph: 62, acc: 8 }); autoCheck({ lat: 53.31, lon: -114.9, at: new Date().toISOString(), kph: 65, acc: 8 }); });
  ok(await page.evaluate(() => curStatus()) === 'D', 'over 40 km/h two readings = Driving');
  ok(await page.isVisible('#toast'), 'toast shown for auto driving');
  await page.evaluate(() => { anchor = { lat: 53.31, lon: -114.9, at: Date.now() - 16 * 60000 }; stoppedCheck(Date.now()); });
  let le = await page.evaluate(() => lastEvent());
  ok(le.s === 'ON' && le.auto === 'stop', 'stopped 15 min = On Duty');
  // a stop that began before the Driving entry starts right after it; one that began later starts at the stop
  await page.evaluate(() => { undoAuto(lastEvent().id); shift.events[shift.events.length - 1].t = new Date(Date.now() - 20 * 60000).toISOString(); normalize(shift); anchor = { lat: 53.31, lon: -114.9, at: Date.now() - 16 * 60000 }; stoppedCheck(Date.now()); });
  le = await page.evaluate(() => lastEvent());
  ok(le.s === 'ON' && Math.abs(new Date(le.t) - (Date.now() - 16 * 60000)) < 5000, 'On Duty starts when the truck stopped');
  await page.evaluate(() => { anchor.at = Date.now() - 31 * 60000; lastEvent().stopAt = anchor.at; stoppedCheck(Date.now()); });
  le = await page.evaluate(() => lastEvent());
  ok(le.s === 'OFF' && le.auto === 'stopoff', 'stopped 30 min = Off Duty');
  await page.click('#toastBtns button:first-child'); // Keep On Duty
  le = await page.evaluate(() => lastEvent());
  ok(le.s === 'ON' && le.keep, 'Keep On Duty reverts the auto Off Duty');
  await page.evaluate(() => { stoppedCheck(Date.now()); });
  ok(await page.evaluate(() => curStatus()) === 'ON', 'kept on duty stays on duty');

  // ---- duty status edit ----
  await page.evaluate(() => renderShiftHome());
  await page.click('#aEdit'); await page.waitForSelector('#evAdd');
  await page.click('#evAdd'); await page.waitForSelector('#efOk');
  const t = new Date(Date.now() - 10 * 60000); const pad = n => String(n).padStart(2, '0');
  await page.fill('#efT', pad(t.getHours()) + ':' + pad(t.getMinutes()));
  await page.fill('#efD', t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate()));
  await page.selectOption('#efS', 'D'); await page.click('#efOk');
  ok((await page.textContent('#efE')).includes('reason'), 'reason required');
  await page.fill('#efR', 'forgot to change to driving'); await page.click('#efOk');
  await page.waitForSelector('#evAdd');
  sh = await page.evaluate(() => shift);
  ok(sh.edits.length === 1 && sh.edits[0].action === 'add' && sh.events.some(e => e.edited && e.s === 'D'), 'status change added with reason');
  ok(sh.events.every((e, i, a) => !i || new Date(a[i - 1].t) <= new Date(e.t)), 'events stay in time order');
  // future time refused
  await page.click('#evAdd'); await page.waitForSelector('#efOk');
  const f = new Date(Date.now() + 3 * 3600000);
  await page.fill('#efD', f.getFullYear() + '-' + pad(f.getMonth() + 1) + '-' + pad(f.getDate())); await page.fill('#efT', pad(f.getHours()) + ':' + pad(f.getMinutes()));
  await page.fill('#efR', 'x'); await page.click('#efOk');
  ok((await page.textContent('#efE')).includes('future'), 'future time refused');
  await page.click('#efNo'); await page.waitForSelector('#evDone'); await page.click('#evDone');
  ok((await page.textContent('#aEdit')).includes('1 edited'), 'edit count on home');

  // ---- odometer edit ----
  await page.click('#aOdo'); await page.fill('#odS', '250010'); await page.click('#odOk');
  ok(await page.evaluate(() => shift.startOdo) === 250010, 'start km editable');

  // ---- trail queued + synced ----
  await page.evaluate(() => pushShift());
  const pos = g.sheets.Positions ? g.sheets.Positions._data().length - 1 : 0;
  ok(pos >= 4, 'GPS trail points reached the sheet: ' + pos);

  // ---- log sheet + PDF ----
  console.log('dbg', await page.evaluate(async () => { try { dayPageHtml(buildDay(dkey(new Date()), await getHistory(false), Date.now())); return 'ok'; } catch (e) { return e.stack; } }));
  await page.click('#aLog'); await page.waitForSelector('.paper');
  const paperText = await page.textContent('.paper');
  ok(paperText.includes("DRIVER'S DAILY LOG") && paperText.includes('Pre-trip inspection report') && paperText.includes('Alberta provincial'), 'paper log has graph header, pre-trip and rules');
  ok(paperText.includes('Edited: forgot to change to driving'), 'edit reason printed');
  const paper = await page.$('.paper'); await page.evaluate(() => { document.querySelectorAll('.paper').forEach(p => p.style.zoom = ''); });
  await paper.screenshot({ path: path.join(OUT, 'paper-log.png') });
  await page.click('#cls');
  const pdfInfo = await page.evaluate(async () => { const b = await makePdf([dkey(new Date())], await getHistory(false), Date.now()); const txt = await b.text(); return { size: b.size, pages: (txt.match(/\/Type \/Page[^s]/g) || []).length }; });
  ok(pdfInfo.size > 20000 && pdfInfo.pages >= 1, 'PDF made: ' + JSON.stringify(pdfInfo));
  await page.click('#aPrint'); await page.click('#prToday');
  await page.waitForSelector('#psPrint', { timeout: 30000 });
  ok(await page.$('#psDown') || await page.$('#psShare'), 'PDF ready with share or download');
  await page.click('#psNo');

  // ---- offline change syncs later ----
  offline = true; await ctx.setOffline(true);
  await page.evaluate(() => renderShiftHome());
  await page.click('[data-st="OFF"]'); await page.waitForSelector('#csOk'); await page.click('#csOk');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => dirty), 'offline change kept on phone');
  offline = false; await ctx.setOffline(false); await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForFunction(() => !dirty, null, { timeout: 10000 });
  ok(true, 'synced when back online');

  // ---- office edits the open shift -> phone adopts it ----
  g.reset(); const cur = g.post({ action: 'adminGetShift', password: 'boss1', shiftId: sh.id }).shift;
  cur.remarks = 'office note'; cur.startOdo = 250005;
  g.reset(); g.post({ action: 'adminSaveShift', password: 'boss1', shift: cur, status: 'Open' });
  await page.evaluate(() => pushShift());
  ok(await page.evaluate(() => shift.startOdo) === 250005 && await page.evaluate(() => !!shift.adminEditAt), 'phone takes the office copy');

  // ---- close + submit ----
  await page.evaluate(() => renderShiftHome());
  await page.click('#aClose'); await page.waitForSelector('#clGo');
  await page.fill('#clOdo', '250180'); await page.fill('#clRem', 'none');
  await (await page.$('#clSig')).scrollIntoViewIfNeeded(); const cb = await (await page.$('#clSig')).boundingBox();
  await page.mouse.move(cb.x + 20, cb.y + 40); await page.mouse.down(); await page.mouse.move(cb.x + 150, cb.y + 60); await page.mouse.up();
  await page.click('#clGo');
  await page.waitForSelector('#again', { timeout: 60000 });
  ok((await page.textContent('#view-drivers')).includes('emailed to the office'), 'submitted and emailed');
  const sub = log.filter(b => b.action === 'submitShift').pop();
  ok(sub && sub.pdfBase64 && sub.pdfBase64.length > 20000, 'PDF sent with the submit');
  ok(g.mails.length === 1 && g.mails[0].attachments[0].type === 'application/pdf', 'office email has the PDF');
  fs.writeFileSync(path.join(OUT, 'submitted.pdf'), Buffer.from(sub.pdfBase64, 'base64'));

  // ---- next shift: off duty since last close, km from last log ----
  await page.click('#again');
  await page.selectOption('#lgName', 'Sam Driver'); await page.fill('#lgPass', '2468'); await page.click('#lgGo');
  await page.waitForSelector('#stUnit'); await page.selectOption('#stUnit', 'Truck 7');
  ok(await page.$eval('#stOdo', e => e.value) === '250180', 'next shift loads last km');
  ok((await page.textContent('#stOdoHint')).includes('250180'), 'km hint shown');
  await page.click('#stHist'); await page.waitForSelector('[data-k]');
  ok((await page.$$('[data-k]')).length === 14, '14 days listed');
  await page.click('#hClose');
  await page.check('#stOdoOk'); await page.click('#stGo'); await page.waitForSelector('#aPre');
  const ev0 = await page.evaluate(() => shift.events[0]);
  ok(ev0.s === 'OFF' && Math.abs(new Date(ev0.t) - new Date(sub.shift.closedAt)) < 2000, 'new shift Off Duty from last shift close');

  // ---- admin ----
  await page.click('#tab-admin'); await page.fill('#adPw', 'boss1'); await page.click('#adGo');
  await page.waitForSelector('#slList [data-id]');
  ok((await page.$$('#slList [data-id]')).length === 2, 'admin shift list (open + submitted)');
  await page.click('#slList [data-id]:nth-child(2)'); await page.waitForSelector('#asEd');
  await page.click('#asEd'); await page.waitForSelector('#aeOk');
  await page.fill('#aeOe', '250190'); await page.click('#aeOk');
  ok((await page.textContent('#aeErr')).includes('reason'), 'admin edit needs reason');
  await page.fill('#aeWhy', 'dash photo shows 250190'); await page.click('#aeOk');
  await page.waitForSelector('#asDel');
  g.reset(); ok(g.post({ action: 'adminGetShift', password: 'boss1', shiftId: sub.shift.id }).shift.endOdo === 250190, 'admin edit saved');
  await page.click('#asCl');
  // map
  await page.click('#adSeg [data-s="map"]'); await page.waitForSelector('#mpDrv option:nth-child(2)', { state: 'attached' });
  const drvId = await page.$eval('#mpDrv option:nth-child(2)', o => o.value);
  await page.selectOption('#mpDrv', drvId);
  await page.waitForFunction(() => document.querySelector('#mpInfo') && /Duty status changes|needs/.test(document.querySelector('#mpInfo').textContent), null, { timeout: 20000 });
  const mapTxt = await page.textContent('#mpInfo');
  ok(mapTxt.includes('Duty status changes') && mapTxt.includes('15-minute positions'), 'admin map lists changes + positions');
  ok(await page.evaluate(() => !!window.L), 'map library loaded: ' + await page.evaluate(() => !!window.L));
  await page.screenshot({ path: path.join(OUT, 'admin-map.png') });
  // delete the open shift -> driver phone clears it
  await page.click('#adSeg [data-s="logs"]'); await page.waitForSelector('#slList [data-id]');
  await page.click('#slList [data-id]:nth-child(1)'); await page.waitForSelector('#asDel'); await page.click('#asDel');
  await page.waitForTimeout(500);
  await page.evaluate(() => pushShift()); await page.waitForTimeout(300);
  ok(await page.evaluate(() => shift === null), 'deleted shift removed from the phone');
  // settings
  await page.click('#tab-settings'); await page.waitForSelector('#ruDef');
  ok(await page.$eval('#ru_ab_maxOnDuty', e => e.value) === '15' && await page.$eval('#ru_ab_maxElapsed', e => e.value) === '0' && await page.$eval('#ru_sk_offCount', e => e.value) === '0' && await page.$eval('#ru_c2_cycleHours', e => e.value) === '120', 'settings table: four rule columns');
  await page.selectOption('#ruDef', 'sk'); await page.fill('#ru_ab_offCount', '3'); await page.click('#coSave'); await page.waitForFunction(() => /Saved/.test(document.querySelector('#coMsg').textContent));
  g.reset(); const savedR = g.post({ action: 'adminGetConfig', password: 'boss1' }).config.rules;
  ok(savedR.defaultSet === 'sk' && savedR.ab.offCount === 3, 'settings save the rule table');
  await page.click('#drvList [data-id]'); await page.waitForSelector('#dfPhone');
  ok(await page.$eval('#dfPhone', e => e.value) === '780-555-0100', 'driver phone in settings');

  ok(errors.length === 0, 'no page errors: ' + errors.join(' | '));
  console.log(`page tests: ${pass} passed, ${fail} failed`);
  await browser.close(); server.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
