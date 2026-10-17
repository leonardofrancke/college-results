// Automated axe-core scan of the results view and info pages, light and dark.
// A pass here is necessary, not sufficient: see the manual checks in the
// accessibility verification report.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { chromium } = require('playwright-core');
const { start } = require('./harness');

const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
let h, browser;
before(async () => { h = await start(); browser = await chromium.launch({ channel: 'chrome', headless: true }); });
after(async () => { await browser?.close(); await h?.stop(); });

async function scan(p, include) {
  await p.addScriptTag({ content: AXE });
  return p.evaluate(async inc => {
    const r = await axe.run(inc ? { include: inc } : document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
    return r.violations.map(v => `${v.id}: ${v.nodes.length} × ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`);
  }, include);
}

for (const theme of ['light', 'dark']) {
  test(`results view (${theme}): no axe violations`, async () => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(t => { localStorage.setItem('cr_stats_disclaimer_ack', '1'); localStorage.setItem('cr_theme', t); }, theme);
    const p = await ctx.newPage();
    await p.goto(h.baseUrl + '/?schools=All');
    await p.waitForSelector('#chart-main svg');
    // The submission view is hidden here and is out of scope (unchanged).
    const v = [...await scan(p, [['nav'], ['#page-results'], ['footer']])];
    await p.click('#chart-main text[data-col]');
    await p.waitForSelector('#college-modal.open');
    v.push(...await scan(p, [['#college-modal']]));
    await p.keyboard.press('Escape');
    await p.click('#compare-open');
    await p.selectOption('#cmp-c', { index: 3 });
    v.push(...await scan(p, [['#compare-modal']]));
    await p.keyboard.press('Escape');
    await p.click('#chat-fab');
    v.push(...await scan(p, [['#chat-panel']]));
    assert.deepEqual(v, []);
    await ctx.close();
  });
}

test('info pages: no axe violations', async () => {
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ colorScheme: scheme });
    const p = await ctx.newPage();
    for (const path of ['/about.html', '/methodology.html', '/accessibility.html', '/terms-draft.html', '/nope']) {
      await p.goto(h.baseUrl + path);
      assert.deepEqual(await scan(p), [], `${path} (${scheme})`);
    }
    await ctx.close();
  }
});
