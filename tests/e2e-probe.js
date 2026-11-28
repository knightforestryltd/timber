'use strict';
// Scratch probe: signed-in office device, run a snippet of steps given as a JS file, dump state.
const path = require('path');
const { serve, setup } = require('./e2e-lib');
const { seedCompany } = require('./seed');
const SITE = path.resolve(process.argv[2]);
(async () => {
  const srv = await serve(SITE, 8143);
  const seed = seedCompany(path.join(SITE, 'company-apps-script.gs'));
  const E = await setup({ rt: seed.rt });
  const ctx = await E.newContext(JSON.parse(process.argv[4] || '{}')), page = await ctx.newPage(); E.watch(page, 'p');
  const steps = require(path.resolve(process.argv[3]));
  try { await steps({ page, E, seed, base: 'http://127.0.0.1:8143/', shot: n => page.screenshot({ path: path.join(__dirname, 'shots', 'probe-' + n + '.png'), fullPage: true }) }); }
  catch (e) { console.log('STEP ERROR', e.message.split('\n').slice(0, 6).join('\n')); }
  console.log('pageErrors', E.log.pageErrors); console.log('consoleErrors', E.log.consoleErrors); console.log('dialogs', E.log.dialogs);
  console.log('calls', E.log.requests.map(r => `${r.page} ${r.svc}/${r.action} -> ${r.status}`).join(' | '));
  await E.browser.close(); srv.close();
})();
