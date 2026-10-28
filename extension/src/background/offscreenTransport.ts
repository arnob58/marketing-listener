import type { OffscreenRequest, OffscreenResponse } from '../core/messages';
import type { FeatureJob, FeatureResult } from '../features/worker';
import type { FeatureTransport } from './featureQueue';

const OFFSCREEN_PATH = 'offscreen.html';

/** Sends feature jobs to the offscreen document, creating it on demand. */
export class OffscreenTransport implements FeatureTransport {
  private creating: Promise<void> | null = null;

  private async ensure(): Promise<void> {
    const url = chrome.runtime.getURL(OFFSCREEN_PATH);
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [url],
    });
    if (contexts.length) return;
    this.creating ??= chrome.offscreen
      .createDocument({
        url: OFFSCREEN_PATH,
        reasons: [chrome.offscreen.Reason.WORKERS, chrome.offscreen.Reason.BLOBS],
        justification: 'Decode images and run local embedding models off the main thread.',
      })
      .finally(() => {
        this.creating = null;
      });
    await this.creating;
  }

  async compute(jobs: FeatureJob[], opts: { embeddings: boolean }): Promise<FeatureResult[]> {
    await this.ensure();
    const req: OffscreenRequest = { target: 'offscreen', type: 'features:compute', jobs, embeddings: opts.embeddings };
    const res = (await chrome.runtime.sendMessage(req)) as OffscreenResponse | undefined;
    if (!res?.ok) throw new Error(res && !res.ok ? res.error : 'offscreen document did not respond');
    return res.results;
  }
}
