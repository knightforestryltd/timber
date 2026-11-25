// Two devices on one company: tickets, dispatch and settings reach the other device by themselves;
// ticket edits never duplicate; Client / Supplier / Office copies; thermal printing (fake printer).
const { chromium, devices } = require('playwright');
const { makeEnv, registry } = require('./gasmock2');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = require('path').resolve(__dirname, '..'), R = ROOT + '/';
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
const B = 'http://localhost:8128/', CO = 'https://script.google.com/macros/s/LIVE/exec';

(async () => {
  await new Promise(r => server.listen(8128, r));
  const g = makeEnv({ file: R + 'company-apps-script.gs', url: CO });
  const K = g.post({ action: 'setPassword', newPassword: 'boss1' }, { svc: 'sync' }).key;
  const meta = g.get({ settings: '1' })._meta;
  g.post({ action: 'saveProfile', password: 'boss1', profile: { name: 'Knight Forestry Ltd', phone: '780-555-0100' } }, { svc: 'sync' });
  g.post({ action: 'saveSettings', password: 'boss1', settings: { locations: [{ name: 'Barmac', species: [{ name: 'Birch', pricePerTonne: 90 }] }], units: [{ name: 'Tandem', hourly: 150 }], companyName: 'Knight Forestry Ltd' }, force: true }, { svc: 'sync' });
  g.post({ customerName: 'Bob', options: [{ location: 'Barmac', species: 'Birch', truck: 'Tandem', tonnes: 10, total: 1050 }] }, { svc: 'loads', k: K });

  const browser = await chromium.launch();
  let offline = false;
  const phone = async (dev) => {
    const ctx = await browser.newContext({ ...devices[dev], permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true });
    await ctx.route('https://script.google.com/**', async rt => {
      if (offline && rt.request().frame().page().__dev === 'A') return rt.abort('internetdisconnected');
      const req = rt.request(), u = new URL(req.url()), env = registry[u.origin + u.pathname]; env.reset();
      const params = Object.fromEntries(u.searchParams);
      const out = req.method() === 'POST' ? env.env.doPost({ parameter: params, postData: { contents: req.postData() } }) : env.env.doGet({ parameter: params });
      rt.fulfill({ status: 200, contentType: 'application/json', body: out.text });
    });
    await ctx.route(/googleapis|cdnjs/, rt => rt.abort());
    await ctx.addInitScript(({ CO, K, meta }) => {
      if (document.cookie.includes('seeded=1')) return; document.cookie = 'seeded=1; path=/';
      // a device connected to the company, exactly as the Connect screen leaves it
      const base = CO, url = svc => base + '?svc=' + svc + '&k=' + K;
      localStorage.setItem('kfCompanyUrl', base); localStorage.setItem('kfKey', K); localStorage.setItem('kfCompanyId', meta.companyId);
      localStorage.setItem('knightForestrySettings_v3', JSON.stringify({ syncUrl: url('sync'), sheetsUrl: url('loads'), companyName: 'Knight Forestry Ltd', locations: [{ name: 'Barmac' }], units: [{ name: 'Tandem' }] }));
      localStorage.setItem('scriptUrl', url('tickets')); localStorage.setItem('yardUrl', url('yards')); localStorage.setItem('driversUrl', url('drivers'));
      localStorage.setItem('coLoggedIn', '1'); localStorage.setItem('loggedIn', 'true'); localStorage.setItem('kfCompanyRev', String(meta.rev + 2));
      localStorage.setItem('kfCompany', JSON.stringify({ name: 'Knight Forestry Ltd', phone: '780-555-0100' }));
    }, { CO, K, meta: g.get({ settings: '1' })._meta });
    const p = await ctx.newPage(); p.errors = []; p.on('pageerror', e => p.errors.push(p.url() + ' ' + e.message)); p.on('dialog', d => { p.lastDialog = d.message(); d.accept(); });
    return p;
  };
  const A = await phone('Pixel 5'); A.__dev = 'A';            // driver / scale phone
  const O = await phone('Desktop Chrome'); O.__dev = 'O';     // office laptop
  const nudge = async p => { await p.evaluate(() => window.dispatchEvent(new Event('focus'))); await p.waitForTimeout(700); };
  const sheetTickets = () => g.get({ svc: 'tickets', k: K }).rows;

  // ---- office has the tickets list open before anything exists ----
  await O.goto(B + 'scale.html'); await O.evaluate(() => showScreen('history')); await O.waitForTimeout(400);
  ok((await O.textContent('#historyList')).includes('No tickets yet'), 'office: empty list');

  // ---- phone A: new ticket ----
  await A.goto(B + 'scale.html'); await A.waitForTimeout(300);
  ok(await A.isVisible('#home') && !(await A.isVisible('#login')), 'tickets opens without the old password on a company device');
  await A.click('text=+ New ticket');
  const num1 = await A.inputValue('#tm9');
  ok(/^KF-\d{4}-\d{4}-01$/.test(num1), 'ticket number keeps the Dispatch format: ' + num1);
  await A.fill('#customer', 'Bob'); await A.fill('#source', 'Barmac'); await A.fill('#tare', '15000'); await A.fill('#gross', '25200'); await A.fill('#purchase', '400'); await A.fill('#sale', '900'); await A.fill('#notes', 'private note');
  await A.click('#saveBtn'); await A.waitForTimeout(600);
  ok(sheetTickets().length === 1 && sheetTickets()[0][6] === 10200, 'saved to the sheet with net 10200');
  // office sees it without touching anything (live refresh)
  await nudge(O);
  ok((await O.textContent('#historyList')).includes(num1), 'office sees the new ticket by itself');

  // ---- edits never duplicate (even with a changed number) ----
  await A.evaluate(() => editTicket(0)); await A.fill('#gross', '26200'); await A.click('#saveBtn'); await A.waitForTimeout(500);
  ok(sheetTickets().length === 1 && sheetTickets()[0][6] === 11200, 'edit updates the same ticket (no duplicate)');
  const t0 = sheetTickets()[0][9];
  await A.evaluate(() => editTicket(0)); await A.fill('#tm9', num1 + 'B'); await A.click('#saveBtn'); await A.waitForTimeout(500);
  ok(sheetTickets().length === 1 && sheetTickets()[0][0] === num1 + 'B' && sheetTickets()[0][9] === t0, 'renumbering edits the same row and keeps the original time');
  await A.evaluate(() => editTicket(0)); await A.fill('#tm9', num1); await A.click('#saveBtn'); await A.waitForTimeout(500);
  // a resent save (e.g. after a dropped connection) does not duplicate
  await A.evaluate(async r => { await send({ action: 'save', row: r }); }, sheetTickets()[0]);
  ok(sheetTickets().length === 1, 'resent save does not duplicate');
  // typing an existing number on a new ticket is refused
  await A.evaluate(() => newTicket()); await A.fill('#tm9', num1); await A.click('#saveBtn');
  ok((await A.textContent('#tkErr')).includes('already exists'), 'duplicate number refused on a new ticket');
  await A.evaluate(() => cancelTicket());

  // ---- no signal: the ticket waits on the phone and sends itself ----
  offline = true;
  await A.evaluate(() => newTicket()); const num2 = await A.inputValue('#tm9');
  await A.fill('#customer', 'Ann'); await A.fill('#tare', '1000'); await A.fill('#gross', '3000'); await A.click('#saveBtn'); await A.waitForTimeout(500);
  ok(/No signal/.test(A.lastDialog || '') && (await A.textContent('#historyList')).includes('not sent yet') && sheetTickets().length === 1, 'offline: kept on the phone, marked not sent');
  offline = false; await A.evaluate(() => loadTickets(true)); await A.waitForTimeout(600);
  ok(sheetTickets().length === 2 && sheetTickets().some(t => t[0] === num2) && !(await A.textContent('#historyList')).includes('not sent yet'), 'back online: sent by itself');

  // ---- Client / Supplier / Office copies ----
  await A.evaluate(() => showScreen('history')); await A.waitForTimeout(300);
  const i1 = await A.evaluate(n => tickets.findIndex(t => t[0] === n), num1);
  await A.evaluate(i => openShare(i, 'client'), i1);
  let pre = await A.textContent('#shareBox pre');
  ok(/CLIENT COPY/.test(pre) && /Customer: Bob/.test(pre) && !/Source/.test(pre) && !/private note/.test(pre) && /Amount:\s+\$900\.00/.test(pre) && /KNIGHT FORESTRY LTD/.test(pre), 'client copy: customer + sale amount, no source, no private notes');
  ok((await A.$$('#shareBox .opt')).length === 3, 'three options: copy text, share as PDF, print');
  await A.click('text=Copy text'); await A.waitForTimeout(200);
  ok((await A.evaluate(() => navigator.clipboard.readText())).includes('CLIENT COPY'), 'copy text');
  await A.evaluate(() => closeShare()); await A.evaluate(i => openShare(i, 'supplier'), i1); pre = await A.textContent('#shareBox pre');
  ok(/SUPPLIER COPY/.test(pre) && /Source:\s+Barmac/.test(pre) && !/Customer/.test(pre) && /Amount:\s+\$400\.00/.test(pre) && !/private/.test(pre), 'supplier copy: source + purchase amount, no customer');
  await A.evaluate(() => closeShare()); await A.evaluate(i => openShare(i, 'office'), i1); pre = await A.textContent('#shareBox pre');
  ok(/OFFICE COPY/.test(pre) && /Profit:\s+\$500\.00/.test(pre) && /private note/.test(pre), 'office copy: everything incl. profit and notes');
  ok(pre.split('\n').every(l => l.length <= 32), 'fits a 58 mm receipt (32 characters)');
  // PDF
  const [dl] = await Promise.all([A.waitForEvent('download', { timeout: 30000 }), A.click('text=Share as PDF')]);
  ok(dl.suggestedFilename().endsWith('office.pdf') && fs.statSync(await dl.path()).size > 3000, 'share as PDF (downloads where the share screen is unavailable)');
  // thermal printer: a fake Bluetooth printer records what is sent
  await A.evaluate(() => {
    window.__printed = [];
    const ch = { properties: { write: true, writeWithoutResponse: true }, writeValueWithoutResponse: async b => { window.__printed.push(...b); }, writeValue: async b => { window.__printed.push(...b); } };
    if (!navigator.bluetooth) Object.defineProperty(navigator, 'bluetooth', { value: {}, configurable: true });
    navigator.bluetooth.requestDevice = async () => ({ name: 'MPT-II', addEventListener() {}, gatt: { connect: async () => ({ getPrimaryServices: async () => [{ getCharacteristics: async () => [ch] }] }) } });
  });
  await A.evaluate(i => { closeShare(); openShare(i, 'office'); }, i1);
  await A.click('#shareBox button.btn.opt:not(.btn-outline)'); await A.waitForTimeout(800);
  const bytes = await A.evaluate(() => window.__printed);
  const txt = String.fromCharCode(...bytes.filter(b => b === 10 || (b >= 32 && b < 127)));
  ok(bytes[0] === 0x1b && bytes[1] === 0x40 && /OFFICE COPY/.test(txt) && /NET:/.test(txt) && (await A.textContent('#shMsg')).includes('MPT-II'), 'print: ESC/POS text sent to the receipt printer');
  await A.evaluate(() => closeShare());

  // ---- links to Dispatch and Billing still work ----
  await O.goto(B + 'invoices.html'); await O.waitForTimeout(300);
  ok(await O.evaluate(async n => { const t = await fetchTicket(n); return !!t && t[6] === 11200; }, num1), 'Billing finds the ticket by number');
  await A.goto(B + 'dispatch.html'); await A.waitForTimeout(600);
  await O.goto(B + 'dispatch.html'); await O.waitForTimeout(600);
  ok((await O.textContent('#loadList')).includes('Bob') && !(await O.textContent('#loadList')).includes('Started'), 'office dispatch: load waiting');
  await A.evaluate(() => openLoad(0)); await A.fill('#ticketInput', num1); await A.evaluate(() => checkTicket()); await A.waitForTimeout(600);
  ok((await A.textContent('#ticketResult')).includes('Ticket found') && g.get({ svc: 'loads', k: K }).rows[0].status === 'Started', 'Dispatch finds the ticket and starts the load in the sheet');
  await nudge(O);
  ok((await O.textContent('#loadList')).includes('Started · ' + num1), 'office sees the load started, by itself');
  ok(await A.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('kfDispatch') || '{}')).length === 0), 'phone forgets the change once the sheet has it');

  // ---- settings: saved with the company password, received by other devices ----
  g.post({ action: 'saveSettings', password: 'boss1', settings: { locations: [{ name: 'Barmac' }, { name: 'New Yard' }], units: [{ name: 'Tandem' }, { name: 'Super B' }], companyName: 'Knight Forestry Ltd', fuelPrice: 1.61 }, force: true }, { svc: 'sync' });
  await nudge(O); await O.waitForTimeout(400);
  ok(await O.evaluate(() => { const s = JSON.parse(localStorage.getItem('knightForestrySettings_v3')); return s.units.length === 2 && s.locations[1].name === 'New Yard' && s.fuelPrice === 1.61; }), 'office laptop received the new settings by itself');
  await A.evaluate(() => localStorage.setItem('kfDirty', '1')); await nudge(A);
  ok(await A.evaluate(() => JSON.parse(localStorage.getItem('knightForestrySettings_v3')).units.length === 1), 'a device with unsaved changes is not overwritten');

  for (const p of [A, O]) ok(p.errors.length === 0, p.__dev + ': no page errors ' + p.errors.join(' | '));
  console.log(`live/tickets tests: ${pass} passed, ${fail} failed`);
  await browser.close(); server.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
