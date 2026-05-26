'use strict';
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path    = require('path');
const cors    = require('cors');
const crypto  = require('crypto');

// ── Helpers ────────────────────────────────────────────────────────────────
function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}
function makeToken() {
  return crypto.randomBytes(32).toString('hex');
}

// In-memory token store: token → { username, expires }
const tokens = new Map();
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

function requireAdmin(req, res, next) {
  const tok = req.headers['x-admin-token'];
  if (!tok) return res.status(401).json({ error: 'No token' });
  const session = tokens.get(tok);
  if (!session) return res.status(401).json({ error: 'Invalid token' });
  if (Date.now() > session.expires) { tokens.delete(tok); return res.status(401).json({ error: 'Token expired' }); }
  req.adminUser = session.username;
  next();
}

// ── App factory ────────────────────────────────────────────────────────────
function createApp(dbPath) {
  dbPath = dbPath || path.join(__dirname, '../db/leo.db');

  const app = express();
  app.use(cors());
  app.use(express.json());

  const db = new sqlite3.Database(dbPath, err => {
    if (err) console.error('DB error:', err);
    else console.log('Connected to SQLite at', dbPath);
  });

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
  });

  // ── Public: submissions ────────────────────────────────────────────────
  app.get('/api/submissions', (req, res) => {
    db.all('SELECT * FROM submissions ORDER BY created_at DESC', (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    });
  });

  app.get('/api/submissions/:session_id', (req, res) => {
    db.all('SELECT * FROM submissions WHERE session_id = ? ORDER BY created_at DESC',
      [req.params.session_id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
      });
  });

  app.post('/api/submissions', (req, res) => {
    const { session_id, colleges } = req.body;
    if (!session_id || !Array.isArray(colleges) || !colleges.length)
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
                 decision_type, essay_rating, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `);
            stmt.run([
              session_id, college.college_name,
              college.grad_year || null, college.gpa || null, college.gpa_weighted || null,
              college.sat || null, college.act || null, college.class_rank || null,
              college.major || null, college.extracurriculars || null,
              college.sport || null, college.first_gen || null,
              college.decision || null, college.decision_type || null,
              college.essay_rating ? parseInt(college.essay_rating) : null,
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
  app.post('/api/track', (req, res) => {
    const session_id = req.body.session_id || null;
    const ua = req.headers['user-agent'] || '';
    const ua_hash = crypto.createHash('sha256').update(ua).digest('hex').slice(0, 16);
    db.run('INSERT INTO page_views (session_id, ua_hash) VALUES (?, ?)',
      [session_id, ua_hash], err => {
        if (err) console.error('Track error:', err);
        res.json({ ok: true });
      });
  });

  // ── Public: submit chatbot question ───────────────────────────────────
  app.post('/api/questions', (req, res) => {
    const { question, session_id } = req.body;
    if (!question || !question.trim()) return res.status(400).json({ error: 'No question' });
    db.run('INSERT INTO questions (question, session_id) VALUES (?, ?)',
      [question.trim().slice(0, 1000), session_id || null], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, id: this.lastID });
      });
  });

  // ── Admin: setup (first account) ──────────────────────────────────────
  app.post('/api/admin/setup', (req, res) => {
    const secret = req.headers['x-admin-secret'];
    if (!secret || secret !== process.env.ADMIN_SECRET)
      return res.status(403).json({ error: 'Forbidden' });
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword(password, salt);
    db.run('INSERT INTO admin_users (username, password_hash, salt) VALUES (?, ?, ?)',
      [username, hash, salt], function(err) {
        if (err) return res.status(400).json({ error: err.message.includes('UNIQUE') ? 'Username taken' : err.message });
        res.json({ success: true, id: this.lastID });
      });
  });

  // ── Admin: login ───────────────────────────────────────────────────────
  app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    db.get('SELECT * FROM admin_users WHERE username = ?', [username], (err, user) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!user) return res.status(401).json({ error: 'Invalid credentials' });
      const hash = hashPassword(password, user.salt);
      if (hash !== user.password_hash) return res.status(401).json({ error: 'Invalid credentials' });
      const tok = makeToken();
      tokens.set(tok, { username, expires: Date.now() + TOKEN_TTL_MS });
      res.json({ token: tok, username });
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
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword(password, salt);
    db.run('INSERT INTO admin_users (username, password_hash, salt) VALUES (?, ?, ?)',
      [username, hash, salt], function(err) {
        if (err) return res.status(400).json({ error: err.message.includes('UNIQUE') ? 'Username taken' : err.message });
        res.json({ success: true, id: this.lastID });
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

  // ── Admin: delete session ──────────────────────────────────────────────
  app.delete('/api/admin/sessions/:session_id', requireAdmin, (req, res) => {
    db.run('DELETE FROM submissions WHERE session_id = ?', [req.params.session_id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, deleted: this.changes });
    });
  });

  // Legacy single-submission delete
  app.delete('/api/admin/submissions/:id', (req, res) => {
    const secret = req.headers['x-admin-secret'];
    const tok    = req.headers['x-admin-token'];
    const validSecret = secret && secret === process.env.ADMIN_SECRET;
    const validToken  = tok && tokens.has(tok) && Date.now() < tokens.get(tok).expires;
    if (!validSecret && !validToken) return res.status(403).json({ error: 'Forbidden' });
    db.run('DELETE FROM submissions WHERE id = ?', [req.params.id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      if (!this.changes) return res.status(404).json({ error: 'Not found' });
      res.json({ success: true });
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
        db.all(`SELECT date(created_at) AS day, COUNT(*) AS views, COUNT(DISTINCT session_id) AS uniq
                FROM page_views WHERE created_at >= datetime('now','-14 days')
                GROUP BY day ORDER BY day`, [], (err, rows) => err ? reject(err) : resolve(rows))
      ),
      q('SELECT COUNT(*) AS total_subs FROM submissions'),
      q('SELECT COUNT(DISTINCT session_id) AS total_students FROM submissions'),
      q(`SELECT COUNT(DISTINCT session_id) AS subs_this_week FROM submissions WHERE created_at >= datetime('now','-7 days')`),
    ]).then(([total, today, week, month, uniq, uniqToday, uniqWeek, daily, subs, students, subsWeek]) => {
      res.json({
        page_views: { total: total.total, today: today.today, week: week.week, month: month.month },
        unique_visitors: { all_time: uniq.unique_sessions, today: uniqToday.uniq_today, week: uniqWeek.uniq_week },
        daily,
        submissions: { total: subs.total_subs, students: students.total_students, this_week: subsWeek.subs_this_week },
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
