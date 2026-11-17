// 24x24 stroke icons, currentColor, 2px stroke (visualizer convention). Decorative: aria-hidden.

const P = {
  dashed: '<circle cx="12" cy="12" r="9" stroke-dasharray="3 3"/>',
  x: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  scale: '<path d="M12 3v18M7 21h10M5 7h14M5 7l-3 6a3 3 0 0 0 6 0L5 7zM19 7l-3 6a3 3 0 0 0 6 0l-3-6z"/>',
  alert: '<path d="M12 3l10 18H2L12 3z"/><path d="M12 10v4M12 17.5v.5"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
  tick: '<path d="M5 12l5 5 9-10"/>',
  award: '<circle cx="12" cy="9" r="6"/><path d="M8.5 14L7 22l5-3 5 3-1.5-8"/>',
  slash: '<circle cx="12" cy="12" r="9"/><path d="M6 18L18 6"/>',
  hourglass: '<path d="M6 3h12M6 21h12M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9"/>',
  pause: '<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>',
  setup: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4l-3 2"/><path d="M12 3v2"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
  chevRight: '<path d="M9 6l6 6-6 6"/>',
  chevDown: '<path d="M6 9l6 6 6-6"/>',
  chevLeft: '<path d="M15 6l-6 6 6 6"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  pr: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="19" r="2"/><path d="M6 7v10M18 17V9a3 3 0 0 0-3-3h-4M13 3l-2 3 2 3"/>',
  issue: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="1.5"/>',
  issueClosed: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
  commit: '<circle cx="12" cy="12" r="3.5"/><path d="M2 12h6.5M15.5 12H22"/>',
  comment: '<path d="M4 5h16v11H9l-5 4V5z"/>',
  review: '<path d="M4 5h16v11H9l-5 4V5z"/><path d="M9 10.5l2 2 4-4"/>',
  tag: '<path d="M3 12V3h9l9 9-9 9-9-9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  run: '<circle cx="12" cy="12" r="9"/><path d="M10 8l6 4-6 4V8z"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8L3 5z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  flag: '<path d="M5 21V4h11l-2 4 2 4H5"/>',
  assign: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M19 8v6M16 11h6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  bot: '<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 4v4M9 13v1M15 13v1"/>',
};

export function icon(name, cls = '') {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[name] || ''}</svg>`;
}

// Stage code -> [icon, tone]. Tone picks colours in styles.css.
export const STAGE_LOOK = {
  CC_HELD: ['pause', 'slate'], CC_NO_PR: ['dashed', 'slate'], CC_FAILED: ['x', 'rose'], CC_CHECKING: ['run', 'slate'],
  RP_SETUP: ['setup', 'blue'], RP_PEER: ['eye', 'blue'], RP_OBJECTION: ['scale', 'violet'], RP_PAST_WK6: ['alert', 'rose'],
  FIN_RDI: ['check', 'teal'], FIN_WAITING: ['check', 'teal'], PUBLISHED: ['award', 'green'],
  SUPERSEDED: ['slash', 'closed'], EXPIRED: ['slash', 'closed'], WD_PENALTY: ['slash', 'closed'], WD: ['slash', 'closed'], WD_INCOMPLETE: ['slash', 'closed'],
};
export const WAIT_ICON = { submitter: 'user', reviewer: 'eye', chair: 'scale', lm: 'run', submitter_compliance: 'x', unknown: 'dashed', nobody: 'dashed' };
export const TURN_LOOK = { submitter: ['user', 'turn-sub'], reviewer: ['eye', 'turn-rev'], resolved: ['check', 'turn-res'], waived: ['slash', 'turn-waived'], none: ['alert', 'turn-none'] };
export const FLAG_ICON = {
  provisional: 'hourglass', test: 'flag', embargoed: 'clock', penalty_delayed: 'clock', finalize_pending: 'run',
  non_chair_finalize: 'alert', withdrawn_after_finalization: 'slash', compliance_overdue: 'alert', escalated: 'alert', legacy: 'db',
  penalty_waived: 'slash', supersedes: 'arrow', superseded_by: 'slash', non_chair_finalize_removed: 'slash',
};
