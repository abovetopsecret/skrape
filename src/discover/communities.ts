import { extractNextData, PayloadParseError } from '../fetch/nextdata.js';
import type { Fetcher } from '../types.js';

export interface CommunityRef {
  slug: string;
  name: string;
}

function readSelf(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return undefined;
  const props = (payload as Record<string, unknown>)['props'];
  if (!props || typeof props !== 'object') return undefined;
  const pageProps = (props as Record<string, unknown>)['pageProps'];
  if (!pageProps || typeof pageProps !== 'object') return undefined;
  return (pageProps as Record<string, unknown>)['self'];
}

/**
 * Skool's public, logged-out discovery feed (skool.com/) embeds each community as
 * `{ group: { name, metadata: { displayName } } }`, where `name` is the URL slug —
 * confirmed by fetching that page live. Whether the authenticated `self` object
 * reuses this exact shape for the signed-in user's own memberships could not be
 * verified without real credentials, so this accepts either that wrapped shape or
 * an unwrapped `{ name, metadata: { displayName } }` object.
 */
function asCommunityRef(candidate: unknown): CommunityRef | null {
  if (!candidate || typeof candidate !== 'object') return null;
  const record = candidate as Record<string, unknown>;
  const groupField = record['group'];
  const inner = groupField && typeof groupField === 'object'
    ? (groupField as Record<string, unknown>)
    : record;

  const slug = inner['name'];
  if (typeof slug !== 'string' || slug.length === 0) return null;

  const metadata = inner['metadata'];
  const displayName = metadata && typeof metadata === 'object'
    ? (metadata as Record<string, unknown>)['displayName']
    : undefined;
  const name = typeof displayName === 'string' && displayName.length > 0 ? displayName : slug;

  return { slug, name };
}

/**
 * Best-effort scan of the __NEXT_DATA__ payload's `self` object for the signed-in
 * user's community memberships. Deliberately shape-tolerant rather than hardcoding
 * one exact path: it walks `self` (bounded depth) looking for the first array whose
 * every element matches a "group embed" shape (see asCommunityRef above). Returns
 * null — never a guessed or partial list — when nothing matches, so callers know to
 * fall back to manual slug entry instead of showing a fabricated list.
 */
export function extractUserGroups(payload: unknown, maxDepth = 4): CommunityRef[] | null {
  const self = readSelf(payload);
  if (!self || typeof self !== 'object') return null;

  const visit = (node: unknown, depth: number): CommunityRef[] | null => {
    if (depth > maxDepth || node === null || typeof node !== 'object') return null;

    if (Array.isArray(node) && node.length > 0) {
      const refs = node.map(asCommunityRef);
      if (refs.every((ref): ref is CommunityRef => ref !== null)) {
        const seen = new Set<string>();
        return refs.filter((ref) => {
          if (seen.has(ref.slug)) return false;
          seen.add(ref.slug);
          return true;
        });
      }
    }

    for (const value of Object.values(node as Record<string, unknown>)) {
      const found = visit(value, depth + 1);
      if (found) return found;
    }
    return null;
  };

  return visit(self, 0);
}

/**
 * Fetches skool.com/ through the caller's authenticated fetcher stack and looks
 * for the signed-in user's communities. Returns null (not an empty array) when
 * the page didn't yield a parseable payload or no group-shaped list was found —
 * both are treated the same way by callers: fall back to manual slug entry.
 * A genuine network failure still propagates, distinct from a shape mismatch.
 */
export async function listUserCommunities(fetcher: Fetcher): Promise<CommunityRef[] | null> {
  const html = await fetcher.getPage('https://www.skool.com/');
  try {
    return extractUserGroups(extractNextData(html));
  } catch (error) {
    if (error instanceof PayloadParseError) return null;
    throw error;
  }
}
