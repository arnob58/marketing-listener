import { useState } from 'preact/hooks';
import type { ClusterReport } from '../../analysis/evaluate';
import { AttributionTag } from '../shared/components';
import { fmtDate } from '../shared/format';

export function History({ reports, onOpen }: { reports: ClusterReport[]; onOpen: (id: string) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const byDate = [...reports].sort((a, b) => b.firstSeenAt - a.firstSeenAt);
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p.slice(-1), id]));
  const [a, b] = picked.map((id) => reports.find((r) => r.clusterId === id));

  return (
    <div>
      <div class="card">
        <table>
          <thead><tr><th>Compare</th><th>First seen</th><th>Cluster</th><th>Accounts</th><th>Lifecycle</th><th></th></tr></thead>
          <tbody>
            {byDate.map((r) => (
              <tr>
                <td><input type="checkbox" checked={picked.includes(r.clusterId)} onChange={() => toggle(r.clusterId)} /></td>
                <td>{fmtDate(r.firstSeenAt)}</td>
                <td>{r.kind === 'trend' ? 'Trend' : 'Candidate'} · {r.platforms.join(', ')}</td>
                <td>{r.independentAccounts}</td>
                <td>{r.lifecycle.stage ?? 'n/a'}</td>
                <td><button onClick={() => onOpen(r.clusterId)}>Details</button></td>
              </tr>
            ))}
            {!byDate.length && <tr><td colSpan={6} class="muted">No history yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {a && b && (
        <div class="card">
          <h3>Comparison</h3>
          <table>
            <thead><tr><th></th><th>A</th><th>B</th></tr></thead>
            <tbody>
              <tr><td>Independent accounts</td><td>{a.independentAccounts}</td><td>{b.independentAccounts}</td></tr>
              <tr><td>Posts / variants</td><td>{a.totalPosts} / {a.variants}</td><td>{b.totalPosts} / {b.variants}</td></tr>
              <tr><td>Platforms</td><td>{a.platforms.join(', ')}</td><td>{b.platforms.join(', ')}</td></tr>
              <tr><td>Trend score</td><td>{a.trendScore.toFixed(1)}</td><td>{b.trendScore.toFixed(1)}</td></tr>
              <tr><td>Lifecycle</td><td>{a.lifecycle.stage ?? 'n/a'} {a.lifecycle.duration ?? ''}</td><td>{b.lifecycle.stage ?? 'n/a'} {b.lifecycle.duration ?? ''}</td></tr>
              <tr><td>Attribution</td><td><AttributionTag report={a} /></td><td><AttributionTag report={b} /></td></tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
