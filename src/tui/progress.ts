import type { Outcome, ProgressEvent } from '../sync.js';

export interface ProgressState {
  total: number;
  done: number;
  counts: Record<Outcome, number>;
  current: { course: string; title: string } | null;
}

export function createProgressState(total: number): ProgressState {
  return {
    total,
    done: 0,
    counts: { ok: 0, skipped: 0, 'no-video': 0, 'no-access': 0, unavailable: 0, failed: 0 },
    current: null,
  };
}

/**
 * Pure reducer folding one onProgress event into state. Events arrive out of
 * order from concurrent workers, so `done`/`total` are taken straight from the
 * event (sync.ts already owns and increments that counter atomically) rather
 * than re-derived here, and `current` is simply whichever event was folded in
 * most recently — a stable "last seen" snapshot, not a claim about true
 * completion order.
 */
export function applyProgress(state: ProgressState, event: ProgressEvent): ProgressState {
  return {
    total: event.total,
    done: event.done,
    counts: { ...state.counts, [event.outcome]: state.counts[event.outcome] + 1 },
    current: { course: event.course, title: event.title },
  };
}

export function formatProgressBar(done: number, total: number, width = 24): string {
  const safeTotal = total > 0 ? total : 1;
  const ratio = Math.min(1, Math.max(0, done / safeTotal));
  const filled = Math.round(ratio * width);
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}  ${done}/${total}  ${Math.round(ratio * 100)}%`;
}
