#!/usr/bin/env python3
"""Check seed/scenarios.json for coverage, consistency and banned content.

Python 3 stdlib only. Prints a pass/fail report and exits 1 on any failure.

    python3 seed/validate.py [--scenarios seed/scenarios.json]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
PACIFIC = ZoneInfo("America/Los_Angeles")

TURN_LABELS = ("needs-submitter-attention", "needs-reviewer-attention", "resolved")
SUBMITTER = "needs-submitter-attention"
WAIVE_L1 = "waive-penalty-L1"
WAIVE_ALL = "waive-penalty-all"
STATUSES = (
    "COMPLIANCE_CHECKING", "REVIEW_PENDING", "FINALIZED", "PUBLISHED",
    "SUPERSEDED", "EXPIRED", "WITHDRAWN", "WITHDRAWN_INCOMPLETE",
)
DB_KEYS = {
    "status", "created_at", "compliance_passed_at", "peer_review_started_at",
    "objection_resolution_started_at", "finalized_at", "first_published_at",
    "withdrawn_at", "embargo_date", "early_publish", "availability", "division",
    "penalties_imposed", "business_days_since_response", "publication_cycle",
    "supersedes", "pr_number", "tracking_issue_number",
    "id", "is_test", "model", "benchmark_type", "org", "submitter",
}
BENCHMARK_TYPES = {"agentic", "single_turn", "mixed"}

# Real vendors, products, models, frameworks and companies. Matched as whole
# words, case-insensitive, against every string in scenarios.json.
DENYLIST = [
    # accelerator / CPU / system vendors and products
    "nvidia", "intel", "amd", "arm", "qualcomm", "broadcom", "marvell", "cerebras",
    "groq", "sambanova", "graphcore", "tenstorrent", "habana", "gaudi", "xeon",
    "epyc", "instinct", "h100", "h200", "h800", "b100", "b200", "gb200", "gb300",
    "a100", "a10g", "l4", "l40", "l40s", "mi250", "mi300", "mi300x", "mi325x",
    "mi355x", "tpu", "trainium", "inferentia", "grace", "hopper", "blackwell",
    "ampere", "dgx", "hgx", "nvlink", "infiniband", "cuda", "rocm", "oneapi",
    "dell", "hpe", "hewlett", "lenovo", "supermicro", "cisco", "fujitsu", "gigabyte",
    "giga computing", "asus", "quanta", "wiwynn", "inspur", "ibm", "oracle",
    "redhat", "red hat", "vmware", "krai", "mangoboost", "coreweave", "nebius",
    "lambda labs", "crusoe",
    # clouds and big tech
    "google", "gcp", "microsoft", "azure", "aws", "amazon", "meta", "openai",
    "anthropic", "alibaba", "baidu", "tencent", "huawei", "samsung", "apple",
    # model families
    "llama", "gpt", "chatgpt", "deepseek", "qwen", "mistral", "mixtral", "gemma",
    "gemini", "claude", "phi-3", "phi-4", "falcon", "bloom", "bert", "resnet",
    "retinanet", "dlrm", "whisper", "sdxl", "stable diffusion", "olmo", "granite",
    "nemotron", "kimi", "glm", "yi-34b", "command-r",
    # serving software
    "vllm", "sglang", "tensorrt", "trt-llm", "triton", "tgi", "llama.cpp", "ollama",
    # real people / real infra names that must not leak in
    "mlcommons", "mlperf", "prism", "supabase",
]

UBUNTU_ORGS = {
    "Warty Warthog", "Hoary Hedgehog", "Breezy Badger", "Dapper Drake", "Edgy Eft",
    "Feisty Fawn", "Gutsy Gibbon", "Hardy Heron", "Intrepid Ibex", "Jaunty Jackalope",
    "Karmic Koala", "Lucid Lynx", "Maverick Meerkat", "Natty Narwhal",
    "Oneiric Ocelot", "Precise Pangolin", "Quantal Quetzal", "Raring Ringtail",
    "Saucy Salamander", "Trusty Tahr", "Utopic Unicorn", "Vivid Vervet",
    "Wily Werewolf", "Xenial Xerus", "Yakkety Yak", "Zesty Zapus", "Artful Aardvark",
    "Bionic Beaver", "Cosmic Cuttlefish", "Disco Dingo", "Eoan Ermine",
    "Focal Fossa", "Groovy Gorilla", "Hirsute Hippo", "Impish Indri",
    "Jammy Jellyfish", "Kinetic Kudu", "Lunar Lobster", "Mantic Minotaur",
    "Noble Numbat", "Oracular Oriole", "Plucky Puffin",
}
MODEL_RE = re.compile(r"^Sim[A-Za-z]+-\d+B$")
ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
PLACEHOLDER_RE = re.compile(r"\{\{(num|sha):([^}]+)\}\}")


# ---------------------------------------------------------------------------
# Time and business-day helpers (shared with the scenario builder)
# ---------------------------------------------------------------------------

def ts(value: str | None) -> datetime | None:
    if value is None:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def pacific_date(moment: datetime) -> date:
    return moment.astimezone(PACIFIC).date()


def window_close(started: datetime, days: int) -> datetime:
    """23:59:59 Pacific on the Pacific date `days` after the clock started."""
    return datetime.combine(
        pacific_date(started) + timedelta(days=days), time(23, 59, 59), tzinfo=PACIFIC
    )


class BusinessCalendar:
    def __init__(self, holidays: list[str]):
        self.holidays = {date.fromisoformat(h) for h in holidays}

    def is_bday(self, d: date) -> bool:
        return d.weekday() < 5 and d not in self.holidays

    def whole_days(self, start: datetime, end: datetime) -> int:
        """Whole 24-hour business days between two instants (LM's turn count)."""
        if end <= start:
            return 0
        total = 0.0
        d = pacific_date(start)
        last = pacific_date(end)
        while d <= last:
            if self.is_bday(d):
                day_start = datetime.combine(d, time(0), tzinfo=PACIFIC)
                day_end = datetime.combine(d + timedelta(days=1), time(0), tzinfo=PACIFIC)
                lo, hi = max(start, day_start), min(end, day_end)
                if hi > lo:
                    total += (hi - lo).total_seconds()
            d += timedelta(days=1)
        return int(total // 86400)


def stage_for(days: int) -> int:
    return 3 if days >= 10 else 2 if days >= 6 else 1 if days >= 3 else 0


def label_events(item: dict) -> list[tuple[datetime, str, str]]:
    """(time, label, added|removed) for an item, creation labels first."""
    out = [(ts(item["at"]), lab, "added") for lab in item.get("initial_labels", [])]
    for entry in item.get("timeline", []):
        for ev in entry.get("labels", []):
            out.append((ts(entry["at"]), ev["label"], ev["action"]))
    out.sort(key=lambda e: e[0])
    return out


def labels_at(item: dict, cutoff: datetime) -> set[str]:
    cur: set[str] = set()
    for at, lab, action in label_events(item):
        if at > cutoff:
            break
        if action == "added":
            cur.add(lab)
        else:
            cur.discard(lab)
    return cur


def submitter_spans(item: dict, cutoff: datetime) -> list[tuple[datetime, datetime, bool]]:
    """(start, end, still_open) for each needs-submitter-attention span."""
    spans, start = [], None
    for at, lab, action in label_events(item):
        if lab != SUBMITTER or at > cutoff:
            continue
        if action == "added" and start is None:
            start = at
        elif action == "removed" and start is not None:
            spans.append((start, at, False))
            start = None
    if start is not None:
        spans.append((start, cutoff, True))
    return spans


def score_cutoff(sc: dict, as_of: datetime) -> datetime:
    db = sc["sim_db"]
    if db["status"] in ("FINALIZED", "PUBLISHED", "SUPERSEDED") and db["finalized_at"]:
        return ts(db["finalized_at"])
    if db["status"] == "WITHDRAWN" and db["withdrawn_at"]:
        return ts(db["withdrawn_at"])
    return as_of


def score(sc: dict, cal: BusinessCalendar, as_of: datetime) -> tuple[int, int, list[dict]]:
    """(penalty level, business_days_since_response, per-finding detail)."""
    cutoff = score_cutoff(sc, as_of)
    level, longest, detail = 0, 0, []
    for f in sc.get("findings", []):
        if ts(f["at"]) > cutoff:
            continue
        spans = submitter_spans(f, cutoff)
        waits = [cal.whole_days(s, e) for s, e, _ in spans]
        raw = stage_for(max(waits, default=0))
        labs = labels_at(f, cutoff)
        waived_all = WAIVE_ALL in labs
        adj = 0 if waived_all else max(0, raw - (1 if WAIVE_L1 in labs else 0))
        level = max(level, adj)
        if not waived_all:
            longest = max(longest, max(waits, default=0))
        current = waits[-1] if spans and spans[-1][2] else None
        detail.append({"key": f["key"], "raw": raw, "adj": adj, "current": current,
                       "max_wait": max(waits, default=0)})
    return level, longest, detail


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

class Report:
    def __init__(self):
        self.rows: list[tuple[str, bool, str]] = []

    def check(self, name: str, ok: bool, detail: str = "") -> None:
        self.rows.append((name, bool(ok), detail))

    def print(self) -> bool:
        width = max(len(n) for n, _, _ in self.rows)
        for name, ok, detail in self.rows:
            print(f"{'PASS' if ok else 'FAIL'}  {name.ljust(width)}  {detail}")
        failed = [r for r in self.rows if not r[1]]
        print(f"\n{len(self.rows) - len(failed)} passed, {len(failed)} failed")
        return not failed


def all_strings(obj, path=""):
    if isinstance(obj, str):
        yield path, obj
    elif isinstance(obj, dict):
        for k, v in obj.items():
            yield from all_strings(k, f"{path}.<key>")
            yield from all_strings(v, f"{path}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from all_strings(v, f"{path}[{i}]")


def items_of(sc: dict) -> list[dict]:
    out = []
    if sc.get("pr"):
        out.append(sc["pr"])
    if sc.get("tracking"):
        out.append(sc["tracking"])
    out.extend(sc.get("findings", []))
    return out


def marker_texts(item: dict) -> list[str]:
    return [e.get("text") or "" for e in item.get("timeline", [])]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenarios", default=str(HERE / "scenarios.json"))
    args = ap.parse_args()
    data = json.loads(Path(args.scenarios).read_text())
    rep = Report()
    as_of = ts(data["as_of_utc"])
    cal = BusinessCalendar(data["calendar"]["holidays"])
    scs = data["scenarios"]
    personas = {p["login"]: p for p in data["personas"]}
    label_names = {l["name"] for l in data["labels"]}
    by_status: dict[str, list[dict]] = {}
    for sc in scs:
        by_status.setdefault(sc["sim_db"]["status"], []).append(sc)

    # ---------------- structure ----------------
    rep.check("submission count 18-24", 18 <= len(scs) <= 24, f"{len(scs)} submissions")
    keys: list[str] = []
    problems: list[str] = []
    for sc in scs:
        db = sc["sim_db"]
        keys.append(sc["key"])
        if set(db) != DB_KEYS:
            problems.append(f"{sc['key']}: sim-db keys differ: "
                            f"missing {sorted(DB_KEYS - set(db))}, extra {sorted(set(db) - DB_KEYS)}")
        if db["benchmark_type"] not in BENCHMARK_TYPES:
            problems.append(f"{sc['key']}: benchmark_type {db['benchmark_type']}")
        if db["org"] not in UBUNTU_ORGS:
            problems.append(f"{sc['key']}: org {db['org']} is not an Ubuntu codename")
        models = db["model"] if isinstance(db["model"], list) else [db["model"]]
        for m in models:
            if not MODEL_RE.match(m):
                problems.append(f"{sc['key']}: model {m} is not Sim*")
        if db["submitter"] not in personas or personas[db["submitter"]]["role"] != "submitter":
            problems.append(f"{sc['key']}: submitter {db['submitter']} not a submitter persona")
        elif personas[db["submitter"]]["org"] != db["org"]:
            problems.append(f"{sc['key']}: submitter org mismatch")
        for col in ("created_at", "compliance_passed_at", "peer_review_started_at",
                    "objection_resolution_started_at", "finalized_at",
                    "first_published_at", "withdrawn_at", "embargo_date"):
            v = db[col]
            if v is not None and (not ISO_RE.match(v)):
                problems.append(f"{sc['key']}: {col} not ISO Z: {v}")
            if v is not None and col != "embargo_date" and ts(v) > as_of:
                problems.append(f"{sc['key']}: {col} after as_of")
        home = sc["home"]
        if home == "tracking" and not sc.get("tracking"):
            problems.append(f"{sc['key']}: home tracking but no tracking issue")
        if home == "pr" and (not sc.get("pr") or sc.get("tracking")):
            problems.append(f"{sc['key']}: home pr needs a PR and no tracking issue")
        if home == "untracked" and (sc.get("pr") or sc.get("tracking")):
            problems.append(f"{sc['key']}: untracked row has GitHub items")
        if (db["pr_number"] is None) != (sc.get("pr") is None and True) and home != "untracked":
            pass
        short = db["id"][:8]
        if sc.get("pr"):
            pr = sc["pr"]
            if pr["branch"] != f"submission/{short}":
                problems.append(f"{sc['key']}: branch {pr['branch']}")
            if not (2 <= len(pr["commits"]) <= 5):
                problems.append(f"{sc['key']}: {len(pr['commits'])} commits")
            if not re.match(rf"^\[Review\] {re.escape(db['org'])} · \S+ · \S+ · .+ · {short}$", pr["title"]):
                problems.append(f"{sc['key']}: PR title format: {pr['title']}")
            for c in pr["commits"]:
                if ts(c["at"]) > ts(pr["at"]) and not c.get("after_open"):
                    problems.append(f"{sc['key']}: commit after PR open not flagged")
        if sc.get("tracking"):
            t = sc["tracking"]["title"]
            if not re.match(rf"^Reviews for Submission {short} — {re.escape(db['org'])} — .+$", t):
                problems.append(f"{sc['key']}: tracking title format: {t}")
        for item in items_of(sc):
            for who in [item["by"]] + [e["by"] for e in item.get("timeline", [])]:
                if who not in personas:
                    problems.append(f"{item['key']}: unknown persona {who}")
            if ts(item["at"]) > as_of:
                problems.append(f"{item['key']}: created after as_of")
            for e in item.get("timeline", []):
                if ts(e["at"]) > as_of or ts(e["at"]) < ts(item["at"]):
                    problems.append(f"{e['key']}: time {e['at']} outside item life")
            for lab in item.get("initial_labels", []) + item.get("labels", []):
                if lab not in label_names:
                    problems.append(f"{item['key']}: label {lab} not defined")
            for e in item.get("timeline", []):
                for ev in e.get("labels", []):
                    if ev["label"] not in label_names:
                        problems.append(f"{e['key']}: label {ev['label']} not defined")
            final = labels_at(item, as_of)
            if set(item.get("labels", [])) != final:
                problems.append(f"{item['key']}: final labels {sorted(item['labels'])} != replay {sorted(final)}")
        for f in sc.get("findings", []):
            rv = personas[f["by"]]
            if rv["role"] != "reviewer":
                problems.append(f"{f['key']}: finding author not a reviewer")
            elif rv["org"] == db["org"]:
                problems.append(f"{f['key']}: reviewer from the submitting org")
            if sc.get("tracking") and ts(f["at"]) > window_close(ts(db["peer_review_started_at"]), 21):
                problems.append(f"{f['key']}: filed after Week 3 closed")
    rep.check("sim-db keys, values, titles, branches", not problems, "; ".join(problems[:6]))
    rep.check("sim keys unique", len(keys) == len(set(keys)))
    all_keys = []
    for sc in scs:
        for item in items_of(sc):
            all_keys.append(item["key"])
            all_keys.extend(e["key"] for e in item.get("timeline", []))
    rep.check("item and comment keys unique", len(all_keys) == len(set(all_keys)),
              f"{len(all_keys)} keys")
    known = set(all_keys)
    commit_keys = {f"{sc['key']}/pr/{i}" for sc in scs if sc.get("pr") for i in range(len(sc["pr"]["commits"]))}
    bad_ph = []
    for _, s in all_strings(data["scenarios"]):
        for kind, ref in PLACEHOLDER_RE.findall(s):
            if (kind == "num" and ref not in known) or (kind == "sha" and ref not in commit_keys):
                bad_ph.append(ref)
    rep.check("placeholders resolve", not bad_ph, ", ".join(bad_ph[:5]))

    # ---------------- penalties consistency ----------------
    pen_problems = []
    detail_by_key: dict[str, dict] = {}
    for sc in scs:
        if not sc.get("findings"):
            continue
        level, longest, det = score(sc, cal, as_of)
        for d in det:
            detail_by_key[d["key"]] = d
        db = sc["sim_db"]
        if db["penalties_imposed"] != level or db["business_days_since_response"] != longest:
            pen_problems.append(f"{sc['key']}: db {db['penalties_imposed']}/{db['business_days_since_response']}"
                                f" vs label replay {level}/{longest}")
    rep.check("penalties_imposed and business_days_since_response match label history",
              not pen_problems, "; ".join(pen_problems))

    # ---------------- coverage ----------------
    rep.check("every DB status present", set(by_status) == set(STATUSES),
              f"missing {sorted(set(STATUSES) - set(by_status))}")

    def pr_checks(sc):
        out = []
        for e in (sc.get("pr") or {}).get("timeline", []):
            if e.get("check"):
                out.append(e["check"]["conclusion"])
        return out

    cc = by_status.get("COMPLIANCE_CHECKING", [])
    rep.check("CC: waiting (no PR, or check pending)",
              any(sc.get("pr") is None or (pr_checks(sc) and pr_checks(sc)[-1] == "pending") for sc in cc))
    rep.check("CC: failed check described in comments",
              any(pr_checks(sc) and pr_checks(sc)[-1] == "failure"
                  and any(e.get("text") for e in sc["pr"]["timeline"]) for sc in cc))

    def phase(sc):
        start = ts(sc["sim_db"]["peer_review_started_at"])
        if as_of <= window_close(start, 21):
            return "wk1-3"
        if as_of <= window_close(start, 42):
            return "wk4-6"
        return "past"

    def open_findings(sc):
        return [f for f in sc.get("findings", []) if f["state"] == "open"
                and "resolved" not in f["labels"]]

    rp = [sc for sc in by_status.get("REVIEW_PENDING", []) if sc.get("tracking")]
    rep.check("RP: Weeks 1-3", any(phase(sc) == "wk1-3" for sc in rp))
    rep.check("RP: Weeks 4-6 with open findings",
              any(phase(sc) == "wk4-6" and open_findings(sc) for sc in rp))
    rep.check("RP: past Week 6 with wk6-referral comment",
              any(phase(sc) == "past" and any("<!-- wk6-referral -->" in t for t in marker_texts(sc["tracking"]))
                  for sc in rp))

    def assigned(sc):
        out = set()
        for e in (sc.get("tracking") or {}).get("timeline", []):
            a = e.get("assign")
            if a:
                (out.add if a["action"] == "assigned" else out.discard)(a["login"])
        return out

    rep.check("RP: no assigned reviewer", any(not assigned(sc) for sc in rp))
    fin = by_status.get("FINALIZED", [])
    rep.check("FINALIZED: embargoed", any(sc["sim_db"]["embargo_date"] and ts(sc["sim_db"]["embargo_date"]) > as_of for sc in fin))
    rep.check("FINALIZED: RDI", any(sc["sim_db"]["availability"] == "rdi" for sc in fin))
    rep.check("FINALIZED: penalty-delayed", any(sc["sim_db"]["penalties_imposed"] > 0 for sc in fin))
    rep.check("FINALIZED/PUBLISHED PRs open with finalized label",
              all(sc["pr"]["state"] == "open" and "finalized" in sc["pr"]["labels"]
                  for sc in fin + by_status.get("PUBLISHED", []) + by_status.get("SUPERSEDED", [])
                  if sc.get("tracking")))
    rep.check("PUBLISHED present", bool(by_status.get("PUBLISHED")))
    sup_ids = {sc["sim_db"]["supersedes"] for sc in scs if sc["sim_db"]["supersedes"]}
    rep.check("SUPERSEDED row has a successor",
              any(sc["sim_db"]["id"] in sup_ids for sc in by_status.get("SUPERSEDED", [])))
    rep.check("EXPIRED: Preview, first published 180+ days before as_of",
              any(sc["sim_db"]["availability"] == "preview" and sc["sim_db"]["first_published_at"]
                  and ts(sc["sim_db"]["first_published_at"]) < as_of - timedelta(days=180)
                  for sc in by_status.get("EXPIRED", [])))
    wd = by_status.get("WITHDRAWN", [])
    rep.check("WITHDRAWN: by submitter", any(sc["sim_db"]["penalties_imposed"] < 3 for sc in wd))
    rep.check("WITHDRAWN: by penalty level 3", any(sc["sim_db"]["penalties_imposed"] >= 3 for sc in wd))
    rep.check("WITHDRAWN: PR and tracking issue closed",
              all(sc["pr"]["state"] == "closed" and sc["tracking"]["state"] == "closed"
                  for sc in wd if sc.get("pr") and sc.get("tracking")))
    rep.check("WITHDRAWN_INCOMPLETE present", bool(by_status.get("WITHDRAWN_INCOMPLETE")))

    findings = [f for sc in scs for f in sc.get("findings", [])]
    for lab in TURN_LABELS:
        rep.check(f"finding with final label {lab}", any(lab in f["labels"] for f in findings))
    open_sub = [detail_by_key[f["key"]] for sc in rp for f in sc["findings"]
                if f["key"] in detail_by_key and detail_by_key[f["key"]]["current"] is not None]
    rep.check("open submitter turn at stage 1", any(stage_for(d["current"]) == 1 for d in open_sub))
    rep.check("open submitter turn at stage 2", any(stage_for(d["current"]) == 2 for d in open_sub))
    rep.check("objector missed 2-day deadline, closed by bot",
              any(f["state"] == "closed" and "needs-reviewer-attention" in f["labels"]
                  and any(e.get("state", {}).get("action") == "closed" and e["by"] == "lm-bot"
                          for e in f["timeline"]) for f in findings))
    rep.check("waive-penalty-L1 on a finding", any(WAIVE_L1 in f["labels"] for f in findings))
    rep.check("meeting escalation on finding and tracking issue",
              any(any("<!-- meeting-escalation:" in t for t in marker_texts(f)) for f in findings)
              and any(sc.get("tracking") and any("<!-- meeting-escalation:" in t for t in marker_texts(sc["tracking"])) for sc in scs))
    rep.check("'no findings' sub-issue from a reviewer", any(f.get("no_findings") for f in findings))
    rep.check("non-chair finalize warning",
              any(sc.get("tracking") and any("<!-- non-chair-finalize:" in t for t in marker_texts(sc["tracking"])) for sc in rp))

    types = {sc["sim_db"]["benchmark_type"] for sc in scs}
    rep.check("benchmark types agentic and single_turn (and mixed)",
              {"agentic", "single_turn"} <= types, ", ".join(sorted(types)))
    models = set()
    for sc in scs:
        m = sc["sim_db"]["model"]
        models.update(m if isinstance(m, list) else [m])
    rep.check("at least 5 models", len(models) >= 5, ", ".join(sorted(models)))
    orgs: dict[str, int] = {}
    for sc in scs:
        orgs[sc["sim_db"]["org"]] = orgs.get(sc["sim_db"]["org"], 0) + 1
    rep.check("at least 10 orgs", len(orgs) >= 10, f"{len(orgs)} orgs")
    multi = [o for o, n in orgs.items() if n > 1]
    rep.check("several orgs with more than one submission", len(multi) >= 3, ", ".join(sorted(multi)))
    rep.check("early_publish true and false", {sc["sim_db"]["early_publish"] for sc in scs} == {True, False})
    rep.check("legacy PUBLISHED with a PR but no tracking issue",
              any(sc.get("pr") and not sc.get("tracking") for sc in by_status.get("PUBLISHED", [])))

    # ---------------- sim/ files ----------------
    sim = ROOT / "sim"
    try:
        untracked = json.loads((sim / "untracked.json").read_text())
        want = [sc["sim_db"] for sc in scs if sc["home"] == "untracked"]
        rep.check("sim/untracked.json matches untracked scenarios", untracked == want,
                  f"{len(untracked)} rows")
        pj = json.loads((sim / "personas.json").read_text())
        rep.check("sim/personas.json matches scenarios personas",
                  pj == [{k: p[k] for k in ("login", "display_name", "role", "org")} for p in data["personas"]])
        cj = json.loads((sim / "calendar.json").read_text())
        rep.check("sim/calendar.json matches scenarios calendar", cj == data["calendar"])
    except FileNotFoundError as exc:
        rep.check("sim/ files present (run seed.py --export-sim)", False, str(exc))

    # ---------------- banned content ----------------
    hits = []
    pats = [(w, re.compile(rf"(?<![A-Za-z0-9]){re.escape(w)}(?![A-Za-z0-9])", re.I)) for w in DENYLIST]
    for path, s in all_strings(data):
        for w, p in pats:
            if p.search(s):
                hits.append(f"{w} in {path}")
    rep.check("no real vendor / model / product names", not hits, "; ".join(hits[:8]))
    mentions = [p for p, s in all_strings(data) if re.search(r"(?<![\w.`])@[A-Za-z0-9]", s)]
    rep.check("no @-mentions (they would notify real GitHub users)", not mentions, "; ".join(mentions[:5]))
    for p in data["personas"]:
        if p["org"] is not None and p["org"] not in UBUNTU_ORGS:
            hits.append(p["login"])
    rep.check("personas fictional (Ubuntu codenames, chairs, bots)",
              all(p["org"] is None or p["org"] in UBUNTU_ORGS for p in data["personas"]))

    return 0 if rep.print() else 1


if __name__ == "__main__":
    sys.exit(main())
