import { homedir } from 'node:os';
import type { Outcome } from '../sync.js';

/** Brand accent: peach. Ink takes hex; the plain CLI falls back to a named color. */
export const ACCENT = '#FFB38A';

export type OutcomeColor = 'green' | 'gray' | 'yellow' | 'red';

export const OUTCOME_STYLE: Record<Outcome, { icon: string; label: string; color: OutcomeColor }> = {
  ok: { icon: '✓', label: 'transcribed', color: 'green' },
  skipped: { icon: '↷', label: 'already done', color: 'gray' },
  'no-video': { icon: '·', label: 'no video', color: 'gray' },
  'no-access': { icon: '⊘', label: 'locked', color: 'yellow' },
  unavailable: { icon: '!', label: 'unavailable', color: 'yellow' },
  failed: { icon: '✗', label: 'failed', color: 'red' },
};

/** A path as a person reads it: absolute, with the home folder shortened to ~. */
export function displayPath(path: string): string {
  const home = homedir();
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Remaining time from a linear rate; null until there's at least one data point. */
export function estimateRemainingMs(elapsedMs: number, done: number, total: number): number | null {
  if (done <= 0 || done >= total) return null;
  return (elapsedMs / done) * (total - done);
}
