import { describe, it, expect } from 'vitest';
import { isLoggedIn, profileDir, dbPath } from '../../src/auth/session.js';

describe('isLoggedIn', () => {
  it('is true when the page carries a payload with pageProps', () => {
    expect(isLoggedIn(`<script id="__NEXT_DATA__">{"props":{"pageProps":{"self":{"id":"u1"}}}}</script>`)).toBe(true);
  });
  it('is false for a page with no payload at all', () => {
    expect(isLoggedIn('<html><body>Log in to Skool</body></html>')).toBe(false);
  });
  it('is false when the payload has a null self, meaning signed out', () => {
    expect(isLoggedIn(`<script id="__NEXT_DATA__">{"props":{"pageProps":{"self":null}}}</script>`)).toBe(false);
  });
  it('is false for a top-level null payload (valid JSON)', () => {
    expect(isLoggedIn(`<script id="__NEXT_DATA__">null</script>`)).toBe(false);
  });
  it('is false for a top-level string payload', () => {
    expect(isLoggedIn(`<script id="__NEXT_DATA__">"some string"</script>`)).toBe(false);
  });
  it('is false for a top-level number payload', () => {
    expect(isLoggedIn(`<script id="__NEXT_DATA__">42</script>`)).toBe(false);
  });
  it('is false when props is present but pageProps is absent', () => {
    expect(isLoggedIn(`<script id="__NEXT_DATA__">{"props":{"other":"data"}}</script>`)).toBe(false);
  });
});

describe('paths', () => {
  it('puts the profile under a dot-directory in home', () => {
    expect(profileDir()).toMatch(/\.skool-skrape[/\\]chrome-profile$/);
  });
  it('puts the database alongside it', () => {
    expect(dbPath()).toMatch(/\.skool-skrape[/\\]skool\.db$/);
  });
});
