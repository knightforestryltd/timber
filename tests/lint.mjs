import { createRequire } from 'module'; import { execSync } from 'child_process';
const req = createRequire(import.meta.url); let eslintPath; try { eslintPath = req.resolve('eslint'); } catch (e) { eslintPath = req.resolve(execSync('npm root -g').toString().trim() + '/eslint'); }
const { ESLint } = await import(eslintPath);
import fs from 'fs'; import path from 'path';
const D = process.argv[2], bg = JSON.parse(fs.readFileSync(new URL('./browser-globals.json', import.meta.url)));
const shared = ['theme.js', 'kf-config.js', 'nav.js', 'kf-stock.js', 'kf-stats.js'].map(f => fs.readFileSync(path.join(D, f), 'utf8')).join('\n');
const winGlobals = [...new Set([...shared.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g)].map(m => m[1]))];
const globals = {}; bg.forEach(n => globals[n] = 'readonly'); winGlobals.forEach(n => globals[n] = 'writable');
['html2pdf', 'Capacitor', 'google', '__kfEarly', 'L'].forEach(n => globals[n] = 'readonly');
const rules = { 'no-undef': 'error', 'no-dupe-keys': 'error', 'no-unreachable': 'warn', 'no-func-assign': 'off', 'no-self-assign': 'warn', 'no-dupe-else-if': 'error', 'no-duplicate-case': 'error',
  'no-unsafe-negation': 'error', 'no-cond-assign': ['warn', 'except-parens'], 'no-const-assign': 'error', 'no-redeclare': 'warn', 'use-isnan': 'error', 'valid-typeof': 'error', 'no-loss-of-precision': 'warn', 'no-unused-vars': 'off', 'no-dupe-class-members': 'error', 'no-compare-neg-zero': 'error', 'no-unsafe-finally': 'warn', 'for-direction': 'error', 'getter-return': 'error', 'no-sparse-arrays': 'warn', 'no-import-assign': 'error' };
const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: [{ languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals }, rules }] });
const targets = [];
for (const f of fs.readdirSync(D)) {
  if (f.endsWith('.html')) {
    const h = fs.readFileSync(path.join(D, f), 'utf8');
    const code = [...h.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n;\n');
    // inline handlers
    const outside = h.replace(/<script[\s\S]*?<\/script>/g, '');
    const handlers = [...outside.matchAll(/\son[a-z]+="([^"]*)"/g)].map(m => m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    const own = [...new Set([...code.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g)].map(m => m[1]))];   // names the page itself puts on window
    targets.push({ name: f, code: (own.length ? '/* global ' + own.join(', ') + ' */\n' : '') + code + '\n;' + handlers.map((x, i) => 'function __h' + i + '(event){' + x + '\n}').join('\n') });
  }
}
['nav.js', 'kf-stock.js', 'kf-stats.js', 'theme.js', 'sw.js'].forEach(f => targets.push({ name: f, code: fs.readFileSync(path.join(D, f), 'utf8') }));
targets.push({ name: 'company-apps-script.gs', code: fs.readFileSync(path.join(D, 'company-apps-script.gs'), 'utf8'), gas: true });
const gasG = { SpreadsheetApp: 1, DriveApp: 1, Utilities: 1, Session: 1, ContentService: 1, MailApp: 1, UrlFetchApp: 1, Maps: 1, ScriptApp: 1, Logger: 1, PropertiesService: 1, CacheService: 1, LockService: 1 };
let total = 0;
for (const t of targets) {
  let e2 = eslint;
  if (t.gas) { const g = {}; Object.keys(gasG).forEach(k => g[k] = 'readonly'); e2 = new ESLint({ overrideConfigFile: true, overrideConfig: [{ languageOptions: { ecmaVersion: 2019, sourceType: 'script', globals: Object.assign(g, { JSON: 'readonly', Math: 'readonly', Date: 'readonly', Number: 'readonly', String: 'readonly', Object: 'readonly', Array: 'readonly', parseInt: 'readonly', isNaN: 'readonly', isFinite: 'readonly', Error: 'readonly', encodeURIComponent: 'readonly', RegExp: 'readonly', Boolean: 'readonly', parseFloat: 'readonly' }) }, rules }] }); }
  if (t.name === 'sw.js') { const g = Object.assign({}, globals, { self: 'readonly', caches: 'readonly', clients: 'readonly' }); e2 = new ESLint({ overrideConfigFile: true, overrideConfig: [{ languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: g }, rules }] }); }
  const [r] = await e2.lintText(t.code, { filePath: t.name + '.js' });
  const msgs = r.messages.filter(m => !(t.name.endsWith('.html') && m.ruleId === 'no-redeclare' && /already defined as a built-in global/.test(m.message)));
  total += msgs.length;
  console.log(`${msgs.length ? '!!' : 'ok'} ${t.name}: ${msgs.length} issue(s)`);
  msgs.slice(0, 40).forEach(m => console.log(`     L${m.line} [${m.ruleId}] ${m.message}  ::  ${t.code.split('\n')[m.line - 1].trim().slice(0, 150)}`));
}
console.log('total', total);
