// Analytics trends (from the "Endpoints Goals, signals, metrics" sheet): submissions per cohort (M16),
// submitting orgs (M20) and suite coverage (M28). Counted over every non-test submission in the
// snapshot; list filters do not change them.
//
// Cohorts (rules §4.2): results publish on the 1st and 3rd Wednesday of each month, ids YYYY-MM-C0 and
// YYYY-MM-C1. A submission belongs to the first cohort on or after its submission date (Pacific),
// unless the "Published" view is chosen, which uses the cohort it was published in (publication_cycle).

import { COPY } from './copy.js';
import { esc } from './format.js';

const COHORTS = 12; // columns in the chart: about 6 months
const WINDOW = 6; // cohorts, for M20 and M28

const ptDate = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

export function computeProgram(snapshot) {
  const cohorts = (snapshot.calendar?.cohorts || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const subs = snapshot.submissions.filter((s) => !s.is_test && s.db?.created_at);
  // The cohort a submission was made for: the first cohort date on or after its submission date.
  const forIdx = (s) => cohorts.findIndex((c) => c.date >= ptDate(s.db.created_at));
  const nowIdx = cohorts.findIndex((c) => c.date >= ptDate(snapshot.as_of)); // the open cohort
  const last = nowIdx < 0 ? cohorts.length - 1 : nowIdx;
  const first = Math.max(0, last - COHORTS + 1);
  const shown = cohorts.slice(first, last + 1);
  const col = () => shown.map((c) => ({ key: c.id, date: c.date, open: c.id === cohorts[nowIdx]?.id, n: 0 }));

  // M16: by the cohort each submission was made for, and by the cohort it was published in.
  const submitted = col(); const published = col();
  const at = new Map(shown.map((c, i) => [c.id, i]));
  let noPub = 0;
  for (const s of subs) {
    const i = forIdx(s);
    if (i >= first && i <= last) submitted[i - first].n += 1;
    const pc = s.db.publication_cycle;
    if (!pc) noPub += 1; else if (at.has(pc)) published[at.get(pc)].n += 1;
  }

  // M20: distinct orgs in the last WINDOW cohorts, and in the WINDOW cohorts before that.
  const inWin = (s, lo, hi) => { const i = forIdx(s); return i >= lo && i <= hi; };
  const recent = subs.filter((s) => inWin(s, last - WINDOW + 1, last));
  const orgsNow = new Set(recent.map((s) => s.org));
  const orgsBefore = new Set(subs.filter((s) => inWin(s, last - 2 * WINDOW + 1, last - WINDOW)).map((s) => s.org));

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
    submitted, published, noPub, total: submitted.reduce((t, c) => t + c.n, 0), span: shown.length,
    orgsNow: orgsNow.size, orgsBefore: orgsBefore.size, suite, orgs, used, byModel, avg,
  };
}

// "2026-11-C1" -> "Nov C1" (HTML, in two parts so phones can show the month alone); the full id and date go to the tooltip.
function cohortLabel(id) {
  const [y, m, c] = id.split('-');
  const month = new Date(Date.UTC(+y, +m - 1, 1)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return `<span class="plab-m">${esc(month)}</span> <span class="plab-c">${esc(c)}</span>`;
}

// Column chart in HTML, so labels keep their size at any width. A count above each non-zero column.
function columns(items, label, tip) {
  const max = Math.max(1, ...items.map((c) => c.n));
  const cols = items.map((c) => `<li class="pcol${c.open ? ' open' : ''}" title="${esc(tip(c))}">
      <span class="pbar-track"><span class="pval num">${c.n || ''}</span><span class="pbar" style="height:${c.n ? Math.max(4, (100 * c.n) / max) : 0}%"></span></span>
      <span class="plab">${label(c)}</span>
    </li>`).join('');
  const summary = items.map((c) => `${tip(c)}`).join(', ');
  return `<ol class="pchart" aria-label="${esc(summary)}">${cols}</ol>`;
}

function subsChart(p, by) {
  const P = COPY.program;
  const items = by === 'published' ? p.published : p.submitted;
  const tip = (c) => P.cohortTip(c.key, c.date, c.n, c.open);
  return columns(items, (c) => cohortLabel(c.key), tip)
    + `<p class="meta">${esc(by === 'published' ? P.publishedNote(p.noPub) : P.submittedNote)}</p>`;
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
  const by = ui.programBy === 'published' ? 'published' : 'submitted';
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
      ${stat(P.subsTitle, String(p.total), P.subsNote(p.span))}
      ${stat(P.orgsTitle, String(p.orgsNow), P.orgsDelta(delta, p.orgsBefore, WINDOW))}
      ${stat(P.suiteTitle, `${p.avg}%`, P.suiteNote(p.suite.length, WINDOW))}
      <div class="mcard pchart-card">
        <div class="pcard-head">
          <span class="mcard-title">${esc(P.chartTitle)}</span>
          ${seg('data-program-by', by, [['submitted', P.bySubmitted], ['published', P.byPublished]], P.by)}
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
