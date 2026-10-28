import { useEffect, useState } from 'preact/hooks';
import type { Settings } from '../../core/settings';
import { OPTIONAL_HOST_PERMISSIONS } from '../../manifest';
import type { HealthRecord } from '../../storage/db';
import { rpc } from '../shared/api';
import { fmtPct } from '../shared/format';

const FIELDS = ['author', 'text', 'timestamp', 'url', 'metrics', 'media'] as const;

export function SettingsPanel() {
  const [s, setS] = useState<Settings | null>(null);
  const [health, setHealth] = useState<HealthRecord[]>([]);
  const [note, setNote] = useState('');

  useEffect(() => {
    void rpc({ type: 'ui:settings' }).then(setS);
    void rpc({ type: 'ui:health' }).then(setHealth);
  }, []);
  if (!s) return <div class="muted">Loading...</div>;

  const save = async (patch: Partial<Settings>) => {
    setS(await rpc({ type: 'ui:saveSettings', patch }));
    setNote('Saved.');
  };
  const num = (v: string) => Number(v);

  // chrome.permissions.request must run directly inside the click handler.
  const toggleModel = async (checked: boolean) => {
    if (checked) {
      const granted = await chrome.permissions.request({ origins: OPTIONAL_HOST_PERMISSIONS });
      if (!granted) return setNote('Permission was not granted, so the models stay off.');
      setNote('Models enabled. They download from Hugging Face once (roughly 100 MB), then run offline.');
    } else {
      await chrome.permissions.remove({ origins: OPTIONAL_HOST_PERMISSIONS });
      setNote('Models disabled. Perceptual hashes and caption matching still work.');
    }
    await save({ modelOptIn: checked });
  };

  const purge = async () => {
    if (!confirm('Delete every collected post, cluster and snapshot? This cannot be undone.')) return;
    await rpc({ type: 'ui:purgeAll' });
    setNote('All local data deleted.');
  };

  return (
    <div>
      {note && <div class="notice">{note}</div>}
      <div class="card">
        <h3>Scan caps</h3>
        <div class="row">
          <label>Max posts (hard limit 200) <input type="number" min="1" max="200" value={s.scan.maxPosts} onChange={(e) => save({ scan: { ...s.scan, maxPosts: num(e.currentTarget.value) } })} /></label>
          <label>Max minutes <input type="number" min="1" max="15" value={s.scan.maxMs / 60000} onChange={(e) => save({ scan: { ...s.scan, maxMs: num(e.currentTarget.value) * 60000 } })} /></label>
          <label>Seconds per screen <input type="number" min="1" max="60" value={s.scan.intervalMs / 1000} onChange={(e) => save({ scan: { ...s.scan, intervalMs: num(e.currentTarget.value) * 1000 } })} /></label>
        </div>
      </div>

      <div class="card">
        <h3>Thresholds</h3>
        <div class="row">
          <label>Independent accounts for a trend <input type="number" min="2" max="20" value={s.thresholds.minTrendAccounts} onChange={(e) => save({ thresholds: { ...s.thresholds, minTrendAccounts: num(e.currentTarget.value) } })} /></label>
          <label>Image similarity <input type="number" step="0.01" min="0.5" max="1" value={s.thresholds.imageSimilarity} onChange={(e) => save({ thresholds: { ...s.thresholds, imageSimilarity: num(e.currentTarget.value) } })} /></label>
          <label>Text similarity <input type="number" step="0.01" min="0.5" max="1" value={s.thresholds.textSimilarity} onChange={(e) => save({ thresholds: { ...s.thresholds, textSimilarity: num(e.currentTarget.value) } })} /></label>
          <label>Image hash distance <input type="number" min="0" max="32" value={s.thresholds.dhashMaxDistance} onChange={(e) => save({ thresholds: { ...s.thresholds, dhashMaxDistance: num(e.currentTarget.value) } })} /></label>
        </div>
        <p class="muted">Similarity thresholds apply to the optional embedding models and have not been tuned on real data yet.</p>
      </div>

      <div class="card">
        <h3>Embedding models (optional)</h3>
        <label><input type="checkbox" checked={s.modelOptIn} onChange={(e) => toggleModel(e.currentTarget.checked)} /> Download MiniLM (text) and CLIP (image) models from Hugging Face, once, then run offline</label>
        <p class="muted">Without them, clustering uses perceptual image hashes and caption overlap only.</p>
      </div>

      <div class="card">
        <h3>Retention and data</h3>
        <label>Keep data for (days) <input type="number" min="1" value={s.retentionDays} onChange={(e) => save({ retentionDays: num(e.currentTarget.value) })} /></label>
        <div style="margin-top:8px"><button class="danger" onClick={purge}>Purge all data</button></div>
      </div>

      <div class="card">
        <h3>Extraction health</h3>
        <table>
          <thead><tr><th>Adapter</th><th>Selectors</th><th>Posts</th>{FIELDS.map((f) => <th>{f}</th>)}</tr></thead>
          <tbody>
            {health.map((h) => (
              <tr>
                <td>{h.platform}</td><td>{h.selectorVersion}</td><td>{h.posts}</td>
                {FIELDS.map((f) => {
                  const ratio = h.posts ? h[f] / h.posts : 0;
                  return <td class={ratio < 0.9 ? 'bad' : ''}>{fmtPct(ratio)}</td>;
                })}
              </tr>
            ))}
            {!health.length && <tr><td colSpan={9} class="muted">No posts extracted yet.</td></tr>}
          </tbody>
        </table>
        <p class="muted">A field below 90% usually means the platform changed its markup. See workflows/update_platform_selectors.md.</p>
      </div>
    </div>
  );
}
