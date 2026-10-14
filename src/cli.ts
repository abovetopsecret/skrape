#!/usr/bin/env node
import './quiet.js';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { styleText } from 'node:util';
import { Command } from 'commander';
import { HttpFetcher } from './fetch/http.js';
import { BrowserFetcher } from './fetch/browser.js';
import { ResilientFetcher } from './fetch/resilient.js';
import { openDb } from './store/db.js';
import { syncClassroom } from './sync.js';
import { formatSummary, type Paint } from './tui/summary.js';
import { OUTCOME_STYLE, displayPath, formatDuration } from './tui/theme.js';
import { login, profileDir, dbPath, defaultOutRoot, ensureRoot, isLoggedIn } from './auth/session.js';

// Color only for a human at a terminal; pipes and NO_COLOR get plain text.
const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint: Paint = (color, text) => (useColor ? styleText(color, text) : text);

const MAX_CONCURRENCY = 16;

/** Parse the --concurrency flag to a positive integer, or return null if invalid. */
function parseConcurrency(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return null;
  return Math.min(n, MAX_CONCURRENCY);
}

const program = new Command();
const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

program
  .name('skrape')
  .description('Read Skool course content instead of watching it')
  .version(version, '-v, --version')
  .addHelpText('after', '\nRun `skrape` with no arguments for the guided, interactive flow.');

program
  .command('login')
  .description('Sign in to Skool once; the session is reused by later runs')
  .action(async () => {
    console.log('A browser window is opening. Sign in to Skool there (Ctrl+C to cancel)…');
    await login();
    console.log(`${paint('green', '✓')} Signed in. Future runs reuse this session.`);
  });

program
  .command('sync')
  .argument('<slug>', 'community slug, e.g. demo from skool.com/demo')
  .option('-o, --out <dir>', 'output directory', defaultOutRoot())
  .option('-c, --concurrency <n>', 'parallel requests', '4')
  .option('--videos', 'also download every lesson video (needs yt-dlp)')
  .description('Pull a community classroom to disk as transcripts (and optionally videos)')
  .action(async (slug: string, options: { out: string; concurrency: string; videos?: boolean }) => {
    const concurrency = parseConcurrency(options.concurrency);
    if (concurrency === null) {
      console.error(
        `\nInvalid --concurrency value: "${options.concurrency}". ` +
        `Must be a positive integer (capped at ${MAX_CONCURRENCY}).`,
      );
      process.exitCode = 1;
      return;
    }

    await ensureRoot();
    const outDir = join(resolve(options.out), slug);
    const db = openDb(dbPath());
    const browser = new BrowserFetcher(profileDir());
    const fetcher = new ResilientFetcher(new HttpFetcher(), async () => browser, isLoggedIn);

    const startedAt = Date.now();
    console.log(`${paint('bold', '◆ skrape')} ${paint('dim', `syncing skool.com/${slug}${options.videos ? ' · with videos' : ''}`)}\n`);
    try {
      const summary = await syncClassroom({
        slug,
        outDir,
        db,
        fetcher,
        concurrency,
        videos: options.videos,
        onProgress: (event) => {
          const style = OUTCOME_STYLE[event.outcome];
          const counter = `${event.done}/${event.total}`.padStart(String(event.total).length * 2 + 1);
          console.log(`${paint(style.color, style.icon)} ${paint('dim', counter)}  ${paint('dim', `${event.course.slice(0, 28)} ›`)} ${event.title.slice(0, 60)}`);
        },
      });

      console.log('');
      for (const line of formatSummary(summary, displayPath(outDir), paint)) console.log(line);
      console.log(paint('dim', `Finished in ${formatDuration(Date.now() - startedAt)}`));
      if (fetcher.escalatedRoutes.size > 0) {
        console.log(paint('dim', `Escalated to browser: ${[...fetcher.escalatedRoutes].join(', ')}`));
      }
    } catch (error) {
      console.error(`\n${paint('red', '✗ Sync failed:')} ${(error as Error).message}`);
      if ((error as Error).message.includes('HTTP 404')) {
        console.error(`No classroom at skool.com/${slug}. Check the slug (the part after skool.com/).`);
      } else if (fetcher.escalatedRoutes.size > 0) {
        console.error(
          `\n  escalated to browser: ${[...fetcher.escalatedRoutes].join(', ')}`,
        );
        console.error(
          'If this mentions an unexpected payload, the authenticated browser path was already tried ' +
          "for the route(s) above, so Skool's page structure most likely changed rather than the " +
          'session being expired. A fresh `skrape login` is still worth trying, but treat it as a ' +
          'secondary guess.',
        );
      } else {
        console.error(
          'If this mentions an unexpected payload, your session may have expired. Run: skrape login. ' +
          "It is also possible Skool's page structure changed; if a retry after login fails the same " +
          'way, that is more likely.',
        );
      }
      process.exitCode = 1;
    } finally {
      try {
        await browser.close();
      } catch (closeError) {
        // Cosmetic only — do not overwrite a real sync error or change the exit code.
        console.error(`\nWarning: failed to close browser cleanly: ${(closeError as Error).message}`);
      } finally {
        db.close();
      }
    }
  });

/**
 * With no subcommand, launch the guided Ink flow instead of requiring the user
 * to already know a subcommand and a community slug. `skrape login` and
 * `skrape sync <slug>` keep working unchanged as scriptable escape hatches.
 * The TUI module is dynamically imported so plain subcommand invocations
 * never pay for loading ink/react.
 */
async function main(): Promise<void> {
  if (process.argv.length <= 2) {
    const { runGuidedFlow } = await import('./tui/run.js');
    await runGuidedFlow();
    return;
  }
  program.parse();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
