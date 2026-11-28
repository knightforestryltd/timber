// Minimal-but-faithful Google Apps Script runtime mock for running company-apps-script.gs in Node.
'use strict';
const vm = require('vm');
const fs = require('fs');
const crypto = require('crypto');

function createRuntime(opts = {}) {
  let CtxDate = Date; const isDate = v => Object.prototype.toString.call(v) === '[object Date]';
  const tz = opts.tz || 'America/Edmonton';
  const state = {
    props: {}, cache: {}, mails: [], fetchHandler: opts.fetchHandler || (() => ({ code: 404, body: '' })),
    triggers: [], files: {}, folders: {}, spreadsheets: {}, warnings: [], clock: null, lockHeld: false, lockBusy: false,
    calls: { getValues: 0, setValues: 0, getRange: 0 },
  };
  const now = () => (state.clock != null ? state.clock : Date.now());
  const warn = (m) => state.warnings.push(m);
  let idn = 0; const nid = (p) => p + (++idn).toString(36) + crypto.randomBytes(4).toString('hex');

  // ---------------- Sheets ----------------
  // Values: Sheets auto-converts strings typed into non-text cells (numbers, dates, booleans).
  function autoConvert(v) {
    if (typeof v !== 'string') return v;
    const s = v.trim();
    if (s === '') return v;
    if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s) && !/^0\d/.test(s)) return Number(s);
    if (/^(true|false)$/i.test(s)) return s.toLowerCase() === 'true';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const [y, m, d] = s.split('-').map(Number); return new CtxDate(y, m - 1, d); }
    return v;
  }
  function Sheet(ss, name) {
    this._ss = ss; this._name = name; this._cells = []; this._fmt = []; this._maxRows = 1000; this._maxCols = 26; this._frozen = 0; this._id = ++idn;
  }
  Sheet.prototype = {
    getName() { return this._name; }, getSheetId() { return this._id; }, getParent() { return this._ss; },
    getMaxRows() { return this._maxRows; }, getMaxColumns() { return this._maxCols; },
    getLastRow() { for (let r = this._cells.length - 1; r >= 0; r--) { const row = this._cells[r]; if (row && row.some(v => v !== '' && v != null)) return r + 1; } return 0; },
    getLastColumn() { let m = 0; this._cells.forEach(row => { if (row) for (let c = row.length - 1; c >= 0; c--) if (row[c] !== '' && row[c] != null) { m = Math.max(m, c + 1); break; } }); return m; },
    getRange(r, c, nr, nc) {
      state.calls.getRange++;
      if (typeof r === 'string') throw new Error('MOCK: A1 notation not supported: ' + r);
      nr = nr == null ? 1 : nr; nc = nc == null ? 1 : nc;
      if (!(r >= 1) || !(c >= 1) || !(nr >= 1) || !(nc >= 1) || r % 1 || c % 1 || nr % 1 || nc % 1) throw new Error('The starting row/column of the range is too small / number of rows must be at least 1. (getRange(' + [r, c, nr, nc].join(',') + '))');
      if (c + nc - 1 > this._maxCols) throw new Error('Exception: The coordinates of the range are outside the dimensions of the sheet. (' + this._name + ' cols ' + (c + nc - 1) + ' > ' + this._maxCols + ')');
      if (r + nr - 1 > this._maxRows) { // Sheets throws for rows beyond the grid too, except we grow to model appendRow-like growth; record it.
        warn('row range beyond max rows on ' + this._name + ' (' + (r + nr - 1) + ' > ' + this._maxRows + ')');
        if (opts.strictRows !== false) throw new Error('Exception: The coordinates of the range are outside the dimensions of the sheet. (' + this._name + ' rows)');
        this._maxRows = r + nr - 1;
      }
      return new Range(this, r, c, nr, nc);
    },
    getDataRange() { return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); },
    appendRow(vals) { const r = this.getLastRow() + 1; if (vals.length > this._maxCols) this._maxCols = vals.length; if (r > this._maxRows) this._maxRows = r; new Range(this, r, 1, 1, vals.length).setValues([vals]); return this; },
    insertColumnsAfter(after, n) { this._cells.forEach(row => { if (row && row.length > after) row.splice(after, 0, ...Array(n).fill('')); }); this._maxCols += n; return this; },
    insertRowsAfter(after, n) { if (after > this._maxRows) throw new Error('insertRowsAfter: row out of range'); const f = this._fmt[after - 1]; this._cells.splice(after, 0, ...Array(n).fill(null).map(() => [])); this._fmt.splice(after, 0, ...Array(n).fill(null).map(() => (f ? f.slice() : []))); this._maxRows += n; state.rowsInserted = (state.rowsInserted || 0) + n; return this; },   // new rows take the format of the row above, like Sheets
    deleteRow(r) { if (r > this._maxRows) throw new Error('deleteRow out of range'); this._cells.splice(r - 1, 1); this._fmt.splice(r - 1, 1); this._maxRows--; return this; },
    deleteRows(r, n) { if (r + n - 1 > this._maxRows) throw new Error('deleteRows: Those rows are out of bounds.'); if (n >= this._maxRows) throw new Error('You can\'t delete all the rows on the sheet.'); this._cells.splice(r - 1, n); this._fmt.splice(r - 1, n); this._maxRows -= n; return this; },
    setFrozenRows(n) { this._frozen = n; return this; }, getFrozenRows() { return this._frozen; },
    clear() { this._cells = []; return this; }, getSheetName() { return this._name; },
    setName(n) { this._name = n; return this; }, activate() { return this; }, hideSheet() { return this; },
    autoResizeColumns() { return this; }, setColumnWidth() { return this; },
  };
  function Range(sh, r, c, nr, nc) { this._sh = sh; this._r = r; this._c = c; this._nr = nr; this._nc = nc; }
  const cellGet = (sh, r, c) => { const row = sh._cells[r - 1]; const v = row ? row[c - 1] : undefined; return v == null ? '' : v; };
  const cellSet = (sh, r, c, v) => {
    while (sh._cells.length < r) sh._cells.push([]);
    const row = sh._cells[r - 1] || (sh._cells[r - 1] = []);
    const fmt = (sh._fmt[r - 1] || [])[c - 1];
    if (v === undefined) throw new Error('MOCK: undefined written to ' + sh._name + ' R' + r + 'C' + c);
    if (typeof v === 'object' && v !== null && !isDate(v)) { warn('object written to cell ' + sh._name + ' R' + r + 'C' + c + ': ' + String(v).slice(0, 40)); v = String(v); }
    if (typeof v === 'string' && v.length > 50000) throw new Error('Your input contains more than the maximum of 50000 characters in a single cell. (' + sh._name + ' R' + r + 'C' + c + ')');
    if (fmt === '@') { if (typeof v === 'number' || typeof v === 'boolean') v = String(v); }   // plain-text cell keeps text
    else v = autoConvert(v);
    row[c - 1] = v;
  };
  Range.prototype = {
    getRow() { return this._r; }, getColumn() { return this._c; }, getNumRows() { return this._nr; }, getNumColumns() { return this._nc; },
    getValues() { state.calls.getValues++; state.calls.cells = (state.calls.cells || 0) + this._nr * this._nc; let b = 0; for (let i = 0; i < this._nr; i++) { const row = this._sh._cells[this._r + i - 1]; if (row) for (let j = 0; j < this._nc; j++) { const v = row[this._c + j - 1]; if (typeof v === 'string') b += v.length; } } state.calls.bytes = (state.calls.bytes || 0) + b; const out = []; for (let i = 0; i < this._nr; i++) { const row = []; for (let j = 0; j < this._nc; j++) { const v = cellGet(this._sh, this._r + i, this._c + j); row.push(isDate(v) ? new CtxDate(v.getTime()) : v); } out.push(row); } return out; },
    getDisplayValues() { return this.getValues().map(r => r.map(v => isDate(v) ? v.toISOString() : String(v))); },
    getValue() { return this.getValues()[0][0]; },
    setValues(vals) {
      state.calls.setValues++;
      if (!Array.isArray(vals) || vals.length !== this._nr) throw new Error('The number of rows in the data does not match the number of rows in the range. The data has ' + (vals && vals.length) + ' but the range has ' + this._nr + '.');
      vals.forEach((row, i) => { if (row.length !== this._nc) throw new Error('The number of columns in the data does not match the number of columns in the range. The data has ' + row.length + ' but the range has ' + this._nc + '.'); row.forEach((v, j) => cellSet(this._sh, this._r + i, this._c + j, v)); });
      return this;
    },
    setValue(v) { for (let i = 0; i < this._nr; i++) for (let j = 0; j < this._nc; j++) cellSet(this._sh, this._r + i, this._c + j, v); return this; },
    clearContent() { for (let i = 0; i < this._nr; i++) for (let j = 0; j < this._nc; j++) { const row = this._sh._cells[this._r + i - 1]; if (row) row[this._c + j - 1] = ''; } return this; },
    clear() { return this.clearContent(); },
    setNumberFormat(f) { for (let i = 0; i < this._nr; i++) { const fr = this._sh._fmt[this._r + i - 1] || (this._sh._fmt[this._r + i - 1] = []); for (let j = 0; j < this._nc; j++) fr[this._c + j - 1] = f; } return this; },
    setNumberFormats() { return this; },
    setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; }, setFontSize() { return this; },
    setWrap() { return this; }, setHorizontalAlignment() { return this; }, setNote() { return this; },
    sort() { throw new Error('MOCK: Range.sort not implemented'); },
  };
  function Spreadsheet(name) { this._id = nid('ss_'); this._name = name; this._sheets = [new Sheet(this, 'Sheet1')]; this._updated = now(); state.spreadsheets[this._id] = this;
    state.files[this._id] = makeFile(this._id, name, 'application/vnd.google-apps.spreadsheet', this); }
  Spreadsheet.prototype = {
    getId() { return this._id; }, getName() { return this._name; }, getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this._id + '/edit'; },
    getSheetByName(n) { return this._sheets.find(s => s._name === n) || null; },
    getSheets() { return this._sheets.slice(); },
    insertSheet(n) { if (this.getSheetByName(n)) throw new Error('A sheet with the name "' + n + '" already exists.'); const s = new Sheet(this, n); this._sheets.push(s); return s; },
    deleteSheet(s) { if (this._sheets.length === 1) throw new Error("You can't remove all the sheets in a document."); this._sheets = this._sheets.filter(x => x !== s); },
    getSpreadsheetTimeZone() { return tz; }, toast() {}, rename(n) { this._name = n; },
  };
  const SpreadsheetApp = {
    _active: null,
    create(name) { return new Spreadsheet(name); },
    openById(id) { const s = state.spreadsheets[id]; if (!s || (state.files[id] && state.files[id]._trashed)) throw new Error('Unexpected error while getting the method or property openById on object SpreadsheetApp.'); return s; },
    openByUrl(u) { const m = /\/d\/([^/]+)/.exec(u || ''); return SpreadsheetApp.openById(m && m[1]); },
    getActiveSpreadsheet() { return SpreadsheetApp._active; },
    flush() {},
  };

  // ---------------- Drive ----------------
  function iter(list) { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; }
  function makeFile(id, name, mime, payload, folder) {
    return { _id: id, _name: name, _mime: mime, _payload: payload, _trashed: false, _folder: folder || null, _sharing: null, _updated: now(),
      getId() { return this._id; }, getName() { return this._name; }, getMimeType() { return this._mime; },
      getUrl() { return 'https://drive.google.com/file/d/' + this._id + '/view'; },
      setSharing(a, p) { this._sharing = [a, p]; return this; }, setTrashed(t) { this._trashed = !!t; return this; }, isTrashed() { return this._trashed; },
      getDateCreated() { return new CtxDate(this._created || (this._created = now())); },
      getLastUpdated() { const ss = state.spreadsheets[this._id]; return new CtxDate(ss ? ss._updated : this._updated); },
      makeCopy(n, folder) { const ss = state.spreadsheets[this._id]; let copy;
        if (ss) { copy = new Spreadsheet(n); copy._sheets = ss._sheets.map(s => { const c = new Sheet(copy, s._name); c._cells = JSON.parse(JSON.stringify(s._cells)); return c; }); }
        const f = state.files[copy ? copy._id : nid('f_')] || makeFile(nid('f_'), n, this._mime, null);
        f._name = n; f._folder = folder || null; state.files[f._id] = f; return f; },
      getBlob() { return this._payload; }, getSize() { return this._payload && this._payload._bytes ? this._payload._bytes.length : 0; },
      setName(n) { this._name = n; return this; }, moveTo(f) { this._folder = f; return this; },
    };
  }
  function makeFolder(name) {
    const f = { _id: nid('fo_'), _name: name, getId() { return this._id; }, getName() { return this._name; },
      createFile(blob) { const file = makeFile(nid('f_'), blob.getName(), blob.getContentType(), blob, this); state.files[file._id] = file; return file; },
      getFiles() { return iter(Object.values(state.files).filter(x => x._folder === this && !x._trashed)); },
      getFilesByName(n) { return iter(Object.values(state.files).filter(x => x._folder === this && !x._trashed && x._name === n)); },
      addFile(file) { file._folder = this; return this; }, getUrl() { return 'https://drive.google.com/drive/folders/' + this._id; },
    };
    state.folders[f._id] = f; return f;
  }
  const DriveApp = {
    Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', ANYONE: 'ANYONE', PRIVATE: 'PRIVATE' }, Permission: { VIEW: 'VIEW', EDIT: 'EDIT' },
    getFoldersByName(n) { return iter(Object.values(state.folders).filter(f => f._name === n)); },
    createFolder(n) { return makeFolder(n); },
    getFileById(id) { const f = state.files[id]; if (!f) throw new Error('No item with the given ID could be found, or you do not have permission to access it.'); return f; },
    getFilesByName(n) { return iter(Object.values(state.files).filter(f => f._name === n && !f._trashed)); },
    getRootFolder() { return makeFolder('My Drive'); },
  };

  // ---------------- Properties / Cache / Lock ----------------
  const Properties = {
    getProperty(k) { state.calls.props = (state.calls.props || 0) + 1; return Object.prototype.hasOwnProperty.call(state.props, k) ? state.props[k] : null; },
    setProperty(k, v) { v = String(v); if (Buffer.byteLength(v) > 9 * 1024) throw new Error('Exception: Argument too large: value (property ' + k + ' = ' + Buffer.byteLength(v) + ' bytes)'); state.props[k] = v; checkTotal(); return Properties; },
    setProperties(o, del) { const save = Object.assign({}, state.props); try { if (del) state.props = {}; Object.keys(o).forEach(k => Properties.setProperty(k, o[k])); } catch (e) { state.props = save; throw e; } return Properties; },   // treated as all-or-nothing
    deleteProperty(k) { delete state.props[k]; return Properties; },
    getProperties() { return Object.assign({}, state.props); }, getKeys() { return Object.keys(state.props); },
    deleteAllProperties() { state.props = {}; return Properties; },
  };
  function checkTotal() { const t = Object.keys(state.props).reduce((a, k) => a + Buffer.byteLength(k) + Buffer.byteLength(state.props[k]), 0); if (t > 500 * 1024) throw new Error('Exception: You have exceeded the property storage quota (' + t + ' bytes).'); }
  const Cache = {
    get(k) { const e = state.cache[k]; if (!e) return null; if (e.exp < now()) { delete state.cache[k]; return null; } return e.v; },
    put(k, v, s) { v = String(v); if (Buffer.byteLength(v) > 100 * 1024) throw new Error('Exception: Argument too large: value (cache ' + k + ')'); if (k.length > 250) throw new Error('Cache key too long'); state.cache[k] = { v, exp: now() + Math.min(s || 600, 21600) * 1000 }; },
    remove(k) { delete state.cache[k]; },
    getAll(ks) { const o = {}; ks.forEach(k => { const v = Cache.get(k); if (v != null) o[k] = v; }); return o; },
    putAll(o, s) { Object.keys(o).forEach(k => Cache.put(k, o[k], s)); }, removeAll(ks) { ks.forEach(k => delete state.cache[k]); },
  };
  function makeLock() { let held = false; return {
    tryLock() { if (state.lockBusy) return false; held = true; state.lockHeld = true; return true; },
    waitLock() { if (state.lockBusy) throw new Error('Lock timeout'); held = true; state.lockHeld = true; },
    releaseLock() { if (held) { held = false; state.lockHeld = false; } }, hasLock() { return held; } }; }

  // ---------------- Utilities ----------------
  const toBytes = (v) => { if (Array.isArray(v)) return Buffer.from(v.map(b => b & 0xff)); if (v && v._bytes) return v._bytes; return Buffer.from(String(v), 'utf8'); };
  const signed = (buf) => Array.from(buf).map(b => (b > 127 ? b - 256 : b));
  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
  function formatDate(d, zone, fmt) {
    if (!isDate(d) || isNaN(d)) throw new Error('Exception: Invalid argument: date');
    const parts = {}; new Intl.DateTimeFormat('en-CA', { timeZone: zone || tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, weekday: 'short', month2: undefined })
      .formatToParts(d).forEach(p => { parts[p.type] = p.value; });
    const mon = new Intl.DateTimeFormat('en-US', { timeZone: zone || tz, month: 'short' }).format(d);
    const monL = new Intl.DateTimeFormat('en-US', { timeZone: zone || tz, month: 'long' }).format(d);
    const wk = new Intl.DateTimeFormat('en-US', { timeZone: zone || tz, weekday: 'short' }).format(d);
    const wkL = new Intl.DateTimeFormat('en-US', { timeZone: zone || tz, weekday: 'long' }).format(d);
    let H = Number(parts.hour) % 24; const h12 = H % 12 || 12;
    const map = { yyyy: parts.year, yy: parts.year.slice(2), MMMM: monL, MMM: mon, MM: parts.month, M: String(Number(parts.month)), dd: parts.day, d: String(Number(parts.day)), EEEE: wkL, EEE: wk, E: wk,
      HH: pad(H, 2), H: String(H), hh: pad(h12, 2), h: String(h12), mm: parts.minute, m: String(Number(parts.minute)), ss: parts.second, s: String(Number(parts.second)), a: H < 12 ? 'AM' : 'PM', z: 'MST', Z: '-0700', XXX: '-07:00' };
    return fmt.replace(/'([^']*)'|yyyy|yy|MMMM|MMM|MM|M|dd|d|EEEE|EEE|E|HH|H|hh|h|mm|m|ss|s|a|XXX|z|Z/g, (t, lit) => (lit != null ? lit : map[t]));
  }
  function Blob(bytes, type, name) { this._bytes = bytes; this._type = type || 'application/octet-stream'; this._name = name || 'blob'; }
  Blob.prototype = { getBytes() { return signed(this._bytes); }, getDataAsString() { return this._bytes.toString('utf8'); }, getContentType() { return this._type; }, setContentType(t) { this._type = t; return this; },
    getName() { return this._name; }, setName(n) { this._name = n; return this; }, getAs() { return this; }, copyBlob() { return new Blob(Buffer.from(this._bytes), this._type, this._name); } };
  const Utilities = {
    DigestAlgorithm: { SHA_256: 'sha256', MD5: 'md5', SHA_1: 'sha1', SHA_512: 'sha512' }, Charset: { UTF_8: 'utf8' },
    getUuid: () => crypto.randomUUID(),
    computeDigest: (alg, v) => signed(crypto.createHash(alg).update(toBytes(v)).digest()),
    computeHmacSha256Signature: (v, k) => signed(crypto.createHmac('sha256', toBytes(k)).update(toBytes(v)).digest()),
    base64Encode: (v) => toBytes(v).toString('base64'),
    base64EncodeWebSafe: (v) => toBytes(v).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
    base64Decode: (s) => { s = String(s); if (/[^A-Za-z0-9+/=\s]/.test(s)) throw new Error('Exception: Could not decode string.'); return signed(Buffer.from(s, 'base64')); },
    base64DecodeWebSafe: (s) => signed(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
    newBlob: (data, type, name) => new Blob(toBytes(data), type, name),
    formatDate, sleep: () => {}, formatString: (f, ...a) => { let i = 0; return f.replace(/%s/g, () => a[i++]); },
  };
  const Session = { getScriptTimeZone: () => tz, getEffectiveUser: () => ({ getEmail: () => 'owner@example.test' }), getActiveUser: () => ({ getEmail: () => '' }), getTemporaryActiveUserKey: () => 'tmp' };
  const ContentService = { MimeType: { JSON: 'JSON', TEXT: 'TEXT' }, createTextOutput: (s) => ({ _s: s, _m: null, setMimeType(m) { this._m = m; return this; }, getContent() { return this._s; }, getMimeType() { return this._m; } }) };
  const MailApp = { sendEmail(o) { if (typeof o !== 'object') throw new Error('MOCK: sendEmail(to,subject,body) form not supported'); if (!o.to) throw new Error('Exception: Invalid argument: recipient'); state.mails.push(o); }, getRemainingDailyQuota: () => 100 };
  const UrlFetchApp = { fetch(url, o) { const r = state.fetchHandler(url, o || {}); return { getContentText: () => r.body || '', getResponseCode: () => r.code || 200, getHeaders: () => ({}) }; } };
  const Maps = { newGeocoder() { return { setRegion() { return this; }, setLanguage() { return this; },
    geocode(a) { return opts.geocode ? opts.geocode(a) : { status: 'OK', results: [{ geometry: { location: { lat: 53.5, lng: -113.5 } }, address_components: [{ long_name: 'Testville', types: ['locality', 'political'] }], formatted_address: a }] }; },
    reverseGeocode(lat, lon) { return { status: 'OK', results: [{ address_components: [{ long_name: 'Testville', short_name: 'Testville', types: ['locality', 'political'] }, { long_name: 'Alberta', short_name: 'AB', types: ['administrative_area_level_1'] }], formatted_address: 'Testville, AB' }] }; } }; } };
  const ScriptApp = {
    getProjectTriggers: () => state.triggers.slice(),
    newTrigger(fn) { const t = { fn, getHandlerFunction: () => fn, getUniqueId: () => fn }; const b = { timeBased: () => b, everyDays: () => b, everyHours: () => b, atHour: () => b, nearMinute: () => b, onWeekDay: () => b, everyMinutes: () => b, create: () => { state.triggers.push(t); return t; } }; return b; },
    deleteTrigger(t) { state.triggers = state.triggers.filter(x => x !== t); }, getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TESTSCRIPT/exec' }),
    WeekDay: {},
  };
  const Logger = { _l: [], log(m) { Logger._l.push(String(m)); } };

  const ctx = {
    SpreadsheetApp, DriveApp, Utilities, Session, ContentService, MailApp, UrlFetchApp, Maps, ScriptApp, Logger,
    PropertiesService: { getScriptProperties: () => Properties, getUserProperties: () => Properties, getDocumentProperties: () => Properties },
    CacheService: { getScriptCache: () => Cache, getUserCache: () => Cache, getDocumentCache: () => Cache },
    LockService: { getScriptLock: () => makeLock(), getUserLock: () => makeLock(), getDocumentLock: () => makeLock() },
    console: { log() {}, warn() {}, error() {}, info() {} },
  };
  // Date in the script uses the mock clock (so purge/nightly tests can move time)
  const RealDate = Date;
  class MDate extends RealDate { constructor(...a) { if (a.length === 0) super(now()); else super(...a); } static now() { return now(); } }
  ctx.Date = MDate; CtxDate = MDate; ctx.JSON = JSON; ctx.Math = Math;
  vm.createContext(ctx);
  const src = fs.readFileSync(opts.script, 'utf8');
  vm.runInContext(src, ctx, { filename: 'company-apps-script.gs' });
  // Script-level globals reset per request in real GAS (each request is a fresh execution).
  function freshExecution() { vm.runInContext('ss__ = null; tabs__ = {}; if (typeof DEV_ !== "undefined") DEV_ = "anon"; if (typeof LOCKED_ !== "undefined") LOCKED_ = false; if (typeof settings__ !== "undefined") settings__ = null;', ctx); }

  function parseOut(out) { if (!out || typeof out.getContent !== 'function') throw new Error('handler did not return a TextOutput'); try { return JSON.parse(out.getContent()); } catch (e) { throw new Error('non-JSON output: ' + out.getContent().slice(0, 200)); } }
  const api = {
    ctx, state,
    get(params) { freshExecution(); return parseOut(ctx.doGet({ parameter: params || {} })); },
    post(params, body) { freshExecution(); return parseOut(ctx.doPost({ parameter: params || {}, postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } })); },
    call(fnName, ...args) { freshExecution(); return ctx[fnName](...args); },
    eval(code) { return vm.runInContext(code, ctx); },
    setClock(ms) { state.clock = ms; }, advance(ms) { state.clock = now() + ms; },
    sheet(name) { const id = state.props.ssId; const ss = id && state.spreadsheets[id]; return ss ? ss.getSheetByName(name) : null; },
    ss() { return state.spreadsheets[state.props.ssId]; },
  };
  // a second copy of the script (e.g. the older version) working on this same sheet, properties and cache
  api.twin = function (otherScript) {
    const c2 = {}; ['SpreadsheetApp', 'DriveApp', 'Utilities', 'Session', 'ContentService', 'MailApp', 'UrlFetchApp', 'Maps', 'ScriptApp', 'Logger', 'PropertiesService', 'CacheService', 'LockService', 'console', 'Date', 'JSON', 'Math'].forEach(k => c2[k] = ctx[k]);
    vm.createContext(c2); vm.runInContext(fs.readFileSync(otherScript, 'utf8'), c2, { filename: 'twin.gs' });
    const fresh2 = () => vm.runInContext('ss__ = null; tabs__ = {}; if (typeof DEV_ !== "undefined") DEV_ = "anon"; if (typeof LOCKED_ !== "undefined") LOCKED_ = false; if (typeof settings__ !== "undefined") settings__ = null;', c2);
    return { get: (q) => { fresh2(); return parseOut(c2.doGet({ parameter: q || {} })); }, post: (q, b) => { fresh2(); return parseOut(c2.doPost({ parameter: q || {}, postData: { contents: typeof b === 'string' ? b : JSON.stringify(b) } })); }, call: (f, ...a) => { fresh2(); return c2[f](...a); } };
  };
  return api;
}
module.exports = { createRuntime };
