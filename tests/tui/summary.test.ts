import { describe, it, expect } from 'vitest';
import { formatSummary, nothingTranscribed } from '../../src/tui/summary.js';
import type { SyncSummary } from '../../src/sync.js';

const emptySummary: SyncSummary = {
  counts: { ok: 0, skipped: 0, 'no-video': 0, 'no-access': 0, unavailable: 0, failed: 0 },
  problems: [],
  totalWords: 0,
};

describe('nothingTranscribed', () => {
  it('is true when nothing succeeded and no words were captured', () => {
    expect(nothingTranscribed(emptySummary)).toBe(true);
  });

  it('is false once at least one lesson succeeded', () => {
    const summary: SyncSummary = { ...emptySummary, counts: { ...emptySummary.counts, ok: 1 }, totalWords: 100 };
    expect(nothingTranscribed(summary)).toBe(false);
  });
});

describe('formatSummary', () => {
  it('says loudly, as the first line, when nothing was transcribed', () => {
    const lines = formatSummary(emptySummary, './out/demo');
    expect(lines[0]).toMatch(/nothing was transcribed/i);
  });

  it('does not print the loud empty-run banner when something succeeded', () => {
    const summary: SyncSummary = { ...emptySummary, counts: { ...emptySummary.counts, ok: 3 }, totalWords: 900 };
    const lines = formatSummary(summary, './out/demo');
    expect(lines.some((line) => /nothing was transcribed/i.test(line))).toBe(false);
  });

  it('lists problems with course, title, and reason', () => {
    const summary: SyncSummary = {
      ...emptySummary,
      counts: { ...emptySummary.counts, ok: 1, 'no-access': 1 },
      totalWords: 500,
      problems: [{ outcome: 'no-access', course: 'C1', title: '(entire course)', reason: 'hasAccess is 0' }],
    };
    const lines = formatSummary(summary, './out/demo');
    expect(lines.some((line) => line.includes('C1') && line.includes('hasAccess is 0'))).toBe(true);
  });

  it('includes the output path', () => {
    const lines = formatSummary(emptySummary, './out/demo');
    expect(lines.some((line) => line.includes('./out/demo'))).toBe(true);
  });

  it('includes the total word count, formatted with thousands separators', () => {
    const summary: SyncSummary = { ...emptySummary, counts: { ...emptySummary.counts, ok: 1 }, totalWords: 12345 };
    const lines = formatSummary(summary, './out/demo');
    expect(lines.some((line) => line.includes('12,345'))).toBe(true);
  });
});

describe('formatSummary headline', () => {
  it('calls a re-sync with everything already on disk up to date, not empty', () => {
    const summary: SyncSummary = { ...emptySummary, counts: { ...emptySummary.counts, skipped: 4 } };
    expect(formatSummary(summary, './out/demo')[0]).toMatch(/up to date/i);
  });
});

describe('formatSummary problem order', () => {
  it('lists failures before routine no-video lessons', () => {
    const summary: SyncSummary = {
      ...emptySummary,
      problems: [
        { outcome: 'no-video', course: 'C', title: 'Intro', reason: 'none' },
        { outcome: 'failed', course: 'C', title: 'Broken', reason: 'boom' },
      ],
    };
    const lines = formatSummary(summary, './out/demo');
    expect(lines.findIndex((l) => l.includes('Broken'))).toBeLessThan(lines.findIndex((l) => l.includes('Intro')));
  });
});
