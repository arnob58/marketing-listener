import { useMemo, useState } from 'preact/hooks';
import type { ClusterReport } from '../../analysis/evaluate';
import type { AttributionLabel, LifecycleStage, Platform } from '../../core/types';
import { AttributionTag, PostThumb } from '../shared/components';
import { fmtDate } from '../shared/format';

export interface Filters {
  platform: Platform | '';
  lifecycle: LifecycleStage | '';
  attribution: AttributionLabel | '';
  from: string;
  to: string;
  trendsOnly: boolean;
}

export const NO_FILTERS: Filters = { platform: '', lifecycle: '', attribution: '', from: '', to: '', trendsOnly: false };

export function applyFilters(reports: ClusterReport[], f: Filters): ClusterReport[] {
  const from = f.from ? Date.parse(f.from) : -Infinity;
  const to = f.to ? Date.parse(f.to) + 86_399_999 : Infinity;
  return reports.filter(
    (r) =>
      (!f.platform || r.platforms.includes(f.platform)) &&
      (!f.lifecycle || r.lifecycle.stage === f.lifecycle) &&
      (!f.attribution || r.classification.label === f.attribution) &&
      (!f.trendsOnly || r.kind === 'trend') &&
      r.lastSeenAt >= from &&
      r.firstSeenAt <= to,
  );
}

export function Trends({ reports, onOpen }: { reports: ClusterReport[]; onOpen: (id: string) => void }) {
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const shown = useMemo(() => applyFilters(reports, filters), [reports, filters]);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters({ ...filters, [k]: v });

  return (
    <div>
      <div class="row card">
        <label>Platform <select value={filters.platform} onChange={(e) => set('platform', e.currentTarget.value as Platform | '')}>
          <option value="">all</option><option>x</option><option>instagram</option><option>facebook</option></select></label>
        <label>Lifecycle <select value={filters.lifecycle} onChange={(e) => set('lifecycle', e.currentTarget.value as LifecycleStage | '')}>
          <option value="">all</option><option>Emerging</option><option>Accelerating</option><option>Established</option><option>Declining</option></select></label>
        <label>Attribution <select value={filters.attribution} onChange={(e) => set('attribution', e.currentTarget.value as AttributionLabel | '')}>
          <option value="">all</option><option>Likely content-driven</option><option>Likely publisher-driven</option><option>Mixed</option><option>Insufficient evidence</option></select></label>
        <label>From <input type="date" value={filters.from} onChange={(e) => set('from', e.currentTarget.value)} /></label>
        <label>To <input type="date" value={filters.to} onChange={(e) => set('to', e.currentTarget.value)} /></label>
        <label><input type="checkbox" checked={filters.trendsOnly} onChange={(e) => set('trendsOnly', e.currentTarget.checked)} /> trends only</label>
      </div>
      <div class="card">
        <table>
          <thead>
            <tr><th>Cluster</th><th>Accounts</th><th>Platforms</th><th>Lifecycle</th><th>Attribution</th><th>Score</th><th>Last seen</th></tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr class="clickable" onClick={() => onOpen(r.clusterId)}>
                <td>
                  <div class="lead">
                    <PostThumb postKey={r.lead?.key} />
                    <div>
                      {r.kind === 'trend' ? 'Trend' : 'Viral post candidate'} <span class="muted">({r.totalPosts} posts, {r.variants} variants)</span>
                      {r.lead?.text && <div class="clamp2">{r.lead.text}</div>}
                      {r.lead?.audioTitle && <div class="muted">Sound: {r.lead.audioTitle}</div>}
                    </div>
                  </div>
                </td>
                <td>{r.independentAccounts}</td>
                <td>{r.platforms.join(', ')}</td>
                <td>{r.lifecycle.stage ?? <span class="muted">n/a</span>} {r.lifecycle.duration && <span class="muted">· {r.lifecycle.duration}</span>}</td>
                <td><AttributionTag report={r} /></td>
                <td>{r.trendScore.toFixed(1)}</td>
                <td>{fmtDate(r.lastSeenAt)}</td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={7} class="muted">Nothing matches. Browse feeds or run a scan, or loosen the filters.</td></tr>}
          </tbody>
        </table>
        <p class="muted">Based on {reports.length} clusters from posts your own feeds showed; sample sizes are listed in each cluster.</p>
      </div>
    </div>
  );
}
