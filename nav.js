/* Knight Forestry — shared by every page.
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
  window.addEventListener('popstate', function () {
    if (leaving) return;
    var handled = false;
    try { handled = typeof window.kfBack === 'function' && window.kfBack() === true; } catch (e) { handled = false; }
    if (!handled && !isHome()) { leaving = true; location.replace(HOME); return; }
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
})();
