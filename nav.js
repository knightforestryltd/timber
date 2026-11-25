/* Shared by every page.
   1) Phone back button: goes back one level at a time (close pop-up → previous screen → page menu →
      Quote home page). On the home page it does nothing, so the app never closes by accident.
      Each page defines window.kfBack(): return true if it closed something / went up a level.
   2) Sheet links: kfLinks reads/writes the script links each page uses, stamped with the time so
      Company Sync (Quote page) knows which copy is newest, and flags "not saved to company yet". */
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
      el.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);background:#0f172a;color:#fff;padding:10px 14px;border-radius:10px;font:14px Arial,sans-serif;z-index:5000;box-shadow:0 6px 20px rgba(0,0,0,.3);max-width:90vw;text-align:center;display:none';
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
      return fetch(kfCo.url(svc), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow' }).then(function (r) { return r.json(); });
    }
  };
  window.kfCo = kfCo;

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
    // keep company info (Billing details, name, logo) current on every device
    if (kfCo.unified() && navigator.onLine !== false) {
      fetch(kfCo.url('sync') + '&profile=1&t=' + Date.now()).then(function (r) { return r.json(); }).then(function (j) {
        if (j && j.status === 'ok' && j.profile) {
          var cur = company(), pr = j.profile, next = { name: pr.name || '', gst: pr.gst || '', wcb: pr.wcb || '', email: pr.email || '', phone: pr.phone || '', addr: pr.addr || '', mail: pr.mail || '', etNote: pr.etNote || '', logo: pr.logo || '' };
          if (JSON.stringify(cur) !== JSON.stringify(next)) { try { localStorage.setItem('kfCompany', JSON.stringify(next)); } catch (e) {} window.kfBrand(); if (window.kfOnProfile) window.kfOnProfile(next); }
        } else if (j && j.status === 'nokey') {
          hint('This device is no longer connected to the company (the password was changed). Open Quote → Settings to connect again.');
        }
      }).catch(function () {});
    }
  });
  // shrink a picture to at most `max` px and return a data URL (logos are stored in the company sheet)
  window.kfShrinkImage = function (file, max) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { var im = new Image(); im.onload = function () { var k = Math.min(1, (max || 256) / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); res(c.toDataURL('image/png')); }; im.onerror = rej; im.src = r.result; };
      r.onerror = rej; r.readAsDataURL(file);
    });
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
