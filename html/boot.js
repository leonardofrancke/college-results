// Runs before first paint: theme, text size and the "share" prompt, so nothing
// flashes or jumps once the page's main script loads.
(function () {
  var d = document.documentElement, get = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
  var t = get('cr_theme'), fs = parseFloat(get('cr_textsize'));
  if (t !== 'dark' && t !== 'light') t = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  d.dataset.theme = t;
  d.style.setProperty('--fs', [1, 1.15, 1.3, 1.5].indexOf(fs) >= 0 ? fs : 1.15);
  if (get('cr_submitted') === '1') d.classList.add('no-cta');
})();
