import Dexie, { type Table } from 'dexie';
import type {
  Account,
  Cluster,
  ImageFeatures,
  Observation,
  Platform,
  Snapshot,
  StoredPost,
  TextFeatures,
  Thumbnail,
} from '../core/types';

export interface HealthRecord {
  key: string; // platform:selectorVersion
  platform: Platform;
  selectorVersion: string;
  posts: number;
  author: number;
  text: number;
  timestamp: number;
  url: number;
  metrics: number;
  media: number;
  updatedAt: number;
}

export class ListenerDb extends Dexie {
  posts!: Table<StoredPost, string>;
  observations!: Table<Observation, number>;
  accounts!: Table<Account, string>;
  clusters!: Table<Cluster, string>;
  snapshots!: Table<Snapshot, [string, string]>;
  imageFeatures!: Table<ImageFeatures, string>;
  textFeatures!: Table<TextFeatures, string>;
  health!: Table<HealthRecord, string>;
  thumbnails!: Table<Thumbnail, string>;

  constructor(name = 'marketing-listener') {
    super(name);
    this.version(1).stores({
      posts: 'key, platform, authorKey, clusterId, firstSeenAt, lastSeenAt, featureState, refKey',
      observations: '++id, postKey, at',
      accounts: 'key, platform',
      clusters: 'id, updatedAt, createdAt',
      snapshots: '[clusterId+day], clusterId, day',
      imageFeatures: 'hash',
      textFeatures: 'hash',
      health: 'key',
    });
    // v2: audio + surface on posts, and a table for locally stored thumbnails.
    this.version(2)
      .stores({ thumbnails: 'key, at' })
      .upgrade((tx) =>
        tx
          .table('posts')
          .toCollection()
          .modify((p: Partial<StoredPost>) => {
            p.audio ??= null;
            p.surface ??= 'other';
          }),
      );
  }
}

let shared: ListenerDb | null = null;

export function getDb(): ListenerDb {
  shared ??= new ListenerDb();
  return shared;
}
