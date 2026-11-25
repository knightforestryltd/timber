/* Knight Forestry — shared theme switch. Load in <head>, before the page CSS paints.
   Reads the same 'kf_theme' key the Quote page Settings toggle writes. */
(function () {
  var KEY = 'kf_theme';
  function current() {
    try { return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'; } catch (e) { return 'light'; }
  }
  function apply(t) {
    var dark = t === 'dark';
    document.documentElement.classList.toggle('dark', dark);
    if (document.body) document.body.classList.toggle('dark', dark);
  }
  window.kfApplyTheme = function (t) {
    try { localStorage.setItem(KEY, t); } catch (e) {}
    apply(t);
  };
  apply(current());
  document.addEventListener('DOMContentLoaded', function () {
    apply(current());
    var file = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    var links = document.querySelectorAll('header a[href]');
    for (var i = 0; i < links.length; i++) {
      var h = (links[i].getAttribute('href') || '').split('#')[0].toLowerCase();
      if (h && h === file) links[i].classList.add('active');
    }
  });
  window.addEventListener('pageshow', function () { apply(current()); });
  window.addEventListener('storage', function (e) { if (e.key === KEY) apply(current()); });
})();
