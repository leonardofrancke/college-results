'use strict';
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path    = require('path');
const crypto  = require('crypto');

// ── Helpers ────────────────────────────────────────────────────────────────
function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}
function makeToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Only a SHA-256 of each token is stored, so a copy of the DB can't be used to
// act as an admin. Tokens are short-lived because admins can see every row.
const hashToken = tok => crypto.createHash('sha256').update(String(tok)).digest('hex');
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 d

// Student-entered text is rendered into HTML (and a few inline handlers) on the
// public page and the admin page. Strip every character that can open a tag,
// break out of an attribute, or escape a JS string, plus control characters.
// Apostrophes stay (St. Mary's); the client escapes those where it needs to.
const cleanText = (v, max) => {
  if (v == null) return null;
  const t = String(v).replace(/[<>"`\\\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
  return t || null;
};
const cleanNum = (v, lo, hi, int) => {
  const n = int ? parseInt(v) : parseFloat(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};
const cleanFlag = v => (v === 'yes' || v === 'no') ? v : null;

// ── App factory ────────────────────────────────────────────────────────────
function createApp(dbPath) {
  dbPath = dbPath || path.join(__dirname, '../db/leo.db');

  const app = express();
  // The page and API are served from the same origin, so no CORS headers:
  // other sites can't read the feed or write submissions from a browser.
  app.disable('x-powered-by');
  app.use(express.json({ limit: '50kb' }));

  const db = new sqlite3.Database(dbPath, err => {
    if (err) console.error('DB error:', err);
    else console.log('Connected to SQLite at', dbPath);
  });

  // Per-process fallback until the stored salts load (they load before any
  // request's query runs, since sqlite3 runs queued statements in order).
  const salts = {
    GROUP_SALT: process.env.GROUP_SALT || crypto.randomBytes(16).toString('hex'),
    ANALYTICS_SALT: process.env.ANALYTICS_SALT || crypto.randomBytes(16).toString('hex'),
  };

  // ── Schema ─────────────────────────────────────────────────────────────
  db.serialize(() => {
    // Submissions
    db.run(`
      CREATE TABLE IF NOT EXISTS submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        college_name TEXT NOT NULL,
        grad_year INTEGER,
        gpa REAL,
        gpa_weighted REAL,
        sat INTEGER,
        act INTEGER,
        class_rank TEXT,
        major TEXT,
        extracurriculars TEXT,
        sport TEXT,
        first_gen TEXT,
        decision TEXT,
        decision_type TEXT,
        essay_rating INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(session_id, college_name)
      )
    `);

    // Add columns that may not exist yet
    [
      "ALTER TABLE submissions ADD COLUMN sport TEXT",
      "ALTER TABLE submissions ADD COLUMN first_gen TEXT",
      "ALTER TABLE submissions ADD COLUMN decision TEXT",
      "ALTER TABLE submissions ADD COLUMN decision_type TEXT",
      "ALTER TABLE submissions ADD COLUMN essay_rating INTEGER",
      "ALTER TABLE submissions ADD COLUMN school_type TEXT",
      "ALTER TABLE submissions ADD COLUMN enrolling TEXT",
      "ALTER TABLE submissions ADD COLUMN scholarship TEXT",
    ].forEach(sql => db.run(sql, err => {
      if (err && !err.message.includes('duplicate column')) console.error(sql, err.message);
    }));

    // Admin users
    db.run(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Visitor questions (from chatbot)
    db.run(`
      CREATE TABLE IF NOT EXISTS questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        question TEXT NOT NULL,
        session_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Page views
    db.run(`
      CREATE TABLE IF NOT EXISTS page_views (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        ua_hash TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Lightweight analytics events (clicks, filter usage, etc.)
    db.run(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        event_type TEXT NOT NULL,
        event_value TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type)');

    // Admin auth tokens (persisted so they survive restarts)
    db.run(`
      CREATE TABLE IF NOT EXISTS admin_tokens (
        token TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // Salts for the one-way ID digests below. Generated once and kept here so
    // digests stay the same across restarts; an env var still overrides.
    db.run(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
    ['GROUP_SALT', 'ANALYTICS_SALT'].forEach(key => {
      db.run('INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)',
        [key, crypto.randomBytes(16).toString('hex')]);
      db.get('SELECT value FROM app_settings WHERE key = ?', [key], (err, row) => {
        if (!err && row && !process.env[key]) salts[key] = row.value;
      });
    });

    // Best-effort cleanup of expired tokens on startup
    db.run('DELETE FROM admin_tokens WHERE expires_at < ?', [Date.now()]);
  });

  // ── Auth middleware ────────────────────────────────────────────────────
  function requireAdmin(req, res, next) {
    const tok = req.headers['x-admin-token'];
    if (!tok) return res.status(401).json({ error: 'No token' });
    db.get('SELECT username, expires_at FROM admin_tokens WHERE token = ?', [hashToken(tok)], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(401).json({ error: 'Invalid token' });
      if (Date.now() > row.expires_at) {
        db.run('DELETE FROM admin_tokens WHERE token = ?', [hashToken(tok)]);
        return res.status(401).json({ error: 'Token expired' });
      }
      req.adminUser = row.username;
      next();
    });
  }

  // ── Public: submissions ────────────────────────────────────────────────
  // A submission's session_id is also the only thing needed to edit or delete
  // it, so it must never appear in the public feed — otherwise anyone can list
  // every id and delete every submission. The feed instead carries a stable
  // one-way digest, which groups a student's colleges together exactly like the
  // raw id did but cannot be replayed against the write routes.
  const groupId = sid => sid
    ? crypto.createHmac('sha256', salts.GROUP_SALT).update(String(sid)).digest('hex').slice(0, 16)
    : null;

  // Exact class rank identifies a student outright — everyone knows who is #1,
  // and most reported ranks belong to a single person. The feed carries a
  // fixed-width 7-rank range instead (e.g. "8-14"), never the raw number.
  const RANK_BUCKET = 7;
  const rankBand = rank => {
    const n = parseInt(rank);
    if (!n || n < 1) return null;
    const band = Math.ceil(n / RANK_BUCKET);
    const lo = (band - 1) * RANK_BUCKET + 1, hi = band * RANK_BUCKET;
    return `${lo}-${hi}`;
  };

  // Text columns are re-cleaned on the way out so rows saved before input
  // cleaning existed can't inject markup either.
  const TEXT_COLS = ['college_name', 'major', 'decision', 'decision_type', 'school_type', 'class_rank'];
  const cleanRow = r => {
    const out = { ...r };
    TEXT_COLS.forEach(c => { out[c] = cleanText(r[c], 120); });
    return out;
  };

  // Same grouping as canonKey() in html/index.html, so "Gavilan" and
  // "Gavilan College" count as one school. Keep the two in sync.
  const canonKey = name => String(name || '').toLowerCase()
    .replace(/csumb/g, 'cal state monterey bay')
    .replace(/\b(university|college|the|of|at|state|cal)\b/g, '')
    .replace(/gavill?an/g, 'gavilan')
    .replace(/[^a-z]/g, '');

  // A college only one student applied to shows that student's whole profile
  // to anyone who clicks it, so the public feed only includes colleges at
  // least this many different students applied to.
  const MIN_STUDENTS_PER_COLLEGE = 2;

  // The public feed also leaves out:
  //  - free-text extracurriculars (a line like "varsity soccer captain" names
  //    a student at a single school)
  //  - submission timestamps (can be matched to when someone was seen submitting)
  //  - first-generation and recruited-athlete flags (sensitive; admins still
  //    see them via /api/admin/submissions)
  app.get('/api/submissions', (req, res) => {
    db.all('SELECT * FROM submissions ORDER BY created_at DESC', (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      rows = rows || [];
      const students = new Map();
      rows.forEach(r => {
        const k = canonKey(r.college_name);
        if (!students.has(k)) students.set(k, new Set());
        students.get(k).add(r.session_id);
      });
      res.json(rows
        .filter(r => students.get(canonKey(r.college_name)).size >= MIN_STUDENTS_PER_COLLEGE)
        .map(r => {
          const { extracurriculars, created_at, updated_at, first_gen, sport, ...rest } = cleanRow(r);
          return {
            ...rest,
            session_id: groupId(r.session_id),
            class_rank: rankBand(r.class_rank)
          };
        }));
    });
  });

  app.get('/api/submissions/:session_id', (req, res) => {
    db.all('SELECT * FROM submissions WHERE session_id = ? ORDER BY created_at DESC',
      [req.params.session_id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json((rows || []).map(cleanRow));
      });
  });

  app.post('/api/submissions', (req, res) => {
    const { session_id } = req.body;
    if (!session_id || !Array.isArray(req.body.colleges) || !req.body.colleges.length)
      return res.status(400).json({ error: 'Need session_id and colleges array' });
    if (typeof session_id !== 'string' || session_id.length > 80)
      return res.status(400).json({ error: 'Invalid session_id' });
    if (req.body.colleges.length > 60)
      return res.status(400).json({ error: 'Too many colleges' });
    const colleges = req.body.colleges
      .map(c => ({ ...c, college_name: cleanText(c && c.college_name, 120) }))
      .filter(c => c.college_name);
    if (!colleges.length)
      return res.status(400).json({ error: 'Need session_id and colleges array' });

    db.run('BEGIN TRANSACTION', err => {
      if (err) return res.status(500).json({ error: err.message });

      const names = colleges.map(c => c.college_name);
      const ph = names.map(() => '?').join(',');
      db.run(`DELETE FROM submissions WHERE session_id = ? AND college_name NOT IN (${ph})`,
        [session_id, ...names], err => {
          if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }

          let done = 0;
          colleges.forEach(college => {
            const stmt = db.prepare(`
              INSERT OR REPLACE INTO submissions
                (session_id, college_name, grad_year, gpa, gpa_weighted, sat, act,
                 class_rank, major, extracurriculars, sport, first_gen, decision,
                 decision_type, essay_rating, school_type, enrolling, scholarship, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?,
                (SELECT extracurriculars FROM submissions WHERE session_id = ? AND college_name = ?),
                ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `);
            // extracurriculars is no longer collected (see the public feed note),
            // but whatever an older submission saved is kept, not overwritten.
            stmt.run([
              session_id, college.college_name,
              cleanNum(college.grad_year, 2000, 2100, true),
              cleanNum(college.gpa, 0, 5), cleanNum(college.gpa_weighted, 0, 6),
              cleanNum(college.sat, 400, 1600, true), cleanNum(college.act, 1, 36, true),
              cleanText(college.class_rank, 20),
              cleanText(college.major, 80), session_id, college.college_name,
              cleanFlag(college.sport), cleanFlag(college.first_gen),
              cleanText(college.decision, 20), cleanText(college.decision_type, 30),
              cleanNum(college.essay_rating, 1, 5, true),
              cleanText(college.school_type, 30) || 'University',
              cleanFlag(college.enrolling),
              cleanFlag(college.scholarship),
            ], err => {
              if (err) { console.error('Insert error:', err); db.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }
              if (++done === colleges.length) {
                db.run('COMMIT', err => {
                  if (err) return res.status(500).json({ error: err.message });
                  res.json({ success: true, inserted: colleges.length });
                });
              }
            });
            stmt.finalize();
          });
        });
    });
  });

  app.delete('/api/submissions/:session_id', (req, res) => {
    db.run('DELETE FROM submissions WHERE session_id = ?', [req.params.session_id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, deleted: this.changes });
    });
  });

  // ── Public: page view tracking ─────────────────────────────────────────
  // Analytics rows store a one-way digest of the browser ID rather than the ID
  // itself, so browsing history can't be joined back to a submission.
  const analyticsId = sid => sid
    ? crypto.createHmac('sha256', salts.ANALYTICS_SALT).update(String(sid)).digest('hex').slice(0, 16)
    : null;

  app.post('/api/track', (req, res) => {
    const session_id = analyticsId(req.body && req.body.session_id);
    const ua = req.headers['user-agent'] || '';
    const ua_hash = crypto.createHash('sha256').update(ua).digest('hex').slice(0, 16);
    db.run('INSERT INTO page_views (session_id, ua_hash) VALUES (?, ?)',
      [session_id, ua_hash], err => {
        if (err) console.error('Track error:', err);
        res.json({ ok: true });
      });
  });

  // Generic analytics event tracking (clicks, filter usage, etc.)
  app.post('/api/track/event', (req, res) => {
    const { type, value, session_id } = req.body || {};
    if (!type) return res.status(400).json({ error: 'type required' });
    // Values are shown on the admin page, so strip markup like submissions.
    const safeType  = cleanText(type, 50);
    const safeValue = cleanText(value, 200);
    if (!safeType) return res.status(400).json({ error: 'type required' });
    const safeSid   = analyticsId(session_id);
    db.run('INSERT INTO events (session_id, event_type, event_value) VALUES (?, ?, ?)',
      [safeSid, safeType, safeValue], err => {
        if (err) console.error('Event track:', err);
        res.json({ ok: true });
      });
  });

  // ── Public: submit chatbot question ───────────────────────────────────
  app.post('/api/questions', (req, res) => {
    const question = cleanText(req.body && req.body.question, 1000);
    if (!question) return res.status(400).json({ error: 'No question' });
    // Not linked to the browser ID: questions stay separate from submissions.
    db.run('INSERT INTO questions (question) VALUES (?)', [question], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, id: this.lastID });
      });
  });

  const safeEqual = (a, b) => {
    const x = Buffer.from(String(a)), y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  };
  const secretOk = s => !!(s && process.env.ADMIN_SECRET && safeEqual(s, process.env.ADMIN_SECRET));

  // Usernames match case-insensitively everywhere ("leo" logs in as "Leo").
  const findUser = (username, cb) =>
    db.get('SELECT * FROM admin_users WHERE username = ? COLLATE NOCASE', [String(username || '').trim()], cb);

  // ── Admin: setup / password reset ─────────────────────────────────────
  // Whoever holds ADMIN_SECRET can already create admins, so it's also the
  // recovery path: an existing username gets a new password instead of an
  // error, and that account's old logins are signed out.
  app.post('/api/admin/setup', (req, res) => {
    if (!secretOk(req.headers['x-admin-secret']))
      return res.status(403).json({ error: 'Wrong security key' });
    const username = String(req.body.username || '').trim();
    const { password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    if (String(password).length < 12)
      return res.status(400).json({ error: 'Password must be at least 12 characters' });
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword(password, salt);
    findUser(username, (err, user) => {
      if (err) return res.status(500).json({ error: err.message });
      if (user) {
        return db.run('UPDATE admin_users SET password_hash = ?, salt = ? WHERE id = ?',
          [hash, salt, user.id], err2 => {
            if (err2) return res.status(500).json({ error: err2.message });
            db.run('DELETE FROM admin_tokens WHERE username = ?', [user.username]);
            res.json({ success: true, reset: true, username: user.username });
          });
      }
      db.run('INSERT INTO admin_users (username, password_hash, salt) VALUES (?, ?, ?)',
        [username, hash, salt], function(err2) {
          if (err2) return res.status(400).json({ error: err2.message });
          res.json({ success: true, id: this.lastID, username });
        });
    });
  });

  // ── Admin: login ───────────────────────────────────────────────────────
  app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    findUser(username, (err, user) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!user) return res.status(401).json({ error: 'Invalid credentials' });
      const hash = hashPassword(password, user.salt);
      if (!safeEqual(hash, user.password_hash)) return res.status(401).json({ error: 'Invalid credentials' });
      const tok = makeToken();
      const expiresAt = Date.now() + TOKEN_TTL_MS;
      db.run('INSERT INTO admin_tokens (token, username, expires_at) VALUES (?, ?, ?)',
        [hashToken(tok), user.username, expiresAt], err2 => {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json({ token: tok, username: user.username });
        });
    });
  });

  // ── Admin: users ───────────────────────────────────────────────────────
  app.get('/api/admin/users', requireAdmin, (req, res) => {
    db.all('SELECT id, username, created_at FROM admin_users ORDER BY created_at', (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    });
  });

  app.post('/api/admin/users', requireAdmin, (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    if (String(password).length < 12)
      return res.status(400).json({ error: 'Password must be at least 12 characters' });
    findUser(username, (err, existing) => {
      if (err) return res.status(500).json({ error: err.message });
      if (existing) return res.status(400).json({ error: 'Username taken' });
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = hashPassword(password, salt);
      db.run('INSERT INTO admin_users (username, password_hash, salt) VALUES (?, ?, ?)',
        [String(username).trim(), hash, salt], function(err2) {
          if (err2) return res.status(400).json({ error: err2.message });
          res.json({ success: true, id: this.lastID });
        });
    });
  });

  app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
    db.get('SELECT username FROM admin_users WHERE id = ?', [req.params.id], (err, row) => {
      if (!row) return res.status(404).json({ error: 'Not found' });
      if (row.username === req.adminUser) return res.status(400).json({ error: 'Cannot delete your own account' });
      db.run('DELETE FROM admin_users WHERE id = ?', [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
      });
    });
  });

  // ── Admin: all submissions ─────────────────────────────────────────────
  // Everything the public feed hides, except the raw browser ID and the
  // extracurriculars text.
  app.get('/api/admin/submissions', requireAdmin, (req, res) => {
    db.all('SELECT * FROM submissions ORDER BY created_at DESC', (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json((rows || []).map(r => {
        const { extracurriculars, ...rest } = cleanRow(r);
        return { ...rest, session_id: groupId(r.session_id) };
      }));
    });
  });

  // ── Admin: delete session ──────────────────────────────────────────────
  // The admin page only ever sees the feed's digest, so accept either the raw
  // browser ID or its digest (needed to honor a deletion request by email).
  app.delete('/api/admin/sessions/:session_id', requireAdmin, (req, res) => {
    const key = req.params.session_id;
    db.all('SELECT DISTINCT session_id FROM submissions', (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const ids = (rows || []).map(r => r.session_id).filter(s => s === key || groupId(s) === key);
      if (!ids.length) return res.json({ success: true, deleted: 0 });
      db.run(`DELETE FROM submissions WHERE session_id IN (${ids.map(() => '?').join(',')})`, ids, function(err2) {
        if (err2) return res.status(500).json({ error: err2.message });
        res.json({ success: true, deleted: this.changes });
      });
    });
  });

  // Legacy single-submission delete
  app.delete('/api/admin/submissions/:id', (req, res) => {
    const secret = req.headers['x-admin-secret'];
    const tok    = req.headers['x-admin-token'];
    const validSecret = secretOk(secret);
    const doDelete = () => {
      db.run('DELETE FROM submissions WHERE id = ?', [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (!this.changes) return res.status(404).json({ error: 'Not found' });
        res.json({ success: true });
      });
    };
    if (validSecret) return doDelete();
    if (!tok) return res.status(403).json({ error: 'Forbidden' });
    db.get('SELECT expires_at FROM admin_tokens WHERE token = ?', [hashToken(tok)], (err, row) => {
      if (!row || Date.now() >= row.expires_at) return res.status(403).json({ error: 'Forbidden' });
      doDelete();
    });
  });

  // ── Admin: questions ───────────────────────────────────────────────────
  app.get('/api/admin/questions', requireAdmin, (req, res) => {
    db.all('SELECT * FROM questions ORDER BY created_at DESC', (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    });
  });

  app.delete('/api/admin/questions/:id', requireAdmin, (req, res) => {
    db.run('DELETE FROM questions WHERE id = ?', [req.params.id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
  });

  // ── Admin: site stats ──────────────────────────────────────────────────
  app.get('/api/admin/stats', requireAdmin, (req, res) => {
    const q = (sql, params) => new Promise((resolve, reject) =>
      db.get(sql, params || [], (err, row) => err ? reject(err) : resolve(row))
    );
    Promise.all([
      q('SELECT COUNT(*) AS total FROM page_views'),
      q(`SELECT COUNT(*) AS today FROM page_views WHERE date(created_at) = date('now')`),
      q(`SELECT COUNT(*) AS week FROM page_views WHERE created_at >= datetime('now','-7 days')`),
      q(`SELECT COUNT(*) AS month FROM page_views WHERE created_at >= datetime('now','-30 days')`),
      q('SELECT COUNT(DISTINCT session_id) AS unique_sessions FROM page_views WHERE session_id IS NOT NULL'),
      q(`SELECT COUNT(DISTINCT session_id) AS uniq_today FROM page_views WHERE session_id IS NOT NULL AND date(created_at) = date('now')`),
      q(`SELECT COUNT(DISTINCT session_id) AS uniq_week FROM page_views WHERE session_id IS NOT NULL AND created_at >= datetime('now','-7 days')`),
      // Daily breakdown for last 14 days
      new Promise((resolve, reject) =>
        db.all(`SELECT date(created_at) AS date, COUNT(*) AS page_views, COUNT(DISTINCT session_id) AS unique_visitors
                FROM page_views WHERE created_at >= datetime('now','-14 days')
                GROUP BY date ORDER BY date`, [], (err, rows) => err ? reject(err) : resolve(rows))
      ),
      q('SELECT COUNT(*) AS total_subs FROM submissions'),
      q('SELECT COUNT(DISTINCT session_id) AS total_students FROM submissions'),
      q(`SELECT COUNT(DISTINCT session_id) AS subs_this_week FROM submissions WHERE created_at >= datetime('now','-7 days')`),
      // New analytics queries
      q('SELECT COUNT(DISTINCT college_name) AS n FROM submissions WHERE college_name IS NOT NULL AND college_name != ""'),
      q('SELECT COUNT(DISTINCT major) AS n FROM submissions WHERE major IS NOT NULL AND major != ""'),
      // Avg session length in seconds (only for sessions with >1 page view)
      q(`SELECT AVG(dur) AS avg_sec FROM (
            SELECT (julianday(MAX(created_at)) - julianday(MIN(created_at))) * 86400 AS dur
            FROM page_views WHERE session_id IS NOT NULL
            GROUP BY session_id HAVING COUNT(*) > 1
         )`),
      // Top clicked colleges
      new Promise((resolve, reject) =>
        db.all(`SELECT event_value AS name, COUNT(*) AS clicks FROM events
                WHERE event_type = 'college_click' AND event_value IS NOT NULL
                GROUP BY event_value ORDER BY clicks DESC LIMIT 12`, [], (err, rows) => err ? reject(err) : resolve(rows))
      ),
      // Top used filters
      new Promise((resolve, reject) =>
        db.all(`SELECT event_value AS name, COUNT(*) AS clicks FROM events
                WHERE event_type = 'filter_click' AND event_value IS NOT NULL
                GROUP BY event_value ORDER BY clicks DESC LIMIT 12`, [], (err, rows) => err ? reject(err) : resolve(rows))
      ),
    ]).then(([total, today, week, month, uniq, uniqToday, uniqWeek, daily, subs, students, subsWeek,
              collegesTracked, majorsTracked, avgSession, topColleges, topFilters]) => {
      const visitors = uniq.unique_sessions || 0;
      const submitters = students.total_students || 0;
      res.json({
        page_views: { total: total.total, today: today.today, week: week.week, month: month.month },
        unique_visitors: { total: visitors, today: uniqToday.uniq_today, week: uniqWeek.uniq_week },
        daily,
        submissions: { total: subs.total_subs, students: submitters, this_week: subsWeek.subs_this_week },
        colleges_tracked: collegesTracked.n || 0,
        majors_tracked: majorsTracked.n || 0,
        avg_session_seconds: Math.round(avgSession.avg_sec || 0),
        conversion: {
          visitors, submitters,
          rate: visitors ? +(submitters / visitors * 100).toFixed(1) : 0,
        },
        // Re-cleaned so events stored before input cleaning can't inject markup.
        top_colleges: (topColleges || []).map(r => ({ ...r, name: cleanText(r.name, 200) })),
        top_filters: (topFilters || []).map(r => ({ ...r, name: cleanText(r.name, 200) })),
      });
    }).catch(err => res.status(500).json({ error: err.message }));
  });

  app._db = db;
  app._dbPath = dbPath;
  return app;
}

if (require.main === module) {
  const app = createApp();
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`API running on port ${PORT}`));
}

module.exports = { createApp };
