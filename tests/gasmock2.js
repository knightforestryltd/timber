// In-memory Google Apps Script environment that can run several scripts side by side
// (the new company script plus the old separate scripts it imports from).
const fs = require('fs'), vm = require('vm'), crypto = require('crypto');

function chain(obj) {   // unknown formatting methods (setFontSize, merge, createFilter...) are no-ops that chain
  return new Proxy(obj, { get(t, k) { if (k in t) return t[k]; if (typeof k === 'symbol') return undefined; return function () { return this; }; } });
}
function makeSheet(name) {
  let data = []; let maxCols = 26;
  const lastRow = () => { let r = data.length; while (r > 0 && (data[r - 1] || []).every(v => v === '' || v == null)) r--; return r; };
  const sh = chain({
    name, _data: () => data, getName: () => name,
    getLastRow: lastRow,
    getLastColumn: () => data.reduce((m, row) => { let c = row.length; while (c > 0 && (row[c - 1] === '' || row[c - 1] == null)) c--; return Math.max(m, c); }, 0),
    getMaxColumns: () => maxCols, getMaxRows: () => Math.max(1000, data.length),
    insertColumnsAfter: (a, n) => { maxCols += n; },
    appendRow(row) { data[lastRow()] = row.slice(); },
    deleteRow(r) { data.splice(r - 1, 1); },
    getRange(r, c, nr, nc) {
      if (typeof r === 'string') { r = 1; c = 1; nr = 1; nc = 1; }
      nr = nr || 1; nc = nc || 1;
      return chain({
        getValues: () => { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) { const v = (data[r - 1 + i] || [])[c - 1 + j]; row.push(v == null ? '' : v); } out.push(row); } return out; },
        getValue: () => { const v = (data[r - 1] || [])[c - 1]; return v == null ? '' : v; },
        setValues(vals) { if (vals.length !== nr || vals[0].length !== nc) throw new Error('size mismatch'); for (let i = 0; i < nr; i++) { data[r - 1 + i] = data[r - 1 + i] || []; for (let j = 0; j < nc; j++) data[r - 1 + i][c - 1 + j] = vals[i][j]; } return this; },
        setValue(v) { data[r - 1] = data[r - 1] || []; data[r - 1][c - 1] = v; return this; },
        clearContent() { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (data[r - 1 + i]) data[r - 1 + i][c - 1 + j] = ''; return this; }
      });
    }
  });
  return sh;
}
function makeSS(id) {
  const sheets = { Sheet1: makeSheet('Sheet1') }, order = ['Sheet1'];
  return chain({
    getId: () => id, _sheets: sheets,
    getSheetByName: n => sheets[n] || null, insertSheet: n => { order.push(n); return (sheets[n] = makeSheet(n)); },
    getSheets: () => order.filter(n => sheets[n]).map(n => sheets[n]), deleteSheet: s => { delete sheets[s.name]; },
    getActiveSheet: () => sheets[order.find(n => sheets[n])]
  });
}
const registry = {};          // url -> env (for UrlFetchApp between scripts)
const spreadsheets = {};      // id -> ss (shared Drive)
function makeEnv(opts) {
  opts = opts || {};
  const props = {}, cache = {}, mails = [], triggers = [], driveFiles = [];
  const ssId = opts.ssId || ('SS' + Math.random().toString(36).slice(2, 8));
  let ss = null;
  const getSS = () => { if (!ss) { ss = makeSS(ssId); spreadsheets[ssId] = ss; } return ss; };
  const env = {
    console, JSON, Date, Math, Number, String, Object, Array, isFinite, isNaN, parseInt, Error,
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, setProperties: (o) => { for (const k in o) props[k] = String(o[k]); }, deleteProperty: k => { delete props[k]; } }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ setMimeType() { return this; }, text: t }) },
    SpreadsheetApp: {
      create: (n) => { const s = getSS(); if (n) s._name = n; return s; }, openById: id => (id === ssId ? getSS() : spreadsheets[id]), getActiveSpreadsheet: () => getSS(),
      openByUrl: u => spreadsheets[String(u).split('/d/')[1]]
    },
    Session: { getScriptTimeZone: () => 'America/Edmonton', getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(), DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(s, 'utf8').digest()).map(b => b > 127 ? b - 256 : b),
      formatDate: (d, tz, f) => f === 'yyyyMMdd' ? d.toISOString().slice(0, 10).replace(/-/g, '') : d.toISOString().slice(0, 10),
      base64Decode: s => Array.from(Buffer.from(s, 'base64')), newBlob: (bytes, type, name) => ({ bytes, type, name })
    },
    MailApp: { sendEmail: o => mails.push(o) },
    Maps: { newGeocoder: () => ({ reverseGeocode: () => ({ status: 'OK', results: [{ types: ['locality'], address_components: [{ long_name: 'Breton' }, { short_name: 'AB', types: ['administrative_area_level_1'] }], geometry: { location: { lat: 53.1, lng: -114.47 } } }] }) }) },
    ScriptApp: { getProjectTriggers: () => triggers.map(h => ({ getHandlerFunction: () => h })), newTrigger: h => chain({ create() { triggers.push(h); return this; } }) },
    DriveApp: {
      getFilesByName: n => { const list = Object.values(spreadsheets).filter(x => x._name === n); let i = 0; return { hasNext: () => i < list.length, next: () => ({ getId: () => list[i++].getId() }) }; },
      getFileById: id => ({ makeCopy: (name) => { driveFiles.push(name); return {}; } }),
      getFoldersByName: () => ({ hasNext: () => false }), createFolder: () => ({ getFiles: () => { let i = 0; return { hasNext: () => i < driveFiles.length, next: () => ({ getDateCreated: () => new Date(), setTrashed() {} }, i++) }; } })
    },
    UrlFetchApp: {
      fetch: (url, o) => {
        o = o || {}; const base = url.split('?')[0], target = registry[base];
        if (!target) throw new Error('no route ' + base);
        const params = Object.fromEntries(new URL(url).searchParams);
        const out = (o.method || 'get') === 'post' ? target.env.doPost({ parameter: params, postData: { contents: o.payload } }) : target.env.doGet({ parameter: params });
        target.reset();
        return { getContentText: () => out.text };
      }
    }
  };
  vm.createContext(env);
  vm.runInContext(fs.readFileSync(opts.file, 'utf8'), env);
  const api = {
    env, props, mails, triggers, driveFiles, ss: () => getSS(), ssId,
    tab: n => getSS()._sheets[n],
    reset() { try { vm.runInContext('if (typeof ss__ !== "undefined") { ss__ = null; tabs__ = {}; }', env); } catch (e) {} },
    get(params) { api.reset(); return JSON.parse(env.doGet({ parameter: params || {} }).text); },
    post(body, params) { api.reset(); return JSON.parse(env.doPost({ parameter: params || {}, postData: { contents: JSON.stringify(body) } }).text); }
  };
  if (opts.url) registry[opts.url] = api;
  if (opts.name) { getSS()._name = opts.name; }
  return api;
}
module.exports = { makeEnv, registry, spreadsheets };
