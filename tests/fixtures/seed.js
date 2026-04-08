#!/usr/bin/env node
/**
 * Toy DB Seeder
 *
 * Populates a SQLite database with realistic sample college admission data.
 * Designed for dev/staging environments so the app isn't empty.
 *
 * Usage:
 *   node seed.js                          # seeds /app/db/leo.db (Docker default)
 *   node seed.js /path/to/leo.db          # seeds a specific DB file
 *   node seed.js --clear /path/to/leo.db  # wipe + reseed
 *
 * The seeder is idempotent: it upserts by (session_id, college_name).
 * Running it twice won't create duplicates.
 */
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const clearMode = args.includes('--clear');
const dbArg = args.find(a => !a.startsWith('--'));
const dbPath = dbArg || '/app/db/leo.db';

const seedData = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'seed-data.json'), 'utf8')
);

console.log(`Seeding database: ${dbPath}`);
if (clearMode) console.log('  (clear mode — wiping existing data first)');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) { console.error('Failed to open DB:', err.message); process.exit(1); }
});

db.serialize(() => {
  // Ensure table exists (same schema as api/server.js)
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

  if (clearMode) {
    db.run("DELETE FROM submissions WHERE session_id LIKE 'demo-%'");
    console.log('  Cleared existing demo data.');
  }

  let total = 0;

  for (const session of seedData) {
    for (const c of session.colleges) {
      db.run(`
        INSERT OR REPLACE INTO submissions
          (session_id, college_name, grad_year, gpa, gpa_weighted, sat, act,
           class_rank, major, extracurriculars, sport, first_gen, decision, decision_type, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        session.session_id,
        c.college_name,
        c.grad_year || null,
        c.gpa || null,
        c.gpa_weighted || null,
        c.sat || null,
        c.act || null,
        c.class_rank || null,
        c.major || null,
        c.extracurriculars || null,
        c.sport || null,
        c.first_gen || null,
        c.decision || null,
        c.decision_type || null,
      ]);
      total++;
    }
  }

  db.run('SELECT 1', () => {
    console.log(`  Seeded ${total} submissions across ${seedData.length} sessions.`);
    console.log('  Sessions: ' + seedData.map(s => s.session_id).join(', '));
    db.close();
  });
});
