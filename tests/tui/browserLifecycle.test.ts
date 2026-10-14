import { describe, it, expect, vi } from 'vitest';
import { createBrowserLifecycle, translateLaunchError, type CloseableFetcher } from '../../src/tui/browserLifecycle.js';
import type { Fetcher } from '../../src/types.js';

const LOGGED_IN_HTML = `<script id="__NEXT_DATA__">{"props":{"pageProps":{"self":{"id":"u1"}}}}</script>`;
const LOGGED_OUT_HTML = `<script id="__NEXT_DATA__">{"props":{"pageProps":{"self":null}}}</script>`;

const isLoggedIn = (html: string): boolean => html === LOGGED_IN_HTML;

function fakeBrowser(html: string | (() => string) = LOGGED_IN_HTML): {
  browser: CloseableFetcher;
  closeSpy: ReturnType<typeof vi.fn>;
} {
  const closeSpy = vi.fn(async () => {});
  const browser: CloseableFetcher = {
    getPage: vi.fn(async () => (typeof html === 'function' ? html() : html)),
    close: closeSpy,
  };
  return { browser, closeSpy };
}

function fakeHttp(): Fetcher {
  // Skool.com URLs need a __NEXT_DATA__ payload from ResilientFetcher's HTTP leg
  // to avoid escalating; return nothing useful so every call escalates to the browser,
  // exactly like the real anonymous fetch that started this whole bug.
  return { getPage: vi.fn(async () => '<html><body>anonymous, no payload</body></html>') };
}

describe('createBrowserLifecycle — checkLoggedIn', () => {
  it('closes its browser before returning on the logged-in (true) path', async () => {
    const { browser, closeSpy } = fakeBrowser(LOGGED_IN_HTML);
    const makeBrowserFetcher = vi.fn(() => browser);
    const lifecycle = createBrowserLifecycle({
      http: fakeHttp(),
      isLoggedIn,
      makeBrowserFetcher,
      performLogin: vi.fn(async () => {}),
    });

    const result = await lifecycle.checkLoggedIn();

    expect(result).toBe(true);
    expect(closeSpy).toHaveBeenCalledOnce();
  });

  it('closes its browser before returning on the logged-out (false) path', async () => {
    const { browser, closeSpy } = fakeBrowser(LOGGED_OUT_HTML);
    const lifecycle = createBrowserLifecycle({
      http: fakeHttp(),
      isLoggedIn,
      makeBrowserFetcher: () => browser,
      performLogin: vi.fn(async () => {}),
    });

    const result = await lifecycle.checkLoggedIn();

    expect(result).toBe(false);
    expect(closeSpy).toHaveBeenCalledOnce();
  });

  it('closes its browser even when the check throws', async () => {
    const closeSpy = vi.fn(async () => {});
    const browser: CloseableFetcher = {
      getPage: vi.fn(async () => {
        throw new Error('boom');
      }),
      close: closeSpy,
    };
    const lifecycle = createBrowserLifecycle({
      http: fakeHttp(),
      isLoggedIn,
      makeBrowserFetcher: () => browser,
      performLogin: vi.fn(async () => {}),
    });

    await expect(lifecycle.checkLoggedIn()).rejects.toThrow('boom');
    expect(closeSpy).toHaveBeenCalledOnce();
  });
});

describe('createBrowserLifecycle — no two browsers open at once', () => {
  it('across check -> login -> sync, at most one browser instance is ever open', async () => {
    // Track how many BrowserFetcher-equivalents are simultaneously "open"
    // (created but not yet closed) — this is exactly the invariant that broke:
    // checkLoggedIn's browser was still open when login() tried to launch a second one.
    let openCount = 0;
    let maxOpenCount = 0;
    let instancesCreated = 0;

    const makeBrowserFetcher = vi.fn((): CloseableFetcher => {
      instancesCreated += 1;
      openCount += 1;
      maxOpenCount = Math.max(maxOpenCount, openCount);
      return {
        getPage: vi.fn(async () => LOGGED_IN_HTML),
        close: vi.fn(async () => {
          openCount -= 1;
        }),
      };
    });

    let loginContextClose: (() => Promise<void>) | undefined;
    const performLogin = vi.fn(async (onContext: (ctx: { close(): Promise<void> }) => void) => {
      // The real login() also launches a headed Chrome against the same profile —
      // model that as a second kind of "open" instance sharing the same counter.
      openCount += 1;
      maxOpenCount = Math.max(maxOpenCount, openCount);
      const close = async (): Promise<void> => {
        openCount -= 1;
      };
      loginContextClose = close;
      onContext({ close });
      await close();
      loginContextClose = undefined;
    });

    const lifecycle = createBrowserLifecycle({
      http: fakeHttp(),
      isLoggedIn,
      makeBrowserFetcher,
      performLogin,
    });

    await lifecycle.checkLoggedIn();
    await lifecycle.login();
    lifecycle.getFetcher();
    await lifecycle.getFetcher().getPage('https://www.skool.com/demo/classroom');

    expect(maxOpenCount).toBe(1);
    expect(instancesCreated).toBeGreaterThanOrEqual(2); // check's browser + the post-login one are distinct
    void loginContextClose;
  });
});

describe('createBrowserLifecycle — cleanup', () => {
  it('closes the currently-live instance', async () => {
    const { browser, closeSpy } = fakeBrowser(LOGGED_IN_HTML);
    const lifecycle = createBrowserLifecycle({
      http: fakeHttp(),
      isLoggedIn,
      makeBrowserFetcher: () => browser,
      performLogin: vi.fn(async () => {}),
    });

    lifecycle.getFetcher();
    await lifecycle.cleanup();

    expect(closeSpy).toHaveBeenCalledOnce();
  });

  it('is safe when no browser was ever created', async () => {
    const lifecycle = createBrowserLifecycle({
      http: fakeHttp(),
      isLoggedIn,
      makeBrowserFetcher: vi.fn(),
      performLogin: vi.fn(async () => {}),
    });

    await expect(lifecycle.cleanup()).resolves.toBeUndefined();
  });

  it('is safe to call twice', async () => {
    const { browser, closeSpy } = fakeBrowser(LOGGED_IN_HTML);
    const lifecycle = createBrowserLifecycle({
      http: fakeHttp(),
      isLoggedIn,
      makeBrowserFetcher: () => browser,
      performLogin: vi.fn(async () => {}),
    });

    lifecycle.getFetcher();
    await lifecycle.cleanup();
    await lifecycle.cleanup();

    expect(closeSpy).toHaveBeenCalledOnce();
  });

  it('closes an in-progress login context if cleanup runs mid-login (simulated SIGINT)', async () => {
    const loginCloseSpy = vi.fn(async () => {});
    const performLogin = vi.fn(async (onContext: (ctx: { close(): Promise<void> }) => void) => {
      onContext({ close: loginCloseSpy });
      // Simulate the user never finishing sign-in — a "SIGINT" fires cleanup()
      // concurrently and this promise never resolves on its own.
      await new Promise<void>(() => {});
    });

    const lifecycle = createBrowserLifecycle({
      http: fakeHttp(),
      isLoggedIn,
      makeBrowserFetcher: vi.fn(),
      performLogin,
    });

    void lifecycle.login();
    // Give login() a tick to reach performLogin() and register its context.
    await new Promise((resolve) => setTimeout(resolve, 0));

    await lifecycle.cleanup();

    expect(loginCloseSpy).toHaveBeenCalledOnce();
  });
});

describe('createBrowserLifecycle — login', () => {
  it('closes any browser held from checkLoggedIn before launching', async () => {
    const { browser: checkBrowser, closeSpy: checkClose } = fakeBrowser(LOGGED_OUT_HTML);
    const performLogin = vi.fn(async () => {});
    const lifecycle = createBrowserLifecycle({
      http: fakeHttp(),
      isLoggedIn,
      makeBrowserFetcher: () => checkBrowser,
      performLogin,
    });

    // checkLoggedIn already closes its own browser (asserted elsewhere), but
    // login() must not assume that and should defensively ensure the profile
    // is free regardless of call order.
    await lifecycle.checkLoggedIn();
    expect(checkClose).toHaveBeenCalledOnce();

    await lifecycle.login();
    expect(performLogin).toHaveBeenCalledOnce();
  });

  it('translates a ProcessSingleton lock failure into a short human message', async () => {
    const rawError = new Error(
      [
        'Failed to create a ProcessSingleton for your profile directory.',
        'This usually means that the profile is already in use by another instance of Chromium.',
        "Failed to create .../chrome-profile/SingletonLock: File exists (17)",
        ...Array.from({ length: 50 }, (_, i) => `  at someInternalFrame${i} (playwright/lib/index.js:${i}:1)`),
      ].join('\n'),
    );
    const performLogin = vi.fn(async () => {
      throw rawError;
    });
    const lifecycle = createBrowserLifecycle({
      http: fakeHttp(),
      isLoggedIn,
      makeBrowserFetcher: vi.fn(),
      performLogin,
    });

    try {
      await lifecycle.login();
      throw new Error('expected login() to reject');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toMatch(/already in use/i);
      expect(message).not.toMatch(/at someInternalFrame/);
      expect(message.length).toBeLessThan(400);
      expect((error as Error).cause).toBe(rawError);
    }
  });
});

describe('translateLaunchError', () => {
  it('leaves unrelated errors untouched', () => {
    const original = new Error('ECONNREFUSED');
    expect(translateLaunchError(original)).toBe(original);
  });

  it('produces a short message for ProcessSingleton failures', () => {
    const raw = new Error('Failed to create a ProcessSingleton for your profile directory.\n' + 'x'.repeat(5000));
    const translated = translateLaunchError(raw);
    expect(translated.message).toMatch(/already in use/i);
    expect(translated.message.length).toBeLessThan(300);
    expect(translated.cause).toBe(raw);
  });

  it('produces a short message for SingletonLock failures', () => {
    const raw = new Error("Failed to create .../chrome-profile/SingletonLock: File exists (17)");
    const translated = translateLaunchError(raw);
    expect(translated.message).toMatch(/already in use/i);
  });
});
