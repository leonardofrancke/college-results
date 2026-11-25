// ── Constants ──────────────────────────────────────────────────────────────
// Deferred and Withdrawn removed for now — zero existing submissions used
// either, so this is a clean cut, not a data migration.
const DECISIONS = ['Accepted','Rejected','Waitlisted','Pending'];
const DECISION_ORDER = ['Accepted','Waitlisted','Rejected','Pending'];
// Colours are CSS custom properties (see app.css), one class per decision.
const PILL_CLASS = {Accepted:'dp-acc',Rejected:'dp-den',Waitlisted:'dp-wl',Pending:'dp-pnd'};

// Decisions were distinguished by colour alone, and green-vs-red is the exact
// pair red-green colourblind readers cannot separate — roughly 1 in 12 men. On
// a chart whose whole point is "who got in", that made it unreadable. Each
// decision now also has its own shape, so colour is reinforcement rather than
// the only signal. Colours themselves are pulled from a colorblind-validated
// categorical palette (dataviz skill), adjacent-pair checked in this exact
// legend order against both the light and dark chart surfaces.
const DECISION_SHAPE = {
  Accepted:'circle', Rejected:'square', Waitlisted:'triangle', Pending:'star'
};

// Returns path geometry centred on (x,y). Absolute coordinates rather than a
// transform attribute, so the FLIP animation can own the CSS transform without
// the two fighting over the same property.
function shapePath(shape, x, y, r) {
  switch (shape) {
    case 'square': {
      const s = r * 0.9;
      return `M${x-s},${y-s}H${x+s}V${y+s}H${x-s}Z`;
    }
    case 'triangle': {
      const h = r * 1.15;
      return `M${x},${y-h}L${x+h},${y+h*0.75}L${x-h},${y+h*0.75}Z`;
    }
    case 'triangleDown': {
      const h = r * 1.15;
      return `M${x},${y+h}L${x+h},${y-h*0.75}L${x-h},${y-h*0.75}Z`;
    }
    case 'diamond': {
      const d = r * 1.25;
      return `M${x},${y-d}L${x+d},${y}L${x},${y+d}L${x-d},${y}Z`;
    }
    case 'star': {
      let p = '';
      for (let i = 0; i < 10; i++) {
        const rad = (i % 2 === 0) ? r * 1.35 : r * 0.55;
        const a = (-90 + i * 36) * Math.PI / 180;
        p += (i ? 'L' : 'M') + (x + Math.cos(a)*rad).toFixed(2) + ',' + (y + Math.sin(a)*rad).toFixed(2);
      }
      return p + 'Z';
    }
    default: return null;   // circle handled with <circle>
  }
}

// One dot, as the right shape for its decision.
function dotSvg(decision, x, y, r, attrs) {
  const shape = DECISION_SHAPE[decision] || 'circle';
  const d = shapePath(shape, +x, +y, r);
  return d
    ? `<path d="${d}" ${attrs}/>`
    : `<circle cx="${x}" cy="${y}" r="${r}" ${attrs}/>`;
}

// ── College categorization ─────────────────────────────────────────────────
const IVY_SET = new Set(['Harvard','Princeton','Yale','Columbia','Brown','Dartmouth','Cornell','Penn','University of Pennsylvania','UPenn']);
const T20_SET = new Set([
  'Harvard','Princeton','MIT','Stanford','Yale','Caltech','UChicago','Johns Hopkins',
  'Penn','UPenn','University of Pennsylvania','Duke','Northwestern','Columbia','Cornell',
  'Brown','Dartmouth','Vanderbilt','Rice','Notre Dame','WashU','UCLA','UC Berkeley',
]);
const LAC_SET = new Set([
  'Swarthmore','Amherst','Williams','Bowdoin','Middlebury','Colby','Bates','Hamilton',
  'Colgate','Vassar','Wesleyan','Haverford','Bryn Mawr','Wellesley','Barnard','Smith',
  'Mount Holyoke','Davidson','Oberlin','Kenyon','Grinnell','Carleton','Macalester','Reed',
  'Whitman','Bucknell','Lafayette','Dickinson','Skidmore','Trinity','Connecticut College',
  'Pomona','Claremont McKenna','Scripps','Pitzer','Harvey Mudd','Occidental',
]);
const UC_RE = /^UC |^University of California/i;
const CSU_RE = /\bCSUMB\b|Cal State|California State|San Jose State|San Francisco State|Fresno State|Sacramento State|Chico State|Humboldt State|Sonoma State|Cal Maritime|Cal Poly/i;
const PUBLIC_SET = new Set([
  'UC Berkeley','UCLA','UCSD','UC Santa Barbara','UC Davis','UC Irvine','UC Santa Cruz','UC Riverside','UC Merced',
  'Cal Poly SLO','Cal Poly Pomona','Cal State Long Beach','San Jose State','San Francisco State','Fresno State',
  'Sacramento State','Cal State Fullerton','Cal State Northridge','Sonoma State','Cal State East Bay','Chico State',
  'Cal State San Bernardino','Cal State Dominguez Hills','Cal State Los Angeles','Cal State Monterey Bay',
  'Cal State Channel Islands','Cal State San Marcos','Cal State Bakersfield','Humboldt State','Cal Maritime',
  'Michigan','UVA','UNC Chapel Hill','Georgia Tech','University of Florida','Wisconsin','Ohio State','Penn State',
  'UT Austin','UIUC','Purdue','University of Washington','University of Maryland','University of Georgia',
  'Michigan State','Indiana University','University of Iowa','Arizona State','University of Arizona',
  'Colorado State','University of Alabama','University of South Carolina','University of Tennessee',
  'University of Kentucky','University of Pittsburgh','Virginia Tech','Clemson','University of Delaware',
  'UConn','UMass Amherst','University of Vermont','UNH','Rutgers','Stony Brook','University at Buffalo',
  'George Mason','JMU','University of Oregon','Oregon State','Colorado','Texas A&M','UT Dallas',
]);
// Students type college names freely, so the same school arrives as "Gavilan
// college", "Gavilan" and "Gavillan", and school_type is whatever each student
// happened to pick — Gavilan is currently tagged Community by some and
// University by others. Classification therefore has to be derived from the
// name, not trusted from the row.
const JUCO_RE = /^mission$|gavil+an|gavillan|evergreen valley|de anza|west valley|mission college|foothill|san jose city|miramar|american river|lemoore|victor valley|hartnell|cabrillo|canada college|ohlone|chabot|las positas|community college|\bjc\b/i;

// Public 4-years students actually applied to that the whitelist misses.
const PUBLIC_EXTRA_RE = /nevada|reno|csumb|monterey bay|boise state|southern oregon|ohio state|texas at dallas|arizona state|grand canyon/i;

// Collapses "Gavilan college" / "Gavilan" / "Gavillan" and
// "CSUMB" / "Cal State Monterey Bay" onto one key.
// Escape text for insertion into HTML. Needed where a value can come from the
// URL (e.g. ?college=) rather than from server-cleaned submission data.
function escHtml(v) {
  return String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// "State" is dropped only as part of "Cal State", never on its own: it used to
// be, which would have counted "Arizona State" and "University of Arizona" (or
// the two San Francisco schools) as one college.
function canonKey(name) {
  return String(name || '').toLowerCase()
    .replace(/\bcsumb\b/g, 'cal state monterey bay')
    .replace(/\b(cal|california) state( university)?\b,?/g, '')
    .replace(/\b(university|college|the|of|at)\b/g, '')
    .replace(/gavill?an/g, 'gavilan')
    .replace(/[^a-z]/g, '');
}

// Free-text college names collect spelling variants ("Gavilan college" vs
// "Gavilan"); group rows by canonKey and pick each group's most common
// actual spelling as the display name. Shared by the scatter chart and the
// school-profile "top colleges" list so a school never fragments into
// multiple, individually-undercounted entries in one view but not the other.
function canonicalNames(data) {
  const canonical = new Map();   // canonKey -> display name
  const nameCount = new Map();   // raw name -> occurrences
  data.forEach(r => {
    if (!r.college_name || r.college_name.toLowerCase() === 'none') return;
    const k = canonKey(r.college_name);
    nameCount.set(r.college_name, (nameCount.get(r.college_name)||0)+1);
    if (!canonical.has(k) || (nameCount.get(r.college_name)||0) > (nameCount.get(canonical.get(k))||0))
      canonical.set(k, r.college_name);
  });
  return canonical;
}

// Display only: the chart and statistics tidy capitals ("grand canyon
// university"). The student list keeps every name exactly as typed.
const SMALL_WORDS = new Set(['of', 'at', 'the', 'and', 'in', 'for']);
function prettyName(n) {
  return String(n || '').trim().replace(/\S+/g, (w, i) =>
    /^[a-z]{2,}$/.test(w) && (i === 0 || !SMALL_WORDS.has(w)) ? w[0].toUpperCase() + w.slice(1) : w);
}
function displayNamer(rows) {
  const map = canonicalNames(rows);
  return n => prettyName(map.get(canonKey(n)) || n);
}

function isOpenAdmission(row) {
  const name = row.college_name || '';
  if (JUCO_RE.test(name)) return true;
  // Trust an explicit Community tag only when nothing contradicts it.
  return (row.school_type === 'Community');
}

function isPublic(name) {
  if (IVY_SET.has(name)) return false;
  if (UC_RE.test(name)) return true;
  if (CSU_RE.test(name)) return true;
  if (PUBLIC_EXTRA_RE.test(name)) return true;
  if (JUCO_RE.test(name)) return true;          // community colleges are public
  return PUBLIC_SET.has(name);
}
function matchesCollegeFilter(row, filter) {
  const name = row.college_name;
  const st = (row.school_type || 'University');
  if (filter === 'All') return true;
  if (filter === 'T20') return T20_SET.has(name);
  if (filter === 'Ivies') return IVY_SET.has(name);
  if (filter === 'LACs') return LAC_SET.has(name);
  if (filter === 'UCs') return UC_RE.test(name);
  if (filter === 'CSUs') return CSU_RE.test(name);
  // Community colleges are neither Public-4yr nor Private — they get their own
  // tab. Without this guard Gavilan lands in Private purely because it isn't on
  // the public whitelist.
  if (filter === 'Public')  return !isOpenAdmission(row) && st !== 'Trade' && isPublic(name);
  if (filter === 'Private') return !isOpenAdmission(row) && st !== 'Trade' && !isPublic(name);
  if (filter === 'Community') return isOpenAdmission(row);
  if (filter === 'Trade') return st === 'Trade';
  return true;
}
const COLLEGE_FILTER_TABS = ['All','UCs','CSUs','Public','Private','T20','Ivies','Community','Trade','LACs'];

const COLLEGE_ACCEPT_RATES = {
  'Harvard':3,'Princeton':4,'MIT':4,'Yale':5,'Columbia':4,'Stanford':4,'Caltech':4,
  'Penn':7,'UPenn':7,'University of Pennsylvania':7,'Brown':6,'Dartmouth':6,'Cornell':8,
  'Duke':7,'Northwestern':7,'Johns Hopkins':7,'Harvey Mudd':10,'Olin College':10,
  'Vanderbilt':7,'Rice':9,'WashU':11,'Notre Dame':13,'Georgetown':13,
  'Emory':14,'Carnegie Mellon':12,'Tufts':11,'Northeastern':6,'Tulane':13,
  'Wake Forest':25,'USC':13,'NYU':12,'Boston College':19,'Boston University':18,
  'Case Western':30,'University of Rochester':30,'Lehigh':34,'University of Miami':27,
  'Villanova':28,'University of Richmond':28,'William & Mary':37,'SMU':50,'TCU':48,'Baylor':45,
  'UC Berkeley':14,'UCLA':9,'UCSD':28,'UC Santa Barbara':38,'UC Davis':45,
  'UC Irvine':26,'UC Santa Cruz':73,'UC Riverside':57,'UC Merced':69,
  'Cal Poly SLO':30,'Cal Poly Pomona':55,'Cal State Long Beach':47,
  'San Jose State':85,'San Francisco State':58,'Fresno State':77,'Sacramento State':94,
  'Cal State Fullerton':67,'Cal State Northridge':92,'Sonoma State':90,'Cal State East Bay':73,
  'Chico State':93,'Cal State San Bernardino':75,'Cal State Dominguez Hills':63,
  'Cal State Los Angeles':64,'Cal State Monterey Bay':96,'Cal State Channel Islands':79,
  'Cal State San Marcos':79,'Cal State Bakersfield':78,'Humboldt State':92,'Cal Maritime':72,
  'LMU':50,'Santa Clara':48,'University of San Diego':52,'Pepperdine':37,
  'University of San Francisco':67,'Chapman':65,'Occidental':38,'University of the Pacific':60,
  'Whittier College':73,'Azusa Pacific':72,'Biola University':61,'Point Loma Nazarene':72,
  'Westmont':75,'Cal Lutheran':68,"Saint Mary's College of California":71,
  'Claremont McKenna':9,'Scripps':22,'Pitzer':14,'Pomona':8,
  'Michigan':16,'UVA':21,'UNC Chapel Hill':19,'Georgia Tech':13,'University of Florida':24,
  'Wisconsin':49,'Ohio State':61,'Penn State':55,'UT Austin':31,'UIUC':45,'Purdue':43,
  'University of Washington':48,'University of Maryland':44,'University of Georgia':42,
  'Michigan State':76,'Indiana University':80,'University of Iowa':85,'Arizona State':88,
  'University of Arizona':85,'Colorado State':90,'University of Alabama':80,
  'University of South Carolina':67,'University of Tennessee':67,'University of Kentucky':95,
  'University of Pittsburgh':49,'Virginia Tech':65,'Clemson':47,'University of Delaware':65,
  'UConn':56,'UMass Amherst':58,'University of Vermont':63,'UNH':80,'Rutgers':61,
  'Stony Brook':49,'University at Buffalo':58,'George Mason':82,'JMU':71,
  'University of Oregon':82,'Oregon State':77,'Colorado':77,'University of Denver':60,
  'Texas A&M':63,'UT Dallas':45,
  'Swarthmore':7,'Amherst':9,'Williams':9,'Bowdoin':9,'Middlebury':15,'Colby':11,
  'Bates':13,'Hamilton':14,'Colgate':22,'Vassar':24,'Wesleyan':17,'Haverford':15,
  'Bryn Mawr':31,'Wellesley':20,'Barnard':11,'Smith':33,'Mount Holyoke':52,
  'Davidson':19,'Oberlin':33,'Kenyon':36,'Grinnell':12,'Carleton':19,'Macalester':36,
  'Reed':35,'Whitman':42,'Bucknell':38,'Lafayette':36,'Dickinson':47,'Skidmore':42,
  'Trinity':34,'Connecticut College':35,
  'RPI':57,'RIT':57,'WPI':49,'Drexel':68,'Temple':68,'Syracuse':60,'Fordham':46,
  'American University':62,'GWU':41,'Howard':37,'Spelman':37,'Morehouse':48,
  'Elon':72,'Furman':65,'College of Charleston':79,'Gonzaga':72,
  'Loyola Chicago':68,'Marquette':82,'Butler':73,
};
const ALL_COLLEGES = Object.keys(COLLEGE_ACCEPT_RATES).sort();

const ALL_MAJORS = [
  'Accounting','Aerospace Engineering','African American Studies','Agriculture','Anthropology',
  'Architecture','Art','Art History','Biochemistry','Biology','Biomedical Engineering',
  'Business','Business Administration','Chemical Engineering','Chemistry','Civil Engineering',
  'Classics','Cognitive Science','Communication','Computer Engineering','Computer Science',
  'Creative Writing','Criminal Justice','Data Science','Economics','Education',
  'Electrical Engineering','English','Environmental Science','Environmental Studies',
  'Film','Finance','Fine Arts','French','Gender Studies','Geography','Geology',
  'Global Studies','Graphic Design','History','Human Biology','Humanities',
  'Industrial Engineering','Information Systems','International Business',
  'International Relations','Italian','Japanese','Journalism','Kinesiology',
  'Latin American Studies','Law','Linguistics','Management','Marine Biology',
  'Marketing','Mathematics','Mechanical Engineering','Media Studies','Medicine',
  'Music','Neuroscience','Nursing','Nutrition','Philosophy','Physics',
  'Political Science','Pre-Dental','Pre-Law','Pre-Med','Pre-Pharmacy','Pre-Veterinary',
  'Psychology','Public Health','Public Policy','Religious Studies','Russian',
  'Social Work','Sociology','Software Engineering','Spanish','Statistics',
  'Studio Art','Supply Chain','Sustainability','Theater','Undeclared',
  'Urban Studies','Women\'s Studies',
];

// Alternate names for schools already in the main table above, plus a few
// more Live Oak students applied to. Sourced individually — see note below.
Object.assign(COLLEGE_ACCEPT_RATES, {
  'UC San Diego': 28, 'University of Michigan': 16, 'Chapman University': 65,
  'CSUMB': 96,
  'University of Nevada Reno': 85, 'Boise State University': 84,
  'Southern Oregon University': 89, 'Grand Canyon University': 60,
  'Northwest Nazarene': 65, 'Cal Poly Humboldt': 92,
});
// NOTE (2026-08-23): the CSU and UC figures above were found to be stale by
// roughly 10-25 points in several cases — e.g. Cal State Long Beach was
// listed at 33% against a real ~47%, UC Santa Cruz at 47% against a real
// ~73%. Application volume at CSU/UC campuses shifted enough in the last two
// admissions cycles that these need occasional rechecking; the ~150 schools
// elsewhere in this table have not all been individually reverified.

function getAcceptRate(name) {
  if (COLLEGE_ACCEPT_RATES[name]) return COLLEGE_ACCEPT_RATES[name];
  // "state university" was previously stripped as one joined phrase, which
  // deletes "state" from names like "Ohio state university" — losing the word
  // the table's "Ohio State" key actually needs to match on. "university" and
  // "college" are stripped individually instead; "state" is left alone.
  const norm = n => n.replace(/\b(university|college|institute of technology)\b/gi,'').replace(/\s+/g,' ').trim().toLowerCase();
  const m = Object.keys(COLLEGE_ACCEPT_RATES).find(k => norm(k) === norm(name));
  if (m) return COLLEGE_ACCEPT_RATES[m];
  const p = Object.keys(COLLEGE_ACCEPT_RATES).find(k => { const kn=norm(k); return norm(name).includes(kn)||kn.includes(norm(name)); });
  return p ? COLLEGE_ACCEPT_RATES[p] : null;
}

// ── Session ────────────────────────────────────────────────────────────────
const SESSION_ID = localStorage.getItem('cr_sid') || (()=>{
  const id = Math.random().toString(36).slice(2)+Date.now().toString(36);
  localStorage.setItem('cr_sid', id); return id;
})();
const HAS_SUBMITTED = () => localStorage.getItem('cr_submitted') === '1';

// ── Chart metrics ──────────────────────────────────────────────────────────────────
// One row per college, GPA (or SAT) left to right, one mark per decision.
// Colours come from CSS classes, so a theme change needs no redraw.
const METRICS = {
  uw:  { key: 'gpa',          label: 'unweighted GPA', title: 'Unweighted GPA', min: 1,   max: 4,    ticks: [1, 1.5, 2, 2.5, 3, 3.5, 4],       fmt: v => v.toFixed(1) },
  gpa: { key: 'gpa_weighted', label: 'weighted GPA',   title: 'Weighted GPA',   min: 1,   max: 5,    ticks: [1, 2, 3, 4, 5],                    fmt: v => v.toFixed(1) },
  sat: { key: 'sat',          label: 'SAT',            title: 'SAT score',      min: 400, max: 1600, ticks: [400, 700, 1000, 1300, 1600],       fmt: v => String(v) },
};

// ── State ──────────────────────────────────────────────────────────────────
let allData = [], scatterData = [], collegeCount = 0, activeCollegeFilter = 'All';
let activeChartType = 'uw', searchFilter = '', activeFilter = null, slmFilter = null;
let chartExpanded = false;   // false: colleges with one report are folded away
let entriesShown = 0;        // how many student cards are on screen
let view = 'colleges';        // colleges | numbers | students
let chartSort = 'apps';
let savedOnly = false;
const STUDENT_DEFAULTS = { sort: 'shared', dir: 'desc', college: '', flags: [], q: '' };
let stu = { ...STUDENT_DEFAULTS };
const CHART_MIN_ROWS = 10, ENTRIES_PAGE = 10;
// Below this many decisions a percentage says nothing, so only counts show.
const MIN_RATE_N = 5;
const admitted = (a, n) => n >= MIN_RATE_N ? `${a} of ${n} (${Math.round(a / n * 100)}%)` : `${a} of ${n}`;
// Honour the OS "reduce motion" setting everywhere: every effect below checks
// this and falls back to showing the final state immediately.
const REDUCED_MOTION = window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let currentPage = 'results';
let _openCollegeName = null; // for URL sync only — which college's modal is open
let _suppressUrlWrite = false; // true while popstate is restoring, so restoring doesn't itself push history
let _loadSeq = 0, _loadState = 'idle', _dataLoadedAt = null; // results feed request state
let _chartCols = [];         // display names of the chart's current rows, in order
let _chartRovingKey = null;  // canonKey of the college holding the chart's single Tab stop
let _openModalId = null, _modalReturn = null;

// ── URL state sync ───────────────────────────────────────────────────────
// The tab, category, metric, searches, sorts, filters and the open college are
// in the query string, so views can be shared and Back works. "Students like
// me" (a student's own GPA and scores) and saved colleges are deliberately kept
// out of it: they are personal, and URLs get shared and logged.
const VIEWS = ['colleges', 'numbers', 'students'];
function readStateFromUrl() {
  const p = new URLSearchParams(location.search);
  const pick = (k, list, def) => list.includes(p.get(k)) ? p.get(k) : def;
  return {
    page: p.get('page') === 'submit' ? 'submit' : 'results',
    view: pick('view', VIEWS, 'colleges'),
    chart: pick('chart', Object.keys(METRICS), 'uw'),
    schools: pick('schools', COLLEGE_FILTER_TABS, 'All'),
    sort: pick('sort', Object.keys(CHART_SORTS), 'apps'),
    q: p.get('q') || '',
    decision: pick('decision', DECISION_ORDER, null),
    college: p.get('college') || null,
    stu: {
      sort: pick('by', Object.keys(STUDENT_SORTS), 'shared'),
      dir: pick('dir', ['asc', 'desc'], null) || STUDENT_SORTS[pick('by', Object.keys(STUDENT_SORTS), 'shared')].dir,
      college: p.get('at') || '',
      flags: (p.get('only') || '').split(',').filter(f => STUDENT_FLAGS[f]),
      q: p.get('find') || '',
    },
  };
}
function writeUrlState(push) {
  const p = new URLSearchParams();
  if (currentPage !== 'results') p.set('page', currentPage);
  if (view !== 'colleges') p.set('view', view);
  if (activeChartType !== 'uw') p.set('chart', activeChartType);
  if (chartSort !== 'apps') p.set('sort', chartSort);
  if (activeCollegeFilter !== 'All') p.set('schools', activeCollegeFilter);
  if (searchFilter) p.set('q', searchFilter);
  if (activeFilter) p.set('decision', activeFilter);
  if (stu.sort !== 'shared') p.set('by', stu.sort);
  if (stu.dir !== STUDENT_SORTS[stu.sort].dir) p.set('dir', stu.dir);
  if (stu.college) p.set('at', stu.college);
  if (stu.flags.length) p.set('only', stu.flags.join(','));
  if (stu.q) p.set('find', stu.q);
  if (_openCollegeName) p.set('college', _openCollegeName);
  const qs = p.toString();
  const url = location.pathname + (qs ? '?' + qs : '');
  if (push) history.pushState({}, '', url);
  else history.replaceState({}, '', url);
}
// Push state vars into the controls that don't re-render themselves.
function syncControlsToState() {
  const search = document.getElementById('college-search');
  if (search && search.value.toLowerCase().trim() !== searchFilter) search.value = searchFilter;
  document.querySelectorAll('[data-metric]').forEach(b =>
    b.setAttribute('aria-pressed', b.dataset.metric === activeChartType ? 'true' : 'false'));
  document.getElementById('chart-sort').value = chartSort;
  syncView();
}

// ── Navigation ────────────────────────────────────────────────────────────
function updateNav() {
  const sub = HAS_SUBMITTED();
  document.getElementById('nav-submit').textContent = sub ? 'Edit Submission' : 'Submit yours';
  document.documentElement.classList.toggle('no-cta', sub);
}

// ── Page transitions ───────────────────────────────────────────────────────
function showPage(name, opts) {
  const fromPopstate = !!(opts && opts.fromPopstate);
  if (name === currentPage) return;
  const oldEl = document.getElementById('page-' + currentPage);
  const newEl = document.getElementById('page-' + name);

  document.querySelectorAll('.nav-link').forEach(l => { l.classList.remove('active'); l.removeAttribute('aria-current'); });
  const navEl = document.getElementById('nav-' + name);
  navEl.classList.add('active');
  navEl.setAttribute('aria-current', 'page');
  updateNav();
  setDocTitle(name);

  if (REDUCED_MOTION) {
    oldEl.classList.remove('active');
    newEl.classList.add('active');
    currentPage = name;
    syncView();
    if (!fromPopstate) writeUrlState(true);
    if (name === 'results') loadData();
    if (name === 'submit') loadExistingSubmission();
    if (opts && opts.focus) focusPageStart(name);
    return;
  }

  oldEl.style.cssText = 'opacity:0;transform:translateY(-5px);transition:opacity 0.16s ease,transform 0.16s ease;pointer-events:none;';

  setTimeout(() => {
    oldEl.classList.remove('active');
    oldEl.style.cssText = '';
    newEl.style.cssText = 'opacity:0;transform:translateY(10px);transition:none;display:block;';
    void newEl.offsetWidth;
    newEl.style.cssText = 'opacity:0;transform:translateY(10px);transition:opacity 0.22s ease,transform 0.22s cubic-bezier(0.16,1,0.3,1);display:block;';
    void newEl.offsetWidth;
    newEl.style.opacity = '1';
    newEl.style.transform = 'translateY(0)';
    setTimeout(() => {
      newEl.style.cssText = '';
      newEl.classList.add('active');
      currentPage = name;
      syncView();
      if (!fromPopstate) writeUrlState(true);
      if (name === 'results') loadData();
      if (name === 'submit') loadExistingSubmission();
      if (opts && opts.focus) focusPageStart(name);
    }, 220);
  }, 160);
}

// After a nav link switches views, put keyboard focus at the start of the new
// view instead of leaving it on a link in the other one. Results has a real
// heading; the submit view's title is part of the untouched form, so focus
// goes to the main region there.
function focusPageStart(name) {
  const target = name === 'results'
    ? document.getElementById('results-title')
    : document.getElementById('main-content');
  if (target) target.focus();
}
function setDocTitle(name) {
  document.title = name === 'submit' ? 'Submit your results — College Results — Live Oak'
    : (view === 'numbers' ? 'Numbers — ' : view === 'students' ? 'Students — ' : '') + 'College Results — Live Oak';
}

// ── Data ───────────────────────────────────────────────────────────────────
async function loadData() {
  // Results load in three distinct outcomes: fresh data, a failed request,
  // or a response that isn't the expected list. Only fresh data replaces what
  // is on screen; a failure keeps the last good data and says how old it is.
  // A sequence number drops responses that arrive after a newer request.
  const seq = ++_loadSeq;
  setLoadState('loading');
  let rows;
  try {
    const res = await fetch('/api/submissions');
    if (!res.ok) throw { kind: 'http', status: res.status };
    let json;
    try { json = await res.json(); } catch (e) { throw { kind: 'malformed' }; }
    if (!Array.isArray(json)) throw { kind: 'malformed' };
    rows = json.filter(r => r && typeof r === 'object');
  } catch (e) {
    if (seq !== _loadSeq) return;
    setLoadState('error', e && e.kind ? e : { kind: 'network' });
    return;
  }
  if (seq !== _loadSeq) return;
  allData = rows;
  _dataLoadedAt = new Date();
  setLoadState('ready');
  renderResults();
}

function setLoadState(state, err) {
  _loadState = state;
  const box = document.getElementById('load-status');
  if (!box) return;
  box.textContent = '';
  box.removeAttribute('role');
  if (state === 'loading') {
    // Only announce the first load; quiet background refreshes stay quiet.
    if (!_dataLoadedAt) { box.setAttribute('role', 'status'); box.textContent = 'Loading results…'; }
    return;
  }
  if (state !== 'error') return;
  const reason = err.kind === 'http'
    ? (err.status === 429 ? 'Too many requests right now.' : `The server returned an error (${err.status}).`)
    : err.kind === 'malformed' ? 'The server sent a response this page could not read.'
    : 'The server could not be reached. Check your connection.';
  const wrap = document.createElement('div');
  wrap.className = 'load-error';
  wrap.setAttribute('role', 'alert');
  const msg = document.createElement('span');
  msg.textContent = _dataLoadedAt
    ? `Couldn't refresh results. ${reason} Still showing results loaded at ${_dataLoadedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
    : `Couldn't load results. ${reason}`;
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.dataset.action = 'retry-load';
  retry.textContent = 'Try again';
  wrap.append(msg, retry);
  box.appendChild(wrap);
  if (!_dataLoadedAt) document.getElementById('page-meta').textContent = 'Results unavailable';
}

// The page shows one set of rows: Class of 2026, in the selected school
// category, from students who match "Students like me". scatterData is that
// set before the student filter, because the chart keeps non-matching dots as
// faint context.
function getViewData() {
  const allYear = allData.filter(r => r.grad_year == 2026);
  return activeCollegeFilter === 'All'
    ? allYear
    : allYear.filter(r => matchesCollegeFilter(r, activeCollegeFilter));
}
const viewRows = () => scatterData.filter(slmMatches);
const studentKey = r => r.session_id || `${r.gpa}|${r.sat}|${r.act}|${r.major}`;
const isNoCollege = r => !r.college_name || r.college_name.trim().toLowerCase() === 'none';

// opts.motion: rows and dots glide to their new places (off for typing).
function renderResults(opts) {
  updateCollegeFilterTabs();
  scatterData = getViewData();
  populateMajorOptions();
  const rows = viewRows();
  renderSummary(rows);
  renderField(rows);
  renderYou(rows);
  renderSlmChips();
  buildChart({ motion: !!(opts && opts.motion) });
  renderStatsInline(rows);
  entriesShown = ENTRIES_PAGE;
  renderEntries(rows);
  initStatsDisclaimerGate();
}

// The category buttons are in the page's HTML; only their state changes, so
// keyboard focus stays on the button that was just pressed.
function updateCollegeFilterTabs() {
  const bar = document.getElementById('college-filter-bar');
  const year = allData.filter(r => r.grad_year == 2026 && !isNoCollege(r) && slmMatches(r));
  bar.querySelectorAll('[data-schools]').forEach(b => {
    if (_dataLoadedAt) {
      const n = new Set(year.filter(r => matchesCollegeFilter(r, b.dataset.schools)).map(studentKey)).size;
      let c = b.querySelector('.n');
      if (!c) { c = document.createElement('span'); c.className = 'n'; c.setAttribute('aria-hidden', 'true'); b.appendChild(c); }
      c.textContent = n;
      b.classList.toggle('is-empty', !n);
    }
    const on = b.dataset.schools === activeCollegeFilter;
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (!on) return;
    // Keep the selected category in view in the sideways-scrolling strip.
    const l = b.offsetLeft - bar.offsetLeft;
    if (l < bar.scrollLeft || l + b.offsetWidth > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = Math.max(0, l - 40);
  });
}

function setCollegeFilter(f, opts) {
  activeCollegeFilter = f;
  // Analytics fire only from the category buttons themselves, exactly as
  // before; "Show all schools" shortcuts added for empty states don't record.
  if (!(opts && opts.track === false)) trackEvent('filter_click', f);
  activeFilter = null;
  writeUrlState(true);
  renderResults({ motion: true });
  announceChart();
}

// ── Summary sentence ───────────────────────────────────────────────────────
const CATEGORY_NOUN = {
  UCs: 'a UC', CSUs: 'a CSU', Public: 'a public four-year college', Private: 'a private college',
  T20: 'a top-20 college', Ivies: 'an Ivy', Community: 'a community college', Trade: 'a trade school', LACs: 'a liberal arts college',
};
function renderSummary(rows) {
  const students = new Map();
  rows.forEach(r => {
    const k = studentKey(r);
    if (!students.has(k)) students.set(k, { gpa: parseFloat(r.gpa), ok: false });
    if (r.decision === 'Accepted') students.get(k).ok = true;
  });
  const n = students.size, ok = [...students.values()].filter(s => s.ok).length;
  const gpas = [...students.values()].map(s => s.gpa).filter(g => !isNaN(g));
  // Per application, at colleges that can say no (open-admission colleges
  // accept everyone, which pushed this to ~99%).
  const decided = rows.filter(r => !isOpenAdmission(r) && ['Accepted', 'Rejected', 'Waitlisted'].includes(r.decision));
  const yes = decided.filter(r => r.decision === 'Accepted').length;

  const el = document.getElementById('summary');
  el.textContent = '';
  const num = (id, v) => { const b = document.createElement('b'); b.id = id; b.textContent = v; return b; };
  const all = activeCollegeFilter === 'All', noun = CATEGORY_NOUN[activeCollegeFilter];
  if (!n) {
    el.textContent = slmFilter ? 'No students match these filters.'
      : all ? 'Nobody has shared results yet.' : `Nobody has reported applying to ${noun} yet.`;
  } else {
    el.append(num('s0', n), ` student${n !== 1 ? 's' : ''}${slmFilter ? ' like you' : ''} ${all ? 'shared their results' : 'applied to ' + noun}. `,
      num('s1', ok), all ? ' got into at least one college.' : ' got into at least one.');
    if (decided.length) el.append(' Four-year colleges said yes to ', num('s2', `${yes} of ${decided.length}`), ` decided application${decided.length !== 1 ? 's' : ''}${decided.length >= MIN_RATE_N ? ` (${Math.round(yes / decided.length * 100)}%)` : ''}.`);
    if (gpas.length) el.append(' Average unweighted GPA: ', num('s3', (gpas.reduce((a, b) => a + b, 0) / gpas.length).toFixed(2)), '.');
  }
  document.getElementById('page-meta').textContent =
    `Class of 2026${all ? '' : ', ' + activeCollegeFilter}${slmFilter ? ', ' + slmParts().map(p => p.text).join(', ') : ''}`;
}

// ── Decision field ─────────────────────────────────────────────────────────
// Every decision on the site as one mark, grouped by outcome. Marks stay put
// and fade when a filter leaves them out. The sentence beside it says the same
// thing in words, so this is hidden from assistive technology.
let _fieldFor = null;
function renderField(rows) {
  const host = document.getElementById('field-marks');
  if (_fieldFor !== allData) {
    _fieldFor = allData;
    const all = allData.filter(r => r.grad_year == 2026 && !isNoCollege(r))
      .sort((a, b) => DECISION_ORDER.indexOf(a.decision) - DECISION_ORDER.indexOf(b.decision) || parseFloat(b.gpa) - parseFloat(a.gpa));
    host.innerHTML = all.map(r => `<svg viewBox="0 0 14 14">${dotSvg(r.decision, 7, 7, 5, `class="d-${PILL_CLASS[r.decision] ? r.decision : 'none'}"`)}</svg>`).join('');
    [...host.children].forEach((n, i) => { n._row = all[i]; });
  }
  const on = new Set(rows);
  [...host.children].forEach(n => n.classList.toggle('off', !on.has(n._row)));
  document.getElementById('field-key').innerHTML = DECISION_ORDER.map(d => [d, rows.filter(r => r.decision === d && !isNoCollege(r)).length]).filter(x => x[1])
    .map(([d, n]) => `<span>${decisionIcon(d).outerHTML}<b>${n}</b> ${d.toLowerCase()}</span>`).join('');
}

const med = a => { const v = [...a].sort((x, y) => x - y); return v.length ? (v[Math.floor((v.length - 1) / 2)] + v[Math.ceil((v.length - 1) / 2)]) / 2 : 0; };
const gMed = g => med(g.pts.filter(p => p.match).map(p => p.v));
const CHART_SORTS = {
  apps:   { label: 'Most applied to',  fn: (a, b) => b.n - a.n },
  name:   { label: 'Name, A to Z',     fn: () => 0 },
  high:   { label: 'Highest typical',  fn: (a, b) => gMed(b) - gMed(a) },
  low:    { label: 'Lowest typical',   fn: (a, b) => gMed(a) - gMed(b) },
  going:  { label: 'Most going',       fn: (a, b) => gGoing(b) - gGoing(a) || b.n - a.n },
  nos:    { label: "Most no's",        fn: (a, b) => gNos(b) - gNos(a) || b.n - a.n },
  near:   { label: 'Closest to you',   fn: (a, b) => gNear(a) - gNear(b) },
};
const gGoing = g => g.pts.filter(p => p.match && p.r.enrolling === 'yes').length;
const gNos = g => g.pts.filter(p => p.match && p.r.decision === 'Rejected').length;
const youValue = () => activeChartType === 'uw' ? slmFilter && slmFilter.gpa && slmFilter.gpa.v : activeChartType === 'sat' ? slmFilter && slmFilter.sat && slmFilter.sat.v : null;
const gNear = g => { const y = youValue(); return y ? Math.abs(gMed(g) - y) : -g.n; };
function setChartSort(v) { chartSort = v; chartExpanded = false; writeUrlState(true); buildChart({ motion: true }); announceChart(); }

// Saved colleges live in this browser only.
const SAVED_KEY = 'cr_saved';
let saved = new Set((() => { try { return JSON.parse(localStorage.getItem(SAVED_KEY)) || []; } catch (e) { return []; } })());
function toggleSaved(key) {
  saved.has(key) ? saved.delete(key) : saved.add(key);
  try { saved.size ? localStorage.setItem(SAVED_KEY, JSON.stringify([...saved])) : localStorage.removeItem(SAVED_KEY); } catch (e) {}
  if (!saved.size) savedOnly = false;
  if (savedOnly) buildChart({ motion: true });
  syncSaved();
}
function syncSaved() {
  document.querySelectorAll('[data-save]').forEach(b => {
    const on = saved.has(b.dataset.save);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    const t = b.querySelector('[data-save-text]');
    if (t) t.textContent = on ? 'Saved' : 'Save';
  });
  const f = document.getElementById('saved-filter');
  f.hidden = !saved.size;
  f.setAttribute('aria-pressed', savedOnly ? 'true' : 'false');
  f.querySelector('.n').textContent = saved.size;
}

function dotKey(r, i) {
  return String((r.session_id || 'r' + i) + '|' + (r.college_name || '') + '|' + (r.decision || '') + '|' + (r.decision_type || ''));
}
function filterChart(val) { searchFilter = val.toLowerCase().trim(); writeUrlState(false); buildChart(); announceChart(); }
function switchChart(type) {
  activeChartType = type;
  trackEvent('chart_switch', type);
  syncControlsToState();
  writeUrlState(true);
  buildChart({ motion: true });
  announceChart();
}
function toggleFilter(d) { activeFilter = activeFilter === d ? null : d; writeUrlState(true); buildChart(); announceChart(); }

// One short, polite summary after a chart control changes, debounced so typing
// in the search box doesn't produce an announcement per keystroke.
let _announceTimer = 0;
function announceChart() {
  clearTimeout(_announceTimer);
  _announceTimer = setTimeout(() => {
    const el = document.getElementById('chart-status');
    if (!el || !_dataLoadedAt) return;
    const n = _chartCols.length;
    let msg = n
      ? `Chart lists ${n} college${n !== 1 ? 's' : ''}${activeCollegeFilter !== 'All' ? ' in ' + activeCollegeFilter : ''}.`
      : (document.querySelector('#chart-main .chart-empty p') || {}).textContent || 'No colleges in the chart.';
    if (n && activeFilter) msg += ` ${activeFilter} highlighted.`;
    if (n && chartSort !== 'apps') msg += ` Sorted by ${CHART_SORTS[chartSort].label.toLowerCase()}.`;
    el.textContent = msg;
  }, 500);
}

// Where every row and mark is now, so the next render can glide from here.
function captureChart(el) {
  const rows = new Map(), dots = new Map();
  el.querySelectorAll('.c-row').forEach(n => rows.set(n.dataset.key, n.offsetTop));
  el.querySelectorAll('.chart-dot').forEach(n => dots.set(n.dataset.key, [+n.dataset.cx, +n.dataset.cy]));
  return { rows, dots };
}
// Rows carry their marks to the new order; marks glide within a row when the
// metric changes; new rows fade in. Interruptible: nothing is left mid-state
// because the final position is always the un-animated one.
function playChart(el, prev) {
  const move = { duration: 340, easing: 'cubic-bezier(0.77,0,0.175,1)' };
  el.querySelectorAll('.c-row').forEach(n => {
    const was = prev.rows.get(n.dataset.key);
    if (was === undefined) { n.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: 120, easing: 'ease-out', fill: 'backwards' }); return; }
    const dy = was - n.offsetTop;
    if (dy) n.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], move);
  });
  el.querySelectorAll('.chart-dot').forEach(n => {
    const was = prev.dots.get(n.dataset.key);
    if (!was) return;
    const dx = was[0] - n.dataset.cx, dy = was[1] - n.dataset.cy;
    if (dx || dy) n.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], move);
  });
}

// Marks that would overlap are stacked into lanes instead of being jittered,
// so the horizontal position is always the exact value.
function layoutLanes(points, r) {
  const gap = r * 2 + 2, lanes = [];
  points.sort((a, b) => a.x - b.x || DECISION_ORDER.indexOf(a.r.decision) - DECISION_ORDER.indexOf(b.r.decision));
  points.forEach(p => {
    let i = 0;
    while (lanes[i] !== undefined && p.x - lanes[i] < gap) i++;
    lanes[i] = p.x;
    p.lane = i;
  });
  const step = gap;
  points.forEach(p => { p.dy = (p.lane % 2 ? -1 : 1) * Math.ceil(p.lane / 2) * step; });
  const up = Math.floor(lanes.length / 2), down = Math.max(0, Math.ceil((lanes.length - 1) / 2));
  return { above: up * step, below: down * step };
}

function buildChart(opts) {
  const el = document.getElementById('chart-main');
  const prev = opts && opts.motion && !REDUCED_MOTION && el.querySelector('.c-row') ? captureChart(el) : null;
  const m = METRICS[activeChartType];
  const rows = scatterData.filter(r => !isNoCollege(r));
  const name = displayNamer(rows);

  // Group by college; a college is listed only if a matching student has a
  // value for this metric there.
  const groups = new Map();
  rows.forEach(r => {
    const v = parseFloat(r[m.key]);
    if (isNaN(v)) return;
    const k = canonKey(r.college_name);
    if (!groups.has(k)) groups.set(k, { key: k, name: name(r.college_name), pts: [], n: 0 });
    const g = groups.get(k), match = _dragging || slmMatches(r);
    if (match) g.n++;
    g.pts.push({ r, v, match });
  });
  let cols = [...groups.values()].filter(g => g.n);
  cols.sort((a, b) => (CHART_SORTS[chartSort].fn(a, b)) || a.name.localeCompare(b.name));
  if (savedOnly) cols = cols.filter(g => saved.has(g.key));
  if (searchFilter) cols = cols.filter(g => g.name.toLowerCase().includes(searchFilter) || g.pts.some(p => p.r.college_name.toLowerCase().includes(searchFilter)));
  // Highlighting a decision narrows the list to colleges that have one.
  const used = DECISION_ORDER.filter(d => cols.some(g => g.pts.some(p => p.match && p.r.decision === d)));
  if (activeFilter && used.includes(activeFilter)) cols = cols.filter(g => g.pts.some(p => p.match && p.r.decision === activeFilter));
  // Colleges with a single report start folded away, when there are many.
  const total = cols.length;
  const keep = chartSort === 'apps' ? Math.max(CHART_MIN_ROWS, cols.filter(g => g.n > 1).length) : 15;
  const foldable = !searchFilter && !activeFilter && !savedOnly && total > keep + 3;
  const more = foldable && !chartExpanded;
  if (more) cols = cols.slice(0, keep);

  document.getElementById('chart-col-count').textContent = total ? `${total} college${total !== 1 ? 's' : ''}` : '';
  document.getElementById('chart-axis-title').textContent = m.title;

  // A rebuild replaces every chart node: remember what had focus and put it
  // back on the same college/mark/legend button afterwards.
  const active = document.activeElement;
  const refocusKey = active && el.contains(active) ? active.dataset.focusKey : null;
  const legendEl = document.getElementById('legend');
  const refocusLegend = active && legendEl.contains(active) ? active.dataset.decision : null;
  if (_tooltipDot) unpinDot();

  _chartCols = cols.map(g => g.name);
  const moreBtn = document.getElementById('chart-more');
  moreBtn.hidden = !foldable;
  moreBtn.textContent = more ? `Show ${total - keep} more colleges` : 'Show fewer colleges';
  moreBtn.setAttribute('aria-expanded', more ? 'false' : 'true');
  document.getElementById('chart-foot').hidden = !cols.length;

  renderLegend(legendEl, used, rows.filter(r => _dragging || slmMatches(r)));
  if (!cols.length) {
    el.textContent = '';
    renderChartEmpty(el, rows);
    renderChartTable([]);
    return;
  }

  // The axis is laid out on the same grid as the rows; measure its plot cell.
  el.innerHTML = `<div class="c-row c-axis"><div class="c-star"></div><div class="c-name"></div><div class="c-plot"></div><div class="c-count">Admitted</div></div>`;
  const axisPlot = el.querySelector('.c-plot');
  const W = Math.max(200, Math.round(axisPlot.clientWidth) || 600);
  const narrow = el.clientWidth < 680;
  const R = narrow ? 5 : 5.5, PADX = 14, MIN_H = narrow ? 34 : 38;
  const x = v => PADX + (Math.min(m.max, Math.max(m.min, v)) - m.min) / (m.max - m.min) * (W - PADX * 2);
  axisPlot.innerHTML = m.ticks.map(t => `<span aria-hidden="true" style="left:${x(t).toFixed(1)}px">${m.fmt(t)}</span>`).join('');

  // "You": the value typed into the filters, when it's on this axis.
  const you = activeChartType === 'uw' ? slmFilter && slmFilter.gpa : activeChartType === 'sat' ? slmFilter && slmFilter.sat : null;
  axisPlot.parentNode.classList.add('has-you');

  _axis = { x, inv: px => m.min + (px - PADX) / (W - PADX * 2) * (m.max - m.min), metric: activeChartType };
  if (activeChartType !== 'gpa') addYouHandle(axisPlot, you, m, x);
  let roving = cols.findIndex(g => g.key === _chartRovingKey);
  if (roving < 0) roving = 0;
  _chartRovingKey = cols[roving].key;

  let html = '';
  cols.forEach((g, i) => {
    g.pts.forEach(p => { p.x = x(p.v); });
    const ext = layoutLanes(g.pts, R);
    const H = Math.max(MIN_H, Math.round(ext.above + ext.below + R * 2 + 14));
    const cy = H / 2 + (ext.above - ext.below) / 2;
    const shown = g.pts.filter(p => p.match);
    const counts = {};
    shown.forEach(p => { counts[p.r.decision] = (counts[p.r.decision] || 0) + 1; });
    const acc = shown.filter(p => p.r.decision === 'Accepted');
    const summary = DECISION_ORDER.filter(d => counts[d]).map(d => `${counts[d]} ${d.toLowerCase()}`).join(', ');

    let s = '<g aria-hidden="true">';
    if (you) s += `<rect class="c-band" x="${x(you.v - you.range).toFixed(1)}" y="0" width="${Math.max(2, x(you.v + you.range) - x(you.v - you.range)).toFixed(1)}" height="${H}"/>`;
    m.ticks.forEach(t => { const tx = x(t).toFixed(1); s += `<line class="c-grid" x1="${tx}" x2="${tx}" y1="0" y2="${H}"/>`; });
    if (acc.length >= 2) {
      const xs = acc.map(p => p.x), lo = Math.min(...xs), hi = Math.max(...xs);
      if (hi - lo > 1) s += `<line class="c-range" x1="${lo.toFixed(1)}" x2="${hi.toFixed(1)}" y1="${cy}" y2="${cy}"/>`;
    }
    if (you) s += `<line class="c-youline" x1="${x(you.v).toFixed(1)}" x2="${x(you.v).toFixed(1)}" y1="0" y2="${H}"/>`;
    s += '</g>';
    // Faded context first, so matching marks sit on top.
    [...g.pts].sort((a, b) => a.match - b.match).forEach(p => {
      const idx = scatterData.indexOf(p.r);
      const off = !p.match || (activeFilter && p.r.decision !== activeFilter);
      const key = dotKey(p.r, idx);
      const px = p.x.toFixed(1), py = (cy + p.dy).toFixed(1);
      const a11y = p.match
        ? `role="button" tabindex="-1" aria-label="${escHtml(`${p.r.decision || 'No decision'}, ${m.label} ${p.r[m.key]}${off ? ', not highlighted' : ''}`)}" data-focus-key="dot:${escHtml(key)}"`
        : 'aria-hidden="true"';
      s += dotSvg(p.r.decision, px, py, R, `class="${p.match ? 'chart-dot' : 'ghost-dot'} d-${escHtml(p.r.decision || 'none')}${off ? ' off' : ''}" data-col="${i}" data-idx="${idx}" data-key="${escHtml(key)}" data-v="${p.v}" data-cx="${px}" data-cy="${py}" ${a11y}`);
    });

    html += `<div class="c-row" data-key="${escHtml(g.key)}">
      <button type="button" class="c-star" data-save="${escHtml(g.key)}" tabindex="-1" aria-pressed="${saved.has(g.key)}" aria-label="Save ${escHtml(g.name)}"><svg aria-hidden="true"><use href="#i-star"/></svg></button>
      <button type="button" class="c-name" data-col="${i}" data-focus-key="col:${escHtml(g.key)}" tabindex="${i === roving ? 0 : -1}" aria-label="${escHtml(g.name)}, ${shown.length} shown: ${summary}. Open details"><span>${escHtml(g.name)}</span></button>
      <div class="c-plot"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="group" aria-label="${escHtml(g.name)} decisions">${s}</svg></div>
      <div class="c-count" aria-hidden="true"><b>${acc.length}</b> of ${shown.length}</div>
    </div>`;
  });
  el.insertAdjacentHTML('beforeend', html);

  if (prev) playChart(el, prev);
  syncSaved();
  renderChartTable(cols);

  if (refocusKey) {
    const again = el.querySelector(`[data-focus-key="${CSS.escape(refocusKey)}"]`) || el.querySelector('.c-name[tabindex="0"]');
    if (again) focusChartItem(again);
  } else if (refocusLegend) {
    (legendEl.querySelector(`[data-decision="${refocusLegend}"]`) || document.getElementById('college-search')).focus();
  }
}

// ── "You" on the axis ──────────────────────────────────────────────────────
// A slider: drag it, or use the arrow keys. While dragging, rows hold still and
// marks brighten or fade; letting go applies the filter to the whole page.
let _dragging = false, _axis = null;
function youInput() { return document.getElementById(activeChartType === 'sat' ? 'slm-sat' : 'slm-gpa'); }
function addYouHandle(host, you, m, x) {
  const sat = activeChartType === 'sat', start = sat ? 1150 : 3.2, v = you ? you.v : start;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'c-you' + (you ? '' : ' is-idle');
  b.setAttribute('role', 'slider');
  b.setAttribute('aria-label', sat ? 'Your SAT score' : 'Your unweighted GPA');
  b.setAttribute('aria-valuemin', m.min); b.setAttribute('aria-valuemax', m.max); b.setAttribute('aria-valuenow', v);
  b.setAttribute('aria-valuetext', you ? `${v}` : 'Not set');
  b.dataset.focusKey = 'you';
  b.style.left = x(v).toFixed(1) + 'px';
  b.textContent = you ? `You ${sat ? v : v.toFixed(2)}` : (sat ? 'Drag to your SAT' : 'Drag to your GPA');
  host.appendChild(b);
  const fmt = n => sat ? String(Math.round(n / 10) * 10) : (Math.round(n * 20) / 20).toFixed(2);
  const clamp = n => Math.min(m.max, Math.max(m.min, n));
  b.addEventListener('keydown', e => {
    const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    if (!step) return;
    e.preventDefault(); e.stopPropagation();
    youInput().value = fmt(clamp(v + (you ? step * (sat ? 10 : .05) : 0)));
    applySlm();
  });
  b.addEventListener('pointerdown', e => {
    if (e.button) return;
    e.preventDefault();
    const box = host.getBoundingClientRect(), inp = youInput();
    _dragging = true;
    inp.value = fmt(clamp(_axis.inv(e.clientX - box.left)));
    slmFilter = readSlm().filter;
    buildChart();
    document.body.classList.add('is-dragging');
    const paint = px => {
      const val = +fmt(clamp(_axis.inv(px))), range = +document.getElementById(sat ? 'slm-sat-range' : 'slm-gpa-range').value;
      inp.value = fmt(val);
      const a = _axis.x(val), lo = _axis.x(val - range), hi = _axis.x(val + range);
      const h = document.querySelector('#chart-main .c-you');
      h.style.left = a + 'px'; h.textContent = 'You ' + fmt(val);
      document.querySelectorAll('#chart-main .c-youline').forEach(l => { l.setAttribute('x1', a); l.setAttribute('x2', a); });
      document.querySelectorAll('#chart-main .c-band').forEach(r => { r.setAttribute('x', lo); r.setAttribute('width', Math.max(2, hi - lo)); });
      document.querySelectorAll('#chart-main .chart-dot').forEach(d => d.classList.toggle('off', Math.abs(d.dataset.v - val) > range + 1e-9));
    };
    const move = ev => paint(ev.clientX - box.left);
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
      _dragging = false; document.body.classList.remove('is-dragging');
      slmFilter = null; applySlm();
      const h = document.querySelector('#chart-main .c-you'); if (h) h.focus({ preventScroll: true });
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
    paint(e.clientX - box.left);
  });
}

// Legend swatches mirror the plotted shape, so the key works without colour.
function renderLegend(host, used, rows) {
  host.innerHTML = used.map(d => `<button type="button" class="legend-item" data-decision="${d}" aria-pressed="${activeFilter === d ? 'true' : 'false'}">
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">${dotSvg(d, 7, 7, 5, `class="d-${d}"`)}</svg>${d}<span class="n" aria-hidden="true">${rows.filter(r => r.decision === d).length}</span></button>`).join('');
  host.classList.toggle('has-active', !!activeFilter);
}

// Empty chart: say which control caused it and offer the reset that fixes it.
function renderChartEmpty(el, rows) {
  const box = document.createElement('div');
  box.className = 'chart-empty';
  const p = document.createElement('p');
  const actions = document.createElement('div');
  actions.className = 'chart-empty-actions';
  const add = (label, action) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn-quiet'; b.dataset.action = action; b.textContent = label;
    actions.appendChild(b);
  };
  const cat = activeCollegeFilter, m = METRICS[activeChartType];
  const rawSearch = (document.getElementById('college-search').value || '').trim();
  if (!allData.some(r => r.grad_year == 2026)) {
    p.textContent = 'No Class of 2026 submissions yet.';
  } else if (!rows.length) {
    p.textContent = `No submissions in the ${cat} category yet. Other categories may have results.`;
    add('Show all schools', 'schools-all');
  } else if (savedOnly && !searchFilter) {
    p.textContent = 'None of your saved colleges are in this view.';
    add('Show every college', 'saved-off');
  } else if (searchFilter) {
    p.textContent = `No colleges match “${rawSearch || searchFilter}”${cat !== 'All' ? ' in ' + cat : ''}.`;
    add('Clear search', 'clear-search');
  } else if (activeFilter && !slmFilter) {
    p.textContent = `No ${activeFilter.toLowerCase()} decisions in this view.`;
    add('Show every decision', 'decision-clear');
  } else if (slmFilter) {
    p.textContent = 'No students match these filters. Try a wider range or remove one.';
    add('Clear student filters', 'slm-clear');
  } else {
    p.textContent = `None of these submissions reported ${activeChartType === 'sat' ? 'an SAT score' : 'a ' + m.label}.`;
  }
  box.append(p, actions);
  el.appendChild(box);
}

// Text alternative to the chart: the same colleges and the same plotted
// decisions, counted.
function renderChartTable(cols) {
  const host = document.getElementById('chart-table');
  host.textContent = '';
  if (!cols.length) return;
  const table = document.createElement('table');
  table.className = 'chart-table';
  const cap = document.createElement('caption');
  cap.textContent = `Decisions plotted in the chart (${METRICS[activeChartType].label}), by college. Same colleges and order as the chart.`;
  table.appendChild(cap);
  const thead = table.createTHead().insertRow();
  ['College', 'Shown', ...DECISION_ORDER].forEach(h => {
    const th = document.createElement('th'); th.scope = 'col'; th.textContent = h; thead.appendChild(th);
  });
  const tbody = table.createTBody();
  cols.forEach(g => {
    const rows = g.pts.filter(p => p.match);
    const tr = tbody.insertRow();
    const th = document.createElement('th');
    th.scope = 'row';
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.openCollege = g.name;
    b.dataset.focusKey = 'tbl:' + g.key;
    b.textContent = g.name;
    th.appendChild(b);
    tr.appendChild(th);
    tr.insertCell().textContent = rows.length;
    DECISION_ORDER.forEach(d => { tr.insertCell().textContent = rows.filter(p => p.r.decision === d).length; });
  });
  host.appendChild(table);
}

function focusChartItem(node) {
  if (node.matches('.c-name')) {
    document.querySelectorAll('#chart-main .c-name[data-col]').forEach(t => t.setAttribute('tabindex', t === node ? '0' : '-1'));
    _chartRovingKey = node.closest('.c-row').dataset.key;
  }
  node.focus();
}

// ── Mark details ───────────────────────────────────────────────────────────
// Hover previews a mark; a click, tap or keyboard focus pins it.
let _tooltipDot = null, _tooltipPinned = false;
function unpinDot() {
  if (_tooltipDot) _tooltipDot.classList.remove('pinned');
  _tooltipDot = null; _tooltipPinned = false;
  const tip = document.getElementById('dot-tooltip');
  tip.style.display = 'none';
  tip.classList.remove('is-pinned');
}
function showDot(dot, pin, point) {
  if (_tooltipDot && _tooltipDot !== dot) _tooltipDot.classList.remove('pinned');
  _tooltipDot = dot; _tooltipPinned = pin;
  dot.classList.add('pinned');
  document.getElementById('dot-tooltip').classList.toggle('is-pinned', pin);
  showTooltip(scatterData[+dot.dataset.idx], point || dotAnchor(dot));
}
function dotAnchor(dot) {
  const rect = dot.getBoundingClientRect();
  return { x: rect.right, y: rect.top };
}
// The mark nearest the pointer in this row's plot, within a finger's reach.
function nearestDot(svg, e, reach) {
  const box = svg.getBoundingClientRect();
  const px = e.clientX - box.left, py = e.clientY - box.top;
  let best = null, bd = reach;
  svg.querySelectorAll('.chart-dot').forEach(n => {
    const d = Math.hypot(n.dataset.cx - px, n.dataset.cy - py);
    if (d < bd) { bd = d; best = n; }
  });
  return best;
}
function positionTooltipNear(x, y) {
  // Keep the whole pane on screen, and flip it to the left of the mark rather
  // than covering it. On phones CSS docks the pane to the bottom edge.
  const tip = document.getElementById('dot-tooltip');
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let left = x + 16;
  if (left + w > vw - 10) left = Math.max(10, x - 24 - w);
  let top = Math.max(y - 10, 10);
  if (top + h > vh - 10) top = Math.max(10, vh - h - 10);
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}
function repositionTooltip() {
  if (!_tooltipDot) return;
  if (!_tooltipDot.isConnected || !_tooltipPinned) { unpinDot(); return; }
  const a = dotAnchor(_tooltipDot);
  positionTooltipNear(a.x, a.y);
}
// Built from DOM nodes and textContent, so college names and majors are shown
// literally and can never become markup.
function showTooltip(r, pos) {
  const key = studentKey(r);
  const sibs = scatterData.filter(x => studentKey(x) === key);
  const tip = document.getElementById('dot-tooltip');
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  tip.textContent = '';
  const facts = [];
  if (r.gpa) facts.push(`UW GPA ${r.gpa}`);
  if (r.gpa_weighted) facts.push(`W ${r.gpa_weighted}`);
  if (r.sat) facts.push(`SAT ${r.sat}`);
  if (r.act) facts.push(`ACT ${r.act}`);
  if (r.class_rank) facts.push(`Rank ${r.class_rank}`);
  if (r.essay_rating) facts.push(`Essay ${r.essay_rating}/5`);
  const fl = el('div', 'tip-facts');
  facts.forEach(f => fl.appendChild(el('span', null, f)));
  tip.appendChild(fl);
  if (r.major) tip.appendChild(el('div', null, r.major));
  if (r.first_gen === 'yes') tip.appendChild(el('div', null, 'First-generation student'));
  const decs = el('ul', 'tip-decs');
  sibs.forEach(s => {
    const li = el('li', s === r ? 'is-this' : null);
    li.append(decisionIcon(s.decision), el('span', null, `${s.college_name}: ${s.decision}`));
    const extras = decisionExtras(s);
    if (extras.length) li.append(' ', el('small', null, extras.join(', ')));
    decs.appendChild(li);
  });
  tip.appendChild(decs);
  if (r.extracurriculars) {
    tip.appendChild(el('div', 'tip-label', 'Extracurriculars'));
    tip.appendChild(el('div', 'tip-ecs', r.extracurriculars));
  }
  tip.style.display = 'block';
  positionTooltipNear(pos.x, pos.y);
}
function decisionIcon(d) {
  const t = document.createElement('template');
  t.innerHTML = `<svg class="d-icon" width="12" height="12" viewBox="0 0 14 14" aria-hidden="true">${dotSvg(d, 7, 7, 5, `class="d-${PILL_CLASS[d] ? d : 'none'}"`)}</svg>`;
  return t.content.firstChild;
}
function decisionExtras(c) {
  const x = [];
  if (c.decision_type) x.push(c.decision_type);
  if (c.school_type && c.school_type !== 'University') x.push(c.school_type);
  if (c.enrolling === 'yes') x.push('Enrolling');
  if (c.scholarship === 'yes') x.push('Scholarship');
  if (c.sport === 'yes') x.push('Recruited');
  return x;
}
document.addEventListener('click', e => {
  if (_tooltipDot && !e.target.closest('.c-plot') && !e.target.closest('#dot-tooltip')) unpinDot();
});
window.addEventListener('scroll', repositionTooltip, { passive: true });
window.addEventListener('resize', repositionTooltip, { passive: true });

// ── College details ────────────────────────────────────────────────────────
const scopeText = () => slmFilter ? ` Only students matching ${slmParts().map(p => p.text).join(', ')}.` : '';
function rangeText(rows, key, digits) {
  const v = rows.map(r => parseFloat(r[key])).filter(x => !isNaN(x));
  if (!v.length) return null;
  const f = x => x.toFixed(digits), lo = Math.min(...v), hi = Math.max(...v);
  return { range: lo === hi ? f(lo) : `${f(lo)} to ${f(hi)}`, avg: f(v.reduce((a, b) => a + b, 0) / v.length), n: v.length };
}
function openCollegeDetail(name, opts) {
  // Pull in every spelling variant, not just rows with this exact string.
  const key = canonKey(name);
  const rows = viewRows().filter(r => !isNoCollege(r) && canonKey(r.college_name) === key);
  if (!rows.length) return;
  if (!(opts && opts.track === false)) trackEvent('college_click', name);
  const shownName = displayNamer(scatterData)(rows[0].college_name);
  const total = rows.length, acc = rows.filter(r => r.decision === 'Accepted');
  const extRate = getAcceptRate(shownName);
  const bars = DECISION_ORDER.map(d => ({ d, n: rows.filter(r => r.decision === d).length })).filter(x => x.n).map(({ d, n }) => `
    <div class="bar-row"><div class="bar-label">${d}</div><div class="bar-track" aria-hidden="true"><div class="bar-fill b-${d}" style="width:${n / total * 100}%"></div></div><div class="bar-val">${n}</div></div>`).join('');
  const facts = [['gpa', 'Unweighted GPA', 2], ['gpa_weighted', 'Weighted GPA', 2], ['sat', 'SAT', 0]].map(([k, label, dg]) => {
    const a = rangeText(acc, k, dg);
    return a ? `<tr><th scope="row">${label}</th><td>${a.range}</td><td>${a.avg}</td></tr>` : '';
  }).join('');
  document.getElementById('college-modal-content').innerHTML = `
    <h2 id="college-modal-title" tabindex="-1">${escHtml(shownName)}</h2>
    <p class="modal-lead"><b>${acc.length} of ${total}</b> admitted${total >= MIN_RATE_N ? ` (${Math.round(acc.length / total * 100)}%)` : ''}.${escHtml(scopeText())}</p>
    <div class="modal-acts"><button type="button" class="btn-quiet btn-save" data-save="${escHtml(key)}" aria-pressed="${saved.has(key)}" aria-label="Save ${escHtml(shownName)}"><svg aria-hidden="true"><use href="#i-star"/></svg><span data-save-text>${saved.has(key) ? 'Saved' : 'Save'}</span></button><button type="button" class="btn-quiet" data-students-at="${escHtml(shownName)}">${total === 1 ? 'See this student' : `See these ${total} students`}</button></div>
    ${total < MIN_RATE_N ? `<p class="scope-note">Only ${total} Live Oak report${total !== 1 ? 's' : ''}. That's too few to say anything about anyone's chances.</p>` : ''}
    <div class="modal-section"><h3>Decisions</h3>${bars}</div>
    ${facts ? `<div class="modal-section"><h3>Admitted students</h3><table class="mini-table"><thead><tr><td></td><th scope="col">Range</th><th scope="col">Average</th></tr></thead><tbody>${facts}</tbody></table></div>` : ''}
    <p class="scope-note">${extRate ? `About ${extRate}% overall admission rate (unverified estimate). ` : ''}<a href="/methodology.html">How these numbers work</a></p>`;
  _openCollegeName = shownName;
  if (!_suppressUrlWrite) writeUrlState(true);
  openModal('college-modal', { returnKey: 'col:' + key });
}

function openCompare() {
  const rows = viewRows().filter(r => !isNoCollege(r));
  const name = displayNamer(scatterData);
  const colleges = [...new Set(rows.map(r => name(r.college_name)))].sort((a, b) => a.localeCompare(b));
  const host = document.getElementById('compare-modal-content');
  host.innerHTML = `
    <h2 id="compare-modal-title">Compare colleges</h2>
    <p class="modal-sub">Pick up to three.${escHtml(scopeText())}</p>`;
  if (colleges.length < 2) {
    const p = document.createElement('p');
    p.className = 'scope-note';
    p.textContent = 'Need at least 2 colleges with submissions in this view to compare.';
    host.appendChild(p);
    openModal('compare-modal');
    return;
  }
  const picker = (id, label, list, withNone) => {
    const lab = document.createElement('label');
    lab.append(label);
    const sel = document.createElement('select');
    sel.id = id;
    if (withNone) sel.add(new Option('None', ''));
    list.forEach(c => sel.add(new Option(c, c)));
    lab.appendChild(sel);
    return lab;
  };
  // Start from the two most-applied colleges in view, not A and B of the alphabet.
  const mine = colleges.filter(c => saved.has(canonKey(c)));
  const top = mine.length > 1 ? mine : _chartCols.filter(c => colleges.includes(c));
  const lead = (c, list) => c ? [c, ...list.filter(x => x !== c)] : list;
  const pick = document.createElement('div');
  pick.className = 'compare-pick';
  pick.append(
    picker('cmp-a', 'First college', lead(top[0], colleges)),
    picker('cmp-b', 'Second college', lead(top[1] || colleges.find(c => c !== (top[0] || colleges[0])), colleges)),
    picker('cmp-c', 'Third college (optional)', colleges, true));
  if (mine.length > 2) pick.querySelector('#cmp-c').value = mine[2];
  const result = document.createElement('div');
  result.id = 'cmp-result';
  result.setAttribute('aria-live', 'polite');
  host.append(pick, result);
  openModal('compare-modal');
  renderCompare();
}
function renderCompare() {
  const unique = [...new Set(['cmp-a', 'cmp-b', 'cmp-c'].map(id => document.getElementById(id).value).filter(Boolean))];
  document.getElementById('cmp-result').innerHTML = unique.length < 2
    ? '<p class="scope-note">Pick at least two different colleges.</p>'
    : `<div class="cmp-grid" style="--cmp-cols:${unique.length};">${unique.map(colStats).join('')}</div>`;
}
function colStats(name) {
  const rows = viewRows().filter(r => !isNoCollege(r) && canonKey(r.college_name) === canonKey(name));
  const total = rows.length, acc = rows.filter(r => r.decision === 'Accepted');
  const natRate = getAcceptRate(name);
  const bars = DECISION_ORDER.map(d => ({ d, n: rows.filter(r => r.decision === d).length })).filter(x => x.n).map(({ d, n }) => `
    <div class="bar-row"><div class="bar-label">${d}</div><div class="bar-track" aria-hidden="true"><div class="bar-fill b-${d}" style="width:${n / total * 100}%"></div></div><div class="bar-val">${n}</div></div>`).join('');
  const facts = [['gpa', 'Unweighted GPA', 2], ['gpa_weighted', 'Weighted GPA', 2], ['sat', 'SAT', 0]].map(([k, label, dg]) => {
    const a = rangeText(acc, k, dg);
    return a ? `<tr><th scope="row">${label}</th><td>${a.range}</td></tr>` : '';
  }).join('');
  const rounds = ['EA', 'ED', 'RD', 'Rolling'].map(t => {
    const rt = rows.filter(r => r.decision_type === t);
    return rt.length ? `<tr><th scope="row">${t}</th><td>${admitted(rt.filter(r => r.decision === 'Accepted').length, rt.length)}</td></tr>` : '';
  }).join('');
  const enrolled = rows.filter(r => r.enrolling === 'yes').length, schol = rows.filter(r => r.scholarship === 'yes').length;
  return `<div class="cmp-col">
    <h3>${escHtml(name)}</h3>
    <p class="modal-lead"><b>${acc.length} of ${total}</b> admitted${total >= MIN_RATE_N ? ` (${Math.round(acc.length / total * 100)}%)` : ''}</p>
    ${bars}
    ${facts ? `<table class="mini-table"><caption>Admitted students</caption><tbody>${facts}</tbody></table>` : ''}
    ${rounds ? `<table class="mini-table"><caption>Admitted, by round</caption><tbody>${rounds}</tbody></table>` : ''}
    <p class="scope-note">${[enrolled ? `${enrolled} enrolling.` : '', schol ? `${schol} got a scholarship.` : '', natRate ? `About ${natRate}% overall admission rate (unverified estimate).` : ''].filter(Boolean).join(' ')}</p>
  </div>`;
}

// ── Modal accessibility: focus trap + focus restore ─────────────────────────
// Tab used to escape straight into the page behind the overlay, and closing
// a modal dropped focus back to <body> instead of wherever you opened it
// from. Both are single-instance globals because this app never stacks
// more than one modal at a time.
let _modalKeydownHandler = null;
function _focusableIn(modal) {
  return [...modal.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter(el => el.offsetParent !== null);
}
function openModal(id, opts) {
  const overlay = document.getElementById(id);
  const modal = overlay.querySelector('.modal');
  // Re-opening an open dialog (e.g. Back/Forward to another college) only
  // refreshes it: no second focus-trap listener, and the original trigger
  // stays the place focus returns to.
  if (overlay.classList.contains('open')) { focusModalStart(modal); return; }
  // Only one dialog at a time.
  if (_openModalId && _openModalId !== id) closeModal(_openModalId, { restoreFocus: false });
  const trigger = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
  _modalReturn = {
    el: trigger,
    key: (opts && opts.returnKey) || (trigger && trigger.dataset && trigger.dataset.focusKey) || null,
    fallback: (opts && opts.fallback) || null,
  };
  unpinDot();
  overlay.classList.add('open');
  _openModalId = id;
  setBackgroundInert(true, overlay);
  lockScroll(true);
  focusModalStart(modal);
  _modalKeydownHandler = (e) => {
    if (e.key !== 'Tab') return;
    const focusables = _focusableIn(modal);
    if (!focusables.length) { e.preventDefault(); return; }
    const idx = focusables.indexOf(document.activeElement);
    if (e.shiftKey && idx <= 0) { e.preventDefault(); focusables[focusables.length - 1].focus(); }
    else if (!e.shiftKey && (idx === focusables.length - 1 || idx === -1)) { e.preventDefault(); focusables[0].focus(); }
  };
  modal.addEventListener('keydown', _modalKeydownHandler);
}
// Focus the dialog's heading so its title is read first, then Tab reaches
// the controls inside.
function focusModalStart(modal) {
  const h = modal.querySelector('h2');
  if (h) { h.setAttribute('tabindex', '-1'); h.focus(); }
  else { modal.setAttribute('tabindex', '-1'); modal.focus(); }
  modal.scrollTop = 0;
}
// While a dialog is open everything behind it is inert: no Tab stops, no
// clicks, nothing for a screen reader's virtual cursor to wander into.
function setBackgroundInert(on, except) {
  const nodes = [...document.body.children].filter(n =>
    n !== except && n.tagName !== 'SCRIPT' && n.id !== 'celebration-overlay' && n.id !== 'dot-tooltip');
  nodes.forEach(n => { if (on) n.setAttribute('inert', ''); else n.removeAttribute('inert'); });
}
// Stop the page behind a dialog from scrolling, and always restore exactly
// what was there before (no leftover overflow:hidden after closing).
let _scrollLock = null;
function lockScroll(on) {
  const b = document.body;
  if (on && !_scrollLock) {
    const gap = window.innerWidth - document.documentElement.clientWidth;
    _scrollLock = { overflow: b.style.overflow, paddingRight: b.style.paddingRight };
    b.style.overflow = 'hidden';
    if (gap > 0) b.style.paddingRight = gap + 'px';
  } else if (!on && _scrollLock) {
    b.style.overflow = _scrollLock.overflow;
    b.style.paddingRight = _scrollLock.paddingRight;
    _scrollLock = null;
  }
}
function closeModal(id, opts) {
  const overlay = document.getElementById(id);
  // Closing a dialog that isn't open is a no-op. Previously it still ran the
  // cleanup, which (via Escape) detached the stats notice's focus trap and
  // threw focus behind it while the notice stayed on screen.
  if (!overlay || !overlay.classList.contains('open')) return;
  overlay.classList.remove('open');
  const modal = overlay.querySelector('.modal');
  if (_modalKeydownHandler) { modal.removeEventListener('keydown', _modalKeydownHandler); _modalKeydownHandler = null; }
  _openModalId = null;
  setBackgroundInert(false);
  lockScroll(false);
  const ret = _modalReturn;
  _modalReturn = null;
  if (!(opts && opts.restoreFocus === false)) restoreFocusAfterModal(ret);
  if (id === 'college-modal' && _openCollegeName) {
    _openCollegeName = null;
    if (!_suppressUrlWrite) writeUrlState(true);
  }
}
// Back to the control that opened the dialog. If a re-render replaced that
// control (the chart rebuilds on resize), find its replacement by key; if it
// is gone entirely, land on the page heading rather than on <body>.
function restoreFocusAfterModal(ret) {
  let target = ret && ret.el && ret.el.isConnected && !ret.el.closest('[inert]') ? ret.el : null;
  if (!target && ret && ret.key) target = document.querySelector(`[data-focus-key="${CSS.escape(ret.key)}"]`);
  if (!target && ret && ret.fallback) {
    target = document.getElementById(ret.fallback);
    if (target) target.setAttribute('tabindex', '-1');
  }
  if (!target && currentPage === 'results') target = document.getElementById('results-title');
  if (target) target.focus();
}

// ── Students like me ───────────────────────────────────────────────────────
// GPA, SAT and major, in any mix. They apply as you type, and to everything on
// the page: the summary, the chart, the statistics and the student list.
const normMajor = m => String(m || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();

// Majors actually in the data, grouped ignoring case/punctuation, shown with
// the most common spelling and how many students picked it.
function populateMajorOptions() {
  const sel = document.getElementById('slm-major');
  const groups = new Map();
  const seen = new Set();
  scatterData.forEach(r => {
    const k = normMajor(r.major);
    if (!k || seen.has(studentKey(r) + '|' + k)) return;
    seen.add(studentKey(r) + '|' + k);
    const g = groups.get(k) || { n: 0, names: new Map() };
    g.n++;
    g.names.set(r.major.trim(), (g.names.get(r.major.trim()) || 0) + 1);
    groups.set(k, g);
  });
  const opts = [...groups.entries()].map(([k, g]) => ({
    k, n: g.n, label: [...g.names.entries()].sort((a, b) => b[1] - a[1])[0][0],
  })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
  const cur = slmFilter && slmFilter.major;
  if (cur && !opts.some(o => o.k === cur.key)) opts.unshift({ k: cur.key, n: 0, label: cur.label });
  sel.innerHTML = '<option value="">Any major</option>' + opts.map(o =>
    `<option value="${escHtml(o.k)}" data-label="${escHtml(o.label)}"${cur && o.k === cur.key ? ' selected' : ''}>${escHtml(o.label)} (${o.n})</option>`).join('');
}

function readSlm() {
  const next = {}, problems = [];
  const field = (id, lo, hi, msg) => {
    const input = document.getElementById(id), raw = input.value.trim(), v = parseFloat(raw);
    const bad = raw !== '' && (isNaN(v) || v < lo || v > hi);
    input.setAttribute('aria-invalid', bad ? 'true' : 'false');
    if (bad) problems.push(msg(v));
    return raw === '' || bad ? null : v;
  };
  const gpa = field('slm-gpa', 1, 4, v => `Unweighted GPA is 1.0 to 4.0.${v > 4 ? ' Did you mean your weighted GPA?' : ''}`);
  const sat = field('slm-sat', 400, 1600, () => 'SAT scores are 400 to 1600.');
  if (gpa !== null) next.gpa = { v: gpa, range: parseFloat(document.getElementById('slm-gpa-range').value) };
  if (sat !== null) next.sat = { v: sat, range: parseInt(document.getElementById('slm-sat-range').value) };
  const maj = document.getElementById('slm-major');
  if (maj.value) next.major = { key: maj.value, label: maj.selectedOptions[0].dataset.label };
  return { filter: Object.keys(next).length ? next : null, problems };
}
function applySlm() {
  const { filter, problems } = readSlm();
  const before = JSON.stringify(slmFilter);
  slmFilter = filter;
  if (JSON.stringify(filter) !== before) renderResults({ motion: true });
  const n = new Set(viewRows().map(studentKey)).size;
  const msg = problems.join(' ') || (filter
    ? (n ? `${n} student${n !== 1 ? 's' : ''} match${n === 1 ? 'es' : ''}. Everything on the page now shows only ${n !== 1 ? 'them' : 'that student'}.` : 'No students match. Try a wider range.')
    : '');
  const st = document.getElementById('slm-status');
  if (st.textContent !== msg) st.textContent = msg;
  st.classList.toggle('is-error', !!problems.length);
}
let _slmTimer = 0;
function applySlmSoon() { clearTimeout(_slmTimer); _slmTimer = setTimeout(applySlm, 350); }
function removeSlm(kind) {
  document.getElementById('slm-' + kind).value = '';
  applySlm();
}
function clearSlm() {
  ['gpa', 'sat', 'major'].forEach(k => { document.getElementById('slm-' + k).value = ''; });
  applySlm();
}
function slmParts() {
  if (!slmFilter) return [];
  const f = slmFilter, parts = [];
  if (f.gpa) parts.push({ kind: 'gpa', text: `GPA ${Math.max(1, f.gpa.v - f.gpa.range).toFixed(2)} to ${Math.min(4, f.gpa.v + f.gpa.range).toFixed(2)}` });
  if (f.sat) parts.push({ kind: 'sat', text: `SAT ${Math.max(400, f.sat.v - f.sat.range)} to ${Math.min(1600, f.sat.v + f.sat.range)}` });
  if (f.major) parts.push({ kind: 'major', text: f.major.label });
  return parts;
}
function renderSlmChips() {
  const parts = slmParts();
  document.getElementById('slm-active').innerHTML = parts.map(p =>
    `<button type="button" class="slm-chip" data-slm-remove="${p.kind}" aria-label="Remove filter: ${escHtml(p.text)}">${escHtml(p.text)}<svg aria-hidden="true"><use href="#i-x"/></svg></button>`).join('')
    + (parts.length > 1 ? '<button type="button" class="btn-link" data-action="slm-clear">Clear all</button>' : '');
  document.getElementById('slm-toggle-n').textContent = parts.length ? ` (${parts.length})` : '';
}
// Every row carries its student's own values. Filtering by SAT only includes
// students who reported one.
function slmMatches(r) {
  if (!slmFilter) return true;
  const { gpa, sat, major } = slmFilter;
  if (gpa && !(Math.abs(parseFloat(r.gpa) - gpa.v) <= gpa.range + 1e-9)) return false;
  if (sat && !(parseInt(r.sat) && Math.abs(parseInt(r.sat) - sat.v) <= sat.range)) return false;
  if (major && normMajor(r.major) !== major.key) return false;
  return true;
}

function renderYou(rows) {
  const host = document.getElementById('you-panel');
  if (!host) return;
  host.hidden = !slmFilter;
  if (!slmFilter) return;
  const n = new Set(rows.map(studentKey)).size;
  if (!n) { host.innerHTML = '<p>No students match. Try a wider range.</p>'; return; }
  const name = displayNamer(rows), by = new Map();
  const going = rows.filter(r => r.enrolling === 'yes' && !isNoCollege(r));
  going.forEach(r => { const k = canonKey(r.college_name), g = by.get(k) || { name: name(r.college_name), n: 0 }; g.n++; by.set(k, g); });
  const top = [...by.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).slice(0, 3);
  host.innerHTML = `<p><b>${n} student${n !== 1 ? 's' : ''} like you.</b> ${top.length ? 'Most common next stops:' : ''}</p>${top.map(t => `<button type="button" data-open-college="${escHtml(t.name)}">${escHtml(t.name)} <span>${t.n}</span></button>`).join('')}`;
}

// ── Student sorting and filters ────────────────────────────────────────────
// Class rank and extracurriculars are deliberately not sortable or searchable:
// they'd make it easy to look up one particular classmate.
const numOf = (g, k) => { const v = parseFloat(g[k]); return isNaN(v) ? null : v; };
const STUDENT_SORTS = {
  shared:   { label: 'Order shared', dir: 'desc', get: null },
  gpa:      { label: 'GPA',          dir: 'desc', get: g => numOf(g, 'gpa') },
  weighted: { label: 'Weighted GPA', dir: 'desc', get: g => numOf(g, 'gpa_weighted') },
  sat:      { label: 'SAT',          dir: 'desc', get: g => numOf(g, 'sat') },
  act:      { label: 'ACT',          dir: 'desc', get: g => numOf(g, 'act') },
  major:    { label: 'Major',        dir: 'asc',  get: g => normMajor(g.major) || null },
  applied:  { label: 'Colleges applied to', dir: 'desc', get: g => g.colleges.length },
  yes:      { label: 'Yeses',        dir: 'desc', get: g => g.colleges.filter(c => c.decision === 'Accepted').length },
};
const STUDENT_FLAGS = {
  no:          { label: "Got a no",     test: g => g.colleges.some(c => c.decision === 'Rejected') },
  waitlist:    { label: 'Waitlisted',   test: g => g.colleges.some(c => c.decision === 'Waitlisted') },
  scholarship: { label: 'Scholarship',  test: g => g.colleges.some(c => c.scholarship === 'yes') },
  first:       { label: 'First-gen',    test: g => g.first_gen === 'yes' },
  sport:       { label: 'Recruited',    test: g => g.colleges.some(c => c.sport === 'yes') },
  sat:         { label: 'Has an SAT',   test: g => numOf(g, 'sat') !== null },
};
const stuFiltered = () => !!(stu.college || stu.flags.length || stu.q);
function studentsInView(rows) {
  let list = groupStudents(rows);
  const key = stu.college && canonKey(stu.college), q = stu.q.trim().toLowerCase();
  if (key) list = list.filter(g => g.colleges.some(c => !isNoCollege(c) && canonKey(c.college_name) === key));
  stu.flags.forEach(f => { list = list.filter(STUDENT_FLAGS[f].test); });
  if (q) list = list.filter(g => (g.major || '').toLowerCase().includes(q) || g.colleges.some(c => (c.college_name || '').toLowerCase().includes(q)));
  const s = STUDENT_SORTS[stu.sort];
  if (s.get) {
    const sign = stu.dir === 'asc' ? 1 : -1;
    // Students without a value go last, whichever way it's sorted.
    list = list.map((g, i) => ({ g, i, v: s.get(g) })).sort((a, b) =>
      (a.v === null) - (b.v === null) || (a.v === null ? 0 : (a.v < b.v ? -1 : a.v > b.v ? 1 : 0) * sign) || a.i - b.i).map(x => x.g);
  }
  return list;
}
function updateStudents(patch, opts) {
  Object.assign(stu, patch);
  entriesShown = ENTRIES_PAGE;
  writeUrlState(!(opts && opts.typing));
  renderEntries(viewRows());
  announceStudents();
}
function sortStudents(k) {
  updateStudents(stu.sort === k && STUDENT_SORTS[k].get
    ? { dir: stu.dir === 'asc' ? 'desc' : 'asc' } : { sort: k, dir: STUDENT_SORTS[k].dir });
}
let _stuTimer = 0;
function announceStudents() {
  clearTimeout(_stuTimer);
  _stuTimer = setTimeout(() => {
    const n = studentsInView(viewRows()).length;
    document.getElementById('entries-status').textContent = `${n} student${n !== 1 ? 's' : ''}${STUDENT_SORTS[stu.sort].get ? `, sorted by ${STUDENT_SORTS[stu.sort].label}, ${sortDirText()}` : ''}.`;
  }, 500);
}
const sortDirText = () => stu.sort === 'major' ? (stu.dir === 'asc' ? 'A to Z' : 'Z to A') : stu.dir === 'asc' ? 'lowest first' : 'highest first';
function syncStudentControls(rows) {
  document.getElementById('stu-sort').value = stu.sort;
  const dir = document.getElementById('stu-dir');
  dir.hidden = !STUDENT_SORTS[stu.sort].get;
  dir.textContent = sortDirText()[0].toUpperCase() + sortDirText().slice(1);
  const find = document.getElementById('stu-find');
  if (document.activeElement !== find) find.value = stu.q;
  const name = displayNamer(scatterData), cols = new Map();
  rows.filter(r => !isNoCollege(r)).forEach(r => { const k = canonKey(r.college_name); cols.set(k, { name: name(r.college_name), n: (cols.get(k) ? cols.get(k).n : 0) + 1 }); });
  const sel = document.getElementById('stu-college'), cur = stu.college && canonKey(stu.college);
  const list = [...cols.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  if (cur && !cols.has(cur)) list.unshift([cur, { name: prettyName(stu.college), n: 0 }]);
  sel.innerHTML = '<option value="">Any college</option>' + list.map(([k, c]) => `<option value="${escHtml(c.name)}"${k === cur ? ' selected' : ''}>${escHtml(c.name)} (${c.n})</option>`).join('');
  const groups = groupStudents(rows);
  document.getElementById('stu-flags').querySelectorAll('[data-flag]').forEach(b => {
    b.setAttribute('aria-pressed', stu.flags.includes(b.dataset.flag) ? 'true' : 'false');
    b.querySelector('.n').textContent = groups.filter(STUDENT_FLAGS[b.dataset.flag].test).length;
  });
  document.querySelectorAll('[data-sort]').forEach(b => {
    const on = b.dataset.sort === stu.sort;
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.dataset.dir = on ? stu.dir : '';
    b.setAttribute('aria-label', `${b.textContent.trim()}, sort by ${STUDENT_SORTS[b.dataset.sort].label}${on ? ', ' + sortDirText() : ''}`);
  });
  document.getElementById('stu-clear').hidden = !stuFiltered();
}

// ── Student list ───────────────────────────────────────────────────────────
function groupStudents(rows) {
  const groups = [], seen = new Map();
  rows.forEach(r => {
    const k = studentKey(r);
    if (!seen.has(k)) { seen.set(k, groups.length); groups.push({ ...r, colleges: [] }); }
    groups[seen.get(k)].colleges.push(r);
  });
  return groups;
}
function renderEntries(rows) {
  const el = document.getElementById('entries'), head = document.getElementById('entries-heading');
  const more = document.getElementById('entries-more'), sub = document.getElementById('entries-sub');
  const groups = studentsInView(rows), total = groupStudents(rows).length;
  syncStudentControls(rows);
  head.textContent = slmFilter ? `${total} student${total !== 1 ? 's' : ''} like you` : 'Every student';
  if (!groups.length) {
    sub.textContent = ''; more.hidden = true;
    const any = allData.some(r => r.grad_year == 2026);
    el.innerHTML = total
      ? '<div class="empty-state" role="listitem"><h3>No students match</h3><p>Nobody in this view fits those filters together.</p><button type="button" class="btn-quiet" data-action="stu-clear">Clear these filters</button></div>'
      : slmFilter
      ? '<div class="empty-state" role="listitem"><h3>No matches</h3><p>No submissions match these filters yet. Try a wider range or remove one.</p><button type="button" class="btn-quiet" data-action="slm-clear">Clear student filters</button></div>'
      : (any && activeCollegeFilter !== 'All')
      ? `<div class="empty-state" role="listitem"><h3>No ${escHtml(activeCollegeFilter)} submissions yet</h3><p>Nobody has reported a decision from this category so far. Other categories have results.</p><button type="button" class="btn-quiet" data-action="schools-all">Show all schools</button></div>`
      : '<div class="empty-state" role="listitem"><h3>No results yet for 2026</h3><p>Be the first from Live Oak to share your college decisions.</p><button type="button" class="btn-main" data-action="go-submit">Add your results</button></div>';
    return;
  }
  const shown = Math.min(entriesShown || ENTRIES_PAGE, groups.length);
  sub.textContent = `${groups.length !== total ? `${groups.length} of ${total} students` : `${total} student${total !== 1 ? 's' : ''}`}${shown < groups.length ? `, showing ${shown}` : ''}`;
  // Every API string is escaped and shown exactly as typed.
  const e = v => escHtml(v == null ? '' : v);
  const gpa2 = v => isNaN(parseFloat(v)) ? e(v) || '<i>–</i>' : parseFloat(v).toFixed(2);
  el.innerHTML = groups.slice(0, shown).map((g, i) => {
    const bits = [g.act ? `ACT ${e(g.act)}` : '', g.class_rank ? `Rank ${e(g.class_rank)}` : '', g.essay_rating ? `Essay ${e(g.essay_rating)}/5` : '', g.first_gen === 'yes' ? 'First-gen' : ''].filter(Boolean).map(x => `<span>${x}</span>`).join('');
    const decs = g.colleges.map(c => `<li class="${c.enrolling === 'yes' ? 'is-going' : ''}">${decisionIcon(c.decision).outerHTML}<span>${isNoCollege(c) ? e(c.college_name) : `<button type="button" class="e-col" data-open-college="${e(c.college_name)}">${e(c.college_name)}</button>`}<span class="sr-only">: ${e(c.decision)}</span>${decisionExtras(c).length ? ` <small>${e(decisionExtras(c).join(', '))}</small>` : ''}</span></li>`).join('');
    return `<article class="entry-card" role="listitem" tabindex="-1" data-entry="${i}">
      <div class="e-num"><span class="e-l">GPA</span><b>${gpa2(g.gpa)}</b></div>
      <div class="e-num"><span class="e-l">Weighted</span>${g.gpa_weighted ? gpa2(g.gpa_weighted) : '<i>–</i>'}</div>
      <div class="e-num"><span class="e-l">SAT</span>${e(g.sat) || '<i>–</i>'}</div>
      <div class="e-major">${g.major ? e(g.major) : '<i>No major given</i>'}${bits ? `<div class="e-bits">${bits}</div>` : ''}</div>
      <div class="e-main"><ul class="entry-decisions">${decs}</ul>
      ${g.extracurriculars ? `<details class="entry-ecs"><summary>Extracurriculars</summary><p>${e(g.extracurriculars)}</p></details>` : ''}</div>
    </article>`;
  }).join('');
  more.hidden = shown >= groups.length;
  more.textContent = `Show ${Math.min(ENTRIES_PAGE, groups.length - shown)} more`;
}
function showMoreEntries() {
  const from = entriesShown;
  entriesShown += ENTRIES_PAGE;
  renderEntries(viewRows());
  const first = document.querySelector(`[data-entry="${from}"]`);
  if (first) first.focus({ preventScroll: true });
}

// ── Statistics ─────────────────────────────────────────────────────────────
// Four questions. Same rows as the rest of the page.
// Counts lead; a percentage or a filled bar appears only from MIN_RATE_N up.
const barRow = (label, pct, value, attr) => `<div class="bar-row"><div class="bar-label">${attr ? `<button type="button" ${attr}>${escHtml(label)}</button>` : escHtml(label)}</div><div class="bar-track" aria-hidden="true">${pct === null ? '' : `<div class="bar-fill" style="width:${Math.max(0, Math.min(100, pct)).toFixed(1)}%"></div>`}</div><div class="bar-val">${value}</div></div>`;
const rateRow = (label, a, n) => barRow(label, n >= MIN_RATE_N ? a / n * 100 : null, admitted(a, n));
const statBlock = (title, body, note) => body ? `<div class="stat-block"><h4>${title}</h4>${note ? `<p class="scope-note">${note}</p>` : ''}${body}</div>` : '';

// Builds the "for example" line in the statistics notice from the data on the
// page, so it can't go stale the way a hand-written example would.
function buildHardestRejectQuote(data) {
  const HI_GPA = 4.5;
  const rows = data.filter(r =>
    !isOpenAdmission(r) && parseFloat(r.gpa_weighted) >= HI_GPA &&
    (r.decision === 'Rejected' || r.decision === 'Waitlisted') && r.college_name);
  const seen = new Set(), names = [];
  rows.forEach(r => {
    const k = canonKey(r.college_name);
    if (seen.has(k)) return;
    seen.add(k); names.push(r.college_name);
  });
  if (!names.length) return null;
  const shown = names.slice(0, 5);
  const list = shown.length === 1 ? shown[0]
    : shown.slice(0, -1).join(', ') + ' and ' + shown[shown.length - 1];
  return shown.length === 1
    ? `For example: the one "no" from a student with a ${HI_GPA}+ weighted GPA is from ${list}. It's not a sign the GPA didn't work, just that it's a hard school.`
    : `For example: most of the "no"s from students with a ${HI_GPA}+ weighted GPA are from ${list}. It's not a sign the GPA didn't work, just that those are hard schools.`;
}

const DEST_ORDER = ['Community college', 'CSU', 'UC', 'Private 4-year', 'Public (out of state)', 'Trade school'];
function destOf(r) {
  const n = r.college_name || '';
  if (r.school_type === 'Trade') return 'Trade school';
  if (isOpenAdmission(r)) return 'Community college';
  if (UC_RE.test(n)) return 'UC';
  if (CSU_RE.test(n)) return 'CSU';
  if (isPublic(n)) return 'Public (out of state)';
  return 'Private 4-year';
}
const CA_PRIVATE_RE = /stanford|santa clara|chapman|university of san diego|usd\b|simpson|pepperdine|usc|occidental|pomona|claremont|harvey mudd|scripps|pitzer|loyola marymount|saint mary|university of the pacific|whittier|redlands|la verne|menlo|dominican/i;
const isInState = r => {
  const n = r.college_name || '';
  return UC_RE.test(n) || CSU_RE.test(n) || isOpenAdmission(r) || CA_PRIVATE_RE.test(n);
};
const openAttr = n => `data-open-college="${escHtml(n)}"`;
const share = (n, total) => total >= MIN_RATE_N ? `${n} (${Math.round(n / total * 100)}%)` : String(n);

function renderStatsInline(allRows) {
  const quote = buildHardestRejectQuote(scatterData);
  const qEl = document.getElementById('stats-disclaimer-quote');
  qEl.textContent = quote || '';
  qEl.hidden = !quote;

  const data = allRows.filter(r => !isNoCollege(r));
  const el = document.getElementById('stats-inline');
  const section = document.getElementById('stats-section');
  section.hidden = !data.length;
  if (!data.length) { el.innerHTML = ''; return; }
  const scope = activeCollegeFilter === 'All' ? 'all schools' : activeCollegeFilter;
  document.getElementById('stats-heading').textContent = `Statistics: ${scope}`;
  const students = new Set(data.map(studentKey)).size;
  document.getElementById('stats-scope-note').textContent =
    `Based on ${students} student${students !== 1 ? 's' : ''} and ${data.length} decision${data.length !== 1 ? 's' : ''}${slmFilter ? ` matching ${slmParts().map(p => p.text).join(', ')}` : ''}. Percentages appear only for groups of ${MIN_RATE_N} or more.`;

  const name = displayNamer(data);
  const uniq = rows => new Set(rows.map(studentKey)).size;
  const apps = new Map();
  data.forEach(r => {
    const k = canonKey(r.college_name);
    const a = apps.get(k) || { name: name(r.college_name), n: 0, acc: 0, enr: 0 };
    a.n++; if (r.decision === 'Accepted') a.acc++; if (r.enrolling === 'yes') a.enr++;
    apps.set(k, a);
  });
  const decided = r => ['Accepted', 'Rejected', 'Waitlisted'].includes(r.decision);
  const isYes = r => r.decision === 'Accepted';
  const fourYear = data.filter(r => !isOpenAdmission(r));

  // 1. Where people ended up. Enrolment is the truth where we have it;
  // otherwise acceptances, and the heading says so.
  const enrolled = data.filter(r => r.enrolling === 'yes');
  const basis = enrolled.length ? enrolled : data.filter(isYes);
  const byDest = DEST_ORDER.map(d => ({ d, rows: basis.filter(r => destOf(r) === d) })).filter(x => x.rows.length);
  const destTotal = byDest.reduce((s, x) => s + uniq(x.rows), 0);
  const inN = uniq(basis.filter(isInState)), outN = uniq(basis.filter(r => !isInState(r)));
  const enrollList = [...apps.values()].filter(a => a.enr > 1).sort((a, b) => b.enr - a.enr || a.name.localeCompare(b.name));
  const destinations =
    statBlock(`Type of school${enrolled.length ? '' : ' (by acceptance)'}`, byDest.map(x => barRow(x.d, uniq(x.rows) / destTotal * 100, share(uniq(x.rows), destTotal))).join('')) +
    statBlock('In or out of California', inN + outN ? barRow('In California', inN / (inN + outN) * 100, share(inN, inN + outN)) + barRow('Out of state', outN / (inN + outN) * 100, share(outN, inN + outN)) : '') +
    statBlock('Colleges with more than one student enrolling', enrollList.map(a => barRow(a.name, a.enr / enrollList[0].enr * 100, a.enr, openAttr(a.name))).join(''));

  // 2. Grades.
  const q = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a[Math.floor((a.length - 1) * p)]; };
  const pos = v => Math.max(0, Math.min(100, (v - 1) / 3 * 100));
  const gpaRange = byDest.map(x => ({ d: x.d, g: x.rows.map(r => parseFloat(r.gpa)).filter(v => !isNaN(v)) })).filter(x => x.g.length >= MIN_RATE_N).map(({ d, g }) => {
    const lo = q(g, .25), mid = q(g, .5), hi = q(g, .75);
    return `<div class="bar-row"><div class="bar-label">${d}</div><div class="bar-track is-scale" aria-hidden="true"><i style="left:${pos(lo)}%;width:${Math.max(1, pos(hi) - pos(lo))}%"></i><u style="left:${pos(mid)}%"></u></div><div class="bar-val">${lo.toFixed(2)} to ${hi.toFixed(2)}</div></div>`;
  }).join('');
  const bands = [['Under 2.5', 0, 2.5], ['2.5 to 3.0', 2.5, 3], ['3.0 to 3.5', 3, 3.5], ['3.5 to 4.0', 3.5, 4], ['4.0 to 4.5', 4, 4.5], ['4.5 and up', 4.5, 99]].map(([label, lo, hi]) => {
    const rows = fourYear.filter(r => { const g = parseFloat(r.gpa_weighted); return g >= lo && g < hi; });
    return rows.length ? rateRow(label, rows.filter(isYes).length, rows.length) : '';
  }).join('');
  const grades =
    statBlock('Unweighted GPA by type of school', gpaRange, 'The bar is the middle half of students and the line is the median, on a 1.0 to 4.0 scale.') +
    statBlock('Four-year admissions by weighted GPA', bands, 'A lower rate in a band usually means those students applied to harder schools.');

  // 3. Colleges. One applicant is not a trend, so single reports are left out.
  const top = [...apps.values()].filter(a => a.n >= 2).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).slice(0, 12);
  const hardest = [...apps.values()].filter(a => a.acc && getAcceptRate(a.name) && getAcceptRate(a.name) <= 35 && !isOpenAdmission({ college_name: a.name, school_type: 'University' }))
    .sort((a, b) => getAcceptRate(a.name) - getAcceptRate(b.name)).slice(0, 8);
  const colleges =
    statBlock('Most applied to', top.map(a => barRow(a.name, a.n / top[0].n * 100, `${a.acc} of ${a.n} in`, openAttr(a.name))).join('')) +
    statBlock('Hardest to get into, with at least one yes', hardest.map(a => `<div class="pair-row"><span><button type="button" ${openAttr(a.name)}>${escHtml(a.name)}</button></span><span>${a.acc} of ${a.n} in</span><span>about ${getAcceptRate(a.name)}% overall</span></div>`).join(''),
      'Ordered by approximate overall admission rates, which are unverified estimates. <a href="/methodology.html#admission-rates">About these rates</a>') +
    statBlock('Every decision', DECISION_ORDER.map(d => ({ d, n: data.filter(r => r.decision === d).length })).filter(x => x.n).map(x => `<div class="bar-row"><div class="bar-label">${x.d}</div><div class="bar-track" aria-hidden="true"><div class="bar-fill b-${x.d}" style="width:${x.n / data.length * 100}%"></div></div><div class="bar-val">${share(x.n, data.length)}</div></div>`).join(''));

  // 4. Timing, money, majors. Four-year colleges only for the first two:
  // community colleges admit everyone and don't award admission scholarships.
  const rounds = [['Early (EA or ED)', ['EA', 'ED']], ['Regular (RD)', ['RD']]].map(([label, types]) => {
    const rows = fourYear.filter(r => decided(r) && types.includes(r.decision_type));
    return rows.length ? rateRow(label, rows.filter(isYes).length, rows.length) : '';
  }).join('');
  const schol = DEST_ORDER.filter(d => d !== 'Community college').map(d => {
    const rows = data.filter(r => isYes(r) && destOf(r) === d);
    return rows.length ? rateRow(d, rows.filter(r => r.scholarship === 'yes').length, rows.length) : '';
  }).join('');
  const majors = new Map(), seen = new Set();
  data.forEach(r => {
    const k = studentKey(r), m = normMajor(r.major);
    if (seen.has(k)) return;
    seen.add(k);
    if (m) { const g = majors.get(m) || { n: 0, label: r.major.trim() }; g.n++; majors.set(m, g); }
  });
  const topMajors = [...majors.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)).slice(0, 8);
  const timing =
    statBlock('Admitted, early or regular (four-year colleges)', rounds) +
    statBlock('Acceptances that came with a scholarship', schol) +
    statBlock('Popular majors', topMajors.map(m => barRow(m.label, m.n / topMajors[0].n * 100, m.n, `data-major="${escHtml(normMajor(m.label))}" aria-label="Show only ${escHtml(m.label)}"`)).join(''), 'Pick a major to see only those students.');

  el.innerHTML = [['Where did people go?', destinations], ['What grades did they have?', grades], ['Which colleges said yes?', colleges], ['Early, scholarships and majors', timing]].map(([t, html]) =>
    `<section class="stat-group"><h3 class="stat-q">${t}</h3><div class="stat-panel">${html || '<p class="scope-note">Not enough data in this view yet.</p>'}</div></section>`).join('');
}
// ── College autocomplete ───────────────────────────────────────────────────
function getKnownColleges() {
  const submitted = allData.map(r=>r.college_name).filter(Boolean);
  return [...new Set([...ALL_COLLEGES, ...submitted])].sort();
}
function addCollege(name='', decision='Accepted', decisionType='RD', schoolType='University', enrolling='', scholarship='', sport='') {
  const id = collegeCount++;
  const div = document.createElement('div');
  div.id = `cr-${id}`;
  div.className = 'college-row';
  div.style.cssText = 'animation:none;opacity:1;flex-wrap:wrap;';
  setTimeout(() => { div.style.cssText = 'flex-wrap:wrap;'; }, 50);
  const inputStyle = "padding:9px 12px;border:1px solid var(--border-2);border-radius:6px;font-size:calc(14px * var(--fs));font-family:inherit;color:var(--text);background:var(--surface);outline:none;transition:border-color .15s,box-shadow .15s;";
  div.innerHTML = `
    <div class="college-row-name">
      <input type="text" id="cn-${id}" aria-label="College name" placeholder="College name" value="${name.replace(/"/g,'&quot;')}" autocomplete="off"
        style="width:100%;${inputStyle}"
        oninput="showSuggestions('cn-${id}')" onblur="setTimeout(()=>hideSuggestions('cn-${id}'),350)"
        onfocus="this.style.borderColor='#a8b8d8';this.style.boxShadow='0 0 0 3px rgba(79,114,196,0.08)'">
      <div class="sug-drop" id="sug-${id}"></div>
    </div>
    <div class="college-row-decision">
      <select id="cd-${id}" aria-label="Decision" style="width:100%;${inputStyle}"
        onfocus="this.style.borderColor='#a8b8d8';this.style.boxShadow='0 0 0 3px rgba(79,114,196,0.08)'"
        onblur="this.style.borderColor='var(--border-2)';this.style.boxShadow='none'">
        ${DECISIONS.map(d=>`<option${d===decision?' selected':''}>${d}</option>`).join('')}
      </select>
    </div>
    <div class="college-row-decision">
      <select id="cat-${id}" aria-label="Application round" style="width:100%;${inputStyle}"
        onfocus="this.style.borderColor='#a8b8d8';this.style.boxShadow='0 0 0 3px rgba(79,114,196,0.08)'"
        onblur="this.style.borderColor='var(--border-2)';this.style.boxShadow='none'">
        <option value="RD"${decisionType==='RD'?' selected':''}>Regular Decision</option>
        <option value="EA"${decisionType==='EA'?' selected':''}>Early Action</option>
        <option value="ED"${decisionType==='ED'?' selected':''}>Early Decision</option>
        <option value="Rolling"${decisionType==='Rolling'?' selected':''}>Rolling</option>
      </select>
    </div>
    <button type="button" class="college-row-remove" aria-label="Remove this college" onclick="removeCollege('cr-${id}')">×</button>
    <div style="flex-basis:100%;display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;margin-top:2px;margin-left:2px;">
      <label for="st-${id}" style="font-size:calc(11px * var(--fs));color:var(--text-3);">School type</label>
      <select id="st-${id}" style="${inputStyle}padding:4px 10px;font-size:calc(12.5px * var(--fs));width:auto;min-width:170px;flex:0 0 auto;"
        onfocus="this.style.borderColor='#a8b8d8';this.style.boxShadow='0 0 0 3px rgba(79,114,196,0.08)'"
        onblur="this.style.borderColor='var(--border-2)';this.style.boxShadow='none'">
        <option value="University"${schoolType==='University'?' selected':''}>4-year university</option>
        <option value="Community"${schoolType==='Community'?' selected':''}>Community college</option>
        <option value="Trade"${schoolType==='Trade'?' selected':''}>Trade / vocational school</option>
      </select>
      <label style="font-size:calc(11px * var(--fs));color:var(--text-3);display:flex;align-items:center;gap:4px;cursor:pointer;">
        <input type="checkbox" id="en-${id}" ${enrolling==='yes'?'checked':''} style="width:11px;height:11px;accent-color:var(--accent);cursor:pointer;margin:0;"> Enrolling here
      </label>
      <label style="font-size:calc(11px * var(--fs));color:var(--text-3);display:flex;align-items:center;gap:4px;cursor:pointer;">
        <input type="checkbox" id="sc-${id}" ${scholarship==='yes'?'checked':''} style="width:11px;height:11px;accent-color:var(--accent);cursor:pointer;margin:0;"> Got scholarship
      </label>
      <label style="font-size:calc(11px * var(--fs));color:var(--text-3);display:flex;align-items:center;gap:4px;cursor:pointer;">
        <input type="checkbox" id="sp-${id}" ${sport==='yes'?'checked':''} style="width:11px;height:11px;accent-color:var(--accent);cursor:pointer;margin:0;"> Sports recruitment
      </label>
    </div>`;
  document.getElementById('college-inputs').appendChild(div);
}
function removeCollege(id) {
  const el = document.getElementById(id);
  el.style.cssText = 'opacity:0;transform:translateX(8px);transition:opacity .15s,transform .15s;';
  setTimeout(() => el.remove(), 150);
}
function showSuggestions(inputId) {
  const input = document.getElementById(inputId);
  const sug = document.getElementById(inputId.replace('cn-','sug-'));
  const val = input.value.toLowerCase().trim();
  if (!val) { sug.style.display='none'; return; }
  const matches = getKnownColleges().filter(c => c.toLowerCase().includes(val));
  if (!matches.length) { sug.style.display='none'; return; }
  sug.innerHTML = matches.slice(0,7).map(c => {
    const rate = getAcceptRate(c);
    return `<div class="sug-item" onmousedown="selectSuggestion('${inputId}','${c.replace(/'/g,"\\'")}');event.preventDefault();">${c}<span class="sug-rate">${rate?rate+'%':''}</span></div>`;
  }).join('');
  sug.style.display = 'block';
}
function selectSuggestion(inputId, val) { document.getElementById(inputId).value=val; hideSuggestions(inputId); }
function hideSuggestions(inputId) { const s=document.getElementById(inputId.replace('cn-','sug-')); if(s) s.style.display='none'; }

// ── Major autocomplete ─────────────────────────────────────────────────────
function showMajorSuggestions() {
  const input = document.getElementById('f-major');
  const sug = document.getElementById('major-sug');
  const val = input.value.toLowerCase().trim();
  if (!val) { sug.style.display='none'; return; }
  const matches = ALL_MAJORS.filter(m => m.toLowerCase().includes(val));
  if (!matches.length) { sug.style.display='none'; return; }
  sug.innerHTML = matches.slice(0,7).map(m =>
    `<div class="sug-item" onmousedown="document.getElementById('f-major').value='${m}';hideMajorSuggestions();event.preventDefault();">${m}</div>`
  ).join('');
  sug.style.display = 'block';
}
function hideMajorSuggestions() { document.getElementById('major-sug').style.display='none'; }

// ── Load existing submission ───────────────────────────────────────────────
async function loadExistingSubmission() {
  try {
    const res = await fetch(`/api/submissions/${SESSION_ID}`);
    const data = await res.json();
    document.getElementById('college-inputs').innerHTML = '';
    collegeCount = 0;
    if (data && data.length > 0) {
      const r = data[0];
      document.getElementById('f-gpa').value = r.gpa||'';
      document.getElementById('f-gpa-w').value = r.gpa_weighted||'';
      document.getElementById('f-sat').value = r.sat||'';
      document.getElementById('f-act').value = r.act||'';
      document.getElementById('f-rank').value = r.class_rank||'';
      document.getElementById('f-major').value = r.major||'';
      document.getElementById('f-ecs').value = r.extracurriculars||'';
      document.getElementById('f-first-gen').checked = r.first_gen==='yes';
      document.getElementById('f-year').value = '2026';
      if (r.essay_rating) document.getElementById('f-essay').value = r.essay_rating;
      data.forEach(row => addCollege(row.college_name||'', row.decision||'Accepted', row.decision_type||'RD', row.school_type||'University', row.enrolling||'', row.scholarship||'', row.sport||''));
      document.getElementById('submit-btn').textContent = 'Update Submission';
      document.getElementById('form-title').textContent = 'Edit your Submission';
      document.getElementById('form-subtitle').textContent = 'Update your results below.';
      document.getElementById('anon-badge').style.display = 'none';
      document.getElementById('delete-wrap').style.display = 'block';
    } else {
      ['f-gpa','f-gpa-w','f-sat','f-act','f-rank','f-major','f-ecs']
        .forEach(id => document.getElementById(id).value='');
      document.getElementById('f-year').value = '2026';
      document.getElementById('f-first-gen').checked = false;
      document.getElementById('f-essay').value = '';
      addCollege();
      document.getElementById('submit-btn').textContent = 'Submit';
      document.getElementById('form-title').textContent = 'Add your college results';
      document.getElementById('form-subtitle').textContent = 'Share your decisions to help future Live Oak students.';
      document.getElementById('anon-badge').style.display = 'flex';
      document.getElementById('delete-wrap').style.display = 'none';
    }
  } catch(e) { addCollege(); }
}

// ── Submit ─────────────────────────────────────────────────────────────────
async function submitForm() {
  const gpa = parseFloat(document.getElementById('f-gpa').value);
  const gpaW = parseFloat(document.getElementById('f-gpa-w').value)||null;
  const year = parseInt(document.getElementById('f-year').value);
  if (!gpa||!gpaW||!year) { alert('Unweighted GPA, weighted GPA, and graduation year are required.'); return; }
  if (!document.getElementById('f-consent').checked) { alert('Please check the box confirming your results will be shown publicly (without your name).'); return; }
  if (gpa>4) { alert('Unweighted GPA cannot exceed 4.0'); return; }
  if (gpaW>5) { alert('Weighted GPA cannot exceed 5.0'); return; }
  const rows = [];
  for (let i=0; i<collegeCount; i++) {
    const cn = document.getElementById(`cn-${i}`), cd = document.getElementById(`cd-${i}`);
    if (cn && cn.value.trim()) rows.push({
      gpa, grad_year: year, gpa_weighted: gpaW,
      sat: parseInt(document.getElementById('f-sat').value)||null,
      act: parseInt(document.getElementById('f-act').value)||null,
      class_rank: parseInt(document.getElementById('f-rank').value)||null,
      major: document.getElementById('f-major').value.trim()||null,
      extracurriculars: document.getElementById('f-ecs').value.trim()||null,
      sport: document.getElementById(`sp-${i}`)?.checked ? 'yes' : null,
      first_gen: document.getElementById('f-first-gen').checked?'yes':null,
      essay_rating: document.getElementById('f-essay').value||null,
      decision_type: document.getElementById(`cat-${i}`)?.value||null,
      school_type: document.getElementById(`st-${i}`)?.value||'University',
      enrolling: document.getElementById(`en-${i}`)?.checked ? 'yes' : null,
      scholarship: document.getElementById(`sc-${i}`)?.checked ? 'yes' : null,
      college_name: cn.value.trim(), decision: cd.value, session_id: SESSION_ID
    });
  }
  if (!rows.length) { alert('Add at least one college.'); return; }
  try {
    const res = await fetch('/api/submissions', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({session_id: SESSION_ID, colleges: rows})
    });
    const result = await res.json();
    if (!result.success) { alert('Something went wrong. Try again.'); return; }
  } catch(e) { alert('Something went wrong. Try again.'); return; }
  localStorage.setItem('cr_submitted','1');
  updateNav();
  showCelebration(() => showPage('results'));
}
async function deleteSubmission() {
  if (!confirm('Delete your submission? This cannot be undone.')) return;
  try {
    await fetch(`/api/submissions/${SESSION_ID}`, {method:'DELETE'});
    localStorage.removeItem('cr_submitted');
    updateNav();
    loadExistingSubmission();
  } catch(e) { alert('Error deleting submission.'); }
}

// ── Chatbot ────────────────────────────────────────────────────────────────
function toggleChat(force) {
  const panel = document.getElementById('chat-panel');
  const fab = document.getElementById('chat-fab');
  const open = typeof force === 'boolean' ? force : !panel.classList.contains('open');
  const hadFocus = panel.contains(document.activeElement);
  panel.classList.toggle('open', open);
  fab.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) document.getElementById('chat-input').focus();
  else if (hadFocus) fab.focus();
}
// Questions go to /api/questions and show up on the admin page.
async function sendChat() {
  const input = document.getElementById('chat-input');
  const msgs = document.getElementById('chat-msgs');
  const sendBtn = document.querySelector('.chat-send');
  const text = input.value.trim();
  if (!text || input.disabled) return;
  const addMsg = (cls, str) => {
    const m = document.createElement('div');
    m.className = cls; m.textContent = str;
    msgs.appendChild(m); msgs.scrollTop = msgs.scrollHeight;
    return m;
  };
  addMsg('chat-msg-user', text);
  input.value = '';
  input.disabled = true; if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = 'Sending…'; }
  let ok = false, errMsg = '';
  try {
    const res = await fetch('/api/questions', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ question: text })
    });
    ok = res.ok;
    if (!ok) errMsg = res.status === 429 ? 'Too many messages. Wait a minute and try again.' : 'Something went wrong on our end.';
  } catch (e) { errMsg = "Couldn't reach the server. Check your connection."; }
  input.disabled = false; if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Send'; }
  if (ok) {
    addMsg('chat-msg-bot', "Sent. The site admins will see your question on their admin page. They can't reply in this box.");
  } else {
    addMsg('chat-msg-bot', errMsg + ' Your question was not sent.');
    input.value = text;
  }
  input.focus();
}

// ── Theme ──────────────────────────────────────────────────────────────────
// boot.js sets the theme and text size before first paint. No saved choice
// means the device's own light/dark setting.
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  const label = document.getElementById('theme-toggle-text');
  if (label) label.textContent = theme === 'dark' ? 'Light' : 'Dark';
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.title = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
}
function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem('cr_theme', next); } catch(e) {}
}
// ── Text size ──────────────────────────────────────────────────────────────
const TEXT_SIZES = [1, 1.15, 1.3, 1.5];
let textScale = 1.15;
function applyTextSize(scale, rebuild) {
  textScale = TEXT_SIZES.includes(scale) ? scale : 1.15;
  document.documentElement.style.setProperty('--fs', textScale);
  const i = TEXT_SIZES.indexOf(textScale);
  // aria-disabled rather than disabled: a disabled button drops keyboard
  // focus to <body> the moment you reach the largest or smallest size.
  const sm = document.getElementById('text-smaller'), bg = document.getElementById('text-bigger');
  if (sm) sm.setAttribute('aria-disabled', i === 0 ? 'true' : 'false');
  if (bg) bg.setAttribute('aria-disabled', i === TEXT_SIZES.length - 1 ? 'true' : 'false');
  if (rebuild && _dataLoadedAt) buildChart();
}
function changeTextSize(dir) {
  const i = TEXT_SIZES.indexOf(textScale);
  const next = TEXT_SIZES[Math.min(TEXT_SIZES.length - 1, Math.max(0, i + dir))];
  try { localStorage.setItem('cr_textsize', String(next)); } catch(e) {}
  applyTextSize(next, true);
}
applyTheme(document.documentElement.dataset.theme);
try { applyTextSize(parseFloat(localStorage.getItem('cr_textsize')) || 1.15, false); } catch(e) {}

// ── Event wiring ───────────────────────────────────────────────────────────
// Listeners instead of inline handlers, so these surfaces work under a
// Content-Security-Policy without 'unsafe-inline'. The submission form keeps
// its own inline handlers (see deploy/proposed).
const UI_ACTIONS = {
  'cta-share': () => showPage('submit', { focus: true }),
  'retry-load': () => loadData(),
  'schools-all': () => setCollegeFilter('All', { track: false }),
  'clear-search': () => {
    const s = document.getElementById('college-search');
    s.value = ''; filterChart(''); s.focus();
  },
  'decision-clear': () => { if (activeFilter) toggleFilter(activeFilter); document.getElementById('college-search').focus(); },
  'saved-off': () => { savedOnly = false; buildChart({ motion: true }); document.getElementById('chart-sort').focus(); },
  'stu-clear': () => { updateStudents({ college: '', flags: [], q: '' }); document.getElementById('stu-find').focus(); },
  'slm-clear': () => { clearSlm(); document.getElementById('slm-gpa').focus(); },
  'go-submit': () => showPage('submit', { focus: true }),
};

function bindUi() {
  const $ = id => document.getElementById(id);

  // Nav links are real links (new tab, copy link and the like still work);
  // a plain click switches views in place.
  document.querySelectorAll('.nav-link[data-page]').forEach(a => a.addEventListener('click', e => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (a.dataset.view) setView(a.dataset.view, { focus: true });
    else showPage(a.dataset.page, { focus: true });
  }));
  $('text-smaller').addEventListener('click', () => changeTextSize(-1));
  $('text-bigger').addEventListener('click', () => changeTextSize(1));
  $('theme-toggle').addEventListener('click', toggleTheme);

  document.addEventListener('click', e => {
    const a = e.target.closest('[data-action]');
    if (a && UI_ACTIONS[a.dataset.action]) UI_ACTIONS[a.dataset.action](a);
  });

  // Filters
  $('college-filter-bar').addEventListener('click', e => {
    const b = e.target.closest('[data-schools]');
    if (b) setCollegeFilter(b.dataset.schools);
  });
  $('slm-toggle').addEventListener('click', () => {
    const open = $('slm-panel').classList.toggle('open');
    $('slm-toggle').setAttribute('aria-expanded', open ? 'true' : 'false');
    if (!open) return;
    $('slm-panel').scrollIntoView({ block: 'start', behavior: REDUCED_MOTION ? 'auto' : 'smooth' });
    $('slm-gpa').focus({ preventScroll: true });
  });
  ['slm-gpa', 'slm-sat'].forEach(id => {
    $(id).addEventListener('input', applySlmSoon);
    $(id).addEventListener('change', applySlm);
  });
  ['slm-gpa-range', 'slm-sat-range', 'slm-major'].forEach(id => $(id).addEventListener('change', applySlm));
  $('slm-form').addEventListener('submit', e => { e.preventDefault(); applySlm(); });
  $('slm-active').addEventListener('click', e => {
    const b = e.target.closest('[data-slm-remove]');
    if (!b) return;
    removeSlm(b.dataset.slmRemove);
    ($('slm-active').querySelector('button') || $('slm-toggle')).focus();
    if (document.activeElement === document.body) $('slm-gpa').focus();
  });

  // Chart
  document.querySelectorAll('[data-metric]').forEach(b => b.addEventListener('click', () => switchChart(b.dataset.metric)));
  $('compare-open').addEventListener('click', openCompare);
  $('college-search').addEventListener('input', e => filterChart(e.target.value));
  $('legend').addEventListener('click', e => {
    const b = e.target.closest('[data-decision]');
    if (b) toggleFilter(b.dataset.decision);
  });
  $('chart-more').addEventListener('click', () => {
    chartExpanded = !chartExpanded;
    buildChart();
    if (!chartExpanded) $('chart-section').scrollIntoView({ block: 'start' });
  });
  $('chart-table').addEventListener('click', e => {
    const b = e.target.closest('[data-open-college]');
    if (b) openCollegeDetail(b.dataset.openCollege, { track: false });
  });
  if ($('you-panel')) $('you-panel').addEventListener('click', e => { const b = e.target.closest('[data-open-college]'); if (b) openCollegeDetail(b.dataset.openCollege, { track: false }); });
  bindChartInteractions($('chart-main'));
  // Redraw on width changes only: phones fire "resize" whenever the address
  // bar slides away.
  let lastW = 0;
  new ResizeObserver(() => {
    const w = $('chart-main').clientWidth;
    if (w && lastW && w !== lastW && _dataLoadedAt) buildChart();
    if (w) lastW = w;
  }).observe($('chart-main'));

  // Numbers: college names open details, majors filter the page
  $('stats-inline').addEventListener('click', e => {
    const c = e.target.closest('[data-open-college]');
    if (c) return openCollegeDetail(c.dataset.openCollege, { track: false });
    const m = e.target.closest('[data-major]');
    if (m) { $('slm-major').value = m.dataset.major; applySlm(); $('slm-panel').classList.add('open'); $('slm-toggle').setAttribute('aria-expanded', 'true'); $('results-title').focus({ preventScroll: true }); window.scrollTo(0, 0); }
  });

  // Students
  $('entries-more').addEventListener('click', showMoreEntries);
  $('entries').addEventListener('click', e => { const c = e.target.closest('[data-open-college]'); if (c) openCollegeDetail(c.dataset.openCollege, { track: false }); });
  $('stu-sort').addEventListener('change', e => updateStudents({ sort: e.target.value, dir: STUDENT_SORTS[e.target.value].dir }));
  $('stu-dir').addEventListener('click', () => updateStudents({ dir: stu.dir === 'asc' ? 'desc' : 'asc' }));
  $('e-head').addEventListener('click', e => { const b = e.target.closest('[data-sort]'); if (b) sortStudents(b.dataset.sort); });
  $('stu-find').addEventListener('input', e => updateStudents({ q: e.target.value }, { typing: true }));
  $('stu-college').addEventListener('change', e => updateStudents({ college: e.target.value }));
  $('stu-flags').addEventListener('click', e => {
    const b = e.target.closest('[data-flag]');
    if (!b) return;
    const f = b.dataset.flag;
    updateStudents({ flags: stu.flags.includes(f) ? stu.flags.filter(x => x !== f) : [...stu.flags, f] });
  });

  // Saved colleges and chart order
  $('chart-sort').addEventListener('change', e => setChartSort(e.target.value));
  $('saved-filter').addEventListener('click', () => { savedOnly = !savedOnly; buildChart({ motion: true }); announceChart(); syncSaved(); });
  $('college-modal').addEventListener('click', e => {
    const s = e.target.closest('[data-save]');
    if (s) return toggleSaved(s.dataset.save);
    const b = e.target.closest('[data-students-at]');
    if (!b) return;
    const at = b.dataset.studentsAt;
    closeModal('college-modal', { restoreFocus: false });
    stu = { ...STUDENT_DEFAULTS, flags: [], college: at };
    entriesShown = ENTRIES_PAGE;
    setView('students', { focus: true });
    renderEntries(viewRows());
  });
  syncSaved();

  // Dialogs
  document.querySelectorAll('[data-close-modal]').forEach(b => b.addEventListener('click', () => closeModal(b.dataset.closeModal)));
  document.querySelectorAll('.modal-overlay[data-dismissable]').forEach(o => o.addEventListener('click', e => {
    if (e.target === o) closeModal(o.id);
  }));
  $('sd-ack').addEventListener('click', acknowledgeStatsDisclaimer);
  $('compare-modal').addEventListener('change', e => { if (e.target.matches('.compare-pick select')) renderCompare(); });

  // Question panel
  $('chat-fab').addEventListener('click', () => toggleChat());
  $('chat-close').addEventListener('click', () => toggleChat(false));
  $('chat-send').addEventListener('click', sendChat);
  $('chat-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

  // One Escape handler, in priority order: the open dialog (except the stats
  // notice, which is closed only by "Got it"), then the question panel, then
  // a mark's details pane.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (_openModalId) {
      const o = document.getElementById(_openModalId);
      if (o && o.dataset.dismissable) { e.preventDefault(); closeModal(_openModalId); }
      return;
    }
    const panel = $('chat-panel');
    if (panel.classList.contains('open') && (panel.contains(document.activeElement) || document.activeElement === $('chat-fab'))) {
      toggleChat(false); $('chat-fab').focus(); return;
    }
    if (_tooltipDot) unpinDot();
  });

  // Keep anchor jumps, focused controls and the chart's axis clear of the
  // sticky filter bar, whose height changes with text size and filters.
  const bar = $('filters');
  const nav = document.querySelector('nav');
  const setBarH = () => {
    document.documentElement.style.setProperty('--bar-h', bar.offsetHeight + 'px');
    document.documentElement.style.setProperty('--nav-h', (getComputedStyle(nav).position === 'sticky' ? nav.offsetHeight : 56) + 'px');
  };
  setBarH();
  const ro = new ResizeObserver(setBarH);
  ro.observe(bar); ro.observe(nav);
}

// Colleges, Numbers and Students are links to ?view=…; a plain click swaps the
// view in place.
function setView(v, opts) {
  view = v;
  // showPage writes the URL itself once it has switched.
  if (currentPage !== 'results') showPage('results');
  else writeUrlState(true);
  syncView();
  if (v === 'colleges' && _dataLoadedAt) buildChart();
  if (opts && opts.focus) document.getElementById('results-title').focus();
  window.scrollTo(0, 0);
}
function syncView() {
  document.getElementById('page-results').dataset.view = view;
  document.querySelectorAll('.nav-link[data-view]').forEach(a => {
    const on = currentPage === 'results' && a.dataset.view === view;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  setDocTitle(currentPage);
}

// Chart: click or tap anywhere in a row to pick its nearest mark; click a name
// for details. Keyboard: one Tab stop on the college names, Up/Down between
// them, Enter for details, Right into a college's marks, Left/Right along
// them, Escape to hide a mark's pane and return to its name.
function bindChartInteractions(chartMain) {
  const nameOf = t => t && t.closest && t.closest('.c-name[data-col]');
  const dotOf = t => t && t.closest && t.closest('.chart-dot');
  const names = () => [...chartMain.querySelectorAll('.c-name[data-col]')];
  const dotsIn = col => [...chartMain.querySelectorAll(`.chart-dot[data-col="${col}"]`)]
    .sort((a, b) => a.dataset.cx - b.dataset.cx || a.dataset.cy - b.dataset.cy);
  const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  chartMain.addEventListener('mousemove', e => {
    if (!canHover || _tooltipPinned) return;
    const svg = e.target.closest('.c-plot svg');
    const d = svg && nearestDot(svg, e, 14);
    if (!d) { if (_tooltipDot) unpinDot(); return; }
    if (d !== _tooltipDot) showDot(d, false, { x: e.clientX, y: e.clientY });
  });
  chartMain.addEventListener('mouseleave', () => { if (_tooltipDot && !_tooltipPinned) unpinDot(); });
  chartMain.addEventListener('click', e => {
    const star = e.target.closest('[data-save]');
    if (star) return toggleSaved(star.dataset.save);
    const l = nameOf(e.target);
    if (l) { focusChartItem(l); return openCollegeDetail(_chartCols[+l.dataset.col]); }
    const svg = e.target.closest('.c-plot svg');
    if (!svg) return;
    const d = dotOf(e.target) || nearestDot(svg, e, 24);
    if (d) showDot(d, true, { x: e.clientX, y: e.clientY });
    else if (_tooltipDot) unpinDot();
  });
  chartMain.addEventListener('focusin', e => {
    const d = dotOf(e.target);
    if (d) { if (d !== _tooltipDot) showDot(d, true); }
    else if (_tooltipDot) unpinDot();
  });
  chartMain.addEventListener('focusout', e => {
    if (e.relatedTarget && chartMain.contains(e.relatedTarget)) return;
    if (_tooltipDot && dotOf(e.target)) unpinDot();
  });
  chartMain.addEventListener('keydown', e => {
    const l = nameOf(e.target), d = dotOf(e.target);
    if (!l && !d) return;
    const all = names(), col = +(l || d).dataset.col;
    const moveTo = i => { if (all[i]) focusChartItem(all[i]); };
    let handled = true;
    if (e.key === 'ArrowDown') moveTo(Math.min(all.length - 1, col + 1));
    else if (e.key === 'ArrowUp') moveTo(Math.max(0, col - 1));
    else if (e.key === 'Home') moveTo(0);
    else if (e.key === 'End') moveTo(all.length - 1);
    else if (l) {
      if (e.key === 'ArrowRight') { const ds = dotsIn(col); if (ds.length) ds[0].focus(); }
      else if (e.key === 's' || e.key === 'S') { if (e.metaKey || e.ctrlKey || e.altKey) return; toggleSaved(l.closest('.c-row').dataset.key); }
      else handled = false;                       // Enter/Space are a real button's click
    } else {
      const ds = dotsIn(col), i = ds.indexOf(d);
      if (e.key === 'ArrowRight') { if (ds[i + 1]) ds[i + 1].focus(); }
      else if (e.key === 'ArrowLeft') { if (ds[i - 1]) ds[i - 1].focus(); else moveTo(col); }
      else if (e.key === 'Escape') { e.stopPropagation(); unpinDot(); moveTo(col); }
      else if (e.key === 'Enter' || e.key === ' ') showDot(d, true);
      else handled = false;
    }
    if (handled) e.preventDefault();
  });
}

// ── Init ───────────────────────────────────────────────────────────────────
function applyUrlState(s) {
  activeChartType = s.chart;
  activeCollegeFilter = s.schools;
  searchFilter = s.q.toLowerCase().trim();
  activeFilter = s.decision;
  view = s.view;
  chartSort = s.sort;
  stu = s.stu;
  syncControlsToState();
}
document.addEventListener('DOMContentLoaded', bindUi);
document.addEventListener('DOMContentLoaded', async () => {
  // Restore whatever view the URL describes before the first render.
  const initial = readStateFromUrl();
  applyUrlState(initial);
  updateCollegeFilterTabs();
  if (initial.page === 'submit') {
    document.getElementById('page-results').classList.remove('active');
    document.getElementById('page-submit').classList.add('active');
    document.getElementById('nav-results').classList.remove('active');
    document.getElementById('nav-results').removeAttribute('aria-current');
    document.getElementById('nav-submit').classList.add('active');
    document.getElementById('nav-submit').setAttribute('aria-current', 'page');
    setDocTitle('submit');
    currentPage = 'submit';
    loadExistingSubmission();
  }
  updateNav();
  await loadData();
  if (initial.college) openCollegeDetail(initial.college);
  fetch('/api/track', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session_id:SESSION_ID})}).catch(()=>{});
});

window.addEventListener('popstate', () => {
  _suppressUrlWrite = true;
  try {
    const state = readStateFromUrl();
    applyUrlState(state);
    closeModal('college-modal');
    if (state.page !== currentPage) showPage(state.page, {fromPopstate: true});
    if (currentPage === 'results' && _dataLoadedAt) renderResults();
    if (state.college) openCollegeDetail(state.college);
  } finally {
    _suppressUrlWrite = false;
  }
});

function trackEvent(type, value) {
  fetch('/api/track/event', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ type, value: value == null ? null : String(value), session_id: SESSION_ID })
  }).catch(()=>{});
}

// ── Statistics notice ──────────────────────────────────────────────────────
// Shown once, as the statistics scroll into view. Acknowledged state is
// remembered so returning visitors aren't nagged again.
const STATS_DISCLAIMER_KEY = 'cr_stats_disclaimer_ack';
let statsGateObserver = null;
function initStatsDisclaimerGate() {
  if (localStorage.getItem(STATS_DISCLAIMER_KEY) === '1') return;
  const target = document.getElementById('stats-inline');
  if (!target || target.dataset.gateBound) return;
  target.dataset.gateBound = '1';
  statsGateObserver = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      openModal('stats-disclaimer-modal', { fallback: 'stats-heading' });
      statsGateObserver.unobserve(e.target);
    });
  }, { threshold: 0, rootMargin: '0px 0px -60% 0px' });
  statsGateObserver.observe(target);
}
function acknowledgeStatsDisclaimer() {
  localStorage.setItem(STATS_DISCLAIMER_KEY, '1');
  closeModal('stats-disclaimer-modal');
}

// ── Celebration overlay ────────────────────────────────────────────────────
function showCelebration(onDone) {
  const overlay = document.getElementById('celebration-overlay');
  const canvas  = document.getElementById('celebration-canvas');
  const ctx     = canvas.getContext('2d');

  // Guard against overlapping runs stomping on each other's canvas
  if (showCelebration._running) return;
  showCelebration._running = true;

  // Size canvas to viewport, scaled for retina so confetti edges stay crisp
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let vw = 0, vh = 0;
  function resize() {
    vw = window.innerWidth || document.documentElement.clientWidth || 0;
    vh = window.innerHeight || document.documentElement.clientHeight || 0;
    canvas.width  = Math.max(1, Math.round(vw * dpr));
    canvas.height = Math.max(1, Math.round(vh * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  // Confetti pieces
  const COLORS = ['#4f72c4','#2e9b66','#e8a838','#c45f5f','#9b6bc4','#4fb8c4'];
  const pieces = [];
  const count = Math.max(40, Math.min(120, Math.floor(vw / 8)));
  for (let i = 0; i < count; i++) {
    pieces.push({
      x: Math.random() * vw,
      y: -20 - Math.random() * vh * 0.5,
      w: 7 + Math.random() * 5,
      h: 3 + Math.random() * 3,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      angle: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.12,
      vx: (Math.random() - 0.5) * 1.4,
      vy: 2 + Math.random() * 3,
      opacity: 0.85 + Math.random() * 0.15,
      wobble: Math.random() * Math.PI * 2,
      wobbleSpeed: 0.04 + Math.random() * 0.04,
      // Independent tilt axis: each piece is flat paper turning in space, so it
      // narrows to nearly nothing edge-on and widens again. This is what reads
      // as real confetti rather than coloured dashes sliding down the screen.
      tilt: Math.random() * Math.PI * 2,
      tiltSpeed: 0.10 + Math.random() * 0.10,
    });
  }

  let frame, startTime, done = false, hardStop = null;
  const DURATION = 3500;

  function finish() {
    if (done) return;
    done = true;
    clearTimeout(hardStop);
    cancelAnimationFrame(frame);
    ctx.clearRect(0, 0, vw, vh);
    overlay.classList.add('fading');
    window.removeEventListener('resize', resize);
    setTimeout(() => {
      overlay.classList.remove('visible', 'fading');
      showCelebration._running = false;
      onDone();
    }, 420);
  }

  function tick(ts) {
    if (done) return;
    if (!startTime) startTime = ts;
    const elapsed = ts - startTime;
    const fadeStart = DURATION - 600;
    const globalAlpha = elapsed > fadeStart ? Math.max(0, 1 - (elapsed - fadeStart) / 600) : 1;

    ctx.clearRect(0, 0, vw, vh);

    for (const p of pieces) {
      p.y  += p.vy;
      p.x  += p.vx + Math.sin(p.wobble) * 0.6;
      p.angle += p.spin;
      p.wobble += p.wobbleSpeed;
      p.tilt += p.tiltSpeed;
      p.vy = Math.min(p.vy + 0.04, 6); // gravity, capped

      // Foreshortening as the piece turns edge-on, plus a matching dim so the
      // face reads as catching less light at a steep angle.
      const face   = Math.abs(Math.cos(p.tilt));
      const squash = Math.max(0.08, face);
      const shade  = 0.55 + 0.45 * face;

      ctx.save();
      ctx.globalAlpha = p.opacity * globalAlpha * shade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w * squash, p.h);
      ctx.restore();
    }

    if (elapsed < DURATION) {
      frame = requestAnimationFrame(tick);
    } else {
      finish();
    }
  }

  // Kick off
  overlay.classList.remove('fading');
  overlay.classList.add('visible');

  // Users who asked for less motion get the message, not the confetti storm.
  const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!calm) frame = requestAnimationFrame(tick);

  // Safety net: rAF is suspended in background tabs, so a user who submits and
  // immediately switches away would otherwise return to a stuck full-screen
  // overlay that blocks the page. Timers still fire (throttled), so guarantee
  // dismissal independently of the animation loop.
  hardStop = setTimeout(finish, DURATION + 400);
}
