// Minimal in-memory Apps Script environment to run company-apps-script.gs in Node (tests only).
const crypto = require('crypto'), fs = require('fs'), vm = require('vm');
function makeEnv() {
  const props = {}, cache = {}, mails = [], files = [];
  class Range {
    constructor(sh, r, c, nr, nc) { this.sh = sh; this.r = r; this.c = c; this.nr = nr || 1; this.nc = nc || 1; }
    _chk() { if (this.c + this.nc - 1 > this.sh.maxCols) throw new Error('Range outside sheet: col ' + (this.c + this.nc - 1) + ' > ' + this.sh.maxCols); }
    getValues() { this._chk(); const out = []; for (let i = 0; i < this.nr; i++) { const row = this.sh.data[this.r - 1 + i] || []; const o = []; for (let j = 0; j < this.nc; j++) { const v = row[this.c - 1 + j]; o.push(v === undefined ? '' : v); } out.push(o); } return out; }
    setValues(v) { this._chk(); if (v.length !== this.nr || v[0].length !== this.nc) throw new Error('setValues size mismatch ' + v.length + 'x' + v[0].length + ' vs ' + this.nr + 'x' + this.nc); for (let i = 0; i < this.nr; i++) { const ri = this.r - 1 + i; this.sh.data[ri] = this.sh.data[ri] || []; for (let j = 0; j < this.nc; j++) this.sh.data[ri][this.c - 1 + j] = v[i][j] == null ? '' : v[i][j]; } return this; }
    setValue(v) { return this.setValues([[v]]); }
    clearContent() { for (let i = 0; i < this.nr; i++) { const row = this.sh.data[this.r - 1 + i]; if (row) for (let j = 0; j < this.nc; j++) row[this.c - 1 + j] = ''; } return this; }
    setNumberFormat() { return this; } setFontWeight() { return this; } setBackground() { return this; } setFontColor() { return this; } setFontSize() { return this; }
  }
  class Sheet {
    constructor(name) { this.name = name; this.data = []; this.maxCols = 26; }
    getName() { return this.name; }
    getRange(r, c, nr, nc) { return new Range(this, r, c, nr, nc); }
    getLastRow() { for (let i = this.data.length - 1; i >= 0; i--) if ((this.data[i] || []).some(v => v !== '' && v != null)) return i + 1; return 0; }
    getLastColumn() { let m = 0; this.data.forEach(r => { (r || []).forEach((v, j) => { if (v !== '' && v != null) m = Math.max(m, j + 1); }); }); return m; }
    getMaxColumns() { return this.maxCols; } getMaxRows() { return Math.max(1000, this.data.length); }
    insertColumnsAfter(a, n) { this.maxCols += n; }
    deleteRow(r) { this.data.splice(r - 1, 1); }
    appendRow(arr) { if (arr.length > this.maxCols) throw new Error('appendRow wider than sheet'); this.data[this.getLastRow()] = arr.slice(); }
    setFrozenRows() {}
  }
  const ss = { sheets: {}, id: 'SS1', getId() { return this.id; }, getSheetByName(n) { return this.sheets[n] || null; }, insertSheet(n) { return (this.sheets[n] = new Sheet(n)); }, getSheets() { return Object.values(this.sheets); }, deleteSheet(s) { delete this.sheets[s.name]; } };
  const ctx = {
    console, JSON, Math, Date, String, Number, Object, Array, isFinite, isNaN, parseInt, parseFloat, RegExp, Error,
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, setProperties: (o) => { Object.assign(props, o); }, deleteProperty: k => { delete props[k]; } }) },
    CacheService: { getScriptCache: () => ({ get: k => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = String(v); }, remove: k => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      computeDigest: (alg, s) => [...crypto.createHash('sha256').update(String(s), 'utf8').digest()].map(b => (b > 127 ? b - 256 : b)),
      computeHmacSha256Signature: (v, k) => [...crypto.createHmac('sha256', k).update(String(v)).digest()].map(b => (b > 127 ? b - 256 : b)),
      base64EncodeWebSafe: (bytes) => Buffer.from(bytes.map(b => b & 255)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64Decode: (s) => [...Buffer.from(s, 'base64')],
      newBlob: (d, t, n) => ({ d, t, n }),
      formatDate: (d, tz, f) => { const p = n => String(n).padStart(2, '0'); return f.replace('yyyy', d.getFullYear()).replace('MM', p(d.getMonth() + 1)).replace('dd', p(d.getDate())).replace(/\bd\b/, d.getDate()); },
      DigestAlgorithm: { SHA_256: 1 }, Charset: { UTF_8: 1 }
    },
    Session: { getScriptTimeZone: () => 'America/Edmonton', getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) },
    SpreadsheetApp: { openById: () => ss, create: () => ss, openByUrl: () => ss },
    ContentService: { createTextOutput: s => ({ s, setMimeType() { return this; } }), MimeType: { JSON: 1 } },
    Logger: { log: () => {} },
    MailApp: { sendEmail: o => mails.push(o) },
    DriveApp: { getFoldersByName: () => ({ hasNext: () => false }), createFolder: () => ({ createFile: b => { const f = { id: 'F' + files.length, getId() { return this.id; }, getUrl() { return 'https://drive/' + this.id; }, setSharing() {} }; files.push(b); return f; } }), Access: {}, Permission: {} },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ everyDays: () => ({ atHour: () => ({ create() {} }) }) }) }) },
    Maps: { newGeocoder: () => ({ setRegion() { return this; }, geocode: () => ({ status: 'ZERO_RESULTS', results: [] }), reverseGeocode: () => ({ status: 'ZERO_RESULTS', results: [] }) }) },
    UrlFetchApp: { fetch: () => ({ getContentText: () => '{}' }) }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('/home/user/timber/company-apps-script.gs', 'utf8'), ctx);
  const call = (method, params, body) => {
    const e = { parameter: params || {}, postData: body ? { contents: JSON.stringify(body) } : undefined };
    const out = ctx[method](e); return JSON.parse(out.s);
  };
  return { ctx, ss, props, mails, files, post: (svc, body, extra) => call('doPost', Object.assign({ svc }, extra || {}), body), get: (params) => call('doGet', params) };
}
module.exports = { makeEnv };
