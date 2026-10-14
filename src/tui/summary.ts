import type { Outcome, SyncSummary } from '../sync.js';
import { OUTCOME_STYLE, type OutcomeColor } from './theme.js';

/** Colors a piece of text; identity by default so output stays plain for tests and pipes. */
export type Paint = (color: OutcomeColor | 'bold' | 'dim', text: string) => string;
const plain: Paint = (_color, text) => text;

export function formatVideoLine(summary: SyncSummary): string | null {
  const v = summary.videos;
  if (!v) return null;
  return `${v.downloaded} downloaded · ${v.existing} already on disk · ${v.failed} failed`;
}

const SEVERITY: Outcome[] = ['failed', 'unavailable', 'no-access', 'no-video', 'skipped', 'ok'];

/** Problems worst-first, so real failures aren't buried under routine "no video" lessons. */
export function sortedProblems(summary: SyncSummary): SyncSummary['problems'] {
  return [...summary.problems].sort((a, b) => SEVERITY.indexOf(a.outcome) - SEVERITY.indexOf(b.outcome));
}

/** True when nothing was transcribed at all — the case that must never be
 *  rendered as a cheerful, empty-looking summary. */
export function nothingTranscribed(summary: SyncSummary): boolean {
  return summary.counts.ok === 0 && summary.totalWords === 0;
}

function headline(summary: SyncSummary, paint: Paint): string {
  if (!nothingTranscribed(summary)) {
    return paint('green', `✓ Transcribed ${summary.totalWords.toLocaleString('en-US')} words`);
  }
  // A re-sync where every lesson was already on disk is a success, not an empty run.
  if (summary.counts.skipped > 0) return paint('green', '✓ Up to date, nothing new to transcribe.');
  return paint('yellow', '⚠ Nothing was transcribed.');
}

export function formatSummary(summary: SyncSummary, outDir: string, paint: Paint = plain): string[] {
  const lines: string[] = [];

  lines.push(headline(summary, paint), '');

  for (const [outcome, count] of Object.entries(summary.counts) as Array<[Outcome, number]>) {
    if (count === 0) continue;
    const style = OUTCOME_STYLE[outcome];
    lines.push(`  ${paint(style.color, style.icon)} ${style.label.padEnd(14)} ${count}`);
  }
  const videoLine = formatVideoLine(summary);
  if (videoLine) lines.push(`  ${paint('dim', '▸')} ${'videos'.padEnd(14)} ${videoLine}`);

  if (summary.problems.length > 0) {
    lines.push('', paint('bold', `Needs attention (${summary.problems.length})`));
    for (const problem of sortedProblems(summary)) {
      const style = OUTCOME_STYLE[problem.outcome];
      lines.push(`  ${paint(style.color, style.icon)} ${problem.course} › ${problem.title}  ${paint('dim', problem.reason)}`);
    }
  }

  lines.push('', `${paint('dim', 'Saved to')} ${outDir}`);
  return lines;
}
