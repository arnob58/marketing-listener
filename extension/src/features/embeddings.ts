import { createGuardedFetch } from '../net/allowlist';

/** Boundary between clustering and whichever model produces vectors. */
export interface Embedder {
  embedText(text: string): Promise<number[]>;
  embedImage(bytes: Uint8Array, mime: string): Promise<number[]>;
  unload(): Promise<void>;
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function normalize(v: ArrayLike<number>): number[] {
  const out = Array.from(v);
  const n = Math.sqrt(out.reduce((s, x) => s + x * x, 0));
  return n ? out.map((x) => x / n) : out;
}

export const TEXT_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const IMAGE_MODEL = 'Xenova/clip-vit-base-patch32';
export const MODEL_IDLE_MS = 2 * 60_000;

/** Calls `unload` once nothing has used the model for `idleMs`. */
export class IdleUnloader {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly unload: () => Promise<void> | void,
    private readonly idleMs = MODEL_IDLE_MS,
  ) {}

  touch(): void {
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.unload();
    }, this.idleMs);
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

type Pipeline = (input: unknown, opts?: Record<string, unknown>) => Promise<{ data: ArrayLike<number> }>;

/**
 * transformers.js-backed embedder. Models are fetched only after the user opts in,
 * through the allowlisted fetch, then served from the browser cache. Only constructed
 * inside the offscreen document.
 */
export class TransformersEmbedder implements Embedder {
  private text: Pipeline | null = null;
  private image: { processor: (img: unknown) => Promise<unknown>; model: (inputs: unknown) => Promise<{ image_embeds: { data: ArrayLike<number> } }> & { dispose?: () => Promise<void> } } | null = null;
  private lib: typeof import('@huggingface/transformers') | null = null;
  private readonly unloader: IdleUnloader;

  constructor(
    private readonly wasmBase: string,
    idleMs = MODEL_IDLE_MS,
  ) {
    this.unloader = new IdleUnloader(() => this.unload(), idleMs);
  }

  private async load() {
    if (!this.lib) {
      const lib = await import('@huggingface/transformers');
      lib.env.allowLocalModels = false;
      lib.env.useBrowserCache = true;
      const wasm = lib.env.backends.onnx.wasm;
      if (wasm) {
        wasm.wasmPaths = this.wasmBase;
        wasm.proxy = false;
      }
      this.lib = lib;
    }
    return this.lib;
  }

  async embedText(text: string): Promise<number[]> {
    const lib = await this.load();
    this.text ??= (await lib.pipeline('feature-extraction', TEXT_MODEL, { dtype: 'q8' })) as unknown as Pipeline;
    const out = await this.text(text, { pooling: 'mean', normalize: true });
    this.unloader.touch();
    return Array.from(out.data);
  }

  async embedImage(bytes: Uint8Array, mime: string): Promise<number[]> {
    const lib = await this.load();
    if (!this.image) {
      const processor = await lib.AutoProcessor.from_pretrained(IMAGE_MODEL, {});
      const model = await lib.CLIPVisionModelWithProjection.from_pretrained(IMAGE_MODEL, { dtype: 'q8' });
      this.image = { processor: processor as never, model: model as never };
    }
    const raw = await lib.RawImage.fromBlob(new Blob([bytes as unknown as BlobPart], { type: mime }));
    const inputs = await this.image.processor(raw);
    const out = await this.image.model(inputs);
    this.unloader.touch();
    return normalize(out.image_embeds.data);
  }

  async unload(): Promise<void> {
    this.unloader.cancel();
    const disposables = [this.text, this.image?.model] as Array<{ dispose?: () => Promise<void> } | null | undefined>;
    this.text = null;
    this.image = null;
    await Promise.all(disposables.map((p) => p?.dispose?.()));
  }
}

/** Replaces global fetch so every request in this context obeys the allowlist. */
export function installGuardedFetch(getAllowModelHosts: () => boolean): void {
  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = createGuardedFetch(original, () => ({ allowModelHosts: getAllowModelHosts() }));
}
