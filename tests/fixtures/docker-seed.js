#!/usr/bin/env node
// Standalone seeder that runs inside the Docker container.
// Uses the sqlite3 already installed in /app/api/node_modules.
const sqlite3Path = '/app/api/node_modules/sqlite3';
const sqlite3 = require(sqlite3Path).verbose();
const fs = require('fs');
const seedData = JSON.parse(fs.readFileSync('/tmp/seed-data.json', 'utf8'));
const db = new sqlite3.Database('/app/db/leo.db');
let total = 0;
db.serialize(function() {
  seedData.forEach(function(session) {
    session.colleges.forEach(function(c) {
      db.run(
        'INSERT OR REPLACE INTO submissions (session_id,college_name,grad_year,gpa,gpa_weighted,sat,act,class_rank,major,extracurriculars,sport,first_gen,decision,decision_type,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)',
        [session.session_id, c.college_name, c.grad_year||null, c.gpa||null, c.gpa_weighted||null, c.sat||null, c.act||null, c.class_rank||null, c.major||null, c.extracurriculars||null, c.sport||null, c.first_gen||null, c.decision||null, c.decision_type||null]
      );
      total++;
    });
  });
  db.run('SELECT 1', function() {
    console.log('Seeded ' + total + ' submissions across ' + seedData.length + ' sessions');
    db.close();
  });
});
