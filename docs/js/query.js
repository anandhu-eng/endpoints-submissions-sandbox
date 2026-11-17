// Filters, grouping, sort and URL state (REQUIREMENTS section 5).
// Works on the derived rows from derive.js; holds no review rules of its own.

import {
  STAGES, DEFAULT_STAGES, WAIT_VALUES, FLAGS, TYPES, DIVISIONS, AVAILABILITY, PENALTY_LEVELS, DUE_OPTIONS,
  STATUS_ORDER, normOrg, QUEUES,
} from './derive.js?v=0c38b22995';

export const SET_KEYS = ['queue', 'wait', 'due', 'rev', 'by', 'org', 'sub', 'model', 'type', 'div', 'avail', 'otype', 'pen', 'flag'];
export const GROUP_KEYS = ['model', 'org', 'sub', 'type', 'stage', 'rev', 'div', 'by'];
export const SORT_KEYS = ['due', 'day', 'stage', 'created', 'id', 'wait'];
export const PERIODS = ['all', '90', '30'];
export const GSORTS = ['count', 'az', 'm1', 'm2'];

export const UNASSIGNED = '__unassigned__';

export function emptyState() {
  const s = {
    q: '', stage: null, n: 5, nofind: false, from: '', to: '', test: false,
    group: [], gsort: 'count', sort: 'due', period: 'all', id: '', node: '',
  };
  for (const k of SET_KEYS) s[k] = new Set();
  return s;
}

// Allowed values per key, from fixed lists and from the data.
export function domains(rows) {
  const uniq = (xs) => [...new Set(xs.filter((x) => x != null && x !== ''))].sort((a, b) => String(a).localeCompare(String(b)));
  return {
    stage: STAGES.map((s) => s.code),
    queue: QUEUES,
    wait: WAIT_VALUES,
    due: DUE_OPTIONS,
    rev: [...uniq(rows.flatMap((r) => r.assignees)), UNASSIGNED],
    by: uniq(rows.flatMap((r) => [...r.objectorOrgs])),
    org: uniq(rows.map((r) => r.org)),
    sub: uniq(rows.map((r) => r.submitter)),
    model: uniq(rows.flatMap((r) => r.models)),
    type: TYPES,
    div: DIVISIONS,
    avail: AVAILABILITY,
    otype: uniq(rows.flatMap((r) => [...r.objectionTypes])),
    pen: PENALTY_LEVELS,
    flag: FLAGS,
    group: GROUP_KEYS,
  };
}

// ---------------------------------------------------------------------------
// URL

export function parseUrl(search, dom, rows) {
  const p = new URLSearchParams(search);
  const s = emptyState();
  const ignored = [];
  const known = new Set(['q', 'stage', 'n', 'nofind', 'from', 'to', 'test', 'group', 'gsort', 'sort', 'period', 'id', 'node', ...SET_KEYS]);
  const list = (v) => v.split(',').map((x) => x.trim()).filter(Boolean);
  for (const [key, value] of p) {
    if (!known.has(key)) { ignored.push(key); continue; }
    if (SET_KEYS.includes(key)) {
      for (const v of list(value)) (dom[key].includes(v) ? s[key].add(v) : ignored.push(`${key}=${v}`));
    } else if (key === 'stage') {
      if (value === 'all') { s.stage = new Set(); continue; }
      s.stage = new Set();
      for (const v of list(value)) (dom.stage.includes(v) ? s.stage.add(v) : ignored.push(`stage=${v}`));
    } else if (key === 'group') {
      for (const v of list(value)) {
        if (dom.group.includes(v) && !s.group.includes(v) && s.group.length < 3) s.group.push(v);
        else ignored.push(`group=${v}`);
      }
    } else if (key === 'sort') {
      const k = value.replace(/^-/, '');
      if (SORT_KEYS.includes(k)) s.sort = value; else ignored.push(`sort=${value}`);
    } else if (key === 'gsort') {
      if (GSORTS.includes(value)) s.gsort = value; else ignored.push(`gsort=${value}`);
    } else if (key === 'period') {
      if (PERIODS.includes(value)) s.period = value; else ignored.push(`period=${value}`);
    } else if (key === 'n') {
      const n = parseInt(value, 10);
      if (n >= 1 && n <= 60) s.n = n; else ignored.push(`n=${value}`);
    } else if (key === 'nofind' || key === 'test') {
      if (value === '1') s[key] = true; else if (value !== '0') ignored.push(`${key}=${value}`);
    } else if (key === 'from' || key === 'to') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) s[key] = value; else ignored.push(`${key}=${value}`);
    } else if (key === 'id') {
      const r = rows.find((x) => x.shortId === value || x.id === value);
      if (r) s.id = r.shortId; else ignored.push(`id=${value}`);
    } else {
      s[key] = value;
    }
  }
  return { state: s, ignored };
}

export function toQuery(s) {
  const p = new URLSearchParams();
  const put = (k, v) => { if (v !== '' && v != null) p.set(k, v); };
  put('q', s.q);
  if (s.stage) put('stage', s.stage.size ? [...s.stage].join(',') : 'all');
  for (const k of SET_KEYS) if (s[k].size) put(k, [...s[k]].join(','));
  if (s.due.size && s.n !== 5) put('n', String(s.n));
  if (s.nofind) put('nofind', '1');
  put('from', s.from); put('to', s.to);
  if (s.test) put('test', '1');
  if (s.group.length) put('group', s.group.join(','));
  if (s.gsort !== 'count') put('gsort', s.gsort);
  if (s.sort !== 'due') put('sort', s.sort);
  if (s.period !== 'all') put('period', s.period);
  put('id', s.id);
  if (s.id) put('node', s.node);
  const str = p.toString().replace(/%2C/g, ',').replace(/%3A/g, ':');
  return str ? '?' + str : '';
}

// ---------------------------------------------------------------------------
// Filtering

export function stageSet(s) { return s.stage ?? new Set(DEFAULT_STAGES); }

export function matchesSearch(r, q) {
  if (!q) return true;
  const needle = q.trim().toLowerCase().replace(/^#/, '');
  if (!needle) return true;
  const hay = [
    r.shortId, r.id, r.org, ...r.models,
    r.db.pr_number, r.pr?.number, r.db.tracking_issue_number, r.ti?.number, ...r.findings.map((f) => f.number),
    ...r.findings.flatMap((f) => f.waivers), r.flags.has('penalty_waived') ? 'penalty waived' : null,
  ].filter((x) => x != null).map((x) => String(x).toLowerCase());
  return hay.some((h) => h.includes(needle));
}

export function rowMatches(r, s, { ignoreStage = false } = {}) {
  if (r.isTest && !s.test) return false;
  if (!matchesSearch(r, s.q)) return false;
  if (!ignoreStage) { const st = stageSet(s); if (st.size && !st.has(r.stage)) return false; }
  if (s.queue.size && ![...s.queue].some((q) => queueMatches(r, q))) return false;
  if (s.wait.size && ![...r.waitSet].some((w) => s.wait.has(w))) return false;
  if (s.due.size && ![...s.due].some((d) => dueMatches(r, d, s.n))) return false;
  if (s.rev.size) {
    const set = r.assignees.length ? r.assignees : [UNASSIGNED];
    if (!set.some((a) => s.rev.has(a))) return false;
  }
  if (s.nofind && !(r.status === 'REVIEW_PENDING' && r.noFindingAssignees.length)) return false;
  if (s.by.size && ![...r.objectorOrgs].some((o) => s.by.has(o))) return false;
  if (s.org.size && !s.org.has(r.org)) return false;
  if (s.sub.size && !s.sub.has(r.submitter)) return false;
  if (s.model.size && !r.models.some((m) => s.model.has(m))) return false;
  if (s.type.size && !s.type.has(r.type)) return false;
  if (s.div.size && !s.div.has(r.division)) return false;
  if (s.avail.size && !s.avail.has(r.availability)) return false;
  if (s.otype.size && ![...r.objectionTypes].some((t) => s.otype.has(t))) return false;
  if (s.pen.size && !s.pen.has(String(r.penalty))) return false;
  if (s.flag.size && ![...r.flags].some((f) => s.flag.has(f))) return false;
  if (s.from && (!r.createdDate || r.createdDate < s.from)) return false;
  if (s.to && (!r.createdDate || r.createdDate > s.to)) return false;
  return true;
}

export function queueMatches(r, q) {
  if (q === 'ready') return r.ready;
  if (q === 'needschair') return r.needsChair;
  return false;
}

export function dueMatches(r, d, n) {
  switch (d) {
    case 'past6': return r.stage === 'RP_PAST_WK6';
    case 'wk3n': return r.bdToWk3 != null && r.bdToWk3 <= n;
    case 'wk6n': return r.bdToWk6 != null && r.bdToWk6 <= n;
    case 'pen1': return r.penaltySoonCount > 0;
    case 'overdue': return r.overdueCount > 0;
    case 'open12': return r.openLongCount > 0;
    case 'stuck': return r.stuckReasons.length > 0;
    default: return false;
  }
}

// D18: the deadline that made the row pass the Deadline filter (earliest if several).
export function matchedDeadline(r, s) {
  if (!s.due.size) return null;
  const out = [];
  for (const d of s.due) {
    if (!dueMatches(r, d, s.n)) continue;
    if (d === 'wk3n') out.push({ kind: 'wk3', at: r.clock.wk3Close });
    else if (d === 'wk6n') out.push({ kind: 'wk6', at: r.clock.wk6Close });
    else if (d === 'pen1') {
      for (const f of r.findings) if (f.penaltySoon && f.openSubmitter?.nextLevelAt) out.push({ kind: 'penalty', at: f.openSubmitter.nextLevelAt, level: f.openSubmitter.nextLevel, finding: f.number });
    } else if (d === 'overdue') {
      for (const f of r.findings) if (f.replyOverdue) out.push({ kind: 'overdue', finding: f.number, at: f.openReviewer?.deadline ?? null });
    } else if (d === 'open12') {
      for (const f of r.findings) if (f.openLong) out.push({ kind: 'open12', finding: f.number, at: null });
    }
  }
  if (!out.length) return null;
  out.sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity));
  return out[0];
}

// ---------------------------------------------------------------------------
// Sort

export function sortRows(rows, sort) {
  const desc = sort.startsWith('-');
  const key = sort.replace(/^-/, '');
  const val = (r) => {
    switch (key) {
      case 'due': return r.nextDeadline?.at ?? null;
      case 'day': return r.clock.reviewDay;
      case 'stage': return r.stageOrder;
      case 'created': return r.createdMs;
      case 'id': return r.shortId;
      case 'wait': return r.longestSubmitterWait;
      default: return null;
    }
  };
  return rows.slice().sort((a, b) => {
    const va = val(a); const vb = val(b);
    if (va == null && vb == null) return a.shortId.localeCompare(b.shortId);
    if (va == null) return 1; // missing values last in both directions
    if (vb == null) return -1;
    const c = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    return (desc ? -c : c) || a.shortId.localeCompare(b.shortId);
  });
}

// ---------------------------------------------------------------------------
// Grouping

// Values of a row for a group key. Empty -> [null] (Unknown/Unassigned group).
export function groupValues(r, key) {
  let v;
  switch (key) {
    case 'model': v = r.models; break;
    case 'org': v = [r.org]; break;
    case 'sub': v = [r.submitter]; break;
    case 'type': v = [r.type]; break;
    case 'stage': v = [r.stage]; break;
    case 'rev': v = r.assignees; break;
    case 'div': v = [r.division]; break;
    case 'by': v = [...r.objectorOrgs]; break;
    default: v = [];
  }
  v = (v || []).filter((x) => x != null && x !== '');
  return v.length ? [...new Set(v)] : [null];
}

export const MULTI_KEYS = new Set(['model', 'rev', 'by']);

// Returns a tree: [{key, value, rows, children, path}]
export function groupRows(rows, keys, gsort, labelOf, metricOf = null) {
  if (!keys.length) return null;
  const build = (subset, depth, path) => {
    const key = keys[depth];
    const map = new Map();
    for (const r of subset) for (const v of groupValues(r, key)) {
      if (!map.has(v)) map.set(v, []);
      map.get(v).push(r);
    }
    const groups = [...map.entries()].map(([value, gr]) => ({
      key, value, rows: gr, path: [...path, `${key}:${value ?? ''}`].join('|'), depth,
    }));
    groups.sort((a, b) => {
      if ((a.value == null) !== (b.value == null)) return a.value == null ? 1 : -1;
      if (key === 'stage' && gsort !== 'az') { /* fall through to count */ }
      if (gsort === 'az') return String(labelOf(key, a.value)).localeCompare(String(labelOf(key, b.value)));
      if ((gsort === 'm1' || gsort === 'm2') && metricOf) {
        // Slowest median reply first; groups with no data last.
        const va = metricOf(gsort, a); const vb = metricOf(gsort, b);
        if ((va == null) !== (vb == null)) return va == null ? 1 : -1;
        if (va != null && vb !== va) return vb - va;
      }
      return b.rows.length - a.rows.length || String(labelOf(key, a.value)).localeCompare(String(labelOf(key, b.value)));
    });
    if (depth + 1 < keys.length) for (const g of groups) g.children = build(g.rows, depth + 1, [g.path]);
    return groups;
  };
  return build(rows, 0, []);
}

// How many groups at the first multi-valued level a row appears in, minus one.
export function alsoInCount(r, keys) {
  let n = 1;
  for (const k of keys) if (MULTI_KEYS.has(k)) n *= groupValues(r, k).length;
  return n - 1;
}

export { STATUS_ORDER, normOrg };
