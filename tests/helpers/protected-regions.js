// Extracts the parts of the app that student submissions depend on, so a test
// can prove they are byte-for-byte unchanged by presentation work elsewhere.
// The page is index.html (markup), app.js and app.css. The baseline in
// fixtures/protected-baseline.json was regenerated on 2026-11-25 for the
// redesign: the form's markup and styles and addCollege()'s labels changed on
// purpose; every other protected function is identical to commit 48811be.
//
// If one of these regions has to change on purpose, regenerate the baseline
// with `node tests/helpers/protected-regions.js --write` in the same commit and
// say why in the commit message.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const sha = s => crypto.createHash('sha256').update(s).digest('hex');

// Source of a top-level `function name(...) { ... }` (or `async function`),
// found by brace counting from the first `{` after the signature.
function fnSource(src, name) {
  const re = new RegExp(`(^|\\n)((async )?function ${name}\\()`);
  const m = re.exec(src);
  if (!m) throw new Error(`function ${name} not found`);
  const start = m.index + m[1].length;
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`function ${name} not closed`);
}

function between(src, startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  if (a < 0) throw new Error(`marker not found: ${startMarker}`);
  const b = src.indexOf(endMarker, a + startMarker.length);
  if (b < 0) throw new Error(`marker not found: ${endMarker}`);
  return src.slice(a, b);
}

// Functions on the submission/edit/delete path, plus analytics.
const PROTECTED_FUNCTIONS = [
  'getKnownColleges', 'addCollege', 'removeCollege', 'showSuggestions',
  'selectSuggestion', 'hideSuggestions', 'showMajorSuggestions',
  'hideMajorSuggestions', 'loadExistingSubmission', 'submitForm',
  'deleteSubmission', 'trackEvent', 'showCelebration',
];

// Any style rule naming one of these classes styles the submission form.
const FORM_CSS = /\.(form-|college-row|add-college|delete-|privacy-note|sug-|anon-note|success-msg|req\b|major-wrap|cel-)|#celebration/;

function indexRegions(html, js, css) {
  const out = {};
  out['markup:#page-submit'] = between(html, '<!-- ── SUBMIT PAGE ── -->', '</div><!-- .content -->');
  out['markup:#celebration-overlay'] = between(html, '<!-- Celebration overlay -->', '</body>');
  out['css:submission-form-rules'] = css.split('\n').filter(l => FORM_CSS.test(l)).join('\n');
  out['js:session-id'] = between(js, 'const SESSION_ID', '// ── Chart metrics');
  out['js:page-view-track-call'] = js.split('\n').filter(l => l.includes("fetch('/api/track'")).join('\n');
  PROTECTED_FUNCTIONS.forEach(n => { out[`js:${n}`] = fnSource(js, n); });
  return out;
}

function serverRegions(js) {
  return {
    'server:submission-and-tracking-routes': between(js, '// ── Public: submissions', '// ── Public: submit chatbot question'),
    'server:question-route': between(js, '// ── Public: submit chatbot question', 'const safeEqual'),
    'server:input-cleaning': between(js, 'const cleanText', '// ── App factory'),
  };
}

function hashAll(root) {
  const read = f => fs.readFileSync(path.join(root, f), 'utf8');
  const regions = { ...indexRegions(read('html/index.html'), read('html/app.js'), read('html/app.css')), ...serverRegions(read('api/server.js')) };
  return Object.fromEntries(Object.entries(regions).map(([k, v]) => [k, sha(v)]));
}

module.exports = { hashAll, indexRegions, serverRegions, fnSource };

if (require.main === module && process.argv.includes('--write')) {
  const root = path.resolve(__dirname, '../..');
  const file = path.join(__dirname, '../fixtures/protected-baseline.json');
  fs.writeFileSync(file, JSON.stringify(hashAll(root), null, 2) + '\n');
  console.log('wrote', file);
}
