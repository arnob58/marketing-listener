import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { ListenerDb } from '../../src/storage/db';
import { Repository } from '../../src/storage/repositories';
import { DAY, MON, createWorld, handleN, vec } from '../helpers/world';

let n = 0;
const V1_STORES = {
  posts: 'key, platform, authorKey, clusterId, firstSeenAt, lastSeenAt, featureState, refKey',
  observations: '++id, postKey, at',
  accounts: 'key, platform',
  clusters: 'id, updatedAt, createdAt',
  snapshots: '[clusterId+day], clusterId, day',
  imageFeatures: 'hash',
  textFeatures: 'hash',
  health: 'key',
};

describe('database migration', () => {
  it('upgrades a v1 database in place, keeping posts and adding audio and surface', async () => {
    const name = `migrate-${Date.now()}-${n++}`;
    const old = new Dexie(name);
    old.version(1).stores(V1_STORES);
    await old.table('posts').put({ key: 'x:1', platform: 'x', postId: '1', url: 'https://x.com/a/status/1', authorKey: 'x:a', authorHandle: 'a', text: 'kept', hashtags: ['t'], firstSeenAt: MON, lastSeenAt: MON, featureState: 'done', clusterId: 'c1', refKey: null });
    await old.table('accounts').put({ key: 'x:a', platform: 'x', handle: 'a' });
    old.close();

    const db = new ListenerDb(name);
    const posts = await db.posts.toArray();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ key: 'x:1', text: 'kept', hashtags: ['t'], clusterId: 'c1', audio: null, surface: 'other' });
    expect(await db.accounts.count()).toBe(1);
    expect(await db.thumbnails.count()).toBe(0);
    await new Repository(db).putThumbnail({ key: 'x:1', blob: new Blob(['jpg'], { type: 'image/jpeg' }), at: MON });
    expect(await db.thumbnails.count()).toBe(1);
    db.close();
  });
});

describe('thumbnail storage and retention', () => {
  const blob = () => new Blob(['jpg'], { type: 'image/jpeg' });

  it('purges thumbnails with their posts but keeps those of recent posts', async () => {
    const w = createWorld();
    const old = await w.addPost({ handle: handleN(1), textVec: vec(0), firstSeenAt: MON - 120 * DAY });
    const fresh = await w.addPost({ handle: handleN(2), textVec: vec(5), firstSeenAt: MON });
    await w.repo.putThumbnail({ key: old.key, blob: blob(), at: MON });
    await w.repo.putThumbnail({ key: fresh.key, blob: blob(), at: MON });
    expect(await w.repo.purgeOlderThan(90, MON)).toBe(1);
    expect(await w.repo.hasThumbnail(old.key)).toBe(false);
    expect(await w.repo.hasThumbnail(fresh.key)).toBe(true);
  });

  it('purge-all clears the thumbnails table too', async () => {
    const w = createWorld();
    await w.repo.putThumbnail({ key: 'x:1', blob: blob(), at: MON });
    await w.repo.purgeAll();
    expect(await w.db.thumbnails.count()).toBe(0);
  });

  it('stores a thumbnail row per post key and reads it back', async () => {
    const w = createWorld();
    await w.repo.putThumbnail({ key: 'x:1', blob: blob(), at: MON });
    await w.repo.putThumbnail({ key: 'x:1', blob: blob(), at: MON + 1 }); // replaced, not duplicated
    expect(await w.db.thumbnails.count()).toBe(1);
    // fake-indexeddb does not preserve Blob instances, so only the row itself is asserted here.
    expect(await w.repo.getThumbnail('x:1')).toMatchObject({ key: 'x:1', at: MON + 1 });
    expect(await w.repo.getThumbnail('x:2')).toBeUndefined();
  });
});
