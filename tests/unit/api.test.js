const request = require('supertest');
const { createApp } = require('../helpers/create-app');

let app;

beforeEach(() => {
  app = createApp();
});

afterEach(async () => {
  await app.cleanup();
});

// ─── GET /api/submissions ───

describe('GET /api/submissions', () => {
  test('returns empty array when no data', async () => {
    const res = await request(app).get('/api/submissions');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('returns submissions after insert', async () => {
    // Two students, since colleges with a single applicant are hidden.
    for (const sid of ['sess-1', 'sess-2']) {
      await request(app).post('/api/submissions').send({
        session_id: sid,
        colleges: [{ college_name: 'MIT', gpa: 3.9, sat: 1520 }],
      });
    }

    const res = await request(app).get('/api/submissions');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].college_name).toBe('MIT');
    expect(res.body[0].gpa).toBe(3.9);
    expect(res.body[0].sat).toBe(1520);
  });
});

// ─── GET /api/submissions/:session_id ───

describe('GET /api/submissions/:session_id', () => {
  test('returns only submissions for the given session', async () => {
    await request(app).post('/api/submissions').send({
      session_id: 'sess-a',
      colleges: [{ college_name: 'Stanford' }],
    });
    await request(app).post('/api/submissions').send({
      session_id: 'sess-b',
      colleges: [{ college_name: 'Harvard' }],
    });

    const res = await request(app).get('/api/submissions/sess-a');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].college_name).toBe('Stanford');
  });

  test('returns empty array for unknown session', async () => {
    const res = await request(app).get('/api/submissions/nonexistent');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ─── POST /api/submissions ───

describe('POST /api/submissions', () => {
  test('creates multiple colleges in one session', async () => {
    const res = await request(app).post('/api/submissions').send({
      session_id: 'sess-1',
      colleges: [
        { college_name: 'MIT', gpa: 3.95, sat: 1550 },
        { college_name: 'Caltech', gpa: 3.95, act: 35 },
      ],
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.inserted).toBe(2);

    const all = await request(app).get('/api/submissions/sess-1');
    expect(all.body).toHaveLength(2);
  });

  test('upserts on duplicate session_id + college_name', async () => {
    await request(app).post('/api/submissions').send({
      session_id: 'sess-1',
      colleges: [{ college_name: 'MIT', gpa: 3.5 }],
    });

    await request(app).post('/api/submissions').send({
      session_id: 'sess-1',
      colleges: [{ college_name: 'MIT', gpa: 3.9 }],
    });

    const res = await request(app).get('/api/submissions/sess-1');
    expect(res.body).toHaveLength(1);
    expect(res.body[0].gpa).toBe(3.9);
  });

  test('removes colleges no longer in the list', async () => {
    await request(app).post('/api/submissions').send({
      session_id: 'sess-1',
      colleges: [
        { college_name: 'MIT' },
        { college_name: 'Harvard' },
        { college_name: 'Yale' },
      ],
    });

    // Resubmit with only MIT — Harvard and Yale should be deleted
    await request(app).post('/api/submissions').send({
      session_id: 'sess-1',
      colleges: [{ college_name: 'MIT' }],
    });

    const res = await request(app).get('/api/submissions/sess-1');
    expect(res.body).toHaveLength(1);
    expect(res.body[0].college_name).toBe('MIT');
  });

  test('stores all optional fields', async () => {
    await request(app).post('/api/submissions').send({
      session_id: 'sess-1',
      colleges: [{
        college_name: 'Stanford',
        grad_year: 2030,
        gpa: 3.85,
        gpa_weighted: 4.2,
        sat: 1480,
        act: 33,
        class_rank: 'Top 10%',
        major: 'Computer Science',
        extracurriculars: 'Robotics, Math Team',
        sport: 'yes',
        first_gen: 'no',
        decision: 'Accepted',
        decision_type: 'Regular Decision',
      }],
    });

    const res = await request(app).get('/api/submissions/sess-1');
    const row = res.body[0];
    expect(row.grad_year).toBe(2030);
    expect(row.gpa_weighted).toBe(4.2);
    expect(row.class_rank).toBe('Top 10%');
    expect(row.major).toBe('Computer Science');
    expect(row.extracurriculars).toBeNull(); // no longer collected
    expect(row.sport).toBe('yes');
    expect(row.first_gen).toBe('no');
    expect(row.decision).toBe('Accepted');
    expect(row.decision_type).toBe('Regular Decision');
  });

  test('rejects missing session_id', async () => {
    const res = await request(app).post('/api/submissions').send({
      colleges: [{ college_name: 'MIT' }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/session_id/i);
  });

  test('rejects empty colleges array', async () => {
    const res = await request(app).post('/api/submissions').send({
      session_id: 'sess-1',
      colleges: [],
    });
    expect(res.status).toBe(400);
  });

  test('rejects missing colleges field', async () => {
    const res = await request(app).post('/api/submissions').send({
      session_id: 'sess-1',
    });
    expect(res.status).toBe(400);
  });
});

// ─── DELETE /api/submissions/:session_id ───

describe('DELETE /api/submissions/:session_id', () => {
  test('deletes all submissions for a session', async () => {
    await request(app).post('/api/submissions').send({
      session_id: 'sess-1',
      colleges: [{ college_name: 'MIT' }, { college_name: 'Harvard' }],
    });

    const res = await request(app).delete('/api/submissions/sess-1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.deleted).toBe(2);

    const check = await request(app).get('/api/submissions/sess-1');
    expect(check.body).toEqual([]);
  });

  test('returns deleted: 0 for unknown session', async () => {
    const res = await request(app).delete('/api/submissions/nonexistent');
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(0);
  });

  test('does not affect other sessions', async () => {
    await request(app).post('/api/submissions').send({
      session_id: 'sess-a',
      colleges: [{ college_name: 'MIT' }],
    });
    for (const sid of ['sess-b', 'sess-c']) {
      await request(app).post('/api/submissions').send({
        session_id: sid,
        colleges: [{ college_name: 'Harvard' }],
      });
    }

    await request(app).delete('/api/submissions/sess-a');

    const remaining = await request(app).get('/api/submissions');
    expect(remaining.body).toHaveLength(2);
    // GET /api/submissions deliberately never returns the raw session_id
    // (it's the only credential needed to edit/delete, so exposing it in the
    // public feed would let anyone delete anyone's rows) — it returns a
    // salted one-way digest instead, generated fresh per app instance, so
    // this can't assert an exact value. college_name distinguishes sess-b's
    // row from the deleted sess-a row just as well.
    expect(remaining.body[0].college_name).toBe('Harvard');
  });
});

// ─── DELETE /api/admin/submissions/:id ───

describe('DELETE /api/admin/submissions/:id', () => {
  test('deletes a single row by id with valid secret', async () => {
    await request(app).post('/api/submissions').send({
      session_id: 'sess-1',
      colleges: [{ college_name: 'MIT' }, { college_name: 'Harvard' }],
    });

    const all = await request(app).get('/api/submissions/sess-1');
    const mitId = all.body.find(r => r.college_name === 'MIT').id;

    const res = await request(app)
      .delete(`/api/admin/submissions/${mitId}`)
      .set('x-admin-secret', 'test-secret');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const remaining = await request(app).get('/api/submissions/sess-1');
    expect(remaining.body).toHaveLength(1);
    expect(remaining.body[0].college_name).toBe('Harvard');
  });

  test('returns 403 without admin secret', async () => {
    const res = await request(app).delete('/api/admin/submissions/1');
    expect(res.status).toBe(403);
  });

  test('returns 403 with wrong secret', async () => {
    const res = await request(app)
      .delete('/api/admin/submissions/1')
      .set('x-admin-secret', 'wrong');
    expect(res.status).toBe(403);
  });

  test('returns 404 for nonexistent id', async () => {
    const res = await request(app)
      .delete('/api/admin/submissions/99999')
      .set('x-admin-secret', 'test-secret');
    expect(res.status).toBe(404);
  });
});

// ─── Data isolation ───

describe('session isolation', () => {
  test('multiple sessions do not interfere', async () => {
    const sessions = ['alpha', 'beta', 'gamma'];
    for (const s of sessions) {
      await request(app).post('/api/submissions').send({
        session_id: s,
        colleges: [
          { college_name: 'Shared College One' },
          { college_name: 'Shared College Two' },
        ],
      });
    }

    for (const s of sessions) {
      const res = await request(app).get(`/api/submissions/${s}`);
      expect(res.body).toHaveLength(2);
      expect(res.body.every(r => r.session_id === s)).toBe(true);
    }

    const all = await request(app).get('/api/submissions');
    expect(all.body).toHaveLength(6);
  });
});

// ─── Admin auth + deletion requests ───

describe('admin tokens and session deletion', () => {
  async function login() {
    await request(app).post('/api/admin/setup')
      .set('x-admin-secret', 'test-secret')
      .send({ username: 'admin', password: 'correct-horse-battery' });
    const res = await request(app).post('/api/admin/login')
      .send({ username: 'admin', password: 'correct-horse-battery' });
    return res.body.token;
  }

  test('rejects short admin passwords', async () => {
    const res = await request(app).post('/api/admin/setup')
      .set('x-admin-secret', 'test-secret')
      .send({ username: 'admin', password: 'abc' });
    expect(res.status).toBe(400);
  });

  test('stores only a hash of the token', async () => {
    const token = await login();
    expect(token).toBeTruthy();
    const rows = await new Promise((resolve, reject) =>
      app._db.all('SELECT token FROM admin_tokens', (err, r) => err ? reject(err) : resolve(r)));
    expect(rows).toHaveLength(1);
    expect(rows[0].token).not.toBe(token);
    const ok = await request(app).get('/api/admin/users').set('x-admin-token', token);
    expect(ok.status).toBe(200);
  });

  test('admin can delete a student by the digest shown in the feed', async () => {
    const token = await login();
    for (const sid of ['student-1', 'student-2']) {
      await request(app).post('/api/submissions').send({
        session_id: sid, colleges: [{ college_name: 'A' }, { college_name: 'B' }],
      });
    }
    const feed = await request(app).get('/api/submissions');
    const digest = feed.body[0].session_id;
    expect(digest).not.toBe('student-1');

    const del = await request(app).delete(`/api/admin/sessions/${digest}`).set('x-admin-token', token);
    expect(del.body.deleted).toBe(2);
    const after = await request(app).get('/api/submissions');
    expect(after.body).toHaveLength(0);
  });
});

describe('existing data is preserved', () => {
  test('editing a submission keeps extracurriculars saved earlier', async () => {
    await new Promise((resolve, reject) => app._db.run(
      "INSERT INTO submissions (session_id, college_name, extracurriculars) VALUES ('old', 'A', 'Debate')",
      err => err ? reject(err) : resolve()));
    await request(app).post('/api/submissions').send({
      session_id: 'old', colleges: [{ college_name: 'A', decision: 'Accepted' }],
    });
    const row = await new Promise((resolve, reject) => app._db.get(
      "SELECT * FROM submissions WHERE session_id = 'old'", (err, r) => err ? reject(err) : resolve(r)));
    expect(row.extracurriculars).toBe('Debate');
    expect(row.decision).toBe('Accepted');
  });
});

describe('stable feed IDs', () => {
  test('digest is the same after a restart on the same database', async () => {
    const path = require('path'), os = require('os'), fs = require('fs');
    const { createApp: real } = require('../../api/server');
    const dbPath = path.join(os.tmpdir(), `leo-salt-${Date.now()}.db`);
    const close = a => new Promise(r => a._db.close(r));

    const a1 = real(dbPath);
    await request(a1).post('/api/submissions').send({ session_id: 's', colleges: [{ college_name: 'A' }] });
    await request(a1).post('/api/submissions').send({ session_id: 't', colleges: [{ college_name: 'A' }] });
    const id1 = (await request(a1).get('/api/submissions')).body[0].session_id;
    await close(a1);

    const a2 = real(dbPath);
    const id2 = (await request(a2).get('/api/submissions')).body[0].session_id;
    await close(a2);
    fs.unlinkSync(dbPath);
    expect(id2).toBe(id1);
  });
});

describe('analytics events', () => {
  test('markup in event values never reaches admin stats', async () => {
    await request(app).post('/api/track/event')
      .send({ type: 'college_click', value: '<img src=x onerror=alert(1)>' });
    await request(app).post('/api/admin/setup').set('x-admin-secret', 'test-secret')
      .send({ username: 'admin', password: 'correct-horse-battery' });
    const { body: { token } } = await request(app).post('/api/admin/login')
      .send({ username: 'admin', password: 'correct-horse-battery' });
    const stats = await request(app).get('/api/admin/stats').set('x-admin-token', token);
    expect(stats.body.top_colleges).toHaveLength(1);
    expect(stats.body.top_colleges[0].name).not.toMatch(/[<>"]/);
  });
});

describe('admin login recovery', () => {
  const setup = (username, password, secret = 'test-secret') =>
    request(app).post('/api/admin/setup').set('x-admin-secret', secret).send({ username, password });
  const login = (username, password) =>
    request(app).post('/api/admin/login').send({ username, password });

  test('username is case-insensitive at login', async () => {
    await setup('Leo', 'correct-horse-battery');
    const res = await login(' leo ', 'correct-horse-battery');
    expect(res.status).toBe(200);
    expect(res.body.username).toBe('Leo');
  });

  test('security key resets an existing password', async () => {
    await setup('Leo', 'old-password-123');
    const reset = await setup('leo', 'new-password-456');
    expect(reset.body.reset).toBe(true);
    expect((await login('Leo', 'old-password-123')).status).toBe(401);
    expect((await login('Leo', 'new-password-456')).status).toBe(200);
    const users = await new Promise((resolve, reject) =>
      app._db.all('SELECT username FROM admin_users', (e, r) => e ? reject(e) : resolve(r)));
    expect(users).toEqual([{ username: 'Leo' }]);
  });

  test('wrong security key is rejected', async () => {
    const res = await setup('Leo', 'correct-horse-battery', 'nope');
    expect(res.status).toBe(403);
  });
});

describe('public feed privacy', () => {
  const post = (session_id, colleges) => request(app).post('/api/submissions').send({ session_id, colleges });

  test('hides colleges only one student applied to', async () => {
    await post('a', [{ college_name: 'UC Davis' }, { college_name: 'Tiny College' }]);
    await post('b', [{ college_name: 'uc davis' }]);
    const feed = await request(app).get('/api/submissions');
    expect(feed.body.map(r => r.college_name).sort()).toEqual(['UC Davis', 'uc davis']);
  });

  test('spelling variants count as the same college', async () => {
    await post('a', [{ college_name: 'Gavilan' }]);
    await post('b', [{ college_name: 'Gavilan College' }]);
    const feed = await request(app).get('/api/submissions');
    expect(feed.body).toHaveLength(2);
  });

  test('omits first-gen and recruited flags, admin feed keeps them', async () => {
    await post('a', [{ college_name: 'MIT', first_gen: 'yes', sport: 'yes' }]);
    await post('b', [{ college_name: 'MIT' }]);
    const feed = await request(app).get('/api/submissions');
    feed.body.forEach(r => {
      expect(r).not.toHaveProperty('first_gen');
      expect(r).not.toHaveProperty('sport');
    });

    await request(app).post('/api/admin/setup').set('x-admin-secret', 'test-secret')
      .send({ username: 'admin', password: 'correct-horse-battery' });
    const { body: { token } } = await request(app).post('/api/admin/login')
      .send({ username: 'admin', password: 'correct-horse-battery' });
    const admin = await request(app).get('/api/admin/submissions').set('x-admin-token', token);
    expect(admin.status).toBe(200);
    expect(admin.body).toHaveLength(2);
    expect(admin.body.some(r => r.first_gen === 'yes' && r.sport === 'yes')).toBe(true);
    expect(admin.body[0]).not.toHaveProperty('extracurriculars');
    expect(admin.body.map(r => r.session_id)).not.toContain('a');

    const anon = await request(app).get('/api/admin/submissions');
    expect(anon.status).toBe(401);
  });
});

describe('admin password length', () => {
  test('5 characters is enough, 4 is not', async () => {
    const setup = password => request(app).post('/api/admin/setup')
      .set('x-admin-secret', 'test-secret').send({ username: 'Leo', password });
    expect((await setup('1234')).status).toBe(400);
    expect((await setup('12345')).status).toBe(200);
    const login = await request(app).post('/api/admin/login').send({ username: 'leo', password: '12345' });
    expect(login.status).toBe(200);
  });
});

describe('admin daily history', () => {
  test('pages back to the first visit, including empty days', async () => {
    const run = (sql, params = []) => new Promise((resolve, reject) =>
      app._db.run(sql, params, err => err ? reject(err) : resolve()));
    await run("INSERT INTO page_views (session_id, created_at) VALUES ('a', datetime('now','-40 days'))");
    await run("INSERT INTO page_views (session_id, created_at) VALUES ('a', datetime('now','-40 days'))");
    await run("INSERT INTO page_views (session_id, created_at) VALUES ('b', datetime('now'))");
    await request(app).post('/api/admin/setup').set('x-admin-secret', 'test-secret')
      .send({ username: 'admin', password: 'correct-horse' });
    const { body: { token } } = await request(app).post('/api/admin/login')
      .send({ username: 'admin', password: 'correct-horse' });
    const get = q => request(app).get('/api/admin/daily' + q).set('x-admin-token', token);

    const p1 = await get('?limit=30');
    expect(p1.body.days).toHaveLength(30);
    expect(p1.body.days[0].page_views).toBe(1);
    expect(p1.body.days[1].page_views).toBe(0);
    expect(p1.body.hasMore).toBe(true);

    const p2 = await get('?offset=30&limit=30');
    expect(p2.body.days).toHaveLength(11);
    const last = p2.body.days[p2.body.days.length - 1];
    expect(last.date).toBe(p2.body.first);
    expect(last.page_views).toBe(2);
    expect(last.unique_visitors).toBe(1);
    expect(p2.body.hasMore).toBe(false);

    expect((await request(app).get('/api/admin/daily')).status).toBe(401);
  });
});
