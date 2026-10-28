export type Platform = 'x' | 'instagram' | 'facebook';

export type Surface = 'feed' | 'explore' | 'search' | 'profile' | 'post' | 'blocked' | 'other';

/** A count with its uncertainty: abbreviated counts ("12K") are stored as ranges. */
export interface Metric {
  value: number;
  low: number;
  high: number;
}

export interface PostMetrics {
  likes: Metric | null;
  comments: Metric | null;
  shares: Metric | null;
  views: Metric | null;
}

export type PostKind = 'original' | 'repost' | 'quote';

/** The sound a reel uses. `id` is null when the platform shows a title but no stable id. */
export interface PostAudio {
  id: string | null;
  title: string;
  /** True for a creator's own "Original audio", as opposed to licensed or shared music. */
  isOriginal: boolean;
}

export type ExtractedField = 'author' | 'text' | 'timestamp' | 'url' | 'metrics' | 'media';

export interface RawPost {
  platform: Platform;
  postId: string;
  url: string;
  authorHandle: string;
  authorName: string | null;
  text: string;
  hashtags: string[];
  /** Epoch ms, or null when the platform only shows an unparseable value. */
  postedAt: number | null;
  imageUrls: string[];
  hasVideo: boolean;
  metrics: PostMetrics;
  audio: PostAudio | null;
  /** Where the post was seen (e.g. the reels viewer is a 'feed' under /reels/). */
  surface: Surface;
  kind: PostKind;
  /** For quotes: the quoted post. For reposts: the account that reposted. */
  refPostId: string | null;
  repostedBy: string | null;
  resolved: Record<ExtractedField, boolean>;
  selectorVersion: string;
}

export interface ProfileInfo {
  platform: Platform;
  handle: string;
  displayName: string | null;
  followers: Metric | null;
  verified: boolean;
}

export type FeatureState = 'pending' | 'done' | 'failed';

/** Stored form of a post. */
export interface StoredPost {
  key: string; // platform:postId
  platform: Platform;
  postId: string;
  url: string;
  authorKey: string; // platform:handle (lowercase)
  authorHandle: string;
  text: string;
  hashtags: string[];
  postedAt: number | null;
  imageUrls: string[];
  hasVideo: boolean;
  metrics: PostMetrics;
  engagement: Metric;
  audio: PostAudio | null;
  surface: Surface;
  kind: PostKind;
  refKey: string | null;
  repostedBy: string[];
  firstSeenAt: number;
  lastSeenAt: number;
  featureState: FeatureState;
  imageHash: string | null;
  textHash: string | null;
  clusterId: string | null;
  variantOf: string | null;
}

/** Small JPEG kept locally so the dashboard can show media after platform URLs expire. */
export interface Thumbnail {
  key: string; // post key
  blob: Blob;
  at: number;
}

export interface Observation {
  id?: number;
  postKey: string;
  at: number;
  metrics: PostMetrics;
  engagement: Metric;
}

export interface Account {
  key: string; // platform:handle
  platform: Platform;
  handle: string;
  displayName: string | null;
  followers: Metric | null;
  verified: boolean;
  updatedAt: number;
}

export interface ImageFeatures {
  hash: string; // content hash of the image bytes
  phash: string; // 16 hex chars (64-bit dHash)
  vec: number[] | null;
}

export interface TextFeatures {
  hash: string;
  minhash: number[];
  vec: number[] | null;
}

export interface Cluster {
  id: string;
  createdAt: number;
  updatedAt: number;
  centroidImage: number[] | null;
  nImage: number;
  centroidText: number[] | null;
  nText: number;
}

export interface Snapshot {
  clusterId: string;
  day: string; // YYYY-MM-DD (UTC)
  at: number;
  accounts: number;
  posts: number;
  medianEngagement: number;
  platforms: Platform[];
}

export type AttributionLabel =
  | 'Likely content-driven'
  | 'Likely publisher-driven'
  | 'Mixed'
  | 'Insufficient evidence';

export interface EvidenceItem {
  signal: string;
  direction: 'content' | 'publisher' | 'neutral';
  text: string;
}

export interface Classification {
  label: AttributionLabel;
  /** Probability-like score in [0,1]; higher means more content-driven. */
  score: number;
  confidence: number;
  evidence: EvidenceItem[];
  missingData: string[];
  sampleSizes: {
    posts: number;
    independentAccounts: number;
    platforms: number;
    baselineSamples: Record<string, number>;
  };
  summary: string;
}

export type LifecycleStage = 'Emerging' | 'Accelerating' | 'Established' | 'Declining';
