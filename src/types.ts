export type ItemType = 'lesson' | 'call' | 'post';

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
}

export type TranscriptResult =
  | { status: 'ok'; text: string; wordCount: number; provider: string; sourceUrl: string }
  | { status: 'unavailable'; reason: string; provider: string }
  | { status: 'failed'; reason: string; provider: string };

export interface Fetcher {
  getPage(url: string): Promise<string>;
}
