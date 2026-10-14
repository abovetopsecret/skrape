import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * All the real, non-pure IO Playwright's Chrome install needs: checking a
 * cheap on-disk marker, probing whether Chrome is actually launchable, and
 * running the installer. Kept separate from `../tui/chromeSetup.ts`, which
 * holds the decision logic and is unit-tested against fakes of the
 * functions here — none of *this* file is meaningfully unit-testable
 * (it launches a real browser / spawns a real child process / hits disk).
 */

/**
 * True when a past run confirmed Chrome installed *and* the executable path
 * recorded then still exists now. The marker stores that resolved path
 * (see `markChromeInstalled`) rather than a bare flag, so an uninstall,
 * move, or OS package-manager removal after the marker was written is
 * caught here — cheaply, via `existsSync`, never by launching a browser.
 * A missing/unreadable/empty marker is just treated as "not installed".
 */
export function isChromeMarkedInstalled(markerPath: string): boolean {
  return markedExecutablePath(markerPath) !== null;
}

/** The browser executable a past run confirmed, if the marker exists and that path still does. */
export function markedExecutablePath(markerPath: string): string | null {
  if (!existsSync(markerPath)) return null;
  let storedPath: string;
  try {
    storedPath = readFileSync(markerPath, 'utf8').trim();
  } catch {
    return null;
  }
  return storedPath.length > 0 && existsSync(storedPath) ? storedPath : null;
}

/** Records the confirmed Chrome executable's path, so later runs can skip
 *  the probe by cheaply checking that path still exists on disk. */
export async function markChromeInstalled(markerPath: string, executablePath: string): Promise<void> {
  await writeFile(markerPath, executablePath, 'utf8');
}

/**
 * Real "is Chrome actually launchable" probe: Playwright exposes no public
 * API to ask "is the 'chrome' channel installed" without launching it —
 * `chromium.executablePath()` takes no channel argument and always returns
 * the bundled Chromium's default path regardless, whether or not anything
 * is actually installed there. So the reliable check is a real launch.
 *
 * This launches a throwaway, headless Chrome via `browserType.launchServer()`
 * (no persistent context, no profile directory at all) and closes it
 * immediately — it can never touch the user's real login profile, and nothing
 * survives the call either way. `launchServer()` (unlike `launch()`) exposes
 * the spawned process via `.process()`, whose Node `spawnfile` is the actual
 * resolved Chrome executable path Playwright launched — that's what gets
 * returned so callers can persist a marker that verifies something real,
 * rather than a bare boolean. Playwright itself is imported dynamically so
 * a user who already has a confirmed marker (the common case after the first
 * run) never pays Playwright's module-load cost at all.
 */
export async function probeChromeLaunchable(): Promise<string | undefined> {
  let chromium: typeof import('playwright').chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return undefined;
  }
  // Prefer the user's real Chrome; fall back to Playwright's own Chromium (what gets
  // installed on Linux, where installing Chrome itself needs root).
  const candidates: Array<{ channel?: string; executablePath?: string }> = [{ channel: 'chrome' }];
  if (existsSync(chromium.executablePath())) candidates.push({ executablePath: chromium.executablePath() });
  for (const options of candidates) {
    try {
      const server = await chromium.launchServer({ ...options, headless: true });
      try {
        return server.process().spawnfile;
      } finally {
        await server.close();
      }
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

/** Which browser to install when none is launchable: Chrome where that needs no root, Chromium on Linux. */
export const INSTALL_TARGET = process.platform === 'linux' ? 'chromium' : 'chrome';

/** Resolves the on-disk path to Playwright's own bundled CLI script, via the
 *  package's exported `./package.json` subpath (not `./cli.js`, which isn't
 *  in Playwright's `exports` map and so can't be resolved directly) — this
 *  needs no network or npm resolution, unlike shelling out to `npx`. */
async function resolvePlaywrightCliPath(): Promise<string> {
  const pkgJsonUrl = import.meta.resolve('playwright/package.json');
  return join(dirname(fileURLToPath(pkgJsonUrl)), 'cli.js');
}

/**
 * Runs the equivalent of `npx playwright install chrome` in-process, by
 * spawning Playwright's own bundled CLI script directly. Preferred over
 * `npx playwright install chrome` because the CLI path is resolved from
 * node_modules up front (no npm package resolution / registry round trip
 * just to find the command), and preferred over trying to call an in-process
 * "install" function because Playwright doesn't export one from its public
 * API surface — the installer lives inside its bundled, unexported CLI.
 *
 * `onProgress` fires roughly once a second with the elapsed seconds so
 * callers can render a simple "still working…" indicator — Playwright's own
 * download progress bars are written directly to the child's TTY and aren't
 * easily piped through as structured progress.
 */
export async function installChromeViaCli(onProgress?: (elapsedSeconds: number) => void): Promise<void> {
  const cliPath = await resolvePlaywrightCliPath();

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, 'install', INSTALL_TARGET], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const startedAt = Date.now();
    const interval = setInterval(() => {
      onProgress?.(Math.round((Date.now() - startedAt) / 1000));
    }, 1000);

    child.on('error', (error) => {
      clearInterval(interval);
      reject(error);
    });

    child.on('exit', (code) => {
      clearInterval(interval);
      if (code === 0) {
        resolve();
        return;
      }
      const detail = (stderr || stdout).trim().split('\n').slice(-20).join('\n');
      reject(new Error(`\`playwright install chrome\` exited with code ${code}${detail ? `:\n${detail}` : ''}`));
    });
  });
}
