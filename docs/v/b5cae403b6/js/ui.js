// Small shared render pieces (pills, chips, names). Strings come from copy.js.

import { COPY } from './copy.js';
import { esc, days1, dateText } from './format.js';
import { icon, STAGE_LOOK, WAIT_ICON, TURN_LOOK, FLAG_ICON } from './icons.js';
import { STAGE_BY_CODE } from './derive.js';
import { UNASSIGNED } from './query.js';

let PEOPLE = new Map();
export function setPeople(map) { PEOPLE = map; }
export function person(login) { return PEOPLE.get(login) || null; }
export function personName(login) {
  if (!login) return COPY.missing;
  const p = PEOPLE.get(login);
  return p ? p.display_name : COPY.unknownPerson(login);
}
// Display name with the login on hover.
export function personHtml(login) {
  if (!login) return `<span class="muted">${esc(COPY.missing)}</span>`;
  return `<span class="person" title="@${esc(login)}">${esc(personName(login))}</span>`;
}
export function roleBadge(login) {
  const p = PEOPLE.get(login);
  const role = p?.role || (/\[bot\]$|^github-actions$/.test(login || '') ? 'bot' : null);
  if (!role) return '';
  const label = COPY.roles[role] || role;
  return `<span class="role role-${esc(role)}">${role === 'bot' ? icon('bot') : ''}${esc(label)}</span>`;
}

// A "(Weeks 1–3)" suffix wraps as one piece, never mid-range.
function keepParens(text) {
  return esc(text).replace(/\(([^)]*)\)/g, (m) => `<span class="nw">${m}</span>`);
}
export function stagePill(code, { size = 'sm', withStatus = true } = {}) {
  if (!code) return `<span class="muted">${esc(COPY.missing)}</span>`;
  const [ic, tone] = STAGE_LOOK[code] || ['dashed', 'slate'];
  const status = STAGE_BY_CODE[code]?.status || '';
  const help = COPY.stageHelp[code] || '';
  // Without the visible DB status, the pill's tooltip carries it.
  const title = withStatus ? help : `${help} (${COPY.dbStatus}: ${status})`;
  return `<span class="stage-cell"><span class="pill pill-${size} tone-${tone}" title="${esc(title)}">${icon(ic)}<span>${keepParens(COPY.stages[code] || code)}</span></span>${
    withStatus ? `<span class="db-status" title="${esc(COPY.dbStatus)}">${esc(status)}</span>` : ''}</span>`;
}
export function stageLabelText(code) {
  return `${COPY.stages[code] || code} · ${STAGE_BY_CODE[code]?.status || ''}`;
}

// youName: the View-as person's name when the action is theirs (D11).
export function waitChip(value, youName = null) {
  const text = youName ? COPY.waiting.you(youName) : COPY.waiting.values[value] || value;
  return `<span class="wait wait-${esc(value)}${youName ? ' wait-you' : ''}">${icon(value === 'nobody' || value === 'unknown' ? 'dashed' : 'arrow')}<span>${esc(text)}</span></span>`;
}
// "S1 · Dapper Drake" -> name "Dapper Drake", tag "S1".
export function splitName(login) {
  const p = PEOPLE.get(login);
  const full = p ? p.display_name : login || '';
  const m = /^(\S+) · (.+)$/.exec(full);
  return m ? { name: m[2], tag: m[1] } : { name: full, tag: '' };
}
// you: the viewer owns this value, so use the "you" wording (S2). Stage 1 has no viewer, so it is always false.
// Arrays of logins become names; epoch-ms numbers become Pacific dates.
export function waitReasonText(reason, you = false) {
  const fn = (you && COPY.waiting.reasonsYou[reason.key]) || COPY.waiting.reasons[reason.key];
  const args = (reason.args || []).map((a) => (Array.isArray(a) && typeof a[0] === 'string' ? a.map(personName) : typeof a === 'number' && a > 1e11 ? dateText(a) : a));
  return typeof fn === 'function' ? fn(...args) : fn || '';
}

export function flagBadge(flag) {
  return `<span class="flag flag-${esc(flag)}" title="${esc(COPY.flagHelp[flag] || '')}">${icon(FLAG_ICON[flag] || 'flag')}<span>${esc(COPY.flags[flag] || flag)}</span></span>`;
}

// Badges the page computes, shown before the flags in the list and the detail view.
export function stuckBadge(r) {
  return r.stuckReasons.length ? `<span class="flag flag-stuck" title="${esc(r.stuckReasons.map((x) => COPY.list.stuckReasons[x]).join(', '))}">${icon('alert')}<span>${esc(COPY.metrics.M12.name)}</span></span>` : '';
}
export function penaltyBadge(r) {
  return r.penalty ? `<span class="flag flag-penalty" title="${esc(COPY.list.penaltyHelp)}">${icon('flag')}<span>${esc(COPY.list.penaltyBadge(r.penalty))}</span></span>` : '';
}

export function turnBadge(state) {
  const [ic, cls] = TURN_LOOK[state] || TURN_LOOK.none;
  const title = state === 'none' ? COPY.turns.noneHelp : '';
  return `<span class="turn ${cls}" title="${esc(title)}">${icon(ic)}<span>${esc(COPY.turns[state])}</span></span>`;
}

export function extLink(url, text, cls = '') {
  if (!url) return esc(text);
  return `<a class="ext ${cls}" href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="${esc(COPY.githubTitle)}">${esc(text)}${icon('external', 'ext-icon')}<span class="sr-only"> ${esc(COPY.external)}</span></a>`;
}

export function bd(x) { return `${days1(x)}`; }

// Label for a group value or filter value.
export function valueLabel(key, v) {
  if (v == null || v === '') return key === 'rev' ? COPY.grouping.unassigned : COPY.grouping.unknown;
  switch (key) {
    case 'stage': return stageLabelText(v);
    case 'wait': return COPY.waiting.values[v] || v;
    case 'type': return COPY.types[v] || v;
    case 'div': return COPY.divisions[v] || v;
    case 'avail': return COPY.availability[v] || v;
    case 'flag': return COPY.flags[v] || v;
    case 'rev': return v === UNASSIGNED ? COPY.filters.unassigned : personName(v);
    case 'sub': return personName(v);
    case 'pen': return String(v);
    case 'due': return typeof COPY.filters.dueOptions[v] === 'function' ? COPY.filters.dueOptions[v]('N') : COPY.filters.dueOptions[v] || v;
    default: return String(v);
  }
}
