import { useEffect, useState } from 'preact/hooks';
import type { ClusterDetail } from '../../core/messages';
import { rpc } from '../shared/api';
import { AttributionTag, PostItem, Sparkline } from '../shared/components';
import { fmtMetric, fmtPct } from '../shared/format';

export function ClusterView({ id, onBack }: { id: string; onBack: () => void }) {
  const [detail, setDetail] = useState<ClusterDetail | null | undefined>(undefined);
  useEffect(() => {
    void rpc({ type: 'ui:cluster', id }).then(setDetail);
  }, [id]);

  if (detail === undefined) return <div class="muted">Loading...</div>;
  if (detail === null) return <div><button onClick={onBack}>Back</button> Cluster not found.</div>;
  const { report: r, posts, accounts, snapshots } = detail;
  const c = r.classification;
  const originals = posts.filter((p) => !p.variantOf).sort((a, b) => b.engagement.value - a.engagement.value);
  const variants = posts.filter((p) => p.variantOf);

  return (
    <div>
      <button onClick={onBack}>Back to trends</button>
      <h2>{r.kind === 'trend' ? 'Trend' : 'Viral post candidate'} · {r.independentAccounts} independent accounts</h2>

      <div class="card">
        <AttributionTag report={r} />
        <p>{c.summary}</p>
        <h3>Evidence</h3>
        <ul class="evidence">
          {c.evidence.map((e) => <li><b>{e.direction === 'content' ? 'Toward content-driven' : e.direction === 'publisher' ? 'Toward publisher-driven' : 'Context'}:</b> {e.text}</li>)}
        </ul>
        <h3>Missing or uncertain data</h3>
        {c.missingData.length ? <ul class="evidence">{c.missingData.map((m) => <li>{m}</li>)}</ul> : <div class="muted">None noted.</div>}
        <h3>Sample sizes</h3>
        <div class="muted">
          {c.sampleSizes.posts} posts · {c.sampleSizes.independentAccounts} independent accounts · {c.sampleSizes.platforms} platforms · confidence {fmtPct(c.confidence)} · content score {c.score.toFixed(2)}
        </div>
      </div>

      <div class="card">
        <h3>Lifecycle</h3>
        <div>
          {r.lifecycle.stage ?? 'Not enough accounts for a lifecycle stage'}
          {r.lifecycle.duration && ` · ${r.lifecycle.duration}`}
          <span class="muted"> · new accounts per 24h window (latest first): {r.lifecycle.windows.join(', ')}</span>
        </div>
        <Sparkline snapshots={snapshots} />
      </div>

      <div class="card">
        <h3>Per platform</h3>
        <table>
          <thead><tr><th>Platform</th><th>Posts</th><th>Accounts</th><th>Median engagement</th></tr></thead>
          <tbody>{r.perPlatform.map((p) => <tr><td>{p.platform}</td><td>{p.posts}</td><td>{p.accounts}</td><td>{Math.round(p.medianEngagement).toLocaleString()}</td></tr>)}</tbody>
        </table>
      </div>

      <div class="card">
        <h3>Representative posts</h3>
        {originals.map((p) => <PostItem post={p} />)}
        {variants.length > 0 && (
          <>
            <h3>Variants ({variants.length}) of near-duplicate posts</h3>
            <ul class="evidence">{variants.map((p) => <li>@{p.authorHandle} · {p.platform} · <a href={p.url} target="_blank" rel="noreferrer noopener">open</a></li>)}</ul>
          </>
        )}
      </div>

      <div class="card">
        <h3>Participating accounts</h3>
        <table>
          <thead><tr><th>Account</th><th>Platform</th><th>Followers</th><th>Verified</th></tr></thead>
          <tbody>{accounts.map((a) => <tr><td>@{a.handle}</td><td>{a.platform}</td><td>{fmtMetric(a.followers)}</td><td>{a.verified ? 'yes' : 'unknown/no'}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
