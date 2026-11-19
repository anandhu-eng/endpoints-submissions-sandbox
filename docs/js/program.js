// Program metrics (from the "Endpoints Goals, signals, metrics" sheet): submissions per month (M16),
// submitting orgs (M20) and suite coverage (M28). Counted over every non-test submission in the
// snapshot; list filters do not change them.

import { COPY } from './copy.js';
import { esc } from './format.js';

const MONTHS = 12;
const WINDOW = 6; // months, for M20 and M28

// First day (UTC) of the month `back` months before `d`.
function monthStart(d, back = 0) { return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1); }
function monthKey(ms) { const d = new Date(ms); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; }

export function computeProgram(snapshot) {
  const asOf = new Date(Date.parse(snapshot.as_of));
  const subs = snapshot.submissions.filter((s) => !s.is_test && s.db?.created_at);
  const at = (s) => Date.parse(s.db.created_at);

  // M16: one bar per calendar month, oldest first, ending with the as-of month.
  const months = Array.from({ length: MONTHS }, (_, i) => ({ key: monthKey(monthStart(asOf, MONTHS - 1 - i)), n: 0 }));
  const byKey = new Map(months.map((m) => [m.key, m]));
  for (const s of subs) { const m = byKey.get(monthKey(at(s))); if (m) m.n += 1; }

  // M20: distinct orgs in the last WINDOW months, and in the WINDOW months before that.
  const cut = monthStart(asOf, WINDOW - 1);
  const prevCut = monthStart(asOf, 2 * WINDOW - 1);
  const recent = subs.filter((s) => at(s) >= cut);
  const orgsNow = new Set(recent.map((s) => s.org));
  const orgsBefore = new Set(subs.filter((s) => at(s) >= prevCut && at(s) < cut).map((s) => s.org));

  // M28: the suite is every model seen in the snapshot (a stand-in until the suite is defined).
  const suite = [...new Set(subs.flatMap((s) => s.models || []))].sort();
  const used = new Map();
  for (const s of recent) for (const m of s.models || []) {
    if (!used.has(s.org)) used.set(s.org, new Set());
    used.get(s.org).add(m);
  }
  const coverage = [...used].map(([org, set]) => ({ org, models: set, pct: Math.round((100 * set.size) / suite.length) }))
    .sort((a, b) => b.pct - a.pct || a.org.localeCompare(b.org));
  const avg = coverage.length ? Math.round(coverage.reduce((t, c) => t + c.pct, 0) / coverage.length) : 0;

  return { months, total: months.reduce((t, m) => t + m.n, 0), orgsNow: orgsNow.size, orgsBefore: orgsBefore.size, suite, coverage, avg };
}

function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
}

// Column chart: rounded tops, 2px gaps, a count above each non-zero bar, every other month labelled.
function monthsChart(months) {
  const W = 360, H = 132, top = 16, base = 104, gap = 2;
  const max = Math.max(1, ...months.map((m) => m.n));
  const bw = W / months.length;
  const bars = months.map((m, i) => {
    const x = i * bw + gap / 2, w = bw - gap, h = m.n ? Math.max(3, ((base - top) * m.n) / max) : 0, y = base - h;
    const r = Math.min(4, w / 2, h);
    const shape = h ? `<path class="pbar" d="M${x} ${base} V${y + r} Q${x} ${y} ${x + r} ${y} H${x + w - r} Q${x + w} ${y} ${x + w} ${y + r} V${base} Z"><title>${esc(COPY.program.monthTip(monthLabel(m.key), m.key.slice(0, 4), m.n))}</title></path>` : '';
    const val = m.n ? `<text class="pval" x="${x + w / 2}" y="${y - 4}" text-anchor="middle">${m.n}</text>` : '';
    const lab = i % 2 === months.length % 2 ? '' : `<text class="plab" x="${x + w / 2}" y="${base + 16}" text-anchor="middle">${esc(monthLabel(m.key))}</text>`;
    return shape + val + lab;
  }).join('');
  const summary = months.map((m) => `${monthLabel(m.key)} ${m.key.slice(0, 4)}: ${m.n}`).join(', ');
  return `<svg class="pchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(COPY.program.subsAria(summary))}"><line class="pbase" x1="0" x2="${W}" y1="${base}" y2="${base}"/>${bars}</svg>`;
}

function coverageGrid(p) {
  const head = p.suite.map((m) => `<th scope="col"><span class="pcol">${esc(m)}</span></th>`).join('');
  const rows = p.coverage.map((c) => `<tr><th scope="row">${esc(c.org)}</th>${p.suite.map((m) => `<td>${c.models.has(m) ? `<span class="pdot on" title="${esc(COPY.program.usedTip(c.org, m))}"></span><span class="sr-only">${esc(COPY.program.used)}</span>` : '<span class="pdot"></span>'}</td>`).join('')}<td class="ppct num">${c.pct}%</td></tr>`).join('');
  return `<div class="pgrid-wrap"><table class="pgrid"><thead><tr><th></th>${head}<th scope="col" class="ppct">${esc(COPY.program.share)}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function renderProgram(p) {
  const P = COPY.program;
  const delta = p.orgsNow - p.orgsBefore;
  return `
  <section class="program" aria-labelledby="program-h">
    <div class="metrics-head">
      <h2 id="program-h" class="micro">${esc(P.heading)}</h2>
      <span class="meta">${esc(P.scope)}</span>
    </div>
    <div class="pcards">
      <div class="mcard pcard-subs">
        <div class="mcard-main"><span class="mcard-title">${esc(P.subsTitle)}</span><span class="mcard-caption">${esc(P.subsNote(p.total, MONTHS))}</span></div>
        ${monthsChart(p.months)}
      </div>
      <div class="mcard pcard-orgs">
        <div class="mcard-main"><span class="mcard-title">${esc(P.orgsTitle)}</span><span class="mcard-caption">${esc(P.orgsNote(WINDOW))}</span></div>
        <div class="mcard-value"><span class="num">${p.orgsNow}</span></div>
        <p class="mcard-line">${esc(P.orgsDelta(delta, p.orgsBefore))}</p>
      </div>
      <div class="mcard pcard-suite">
        <div class="mcard-main"><span class="mcard-title">${esc(P.suiteTitle)}</span><span class="mcard-caption">${esc(P.suiteNote(p.suite.length, WINDOW))}</span></div>
        <p class="mcard-line">${esc(P.suiteAvg(p.avg))}</p>
        ${coverageGrid(p)}
      </div>
    </div>
  </section>`;
}
