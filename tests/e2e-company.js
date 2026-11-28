'use strict';
// v14.4 browser checks: a NEW company set up from its own sheet link, sign-in by company name, logo from Billing settings.
const path = require('path'), fs = require('fs');
const { serve, setup } = require('./e2e-lib');
const { seedCompany } = require('./seed');
const { createRuntime } = require('./gasmock');
const { agroup, check, eq, summary } = require('./harness');
const SITE = path.resolve(process.argv[2]), BASE = 'http://127.0.0.1:8143/', SHOTS = path.join(__dirname, 'shots');
const NEWURL = 'https://script.google.com/macros/s/NEWCO123abc/exec';
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };
(async () => {
  const served = []; const srv = await serve(SITE, 8143);
  srv.on('request', r => served.push(r.url));
  const seed = seedCompany(path.join(SITE, 'company-apps-script.gs'));          // the site's own company (kf-config.js link) = the company list
  const newco = createRuntime({ script: path.join(SITE, 'company-apps-script.gs') });   // a brand-new, empty company script
  seed.rt.state.fetchHandler = url => (url.split('?')[0] === NEWURL ? { code: 200, body: JSON.stringify(newco.get({})) } : { code: 404, body: '' });
  const E = await setup({ rt: seed.rt, byId: { NEWCO123abc: newco } });

  await agroup('C1. Sign-in screen fills in this website\'s company', async () => {
    const c = await E.newContext(PHONE), p = await c.newPage(); E.watch(p, 'prefill');
    await p.goto(BASE + 'drivers.html'); await p.waitForTimeout(400);
    await p.goto(BASE + 'index.html'); await p.waitForSelector('#kfSignIn'); await p.waitForTimeout(800);
    eq(await p.inputValue('#kfsCoName'), 'Test Forestry', 'company name box already says "Test Forestry"');
    await p.click('#kfsPerson'); await p.waitForURL(/drivers\.html/, { timeout: 8000 });
    check(true, 'driver taps "I drive…" without typing anything and reaches the driver log in');
    await c.close();
  });

  await agroup('C2. New company from its sheet link (first admin device)', async () => {
    const c = await E.newContext(), p = await c.newPage(); E.watch(p, 'newco');
    await p.goto(BASE + 'index.html'); await p.waitForSelector('#kfSignIn');
    await p.click('#kfsNew'); await p.waitForURL(/#company/); await p.waitForTimeout(1200);
    check(await p.isVisible('#coLinkUrl'), '"Company sheet link" box is shown');
    await p.fill('#coLinkUrl', 'https://example.com/not-a-script'); await p.click('#btnSaveLink'); await p.waitForTimeout(400);
    check(/Paste the company script link/.test(await p.textContent('#coLinkMsg')), 'a wrong link is refused with a clear message');
    await p.fill('#coLinkUrl', NEWURL); await p.click('#btnSaveLink'); await p.waitForTimeout(1200);
    check(await p.isVisible('#coLinkCo') && await p.isVisible('#coLinkPw1'), 'empty company: asks for the company name and a new password');
    await p.fill('#coLinkCo', 'Birchwood Haulers'); await p.fill('#coLinkPw1', 'newpass1'); await p.fill('#coLinkPw2', 'newpass1');
    await p.click('#btnSaveLink'); await p.waitForTimeout(2500);
    const msg = await p.textContent('#coLinkMsg');
    check(/Saved\. New devices sign in with "Birchwood Haulers"/.test(msg), 'set-up message: ' + msg.slice(0, 120));
    const g = newco.get({});
    eq([g.hasPassword, g.companyName], [true, 'Birchwood Haulers'], 'new company script now has its password and name');
    eq(seed.rt.post({ svc: 'sync' }, { action: 'findCompany', name: 'birchwood haulers' }).url, NEWURL, 'new company is in the sign-in list (by name)');
    await p.waitForTimeout(3000);
    const ls = await p.evaluate(() => ({ url: localStorage.kfCompanyUrl, admin: !!localStorage.kfAdminToken, key: !!localStorage.kfKey }));
    eq(ls, { url: NEWURL, admin: true, key: true }, 'this device is now connected to the new company as an admin');
    eq([seed.rt.get({}).companyName, seed.rt.get({ svc: 'sync', k: seed.key }).locations.length], ['Test Forestry', 2], 'the website\'s own company (Test Forestry) is untouched');
    await c.close();
  });

  await agroup('C3. Second device + driver join the new company by name', async () => {
    const nk = newco.post({ svc: 'sync' }, { action: 'checkPassword', password: 'newpass1' }).key;
    newco.post({ svc: 'drivers' }, { action: 'adminSaveDriver', password: 'newpass1', driver: { name: 'Nina', passcode: '2468' } });
    const c = await E.newContext(), p = await c.newPage(); E.watch(p, 'newco-office2');
    await p.goto(BASE + 'index.html'); await p.waitForSelector('#kfSignIn'); await p.waitForTimeout(600);
    await p.fill('#kfsCoName', 'Birchwood Haulers'); await p.fill('#kfsPw', 'newpass1'); await p.fill('#kfsName', 'Office 2'); await p.click('#kfsAdmin');
    await p.waitForFunction(() => !!localStorage.kfAdminToken, null, { timeout: 8000 }); await p.waitForTimeout(1200);
    eq(await p.evaluate(() => localStorage.kfCompanyUrl), NEWURL, 'office device 2 found the new company by its name');
    eq(await p.textContent('#companyNameBanner'), 'Birchwood Haulers', 'header shows the new company');
    await c.close();
    const d = await E.newContext(PHONE), q = await d.newPage(); E.watch(q, 'newco-driver');
    await q.goto(BASE + 'index.html'); await q.waitForSelector('#kfSignIn'); await q.waitForTimeout(600);
    await q.fill('#kfsCoName', 'Birchwood Haulers'); await q.click('#kfsPerson'); await q.waitForURL(/drivers\.html/);
    await q.waitForSelector('#lgName option:has-text("Nina")', { state: 'attached', timeout: 8000 });
    await q.selectOption('#lgName', 'Nina'); await q.fill('#lgPass', '2468'); await q.click('#lgGo'); await q.waitForTimeout(1500);
    check(await q.isVisible('#stUnit') || /Hi Nina/.test(await q.evaluate(() => document.body.innerText)), 'driver Nina logged in to the new company');
    await d.close();
    check(!!nk, 'company key works');
  });

  await agroup('C4. Header logo comes from Billing settings; the site has no logo file', async () => {
    const c = await E.newContext(), p = await c.newPage(); E.watch(p, 'logo');
    await p.goto(BASE + 'index.html'); await p.waitForSelector('#kfSignIn');
    await p.fill('#kfsPw', 'secret1'); await p.fill('#kfsName', 'PC'); await p.waitForTimeout(800); await p.click('#kfsAdmin');
    await p.waitForFunction(() => !!localStorage.kfAdminToken); await p.waitForTimeout(1200);
    eq(await p.evaluate(() => getComputedStyle(document.getElementById('companyLogo')).visibility), 'hidden', 'no logo saved in Billing yet -> no picture in the header');
    const logo = 'data:image/png;base64,' + fs.readFileSync(path.join(SITE, 'icon-192.png')).toString('base64');
    seed.S('sync', { action: 'saveProfile', profile: { name: 'Test Forestry', email: 'office@example.test', logo } });
    await p.goto(BASE + 'dispatch.html'); await p.waitForTimeout(1500);
    const im = await p.evaluate(() => { const i = document.getElementById('companyLogo'); return { src: (i.getAttribute('src') || '').slice(0, 22), vis: getComputedStyle(i).visibility, w: i.naturalWidth }; });
    eq([im.src, im.vis, im.w > 0], ['data:image/png;base64,', 'visible', true], 'logo saved in Billing settings shows in the header of every page');
    await p.goto(BASE + 'invoices.html'); await p.waitForTimeout(800); await p.click('text=Settings'); await p.waitForTimeout(600);
    check(!(await p.isVisible('text=Use the logo from this website')), 'Billing settings no longer offers the website\'s own logo file');
    check(!served.some(u => /logo\.jpg/.test(u)), 'no page asked the website for logo.jpg');
  });

  await agroup('C5. The company logo is the tab icon, home-screen icon and laptop install icon', async () => {
    const c = await E.newContext(), p = await c.newPage(); E.watch(p, 'icons');
    const cdp = await c.newCDPSession(p);
    const iconState = async () => { await p.waitForTimeout(600); const m = await cdp.send('Page.getAppManifest'); const inst = await cdp.send('Page.getInstallabilityErrors');
      const j = m.url && m.url.indexOf('data:') === 0 ? JSON.parse(decodeURIComponent(m.url.split(',').slice(1).join(','))) : null;
      return { tab: await p.evaluate(() => document.querySelector('link[rel="icon"]').href), apple: await p.evaluate(() => document.querySelector('link[rel="apple-touch-icon"]').href), manifest: j, errs: (inst.installabilityErrors || []).map(e => e.errorId), merrs: m.errors || [] }; };
    // a company with NO logo yet
    seed.S('sync', { action: 'saveProfile', profile: { name: 'Test Forestry', email: 'office@example.test', logo: '' } });
    await p.goto(BASE + 'index.html'); await p.waitForSelector('#kfSignIn'); await p.fill('#kfsPw', 'secret1'); await p.fill('#kfsName', 'Laptop'); await p.waitForTimeout(600); await p.click('#kfsAdmin');
    await p.waitForFunction(() => !!localStorage.kfAdminToken); await p.goto(BASE + 'dispatch.html'); await p.waitForTimeout(1200);
    let st = await iconState();
    check(/icon-192\.png$/.test(st.tab), 'no logo yet: the tab shows the website icon');
    eq([st.manifest && st.manifest.name, st.errs, st.merrs], ['Test Forestry', [], []], 'no logo yet: installs as "Test Forestry" with the website icon, Chrome finds no problem');
    // the company saves its own (wide) logo in Billing
    const wide = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'fixtures', 'wide-logo.png')).toString('base64');
    await p.goto(BASE + 'invoices.html'); await p.waitForTimeout(800); await p.click('text=Settings'); await p.waitForTimeout(600);
    seed.S('sync', { action: 'saveProfile', profile: { name: 'Test Forestry', email: 'office@example.test', logo: wide } });
    for (const f of ['index.html', 'dispatch.html', 'drivers.html', 'trucks.html', 'statistics.html']) {
      await p.goto(BASE + f); await p.waitForTimeout(1500);
      st = await iconState();
      const icons = (st.manifest && st.manifest.icons) || [];
      check(/^data:image\/png/.test(st.tab) && /^data:image\/png/.test(st.apple) && icons.length === 2 && icons.every(i => /^data:image\/png/.test(i.src)) && st.errs.length === 0,
        f + ': tab icon, home-screen icon and install icons are the company logo; Chrome install check clean' + (st.errs.length ? ' ' + st.errs.join(',') : ''));
    }
    const size = await p.evaluate(src => new Promise(r => { const i = new Image(); i.onload = () => { const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d'); g.drawImage(i, 0, 0); const top = g.getImageData(256, 5, 1, 1).data[3], mid = g.getImageData(256, 256, 1, 1).data[3]; r({ w: i.width, h: i.height, top, mid }); }; i.src = src; }), st.manifest.icons[1].src);
    eq(size, { w: 512, h: 512, top: 0, mid: 255 }, 'a wide logo is centred on a square 512 x 512 icon (clear above and below, not stretched)');
    await p.screenshot({ path: path.join(SHOTS, 'company-logo-icons.png') });
    await c.close();
    await c.close();
  });

  const out = summary('v14.4 COMPANY SET-UP + LOGO (browser)'); console.log(out.text);
  console.log('page errors:', JSON.stringify(E.log.pageErrors)); console.log('console errors:', JSON.stringify(E.log.consoleErrors));
  await E.browser.close(); srv.close(); process.exitCode = out.fail || out.err ? 1 : 0;
})();
