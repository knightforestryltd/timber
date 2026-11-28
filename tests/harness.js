'use strict';
// tiny test runner: groups, checks, findings
const results = []; let cur = null;
function group(name, fn) {
  cur = { name, checks: [], error: null };
  results.push(cur);
  try { fn(); } catch (e) { cur.error = (e && e.stack) || String(e); }
}
async function agroup(name, fn) {
  cur = { name, checks: [], error: null };
  results.push(cur);
  try { await fn(); } catch (e) { cur.error = (e && e.stack) || String(e); }
}
function check(cond, msg, detail) { cur.checks.push({ ok: !!cond, msg, detail: cond ? undefined : detail }); return !!cond; }
function eq(a, b, msg) { const ok = JSON.stringify(a) === JSON.stringify(b); return check(ok, msg, 'expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); }
function summary(title) {
  let pass = 0, fail = 0, err = 0; const lines = ['== ' + title + ' =='];
  results.forEach(g => {
    const f = g.checks.filter(c => !c.ok);
    pass += g.checks.length - f.length; fail += f.length; if (g.error) err++;
    lines.push((f.length || g.error ? 'FAIL ' : 'ok   ') + g.name + ' (' + (g.checks.length - f.length) + '/' + g.checks.length + ')');
    f.forEach(c => lines.push('       x ' + c.msg + (c.detail ? ' -- ' + String(c.detail).slice(0, 400) : '')));
    if (g.error) lines.push('       ! threw: ' + g.error.split('\n').slice(0, 4).join(' | '));
  });
  lines.push('TOTAL: ' + pass + ' passed, ' + fail + ' failed, ' + err + ' groups threw');
  return { text: lines.join('\n'), pass, fail, err, results };
}
module.exports = { group, agroup, check, eq, summary, results };
