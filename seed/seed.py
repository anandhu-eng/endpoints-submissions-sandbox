#!/usr/bin/env python3
"""Seed the Endpoints submissions sandbox repo from seed/scenarios.json.

Python 3 stdlib only. Talks to GitHub through the `gh` CLI and pushes branches
with `git`. Re-runnable: every PR, issue and comment carries a hidden
`<!-- sim-key: ... -->` marker, and only missing items are created.

    python3 seed/seed.py                 # dry run (default): GET requests only
    python3 seed/seed.py --apply         # perform the writes
    python3 seed/seed.py --export-sim    # rewrite sim/*.json from scenarios.json (local files only)

Only repos under anandhu-eng/ are accepted.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent  # the sandbox clone
DEFAULT_REPO = "anandhu-eng/endpoints-submissions-sandbox"
REPO_RE = re.compile(r"^anandhu-eng/[A-Za-z0-9._-]+$")
KEY_RE = re.compile(r"<!-- sim-key: (\S+) -->")
PLACEHOLDER_RE = re.compile(r"\{\{(num|sha):([^}]+)\}\}")
API_HEADERS = ["-H", "Accept: application/vnd.github+json",
               "-H", "X-GitHub-Api-Version: 2022-11-28"]
README = (
    "# Endpoints submissions sandbox\n\n"
    "Synthetic review PRs, tracking issues and findings for the Endpoints submission "
    "tracker prototype. Every org, person, model, system and number here is invented.\n\n"
    "Simulated times live in hidden `sim-*` markers; see `seed/README.md`.\n"
)


# ---------------------------------------------------------------------------
# gh / git wrappers
# ---------------------------------------------------------------------------

class GhError(RuntimeError):
    pass


def gh_api(method: str, path: str, body: dict | None = None) -> object:
    cmd = ["gh", "api", "-X", method, path, *API_HEADERS]
    if body is not None:
        cmd += ["--input", "-"]
    proc = subprocess.run(cmd, input=json.dumps(body) if body is not None else None,
                          capture_output=True, text=True)
    if proc.returncode != 0:
        raise GhError(f"{method} {path}: {proc.stderr.strip() or proc.stdout.strip()}")
    out = proc.stdout.strip()
    return json.loads(out) if out else None


def gh_get_all(path: str) -> list:
    """GET a list endpoint page by page (per_page=100)."""
    sep = "&" if "?" in path else "?"
    items, page = [], 1
    while True:
        batch = gh_api("GET", f"{path}{sep}per_page=100&page={page}")
        if not isinstance(batch, list):
            raise GhError(f"GET {path}: expected a list")
        items.extend(batch)
        if len(batch) < 100:
            return items
        page += 1


def git(*args: str, env: dict | None = None, check: bool = True) -> str:
    proc = subprocess.run(["git", "-C", str(ROOT), *args], capture_output=True, text=True,
                          env={**os.environ, **(env or {})})
    if check and proc.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {proc.stderr.strip()}")
    return proc.stdout.strip()


# ---------------------------------------------------------------------------
# Writer: dry-run log, or throttled writes with back-off
# ---------------------------------------------------------------------------

class Writer:
    def __init__(self, apply: bool, interval: float):
        self.apply = apply
        self.interval = interval
        self.last = 0.0
        self.counts: dict[str, int] = {}
        self.fake_id = 10_000_000

    def _count(self, category: str) -> None:
        self.counts[category] = self.counts.get(category, 0) + 1

    def api(self, category: str, method: str, path: str, body: dict | None, desc: str):
        self._count(category)
        print(f"  [{category}] {method} {path}  {desc}")
        if not self.apply:
            self.fake_id += 1
            return {"id": self.fake_id, "number": None, "labels": []}
        delay = 60.0
        for attempt in range(6):
            wait = self.interval - (time.monotonic() - self.last)
            if wait > 0:
                time.sleep(wait)
            self.last = time.monotonic()
            try:
                return gh_api(method, path, body)
            except GhError as exc:
                msg = str(exc).lower()
                limited = ("rate limit" in msg or "http 429" in msg or "secondary" in msg
                           or "abuse" in msg)
                transient = ("refused_stream" in msg or "timeout" in msg or "connection reset" in msg
                             or "http 502" in msg or "http 503" in msg)
                if not (limited or transient) or attempt == 5:
                    raise
                pause = delay if limited else 5.0 * (attempt + 1)
                print(f"    {'rate limited' if limited else 'transient error'}, sleeping {pause:.0f}s ({exc})")
                time.sleep(pause)
                if limited:
                    delay = min(delay * 2, 900)
        raise GhError("unreachable")

    def git_push(self, url: str, refspecs: list[str]) -> None:
        self._count("git push")
        print(f"  [git push] {len(refspecs)} ref(s): " + ", ".join(r.split(':')[1] for r in refspecs))
        if self.apply:
            git("push", url, *refspecs)


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------

class Renderer:
    def __init__(self, data: dict):
        self.personas = {p["login"]: p for p in data["personas"]}
        self.numbers: dict[str, int] = {}  # sim-key -> GitHub number (real or predicted)
        self.predicted: set[str] = set()
        self.shas: dict[str, str] = {}     # "<scenario>/pr/<i>" -> sha

    def resolve(self, text: str) -> str:
        def sub(m):
            kind, ref = m.group(1), m.group(2)
            if kind == "num":
                return str(self.numbers[ref]) if ref in self.numbers else f"<num:{ref}>"
            return self.shas.get(ref, f"<sha:{ref}>")
        return PLACEHOLDER_RE.sub(sub, text)

    def sim_db(self, db: dict) -> str:
        out = {}
        for k, v in db.items():
            if isinstance(v, str) and PLACEHOLDER_RE.fullmatch(v):
                r = self.resolve(v)
                out[k] = int(r) if r.isdigit() else r
            else:
                out[k] = v
        text = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
        assert "-->" not in text
        return f"<!-- sim-db {text} -->"

    def prefixed(self, login: str, text: str) -> str:
        prefix = f"[{self.personas[login]['prefix']}]"
        sep = "\n\n" if text[:1] in "#|-`*>" and not text.startswith("**") else " "
        return f"{prefix}{sep}{text}"

    @staticmethod
    def initial_label_by(item: dict, label: str) -> str:
        if item["kind"] == "finding":
            return item["by"] if label.startswith("type: ") else "label-objections-bot"
        return "lm-bot"

    def item_body(self, item: dict, sc: dict, home: bool) -> str:
        lines = [self.prefixed(item["by"], self.resolve(item["body"])), "",
                 f"<!-- sim-key: {item['key']} -->", f"<!-- sim-at: {item['at']} -->",
                 f"<!-- sim-by: {item['by']} -->"]
        for lab in item.get("initial_labels", []):
            lines.append(f"<!-- sim-label: {lab} added {item['at']} by "
                         f"{self.initial_label_by(item, lab)} -->")
        if home:
            lines.append(self.sim_db(sc["sim_db"]))
        return "\n".join(lines)

    def comment_bodies(self, entry: dict, item: dict) -> list[tuple[str, str]]:
        """(sim-key, body) for the visible comment and/or the hidden event comment."""
        out = []
        head = [f"<!-- sim-at: {entry['at']} -->", f"<!-- sim-by: {entry['by']} -->"]
        if entry.get("text"):
            out.append((entry["key"], "\n".join(
                [self.prefixed(entry["by"], self.resolve(entry["text"])), "",
                 f"<!-- sim-key: {entry['key']} -->", *head])))
        ev = []
        for lab in entry.get("labels", []):
            ev.append(f"<!-- sim-label: {lab['label']} {lab['action']} {entry['at']} by {entry['by']} -->")
        if entry.get("state"):
            st = entry["state"]
            reason = f" {item['state_reason']}" if item["kind"] != "pr" and item.get("state_reason") else ""
            ev.append(f"<!-- sim-state: {st['action']} {entry['at']} by {entry['by']}{reason} -->")
        if entry.get("assign"):
            a = entry["assign"]
            ev.append(f"<!-- sim-assign: {a['login']} {a['action']} {entry['at']} by {entry['by']} -->")
        if entry.get("check"):
            c = entry["check"]
            sha = self.resolve(f"{{{{sha:{item['key'].rsplit('/', 1)[0]}/pr/{c['commit']}}}}}")
            ev.append(f"<!-- sim-check: Run submission checker {c['conclusion']} {entry['at']} sha={sha} -->")
        if ev:
            key = f"{entry['key']}/ev"
            out.append((key, "\n".join([f"<!-- sim-key: {key} -->", *head, *ev])))
        return out


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def export_sim(data: dict) -> None:
    sim = ROOT / "sim"
    sim.mkdir(exist_ok=True)
    rows = [sc["sim_db"] for sc in data["scenarios"] if sc["home"] == "untracked"]
    personas = [{k: p[k] for k in ("login", "display_name", "role", "org")} for p in data["personas"]]
    for name, obj in (("untracked.json", rows), ("personas.json", personas),
                      ("calendar.json", data["calendar"])):
        (sim / name).write_text(json.dumps(obj, indent=1, ensure_ascii=False) + "\n")
        print(f"wrote sim/{name}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", default=DEFAULT_REPO)
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", default=True, help="plan only (default)")
    mode.add_argument("--apply", action="store_true", help="perform the writes")
    ap.add_argument("--scenarios", default=str(HERE / "scenarios.json"))
    ap.add_argument("--interval", type=float, default=1.0, help="seconds between writes")
    ap.add_argument("--export-sim", action="store_true", help="write sim/*.json and exit")
    args = ap.parse_args()

    if not REPO_RE.match(args.repo):
        print(f"Refusing repo {args.repo!r}: only anandhu-eng/<name> is allowed.", file=sys.stderr)
        return 2
    data = json.loads(Path(args.scenarios).read_text())
    if args.export_sim:
        export_sim(data)
        return 0

    repo = args.repo
    url = f"https://github.com/{repo}.git"
    w = Writer(args.apply, args.interval)
    r = Renderer(data)
    print(f"{'APPLY' if args.apply else 'DRY RUN'} against {repo}\n")

    # ---- read current state (GET only) -------------------------------------
    try:
        info = gh_api("GET", f"repos/{repo}")
        if not info.get("private"):
            print(f"WARNING: {repo} is public.")
        labels_now = {l["name"]: l for l in gh_get_all(f"repos/{repo}/labels")}
        issues = gh_get_all(f"repos/{repo}/issues?state=all")
        comments = gh_get_all(f"repos/{repo}/issues/comments")
    except GhError as exc:
        if args.apply:
            raise
        print(f"(could not read the repo, planning as if empty: {exc})")
        labels_now, issues, comments = {}, [], []
    existing: dict[str, dict] = {}
    for it in issues:
        m = KEY_RE.search(it.get("body") or "")
        if m:
            existing[m.group(1)] = it
    comment_keys = {m.group(1) for c in comments for m in [KEY_RE.search(c.get("body") or "")] if m}
    max_number = max((it["number"] for it in issues), default=0)
    heads = git("ls-remote", "--heads", url, check=False)
    remote_heads = {line.split("\trefs/heads/")[1]: line.split("\t")[0]
                    for line in heads.splitlines() if "\trefs/heads/" in line}
    print(f"found {len(existing)} seeded items, {len(comment_keys)} seeded comments, "
          f"{len(labels_now)} labels, {len(remote_heads)} branches\n")

    scenarios = data["scenarios"]
    items: list[tuple[dict, dict]] = []  # (item, scenario)
    for sc in scenarios:
        for it in ([sc["pr"]] if sc.get("pr") else []) + ([sc["tracking"]] if sc.get("tracking") else []) + sc.get("findings", []):
            items.append((it, sc))
    kind_order = {"pr": 0, "tracking": 1, "finding": 2}
    items.sort(key=lambda p: (p[0]["at"], kind_order[p[0]["kind"]]))

    # numbers: existing ones are real, missing ones predicted in creation order
    nxt = max_number + 1
    for it, _ in items:
        if it["key"] in existing:
            r.numbers[it["key"]] = existing[it["key"]]["number"]
        else:
            r.numbers[it["key"]] = nxt
            r.predicted.add(it["key"])
            nxt += 1

    # ---- 1. labels ---------------------------------------------------------
    print("1. labels")
    for lab in data["labels"]:
        cur = labels_now.get(lab["name"])
        if cur is None:
            w.api("label", "POST", f"repos/{repo}/labels", lab, lab["name"])
        elif cur["color"].lower() != lab["color"].lower() or (cur.get("description") or "") != lab["description"]:
            w.api("label", "PATCH", f"repos/{repo}/labels/{urllib.parse.quote(lab['name'], safe='')}",
                  {"color": lab["color"], "description": lab["description"]}, f"update {lab['name']}")

    # ---- 2. main + branches ------------------------------------------------
    print("\n2. branches")
    if "main" not in remote_heads:
        w.api("contents", "PUT", f"repos/{repo}/contents/README.md",
              {"message": "Initial commit", "content": __import__("base64").b64encode(README.encode()).decode()},
              "create main with README.md")
    if args.apply:
        git("fetch", url, "+refs/heads/*:refs/remotes/sandbox/*")
    refspecs = []
    for sc in scenarios:
        pr = sc.get("pr")
        if not pr:
            continue
        branch = pr["branch"]
        if branch in remote_heads:
            if args.apply:
                shas = git("rev-list", "--reverse", f"refs/remotes/sandbox/main..refs/remotes/sandbox/{branch}").split()
                for i, sha in enumerate(shas):
                    r.shas[f"{sc['key']}/pr/{i}"] = sha
            continue
        if not args.apply:
            refspecs.append(f"<new>:refs/heads/{branch}")
            continue
        parent = git("rev-parse", "refs/remotes/sandbox/main")
        tree = git("rev-parse", "refs/remotes/sandbox/main^{tree}")
        for i, c in enumerate(pr["commits"]):
            who = r.personas[c["by"]]
            env = {"GIT_AUTHOR_NAME": who["display_name"], "GIT_AUTHOR_EMAIL": f"{c['by']}@sandbox.invalid",
                   "GIT_COMMITTER_NAME": who["display_name"], "GIT_COMMITTER_EMAIL": f"{c['by']}@sandbox.invalid",
                   "GIT_AUTHOR_DATE": c["at"], "GIT_COMMITTER_DATE": c["at"]}
            parent = git("commit-tree", tree, "-p", parent, "-m", c["message"], env=env)
            r.shas[f"{sc['key']}/pr/{i}"] = parent
        refspecs.append(f"{parent}:refs/heads/{branch}")
    if refspecs:
        w.git_push(url, refspecs)

    # ---- 3. PRs and issues -------------------------------------------------
    print("\n3. PRs and issues (simulated-time order)")
    created_now: dict[str, dict] = {}
    for it, sc in items:
        home = (it["kind"] == "tracking" and sc["home"] == "tracking") or (it["kind"] == "pr" and sc["home"] == "pr")
        if it["key"] in existing:
            continue
        body = r.item_body(it, sc, home)
        pred = r.numbers[it["key"]]
        if it["kind"] == "pr":
            res = w.api("pr", "POST", f"repos/{repo}/pulls",
                        {"title": it["title"], "head": it["branch"], "base": "main", "body": body},
                        f"#{pred} {it['title']}")
        else:
            res = w.api("issue", "POST", f"repos/{repo}/issues",
                        {"title": it["title"], "body": body, "labels": it["labels"]},
                        f"#{pred} {it['title']}")
            res["labels"] = [{"name": n} for n in it["labels"]] if not args.apply else res["labels"]
        if args.apply and res["number"] != pred:
            print(f"    number {res['number']} differs from predicted {pred}; bodies will be re-synced")
            r.numbers[it["key"]] = res["number"]
        res.setdefault("state", "open")
        res["body"] = body
        created_now[it["key"]] = res

    def current(key):
        return existing.get(key) or created_now.get(key)

    # ---- 4. body sync (only when something changed) ------------------------
    print("\n4. body sync")
    for it, sc in items:
        cur = current(it["key"])
        home = (it["kind"] == "tracking" and sc["home"] == "tracking") or (it["kind"] == "pr" and sc["home"] == "pr")
        want = r.item_body(it, sc, home)
        have = (cur.get("body") or "").replace("\r\n", "\n").strip()
        if have != want.strip():
            path = f"repos/{repo}/{'pulls' if it['kind'] == 'pr' else 'issues'}/{r.numbers[it['key']]}"
            w.api("body", "PATCH", path, {"body": want}, f"#{r.numbers[it['key']]} {it['key']}")

    # ---- 5. sub-issue links ------------------------------------------------
    print("\n5. sub-issue links")
    linked: dict[str, set[int]] = {}
    for it, sc in items:
        if it["kind"] != "finding":
            continue
        parent_key = it["parent"]
        if parent_key not in linked:
            linked[parent_key] = set()
            if parent_key in existing:
                subs = gh_get_all(f"repos/{repo}/issues/{r.numbers[parent_key]}/sub_issues")
                linked[parent_key] = {s["id"] for s in subs}
        child = current(it["key"])
        if child["id"] in linked[parent_key]:
            continue
        w.api("sub-issue", "POST", f"repos/{repo}/issues/{r.numbers[parent_key]}/sub_issues",
              {"sub_issue_id": child["id"]}, f"#{r.numbers[it['key']]} under #{r.numbers[parent_key]}")

    # ---- 6. comments, in simulated-time order ------------------------------
    print("\n6. comments (simulated-time order)")
    pending = []
    for it, sc in items:
        for entry in it.get("timeline", []):
            for key, body in r.comment_bodies(entry, it):
                pending.append((entry["at"], key.endswith("/ev"), key, it, body))
    pending.sort(key=lambda p: (p[0], p[1]))
    for _, is_ev, key, it, body in pending:
        if key in comment_keys:
            continue
        w.api("comment-event" if is_ev else "comment", "POST",
              f"repos/{repo}/issues/{r.numbers[it['key']]}/comments", {"body": body},
              f"#{r.numbers[it['key']]} {key}")

    # ---- 7. labels and open/closed state -----------------------------------
    print("\n7. label and state sync")
    for it, sc in items:
        cur = current(it["key"])
        num = r.numbers[it["key"]]
        have = {l["name"] for l in cur.get("labels", [])}
        want = set(it["labels"])
        if want - have:
            w.api("label-sync", "POST", f"repos/{repo}/issues/{num}/labels",
                  {"labels": sorted(want - have)}, f"#{num} add {sorted(want - have)}")
        for lab in sorted(have - want):
            w.api("label-sync", "DELETE",
                  f"repos/{repo}/issues/{num}/labels/{urllib.parse.quote(lab, safe='')}", None,
                  f"#{num} remove {lab}")
        if cur.get("state", "open") != it["state"]:
            if it["kind"] == "pr":
                w.api("state", "PATCH", f"repos/{repo}/pulls/{num}", {"state": it["state"]},
                      f"#{num} {it['state']}")
            else:
                body = {"state": it["state"]}
                if it["state"] == "closed" and it.get("state_reason"):
                    body["state_reason"] = it["state_reason"]
                w.api("state", "PATCH", f"repos/{repo}/issues/{num}", body, f"#{num} {it['state']}")

    # ---- summary -----------------------------------------------------------
    total_api = sum(n for k, n in w.counts.items() if k != "git push")
    print("\nPlanned writes:" if not args.apply else "\nWrites performed:")
    for k in sorted(w.counts):
        print(f"  {k:14} {w.counts[k]}")
    print(f"  {'TOTAL API':14} {total_api}  (+{w.counts.get('git push', 0)} git push)")
    if not args.apply:
        print(f"\nAt {args.interval:.1f}s per write this takes about {total_api * args.interval / 60:.0f} min "
              "plus any rate-limit back-off. Run with --apply to perform.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
