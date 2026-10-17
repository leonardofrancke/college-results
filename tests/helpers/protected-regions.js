// Extracts the parts of the app that student submissions depend on, so a test
// can prove they are byte-for-byte unchanged by presentation work elsewhere.
// The baseline in fixtures/protected-baseline.json was generated from commit
// 919242b (the version the 2026-10-16 readiness audit inspected).
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

function indexRegions(html) {
  const out = {};
  out['markup:#page-submit'] = between(html, '<!-- ── SUBMIT PAGE ── -->', '</div><!-- .content -->');
  out['markup:#celebration-overlay'] = between(html, '<!-- Celebration overlay -->', '</body>');
  out['css:submission-form-rules'] = html.split('\n').filter(l => FORM_CSS.test(l)).join('\n');
  out['js:session-id'] = between(html, 'const SESSION_ID', '// ── State');
  out['js:page-view-track-call'] = html.split('\n').filter(l => l.includes("fetch('/api/track'")).join('\n');
  PROTECTED_FUNCTIONS.forEach(n => { out[`js:${n}`] = fnSource(html, n); });
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
  const html = fs.readFileSync(path.join(root, 'html/index.html'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'api/server.js'), 'utf8');
  const regions = { ...indexRegions(html), ...serverRegions(server) };
  return Object.fromEntries(Object.entries(regions).map(([k, v]) => [k, sha(v)]));
}

module.exports = { hashAll, indexRegions, serverRegions, fnSource };

if (require.main === module && process.argv.includes('--write')) {
  const root = path.resolve(__dirname, '../..');
  const file = path.join(__dirname, '../fixtures/protected-baseline.json');
  fs.writeFileSync(file, JSON.stringify(hashAll(root), null, 2) + '\n');
  console.log('wrote', file);
}
