import 'fake-indexeddb/auto';

// Fixtures contain challenge iframes; never let the DOM implementation load them.
const settings = (window as unknown as { happyDOM?: { settings: Record<string, unknown> } }).happyDOM?.settings;
if (settings) settings.disableIframePageLoading = true;
