// End-to-end harness: real pages (file://) in headless Chromium; every call to script.google.com is answered by
// company-apps-script.gs running in the in-memory mock (gasmock.js).
const { chromium } = require('playwright');
const { makeEnv } = require('./gasmock');
const BASE = 'https://script.google.com/macros/s/TEST/exec';
async function start(opts) {
  opts = opts || {};
  const env = opts.env || makeEnv();
  const browser = opts.browser || await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 } });
  await ctx.addInitScript((base) => {
    Object.defineProperty(window, 'KF_COMPANY_URL', { get: () => base, set: () => {}, configurable: false });
    window.alert = m => { (window.__alerts = window.__alerts || []).push(String(m)); };
    window.confirm = m => { (window.__confirms = window.__confirms || []).push(String(m)); return window.__confirmAnswer !== false; };
    window.prompt = (m, d) => (window.__promptAnswer != null ? window.__promptAnswer : d || '');
  }, BASE);
  await ctx.route('https://script.google.com/**', async route => {
    const req = route.request(), u = new URL(req.url()), params = Object.fromEntries(u.searchParams.entries());
    let out;
    const id = (u.pathname.match(/\/s\/([^/]+)\/exec/) || [])[1], E = (opts.envs && opts.envs[id]) || env;
    try {
      if (req.method() === 'POST') { const e = { parameter: params, postData: { contents: req.postData() || '{}' } }; out = E.ctx.doPost(e).s; }
      else out = E.ctx.doGet({ parameter: params }).s;
    } catch (err) { out = JSON.stringify({ status: 'error', message: 'MOCK: ' + err.message }); }
    if (opts.log) console.log('   >', req.method(), params.svc || '', (req.postData() || '').slice(0, 90), '=>', out.slice(0, 120));
    await route.fulfill({ status: 200, contentType: 'application/json', body: out, headers: { 'access-control-allow-origin': '*' } });
  });
  await ctx.route(/maps\.googleapis|routes\.googleapis|cdnjs|openstreetmap/, r => r.abort());
  const errs = [];
  const open = async (page, ls) => {
    const pg = await ctx.newPage();
    pg.on('pageerror', e => errs.push(page + ': ' + e.message));
    pg.on('console', m => { if (m.type() === 'error' && !/Failed to load|ERR_|net::/.test(m.text())) errs.push(page + ' console: ' + m.text()); });
    if (ls) { await pg.goto('file:///home/user/timber/app.html'); await pg.evaluate(o => { for (const k in o) localStorage.setItem(k, typeof o[k] === 'string' ? o[k] : JSON.stringify(o[k])); }, ls); }
    await pg.goto('file:///home/user/timber/' + page);
    await pg.waitForTimeout(600);
    return pg;
  };
  return { env, browser, ctx, open, errs, BASE };
}
module.exports = { start, BASE };
