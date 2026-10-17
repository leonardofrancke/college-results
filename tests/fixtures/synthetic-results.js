// Synthetic submissions for local browser tests. Every value is invented;
// nothing here comes from the live site. Deterministic, so screenshots and
// assertions are stable. IDs all start with "synthetic-".
//
// Coverage: UC/CSU/community/private/out-of-state colleges, spelling variants
// that the chart merges (Gavilan / Gavilan College / Gavillan, CSUMB / Cal State
// Monterey Bay), apostrophes and ampersands, a very long name, enrolling and
// scholarship flags, and every decision value.

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9 >>> 0) / 0x100000000);
}

const LONG_NAME = 'University of Synthetic Testing at Very Long Campus Name for Layout Checks & Engineering';

const COLLEGES = [
  ['UC Davis', 'University'], ['UC Santa Cruz', 'University'], ['UC Santa Barbara', 'University'],
  ['UC Berkeley', 'University'], ['San Jose State', 'University'], ['Cal Poly SLO', 'University'],
  ['Chico State', 'University'], ['CSUMB', 'University'], ['Cal State Monterey Bay', 'University'],
  ['Gavilan College', 'Community'], ['Gavilan', 'Community'], ['Gavillan', 'Community'],
  ['De Anza', 'Community'], ['Stanford', 'University'], ["Saint Mary's College of California", 'University'],
  ['Texas A&M', 'University'], ['University of Nevada Reno', 'University'], [LONG_NAME, 'University'],
];
const MAJORS = ['Computer Science', 'Biology', "Women's Studies", 'Science & Society', 'Business', 'Undeclared', 'Nursing', null];
const DECISIONS = ['Accepted', 'Accepted', 'Accepted', 'Rejected', 'Waitlisted', 'Pending'];
const ROUNDS = ['RD', 'RD', 'EA', 'ED', 'Rolling'];

function buildSyntheticSubmissions(count = 32) {
  const r = rng(20261016);
  const pick = a => a[Math.floor(r() * a.length)];
  const out = [];
  for (let i = 0; i < count; i++) {
    const gpa = +(2.6 + r() * 1.4).toFixed(2);
    const weighted = +Math.min(5, gpa + r() * 0.7).toFixed(2);
    const sat = r() < 0.5 ? 10 * Math.round((1000 + r() * 550) / 10) : null;
    const major = pick(MAJORS);
    const n = 2 + Math.floor(r() * 4);
    const chosen = new Set();
    while (chosen.size < n) chosen.add(pick(COLLEGES));
    let enrolled = false;
    const colleges = [...chosen].map(([name, type]) => {
      const decision = type === 'Community' ? 'Accepted' : pick(DECISIONS);
      const enrolling = !enrolled && decision === 'Accepted' && r() < 0.5 ? 'yes' : null;
      if (enrolling) enrolled = true;
      return {
        college_name: name, school_type: type, decision,
        decision_type: type === 'Community' ? 'Rolling' : pick(ROUNDS),
        grad_year: 2026, gpa, gpa_weighted: weighted, sat,
        act: r() < 0.2 ? 20 + Math.floor(r() * 15) : null,
        class_rank: r() < 0.4 ? 1 + Math.floor(r() * 300) : null,
        major, essay_rating: r() < 0.5 ? 1 + Math.floor(r() * 5) : null,
        enrolling, scholarship: decision === 'Accepted' && r() < 0.25 ? 'yes' : null,
      };
    });
    out.push({ session_id: `synthetic-${String(i + 1).padStart(3, '0')}`, colleges });
  }
  // Two submitters for the long name and both special-character names, so the
  // public feed (2+ students per college) is guaranteed to include them.
  for (const [k, name] of [[901, LONG_NAME], [902, LONG_NAME], [903, "Saint Mary's College of California"], [904, "Saint Mary's College of California"], [905, 'Texas A&M'], [906, 'Texas A&M']]) {
    out.push({ session_id: `synthetic-${k}`, colleges: [{
      college_name: name, school_type: 'University', decision: k % 2 ? 'Accepted' : 'Waitlisted',
      decision_type: 'RD', grad_year: 2026, gpa: 3.5, gpa_weighted: 4.1, sat: 1300, major: 'Science & Society',
    }] });
  }
  return out;
}

module.exports = { buildSyntheticSubmissions, LONG_NAME };
