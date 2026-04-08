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
    await request(app).post('/api/submissions').send({
      session_id: 'sess-1',
      colleges: [{ college_name: 'MIT', gpa: 3.9, sat: 1520 }],
    });

    const res = await request(app).get('/api/submissions');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
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
    expect(row.extracurriculars).toBe('Robotics, Math Team');
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
    await request(app).post('/api/submissions').send({
      session_id: 'sess-b',
      colleges: [{ college_name: 'Harvard' }],
    });

    await request(app).delete('/api/submissions/sess-a');

    const remaining = await request(app).get('/api/submissions');
    expect(remaining.body).toHaveLength(1);
    expect(remaining.body[0].session_id).toBe('sess-b');
  });
});

// ─── DELETE /api/admin/submissions/:id ───

describe('DELETE /api/admin/submissions/:id', () => {
  test('deletes a single row by id with valid secret', async () => {
    await request(app).post('/api/submissions').send({
      session_id: 'sess-1',
      colleges: [{ college_name: 'MIT' }, { college_name: 'Harvard' }],
    });

    const all = await request(app).get('/api/submissions');
    const mitId = all.body.find(r => r.college_name === 'MIT').id;

    const res = await request(app)
      .delete(`/api/admin/submissions/${mitId}`)
      .set('x-admin-secret', 'test-secret');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const remaining = await request(app).get('/api/submissions');
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
          { college_name: `${s}-college-1` },
          { college_name: `${s}-college-2` },
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
