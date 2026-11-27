// Two companies on one website: the company named in kf-config.js keeps the sign-in list (company name -> link).
const { start, BASE } = require('./e2e');
const { makeEnv } = require('./gasmock');
(async () => {
  const knight = makeEnv(), bro = makeEnv(), other = makeEnv();
  const BRO = 'https://script.google.com/macros/s/BRO/exec', OTHER = 'https://script.google.com/macros/s/OTHER/exec';
  // the directory (Knight) opens a registering company's link to check it: route that to the right in-memory script
  knight.ctx.UrlFetchApp.fetch = url => { const E = /\/BRO\//.test(url) ? bro : /\/OTHER\//.test(url) ? other : knight; return { getContentText: () => E.ctx.doGet({ parameter: {} }).s }; };
  const h = await start({ env: knight, envs: { TEST: knight, BRO: bro, OTHER: other }, log: !!process.env.LOG });
  // each "phone" starts with empty storage
  const phone = async page => { const p0 = await h.open('app.html'); await p0.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await p0.close(); return h.open(page); };
  let n = 0, bad = 0; const t = (c, m) => { n++; if (!c) bad++; console.log((c ? 'ok   ' : 'FAIL ') + m); };
  let r = knight.post('sync', { action: 'setPassword', newPassword: 'knightpw' }); knight.post('sync', { action: 'saveProfile', adminToken: r.adminToken, profile: { name: 'Knight Forestry' } });
  // 1. a fresh phone of a NEW company: sign-in screen -> "Setting up a new company?" -> paste its link -> name + password
  let pg = await h.open('index.html');
  t(await pg.isVisible('#kfSignIn') && await pg.isVisible('#kfsCoName'), 'sign-in screen asks for the company name');
  await pg.click('#kfsNew'); await pg.waitForTimeout(900);
  t(await pg.isVisible('#coLinkUrl'), 'new company: Company settings opens with the sheet link field');
  await pg.fill('#coLinkUrl', BRO); await pg.click('#btnSaveLink'); await pg.waitForTimeout(800);
  t(await pg.isVisible('#coLinkSetup'), 'link has no password yet: asks the company name and a new password');
  await pg.fill('#coLinkCo', 'Brother Co'); await pg.fill('#coLinkPw1', 'bropw1'); await pg.fill('#coLinkPw2', 'bropw1'); await pg.click('#btnSaveLink'); await pg.waitForTimeout(2000);
  const msg = await pg.textContent('#coLinkMsg').catch(() => '');
  const dir = JSON.parse(knight.props.companyDir || '{}');
  t(dir['brother co'] && dir['brother co'].url === BRO, 'Brother Co registered in the sign-in list (on Knight\'s script): ' + msg.slice(0, 80));
  t(bro.ctx.hasPassword_() && /Brother Co/.test(JSON.stringify(bro.ctx.readSettings_())), 'Brother Co has its own password and name in its OWN script');
  t(!knight.ctx.readSettings_().companyName || knight.ctx.readSettings_().profile.name === 'Knight Forestry', 'Knight\'s own settings untouched');
  await pg.close();
  // 2. a second fresh phone: company name + company password only
  pg = await phone('dispatch.html');
  await pg.fill('#kfsCoName', 'brother co'); await pg.fill('#kfsPw', 'bropw1'); await pg.fill('#kfsName', 'Bro office'); await pg.click('#kfsAdmin'); await pg.waitForTimeout(1800);
  let ls = await pg.evaluate(() => ({ url: localStorage.getItem('kfCompanyUrl'), tok: localStorage.getItem('kfAdminToken') }));
  t(ls.url === BRO && ls.tok, 'second phone signed in with "brother co" + password: connected to Brother Co, admin');
  await pg.close();
  // 3. a driver phone: company name, then name + passcode on Drivers
  const bt = bro.ctx.adminTokens_(); bro.post('drivers', { action: 'adminSaveDriver', password: 'bropw1', driver: { name: 'Sam', passcode: '4321' } });
  pg = await phone('index.html'); await pg.fill('#kfsCoName', 'Brother Co'); await pg.click('#kfsPerson'); await pg.waitForTimeout(1500);
  t(/drivers\.html/.test(pg.url()) && (await pg.evaluate(() => localStorage.getItem('driversUrl'))) === BRO + '?svc=drivers', 'driver phone: "Brother Co" -> Drivers page on Brother Co\'s link');
  await pg.selectOption('#lgName', 'Sam'); await pg.fill('#lgPass', '4321'); await pg.click('#lgGo'); await pg.waitForTimeout(1200);
  t((await pg.textContent('#view-drivers')).includes('Hi Sam'), 'Sam logged in to Brother Co');
  await pg.close();
  // 4. wrong names, Knight by its own name, and a name already taken
  pg = await phone('index.html'); await pg.fill('#kfsCoName', 'Nobody Ltd'); await pg.fill('#kfsPw', 'x'); await pg.fill('#kfsName', 'x'); await pg.click('#kfsAdmin'); await pg.waitForTimeout(900);
  t(/No company called "Nobody Ltd"/.test(await pg.textContent('#kfsMsg')), 'unknown company name: clear message');
  await pg.fill('#kfsCoName', 'Knight Forestry'); await pg.fill('#kfsPw', 'knightpw'); await pg.click('#kfsAdmin'); await pg.waitForTimeout(1500);
  t((await pg.evaluate(() => localStorage.getItem('kfCompanyUrl'))) === BASE, '"Knight Forestry" + password connects to Knight');
  await pg.close();
  r = other.post('sync', { action: 'setPassword', newPassword: 'otherpw' }); other.post('sync', { action: 'saveProfile', adminToken: r.adminToken, profile: { name: 'Brother Co.' } });
  r = knight.post('sync', { action: 'registerCompany', url: OTHER });
  t(r.status === 'taken', 'a different company cannot take the name "Brother Co": ' + r.message);
  r = knight.post('sync', { action: 'registerCompany', url: 'https://evil.example.com/exec' }); t(r.status === 'error', 'only script.google.com company links are accepted');
  t(h.errs.length === 0, 'no page errors' + (h.errs.length ? ': ' + h.errs.join(' | ') : ''));
  console.log(n + ' checks, ' + bad + ' failed'); await h.browser.close(); process.exitCode = bad ? 1 : 0;
})();
