import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { consumeHandedSnapshot, requestDownloads, resetPermissionCache, saveSnapshotFile } from '../../src/ui/shared/saveFile';

type Listener = (d: { id: number; state?: { current: string }; error?: { current: string } }) => void;

function setup(opts: { grant?: boolean; withDownloads?: boolean; downloadId?: number } = {}) {
  const listeners = new Set<Listener>();
  const store: Record<string, unknown> = {};
  const c = {
    permissions: { request: vi.fn(async () => opts.grant ?? true) },
    downloads: opts.withDownloads === false ? undefined : {
      download: vi.fn(async () => opts.downloadId ?? 7),
      onChanged: { addListener: (l: Listener) => listeners.add(l), removeListener: (l: Listener) => listeners.delete(l) },
    },
    storage: { session: {
      set: vi.fn(async (o: Record<string, unknown>) => void Object.assign(store, o)),
      get: vi.fn(async (k: string) => ({ [k]: store[k] })),
      remove: vi.fn(async (k: string) => void delete store[k]),
    } },
    tabs: { create: vi.fn(async () => ({})) },
    runtime: { getURL: (p: string) => `chrome-extension://abc${p}` },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = c;
  const emit: Listener = (d) => [...listeners].forEach((l) => l(d));
  return { c, emit, store, listeners };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('snapshot saving', () => {
  beforeEach(() => {
    resetPermissionCache();
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it('requests the downloads permission only once after it is granted', async () => {
    const { c } = setup();
    expect(await requestDownloads()).toBe(true);
    expect(await requestDownloads()).toBe(true);
    expect(c.permissions.request).toHaveBeenCalledTimes(1);
    expect(c.permissions.request).toHaveBeenCalledWith({ permissions: ['downloads'] });
  });

  it('reports a denied permission as false', async () => {
    setup({ grant: false });
    expect(await requestDownloads()).toBe(false);
  });

  it('reports false when the downloads API is unavailable', async () => {
    setup({ withDownloads: false });
    expect(await requestDownloads()).toBe(false);
  });

  it('reports success only after state becomes complete, then revokes the blob', async () => {
    const { c, emit } = setup();
    const p = saveSnapshotFile('a.html', '<p>x</p>', true);
    let settled = false;
    void p.then(() => (settled = true));
    await tick();
    expect(c.downloads!.download).toHaveBeenCalledWith({ url: 'blob:x', filename: 'marketing-listener-snapshots/a.html', saveAs: false });
    emit({ id: 7, state: { current: 'in_progress' } });
    emit({ id: 99, state: { current: 'complete' } });
    await tick();
    expect(settled).toBe(false);
    emit({ id: 7, state: { current: 'complete' } });
    const r = await p;
    expect(r).toEqual({ ok: true, message: 'Saved to Downloads/marketing-listener-snapshots/a.html' });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:x');
  });

  it('surfaces the interrupt reason and never says Saved', async () => {
    const { emit } = setup();
    const p = saveSnapshotFile('a.html', 'x', true);
    await tick();
    emit({ id: 7, state: { current: 'interrupted' }, error: { current: 'USER_CANCELED' } });
    const r = await p;
    expect(r.ok).toBe(false);
    expect(r.message).toContain('USER_CANCELED');
    expect(r.message).not.toContain('Saved');
  });

  it('surfaces a rejected download call', async () => {
    const { c } = setup();
    c.downloads!.download.mockRejectedValueOnce(new Error('Invalid filename'));
    const r = await saveSnapshotFile('a.html', 'x', true);
    expect(r).toEqual({ ok: false, message: 'Download failed: Invalid filename' });
  });

  it('falls back to the dashboard tab when downloads is not available, and the dashboard downloads and deletes it', async () => {
    const { c, store } = setup({ grant: false });
    const r = await saveSnapshotFile('a.html', '<p>x</p>', false);
    expect(r.ok).toBe(true);
    expect(c.downloads!.download).not.toHaveBeenCalled();
    const url = (c.tabs.create.mock.calls[0] as unknown as [{ url: string }])[0].url;
    expect(url).toMatch(/^chrome-extension:\/\/abc\/dashboard\.html#snapshot=snapshot-/);
    const key = url.split('#snapshot=')[1]!;
    expect(store[key]).toEqual({ name: 'a.html', text: '<p>x</p>' });

    const click = vi.fn();
    const orig = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((t: string) => {
      const el = orig(t);
      if (t === 'a') el.click = click;
      return el;
    });
    expect(await consumeHandedSnapshot(`#snapshot=${key}`)).toBe(true);
    expect(click).toHaveBeenCalledTimes(1);
    expect(store[key]).toBeUndefined();
    vi.restoreAllMocks();
  });

  it('does nothing on the dashboard without a snapshot hash', async () => {
    setup();
    expect(await consumeHandedSnapshot('#other')).toBe(false);
  });
});
