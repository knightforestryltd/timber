const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = require('path').resolve(__dirname, '..');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
const B = 'http://localhost:8124/';
(async () => {
  await new Promise(r => server.listen(8124, r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices[process.env.DEVICE || 'Pixel 5'] });
  await ctx.route('https://**', r => r.abort());
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => { if (!page.url().startsWith('about:')) errors.push(page.url() + ': ' + e.message); });
  page.on('dialog', d => d.accept());
  await page.addInitScript(() => { if (!localStorage.getItem('t')) { localStorage.setItem('t', '1'); localStorage.setItem('kfSkipConnect', '1'); localStorage.setItem('loggedIn', 'true'); } });
  const back = async () => { await page.evaluate(() => history.back()); await page.waitForTimeout(400); };
  const vis = sel => page.isVisible(sel);

  // ---- Quote (home) ----
  await page.goto(B + 'index.html'); await page.click('#nav-settings');
  ok(await vis('#view-settings'), 'quote settings open');
  ok(!(await page.$('#setTicketsUrl')) && await page.$('#setSheetsUrl') && await page.$('#setSyncUrl'), 'Quote keeps sync + load log, other links moved');
  await back(); ok(await vis('#view-quote') && page.url().includes('index.html'), 'back: settings -> quote');
  if (!process.env.DEVICE || /Pixel|iPhone|Galaxy/.test(process.env.DEVICE)) {
    await back(); ok(page.url().includes('index.html') && await vis('#view-quote'), 'phone: back on home page stays in the app');
    ok(await vis('#kfBackHint'), 'home page hint shown');
  } else {
    await back(); await page.waitForTimeout(300); ok(!page.url().includes('index.html'), 'laptop: back on the home page leaves the site as usual');
  }

  // ---- Invoices ----
  await page.goto(B + 'invoices.html'); await page.click('#menu button:nth-child(3)');
  ok(await vis('#invLinks input'), 'invoices settings has sheet links');
  await page.fill('#invLinks input', 'https://script.google.com/macros/s/LOADLOG/exec'); await page.click('#invLinks .btn');
  ok(await page.evaluate(() => JSON.parse(localStorage.getItem('knightForestrySettings_v3')).sheetsUrl === 'https://script.google.com/macros/s/LOADLOG/exec' && localStorage.getItem('kfDirty') === '1'), 'link saved + flagged for company sync');
  await back(); ok(await vis('#menu'), 'back: settings -> invoice menu');
  // manual: total backwards
  await page.click('#menu button:nth-child(2)');
  await page.fill('#newQty', '4'); await page.fill('#newTotalIn', '525');
  ok(await page.inputValue('#newPrice') === '125' && await page.textContent('#newSub') === '500.00' && await page.textContent('#newGst') === '25.00' && await page.textContent('#newTotal') === '525.00', 'total 525, 4 units -> $125/unit, sub 500, GST 25');
  ok((await page.textContent('#newBackNote')).includes('÷ 1.05'), 'shows the backwards math');
  await page.fill('#newQty', '5');
  ok(await page.inputValue('#newPrice') === '100' && await page.textContent('#newTotal') === '525.00', 'qty change keeps the total, re-works price');
  await page.fill('#newPrice', '110');
  ok(await page.textContent('#newTotal') === '577.50' && await page.inputValue('#newTotalIn') === '577.50', 'typing a price works forwards again');
  await page.fill('#newTotalIn', '1000'); await page.fill('#newQty', '3');
  ok(Math.abs(await page.evaluate(() => { const m = calcNew(); return m.sub + m.gst - m.total; })) < 0.001 && await page.textContent('#newTotal') === '1000.00', 'odd total stays exact');
  ok(!(await page.$('#newCashSale')), 'separate Cash Sale tick removed');
  let html = await page.evaluate(() => invoiceHtml(calcNew()));
  ok(!html.includes('CASH SALE'), 'no cash banner without Cash payment');
  await page.check('input.newPay[value="Cash"]');
  html = await page.evaluate(() => invoiceHtml(calcNew()));
  ok(html.includes('CASH SALE'), 'cash banner when Cash payment ticked');
  await back(); ok(await vis('#menu'), 'back: manual -> menu');
  // pending: price adjustment
  await page.evaluate(() => { loads = [{ customerName: 'Bob', loadId: 'KF-1', species: 'Birch', location: 'Yard', tonnes: 10, netTonnes: 10, total: 1050, totalHours: 2, km: 20 }]; show('pendingView'); openInvoice(0); });
  const modes = await page.$$eval('input[name="invMode"]', a => a.map(x => x.parentElement.textContent.trim()));
  ok(modes.join('|') === 'From Ticket|Match Quote|Price Adjustment', 'modes: ' + modes.join('|'));
  await page.check('input[name="invMode"][value="adjust"]');
  ok(await vis('#cashBox') && (await page.textContent('#cashBox')).includes('Adjusted price'), 'price adjustment box');
  await page.fill('#cashAmount', '840');
  let m = await page.evaluate(() => calcInvoice());
  ok(m.total === 840 && m.sub === 800 && !m.cash, 'adjusted price, no cash banner');
  await page.check('input.pay[value="Cash"]'); m = await page.evaluate(() => calcInvoice());
  ok(m.cash && (await page.evaluate(mm => invoiceHtml(mm), m)).includes('CASH SALE'), 'cash payment -> banner');
  await back(); ok(await vis('#pendingView'), 'back: invoice -> pending list');
  await back(); ok(await vis('#menu'), 'back: pending -> menu');
  await back(); await page.waitForLoadState(); ok(page.url().includes('index.html'), 'back from invoice menu -> Quote home');

  // ---- Dispatch ----
  await page.goto(B + 'dispatch.html'); await page.click('#nav-settings');
  ok(await vis('#dispLinks input'), 'dispatch settings has sheet links');
  ok((await page.$$('#dispLinks input')).length === 2, 'load log + tickets links');
  await back(); ok(await vis('#listView'), 'back: settings -> list');
  await back(); await page.waitForLoadState(); ok(page.url().includes('index.html'), 'dispatch -> home');

  // ---- Tickets ----
  await page.goto(B + 'scale.html'); await page.click('#nav-settings');
  ok(await vis('#settings'), 'tickets gear opens its settings');
  await back(); ok(await vis('#home'), 'back: settings -> tickets home');
  await back(); await page.waitForLoadState(); ok(page.url().includes('index.html'), 'tickets -> home');

  // ---- Inventory ----
  await page.goto(B + 'yards.html'); await page.click('#nav-settings');
  ok(await vis('#settingsScreen'), 'yards gear opens its settings');
  await back(); ok(await vis('#menuScreen'), 'back: settings -> yard menu');
  await back(); await page.waitForLoadState(); ok(page.url().includes('index.html'), 'yards -> home');

  // ---- Drivers ----
  await page.goto(B + 'drivers.html'); await page.click('#tab-admin');
  await back(); ok(await vis('#view-drivers'), 'back: admin -> drivers tab');
  await back(); await page.waitForLoadState(); ok(page.url().includes('index.html'), 'drivers -> home');

  ok(errors.length === 0, 'no page errors: ' + errors.join(' | '));
  console.log(`nav/invoice tests: ${pass} passed, ${fail} failed`);
  await browser.close(); server.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
