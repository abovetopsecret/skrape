import { execFile } from 'node:child_process';

export interface RevealDeps {
  /** Injectable so tests never spawn a real process. Defaults to
   *  node:child_process's execFile, promisified. */
  run: (command: string, args: string[]) => Promise<void>;
  platform: NodeJS.Platform;
  /** Where to print the path when reveal isn't possible/fails. Defaults to
   *  console.log. */
  log: (message: string) => void;
}

function defaultRun(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export function defaultRevealDeps(): RevealDeps {
  return { run: defaultRun, platform: process.platform, log: (message) => console.log(message) };
}

/** Maps a platform to the OS command that reveals a folder in the file
 *  manager, or null when there's no known one to try. */
function revealCommandFor(platform: NodeJS.Platform): { command: string; args: (path: string) => string[] } | null {
  switch (platform) {
    case 'darwin':
      return { command: 'open', args: (path) => [path] };
    case 'win32':
      return { command: 'explorer', args: (path) => [path] };
    case 'linux':
      return { command: 'xdg-open', args: (path) => [path] };
    default:
      return null;
  }
}

/**
 * Reveals `outDir` in the OS file manager. Tries the platform-appropriate
 * command; if there isn't one for this platform, or the command fails (not
 * installed, headless environment, etc.), this never throws — it just prints
 * the path instead, so a failed reveal can never crash the TUI.
 */
export async function revealOutputFolder(outDir: string, deps: RevealDeps = defaultRevealDeps()): Promise<void> {
  const reveal = revealCommandFor(deps.platform);
  if (!reveal) {
    deps.log(outDir);
    return;
  }
  try {
    await deps.run(reveal.command, reveal.args(outDir));
  } catch {
    deps.log(outDir);
  }
}
