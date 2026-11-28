/* Shared by every page.
   1) Phone back button: goes back one level at a time (close pop-up → previous screen → page menu →
      Quote home page). On the home page it does nothing, so the app never closes by accident.
      Each page defines window.kfBack(): return true if it closed something / went up a level.
   2) Sheet links: kfLinks reads/writes the script links each page uses, stamped with the time so
      Company Sync (Quote page) knows which copy is newest, and flags "not saved to company yet". */
// v14: the company link lives in kf-config.js (loaded here, before the page's own scripts run).
// Pages include kf-config.js before nav.js; this is only a fallback (then the early steps below run right after it loads).
if (!('KF_COMPANY_URL' in window)) { try { document.write('<script src="kf-config.js"><\/script><script>window.__kfEarly && __kfEarly();<\/script>'); } catch (e) {} }
(function () {
  var HOME = 'index.html';
  function isHome() { var f = (location.pathname.split('/').pop() || '').toLowerCase(); return f === '' || f === 'index.html'; }

  // One extra history entry ("guard") sits on top of the page. Back pops it, we handle one level, re-add it.
  // Chrome skips history entries a page adds before the person has tapped it, so the guard is only added
  // after a real tap (pointerup / touchend / click / key — the events Chrome counts as a user action).
  var touched = false;
  function arm() { if (!touched) return; try { if (!(history.state && history.state.kfGuard)) history.pushState({ kfGuard: 1 }, '', location.href); } catch (e) {} }
  ['pointerup', 'touchend', 'click', 'keydown'].forEach(function (t) { window.addEventListener(t, function () { touched = true; arm(); }, { capture: true, passive: true }); });

  var leaving = false;
  function appLike() {
    try { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) || matchMedia('(display-mode: standalone)').matches || matchMedia('(pointer: coarse)').matches; } catch (e) { return true; }
  }
  window.addEventListener('popstate', function () {
    if (leaving) return;
    var handled = false;
    try {
      if (window.kfPreviewClose) { window.kfPreviewClose(); handled = true; }
      else handled = typeof window.kfBack === 'function' && window.kfBack() === true;
    } catch (e) { handled = false; }
    if (!handled && !isHome()) { leaving = true; location.replace(HOME); return; }
    // On the home page: phones and the installed app stay put (so the app never closes by accident);
    // a laptop browser tab lets Back leave the site as usual.
    if (!handled && !appLike()) { leaving = true; history.back(); return; }
    arm();
    if (!handled) hint('You are on the home page. Use the menu to switch pages.');
  });

  function hint(msg) {
    var el = document.getElementById('kfBackHint');
    if (!el) {
      el = document.createElement('div'); el.id = 'kfBackHint';
      el.style.cssText = 'position:fixed;left:50%;bottom:calc(18px + env(safe-area-inset-bottom, 0px));transform:translateX(-50%);background:#0f172a;color:#fff;padding:10px 14px;border-radius:10px;font:14px Arial,sans-serif;z-index:5000;box-shadow:0 6px 20px rgba(0,0,0,.3);max-width:90vw;text-align:center;display:none';
      document.body.appendChild(el);
    }
    el.textContent = msg; el.style.display = 'block';
    clearTimeout(el._t); el._t = setTimeout(function () { el.style.display = 'none'; }, 2500);
  }
  window.kfHint = hint;

  /* ---------------- sheet links ---------------- */
  var SETTINGS_KEY = 'knightForestrySettings_v3';
  var LABELS = {
    sheetsUrl: 'Load Log sheet link (bookings, dispatch, billing)',
    scriptUrl: 'Tickets sheet link (scale tickets)',
    yardUrl: 'Inventory (yards) sheet link',
    driversUrl: 'Drivers script link',
    trucksUrl: 'Trucks sheet link'
  };
  function readSettings() { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch (e) { return {}; } }
  var kfLinks = {
    get: function (key) {
      if (key === 'sheetsUrl') return readSettings().sheetsUrl || '';
      try { return localStorage.getItem(key) || ''; } catch (e) { return ''; }
    },
    // returns true when the value changed
    set: function (key, value) {
      value = String(value || '').trim();
      if (value === kfLinks.get(key)) return false;
      var now = Date.now();
      try {
        if (key === 'sheetsUrl') { var s = readSettings(); s.sheetsUrl = value; s.sheetsUrlAt = now; localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }
        else { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); localStorage.setItem(key + 'At', String(now)); }
        localStorage.setItem('kfDirty', '1');          // Quote page → Company Sync shows "not saved to company yet"
      } catch (e) {}
      return true;
    },
    valid: function (u) { return !u || /^https:\/\/script\.google(usercontent)?\.com\//.test(u); },
    // Draws a "Sheet links" card into `box` for the given keys.
    card: function (box, keys, onSaved) {
      // v14: no link fields anywhere once the site knows its company (kf-config.js). The old code paths stay.
      if (window.kfConfigUrl && window.kfConfigUrl()) { box.innerHTML = ''; box.style.display = 'none'; return; }
      if (kfCo.unified()) {
        box.innerHTML = '<h2 style="margin-top:0">Sheet link</h2><div style="font-size:.9rem">This device uses the single company link for everything:</div><div style="word-break:break-all;font-size:.85rem;margin:6px 0;padding:8px;border:1px solid var(--border,#e2e8f0);border-radius:8px">' +
          kfCo.base().replace(/[&<>"]/g, '') + '</div><div style="font-size:.85rem;color:var(--muted,#64748b)">To connect to a different company, use Quote → Settings → Switch company.</div>';
        return;
      }
      var id = 'kfl' + Math.random().toString(36).slice(2, 7);
      var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); };
      box.innerHTML = '<h2 style="margin-top:0">Sheet links</h2>' + keys.map(function (k) {
        return '<label for="' + id + k + '" style="display:block;margin:10px 0 4px">' + esc(LABELS[k] || k) + '</label><input id="' + id + k + '" type="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://script.google.com/macros/s/.../exec" value="' + esc(kfLinks.get(k)) + '" style="width:100%;box-sizing:border-box">';
      }).join('') + '<div style="font-size:.85rem;color:var(--muted,#64748b);margin-top:8px">Saved on this device. To share a change with every device, open Quote → Settings → <b>Save to Company</b>.</div>' +
        '<button class="btn" id="' + id + 'save" style="margin-top:10px">Save links</button><div id="' + id + 'msg" style="margin-top:6px;font-weight:600"></div>';
      document.getElementById(id + 'save').onclick = function () {
        var msg = document.getElementById(id + 'msg'), bad = [], changed = 0;
        keys.forEach(function (k) { var v = document.getElementById(id + k).value.trim(); if (!kfLinks.valid(v)) bad.push(LABELS[k] || k); });
        if (bad.length) { msg.style.color = 'var(--bad,#dc2626)'; msg.textContent = 'Not a Google script link: ' + bad.join(', '); return; }
        keys.forEach(function (k) { if (kfLinks.set(k, document.getElementById(id + k).value)) changed++; });
        msg.style.color = 'var(--good,#16a34a)'; msg.textContent = changed ? 'Saved on this device.' : 'No changes.';
        if (changed && onSaved) onSaved();
      };
    }
  };
  window.kfLinks = kfLinks;

  /* ---------------- single company link (company-apps-script.gs) ----------------
     A connected device stores the link (kfCompanyUrl) and the company key (kfKey). Every page's old
     link setting is filled with "<link>?svc=<part>&k=<key>", so all pages work without other changes. */
  var LS = { get: function (k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }, del: function (k) { try { localStorage.removeItem(k); } catch (e) {} } };
  var kfCo = {
    unified: function () { return !!(LS.get('kfCompanyUrl') && LS.get('kfKey')); },
    base: function () { return LS.get('kfCompanyUrl'); },
    url: function (svc, withKey) { var b = LS.get('kfCompanyUrl'); if (!b) return ''; return b + '?svc=' + svc + (withKey === false ? '' : '&k=' + encodeURIComponent(LS.get('kfKey'))); },
    clean: function (u) { return String(u || '').trim().split('?')[0]; },
    // Connect this device to a company: write every page's link.
    apply: function (base, key, meta) {
      base = kfCo.clean(base); var now = String(Date.now());
      LS.set('kfCompanyUrl', base); LS.set('kfKey', key);
      if (meta && meta.companyId) LS.set('kfCompanyId', meta.companyId);
      if (meta && meta.companyName) LS.set('kfCompanyName', meta.companyName);
      var s = readSettings(); s.syncUrl = kfCo.url('sync'); s.sheetsUrl = kfCo.url('loads'); s.sheetsUrlAt = Number(now);
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) {}
      [['scriptUrl', 'tickets'], ['yardUrl', 'yards'], ['driversUrl', 'drivers']].forEach(function (x) { LS.set(x[0], kfCo.url(x[1])); LS.set(x[0] + 'At', now); });
      LS.del('kfDrvUrl'); LS.set('coLoggedIn', '1'); LS.set('loggedIn', 'true');
    },
    // Remove every trace of a company from this device (its data stays safe in that company's sheet).
    wipe: function () {
      var keep = { kf_theme: 1, kfSkipConnect: 0 }, ks = [];
      try { for (var i = 0; i < localStorage.length; i++) ks.push(localStorage.key(i)); } catch (e) {}
      ks.forEach(function (k) { if (!keep[k]) LS.del(k); });
      try { sessionStorage.clear(); } catch (e) {}
    },
    // Does this device hold data for a company (used to protect against mixing two companies)?
    hasData: function () {
      var s = readSettings();
      return !!((s.locations && s.locations.length) || s.syncUrl || s.sheetsUrl || LS.get('scriptUrl') || LS.get('yardUrl') || LS.get('kfCompany') || LS.get('kfDrvSession') || LS.get('kfDrvShift'));
    },
    sameCompany: function (meta) { var id = LS.get('kfCompanyId'); return !!(id && meta && meta.companyId === id); },
    post: function (svc, body) {
      return fetch(kfCo.url(svc), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(window.kfAuth ? kfAuth(body) : body), redirect: 'follow' })
        .then(function (r) { return r.json(); }).then(function (j) { if (j && j.status === 'noadmin' && window.kfLostAdmin) kfLostAdmin(); return j; });
    }
  };
  window.kfCo = kfCo;
  // A connected device's links must carry the company key. Quote → Settings → Save Settings used to copy the bare link
  // (no key) over them, so the next sync answered "not connected" and the device was asked to sign in again.
  // Every page load puts the right links back.
  kfCo.repair = function () {
    if (!kfCo.unified()) return false;
    var s = readSettings(), fixed = false, want = { syncUrl: kfCo.url('sync'), sheetsUrl: kfCo.url('loads') };
    Object.keys(want).forEach(function (k) { if (s[k] !== want[k]) { s[k] = want[k]; fixed = true; } });
    if (fixed) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) {} }
    [['scriptUrl', 'tickets'], ['yardUrl', 'yards'], ['driversUrl', 'drivers']].forEach(function (x) { var u = kfCo.url(x[1]); if (LS.get(x[0]) !== u) { LS.set(x[0], u); fixed = true; } });
    return fixed;
  };
  try { kfCo.repair(); } catch (e) {}

  /* ---------------- live refresh ----------------
     kfLive(fn, { ms, when }) runs fn every `ms` while the page is on screen and online, and right away when the
     person comes back to the app. Pages use it so loads, tickets and inventory from other devices show up by themselves. */
  // v14.3: NO background refreshing. A page loads its data when it is opened from the menu (or its ↻ button is tapped).
  // kfLive is kept so the pages do not change; it only returns a "refresh now" function and never runs by itself.
  window.kfLive = function (fn, opts) {
    var busy = false;
    return function () {
      if (busy || navigator.onLine === false) return;
      busy = true; Promise.resolve().then(fn).catch(function () {}).then(function () { busy = false; });
    };
  };
  // "Updated 10:42" line for a page's data (el = element or id)
  window.kfStamp = function (el) { el = typeof el === 'string' ? document.getElementById(el) : el; if (el) el.textContent = 'Updated ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · tap ↻ to refresh'; };

  /* ---------------- company settings arrive on every connected device ----------------
     Saving settings needs the company password (Quote → Settings → Save to Company). Every device connected to the
     company checks for a newer version about once a minute and applies it, unless it has its own unsaved changes. */
  function applyCompanySettings(data) {
    var s = readSettings();
    if (Array.isArray(data.locations) && data.locations.length) s.locations = data.locations;
    if (Array.isArray(data.units) && data.units.length) s.units = data.units;
    ['companyName', 'quoteShow', 'apiKey', 'dispatch'].forEach(function (k) { if (data[k]) s[k] = data[k]; });
    ['speed', 'fuelPrice', 'gst'].forEach(function (k) { if (data[k] != null && data[k] !== '') s[k] = +data[k]; });
    if (data.costFuelPrice != null && data.costFuelPrice !== '') s.costFuelPrice = +data.costFuelPrice; else delete s.costFuelPrice;
    ['money', 'homeBase'].forEach(function (k) { if (data[k] != null && data[k] !== '') s[k] = data[k]; });          // v14
    if (data.offRoadFuelPrice != null && data.offRoadFuelPrice !== '') s.offRoadFuelPrice = +data.offRoadFuelPrice;
    delete s.yardPassword;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) {}
    if (data.profile && typeof data.profile === 'object') {
      var pr = data.profile;
      try { localStorage.setItem('kfCompany', JSON.stringify({ name: pr.name || '', gst: pr.gst || '', wcb: pr.wcb || '', email: pr.email || '', phone: pr.phone || '', addr: pr.addr || '', mail: pr.mail || '', etNote: pr.etNote || '', logo: pr.logo || '' })); } catch (e) {}
    }
  }
  window.kfPullSettings = function () {
    if (!kfCo.unified() || window.kfOwnSync) return Promise.resolve(false);
    return fetch(kfCo.url('sync') + '&settings=1&rev=' + encodeURIComponent(LS.get('kfCompanyRev')) + '&t=' + Date.now()).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.status === 'nokey') { hint('This device is no longer connected (the company password was changed). Open Quote → Settings to connect again.'); return false; }
      if (j && j._meta) { LS.set('kfServerV', String(j._meta.v || 0)); if (j._meta.hasPassword === false) LS.set('kfNoPassword', '1'); else LS.del('kfNoPassword'); if (j._meta.test) LS.set('kfTestMode', '1'); else LS.del('kfTestMode'); }
      var rev = j && j._meta && j._meta.rev;
      if (j && j.same) return false;
      if (rev == null || String(rev) === LS.get('kfCompanyRev')) return false;
      if (LS.get('kfDirty') === '1') return false;                   // this device has unsaved company changes: never overwrite them
      applyCompanySettings(j); LS.set('kfCompanyRev', String(rev));
      window.kfBrand(); if (window.kfOnSettings) window.kfOnSettings(); if (window.kfOnProfile) window.kfOnProfile();
      return true;
    }).catch(function () { return false; });
  };

  /* ---------------- company name + logo in every page header ---------------- */
  function company() { try { return JSON.parse(localStorage.getItem('kfCompany') || '{}'); } catch (e) { return {}; } }
  window.kfBrand = function () {
    var co = company(), s = readSettings(), name = co.name || s.companyName || LS.get('kfCompanyName') || '';
    var logo = co.logo || (!kfCo.unified() && kfCo.hasData() ? 'logo.jpg' : '');   // bundled logo only for a device on the original separate scripts
    var n = document.getElementById('companyNameBanner'); if (n) n.textContent = name || 'Set up your company';
    var img = document.getElementById('companyLogo');
    if (img) { if (logo) { if (img.getAttribute('src') !== logo) img.src = logo; img.style.visibility = 'visible'; } else { img.removeAttribute('src'); img.style.visibility = 'hidden'; } }
    return { name: name, logo: logo };
  };
  document.addEventListener('DOMContentLoaded', function () {
    window.kfBrand();
    // company settings, name and logo: checked once each time a page is opened
    if (kfCo.unified()) window.kfPullSettings();
  });
  // Shrink a picture for the company sheet: at most `max` px and small enough to store whole (about 60 KB).
  // Simple logos stay PNG (keeps transparency); detailed ones become JPEG on white.
  var LOGO_LIMIT = 60000;
  window.kfShrinkImage = function (file, max) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () {
        var im = new Image();
        im.onload = function () {
          var draw = function (px, bg) { var k = Math.min(1, px / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.max(1, Math.round(im.width * k)); c.height = Math.max(1, Math.round(im.height * k)); var g = c.getContext('2d'); if (bg) { g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height); } g.drawImage(im, 0, 0, c.width, c.height); return c; };
          var px = max || 256, out = draw(px).toDataURL('image/png');
          if (out.length > LOGO_LIMIT) {
            var tries = [[px, 0.85], [px, 0.7], [192, 0.75], [160, 0.7], [128, 0.7]];
            for (var i = 0; i < tries.length; i++) { out = draw(tries[i][0], '#ffffff').toDataURL('image/jpeg', tries[i][1]); if (out.length <= LOGO_LIMIT) break; }
          }
          res(out);
        };
        im.onerror = rej; im.src = r.result;
      };
      r.onerror = rej; r.readAsDataURL(file);
    });
  };
  // A logo saved before this fix may have been cut short (only the top of the picture shows).
  window.kfLogoBroken = function (logo) {
    if (!logo) return false;
    if (/^data:image\/png;base64,/.test(logo)) { try { var b = logo.split(',')[1]; return atob(b.slice(b.length - 16)).indexOf('IEND') < 0; } catch (e) { return true; } }   // a whole PNG ends with IEND
    if (/^data:image\/jpeg;base64,/.test(logo)) { try { var t = atob(logo.split(',')[1].slice(-8)); return t.charCodeAt(t.length - 2) !== 0xFF || t.charCodeAt(t.length - 1) !== 0xD9; } catch (e) { return true; } }
    return false;
  };

  /* ======================================================================================
     v14: company from kf-config.js, sign-in (admin token / person), menu, alert badges
     ====================================================================================== */
  function cfgList() {
    var c = window.KF_COMPANY_URL, ok = function (u) { return /^https:\/\/script\.google\.com\//.test(String(u || '').trim()); };
    if (Array.isArray(c)) return c.filter(function (x) { return x && ok(x.url); });
    return ok(c) ? [{ name: '', url: String(c).trim() }] : [];
  }
  // The company link this site belongs to ('' = not set: behave exactly as before v14).
  window.kfConfigUrl = function () {
    var l = cfgList(); if (!l.length) return '';
    if (l.length === 1) return kfCo.clean(l[0].url);
    var pick = LS.get('kfCompanyPick'), hit = l.filter(function (x) { return x.name === pick; })[0];
    return hit ? kfCo.clean(hit.url) : '';
  };
  var FILE = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  function session() { try { return JSON.parse(localStorage.getItem('kfDrvSession') || 'null'); } catch (e) { return null; } }
  window.kfAdminToken = function () { return LS.get('kfAdminToken'); };
  // admin device = has an admin token, or the company has no password yet (then every device is admin)
  window.kfIsAdmin = function () { return !!LS.get('kfAdminToken') || LS.get('kfNoPassword') === '1'; };
  // the person signed in on this phone (driver / mechanic / yard), or null
  window.kfPerson = function () { var s = session(); return s && s.name ? s : null; };
  window.kfRoles = function () { try { var c = JSON.parse(localStorage.getItem('kfDrvCtx') || 'null'); return (c && c.roles) || (kfPerson() ? ['driver'] : []); } catch (e) { return []; } };
  // a phone used only by a person (no company key, not admin): office pages are not shown
  window.kfPeopleOnly = function () { return !!kfPerson() && !kfIsAdmin() && !LS.get('kfKey'); };
  window.kfServerV = function () { return Number(LS.get('kfServerV') || 0); };
  // every request to the company script carries this device's admin token / person token (never a password)
  window.kfDev = function () { var d = LS.get('kfDevId'); if (!d) { d = 'D' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); LS.set('kfDevId', d); } return d; };
  window.kfAuth = function (body) {
    body = Object.assign({}, body || {});
    if (!body.dev) body.dev = window.kfDev();
    var t = LS.get('kfAdminToken'); if (t && !body.adminToken) body.adminToken = t;
    var s = session(); if (s && s.token && !body.token && !body.passcode) body.token = s.token;
    return body;
  };
  window.kfLostAdmin = function () { LS.del('kfAdminToken'); hint('This device is no longer an admin. Enter the company password to make it one again.'); };

  // A device that has never connected joins the company from kf-config.js by itself.
  // People-only phones never see office pages (Quote, Dispatch, Billing, Tickets, Inventory, Statistics).
  var OFFICE = { 'index.html': 1, '': 1, 'dispatch.html': 1, 'invoices.html': 1, 'scale.html': 1, 'yards.html': 1, 'statistics.html': 1 };
  var earlyDone = false;
  window.__kfEarly = function () {
    if (earlyDone || !('KF_COMPANY_URL' in window)) return; earlyDone = true;
    var base = window.kfConfigUrl();
    if (base && !LS.get('kfCompanyUrl')) LS.set('kfCompanyUrl', base);
    if (base && !LS.get('driversUrl') && !LS.get('kfKey')) LS.set('driversUrl', base + '?svc=drivers');
    if (OFFICE[FILE] && window.kfPeopleOnly()) { try { location.replace('drivers.html'); } catch (e) {} }
  };
  window.__kfEarly();

  function el(html) { var d = document.createElement('div'); d.innerHTML = html; return d.firstElementChild; }
  function escH(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function syncPost(body, baseIn) {
    body = Object.assign({ dev: window.kfDev() }, body || {});
    var base = baseIn || kfCo.base() || window.kfConfigUrl();
    return fetch(base + '?svc=sync' + (!baseIn && LS.get('kfKey') ? '&k=' + encodeURIComponent(LS.get('kfKey')) : ''), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow' }).then(function (r) { return r.json(); });
  }
  // The company directory lives in the script named in kf-config.js (the first one when there is a list).
  window.kfDirectoryUrl = function () { var l = cfgList(); return l.length ? kfCo.clean(l[0].url) : ''; };
  // company NAME -> its link ('' name = the site's own company). Resolves { url, name } or { error }.
  window.kfFindCompany = function (name) {
    var dir = window.kfDirectoryUrl(); name = String(name || '').trim();
    if (!dir) return Promise.resolve({ error: 'This website has no company list yet.' });
    if (!name) return Promise.resolve({ url: window.kfConfigUrl() || dir, name: '' });
    return syncPost({ action: 'findCompany', name: name }, dir).then(function (r) {
      if (r && r.status === 'ok') return { url: r.self ? dir : kfCo.clean(r.url), name: r.name };
      if (r && r.status === 'notfound') return { error: 'No company called "' + name + '". Check the spelling, or ask the office for the exact company name.' };
      if (r && r.status === 'error' && /Unknown action/.test(r.message || '')) return { url: dir, name: name };   // old script: only its own company
      return { error: (r && r.message) || 'Could not look up the company.' };
    });
  };
  // Register a company's own link in the directory (done by its first admin device, from Company settings).
  window.kfRegisterCompany = function (url) {
    var dir = window.kfDirectoryUrl() || url;
    return syncPost({ action: 'registerCompany', url: kfCo.clean(url) }, dir);
  };
  // Point this (not yet signed-in) device at a company found by name.
  window.kfUseCompany = function (url, name) {
    if (!url || LS.get('kfKey')) return;
    if (LS.get('kfCompanyUrl') !== url) { LS.set('kfCompanyUrl', url); LS.set('driversUrl', url + '?svc=drivers'); }
    if (name) LS.set('kfCompanyName', name);
  };
  // Make this device an admin: the company password is checked once and a random admin token is kept instead.
  window.kfMakeAdmin = function (password, deviceName, baseIn) {
    var base = baseIn || kfCo.base() || window.kfConfigUrl();
    var post = function (b) { return syncPost(b, baseIn); };
    return post({ action: 'makeAdmin', password: password, deviceName: deviceName }).then(function (r) {
      if (r && r.status === 'ok' && r.adminToken) {
        if (!LS.get('kfKey') || LS.get('kfKey') !== r.key) kfCo.apply(base, r.key, r.meta || { companyId: r.companyId });
        LS.set('kfAdminToken', r.adminToken); LS.set('kfDeviceName', deviceName || ''); LS.set('kfServerV', String((r.meta && r.meta.v) || r.v || 14));
        return { ok: true };
      }
      if (r && r.status === 'error' && /Unknown action/.test(r.message || '')) {         // the script is not updated yet: connect the old way
        return post({ action: 'checkPassword', password: password }).then(function (c) {
          if (c && c.status === 'ok' && c.key) { kfCo.apply(base, c.key, c.meta || { companyId: c.companyId }); return { ok: true, old: true }; }
          return { ok: false, msg: c && c.status === 'locked' ? 'Too many wrong passwords. Wait 10 minutes.' : 'Wrong company password.' };
        });
      }
      if (r && r.status === 'nopassword') return { ok: false, setup: true };
      return { ok: false, msg: r && r.status === 'locked' ? 'Too many wrong passwords. Wait 10 minutes.' : 'Wrong company password.' };
    });
  };
  // An admin device that lost its company key (the old Save Settings bug) gets it back with its admin token,
  // without typing the password. Resolves true when the device is connected again.
  window.kfRecoverKey = function () {
    var tok = LS.get('kfAdminToken'), base = kfCo.base() || window.kfConfigUrl();
    if (!tok || !base || navigator.onLine === false) return Promise.resolve(false);
    return syncPost({ action: 'adminKey', adminToken: tok }, base).then(function (r) {
      if (r && r.status === 'ok' && r.key) { kfCo.apply(base, r.key, r.meta || { companyId: r.companyId }); return true; }
      if (r && r.status === 'noadmin') LS.del('kfAdminToken');
      return false;
    }).catch(function () { return false; });
  };
  window.kfStopAdmin = function () {
    if (!confirm('Stop being an admin on this device? Office pages will ask for the company password again.')) return;
    var t = LS.get('kfAdminToken');
    syncPost({ action: 'stopAdmin', adminToken: t }).catch(function () {});
    LS.del('kfAdminToken'); location.reload();
  };

  // ---- sign-in screen (first open of a device that knows its company but has no sign-in yet) ----
  window.kfShowSignIn = function (why) {
    if (document.getElementById('kfSignIn')) return;
    var list = cfgList(), many = list.length > 1;
    var ov = el('<div id="kfSignIn" style="position:fixed;inset:0;z-index:7000;background:var(--bg,#f1f5f9);color:var(--text,#0f172a);overflow:auto;font-family:Arial,sans-serif">' +
      '<div style="max-width:440px;margin:0 auto;padding:22px 16px 40px">' +
      '<h2 style="margin:6px 0 4px">Sign in</h2><div style="color:var(--muted,#475569);font-size:.95rem;margin-bottom:14px">' + escH(why || 'Sign in once on this phone.') + '</div>' +
      (many ? '<label style="display:block;font-weight:700;margin:8px 0 4px">Which company?</label><select id="kfsCo" style="width:100%;padding:12px;font-size:1rem">' + list.map(function (x) { return '<option>' + escH(x.name) + '</option>'; }).join('') + '</select>'
        : '<label style="display:block;font-weight:700;margin:8px 0 4px" for="kfsCoName">Company name</label><input id="kfsCoName" autocomplete="organization" placeholder="as the office spells it" value="' + escH(LS.get('kfCompanyName')) + '" style="width:100%;box-sizing:border-box;padding:12px;font-size:1rem">') +
      '<button id="kfsPerson" style="display:block;width:100%;padding:16px;margin:12px 0;border:0;border-radius:12px;background:var(--btn-bg,#1e3a5f);color:#fff;font-size:1.05rem;font-weight:800">I drive, fix trucks or work in the yard</button>' +
      '<div style="border-top:1px solid var(--border,#cbd5e1);margin:18px 0 10px"></div><b>Office / owner</b>' +
      '<label style="display:block;margin:10px 0 4px" for="kfsPw">Company password</label><input id="kfsPw" type="password" autocomplete="current-password" style="width:100%;box-sizing:border-box;padding:12px;font-size:1rem">' +
      '<label style="display:block;margin:10px 0 4px" for="kfsName">Name for this device</label><input id="kfsName" placeholder="e.g. Owner\'s phone" style="width:100%;box-sizing:border-box;padding:12px;font-size:1rem">' +
      '<button id="kfsAdmin" style="display:block;width:100%;padding:14px;margin-top:12px;border:2px solid var(--btn-bg,#1e3a5f);border-radius:12px;background:transparent;color:var(--text,#0f172a);font-size:1rem;font-weight:800">Make this device an admin</button>' +
      '<div id="kfsMsg" style="margin-top:10px;font-weight:700"></div>' +
      '<div style="border-top:1px solid var(--border,#cbd5e1);margin:22px 0 10px"></div><button id="kfsNew" type="button" style="background:none;border:0;color:var(--link,#1d4ed8);font-size:.95rem;text-decoration:underline;padding:6px 0;cursor:pointer">Setting up a new company? Use its sheet link</button></div></div>');
    document.body.appendChild(ov);
    var pickCo = function () { if (many) { LS.set('kfCompanyPick', document.getElementById('kfsCo').value); LS.del('kfCompanyUrl'); LS.del('driversUrl'); var b = window.kfConfigUrl(); LS.set('kfCompanyUrl', b); LS.set('driversUrl', b + '?svc=drivers'); } };
    if (many && LS.get('kfCompanyPick')) document.getElementById('kfsCo').value = LS.get('kfCompanyPick');
    document.getElementById('kfsNew').onclick = function () { try { sessionStorage.setItem('kfNewCompany', '1'); } catch (e) {} location.replace('index.html?new=' + Date.now() + '#company'); };
    var msgEl = document.getElementById('kfsMsg'), bad = function (t) { msgEl.style.color = 'var(--bad,#dc2626)'; msgEl.textContent = t; };
    // the company: picked from the list, or looked up by its name in the company directory
    var findCo = function () {
      if (many) { pickCo(); return Promise.resolve({ url: window.kfConfigUrl() }); }
      var nmEl = document.getElementById('kfsCoName'); if (!nmEl.value.trim()) return Promise.resolve({ error: 'Enter the company name.' });
      msgEl.style.color = ''; msgEl.textContent = 'Finding the company…';
      return window.kfFindCompany(nmEl.value).then(function (c) { if (c.url) window.kfUseCompany(c.url, c.name); return c; });
    };
    document.getElementById('kfsPerson').onclick = function () {
      findCo().then(function (c) { if (c.error) return bad(c.error); location.replace('drivers.html'); }).catch(function () { bad('No signal. Try again when you have signal.'); });
    };
    document.getElementById('kfsAdmin').onclick = function () {
      var pw = document.getElementById('kfsPw').value, nm = document.getElementById('kfsName').value.trim();
      if (!pw) return bad('Enter the company password.');
      if (!nm) return bad('Give this device a name (so you can remove it later).');
      findCo().then(function (c) {
        if (c.error) return bad(c.error);
        msgEl.style.color = ''; msgEl.textContent = 'Checking…';
        return window.kfMakeAdmin(pw, nm, c.url).then(function (r) {
          if (r.ok) { msgEl.textContent = 'Done.'; setTimeout(function () { location.replace(FILE === 'drivers.html' ? 'drivers.html' : (FILE || 'index.html')); }, 300); return; }
          if (r.setup) { LS.set('kfSetupUrl', c.url); location.replace('index.html#setup'); return; }
          bad(r.msg);
        });
      }).catch(function () { bad('No signal. Try again when you have signal.'); });
    };
  };
  window.kfCloseSignIn = function () { var o = document.getElementById('kfSignIn'); if (o) o.remove(); };
  function needsSignIn() {
    if (!window.kfConfigUrl() && cfgList().length < 2) return false;
    if (cfgList().length > 1 && !LS.get('kfCompanyPick')) return true;
    var newCo = false; try { newCo = sessionStorage.getItem('kfNewCompany') === '1'; } catch (e) {}
    return !newCo && !LS.get('kfKey') && !LS.get('kfAdminToken') && !window.kfPerson() && !LS.get('kfSkipConnect');
  }

  // ---- menu: same order on every page, Trucks linked, Statistics for admins, alert badges ----
  // v14.3 menu order. Four tabs fit on screen; swipe the bar for the rest.
  var PAGES = [['index.html', 'Quote', 'quote'], ['drivers.html', 'Drivers', 'drivers'], ['dispatch.html', 'Dispatch', 'dispatch'], ['scale.html', 'Tickets', 'tickets'],
    ['invoices.html', 'Billing', 'billing'], ['yards.html', 'Yards', 'inventory'], ['trucks.html', 'Trucks', 'trucks'], ['statistics.html', 'Statistics', 'statistics']];
  var KEY_OF = {}; PAGES.forEach(function (p) { KEY_OF[p[0]] = p[2]; }); KEY_OF[''] = 'quote';
  window.kfPageKey = function () { return KEY_OF[FILE] || ''; };
  function menuCss() {
    if (document.getElementById('kfMenuCss')) return;
    var st = document.createElement('style'); st.id = 'kfMenuCss';
    st.textContent = 'header .kfMenu{display:flex!important;gap:6px!important;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x proximity;scrollbar-width:none;-webkit-overflow-scrolling:touch;padding:7px 2px 2px!important;grid-template-columns:none!important}' +
      'header .kfMenu::-webkit-scrollbar{display:none}' +
      'header .kfMenu a{flex:0 0 calc((100% - 18px) / 4)!important;box-sizing:border-box;text-align:center;scroll-snap-align:start;padding:11px 2px!important;font-size:.9rem!important;border-radius:8px!important;white-space:nowrap;min-height:42px}' +
      'header .kfMenu.more{-webkit-mask-image:linear-gradient(90deg,#000 85%,transparent);mask-image:linear-gradient(90deg,#000 85%,transparent)}' +
      'header .kfMenu.more.end{-webkit-mask-image:none;mask-image:none}';
    document.head.appendChild(st);
  }
  // v14.4: pages call kfFixMenu() after someone signs in or out, so the menu matches at once
  // v14.4: the 900 KB PDF tool is loaded the first time a PDF is made, not with every page
  window.kfPdfLib = function () {
    if (window.html2pdf) return Promise.resolve();
    if (!window.__kfPdf) window.__kfPdf = new Promise(function (res, rej) { var s = document.createElement('script'); s.src = 'html2pdf.bundle.min.js'; s.onload = function () { res(); }; s.onerror = function () { window.__kfPdf = null; rej(new Error('PDF library not loaded (no signal?).')); }; document.head.appendChild(s); });
    return window.__kfPdf;
  };
  window.kfFixMenu = function () { try { fixMenu(); } catch (e) {} };
  function fixMenu() {
    var a0 = document.querySelector('header a[href="dispatch.html"]'); if (!a0) return;
    menuCss();
    var grid = a0.parentElement, anchors = [].slice.call(grid.querySelectorAll('a'));
    var people = window.kfPeopleOnly(), admin = window.kfIsAdmin(), shown = 0;
    // existing links are matched by the page they open (the Trucks / Statistics links on old pages are matched by their text)
    var byPage = {}; anchors.forEach(function (a) { var raw = a.getAttribute('href') || '', h = raw === '#' ? '#' : raw.split('#')[0], t = a.textContent.trim(); PAGES.forEach(function (p) { if (h === p[0] || (h === '#' && (t === p[1] || (p[2] === 'inventory' && t === 'Inventory')))) byPage[p[0]] = a; }); });
    PAGES.forEach(function (p) {
      var a = byPage[p[0]];
      if (!a) { a = a0.cloneNode(false); a.removeAttribute('id'); grid.appendChild(a); }
      a.textContent = p[1];
      a.setAttribute('href', p[0]); a.removeAttribute('onclick'); a.onclick = function (e) { e.preventDefault(); location.replace(p[0]); };
      a.dataset.kfPage = p[2]; a.style.position = 'relative';
      var show = p[2] === 'statistics' ? admin : (!people || p[2] === 'drivers' || p[2] === 'trucks');
      a.style.display = show ? '' : 'none'; if (show) shown++;
      grid.appendChild(a);                                                     // same order everywhere
    });
    grid.classList.add('kfMenu'); grid.style.display = 'flex';
    var edge = function () { var more = grid.scrollWidth > grid.clientWidth + 4; grid.classList.toggle('more', more); grid.classList.toggle('end', grid.scrollLeft + grid.clientWidth >= grid.scrollWidth - 4); };
    grid.addEventListener('scroll', edge, { passive: true }); window.addEventListener('resize', edge);
    var cur = grid.querySelector('a[data-kf-page="' + window.kfPageKey() + '"]');
    if (cur) { cur.style.background = 'rgba(255,255,255,0.32)'; cur.style.fontWeight = '700'; grid.scrollLeft = Math.max(0, cur.offsetLeft - grid.offsetLeft - grid.clientWidth / 2 + cur.offsetWidth / 2); }
    edge();
  }
  function headerBadges() {
    var name = document.getElementById('companyNameBanner'); if (!name || document.getElementById('kfAdminBadge')) return;
    if (LS.get('kfAdminToken')) {
      var b = el('<button id="kfAdminBadge" type="button" title="This device is an admin" style="margin-left:8px;background:#facc15;color:#0f172a;border:0;border-radius:999px;padding:3px 9px;font-size:.7rem;font-weight:800;cursor:pointer">Admin</button>');
      b.onclick = function () { window.kfStopAdmin(); };
      name.parentNode.insertBefore(b, name.nextSibling);
    }
    if (window.KF_TEST || LS.get('kfTestMode') === '1') {
      document.body.insertBefore(el('<div style="background:#dc2626;color:#fff;text-align:center;font-weight:900;letter-spacing:2px;padding:6px;font-family:Arial,sans-serif">TEST SITE: emails only go to the owner</div>'), document.body.firstChild);
    }
  }
  // An existing office device that holds the company key but has no admin token is asked once (not forced).
  function adminAsk() {
    if (!OFFICE[FILE] || !LS.get('kfKey') || LS.get('kfAdminToken') || window.kfIsAdmin() || window.kfServerV() < 14) return;
    if (Date.now() - Number(LS.get('kfAdminAskAt') || 0) < 7 * 86400000) return;
    var box = document.querySelector('.container'); if (!box) return;
    var card = el('<div style="border:2px solid #facc15;background:var(--card,#fff);border-radius:12px;padding:12px;margin:10px 0">' +
      '<b>Make this device an admin?</b><div style="font-size:.9rem;color:var(--muted,#475569);margin:4px 0 8px">Enter the company password once. After that this device never asks for it again (nothing is lost if you do it later).</div>' +
      '<input id="kfaPw" type="password" placeholder="Company password" style="width:100%;box-sizing:border-box;margin-bottom:6px"><input id="kfaName" placeholder="Name for this device, e.g. Office tablet" style="width:100%;box-sizing:border-box">' +
      '<div style="display:flex;gap:8px;margin-top:8px"><button class="btn" id="kfaGo" type="button">Make admin</button><button class="btn btn-outline" id="kfaLater" type="button">Later</button></div><div id="kfaMsg" style="font-weight:700;margin-top:6px"></div></div>');
    box.insertBefore(card, box.firstChild);
    document.getElementById('kfaLater').onclick = function () { LS.set('kfAdminAskAt', String(Date.now())); card.remove(); };
    document.getElementById('kfaGo').onclick = function () {
      var m = document.getElementById('kfaMsg'), pw = document.getElementById('kfaPw').value, nm = document.getElementById('kfaName').value.trim() || 'Office device';
      if (!pw) { m.textContent = 'Enter the company password.'; return; }
      m.textContent = 'Checking…';
      window.kfMakeAdmin(pw, nm).then(function (r) { if (r.ok) location.reload(); else m.textContent = r.msg || 'Could not make this device an admin.'; }).catch(function () { m.textContent = 'No signal.'; });
    };
  }

  // ---- action alerts: one light call, cached 5 minutes, never blocks the page ----
  function renderAlerts(j) {
    var pages = (j && j.pages) || {};
    [].forEach.call(document.querySelectorAll('header a[data-kf-page]'), function (a) {
      var p = pages[a.dataset.kfPage], old = a.querySelector('.kfBadge'); if (old) old.remove();
      if (!p || !(p.red || p.amber)) return;
      a.appendChild(el(p.red ? '<span class="kfBadge" style="position:absolute;top:-5px;right:-3px;background:#dc2626;color:#fff;border-radius:999px;min-width:16px;height:16px;line-height:16px;font-size:10px;font-weight:800;text-align:center;padding:0 3px">' + p.red + '</span>'
        : '<span class="kfBadge" style="position:absolute;top:-3px;right:-1px;background:#f59e0b;border-radius:50%;width:10px;height:10px"></span>'));
    });
    var mine = pages[window.kfPageKey()], box = document.querySelector('.container'), old = document.getElementById('kfNeeds');
    if (old) old.remove();
    if (!mine || !box || !(mine.items || []).length || window.kfPageKey() === 'statistics') return;
    var open = LS.get('kfNeedsOpen_' + window.kfPageKey()) !== '0';
    var d = el('<details id="kfNeeds" ' + (open ? 'open' : '') + ' style="border:1px solid var(--border,#cbd5e1);border-left:5px solid ' + (mine.red ? '#dc2626' : '#f59e0b') + ';background:var(--card,#fff);border-radius:10px;padding:8px 12px;margin:8px 0"><summary style="font-weight:800;cursor:pointer">Needs action (' + mine.items.length + ')</summary>' +
      mine.items.slice(0, 40).map(function (it) { return '<a href="' + escH(it.href || '#') + '" style="display:block;padding:9px 2px;border-top:1px solid var(--border,#e2e8f0);color:var(--text,#0f172a);text-decoration:none"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:8px;background:' + (it.lvl === 'red' ? '#dc2626' : '#f59e0b') + '"></span>' + escH(it.t) + '</a>'; }).join('') + '</details>');
    d.addEventListener('toggle', function () { LS.set('kfNeedsOpen_' + window.kfPageKey(), d.open ? '1' : '0'); });
    box.insertBefore(d, box.firstChild);
  }
  window.kfAlertsRefresh = function (force) {
    if (!LS.get('kfCompanyUrl') || window.kfServerV() < 14) return;
    var c = null; try { c = JSON.parse(LS.get('kfAlerts') || 'null'); } catch (e) {}
    if (c && c.data) renderAlerts(c.data);
    if (!force && c && Date.now() - c.at < 300000) return;
    if (navigator.onLine === false) return;
    kfCo.post('sync', { action: 'alerts' }).then(function (j) { if (j && j.status === 'ok') { LS.set('kfAlerts', JSON.stringify({ at: Date.now(), data: j })); renderAlerts(j); } }).catch(function () {});
  };

  // ---- photos: shrunk on the phone (max 1600 px, JPEG 0.7), uploaded to Drive; the sheet stores only the link ----
  window.kfPhoto = {
    shrink: function (file) {
      return new Promise(function (res, rej) {
        var r = new FileReader();
        r.onload = function () { var im = new Image(); im.onload = function () { var k = Math.min(1, 1600 / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', 0.7)); }; im.onerror = rej; im.src = r.result; };
        r.onerror = rej; r.readAsDataURL(file);
      });
    },
    // pick a picture (camera or file) and shrink it; resolves a data URL or '' if cancelled
    pick: function () {
      return new Promise(function (res) {
        var i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*,application/pdf';
        i.onchange = function () { var f = i.files[0]; if (!f) return res(''); if (/pdf/.test(f.type)) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.readAsDataURL(f); } else window.kfPhoto.shrink(f).then(res, function () { res(''); }); };
        i.click();
      });
    },
    upload: function (dataUrl, name) {
      return kfCo.post('trucks', { action: 'uploadPhoto', data: dataUrl, name: name || 'photo' }).then(function (j) { if (j && j.status === 'ok' && j.url) return j.url; throw new Error((j && j.message) || 'Upload failed'); });
    }
  };

  document.addEventListener('DOMContentLoaded', function () {
    try { fixMenu(); headerBadges(); } catch (e) {}
    if (LS.get('kfAdminToken') && !LS.get('kfKey') && LS.get('kfCompanyUrl')) window.kfRecoverKey().then(function (ok) { if (ok) location.reload(); });
    if (needsSignIn() && FILE !== 'drivers.html' && FILE !== 'app.html') window.kfShowSignIn('Sign in once on this phone.');
    try { adminAsk(); } catch (e) {}
    setTimeout(function () { window.kfAlertsRefresh(false); }, 400);
  });
  // v14.3: alert counts are checked when a page is opened (no background checks)

  /* ---------------- v14.3 shared rules: weights + tonnes per cord ----------------
     Scale tickets weigh in KG (the scale needs that). Everywhere else weights are TONNES to 2 decimals: 30,360 kg = 30.36 t.
     Tonnes per cord is set per species at each pickup location / yard. There is no default: no factor = no cords shown. */
  window.kfKgToT = function (kg) { var n = parseFloat(String(kg == null ? '' : kg).replace(/,/g, '')); return n > 0 ? Math.round(n / 10) / 100 : 0; };
  window.kfFactor = function (place, species) {
    var s = readSettings(), loc = (s.locations || []).filter(function (l) { return l.name === place; })[0];
    var sp = loc && (loc.species || []).filter(function (x) { return x.name === species; })[0];
    var f = sp ? Number(sp.tonnesPerCord) : 0; return f > 0 ? f : 0;
  };
  window.kfCords = function (tonnes, factor) { var t = Number(tonnes), f = Number(factor); return t > 0 && f > 0 ? Math.round(t / f * 10) / 10 : ''; };

  // Password box (hidden typing) instead of the browser's prompt(). Resolves the password, or '' when cancelled.
  window.kfAskPassword = function (msg) {
    return new Promise(function (res) {
      var ov = el('<div style="position:fixed;inset:0;z-index:8000;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:16px;font-family:Arial,sans-serif">' +
        '<div style="background:var(--card,#fff);color:var(--text,#0f172a);border-radius:14px;padding:18px;width:100%;max-width:380px;box-shadow:0 10px 40px rgba(0,0,0,.35)">' +
        '<div style="font-weight:800;margin-bottom:10px">' + escH(msg || 'Company password') + '</div>' +
        '<input type="password" autocomplete="current-password" style="width:100%;box-sizing:border-box;padding:12px;font-size:1.05rem">' +
        '<div style="display:flex;gap:8px;margin-top:12px"><button type="button" data-x="0" style="flex:1;padding:13px;border-radius:10px;border:2px solid var(--border,#cbd5e1);background:transparent;color:inherit;font-weight:700;font-size:1rem">Cancel</button>' +
        '<button type="button" data-x="1" style="flex:1;padding:13px;border-radius:10px;border:0;background:var(--btn-bg,#1e3a5f);color:#fff;font-weight:800;font-size:1rem">OK</button></div></div></div>');
      document.body.appendChild(ov);
      var inp = ov.querySelector('input'), done = function (v) { ov.remove(); res(v); };
      ov.querySelector('[data-x="0"]').onclick = function () { done(''); };
      ov.querySelector('[data-x="1"]').onclick = function () { done(inp.value); };
      inp.onkeydown = function (e) { if (e.key === 'Enter') done(inp.value); };
      setTimeout(function () { inp.focus(); }, 50);
    });
  };
  // Short message at the bottom of the screen that does not need a tap (green = done, red = problem).
  window.kfToast = function (msg, bad) {
    var t = el('<div style="position:fixed;left:50%;bottom:calc(20px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:8500;max-width:92vw;padding:13px 16px;border-radius:12px;font:700 15px Arial,sans-serif;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.3);background:' + (bad ? '#b91c1c' : '#15803d') + '"></div>');
    t.textContent = msg; document.body.appendChild(t); setTimeout(function () { t.remove(); }, bad ? 6000 : 3500);
  };

  /* ---------------- Android app (Capacitor) ----------------
     The app loads this same site. Inside it, the browser's share screen, downloads, print and
     pop-up windows are not available, so files go through the phone's own share screen. */
  var C = window.Capacitor;
  window.kfNative = !!(C && C.isNativePlatform && C.isNativePlatform());
  function plug(name) { return window.kfNative && C.Plugins && C.Plugins[name]; }
  window.kfPlugin = plug;
  function blobToB64(blob) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(String(r.result).split('base64,')[1] || ''); }; r.onerror = rej; r.readAsDataURL(blob); }); }
  // Share a File/Blob with the phone's share screen (Print, Gmail, Drive...). Resolves true when handled.
  window.kfShareFile = function (file, title) {
    var FS = plug('Filesystem'), SH = plug('Share');
    if (!FS || !SH) return Promise.resolve(false);
    var name = String(file.name || 'document.pdf').replace(/[\\/:*?"<>|]/g, '-');
    return blobToB64(file).then(function (b64) {
      return FS.writeFile({ path: name, data: b64, directory: 'CACHE' });
    }).then(function (w) {
      return SH.share({ title: title || name, files: [w.uri], dialogTitle: title || name });
    }).then(function () { return true; }, function (e) {
      if (e && /cancel/i.test(String(e.message || e))) return true;
      alert('Could not share: ' + (e && e.message || e)); return true;
    });
  };
  // Show a full HTML document (invoice preview) inside the app instead of a new window.
  window.kfPreview = function (html) {
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:6000;background:#fff;display:flex;flex-direction:column';
    ov.innerHTML = '<div style="padding:8px;background:#0f172a;text-align:right"><button style="background:#fff;color:#0f172a;border:0;border-radius:8px;padding:10px 16px;font-weight:800">Close</button></div>';
    var fr = document.createElement('iframe'); fr.style.cssText = 'flex:1;border:0;width:100%;background:#fff'; fr.srcdoc = html;
    ov.appendChild(fr); document.body.appendChild(ov);
    var close = function () { ov.remove(); window.kfPreviewClose = null; };
    ov.querySelector('button').onclick = close; window.kfPreviewClose = close;
  };
})();
