---
name: social-trend-attribution
description: >-
  Estimate whether a post's or meme's popularity is content-driven (the idea is spreading) or
  publisher-driven (an established account's usual audience), with explainable signals, confidence and
  missing-data lists, plus trend scoring and lifecycle stages (emerging, accelerating, established, declining).
  Use when ranking social posts or trends, explaining why something went viral, building a social-listening
  dashboard, or reviewing such a classifier. Includes a runnable reference scorer with self-tests. Triggers on:
  viral, trending, brand vs organic, engagement baseline, influencer effect, trend lifecycle.
---

# Content-driven vs publisher-driven attribution

Companion: `social-post-clustering` (produces the clusters and independent-account counts this skill consumes).

## Principles

- High engagement is not a trend. Popularity can come from the content or from who posted it; the data only
  supports an **estimate**. Show label + score + confidence + evidence + **missing data** together, in hedged language
  ("evidence suggests"). Never present a label as fact.
- Score only what is observed. A signal with no data is **unavailable** (excluded from the score and from confidence),
  not zero.
- Count **distinct independent accounts**, never posts. Reposts, quotes and same-account duplicates add nothing.
- Trending means trending **in the user's observed sample**. Display sample sizes with every metric.

## Signals (log-odds toward content positive, publisher negative)

| Signal | Rule | Weight |
|---|---|---|
| Over-performance | z = (log1p(E) - median) / MAD vs the account's other posts (excluding this one). z >= 2: +1.5 to +2.5. \|z\| < 1: -1.5. z <= -1: -1 | 3 |
| Independent adoption | accounts >= 3: +1.5 +0.3 per extra account, max 2.5 | 3 |
| Big numbers, no adoption | <= 1 account and E >= 1000: -0.8 | 2 |
| Small account punching up | followers < 10k and E/followers >= 1: +1 | 2 |
| Cross-platform | 2+ platforms: +1 | 2 |
| Large or verified account (weak prior) | followers >= 1M or verified: -0.4 | 1 |

Baseline: needs >= 5 other posts from the account; MAD is scaled (x1.4826) and floored at 0.3 log units so a tight
history cannot make everything extreme. Engagement E = likes + comments + shares (+ views where the platform exposes
them); keep counts as ranges when abbreviated.

**Score** = sigmoid(sum of available contributions), clamped to [0.02, 0.98]; higher = more content-driven.
**Confidence** = (available weight / total weight) x data quality (count precision, number of posts), capped at 0.90.
**Label**: confidence < 0.35 -> *Insufficient evidence*; score >= 0.65 -> *Likely content-driven*; score <= 0.35 ->
*Likely publisher-driven*; otherwise *Mixed*.

Run `python scripts/score_attribution.py --selftest` (exit 1 on failure) or pass a case JSON to reproduce a verdict
and test threshold changes. It matches a real export row exactly (score 0.31, confidence 0.215 for one abbreviated X
post with no baseline).

## What is usually missing (and why most verdicts say "Insufficient evidence")

- Baselines: feeds rarely show an account 5+ times. Use a user-triggered "sample baseline" on profile pages; on
  Instagram profile grids show no likes, so Instagram baselines accrue only from feed sightings.
- Follower counts: absent from most feed DOMs; read from profile pages.
- Each missing item must be listed with the instruction to fix it ("use Sample baseline on @handle's profile").

## Trend score and lifecycle

- Trend score = f(log distinct independent accounts, robust engagement using the **median per account** so one brand
  post cannot dominate, platform count, velocity). Clusters with 1-2 accounts are "viral post candidates", not trends
  (default minimum 3).
- Daily snapshot per cluster (accounts, posts, median engagement, platforms) enables lifecycle:
  Emerging (first seen < 48 h, >= 3 accounts); Accelerating (new accounts in last 24 h >= 1.5x the prior 24 h);
  Established (active >= 3 days, ratio 0.67-1.5); Declining (ratio < 0.67 for 2 windows, or no sighting for 72 h).
  Tag short-lived vs sustained by peak-to-span ratio. Never overwrite earlier days' snapshots.

## Known weaknesses (fix before trusting at scale)

- A shared sound/audio across independent accounts is a strong Reels trend signal but is shown as evidence text only;
  it does not change the score. Consider giving it the same weight as independent adoption.
- The small-account rule needs engagement >= followers, which is strict; a ratio near 0.3 may be more realistic.
- "Independent" is approximated (distinct authors, not reposts/quotes, not name-similar brand families). Coordinated
  meme-page networks look independent; the UI must say so.
- Thresholds are defaults, untuned on real data.

## Test scenarios to keep

Brand at its usual level with no adoption -> publisher-driven. Tiny account at ~80x its usual -> content-driven. Same
meme across 3 unrelated accounts -> one cluster, content-driven, evidence cites independent adoption. Missing baseline
-> lower confidence and "baseline unknown" in missing data. Same meme on 3 platforms -> one cluster with per-platform
breakdown.
