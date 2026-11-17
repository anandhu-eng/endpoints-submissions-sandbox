// Main view: metrics, stage counts, filters sidebar, grouping toolbar and the list.

import { COPY } from './copy.js';
import { esc, days1, plainDateText, dateText, dateTimeText, shortDateTimeText, isoText } from './format.js';
import { icon } from './icons.js';
import { STAGES, STATUS_ORDER, TERMINAL, DEFAULT_STAGES, summarizeGroup } from './derive.js';
import { stageSet, groupRows, alsoInCount, matchedDeadline, GROUP_KEYS, MULTI_KEYS, SORT_KEYS, PERIODS, GSORTS, UNASSIGNED } from './query.js';
import { stagePill, waitChip, waitReasonText, flagBadge, personName, valueLabel } from './ui.js';

// ---------------------------------------------------------------------------
// Metric tiles. Each tile names the filter it applies.

export const TILE_FILTERS = {
  M1: { wait: ['submitter'] },
  M2: { wait: ['reviewer'] },
  M3: { nofind: true },
  M4: { stage: STAGES.filter((s) => s.status === 'REVIEW_PENDING').map((s) => s.code) },
  M5: { stage: ['FIN_RDI', 'FIN_WAITING'] },
  M6: { stage: ['RP_PAST_WK6'] },
  M8: { stage: ['RP_OBJECTION'] },
  M9: { wait: ['submitter'] },
  M10: { wait: ['submitter', 'reviewer'] },
  M11: { due: ['pen1'] },
  M12: { due: ['stuck'] },
  M13: { due: ['overdue', 'open12'] },
  M14: { stage: STAGES.filter((s) => s.status === 'REVIEW_PENDING').map((s) => s.code), pen: ['1', '2', '3'] },
  M15: { stage: ['FIN_RDI', 'FIN_WAITING', 'PUBLISHED'] },
  M16: { queue: ['ready'] },
  M17: { queue: ['needschair'] },
  RP_EARLY: { stage: ['RP_SETUP', 'RP_PEER'] },
};
// M6 (past Week 6) and M8 (Weeks 4–6) live inside the "Under review" card as its phases.
const SECONDARY = ['M3', 'M9', 'M10', 'M11', 'M12', 'M13', 'M14', 'M15', 'M16', 'M17'];

export function tileActive(state, id) {
  const f = TILE_FILTERS[id];
  return Object.entries(f).every(([k, v]) => {
    if (k === 'nofind') return state.nofind === v;
    const cur = k === 'stage' ? state.stage : state[k];
    if (!cur) return false;
    return cur.size === v.length && v.every((x) => cur.has(x));
  });
}

// A response-time figure: the median is the value; mean, n and caveats go to the tooltip.
function respStat(m, line, extra, calendar = false) {
  const v = m.stats.median;
  return {
    value: v == null ? COPY.metrics.none : days1(v),
    unit: v == null ? '' : COPY.metrics.daysShort,
    caption: v == null ? '' : calendar ? COPY.metrics.medianCaptionCal : COPY.metrics.medianCaption,
    line,
    detail: [COPY.metrics.meanN(days1(m.stats.mean), m.stats.n), ...extra],
  };
}

const press = (state, id) => `data-metric="${id}" aria-pressed="${tileActive(state, id)}"`;
const tipFor = (state, id, detail = []) => esc([COPY.metrics[id].help, ...detail.filter(Boolean), tileActive(state, id) ? COPY.metrics.active : COPY.metrics.applies].join(' '));

// One metric card: a title, one large number and at most one supporting line (REQUIREMENTS §4).
// `extra` is markup placed under the figure (a phase bar, a breakdown list).
function card(state, id, t, extra = '') {
  const on = tileActive(state, id);
  return `<div class="mcard${on ? ' on' : ''}${t.warn ? ' warn' : ''}${t.wide ? ' wide' : ''}">
    <button type="button" class="mcard-main" ${press(state, id)} title="${tipFor(state, id, t.detail)}">
      <span class="mcard-title">${esc(COPY.metrics[id].name)}</span>
      ${t.pill ? `<span class="period-pill">${esc(t.pill)}</span>` : ''}
      <span class="mcard-value">${t.warn ? icon('alert', 'mcard-warn') : ''}<span class="num">${esc(t.value)}</span>${t.unit ? `<span class="unit">${esc(t.unit)}</span>` : ''}</span>
      ${t.caption ? `<span class="mcard-caption">${esc(t.caption)}</span>` : ''}
    </button>
    ${[].concat(t.line || []).filter(Boolean).map((l) => `<p class="mcard-line">${esc(l)}</p>`).join('')}
    ${extra}
  </div>`;
}

// "Under review" phases as a thin bar plus a legend that doubles as filter buttons.
function phaseBlock(m, state) {
  const parts = [
    { id: 'RP_EARLY', cls: 'p1', label: COPY.metrics.phases.early, n: m.M4 - m.M8.count - m.M6 },
    { id: 'M8', cls: 'p2', label: COPY.metrics.phases.objection, n: m.M8.count, detail: [COPY.metrics.M8second(m.M8.withTurn)] },
    { id: 'M6', cls: 'p3', label: COPY.metrics.phases.past, n: m.M6 },
  ];
  const alert = m.M6 > 0 ? `<button type="button" class="alert-chip" ${press(state, 'M6')} title="${tipFor(state, 'M6')}">${icon('alert')}${esc(COPY.metrics.pastAlert(m.M6))}</button>` : '';
  const bar = m.M4 > 0
    ? `<div class="phasebar" role="img" aria-label="${esc(COPY.metrics.phaseBar(parts[0].n, parts[1].n, parts[2].n))}">${parts.filter((p) => p.n > 0).map((p) => `<span class="seg ${p.cls}" style="flex-grow:${p.n}" title="${esc(`${p.label}: ${p.n}`)}"></span>`).join('')}</div>`
    : '';
  const legend = `<ul class="legend">${parts.map((p) => `<li><button type="button" class="legend-item" ${press(state, p.id)} title="${tipFor(state, p.id, p.detail)}"><i class="dot ${p.cls}" aria-hidden="true"></i><span>${esc(p.label)}</span><b>${p.n}</b></button></li>`).join('')}</ul>`;
  return alert + bar + legend;
}

// "Waiting to publish" split by reason. Zero rows are left out.
function publishBlock(m) {
  const P = COPY.metrics.M5parts;
  const rows = [[P.rdi, m.M5.rdi], [P.embargoed, m.M5.embargoed], [P.penalty, m.M5.penalty], [P.onSchedule, m.M5.onSchedule]].filter(([, n]) => n > 0);
  if (!rows.length) return `<p class="mcard-line">${esc(COPY.metrics.noneToPublish)}</p>`;
  return `<ul class="legend static">${rows.map(([label, n]) => `<li><span class="legend-item"><span>${esc(label)}</span><b>${n}</b></span></li>`).join('')}</ul>`;
}

// Secondary metrics as compact rows: name (and one short line) on the left, value on the right.
function metricRow(state, id, t) {
  const on = tileActive(state, id);
  const lines = [].concat(t.line || []).filter(Boolean);
  return `<button type="button" class="mrow${on ? ' on' : ''}${t.warn ? ' warn' : ''}" ${press(state, id)} title="${tipFor(state, id, t.detail)}">
    <span class="mrow-text"><span class="mrow-name">${esc(COPY.metrics[id].name)}</span>${lines.map((l) => `<span class="mrow-sub">${esc(l)}</span>`).join('')}</span>
    <span class="mrow-value">${t.warn ? icon('alert', 'mrow-warn') : ''}<span class="num">${esc(t.value)}</span>${t.unit ? `<span class="unit">${esc(t.unit)}</span>` : ''}</span>
  </button>`;
}

export function renderMetrics(m, state, showMore) {
  const pill = COPY.metrics.periodPill[state.period] || COPY.metrics.periodPill.all;
  const M = COPY.metrics;
  const primary = [
    card(state, 'M4', { value: m.M4, wide: true }, phaseBlock(m, state)),
    card(state, 'M5', { value: m.M5.count, wide: true }, publishBlock(m)),
    card(state, 'M1', { ...respStat(m.M1, M.waitingNow(m.M1.open, days1(m.M1.longestOpen)), [m.M1.labelOnly ? M.labelOnlyTurns(m.M1.labelOnly) : null, m.M1.excluded ? M.excluded(m.M1.excluded, M.noStart) : null]), pill }),
    card(state, 'M2', { ...respStat(m.M2, [M.waitingNow(m.M2.open, days1(m.M2.longestOpen)), m.M2.missed ? M.missedShort(m.M2.missed) : null], [m.M2.labelOnly ? M.labelOnlyTurns(m.M2.labelOnly) : null]), pill }),
  ];
  const secondary = {
    M3: respStat({ stats: m.M3.stats }, M.openTurns(m.M3.open, days1(m.M3.longestOpen)), [m.M3.excluded ? M.excluded(m.M3.excluded, M.noStart) : null]),
    M9: { value: m.M9.count, line: M.M9second(m.M9.findings) },
    M10: { value: m.M10.count, line: M.M10second(m.M10.submitter, m.M10.reviewer, m.M10.none), detail: [m.M10.waived ? M.M10waived(m.M10.waived) : null] },
    M11: { value: m.M11, warn: m.M11 > 0 },
    M12: { value: m.M12, warn: m.M12 > 0 },
    M13: { value: m.M13.count, warn: m.M13.count > 0, line: M.M13parts(m.M13.overdue, m.M13.openLong) },
    M14: { value: m.M14 },
    M15: respStat(m.M15, '', [m.M15.excluded ? M.excluded(m.M15.excluded, M.noStart) : null], true),
    M16: { value: m.M16 },
    M17: { value: m.M17, warn: m.M17 > 0 },
  };
  return `
  <section class="metrics" aria-labelledby="metrics-h">
    <div class="metrics-head">
      <h2 id="metrics-h" class="micro">${esc(COPY.metrics.heading)}</h2>
      <span class="meta">${esc(COPY.metrics.scope(m.total))}</span>
      <div class="seg-group" role="group" aria-label="${esc(COPY.metrics.period)}" title="${esc(COPY.metrics.periodHelp)}">
        <span class="seg-label micro">${esc(COPY.metrics.period)}</span>
        ${PERIODS.map((p) => `<button type="button" class="seg-btn" id="period-${p}" data-period="${p}" aria-pressed="${state.period === p}">${esc(COPY.metrics.periods[p])}</button>`).join('')}
      </div>
    </div>
    <div class="mcards">${primary.join('')}</div>
    <div class="mrows" id="tiles-more" ${showMore ? '' : 'hidden'}>${SECONDARY.map((id) => metricRow(state, id, secondary[id])).join('')}</div>
    <div class="metrics-foot">
      <button type="button" class="btn-link" id="more-metrics" aria-expanded="${showMore}" aria-controls="tiles-more">${esc(showMore ? COPY.metrics.fewer : COPY.metrics.more)}</button>
      <details class="caveats" id="caveats"><summary>${icon('info')}${esc(COPY.metrics.caveatsTitle)}</summary><ul>${COPY.metrics.caveats.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></details>
    </div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Stage counts (M7), grouped by DB status, terminal statuses folded into "Closed".

export function renderStageCounts(counts, state) {
  // One button per DB status with its total; the per-stage counts are in the tooltip and in
  // the sidebar Stage filter (M7). Terminal statuses fold into "Closed" (D19).
  const active = stageSet(state);
  const isOnly = (codes) => state.stage && state.stage.size === codes.length && codes.every((c) => state.stage.has(c));
  const breakdown = (stages) => stages.map((s) => `${COPY.stages[s.code]}: ${counts[s.code]}`).join('\n');
  const item = (label, codes, stages, attrs, pressed) => {
    const total = codes.reduce((a, c) => a + counts[c], 0);
    return `<button type="button" class="sc-pipe${total ? '' : ' zero'}" ${attrs} aria-pressed="${pressed}" title="${esc(breakdown(stages))}">
      <span>${esc(label)}</span><b class="num">${total}</b></button>`;
  };
  const open = STATUS_ORDER.filter((s) => !TERMINAL.has(s)).map((status) => {
    const stages = STAGES.filter((s) => s.status === status);
    const codes = stages.map((s) => s.code);
    return item(COPY.stageGroups[status], codes, stages, `data-stages="${codes.join(',')}"`, isOnly(codes));
  });
  const closedStages = STAGES.filter((s) => TERMINAL.has(s.status));
  const closedCodes = closedStages.map((s) => s.code);
  const closed = item(COPY.stageGroups.closed, closedCodes, closedStages, `id="sc-closed" data-closed="${closedCodes.join(',')}"`, closedCodes.every((c) => active.has(c)));
  return `<section class="stage-counts" aria-labelledby="sc-h">
    <h2 id="sc-h" class="micro" title="${esc(COPY.metrics.M7.help)}">${esc(COPY.metrics.M7.name)}</h2>
    <div class="sc-pipeline">${open.join('')}${closed}</div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Filters sidebar

function countPill(n) { return n ? `<span class="count-pill">${n}</span>` : ''; }

// opts.counts: rows per value (S10); opts.disabled: value -> reason it cannot be used yet.
function checkList(key, values, state, labelFn = (v) => valueLabel(key, v), opts = {}) {
  if (!values.length) return `<p class="muted meta">${esc(COPY.missing)}</p>`;
  return `<ul class="checks">${values.map((v) => {
    const id = `f-${key}-${String(v).replace(/[^\w-]/g, '_')}`;
    const why = opts.disabled?.[v];
    const n = opts.counts ? opts.counts[v] ?? 0 : null;
    return `<li><label for="${id}"${why ? ` title="${esc(why)}" class="is-disabled"` : ''}><input type="checkbox" id="${id}" data-filter="${key}" value="${esc(v)}" ${state[key].has(v) ? 'checked' : ''} ${why && !state[key].has(v) ? 'disabled' : ''}><span>${esc(labelFn(v))}</span>${n != null ? `<span class="opt-count num">${n}</span>` : ''}</label>${why ? `<span class="meta block opt-why">${esc(why)}</span>` : ''}</li>`;
  }).join('')}</ul>`;
}

function fieldset(key, title, body, n) {
  return `<fieldset class="fgroup"><legend class="field-label">${esc(title)}${countPill(n)}</legend>${body}</fieldset>`;
}

export function renderFilters(state, dom, openSections, extra = {}) {
  const st = stageSet(state);
  const stageTree = STATUS_ORDER.map((status) => {
    const stages = STAGES.filter((s) => s.status === status);
    const on = stages.filter((s) => st.has(s.code)).length;
    const id = `f-status-${status}`;
    return `<li><label for="${id}" class="status-row"><input type="checkbox" id="${id}" data-status="${status}" aria-label="${esc(COPY.filters.allOf(COPY.stageGroups[status]))}" ${on === stages.length ? 'checked' : ''} data-indeterminate="${on > 0 && on < stages.length}">
      <span>${esc(COPY.stageGroups[status])}</span><span class="db-status">${esc(status)}</span></label>
      <ul class="checks nested">${stages.map((s) => {
        const sid = `f-stage-${s.code}`;
        const n = extra.stageCounts ? extra.stageCounts[s.code] ?? 0 : null;
        return `<li><label for="${sid}"><input type="checkbox" id="${sid}" data-stage="${s.code}" ${st.has(s.code) ? 'checked' : ''}><span>${esc(COPY.stages[s.code])}</span>${n != null ? `<span class="opt-count num">${n}</span>` : ''}</label></li>`;
      }).join('')}</ul></li>`;
  }).join('');

  // D17: the N field sits right under the two "within N business days" options.
  const dueList = `<ul class="checks">${dom.due.map((v) => {
    const id = `f-due-${v}`;
    const label = typeof COPY.filters.dueOptions[v] === 'function' ? COPY.filters.dueOptions[v](state.n) : COPY.filters.dueOptions[v];
    const item = `<li><label for="${id}"><input type="checkbox" id="${id}" data-filter="due" value="${v}" ${state.due.has(v) ? 'checked' : ''}><span>${esc(label)}</span></label></li>`;
    return v === 'wk6n' ? `${item}<li class="n-row"><label class="inline-field" for="f-n"><span class="meta">${esc(COPY.filters.dueN)}</span><input type="number" id="f-n" min="1" max="60" value="${state.n}" class="field-control narrow"></label></li>` : item;
  }).join('')}</ul>`;

  const section = (id, title, inner) => `<details class="fsection" id="fs-${id}" ${openSections.has(id) ? 'open' : ''}>
    <summary class="fsection-title">${icon('chevRight', 'chev')}${esc(title)}</summary><div class="fsection-body">${inner}</div></details>`;

  return `
  <div class="sidebar-head">
    <h2 class="micro">${esc(COPY.filters.title)}</h2>
    <button type="button" class="btn-quiet" id="clear-all">${esc(COPY.filters.clearAll)}</button>
    <button type="button" class="icon-btn only-drawer" id="close-filters" aria-label="${esc(COPY.filters.close)}">${icon('close')}</button>
  </div>
  ${section('review', COPY.filters.sections.review, `
    ${fieldset('queue', COPY.filters.queue, checkList('queue', dom.queue, state, (v) => COPY.filters.queueOptions[v], { counts: extra.counts?.queue, disabled: extra.canMe ? {} : { me: COPY.filters.pickPersonFirst } }), state.queue.size)}
    ${fieldset('wait', COPY.filters.wait, checkList('wait', dom.wait, state, undefined, { counts: extra.counts?.wait }), state.wait.size)}
    ${fieldset('due', COPY.filters.due, dueList, state.due.size)}
    ${fieldset('rev', COPY.filters.rev, `<label class="toggle" for="f-nofind"><input type="checkbox" id="f-nofind" data-bool="nofind" ${state.nofind ? 'checked' : ''}><span>${esc(COPY.filters.nofind)}</span></label>${checkList('rev', dom.rev, state)}`, state.rev.size)}
    <fieldset class="fgroup"><legend class="field-label">${esc(COPY.filters.stage)}${countPill(state.stage ? state.stage.size : 0)}</legend>
      <p class="meta muted">${esc(state.stage ? (state.stage.size ? '' : COPY.filters.allStages) : COPY.filters.defaultStages)} ${esc(COPY.filters.stageHelp)}</p>
      <ul class="checks tree-checks">${stageTree}</ul></fieldset>
  `)}
  ${section('submission', COPY.filters.sections.submission, `
    ${fieldset('org', COPY.filters.org, checkList('org', dom.org, state), state.org.size)}
    ${fieldset('sub', COPY.filters.sub, checkList('sub', dom.sub, state), state.sub.size)}
    ${fieldset('model', COPY.filters.model, checkList('model', dom.model, state), state.model.size)}
    ${fieldset('type', COPY.filters.type, checkList('type', dom.type, state), state.type.size)}
    ${fieldset('div', COPY.filters.div, checkList('div', dom.div, state), state.div.size)}
    ${fieldset('avail', COPY.filters.avail, checkList('avail', dom.avail, state), state.avail.size)}
    ${fieldset('pen', COPY.filters.pen, checkList('pen', dom.pen, state), state.pen.size)}
    ${fieldset('flag', COPY.filters.flag, checkList('flag', dom.flag, state), state.flag.size)}
    <fieldset class="fgroup"><legend class="field-label">${esc(COPY.filters.submitted)}</legend>
      <div class="date-pair">
        <label for="f-from"><span class="meta">${esc(COPY.filters.from)}</span><input type="date" id="f-from" data-date="from" value="${esc(state.from)}" class="field-control"></label>
        <label for="f-to"><span class="meta">${esc(COPY.filters.to)}</span><input type="date" id="f-to" data-date="to" value="${esc(state.to)}" class="field-control"></label>
      </div></fieldset>
    <label class="toggle" for="f-test" title="${esc(COPY.filters.testHelp)}"><input type="checkbox" id="f-test" data-bool="test" ${state.test ? 'checked' : ''}><span>${esc(COPY.filters.test)}</span></label>
  `)}
  ${section('findings', COPY.filters.sections.findings, `
    ${fieldset('by', COPY.filters.by, checkList('by', dom.by, state), state.by.size)}
    ${fieldset('otype', COPY.filters.otype, checkList('otype', dom.otype, state), state.otype.size)}
  `)}`;
}

// Active filter chips under the toolbar.
export function renderChips(state) {
  const chips = [];
  const add = (key, value, text) => chips.push(`<button type="button" class="chip" data-chip="${key}" data-value="${esc(value)}" aria-label="${esc(COPY.filters.chipRemove(text))}"><span>${esc(text)}</span>${icon('close')}</button>`);
  if (state.q) add('q', '', `${COPY.filters.search}: ${state.q}`);
  if (state.stage) {
    // S11: describe the choice against the default stages when that is shorter.
    const def = new Set(DEFAULT_STAGES);
    const on = STAGES.filter((s) => state.stage.has(s.code)).map((s) => COPY.stages[s.code]);
    const off = STAGES.filter((s) => !state.stage.has(s.code)).map((s) => COPY.stages[s.code]);
    const removed = STAGES.filter((s) => def.has(s.code) && !state.stage.has(s.code)).map((s) => COPY.stages[s.code]);
    const added = STAGES.filter((s) => !def.has(s.code) && state.stage.has(s.code)).map((s) => COPY.stages[s.code]);
    // Stage names can contain commas, so separate them with semicolons.
    const vsDefault = [removed.length ? COPY.filters.defaultExcept(removed.join('; ')) : '', added.length ? COPY.filters.defaultPlus(added.join('; ')) : ''].filter(Boolean).join(' · ');
    const plain = off.length < on.length ? COPY.filters.allExcept(off.join('; ')) : on.join('; ');
    const text = !state.stage.size || !off.length ? COPY.filters.allStages : (removed.length + added.length < Math.min(on.length, off.length) ? vsDefault : plain);
    add('stage', '', `${COPY.filters.stage}: ${text}`);
  }
  const names = { queue: COPY.filters.queue, wait: COPY.filters.wait, due: COPY.filters.due, rev: COPY.filters.rev, by: COPY.filters.by, org: COPY.filters.org, sub: COPY.filters.sub, model: COPY.filters.model, type: COPY.filters.type, div: COPY.filters.div, avail: COPY.filters.avail, otype: COPY.filters.otype, pen: COPY.filters.pen, flag: COPY.filters.flag };
  for (const [k, title] of Object.entries(names)) for (const v of state[k]) {
    const label = k === 'due' && typeof COPY.filters.dueOptions[v] === 'function' ? COPY.filters.dueOptions[v](state.n) : k === 'queue' ? COPY.filters.queueOptions[v] : valueLabel(k, v);
    add(k, v, `${title}: ${label}`);
  }
  if (state.nofind) add('nofind', '', COPY.filters.nofind);
  if (state.from) add('from', '', `${COPY.filters.from}: ${plainDateText(state.from)}`);
  if (state.to) add('to', '', `${COPY.filters.to}: ${plainDateText(state.to)}`);
  if (state.test) add('test', '', COPY.filters.test);
  return chips.join('');
}

// ---------------------------------------------------------------------------
// Grouping and sort toolbar

export function renderGroupBar(state) {
  const chips = state.group.map((k, i) => `
    <span class="gchip"><span class="gchip-n">${i + 1}</span><span>${esc(COPY.grouping.keys[k])}</span>
      <button type="button" class="icon-btn xs" data-gmove="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="${esc(COPY.grouping.moveUp(COPY.grouping.keys[k]))}">${icon('chevLeft')}</button>
      <button type="button" class="icon-btn xs" data-gmove="${i}" data-dir="1" ${i === state.group.length - 1 ? 'disabled' : ''} aria-label="${esc(COPY.grouping.moveDown(COPY.grouping.keys[k]))}">${icon('chevRight')}</button>
      <button type="button" class="icon-btn xs" data-gremove="${i}" aria-label="${esc(COPY.grouping.remove(COPY.grouping.keys[k]))}">${icon('close')}</button>
    </span>`).join(`<span class="gsep" aria-hidden="true">›</span>`);
  const left = GROUP_KEYS.filter((k) => !state.group.includes(k));
  const addSel = state.group.length < 3 ? `<label class="sr-only" for="g-add">${esc(COPY.grouping.add)}</label>
    <select id="g-add" class="field-control sm"><option value="">${esc(state.group.length ? COPY.grouping.add : COPY.grouping.none)}</option>${left.map((k) => `<option value="${k}">${esc(COPY.grouping.keys[k])}</option>`).join('')}</select>` : `<span class="meta muted">${esc(COPY.grouping.max)}</span>`;
  const sortKey = state.sort.replace(/^-/, '');
  const desc = state.sort.startsWith('-');
  return `<div class="groupbar">
    <span class="field-label inline">${esc(COPY.grouping.title)}</span>
    <div class="gchips">${chips}${addSel}</div>
    ${state.group.length ? `<label class="sr-only" for="g-sort">${esc(COPY.grouping.sort)}</label>
      <select id="g-sort" class="field-control sm" title="${esc(COPY.grouping.sort)}">${GSORTS.map((g) => `<option value="${g}" ${state.gsort === g ? 'selected' : ''}>${esc({ count: COPY.grouping.sortCount, az: COPY.grouping.sortAz, m1: COPY.grouping.sortM1, m2: COPY.grouping.sortM2 }[g])}</option>`).join('')}</select>
      <button type="button" class="btn-quiet" id="expand-all">${esc(COPY.grouping.expandAll)}</button>
      <button type="button" class="btn-quiet" id="collapse-all">${esc(COPY.grouping.collapseAll)}</button>` : ''}
    <span class="spacer"></span>
    <label class="field-label inline" for="sort-key">${esc(COPY.list.sortLabel)}</label>
    <select id="sort-key" class="field-control sm">${SORT_KEYS.map((k) => `<option value="${k}" ${k === sortKey ? 'selected' : ''}>${esc(COPY.list.sorts[k])}</option>`).join('')}</select>
    <button type="button" class="icon-btn" id="sort-dir" aria-label="${esc(COPY.list.reverse)} (${esc(desc ? COPY.list.descending : COPY.list.ascending)})" title="${esc(COPY.list.reverse)}">${icon(desc ? 'down' : 'up')}</button>
  </div>`;
}

// ---------------------------------------------------------------------------
// List

const COLS = ['id', 'stage', 'wait', 'findings', 'due', 'rev', 'flags'];
const SORTABLE = { id: 'id', stage: 'stage', due: 'due' };

function deadlineCell(r, asOf, state) {
  const when = (at) => `<time class="meta block" datetime="${esc(isoText(at))}" title="${esc(dateTimeText(at))}">${esc(shortDateTimeText(at))}</time>`;
  // S5: held submissions open for review after the embargo date.
  if (r.stage === 'CC_HELD' && r.db.embargo_date) return `<span class="due-kind">${esc(COPY.list.opensAfter(dateText(r.db.embargo_date)))}</span>`;
  if (r.status === 'FINALIZED' && r.due) {
    if (r.due.rdi) return `<span class="due-fin">${esc(COPY.list.notAutoPublished)}</span>`;
    const reasons = r.due.reasons.map((x) => reasonText(x)).join('; ');
    // D25: lead with the date; the cohort code and the delay reasons go to the tooltip.
    const tip = [r.due.cohort?.id, reasons].filter(Boolean).join(' · ');
    return `<span class="due-fin" title="${esc(tip)}">${esc(r.due.cohort ? COPY.list.publishesOn(dateText(r.due.at)) : COPY.missing)}</span>`;
  }
  // D18: with a Deadline filter on, show the deadline that matched.
  const m = state ? matchedDeadline(r, state) : null;
  const matched = m ? ` title="${esc(COPY.list.matched)}"` : '';
  if (m && (m.kind === 'overdue' || m.kind === 'open12')) {
    return `<span class="due-kind soon"${matched}>${icon('alert')}${esc(COPY.list.deadlineKinds[m.kind])}${m.finding}</span>${m.at ? when(m.at) : ''}`;
  }
  const d = m && m.at ? m : r.nextDeadline;
  if (!d) return `<span class="muted">${esc(COPY.missing)}</span>`;
  const kind = d.kind === 'penalty' ? `${COPY.list.deadlineKinds.penalty(d.level)}${d.finding}` : COPY.list.deadlineKinds[d.kind];
  const soon = d.at - asOf < 2 * 864e5;
  return `<span class="due-kind${soon ? ' soon' : ''}"${matched}>${soon ? icon('clock') : ''}${esc(kind)}</span>${when(d.at)}`;
}

export function reviewDayText(r) {
  return r.clock.pastWk6Days > 0 ? COPY.list.reviewDayPast(r.clock.reviewDay, r.clock.pastWk6Days) : COPY.list.reviewDay(r.clock.reviewDay);
}

export function reasonText(x) {
  const f = COPY.detail.delayReasons[x.key];
  if (typeof f !== 'function') return f || '';
  if (x.key === 'embargo') return f(dateText(x.arg));
  return f(x.arg);
}

function rowHtml(r, ctx) {
  // At most two lines per cell; detail moves into tooltips and the detail view.
  const c = r.counts;
  const also = ctx.groupKeys ? alsoInCount(r, ctx.groupKeys) : 0;
  const link = ctx.hrefFor(r);
  const reviewers = r.assignees.length ? r.assignees.map((a) => esc(personName(a))).join(', ') : `<span class="muted">${esc(COPY.filters.unassigned)}</span>`;
  const mine = ctx.myWaits ? ctx.myWaits(r) : new Set();
  const supLinks = [
    r.supersedes ? `<a class="flag flag-supersedes" href="${esc(ctx.hrefForId(r.supersedes))}" data-open="${esc(r.supersedes)}" title="${esc(COPY.flagHelp.supersedes)}">${icon('arrow')}${esc(COPY.detail.supersedes(r.supersedes))}</a>` : '',
    r.supersededBy ? `<a class="flag flag-superseded_by" href="${esc(ctx.hrefForId(r.supersededBy))}" data-open="${esc(r.supersededBy)}" title="${esc(COPY.flagHelp.superseded_by)}">${icon('slash')}${esc(COPY.detail.supersededBy(r.supersededBy))}</a>` : '',
  ].join('');
  const stuck = r.stuckReasons.length ? `<span class="flag flag-stuck" title="${esc(r.stuckReasons.map((x) => COPY.list.stuckReasons[x]).join(', '))}">${icon('alert')}<span>${esc(COPY.metrics.M12.name)}</span></span>` : '';
  // The penalty level shows only when there is one (most rows have none).
  const penalty = r.penalty ? `<span class="flag flag-penalty" title="${esc(COPY.list.penaltyHelp)}">${esc(COPY.list.penaltyBadge(r.penalty))}</span>` : '';
  const flagList = stuck + penalty + [...r.flags].filter((f) => f !== 'supersedes' && f !== 'superseded_by').map(flagBadge).join('') + supLinks;
  const waits = r.waiting.map((w) => `<span class="wait-line" title="${esc(w.reason.map((x) => waitReasonText(x, mine.has(w.value))).join('; '))}">${waitChip(w.value, mine.has(w.value) ? ctx.youName : null)}</span>`).join('');
  const findTip = c.total ? [COPY.list.findingsTurns(c.submitter, c.reviewer), c.waived ? COPY.list.findingsWaived(c.waived) : ''].filter(Boolean).join(' · ') : '';
  return `<tr class="row" data-depth="${ctx.depth}" data-id="${esc(r.shortId)}">
    <td data-col="id" class="c-id">
      <span class="block"><a class="sub-link mono" href="${esc(link)}" data-open="${esc(r.shortId)}" aria-label="${esc(COPY.list.open(r.shortId))}">${esc(r.shortId)}</a> <span class="c-org">${esc(r.org || COPY.missing)}</span></span>
      <span class="meta block">${esc(r.models.join(', ') || COPY.missing)} · ${esc(COPY.types[r.type] || r.type)}</span>
      ${also > 0 ? `<span class="meta block also">${esc(COPY.grouping.alsoIn(also))}</span>` : ''}
    </td>
    <td data-col="stage" data-label="${esc(COPY.list.cols.stage)}">${stagePill(r.stage, { withStatus: false })}${r.clock.reviewDay != null ? `<span class="meta block">${esc(reviewDayText(r))}</span>` : ''}</td>
    <td data-col="wait" data-label="${esc(COPY.list.cols.wait)}"><span class="waits">${waits}</span></td>
    <td data-col="findings" data-label="${esc(COPY.list.cols.findings)}">${c.total ? `<span title="${esc(findTip)}">${esc(COPY.list.findingsCell(c.open, c.total))}</span>` : `<span class="muted">${esc(COPY.missing)}</span>`}</td>
    <td data-col="due" data-label="${esc(COPY.list.cols.due)}">${deadlineCell(r, ctx.asOf, ctx.state)}</td>
    <td data-col="rev" data-label="${esc(COPY.list.cols.rev)}">${reviewers}</td>
    <td data-col="flags" data-label="${esc(COPY.list.cols.flags)}"><span class="flags">${flagList || `<span class="muted">${esc(COPY.missing)}</span>`}</span></td>
  </tr>`;
}

function groupHeader(g, summary, expanded, ctx) {
  const label = valueLabel(g.key, g.value);
  const waitList = Object.entries(summary.wait).map(([k, n]) => `${COPY.waiting.values[k]} ${n}`).join(', ');
  const waits = waitList ? COPY.grouping.waitingOn(waitList) : '';
  const bits = [
    COPY.grouping.count(summary.count),
    waits,
    COPY.grouping.m1(summary.m1.median == null ? COPY.missing : days1(summary.m1.median), summary.m1.n),
    COPY.grouping.m2(summary.m2.median == null ? COPY.missing : days1(summary.m2.median), summary.m2.n),
  ];
  if (summary.m3) { bits.splice(1, 0, COPY.grouping.assigned(summary.assigned)); bits.push(COPY.grouping.m3(summary.m3.median == null ? COPY.missing : days1(summary.m3.median), summary.m3.n)); }
  if (summary.openSub) bits.push(COPY.grouping.openOnSubmitter(summary.openSub, days1(summary.longestSub)));
  if (summary.openRev) bits.push(COPY.grouping.openOnReviewer(summary.openRev, days1(summary.longestRev)));
  if (summary.waived) bits.push(COPY.grouping.waived(summary.waived));
  if (summary.missed) bits.push(COPY.grouping.missed(summary.missed));
  if (summary.stuck) bits.push(COPY.grouping.stuck(summary.stuck));
  const id = `g-${g.path.replace(/[^\w-]/g, '_')}`;
  return `<tr class="group-row" data-depth="${g.depth}"><th colspan="${COLS.length}" scope="colgroup">
    <button type="button" class="group-btn" id="${esc(id)}" data-group="${esc(g.path)}" aria-expanded="${expanded}">
      ${icon(expanded ? 'chevDown' : 'chevRight', 'chev')}<span class="group-key micro">${esc(COPY.grouping.keys[g.key])}</span>
      <span class="group-name">${esc(label)}</span><span class="count-pill">${g.rows.length}</span>
      <span class="group-sum meta">${bits.filter(Boolean).map(esc).join(' · ')}</span>
    </button></th></tr>`;
}

export function renderList(rows, allRowsCount, state, ctx) {
  const sortKey = state.sort.replace(/^-/, '');
  const desc = state.sort.startsWith('-');
  const head = COLS.map((c) => {
    const sk = SORTABLE[c];
    if (!sk) return `<th scope="col" data-col="${c}">${esc(COPY.list.cols[c])}</th>`;
    const on = sortKey === sk;
    return `<th scope="col" data-col="${c}" aria-sort="${on ? (desc ? 'descending' : 'ascending') : 'none'}"><button type="button" class="th-sort" data-sort="${sk}">${esc(COPY.list.cols[c])}${on ? icon(desc ? 'down' : 'up', 'sort-ic') : ''}</button></th>`;
  }).join('');

  let body = '';
  if (!rows.length) {
    body = `<tr><td colspan="${COLS.length}" class="empty">${esc(ctx.emptyText || COPY.list.empty)} <button type="button" class="btn-link" data-action="clear-all">${esc(COPY.list.emptyAction)}</button></td></tr>`;
  } else if (!state.group.length) {
    body = rows.map((r) => rowHtml(r, { ...ctx, depth: 0 })).join('');
  } else {
    const summaryOf = (g) => {
      if (!g.summary) {
        const reviewer = g.key === 'rev' && g.value && g.value !== UNASSIGNED ? g.value : null;
        g.summary = summarizeGroup(g.rows, ctx.derived, state.period, reviewer);
      }
      return g.summary;
    };
    const tree = groupRows(rows, state.group, state.gsort, valueLabel, (k, g) => summaryOf(g)[k].median);
    const walk = (groups) => groups.map((g) => {
      const expanded = ctx.isExpanded(g);
      const summary = summaryOf(g);
      let html = groupHeader(g, summary, expanded, ctx);
      if (expanded) html += g.children ? walk(g.children) : g.rows.map((r) => rowHtml(r, { ...ctx, depth: g.depth + 1, groupKeys: state.group })).join('');
      return html;
    }).join('');
    body = walk(tree);
  }
  return `<div class="list-head">
      <h2 id="list-h" class="micro">${esc(COPY.list.heading)}</h2>
      <span class="meta">${esc(COPY.list.showing(rows.length, allRowsCount))}</span>
    </div>
    <div class="table-wrap"><table class="data" aria-labelledby="list-h"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
    ${ctx.footer || ''}`;
}

export { MULTI_KEYS };
