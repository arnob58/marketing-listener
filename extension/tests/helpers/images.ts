import type { GrayImage } from '../../src/features/phash';

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SIZE = 64;

/** Photo-like test image: many soft blobs at mixed scales over a faint gradient. */
export function syntheticImage(seed: number, size = SIZE): GrayImage {
  const r = rng(seed);
  const blobs = Array.from({ length: 10 + Math.floor(r() * 8) }, () => ({
    x: r() * size,
    y: r() * size,
    s: size * (0.05 + r() * 0.2),
    a: (r() - 0.5) * 220,
  }));
  const gx = (r() - 0.5) * 30;
  const gy = (r() - 0.5) * 30;
  const data = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 128 + gx * (x / size - 0.5) + gy * (y / size - 0.5);
      for (const b of blobs) v += b.a * Math.exp(-((x - b.x) ** 2 + (y - b.y) ** 2) / (2 * b.s * b.s));
      data[y * size + x] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  return { data, width: size, height: size };
}

function bilinear(img: GrayImage, x: number, y: number): number {
  const x0 = Math.max(0, Math.min(img.width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(img.height - 1, Math.floor(y)));
  const x1 = Math.min(img.width - 1, x0 + 1);
  const y1 = Math.min(img.height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const d = img.data;
  const top = d[y0 * img.width + x0] * (1 - fx) + d[y0 * img.width + x1] * fx;
  const bot = d[y1 * img.width + x0] * (1 - fx) + d[y1 * img.width + x1] * fx;
  return top * (1 - fy) + bot * fy;
}

export function resize(img: GrayImage, w: number, h: number): GrayImage {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[y * w + x] = Math.round(bilinear(img, ((x + 0.5) * img.width) / w - 0.5, ((y + 0.5) * img.height) / h - 0.5));
    }
  }
  return { data: out, width: w, height: h };
}

/** Lossy re-encode stand-in: quantize and add noise, as JPEG recompression would. */
export function recompress(img: GrayImage, seed: number, levels = 24, noise = 4): GrayImage {
  const r = rng(seed);
  const step = 256 / levels;
  const data = Uint8Array.from(img.data as ArrayLike<number>, (v) => {
    const q = Math.round((v + (r() - 0.5) * 2 * noise) / step) * step;
    return Math.max(0, Math.min(255, Math.round(q)));
  });
  return { data, width: img.width, height: img.height };
}

export function cropEdges(img: GrayImage, fraction: number): GrayImage {
  const mx = Math.round(img.width * fraction);
  const my = Math.round(img.height * fraction);
  const w = img.width - 2 * mx;
  const h = img.height - 2 * my;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = img.data[(y + my) * img.width + x + mx];
  return resize({ data: out, width: w, height: h }, img.width, img.height);
}

export function adjust(img: GrayImage, gain: number, bias: number): GrayImage {
  const data = Uint8Array.from(img.data as ArrayLike<number>, (v) => Math.max(0, Math.min(255, Math.round(v * gain + bias))));
  return { data, width: img.width, height: img.height };
}

export function rescale(img: GrayImage): GrayImage {
  return resize(resize(img, img.width / 2, img.height / 2), img.width, img.height);
}
