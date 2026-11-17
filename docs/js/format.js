// Display helpers: escaping, Pacific dates, numbers, safe Markdown.

import { COPY } from './copy.js';

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let TZ = 'America/Los_Angeles';
export function setTimeZone(tz) { TZ = tz || TZ; fmtCache.clear(); }
const fmtCache = new Map();
function fmt(opts) {
  const k = JSON.stringify(opts);
  if (!fmtCache.has(k)) fmtCache.set(k, new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...opts }));
  return fmtCache.get(k);
}

// "Nov 17, 2026, 4:00 PM PT"
export function dateTimeText(msOrIso) {
  if (msOrIso == null) return COPY.missing;
  const d = new Date(typeof msOrIso === 'number' ? msOrIso : Date.parse(msOrIso));
  if (isNaN(d)) return COPY.missing;
  return `${fmt({ month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d)} ${COPY.tz}`;
}
export function dateText(msOrIso) {
  if (msOrIso == null) return COPY.missing;
  const d = new Date(typeof msOrIso === 'number' ? msOrIso : Date.parse(msOrIso));
  if (isNaN(d)) return COPY.missing;
  return fmt({ month: 'short', day: 'numeric', year: 'numeric' }).format(d);
}
// A YYYY-MM-DD calendar date (no time zone shift).
export function plainDateText(ymd) {
  if (!ymd) return COPY.missing;
  const [y, m, d] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(Date.UTC(y, m - 1, d)));
}
export function isoText(msOrIso) {
  if (msOrIso == null) return '';
  const d = new Date(typeof msOrIso === 'number' ? msOrIso : Date.parse(msOrIso));
  return isNaN(d) ? '' : d.toISOString();
}
// <time> with Pacific text, ISO on hover and in the accessible name.
export function timeEl(msOrIso, { dateOnly = false } = {}) {
  if (msOrIso == null) return `<span class="muted">${esc(COPY.missing)}</span>`;
  const iso = isoText(msOrIso);
  const text = dateOnly ? dateText(msOrIso) : dateTimeText(msOrIso);
  return `<time datetime="${esc(iso)}" title="${esc(iso)}" aria-label="${esc(dateTimeText(msOrIso) + ' (' + iso + ')')}">${esc(text)}</time>`;
}

export function days1(x) { return x == null ? COPY.missing : (Math.round(x * 10) / 10).toFixed(1); }
export function int(x) { return x == null ? COPY.missing : String(x); }

// ---------------------------------------------------------------------------
// Markdown: escape everything first, then add a small set of known tags.
// Only http(s) and relative links survive. Hidden HTML comments are removed.

function safeUrl(u) {
  const s = u.replace(/&amp;/g, '&').trim();
  if (/^https?:\/\//i.test(s)) return esc(s);
  return null;
}
function inline(text) {
  const codes = [];
  let t = text.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
    const u = safeUrl(url);
    return u ? `<a href="${u}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
  });
  t = t.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (m, pre, url) => `${pre}<a href="${esc(url.replace(/&amp;/g, '&'))}" target="_blank" rel="noopener noreferrer">${url}</a>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  t = t.replace(/(^|\s)@([A-Za-z0-9-]+)/g, '$1<span class="mention">@$2</span>');
  t = t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
  return t;
}
// The sandbox seed starts bodies with "[Reviewer: R1 · Name]". The actor is shown already (D24).
export function stripPersonaPrefix(src) {
  return String(src || '').replace(/^\s*\[(?:Reviewer|Submitter|Bot|Review chair|Chair|Engineer)[^\]\n]{0,80}\]\s*/i, '');
}

const isRow = (l) => /^\s*\|.*\|\s*$/.test(l);
const isSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

export function markdown(src) {
  const text = esc(stripPersonaPrefix(String(src || '').replace(/<!--[\s\S]*?-->/g, '').trim()));
  if (!text) return '';
  const lines = text.split(/\r?\n/);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${buf.join('\n')}</code></pre>`);
      continue;
    }
    if (isRow(line) && i + 1 < lines.length && isSep(lines[i + 1])) {
      const head = cells(line); i += 2;
      const body = [];
      while (i < lines.length && isRow(lines[i])) body.push(cells(lines[i++]));
      out.push(`<div class="md-table"><table><thead><tr>${head.map((c) => `<th scope="col">${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^#{1,6}\s/.test(line)) { out.push(`<p class="md-h">${inline(line.replace(/^#+\s/, ''))}</p>`); i++; continue; }
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(`<li>${inline(lines[i++].replace(/^\s*[-*]\s+/, ''))}</li>`);
      out.push(`<ul>${items.join('')}</ul>`); continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) items.push(`<li>${inline(lines[i++].replace(/^\s*\d+\.\s+/, ''))}</li>`);
      out.push(`<ol>${items.join('')}</ol>`); continue;
    }
    if (/^&gt;\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^&gt;\s?/.test(lines[i])) buf.push(lines[i++].replace(/^&gt;\s?/, ''));
      out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`); continue;
    }
    if (!line.trim()) { i++; continue; }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(```|#{1,6}\s|\s*[-*]\s+|\s*\d+\.\s+|&gt;)/.test(lines[i]) && !(isRow(lines[i]) && isSep(lines[i + 1] || ''))) buf.push(lines[i++]);
    out.push(`<p>${inline(buf.join('<br>'))}</p>`);
  }
  return out.join('');
}

// Plain text excerpt: no Markdown, no hidden comments, no persona prefix.
export function excerpt(src, max = 200) {
  const t = stripPersonaPrefix(String(src || '').replace(/<!--[\s\S]*?-->/g, '')).replace(/[`*_>#|]/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}
