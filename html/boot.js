// Runs before first paint: theme, text size and the "share" prompt, so nothing
// flashes or jumps once the page's main script loads.
(function () {
  var d = document.documentElement, get = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
  var t = get('cr_theme'), fs = parseFloat(get('cr_textsize'));
  if (t !== 'dark' && t !== 'light') t = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  d.dataset.theme = t;
  var bar = document.querySelectorAll('meta[name="theme-color"]');
  for (var i = 0; i < bar.length; i++) { bar[i].removeAttribute('media'); bar[i].content = t === 'dark' ? '#122023' : '#ffffff'; }
  d.style.setProperty('--fs', [1, 1.15, 1.3, 1.5].indexOf(fs) >= 0 ? fs : 1.15);
  // How much to show (1 simple, 2 more, 3 everything). A shared link that needs
  // a control the simple level hides opens at the level that has it.
  var q = new URLSearchParams(location.search), n = parseInt(q.get('detail') || get('cr_detail'), 10);
  n = n === 2 || n === 3 ? n : 1;
  if (n < 2 && ['schools', 'q', 'decision', 'sort', 'at'].some(function (k) { return q.has(k); })) n = 2;
  if (q.has('only')) n = 3;
  d.dataset.detail = n;
  // First visit: the tip about levels is part of the first paint, so nothing jumps.
  if (get('cr_detail_tip') !== '1' && !get('cr_detail') && !q.has('detail')) d.classList.add('first-visit');
  if (get('cr_submitted') === '1') d.classList.add('no-cta');
})();
