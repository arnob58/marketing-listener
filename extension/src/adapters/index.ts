import { registerAdapter } from './PlatformAdapter';
import { facebookAdapter } from './facebook/adapter';
import { instagramAdapter } from './instagram/adapter';
import { xAdapter } from './x/adapter';

[xAdapter, instagramAdapter, facebookAdapter].forEach(registerAdapter);

export { getAdapterForUrl, listAdapters, collectPosts } from './PlatformAdapter';
export type { PlatformAdapter } from './PlatformAdapter';
