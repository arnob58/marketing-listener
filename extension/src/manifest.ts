import { IMAGE_CDN_HOSTS, MODEL_HOSTS, PLATFORM_HOSTS } from './net/allowlist';

export const PERMISSIONS = ['storage', 'unlimitedStorage', 'sidePanel', 'offscreen', 'alarms'];

const toMatch = (host: string) => `https://${host}/*`;
const platformMatch = (host: string) => `https://${host === 'x.com' || host === 'twitter.com' ? host : `*.${host}`}/*`;

export const CONTENT_MATCHES = PLATFORM_HOSTS.map(platformMatch);
/** Requested at runtime on first "Save page snapshot" click (side panel anchors can't download). */
export const OPTIONAL_PERMISSIONS = ['downloads'];
export const HOST_PERMISSIONS = [...CONTENT_MATCHES, ...IMAGE_CDN_HOSTS.map(toMatch)];
export const OPTIONAL_HOST_PERMISSIONS = MODEL_HOSTS.map(toMatch);

export function buildManifest() {
  return {
    name: 'Marketing Listener',
    description:
      'Local-first trend discovery from the feeds you browse on X, Instagram and Facebook. No telemetry.',
    permissions: PERMISSIONS,
    optional_permissions: OPTIONAL_PERMISSIONS as Array<'downloads'>,
    host_permissions: HOST_PERMISSIONS,
    optional_host_permissions: OPTIONAL_HOST_PERMISSIONS,
    action: { default_title: 'Open Marketing Listener' },
    minimum_chrome_version: '116',
  };
}
