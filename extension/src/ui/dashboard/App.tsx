import { useEffect, useState } from 'preact/hooks';
import type { ClusterReport } from '../../analysis/evaluate';
import { rpc } from '../shared/api';
import { Limitations } from '../shared/components';
import { ClusterView } from './ClusterView';
import { ExportPanel } from './ExportPanel';
import { History } from './History';
import { SettingsPanel } from './SettingsPanel';
import { Trends } from './Trends';

type Tab = 'trends' | 'history' | 'export' | 'settings';
const TABS: Array<[Tab, string]> = [['trends', 'Trends'], ['history', 'History'], ['export', 'Export'], ['settings', 'Settings']];

export function App() {
  const [tab, setTab] = useState<Tab>('trends');
  const [reports, setReports] = useState<ClusterReport[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    rpc({ type: 'ui:reports' }).then(setReports, (e: Error) => setError(e.message));
  }, [tab]);

  return (
    <div class="page">
      <h1>Marketing Listener</h1>
      <Limitations />
      {error && <div class="notice bad">{error}</div>}
      <div class="tabs">
        {TABS.map(([id, label]) => (
          <button class={tab === id && !open ? 'active' : ''} onClick={() => { setTab(id); setOpen(null); }}>{label}</button>
        ))}
      </div>
      {open ? (
        <ClusterView id={open} onBack={() => setOpen(null)} />
      ) : tab === 'trends' ? (
        <Trends reports={reports} onOpen={setOpen} />
      ) : tab === 'history' ? (
        <History reports={reports} onOpen={setOpen} />
      ) : tab === 'export' ? (
        <ExportPanel />
      ) : (
        <SettingsPanel />
      )}
    </div>
  );
}
