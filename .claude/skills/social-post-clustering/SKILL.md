---
name: social-post-clustering
description: >-
  Deduplicate and cluster social posts (memes, reels, discussions) locally and incrementally, so variants of one
  idea become one trend with independent-account counts. Covers exact, near-duplicate (perceptual hash, MinHash),
  and semantic (local embeddings) matching, shared-audio grouping, independence rules, centroid updates,
  thresholds and tests with injected vectors. Use when grouping posts across accounts or platforms, preventing
  duplicates from inflating trend scores, or tuning similarity. Triggers on: dedupe, near-duplicate image, dHash,
  MinHash, CLIP, MiniLM, cluster, same meme different caption, cross-platform trend.
---

# Social post clustering (local, incremental)

Companions: `social-trend-attribution` (consumes cluster output), `chrome-extension-passive-listener` (where the
heavy work runs: the offscreen document).

## Stages (cheapest first; stop at the first match)

1. **Exact**: same `platform:postId`. A repost or quote resolves to the original and counts as *propagation*, not as an
   independent post.
2. **Near-duplicate**: 64-bit **dHash** Hamming distance <= 10, or caption **MinHash** Jaccard >= 0.8 -> the post
   becomes a *variant* of the existing item. Catches re-posts, recompression, rescaling, mild crops.
3. **Shared audio**: same non-null audio ID used by a *different* account -> same cluster (reels trend through sounds).
   An account reusing its own sound, including an owner's "original audio", never groups.
4. **Semantic**: similarity = max(image cosine, text cosine) with weighting when both exist. Assign to the best active
   cluster centroid (last 14 days) if image >= 0.88 or text >= 0.80 (defaults, **untuned**); otherwise create a new
   cluster. Update centroids incrementally (running mean, stored count). A nightly pass merges clusters whose centroids
   converge; merging must move snapshots too.

Models (opt-in, local): CLIP ViT-B/32 quantized for images, MiniLM-L6 for English text (~100 MB total, downloaded once
after the user confirms, cached, then offline). Video posts use the poster frame. Process in small batches while idle;
unload after ~2 min of no work. Compute features once per content hash so cross-posted identical images reuse them;
fetch each image once and derive hash and thumbnail from the same bytes (no extra request).

## Independence (what counts as a separate account)

Count distinct authors who are not reposting or quoting each other, not name-similar brand families (strip common
suffixes and trailing digits: `jane1990` and `jane2000` group together, which is a known over-merge), and who posted
within the window. Duplicates by the same account add 0. Preserve the list of participating accounts and per-platform
breakdown for the UI. Coordinated networks can look independent; say so.

## Thumbnails

Store a small JPEG (about 160 px longest side, <= ~12 KB) per post locally because platform image URLs expire in days.
Export post URLs (stable), not thumbnails.

## Testing

- Inject fake embedding vectors; tests must never download a model.
- Dedup set: generate procedural images with identical, recompressed, brightness-shifted, rescaled, cropped and combined
  variants; require precision >= 0.95 and recall >= 0.90 (measured 0.989 / 1.000 on a procedural set; real photos not yet
  measured).
- Scenario tests: 3 unrelated accounts with the same concept -> 1 cluster; same concept on 3 platforms -> 1 cluster with
  per-platform breakdown; 5 accounts Monday, +20 Tuesday -> lifecycle moves Emerging to Accelerating with snapshots
  preserved; same sound on 3 accounts -> 1 cluster with evidence "3 independent accounts used this sound".
- Threshold tuning needs a curated local set of real images and captions; do it after the first model download, with the
  user's confirmation.

## Gotchas

- Without embeddings, only 2 of 131 clusters had more than one post. That is expected: near-duplicate stages alone
  rarely join different wordings of one idea. Enable semantic matching before judging cluster quality.
- Short captions give weak text similarity; prefer image or audio signals for memes and reels.
- Posts with an unresolved author must not form accounts (they would all merge as one "unknown").
