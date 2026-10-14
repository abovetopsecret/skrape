import type { Fetcher } from '../types.js';
import { browserLaunchOptions } from '../auth/session.js';

/**
 * Playwright-backed fallback. Playwright is imported dynamically so that users
 * who never hit the fallback never pay its startup cost — and so the package
 * still works if the optional dependency is absent.
 */
export class BrowserFetcher implements Fetcher {
  private context: unknown = null;
  private contextPromise: Promise<unknown> | null = null;
  private closed = false;

  constructor(private readonly profileDir: string) {}

  private async ensureContext(): Promise<{ newPage(): Promise<{
    goto(url: string, opts: object): Promise<unknown>;
    content(): Promise<string>;
    close(): Promise<void>;
  }> }> {
    if (this.closed) {
      throw new Error('BrowserFetcher is closed, cannot open a new context after close()');
    }
    if (!this.context) {
      try {
        this.contextPromise ??= (async () => {
          const { chromium } = await import('playwright');
          return await chromium.launchPersistentContext(this.profileDir, {
            ...browserLaunchOptions(),
            headless: true,
          });
        })();
        this.context = await this.contextPromise;
      } catch (error) {
        // Clear the promise memo on rejection to allow retries
        this.contextPromise = null;
        throw error;
      }
    }
    return this.context as { newPage(): Promise<{
      goto(url: string, opts: object): Promise<unknown>;
      content(): Promise<string>;
      close(): Promise<void>;
    }> };
  }

  async getPage(url: string): Promise<string> {
    const context = await this.ensureContext();
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      return await page.content();
    } finally {
      await page.close();
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.context) {
      await (this.context as { close(): Promise<void> }).close();
    }
    // Clear both context and its promise memo — no fresh launch is possible after close()
    // since ensureContext() now rejects once `closed` is set.
    this.context = null;
    this.contextPromise = null;
  }
}
