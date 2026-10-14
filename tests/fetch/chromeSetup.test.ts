import { describe, it, expect, vi, beforeEach } from 'vitest';

// A fake in-memory filesystem — proves `isChromeMarkedInstalled` does its
// on-disk check with plain, cheap fs calls and nothing else. A `playwright`
// mock that throws on import backs up the "never launches a browser to do
// this check" claim: if the code path under test tried to reach Playwright,
// these tests would fail loudly instead of silently passing.
const fsState = vi.hoisted(() => ({
  files: new Map<string, string>(),
}));

vi.mock('node:fs', () => ({
  existsSync: (path: string) => fsState.files.has(path),
  readFileSync: (path: string) => {
    const contents = fsState.files.get(path);
    if (contents === undefined) throw new Error(`ENOENT: ${path}`);
    return contents;
  },
}));

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(async (path: string, data: string) => {
    fsState.files.set(path, data);
  }),
}));

vi.mock('playwright', () => {
  throw new Error('playwright must never be imported by the cheap marker check');
});

const { isChromeMarkedInstalled, markChromeInstalled } = await import('../../src/fetch/chromeSetup.js');

const MARKER_PATH = '/fake/.skool-skrape/chrome-installed';
const CHROME_PATH = '/fake/opt/google/chrome/chrome';

beforeEach(() => {
  fsState.files.clear();
});

describe('isChromeMarkedInstalled — fresh run, no marker file', () => {
  it('is false, so ensureChromeReady falls through to the probe/install flow', () => {
    expect(isChromeMarkedInstalled(MARKER_PATH)).toBe(false);
  });
});

describe('isChromeMarkedInstalled — marker path exists on disk', () => {
  it('is true via a cheap existsSync check, with no Playwright import at all', () => {
    fsState.files.set(MARKER_PATH, CHROME_PATH);
    fsState.files.set(CHROME_PATH, ''); // the "chrome executable" itself exists

    expect(isChromeMarkedInstalled(MARKER_PATH)).toBe(true);
  });
});

describe('isChromeMarkedInstalled — marker references a path that no longer exists', () => {
  it('is false (uninstalled/moved Chrome), not a crash or a stale true', () => {
    fsState.files.set(MARKER_PATH, CHROME_PATH);
    // Note: CHROME_PATH is deliberately NOT added to fsState.files — simulates
    // an uninstall, a move, or OS package-manager removal after the marker
    // was written.

    expect(isChromeMarkedInstalled(MARKER_PATH)).toBe(false);
  });

  it('is false when the marker file is empty', () => {
    fsState.files.set(MARKER_PATH, '');

    expect(isChromeMarkedInstalled(MARKER_PATH)).toBe(false);
  });
});

describe('markChromeInstalled', () => {
  it('writes the resolved executable path itself — not a bare boolean/timestamp flag', async () => {
    await markChromeInstalled(MARKER_PATH, CHROME_PATH);

    expect(fsState.files.get(MARKER_PATH)).toBe(CHROME_PATH);
  });
});
