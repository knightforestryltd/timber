'use strict';
// Ask Chrome itself whether the site can be installed as an app, and what it thinks of the manifest + icons.
const path = require('path');
const { chromium } = require('playwright');
const { serve } = require('./e2e-lib');
(async () => {
  const srv = await serve(path.resolve(process.argv[2]), 8144);
  const b = await chromium.launch(); const ctx = await b.newContext(); const p = await ctx.newPage();
  await ctx.route(/^https:\/\//, r => r.fulfill({ status: 200, body: '{}' }));
  const cdp = await ctx.newCDPSession(p);
  for (const f of ['index.html', 'drivers.html']) {
    await p.goto('http://localhost:8144/' + f); await p.waitForTimeout(2500);
    const m = await cdp.send('Page.getAppManifest').catch(e => ({ err: e.message }));
    const inst = await cdp.send('Page.getInstallabilityErrors').catch(e => ({ err: e.message }));
    const sw = await p.evaluate(async () => { try { const r = await navigator.serviceWorker.getRegistrations(); return r.map(x => x.active ? x.active.scriptURL : 'installing'); } catch (e) { return String(e); } });
    console.log('==', f, '\nmanifest url:', m.url || '(none)', '\nmanifest errors:', JSON.stringify(m.errors || []), '\ninstallability errors:', JSON.stringify(inst.installabilityErrors || inst), '\nservice workers:', JSON.stringify(sw));
  }
  await b.close(); srv.close();
})();
