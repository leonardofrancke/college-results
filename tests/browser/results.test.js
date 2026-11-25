// Browser tests for the read-only results surfaces, run against the local
// harness (real nginx + real API + synthetic data). Uses the system Chrome.
//   cd tests/browser && npm install && npm test
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { start } = require('./harness');
const { LONG_NAME } = require('../fixtures/synthetic-results');

let h, browser;
before(async () => {
  h = await start();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});
after(async () => { await browser?.close(); await h?.stop(); });

// A fresh context per test: empty localStorage, so no saved theme or
// acknowledgement leaks between tests. The stats notice is pre-acknowledged
// unless a test is about the notice itself.
async function page(opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 900 }, reducedMotion: opts.reducedMotion || 'reduce' });
  if (!opts.showNotice) await ctx.addInitScript(() => { try { localStorage.setItem('cr_stats_disclaimer_ack', '1'); } catch (e) {} });
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', e => p.errors.push(e.message));
  await p.goto(h.baseUrl + (opts.path || '/'));
  if (opts.wait !== false) await p.waitForSelector('#chart-main svg, #chart-main .chart-empty');
  return p;
}
const statsText = p => p.$eval('#stats-inline', el => el.innerText);
const active = p => p.evaluate(() => {
  const a = document.activeElement;
  return a ? (a.id || a.dataset.focusKey || a.dataset.schools || a.textContent.trim().slice(0, 40)) : null;
});

describe('theme and text size keep the current view (audit F19)', () => {
  test('toggling theme with UCs selected keeps UC statistics', async () => {
    const p = await page();
    const allStats = await statsText(p);
    await p.click('[data-schools="UCs"]');
    const ucStats = await statsText(p);
    assert.notEqual(ucStats, allStats, 'fixture should make UC stats differ from all-school stats');
    await p.click('#theme-toggle');
    assert.equal(await p.getAttribute('html', 'data-theme'), 'dark');
    assert.equal(await statsText(p), ucStats, 'statistics changed when only the theme changed');
    assert.equal(await p.textContent('#stats-heading'), 'Statistics: UCs');
    await p.click('#theme-toggle');
    assert.equal(await statsText(p), ucStats);
    assert.deepEqual(p.errors, []);
    await p.context().close();
  });

  test('every filter survives theme and text-size changes, including the URL', async () => {
    const p = await page({ path: '/?schools=CSUs&chart=sat&q=state&stats=grades&decision=Accepted' });
    await p.fill('#slm-gpa', '3.4');
    await p.waitForSelector('.slm-chip');
    const snap = async () => ({
      url: new URL(p.url()).search,
      pressed: await p.$eval('[data-schools][aria-pressed="true"]', b => b.dataset.schools),
      metric: await p.$eval('[data-metric][aria-pressed="true"]', b => b.dataset.metric),
      search: await p.inputValue('#college-search'),
      tab: await p.$eval('[data-stats][aria-selected="true"]', b => b.dataset.stats),
      legend: await p.$$eval('#legend [aria-pressed="true"]', b => b.map(x => x.dataset.decision)),
      chips: await p.$$eval('.slm-chip', c => c.map(x => x.textContent)),
      cols: await p.$$eval('#chart-main .c-name[data-col]', t => t.map(x => x.textContent)),
      stats: await statsText(p),
      entries: await p.$eval('#entries', e => e.innerText),
    });
    const before = await snap();
    assert.equal(before.pressed, 'CSUs');
    assert.equal(before.metric, 'sat');
    assert.equal(before.tab, 'grades');
    assert.ok(!/3\.4/.test(before.url), 'a student\'s own GPA never goes in the URL');
    assert.deepEqual(before.legend, ['Accepted']);
    assert.equal(before.chips.length, 1);
    await p.click('#theme-toggle');
    assert.deepEqual(await snap(), before);
    await p.click('#text-bigger');
    assert.deepEqual(await snap(), before);
    await p.click('#text-smaller');
    await p.click('#text-smaller');
    assert.deepEqual(await snap(), before);
    await p.context().close();
  });

  test('theme and text size keep the existing preference keys', async () => {
    const p = await page();
    await p.click('#theme-toggle');
    await p.click('#text-bigger');
    const ls = await p.evaluate(() => ({ ...localStorage }));
    assert.equal(ls.cr_theme, 'dark');
    assert.equal(ls.cr_textsize, '1.3');
    assert.ok(ls.cr_sid, 'browser ID still created under the same key');
    await p.context().close();
  });
});

describe('keyboard, names and states', () => {
  test('skip link is first, works, and nav is real links with current state', async () => {
    const p = await page();
    await p.keyboard.press('Tab');
    assert.equal(await p.evaluate(() => document.activeElement.className), 'skip-link');
    await p.keyboard.press('Enter');
    assert.equal(await active(p), 'main-content');
    const nav = await p.$$eval('nav a.nav-link', a => a.map(x => [x.getAttribute('href'), x.getAttribute('aria-current')]));
    assert.deepEqual(nav, [['/', 'page'], ['/?page=submit', null]]);
    assert.deepEqual(await p.$$eval('h1', h => h.filter(x => x.offsetParent).map(x => x.textContent)), ['Where Live Oak got in']);
    await p.focus('#nav-submit');
    await p.keyboard.press('Enter');
    await p.waitForSelector('#page-submit.active');
    assert.equal(await p.getAttribute('#nav-submit', 'aria-current'), 'page');
    assert.equal(new URL(p.url()).search, '?page=submit');
    assert.equal(await active(p), 'main-content');
    assert.ok(await p.$eval('#page-results', el => getComputedStyle(el).display === 'none'), 'inactive view hidden');
    assert.equal(await p.$$eval('h1', h => h.filter(x => x.offsetParent).length), 1, 'one visible h1 on the form too');
    await p.context().close();
  });

  test('category buttons expose pressed state and keep focus', async () => {
    const p = await page();
    await p.focus('[data-schools="UCs"]');
    await p.keyboard.press('Enter');
    assert.equal(await p.getAttribute('[data-schools="UCs"]', 'aria-pressed'), 'true');
    assert.equal(await p.getAttribute('[data-schools="All"]', 'aria-pressed'), 'false');
    assert.equal(await active(p), 'UCs');
    await p.context().close();
  });

  test('chart: one Tab stop, arrows move, Enter opens a named dialog, focus returns', async () => {
    const p = await page();
    const stops = await p.$$eval('#chart-main [tabindex="0"]', n => n.length);
    assert.equal(stops, 1, 'exactly one chart element in the Tab order');
    await p.focus('#chart-main .c-name[tabindex="0"]');
    const first = await active(p);
    await p.keyboard.press('ArrowDown');
    const second = await active(p);
    assert.notEqual(first, second);
    assert.equal(await p.$$eval('#chart-main [tabindex="0"]', n => n.length), 1);
    const label = await p.evaluate(() => document.activeElement.getAttribute('aria-label'));
    assert.match(label, /shown: .*Open details$/);
    await p.keyboard.press('Enter');
    await p.waitForSelector('#college-modal.open');
    const dlg = await p.$eval('#college-modal .modal', m => ({ role: m.getAttribute('role'), modal: m.getAttribute('aria-modal'), name: document.getElementById(m.getAttribute('aria-labelledby')).textContent }));
    assert.equal(dlg.role, 'dialog');
    assert.equal(dlg.modal, 'true');
    assert.ok(dlg.name.length > 0);
    assert.equal(await active(p), 'college-modal-title');
    assert.ok(new URL(p.url()).searchParams.get('college'));
    assert.equal(await p.evaluate(() => document.querySelector('main').hasAttribute('inert')), true);
    assert.equal(await p.evaluate(() => document.body.style.overflow), 'hidden');
    // Focus stays inside while tabbing
    for (let i = 0; i < 6; i++) {
      await p.keyboard.press('Tab');
      assert.ok(await p.evaluate(() => !!document.activeElement.closest('#college-modal')));
    }
    await p.keyboard.press('Escape');
    await p.waitForSelector('#college-modal:not(.open)', { state: 'attached' });
    assert.equal(await active(p), second, 'focus back on the college that opened it');
    assert.equal(await p.evaluate(() => document.body.style.overflow), '');
    assert.equal(await p.evaluate(() => document.querySelector('main').hasAttribute('inert')), false);
    assert.equal(new URL(p.url()).searchParams.get('college'), null);
    await p.context().close();
  });

  test('chart marks: Right arrow reaches a mark, its details show, Escape hides them', async () => {
    const p = await page();
    await p.focus('#chart-main .c-name[tabindex="0"]');
    const name = await active(p);
    await p.keyboard.press('ArrowRight');
    assert.match(await p.evaluate(() => document.activeElement.getAttribute('aria-label')), /unweighted GPA \d/);
    assert.equal(await p.$eval('#dot-tooltip', t => getComputedStyle(t).display), 'block');
    assert.ok((await p.textContent('#dot-tooltip')).includes('UW GPA'));
    await p.keyboard.press('Escape');
    assert.equal(await p.$eval('#dot-tooltip', t => getComputedStyle(t).display), 'none');
    assert.equal(await active(p), name);
    await p.context().close();
  });

  test('decision buttons toggle, keep focus, and list only colleges with that decision', async () => {
    const p = await page();
    const total = await p.textContent('#chart-col-count');
    await p.click('#legend [data-decision="Rejected"]');
    assert.equal(await p.getAttribute('#legend [data-decision="Rejected"]', 'aria-pressed'), 'true');
    assert.equal(await active(p), 'Rejected');
    assert.notEqual(await p.textContent('#chart-col-count'), total);
    const every = await p.$$eval('#chart-main .c-row[data-key]', rows => rows.every(r => r.querySelector('.d-Rejected')));
    assert.ok(every, 'every listed college has a rejection');
    await p.click('#legend [data-decision="Rejected"]');
    assert.equal(await p.textContent('#chart-col-count'), total);
    await p.context().close();
  });

  test('statistics tabs support arrow keys with roving focus and one visible panel', async () => {
    const p = await page();
    await p.focus('#stats-tab-destinations');
    await p.keyboard.press('ArrowRight');
    assert.equal(await active(p), 'stats-tab-grades');
    assert.equal(await p.getAttribute('#stats-tab-grades', 'aria-selected'), 'true');
    assert.equal(await p.getAttribute('#stats-tab-destinations', 'tabindex'), '-1');
    await p.keyboard.press('End');
    assert.equal(await active(p), 'stats-tab-timing');
    assert.deepEqual(await p.$$eval('.stat-panel', n => n.filter(x => !x.hidden).map(x => x.id)), ['stats-panel-timing']);
    assert.equal(new URL(p.url()).searchParams.get('stats'), 'timing');
    await p.context().close();
  });
});

describe('one set of filters for the whole page', () => {
  test('Students like me changes summary, chart, statistics and list together', async () => {
    const p = await page();
    const read = async () => ({ summary: await p.textContent('#summary'), counts: await p.$$eval('.c-count b', n => n.map(x => x.textContent).join()), stats: await statsText(p), list: await p.textContent('#entries-heading') });
    const before = await read();
    await p.fill('#slm-gpa', '3.4');
    await p.waitForSelector('.slm-chip');
    const after = await read();
    for (const k of Object.keys(before)) assert.notEqual(after[k], before[k], k + ' should follow the filter');
    const n = +(await p.textContent('#s0'));
    assert.match(await p.textContent('#slm-status'), new RegExp(`^${n} students? match`));
    assert.equal(await p.textContent('#entries-heading'), `${n} student${n === 1 ? '' : 's'} like you`);
    assert.ok(await p.$('.c-you'), 'your GPA is marked on the axis');
    // Every plotted (not faint) mark is inside the range
    const vals = await p.$$eval('#chart-main .chart-dot', d => d.map(x => +x.getAttribute('aria-label').match(/GPA ([\d.]+)/)[1]));
    assert.ok(vals.length && vals.every(v => v >= 3.1 - 1e-9 && v <= 3.7 + 1e-9), 'marks outside the range are faint context');
    // Survives a category change, and the chip removes it
    await p.click('[data-schools="UCs"]');
    assert.equal(await p.$$eval('.slm-chip', c => c.length), 1);
    await p.click('[data-schools="All"]');
    await p.click('.slm-chip');
    assert.deepEqual(await read(), before);
    assert.deepEqual(p.errors, []);
    await p.context().close();
  });

  test('out-of-range values are explained and do not filter', async () => {
    const p = await page();
    const before = await p.textContent('#summary');
    await p.fill('#slm-gpa', '4.4');
    await p.waitForFunction(() => /weighted GPA/.test(document.getElementById('slm-status').textContent));
    assert.equal(await p.getAttribute('#slm-gpa', 'aria-invalid'), 'true');
    assert.equal(await p.textContent('#summary'), before);
    await p.context().close();
  });

  test('inputs are labelled, and nothing typed there leaves the browser', async () => {
    const p = await page();
    const sent = [];
    p.on('request', r => sent.push(r.url() + (r.postData() || '')));
    for (const [id, label] of [['slm-gpa', 'Unweighted GPA'], ['slm-gpa-range', 'GPA range'], ['slm-sat', 'SAT'], ['slm-sat-range', 'SAT range'], ['slm-major', 'Major']])
      assert.equal(await p.$eval('#' + id, e => e.labels[0].textContent), label);
    await p.fill('#slm-gpa', '3.41');
    await p.fill('#slm-sat', '1234');
    await p.waitForTimeout(600);
    assert.deepEqual(sent, []);
    assert.equal(new URL(p.url()).search, '');
    await p.context().close();
  });
});

describe('counts before percentages', () => {
  test('no percentage is shown for a group smaller than five', async () => {
    const p = await page();
    await p.click('[data-stats="timing"]');
    const all = (await p.$$eval('.stat-panel', n => n.map(x => x.textContent).join('\n'))) + await p.textContent('#summary');
    const small = [...all.matchAll(/(\d+) of (\d+) \((\d+)%\)/g)].filter(m => +m[2] < 5);
    assert.deepEqual(small, []);
    await p.route('**/api/submissions', async r => {
      const all = await (await r.fetch()).json();
      await r.fulfill({ contentType: 'application/json', body: JSON.stringify([...all, { ...all[0], id: 9001, college_name: 'Tiny College', decision: 'Rejected' }, { ...all[1], id: 9002, college_name: 'Tiny College', decision: 'Accepted' }]) });
    });
    await p.goto(h.baseUrl + '/?college=Tiny%20College');
    await p.waitForSelector('#college-modal.open');
    const t = await p.textContent('#college-modal-content');
    assert.match(t, /1 of 2 admitted/);
    assert.doesNotMatch(t, /admitted \(\d+%\)/);
    assert.match(t, /too few/);
    await p.context().close();
  });
});

describe('college names', () => {
  const row = (id, name, extra) => ({ id, session_id: 's' + id, college_name: name, grad_year: 2026, gpa: 3.5, gpa_weighted: 4, decision: 'Accepted', decision_type: 'RD', school_type: 'University', ...extra });
  test('variants merge, different schools do not, "None" is not a college', async () => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' });
    await ctx.addInitScript(() => localStorage.setItem('cr_stats_disclaimer_ack', '1'));
    const p = await ctx.newPage();
    const rows = ['CSUMB', 'Cal State Monterey Bay', 'Cal state university Monterey bay', 'Arizona State', 'University of Arizona', 'San Francisco State', 'University of San Francisco', 'grand canyon university', 'None'].map((n, i) => row(i + 1, n));
    await p.route('**/api/submissions', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(rows) }));
    await p.goto(h.baseUrl + '/');
    await p.waitForSelector('#chart-main svg');
    const names = await p.$$eval('#chart-main .c-name[data-col]', n => n.map(x => x.textContent));
    assert.equal(names.length, 6, names.join(' | '));
    for (const n of ['Arizona State', 'University of Arizona', 'San Francisco State', 'University of San Francisco', 'Grand Canyon University']) assert.ok(names.includes(n), n);
    assert.ok(!names.includes('None'));
    assert.ok((await p.textContent('#entries')).includes('grand canyon university'), 'the student list keeps names as typed');
    await ctx.close();
  });
});

describe('student list', () => {
  test('pages in tens and moves focus to the first new student', async () => {
    const p = await page();
    assert.equal(await p.$$eval('.entry-card', n => n.length), 10);
    await p.click('#entries-more');
    assert.equal(await p.$$eval('.entry-card', n => n.length), 20);
    assert.equal(await p.evaluate(() => document.activeElement.dataset.entry), '10');
    await p.context().close();
  });
});

describe('first paint', () => {
  for (const [w, hgt] of [[1280, 900], [390, 844]]) test(`layout stays put while loading at ${w}px`, async () => {
    const ctx = await browser.newContext({ viewport: { width: w, height: hgt } });
    await ctx.addInitScript(() => { window.__cls = 0; new PerformanceObserver(l => l.getEntries().forEach(e => { if (!e.hadRecentInput) window.__cls += e.value; })).observe({ type: 'layout-shift', buffered: true }); });
    const p = await ctx.newPage();
    await p.goto(h.baseUrl + '/');
    await p.waitForSelector('#chart-main svg');
    await p.waitForTimeout(500);
    const cls = await p.evaluate(() => window.__cls);
    assert.ok(cls < 0.1, 'layout shift ' + cls);
    await ctx.close();
  });
  test('follows the device theme until one is chosen', async () => {
    const ctx = await browser.newContext({ colorScheme: 'dark' });
    const p = await ctx.newPage();
    await p.goto(h.baseUrl + '/');
    assert.equal(await p.getAttribute('html', 'data-theme'), 'dark');
    await p.click('#theme-toggle');
    await p.reload();
    assert.equal(await p.getAttribute('html', 'data-theme'), 'light');
    await ctx.close();
  });
});

describe('statistics notice (acknowledgement preserved)', () => {
  test('appears on reaching the statistics, ignores Escape and backdrop, Got it persists', async () => {
    const p = await page({ showNotice: true });
    await p.$eval('#stats-inline', el => el.scrollIntoView());
    await p.waitForSelector('#stats-disclaimer-modal.open');
    assert.equal(await active(p), 'sd-title');
    assert.equal(await p.$eval('#stats-disclaimer-modal .modal', m => document.getElementById(m.getAttribute('aria-labelledby')).textContent), 'A quick note on these numbers');
    await p.keyboard.press('Escape');
    assert.ok(await p.$('#stats-disclaimer-modal.open'), 'Escape must not dismiss the notice');
    await p.mouse.click(5, 5);
    assert.ok(await p.$('#stats-disclaimer-modal.open'), 'backdrop click must not dismiss the notice');
    await p.keyboard.press('Tab');
    assert.equal(await active(p), 'sd-ack');
    await p.keyboard.press('Enter');
    await p.waitForSelector('#stats-disclaimer-modal:not(.open)', { state: 'attached' });
    assert.equal(await p.evaluate(() => localStorage.getItem('cr_stats_disclaimer_ack')), '1');
    assert.equal(await active(p), 'stats-heading');
    await p.reload();
    await p.waitForSelector('#chart-main svg');
    await p.$eval('#stats-inline', el => el.scrollIntoView());
    await p.waitForTimeout(300);
    assert.equal(await p.$('#stats-disclaimer-modal.open'), null, 'acknowledged notice stays dismissed');
    await p.context().close();
  });
});

describe('scope, empty states, errors', () => {
  test('search with no match explains itself and offers a reset', async () => {
    const p = await page();
    await p.fill('#college-search', 'zz-no-such-college');
    await p.waitForSelector('#chart-main .chart-empty');
    assert.match(await p.textContent('#chart-main .chart-empty p'), /No colleges match “zz-no-such-college”/);
    await p.waitForTimeout(600);
    assert.match(await p.textContent('#chart-status'), /No colleges match/);
    await p.click('[data-action="clear-search"]');
    await p.waitForSelector('#chart-main svg');
    assert.equal(await active(p), 'college-search');
    await p.context().close();
  });

  test('an empty category is distinguished from an empty site', async () => {
    const p = await page();
    await p.click('[data-schools="Ivies"]');
    assert.match(await p.textContent('#chart-main .chart-empty p'), /No submissions in the Ivies category yet/);
    assert.match(await p.textContent('#entries'), /No Ivies submissions yet/);
    await p.click('#entries [data-action="schools-all"]');
    assert.equal(await p.getAttribute('[data-schools="All"]', 'aria-pressed'), 'true');
    await p.context().close();
  });

  test('request failure, retry with filters kept, malformed response, stale data', async () => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' });
    await ctx.addInitScript(() => localStorage.setItem('cr_stats_disclaimer_ack', '1'));
    const p = await ctx.newPage();
    let mode = 'fail';
    await p.route('**/api/submissions', route => mode === 'fail'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"SQLITE_BUSY: internal detail"}' })
      : mode === 'garbage' ? route.fulfill({ status: 200, contentType: 'text/html', body: '<html>proxy error</html>' })
      : route.continue());
    await p.goto(h.baseUrl + '/?schools=UCs&q=davis');
    await p.waitForSelector('.load-error');
    const msg = await p.textContent('.load-error');
    assert.match(msg, /Couldn't load results\. The server returned an error \(500\)/);
    assert.ok(!msg.includes('SQLITE'), 'no internal error details shown');
    assert.equal(await p.getAttribute('.load-error', 'role'), 'alert');
    mode = 'ok';
    await p.click('[data-action="retry-load"]');
    await p.waitForSelector('#chart-main svg');
    assert.equal(await p.$('.load-error'), null);
    assert.equal(await p.inputValue('#college-search'), 'davis');
    assert.equal(await p.getAttribute('[data-schools="UCs"]', 'aria-pressed'), 'true');
    // Later refresh fails: keep what's on screen, say it's not fresh.
    mode = 'garbage';
    await p.click('#nav-submit');
    await p.waitForSelector('#page-submit.active');
    await p.click('#nav-results');
    await p.waitForSelector('.load-error');
    assert.match(await p.textContent('.load-error'), /Couldn't refresh results\. The server sent a response this page could not read\. Still showing results loaded at/);
    assert.ok(await p.$('#chart-main svg'), 'previous chart still shown');
    await ctx.close();
  });

  test('statistics say what they are based on', async () => {
    const p = await page();
    assert.match(await p.textContent('#stats-scope-note'), /^Based on \d+ students and \d+ decisions\. Percentages appear only for groups of 5 or more\.$/);
    await p.fill('#slm-gpa', '3.4');
    await p.waitForSelector('.slm-chip');
    assert.match(await p.textContent('#stats-scope-note'), /matching GPA 3\.10 to 3\.70/);
    await p.context().close();
  });
});

describe('safe rendering', () => {
  const INERT = `<img src=x onerror="window.__pwned=1">`;
  const rows = [
    { id: 1, session_id: 'g1', college_name: `Evil ${INERT} College`, grad_year: 2026, gpa: 3.5, gpa_weighted: 4.0, sat: 1300, major: `Art"><script>window.__pwned=2</script>`, decision: 'Accepted', decision_type: `RD<b>x</b>`, school_type: 'University' },
    { id: 2, session_id: 'g2', college_name: `Evil ${INERT} College`, grad_year: 2026, gpa: 3.1, gpa_weighted: 3.6, sat: null, major: "Women's & Gender Studies", decision: 'Rejected', decision_type: 'RD', school_type: 'University' },
    { id: 3, session_id: 'g1', college_name: `O'Brien & "Quotes" <Univ>`, grad_year: 2026, gpa: 3.5, gpa_weighted: 4.0, sat: 1300, major: `Art"><script>window.__pwned=2</script>`, decision: 'Waitlisted', decision_type: 'EA', school_type: 'University' },
    { id: 4, session_id: 'g2', college_name: `O'Brien & "Quotes" <Univ>`, grad_year: 2026, gpa: 3.1, gpa_weighted: 3.6, sat: null, major: "Women's & Gender Studies", decision: 'Accepted', decision_type: 'RD', school_type: 'University' },
  ];
  test('injection-like API strings render as literal text everywhere', async () => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' });
    await ctx.addInitScript(() => localStorage.setItem('cr_stats_disclaimer_ack', '1'));
    const p = await ctx.newPage();
    await p.route('**/api/submissions', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) }));
    await p.goto(h.baseUrl + '/');
    await p.waitForSelector('#chart-main svg');
    // entries, stats, chart label, tooltip, college details, compare
    assert.ok((await p.textContent('#entries')).includes(`Evil ${INERT} College`));
    assert.ok((await p.textContent('#entries')).includes(`Art"><script>window.__pwned=2</script>`));
    assert.ok((await p.textContent('#stats-inline')).includes(`O'Brien & "Quotes" <Univ>`));
    await p.fill('#slm-gpa', '3.5'); await p.waitForSelector('.slm-chip'); await p.click('.slm-chip');
    await p.click('#chart-main .chart-dot');
    assert.ok((await p.textContent('#dot-tooltip')).includes(`Evil ${INERT} College`) || (await p.textContent('#dot-tooltip')).includes(`O'Brien`));
    await p.keyboard.press('Escape');
    await p.click('#chart-main .c-name[data-col]');
    await p.waitForSelector('#college-modal.open');
    const title = await p.textContent('#college-modal-title');
    assert.ok(title.includes('<'), 'heading shows the literal text');
    await p.keyboard.press('Escape');
    await p.click('#compare-open');
    const opts = await p.$$eval('#cmp-a option', o => o.map(x => x.textContent));
    assert.ok(opts.includes(`O'Brien & "Quotes" <Univ>`));
    assert.ok((await p.textContent('#cmp-result')).includes(`Evil ${INERT} College`));
    // Nothing executed, no element was injected
    assert.equal(await p.evaluate(() => window.__pwned), undefined);
    assert.equal(await p.$$eval('img[src="x"]', n => n.length), 0);
    assert.equal(await p.$$eval('script', n => n.filter(x => /__pwned/.test(x.textContent)).length), 0);
    await p.keyboard.press('Escape');
    // Search text and URL college value are shown literally too
    await p.fill('#college-search', '<i>nothing</i>');
    assert.ok((await p.textContent('#chart-main .chart-empty p')).includes('<i>nothing</i>'));
    assert.equal(await p.$$eval('#chart-main i', n => n.length), 0);
    await ctx.close();
  });
});

describe('layout', () => {
  for (const width of [320, 390, 768, 1280]) {
    test(`no page-level horizontal overflow at ${width}px, comparison of three long names fits`, async () => {
      const p = await page({ viewport: { width, height: 800 } });
      const overflow = () => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.equal(await overflow(), 0, 'results page overflows');
      await p.click('#compare-open');
      await p.selectOption('#cmp-a', LONG_NAME);
      await p.selectOption('#cmp-b', "Saint Mary's College of California");
      await p.selectOption('#cmp-c', 'Texas A&M');
      const cols = await p.$$eval('#cmp-result .cmp-col', c => c.length);
      assert.equal(cols, 3);
      const fit = await p.evaluate(() => {
        const m = document.querySelector('#compare-modal .modal');
        return { scroll: m.scrollWidth, client: m.clientWidth, cols: [...m.querySelectorAll('.cmp-col')].map(c => c.getBoundingClientRect().right <= m.getBoundingClientRect().right + 0.5) };
      });
      assert.ok(fit.scroll <= fit.client, `dialog content ${fit.scroll}px wider than dialog ${fit.client}px`);
      assert.ok(fit.cols.every(Boolean), 'a college column extends past the dialog');
      assert.equal(await overflow(), 0, 'page overflows with comparison open');
      const close = await p.$eval('#compare-modal .modal-close', b => { const r = b.getBoundingClientRect(); return r.width >= 44 && r.height >= 44 && r.right <= innerWidth; });
      assert.ok(close, 'close button reachable and at least 44px');
      fs.mkdirSync(path.join(__dirname, 'screenshots'), { recursive: true });
      await p.screenshot({ path: path.join(__dirname, 'screenshots', `compare-${width}.png`) });
      await p.context().close();
    });
  }

  test('reflow at 640 and 320 CSS px (approximates 200%/400% zoom of a 1280px window; not real zoom)', async () => {
    for (const w of [640, 320]) {
      const p = await page({ viewport: { width: w, height: Math.round(900 * w / 1280) } });
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, `overflow at ${w}`);
      // A 1280×900 window at 200%/400% is under 500px tall: the filter bar scrolls away instead of covering it.
      assert.equal(await p.$eval('#filters', n => getComputedStyle(n).position), 'static');
      await p.context().close();
    }
  });

  test('reduced motion turns off decorative animation', async () => {
    const p = await page({ reducedMotion: 'reduce', path: '/' });
    const anim = await p.evaluate(() => ['.modal', '#chat-panel'].map(s => getComputedStyle(document.querySelector(s)).animationName));
    assert.deepEqual(anim, ['none', 'none']);
    await p.click('[data-metric="gpa"]');
    assert.equal(await p.evaluate(() => document.getAnimations().filter(a => a.effect.getTiming().duration > 1).length), 0, 'chart does not animate');
    await p.context().close();
  });
});

describe('question panel', () => {
  test('labelled, explains where messages go, keyboard open/close, unchanged payload', async () => {
    const p = await page();
    let sent = null;
    await p.route('**/api/questions', r => { sent = r.request().postDataJSON(); r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"id":1}' }); });
    await p.focus('#chat-fab');
    await p.keyboard.press('Enter');
    assert.equal(await p.getAttribute('#chat-fab', 'aria-expanded'), 'true');
    assert.equal(await active(p), 'chat-input');
    assert.equal(await p.$eval('#chat-input', i => i.labels[0].textContent), 'Your question');
    assert.match(await p.textContent('#chat-msgs'), /people who run this site.*no reply/s);
    await p.keyboard.type('Synthetic test question');
    await p.keyboard.press('Enter');
    await p.waitForSelector('.chat-msg-bot:nth-child(3)');
    assert.deepEqual(sent, { question: 'Synthetic test question' });
    assert.match(await p.textContent('#chat-msgs'), /Sent\. The site admins will see your question/);
    await p.keyboard.press('Escape');
    assert.equal(await p.getAttribute('#chat-fab', 'aria-expanded'), 'false');
    assert.equal(await active(p), 'chat-fab');
    await p.context().close();
  });
});

describe('URL state and Back/Forward', () => {
  test('category and college views are shareable and Back/Forward restore them', async () => {
    const p = await page();
    await p.click('[data-schools="UCs"]');
    await p.click('[data-schools="CSUs"]');
    assert.equal(new URL(p.url()).searchParams.get('schools'), 'CSUs');
    await p.goBack();
    await p.waitForFunction(() => document.querySelector('[data-schools="UCs"]').getAttribute('aria-pressed') === 'true');
    await p.goForward();
    await p.waitForFunction(() => document.querySelector('[data-schools="CSUs"]').getAttribute('aria-pressed') === 'true');
    // Leaving an empty category with Back must restore the previous one
    // (Trade has no submissions in the synthetic data).
    await p.click('[data-schools="UCs"]');
    await p.click('[data-schools="Trade"]');
    assert.match(await p.textContent('#chart-main .chart-empty p'), /No submissions in the Trade category/);
    await p.goBack();
    await p.waitForFunction(() => document.querySelector('[data-schools="UCs"]').getAttribute('aria-pressed') === 'true');
    assert.equal(new URL(p.url()).searchParams.get('schools'), 'UCs');
    assert.equal(await p.getAttribute('[data-schools="Trade"]', 'aria-pressed'), 'false');
    assert.ok(await p.$('#chart-main svg'), 'UC chart shown again');
    assert.equal(await p.textContent('#stats-heading'), 'Statistics: UCs');
    assert.equal(await p.textContent('#page-meta'), 'Class of 2026, UCs');
    const p2 = await page({ path: '/?college=UC%20Davis' });
    await p2.waitForSelector('#college-modal.open');
    assert.equal(await p2.textContent('#college-modal-title'), 'UC Davis');
    await p.context().close();
    await p2.context().close();
  });
});

describe('restored public fields (operator decision 2026-10-17)', () => {
  test('cards and dot details show exact rank, first-gen, recruited and extracurriculars', async () => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' });
    await ctx.addInitScript(() => localStorage.setItem('cr_stats_disclaimer_ack', '1'));
    const p = await ctx.newPage();
    const row = { id: 1, session_id: 'g1', college_name: 'Synthetic State', grad_year: 2026, gpa: 3.5, gpa_weighted: 4.0,
      class_rank: '12', major: 'Biology', decision: 'Accepted', decision_type: 'RD', school_type: 'University',
      first_gen: 'yes', sport: 'yes', extracurriculars: 'Synthetic robotics club <b>lead</b>\nChoir' };
    await p.route('**/api/submissions', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([row]) }));
    await p.goto(h.baseUrl + '/');
    await p.waitForSelector('#chart-main svg');
    const card = await p.textContent('#entries');
    assert.ok(card.includes('Rank 12'));
    assert.ok(card.includes('First-gen'));
    assert.ok(card.includes('Recruited'));
    assert.ok(card.includes('Synthetic robotics club <b>lead</b>'), 'EC text shown literally');
    assert.ok(!(await p.$$eval('#entries b', n => n.map(x => x.textContent))).includes('lead'), 'no markup created from student text');
    assert.match(await p.$eval('.entry-ecs p', e => e.innerText), /lead<\/b>\nChoir/, 'line break kept');
    await p.click('#chart-main .chart-dot');
    const tip = await p.textContent('#dot-tooltip');
    for (const t of ['Rank 12', 'First-generation student', 'Recruited', 'Extracurriculars']) assert.ok(tip.includes(t), t);
    await ctx.close();
  });
});
