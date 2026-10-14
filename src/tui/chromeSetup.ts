import { INSTALL_TARGET } from '../fetch/chromeSetup.js';
/**
 * Pure decision logic for the one-time "make sure Chrome is installed" step
 * that runs before the session check. Kept free of fs/child_process/Playwright
 * details (those live in `../fetch/chromeSetup.ts`) so the branching here is
 * unit-testable against plain fakes, the same split used by `flow.ts` and
 * `browserLifecycle.ts` elsewhere in this package.
 */

export interface ChromeSetupDeps {
  /** Cheap on-disk check: was this already confirmed on a past run, and does
   *  the executable path recorded then still exist now? */
  isConfirmedInstalled: () => Promise<boolean> | boolean;
  /** Real (but cheap: headless, throwaway, closes fast) launch-and-close
   *  check. Resolves the launched Chrome's executable path on success, or
   *  `undefined` if it couldn't be launched. */
  probeLaunchable: () => Promise<string | undefined>;
  /** Persists the confirmed executable path so future calls can skip
   *  straight to it (via a cheap existence check, not another launch). */
  markInstalled: (executablePath: string) => Promise<void>;
  /** Runs the actual installer and resolves the freshly-installed Chrome's
   *  executable path; rejects on failure (network/disk/permissions/platform,
   *  or an install that "succeeded" but still isn't launchable). */
  installChrome: (onProgress: (elapsedSeconds: number) => void) => Promise<string>;
}

export interface ChromeReadyResult {
  /** True only when this call actually ran the installer. */
  installed: boolean;
}

const MANUAL_FALLBACK = `npx playwright install ${INSTALL_TARGET}`;

/** Thrown when the automatic install fails. Its message is already
 *  human-actionable (includes the manual fallback command) — callers can
 *  surface `.message` directly without needing to know install internals. */
export class ChromeInstallFailedError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ChromeInstallFailedError';
  }
}

/**
 * Ensures Chrome is installed and launchable, installing it if not.
 *
 * Order, cheapest-first:
 *  1. Trust a previously-written "confirmed installed" marker — no launch at
 *     all, as long as the executable path it recorded still exists on disk.
 *  2. Otherwise, do the real (but cheap) launch-and-close probe.
 *  3. Only if that fails, run the installer — and mark the resolved path it
 *     hands back so steps 2/3 are never repeated on later runs.
 *
 * Never throws a raw/undecorated error: any installChrome() failure is
 * wrapped in `ChromeInstallFailedError` with the manual fallback command
 * included, per this project's no-silent-failures rule.
 */
export async function ensureChromeReady(
  deps: ChromeSetupDeps,
  onProgress?: (elapsedSeconds: number) => void,
): Promise<ChromeReadyResult> {
  if (await deps.isConfirmedInstalled()) {
    return { installed: false };
  }

  const probedPath = await deps.probeLaunchable();
  if (probedPath) {
    await deps.markInstalled(probedPath);
    return { installed: false };
  }

  let installedPath: string;
  try {
    installedPath = await deps.installChrome(onProgress ?? (() => {}));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ChromeInstallFailedError(
      `Could not automatically install the browser skrape needs.\n${message}\n\n` +
        `You can install it yourself, then run skrape again:\n  ${MANUAL_FALLBACK}`,
      { cause: error },
    );
  }

  await deps.markInstalled(installedPath);
  return { installed: true };
}
