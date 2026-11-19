// Program metrics (from the "Endpoints Goals, signals, metrics" sheet): submissions per month or
// round (M16), submitting orgs (M20) and suite coverage (M28). Counted over every non-test
// submission in the snapshot; list filters do not change them.

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

  // M16 by month: one column per calendar month, oldest first, ending with the as-of month.
  const months = Array.from({ length: MONTHS }, (_, i) => ({ key: monthKey(monthStart(asOf, MONTHS - 1 - i)), n: 0 }));
  const byKey = new Map(months.map((m) => [m.key, m]));
  for (const s of subs) { const m = byKey.get(monthKey(at(s))); if (m) m.n += 1; }

  // M16 by round: publication_cycle is set only once a round is assigned, so the rest are counted apart.
  const roundCount = new Map();
  let noRound = 0;
  for (const s of subs) {
    const c = s.db.publication_cycle;
    if (c) roundCount.set(c, (roundCount.get(c) || 0) + 1); else noRound += 1;
  }
  const rounds = [...roundCount].sort(([a], [b]) => a.localeCompare(b)).map(([key, n]) => ({ key, n }));

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
  const orgs = [...used.keys()].sort((a, b) => a.localeCompare(b));
  const perOrg = orgs.map((org) => Math.round((100 * used.get(org).size) / suite.length));
  const avg = perOrg.length ? Math.round(perOrg.reduce((t, p) => t + p, 0) / perOrg.length) : 0;
  const byModel = suite.map((model) => ({ model, orgs: orgs.filter((o) => used.get(o).has(model)) }));

  return {
    months, rounds, noRound, total: months.reduce((t, m) => t + m.n, 0),
    orgsNow: orgsNow.size, orgsBefore: orgsBefore.size, suite, orgs, used, byModel, avg,
  };
}

function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
}

// Column chart in HTML, so labels keep their size at any width. A count above each non-zero column.
function columns(items, label, tip) {
  const max = Math.max(1, ...items.map((c) => c.n));
  const cols = items.map((c) => `<li class="pcol"${c.n ? ` title="${esc(tip(c))}"` : ''}>
      <span class="pbar-track"><span class="pval num">${c.n || ''}</span><span class="pbar" style="height:${c.n ? Math.max(4, (100 * c.n) / max) : 0}%"></span></span>
      <span class="plab">${esc(label(c))}</span>
    </li>`).join('');
  const summary = items.map((c) => `${tip(c)}`).join(', ');
  return `<ol class="pchart" aria-label="${esc(summary)}">${cols}</ol>`;
}

function subsChart(p, by) {
  const P = COPY.program;
  if (by === 'round') {
    const chart = p.rounds.length ? columns(p.rounds, (c) => c.key, (c) => P.roundTip(c.key, c.n)) : `<p class="mcard-line">${esc(P.noRounds)}</p>`;
    return chart + (p.noRound ? `<p class="meta">${esc(P.noRoundNote(p.noRound))}</p>` : '');
  }
  return columns(p.months, (c) => monthLabel(c.key), (c) => P.monthTip(monthLabel(c.key), c.key.slice(0, 4), c.n));
}

function stat(title, value, line) {
  return `<div class="mcard pstat"><span class="mcard-title">${esc(title)}</span><div class="mcard-value"><span class="num">${esc(value)}</span></div><p class="mcard-line">${esc(line)}</p></div>`;
}

// One row per model: full name, a bar, "n of N orgs". The org × model detail opens on request.
function coverage(p, open) {
  const P = COPY.program;
  const n = p.orgs.length;
  const rows = p.byModel.map((m) => `<li class="pmodel">
      <span class="pmodel-name">${esc(m.model)}</span>
      <span class="pmodel-track"><span class="pmodel-bar" style="width:${n ? (100 * m.orgs.length) / n : 0}%"></span></span>
      <span class="pmodel-n num">${esc(P.ofOrgs(m.orgs.length, n))}</span>
    </li>`).join('');
  const head = p.orgs.map((o) => `<th scope="col"><span class="sr-only">${esc(o)}</span></th>`).join('');
  const body = p.byModel.map((m) => `<tr><th scope="row">${esc(m.model)}</th>${p.orgs.map((o) => (p.used.get(o).has(m.model)
    ? `<td><span class="pdot on" title="${esc(P.usedTip(o, m.model))}"></span><span class="sr-only">${esc(P.used)}</span></td>`
    : `<td><span class="pdot" title="${esc(P.notUsedTip(o, m.model))}"></span></td>`)).join('')}</tr>`).join('');
  return `<ul class="pmodels">${rows}</ul>
    <details class="pdetail" id="program-by-org"${open ? ' open' : ''}><summary>${esc(P.byOrg)}</summary>
      <p class="meta">${esc(P.byOrgNote)}</p>
      <div class="pheat-wrap"><table class="pheat"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table></div>
    </details>`;
}

export function renderProgram(p, ui) {
  const P = COPY.program;
  const delta = p.orgsNow - p.orgsBefore;
  const by = ui.programBy === 'round' ? 'round' : 'month';
  const seg = (attr, cur, opts, label) => `<div class="seg-group" role="group" aria-label="${esc(label)}">
      <span class="seg-label micro">${esc(label)}</span>
      ${opts.map(([v, t]) => `<button type="button" class="seg-btn" id="${attr.slice(5)}-${v}" ${attr}="${v}" aria-pressed="${cur === v}">${esc(t)}</button>`).join('')}
    </div>`;
  return `
  <section class="program" aria-labelledby="program-h">
    <div class="metrics-head">
      <h2 id="program-h" class="micro">${esc(P.heading)}</h2>
      <span class="meta">${esc(P.scope)}</span>
      <span class="program-place">${seg('data-program-place', ui.programFirst ? 'first' : 'after', [['first', P.placeFirst], ['after', P.placeAfter]], P.place)}</span>
    </div>
    <div class="pgrid">
      ${stat(P.subsTitle, String(p.total), P.subsNote(MONTHS))}
      ${stat(P.orgsTitle, String(p.orgsNow), P.orgsDelta(delta, p.orgsBefore, WINDOW))}
      ${stat(P.suiteTitle, `${p.avg}%`, P.suiteNote(p.suite.length, WINDOW))}
      <div class="mcard pchart-card">
        <div class="pcard-head">
          <span class="mcard-title">${esc(P.chartTitle)}</span>
          ${seg('data-program-by', by, [['month', P.byMonth], ['round', P.byRound]], P.by)}
        </div>
        ${subsChart(p, by)}
      </div>
      <div class="mcard pcover-card">
        <div class="mcard-main"><span class="mcard-title">${esc(P.coverTitle)}</span><span class="mcard-caption">${esc(P.coverNote(p.orgs.length, WINDOW))}</span></div>
        ${coverage(p, ui.programByOrg)}
      </div>
    </div>
  </section>`;
}
