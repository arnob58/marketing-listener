"""Summarise an extension JSON export per platform and flag extraction failures.

Usage:
    python diagnose_export.py EXPORT.json [--min-posts 5]

Reads schema v2 (`posts`) or v1 (`clusters`). Exit code 0 when no red flags, 1 when any are raised,
2 on unreadable input. Red flags:
  - a platform with fewer than --min-posts posts (adapter may read nothing),
  - every post on a platform has zero engagement (counts not extracted),
  - one author repeated across many unrelated posts (author resolution fell back to a URL word),
  - an author that is a URL/path word such as groups, photo, watch, p, reel, explore, status,
  - only one URL shape on a platform (e.g. only /reel/ although the feed was browsed).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

PATH_WORDS = {
    "groups", "photo", "photos", "watch", "p", "reel", "reels", "tv", "explore", "status", "home",
    "search", "stories", "unknown", "i", "hashtag", "share", "permalink", "posts", "videos", "people",
}


def engagement(post: dict) -> float:
    if "engagement" in post and post["engagement"] not in (None, ""):
        return float(post["engagement"])
    return sum(float(post.get(k) or 0) for k in ("likes", "comments", "shares", "views"))


def url_shape(url: str) -> str:
    path = re.sub(r"^https?://[^/]+", "", url or "")
    path = re.sub(r"[?#].*$", "", path)
    return re.sub(r"[A-Za-z0-9_.-]{6,}", "*", path)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("export", type=Path)
    ap.add_argument("--min-posts", type=int, default=5)
    args = ap.parse_args()

    try:
        data = json.loads(args.export.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as e:
        print(f"ERROR: cannot read {args.export}: {e}", file=sys.stderr)
        return 2
    posts = data.get("posts") if isinstance(data.get("posts"), list) else data.get("clusters")
    if not isinstance(posts, list):
        print("ERROR: no `posts` or `clusters` array in export", file=sys.stderr)
        return 2

    print(f"schemaVersion {data.get('schemaVersion')}, {len(posts)} posts")
    flags: list[str] = []
    for platform in sorted({p.get("platform", "?") for p in posts}):
        group = [p for p in posts if p.get("platform") == platform]
        zero = sum(1 for p in group if engagement(p) == 0)
        authors = Counter((p.get("author") or "").lower() for p in group)
        shapes = Counter(url_shape(p.get("url", "")) for p in group)
        with_text = sum(1 for p in group if (p.get("text") or "").strip())
        print(f"\n{platform}: {len(group)} posts, zero engagement {zero}, with caption {with_text}, "
              f"{len(authors)} distinct authors")
        print("  url shapes: " + ", ".join(f"{s} x{n}" for s, n in shapes.most_common(5)))
        print("  top authors: " + ", ".join(f"{a or '(none)'} x{n}" for a, n in authors.most_common(5)))

        if len(group) < args.min_posts:
            flags.append(f"{platform}: only {len(group)} posts")
        if group and zero == len(group):
            flags.append(f"{platform}: every post has zero engagement (counts not extracted)")
        bad = sorted(a for a in authors if a in PATH_WORDS)
        if bad:
            flags.append(f"{platform}: author is a path word: {', '.join(bad)}")
        top, n = authors.most_common(1)[0] if authors else ("", 0)
        if len(group) >= 10 and n / len(group) > 0.5 and top:
            flags.append(f"{platform}: author '{top}' on {n}/{len(group)} posts (author resolution suspect)")
        if len(group) >= 10 and len(shapes) == 1:
            flags.append(f"{platform}: only one URL shape ({next(iter(shapes))})")

    print("\nRED FLAGS" if flags else "\nno red flags")
    for f in flags:
        print(f"  - {f}")
    return 1 if flags else 0


if __name__ == "__main__":
    sys.exit(main())
