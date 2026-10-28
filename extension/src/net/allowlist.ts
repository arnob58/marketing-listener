/** Single source of truth for every host the extension may talk to. */

export const PLATFORM_HOSTS = ['facebook.com', 'instagram.com', 'x.com', 'twitter.com'];

/** Image CDNs the feature pipeline may fetch thumbnails from. */
export const IMAGE_CDN_HOSTS = ['pbs.twimg.com', '*.cdninstagram.com', '*.fbcdn.net'];

/** Hosts used for the opt-in, one-time model download. */
export const MODEL_HOSTS = ['huggingface.co', '*.huggingface.co', '*.hf.co'];

function hostMatches(host: string, pattern: string): boolean {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1);
    return host.endsWith(suffix) && host.length > suffix.length;
  }
  return host === pattern;
}

export function isAllowedHost(host: string, patterns: string[]): boolean {
  const h = host.toLowerCase();
  return patterns.some((p) => hostMatches(h, p));
}

export interface FetchPolicy {
  allowModelHosts: boolean;
}

/**
 * Decides whether a fetch target is allowed. Image CDNs are always allowed;
 * model hosts only after the user opted in; the extension's own origin and
 * inline data URLs are always fine (bundled wasm, blobs).
 */
export function isAllowedFetchUrl(raw: string, policy: FetchPolicy): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === 'chrome-extension:' || url.protocol === 'data:' || url.protocol === 'blob:') {
    return true;
  }
  if (url.protocol !== 'https:') return false;
  if (isAllowedHost(url.hostname, IMAGE_CDN_HOSTS)) return true;
  return policy.allowModelHosts && isAllowedHost(url.hostname, MODEL_HOSTS);
}

export class FetchBlockedError extends Error {
  constructor(url: string) {
    super(`Fetch blocked by allowlist: ${url}`);
    this.name = 'FetchBlockedError';
  }
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Wraps a fetch implementation so every call is checked against the allowlist. */
export function createGuardedFetch(
  inner: FetchLike,
  getPolicy: () => FetchPolicy,
): FetchLike {
  return (input, init) => {
    const target =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!isAllowedFetchUrl(target, getPolicy())) {
      return Promise.reject(new FetchBlockedError(target));
    }
    return inner(input, init);
  };
}
