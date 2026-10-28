export interface GrayImage {
  data: ArrayLike<number>;
  width: number;
  height: number;
}

const W = 9;
const H = 8;

/** Box-filter resample (area average) to a small grid. */
function resample(img: GrayImage, outW: number, outH: number): number[] {
  const out = new Array<number>(outW * outH);
  const sx = img.width / outW;
  const sy = img.height / outH;
  for (let y = 0; y < outH; y++) {
    const y0 = y * sy;
    const y1 = (y + 1) * sy;
    for (let x = 0; x < outW; x++) {
      const x0 = x * sx;
      const x1 = (x + 1) * sx;
      let sum = 0;
      let weight = 0;
      for (let yy = Math.floor(y0); yy < Math.min(img.height, Math.ceil(y1)); yy++) {
        const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
        for (let xx = Math.floor(x0); xx < Math.min(img.width, Math.ceil(x1)); xx++) {
          const wx = Math.min(xx + 1, x1) - Math.max(xx, x0);
          const w = wx * wy;
          sum += img.data[yy * img.width + xx] * w;
          weight += w;
        }
      }
      out[y * outW + x] = weight ? sum / weight : 0;
    }
  }
  return out;
}

/** 64-bit difference hash as 16 hex chars. */
export function dHash(img: GrayImage): string {
  const grid = resample(img, W, H);
  let bits = 0n;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W - 1; x++) {
      bits = (bits << 1n) | (grid[y * W + x] > grid[y * W + x + 1] ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, '0');
}

export function hamming(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  while (x) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

/** RGBA pixels to luma. */
export function rgbaToGray(rgba: ArrayLike<number>, width: number, height: number): GrayImage {
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.round(0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]);
  }
  return { data, width, height };
}
