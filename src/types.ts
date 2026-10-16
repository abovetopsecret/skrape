export type ItemType = 'lesson' | 'call' | 'post';

/** A lesson attachment: an external link, or a file uploaded to Skool (url null; download it on Skool). */
export interface Resource {
  title: string;
  url: string | null;
  fileName?: string;
}

export interface ContentItem {
  nativeId: string;
  type: ItemType;
  title: string;
  index: number;
  course: string | null;
  section: string | null;
  url: string | null;
  videoUrl: string | null;
  durationMs: number;
  hasAccess: boolean;
  publishedAt: string | null;
  bodyText: string | null;
  resources?: Resource[];
}

export type TranscriptResult =
  | { status: 'ok'; text: string; wordCount: number; provider: string; sourceUrl: string }
  | { status: 'unavailable'; reason: string; provider: string }
  | { status: 'failed'; reason: string; provider: string };

export interface Fetcher {
  getPage(url: string): Promise<string>;
}
