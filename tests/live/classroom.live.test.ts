// Runs only with SKOOL_LIVE_TEST=1. Hits a public Loom share URL via a bare
// HttpFetcher with no cookie and never touches Skool or the persisted session,
// so it needs no `skool login` — that is exactly what it demonstrates.
import { describe, it, expect } from 'vitest';
import { HttpFetcher } from '../../src/fetch/http.js';
import { loomTranscript } from '../../src/media/loom.js';

describe('live Loom transcript', () => {
  it('pulls a real transcript with no authentication', async () => {
    const result = await loomTranscript(
      'https://www.loom.com/share/865e51f74cd4438388cf81e452191382',
      new HttpFetcher(),
    );
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.wordCount).toBeGreaterThan(1000);
      expect(result.text).toMatch(/^\[\d+:\d\d\] /);
    }
  }, 60_000);
});
