# Review status page: design notes

This page is a static GitHub Pages site in `docs/`: plain HTML, CSS and JavaScript modules, with no framework and no build step. It reads `docs/data/snapshot.json` and makes no other network calls. The spec is `REQUIREMENTS.md` (kept outside this repo).

## Files

| File | Holds |
| --- | --- |
| `docs/index.html` | Page shell: header, sidebar, main area. A small inline script applies the theme before first paint. |
| `docs/styles.css` | Colour tokens (light and dark), layout and components. |
| `docs/js/copy.js` | **All user-facing text.** Edit wording here only. |
| `docs/js/derive.js` | **All review rules:** stages, flags, Waiting on, turns, Pacific business days, penalties, deadlines, due cohort, metrics. No DOM code. Key single-source functions: `openTurnAsOf` (every open-turn count), `reviewerReplyDeadline` (11:59 PM PT, 2nd business day), `nextBotRun` (7:00 / 8:00 AM PT runs), `myWaits` / `owesAction` (View as). |
| `docs/js/query.js` | Filters, grouping, sort, URL state, queues (ready, needs a chair, waiting on me) and the deadline that matched a filter. Compares derived fields; contains no review rules. |
| `docs/js/format.js` | Pacific date formatting (12-hour clock everywhere), numbers, safe Markdown (escape first, then a few known tags, plus tables). Quotes use the same inline Markdown, so code spans are kept. |
| `docs/js/ui.js`, `render-list.js`, `render-detail.js` | Rendering. |
| `docs/js/app.js` | Loads the snapshot, keeps state in the URL, handles input. |
| `docs/data/snapshot.json` | Data (section 7 of the spec), built from the sandbox seed. |

Run it locally with `python3 -m http.server -d docs 8000`. ES modules do not load from `file://`.

## Look

The page follows the Endpoints results visualizer, so it reads as part of the same product:

- **Fonts:** Instrument Sans for UI text, DM Mono for ids and kbd chips.
- **Type sizes:** 11px bold uppercase labels, 13px table text.
- **Colours:** navy text and card bars `#14304F` / `#1A3A5E` (dark `#566467`), interactive green `#009966`, mint selection `#CCEBD4` at 40%, links `#37548A` (dark `#BED3FB`), dark page `#1A2028`.
- **Shapes:** 6px corners on controls, 4px on cards.
- **Dark mode:** a recolour only. The theme is stored in a `theme` cookie and falls back to the system setting.

Status is never shown by colour alone:

- Stage pills have an icon and a label, and the DB status sits beside them.
- Turn states, flags and check results always have text.
- Deadlines that are close show a clock icon as well as colour.
- All text pairs reach at least 4.5:1 contrast in both themes (muted text `#596371` light, `#A3ACB8` dark; table headers `#5D6775`).

| Stage group | Light fg / bg | Dark fg / bg | Icon |
| --- | --- | --- | --- |
| Compliance (held, no PR, pending) | `#434C58` / `#E7EAEF` | `#CCD2DA` / `#2E3540` | pause, dashed circle, play |
| Compliance failed, Past Week 6 | `#BE123C` / `#FFE4E6` | `#FDA4AF` / `#3B1820` | x, warning triangle |
| Review starting, Peer review | `#1E40AF` / `#DBEAFE` | `#BED3FB` / `#1C2B4A` | clock, eye |
| Objection resolution | `#5B21B6` / `#EDE9FE` | `#DDD6FE` / `#2E2550` | scales |
| Finalized | `#0F766E` / `#CCFBF1` | `#99F6E4` / `#12332F` | check circle |
| Published | `#15803D` / `#DCFCE7` | `#86EFAC` / `#14321F` | award |
| Closed (withdrawn, expired, superseded) | `#596371`, dashed outline | `#A3ACB8`, dashed outline | circle-slash |
| Provisional flag | `#B45309` / `#FEF3C7` | `#F1C281` / `#302818` | hourglass |

## Layout decisions from persona rounds

- Detail view: Waiting on, What to do and the review clock sit in one top band; submission facts and DB timestamps are in a collapsed Details block, so the PR and Issues panels start on the first screen at 1440×900.
- Person views (submitter, reviewer) and phones start with the Overview and stage strip collapsed; chairs keep them open.
- Phones: header links sit behind a menu button; the detail view opens on Issues when a finding is open; the turn table uses short dates.
- The open turn always has a band in the conversation, so "Jump to current turn" always lands.
- Known gap: the turn table has no "First reply" column.

## References

The URL, what we took from it, and why.

| # | Reference | Taken | Why |
| --- | --- | --- | --- |
| 1 | Gerrit attention set, https://gerrit-review.googlesource.com/Documentation/user-attention-set.html | The "Waiting on" column: an arrow plus the party, with the reason under it. | Most visitors want to know whose turn it is. Gerrit answers that with an arrow and a bold name. |
| 2 | GitHub Primer Timeline, https://primer.style/components/timeline | PR timeline layout: one vertical line, full items for comments and reviews, one-line items for commits, labels and checks. | It matches what users see on GitHub, and short events stay short. |
| 3 | GitHub sub-issues, https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/browsing-sub-issues | Issue tree rows (state icon + text, `#number`, title) with expand toggles, and child counts on the root. | Findings are sub-issues, so the tree mirrors GitHub's own structure. |
| 4 | Linear display options, https://linear.app/docs/display-options | Ordered group-by levels kept separate from filters, with a count on each group header. | Chairs compare by org then model, or by reviewer. Keeping grouping apart from filtering avoids confusion. |
| 5 | Grafana stat panel, https://grafana.com/docs/grafana/latest/panels-visualizations/visualizations/stat/ | Metric tiles: a label, one large number, one or two short lines of detail. A warning icon appears only where a count signals a problem. | Short tiles let the chair take in the whole picture at once, and a full-colour background would be too loud. |
| 6 | Primer StateLabel, https://primer.style/components/state-label | GitHub's own words for PR and issue states (open, closed, merged), each with an icon. | No new vocabulary for things users already know from GitHub. |
| 7 | Jira swimlanes, https://support.atlassian.com/jira-software-cloud/docs/configure-swimlanes | An "Unassigned" / "Unknown" group placed last instead of hidden. | Unassigned submissions are exactly what a chair needs to see. |
| 8 | Zendesk SLA badges, https://support.zendesk.com/hc/en-us/articles/4408832852122 | Deadlines shown as text (date and kind), with colour and a clock icon when close. | Red, amber and green alone fail for colour-blind users. |
| 9 | Phabricator Differential statuses, https://secure.phabricator.com/book/phabricator/article/differential_faq/ | One stage vocabulary everywhere: tiles, stage strip, list, detail and filters all use the same labels from `copy.js`. | Phabricator showed the same review under two different labels on two pages, which confused users. |
| 10 | Dribbble, "Data Tables I (Filters, Sorting)", https://dribbble.com/shots/9553921 | Active filters as removable chips above the list, plus "Clear all filters". | Users can see and undo what is narrowing the list. |
| 11 | Dribbble, "Complex data tables on mobile", https://dribbble.com/shots/9229224 | Below 760px each row becomes a card with labelled fields; no sideways scrolling. | Stage, Waiting on and deadline would otherwise fall off screen on a phone. |
| 12 | Pinterest design guide, "Dashboard with tiles", https://guide.pinterest.com/design/dashboard-with-tiles/ | Every metric tile is a button that applies the matching filter. | A number is only useful if you can see the rows behind it. |
| 13 | Zendesk split view, https://support.zendesk.com/hc/en-us/articles/10413364615194 | Detail view with two panes (PR timeline, issues) side by side from 960px, and tabs below that. | Reviewers read the PR history and the findings together. |

Dribbble pages could not be fetched; references 10 and 11 rest on their titles and descriptions only.
