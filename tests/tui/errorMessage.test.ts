import { describe, it, expect } from 'vitest';
import { truncateErrorText } from '../../src/tui/App.js';

describe('truncateErrorText', () => {
  it('leaves a short single-line message untouched', () => {
    expect(truncateErrorText('boom')).toBe('boom');
  });

  it('caps a many-line Playwright-style dump to a handful of lines', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `  at frame${i} (playwright/lib/index.js:${i}:1)`);
    const message = ['Failed to create a ProcessSingleton for your profile directory.', ...lines].join('\n');
    const result = truncateErrorText(message);
    expect(result.split('\n').length).toBeLessThanOrEqual(7); // MAX_ERROR_LINES + truncation marker
    expect(result).toContain('truncated');
  });

  it('caps a single very long line by character count', () => {
    const message = 'x'.repeat(5000);
    const result = truncateErrorText(message);
    expect(result.length).toBeLessThan(900);
    expect(result).toContain('truncated');
  });
});
