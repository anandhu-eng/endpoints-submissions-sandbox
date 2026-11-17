#!/usr/bin/env python3
"""Stamp a content version on every script and stylesheet URL in docs/.

GitHub Pages lets browsers cache each file for 10 minutes. Without a version
in the URL, a returning visitor can get a new module next to a cached old one,
and the page fails to load (a missing export stops every module). This script
puts `?v=<hash of docs/js and docs/styles.css>` on the app.js and styles.css
links in index.html and on every relative import in docs/js, so a deploy
changes every URL at once.

Run it after any change under docs/js or to docs/styles.css, before committing:

    python3 scripts/stamp_assets.py            # rewrite the stamps
    python3 scripts/stamp_assets.py --check    # exit 1 if a stamp is stale
"""

import argparse
import hashlib
import re
import sys
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent / "docs"
IMPORT = re.compile(r"""(from\s+'\./[\w-]+\.js)(?:\?v=\w+)?'""")
HTML = re.compile(r"""((?:src="js/app\.js|href="styles\.css))(?:\?v=\w+)?\"""")


def unstamped(text, pattern, end):
    return pattern.sub(lambda m: m.group(1) + end, text)


def version(js_files, css):
    h = hashlib.sha256()
    for f in js_files:
        h.update(f.name.encode())
        h.update(unstamped(f.read_text(), IMPORT, "'").encode())
    h.update(css.read_bytes())
    return h.hexdigest()[:10]


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true", help="report stale stamps, change nothing")
    args = ap.parse_args()

    js_files = sorted((DOCS / "js").glob("*.js"))
    v = version(js_files, DOCS / "styles.css")
    stale = []
    targets = [(f, IMPORT, "'") for f in js_files] + [(DOCS / "index.html", HTML, '"')]
    for f, pattern, end in targets:
        old = f.read_text()
        new = pattern.sub(lambda m: f"{m.group(1)}?v={v}{end}", old)
        if new != old:
            stale.append(f.relative_to(DOCS.parent))
            if not args.check:
                f.write_text(new)

    if args.check and stale:
        print(f"Stale asset stamps (want v={v}): " + ", ".join(map(str, stale)))
        sys.exit(1)
    print(f"v={v}: " + (f"updated {len(stale)} files" if stale else "all stamps current"))


if __name__ == "__main__":
    main()
