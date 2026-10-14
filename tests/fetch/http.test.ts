import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HttpFetcher } from '../../src/fetch/http.js';

// Store original fetch
const originalFetch = globalThis.fetch;

describe('HttpFetcher', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Replace globalThis.fetch with a spy before each test
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;
  });

  afterEach(() => {
    // Restore original fetch after each test
    globalThis.fetch = originalFetch;
  });

  describe('cookie scoping', () => {
    it('attaches cookie for https://skool.com/', async () => {
      fetchSpy.mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'body' });
      const fetcher = new HttpFetcher({ cookie: 'session=abc123' });

      await fetcher.getPage('https://skool.com/path');

      expect(fetchSpy).toHaveBeenCalledOnce();
      const callArgs = fetchSpy.mock.calls[0]!;
      const headers = callArgs[1]?.headers as Record<string, string>;
      expect(headers.cookie).toBe('session=abc123');
    });

    it('attaches cookie for https://www.skool.com/', async () => {
      fetchSpy.mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'body' });
      const fetcher = new HttpFetcher({ cookie: 'session=abc123' });

      await fetcher.getPage('https://www.skool.com/path');

      expect(fetchSpy).toHaveBeenCalledOnce();
      const callArgs = fetchSpy.mock.calls[0]!;
      const headers = callArgs[1]?.headers as Record<string, string>;
      expect(headers.cookie).toBe('session=abc123');
    });

    it('attaches cookie for https://api.skool.com/', async () => {
      fetchSpy.mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'body' });
      const fetcher = new HttpFetcher({ cookie: 'session=abc123' });

      await fetcher.getPage('https://api.skool.com/path');

      expect(fetchSpy).toHaveBeenCalledOnce();
      const callArgs = fetchSpy.mock.calls[0]!;
      const headers = callArgs[1]?.headers as Record<string, string>;
      expect(headers.cookie).toBe('session=abc123');
    });

    it('does NOT attach cookie for https://cdn.loom.com/', async () => {
      fetchSpy.mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'body' });
      const fetcher = new HttpFetcher({ cookie: 'session=abc123' });

      await fetcher.getPage('https://cdn.loom.com/path');

      expect(fetchSpy).toHaveBeenCalledOnce();
      const callArgs = fetchSpy.mock.calls[0]!;
      const headers = callArgs[1]?.headers as Record<string, string>;
      expect(headers.cookie).toBeUndefined();
    });

    it('does NOT attach cookie for https://evil-skool.com/ (regression test for endsWith bug)', async () => {
      fetchSpy.mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'body' });
      const fetcher = new HttpFetcher({ cookie: 'session=abc123' });

      await fetcher.getPage('https://evil-skool.com/path');

      expect(fetchSpy).toHaveBeenCalledOnce();
      const callArgs = fetchSpy.mock.calls[0]!;
      const headers = callArgs[1]?.headers as Record<string, string>;
      expect(headers.cookie).toBeUndefined();
    });

    it('does NOT attach cookie for https://notskool.com/ (regression test for endsWith bug)', async () => {
      fetchSpy.mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'body' });
      const fetcher = new HttpFetcher({ cookie: 'session=abc123' });

      await fetcher.getPage('https://notskool.com/path');

      expect(fetchSpy).toHaveBeenCalledOnce();
      const callArgs = fetchSpy.mock.calls[0]!;
      const headers = callArgs[1]?.headers as Record<string, string>;
      expect(headers.cookie).toBeUndefined();
    });

    it('does not include cookie header when no cookie option supplied', async () => {
      fetchSpy.mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'body' });
      const fetcher = new HttpFetcher();

      await fetcher.getPage('https://www.skool.com/path');

      expect(fetchSpy).toHaveBeenCalledOnce();
      const callArgs = fetchSpy.mock.calls[0]!;
      const headers = callArgs[1]?.headers as Record<string, string>;
      expect(headers.cookie).toBeUndefined();
    });

    it('attaches cookie on both hops when a skool.com URL redirects to another skool.com URL', async () => {
      fetchSpy
        .mockResolvedValueOnce({
          ok: false,
          status: 302,
          headers: new Map([['location', 'https://www.skool.com/path/next']]),
        })
        .mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'body' });
      const fetcher = new HttpFetcher({ cookie: 'session=abc123' });

      await fetcher.getPage('https://skool.com/path');

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      const firstHopHeaders = fetchSpy.mock.calls[0]![1]?.headers as Record<string, string>;
      const secondHopHeaders = fetchSpy.mock.calls[1]![1]?.headers as Record<string, string>;
      expect(firstHopHeaders.cookie).toBe('session=abc123');
      expect(secondHopHeaders.cookie).toBe('session=abc123');
    });

    it('drops the cookie on a hop that redirects off skool.com to a non-Skool host', async () => {
      fetchSpy
        .mockResolvedValueOnce({
          ok: false,
          status: 302,
          headers: new Map([['location', 'https://evil.example.com/']]),
        })
        .mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'body' });
      const fetcher = new HttpFetcher({ cookie: 'session=abc123' });

      await fetcher.getPage('https://skool.com/path');

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      // Assert on what the stub actually RECEIVED for each call, not on intent.
      const firstHopHeaders = fetchSpy.mock.calls[0]![1]?.headers as Record<string, string>;
      const secondHopHeaders = fetchSpy.mock.calls[1]![1]?.headers as Record<string, string>;
      expect(fetchSpy.mock.calls[0]![0]).toBe('https://skool.com/path');
      expect(firstHopHeaders.cookie).toBe('session=abc123');
      expect(fetchSpy.mock.calls[1]![0]).toBe('https://evil.example.com/');
      expect(secondHopHeaders.cookie).toBeUndefined();
    });
  });

  describe('retry logic', () => {
    it('retries are bounded: failed fetch is attempted exactly retries times then throws', async () => {
      const error = new Error('connection failed');
      fetchSpy.mockRejectedValue(error);

      const fetcher = new HttpFetcher({ retries: 2 });

      try {
        await fetcher.getPage('https://example.com/');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBe(error);
      }

      // Should have been called exactly 2 times (retries=2)
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('honors default retries of 3 when not specified', async () => {
      const error = new Error('connection failed');
      fetchSpy.mockRejectedValue(error);

      const fetcher = new HttpFetcher();

      try {
        await fetcher.getPage('https://example.com/');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBe(error);
      }

      // Should have been called 3 times (default)
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it('succeeds on second attempt after transient failure', async () => {
      const error = new Error('temporary error');
      fetchSpy
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'success' });

      const fetcher = new HttpFetcher({ retries: 3 });

      const result = await fetcher.getPage('https://example.com/');

      expect(result).toBe('success');
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('rate limiting (429)', () => {
    it('handles 429 response with Retry-After header and retries', async () => {
      const mockHeaders = new Map([['retry-after', '0']]);
      fetchSpy
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: mockHeaders,
        })
        .mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'success' });

      const fetcher = new HttpFetcher({ retries: 2 });

      const result = await fetcher.getPage('https://example.com/');

      expect(result).toBe('success');
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('on 429, re-attempts before exhausting retries', async () => {
      const mockHeaders = new Map();
      fetchSpy
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: mockHeaders,
        })
        .mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'success' });

      const fetcher = new HttpFetcher({ retries: 2 });

      const result = await fetcher.getPage('https://example.com/');

      expect(result).toBe('success');
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('throws on 429 if retries exhausted', async () => {
      const mockHeaders = new Map();
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 429,
        headers: mockHeaders,
      });

      const fetcher = new HttpFetcher({ retries: 2 });

      try {
        await fetcher.getPage('https://example.com/');
        expect.fail('should have thrown');
      } catch (err) {
        expect(String(err)).toContain('rate limited');
      }

      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('error handling', () => {
    it('throws error for non-ok, non-429 status (e.g. 500)', async () => {
      fetchSpy.mockResolvedValueOnce({ ok: false, status: 500 });

      const fetcher = new HttpFetcher({ retries: 1 });

      try {
        await fetcher.getPage('https://example.com/');
        expect.fail('should have thrown');
      } catch (err) {
        expect(String(err)).toContain('HTTP 500');
      }
    });

    it('throws error for 404 response', async () => {
      fetchSpy.mockResolvedValueOnce({ ok: false, status: 404 });

      const fetcher = new HttpFetcher({ retries: 1 });

      try {
        await fetcher.getPage('https://example.com/notfound');
        expect.fail('should have thrown');
      } catch (err) {
        expect(String(err)).toContain('HTTP 404');
      }
    });

    it('includes URL in error message for non-ok status', async () => {
      fetchSpy.mockResolvedValueOnce({ ok: false, status: 500 });

      const fetcher = new HttpFetcher({ retries: 1 });

      try {
        await fetcher.getPage('https://example.com/path');
        expect.fail('should have thrown');
      } catch (err) {
        expect(String(err)).toContain('https://example.com/path');
      }
    });
  });

  describe('headers', () => {
    it('sends user-agent header', async () => {
      fetchSpy.mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'body' });

      const fetcher = new HttpFetcher();
      await fetcher.getPage('https://example.com/');

      const callArgs = fetchSpy.mock.calls[0]!;
      const headers = callArgs[1]?.headers as Record<string, string>;
      expect(headers['user-agent']).toContain('Chrome');
    });

    it('sends accept header for HTML', async () => {
      fetchSpy.mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'body' });

      const fetcher = new HttpFetcher();
      await fetcher.getPage('https://example.com/');

      const callArgs = fetchSpy.mock.calls[0]!;
      const headers = callArgs[1]?.headers as Record<string, string>;
      expect(headers.accept).toContain('text/html');
    });

    it('follows redirects and returns the final body', async () => {
      fetchSpy
        .mockResolvedValueOnce({
          ok: false,
          status: 302,
          headers: new Map([['location', 'https://example.com/final']]),
        })
        .mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'final body' });

      const fetcher = new HttpFetcher();
      const result = await fetcher.getPage('https://example.com/start');

      expect(result).toBe('final body');
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('response handling', () => {
    it('returns response text on success', async () => {
      const body = '<html><body>test</body></html>';
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => body,
      });

      const fetcher = new HttpFetcher();
      const result = await fetcher.getPage('https://example.com/');

      expect(result).toBe(body);
    });

    it('handles 200 OK response', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'success',
      });

      const fetcher = new HttpFetcher();
      const result = await fetcher.getPage('https://example.com/');

      expect(result).toBe('success');
    });
  });

  describe('redirect handling', () => {
    it('throws an error naming the limit when the redirect chain exceeds the hop limit', async () => {
      // Always redirect back to a new URL; the fetcher must bail out after its hop limit
      // rather than looping forever.
      fetchSpy.mockImplementation(async (url: string) => ({
        ok: false,
        status: 302,
        headers: new Map([['location', `${url}/next`]]),
      }));

      const fetcher = new HttpFetcher({ retries: 1 });

      try {
        await fetcher.getPage('https://example.com/start');
        expect.fail('should have thrown');
      } catch (err) {
        expect(String(err)).toContain('5');
      }
    });

    it('throws when a redirect response has no Location header', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 302,
        headers: new Map(),
      });

      const fetcher = new HttpFetcher({ retries: 1 });

      try {
        await fetcher.getPage('https://example.com/start');
        expect.fail('should have thrown');
      } catch (err) {
        expect(String(err)).not.toContain('undefined');
        expect(fetchSpy).toHaveBeenCalledOnce();
      }
    });

    it('resolves a relative Location header against the current URL', async () => {
      fetchSpy
        .mockResolvedValueOnce({
          ok: false,
          status: 302,
          headers: new Map([['location', '/next-page']]),
        })
        .mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'body' });

      const fetcher = new HttpFetcher();
      const result = await fetcher.getPage('https://example.com/start/here');

      expect(result).toBe('body');
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(fetchSpy.mock.calls[1]![0]).toBe('https://example.com/next-page');
    });
  });
});
