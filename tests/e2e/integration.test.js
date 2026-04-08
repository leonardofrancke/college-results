/**
 * E2E Integration Tests
 *
 * Starts a real HTTP server, runs full request flows including
 * multi-step workflows that exercise the API as a real client would.
 */
const http = require('http');
const { createApp } = require('../helpers/create-app');

let app, server, baseUrl;

beforeAll((done) => {
  app = createApp();
  server = http.createServer(app);
  server.listen(0, () => {
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;
    done();
  });
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await app.cleanup();
});

// Helper: make HTTP requests against the live server
function req(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: { 'Content-Type': 'application/json', ...headers },
    };
    const r = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

// ─── Full user workflow ───

describe('complete user workflow', () => {
  const sessionId = 'e2e-user-flow';

  test('step 1: empty state — no submissions', async () => {
    const res = await req('GET', '/api/submissions');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('step 2: submit initial college list', async () => {
    const res = await req('POST', '/api/submissions', {
      session_id: sessionId,
      colleges: [
        { college_name: 'MIT', gpa: 3.95, sat: 1550, major: 'CS', decision: 'Pending' },
        { college_name: 'Stanford', gpa: 3.95, sat: 1550, major: 'CS', decision: 'Pending' },
        { college_name: 'Georgia Tech', gpa: 3.95, sat: 1550, major: 'CS', decision: 'Pending' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.inserted).toBe(3);
  });

  test('step 3: verify all three are stored', async () => {
    const res = await req('GET', `/api/submissions/${sessionId}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    const names = res.body.map(r => r.college_name).sort();
    expect(names).toEqual(['Georgia Tech', 'MIT', 'Stanford']);
  });

  test('step 4: update — change decisions, remove one college, add another', async () => {
    const res = await req('POST', '/api/submissions', {
      session_id: sessionId,
      colleges: [
        { college_name: 'MIT', gpa: 3.95, sat: 1550, major: 'CS', decision: 'Accepted' },
        { college_name: 'Stanford', gpa: 3.95, sat: 1550, major: 'CS', decision: 'Waitlisted' },
        // Georgia Tech removed
        { college_name: 'Carnegie Mellon', gpa: 3.95, sat: 1550, major: 'CS', decision: 'Pending' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.inserted).toBe(3);
  });

  test('step 5: verify update — Georgia Tech gone, CMU added, decisions updated', async () => {
    const res = await req('GET', `/api/submissions/${sessionId}`);
    expect(res.body).toHaveLength(3);

    const byName = {};
    res.body.forEach(r => byName[r.college_name] = r);

    expect(byName['MIT'].decision).toBe('Accepted');
    expect(byName['Stanford'].decision).toBe('Waitlisted');
    expect(byName['Carnegie Mellon'].decision).toBe('Pending');
    expect(byName['Georgia Tech']).toBeUndefined();
  });

  test('step 6: appears in global submissions list', async () => {
    const res = await req('GET', '/api/submissions');
    expect(res.body.length).toBeGreaterThanOrEqual(3);
  });

  test('step 7: user deletes their data', async () => {
    const res = await req('DELETE', `/api/submissions/${sessionId}`);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(3);
  });

  test('step 8: session data is gone', async () => {
    const res = await req('GET', `/api/submissions/${sessionId}`);
    expect(res.body).toEqual([]);
  });
});

// ─── Admin workflow ───

describe('admin moderation workflow', () => {
  test('admin can delete individual submissions', async () => {
    // Create some data
    await req('POST', '/api/submissions', {
      session_id: 'admin-test',
      colleges: [
        { college_name: 'Fake University', gpa: 5.0, sat: 1600 },
        { college_name: 'Real College', gpa: 3.5, sat: 1300 },
      ],
    });

    // Find the fake one
    const all = await req('GET', '/api/submissions/admin-test');
    const fakeRow = all.body.find(r => r.college_name === 'Fake University');

    // Admin deletes it
    const del = await req('DELETE', `/api/admin/submissions/${fakeRow.id}`, null, {
      'x-admin-secret': 'test-secret',
    });
    expect(del.status).toBe(200);

    // Only Real College remains
    const remaining = await req('GET', '/api/submissions/admin-test');
    expect(remaining.body).toHaveLength(1);
    expect(remaining.body[0].college_name).toBe('Real College');
  });

  test('unauthorized admin access is blocked', async () => {
    const res = await req('DELETE', '/api/admin/submissions/1', null, {
      'x-admin-secret': 'wrong-password',
    });
    expect(res.status).toBe(403);
  });
});

// ─── Concurrent sessions ───

describe('multiple sessions', () => {
  test('different users submitting sequentially do not interfere', async () => {
    const sessions = Array.from({ length: 5 }, (_, i) => `multi-${i}`);

    // Submit sequentially (SQLite serializes writes via transactions)
    for (let i = 0; i < sessions.length; i++) {
      const res = await req('POST', '/api/submissions', {
        session_id: sessions[i],
        colleges: [
          { college_name: `College-A-${i}`, gpa: 3.0 + i * 0.1 },
          { college_name: `College-B-${i}`, gpa: 3.0 + i * 0.1 },
        ],
      });
      expect(res.status).toBe(200);
    }

    // Each session has exactly 2
    for (const sid of sessions) {
      const res = await req('GET', `/api/submissions/${sid}`);
      expect(res.body).toHaveLength(2);
      expect(res.body.every(r => r.session_id === sid)).toBe(true);
    }

    // Global count = 10
    const all = await req('GET', '/api/submissions');
    expect(all.body.length).toBeGreaterThanOrEqual(10);
  });
});

// ─── Edge cases ───

describe('edge cases', () => {
  test('college name with special characters', async () => {
    const res = await req('POST', '/api/submissions', {
      session_id: 'edge-special',
      colleges: [{ college_name: "St. Mary's University — O'Brien Campus" }],
    });
    expect(res.status).toBe(200);

    const check = await req('GET', '/api/submissions/edge-special');
    expect(check.body[0].college_name).toBe("St. Mary's University — O'Brien Campus");
  });

  test('very long extracurriculars text', async () => {
    const longText = 'Activity, '.repeat(200).trim();
    const res = await req('POST', '/api/submissions', {
      session_id: 'edge-long',
      colleges: [{ college_name: 'Test U', extracurriculars: longText }],
    });
    expect(res.status).toBe(200);

    const check = await req('GET', '/api/submissions/edge-long');
    expect(check.body[0].extracurriculars).toBe(longText);
  });

  test('null/missing optional fields stored as null', async () => {
    await req('POST', '/api/submissions', {
      session_id: 'edge-nulls',
      colleges: [{ college_name: 'Minimal U' }],
    });

    const res = await req('GET', '/api/submissions/edge-nulls');
    const row = res.body[0];
    expect(row.gpa).toBeNull();
    expect(row.sat).toBeNull();
    expect(row.act).toBeNull();
    expect(row.major).toBeNull();
    expect(row.sport).toBeNull();
    expect(row.decision).toBeNull();
  });
});
