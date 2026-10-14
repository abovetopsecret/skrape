import { describe, it, expect } from 'vitest';
import type { ContentItem } from '../src/types.js';

describe('scaffold', () => {
  it('exposes the ContentItem shape', () => {
    // Type annotation is the real compile-time check; npm run typecheck enforces it.
    const item: ContentItem = {
      nativeId: 'abc', type: 'lesson', title: 'T', index: 0,
      course: 'C', section: null, url: null, videoUrl: null,
      durationMs: 0, hasAccess: true, publishedAt: null, bodyText: null,
    };
    // Runtime assertion: verify all expected keys are present
    expect(Object.keys(item).sort()).toEqual([
      'bodyText', 'course', 'durationMs', 'hasAccess', 'index', 'nativeId',
      'publishedAt', 'section', 'title', 'type', 'url', 'videoUrl',
    ]);
  });
});
