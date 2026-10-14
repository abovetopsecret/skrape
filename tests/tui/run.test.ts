import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type React from 'react';

// run.ts is tested at the level of its own wiring — db/browser lifecycle
// ownership and cleanup — not by driving real Ink keypresses (not
// meaningfully unit-testable; see other tui tests). 'ink' is mocked so
// render() never touches a real terminal; instead the mock hands back the
// `controllers` prop run.ts built, which these tests drive directly the way
// the App component would (calling runSync one or more times), then resolve
// the captured `waitUntilExit` the way Ink resolves it when the user quits.

const mocks = vi.hoisted(() => {
  const state: {
    waitUntilExitResolve: (() => void) | null;
    capturedControllers: unknown;
  } = { waitUntilExitResolve: null, capturedControllers: null };

  const fakeSummary = {
    counts: { ok: 1, skipped: 0, 'no-video': 0, 'no-access': 0, unavailable: 0, failed: 0 },
    problems: [],
    totalWords: 10,
  };

  return {
    state,
    dbClose: vi.fn(),
    syncClassroom: vi.fn(async () => fakeSummary),
    lifecycleCleanup: vi.fn(async () => {}),
    lifecycleGetFetcher: vi.fn(() => ({ getPage: vi.fn(async () => '') })),
    createBrowserLifecycle: vi.fn(),
    callOrder: [] as string[],
    ensureChromeReady: vi.fn(async () => ({ installed: false })),
  };
});

// Kept separate from `mocks` above because it wires together spies already
// defined on `mocks` — a plain function (not itself hoisted) is fine since
// it's only ever called lazily, from inside the browserLifecycle.js mock
// factory below, well after `mocks` has been initialized.
function lifecycleFactory(): { checkLoggedIn: () => Promise<boolean>; login: () => Promise<void>; getFetcher: typeof mocks.lifecycleGetFetcher; cleanup: typeof mocks.lifecycleCleanup } {
  return {
    checkLoggedIn: async () => true,
    login: async () => {},
    getFetcher: mocks.lifecycleGetFetcher,
    cleanup: mocks.lifecycleCleanup,
  };
}

vi.mock('ink', () => ({
  render: vi.fn((element: React.ReactElement<{ controllers: unknown }>) => {
    mocks.callOrder.push('render');
    mocks.state.capturedControllers = element.props.controllers;
    return {
      waitUntilExit: () =>
        new Promise<void>((resolve) => {
          mocks.state.waitUntilExitResolve = resolve;
        }),
    };
  }),
}));

vi.mock('../../src/store/db.js', () => ({
  openDb: vi.fn(() => ({ close: mocks.dbClose })),
}));

vi.mock('../../src/auth/session.js', () => ({
  ensureRoot: vi.fn(async () => {}),
  dbPath: vi.fn(() => '/tmp/fake.db'),
  defaultOutRoot: vi.fn(() => '/tmp/fake-out'),
  profileDir: vi.fn(() => '/tmp/fake-profile'),
  chromeMarkerPath: vi.fn(() => '/tmp/fake-chrome-marker'),
  isLoggedIn: vi.fn(() => true),
  login: vi.fn(async () => {}),
}));

vi.mock('../../src/fetch/chromeSetup.js', () => ({
  isChromeMarkedInstalled: vi.fn(() => true),
  markChromeInstalled: vi.fn(async () => {}),
  probeChromeLaunchable: vi.fn(async () => true),
  installChromeViaCli: vi.fn(async () => {}),
}));

vi.mock('../../src/tui/chromeSetup.js', () => ({
  ensureChromeReady: (...args: unknown[]) => {
    mocks.callOrder.push('ensureChromeReady');
    return mocks.ensureChromeReady(...args);
  },
}));

vi.mock('../../src/fetch/http.js', () => ({
  HttpFetcher: vi.fn(function HttpFetcher(this: unknown) {
    return this;
  }),
}));

vi.mock('../../src/fetch/browser.js', () => ({
  BrowserFetcher: vi.fn(function BrowserFetcher(this: unknown) {
    return this;
  }),
}));

vi.mock('../../src/discover/skool.js', () => ({
  listCourses: vi.fn(async () => []),
}));

vi.mock('../../src/discover/communities.js', () => ({
  listUserCommunities: vi.fn(async () => []),
}));

vi.mock('../../src/sync.js', () => ({
  syncClassroom: (...args: unknown[]) => mocks.syncClassroom(...args),
}));

vi.mock('../../src/tui/browserLifecycle.js', () => ({
  createBrowserLifecycle: (...args: unknown[]) => {
    mocks.createBrowserLifecycle(...args);
    return lifecycleFactory();
  },
}));

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

interface FakeControllers {
  runSync: (slug: string, outDir: string, onProgress: (event: unknown) => void) => Promise<unknown>;
}

function controllers(): FakeControllers {
  return mocks.state.capturedControllers as FakeControllers;
}

describe('runGuidedFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.waitUntilExitResolve = null;
    mocks.state.capturedControllers = null;
    mocks.callOrder.length = 0;
    mocks.ensureChromeReady.mockResolvedValue({ installed: false });
  });

  afterEach(() => {
    process.removeAllListeners('SIGINT');
  });

  it('closes the browser and db exactly once when the user quits', async () => {
    const { runGuidedFlow } = await import('../../src/tui/run.js');
    const runPromise = runGuidedFlow();
    await flushMicrotasks();

    expect(mocks.state.waitUntilExitResolve).not.toBeNull();
    mocks.state.waitUntilExitResolve!();
    await runPromise;

    expect(mocks.lifecycleCleanup).toHaveBeenCalledTimes(1);
    expect(mocks.dbClose).toHaveBeenCalledTimes(1);
  });

  it('running two syncs in one session before quitting still closes the browser and db exactly once', async () => {
    const { runGuidedFlow } = await import('../../src/tui/run.js');
    const runPromise = runGuidedFlow();
    await flushMicrotasks();

    expect(controllers()).not.toBeNull();
    await controllers().runSync('community-a', './out/community-a', () => {});
    await controllers().runSync('community-a', './out/community-a', () => {});

    expect(mocks.syncClassroom).toHaveBeenCalledTimes(2);
    // The same underlying fetcher is reused across syncs — the lifecycle's
    // getFetcher() singleton, not a fresh browser per sync.
    expect(mocks.lifecycleGetFetcher).toHaveBeenCalled();

    mocks.state.waitUntilExitResolve!();
    await runPromise;

    expect(mocks.lifecycleCleanup).toHaveBeenCalledTimes(1);
    expect(mocks.dbClose).toHaveBeenCalledTimes(1);
  });

  it('re-invokes runSync with the same slug when "sync this community again" is chosen', async () => {
    const { runGuidedFlow } = await import('../../src/tui/run.js');
    const runPromise = runGuidedFlow();
    await flushMicrotasks();

    await controllers().runSync('demo', './out/demo', () => {});
    await controllers().runSync('demo', './out/demo', () => {});

    expect(mocks.syncClassroom).toHaveBeenNthCalledWith(1, expect.objectContaining({ slug: 'demo', outDir: './out/demo' }));
    expect(mocks.syncClassroom).toHaveBeenNthCalledWith(2, expect.objectContaining({ slug: 'demo', outDir: './out/demo' }));

    mocks.state.waitUntilExitResolve!();
    await runPromise;
  });

  it('Ctrl+C (SIGINT) during a second sync still triggers cleanup exactly once, without waiting for waitUntilExit', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((() => undefined) as unknown) as typeof process.exit);
    const { runGuidedFlow } = await import('../../src/tui/run.js');
    void runGuidedFlow();
    await flushMicrotasks();

    // Simulate a first sync having already completed, then a second one
    // in flight when Ctrl+C arrives.
    await controllers().runSync('demo', './out/demo', () => {});
    const secondSync = controllers().runSync('demo', './out/demo', () => {});

    process.emit('SIGINT');
    await flushMicrotasks();

    expect(mocks.lifecycleCleanup).toHaveBeenCalledTimes(1);
    expect(mocks.dbClose).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(130);

    await secondSync;
    exitSpy.mockRestore();
  });

  it('runs the Chrome setup step before Ink (and therefore the session check) ever mounts', async () => {
    const { runGuidedFlow } = await import('../../src/tui/run.js');
    const runPromise = runGuidedFlow();
    await flushMicrotasks();

    expect(mocks.callOrder).toEqual(['ensureChromeReady', 'render']);

    mocks.state.waitUntilExitResolve!();
    await runPromise;
  });

  it('propagates a Chrome install failure and never opens the db or mounts Ink', async () => {
    mocks.ensureChromeReady.mockRejectedValueOnce(
      new Error('Could not automatically install the browser skrape needs.\n\nnpx playwright install chrome'),
    );
    const { runGuidedFlow } = await import('../../src/tui/run.js');

    await expect(runGuidedFlow()).rejects.toThrow(/npx playwright install chrome/);

    expect(mocks.dbClose).not.toHaveBeenCalled();
    expect(mocks.callOrder).toEqual(['ensureChromeReady']);
  });
});
