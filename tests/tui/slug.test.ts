import { describe, it, expect } from 'vitest';
import { isValidSlug, normalizeSlug } from '../../src/tui/slug.js';

describe('normalizeSlug', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeSlug('  demo  ')).toBe('demo');
  });

  it('strips a full skool.com URL down to the slug', () => {
    expect(normalizeSlug('https://www.skool.com/demo')).toBe('demo');
    expect(normalizeSlug('skool.com/demo')).toBe('demo');
  });

  it('drops any trailing path segments, such as /classroom', () => {
    expect(normalizeSlug('https://www.skool.com/demo/classroom')).toBe('demo');
  });

  it('leaves a bare slug untouched', () => {
    expect(normalizeSlug('demo')).toBe('demo');
  });
});

describe('isValidSlug', () => {
  it('accepts a typical slug', () => {
    expect(isValidSlug('demo')).toBe(true);
    expect(isValidSlug('ai-video-bootcamp')).toBe(true);
  });

  it('rejects empty input', () => {
    expect(isValidSlug('')).toBe(false);
  });

  it('rejects slashes and whitespace', () => {
    expect(isValidSlug('demo/classroom')).toBe(false);
    expect(isValidSlug('demo slug')).toBe(false);
  });

  it('rejects a slug starting or ending with a hyphen', () => {
    expect(isValidSlug('-demo')).toBe(false);
    expect(isValidSlug('demo-')).toBe(false);
  });
});
