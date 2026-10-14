import type { Fetcher } from '../types.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface HttpFetcherOptions {
  cookie?: string;
  retries?: number;
}

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class HttpFetcher implements Fetcher {
  constructor(private readonly options: HttpFetcherOptions = {}) {}

  async getPage(url: string): Promise<string> {
    const retries = this.options.retries ?? 3;
    let lastError: Error = new Error('no attempt made');

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await this.fetchFollowingRedirects(url);

        if (response.status === 429) {
          const retryAfter = Number(response.headers.get('retry-after') ?? 0);
          await sleep(retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000);
          lastError = new Error('rate limited (429)');
          continue;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);

        return await response.text();
      } catch (error) {
        lastError = error as Error;
        if (attempt < retries - 1) await sleep(2 ** attempt * 500);
      }
    }
    throw lastError;
  }

  /**
   * Follows redirects manually, one hop at a time, so the cookie decision is
   * re-evaluated against the CURRENT hop's hostname rather than the original
   * URL. This prevents a skool.com -> off-domain redirect from carrying the
   * session cookie to a non-Skool host.
   */
  private async fetchFollowingRedirects(initialUrl: string): Promise<Response> {
    let currentUrl = initialUrl;

    for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
      const headers: Record<string, string> = { 'user-agent': UA, accept: 'text/html,*/*' };
      // Only send the Skool session to Skool. Loom must stay unauthenticated.
      // Recomputed on every hop: see comment above.
      const { hostname } = new URL(currentUrl);
      const isSkool = hostname === 'skool.com' || hostname.endsWith('.skool.com');
      if (this.options.cookie && isSkool) {
        headers.cookie = this.options.cookie;
      }

      const response = await fetch(currentUrl, { headers, redirect: 'manual' });

      if (!REDIRECT_STATUSES.has(response.status)) {
        return response;
      }

      const location = response.headers.get('location');
      if (!location) {
        throw new Error(`Redirect response (${response.status}) missing Location header for ${currentUrl}`);
      }
      currentUrl = new URL(location, currentUrl).toString();
    }

    throw new Error(`Too many redirects: exceeded limit of ${MAX_REDIRECTS} hops for ${initialUrl}`);
  }
}
