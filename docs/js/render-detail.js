// Detail view (REQUIREMENTS section 6): header, PR timeline, issue tree and conversation.

import { COPY } from './copy.js';
import { esc, days1, timeEl, markdown, dateText, excerpt } from './format.js';
import { icon } from './icons.js';
import { ms } from './derive.js';
import { stagePill, waitChip, waitReasonText, flagBadge, personHtml, personName, roleBadge, turnBadge, extLink, person } from './ui.js';
import { reasonText, reviewDayText } from './render-list.js';

const TL_TYPES = ['state', 'commit', 'comment', 'review', 'label', 'check', 'assign', 'db'];

function card(title, inner, cls = '') {
  return `<section class="card ${cls}"><h3 class="card-title">${esc(title)}</h3><div class="card-body">${inner}</div></section>`;
}
function kv(rows) {
  return `<dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;
}
const dash = () => `<span class="muted">${esc(COPY.missing)}</span>`;

// ---------------------------------------------------------------------------
// Header

// D12: one entry per open turn the viewer can act on.
function todoItems(r, ctx) {
  const T = COPY.detail.todo;
  const role = ctx.view?.role || '';
  const login = ctx.view?.login || '';
  let fs = r.findings.filter((f) => f.openTurn && ['submitter', 'waived', 'reviewer'].includes(f.turnState));
  if (role === 'submitter') fs = fs.filter((f) => f.turnState !== 'reviewer');
  else if (role === 'reviewer') fs = fs.filter((f) => f.turnState === 'reviewer' && (!login || f.author === login || ctx.myWaits(r).has('reviewer')));
  return fs.map((f) => {
    const t = f.openTurn;
    const ask = f.latestAsk;
    const askHtml = ask ? `<p class="todo-ask"><span class="meta">${esc(T.ask(personName(ask.actor), dateText(ask.at)))}</span> <q>${esc(excerpt(ask.body))}</q> ${extLink(ask.url, COPY.detail.timeline.view, 'ev-link')}</p>` : '';
    let due = ''; let miss = ''; let how = '';
    if (f.turnState === 'waived') {
      due = `<p>${esc(T.waived)}</p>`;
      how = T.howSubmitter;
    } else if (f.turnState === 'submitter') {
      due = `<p class="todo-due">${t.nextLevelAt ? `${esc(T.dueSubmitter(t.nextLevel))}${timeEl(t.nextLevelAt)} <span class="meta">(${esc(T.dueSubmitterNote)})</span>` : esc(T.dueMax)}${f.replyOverdue ? ` <span class="nbadge" title="${esc(COPY.detail.tree.badgeHelp.replyOverdue)}">${icon('alert')}${esc(COPY.detail.tree.badges.replyOverdue)}</span>` : ''}</p>`;
      miss = T.missSubmitter; how = T.howSubmitter;
    } else {
      const wk6First = r.clock.wk6Close && r.clock.wk6Close > ctx.asOf && r.clock.wk6Close < t.deadline;
      due = `<p class="todo-due">${esc(T.dueReviewer)}${timeEl(t.deadline)}${t.overdue ? ` <span class="nbadge" title="${esc(COPY.detail.tree.badgeHelp.replyOverdue)}">${icon('alert')}${esc(COPY.detail.tree.badges.replyOverdue)}</span>` : ''}${wk6First ? `<span class="meta block">${esc(T.wk6First)}${timeEl(r.clock.wk6Close)}</span>` : ''}</p>`;
      miss = T.missReviewer; how = T.howReviewer;
    }
    return `<li class="todo">
      <div class="todo-head">${turnBadge(f.turnState)} ${extLink(f.url, '#' + f.number)} <span class="meta">${esc(f.title)}</span></div>
      ${askHtml}${due}${miss ? `<p class="meta">${esc(miss)}</p>` : ''}<p class="todo-how">${esc(how)}</p></li>`;
  });
}

function header(r, ctx) {
  const F = COPY.detail.fields;
  const c = r.clock;
  const mine = ctx.myWaits(r);
  const summary = kv([
    [F.org, esc(r.org || COPY.missing)],
    [F.submitter, personHtml(r.submitter)],
    [F.models, esc(r.models.join(', ') || COPY.missing)],
    [F.type, esc(COPY.types[r.type] || r.type)],
    [F.division, esc(COPY.divisions[r.division] || r.division || COPY.missing)],
    [F.availability, esc(COPY.availability[r.availability] || r.availability || COPY.missing)],
    [F.reviewers, r.assignees.length ? r.assignees.map(personHtml).join(', ') : esc(COPY.filters.unassigned)],
    [F.penalty, esc(r.penalty)],
    [F.longestWait, r.longestSubmitterWait != null ? `${esc(days1(r.longestSubmitterWait))} ${esc(COPY.metrics.days)}` : dash()],
  ]);
  const clock = c.startMs == null ? `<p class="muted">${esc(COPY.detail.clock.notStarted)}</p>` : kv([
    [COPY.detail.clock.day, c.reviewDay != null ? esc(reviewDayText(r)) : dash()],
    [COPY.detail.clock.start, timeEl(c.startMs, { dateOnly: true })],
    [COPY.detail.clock.wk3, timeEl(c.wk3Close)],
    [COPY.detail.clock.wk6, timeEl(c.wk6Close)],
  ]);
  const waiting = `<ul class="wait-list">${r.waiting.map((w) => `<li>${waitChip(w.value, mine.has(w.value) ? ctx.youName : null)}<ul>${w.reason.map((x) => `<li>${esc(waitReasonText(x))}</li>`).join('')}</ul></li>`).join('')}</ul>`;
  const ts = kv(Object.entries(COPY.detail.timestamps).map(([k, label]) => [label, r.db[k] ? timeEl(r.db[k]) : dash()]));
  const todos = todoItems(r, ctx);
  const todo = todos.length ? `<ul class="todo-list">${todos.join('')}</ul>` : `<p class="muted">${esc(COPY.detail.todo.none)}</p>`;

  let publication = '';
  if (r.status === 'FINALIZED') {
    const d = r.due;
    // D25: the date first; if delayed, the date it would have had.
    const when = d?.rdi ? esc(COPY.list.notAutoPublished) : d?.cohort ? `${timeEl(d.at, { dateOnly: true })} <span class="db-status">${esc(d.cohort.id)}</span>` : dash();
    const delay = d?.delayed && d.baseAt ? `${esc(COPY.detail.wouldHaveBeen(dateText(d.baseAt), d.shift))} ${esc(d.reasons.map(reasonText).join('; '))}` : d?.reasons?.length ? esc(d.reasons.map(reasonText).join('; ')) : esc(COPY.detail.noDelay);
    publication = card(COPY.detail.cards.publication, kv([[COPY.detail.dueCohort, when], [COPY.detail.delay, delay]]), 'card-pub');
  }

  // S4: findings waiting on the submitter
  const subF = r.findings.filter((f) => f.turnState === 'submitter');
  const respond = card(COPY.detail.cards.respond, subF.length ? `<table class="mini"><thead><tr>
      <th scope="col">${esc(COPY.detail.respondCols.finding)}</th><th scope="col">${esc(COPY.detail.respondCols.waited)}</th><th scope="col">${esc(COPY.detail.respondCols.next)}</th></tr></thead><tbody>
      ${subF.map((f) => `<tr><td>${extLink(f.url, '#' + f.number)} <span class="meta">${esc(f.title)}</span></td>
        <td class="num">${f.openSubmitter ? esc(days1(f.openSubmitter.labelDays)) : dash()}</td>
        <td>${f.openSubmitter?.nextLevelAt ? `${esc(COPY.detail.respondNext(f.openSubmitter.nextLevel, ''))}${timeEl(f.openSubmitter.nextLevelAt)}` : esc(COPY.detail.respondMax)}</td></tr>`).join('')}
      </tbody></table>` : `<p class="muted">${esc(COPY.detail.respondNone)}</p>`);

  // R2: findings waiting on their objector
  const revF = r.findings.filter((f) => f.turnState === 'reviewer');
  const respondRev = revF.length ? card(COPY.detail.cards.respondReviewer, `<table class="mini"><thead><tr>
      <th scope="col">${esc(COPY.detail.respondCols.finding)}</th><th scope="col">${esc(COPY.detail.respondCols.author)}</th><th scope="col">${esc(COPY.detail.respondCols.waited)}</th><th scope="col">${esc(COPY.detail.respondCols.deadline)}</th></tr></thead><tbody>
      ${revF.map((f) => `<tr><td>${extLink(f.url, '#' + f.number)} <span class="meta">${esc(f.title)}</span></td><td>${personHtml(f.author)}</td>
        <td class="num">${f.openReviewer ? esc(days1(f.openReviewer.labelDays)) : dash()}</td>
        <td>${f.openReviewer ? `${f.openReviewer.overdue ? `<span class="warn-text">${icon('alert')}${esc(COPY.detail.tree.badges.replyOverdue)}</span> ` : ''}${timeEl(f.openReviewer.deadline)}` : dash()}</td></tr>`).join('')}
      </tbody></table>`) : '';

  const links = [r.pr ? extLink(r.pr.url, COPY.detail.links.pr(r.pr.number), 'btn-quiet') : '', r.ti ? extLink(r.ti.url, COPY.detail.links.issue(r.ti.number), 'btn-quiet') : ''].join('');
  const sup = [
    r.supersedes ? `<a class="flag flag-supersedes" href="${esc(ctx.hrefForId(r.supersedes))}" data-open="${esc(r.supersedes)}" title="${esc(COPY.flagHelp.supersedes)}">${icon('arrow')}${esc(COPY.detail.supersedes(r.supersedes))}</a>` : '',
    r.supersededBy ? `<a class="flag flag-superseded_by" href="${esc(ctx.hrefForId(r.supersededBy))}" data-open="${esc(r.supersededBy)}" title="${esc(COPY.flagHelp.superseded_by)}">${icon('slash')}${esc(COPY.detail.supersededBy(r.supersededBy))}</a>` : '',
  ].join('');
  const flagHtml = [...r.flags].filter((f) => f !== 'supersedes' && f !== 'superseded_by').map(flagBadge).join('') + sup;

  return `
  <div class="detail-top">
    <button type="button" class="btn-back" id="back">${icon('chevLeft')}${esc(COPY.detail.back)}</button>
    <span class="meta kbd-hint">${esc(COPY.detail.prevNext)} <kbd>k</kbd> / <kbd>j</kbd></span>
  </div>
  <header class="detail-head">
    <div class="detail-head-row">
      <h2 class="detail-title"><span class="mono">${esc(r.shortId)}</span> <span class="sep">·</span> ${esc(r.org || COPY.missing)}</h2>
      <div class="detail-links">${links}</div>
    </div>
    <div class="status-strip">${stagePill(r.stage, { size: 'md' })}<span class="flags">${flagHtml}</span></div>
  </header>
  <div class="top-band${publication ? ' with-pub' : ''}">
    ${card(COPY.detail.cards.waiting, waiting, 'card-wait')}
    ${card(COPY.detail.whatToDo, todo, 'card-todo')}
    ${card(COPY.detail.cards.clock, clock, 'card-clock')}
    ${publication}
  </div>
  <details class="more-details" id="more-details">
    <summary>${icon('chevRight', 'chev')}${esc(COPY.detail.details)}</summary>
    <p class="meta">${esc(COPY.detail.fields.fullId)}: <span class="mono" id="full-id">${esc(r.id)}</span>
      <button type="button" class="icon-btn xs" id="copy-id" aria-label="${esc(COPY.detail.copyId)}" title="${esc(COPY.detail.copyId)}">${icon('copy')}</button><span id="copy-status" role="status" class="meta"></span></p>
    <div class="cards">
      ${card(COPY.detail.cards.summary, summary)}
      ${respond}
      ${respondRev}
      ${card(COPY.detail.cards.timestamps, ts)}
    </div>
  </details>`;
}

// ---------------------------------------------------------------------------
// PR timeline

function markerTags(markers) {
  return (markers || []).filter((m) => m.name !== 'submission-id').map((m) => `<span class="marker" title="${esc(m.name + (m.value ? ': ' + m.value : ''))}">${icon('tag')}${esc(COPY.detail.markers[m.name] || m.name)}</span>`).join('');
}

function isBotLogin(login, ctx) { return ctx.derived.ctx.isBot(login); }

function eventItem(e, r, ctx) {
  const T = COPY.detail.timeline;
  const who = e.actor ? `${personHtml(e.actor)} ${roleBadge(e.actor)}` : '';
  const bot = e.actor && isBotLogin(e.actor, ctx);
  const when = timeEl(e.at);
  const head = (ic, text, extra = '') => `<div class="ev-head">${icon(ic, 'ev-ic')}<span class="ev-text">${who} ${text}</span><span class="ev-time">${when}</span>${extra}</div>`;
  switch (e.kind) {
    case 'state': return `<li class="ev ev-state">${head(e.action === 'closed' ? 'issueClosed' : 'pr', esc(T[e.action] || e.action))}</li>`;
    case 'commit': return `<li class="ev ev-commit condensed">${head('commit', `${esc(T.commit)} ${extLink(e.url, String(e.sha || '').slice(0, 7), 'mono')} <span class="ev-msg">${esc(String(e.message || '').split('\n')[0])}</span>`)}</li>`;
    case 'comment': return `<li class="ev ev-comment${bot ? ' is-bot' : ''}">${head('comment', esc(T.commented), extLink(e.url, T.view, 'ev-link'))}
      ${markerTags(e.markers) ? `<div class="markers">${markerTags(e.markers)}</div>` : ''}<div class="md">${markdown(e.body)}</div></li>`;
    case 'review': return `<li class="ev ev-review">${head('review', `<strong>${esc(T.reviewed(e.state))}</strong>`, extLink(e.url, T.view, 'ev-link'))}${e.body ? `<div class="md">${markdown(e.body)}</div>` : ''}</li>`;
    case 'label': {
      const fin = e.label === 'finalized';
      const chair = fin && e.action === 'added' ? `<span class="fin-note ${person(e.actor)?.role === 'chair' ? 'ok' : 'warn-text'}">${icon(person(e.actor)?.role === 'chair' ? 'tick' : 'alert')}${esc(person(e.actor)?.role === 'chair' ? T.finalizedByChair : T.finalizedByNonChair)}</span>` : '';
      return `<li class="ev ev-label condensed${fin ? ' ev-finalized' : ''}">${head('tag', `${esc(e.action === 'added' ? T.labelAdded : T.labelRemoved)} <span class="label-name">${esc(e.label)}</span> ${chair}`)}</li>`;
    }
    case 'assign': return `<li class="ev ev-assign condensed">${head('assign', esc(e.action === 'assigned' ? T.assigned(personName(e.assignee)) : T.unassigned(personName(e.assignee))))}</li>`;
    case 'check': return `<li class="ev ev-check condensed check-${esc(e.conclusion)}">${head(e.conclusion === 'success' ? 'check' : e.conclusion === 'failure' ? 'x' : 'clock',
      `<span class="check-name">${esc(e.name)}</span> <strong class="check-result">${esc(T.check[e.conclusion] || e.conclusion)}</strong> <span class="meta">${esc(T.onCommit(String(e.sha || '').slice(0, 7)))}</span>`, extLink(e.url, T.view, 'ev-link'))}</li>`;
    case 'db': return `<li class="ev ev-db condensed"><div class="ev-head">${icon('db', 'ev-ic')}<span class="ev-text"><strong>${esc(e.label)}</strong> <span class="from-db">${esc(T.fromDb)}</span></span><span class="ev-time">${when}</span></div></li>`;
    default: return '';
  }
}

function dbMilestones(r, asOf) {
  const M = COPY.detail.timeline.milestones;
  const out = [];
  for (const k of ['created_at', 'compliance_passed_at', 'peer_review_started_at', 'finalized_at', 'first_published_at', 'withdrawn_at']) {
    if (r.db[k]) out.push({ kind: 'db', at: r.db[k], label: M[k] });
  }
  if (r.clock.wk3Close && r.clock.wk3Close <= asOf) out.push({ kind: 'db', at: new Date(r.clock.wk3Close).toISOString(), label: M.wk3 });
  if (r.clock.wk6Close && r.clock.wk6Close <= asOf) out.push({ kind: 'db', at: new Date(r.clock.wk6Close).toISOString(), label: M.wk6 });
  return out;
}

export function renderTimeline(r, ctx, ui) {
  const T = COPY.detail.timeline;
  if (!r.pr) return `<p class="empty">${esc(COPY.detail.noPr)}</p>`;
  let events = [...(r.pr.events || []), ...dbMilestones(r, ctx.asOf)].filter((e) => ui.types.has(e.kind));
  events.sort((a, b) => ms(a.at) - ms(b.at) || (a.kind === 'db' ? -1 : 0));
  if (ui.newest) events.reverse();
  const controls = `<div class="tl-controls">
    <fieldset class="tl-types"><legend class="sr-only">${esc(T.show)}</legend>${TL_TYPES.map((t) => `<label for="tl-${t}"><input type="checkbox" id="tl-${t}" data-tltype="${t}" ${ui.types.has(t) ? 'checked' : ''}><span>${esc(T.types[t])}</span></label>`).join('')}</fieldset>
    <button type="button" class="btn-quiet" id="tl-order" aria-pressed="${ui.newest}">${icon(ui.newest ? 'down' : 'up')}${esc(ui.newest ? T.newestFirst : T.oldestFirst)}</button>
  </div>`;
  return `${controls}${events.length ? `<ol class="timeline" aria-label="${esc(COPY.detail.tabs.pr)}">${events.map((e) => eventItem(e, r, ctx)).join('')}</ol>` : `<p class="empty">${esc(T.empty)}</p>`}`;
}

// ---------------------------------------------------------------------------
// Issue tree

export function treeNodes(r) {
  if (!r.ti) return [];
  const byParent = new Map();
  for (const f of r.findings) {
    const p = f.parent ?? r.ti.number;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(f);
  }
  const root = { number: r.ti.number, isRoot: true, issue: r.ti, children: [] };
  const seen = new Set();
  const attach = (node) => {
    for (const f of (byParent.get(node.number) || []).sort((a, b) => a.number - b.number)) {
      if (seen.has(f.number)) continue;
      seen.add(f.number);
      const child = { number: f.number, finding: f, issue: f.issue, children: [] };
      node.children.push(child);
      attach(child);
    }
  };
  attach(root);
  // Findings whose parent is not in the tree still show under the root.
  for (const f of r.findings) if (!seen.has(f.number)) { seen.add(f.number); root.children.push({ number: f.number, finding: f, issue: f.issue, children: [] }); }
  return [root];
}

function stateText(issue) {
  const D = COPY.detail.tree;
  if (issue.state === 'closed') return issue.state_reason === 'not_planned' ? D.notPlanned : D.closed;
  return D.open;
}

function nodeContent(node, r) {
  const D = COPY.detail.tree;
  const issue = node.issue;
  const closed = issue.state === 'closed';
  const head = `<span class="node-state ${closed ? 'is-closed' : 'is-open'}">${icon(closed ? 'issueClosed' : 'issue')}<span>${esc(stateText(issue))}</span></span>
    <span class="node-num mono">#${esc(issue.number)}</span><span class="node-title">${esc(issue.title)}</span>`;
  if (node.isRoot) {
    const c = r.counts;
    return `${head}<span class="node-meta meta block">${esc(D.assignees)}: ${r.assignees.length ? r.assignees.map((a) => esc(personName(a))).join(', ') : esc(D.noAssignees)} · ${esc(D.childCounts(c))}${c.waived ? ` · ${esc(D.waivedCount(c.waived))}` : ''}</span>`;
  }
  const f = node.finding;
  const meta = [
    f.type ? `<span class="tag-type">${esc(f.type)}</span>` : '',
    f.byOrg ? `<span>${esc(D.by)} ${esc(f.byOrg)}</span>` : '',
    f.againstOrg ? `<span>${esc(D.against)} ${esc(f.againstOrg)}</span>` : '',
    f.currentWait != null ? `<span>${esc(D.wait(days1(f.currentWait)))}</span>` : '',
    f.turns.length ? `<span>${esc(D.longest(days1(f.longest)))}</span>` : '',
    `<span>${esc(f.penaltyStage === 'waived' ? D.penaltyWaived : D.penalty(f.impliedPenalty))}</span>`,
    ...f.waivers.map((w) => `<span class="label-name">${esc(w)}</span>`),
  ].filter(Boolean).join('<span class="dot" aria-hidden="true">·</span>');
  const badges = [
    f.escalated ? [D.badges.escalated, COPY.flagHelp.escalated] : null,
    f.replyOverdue ? [D.badges.replyOverdue, D.badgeHelp.replyOverdue] : null,
    f.openLong ? [D.badges.openLong, D.badgeHelp.openLong] : null,
    f.waivedL1 ? [D.badges.waiverL1, D.badgeHelp.waiverL1] : null,
    f.closedStillLabelled ? [D.badges.closedLabelled, ''] : null,
    f.labelOnlyEnds ? [D.badges.labelOnly, COPY.turns.labelOnlyHelp] : null,
  ].filter(Boolean).map(([b, help]) => `<span class="nbadge" title="${esc(help)}">${icon('alert')}${esc(b)}</span>`).join('');
  return `${head}<span class="node-turn">${turnBadge(f.turnState)}</span><span class="node-meta meta block">${meta}</span>${badges ? `<span class="node-badges block">${badges}</span>` : ''}`;
}

export function renderTree(r, ui) {
  const roots = treeNodes(r);
  if (!roots.length) return `<p class="empty">${esc(COPY.detail.noIssue)}</p>`;
  const selected = ui.node || String(roots[0].number);
  let first = true;
  const item = (node, level) => {
    const has = node.children.length > 0;
    const expanded = has ? !ui.collapsed.has(String(node.number)) : null;
    const sel = String(node.number) === selected;
    const tab = sel ? 0 : -1;
    first = false;
    return `<li role="treeitem" id="node-${node.number}" data-node="${node.number}" aria-level="${level}" aria-selected="${sel}" ${has ? `aria-expanded="${expanded}"` : ''} tabindex="${tab}" class="tnode${sel ? ' selected' : ''}">
      <div class="tnode-row">${has ? `<span class="twisty" data-twisty="${node.number}" aria-hidden="true">${icon(expanded ? 'chevDown' : 'chevRight')}</span>` : '<span class="twisty-space"></span>'}
        <div class="tnode-body">${nodeContent(node, r)}</div>
        ${extLink(node.issue.url, COPY.detail.timeline.view, 'node-link icon-only')}</div>
      ${has ? `<ul role="group" ${expanded ? '' : 'hidden'}>${node.children.map((c) => item(c, level + 1)).join('')}</ul>` : ''}
    </li>`;
  };
  return `<ul role="tree" class="tree" id="issue-tree" aria-label="${esc(COPY.detail.tree.label)}">${roots.map((n) => item(n, 1)).join('')}</ul>`;
}

// ---------------------------------------------------------------------------
// Conversation of the selected node, with turn bands

export function renderConversation(r, ui, ctx) {
  const roots = treeNodes(r);
  if (!roots.length) return '';
  const all = [];
  const walk = (n) => { all.push(n); n.children.forEach(walk); };
  roots.forEach(walk);
  const node = all.find((n) => String(n.number) === String(ui.node)) || roots[0];
  const issue = node.issue;
  const f = node.finding;
  const events = (issue.events || []).filter((e) => e.kind !== 'state' || e.action !== 'opened').slice().sort((a, b) => ms(a.at) - ms(b.at));
  const turns = f ? f.turns : [];
  // D15: a band starts after the handover event and keeps the reply and label swap that end it.
  const turnAt = (t) => turns.find((x) => x.start < t && t <= (x.labelEnd ?? Infinity));

  const segments = [];
  for (const e of events) {
    const t = turnAt(ms(e.at));
    const last = segments[segments.length - 1];
    if (last && last.turn === t) last.items.push(e); else segments.push({ turn: t, items: [e] });
  }
  const T = COPY.turns;
  const current = turns.find((t) => t.open);
  const turnTable = turns.length ? `<div class="turn-table-wrap"><table class="mini turn-table"><caption class="sr-only">${esc(T.tableCaption)}</caption><thead><tr>
      <th scope="col">${esc(T.table.owner)}</th><th scope="col">${esc(T.table.start)}</th><th scope="col">${esc(T.table.end)}</th><th scope="col" class="num">${esc(T.table.days)}</th><th scope="col">${esc(T.table.labelOnly)}</th></tr></thead><tbody>
      ${turns.map((t, i) => `<tr${t === current ? ' class="current"' : ''}><td><a href="#turn-${i}" class="turn-link">${esc(T[t.kind])}</a></td><td>${timeEl(t.start)}</td>
        <td>${t.open ? esc(T.table.open) : t.stopped ? esc(T.stopped) : timeEl(t.labelEnd)}</td><td class="num">${esc(days1(t.labelDays))}</td><td>${esc(t.labelOnly ? T.table.yes : T.table.no)}</td></tr>`).join('')}
      </tbody></table>${current ? `<a class="btn-link" href="#turn-${turns.indexOf(current)}" id="jump-turn">${esc(T.jump)}</a>` : ''}</div>` : '';
  const idDone = new Set();
  const body = segments.map((s) => {
    const items = s.items.map((e) => eventItem(e, r, ctx)).join('');
    if (!s.turn) return `<ol class="timeline">${items}</ol>`;
    const t = s.turn;
    const who = T[t.kind];
    const tags = [
      t.labelOnly ? `<span class="nbadge" title="${esc(T.labelOnlyHelp)}">${esc(T.labelOnly)}</span>` : '',
      t.endedBy === 'reply' ? `<span class="meta">${esc(T.endedByReply(days1(t.responseDays)))}</span>` : '',
      t.missed ? `<span class="nbadge">${esc(T.missed)}</span>` : '',
      t.stopped ? `<span class="meta">${esc(T.stopped)}</span>` : '',
    ].join(' ');
    const first = !idDone.has(t); idDone.add(t);
    return `<section class="band band-${t.kind}"${first ? ` id="turn-${turns.indexOf(t)}" tabindex="-1"` : ''} aria-label="${esc(T.bandTitle(who, days1(t.labelDays), t.open))}">
      <h4 class="band-title">${icon(t.kind === 'submitter' ? 'user' : 'eye')}${esc(T.bandTitle(who, days1(t.labelDays), t.open))} ${tags}</h4>
      <ol class="timeline">${items}</ol></section>`;
  }).join('');
  return `<div class="convo-head">
      <h3 class="micro">${esc(COPY.detail.tree.conversation(issue.number))}</h3>
      ${extLink(issue.url, COPY.detail.timeline.view, 'ev-link')}
      <button type="button" class="btn-link only-narrow" id="back-to-tree">${esc(COPY.detail.tree.backToTree)}</button>
    </div>
    ${turnTable}
    <article class="ev ev-body"><div class="ev-head">${icon('issue', 'ev-ic')}<span class="ev-text">${personHtml(issue.author)} ${roleBadge(issue.author)} ${esc(COPY.detail.timeline.opened)}</span><span class="ev-time">${timeEl(issue.created_at)}</span></div>
      ${markerTags(issue.markers) ? `<div class="markers">${markerTags(issue.markers)}</div>` : ''}
      ${issue.body ? `<div class="md">${markdown(issue.body)}</div>` : ''}</article>
    ${body}`;
}

// ---------------------------------------------------------------------------

export function renderDetail(r, ctx, ui) {
  const tab = ui.tab || 'pr';
  return `${header(r, ctx)}
  <div class="panel-tabs seg-group" role="tablist" aria-label="${esc(COPY.detail.tabs.pr)} / ${esc(COPY.detail.tabs.issues)}">
    <button type="button" role="tab" class="seg-btn" id="tab-pr" aria-controls="panel-pr" aria-selected="${tab === 'pr'}" tabindex="${tab === 'pr' ? 0 : -1}">${esc(COPY.detail.tabs.pr)}</button>
    <button type="button" role="tab" class="seg-btn" id="tab-issues" aria-controls="panel-issues" aria-selected="${tab === 'issues'}" tabindex="${tab === 'issues' ? 0 : -1}">${esc(COPY.detail.tabs.issues)}</button>
  </div>
  <div class="panels" data-tab="${tab}">
    <section class="panel" id="panel-pr" role="tabpanel" aria-labelledby="tab-pr">
      <h3 class="panel-title">${icon('pr')}${r.pr ? esc(COPY.detail.prTitle(r.pr.number, COPY.prStates[r.pr.merged ? 'merged' : r.pr.state] || r.pr.state)) : esc(COPY.detail.tabs.pr)}${r.pr ? extLink(r.pr.url, COPY.detail.timeline.view, 'panel-link') : ''}</h3>
      <div class="panel-body" id="timeline">${renderTimeline(r, ctx, ui)}</div>
    </section>
    <section class="panel" id="panel-issues" role="tabpanel" aria-labelledby="tab-issues" data-convo="${ui.showConvo ? 1 : 0}">
      <h3 class="panel-title">${icon('issue')}${r.ti ? esc(COPY.detail.issueTitle(r.ti.number, COPY.issueStates[r.ti.state] || r.ti.state)) : esc(COPY.detail.tabs.issues)}${r.ti ? extLink(r.ti.url, COPY.detail.timeline.view, 'panel-link') : ''}</h3>
      <div class="panel-body">
        <div class="tree-wrap">${renderTree(r, ui)}${r.ti && !r.findings.length ? `<p class="muted meta">${esc(COPY.detail.tree.noFindings)}</p>` : ''}</div>
        ${r.ti ? `<div class="convo" id="convo" aria-live="polite">${renderConversation(r, ui, ctx)}</div>` : ''}
      </div>
    </section>
  </div>`;
}

export { dateText };
