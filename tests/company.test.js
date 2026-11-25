const { makeEnv } = require('./gasmock2');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };
const R = require('path').resolve(__dirname, '..') + '/';

// ---------------- the old separate scripts, with data ----------------
const OLD = { quote: 'https://script.google.com/macros/s/OLDQ/exec', tickets: 'https://script.google.com/macros/s/OLDT/exec', yards: 'https://script.google.com/macros/s/OLDY/exec', drivers: 'https://script.google.com/macros/s/OLDD/exec' };
const oq = makeEnv({ file: R + 'quote-apps-script-v3.gs', url: OLD.quote });
const ot = makeEnv({ file: R + 'tickets-apps-script.gs', url: OLD.tickets });
const oy = makeEnv({ file: R + 'yard-apps-script.gs', url: OLD.yards });
const od = makeEnv({ file: R + 'drivers-apps-script.gs', url: OLD.drivers });
oq.post({ action: 'setPassword', newPassword: 'knight1' });
oq.post({ action: 'saveSettings', password: 'knight1', settings: { locations: [{ name: 'Barmac', species: [{ name: 'Birch', pricePerTonne: 90 }] }], units: [{ name: 'Tandem', hourly: 150 }], companyName: 'Knight Forestry Ltd', apiKey: 'MAPSKEY', scriptUrl: OLD.tickets } });
oq.post({ customerName: 'Bob', phone: '780', address: '1 Main', options: [{ location: 'Barmac', species: 'Birch', truck: 'Tandem', tonnes: 10, total: 1050 }] });
oq.post({ action: 'updateStatus', customerName: 'Bob', status: 'Delivered', loadId: 'KF-1', netTonnes: 10.2 });
ot.post({ action: 'save', row: ['KF-1', 'Birch', 'Bob', 'Barmac', 15000, 25200, 10200, '', '', '10:00', ''] });
oy.post({ action: 'add', yard: 'Home', species: 'Birch', type: 'In', tonnes: 40 });
od.post({ action: 'adminSetPassword', newPassword: 'drvadmin' });
od.post({ action: 'adminSaveConfig', password: 'drvadmin', config: { units: [{ name: 'Truck 7', plate: 'BX1' }], rules: { v: 3, defaultSet: 'sk' } } });
od.post({ action: 'adminSaveDriver', password: 'drvadmin', driver: { name: 'Sam', passcode: '2468' } });
od.post({ action: 'saveShift', name: 'Sam', passcode: '2468', shift: { id: 'S1', date: '2026-11-20', startedAt: '2026-11-20T08:00:00Z', unit: 'Truck 7', startOdo: 1, events: [{ t: '2026-11-20T08:00:00Z', s: 'ON' }] } });

// ---------------- new company script ----------------
const NEW = 'https://script.google.com/macros/s/NEW/exec';
const g = makeEnv({ file: R + 'company-apps-script.gs', url: NEW });
let r = g.get({});
ok(r.app === 'company' && r.unified && !r.hasPassword, 'fresh: app info, no password');
r = g.get({ settings: '1' });
ok(r._meta && r._meta.unified && !r._meta.hasPassword && r._meta.companyId, 'fresh: meta for the connect screen');
r = g.get({ svc: 'loads' });
ok(r.status === 'ok' && r.rows.length === 0, 'fresh: open before a password exists (empty)');
r = g.post({ action: 'setPassword', newPassword: 'knight1' }, { svc: 'sync' });
ok(r.status === 'ok' && r.key && r.key.length > 40 && g.triggers.includes('nightly'), 'password set -> company key + nightly backup trigger');
const K = r.key;
ok(g.get({ svc: 'loads' }).status === 'nokey', 'reads need the key');
ok(g.get({ svc: 'tickets', k: 'wrong' }).status === 'nokey', 'wrong key refused');
ok(g.post({ action: 'save', row: ['X'] }, { svc: 'tickets' }).status === 'nokey', 'writes need the key');
r = g.get({ settings: '1' });
ok(r.status === 'nokey' && r._meta.hasPassword && !r.locations, 'connect screen sees only meta without the key');
r = g.post({ action: 'checkPassword', password: 'nope' }, { svc: 'sync' });
ok(r.status === 'badpassword' && !r.key, 'wrong password, no key');
r = g.post({ action: 'checkPassword', password: 'knight1' }, { svc: 'sync' });
ok(r.status === 'ok' && r.key === K, 'right password returns the key');

// ---------------- import ----------------
r = g.post({ action: 'importOld', password: 'knight1', oldSyncUrl: OLD.quote, loadsUrl: OLD.quote, ticketsUrl: OLD.tickets, yardsUrl: OLD.yards, oldDriversUrl: OLD.drivers, oldDriversPassword: 'drvadmin' }, { svc: 'sync' });
ok(r.status === 'ok' && r.settings && r.loads === 1 && r.tickets === 1 && r.yards === 1 && r.drivers === 1 && r.shifts === 1 && r.driverConfig, 'import: ' + JSON.stringify(r));
r = g.get({ settings: '1', svc: 'sync', k: K });
ok(r.locations[0].name === 'Barmac' && r.apiKey === 'MAPSKEY' && !r.scriptUrl && r.companyName === 'Knight Forestry Ltd', 'settings imported, old links dropped');
r = g.get({ svc: 'loads', k: K });
ok(r.rows.length === 1 && r.rows[0].loadId === 'KF-1' && r.rows[0].status === 'Delivered' && Number(r.rows[0].netTonnes) === 10.2, 'loads imported in the old format');
ok(g.get({ svc: 'tickets', k: K }).rows[0][0] === 'KF-1', 'tickets imported in the old format');
ok(g.get({ svc: 'yards', k: K }).rows[0].yard === 'Home', 'yards imported');
r = g.post({ action: 'importOld', password: 'knight1', loadsUrl: OLD.quote, ticketsUrl: OLD.tickets }, { svc: 'sync' });
ok(r.loads === 0 && r.tickets === 0 && r.notes.length >= 2, 'import twice never duplicates');

// ---------------- each part, through the single link ----------------
r = g.post({ customerName: 'Ann', options: [{ location: 'Barmac', species: 'Birch', truck: 'Tandem', total: 500 }] }, { svc: 'loads', k: K });
ok(r.status === 'ok' && g.get({ svc: 'loads', k: K }).rows.length === 2, 'booking through the single link');
ok(g.post({ action: 'updateStatus', customerName: 'Ann', status: 'Started', loadId: 'KF-2' }, { svc: 'loads', k: K }).status === 'ok', 'dispatch status');
ok(g.post({ action: 'save', row: ['KF-2', 'Birch', 'Ann', 'Barmac', 1, 2, 1, '', '', '', ''] }, { svc: 'tickets', k: K }).status === 'ok' && g.get({ svc: 'tickets', k: K }).rows.length === 2, 'ticket saved');
ok(g.post({ action: 'delete', ticket: 'KF-2' }, { svc: 'tickets', k: K }).status === 'deleted' && g.get({ svc: 'tickets', k: K }).rows.length === 1, 'ticket deleted');
ok(g.post({ action: 'sendInvoice', to: 'x@example.com', pdfBase64: 'JVBERg==' }, { svc: 'loads', k: K }).status === 'sent' && g.mails.length === 1, 'invoice email');

// profile + invoice numbers + settings save keeps profile
r = g.post({ action: 'saveProfile', password: 'knight1', profile: { name: 'Knight Forestry Ltd', gst: '123', logo: 'data:image/png;base64,AAA' } }, { svc: 'sync' });
ok(r.status === 'saved' && r.profile.gst === '123', 'profile saved');
ok(g.get({ svc: 'sync', profile: '1', k: K }).profile.logo.startsWith('data:image'), 'profile readable with the key');
const n1 = g.post({ action: 'nextInvoice', ymd: '20261125' }, { svc: 'sync', k: K }).n, n2 = g.post({ action: 'nextInvoice', ymd: '20261125' }, { svc: 'sync', k: K }).n;
ok(n1 === 1 && n2 === 2, 'invoice numbers never repeat');
r = g.post({ action: 'saveSettings', password: 'knight1', settings: { locations: [{ name: 'Barmac' }], companyName: 'Knight Forestry Ltd' }, force: true }, { svc: 'sync' });
ok(r.status === 'saved' && g.get({ svc: 'sync', profile: '1', k: K }).profile.gst === '123', 'Save to Company keeps the company info');

// drivers through the single link
ok(g.get({ svc: 'drivers', action: 'drivers' }).drivers.includes('Sam'), 'drivers list (no key needed on a driver phone)');
r = g.post({ action: 'driverLogin', name: 'Sam', passcode: '2468' }, { svc: 'drivers' });
ok(r.status === 'ok' && r.openShift && r.openShift.id === 'S1' && r.units[0].name === 'Truck 7' && r.rules.defaultSet === 'sk', 'imported passcode works, open shift + units + rules carried over');
ok(r.company.name === 'Knight Forestry Ltd', 'drivers company name from the profile');
ok(g.post({ action: 'adminCheck', password: '' }, { svc: 'drivers', k: K }).status === 'ok', 'drivers admin opens on a company device (key)');
ok(g.post({ action: 'adminCheck', password: '' }, { svc: 'drivers' }).status === 'badpassword', 'drivers admin refused without key or password');
ok(g.post({ action: 'adminCheck', password: 'knight1' }, { svc: 'drivers' }).status === 'ok', 'drivers admin with the company password');
ok(g.post({ action: 'adminSetPassword', newPassword: 'x1234' }, { svc: 'drivers', k: K }).status === 'error', 'drivers admin password is the company password');
r = g.post({ action: 'submitShift', name: 'Sam', passcode: '2468', shift: { id: 'S1', date: '2026-11-20', startedAt: '2026-11-20T08:00:00Z', unit: 'Truck 7', startOdo: 1, endOdo: 50, remarks: 'none', signature: 'x', closedAt: '2026-11-20T18:00:00Z', events: [{ t: '2026-11-20T08:00:00Z', s: 'ON' }] } }, { svc: 'drivers' });
ok(r.status === 'ok' && r.submitted, 'shift submitted through the single link');
const log = g.tab('Log')._data().slice(1).map(x => x[2]);
ok(['company created', 'imported from old scripts', 'booked', 'status Started', 'saved', 'deleted', 'invoice emailed', 'company info saved', 'shift submitted'].every(a => log.includes(a)), 'change log records everything: ' + log.join(', '));

// password change rotates the key
r = g.post({ action: 'setPassword', password: 'knight1', newPassword: 'newpass1' }, { svc: 'sync' });
ok(r.status === 'ok' && r.key !== K && g.get({ svc: 'loads', k: K }).status === 'nokey' && g.get({ svc: 'loads', k: r.key }).status === 'ok', 'new password = new key, old devices must reconnect');

// backups
g.env.nightly();
ok(g.driveFiles.length === 1 && /Company Data backup/.test(g.driveFiles[0]), 'nightly backup copy');

// a brother: fresh company, nothing from Knight
const b = makeEnv({ file: R + 'company-apps-script.gs', url: 'https://script.google.com/macros/s/BRO/exec' });
b.post({ action: 'setPassword', newPassword: 'bro123' }, { svc: 'sync' });
const bk = b.post({ action: 'checkPassword', password: 'bro123' }, { svc: 'sync' }).key;
r = b.get({ settings: '1', svc: 'sync', k: bk });
ok(!r.locations && !r.companyName && r._meta.companyId !== g.get({ settings: '1' })._meta.companyId, 'a new company starts empty with its own id');
ok(b.get({ svc: 'loads', k: bk }).rows.length === 0 && b.get({ svc: 'loads', k: K }).status === 'nokey', 'company keys do not cross');

console.log(`company script tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
