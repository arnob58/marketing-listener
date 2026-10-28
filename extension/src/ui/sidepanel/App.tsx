import { useCallback, useEffect, useState } from 'preact/hooks';
import { getAdapterForUrl } from '../../adapters';
import type { ClusterReport } from '../../analysis/evaluate';
import type { Stats, TabCommand, TabReply } from '../../core/messages';
import type { Settings } from '../../core/settings';
import type { ScanState } from '../../content/scanner';
import { rpc } from '../shared/api';
import { AttributionTag, Limitations } from '../shared/components';
import { fmtDate, snapshotFileName } from '../shared/format';
import { requestDownloads, saveSnapshotFile } from '../shared/saveFile';

const REASONS: Record<string, string> = {
  post_cap: 'post cap reached',
  time_cap: 'time cap reached',
  user_input: 'you used the page',
  tab_hidden: 'tab was hidden',
  challenge: 'a login wall or challenge page appeared (scan stopped, nothing is bypassed)',
  blocked_surface: 'this is a private surface and is never read',
  end_of_feed: 'end of feed',
  manual: 'stopped by you',
};

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function command(cmd: TabCommand): Promise<TabReply> {
  const tab = await activeTab();
  if (!tab?.id) return { ok: false, reason: 'no_tab' };
  try {
    return (await chrome.tabs.sendMessage(tab.id, cmd)) as TabReply;
  } catch {
    return { ok: false, reason: 'Reload the page once so the extension can attach.' };
  }
}

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [top, setTop] = useState<ClusterReport[]>([]);
  const [scan, setScan] = useState<ScanState | null>(null);
  const [platform, setPlatform] = useState<string | null>(null);
  const [surface, setSurface] = useState<string>('');
  const [message, setMessage] = useState<string>('');

  const refresh = useCallback(async () => {
    const tab = await activeTab();
    const adapter = tab?.url ? getAdapterForUrl(tab.url) : null;
    setPlatform(adapter?.id ?? null);
    setSurface(adapter && tab?.url ? adapter.surface(tab.url) : '');
    const [s, st, reports] = await Promise.all([rpc({ type: 'ui:settings' }), rpc({ type: 'ui:stats' }), rpc({ type: 'ui:reports' })]);
    setSettings(s);
    setStats(st);
    setTop(reports.slice(0, 5));
    if (adapter) {
      const r = await command({ type: 'scan:status' });
      if (r.ok && r.state) setScan(r.state);
    }
  }, []);

  useEffect(() => {
    void refresh().catch((e: Error) => setMessage(e.message));
    const timer = setInterval(() => void refresh().catch(() => {}), 3000);
    const onMsg = (m: { type?: string; state?: ScanState }) => {
      if (m?.type === 'scan:state' && m.state) setScan(m.state);
    };
    chrome.runtime.onMessage.addListener(onMsg);
    chrome.tabs.onActivated.addListener(() => void refresh());
    return () => {
      clearInterval(timer);
      chrome.runtime.onMessage.removeListener(onMsg);
    };
  }, [refresh]);

  const run = async (cmd: TabCommand, okText: string) => {
    const r = await command(cmd);
    setMessage(r.ok ? okText : r.reason);
    if (r.ok && r.state) setScan(r.state);
    if (r.ok && r.sampled !== undefined) setMessage(`Sampled @${r.handle}: ${r.sampled} posts, followers ${r.followers ?? 'unknown'}.`);
  };

  const saveSnapshot = async () => {
    // First await, so the permission prompt still has the click's user gesture.
    const hasDownloads = await requestDownloads();
    setMessage('Taking snapshot...');
    const r = await command({ type: 'debug:snapshot' });
    if (!r.ok || !r.html) {
      setMessage(r.ok ? 'The page returned no content.' : `Snapshot failed: ${r.reason}`);
      return;
    }
    const name = snapshotFileName(platform ?? 'page', surface, Date.now());
    const res = await saveSnapshotFile(name, r.html, hasDownloads);
    setMessage(res.ok && hasDownloads ? `${res.message}. Move it to .tmp/raw_pages/ in the project.` : res.message);
  };

  const running = scan?.status === 'running';
  const scanSettings = settings?.scan;
  const blocked = surface === 'blocked';

  return (
    <div class="panel">
      <h1>Marketing Listener</h1>
      <Limitations />

      <div class="card">
        <h3>Current tab</h3>
        {platform ? (
          <div>
            <b>{platform}</b> <span class="muted">· {surface || 'page'}</span>
            {blocked && <div class="bad">Private surface: nothing is read here.</div>}
          </div>
        ) : (
          <div class="muted">Open X, Instagram or Facebook to start.</div>
        )}
      </div>

      <div class="card">
        <h3>Bounded scan</h3>
        {scanSettings && (
          <p class="muted">
            Up to {scanSettings.maxPosts} posts or {Math.round(scanSettings.maxMs / 60000)} min, one screen every{' '}
            {scanSettings.intervalMs / 1000}s. Stops if you touch the page, switch tabs, or a login/challenge page
            appears.
          </p>
        )}
        <div class="row">
          <button class="primary" disabled={!platform || blocked || running} onClick={() => scanSettings && run({ type: 'scan:start', settings: scanSettings }, 'Scan started.')}>
            Start scan
          </button>
          <button disabled={!running} onClick={() => run({ type: 'scan:stop' }, 'Scan stopped.')}>
            Stop
          </button>
        </div>
        {scan && scan.status !== 'idle' && (
          <div style="margin-top:8px">
            <div class="bar"><div style={{ width: `${Math.min(100, (scan.collected / scan.maxPosts) * 100)}%` }} /></div>
            <div class="muted">
              {scan.collected}/{scan.maxPosts} posts · {Math.round(scan.elapsedMs / 1000)}s of {Math.round(scan.maxMs / 1000)}s ·{' '}
              {scan.status === 'running' ? 'running' : `stopped: ${REASONS[scan.reason ?? 'manual']}`}
            </div>
          </div>
        )}
      </div>

      <div class="card">
        <h3>Account baseline</h3>
        <p class="muted">On a profile page, read follower count and the posts already shown. At least {settings?.thresholds.minBaselinePosts ?? 5} posts are needed for a baseline.</p>
        <div class="row">
          <button disabled={surface !== 'profile'} onClick={() => run({ type: 'baseline:sample' }, 'Sampled.')}>Sample baseline</button>
          <button disabled={surface !== 'profile' || running || !scanSettings} onClick={() => scanSettings && run({ type: 'baseline:scan', settings: scanSettings }, 'Baseline scan started.')}>
            Extend with scan
          </button>
        </div>
      </div>

      <div class="card">
        <h3>Diagnostics</h3>
        <p class="muted">
          Saves the page as it is rendered, to help fix selectors. The file contains whatever is on screen right now,
          including names and posts. It is only written to your Downloads folder and never leaves this machine.
        </p>
        <button disabled={!platform || blocked} onClick={saveSnapshot}>Save page snapshot</button>
      </div>

      {message && <div class="notice">{message}</div>}

      {stats && (
        <div class="card">
          <h3>Collected locally</h3>
          <div class="stats">
            <div class="stat"><b>{stats.posts}</b>posts</div>
            <div class="stat"><b>{stats.clusters}</b>clusters</div>
            <div class="stat"><b>{stats.accounts}</b>accounts</div>
            <div class="stat"><b>{stats.pendingFeatures}</b>queued</div>
          </div>
        </div>
      )}

      <div class="card">
        <h3>Top clusters</h3>
        {top.length === 0 && <div class="muted">None yet. Browse a feed or run a scan.</div>}
        {top.map((r) => (
          <div style="margin-bottom:8px">
            <div class="row">
              <b>{r.kind === 'trend' ? 'Trend' : 'Viral post candidate'}</b>
              <span class="muted">{r.independentAccounts} independent accounts · {r.platforms.join(', ')}</span>
            </div>
            <AttributionTag report={r} />
            <div class="muted">first seen {fmtDate(r.firstSeenAt)} {r.lifecycle.stage ? `· ${r.lifecycle.stage}` : ''}</div>
          </div>
        ))}
        <a href={chrome.runtime.getURL('/dashboard.html')} target="_blank">Open dashboard</a>
      </div>
    </div>
  );
}
