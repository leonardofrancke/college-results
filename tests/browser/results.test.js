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
    const p = await page({ path: '/?schools=CSUs&chart=sat&q=state&min=2&decision=Accepted' });
    await p.click('#slm-tab-gpa');
    await p.fill('#slm-gpa', '3.4');
    await p.click('[data-slm-apply="gpa"]');
    const snap = async () => ({
      url: new URL(p.url()).search,
      pressed: await p.$eval('[data-schools][aria-pressed="true"]', b => b.dataset.schools),
      metric: await p.$eval('[data-metric][aria-pressed="true"]', b => b.dataset.metric),
      search: await p.inputValue('#college-search'),
      min: await p.inputValue('#minsub-slider'),
      legend: await p.$$eval('#legend [aria-pressed="true"]', b => b.map(x => x.dataset.decision)),
      chips: await p.$$eval('.slm-chip', c => c.map(x => x.textContent)),
      cols: await p.$$eval('#chart-main text[data-col]', t => t.map(x => x.textContent)),
      stats: await statsText(p),
      entries: await p.$eval('#entries', e => e.innerText),
    });
    const before = await snap();
    assert.equal(before.pressed, 'CSUs');
    assert.equal(before.metric, 'sat');
    assert.equal(before.min, '2');
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
    assert.equal(await p.$$eval('h1', h => h.length), 1);
    assert.equal(await p.textContent('h1'), 'College Results');
    await p.focus('#nav-submit');
    await p.keyboard.press('Enter');
    await p.waitForSelector('#page-submit.active');
    assert.equal(await p.getAttribute('#nav-submit', 'aria-current'), 'page');
    assert.equal(new URL(p.url()).search, '?page=submit');
    assert.equal(await active(p), 'main-content');
    assert.ok(await p.$eval('#page-results', el => getComputedStyle(el).display === 'none'), 'inactive view hidden');
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
    await p.focus('#chart-main text[tabindex="0"]');
    const first = await active(p);
    await p.keyboard.press('ArrowRight');
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

  test('chart dots: Down arrow reaches a dot, its details show, Escape hides them', async () => {
    const p = await page();
    await p.focus('#chart-main text[tabindex="0"]');
    await p.keyboard.press('ArrowDown');
    assert.match(await p.evaluate(() => document.activeElement.getAttribute('aria-label')), /weighted GPA \d/);
    assert.equal(await p.$eval('#dot-tooltip', t => getComputedStyle(t).display), 'block');
    assert.ok((await p.textContent('#dot-tooltip')).includes('UW GPA'));
    await p.keyboard.press('Escape');
    assert.equal(await p.$eval('#dot-tooltip', t => getComputedStyle(t).display), 'none');
    assert.match(await active(p), /^col-lbl-/);
    await p.context().close();
  });

  test('legend items are toggle buttons; slider has a name and readable value', async () => {
    const p = await page();
    await p.click('#legend [data-decision="Rejected"]');
    assert.equal(await p.getAttribute('#legend [data-decision="Rejected"]', 'aria-pressed'), 'true');
    assert.equal(await active(p), 'Rejected');
    assert.equal(await p.$eval('#minsub-slider', s => s.labels[0].textContent), 'Min. submissions');
    await p.focus('#minsub-slider');
    await p.keyboard.press('ArrowRight');
    await p.waitForTimeout(50);
    const vt = await p.getAttribute('#minsub-slider', 'aria-valuetext');
    assert.match(vt, /^At least \d submissions? per college$/);
    await p.context().close();
  });

  test('Students-like-me tabs support arrow keys with roving focus', async () => {
    const p = await page();
    await p.focus('#slm-tab-gpa');
    await p.keyboard.press('ArrowRight');
    assert.equal(await active(p), 'slm-tab-sat');
    assert.equal(await p.getAttribute('#slm-tab-sat', 'aria-selected'), 'true');
    assert.equal(await p.getAttribute('#slm-tab-gpa', 'tabindex'), '-1');
    await p.keyboard.press('End');
    assert.equal(await active(p), 'slm-tab-major');
    assert.equal(await p.isVisible('#slm-sec-major'), true);
    await p.context().close();
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
    assert.match(await p.textContent('#chart-active'), /Chart filters on: search/);
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

  test('scope notes say what each control filters', async () => {
    const p = await page();
    assert.match(await p.textContent('#minsub-note'), /not a privacy protection/);
    assert.match(await p.textContent('#chart-scope-note'), /statistics below aren't filtered/);
    assert.match(await p.textContent('.slm-scope'), /statistics below still describe everyone/);
    assert.match(await p.textContent('#stats-scope-note'), /don't change these numbers/);
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
    await p.click('#chart-main .chart-dot');
    assert.ok((await p.textContent('#dot-tooltip')).includes(`Evil ${INERT} College`) || (await p.textContent('#dot-tooltip')).includes(`O'Brien`));
    await p.keyboard.press('Escape');
    await p.click('#chart-main text[data-col]');
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
    assert.equal(await p.$$eval('img[src="x"], b', n => n.length), 0);
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
      // A 1280×900 window at 200%/400% is under 500px tall: the nav scrolls away instead of covering it.
      assert.equal(await p.$eval('nav', n => getComputedStyle(n).position), 'static');
      await p.context().close();
    }
  });

  test('reduced motion turns off decorative animation', async () => {
    const p = await page({ reducedMotion: 'reduce', path: '/?min=1' });
    const anim = await p.evaluate(() => ['.scroll-chev', '.modal', '#chat-panel'].map(s => getComputedStyle(document.querySelector(s)).animationName));
    assert.deepEqual(anim, ['none', 'none', 'none']);
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
    assert.match(await p.textContent('#page-meta'), /· UCs$/);
    const p2 = await page({ path: '/?college=UC%20Davis' });
    await p2.waitForSelector('#college-modal.open');
    assert.equal(await p2.textContent('#college-modal-title'), 'UC Davis');
    await p.context().close();
    await p2.context().close();
  });
});
