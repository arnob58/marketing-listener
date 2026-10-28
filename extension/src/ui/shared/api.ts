import type { UiRequest, UiResponseMap } from '../../core/messages';

export async function rpc<T extends UiRequest>(req: T): Promise<UiResponseMap[T['type']]> {
  const res = await chrome.runtime.sendMessage(req);
  if (!res?.ok) throw new Error(res?.error ?? 'The background worker did not respond.');
  return res.data;
}
