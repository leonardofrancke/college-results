// index.html links app.css, app.js and boot.js with ?v=<content hash>, so a
// deploy can never pair new HTML with an old cached script. After editing any
// of them: node tests/helpers/stamp-assets.js --write
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../../html');
const ASSETS = ['app.css', 'app.js', 'boot.js', 'fonts/fonts.css'];

function stamp(html) {
  return ASSETS.reduce((h, a) => {
    const v = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, a))).digest('hex').slice(0, 8);
    const re = new RegExp(`(["'])/${a.replace('.', '\\.')}(\\?v=[0-9a-f]+)?\\1`, 'g');
    if (!re.test(h)) throw new Error('index.html does not link /' + a);
    return h.replace(re, `$1/${a}?v=${v}$1`);
  }, html);
}
module.exports = { stamp, ROOT };

if (require.main === module) {
  const file = path.join(ROOT, 'index.html');
  const html = fs.readFileSync(file, 'utf8'), next = stamp(html);
  if (process.argv.includes('--write')) fs.writeFileSync(file, next);
  else if (html !== next) { console.error('asset versions are stale; run with --write'); process.exit(1); }
}
