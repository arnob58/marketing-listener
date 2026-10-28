import { useState } from 'preact/hooks';
import { exportFileName, toCsv } from '../../export/export';
import { rpc } from '../shared/api';
import { downloadText } from '../shared/format';

export function ExportPanel() {
  const [note, setNote] = useState('');

  const run = async (kind: 'json' | 'trends.csv' | 'posts.csv' | 'accounts.csv') => {
    const bundle = await rpc({ type: 'ui:export' });
    const name = exportFileName(kind, Date.now());
    if (kind === 'json') downloadText(name, JSON.stringify(bundle, null, 2), 'application/json');
    else downloadText(name, toCsv(bundle[kind.split('.')[0] as 'trends' | 'posts' | 'accounts']), 'text/csv');
    setNote(`Saved ${name} to your Downloads folder. Move it to .tmp/exports/ in the project to push it to Google Sheets.`);
  };

  return (
    <div class="card">
      <h3>Export</h3>
      <p>Exports stay on this machine until you run the Sheets tool yourself. Nothing is uploaded from the extension.</p>
      <div class="row">
        <button class="primary" onClick={() => run('json')}>JSON (for Sheets tool)</button>
        <button onClick={() => run('trends.csv')}>Trends CSV</button>
        <button onClick={() => run('posts.csv')}>Posts CSV</button>
        <button onClick={() => run('accounts.csv')}>Accounts CSV</button>
      </div>
      {note && <p class="notice">{note}</p>}
    </div>
  );
}
