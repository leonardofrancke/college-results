const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');

const app = express();
const dbPath = path.join(__dirname, '../db/leo.db');

app.use(cors());
app.use(express.json());

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('DB error:', err);
  else console.log('Connected to SQLite at', dbPath);
});

db.serialize(() => {
  // Create table if it doesn't exist (new installs)
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(session_id, college_name)
    )
  `);

  // Migrate existing tables: add new columns if missing
  const newCols = [
    "ALTER TABLE submissions ADD COLUMN sport TEXT",
    "ALTER TABLE submissions ADD COLUMN first_gen TEXT",
    "ALTER TABLE submissions ADD COLUMN decision TEXT",
    "ALTER TABLE submissions ADD COLUMN decision_type TEXT",
  ];
  newCols.forEach(sql => {
    db.run(sql, err => {
      // Ignore "duplicate column" errors — expected on fresh installs
      if (err && !err.message.includes('duplicate column')) console.error(sql, err.message);
    });
  });

  // Migrate old data: copy sport_recruitment -> sport, college_decisions -> decision
  db.run(`
    UPDATE submissions
    SET sport = CASE WHEN sport_recruitment = 1 THEN 'yes' ELSE NULL END
    WHERE sport IS NULL AND sport_recruitment IS NOT NULL
  `);
  db.run(`
    UPDATE submissions
    SET decision = json_extract(college_decisions, '$.decision')
    WHERE decision IS NULL
      AND college_decisions IS NOT NULL
      AND college_decisions != '{}'
      AND json_extract(college_decisions, '$.decision') IS NOT NULL
  `);
});

// GET all submissions
app.get('/api/submissions', (req, res) => {
  db.all('SELECT * FROM submissions ORDER BY created_at DESC', (err, rows) => {
    if (err) { res.status(500).json({ error: err.message }); return; }
    res.json(rows || []);
  });
});

// GET submissions for a specific session
app.get('/api/submissions/:session_id', (req, res) => {
  const { session_id } = req.params;
  db.all(
    'SELECT * FROM submissions WHERE session_id = ? ORDER BY created_at DESC',
    [session_id],
    (err, rows) => {
      if (err) { res.status(500).json({ error: err.message }); return; }
      res.json(rows || []);
    }
  );
});

// POST — batch upsert for a session
app.post('/api/submissions', (req, res) => {
  const { session_id, colleges } = req.body;
  if (!session_id || !Array.isArray(colleges) || colleges.length === 0) {
    return res.status(400).json({ error: 'Need session_id and colleges array' });
  }

  db.run('BEGIN TRANSACTION', (err) => {
    if (err) return res.status(500).json({ error: err.message });

    const collegeNames = colleges.map(c => c.college_name);
    const placeholders = collegeNames.map(() => '?').join(',');

    db.run(
      `DELETE FROM submissions WHERE session_id = ? AND college_name NOT IN (${placeholders})`,
      [session_id, ...collegeNames],
      (err) => {
        if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }

        let completed = 0;
        colleges.forEach((college) => {
          const stmt = db.prepare(`
            INSERT OR REPLACE INTO submissions
              (session_id, college_name, grad_year, gpa, gpa_weighted, sat, act,
               class_rank, major, extracurriculars, sport, first_gen, decision, decision_type, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          `);
          stmt.run([
            session_id,
            college.college_name,
            college.grad_year || null,
            college.gpa || null,
            college.gpa_weighted || null,
            college.sat || null,
            college.act || null,
            college.class_rank || null,
            college.major || null,
            college.extracurriculars || null,
            college.sport || null,
            college.first_gen || null,
            college.decision || null,
            college.decision_type || null,
          ], (err) => {
            if (err) { console.error('Insert error:', err); db.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }
            completed++;
            if (completed === colleges.length) {
              db.run('COMMIT', (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true, inserted: colleges.length });
              });
            }
          });
          stmt.finalize();
        });
      }
    );
  });
});

// DELETE — user removes their own submission
app.delete('/api/submissions/:session_id', (req, res) => {
  const { session_id } = req.params;
  db.run('DELETE FROM submissions WHERE session_id = ?', [session_id], function(err) {
    if (err) { res.status(500).json({ error: err.message }); return; }
    res.json({ success: true, deleted: this.changes });
  });
});

// DELETE by row id — admin only
app.delete('/api/admin/submissions/:id', (req, res) => {
  const secret = req.headers['x-admin-secret'];
  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { id } = req.params;
  db.run('DELETE FROM submissions WHERE id = ?', [id], function(err) {
    if (err) { res.status(500).json({ error: err.message }); return; }
    if (this.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`API running on port ${PORT}`));
