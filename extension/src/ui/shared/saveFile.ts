import { downloadText } from './format';

export const SNAPSHOT_DIR = 'marketing-listener-snapshots';
const HASH_KEY = 'snapshot=';
const DONE_TIMEOUT_MS = 30_000;

export type SaveResult = { ok: boolean; message: string };

/**
 * Ask for the optional `downloads` permission. Must be the first await in a click handler so the
 * user gesture is still valid. Returns false when denied or the API is unavailable.
 */
export async function requestDownloads(): Promise<boolean> {
  if (!granted) {
    try {
      granted = await chrome.permissions.request({ permissions: ['downloads'] });
    } catch {
      return false;
    }
  }
  return granted && typeof chrome.downloads?.download === 'function';
}

let granted = false;
/** Test hook: forget the cached grant. */
export const resetPermissionCache = (): void => {
  granted = false;
};

/** Resolves with the final state of download `id`, or an error reason. */
function untilDone(getId: () => number | null, events: Array<{ id: number; state?: string; error?: string }>, subscribe: (fn: () => void) => () => void): Promise<SaveResult> {
  return new Promise((resolve) => {
    const check = () => {
      const id = getId();
      if (id === null) return false;
      for (const e of events) {
        if (e.id !== id) continue;
        if (e.state === 'complete') return resolve({ ok: true, message: '' }), true;
        if (e.state === 'interrupted' || e.error) return resolve({ ok: false, message: e.error ?? 'interrupted' }), true;
      }
      return false;
    };
    const stop = subscribe(() => {
      if (check()) done();
    });
    const timer = setTimeout(() => {
      resolve({ ok: false, message: 'timed out waiting for Chrome to finish the download' });
      done();
    }, DONE_TIMEOUT_MS);
    function done() {
      clearTimeout(timer);
      stop();
    }
    if (check()) done();
  });
}

/** Download through chrome.downloads and report success only once Chrome says 'complete'. */
export async function saveViaDownloads(name: string, text: string, mime: string): Promise<SaveResult> {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const events: Array<{ id: number; state?: string; error?: string }> = [];
  let id: number | null = null;
  let poke: () => void = () => {};
  const listener = (d: chrome.downloads.DownloadDelta) => {
    events.push({ id: d.id, state: d.state?.current, error: d.error?.current });
    poke();
  };
  chrome.downloads.onChanged.addListener(listener);
  try {
    id = await chrome.downloads.download({ url, filename: `${SNAPSHOT_DIR}/${name}`, saveAs: false });
    if (typeof id !== 'number') return { ok: false, message: chrome.runtime.lastError?.message ?? 'Chrome refused the download.' };
    const r = await untilDone(() => id, events, (fn) => {
      poke = fn;
      return () => {
        poke = () => {};
      };
    });
    return r.ok ? { ok: true, message: `Saved to Downloads/${SNAPSHOT_DIR}/${name}` } : { ok: false, message: `Download failed: ${r.message}` };
  } catch (e) {
    return { ok: false, message: `Download failed: ${(e as Error).message}` };
  } finally {
    chrome.downloads.onChanged.removeListener(listener);
    URL.revokeObjectURL(url);
  }
}

/** Fallback: hand the file to a dashboard tab, whose anchor download is reliable. */
export async function handToDashboard(name: string, text: string): Promise<SaveResult> {
  try {
    const key = `snapshot-${crypto.randomUUID()}`;
    await chrome.storage.session.set({ [key]: { name, text } });
    await chrome.tabs.create({ url: `${chrome.runtime.getURL('/dashboard.html')}#${HASH_KEY}${key}` });
    return { ok: true, message: 'Opened the dashboard in a new tab, which downloads the snapshot to your Downloads folder.' };
  } catch (e) {
    return { ok: false, message: `Could not save the snapshot: ${(e as Error).message}` };
  }
}

export async function saveSnapshotFile(name: string, text: string, hasDownloads: boolean): Promise<SaveResult> {
  return hasDownloads ? saveViaDownloads(name, text, 'text/html') : handToDashboard(name, text);
}

/** Dashboard side of the fallback: download a handed-over snapshot once, then delete it. */
export async function consumeHandedSnapshot(hash = location.hash): Promise<boolean> {
  const i = hash.indexOf(HASH_KEY);
  if (i < 0) return false;
  const key = hash.slice(i + HASH_KEY.length);
  try {
    const got = (await chrome.storage.session.get(key))[key] as { name: string; text: string } | undefined;
    await chrome.storage.session.remove(key);
    if (!got) return false;
    downloadText(got.name, got.text, 'text/html');
    history.replaceState(null, '', location.pathname);
    return true;
  } catch {
    return false;
  }
}
