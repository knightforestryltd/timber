// Minimal in-memory Google Apps Script environment for running drivers-apps-script.gs in Node.
const fs = require('fs'), vm = require('vm'), crypto = require('crypto');

function makeSheet(name) {
  let data = []; let maxCols = 26;
  const sh = {
    name, _data: () => data,
    getLastRow: () => { let r = data.length; while (r > 0 && (data[r - 1] || []).every(v => v === '' || v == null)) r--; return r; },
    getLastColumn: () => data.reduce((m, row) => { let c = row.length; while (c > 0 && (row[c - 1] === '' || row[c - 1] == null)) c--; return Math.max(m, c); }, 0),
    getMaxColumns: () => maxCols, getMaxRows: () => Math.max(1000, data.length),
    insertColumnsAfter: (a, n) => { maxCols += n; },
    setFrozenRows() {},
    getRange(r, c, nr, nc) {
      nr = nr || 1; nc = nc || 1;
      if (c + nc - 1 > maxCols) throw new Error('Range exceeds columns');
      return {
        getValues: () => { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) { const v = (data[r - 1 + i] || [])[c - 1 + j]; row.push(v == null ? '' : v); } out.push(row); } return out; },
        setValues: (vals) => { if (vals.length !== nr || vals[0].length !== nc) throw new Error('size mismatch ' + vals.length + 'x' + vals[0].length + ' vs ' + nr + 'x' + nc); for (let i = 0; i < nr; i++) { data[r - 1 + i] = data[r - 1 + i] || []; for (let j = 0; j < nc; j++) data[r - 1 + i][c - 1 + j] = vals[i][j]; } },
        clearContent: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (data[r - 1 + i]) data[r - 1 + i][c - 1 + j] = ''; },
        setNumberFormat() { return this; }, setFontWeight() { return this; }
      };
    }
  };
  return sh;
}
function makeEnv(opts) {
  opts = opts || {};
  const props = {}, cache = {}, mails = [];
  const sheets = {};
  const ss = { getId: () => 'SSID', getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = makeSheet(n)), getSheets: () => Object.values(sheets), deleteSheet: s => { delete sheets[s.name]; } };
  sheets.Sheet1 = makeSheet('Sheet1');
  const env = {
    console,
    JSON, Date, Math, Number, String, Object, Array, isFinite, isNaN, parseInt, Error,
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, setProperties: (o) => { Object.assign(props, o); }, deleteProperty: k => { delete props[k]; } }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ setMimeType() { return this; }, text: t }) },
    SpreadsheetApp: { create: () => ss, openById: () => ss },
    Session: { getScriptTimeZone: () => 'America/Edmonton' },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(s, 'utf8').digest()).map(b => b > 127 ? b - 256 : b),
      formatDate: (d) => d.toISOString().slice(0, 10),
      base64Decode: s => Array.from(Buffer.from(s, 'base64')),
      newBlob: (bytes, type, name) => ({ bytes, type, name })
    },
    MailApp: { sendEmail: o => mails.push(o) },
    Maps: { newGeocoder: () => ({ reverseGeocode: (lat, lon) => opts.geocode ? opts.geocode(lat, lon) : { status: 'OK', results: [{ types: ['locality', 'political'], address_components: [{ long_name: 'Okotoks', types: ['locality'] }, { short_name: 'AB', long_name: 'Alberta', types: ['administrative_area_level_1'] }], geometry: { location: { lat: 50.725, lng: -113.975 } }, formatted_address: 'Okotoks, AB' }] } }) }
  };
  vm.createContext(env);
  vm.runInContext(fs.readFileSync(opts.file || require('path').resolve(__dirname, '..', 'drivers-apps-script.gs'), 'utf8'), env);
  return {
    env, props, mails, sheets,
    post: body => JSON.parse(env.doPost({ postData: { contents: JSON.stringify(body) } }).text),
    get: params => JSON.parse(env.doGet({ parameter: params || {} }).text),
    reset() { /* per-request sheet caches live in globals; clear them like a fresh execution */ vm.runInContext('ss__ = null; tabs__ = {};', env); }
  };
}
module.exports = { makeEnv };
