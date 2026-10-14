import { describe, it, expect } from 'vitest';
import { BrowserFetcher } from '../../src/fetch/browser.js';

describe('BrowserFetcher', () => {
  it('close() is safe on a virgin instance without launched context', async () => {
    const fetcher = new BrowserFetcher('/tmp/profile');

    // Close a never-launched instance
    await fetcher.close();

    // Both fields stay null (harmless on virgin instance)
    const state = fetcher as unknown as {
      context: unknown;
      contextPromise: unknown;
    };

    expect(state.context).toBe(null);
    expect(state.contextPromise).toBe(null);
  });

  it('close() clears stale contextPromise memo to allow fresh context on retry', async () => {
    const fetcher = new BrowserFetcher('/tmp/profile');

    // Seed both fields as if a context had been launched
    const fake = { close: async () => {} };
    (fetcher as unknown as { context: unknown }).context = fake;
    (fetcher as unknown as { contextPromise: unknown }).contextPromise = Promise.resolve(fake);

    // Call close()
    await fetcher.close();

    // Both fields should be null, allowing a fresh launch on next getPage()
    const state = fetcher as unknown as {
      context: unknown;
      contextPromise: unknown;
    };

    expect(state.context).toBe(null);
    expect(state.contextPromise).toBe(null);
  });

  it('getPage() after close() rejects instead of launching a fresh context (Finding 3)', async () => {
    const fetcher = new BrowserFetcher('/tmp/profile');
    await fetcher.close();

    await expect(fetcher.getPage('https://www.skool.com/demo/classroom')).rejects.toThrow(/closed/i);
  });
});
