// The submission form was deliberately left untouched. These tests drive it
// the way a student would and capture the requests it makes (mocked, so no
// record is written anywhere), proving the save/load/delete contract is the
// same as the audited version: same endpoints, methods, payload shape and
// values, same storage keys.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { start } = require('./harness');

const SID = 'synthetic-compat-0001';
let h, browser;
before(async () => { h = await start(); browser = await chromium.launch({ channel: 'chrome', headless: true }); });
after(async () => { await browser?.close(); await h?.stop(); });

// Captured from the audited version (commit 919242b) with the same steps,
// plus the extracurriculars field restored on 2026-10-17 (same position as before Sep 28).
const EXPECTED_ROW = {
  gpa: 3.6, grad_year: 2026, gpa_weighted: 4.1, sat: 1250, act: null, class_rank: 40,
  major: 'Biology', extracurriculars: 'Synthetic robotics club\nChoir', sport: null, first_gen: 'yes', essay_rating: '3',
};
const EXPECTED_COLLEGES = [
  { decision_type: 'RD', school_type: 'University', enrolling: 'yes', scholarship: null, college_name: 'UC Davis', decision: 'Accepted' },
  { decision_type: 'EA', school_type: 'Community', enrolling: null, scholarship: 'yes', college_name: 'Gavilan', decision: 'Rejected' },
];

async function driveForm(p) {
  await p.fill('#f-gpa', '3.6');
  await p.fill('#f-gpa-w', '4.1');
  await p.fill('#f-sat', '1250');
  await p.fill('#f-rank', '40');
  await p.selectOption('#f-essay', '3');
  await p.fill('#f-major', 'Biology');
  // The suggestion list stays over the next field until 350ms after blur
  // (existing behaviour, listed as deferred), so leave the field like a user would.
  await p.keyboard.press('Tab'); await p.waitForTimeout(400);
  await p.fill('#f-ecs', 'Synthetic robotics club\nChoir');
  await p.check('#f-first-gen');
  await p.fill('#cn-0', 'UC Davis');
  await p.keyboard.press('Tab'); await p.waitForTimeout(400);
  await p.check('#en-0');
  await p.click('.add-college-btn');
  await p.fill('#cn-1', 'Gavilan');
  await p.keyboard.press('Tab'); await p.waitForTimeout(400);
  await p.selectOption('#cd-1', 'Rejected');
  await p.selectOption('#cat-1', 'EA');
  await p.selectOption('#st-1', 'Community');
  await p.check('#sc-1');
  await p.check('#f-consent');
  await p.click('#submit-btn');
}

test('submit payload, endpoints and storage keys are unchanged', async () => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  await ctx.addInitScript(sid => { if (!localStorage.getItem('cr_sid')) localStorage.setItem('cr_sid', sid); }, SID);
  const p = await ctx.newPage();
  const seen = [];
  let posted = null, stored = [];
  await p.route(`**/api/submissions/${SID}`, r => {
    seen.push(r.request().method() + ' /api/submissions/:sid');
    if (r.request().method() === 'DELETE') { stored = []; return r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"deleted":2}' }); }
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stored) });
  });
  await p.route('**/api/submissions', r => {
    if (r.request().method() !== 'POST') return r.continue();
    seen.push('POST /api/submissions');
    posted = r.request().postDataJSON();
    stored = posted.colleges.map((c, i) => ({ id: i + 1, ...c }));
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, inserted: posted.colleges.length }) });
  });

  await p.goto(h.baseUrl + '/?page=submit');
  await p.waitForSelector('#cn-0');
  assert.equal(await p.textContent('#submit-btn'), 'Submit');
  await driveForm(p);
  await p.waitForFunction(() => localStorage.getItem('cr_submitted') === '1');

  assert.equal(posted.session_id, SID);
  assert.deepEqual(Object.keys(posted), ['session_id', 'colleges']);
  assert.equal(posted.colleges.length, 2);
  posted.colleges.forEach((row, i) => {
    assert.deepEqual(Object.keys(row), ['gpa', 'grad_year', 'gpa_weighted', 'sat', 'act', 'class_rank', 'major', 'extracurriculars', 'sport',
      'first_gen', 'essay_rating', 'decision_type', 'school_type', 'enrolling', 'scholarship', 'college_name', 'decision', 'session_id']);
    assert.deepEqual(row, { ...EXPECTED_ROW, ...EXPECTED_COLLEGES[i], session_id: SID });
  });

  // Back on Edit: the stored record is loaded into the form, then deleted.
  await p.waitForSelector('#page-results.active');
  assert.equal(await p.textContent('#nav-submit'), 'Edit Submission');
  await p.click('#nav-submit');
  await p.waitForFunction(() => document.getElementById('submit-btn').textContent === 'Update Submission');
  assert.equal(await p.inputValue('#cn-1'), 'Gavilan');
  assert.equal(await p.inputValue('#f-ecs'), 'Synthetic robotics club\nChoir', 'saved ECs load back into the form');
  p.once('dialog', d => d.accept());
  await p.click('.delete-btn');
  await p.waitForFunction(() => localStorage.getItem('cr_submitted') === null);
  assert.ok(seen.includes('GET /api/submissions/:sid'));
  assert.ok(seen.includes('DELETE /api/submissions/:sid'));
  // Only the existing keys: the browser ID stays, the submitted flag is cleared.
  assert.deepEqual((await p.evaluate(() => Object.keys(localStorage))).filter(k => k.startsWith('cr_')).sort(), ['cr_sid']);
  assert.equal(await p.evaluate(() => localStorage.getItem('cr_sid')), SID, 'browser ID untouched');
  await ctx.close();
});

test('empty-form validation path is unchanged (no request is sent)', async () => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  let posts = 0;
  await p.route('**/api/submissions', r => { if (r.request().method() === 'POST') posts++; r.continue(); });
  await p.goto(h.baseUrl + '/?page=submit');
  await p.waitForSelector('#cn-0');
  let alertText = null;
  p.once('dialog', d => { alertText = d.message(); d.dismiss(); });
  await p.click('#submit-btn');
  await p.waitForTimeout(200);
  assert.equal(alertText, 'Unweighted GPA, weighted GPA, and graduation year are required.');
  assert.equal(posts, 0);
  await ctx.close();
});

module.exports = { driveForm, EXPECTED_ROW, EXPECTED_COLLEGES };
