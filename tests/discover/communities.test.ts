import { describe, it, expect } from 'vitest';
import { extractUserGroups } from '../../src/discover/communities.js';

function payload(self: unknown): unknown {
  return { props: { pageProps: { self } } };
}

describe('extractUserGroups', () => {
  it('returns null when self is missing or null (signed out)', () => {
    expect(extractUserGroups(payload(null))).toBeNull();
    expect(extractUserGroups({})).toBeNull();
  });

  it('finds a wrapped group array, matching the shape confirmed on the public discovery feed', () => {
    const self = {
      user: {
        memberships: [
          { group: { id: '1', name: 'demo', metadata: { displayName: 'Demo Community' } } },
          { group: { id: '2', name: 'aivideobootcamp', metadata: { displayName: 'AI Video Bootcamp' } } },
        ],
      },
    };
    expect(extractUserGroups(payload(self))).toEqual([
      { slug: 'demo', name: 'Demo Community' },
      { slug: 'aivideobootcamp', name: 'AI Video Bootcamp' },
    ]);
  });

  it('finds an unwrapped group array', () => {
    const self = { groups: [{ id: '1', name: 'demo', metadata: { displayName: 'Demo Co' } }] };
    expect(extractUserGroups(payload(self))).toEqual([{ slug: 'demo', name: 'Demo Co' }]);
  });

  it('falls back to the slug as the display name when displayName is missing', () => {
    const self = { groups: [{ id: '1', name: 'demo' }] };
    expect(extractUserGroups(payload(self))).toEqual([{ slug: 'demo', name: 'demo' }]);
  });

  it('dedupes by slug, keeping the first occurrence', () => {
    const self = {
      groups: [
        { id: '1', name: 'demo', metadata: { displayName: 'Demo Co' } },
        { id: '2', name: 'demo', metadata: { displayName: 'Demo Co dup' } },
      ],
    };
    expect(extractUserGroups(payload(self))).toEqual([{ slug: 'demo', name: 'Demo Co' }]);
  });

  it('returns null when nothing under self looks like a group list', () => {
    const self = { preferences: { theme: 'dark' }, notifications: [1, 2, 3] };
    expect(extractUserGroups(payload(self))).toBeNull();
  });

  it('does not treat an empty array as a match', () => {
    const self = { groups: [] };
    expect(extractUserGroups(payload(self))).toBeNull();
  });

  it('does not treat an array of unrelated objects as a match', () => {
    const self = { history: [{ page: '/a' }, { page: '/b' }] };
    expect(extractUserGroups(payload(self))).toBeNull();
  });
});
