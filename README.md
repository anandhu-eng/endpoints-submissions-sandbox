# Endpoints submissions sandbox

A stage-1 prototype of an internal page that tracks Endpoints submissions through review, and a sandbox repo with simulated review data that feeds it.

Every org, person, model, system and number here is invented. Submitters are Ubuntu release codenames.

## What's here

| Path | What |
|---|---|
| `docs/` | The page: static HTML, CSS and plain JavaScript, with no build step. GitHub Pages serves this folder. |
| `docs/data/snapshot.json` | The data the page reads. Generated; don't edit by hand. |
| `scripts/build_snapshot.py` | Builds the snapshot from this repo through the GitHub API (GET requests only). |
| `seed/` | Scenarios, seeding script and validator for the simulated PRs, issues and comments. See `seed/README.md`. |
| `sim/` | Personas, calendar (holidays, publication dates) and rows with no PR or issue. |
| `DESIGN.md` | Design tokens, status colours and the references used. |

## View the page locally

```
cd docs && python3 -m http.server 8765 --bind 127.0.0.1
```

Then open http://127.0.0.1:8765/.

## Rebuild the data

Needs Python 3.9+ and `gh` logged in with read access to this repo.

```
python3 scripts/build_snapshot.py                  # writes docs/data/snapshot.json
python3 scripts/build_snapshot.py --as-of 2026-11-20T10:00:00-08:00
```

"Now" for every deadline and wait is the snapshot's `as_of`, which defaults to the seed's 2026-11-17 10:00 AM PT. The simulated GitHub items carry their real times in hidden `sim-*` markers, because GitHub timestamps can't be backdated. The builder reads those markers and drops anything dated after `as_of`.

## How the page maps to the real system

| Page reads (sandbox) | Production source |
|---|---|
| `<!-- sim-db {...} -->` in the tracking issue body | `submissions` row (needs a new chair/staff read path) |
| `sim-at`, `sim-by` markers | GitHub `created_at`, `user.login` |
| `sim-label`, `sim-state`, `sim-assign` comments | Issue timeline events |
| `sim-check` comments | Check runs on the PR head commit |
| `sim/personas.json` | `users.role`, `users.github_id`, `orgs.user_ids` |
| `sim/calendar.json` | Lifecycle manager calendar and scheduler |

The requirements, infrastructure findings and test reports are kept outside this repo because they cite private code.
