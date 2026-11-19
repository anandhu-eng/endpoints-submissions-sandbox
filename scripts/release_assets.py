#!/usr/bin/env python3
"""Publish docs/js and docs/styles.css as a fixed build under docs/v/<hash>/.

GitHub Pages ignores query strings and lets browsers cache each file for 10
minutes. After a deploy a visitor can still hold the old index.html, some old
modules, or both; if old and new modules meet, an import fails and the page is
blank. So each build gets its own folder that never changes, and status.html
points at the newest one. A cached old status.html (or, from before the sign-in
page, index.html) still finds every file of its own build. The newest KEEP committed builds stay; older folders, and builds
that were replaced before being committed, are deleted.

Run it after any change under docs/js or to docs/styles.css, before committing:

    python3 scripts/release_assets.py            # copy the build, point status.html at it
    python3 scripts/release_assets.py --check    # exit 1 unless status.html is on the current build, and
                                                 # the build and status.html are committed or staged

docs/js stays the source you edit. Only the copies under docs/v/ are served.
"""

import argparse
import filecmp
import functools
import hashlib
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent / "docs"
BUILDS = DOCS / "v"
LIST = BUILDS / "builds.txt"
# The status page. index.html is the sign-in page, which loads no local scripts.
PAGE = DOCS / "status.html"
# Pages that pointed at a build in earlier commits: index.html was the status page
# before the sign-in page, and a visitor may still have it cached.
PAST_PAGES = ["docs/status.html", "docs/index.html"]
KEEP = 4
BUILD_ID = re.compile(r"^[0-9a-f]{10}$")
# The two local assets status.html loads, with or without a build folder in front.
REFS = re.compile(r"""((?:src|href)=")(?:v/\w+/)?((js/app\.js|styles\.css)")""")
# Any other local script or stylesheet in status.html would not be versioned.
OTHER = re.compile(
    r"""(?:src|href)=["'](?!https?:|//|v/\w+/(?:js/app\.js|styles\.css)["'])[^"']+\.(?:m?js|css)(?:[?#][^"']*)?["']""",
    re.I,
)


def source_files():
    return sorted((DOCS / "js").glob("*.js")) + [DOCS / "styles.css"]


def build_id():
    h = hashlib.sha256()
    for f in source_files():
        h.update(f.relative_to(DOCS).as_posix().encode())
        h.update(f.read_bytes())
    return h.hexdigest()[:10]


def same_as_source(build):
    return all(
        (build / f.relative_to(DOCS)).is_file() and filecmp.cmp(f, build / f.relative_to(DOCS), shallow=False)
        for f in source_files()
    ) and sorted(p.name for p in (build / "js").glob("*.js")) == sorted(p.name for p in (DOCS / "js").glob("*.js"))


@functools.lru_cache(maxsize=None)
def have_git():
    """True when git is installed and the project is inside a git work tree."""
    try:
        r = subprocess.run(["git", "rev-parse", "--is-inside-work-tree"], cwd=DOCS.parent, capture_output=True, text=True)
    except FileNotFoundError:
        return False
    return r.stdout.strip() == "true"


def git(*args):
    """Run git in the project folder. None when have_git() is false."""
    if not have_git():
        return None
    return subprocess.run(["git", *args], cwd=DOCS.parent, capture_output=True, text=True)


def ok(r):
    return r is not None and r.returncode == 0


def untracked(build):
    """Build files or status.html that git would not deploy as they are on disk."""
    paths = [str(p.relative_to(DOCS.parent)) for p in sorted(build.rglob("*")) if p.is_file()] + ["docs/status.html"]
    if not have_git():
        return ["cannot tell: git is not available here"]
    missing = [p for p in paths if not ok(git("ls-files", "--error-unmatch", p))]
    if not ok(git("diff", "--quiet", "--", *paths)):
        missing.append("unstaged changes under docs/v or docs/status.html")
    return missing


def in_ref(ref, b):
    """True if build b exists in commit `ref`."""
    return ok(git("cat-file", "-e", f"{ref}:./docs/v/{b}/js/app.js"))


def deployed_refs():
    """origin/main (what GitHub Pages serves) and this branch's upstream, those that exist."""
    up = git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}")
    refs = ["origin/main"] + ([up.stdout.strip()] if ok(up) else [])
    return [r for i, r in enumerate(refs) if r not in refs[:i] and ok(git("rev-parse", "--verify", "--quiet", r))]


def live_builds(ref, pushes=4):
    """Builds loaded by the deployed status page and by the status page of the last few pushes
    (this clone's reflog of the deployed branch), since visitors may still have those cached.
    These are never deleted."""
    found = set()
    for i in range(pushes):
        rev = f"{ref}@{{{i}}}" if i else ref
        for page in PAST_PAGES:
            r = git("show", f"{rev}:./{page}")
            if ok(r):
                found |= set(re.findall(r"v/([0-9a-f]{10})/", r.stdout))
    return found


def added_at(b):
    """Commit time when build b first appeared, to order builds missing from builds.txt."""
    r = git("log", "--diff-filter=A", "--format=%ct", "--", f"docs/v/{b}/js/app.js")
    out = r.stdout.split() if ok(r) else []
    return int(out[-1]) if out else 0


def copy_build(build):
    """Copy the source into a temp folder, then move it into place, so a crash leaves no half build."""
    shutil.rmtree(build, ignore_errors=True)
    tmp = Path(tempfile.mkdtemp(dir=BUILDS))
    (tmp / "js").mkdir()
    for f in source_files():
        shutil.copy2(f, tmp / f.relative_to(DOCS))
    tmp.rename(build)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true", help="report problems, change nothing")
    args = ap.parse_args()

    bid = build_id()
    build = BUILDS / bid
    index = PAGE
    html = index.read_text(encoding="utf-8")
    new_html = REFS.sub(lambda m: f"{m.group(1)}v/{bid}/{m.group(2)}", html)

    problems = [f"status.html loads {m} without a build folder" for m in OTHER.findall(new_html)]
    loads = [m[2] for m in REFS.findall(html)]
    if sorted(loads) != ["js/app.js", "styles.css"]:
        problems.append("status.html must load js/app.js and styles.css exactly once each")
    if args.check:
        if new_html != html:
            problems.append(f"status.html does not point at the current build v/{bid}/")
        if not build.is_dir() or not same_as_source(build):
            problems.append(f"docs/v/{bid}/ is missing or differs from docs/js and docs/styles.css")
        elif not problems:
            missing = untracked(build)
            if missing:
                print("\n".join(f"not committed or staged: {p}" for p in missing) + "\nStage them: git add docs/v docs/status.html")
                sys.exit(1)
    if problems:
        print("\n".join(problems) + "\nRun: python3 scripts/release_assets.py")
        sys.exit(1)
    if args.check:
        print(f"v/{bid}: current and staged for commit")
        return

    BUILDS.mkdir(exist_ok=True)
    if not build.is_dir() or not same_as_source(build):
        copy_build(build)
    if new_html != html:
        index.write_text(new_html, encoding="utf-8")

    listed = [b for b in (LIST.read_text().split() if LIST.exists() else []) if BUILD_ID.match(b)]
    on_disk = sorted(p.name for p in BUILDS.iterdir() if p.is_dir() and BUILD_ID.match(p.name))
    if not have_git():
        # Without git we cannot tell which builds are live, so delete nothing.
        LIST.write_text("\n".join([b for b in listed if b != bid] + [bid]) + "\n")
        print(f"v/{bid}: status.html points here. git not available: no old builds deleted.")
        return
    # Only committed builds can be live or cached by a visitor, so only they count toward KEEP.
    # A build made while iterating and never committed is deleted as soon as it is replaced.
    # The build the deployed branch serves is never deleted; with no deployed branch known,
    # no committed build is deleted.
    refs = deployed_refs()
    live = set().union(*(live_builds(r) for r in refs)) if refs else None
    committed = [b for b in on_disk if b != bid and in_ref("HEAD", b)]
    unlisted = sorted((b for b in committed if b not in listed), key=added_at)
    order = unlisted + [b for b in listed if b in committed] + [bid]
    keep = set(order[-KEEP:]) | (live if live is not None else set(committed))
    for old in [b for b in on_disk if b not in keep]:
        shutil.rmtree(BUILDS / old, ignore_errors=True)
    kept = [b for b in on_disk if b in keep and b not in order] + [b for b in order if b in keep]
    LIST.write_text("\n".join(kept) + "\n")
    note = f"; live on {', '.join(refs)}: {', '.join(sorted(live)) or 'none'}" if refs else "; no deployed branch found, committed builds kept"
    print(f"v/{bid}: status.html points here; kept {', '.join(kept)}{note}")


if __name__ == "__main__":
    main()
