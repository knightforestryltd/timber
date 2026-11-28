'use strict';
// Phase 1: every page opened cold (new device), on desktop and phone, nothing configured yet.
const path = require('path'), fs = require('fs');
const { serve, setup } = require('./e2e-lib');
const SITE = path.resolve(process.argv[2]), OUT = path.join(__dirname, 'shots'); fs.mkdirSync(OUT, { recursive: true });
const PAGES = ['index.html', 'dispatch.html', 'invoices.html', 'scale.html', 'yards.html', 'drivers.html', 'trucks.html', 'statistics.html', 'app.html'];
(async () => {
  const srv = await serve(SITE, 8143);
  const E = await setup({ script: path.join(SITE, 'company-apps-script.gs') });
  const report = [];
  for (const vp of [{ name: 'desktop', o: {} }, { name: 'phone', o: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } }]) {
    for (const p of PAGES) {
      const ctx = await E.newContext(vp.o), page = await ctx.newPage(); E.watch(page, vp.name + ' ' + p);
      const before = E.log.pageErrors.length + E.log.consoleErrors.length;
      const t0 = Date.now(); let nav = 'ok';
      try { await page.goto('http://127.0.0.1:8143/' + p, { waitUntil: 'load', timeout: 20000 }); await page.waitForTimeout(1200); } catch (e) { nav = 'NAV FAIL ' + e.message.slice(0, 100); }
      const info = await page.evaluate(() => ({ url: location.pathname, title: document.title, overflowX: document.documentElement.scrollWidth - window.innerWidth, text: document.body.innerText.slice(0, 160).replace(/\s+/g, ' ') })).catch(e => ({ err: String(e) }));
      await page.screenshot({ path: path.join(OUT, `cold-${vp.name}-${p}.png`) });
      report.push({ vp: vp.name, page: p, nav, ms: Date.now() - t0, landed: info.url, overflowX: info.overflowX, text: info.text, errs: E.log.pageErrors.length + E.log.consoleErrors.length - before });
      await ctx.close();
    }
  }
  console.table(report.map(r => ({ vp: r.vp, page: r.page, nav: r.nav, ms: r.ms, landed: r.landed, overflowX: r.overflowX, errs: r.errs })));
  report.forEach(r => console.log(r.vp, r.page, '=>', r.text));
  console.log('page errors:', E.log.pageErrors); console.log('console errors:', E.log.consoleErrors); console.log('dialogs:', E.log.dialogs);
  console.log('backend calls:', E.log.requests.map(r => `${r.page} ${r.method} ${r.svc}/${r.action} -> ${r.status}`).join('\n  '));
  console.log('external:', [...new Set(E.log.external)]);
  await E.browser.close(); srv.close();
})();
