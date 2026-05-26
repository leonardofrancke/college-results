from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel
from typing import Optional, List
import sqlite3
import os

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

DB_PATH = os.environ.get("DB_PATH", "/data/submissions.db")
ADMIN_SECRET = os.environ.get("ADMIN_SECRET", "changeme")


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS submissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            grad_year INTEGER,
            gpa REAL,
            gpa_weighted REAL,
            sat INTEGER,
            act INTEGER,
            class_rank INTEGER,
            major TEXT,
            extracurriculars TEXT,
            sport TEXT,
            first_gen TEXT,
            college_name TEXT NOT NULL,
            decision TEXT NOT NULL,
            decision_type TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(session_id, college_name)
        )
    """)
    conn.commit()
    conn.close()


init_db()


class CollegeRow(BaseModel):
    college_name: str
    decision: str
    decision_type: Optional[str] = None


class SubmitRequest(BaseModel):
    session_id: str
    grad_year: int
    gpa: float
    gpa_weighted: Optional[float] = None
    sat: Optional[int] = None
    act: Optional[int] = None
    class_rank: Optional[int] = None
    major: Optional[str] = None
    extracurriculars: Optional[str] = None
    sport: Optional[str] = None
    first_gen: Optional[str] = None
    colleges: List[CollegeRow]


@app.get("/")
def root():
    return FileResponse("index.html")


@app.post("/submit")
def submit(req: SubmitRequest):
    conn = get_db()
    try:
        existing = conn.execute(
            "SELECT college_name FROM submissions WHERE session_id=?", (req.session_id,)
        ).fetchall()
        existing_names = {r["college_name"] for r in existing}
        new_names = {c.college_name for c in req.colleges}

        removed = existing_names - new_names
        if removed:
            placeholders = ",".join("?" * len(removed))
            conn.execute(
                f"DELETE FROM submissions WHERE session_id=? AND college_name IN ({placeholders})",
                (req.session_id, *removed)
            )

        for c in req.colleges:
            conn.execute("""
                INSERT INTO submissions
                    (session_id, grad_year, gpa, gpa_weighted, sat, act, class_rank,
                     major, extracurriculars, sport, first_gen, college_name, decision, decision_type)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(session_id, college_name) DO UPDATE SET
                    grad_year=excluded.grad_year, gpa=excluded.gpa,
                    gpa_weighted=excluded.gpa_weighted, sat=excluded.sat,
                    act=excluded.act, class_rank=excluded.class_rank,
                    major=excluded.major, extracurriculars=excluded.extracurriculars,
                    sport=excluded.sport, first_gen=excluded.first_gen,
                    decision=excluded.decision, decision_type=excluded.decision_type
            """, (
                req.session_id, req.grad_year, req.gpa, req.gpa_weighted,
                req.sat, req.act, req.class_rank, req.major, req.extracurriculars,
                req.sport, req.first_gen, c.college_name, c.decision, c.decision_type
            ))
        conn.commit()
    finally:
        conn.close()
    return {"status": "ok"}


@app.get("/results")
def get_results():
    conn = get_db()
    rows = conn.execute("SELECT * FROM submissions ORDER BY created_at DESC").fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/submissions/mine")
def get_mine(session_id: str = Query(...)):
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM submissions WHERE session_id=? ORDER BY created_at", (session_id,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.delete("/submissions/mine")
def delete_mine(session_id: str = Query(...)):
    conn = get_db()
    conn.execute("DELETE FROM submissions WHERE session_id=?", (session_id,))
    conn.commit()
    conn.close()
    return {"status": "deleted"}


@app.delete("/submissions/{submission_id}")
def delete_by_id(submission_id: int, secret: str = Query(...)):
    if secret != ADMIN_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden")
    conn = get_db()
    result = conn.execute("DELETE FROM submissions WHERE id=?", (submission_id,))
    conn.commit()
    conn.close()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"status": "deleted"}


@app.get("/admin")
def admin_page(secret: str = Query(...)):
    if secret != ADMIN_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden")
    conn = get_db()
    rows = [dict(r) for r in conn.execute(
        "SELECT * FROM submissions ORDER BY created_at DESC"
    ).fetchall()]
    conn.close()
    rows_html = "".join(
        f"<tr><td>{r['id']}</td><td>{r['session_id'][:8]}…</td><td>{r['grad_year']}</td>"
        f"<td>{r['college_name']}</td><td>{r['decision']}</td><td>{r.get('decision_type') or ''}</td>"
        f"<td>{r['gpa']}</td><td>{'✓' if r.get('sport')=='yes' else ''}</td>"
        f"<td>{'✓' if r.get('first_gen')=='yes' else ''}</td>"
        f"<td><button onclick=\"del({r['id']})\">Delete</button></td></tr>"
        for r in rows
    )
    return HTMLResponse(f"""<!DOCTYPE html><html><head><title>Admin</title>
    <style>body{{font-family:sans-serif;padding:2rem;font-size:14px;}}
    table{{border-collapse:collapse;width:100%;}}
    th,td{{border:1px solid #ddd;padding:6px 10px;text-align:left;}}
    th{{background:#f5f5f5;font-weight:600;}}
    button{{background:#dc2626;color:#fff;border:none;padding:3px 10px;border-radius:4px;cursor:pointer;}}
    </style></head><body>
    <h2>Admin — {len(rows)} submissions</h2>
    <table><thead><tr><th>ID</th><th>Session</th><th>Year</th><th>College</th>
    <th>Decision</th><th>Round</th><th>GPA</th><th>Sport</th><th>1st Gen</th><th></th></tr></thead>
    <tbody>{rows_html}</tbody></table>
    <script>
    const S=new URLSearchParams(location.search).get('secret');
    async function del(id){{
      if(!confirm('Delete row '+id+'?'))return;
      await fetch('/submissions/'+id+'?secret='+S,{{method:'DELETE'}});
      location.reload();
    }}
    </script></body></html>""")
