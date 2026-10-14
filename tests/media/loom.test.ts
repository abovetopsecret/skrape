import { describe, it, expect } from 'vitest';
import { loomIdFromUrl, extractCaptionsUrl, extractTranscriptionStatus } from '../../src/media/loom.js';
import { getTranscript } from '../../src/media/index.js';
import type { Fetcher } from '../../src/types.js';

const ID = '865e51f74cd4438388cf81e452191382';

// Shape-accurate synthetic page. Real Loom HTML embeds this JSON escaped.
const page = (opts: { status?: string; captions?: boolean } = {}) => {
  const status = opts.status ?? 'success';
  const captions = opts.captions ?? true;
  return `<html><body><script>window.__DATA__ = {` +
    `\\"transcription_status\\":\\"${status}\\",` +
    (captions
      ? `\\"captions_url\\":\\"https://cdn.loom.com/mediametadata/captions/${ID}-5.vtt?Policy=abc\\u0026Signature=xyz\\",`
      : '') +
    `\\"transcript_to_viewer\\":true}</script></body></html>`;
};

const stubFetcher = (pages: Record<string, string>): Fetcher => ({
  async getPage(url) {
    const body = pages[url];
    if (body === undefined) throw new Error(`unexpected fetch: ${url}`);
    return body;
  },
});

describe('loomIdFromUrl', () => {
  it('extracts the id from a share url', () => {
    expect(loomIdFromUrl(`https://www.loom.com/share/${ID}`)).toBe(ID);
  });
  it('strips query strings and trailing slashes', () => {
    expect(loomIdFromUrl(`https://www.loom.com/share/${ID}/?t=30`)).toBe(ID);
  });
  it('returns null for a non-Loom url', () => {
    expect(loomIdFromUrl('https://youtube.com/watch?v=abc')).toBeNull();
  });
});

describe('extractCaptionsUrl', () => {
  it('finds the signed captions url', () => {
    expect(extractCaptionsUrl(page())).toContain(`/captions/${ID}-5.vtt`);
  });
  it('unescapes \\u0026 into a usable ampersand', () => {
    const url = extractCaptionsUrl(page())!;
    expect(url).toContain('&Signature=');
    expect(url).not.toContain('\\u0026');
  });
  it('returns null when the page has no captions', () => {
    expect(extractCaptionsUrl(page({ captions: false }))).toBeNull();
  });
});

describe('extractTranscriptionStatus', () => {
  it('reads the status', () => {
    expect(extractTranscriptionStatus(page())).toBe('success');
  });
  it('reads a non-success status', () => {
    expect(extractTranscriptionStatus(page({ status: 'processing', captions: false }))).toBe('processing');
  });
});

describe('getTranscript', () => {
  it('returns ok with normalized text', async () => {
    // 20 cues × 5 words each = 100 words (well above the 50-word floor)
    const vtt = 'WEBVTT\n\n' + Array.from({ length: 20 }, (_, i) =>
      `00:00:${String(i).padStart(2, '0')}.000 --> 00:00:${String(i + 1).padStart(2, '0')}.000\n<v 0>Sample line number ${i} here.\n`
    ).join('\n');

    const html = page();
    const capUrl = extractCaptionsUrl(html)!;
    const result = await getTranscript(
      `https://www.loom.com/share/${ID}`,
      stubFetcher({ [`https://www.loom.com/share/${ID}`]: html, [capUrl]: vtt }),
    );
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.text).toContain('Sample line number');
      expect(result.wordCount).toBe(100);
      expect(result.provider).toBe('loom');
    }
  });

  it('reports unavailable — with the status as the reason — when captions are absent', async () => {
    const html = page({ status: 'processing', captions: false });
    const result = await getTranscript(
      `https://www.loom.com/share/${ID}`,
      stubFetcher({ [`https://www.loom.com/share/${ID}`]: html }),
    );
    expect(result.status).toBe('unavailable');
    if (result.status === 'unavailable') expect(result.reason).toContain('processing');
  });

  it('reports failed when the page fetch throws', async () => {
    const result = await getTranscript(`https://www.loom.com/share/${ID}`, {
      async getPage() { throw new Error('network down'); },
    });
    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.reason).toContain('network down');
  });

  it('flags a suspiciously short transcript instead of accepting it', async () => {
    const html = page();
    const capUrl = extractCaptionsUrl(html)!;
    const shortVtt = 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n<v 0>Hello world here.\n';
    const result = await getTranscript(
      `https://www.loom.com/share/${ID}`,
      stubFetcher({ [`https://www.loom.com/share/${ID}`]: html, [capUrl]: shortVtt }),
    );
    expect(result.status).toBe('unavailable');
    if (result.status === 'unavailable') expect(result.reason).toContain('words');
  });

  it('flags an empty transcript', async () => {
    const html = page();
    const capUrl = extractCaptionsUrl(html)!;
    const result = await getTranscript(
      `https://www.loom.com/share/${ID}`,
      stubFetcher({ [`https://www.loom.com/share/${ID}`]: html, [capUrl]: 'WEBVTT\n\n' }),
    );
    expect(result.status).toBe('unavailable');
  });

  it('reports unavailable for an unsupported host rather than throwing', async () => {
    const result = await getTranscript('https://vimeo.com/12345', stubFetcher({}));
    expect(result.status).toBe('unavailable');
    if (result.status === 'unavailable') expect(result.reason).toContain('unsupported');
  });
});
