'use strict';
// Syntax of every script (files + inline <script> blocks), ids, local links, service-worker list, icons.
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
const D = path.resolve(process.argv[2]); const files = fs.readdirSync(D); let bad = 0; const say = (ok, m) => { if (!ok) bad++; console.log((ok ? 'ok   ' : 'FAIL ') + m); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kfsyn-'));
const syn = (code, label) => { const f = path.join(tmp, 'x.js'); fs.writeFileSync(f, code); try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); say(true, 'syntax ' + label); } catch (e) { say(false, 'syntax ' + label + ': ' + String(e.stderr).split('\n').slice(0, 5).join(' | ')); } };
files.filter(f => /\.(js|gs)$/.test(f)).forEach(f => syn(fs.readFileSync(path.join(D, f), 'utf8'), f));
const html = files.filter(f => f.endsWith('.html'));
html.forEach(f => { const h = fs.readFileSync(path.join(D, f), 'utf8'); [...h.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].forEach((m, i) => syn(m[1], f + ' inline #' + i)); });
const shared = ['nav.js', 'kf-stock.js', 'kf-stats.js', 'theme.js'].filter(f => files.includes(f)).map(f => fs.readFileSync(path.join(D, f), 'utf8')).join('');
html.forEach(f => {
  const h = fs.readFileSync(path.join(D, f), 'utf8'), body = h.replace(/<script[\s\S]*?<\/script>/g, '');
  const ids = [...body.matchAll(/\sid="([^"$`{}]+)"/g)].map(m => m[1]), dup = [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))];
  const known = new Set([...(h + shared).matchAll(/id\s*=\s*["'`\\]*([A-Za-z_][\w-]*)/g)].map(m => m[1]));
  const prefixes = [...(h + shared).matchAll(/id="([A-Za-z_][\w-]*)\$\{/g)].map(m => m[1]);
  const refs = [...new Set([...h.matchAll(/(?:getElementById|\$)\(\s*['"]([A-Za-z_][\w-]*)['"]\s*\)/g)].map(m => m[1]))];
  const missing = refs.filter(r => !known.has(r) && !prefixes.some(p => r.startsWith(p)));
  say(!dup.length && !missing.length, `${f}: ${ids.length} ids, duplicates ${JSON.stringify(dup)}, references to ids that exist nowhere ${JSON.stringify(missing)}`);
  const links = [...h.matchAll(/(?:href|src)\s*=\s*["']([^"'#?:]+?\.(?:html|js|css|json|png|jpg|apk))["']/g)].map(m => m[1].replace(/^\//, '')).filter(x => !files.includes(x));
  say(!links.length, `${f}: local links all exist ${links.length ? JSON.stringify(links) : ''}`);
});
if (files.includes('sw.js')) { const L = JSON.parse(/const FILES = (\[.*?\]);/.exec(fs.readFileSync(path.join(D, 'sw.js'), 'utf8'))[1].replace(/'/g, '"')); const miss = L.filter(x => x !== '/' && !files.includes(x.slice(1))); say(!miss.length, 'sw.js: every precached file exists ' + (miss.length ? JSON.stringify(miss) : '')); }
if (files.includes('manifest.json')) {
  const m = JSON.parse(fs.readFileSync(path.join(D, 'manifest.json'), 'utf8'));
  (m.icons || []).forEach(ic => { const b = fs.readFileSync(path.join(D, ic.src)); const png = b.slice(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const size = png ? b.readUInt32BE(16) + 'x' + b.readUInt32BE(20) : (b[0] === 0xff && b[1] === 0xd8 ? 'JPEG' : 'unknown');
    say(png && size === ic.sizes, `manifest icon ${ic.src}: declared ${ic.type} ${ic.sizes}, file is ${png ? 'PNG ' + size : size} (${Math.round(b.length / 1024)} KB)`); });
}
console.log('\nSTATIC: ' + (bad ? bad + ' problem(s)' : 'all ok'));
