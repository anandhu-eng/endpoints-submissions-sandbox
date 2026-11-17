# Sandbox seed data

Synthetic data for the Endpoints submission tracker prototype. It mirrors how the real review repo works (review PR per submission, tracking issue, findings as native sub-issues, turn labels, bot markers) with invented content. Every org, person, model, system and number is made up.

Binding format: the sandbox stand-ins in the requirements doc (§7.3), kept outside this repo. Conventions come from the infrastructure findings, also kept outside.

## Files

| File | What |
|---|---|
| `seed/scenarios.json` | Single source of truth: submissions, sim-db rows, PRs, commits, tracking issues, findings, comments, label/state/assign/check events, personas, labels, calendar |
| `seed/seed.py` | Writes `scenarios.json` to GitHub. Dry run by default |
| `seed/validate.py` | Coverage, consistency and banned-content checks |
| `sim/untracked.json` | sim-db rows with no PR and no tracking issue |
| `sim/personas.json` | Fictional people: login, display_name, role, org |
| `sim/calendar.json` | Time zone, US federal holidays and cohort dates, 2026-01-01 to 2027-06-30 |

The `sim/` files are committed to the repo, not posted. Regenerate them after editing `scenarios.json` with `python3 seed/seed.py --export-sim`.

## Running

Needs Python 3.9+, `git`, and `gh` logged in with write access to the repo. Run from the clone root.

```
python3 seed/validate.py            # must print 0 failed
python3 seed/seed.py                # dry run: GET requests only, prints every planned write and a count
python3 seed/seed.py --apply        # performs the writes (about 350, roughly 6 minutes)
```

- `--repo` defaults to `anandhu-eng/endpoints-submissions-sandbox`. Any repo outside `anandhu-eng/` is refused.
- Order: labels, `main` (README via the contents API if the repo is empty), branches (one `git push`), PRs and issues in simulated-time order, body sync, sub-issue links, comments in simulated-time order, label and open/closed sync.
- Re-runnable. Items and comments are matched by `<!-- sim-key: ... -->`; only missing ones are created. Labels and open/closed state are synced to the final set. Existing branches are reused.
- Issue and PR numbers are predicted before creation so bodies can carry them. If GitHub hands out a different number, the body-sync step patches the affected bodies.
- Writes are spaced 1 s apart (`--interval`). Secondary rate limits (403/429) back off from 60 s, doubling, up to 6 tries.
- Commits are built with `git commit-tree` (no checkout), with backdated author and committer dates. Author is the persona display name with a `<login>@sandbox.invalid` email, so no real account is linked.

## Simulation conventions

- Simulated now: `as_of` = `2026-11-17T10:00:00-08:00` (18:00 UTC). Submissions run from 2026-09-01 to 2026-11-16, plus one Preview row first published in April so it can be 180 days old, and one RDI row reviewed in July so its turns fall outside the Last 90 days period.
- All content is posted by one account. Every visible PR, issue and comment body starts with a persona prefix: `[Submitter: S1 · Feisty Fawn]`, `[Reviewer: R2 · Dapper Drake]`, `[Review chair: Chair A]`, `[Bot: lifecycle]`, `[Bot: label-objections]`, `[Bot: check-submission]`. Reviewers come from other submitting orgs.
- Models are `SimLM-8B`, `SimLM-70B`, `SimMoE-120B`, `SimCoder-32B`, `SimVision-11B`. Systems are "Node type K4 · 8x Accel-X" and similar.
- `benchmark_type` is `agentic`, `single_turn` or `mixed` (REQUIREMENTS §7.2). In production it is derived from `runs.point_config.runtime_settings.load_pattern` (`agentic_inference` / `concurrency`); the rules call the non-agentic kind "Legacy LLM" and VIZ calls it "Single-Turn".
- Bot texts follow the lifecycle manager's wording, with @-mentions replaced by persona names so no real GitHub user is notified.
- LM runs daily at 14:30 UTC in the simulation.

### Marker grammar

Bodies of PRs and issues (after the visible text):

```
<!-- sim-key: <key> -->
<!-- sim-at: <ISO8601 Z> -->
<!-- sim-by: <login> -->
<!-- sim-label: <label> added <ISO8601 Z> by <login> -->      one per label present at creation
<!-- sim-db {compact JSON} -->                                  only on the row's home item
```

Visible comment: `[<prefix>] <text>`, then `sim-key`, `sim-at`, `sim-by`.

Event comment (hidden only, never shown as a comment): `sim-key` (`<entry key>/ev`), `sim-at`, `sim-by`, then one or more of:

```
<!-- sim-label: <label> added|removed <ISO8601 Z> by <login> -->
<!-- sim-state: closed|reopened <ISO8601 Z> by <login> [completed|not_planned] -->   reason only on issues
<!-- sim-assign: <login> assigned|unassigned <ISO8601 Z> by <login> -->
<!-- sim-check: Run submission checker success|failure|pending <ISO8601 Z> sha=<40-hex sha> -->
```

A label may contain spaces and colons (`type: Cosmetic`, `by Dapper Drake`). Parse with `^<!-- sim-label: (.+) (added|removed) (\S+) by (\S+) -->$`. A turn swap is two `sim-label` lines in one event comment. When a person replies and swaps the label at the same moment, there are two comments with the same `sim-at`: the visible reply, then the event comment.

Real LM markers are used as is: `submission-id`, `embargo`, `penalties`, `review-warning`, `wk6-referral`, `meeting-escalation: #N`, `submitter-reminder: <start> L<n>`, `objector-reminder: <start>`, `reply-not-swapped: #N <start>`, `penalty-waiver: <label> added <event id>` (event ids are invented), `non-chair-finalize: <login>`.

### Stand-ins

| Real thing | Sandbox stand-in |
|---|---|
| `submissions` row | `sim-db` JSON: in the tracking issue body; else the PR body; else `sim/untracked.json`. Keys: the §7.2 `db` keys plus `id`, `is_test`, `model` (string or array), `benchmark_type`, `org`, `submitter` |
| GitHub created/closed/label/assign times | `sim-at`, `sim-state`, `sim-label`, `sim-assign` markers. Real GitHub times are all "today" |
| Tracking issue assignee | `sim-assign` comments only. Real assignees stay empty |
| `Run submission checker` check run | `sim-check` event comments on the PR (only on the 3 PRs where it matters: pending, failure x2, success) |
| DB status on GitHub | `status: <status lowercase>` label on the PR and tracking issue. The real system keeps status only in the DB. No history is recorded for it |
| Penalty level and longest wait | `penalties_imposed` and `business_days_since_response` in sim-db are computed from the label history (`validate.py` checks this) |

## Coverage

| Key | Org | Model | Type | Status | GitHub | What it tests |
|---|---|---|---|---|---|---|
| `cc-pending` | Noble Numbat | SimLM-8B | single_turn | COMPLIANCE_CHECKING | PR only | CC_CHECKING: PR open today, checker still queued; Waiting on: LM |
| `cc-failed` | Edgy Eft | SimVision-11B | single_turn | COMPLIANCE_CHECKING | PR only | CC_FAILED: two checker failures, fix pushed in between; Compliance overdue flag (PR > 7 days); Submitter (compliance) waiting-on; Chair nudging about Week 0 rejection |
| `rp-wk1-noreviewer` | Gutsy Gibbon | SimLM-70B | single_turn | REVIEW_PENDING | PR + tracking | RP_PEER day 5; No assigned reviewer (no sim-assign); Checker success event on the PR; No findings yet |
| `rp-wk2` | Feisty Fawn | SimMoE-120B | agentic | REVIEW_PENDING | PR + tracking + 2 finding(s) | RP_PEER day 15, provisional (early_publish, embargo passed); Two assignees; 'No findings' sub-issue (no type label, workflow complaint); Open submitter turn at stage 0 after a full round trip |
| `rp-wk3-stage1` | Dapper Drake | SimCoder-32B | agentic | REVIEW_PENDING | PR + tracking + 2 finding(s) | RP_PEER, Week 3 closes today; Reply without label swap (reply-not-swapped marker); Submitter reminder L1, penalty level 1; Open submitter turn at stage 1 (second turn); Resolved finding closed by reviewer straight from submitter turn |
| `rp-wk4-objres` | Hardy Heron | SimLM-70B | single_turn | REVIEW_PENDING | PR + tracking + 3 finding(s) | RP_OBJECTION day 33; Reproducibility back-and-forth, now reviewer turn with objector reminder; Chair ruling on a division question; 'by dapper-drake' spelling variant; Provisional with no embargo |
| `rp-wk5-stage2` | Karmic Koala | SimLM-8B | single_turn | REVIEW_PENDING | PR + tracking + 1 finding(s) | RP_OBJECTION, Week 6 closes in 2 days (wk6 warning); Open submitter turn at stage 2 (8 business days); Reminders L1 and L2, penalty notices L1 and L2; Submitter replies without swapping |
| `rp-wk5-waiver` | Jammy Jellyfish | SimMoE-120B | agentic | REVIEW_PENDING | PR + tracking + 2 finding(s) | RP_OBJECTION; waive-penalty-L1 by a chair lowers level 1 to 0 ('Penalty lowered'); Objector missed the 2-day deadline: closed by bot, label left as needs-reviewer-attention; Late objector comment on a closed finding; Provisional with a past embargo |
| `rp-wk6-meeting` | Lucid Lynx | SimCoder-32B | agentic | REVIEW_PENDING | PR + tracking + 1 finding(s) | RP_OBJECTION, Week 6 closes today (wk6 warning); Meeting escalation at 12 business days; Chair meeting notes; Long turn history for response-time metrics; Now reviewer turn |
| `rp-past-wk6` | Feisty Fawn | SimLM-70B | single_turn | REVIEW_PENDING | PR + tracking + 1 finding(s) | RP_PAST_WK6 with <!-- wk6-referral --> comment; Dispute referral by a chair; waive-penalty-all stops the clock while chairs decide (23-day submitter turn, penalty 0); Non-chair finalize: reviewer adds `finalized`, bot warns, chair removes it |
| `fin-embargo` | Intrepid Ibex | SimVision-11B, SimLM-8B | single_turn | FINALIZED | PR + tracking + 1 finding(s) | FIN_WAITING with embargo 2026-12-10 (due cohort 2026-12-C1); Two models in one submission; Finalized in Week 5 by a chair label |
| `fin-rdi` | Bionic Beaver | SimMoE-120B | mixed | FINALIZED | PR + tracking + 1 finding(s) | FIN_RDI: never auto-published; benchmark_type mixed (agentic and single-turn runs); division and availability both rdi |
| `fin-penalty` | Dapper Drake | SimLM-8B | single_turn | FINALIZED | PR + tracking + 1 finding(s) | FIN_WAITING, penalty-delayed (level 1: due 2026-12-C0 instead of 2026-11-C1); Finding without the submission label; Penalty frozen at finalization |
| `pub-normal` | Hoary Hedgehog | SimLM-8B | single_turn | PUBLISHED | PR + tracking + 1 finding(s) | PUBLISHED in 2026-10-C0 after provisional publication; Full timestamp set |
| `sup-old` | Breezy Badger | SimLM-70B | single_turn | SUPERSEDED | PR + tracking | SUPERSEDED (no timestamp for the change); Submitter announces resubmission on the tracking issue |
| `sup-new` | Breezy Badger | SimLM-70B | single_turn | PUBLISHED | PR + tracking + 1 finding(s) | PUBLISHED with supersedes set; Early finalization before Week 3; 'No findings' sub-issue on a resubmission; No objection_resolution_started_at (finalized before day 21) |
| `pub-legacy` | Warty Warthog | SimLM-8B | single_turn | PUBLISHED | PR only | Legacy PUBLISHED: PR but no tracking issue, sim-db in PR body; Missing timestamps; Empty issue panel |
| `exp-preview` | Focal Fossa | SimLM-70B | single_turn | EXPIRED | none (`sim/untracked.json`) | EXPIRED: Preview first published 2026-04-15, 180 days passed; No PR or tracking issue (sim/untracked.json) |
| `wd-submitter` | Hardy Heron | SimVision-11B | single_turn | WITHDRAWN | PR + tracking + 1 finding(s) | WD by submitter during review; PR and tracking issue closed by LM; Reviewer closes the finding afterwards |
| `wd-penalty` | Jaunty Jackalope | SimCoder-32B | agentic | WITHDRAWN | PR + tracking + 1 finding(s) | WD_PENALTY: 10 business days on one finding; Reminders L1-L3 and penalty notices L1-L2; Late reply after the threshold, label never swapped; Finding left open with needs-submitter-attention |
| `wi-legacy` | Gutsy Gibbon | SimLM-8B | single_turn | WITHDRAWN_INCOMPLETE | none (`sim/untracked.json`) | Legacy WITHDRAWN_INCOMPLETE from the removed Week 6 step; No PR or tracking issue (sim/untracked.json) |
| `cc-held` | Feisty Fawn | SimCoder-32B | agentic | COMPLIANCE_CHECKING | none (`sim/untracked.json`) | CC_HELD: provisional with future embargo, no PR yet; No PR or tracking issue (sim/untracked.json); Third submission from Feisty Fawn |
| `fin-rdi-july` | Hoary Hedgehog | SimCoder-32B | agentic | FINALIZED | PR + tracking + 3 finding(s) | FIN_RDI reviewed in July: every turn ended more than 90 days before as_of; Slower replies than recent submissions, so the activity period changes the response-time medians; Reviewer missed the 2-day deadline more than 90 days ago |
| `fin-embargo-sep` | Breezy Badger | SimLM-70B | single_turn | FINALIZED | PR + tracking + 3 finding(s) | FIN_WAITING with embargo 2027-01-14, reviewed in September: turns ended 31-90 days before as_of; Slower replies than recent submissions, so Last 90 days and Last 30 days differ |

## Known simplifications

- LM would post an objector reminder for every reviewer turn and a review-period warning on every submission. Only a sample is posted, to stay under the write budget.
- `submission:<short-id>` labels are not created; the UI must rely on the sub-issue parent link (INFRA_FINDINGS §3.2).
- A finding closed by LM for a missed objector deadline keeps `needs-reviewer-attention`; the real behaviour is not documented.
- Withdrawn tracking issues close as `not_planned`, findings as `completed`; LM's exact reason for the tracking issue is not documented.
- `wi-legacy` does not copy the live row's odd `first_published_at` (DB_COUNTS.md says not to).
