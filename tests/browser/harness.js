// Local, isolated stack for browser tests and manual checks:
//   real nginx (the repo's nginx.conf, with only paths/ports swapped)
//   → the real API (api/server.js) on a throwaway SQLite file
//   → seeded with synthetic submissions only.
// Nothing here talks to staging or production.
//
//   node tests/browser/harness.js            # run it and print the URL
//   PORT=8787 node tests/browser/harness.js  # fixed port
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '../..');
process.env.NODE_PATH = path.join(ROOT, 'tests/node_modules');
require('module').Module._initPaths();
process.env.ADMIN_SECRET = process.env.ADMIN_SECRET || 'local-test-secret-not-used-anywhere';

const { createApp } = require(path.join(ROOT, 'api/server.js'));
const { buildSyntheticSubmissions } = require(path.join(ROOT, 'tests/fixtures/synthetic-results.js'));

function findNginx() {
  for (const p of ['/opt/homebrew/bin/nginx', '/usr/local/bin/nginx', '/usr/sbin/nginx']) if (fs.existsSync(p)) return p;
  try { return execFileSync('which', ['nginx']).toString().trim(); } catch { return null; }
}
function mimeTypes(nginx) {
  for (const p of ['/opt/homebrew/etc/nginx/mime.types', '/usr/local/etc/nginx/mime.types', '/etc/nginx/mime.types']) if (fs.existsSync(p)) return p;
  throw new Error('mime.types not found for ' + nginx);
}

function post(port, pathName, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, path: pathName, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, res => {
      let b = ''; res.on('data', c => b += c); res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', reject); req.end(data);
  });
}
const listen = (server, port) => new Promise(r => server.listen(port || 0, '127.0.0.1', () => r(server.address().port)));
const freePort = () => new Promise(r => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

// opts.rateLimits: keep the config's limit_req lines (default false, because a
// browser test suite makes far more requests per second than a person).
async function start(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-harness-'));
  const app = createApp(path.join(dir, 'synthetic.db'));
  const api = http.createServer(app);
  const apiPort = await listen(api);
  if (opts.seed !== false) {
    for (const s of buildSyntheticSubmissions()) {
      const r = await post(apiPort, '/api/submissions', s);
      if (r.status !== 200) throw new Error('seed failed: ' + r.body);
    }
  }

  const nginx = findNginx();
  if (!nginx) throw new Error('nginx is required for the browser tests (brew install nginx)');
  const webPort = opts.port || await freePort();
  let conf = fs.readFileSync(path.join(ROOT, 'nginx.conf'), 'utf8');
  const swap = (from, to) => { if (!conf.includes(from)) throw new Error('nginx.conf no longer contains: ' + from); conf = conf.split(from).join(to); };
  swap('user nginx;', '');
  swap('error_log /var/log/nginx/error.log warn;', `error_log ${dir}/error.log warn;`);
  swap('pid /var/run/nginx.pid;', `pid ${dir}/nginx.pid;`);
  swap('include /etc/nginx/mime.types;', `include ${mimeTypes(nginx)};\n    client_body_temp_path ${dir}/cb; proxy_temp_path ${dir}/px; fastcgi_temp_path ${dir}/fc; uwsgi_temp_path ${dir}/uw; scgi_temp_path ${dir}/sc;`);
  swap('access_log /var/log/nginx/access.log privacy;', `access_log ${dir}/access.log privacy;`);
  swap('listen 80;', `listen 127.0.0.1:${webPort};`);
  swap('root /app/html;', `root ${opts.htmlRoot || path.join(ROOT, 'html')};`);
  swap('proxy_pass http://localhost:3001;', `proxy_pass http://127.0.0.1:${apiPort};`);
  if (!opts.rateLimits) conf = conf.replace(/^\s*limit_req zone=.*$/gm, '');
  const confPath = path.join(dir, 'nginx.conf');
  fs.writeFileSync(confPath, conf);
  execFileSync(nginx, ['-t', '-q', '-p', dir, '-c', confPath], { stdio: 'pipe' });
  const proc = spawn(nginx, ['-p', dir, '-c', confPath, '-g', 'daemon off;'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = ''; proc.stderr.on('data', d => stderr += d);
  const baseUrl = `http://127.0.0.1:${webPort}`;
  for (let i = 0; i < 50; i++) {
    try { await new Promise((res, rej) => http.get(baseUrl + '/', r => { r.resume(); res(); }).on('error', rej)); break; }
    catch { await new Promise(r => setTimeout(r, 100)); if (i === 49) throw new Error('nginx did not start: ' + stderr); }
  }
  const stop = async () => {
    proc.kill('SIGTERM');
    await new Promise(r => api.close(r));
    await new Promise(r => app._db.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { baseUrl, apiPort, dir, stop, confPath };
}

module.exports = { start };

if (require.main === module) {
  start({ port: process.env.PORT ? +process.env.PORT : undefined }).then(h => {
    console.log(`College Results (synthetic data) at ${h.baseUrl}`);
    const bye = () => h.stop().then(() => process.exit(0));
    process.on('SIGINT', bye); process.on('SIGTERM', bye);
  }).catch(e => { console.error(e); process.exit(1); });
}
