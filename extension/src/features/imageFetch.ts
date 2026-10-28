type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Fetches an image from a platform CDN (a browser-cache hit in most cases). Cookies are never sent. */
export async function fetchImageBytes(
  fetchImpl: FetchLike,
  url: string,
): Promise<{ bytes: Uint8Array; mime: string }> {
  const res = await fetchImpl(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type || 'image/jpeg' };
}
