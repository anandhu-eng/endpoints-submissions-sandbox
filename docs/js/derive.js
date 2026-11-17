// Every review rule in one place (REQUIREMENTS sections 3, 4, 6.1).
// Input: the raw snapshot (section 7). Output: derived rows and metrics.
// No DOM access and no user-facing text here.

export const STATUS_ORDER = [
  'COMPLIANCE_CHECKING', 'REVIEW_PENDING', 'FINALIZED', 'PUBLISHED',
  'SUPERSEDED', 'EXPIRED', 'WITHDRAWN', 'WITHDRAWN_INCOMPLETE',
];
export const TERMINAL = new Set(['SUPERSEDED', 'EXPIRED', 'WITHDRAWN', 'WITHDRAWN_INCOMPLETE']);

export const STAGES = [
  ['CC_HELD', 'COMPLIANCE_CHECKING'], ['CC_NO_PR', 'COMPLIANCE_CHECKING'],
  ['CC_FAILED', 'COMPLIANCE_CHECKING'], ['CC_CHECKING', 'COMPLIANCE_CHECKING'],
  ['RP_SETUP', 'REVIEW_PENDING'], ['RP_PEER', 'REVIEW_PENDING'],
  ['RP_OBJECTION', 'REVIEW_PENDING'], ['RP_PAST_WK6', 'REVIEW_PENDING'],
  ['FIN_RDI', 'FINALIZED'], ['FIN_WAITING', 'FINALIZED'],
  ['PUBLISHED', 'PUBLISHED'], ['SUPERSEDED', 'SUPERSEDED'], ['EXPIRED', 'EXPIRED'],
  ['WD_PENALTY', 'WITHDRAWN'], ['WD', 'WITHDRAWN'], ['WD_INCOMPLETE', 'WITHDRAWN_INCOMPLETE'],
].map(([code, status], i) => ({ code, status, order: i + 1 }));
export const STAGE_BY_CODE = Object.fromEntries(STAGES.map((s) => [s.code, s]));
export const DEFAULT_STAGES = STAGES.filter((s) => !TERMINAL.has(s.status)).map((s) => s.code);

export const WAIT_VALUES = ['submitter', 'reviewer', 'chair', 'lm', 'submitter_compliance', 'unknown', 'nobody'];
export const FLAGS = [
  'provisional', 'test', 'embargoed', 'penalty_delayed', 'finalize_pending', 'non_chair_finalize',
  'penalty_waived', 'supersedes', 'superseded_by',
  'withdrawn_after_finalization', 'compliance_overdue', 'escalated', 'legacy',
];
export const TURN_STATES = ['submitter', 'reviewer', 'waived', 'resolved', 'none'];
// Work queues (D4, D10): ready to finalize, needs a chair, and "what the View-as person owes".
export const QUEUES = ['ready', 'needschair', 'me'];
export const TYPES = ['agentic', 'single_turn', 'mixed', 'unknown'];
export const DIVISIONS = ['standardized', 'serviced', 'rdi'];
export const AVAILABILITY = ['available', 'preview', 'rdi'];
export const PENALTY_LEVELS = ['0', '1', '2', '3'];
export const DUE_OPTIONS = ['wk3n', 'wk6n', 'pen1', 'overdue', 'open12', 'past6', 'stuck'];

const SUBMITTER_LABEL = 'needs-submitter-attention';
const REVIEWER_LABEL = 'needs-reviewer-attention';
const RESOLVED_LABEL = 'resolved';
const FINALIZED_LABEL = 'finalized';
const CHECK_NAME = 'Run submission checker';
const PENALTY_THRESHOLDS = [3, 6, 10]; // whole business days for stage 1, 2, 3 (LM)
const REVIEWER_DEADLINE_BD = 2; // business days after day 0 (LM step 7)
const WAIVE_ALL = 'waive-penalty-all';
const WAIVE_L1 = 'waive-penalty-L1';
const ESCALATION_BD = 12;
const COMPLIANCE_OVERDUE_DAYS = 7;
const WK3_DAYS = 21;
const WK6_DAYS = 42;
const HOUR = 3600e3;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------------------
// Pacific calendar: dates, business days, business durations

export function makeCalendar(cal = {}) {
  const tz = cal.timezone || 'America/Los_Angeles';
  const holidays = new Set(cal.holidays || []);
  const cohorts = (cal.cohorts || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const dayStartCache = new Map();

  function parts(ms) {
    const o = {};
    for (const p of dtf.formatToParts(new Date(ms))) o[p.type] = p.value;
    return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second };
  }
  function offset(ms) {
    const p = parts(ms);
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
  }
  // Pacific wall time -> epoch ms
  function zoned(y, m, d, h = 0, mi = 0, s = 0) {
    const guess = Date.UTC(y, m - 1, d, h, mi, s);
    let t = guess - offset(guess);
    t = guess - offset(t);
    return t;
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function dateOf(ms) {
    const p = parts(ms);
    return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  }
  function ymd(date) { return date.split('-').map(Number); }
  function addDays(date, n) {
    const [y, m, d] = ymd(date);
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  }
  function daysBetween(a, b) { // calendar days from date a to date b
    const [y1, m1, d1] = ymd(a); const [y2, m2, d2] = ymd(b);
    return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / DAY);
  }
  function weekday(date) { const [y, m, d] = ymd(date); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }
  function isBusinessDay(date) { const w = weekday(date); return w !== 0 && w !== 6 && !holidays.has(date); }
  function dayStart(date) {
    let v = dayStartCache.get(date);
    if (v === undefined) { const [y, m, d] = ymd(date); v = zoned(y, m, d); dayStartCache.set(date, v); }
    return v;
  }
  function at(date, h, mi, s) { const [y, m, d] = ymd(date); return zoned(y, m, d, h, mi, s); }
  // Time between a and b that falls on business days, in ms.
  function businessMs(a, b) {
    if (a == null || b == null || b <= a) return 0;
    let total = 0;
    let d = dateOf(a);
    for (let guard = 0; guard < 4000; guard++) {
      const s = dayStart(d);
      if (s >= b) break;
      const next = addDays(d, 1);
      const e = dayStart(next);
      if (isBusinessDay(d)) total += Math.max(0, Math.min(e, b) - Math.max(s, a));
      d = next;
    }
    return total;
  }
  function businessDays(a, b) { return businessMs(a, b) / DAY; }
  // The instant when `days` business days have passed since `a`.
  function addBusinessDays(a, days) {
    let remaining = days * DAY;
    let d = dateOf(a);
    let cur = a;
    for (let guard = 0; guard < 4000; guard++) {
      const s = dayStart(d);
      const next = addDays(d, 1);
      const e = dayStart(next);
      if (isBusinessDay(d)) {
        const from = Math.max(s, cur);
        const avail = e - from;
        if (remaining <= avail) return from + remaining;
        remaining -= avail;
      }
      d = next;
    }
    return null;
  }
  function nextBusinessDate(date) {
    let d = addDays(date, 1);
    while (!isBusinessDay(d)) d = addDays(d, 1);
    return d;
  }
  return {
    tz, holidays, cohorts, parts, dateOf, addDays, daysBetween, isBusinessDay, dayStart, at,
    businessMs, businessDays, addBusinessDays, nextBusinessDate,
  };
}

// Reviewer reply deadline (D5, REQUIREMENTS 3.6, LM step 7): day 0 is the Pacific
// date the turn started, business day or not; the reply is due 11:59 PM PT on the
// 2nd business day after day 0 (weekends and US federal holidays skipped).
export function reviewerReplyDeadline(cal, startMs) {
  if (startMs == null) return null;
  let d = cal.dateOf(startMs);
  for (let i = 0; i < REVIEWER_DEADLINE_BD; i++) d = cal.nextBusinessDate(d);
  return cal.at(d, 23, 59, 59);
}

// ---------------------------------------------------------------------------
// Helpers

export const ms = (iso) => (iso ? Date.parse(iso) : null);
const median = (xs) => {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export function stats(values) {
  return { n: values.length, median: median(values), mean: mean(values) };
}

// "Noble Numbat Inc." and "noble numbat" are the same org (IF section 6).
export function normOrg(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[.,_-]/g, ' ')
    .replace(/\b(inc|ltd|llc|corp|corporation|co|limited|gmbh)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sortEvents(events) {
  return (events || []).slice().sort((a, b) => ms(a.at) - ms(b.at));
}

function markerNames(issueOrPr) {
  const out = [];
  for (const m of issueOrPr?.markers || []) out.push(m);
  for (const e of issueOrPr?.events || []) if (e.kind === 'comment') for (const m of e.markers || []) out.push(m);
  return out;
}

// ---------------------------------------------------------------------------
// Main entry

export function deriveAll(snapshot) {
  const cal = makeCalendar(snapshot.calendar || {});
  const asOf = ms(snapshot.as_of);
  const people = new Map((snapshot.people || []).map((p) => [p.login, p]));
  const isBot = (login) => {
    const p = people.get(login);
    return (p && p.role === 'bot') || /\[bot\]$/.test(login || '') || login === 'github-actions';
  };
  const isChair = (login) => people.get(login)?.role === 'chair';
  const canWaive = (login) => ['chair', 'engineer'].includes(people.get(login)?.role);
  const orgOf = (login) => people.get(login)?.org || null;

  // Map org spellings to one display name: prefer the spelling persona data uses.
  const orgDisplay = new Map();
  const addOrg = (name, prefer) => {
    if (!name) return;
    const k = normOrg(name);
    if (!orgDisplay.has(k) || prefer) orgDisplay.set(k, name);
  };
  for (const s of snapshot.submissions || []) addOrg(s.org, true);
  for (const p of snapshot.people || []) addOrg(p.org, true);
  const displayOrg = (name) => (name ? orgDisplay.get(normOrg(name)) || name : null);
  for (const s of snapshot.submissions || []) for (const f of s.findings || []) for (const l of f.labels || []) {
    const m = /^(by|against) (.+)$/.exec(l);
    if (m) addOrg(m[2], false);
  }

  const ctx = { cal, asOf, people, isBot, isChair, canWaive, orgOf, displayOrg };
  const rows = (snapshot.submissions || []).map((s) => deriveSubmission(s, ctx));

  // Supersedes / Superseded by (D21): both rows point at each other.
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const r of rows) {
    const target = r.db.supersedes ? byId.get(r.db.supersedes) || rows.find((x) => x.shortId === r.db.supersedes) : null;
    if (!target) continue;
    r.supersedes = target.shortId; r.flags.add('supersedes');
    target.supersededBy = r.shortId; target.flags.add('superseded_by');
  }
  return { rows, ctx, cal, asOf, people };
}

// ---------------------------------------------------------------------------
// Findings and turns (REQUIREMENTS 3.5, IF 3.3, 3.5)

function deriveFinding(f, sub, ctx, stopAt) {
  const { cal, asOf, isBot, orgOf } = ctx;
  const events = sortEvents(f.events);
  const labelEvents = events.filter((e) => e.kind === 'label');
  const mentioned = new Set(labelEvents.map((e) => e.label));

  // Label set at as_of from events; labels with no event are taken from the current list.
  const labels = new Set((f.labels || []).filter((l) => !mentioned.has(l)));
  for (const e of labelEvents) (e.action === 'added' ? labels.add(l(e)) : labels.delete(l(e)));
  function l(e) { return e.label; }

  // Waivers count only when the last add is by a chair or engineer (REQUIREMENTS 3.5).
  const waiverOk = (name) => {
    let last = null;
    for (const e of labelEvents) if (e.label === name && e.action === 'added') last = e;
    return !last || ctx.canWaive(last.actor);
  };
  const waivers = [...labels].filter((x) => x.startsWith('waive-penalty') && waiverOk(x));
  const waivedAll = waivers.includes(WAIVE_ALL);
  const waivedL1 = !waivedAll && waivers.includes(WAIVE_L1);
  const waiveShift = waivedL1 ? 1 : 0;

  const closed = f.state === 'closed';
  let closedAt = ms(f.closed_at);
  for (const e of events) if (e.kind === 'state' && e.action === 'closed') closedAt = ms(e.at);

  // Turns: spans while a turn label is on. Label events by anyone define the span (as LM counts them).
  const turns = [];
  const active = {};
  const startTurn = (kind, at, actor) => { active[kind] = { kind, start: at, startActor: actor, labelEnd: null, labelEndActor: null, endKind: null }; };
  const endTurn = (kind, at, actor, how) => {
    const t = active[kind];
    if (!t) return;
    t.labelEnd = at; t.labelEndActor = actor; t.endKind = how;
    turns.push(t); delete active[kind];
  };
  const created = ms(f.created_at);
  for (const name of [SUBMITTER_LABEL, REVIEWER_LABEL]) {
    if (!mentioned.has(name) && (f.labels || []).includes(name)) startTurn(name === SUBMITTER_LABEL ? 'submitter' : 'reviewer', created, f.author);
  }
  for (const e of events) {
    const at = ms(e.at);
    if (e.kind === 'label' && (e.label === SUBMITTER_LABEL || e.label === REVIEWER_LABEL)) {
      const kind = e.label === SUBMITTER_LABEL ? 'submitter' : 'reviewer';
      if (e.action === 'added' && !active[kind]) startTurn(kind, at, e.actor);
      else if (e.action === 'removed') endTurn(kind, at, e.actor, 'label');
    } else if (e.kind === 'state' && e.action === 'closed' && active.reviewer) {
      // A closed finding ends the objector's turn (LM closes it at the 2-day deadline).
      endTurn('reviewer', at, e.actor, 'close');
    }
  }
  for (const k of Object.keys(active)) turns.push(active[k]);
  turns.sort((a, b) => a.start - b.start);

  const authorOrg = orgOf(f.author);
  const byLabel = (f.labels || []).find((x) => x.startsWith('by '));
  const againstLabel = (f.labels || []).find((x) => x.startsWith('against '));
  const byOrg = ctx.displayOrg(byLabel ? byLabel.slice(3) : authorOrg);
  const againstOrg = ctx.displayOrg(againstLabel ? againstLabel.slice(8) : sub.org);
  const subOrgKey = normOrg(sub.org);
  const byOrgKey = normOrg(byOrg);
  const comments = events.filter((e) => e.kind === 'comment' && !isBot(e.actor));

  for (const t of turns) {
    // Clocks stop at withdrawal or finalization (D6). A turn still running then is "stopped".
    const runsPastStop = stopAt != null && (t.labelEnd == null || t.labelEnd > stopAt);
    const until = runsPastStop ? Math.max(t.start, stopAt) : (t.labelEnd ?? asOf);
    const reply = comments.find((c) => {
      const at = ms(c.at);
      if (at <= t.start || at > until) return false;
      const o = normOrg(orgOf(c.actor));
      if (t.kind === 'submitter') return o && o === subOrgKey;
      return c.actor === f.author || (o && o === byOrgKey);
    });
    const replyAt = reply ? ms(reply.at) : null;
    t.open = t.labelEnd == null && !runsPastStop;
    t.stopped = runsPastStop && replyAt == null;
    t.end = until; // where the clock stopped counting this turn
    t.labelDays = cal.businessDays(t.start, until);
    t.wholeDays = Math.floor(t.labelDays + 1e-9);
    t.responseEnd = replyAt ?? (runsPastStop ? null : t.labelEnd);
    t.endedBy = replyAt != null ? 'reply' : t.stopped ? 'stopped' : t.labelEnd != null ? t.endKind : null;
    t.labelOnly = t.endedBy === 'label';
    t.responseDays = t.responseEnd != null ? cal.businessDays(t.start, t.responseEnd) : null;
    if (t.kind === 'reviewer') {
      t.deadline = reviewerReplyDeadline(cal, t.start);
      // Missed: the bot ended the turn after the reply deadline, with no reply first.
      t.missed = !runsPastStop && t.labelEnd != null && replyAt == null && isBot(t.labelEndActor) && t.labelEnd > t.deadline;
      t.overdue = t.open && asOf > t.deadline;
    } else t.missed = false;
    if (t.kind === 'submitter' && t.open) {
      // Next stage the page will show, after an L1 waiver lowers it by one.
      const nextIdx = PENALTY_THRESHOLDS.findIndex((th, i) => t.wholeDays < th && i + 1 - waiveShift >= 1);
      if (nextIdx >= 0) {
        t.nextLevel = nextIdx + 1 - waiveShift;
        t.nextLevelAt = cal.addBusinessDays(t.start, PENALTY_THRESHOLDS[nextIdx]);
      }
    }
  }

  const hasS = labels.has(SUBMITTER_LABEL);
  const hasR = labels.has(REVIEWER_LABEL);
  // Turn state (REQUIREMENTS 3.5). Waived applies only in the submitter's turn.
  let turnState;
  if (labels.has(RESOLVED_LABEL) || (closed && !hasS)) turnState = 'resolved';
  else if (hasS) turnState = waivedAll ? 'waived' : 'submitter';
  else if (hasR) turnState = 'reviewer';
  else turnState = closed ? 'resolved' : 'none';
  const closedStillLabelled = closed && (hasS || hasR);

  const turnKind = turnState === 'waived' ? 'submitter' : turnState;
  const openTurn = turns.find((t) => t.open && t.kind === turnKind) || null;
  const longest = turns.reduce((m, t) => Math.max(m, t.labelDays), 0);
  const longestSubmitterWhole = turns.filter((t) => t.kind === 'submitter').reduce((m, t) => Math.max(m, t.wholeDays), 0);
  const rawPenalty = PENALTY_THRESHOLDS.filter((th) => longestSubmitterWhole >= th).length;
  // Stage shown on the finding: "waived" under waive-penalty-all, one lower under L1 (D2).
  const impliedPenalty = waivedAll ? 0 : Math.max(0, rawPenalty - waiveShift);
  const penaltyStage = waivedAll ? 'waived' : impliedPenalty;
  const markers = markerNames(f);
  const escalated = markers.some((m) => m.name === 'meeting-escalation');
  const type = [...labels].find((x) => x.startsWith('type:'))?.replace(/^type:\s*/, '') || null;

  const waived = turnState === 'waived';
  const openSubmitter = turns.find((t) => t.kind === 'submitter' && t.open);
  const openReviewer = turnState === 'reviewer' ? turns.find((t) => t.kind === 'reviewer' && t.open) : null;
  const unresolved = turnState !== 'resolved' && turnState !== 'waived';
  const unresolvedDays = unresolved ? cal.businessDays(created, stopAt ?? asOf) : 0;
  // D9: two separate badges. Waived findings and stopped clocks are excluded from both.
  const replyOverdue = !waived && !!(
    (openSubmitter && openSubmitter.wholeDays >= PENALTY_THRESHOLDS[0]) ||
    (openReviewer && openReviewer.overdue));
  const openLong = stopAt == null && unresolved && !closed && unresolvedDays >= ESCALATION_BD;
  const missedDeadline = replyOverdue || openLong;
  const penaltySoon = !waived && !!(openSubmitter && [2, 5, 9].includes(openSubmitter.wholeDays));

  // D12: the latest ask from the other side on this finding (a person's comment, or the finding body).
  let latestAsk = null;
  if (openTurn) {
    const fromSubmitterOrg = (c) => normOrg(orgOf(c.actor)) === subOrgKey;
    const asks = comments.filter((c) => (turnKind === 'submitter' ? !fromSubmitterOrg(c) : fromSubmitterOrg(c)) && ms(c.at) <= asOf);
    const last = asks[asks.length - 1];
    if (last) latestAsk = { at: ms(last.at), actor: last.actor, body: last.body || '', url: last.url || f.url };
    else if (turnKind === 'submitter') latestAsk = { at: created, actor: f.author, body: f.body || '', url: f.url };
  }

  return {
    issue: f, number: f.number, title: f.title, url: f.url, author: f.author, parent: f.parent,
    state: f.state, stateReason: f.state_reason, closed, closedAt, labels, turnState, closedStillLabelled,
    turns, openTurn, openSubmitter, openReviewer, currentWait: openTurn ? openTurn.labelDays : null,
    longest, longestSubmitterWhole, rawPenalty, impliedPenalty, penaltyStage, waivers, waivedAll, waivedL1,
    escalated, type, byOrg, againstOrg, latestAsk,
    replyOverdue, openLong, missedDeadline, penaltySoon, unresolvedDays,
    labelOnlyEnds: turns.some((t) => t.labelOnly), events,
  };
}

// ---------------------------------------------------------------------------
// Submission

function deriveSubmission(s, ctx) {
  const { cal, asOf, isChair } = ctx;
  const db = s.db || {};
  const status = db.status;
  const pr = s.pr || null;
  const ti = s.tracking_issue || null;
  // Clock stop (D6): withdrawal, and finalization for penalty purposes.
  const stops = [];
  if ((status === 'WITHDRAWN' || status === 'WITHDRAWN_INCOMPLETE') && db.withdrawn_at) stops.push(ms(db.withdrawn_at));
  if (db.finalized_at) stops.push(ms(db.finalized_at));
  const stopAt = stops.length ? Math.min(...stops) : null;
  const findings = (s.findings || []).map((f) => deriveFinding(f, s, ctx, stopAt));

  // Review clock (3.3)
  const startMs = ms(db.peer_review_started_at);
  const startDate = startMs != null ? cal.dateOf(startMs) : null;
  const wk3Close = startDate ? cal.at(cal.addDays(startDate, WK3_DAYS), 23, 59, 59) : null;
  const wk6Close = startDate ? cal.at(cal.addDays(startDate, WK6_DAYS), 23, 59, 59) : null;
  const reviewDay = startDate ? cal.daysBetween(startDate, cal.dateOf(asOf)) : null;
  const pastWk6Days = reviewDay != null && reviewDay > WK6_DAYS ? reviewDay - WK6_DAYS : 0;

  // Compliance check on PR head commit
  let latestCheck = null;
  if (pr) {
    const head = String(pr.head_sha || '');
    const sameSha = (sha) => !sha || !head || head.startsWith(sha) || String(sha).startsWith(head);
    for (const e of sortEvents(pr.events)) if (e.kind === 'check' && e.name === CHECK_NAME && sameSha(e.sha)) latestCheck = e;
  }

  // Stage (3.2): first matching rule within the status
  const embargoMs = ms(db.embargo_date);
  let stage;
  switch (status) {
    case 'COMPLIANCE_CHECKING':
      if (db.pr_number == null && !pr && db.early_publish && embargoMs != null && embargoMs > asOf) stage = 'CC_HELD';
      else if (db.pr_number == null && !pr) stage = 'CC_NO_PR';
      else if (latestCheck && latestCheck.conclusion === 'failure') stage = 'CC_FAILED';
      else stage = 'CC_CHECKING';
      break;
    case 'REVIEW_PENDING':
      if (db.tracking_issue_number == null && !ti) stage = 'RP_SETUP';
      else if (startMs == null || asOf <= wk3Close) stage = 'RP_PEER';
      else if (asOf <= wk6Close) stage = 'RP_OBJECTION';
      else stage = 'RP_PAST_WK6';
      break;
    case 'FINALIZED': stage = db.availability === 'rdi' ? 'FIN_RDI' : 'FIN_WAITING'; break;
    case 'PUBLISHED': stage = 'PUBLISHED'; break;
    case 'SUPERSEDED': stage = 'SUPERSEDED'; break;
    case 'EXPIRED': stage = 'EXPIRED'; break;
    case 'WITHDRAWN': stage = (db.penalties_imposed || 0) >= 3 ? 'WD_PENALTY' : 'WD'; break;
    case 'WITHDRAWN_INCOMPLETE': stage = 'WD_INCOMPLETE'; break;
    default: stage = null;
  }
  const isRP = status === 'REVIEW_PENDING';

  // Reviewers: tracking issue assignees (logins) first, persona display names as fallback.
  let assignees = (ti?.assignees || []).slice();
  if (!assignees.length && (s.assigned_reviewers || []).length) {
    const byName = new Map([...ctx.people.values()].map((p) => [p.display_name, p.login]));
    assignees = s.assigned_reviewers.map((n) => byName.get(n) || ctx.people.get(n)?.login || n);
  }
  const findingAuthors = new Set(findings.map((f) => f.author));
  const noFindingAssignees = assignees.filter((a) => !findingAuthors.has(a));

  // Flags (3.4)
  const flags = new Set();
  if (db.early_publish) flags.add('provisional');
  if (s.is_test) flags.add('test');
  if (embargoMs != null && embargoMs > asOf) flags.add('embargoed');
  if (status === 'FINALIZED' && (db.penalties_imposed || 0) > 0) flags.add('penalty_delayed');
  // Finalized label on the PR now, and who added it last (D1). The marker comment is not used.
  let finalizedBy = null;
  let finalizedOn = false;
  if (pr) {
    const evs = sortEvents(pr.events).filter((e) => e.kind === 'label' && e.label === FINALIZED_LABEL);
    finalizedOn = evs.length ? evs[evs.length - 1].action === 'added' : (pr.labels || []).includes(FINALIZED_LABEL);
    for (const e of evs) if (e.action === 'added') finalizedBy = e.actor;
  }
  if (isRP && finalizedOn && finalizedBy) flags.add(isChair(finalizedBy) ? 'finalize_pending' : 'non_chair_finalize');
  if (findings.some((f) => f.waivers.length)) flags.add('penalty_waived');
  if (status === 'WITHDRAWN' && db.finalized_at) flags.add('withdrawn_after_finalization');
  const prOpened = pr ? ms(pr.created_at) : null;
  if (status === 'COMPLIANCE_CHECKING' && pr && prOpened != null && asOf - prOpened > COMPLIANCE_OVERDUE_DAYS * DAY) flags.add('compliance_overdue');
  if (findings.some((f) => f.escalated)) flags.add('escalated');
  if (!ti && status !== 'COMPLIANCE_CHECKING' && !isRP) flags.add('legacy');

  // Finding roll-up
  const counts = { total: findings.length, open: 0, submitter: 0, reviewer: 0, waived: 0, resolved: 0, none: 0 };
  for (const f of findings) {
    counts[f.turnState]++;
    if (!f.closed) counts.open++;
  }

  // Due cohort (6.1) for FINALIZED rows
  let due = null;
  if (status === 'FINALIZED') due = dueCohort(db, cal, stage);

  // Ready to finalize (D4, M16)
  const ready = isRP && !!ti && findings.length > 0 && stage !== 'RP_PAST_WK6'
    && findings.every((f) => f.turnState === 'resolved' || f.turnState === 'waived')
    && noFindingAssignees.length === 0;

  // Waiting on (3.5), multi-valued, with reasons. Only for rows still moving (D6).
  const active = status === 'COMPLIANCE_CHECKING' || isRP || status === 'FINALIZED';
  const waiting = [];
  const add = (value, reason) => waiting.push({ value, reason });
  if (isRP && counts.submitter) add('submitter', { key: 'submitterFindings', args: [findings.filter((f) => f.turnState === 'submitter').map((f) => f.number)] });
  if (isRP) {
    const rev = findings.filter((f) => f.turnState === 'reviewer').map((f) => f.number);
    const idle = stage === 'RP_PEER' ? noFindingAssignees : [];
    if (rev.length || idle.length) {
      const reasons = [];
      if (rev.length) reasons.push({ key: 'reviewerFindings', args: [rev] });
      if (idle.length) reasons.push({ key: 'reviewerNoFinding', args: [idle] });
      add('reviewer', reasons);
    }
  }
  const chairReasons = [];
  if (isRP && ti && !assignees.length) chairReasons.push({ key: 'chairAssign', args: [] });
  if (isRP && flags.has('escalated')) chairReasons.push({ key: 'chairMeeting', args: [] });
  if (stage === 'RP_PAST_WK6') chairReasons.push({ key: 'chairReferral', args: [] });
  if (ready) chairReasons.push({ key: 'chairReady', args: [] });
  else if (stage === 'RP_OBJECTION' && !counts.submitter && !counts.reviewer && !counts.none) chairReasons.push({ key: 'chairPhase', args: [] });
  if (flags.has('non_chair_finalize')) chairReasons.push({ key: 'chairNonChair', args: [[finalizedBy]] });
  if (chairReasons.length) add('chair', chairReasons);
  const lmReasons = [];
  if (stage === 'CC_HELD') lmReasons.push({ key: 'lmHeld', args: [] });
  if (stage === 'CC_CHECKING') lmReasons.push({ key: 'lmChecking', args: [] });
  if (stage === 'RP_SETUP') lmReasons.push({ key: 'lmSetup', args: [] });
  if (stage === 'FIN_WAITING') lmReasons.push({ key: 'lmFinWaiting', args: [due?.cohort?.id || '?'] });
  if (flags.has('finalize_pending')) lmReasons.push({ key: 'lmFinalizePending', args: [] });
  if (lmReasons.length) add('lm', lmReasons);
  if (stage === 'CC_FAILED') add('submitter_compliance', { key: 'compliance', args: [] });
  if (stage === 'CC_NO_PR') add('unknown', { key: 'noPr', args: [] });
  if (!active) waiting.length = 0;
  if (!waiting.length) add('nobody', { key: 'nobody', args: [] });
  for (const w of waiting) if (!Array.isArray(w.reason)) w.reason = [w.reason];
  const waitSet = new Set(waiting.map((w) => w.value));

  // Deadlines
  const penaltyDates = findings.filter((f) => f.turnState === 'submitter' && f.openSubmitter?.nextLevelAt).map((f) => ({ at: f.openSubmitter.nextLevelAt, kind: 'penalty', level: f.openSubmitter.nextLevel, finding: f.number }));
  const candidates = [];
  if (isRP && wk3Close) candidates.push({ at: wk3Close, kind: 'wk3' });
  if (isRP && wk6Close) candidates.push({ at: wk6Close, kind: 'wk6' });
  if (isRP) candidates.push(...penaltyDates);
  const future = candidates.filter((c) => c.at > asOf).sort((a, b) => a.at - b.at);
  const nextDeadline = future[0] || null;
  const bdUntil = (t) => (t != null && t > asOf ? cal.businessDays(asOf, t) : null);

  const openSubWaits = findings.filter((f) => f.turnState === 'submitter').map((f) => f.openSubmitter).filter(Boolean).map((t) => t.labelDays);
  const longestSubmitterWait = openSubWaits.length ? Math.max(...openSubWaits) : null;

  // Stuck (M12)
  const stuckReasons = [];
  if (isRP || status === 'COMPLIANCE_CHECKING') {
    if (stage === 'RP_PAST_WK6') stuckReasons.push('past6');
    if (flags.has('escalated')) stuckReasons.push('escalated');
    if (flags.has('compliance_overdue')) stuckReasons.push('overdue');
    if (stage === 'CC_FAILED') stuckReasons.push('failed');
  }

  const objectorOrgs = new Set(findings.map((f) => f.byOrg).filter(Boolean));
  const objectionTypes = new Set(findings.map((f) => f.type).filter(Boolean));
  const createdMs = ms(db.created_at);

  return {
    raw: s, id: s.id, shortId: s.short_id || (s.id || '').slice(0, 8), isTest: !!s.is_test,
    org: s.org || null, submitter: s.submitter || null, models: s.models || [], type: s.benchmark_type || 'unknown',
    division: db.division || null, availability: db.availability || null, status, stage,
    stageOrder: STAGE_BY_CODE[stage]?.order ?? 99, db, pr, ti, findings, counts, flags, waiting, waitSet,
    assignees, noFindingAssignees, finalizedBy, latestCheck,
    clock: { startMs, startDate, wk3Close, wk6Close, reviewDay: isRP ? reviewDay : null, pastWk6Days: isRP ? pastWk6Days : 0 },
    stopAt, ready, needsChair: waitSet.has('chair') && !ready, supersedes: null, supersededBy: null,
    bdToWk3: isRP ? bdUntil(wk3Close) : null, bdToWk6: isRP ? bdUntil(wk6Close) : null,
    nextDeadline, due, penalty: db.penalties_imposed ?? 0, longestSubmitterWait, stuckReasons,
    objectorOrgs, objectionTypes, createdMs, createdDate: createdMs != null ? cal.dateOf(createdMs) : null,
    penaltySoonCount: isRP ? findings.filter((f) => f.penaltySoon).length : 0,
    missedCount: isRP ? findings.filter((f) => f.missedDeadline).length : 0,
    overdueCount: isRP ? findings.filter((f) => f.replyOverdue).length : 0,
    openLongCount: isRP ? findings.filter((f) => f.openLong).length : 0,
    reviewerWaitCount: counts.reviewer,
  };
}

function dueCohort(db, cal, stage) {
  if (stage === 'FIN_RDI') return { cohort: null, reasons: [{ key: 'rdi' }], rdi: true };
  const cohorts = cal.cohorts;
  const finMs = ms(db.finalized_at);
  if (finMs == null || !cohorts.length) return { cohort: null, reasons: [{ key: 'beyond' }] };
  const earliest = cal.nextBusinessDate(cal.dateOf(finMs));
  let i = cohorts.findIndex((c) => c.date >= earliest);
  if (i < 0) return { cohort: null, reasons: [{ key: 'beyond' }] };
  const base = i;
  const reasons = [];
  const pen = db.penalties_imposed || 0;
  if (pen > 0) { i += pen; reasons.push({ key: 'penalty', arg: pen }); }
  const emb = ms(db.embargo_date);
  if (emb != null) {
    const embDate = cal.dateOf(emb);
    const j = cohorts.findIndex((c) => c.date >= embDate);
    if (j < 0) return { cohort: null, reasons: [...reasons, { key: 'embargo', arg: emb }, { key: 'beyond' }] };
    if (j > i) { i = j; reasons.push({ key: 'embargo', arg: emb }); }
  }
  if (i >= cohorts.length) return { cohort: null, reasons: [...reasons, { key: 'beyond' }] };
  return { cohort: cohorts[i], at: cal.at(cohorts[i].date, 8, 0, 0), reasons, delayed: i > base, base: cohorts[base], baseAt: cal.at(cohorts[base].date, 8, 0, 0), shift: i - base };
}

// ---------------------------------------------------------------------------
// Metrics (section 4). `rows` are already filtered; test rows are removed here.

export function turnsOf(rows, kind, { periodDays = null, asOf, author = null } = {}) {
  const out = [];
  for (const r of rows) {
    if (r.isTest) continue;
    for (const f of r.findings) {
      if (author && f.author !== author) continue;
      for (const t of f.turns) if (t.kind === kind) out.push({ t, f, r });
    }
  }
  const from = periodDays ? asOf - periodDays * DAY : null;
  // Stopped turns (D6) are neither done nor open.
  const done = out.filter(({ t }) => t.responseEnd != null && !t.missed && (from == null || t.responseEnd >= from));
  const open = out.filter(({ t }) => t.responseEnd == null && t.open);
  return {
    stats: stats(done.map(({ t }) => t.responseDays)),
    open: open.length,
    longestOpen: open.length ? Math.max(...open.map(({ t }) => t.labelDays)) : null,
    missed: out.filter(({ t }) => t.missed && (from == null || t.labelEnd >= from)).length,
    labelOnly: done.filter(({ t }) => t.labelOnly).length,
  };
}

export function firstFinding(rows, ctx, author = null) {
  const done = []; let open = 0; let longestOpen = null; let excluded = 0;
  for (const r of rows) {
    if (r.isTest || !r.ti) continue;
    if (r.clock.startMs == null) { excluded++; continue; }
    const fs = r.findings.filter((f) => !author || f.author === author).map((f) => ms(f.issue.created_at)).filter((x) => x != null);
    if (fs.length) done.push(ctx.cal.businessDays(r.clock.startMs, Math.min(...fs)));
    else if (r.status === 'REVIEW_PENDING') {
      open++;
      const d = ctx.cal.businessDays(r.clock.startMs, ctx.asOf);
      longestOpen = Math.max(longestOpen ?? 0, d);
    }
  }
  return { stats: stats(done), open, longestOpen, excluded };
}

export function computeMetrics(rows, rowsIgnoringStage, ctx, period) {
  const live = rows.filter((r) => !r.isTest);
  const periodDays = period === '30' ? 30 : period === '90' ? 90 : null;
  const rp = live.filter((r) => r.status === 'REVIEW_PENDING');
  const fin = live.filter((r) => r.status === 'FINALIZED');
  const rpFindings = rp.flatMap((r) => r.findings);

  const stageCounts = {};
  for (const s of STAGES) stageCounts[s.code] = 0;
  for (const r of rowsIgnoringStage) if (!r.isTest && r.stage) stageCounts[r.stage]++;

  const m15vals = []; let m15excluded = 0;
  for (const r of live) {
    if (!r.db.finalized_at) continue;
    if (r.clock.startMs == null) { m15excluded++; continue; }
    m15vals.push((ms(r.db.finalized_at) - r.clock.startMs) / DAY);
  }
  const noStart = rp.filter((r) => r.clock.startMs == null).length;

  return {
    total: live.length,
    M1: { ...turnsOf(live, 'submitter', { periodDays, asOf: ctx.asOf }), excluded: noStart },
    M2: turnsOf(live, 'reviewer', { periodDays, asOf: ctx.asOf }),
    M3: firstFinding(live, ctx),
    M4: rp.length,
    M5: {
      count: fin.length,
      rdi: fin.filter((r) => r.stage === 'FIN_RDI').length,
      embargoed: fin.filter((r) => r.flags.has('embargoed')).length,
      penalty: fin.filter((r) => r.flags.has('penalty_delayed')).length,
      onSchedule: fin.filter((r) => r.stage !== 'FIN_RDI' && !r.flags.has('embargoed') && !r.flags.has('penalty_delayed')).length,
    },
    M6: live.filter((r) => r.stage === 'RP_PAST_WK6').length,
    M7: stageCounts,
    M8: {
      count: live.filter((r) => r.stage === 'RP_OBJECTION').length,
      withTurn: live.filter((r) => r.stage === 'RP_OBJECTION' && (r.counts.submitter || r.counts.reviewer)).length,
    },
    M9: { count: live.filter((r) => r.waitSet.has('submitter')).length, findings: rp.reduce((a, r) => a + r.counts.submitter, 0) },
    M10: {
      count: rpFindings.filter((f) => f.turnState !== 'resolved' && f.turnState !== 'waived').length,
      waived: rpFindings.filter((f) => f.turnState === 'waived').length,
      submitter: rpFindings.filter((f) => f.turnState === 'submitter').length,
      reviewer: rpFindings.filter((f) => f.turnState === 'reviewer').length,
      none: rpFindings.filter((f) => f.turnState === 'none').length,
    },
    M11: rpFindings.filter((f) => f.penaltySoon).length,
    M12: live.filter((r) => r.stuckReasons.length).length,
    M13: {
      count: rpFindings.filter((f) => f.missedDeadline).length,
      overdue: rpFindings.filter((f) => f.replyOverdue).length,
      openLong: rpFindings.filter((f) => f.openLong).length,
    },
    M14: rp.filter((r) => r.penalty >= 1).length,
    M15: { stats: stats(m15vals), excluded: m15excluded },
    M16: live.filter((r) => r.ready).length,
    M17: live.filter((r) => r.needsChair).length,
  };
}

// Group header summary (5.2). For the reviewer key, response times and first finding are per reviewer.
export function summarizeGroup(rows, ctx, period, reviewer = null) {
  const live = rows.filter((r) => !r.isTest);
  const periodDays = period === '30' ? 30 : period === '90' ? 90 : null;
  const wait = {};
  for (const r of live) for (const w of r.waitSet) wait[w] = (wait[w] || 0) + 1;
  const sub = turnsOf(live, 'submitter', { periodDays, asOf: ctx.asOf });
  const rev = turnsOf(live, 'reviewer', { periodDays, asOf: ctx.asOf, author: reviewer });
  const out = {
    count: rows.length,
    wait,
    m1: sub.stats,
    m2: rev.stats,
    openSub: sub.open,
    longestSub: sub.longestOpen,
    stuck: live.filter((r) => r.stuckReasons.length).length,
  };
  if (reviewer) out.missed = rev.missed;
  if (reviewer) {
    out.assigned = live.filter((r) => r.assignees.includes(reviewer)).length;
    out.m3 = firstFinding(live, ctx, reviewer).stats;
  }
  return out;
}

// ---------------------------------------------------------------------------
// View as (D10, D11): which "Waiting on" values belong to the person, and their queue.

export function myWaits(r, role, login, ctx) {
  const out = new Set();
  if (!role) return out;
  const me = login ? ctx.people.get(login) : null;
  if (role === 'submitter' && login) {
    const mine = r.submitter === login || (me?.org && normOrg(me.org) === normOrg(r.org));
    if (mine && r.waitSet.has('submitter')) out.add('submitter');
    if (mine && r.waitSet.has('submitter_compliance')) out.add('submitter_compliance');
  } else if (role === 'reviewer' && login) {
    const myOrg = me?.org ? normOrg(me.org) : null;
    const mineF = r.findings.some((f) => f.turnState === 'reviewer' && (f.author === login || (myOrg && normOrg(f.byOrg) === myOrg)));
    const idle = r.waiting.find((w) => w.value === 'reviewer')?.reason.some((x) => x.key === 'reviewerNoFinding' && x.args[0].includes(login));
    if (r.waitSet.has('reviewer') && (mineF || idle)) out.add('reviewer');
  } else if (role === 'chair') {
    if (r.waitSet.has('chair') && (!login || ctx.isChair(login))) out.add('chair');
  }
  return out;
}

// The "Waiting on me" / "My queue" toggle. Chairs also own Stuck rows.
export function owesAction(r, role, login, ctx) {
  if (role === 'chair') return r.waitSet.has('chair') || r.stuckReasons.length > 0;
  return myWaits(r, role, login, ctx).size > 0;
}
