// Node's built-in SQLite: no native module to compile, so installs never depend on a C toolchain.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { ContentItem, TranscriptResult } from '../types.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS communities (
  slug TEXT PRIMARY KEY,
  name TEXT,
  last_synced_at TEXT
);
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  community TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('lesson','call','post')),
  native_id TEXT NOT NULL,
  section TEXT,
  course TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  url TEXT,
  video_url TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  has_access INTEGER NOT NULL DEFAULT 1,
  published_at TEXT,
  body_text TEXT,
  content_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS items_community_type ON items(community, type);
CREATE TABLE IF NOT EXISTS transcripts (
  item_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok','unavailable','failed')),
  reason TEXT,
  text TEXT,
  word_count INTEGER,
  source_url TEXT,
  fetched_at TEXT NOT NULL,
  FOREIGN KEY (item_id) REFERENCES items(id)
);
`;

export function contentHash(item: ContentItem): string {
  // Use \0 as separator to prevent field boundary collisions.
  // Nullable fields are collapsed to '' to ensure stable hashing.
  const salient = [
    item.nativeId, item.title, item.section ?? '', item.course ?? '',
    item.videoUrl ?? '', String(item.durationMs), item.bodyText ?? '',
    String(item.hasAccess),
  ].join('\0');
  return createHash('sha256').update(salient).digest('hex');
}

export interface Db {
  upsertCommunity(slug: string, name: string): void;
  upsertItem(community: string, item: ContentItem): { id: string; changed: boolean };
  saveTranscript(itemId: string, result: TranscriptResult): void;
  getTranscriptStatus(itemId: string): string | null;
  getTranscriptReason(itemId: string): string | null;
  markSynced(slug: string): void;
  close(): void;
}

export function openDb(path: string): Db {
  // Create parent directories for file-based databases (not :memory:)
  if (path !== ':memory:') {
    const dir = dirname(path);
    if (dir && dir !== '.') {
      mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);

  return {
    upsertCommunity(slug, name) {
      db.prepare(
        `INSERT INTO communities (slug, name) VALUES (?, ?)
         ON CONFLICT(slug) DO UPDATE SET name = excluded.name`,
      ).run(slug, name);
    },

    upsertItem(community, item) {
      const id = `${community}:${item.type}:${item.nativeId}`;
      const hash = contentHash(item);
      const existing = db.prepare('SELECT content_hash FROM items WHERE id = ?').get(id) as
        | { content_hash: string }
        | undefined;

      db.prepare(
        `INSERT INTO items (id, community, type, native_id, section, course, position, title,
                            url, video_url, duration_ms, has_access, published_at, body_text,
                            content_hash, updated_at)
         VALUES (@id, @community, @type, @nativeId, @section, @course, @position, @title,
                 @url, @videoUrl, @durationMs, @hasAccess, @publishedAt, @bodyText,
                 @hash, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET
           section = excluded.section, course = excluded.course, position = excluded.position,
           title = excluded.title, url = excluded.url, video_url = excluded.video_url,
           duration_ms = excluded.duration_ms, has_access = excluded.has_access,
           published_at = excluded.published_at, body_text = excluded.body_text,
           content_hash = excluded.content_hash, updated_at = excluded.updated_at`,
      ).run({
        id, community, type: item.type, nativeId: item.nativeId,
        section: item.section, course: item.course, position: item.index,
        title: item.title, url: item.url, videoUrl: item.videoUrl,
        durationMs: item.durationMs, hasAccess: item.hasAccess ? 1 : 0,
        publishedAt: item.publishedAt, bodyText: item.bodyText,
        hash, updatedAt: new Date().toISOString(),
      });

      return { id, changed: existing?.content_hash !== hash };
    },

    saveTranscript(itemId, result) {
      db.prepare(
        `INSERT INTO transcripts (item_id, provider, status, reason, text, word_count, source_url, fetched_at)
         VALUES (@itemId, @provider, @status, @reason, @text, @wordCount, @sourceUrl, @fetchedAt)
         ON CONFLICT(item_id) DO UPDATE SET
           provider = excluded.provider, status = excluded.status, reason = excluded.reason,
           text = excluded.text, word_count = excluded.word_count,
           source_url = excluded.source_url, fetched_at = excluded.fetched_at`,
      ).run({
        itemId,
        provider: result.provider,
        status: result.status,
        reason: result.status === 'ok' ? null : result.reason,
        text: result.status === 'ok' ? result.text : null,
        wordCount: result.status === 'ok' ? result.wordCount : null,
        sourceUrl: result.status === 'ok' ? result.sourceUrl : null,
        fetchedAt: new Date().toISOString(),
      });
    },

    getTranscriptStatus(itemId) {
      const row = db.prepare('SELECT status FROM transcripts WHERE item_id = ?').get(itemId) as
        | { status: string } | undefined;
      return row?.status ?? null;
    },

    getTranscriptReason(itemId) {
      const row = db.prepare('SELECT reason FROM transcripts WHERE item_id = ?').get(itemId) as
        | { reason: string | null } | undefined;
      return row?.reason ?? null;
    },

    markSynced(slug) {
      db.prepare('UPDATE communities SET last_synced_at = ? WHERE slug = ?')
        .run(new Date().toISOString(), slug);
    },

    close() { db.close(); },
  };
}
