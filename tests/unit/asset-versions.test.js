/** index.html must link the current content of its scripts and styles. */
const fs = require('fs');
const path = require('path');
const { stamp, ROOT } = require('../helpers/stamp-assets');

test('asset versions in index.html match the files', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  expect(stamp(html)).toBe(html);
});
test('the preloaded font is the one fonts.css uses', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const file = html.match(/rel="preload" href="\/fonts\/([^"]+)"/)[1];
  expect(fs.existsSync(path.join(ROOT, 'fonts', file))).toBe(true);
  expect(fs.readFileSync(path.join(ROOT, 'fonts/fonts.css'), 'utf8')).toContain(`url(${file})`);
});
