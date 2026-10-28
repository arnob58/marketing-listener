import { useEffect, useState } from 'preact/hooks';
import { getDb } from '../../storage/db';
import { Repository } from '../../storage/repositories';

export type ThumbnailLoader = (postKey: string) => Promise<Blob | undefined>;

/** Extension pages share the background's IndexedDB, so thumbnails are read directly rather than sent as messages. */
export const loadThumbnail: ThumbnailLoader = async (key) => (await new Repository(getDb()).getThumbnail(key))?.blob;

/** An object URL for a stored thumbnail; revoked when the key changes or the component unmounts. */
export function useThumbnailUrl(postKey: string | null | undefined, load: ThumbnailLoader = loadThumbnail): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!postKey) return;
    let alive = true;
    let made: string | null = null;
    load(postKey).then(
      (blob) => {
        if (!alive || !blob) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      },
      () => {},
    );
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [postKey, load]);
  return url;
}
