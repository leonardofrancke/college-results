// Routing through the real nginx.conf (rate limits left on): crawl files are
// real files, unknown paths are real 404s, app URLs and the API are unchanged.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./harness');

let h;
before(async () => { h = await start({ rateLimits: true }); });
after(async () => { await h?.stop(); });
const get = (p, init) => fetch(h.baseUrl + p, init);

test('robots.txt and sitemap.xml are the real files, not the app', async () => {
  const home = await (await get('/')).text();
  const robots = await get('/robots.txt');
  assert.equal(robots.status, 200);
  assert.match(robots.headers.get('content-type'), /^text\/plain/);
  const rt = await robots.text();
  assert.notEqual(rt, home);
  assert.match(rt, /^User-agent: \*$/m);
  assert.match(rt, /^Allow: \/$/m, 'existing allow-all crawl policy preserved');
  const sm = await get('/sitemap.xml');
  assert.equal(sm.status, 200);
  assert.match(sm.headers.get('content-type'), /xml/);
  const xml = await sm.text();
  assert.match(xml, /<urlset/);
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  assert.ok(locs.length >= 5);
  assert.ok(locs.every(l => !/admin|draft|demo|\?/.test(l)), 'no admin, draft or filtered views in the sitemap');
});

test('unknown paths are 404 with a small page, never the app', async () => {
  for (const p of ['/admin', '/results', '/nope/deeper', '/fonts/', '/index.htm']) {
    const r = await get(p);
    assert.equal(r.status, 404, p);
    const body = await r.text();
    assert.match(body, /Page not found/, p);
    assert.doesNotMatch(body, /id="page-results"/, p);
  }
});

test('app URLs, query views, pages and assets still load', async () => {
  for (const p of ['/', '/?page=submit', '/?schools=UCs&chart=sat&q=davis&min=2&decision=Accepted&college=UC%20Davis', '/index.html',
                   '/privacy.html', '/about.html', '/methodology.html', '/accessibility.html', '/terms-draft.html', '/admin.html', '/info.css', '/fonts/fonts.css']) {
    assert.equal((await get(p)).status, 200, p);
  }
});

test('security headers kept everywhere; cache and robots headers by response class', async () => {
  for (const p of ['/', '/robots.txt', '/nope', '/api/submissions', '/fonts/inter-latin-bec94a4d.woff2']) {
    const r = await get(p);
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/, p);
    assert.equal(r.headers.get('x-frame-options'), 'DENY', p);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff', p);
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer', p);
  }
  assert.equal((await get('/')).headers.get('cache-control'), 'no-cache');
  assert.equal((await get('/fonts/inter-latin-bec94a4d.woff2')).headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal((await get('/api/submissions')).headers.get('cache-control'), null, 'API caching left unchanged');
  assert.equal((await get('/terms-draft.html')).headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal((await get('/admin.html')).headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal((await get('/')).headers.get('x-robots-tag'), null, 'results page indexing policy unchanged');
});

test('submission API requests pass through unchanged', async () => {
  const sid = 'synthetic-routing-check';
  const post = await get('/api/submissions', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sid, colleges: [{ college_name: 'UC Davis', grad_year: 2026, gpa: 3.2, gpa_weighted: 3.8, decision: 'Accepted' }] }) });
  assert.equal(post.status, 200);
  assert.deepEqual(await post.json(), { success: true, inserted: 1 });
  const own = await (await get('/api/submissions/' + sid)).json();
  assert.equal(own.length, 1);
  const del = await get('/api/submissions/' + sid, { method: 'DELETE' });
  assert.deepEqual(await del.json(), { success: true, deleted: 1 });
  const missing = await get('/api/no-such-route');
  assert.equal(missing.status, 404);
  assert.doesNotMatch(await missing.text(), /Page not found/, 'API 404s are the API\'s own, not the static 404 page');
});
