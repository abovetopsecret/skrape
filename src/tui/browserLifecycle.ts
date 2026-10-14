import { ResilientFetcher } from '../fetch/resilient.js';
import type { Fetcher } from '../types.js';

/**
 * A Fetcher that also owns a real Chrome process and must be closed to
 * release it.
 */
export interface CloseableFetcher extends Fetcher {
  close(): Promise<void>;
}

/**
 * ============================================================================
 * INVARIANT: only one Chrome process may hold the persistent profile
 * directory at a time. Chrome enforces this itself (SingletonLock) and
 * aborts a second launch against the same profile. Every operation below
 * that needs a browser always closes whatever browser is currently live
 * (via closeCurrent()) before handing out a new one — so the profile is
 * provably held by at most one Chrome at any instant.
 * ============================================================================
 */
/** A handle callers can use to force-close a launched login context, e.g. on Ctrl+C. */
export interface LoginContextHandle {
  close(): Promise<void>;
}

export interface BrowserLifecycleDeps {
  http: Fetcher;
  isLoggedIn: (html: string) => boolean;
  /** Creates a fresh, not-yet-launched BrowserFetcher over the profile dir. */
  makeBrowserFetcher: () => CloseableFetcher;
  /**
   * The real interactive sign-in flow (headed Chrome, same profile dir).
   * `onContext` is called as soon as the headed browser launches, so the
   * lifecycle can track it and force-close it on SIGINT even while
   * performLogin() is still awaiting the user.
   */
  performLogin: (onContext: (context: LoginContextHandle) => void) => Promise<void>;
}

export interface BrowserLifecycle {
  /**
   * Checks whether the saved profile is already signed in. Owns a
   * short-lived browser for the duration of the check only — the profile is
   * guaranteed free again the instant this call resolves or rejects, so a
   * following login() never collides with it.
   */
  checkLoggedIn(): Promise<boolean>;
  /**
   * Runs the interactive login flow. Closes any browser this lifecycle is
   * currently holding first, so the profile is always free before the real
   * (headed) Chrome launches against it.
   */
  login(): Promise<void>;
  /**
   * Returns the long-lived fetcher used for discovery and sync. Lazily
   * launches one fresh browser behind it on first call and reuses it for
   * every call after that.
   */
  getFetcher(): Fetcher;
  /**
   * Closes whichever browser instance is currently live, if any. Safe to
   * call when nothing was ever created and safe to call more than once.
   */
  cleanup(): Promise<void>;
}

const LOCK_ERROR_PATTERN = /ProcessSingleton|SingletonLock/i;

/** True when an error looks like Chrome's "profile already in use" failure. */
export function isProfileLockError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return LOCK_ERROR_PATTERN.test(message);
}

/**
 * Turns Playwright's multi-hundred-line ProcessSingleton/SingletonLock dump
 * into one short, actionable line. The raw error is kept on `.cause` for
 * non-TUI diagnostics (e.g. `--verbose` logging) rather than shown to the
 * user. Anything else passes through unchanged.
 */
export function translateLaunchError(error: unknown): Error {
  if (isProfileLockError(error)) {
    const friendly = new Error(
      'The Chrome profile is already in use. Another skrape process may be running. ' +
        'if not, delete ~/.skool-skrape/chrome-profile/SingletonLock and try again.',
    );
    friendly.cause = error;
    return friendly;
  }
  return error instanceof Error ? error : new Error(String(error));
}

function wrapLaunchErrors(browser: CloseableFetcher): CloseableFetcher {
  return {
    async getPage(url: string): Promise<string> {
      try {
        return await browser.getPage(url);
      } catch (error) {
        throw translateLaunchError(error);
      }
    },
    async close(): Promise<void> {
      try {
        await browser.close();
      } catch (error) {
        throw translateLaunchError(error);
      }
    },
  };
}

export function createBrowserLifecycle(deps: BrowserLifecycleDeps): BrowserLifecycle {
  const { http, isLoggedIn, makeBrowserFetcher, performLogin } = deps;

  // Tracks whichever browser (BrowserFetcher-backed, or the raw login
  // context) currently owns the profile directory, if any. Never held by
  // more than one at a time — see invariant above. At most one of these two
  // is non-null at any instant.
  let current: CloseableFetcher | null = null;
  let loginContext: LoginContextHandle | null = null;
  let sharedFetcher: Fetcher | null = null;

  async function closeCurrent(): Promise<void> {
    const browser = current;
    current = null;
    const login = loginContext;
    loginContext = null;
    if (browser) await browser.close();
    if (login) await login.close();
  }

  return {
    async checkLoggedIn(): Promise<boolean> {
      const browser = wrapLaunchErrors(makeBrowserFetcher());
      current = browser;
      const fetcher = new ResilientFetcher(http, async () => browser, isLoggedIn);
      try {
        const html = await fetcher.getPage('https://www.skool.com/');
        return isLoggedIn(html);
      } finally {
        // The check's browser is never reused — always release it here so
        // the profile is free the instant the check is done, whatever the
        // outcome.
        await closeCurrent();
      }
    },

    async login(): Promise<void> {
      // Defensive: guarantees the invariant even if a caller invokes login()
      // out of the usual check -> login order.
      await closeCurrent();
      try {
        await performLogin((context) => {
          loginContext = context;
        });
        // performLogin() already closed its own context on success.
        loginContext = null;
      } catch (error) {
        // If a browser did launch before the failure, close it ourselves —
        // otherwise a failed/interrupted login leaves the profile locked
        // for the next run. If SIGINT already closed it (see cleanup()),
        // loginContext is already null here and there is nothing to do.
        const context = loginContext;
        loginContext = null;
        if (context) {
          await context.close().catch(() => {
            // Best-effort: we're already reporting the original error.
          });
        }
        throw translateLaunchError(error);
      }
    },

    getFetcher(): Fetcher {
      if (!sharedFetcher) {
        const browser = wrapLaunchErrors(makeBrowserFetcher());
        current = browser;
        sharedFetcher = new ResilientFetcher(http, async () => browser, isLoggedIn);
      }
      return sharedFetcher;
    },

    cleanup: closeCurrent,
  };
}
