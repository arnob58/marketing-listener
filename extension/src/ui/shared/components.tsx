import type { ClusterReport } from '../../analysis/evaluate';
import { useState } from 'preact/hooks';
import type { Snapshot, StoredPost } from '../../core/types';
import { fmtDate, fmtMetric, fmtPct, labelClass, metricParts } from './format';
import { useThumbnailUrl, type ThumbnailLoader } from './thumbnails';

export function Limitations() {
  return (
    <div class="notice">
      "Trending" means trending within the posts your own feeds showed. Every figure comes from a sample, and attribution
      is an estimate with a confidence value, not a certainty.
    </div>
  );
}

export function AttributionTag({ report }: { report: ClusterReport }) {
  const c = report.classification;
  return (
    <span class={labelClass(c.label)} title={c.summary}>
      {c.label} · {fmtPct(c.confidence)}
    </span>
  );
}

/** Independent accounts per day from stored snapshots. */
export function Sparkline({ snapshots, width = 220, height = 48 }: { snapshots: Snapshot[]; width?: number; height?: number }) {
  if (snapshots.length < 2) {
    return <span class="muted">{snapshots.length ? `1 snapshot (${snapshots[0].accounts} accounts)` : 'no snapshots yet'}</span>;
  }
  const max = Math.max(...snapshots.map((s) => s.accounts), 1);
  const pts = snapshots.map((s, i) => {
    const x = (i / (snapshots.length - 1)) * (width - 8) + 4;
    const y = height - 4 - (s.accounts / max) * (height - 8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width={width} height={height} role="img" aria-label="Independent accounts per day">
      <polyline points={pts.join(' ')} fill="none" stroke="var(--accent)" stroke-width="2" />
      {pts.map((p) => {
        const [x, y] = p.split(',');
        return <circle cx={x} cy={y} r="2.5" fill="var(--accent)" />;
      })}
    </svg>
  );
}

/** The stored thumbnail for a post, or an empty frame when none was captured (or it was purged). */
export function PostThumb({ postKey, load }: { postKey: string | null | undefined; load?: ThumbnailLoader }) {
  const url = useThumbnailUrl(postKey, load);
  return url ? <img class="thumb" src={url} alt="" /> : <div class="thumb thumb-empty" aria-hidden="true" />;
}

const LONG_CAPTION = 140;

/** Caption clamped to three lines, with a toggle when it is long enough to be cut. */
export function Caption({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (!text) return <div class="muted">No caption read.</div>;
  const long = text.length > LONG_CAPTION || text.includes('\n');
  return (
    <div>
      <div class={open ? 'caption' : 'caption clamp3'}>{text}</div>
      {long && <button class="link" onClick={() => setOpen(!open)}>{open ? 'Show less' : 'Show more'}</button>}
    </div>
  );
}

/** One post with its content: thumbnail, caption, hashtags, time, counts, sound and link. */
export function PostItem({ post, load }: { post: StoredPost; load?: ThumbnailLoader }) {
  const counts = metricParts(post.metrics);
  return (
    <div class="post">
      <PostThumb postKey={post.key} load={load} />
      <div class="post-body">
        <div>
          <b>@{post.authorHandle}</b> <span class="muted">· {post.platform} · {post.postedAt ? fmtDate(post.postedAt) : 'post time unknown'}{post.kind !== 'original' ? ` · ${post.kind}` : ''}</span>
        </div>
        <Caption text={post.text} />
        {post.hashtags.length > 0 && <div class="hashtags">{post.hashtags.map((h) => `#${h}`).join(' ')}</div>}
        <div class="muted">{counts.length ? counts.join(' · ') : 'no counts shown'} · engagement {fmtMetric(post.engagement)}</div>
        {post.audio && <div class="muted">Sound: {post.audio.title}{post.audio.isOriginal ? ' (original audio)' : ''}</div>}
        <a href={post.url} target="_blank" rel="noreferrer noopener">open</a>
      </div>
    </div>
  );
}
