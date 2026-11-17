#!/usr/bin/env python3
"""Build docs/data/snapshot.json from the sandbox repo through the GitHub API.

Read-only: every call is a GET through `gh api`. The output follows the data
contract in REQUIREMENTS.md section 7. Simulated times, authors, label
changes, state changes, assignments and check results come from the hidden
`sim-*` markers described in seed/README.md; real GitHub times of sandbox
objects are ignored.

    python3 scripts/build_snapshot.py                       # default repo, as_of
    python3 scripts/build_snapshot.py --as-of 2026-11-20T12:00:00-08:00
"""

import argparse
import base64
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_REPO = "anandhu-eng/endpoints-submissions-sandbox"
DEFAULT_AS_OF = "2026-11-17T10:00:00-08:00"  # same as seed/scenarios.json
ROOT = Path(__file__).resolve().parent.parent

HIDDEN = re.compile(r"<!--[\s\S]*?-->")
ISO = r"\d{4}-\d{2}-\d{2}T[0-9:.]+(?:Z|[+-]\d{2}:?\d{2})?"
SIM_DB = re.compile(r"<!--\s*sim-db\s+([\s\S]*?)\s*-->")
SIM_AT = re.compile(r"<!--\s*sim-at:\s*(" + ISO + r")\s*-->")
SIM_BY = re.compile(r"<!--\s*sim-by:\s*(\S+?)\s*-->")
SIM_LABEL = re.compile(
    r"<!--\s*sim-label:\s*(.+?)\s+(added|removed)\s+(" + ISO + r")\s+by\s+(\S+?)\s*-->"
)
SIM_STATE = re.compile(
    r"<!--\s*sim-state:\s*(closed|reopened)\s+(" + ISO + r")\s+by\s+(\S+?)"
    r"(?:\s+(completed|not_planned))?\s*-->"
)
SIM_ASSIGN = re.compile(
    r"<!--\s*sim-assign:\s*(\S+)\s+(assigned|unassigned)\s+(" + ISO + r")\s+by\s+(\S+?)\s*-->"
)
SIM_CHECK = re.compile(
    r"<!--\s*sim-check:\s*(.+?)\s+(success|failure|pending)\s+(" + ISO + r")"
    r"(?:\s+sha=(\w+))?\s*-->"
)
SUBMISSION_ID = re.compile(r"<!--\s*submission-id:\s*([0-9a-fA-F-]{36})\s*-->")
SIM_BY_TRAILER = re.compile(r"^Sim-By:\s*(\S+)\s*$", re.M)

# Bot markers the page shows as short tags (INFRA_FINDINGS section 2.3).
KNOWN_MARKERS = re.compile(
    r"<!--\s*(submission-id|penalties|review-warning|wk6-referral|meeting-escalation|"
    r"submitter-reminder|reply-not-swapped|objector-reminder|penalty-waiver-level|"
    r"penalty-waiver|non-chair-finalize|embargo)\b:?\s*([\s\S]*?)\s*-->"
)
DB_KEYS = [
    "status", "created_at", "compliance_passed_at", "peer_review_started_at",
    "objection_resolution_started_at", "finalized_at", "first_published_at",
    "withdrawn_at", "embargo_date", "early_publish", "availability", "division",
    "penalties_imposed", "business_days_since_response", "publication_cycle",
    "supersedes", "pr_number", "tracking_issue_number",
]

warnings = []


def warn(msg):
    warnings.append(msg)
    print("warning:", msg, file=sys.stderr)


def gh_get(path):
    out = subprocess.run(
        ["gh", "api", "-X", "GET", "-H", "Accept: application/vnd.github+json", path],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        raise RuntimeError(f"gh api {path} failed: {out.stderr.strip()}")
    return json.loads(out.stdout) if out.stdout.strip() else None


def gh_list(path):
    items, page = [], 1
    sep = "&" if "?" in path else "?"
    while True:
        batch = gh_get(f"{path}{sep}per_page=100&page={page}")
        items.extend(batch)
        if len(batch) < 100:
            return items
        page += 1


def repo_file(repo, path, default):
    try:
        data = gh_get(f"repos/{repo}/contents/{path}")
    except RuntimeError:
        warn(f"{path} not found in {repo}")
        return default
    return json.loads(base64.b64decode(data["content"]))


def parse_time(s):
    if not s:
        return None
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def iso(dt):
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z") if dt else None


def strip_markers(body):
    return HIDDEN.sub("", body or "").strip()


def known_markers(body):
    return [{"name": m.group(1), "value": m.group(2).strip()} for m in KNOWN_MARKERS.finditer(body or "")]


def is_marker_only(body):
    return strip_markers(body) == ""


def sim_events(text, url):
    """Label, state, assign and check events from the sim markers in one body."""
    events = []
    for m in SIM_LABEL.finditer(text):
        events.append({"kind": "label", "label": m.group(1), "action": m.group(2),
                       "at": parse_time(m.group(3)), "actor": m.group(4)})
    for m in SIM_STATE.finditer(text):
        events.append({"kind": "state", "action": m.group(1), "at": parse_time(m.group(2)),
                       "actor": m.group(3), "reason": m.group(4)})
    for m in SIM_ASSIGN.finditer(text):
        events.append({"kind": "assign", "assignee": m.group(1), "action": m.group(2),
                       "at": parse_time(m.group(3)), "actor": m.group(4)})
    for m in SIM_CHECK.finditer(text):
        events.append({"kind": "check", "name": m.group(1), "conclusion": m.group(2),
                       "at": parse_time(m.group(3)), "sha": m.group(4) or "",
                       "url": url, "actor": "github-actions"})
    return events


def item_events(item, comments, real_login):
    """Turn an issue or PR plus its comments into events, using sim markers."""
    body = item.get("body") or ""
    opened_at = SIM_AT.search(body)
    opened_by = SIM_BY.search(body)
    if not opened_at:
        warn(f"#{item['number']}: no sim-at in body, using GitHub created_at")
    created = parse_time(opened_at.group(1)) if opened_at else parse_time(item["created_at"])
    author = opened_by.group(1) if opened_by else item["user"]["login"]
    events = [{"kind": "state", "action": "opened", "at": created, "actor": author}]
    # Labels present at creation are recorded in the body (seed/README.md).
    events += sim_events(body, item["html_url"])

    for c in comments:
        cb = c.get("body") or ""
        found = sim_events(cb, c["html_url"])
        events += found
        if found and is_marker_only(cb):
            continue
        at = SIM_AT.search(cb)
        by = SIM_BY.search(cb)
        if not at:
            warn(f"#{item['number']} comment {c['id']}: no sim-at, using GitHub created_at")
        if not by and c["user"]["login"] == real_login:
            warn(f"#{item['number']} comment {c['id']}: no sim-by")
        events.append({
            "kind": "comment", "id": c["id"],
            "at": parse_time(at.group(1)) if at else parse_time(c["created_at"]),
            "actor": by.group(1) if by else c["user"]["login"],
            "body": strip_markers(cb), "url": c["html_url"], "markers": known_markers(cb),
        })
    return events, created, author


def sandbox_only(label):
    # `status: <db status>` labels stand in for the DB column; the real repo has none.
    return label.startswith("status: ")


def finish(events, as_of):
    kept = [e for e in events if e["at"] and e["at"] <= as_of
            and not (e["kind"] == "label" and sandbox_only(e["label"]))]
    kept.sort(key=lambda e: (e["at"], e["kind"] != "state"))
    for e in kept:
        e["at"] = iso(e["at"])
    return kept


def replay_labels(number, real_labels, events):
    labels = {l for l in real_labels if not sandbox_only(l)}
    real_labels = sorted(labels)
    replayed = {}
    for e in events:
        if e["kind"] == "label":
            replayed[e["label"]] = e["action"] == "added"
    for name, present in replayed.items():
        (labels.add if present else labels.discard)(name)
    if labels != set(real_labels):
        warn(f"#{number}: replayed labels {sorted(labels)} differ from GitHub {sorted(real_labels)}")
    return sorted(labels)


def replay_state(item, events):
    state, reason, closed_at = "open", None, None
    saw = False
    for e in events:
        if e["kind"] == "state" and e["action"] in ("closed", "reopened"):
            saw = True
            if e["action"] == "closed":
                state, reason, closed_at = "closed", e.get("reason") or "completed", e["at"]
            else:
                state, reason, closed_at = "open", None, None
    if not saw and item["state"] == "closed":
        warn(f"#{item['number']}: closed on GitHub with no sim-state marker")
        state, reason = "closed", item.get("state_reason")
    return state, reason, closed_at


def replay_assignees(item, events):
    people = {a["login"] for a in item.get("assignees") or []}
    for e in events:
        if e["kind"] == "assign":
            (people.add if e["action"] == "assigned" else people.discard)(e["assignee"])
    return sorted(people)


def build_issue(item, comments, as_of, real_login, parent=None):
    events, created, author = item_events(item, comments, real_login)
    events = finish(events, as_of)
    state, reason, closed_at = replay_state(item, events)
    return {
        "number": item["number"], "url": item["html_url"], "title": item["title"],
        "body": strip_markers(item.get("body")), "state": state, "state_reason": reason,
        "created_at": iso(created), "closed_at": closed_at, "author": author,
        "assignees": replay_assignees(item, events),
        "labels": replay_labels(item["number"], [l["name"] for l in item["labels"]], events),
        "parent": parent, "markers": known_markers(item.get("body")), "events": events,
    }


def build_pr(repo, pull, item, comments, as_of, real_login):
    events, created, author = item_events(item, comments, real_login)
    for c in gh_list(f"repos/{repo}/pulls/{pull['number']}/commits"):
        msg = c["commit"]["message"]
        by = SIM_BY_TRAILER.search(msg)
        events.append({
            "kind": "commit", "sha": c["sha"],
            "message": SIM_BY_TRAILER.sub("", msg).strip(), "url": c["html_url"],
            "at": parse_time(c["commit"]["committer"]["date"]),
            "actor": by.group(1) if by else c["commit"]["author"]["name"],
        })
    for r in gh_list(f"repos/{repo}/pulls/{pull['number']}/reviews"):
        rb = r.get("body") or ""
        at = SIM_AT.search(rb)
        by = SIM_BY.search(rb)
        events.append({
            "kind": "review", "state": r["state"].lower(), "body": strip_markers(rb),
            "url": r["html_url"],
            "at": parse_time(at.group(1)) if at else parse_time(r["submitted_at"]),
            "actor": by.group(1) if by else r["user"]["login"],
        })
    events = finish(events, as_of)
    state, _, _ = replay_state(item, events)
    if pull.get("merged_at"):
        warn(f"PR #{pull['number']} is merged on GitHub; sandbox PRs should never merge")
    return {
        "number": pull["number"], "url": pull["html_url"], "title": pull["title"],
        "state": state, "merged": bool(pull.get("merged_at")), "created_at": iso(created),
        "author": author, "head_ref": pull["head"]["ref"], "head_sha": pull["head"]["sha"],
        "labels": replay_labels(pull["number"], [l["name"] for l in item["labels"]], events),
        "events": events,
    }


def sim_db_of(body):
    m = SIM_DB.search(body or "")
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except json.JSONDecodeError as e:
        warn(f"bad sim-db JSON: {e}")
        return None


def submission_from(sim, repo):
    sid = sim.get("id") or sim.get("submission_id")
    db = {k: sim.get(k) for k in DB_KEYS}
    db["early_publish"] = bool(db["early_publish"])
    db["penalties_imposed"] = db["penalties_imposed"] or 0
    db["business_days_since_response"] = db["business_days_since_response"] or 0
    model = sim.get("model")
    return {
        "id": sid, "short_id": (sim.get("short_id") or sid[:8]), "is_test": bool(sim.get("is_test")),
        "db": db, "org": sim.get("org"), "submitter": sim.get("submitter"),
        "models": model if isinstance(model, list) else ([model] if model else []),
        "benchmark_type": sim.get("benchmark_type") or "unknown",
        "assigned_reviewers": sim.get("assigned_reviewers") or [],
        "repo": repo, "pr": None, "tracking_issue": None, "findings": [],
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", default=DEFAULT_REPO)
    ap.add_argument("--as-of", default=DEFAULT_AS_OF)
    ap.add_argument("--out", default=str(ROOT / "docs" / "data" / "snapshot.json"))
    args = ap.parse_args()
    as_of = parse_time(args.as_of)
    repo = args.repo
    real_login = gh_get("user")["login"]

    personas = repo_file(repo, "sim/personas.json", [])
    calendar = repo_file(repo, "sim/calendar.json", {"timezone": "America/Los_Angeles", "holidays": [], "cohorts": []})
    untracked = repo_file(repo, "sim/untracked.json", [])
    if isinstance(personas, dict):
        personas = personas.get("people") or personas.get("personas") or []

    issues = gh_list(f"repos/{repo}/issues?state=all")
    pulls = {p["number"]: p for p in gh_list(f"repos/{repo}/pulls?state=all")}
    comments = {}
    for c in gh_list(f"repos/{repo}/issues/comments"):
        comments.setdefault(int(c["issue_url"].rsplit("/", 1)[1]), []).append(c)
    by_number = {i["number"]: i for i in issues}

    subs = {}
    pr_by_short = {p["head"]["ref"].split("/", 1)[1]: n for n, p in pulls.items()
                   if p["head"]["ref"].startswith("submission/")}

    # Tracking issues first, then PRs that carry their own sim-db, then untracked rows.
    for i in issues:
        if "pull_request" in i:
            continue
        names = {l["name"] for l in i["labels"]}
        sim = sim_db_of(i.get("body"))
        if "tracking" not in names or not sim:
            continue
        s = submission_from(sim, repo)
        kids = gh_list(f"repos/{repo}/issues/{i['number']}/sub_issues")
        s["tracking_issue"] = build_issue(i, comments.get(i["number"], []), as_of, real_login)
        s["findings"] = [
            build_issue(by_number.get(k["number"], k), comments.get(k["number"], []), as_of,
                        real_login, parent=i["number"])
            for k in kids
        ]
        s["db"]["tracking_issue_number"] = i["number"]
        subs[s["id"]] = s

    for n, p in pulls.items():
        sim = sim_db_of(p.get("body"))
        if sim and (sim.get("id") or sim.get("submission_id")) not in subs:
            s = submission_from(sim, repo)
            subs[s["id"]] = s

    for sim in untracked:
        s = submission_from(sim, repo)
        if s["id"] in subs:
            warn(f"{s['short_id']} is in sim/untracked.json and also on GitHub")
            continue
        subs[s["id"]] = s

    for s in subs.values():
        n = pr_by_short.get(s["short_id"])
        if n is None and s["db"].get("pr_number") in pulls:
            n = s["db"]["pr_number"]
        if n is not None:
            s["pr"] = build_pr(repo, pulls[n], by_number[n], comments.get(n, []), as_of, real_login)
            s["db"]["pr_number"] = n
            s["db"]["pr_url"] = pulls[n]["html_url"]

    out = {
        "schema_version": "1",
        "as_of": args.as_of,
        "generated_at": iso(datetime.now(timezone.utc)),
        "source": {"kind": "sandbox", "repo": repo, "url": f"https://github.com/{repo}"},
        "calendar": calendar,
        "people": personas,
        "submissions": sorted(subs.values(), key=lambda s: s["db"].get("created_at") or ""),
        "warnings": warnings,
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    print(f"wrote {args.out}: {len(subs)} submissions, {len(warnings)} warnings")


if __name__ == "__main__":
    main()
