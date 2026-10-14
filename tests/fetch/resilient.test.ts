import { describe, it, expect, vi } from 'vitest';
import { ResilientFetcher } from '../../src/fetch/resilient.js';
import type { Fetcher } from '../../src/types.js';

const GOOD = `<script id="__NEXT_DATA__">{"props":{"pageProps":{}}}</script>`;
const LOGIN = `<html><body>Please log in</body></html>`;

const fetcherOf = (fn: (url: string) => Promise<string>): Fetcher => ({ getPage: fn });

describe('ResilientFetcher', () => {
  it('uses HTTP and never builds a browser when the payload parses', async () => {
    const makeBrowser = vi.fn();
    const resilient = new ResilientFetcher(fetcherOf(async () => GOOD), makeBrowser as never);
    expect(await resilient.getPage('https://www.skool.com/demo/classroom')).toBe(GOOD);
    expect(makeBrowser).not.toHaveBeenCalled();
  });

  it('escalates to the browser when the payload is missing', async () => {
    const browser = fetcherOf(async () => GOOD);
    const makeBrowser = vi.fn(async () => browser);
    const resilient = new ResilientFetcher(fetcherOf(async () => LOGIN), makeBrowser);
    expect(await resilient.getPage('https://www.skool.com/demo/classroom')).toBe(GOOD);
    expect(makeBrowser).toHaveBeenCalledOnce();
  });

  it('remembers the escalation and skips HTTP for the same route next time', async () => {
    const http = vi.fn(async () => LOGIN);
    const makeBrowser = vi.fn(async () => fetcherOf(async () => GOOD));
    const resilient = new ResilientFetcher(fetcherOf(http), makeBrowser);
    await resilient.getPage('https://www.skool.com/demo/classroom/c1');
    await resilient.getPage('https://www.skool.com/demo/classroom/c2');
    expect(http).toHaveBeenCalledOnce();
    expect(makeBrowser).toHaveBeenCalledOnce();
  });

  it('builds the browser only once across many escalations', async () => {
    const makeBrowser = vi.fn(async () => fetcherOf(async () => GOOD));
    const resilient = new ResilientFetcher(fetcherOf(async () => LOGIN), makeBrowser);
    await resilient.getPage('https://www.skool.com/a/classroom');
    await resilient.getPage('https://www.skool.com/b/other');
    expect(makeBrowser).toHaveBeenCalledOnce();
  });

  it('does NOT escalate on a network error — it rethrows', async () => {
    const makeBrowser = vi.fn();
    const resilient = new ResilientFetcher(
      fetcherOf(async () => { throw new Error('ECONNREFUSED'); }),
      makeBrowser as never,
    );
    await expect(resilient.getPage('https://www.skool.com/demo/classroom')).rejects.toThrow('ECONNREFUSED');
    expect(makeBrowser).not.toHaveBeenCalled();
  });

  it('exposes which routes escalated, for the sync summary', async () => {
    const resilient = new ResilientFetcher(
      fetcherOf(async () => LOGIN),
      async () => fetcherOf(async () => GOOD),
    );
    await resilient.getPage('https://www.skool.com/demo/classroom');
    // Route key includes hostname to distinguish different hosts
    expect([...resilient.escalatedRoutes]).toContain('www.skool.com/demo/classroom');
  });

  it('passes non-Skool urls straight through without payload checking', async () => {
    const makeBrowser = vi.fn();
    const resilient = new ResilientFetcher(fetcherOf(async () => 'raw vtt'), makeBrowser as never);
    expect(await resilient.getPage('https://cdn.loom.com/x.vtt')).toBe('raw vtt');
    expect(makeBrowser).not.toHaveBeenCalled();
  });

  it('prevents concurrent calls from invoking makeBrowser multiple times (concurrency race regression)', async () => {
    let resolveDelayed: () => void;
    const delayedPromise = new Promise<Fetcher>((resolve) => {
      resolveDelayed = () => resolve(fetcherOf(async () => GOOD));
    });
    const makeBrowser = vi.fn(async () => delayedPromise);

    const resilient = new ResilientFetcher(fetcherOf(async () => LOGIN), makeBrowser);

    // Fire three concurrent requests that will all escalate, without awaiting between them
    const promises = [
      resilient.getPage('https://www.skool.com/a/route1'),
      resilient.getPage('https://www.skool.com/b/route2'),
      resilient.getPage('https://www.skool.com/c/route3'),
    ];

    // Give all three a chance to hit the race window
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Now resolve the delayed makeBrowser promise
    resolveDelayed!();

    await Promise.all(promises);

    // makeBrowser should have been called exactly once despite three concurrent escalations
    expect(makeBrowser).toHaveBeenCalledOnce();
  });

  it('retries on makeBrowser rejection (does not permanently poison the fetcher)', async () => {
    let callCount = 0;
    const makeBrowser = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('Transient browser launch failure');
      }
      return fetcherOf(async () => GOOD);
    });

    const resilient = new ResilientFetcher(fetcherOf(async () => LOGIN), makeBrowser);

    // First escalation attempt fails
    await expect(resilient.getPage('https://www.skool.com/demo/classroom')).rejects.toThrow(
      'Transient browser launch failure',
    );

    // Second escalation attempt should retry and succeed (memo was cleared on rejection)
    expect(await resilient.getPage('https://www.skool.com/demo/classroom')).toBe(GOOD);

    // makeBrowser should have been called twice (once failed, once succeeded)
    expect(makeBrowser).toHaveBeenCalledTimes(2);
  });

  it('escalates to the browser when the payload parses but the validator says logged-out (Finding 1)', async () => {
    const browser = fetcherOf(async () => GOOD);
    const makeBrowser = vi.fn(async () => browser);
    const isAuthenticated = vi.fn(() => false);
    const resilient = new ResilientFetcher(fetcherOf(async () => GOOD), makeBrowser, isAuthenticated);
    expect(await resilient.getPage('https://www.skool.com/demo/classroom')).toBe(GOOD);
    expect(makeBrowser).toHaveBeenCalledOnce();
    expect(isAuthenticated).toHaveBeenCalledWith(GOOD);
  });

  it('does NOT escalate when the payload parses and the validator says logged-in', async () => {
    const makeBrowser = vi.fn();
    const isAuthenticated = vi.fn(() => true);
    const resilient = new ResilientFetcher(fetcherOf(async () => GOOD), makeBrowser as never, isAuthenticated);
    expect(await resilient.getPage('https://www.skool.com/demo/classroom')).toBe(GOOD);
    expect(makeBrowser).not.toHaveBeenCalled();
  });

  it('never runs the validator against a non-Skool URL, even one that would fail it', async () => {
    const makeBrowser = vi.fn();
    const isAuthenticated = vi.fn(() => false);
    const resilient = new ResilientFetcher(fetcherOf(async () => 'raw vtt'), makeBrowser as never, isAuthenticated);
    expect(await resilient.getPage('https://cdn.loom.com/x.vtt')).toBe('raw vtt');
    expect(makeBrowser).not.toHaveBeenCalled();
    expect(isAuthenticated).not.toHaveBeenCalled();
  });

  it('with no validator supplied, behaves exactly as before', async () => {
    const makeBrowser = vi.fn();
    const resilient = new ResilientFetcher(fetcherOf(async () => GOOD), makeBrowser as never);
    expect(await resilient.getPage('https://www.skool.com/demo/classroom')).toBe(GOOD);
    expect(makeBrowser).not.toHaveBeenCalled();
  });

  it('distinguishes routes by hostname to prevent collisions', async () => {
    const makeBrowser = vi.fn(async () => fetcherOf(async () => GOOD));
    const resilient = new ResilientFetcher(fetcherOf(async () => LOGIN), makeBrowser);

    // Same path on different hosts should NOT share escalation bucket
    await resilient.getPage('https://www.skool.com/demo/classroom');
    expect(makeBrowser).toHaveBeenCalledTimes(1);

    // Calling the SAME PATH on a different host should NOT skip HTTP (different route)
    const httpCallCount = vi.fn(async () => LOGIN);
    const resilient2 = new ResilientFetcher(fetcherOf(httpCallCount), makeBrowser);
    await resilient2.getPage('https://other-skool.com/demo/classroom');

    // HTTP should be called because this is a different hostname
    expect(httpCallCount).toHaveBeenCalledOnce();
  });
});
