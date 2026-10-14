import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { slugify, transcriptPath, writeTranscript } from '../../src/store/markdown.js';
import type { ContentItem } from '../../src/types.js';

const item: ContentItem = {
  nativeId: 'l1', type: 'lesson', title: 'How To Create a FB Ad Account!', index: 3,
  course: 'Facebook Ads Masterclass 2.0', section: 'Prepare Ad Account', url: null,
  videoUrl: 'https://www.loom.com/share/aaa', durationMs: 991895,
  hasAccess: true, publishedAt: null, bodyText: null,
};

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('How To Create')).toBe('how-to-create');
  });
  it('drops punctuation', () => {
    expect(slugify('FB Ad Account!')).toBe('fb-ad-account');
  });
  it('collapses runs of separators', () => {
    expect(slugify('a   --  b')).toBe('a-b');
  });
  it('falls back for an empty result rather than producing an empty filename', () => {
    expect(slugify('!!!')).toBe('untitled');
  });
  it('handles emoji-laden titles', () => {
    expect(slugify('🚀ROAD TO 8-FIGURES🚀')).toBe('road-to-8-figures');
  });
});

describe('transcriptPath', () => {
  it('nests by course and zero-pads the index for sort order', () => {
    const path = transcriptPath('/out', item);
    expect(path).toBe('/out/transcripts/facebook-ads-masterclass-20/03-how-to-create-a-fb-ad-account.md');
  });

  it('zero-pads index 5 to 05 with default width', () => {
    const testItem = { ...item, index: 5 };
    const path = transcriptPath('/out', testItem);
    expect(path).toContain('/05-');
  });

  it('does not truncate index 100 with default width (documents sort order loss)', () => {
    const testItem = { ...item, index: 100 };
    const path = transcriptPath('/out', testItem);
    expect(path).toContain('/100-');
  });

  it('pads index 5 to 0005 with padWidth 4', () => {
    const testItem = { ...item, index: 5 };
    const path = transcriptPath('/out', testItem, 4);
    expect(path).toContain('/0005-');
  });

  it('sorts correctly up to padWidth: lexicographic order of indexes 9,10,99,100 at padWidth 3', () => {
    const indexes = [9, 10, 99, 100];
    const paths = indexes.map((idx) => {
      const testItem = { ...item, index: idx };
      return transcriptPath('/out', testItem, 3);
    });
    // Extract just the filename part for sorting test
    const filenames = paths.map((p) => p.split('/').pop() ?? '');
    const sorted = [...filenames].sort();
    // With padWidth 3: 009, 010, 099, 100 should sort correctly
    expect(sorted).toEqual([
      '009-how-to-create-a-fb-ad-account.md',
      '010-how-to-create-a-fb-ad-account.md',
      '099-how-to-create-a-fb-ad-account.md',
      '100-how-to-create-a-fb-ad-account.md',
    ]);
  });

  it('demonstrates sort order loss at padWidth 2: indexes 9,10,99,100', () => {
    const indexes = [9, 10, 99, 100];
    const paths = indexes.map((idx) => {
      const testItem = { ...item, index: idx };
      return transcriptPath('/out', testItem, 2);
    });
    const filenames = paths.map((p) => p.split('/').pop() ?? '');
    const sorted = [...filenames].sort();
    // With padWidth 2: 09, 10, 99, 100
    // Lexicographically: 09, 10, 100, 99 (wrong order!)
    expect(sorted).toEqual([
      '09-how-to-create-a-fb-ad-account.md',
      '10-how-to-create-a-fb-ad-account.md',
      '100-how-to-create-a-fb-ad-account.md',
      '99-how-to-create-a-fb-ad-account.md',
    ]);
  });
});

describe('writeTranscript', () => {
  it('writes a file with a title, metadata line, source link and body', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'skool-'));
    const path = await writeTranscript(dir, item, '[0:01] Hello there.', {
      wordCount: 3275, sourceUrl: 'https://www.loom.com/share/aaa',
    });
    const content = await readFile(path, 'utf-8');
    expect(content).toContain('# How To Create a FB Ad Account!');
    expect(content).toContain('Facebook Ads Masterclass 2.0');
    expect(content).toContain('Prepare Ad Account');
    expect(content).toContain('17 min');
    expect(content).toContain('3,275 words');
    expect(content).toContain('https://www.loom.com/share/aaa');
    expect(content).toContain('[0:01] Hello there.');
  });

  it('creates missing parent directories', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'skool-'));
    const path = await writeTranscript(dir, item, 'body', { wordCount: 1, sourceUrl: 'u' });
    expect(await readFile(path, 'utf-8')).toContain('body');
  });

  it('collapses whitespace runs in title and metadata', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'skool-'));
    const itemWithWhitespace = {
      ...item,
      title: 'Title  with\n  multiple   spaces',
      course: 'Course\n  Name',
      section: 'Section\t\twith\t\ttabs',
    };
    const path = await writeTranscript(dir, itemWithWhitespace, 'body', {
      wordCount: 100,
      sourceUrl: 'https://example.com',
    });
    const content = await readFile(path, 'utf-8');
    expect(content).toContain('# Title with multiple spaces');
    expect(content).toContain('Course Name');
    expect(content).toContain('Section with tabs');
  });

  it('supports optional padWidth parameter for writeTranscript', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'skool-'));
    const highIndexItem = { ...item, index: 100 };
    const path = await writeTranscript(dir, highIndexItem, 'body', {
      wordCount: 1,
      sourceUrl: 'u',
    }, 3);
    expect(path).toContain('/100-');
  });
});
