"""Count structural elements in saved page snapshots to see which extractor assumption is false.

Usage:
    python probe_capture.py PAGE.html [PAGE2.html ...] [--pattern NAME=REGEX ...]

Prints one row per page and one column per probe. Compare the counts with what the adapter
assumes: a probe the adapter requires but the page lacks (e.g. header=0 while the adapter needs a
header inside every post) is the broken assumption.

Default probes are generic DOM/social markers; add your own with --pattern, for example
    --pattern 'audio=/reels/audio/' --pattern 'permalink=/posts/\\d+'
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

DEFAULT_PROBES = {
    "article": r"<article\b",
    "header": r"<header\b",
    "video": r"<video\b",
    "time": r"<time\b",
    "role=article": r'role="article"',
    "role=button": r'role="button"',
    "aria-Like": r'aria-label="(?:Like|Unlike)"',
    "aria-Comment": r'aria-label="Comment"',
    "aria-Share/Repost": r'aria-label="(?:Share|Repost)"',
    "data-testid": r"data-testid=",
    "href=/p/": r'href="(?:https://[^"/]+)?/(?:[\w.]+/)?p/',
    "href=/reel(s)/": r'href="(?:https://[^"/]+)?/(?:[\w.]+/)?reels?/',
    "href=/status/": r"/status/\d+",
    "href=/posts/": r"/posts/",
    "dir=auto": r'dir="auto"',
}


def probe(html: str, patterns: dict[str, str]) -> dict[str, int]:
    return {name: len(re.findall(rx, html)) for name, rx in patterns.items()}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pages", nargs="+", type=Path)
    ap.add_argument("--pattern", action="append", default=[], metavar="NAME=REGEX")
    args = ap.parse_args()

    patterns = dict(DEFAULT_PROBES)
    for spec in args.pattern:
        name, sep, rx = spec.partition("=")
        if not sep or not rx:
            ap.error(f"--pattern needs NAME=REGEX, got {spec!r}")
        try:
            re.compile(rx)
        except re.error as e:
            ap.error(f"bad regex in {spec!r}: {e}")
        patterns[name] = rx

    names = list(patterns)
    rows = []
    for page in args.pages:
        if not page.is_file():
            print(f"ERROR: {page} not found", file=sys.stderr)
            return 2
        html = page.read_text(encoding="utf-8", errors="replace")
        rows.append((page.name, len(html) // 1024, probe(html, patterns)))

    width = max(len(r[0]) for r in rows)
    for name, kb, counts in rows:
        print(f"{name:<{width}}  {kb:>5} KB")
        print("  " + "  ".join(f"{n}={counts[n]}" for n in names if counts[n]))
        zero = [n for n in names if not counts[n]]
        print("  absent: " + (", ".join(zero) if zero else "(none)"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
