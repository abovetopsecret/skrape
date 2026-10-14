const NEXT_DATA_RE = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;

/**
 * Signals that a page did not yield a parseable payload — the trigger for
 * escalating a route from HTTP to a real browser. Distinct from network errors,
 * which must NOT trigger escalation.
 */
export class PayloadParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayloadParseError';
  }
}

export function extractNextData(html: string): unknown {
  const match = html.match(NEXT_DATA_RE);
  if (!match) throw new PayloadParseError('no __NEXT_DATA__ script tag (session expired or markup changed?)');
  try {
    return JSON.parse(match[1]!);
  } catch (error) {
    throw new PayloadParseError(`malformed __NEXT_DATA__ JSON: ${(error as Error).message}`);
  }
}
