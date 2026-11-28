'use strict';
// End-to-end workflows in a real browser. The website is served locally; every call to the Google script goes to the mock backend.
const path = require('path'), fs = require('fs');
const { serve, setup } = require('./e2e-lib');
const { seedCompany } = require('./seed');
const { agroup, check, eq, summary } = require('./harness');
const signIn = require('./steps/office-signin');
const SITE = path.resolve(process.argv[2]), BASE = 'http://127.0.0.1:8143/', SHOTS = path.join(__dirname, 'shots');
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };
const loads = rt => rt.get({ svc: 'loads', k: rt.key }).rows;

(async () => {
  const srv = await serve(SITE, 8143);
  const seed = seedCompany(path.join(SITE, 'company-apps-script.gs')); seed.rt.key = seed.key;
  const E = await setup({ rt: seed.rt });
  const office = await E.newContext(), page = await office.newPage(); E.watch(page, 'office');
  const errsAt = () => E.log.pageErrors.length + E.log.consoleErrors.length;

  await agroup('E1. Office sign-in screen', async () => {
    await page.goto(BASE + 'index.html'); await page.waitForSelector('#kfSignIn');
    await page.fill('#kfsCoName', 'No Such Company'); await page.fill('#kfsPw', 'secret1'); await page.fill('#kfsName', 'PC'); await page.click('#kfsAdmin');
    await page.waitForTimeout(800);
    check(/No company called/.test(await page.textContent('#kfsMsg')), 'unknown company name -> clear message');
    await page.fill('#kfsCoName', 'test forestry'); await page.fill('#kfsPw', 'wrong'); await page.click('#kfsAdmin'); await page.waitForTimeout(800);
    eq(await page.textContent('#kfsMsg'), 'Wrong company password.', 'wrong password -> "Wrong company password."');
    await page.fill('#kfsPw', 'secret1'); await page.fill('#kfsName', 'Office PC'); await page.click('#kfsAdmin');
    await page.waitForFunction(() => !!localStorage.kfAdminToken); await page.waitForTimeout(1200);
    const st = await page.evaluate(() => ({ overlay: !!document.getElementById('kfSignIn'), banner: document.getElementById('companyNameBanner').textContent, badge: !!document.getElementById('kfAdminBadge'), menu: [...document.querySelectorAll('header .kfMenu a')].filter(a => a.style.display !== 'none').map(a => a.textContent) }));
    eq([st.overlay, st.banner, st.badge], [false, 'Test Forestry', true], 'signed in: name in header, Admin badge');
    eq(st.menu, ['Quote', 'Drivers', 'Dispatch', 'Tickets', 'Billing', 'Yards', 'Trucks', 'Statistics'], 'admin menu shows all 8 pages in v14.3 order');
    check(!(await page.evaluate(() => JSON.stringify(localStorage))).includes('secret1'), 'company password is never kept on the device');
  });

  await agroup('E2. Quote -> Book load (with notes and a deal)', async () => {
    await page.goto(BASE + 'index.html'); await page.waitForTimeout(1500);
    await page.fill('#customerName', 'Jane Doe'); await page.fill('#customerPhone', '780-555-0101'); await page.fill('#addressInput', '53.40, -113.30');
    await page.click('#btnCalculate'); await page.waitForSelector('text=$1642', { timeout: 8000 });
    const priceText = await page.evaluate(() => document.getElementById('results').innerText);
    check(/Home Yard/.test(priceText) && /\$1642/.test(priceText) && /40\.0 t on hand/.test(priceText), 'Home Yard priced at $1642 and stock 40 t shown');
    await page.click('text=$1642'); await page.click('#btnBookLoad'); await page.waitForSelector('#notesModal.show');
    await page.fill('#bookNotes', 'Gate code 4321 <b>bold</b>'); await page.fill('#bookAdj', '-42'); await page.selectOption('#bookAdjWhy', 'Deal'); await page.fill('#bookAdjNote', 'repeat customer');
    await page.click('#btnNotesOk'); await page.waitForTimeout(1500);
    const rows = loads(seed.rt);
    eq(rows.length, 1, 'one load in the sheet');
    const l = rows[0] || {};
    eq([l.customerName, l.location, l.species, l.status, l.notes], ['Jane Doe', 'Home Yard', 'Birch', 'Pending', 'Gate code 4321 <b>bold</b>'], 'load fields written');
    eq([Math.round(Number(l.quotedTotal)), Number(l.priceAdj), Math.round((Number(l.quotedTotal) - 42 * 1.05) * 100) / 100 === Number(l.total)], [1642, -42, true], 'quoted $1642, deal -$42 before GST, total incl. GST = quoted - $44.10 (' + l.total + ')');
    check(/Deal/.test(l.adjReason) && /^[A-Za-z0-9-]+-1$/.test(String(l.bookingId)), 'deal reason + booking id saved (' + l.adjReason + ', ' + l.bookingId + ')');
    check(Number(l.loadedKm) > 0 || l.bookingData, 'route legs / booking data saved for Statistics');
    // book again from the same screen -> asks first; say no
    page.__dialog = d => d.type() === 'confirm' ? d.dismiss() : d.accept();
    await page.click('#btnBookLoad'); await page.waitForTimeout(600);
    page.__dialog = null;
    check(E.log.dialogs.some(x => /already booked from this screen/.test(x)), 'same booking again -> "already booked" warning');
    eq(loads(seed.rt).length, 1, 'declining the warning books nothing');
  });

  await agroup('E3. Booking while the sheet is busy, then again', async () => {
    await page.goto(BASE + 'index.html'); await page.waitForTimeout(1200);
    await page.fill('#customerName', 'Busy Bob'); await page.fill('#addressInput', '53.41, -113.31');
    await page.click('#btnCalculate'); await page.waitForSelector('text=$1642', { timeout: 8000 }); await page.click('text=$1642');
    seed.rt.state.lockBusy = true;
    await page.click('#btnBookLoad'); await page.waitForSelector('#notesModal.show'); await page.click('#btnNotesOk'); await page.waitForTimeout(1200);
    check(E.log.dialogs.some(x => /busy, so this was NOT booked yet/.test(x)), 'busy -> clear "NOT booked yet, tap Book again" message');
    eq(loads(seed.rt).filter(r => r.customerName === 'Busy Bob').length, 0, 'nothing booked while busy');
    seed.rt.state.lockBusy = false;
    await page.click('#btnBookLoad'); await page.waitForSelector('#notesModal.show'); await page.click('#btnNotesOk'); await page.waitForTimeout(1200);
    eq(loads(seed.rt).filter(r => r.customerName === 'Busy Bob').length, 1, 'tap Book again -> booked exactly once');
  });

  await agroup('E4. Dispatch: scale ticket in kg -> Started in tonnes -> Delivered', async () => {
    seed.S('tickets', { action: 'save', row: ['T500', 'Birch', 'Jane Doe', 'Home Yard', 14000, 44360, 30360, '', '', new Date().toISOString(), ''] });
    await page.goto(BASE + 'dispatch.html'); await page.waitForTimeout(1500);
    const cards = await page.$$eval('.card.ld', a => a.map(x => x.innerText.split('\n')[0]));
    check(cards.includes('Jane Doe') && cards.includes('Busy Bob'), 'both loads listed on Dispatch (' + cards.join(', ') + ')');
    await page.click('.card.ld:has-text("Jane Doe")'); await page.waitForTimeout(600);
    const popup = await page.evaluate(() => { const p = document.getElementById('notesPopup'); return p && getComputedStyle(p).display !== 'none' ? p.innerText : ''; });
    check(/Gate code 4321/.test(popup), 'notes pop up when the load is opened');
    check(popup.includes('<b>bold</b>'), 'notes shown as typed (HTML is not run)');
    await page.click('#notesPopup >> text=OK');
    check(/Gate code 4321/.test(await page.evaluate(() => document.body.innerText)), 'notes shown when the load is opened');
    check(!(await page.evaluate(() => !!document.querySelector('#view b, .notes b, #notesPopup b'))), 'notes shown as text, not HTML');
    await page.fill('#ticketInput', 'T500'); await page.click('text=Check Ticket'); await page.waitForTimeout(1200);
    check(/Net: 30\.36 t/.test(await page.textContent('#ticketResult')), 'ticket 30360 kg shows as 30.36 t');
    let l = loads(seed.rt).find(r => r.customerName === 'Jane Doe');
    eq([l.status, l.loadId, Number(l.netTonnes)], ['Started', 'T500', 30.36], 'sheet: Started, Load ID T500, Net Tonnes 30.36 (tonnes, not kg)');
    const again = await page.isVisible('#notesPopup');
    eq(again, false, 'notes popup does NOT open a second time after Check Ticket');
    if (again) await page.click('#notesPopup >> text=OK');
    await page.click('#deliveredBtn'); await page.waitForTimeout(1200);
    l = loads(seed.rt).find(r => r.customerName === 'Jane Doe');
    check(l.status === 'Delivered' && /^\d{4}-/.test(l.deliveredAt), 'Delivered + Delivered At stamped');
    const st = seed.S('yards', { action: 'stock' }).stock['Home Yard|Birch|Logs'];
    eq(st.qty, 9.64, '30.36 t left Home Yard on delivery (40 - 30.36 = 9.64)');
    await page.click('.card.ld:has-text("Busy Bob")'); await page.waitForTimeout(500);
    if (await page.isVisible('#notesPopup')) await page.click('#notesPopup >> text=OK');
    await page.fill('#ticketInput', 'T500'); await page.click('text=Check Ticket'); await page.waitForTimeout(800);
    check(/already on the load for Jane Doe/.test(await page.textContent('#ticketResult')), 'same ticket on a second load is refused');
  });

  await agroup('E5. Billing: invoice the delivered load', async () => {
    await page.goto(BASE + 'invoices.html'); await page.waitForTimeout(1500);
    await page.click('text=Pending Invoices'); await page.waitForTimeout(1200);
    const pend = await page.evaluate(() => document.body.innerText);
    check(/T500 - Jane Doe/.test(pend) && /30\.36 t/.test(pend), 'delivered load waiting in Pending Invoices with 30.36 t');
    await page.click('[onclick^="openInvoice"]'); await page.waitForTimeout(1200);
    eq(await page.inputValue('#invAmount'), '30.36', 'invoice amount pre-filled in tonnes');
    eq(await page.evaluate(() => typeof window.html2pdf), 'undefined', 'Billing opens without loading the 900 KB PDF tool');
    const pdf = await page.evaluate(async () => { const el = document.createElement('div'); el.innerHTML = '<div style="width:600px;padding:20px">Invoice test</div>'; await kfPdfLib(); const b = await html2pdf().from(el.firstChild).outputPdf('blob'); return { size: b.size, head: await b.slice(0, 5).text() }; });
    check(pdf.head === '%PDF-' && pdf.size > 1000, 'PDF tool loads on first use and makes a real PDF (' + pdf.size + ' bytes)');
    await page.click('text=Preview'); await page.waitForTimeout(1500);
    const prev = await page.evaluate(() => document.body.innerText);
    check(/Test Forestry/.test(prev) && /Jane Doe/.test(prev) && /GST/.test(prev), 'invoice preview has company, customer and GST');
    await page.screenshot({ path: path.join(SHOTS, 'flow-invoice-preview.png'), fullPage: true });
    await page.goto(BASE + 'invoices.html'); await page.waitForTimeout(1200); await page.click('text=Pending Invoices'); await page.waitForTimeout(800);
    await page.click('[onclick^="openInvoice"]'); await page.waitForTimeout(1000);
    await page.click('text=Complete Load'); await page.waitForTimeout(1500);
    const l = loads(seed.rt).find(r => r.customerName === 'Jane Doe');
    eq(l.status, 'Paid', 'load marked invoiced (status Paid) in the sheet');
    const inv = JSON.parse(l.invoiceData || '{}');
    check(inv.model && Number(inv.model.total) > 0, 'invoice data saved with a total ($' + (inv.model && inv.model.total) + ')');
    if (inv.model) { const m = inv.model; check(Math.abs(Number(m.sub) * 1.05 - Number(m.total)) < 0.02, 'invoice total = subtotal + 5% GST (' + m.sub + ' -> ' + m.total + ')'); }
  });

  await agroup('E6. Tickets page: new ticket saved', async () => {
    await page.goto(BASE + 'scale.html'); await page.waitForTimeout(1500);
    await page.click('text=+ New ticket'); await page.waitForTimeout(600);
    await page.fill('#tm9', 'T777'); await page.fill('#customer', 'Acme'); await page.fill('#source', 'North Block');
    await page.fill('#tare', '15000'); await page.fill('#gross', '45000'); await page.click('#saveBtn'); await page.waitForTimeout(1500);
    const t = seed.rt.get({ svc: 'tickets', k: seed.key }).rows.find(r => String(r[0]) === 'T777');
    check(t && Number(t[6]) === 30000, 'ticket T777 saved with net 30000 kg' + (t ? '' : ' (not in sheet)'));
    await page.screenshot({ path: path.join(SHOTS, 'flow-ticket.png'), fullPage: true });
  });

  await agroup('E7. Every office page renders the data with no script errors (desktop + phone)', async () => {
    seed.S('money', { action: 'saveExpense', expense: { id: 'X1', amount: 120, category: 'Office', date: new Date().toISOString().slice(0, 10) } });
    seed.S('trucks', { action: 'saveWorkOrder', workOrder: { unitId: seed.S('trucks', { action: 'listUnits' }).units[0].id, defect: 'Cracked mirror', severity: 'minor' } });
    for (const [label, ctxOpt] of [['desktop', null], ['phone', PHONE]]) {
      let c = office, p = page;
      if (ctxOpt) { c = await E.newContext(ctxOpt); p = await c.newPage(); E.watch(p, 'office-phone'); await signIn(p, BASE); }
      for (const f of ['index.html', 'dispatch.html', 'invoices.html', 'scale.html', 'yards.html', 'drivers.html', 'trucks.html', 'statistics.html']) {
        const e0 = errsAt();
        await p.goto(BASE + f); await p.waitForTimeout(2200);
        const info = await p.evaluate(() => ({ over: document.documentElement.scrollWidth - innerWidth, text: document.body.innerText, signin: !!document.getElementById('kfSignIn') }));
        await p.screenshot({ path: path.join(SHOTS, `data-${label}-${f}.png`), fullPage: false });
        check(errsAt() === e0 && !info.signin && info.over <= 0 && !/NaN|undefined|\[object Object\]/.test(info.text), `${label} ${f}: no errors, no sign-in prompt, no sideways scroll, no NaN/undefined text` + (info.over > 0 ? ' (overflow ' + info.over + 'px)' : '') + ((info.text.match(/.{0,40}(NaN|undefined|\[object Object\]).{0,20}/) || [''])[0] ? ' :: ' + info.text.match(/.{0,40}(NaN|undefined|\[object Object\]).{0,20}/)[0] : ''));
      }
      if (ctxOpt) await c.close();
    }
    await page.goto(BASE + 'trucks.html'); await page.waitForTimeout(1500);
    check(/Tandem/.test(await page.evaluate(() => document.body.innerText)) && /Loader/.test(await page.evaluate(() => document.body.innerText)), 'Trucks lists Tandem and Loader');
    await page.goto(BASE + 'statistics.html'); await page.waitForTimeout(2500);
    const stats = await page.evaluate(() => document.body.innerText);
    check(/\$/.test(stats), 'Statistics shows money figures');
  });

  await agroup('E8. Driver phone: sign in by company name, log in, start a shift', async () => {
    const c = await E.newContext(PHONE), p = await c.newPage(); E.watch(p, 'driver');
    await p.goto(BASE + 'index.html'); await p.waitForSelector('#kfSignIn');
    await p.fill('#kfsCoName', 'Test Forestry'); await p.click('#kfsPerson'); await p.waitForURL(/drivers\.html/); await p.waitForTimeout(1500);
    await p.waitForSelector('#lgName option:has-text("Dave")', { state: 'attached', timeout: 8000 });
    await p.selectOption('#lgName', 'Dave'); await p.fill('#lgPass', '0000'); await p.click('#lgGo'); await p.waitForTimeout(800);
    eq(await p.textContent('#lgErr'), 'Wrong name or passcode.', 'wrong passcode message');
    await p.fill('#lgPass', '1234'); await p.click('#lgGo'); await p.waitForTimeout(1500);
    const sess = await p.evaluate(() => JSON.parse(localStorage.kfDrvSession || '{}'));
    check(sess.token && !sess.passcode && !(await p.evaluate(() => JSON.stringify(localStorage))).includes('1234'), 'driver phone keeps a token, not the passcode');
    const menu0 = await p.evaluate(() => [...document.querySelectorAll('header .kfMenu a')].filter(a => a.style.display !== 'none').map(a => a.textContent));
    await p.waitForSelector('#stUnit'); await p.selectOption('#stUnit', 'Tandem'); await p.waitForTimeout(400);
    await p.fill('#stOdo', '100050'); await p.check('#stOdoOk'); await p.click('#stGo'); await p.waitForTimeout(2000);
    await p.screenshot({ path: path.join(SHOTS, 'flow-driver-after-start.png') });
    const body = await p.evaluate(() => document.body.innerText);
    check(/pre-?trip/i.test(body), 'after Start shift the driver is asked for the pre-trip');
    eq(menu0, ['Drivers', 'Trucks'], 'menu switches to Drivers + Trucks right after log in');
    await p.reload(); await p.waitForTimeout(1500);
    const menu = await p.evaluate(() => [...document.querySelectorAll('header .kfMenu a')].filter(a => a.style.display !== 'none').map(a => a.textContent));
    eq(menu, ['Drivers', 'Trucks'], 'driver phone menu shows only Drivers + Trucks (after the page reloads)');
    check(/pre-?trip/i.test(await p.evaluate(() => document.body.innerText)), 'open shift survives a reload');
    await p.goto(BASE + 'invoices.html'); await p.waitForTimeout(1200);
    check(/drivers\.html/.test(p.url()), 'driver phone opening Billing is sent to Drivers');
    const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth); check(over <= 0, 'driver page fits a phone screen');
    await c.close();
  });

  await agroup('E9. Mechanic phone sees Trucks work orders without prices', async () => {
    const c = await E.newContext(PHONE), p = await c.newPage(); E.watch(p, 'mechanic');
    await p.goto(BASE + 'index.html'); await p.waitForSelector('#kfSignIn'); await p.fill('#kfsCoName', 'Test Forestry'); await p.click('#kfsPerson'); await p.waitForURL(/drivers\.html/);
    await p.waitForSelector('#lgName option:has-text("Mo")', { state: 'attached', timeout: 8000 }); await p.selectOption('#lgName', 'Mo'); await p.fill('#lgPass', '4321'); await p.click('#lgGo'); await p.waitForTimeout(1500);
    await p.goto(BASE + 'trucks.html'); await p.waitForTimeout(2000);
    const t = await p.evaluate(() => document.body.innerText);
    check(/Cracked mirror|Work orders/.test(t), 'mechanic sees Trucks / work orders');
    check(!/purchase price/i.test(t), 'no purchase price on the mechanic phone');
    await p.screenshot({ path: path.join(SHOTS, 'flow-mechanic-trucks.png') });
    await c.close();
  });

  await agroup('E10. Settings change on one office device reaches another', async () => {
    const c = await E.newContext(), p = await c.newPage(); E.watch(p, 'office2');
    await signIn(p, BASE);
    const s = seed.rt.get({ svc: 'sync', k: seed.key }); delete s._meta; s.fuelPrice = 1.99;
    eq(seed.S('sync', { action: 'saveSettings', settings: s }).status, 'saved', 'settings saved from device 1');
    await p.goto(BASE + 'dispatch.html'); await p.waitForTimeout(1500);
    const fp = await p.evaluate(() => JSON.parse(localStorage.knightForestrySettings_v3 || '{}').fuelPrice);
    eq(fp, 1.99, 'device 2 picks up the new fuel price when a page opens');
    await c.close();
  });

  await agroup('E11. Phone and browser maths match the script (inventory, kg->t)', async () => {
    await page.goto(BASE + 'yards.html'); await page.waitForTimeout(800);
    let seedN = 7; const rnd = () => { seedN = (seedN * 16807) % 2147483647; return seedN / 2147483647; };
    let mism = 0, tried = 0;
    for (let k = 0; k < 200; k++) {
      const rows = []; const n = 1 + Math.floor(rnd() * 12);
      for (let i = 0; i < n; i++) rows.push({ timestamp: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(), yard: 'Y', species: 'S', type: rnd() < 0.35 ? 'Out' : 'In', tonnes: Math.round(rnd() * 3000 - 300) / 100, cords: Math.round(rnd() * 200) / 10, pricePerTonne: Math.round(rnd() * 6000) / 100, costPerTonne: rnd() < 0.5 ? '' : Math.round(rnd() * 6000) / 100, product: rnd() < 0.2 ? 'Split' : 'Logs', status: rnd() < 0.1 ? 'Void' : rnd() < 0.1 ? 'Pending' : 'Confirmed' });
      for (const prod of ['Logs', 'Split']) {
        tried++;
        const server = seed.rt.call('yardStock_', JSON.parse(JSON.stringify(rows)), 'Y', 'S', prod);
        const client = await page.evaluate(([r, pr]) => kfStock.stock(r, 'Y', 'S', pr), [rows, prod]);
        if (JSON.stringify(server) !== JSON.stringify(client)) mism++;
      }
    }
    eq(mism, 0, 'stock + average cost identical on page and script for ' + tried + ' random histories');
    const kg = await page.evaluate(() => [kfKgToT(30360), kfKgToT('30,360'), kfKgToT(0), kfKgToT('')]);
    eq(kg, [30.36, 30.36, 0, 0], 'kfKgToT: 30360 / "30,360" kg -> 30.36 t');
  });

  const out = summary('END-TO-END (browser)');
  console.log(out.text);
  console.log('\npage errors:', JSON.stringify(E.log.pageErrors, null, 1));
  console.log('console errors:', JSON.stringify(E.log.consoleErrors, null, 1));
  console.log('dialogs:', JSON.stringify(E.log.dialogs, null, 1));
  const st = {}; E.log.requests.forEach(r => { const k = r.svc + '/' + (r.action || 'GET') + ' -> ' + r.status; st[k] = (st[k] || 0) + 1; });
  console.log('backend calls:', JSON.stringify(st, null, 1));
  fs.writeFileSync(path.join(__dirname, 'e2e-results.json'), JSON.stringify({ results: out.results, log: E.log }, null, 1));
  await E.browser.close(); srv.close();
})();
