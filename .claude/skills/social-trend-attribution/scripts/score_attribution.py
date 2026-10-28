"""Reference implementation of the content-driven vs publisher-driven scoring model.

Usage:
    python score_attribution.py CASE.json        # one case or a list of cases
    python score_attribution.py --selftest       # built-in scenarios, exit 1 on any failure

A case is JSON:
{
  "name": "Nike post",
  "engagement": 50000,                 # focal post, point estimate
  "engagement_low": 47500, "engagement_high": 52500,   # optional range (abbreviated counts)
  "history": [4800, 51000, 49000, ...],  # the account's OTHER posts' engagement; omit/[] if unknown
  "independent_accounts": 1,           # distinct, non-reposting accounts with the same idea
  "followers": 12000000,               # null if unknown
  "verified": true,
  "platforms": 1,
  "n_posts": 1
}
Prints label, score (0..1, higher = more content-driven), confidence, per-signal contributions and
what data was missing. Thresholds mirror the Marketing Listener project defaults; edit CONFIG to tune.
Verdicts are estimates, never facts: always show confidence and the missing-data list with the label.
"""
from __future__ import annotations

import json
import math
import statistics
import sys
from pathlib import Path

CONFIG = {
    "min_trend_accounts": 3,
    "min_baseline_posts": 5,
    "high_engagement": 1000,
    "small_account_followers": 10_000,
    "large_account_followers": 1_000_000,
    "min_mad": 0.3,          # log units; floor so a tight history cannot make everything extreme
    "mad_scale": 1.4826,
    "min_confidence": 0.35,
    "max_confidence": 0.90,
    "content_threshold": 0.65,
    "publisher_threshold": 0.35,
}
WEIGHTS = {"overperformance": 3, "adoption": 3, "noAdoption": 2, "smallAccount": 2, "crossPlatform": 2, "tierPrior": 1}


def log_e(x: float) -> float:
    return math.log1p(max(0.0, x))


def baseline(history: list[float]):
    if len(history) < CONFIG["min_baseline_posts"]:
        return None
    logs = [log_e(h) for h in history]
    m = statistics.median(logs)
    mad = CONFIG["mad_scale"] * statistics.median(abs(x - m) for x in logs)
    return m, max(CONFIG["min_mad"], mad)


def score(case: dict) -> dict:
    eng = float(case["engagement"])
    followers = case.get("followers")
    verified = bool(case.get("verified", False))
    n_acc = int(case.get("independent_accounts", 1))
    platforms = int(case.get("platforms", 1))
    base = baseline(list(case.get("history") or []))
    signals: dict[str, dict] = {}

    z = None
    c = 0.0
    if base:
        z = (log_e(eng) - base[0]) / base[1]
        if z >= 2:
            c = 1.5 + min(1.0, (z - 2) / 4)
        elif abs(z) < 1:
            c = -1.5
        elif z <= -1:
            c = -1.0
    signals["overperformance"] = {"available": base is not None, "contribution": c, "z": z}

    c = 0.0
    if n_acc >= CONFIG["min_trend_accounts"]:
        c = min(2.5, 1.5 + 0.3 * (n_acc - CONFIG["min_trend_accounts"]))
    signals["adoption"] = {"available": True, "contribution": c, "accounts": n_acc}

    high = eng >= CONFIG["high_engagement"]
    signals["noAdoption"] = {"available": True, "contribution": -0.8 if n_acc <= 1 and high else 0.0}

    ratio = eng / followers if followers else None
    small = followers is not None and followers < CONFIG["small_account_followers"]
    signals["smallAccount"] = {
        "available": followers is not None,
        "contribution": 1.0 if small and ratio is not None and ratio >= 1 else 0.0,
        "ratio": ratio,
    }
    signals["crossPlatform"] = {"available": True, "contribution": 1.0 if platforms >= 2 else 0.0}
    large = (followers or 0) >= CONFIG["large_account_followers"] or verified
    signals["tierPrior"] = {
        "available": followers is not None or verified,
        "contribution": -0.4 if large else 0.0,
    }

    log_odds = sum(s["contribution"] for s in signals.values() if s["available"])
    prob = min(0.98, max(0.02, 1 / (1 + math.exp(-log_odds))))

    total = sum(WEIGHTS.values())
    avail = sum(WEIGHTS[k] for k, s in signals.items() if s["available"])
    lo, hi = case.get("engagement_low"), case.get("engagement_high")
    width = min(1.0, (hi - lo) / (2 * eng)) if lo is not None and hi is not None and eng > 0 else 0.0
    quality = (1 - min(0.5, width * 4)) * min(1.0, 0.7 + 0.1 * int(case.get("n_posts", 1)))
    confidence = min(CONFIG["max_confidence"], avail / total * quality)

    if confidence < CONFIG["min_confidence"]:
        label = "Insufficient evidence"
    elif prob >= CONFIG["content_threshold"]:
        label = "Likely content-driven"
    elif prob <= CONFIG["publisher_threshold"]:
        label = "Likely publisher-driven"
    else:
        label = "Mixed"

    missing = []
    if base is None:
        missing.append(f"baseline unknown ({len(case.get('history') or [])} other posts; {CONFIG['min_baseline_posts']} needed)")
    if followers is None:
        missing.append("follower count unknown")
    return {"name": case.get("name", ""), "label": label, "score": round(prob, 3),
            "confidence": round(confidence, 3), "signals": signals, "missing": missing}


SELFTEST = [
    ("brand at its normal level, no adoption", {"engagement": 50000, "history": [48000, 52000, 47000, 51000, 49500, 50500],
     "independent_accounts": 1, "followers": 12_000_000, "verified": True}, "Likely publisher-driven"),
    ("tiny account far above its normal", {"engagement": 8000, "history": [90, 110, 100, 95, 105, 120],
     "independent_accounts": 1, "followers": 900}, "Likely content-driven"),
    ("same meme on three unrelated accounts", {"engagement": 12000, "history": [], "independent_accounts": 3,
     "followers": 4000, "platforms": 1, "n_posts": 3}, "Likely content-driven"),
    # Mirrors a real export row: one X post, abbreviated count (1,006-2,006), no baseline, no followers.
    ("no baseline, no followers, abbreviated count", {"engagement": 1506, "engagement_low": 1006, "engagement_high": 2006,
     "history": [], "independent_accounts": 1}, "Insufficient evidence"),
]


def selftest() -> int:
    failures = 0
    for name, case, want in SELFTEST:
        got = score({**case, "name": name})
        ok = got["label"] == want
        failures += not ok
        print(f"{'ok  ' if ok else 'FAIL'} {name}: {got['label']} (score {got['score']}, confidence {got['confidence']})")
    return 1 if failures else 0


def main() -> int:
    if len(sys.argv) == 2 and sys.argv[1] == "--selftest":
        return selftest()
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    try:
        data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2
    for case in data if isinstance(data, list) else [data]:
        print(json.dumps(score(case), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
