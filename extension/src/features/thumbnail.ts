/** Longest side of a stored thumbnail, in pixels. */
export const THUMB_MAX_SIDE = 160;
/** Target size ceiling for the encoded JPEG. */
export const THUMB_MAX_BYTES = 12 * 1024;
const QUALITIES = [0.7, 0.55, 0.4, 0.28, 0.18];

/** Scales to fit `maxSide` on the longest side, never upscaling. */
export function thumbnailSize(width: number, height: number, maxSide = THUMB_MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Re-encodes at falling quality until the result fits the budget; returns the smallest attempt otherwise. */
export async function encodeWithinBudget(
  encode: (quality: number) => Promise<Blob>,
  maxBytes = THUMB_MAX_BYTES,
): Promise<Blob> {
  let blob = await encode(QUALITIES[0]);
  for (let i = 1; i < QUALITIES.length && blob.size > maxBytes; i++) blob = await encode(QUALITIES[i]);
  return blob;
}
