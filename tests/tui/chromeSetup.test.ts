import { describe, it, expect, vi } from 'vitest';
import { ensureChromeReady, ChromeInstallFailedError, type ChromeSetupDeps } from '../../src/tui/chromeSetup.js';

const FAKE_INSTALLED_PATH = '/opt/google/chrome/chrome';

function baseDeps(overrides: Partial<ChromeSetupDeps> = {}): ChromeSetupDeps {
  return {
    isConfirmedInstalled: vi.fn(async () => false),
    probeLaunchable: vi.fn(async () => undefined),
    markInstalled: vi.fn(async () => {}),
    installChrome: vi.fn(async () => FAKE_INSTALLED_PATH),
    ...overrides,
  };
}

describe('ensureChromeReady — already confirmed', () => {
  it('skips the probe and the installer entirely when the marker says installed', async () => {
    const deps = baseDeps({ isConfirmedInstalled: vi.fn(async () => true) });

    const result = await ensureChromeReady(deps);

    expect(result).toEqual({ installed: false });
    expect(deps.probeLaunchable).not.toHaveBeenCalled();
    expect(deps.installChrome).not.toHaveBeenCalled();
    expect(deps.markInstalled).not.toHaveBeenCalled();
  });
});

describe('ensureChromeReady — probe finds it already launchable', () => {
  it('skips the installer and writes the marker with the resolved executable path so future runs skip the probe too', async () => {
    const deps = baseDeps({
      isConfirmedInstalled: vi.fn(async () => false),
      probeLaunchable: vi.fn(async () => FAKE_INSTALLED_PATH),
    });

    const result = await ensureChromeReady(deps);

    expect(result).toEqual({ installed: false });
    expect(deps.probeLaunchable).toHaveBeenCalledOnce();
    expect(deps.installChrome).not.toHaveBeenCalled();
    expect(deps.markInstalled).toHaveBeenCalledOnce();
    expect(deps.markInstalled).toHaveBeenCalledWith(FAKE_INSTALLED_PATH);
  });
});

describe('ensureChromeReady — install step (fresh run, no marker)', () => {
  it('runs the installer when neither the marker nor the probe find Chrome, then marks the resolved path — not just `true`', async () => {
    const deps = baseDeps({
      isConfirmedInstalled: vi.fn(async () => false),
      probeLaunchable: vi.fn(async () => undefined),
      installChrome: vi.fn(async (onProgress: (elapsed: number) => void) => {
        onProgress(1);
        return FAKE_INSTALLED_PATH;
      }),
    });
    const progressCalls: number[] = [];

    const result = await ensureChromeReady(deps, (elapsed) => progressCalls.push(elapsed));

    expect(result).toEqual({ installed: true });
    expect(deps.installChrome).toHaveBeenCalledOnce();
    expect(deps.markInstalled).toHaveBeenCalledOnce();
    expect(deps.markInstalled).toHaveBeenCalledWith(FAKE_INSTALLED_PATH);
    expect(progressCalls).toEqual([1]);
  });

  it('works with no onProgress callback supplied', async () => {
    const deps = baseDeps({
      isConfirmedInstalled: vi.fn(async () => false),
      probeLaunchable: vi.fn(async () => undefined),
    });

    await expect(ensureChromeReady(deps)).resolves.toEqual({ installed: true });
  });
});

describe('ensureChromeReady — marker path exists on disk', () => {
  it('a truthy isConfirmedInstalled (cheap on-disk check) skips straight past install with no launch at all', async () => {
    const deps = baseDeps({ isConfirmedInstalled: vi.fn(() => true) });

    const result = await ensureChromeReady(deps);

    expect(result).toEqual({ installed: false });
    expect(deps.probeLaunchable).not.toHaveBeenCalled();
    expect(deps.installChrome).not.toHaveBeenCalled();
  });
});

describe('ensureChromeReady — marker references a path that no longer exists', () => {
  it('is treated as not-installed and re-runs the same install flow a first-time user gets, rather than erroring', async () => {
    // Simulates `isChromeMarkedInstalled` having found the marker file but the
    // executable path it recorded no longer existing on disk (uninstalled/moved).
    const deps = baseDeps({
      isConfirmedInstalled: vi.fn(async () => false),
      probeLaunchable: vi.fn(async () => undefined),
      installChrome: vi.fn(async () => FAKE_INSTALLED_PATH),
    });

    const result = await ensureChromeReady(deps);

    expect(result).toEqual({ installed: true });
    expect(deps.installChrome).toHaveBeenCalledOnce();
    expect(deps.markInstalled).toHaveBeenCalledOnce();
    expect(deps.markInstalled).toHaveBeenCalledWith(FAKE_INSTALLED_PATH);
  });
});

describe('ensureChromeReady — install failure', () => {
  it('rejects with a ChromeInstallFailedError carrying the manual fallback command, and does not mark installed', async () => {
    const underlying = new Error('ENOSPC: no space left on device');
    const deps = baseDeps({
      isConfirmedInstalled: vi.fn(async () => false),
      probeLaunchable: vi.fn(async () => undefined),
      installChrome: vi.fn(async () => {
        throw underlying;
      }),
    });

    await expect(ensureChromeReady(deps)).rejects.toBeInstanceOf(ChromeInstallFailedError);

    // Re-run to inspect the rejection's message/cause without a second unhandled throw.
    let caught: unknown;
    try {
      await ensureChromeReady(deps);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ChromeInstallFailedError);
    const error = caught as ChromeInstallFailedError;
    expect(error.message).toContain('npx playwright install chrome');
    expect(error.message).toContain('ENOSPC');
    expect(error.cause).toBe(underlying);
    expect(deps.markInstalled).not.toHaveBeenCalled();
  });

  it('wraps a non-Error rejection (e.g. a plain string throw) without crashing', async () => {
    const deps = baseDeps({
      isConfirmedInstalled: vi.fn(async () => false),
      probeLaunchable: vi.fn(async () => undefined),
      installChrome: vi.fn(async () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw 'disk full';
      }),
    });

    await expect(ensureChromeReady(deps)).rejects.toThrow(/disk full/);
  });
});
