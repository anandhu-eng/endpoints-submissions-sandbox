// Wiring: load the snapshot, keep state in the URL, render, handle input.

import { COPY } from './copy.js';
import { deriveAll, computeMetrics, DEFAULT_STAGES, STAGES, TERMINAL } from './derive.js';
import {
  emptyState, domains, parseUrl, toQuery, rowMatches, sortRows, stageSet, SET_KEYS, UNASSIGNED,
} from './query.js';
import { esc, setTimeZone, dateTimeText, isoText } from './format.js';
import { icon } from './icons.js';
import { setPeople, personName } from './ui.js';
import {
  renderMetrics, renderStageCounts, renderFilters, renderChips, renderGroupBar, renderGroupTools, renderList,
} from './render-list.js';
import { renderDetail, renderTimeline, renderConversation } from './render-detail.js';
import { computeProgram, renderProgram } from './program.js';

// Every import linked. index.html shows a load-error note if this never runs.
window.reviewStatusReady = true;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let D = null;          // deriveAll() result
let DOM = null;        // allowed filter values
let state = emptyState();
let ignoredNote = [];
const PROGRAM_KEY = 'reviewStatus.programFirst';
function readProgramFirst() { try { return localStorage.getItem(PROGRAM_KEY) !== '0'; } catch (e) { return true; } }
const ui = {
  showMore: false, closedOpen: false, overview: null, openSections: new Set(['review']), groupOpen: new Map(), groupDefault: null,
  detail: { types: new Set(['state', 'commit', 'comment', 'review', 'label', 'check', 'assign', 'db']), newest: false, collapsed: new Set(), tab: 'pr', showConvo: false },
  dismissed: new Set(),
  programFirst: readProgramFirst(), programBy: 'month', programByOrg: false,
};

// ---------------------------------------------------------------------------
// Theme (same cookie name as the results visualizer)

function applyTheme(t) {
  document.documentElement.classList.toggle('dark', t === 'dark');
  document.documentElement.dataset.theme = t;
  const b = $('#theme-toggle');
  if (b) { b.innerHTML = icon(t === 'dark' ? 'sun' : 'moon'); b.setAttribute('aria-pressed', String(t === 'dark')); }
}
function currentTheme() { return document.documentElement.classList.contains('dark') ? 'dark' : 'light'; }

// ---------------------------------------------------------------------------
// Static text from copy.js

function fillStaticText() {
  document.title = COPY.app.title;
  for (const el of $$('[data-copy]')) {
    const v = el.dataset.copy.split('.').reduce((o, k) => (o ? o[k] : undefined), COPY);
    if (typeof v === 'string') el.textContent = v;
  }
  for (const el of $$('[data-copy-attr]')) {
    const [attr, path] = el.dataset.copyAttr.split(':');
    const v = path.split('.').reduce((o, k) => (o ? o[k] : undefined), COPY);
    if (typeof v === 'string') el.setAttribute(attr, v);
  }
  $('#results-link').href = COPY.app.resultsUrl;
}

// ---------------------------------------------------------------------------
// Load

async function load() {
  fillStaticText();
  applyTheme(currentTheme());
  const status = $('#load-status');
  status.textContent = COPY.app.loading;
  let snap;
  try {
    const res = await fetch('data/snapshot.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    snap = await res.json();
  } catch (e) {
    status.textContent = COPY.app.loadError(e.message);
    status.classList.add('error');
    return;
  }
  status.textContent = '';
  setTimeZone(snap.calendar?.timezone);
  D = deriveAll(snap);
  D.snapshot = snap;
  D.program = computeProgram(snap);
  setPeople(D.people);
  DOM = domains(D.rows);
  const asOfText = dateTimeText(snap.as_of);
  const asOfEl = $('#as-of');
  asOfEl.innerHTML = `<time datetime="${esc(isoText(snap.as_of))}" title="${esc(isoText(snap.as_of))}">${esc(COPY.app.dataAsOf(asOfText))}</time>`;
  if (snap.source?.repo) {
    const a = $('#source-link');
    a.href = snap.source.url || `https://github.com/${snap.source.repo}`;
    a.title = COPY.githubTitle;
    a.hidden = false;
  }
  readUrl();
  bind();
  render();
}

function readUrl() {
  const parsed = parseUrl(location.search, DOM, D.rows);
  state = parsed.state;
  ignoredNote = parsed.ignored;
  ui.detail.node = state.node || '';
}

// ---------------------------------------------------------------------------
// URL

function writeUrl(push = false) {
  const q = toQuery(state);
  const url = q || location.pathname;
  if (push) history.pushState(null, '', url); else history.replaceState(null, '', url);
}
function hrefFor(r) { return toQuery({ ...state, id: r.shortId, node: '' }) || '?'; }
function hrefForId(shortId) { return toQuery({ ...state, id: shortId, node: '' }) || '?'; }

// No viewer identity: the page is for chairs, PGMs and the infra team, and has no View as.
// The renderers still accept a viewer so per-person views can return in a later phase.
function viewInfo() {
  return { view: { role: '', login: '' }, youName: null, myWaits: () => new Set() };
}
const isNarrow = () => window.matchMedia('(max-width: 760px)').matches;
// D16: Overview and stage counts start collapsed on phones.
function overviewOpen() {
  if (ui.overview != null) return ui.overview;
  return !isNarrow();
}

// S10: how many rows each Waiting-on and Queue option would show with the other filters kept.
function optionCounts() {
  const out = { wait: {}, queue: {} };
  for (const key of ['wait', 'queue']) {
    const s = { ...state, [key]: new Set() };
    const rows = D.rows.filter((r) => rowMatches(r, s));
    for (const v of DOM[key]) out[key][v] = rows.filter((r) => rowMatches(r, { ...s, [key]: new Set([v]) })).length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rows

function visibleRows() { return sortRows(D.rows.filter((r) => rowMatches(r, state)), state.sort); }
function metricRows() {
  const rows = D.rows.filter((r) => !r.isTest && rowMatches(r, { ...state, test: false }));
  const noStage = D.rows.filter((r) => !r.isTest && rowMatches(r, { ...state, test: false }, { ignoreStage: true }));
  return { rows, noStage };
}

// ---------------------------------------------------------------------------
// Render

function keepFocus(fn) {
  const a = document.activeElement;
  const id = a && a.id;
  const sb = $('#filters');
  const scroll = sb ? sb.scrollTop : 0;
  fn();
  if (sb) sb.scrollTop = scroll;
  if (id) { const el = document.getElementById(id); if (el && el !== document.activeElement) el.focus({ preventScroll: true }); }
}

function renderNotes() {
  const notes = [];
  if (ignoredNote.length && !ui.dismissed.has('url')) notes.push(['url', COPY.urlNote(ignoredNote)]);
  const w = D.snapshot.warnings || [];
  let html = notes.map(([k, t]) => `<div class="note" role="status">${icon('info')}<span>${esc(t)}</span><button type="button" class="icon-btn xs" data-dismiss="${k}" aria-label="${esc(COPY.dismiss)}">${icon('close')}</button></div>`).join('');
  if (w.length && !ui.dismissed.has('warn')) html += `<details class="note warnings"><summary>${icon('alert')}${esc(COPY.warningsTitle(w.length))}</summary><ul>${w.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>`;
  $('#notes').innerHTML = html;
}

function render() {
  renderNotes();
  const detailRow = state.id ? D.rows.find((r) => r.shortId === state.id) : null;
  document.body.classList.toggle('in-detail', !!detailRow);
  $('#list-view').hidden = !!detailRow;
  $('#detail-view').hidden = !detailRow;
  if (detailRow) renderDetailView(detailRow); else { delete $('#detail-view').dataset.id; renderListView(); }
  writeUrl();
}

function renderListView() {
  keepFocus(() => {
    const { rows: mRows, noStage } = metricRows();
    const metrics = computeMetrics(mRows, noStage, D.ctx, state.period);
    const ov = overviewOpen();
    const program = ov ? renderProgram(D.program, ui) : '';
    $('#program-top').innerHTML = ui.programFirst ? program : '';
    $('#program-bottom').innerHTML = ui.programFirst ? '' : program;
    $('#metrics').innerHTML = (ov ? renderMetrics(metrics, state, ui.showMore) : '') +
      `<div class="overview-toggle${ov ? '' : ' collapsed'}">${ov ? '' : `<span class="meta">${esc(COPY.metrics.overviewHidden)}</span>`}<button type="button" class="btn-link" id="toggle-overview" aria-expanded="${ov}">${esc(ov ? COPY.metrics.hideOverview : COPY.metrics.showOverview)}</button></div>`;
    $('#stages').innerHTML = ov ? renderStageCounts(metrics.M7) : '';
    $('#filters-body').innerHTML = renderFilters(state, DOM, ui.openSections, { counts: optionCounts(), stageCounts: metrics.M7 });
    for (const el of $$('[data-indeterminate="true"]')) el.indeterminate = true;
    $('#groupbar').innerHTML = renderGroupBar(state);
    $('#chips').innerHTML = renderChips(state);
    const n = activeFilterCount();
    $('#filters-count').textContent = n ? String(n) : '';
    const rows = visibleRows();
    const scope = D.rows.filter((r) => state.test || !r.isTest).length;
    // Search matches hidden by the stage filter
    let hint = '';
    if (state.q) {
      const hidden = D.rows.filter((r) => rowMatches(r, state, { ignoreStage: true })).length - rows.length;
      if (hidden > 0) hint = `<p class="note">${icon('info')}<span>${esc(COPY.filters.hiddenBySearch(hidden))}</span></p>`;
    }
    $('#search-note').innerHTML = hint;
    // D19 / D10: say what the scope hides, with a one-click way back.
    const live = (s) => D.rows.filter((r) => rowMatches(r, s)).length;
    const foot = [];
    if (state.queue.size) {
      const n = live({ ...state, queue: new Set() }) - rows.length;
      if (n > 0) foot.push(`<p class="note">${icon('info')}<span>${esc(COPY.list.hiddenQueue(n))}</span></p>`);
    }
    $('#list').innerHTML = renderList(rows, scope, state, {
      hrefFor, hrefForId, isExpanded, derived: D.ctx, asOf: D.asOf, state, ...viewInfo(), footer: foot.join(''), groupTools: renderGroupTools(state),
    });
    const search = $('#search');
    if (document.activeElement !== search) search.value = state.q;
  });
}

function isExpanded(g) {
  if (ui.groupOpen.has(g.path)) return ui.groupOpen.get(g.path);
  if (ui.groupDefault === 'all') return true;
  if (ui.groupDefault === 'none') return false;
  return g.depth === 0;
}

function activeFilterCount() {
  let n = 0;
  for (const k of SET_KEYS) n += state[k].size;
  if (state.stage) n++;
  if (state.nofind) n++;
  if (state.from) n++;
  if (state.to) n++;
  if (state.test) n++;
  return n;
}

function hrefNode(r, n) { return toQuery({ ...state, id: r.shortId, node: String(n) }) || '?'; }
function detailCtx() { return { asOf: D.asOf, derived: D, hrefForId, hrefNode, ...viewInfo() }; }

function renderDetailView(r) {
  const opening = $('#detail-view').dataset.id !== r.shortId;
  $('#detail-view').dataset.id = r.shortId;
  if (opening) {
    ui.detail.collapsed = new Set(); ui.detail.showConvo = !!state.node;
    // D14: on phones the Issues tab comes first when a finding is still open.
    ui.detail.tab = r.findings.some((f) => !f.closed || f.openTurn) ? 'issues' : 'pr';
  }
  ui.detail.node = state.node || '';
  keepFocus(() => {
    $('#detail-view').innerHTML = renderDetail(r, detailCtx(), ui.detail);
  });
  if (opening) {
    const h = $('.detail-title'); h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); window.scrollTo(0, 0);
    // A link to a finding on a narrow screen: show its conversation, not the top of the page.
    if (state.node && tabsNarrow.matches) { const c = $('#convo'); if (c) c.scrollIntoView({ block: 'start' }); }
    else if (state.node) convoIntoView();
  }
  pinPanels();
}

// ---------------------------------------------------------------------------
// Events

function update(fn, { push = false } = {}) {
  fn();
  if (push) writeUrl(true);
  render();
}

function clearFilters() {
  const keep = { group: state.group, gsort: state.gsort, sort: state.sort, period: state.period };
  state = { ...emptyState(), ...keep };
}

function setStages(set) {
  const def = new Set(DEFAULT_STAGES);
  state.stage = set.size === def.size && [...set].every((c) => def.has(c)) ? null : set;
}

// Every change of submission starts without a pushed finding entry (see selectNode).
function openDetail(shortId) {
  state.id = shortId; state.node = ''; ui.detail.pushedNode = false;
  writeUrl(true);
  render();
}
function closeDetail() {
  const id = state.id;
  state.id = ''; state.node = ''; ui.detail.pushedNode = false;
  writeUrl(true);
  render();
  const link = document.querySelector(`[data-open="${CSS.escape(id)}"]`);
  if (link) link.focus();
}
function step(delta) {
  const rows = visibleRows();
  const i = rows.findIndex((r) => r.shortId === state.id);
  const next = rows[i + delta];
  if (next) { state.id = next.shortId; state.node = ''; ui.detail.pushedNode = false; writeUrl(true); render(); }
}

function bind() {
  // Header
  $('#theme-toggle').addEventListener('click', () => {
    const t = currentTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(t);
    try { document.cookie = `theme=${t}; path=/; max-age=31536000; SameSite=Lax`; } catch { /* ignore */ }
  });
  // D26: on phones the header links sit behind a menu button.
  const menuBtn = $('#menu-toggle');
  menuBtn.addEventListener('click', () => {
    const open = menuBtn.getAttribute('aria-expanded') !== 'true';
    menuBtn.setAttribute('aria-expanded', String(open));
    $('#hdr-links').classList.toggle('open', open);
  });

  // Search
  let t = null;
  const search = $('#search');
  search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { state.q = search.value.trim(); render(); }, 150); });
  $('#search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(t);
    state.q = search.value.trim();
    render();
    const first = $('#list .sub-link');
    if (first) first.focus();
  });

  // The list toolbar is sticky below 1024px and its height varies; CSS uses it as scroll padding
  // so focus and jumps land below it.
  const toolbar = $('.toolbar');
  if (toolbar && 'ResizeObserver' in window) {
    new ResizeObserver(() => document.documentElement.style.setProperty('--toolbar-h', `${Math.ceil(toolbar.getBoundingClientRect().height)}px`)).observe(toolbar);
  }

  // Capture also sees scrolls inside the panels, e.g. keyboard focus scrolling a panel not yet pinned.
  document.addEventListener('scroll', pinPanels, { capture: true, passive: true });
  window.addEventListener('resize', pinPanels);
  if ('ResizeObserver' in window) new ResizeObserver(pinPanels).observe($('#main'));

  // Filters: a drawer below 1024px; beside the list from 1024px, where « or the Filters
  // button hides it. The hidden choice is remembered in this browser.
  const drawer = $('#filters');
  const narrow = window.matchMedia('(max-width: 1023px)');
  const HIDDEN_KEY = 'reviewStatus.filtersHidden';
  const syncFiltersButton = () => $('#open-filters').setAttribute('aria-expanded',
    String(narrow.matches ? drawer.classList.contains('open') : !document.body.classList.contains('filters-hidden')));
  const openDrawer = (open) => {
    drawer.classList.toggle('open', open);
    $('#backdrop').hidden = !open;
    syncFiltersButton();
    if (open) { const b = $('#close-filters'); if (b) b.focus(); } else $('#open-filters').focus();
  };
  const showSidebar = (show) => {
    document.body.classList.toggle('filters-hidden', !show);
    try { localStorage.setItem(HIDDEN_KEY, show ? '0' : '1'); } catch (e) { /* storage blocked: not remembered */ }
    syncFiltersButton();
  };
  // index.html applies the stored choice before first paint.
  syncFiltersButton();
  // Widening past 1024px with the drawer open: close it, so its backdrop does not cover the page.
  narrow.addEventListener('change', () => {
    if (!narrow.matches && drawer.classList.contains('open')) { drawer.classList.remove('open'); $('#backdrop').hidden = true; }
    syncFiltersButton();
  });
  $('#open-filters').addEventListener('click', () => {
    if (narrow.matches) openDrawer(!drawer.classList.contains('open'));
    else showSidebar(document.body.classList.contains('filters-hidden'));
  });
  $('#backdrop').addEventListener('click', () => openDrawer(false));

  drawer.addEventListener('click', (e) => {
    if (e.target.closest('#close-filters')) openDrawer(false);
    if (e.target.closest('#hide-filters')) { showSidebar(false); $('#open-filters').focus(); }
    if (e.target.closest('#clear-all')) update(clearFilters);
  });
  $('#list-view').addEventListener('toggle', (e) => {
    if (e.target.id === 'program-by-org') ui.programByOrg = e.target.open;
  }, true);
  drawer.addEventListener('toggle', (e) => {
    const d = e.target;
    if (d.matches && d.matches('details.fsection')) { const id = d.id.replace('fs-', ''); d.open ? ui.openSections.add(id) : ui.openSections.delete(id); }
  }, true);
  drawer.addEventListener('change', (e) => {
    const el = e.target;
    update(() => {
      if (el.dataset.filter) { const s = state[el.dataset.filter]; el.checked ? s.add(el.value) : s.delete(el.value); }
      else if (el.dataset.status) {
        const set = new Set(stageSet(state));
        for (const s of STAGES.filter((x) => x.status === el.dataset.status)) el.checked ? set.add(s.code) : set.delete(s.code);
        setStages(set);
      } else if (el.dataset.stage) {
        const set = new Set(stageSet(state));
        el.checked ? set.add(el.dataset.stage) : set.delete(el.dataset.stage);
        setStages(set);
      } else if (el.dataset.bool) state[el.dataset.bool] = el.checked;
      else if (el.dataset.date) state[el.dataset.date] = el.value;
      else if (el.id === 'f-n') { const n = parseInt(el.value, 10); if (n >= 1 && n <= 60) state.n = n; }
    });
  });

  // Main list area
  const listView = $('#list-view');
  listView.addEventListener('click', (e) => {
    const tgt = e.target;
    const per = tgt.closest('[data-period]');
    if (per) return update(() => { state.period = per.dataset.period; });
    if (tgt.closest('#more-metrics')) { ui.showMore = !ui.showMore; return render(); }
    const place = tgt.closest('[data-program-place]');
    if (place) {
      ui.programFirst = place.dataset.programPlace === 'first';
      try { localStorage.setItem(PROGRAM_KEY, ui.programFirst ? '1' : '0'); } catch (e) { /* storage blocked: not remembered */ }
      render();
      // The section moved: bring the pressed button back into view.
      return $(`#program-place-${place.dataset.programPlace}`)?.focus();
    }
    const by = tgt.closest('[data-program-by]');
    if (by) { ui.programBy = by.dataset.programBy; return render(); }
    if (tgt.closest('#toggle-overview')) { ui.overview = !overviewOpen(); return render(); }
    if (tgt.closest('#copy-link')) return copyLink();
    const chip = tgt.closest('[data-chip]');
    if (chip) {
      const k = chip.dataset.chip; const v = chip.dataset.value;
      return update(() => {
        if (SET_KEYS.includes(k)) state[k].delete(v);
        else if (k === 'stage') state.stage = null;
        else if (k === 'q') { state.q = ''; $('#search').value = ''; }
        else if (k === 'nofind' || k === 'test') state[k] = false;
        else state[k] = '';
      });
    }
    if (tgt.closest('[data-action="clear-all"]')) return update(clearFilters);
    const gm = tgt.closest('[data-gmove]');
    if (gm) return update(() => { const i = +gm.dataset.gmove; const j = i + +gm.dataset.dir; const g = state.group; [g[i], g[j]] = [g[j], g[i]]; });
    const gr = tgt.closest('[data-gremove]');
    if (gr) return update(() => { state.group.splice(+gr.dataset.gremove, 1); });
    if (tgt.closest('#expand-all')) { ui.groupOpen.clear(); ui.groupDefault = 'all'; return render(); }
    if (tgt.closest('#collapse-all')) { ui.groupOpen.clear(); ui.groupDefault = 'none'; return render(); }
    const gb = tgt.closest('[data-group]');
    if (gb) { ui.groupOpen.set(gb.dataset.group, gb.getAttribute('aria-expanded') !== 'true'); return render(); }
    const ths = tgt.closest('[data-sort]');
    if (ths) return update(() => { const k = ths.dataset.sort; const cur = state.sort.replace(/^-/, ''); state.sort = cur === k ? (state.sort.startsWith('-') ? k : '-' + k) : k; });
    if (tgt.closest('#sort-dir')) return update(() => { state.sort = state.sort.startsWith('-') ? state.sort.slice(1) : '-' + state.sort; });
    const open = tgt.closest('[data-open]');
    if (open && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) { e.preventDefault(); openDetail(open.dataset.open); }
  });
  listView.addEventListener('change', (e) => {
    const el = e.target;
    if (el.id === 'g-add' && el.value) update(() => { state.group.push(el.value); });
    else if (el.id === 'g-sort') update(() => { state.gsort = el.value; });
    else if (el.id === 'sort-key') update(() => { state.sort = (state.sort.startsWith('-') ? '-' : '') + el.value; });
  });
  $('#notes').addEventListener('click', (e) => { const d = e.target.closest('[data-dismiss]'); if (d) { ui.dismissed.add(d.dataset.dismiss); renderNotes(); } });

  // Detail view
  const dv = $('#detail-view');
  dv.addEventListener('click', (e) => {
    const tgt = e.target;
    if (tgt.closest('#back')) return closeDetail();
    if (tgt.closest('#copy-id')) {
      const id = $('#full-id').textContent;
      const done = () => { $('#copy-status').textContent = COPY.detail.copied; };
      try { navigator.clipboard.writeText(id).then(done, done); } catch { done(); }
      return;
    }
    // S1: a finding in "What to do" opens its conversation on this page.
    const goto = tgt.closest('[data-goto-node]');
    if (goto && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      selectTab('issues', false);
      const item = document.querySelector(`#issue-tree [data-node="${CSS.escape(goto.dataset.gotoNode)}"]`);
      if (item) {
        for (let p = item.parentElement.closest('[role="treeitem"]'); p; p = p.parentElement.closest('[role="treeitem"]')) toggleNode(p, true);
        selectNode(item);
        const c = $('#convo'); if (c) c.scrollIntoView({ block: 'start' });
      }
      return;
    }
    const jump = tgt.closest('.turn-link, #jump-turn');
    if (jump) {
      e.preventDefault();
      const band = document.getElementById(jump.getAttribute('href').slice(1));
      if (band) { band.scrollIntoView({ block: 'start' }); band.focus({ preventScroll: true }); }
      return;
    }
    if (tgt.closest('[data-open]') && !e.metaKey && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); return openDetail(tgt.closest('[data-open]').dataset.open); }
    if (tgt.closest('#tl-order')) { ui.detail.newest = !ui.detail.newest; return rerenderTimeline(); }
    const tab = tgt.closest('[role="tab"]');
    if (tab) return selectTab(tab.id === 'tab-issues' ? 'issues' : 'pr', true);
    if (tgt.closest('#back-to-tree')) {
      // Wide screens: the tree sits above the conversation in the same panel; go back up to it.
      if (!tabsNarrow.matches) {
        $('#panel-issues .panel-body').scrollTop = 0;
        const s = $('#issue-tree [aria-selected="true"]') || $('#issue-tree [tabindex="0"]'); if (s) s.focus(); return;
      }
      // Opening a finding on a narrow screen pushed a history entry; going back pops it (popstate re-renders).
      if (ui.detail.pushedNode) { history.back(); return; }
      ui.detail.showConvo = false; $('#panel-issues').dataset.convo = '0';
      state.node = ''; writeUrl();
      const s = $('#issue-tree [aria-selected="true"]'); if (s) s.focus(); return;
    }
    const tw = tgt.closest('[data-twisty]');
    if (tw) return toggleNode(tw.closest('[role="treeitem"]'));
    if (tgt.closest('a')) return;
    const node = tgt.closest('[role="treeitem"]');
    if (node && dv.contains(node)) selectNode(node);
  });
  dv.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.tltype) { el.checked ? ui.detail.types.add(el.dataset.tltype) : ui.detail.types.delete(el.dataset.tltype); rerenderTimeline(); }
  });
  dv.addEventListener('keydown', (e) => {
    const tab = e.target.closest('[role="tab"]');
    if (tab && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { e.preventDefault(); selectTab(tab.id === 'tab-pr' ? 'issues' : 'pr', true); return; }
    const item = e.target.closest('[role="treeitem"]');
    if (item && e.target === item) treeKey(e, item);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer.classList.contains('open')) { openDrawer(false); return; }
    if (!state.id) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (['input', 'select', 'textarea'].includes(tag) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest && e.target.closest('[role="tree"]')) return;
    if (e.key === 'j') step(1);
    else if (e.key === 'k') step(-1);
    else if (e.key === 'Escape') closeDetail();
  });

  window.addEventListener('popstate', () => {
    const fromNode = state.node;
    readUrl(); ui.detail.showConvo = !!state.node; ui.detail.pushedNode = false; render();
    // Back from a finding's conversation: focus that finding in the tree (scroll is already restored).
    if (fromNode && !state.node && state.id) {
      const item = document.querySelector(`#issue-tree [data-node="${CSS.escape(fromNode)}"]`);
      if (item) { for (const x of $$('#issue-tree [role="treeitem"]')) x.tabIndex = -1; item.tabIndex = 0; item.focus({ preventScroll: true }); }
    }
  });
}

// D20: copy the current URL (all state lives in it).
function copyLink() {
  const done = () => { const s = $('#copy-link-status'); if (s) { s.textContent = COPY.app.linkCopied; setTimeout(() => { s.textContent = ''; }, 2500); } };
  try { navigator.clipboard.writeText(location.href).then(done, done); } catch { done(); }
}

function selectTab(tab, focus) {
  ui.detail.tab = tab;
  $('.panels').dataset.tab = tab;
  // With the tab bar stuck mid-panel, start the new panel at its top (scroll-margin clears the bars).
  const bar = $('.panel-tabs-bar');
  if (bar && $('.panels').getBoundingClientRect().top < bar.getBoundingClientRect().bottom) $('.panels').scrollIntoView({ block: 'start' });
  for (const b of $$('.panel-tabs [role="tab"]')) {
    const on = b.id === `tab-${tab}`;
    b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
    if (on && focus) b.focus();
  }
}

function rerenderTimeline() {
  const r = D.rows.find((x) => x.shortId === state.id);
  keepFocus(() => { $('#timeline').innerHTML = renderTimeline(r, detailCtx(), ui.detail); });
  pinPanels();
}

// ---------------------------------------------------------------------------
// Tree keyboard (role=tree, roving tabindex)

function visibleItems() { return $$('#issue-tree [role="treeitem"]').filter((el) => !el.closest('ul[role="group"][hidden]')); }
function focusItem(el) {
  for (const x of $$('#issue-tree [role="treeitem"]')) x.tabIndex = -1;
  el.tabIndex = 0; el.focus();
}
function toggleNode(item, force) {
  if (!item || !item.hasAttribute('aria-expanded')) return;
  const open = force ?? item.getAttribute('aria-expanded') !== 'true';
  item.setAttribute('aria-expanded', String(open));
  const group = item.querySelector(':scope > ul[role="group"]');
  if (group) group.hidden = !open;
  const tw = item.querySelector(':scope > .tnode-row > .twisty');
  if (tw) tw.innerHTML = icon(open ? 'chevDown' : 'chevRight');
  const n = item.dataset.node;
  open ? ui.detail.collapsed.delete(n) : ui.detail.collapsed.add(n);
  pinPanels();
}
const tabsNarrow = window.matchMedia('(max-width: 959px)');
// Detail on wide screens: the panels' contents scroll only once the panels reach the header
// (the page is scrolled to the end; nothing follows the panels). Before that, the wheel scrolls
// the page. A panel left part-way down keeps its scrollbar, so its top stays reachable.
function pinPanels() {
  const p = $('.panels');
  if (!p || !document.body.classList.contains('in-detail')) return;
  const pinned = !tabsNarrow.matches && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
  for (const b of p.querySelectorAll('.panel > .panel-body')) {
    const on = pinned || b.scrollTop > 0;
    b.classList.toggle('scrolls', on);
    b.parentElement.classList.toggle('more-above', on && b.scrollTop > 0);
    // The bottom shadow shows whenever content is cut off, even before the panel can scroll.
    b.parentElement.classList.toggle('more-below', b.scrollTop + b.clientHeight < b.scrollHeight - 1);
    // The conversation heading is stuck at the panel's top: the shadow moves under it and "All findings" shows.
    const hd = b.querySelector('#convo .convo-head');
    b.parentElement.classList.toggle('head-stuck', !!hd && b.scrollTop > 0 && hd.getBoundingClientRect().top <= b.getBoundingClientRect().top + 1);
  }
}
function selectNode(item) {
  const n = item.dataset.node;
  state.node = n; ui.detail.node = n; ui.detail.showConvo = true;
  // Narrow screens replace the tree with the conversation, so the phone's Back gesture should return to the tree.
  const push = tabsNarrow.matches && !ui.detail.pushedNode;
  writeUrl(push);
  if (push) ui.detail.pushedNode = true;
  for (const x of $$('#issue-tree [role="treeitem"]')) {
    const on = x === item;
    x.setAttribute('aria-selected', String(on)); x.classList.toggle('selected', on);
  }
  focusItem(item);
  const r = D.rows.find((x) => x.shortId === state.id);
  $('#convo').innerHTML = renderConversation(r, ui.detail, detailCtx());
  $('#panel-issues').dataset.convo = '1';
  if (tabsNarrow.matches) {
    const h = $('#convo .convo-head h3'); if (h) h.focus({ preventScroll: true });
    $('#convo').scrollIntoView({ block: 'start' });
  } else if (convoIntoView()) {
    // The tree item scrolled away, so focus follows the conversation, as on narrow screens.
    const h = $('#convo .convo-head h3'); if (h) h.focus({ preventScroll: true });
  }
  pinPanels();
}
// Wide screens: the conversation sits under the tree. If its heading is out of sight, or too near
// the bottom to show any of the conversation, bring it to the panel's top. True if it scrolled.
// The heading sticks to the panel's top, so the conversation's own top is what is checked.
function convoIntoView() {
  const head = $('#convo .convo-head'), body = $('#panel-issues .panel-body');
  if (!head || !body) return false;
  const c = $('#convo').getBoundingClientRect(), b = body.getBoundingClientRect();
  if (c.top >= b.top && c.top <= Math.min(b.bottom, window.innerHeight) - 120) return false;
  head.scrollIntoView({ block: 'start' });
  return true;
}
function treeKey(e, item) {
  const items = visibleItems();
  const i = items.indexOf(item);
  const expandable = item.hasAttribute('aria-expanded');
  const expanded = item.getAttribute('aria-expanded') === 'true';
  switch (e.key) {
    case 'ArrowDown': if (items[i + 1]) focusItem(items[i + 1]); break;
    case 'ArrowUp': if (items[i - 1]) focusItem(items[i - 1]); break;
    case 'Home': focusItem(items[0]); break;
    case 'End': focusItem(items[items.length - 1]); break;
    case 'ArrowRight':
      if (expandable && !expanded) toggleNode(item, true);
      else if (expandable) { const c = item.querySelector(':scope > ul > [role="treeitem"]'); if (c) focusItem(c); }
      break;
    case 'ArrowLeft':
      if (expandable && expanded) toggleNode(item, false);
      else { const p = item.parentElement.closest('[role="treeitem"]'); if (p) focusItem(p); }
      break;
    case 'Enter': case ' ': selectNode(item); break;
    default: return;
  }
  e.preventDefault();
}

load();

export { personName, UNASSIGNED };
