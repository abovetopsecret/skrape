import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb, contentHash, type Db } from '../../src/store/db.js';
import type { ContentItem } from '../../src/types.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const item = (overrides: Partial<ContentItem> = {}): ContentItem => ({
  nativeId: 'l1', type: 'lesson', title: 'A Lesson', index: 0,
  course: 'Course', section: null, url: null,
  videoUrl: 'https://www.loom.com/share/aaa', durationMs: 1000,
  hasAccess: true, publishedAt: null, bodyText: null, ...overrides,
});

describe('store', () => {
  let db: Db;
  beforeEach(() => { db = openDb(':memory:'); });
  afterEach(() => { db.close(); });

  it('creates its schema on open', () => {
    expect(() => db.upsertCommunity('demo', 'Demo Co')).not.toThrow();
  });

  it('reports changed=true the first time an item is seen', () => {
    db.upsertCommunity('demo', 'Demo Co');
    expect(db.upsertItem('demo', item()).changed).toBe(true);
  });

  it('reports changed=false when re-upserting identical content', () => {
    db.upsertCommunity('demo', 'Demo Co');
    db.upsertItem('demo', item());
    expect(db.upsertItem('demo', item()).changed).toBe(false);
  });

  it('reports changed=true when the title changes', () => {
    db.upsertCommunity('demo', 'Demo Co');
    db.upsertItem('demo', item());
    expect(db.upsertItem('demo', item({ title: 'Renamed' })).changed).toBe(true);
  });

  it('scopes item ids by community so two communities never collide', () => {
    db.upsertCommunity('a', 'A');
    db.upsertCommunity('b', 'B');
    const one = db.upsertItem('a', item());
    const two = db.upsertItem('b', item());
    expect(one.id).not.toBe(two.id);
  });

  it('stores an ok transcript and reads its status back', () => {
    db.upsertCommunity('demo', 'Demo Co');
    const { id } = db.upsertItem('demo', item());
    db.saveTranscript(id, {
      status: 'ok', text: 'hello', wordCount: 1,
      provider: 'loom', sourceUrl: 'https://www.loom.com/share/aaa',
    });
    expect(db.getTranscriptStatus(id)).toBe('ok');
  });

  it('stores the reason on an unavailable transcript', () => {
    db.upsertCommunity('demo', 'Demo Co');
    const { id } = db.upsertItem('demo', item());
    db.saveTranscript(id, { status: 'unavailable', reason: 'no captions', provider: 'loom' });
    expect(db.getTranscriptStatus(id)).toBe('unavailable');
    expect(db.getTranscriptReason(id)).toBe('no captions');
  });

  it('returns null status for an item never attempted', () => {
    db.upsertCommunity('demo', 'Demo Co');
    const { id } = db.upsertItem('demo', item());
    expect(db.getTranscriptStatus(id)).toBeNull();
  });

  it('overwrites a failed transcript on a later successful retry', () => {
    db.upsertCommunity('demo', 'Demo Co');
    const { id } = db.upsertItem('demo', item());
    db.saveTranscript(id, { status: 'failed', reason: 'timeout', provider: 'loom' });
    db.saveTranscript(id, {
      status: 'ok', text: 'hi', wordCount: 1, provider: 'loom', sourceUrl: 'u',
    });
    expect(db.getTranscriptStatus(id)).toBe('ok');
  });

  it('throws when saving a transcript for an unknown item id (foreign key constraint)', () => {
    expect(() => {
      db.saveTranscript('nonexistent:lesson:id', {
        status: 'ok', text: 'hello', wordCount: 1,
        provider: 'loom', sourceUrl: 'https://www.loom.com/share/aaa',
      });
    }).toThrow();
  });
});

describe('openDb', () => {
  it('creates parent directories for file-based databases', () => {
    const tmpDir = mkdtempSync(join(process.cwd(), 'test-db-'));
    try {
      const dbPath = join(tmpDir, 'subdir', 'nested', 'test.db');
      const db = openDb(dbPath);
      expect(() => db.upsertCommunity('test', 'Test')).not.toThrow();
      db.close();
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });
});

describe('contentHash', () => {
  it('is stable across identical items', () => {
    expect(contentHash(item())).toBe(contentHash(item()));
  });
  it('changes when the video url changes', () => {
    expect(contentHash(item())).not.toBe(contentHash(item({ videoUrl: 'https://www.loom.com/share/bbb' })));
  });
  it('changes when hasAccess changes', () => {
    expect(contentHash(item())).not.toBe(contentHash(item({ hasAccess: false })));
  });
});
