import { describe, it, expect } from 'vitest';
import { applyProgress, createProgressState, formatProgressBar } from '../../src/tui/progress.js';
import type { ProgressEvent } from '../../src/sync.js';

describe('createProgressState', () => {
  it('starts empty at the given total', () => {
    const state = createProgressState(10);
    expect(state.total).toBe(10);
    expect(state.done).toBe(0);
    expect(state.current).toBeNull();
    expect(state.counts).toEqual({ ok: 0, skipped: 0, 'no-video': 0, 'no-access': 0, unavailable: 0, failed: 0 });
  });
});

describe('applyProgress', () => {
  it('increments the count for the event outcome', () => {
    const state = createProgressState(3);
    const event: ProgressEvent = { outcome: 'ok', course: 'C1', title: 'L1', done: 1, total: 3 };
    const next = applyProgress(state, event);
    expect(next.counts.ok).toBe(1);
    expect(next.done).toBe(1);
    expect(next.current).toEqual({ course: 'C1', title: 'L1' });
  });

  it('does not mutate the previous state', () => {
    const state = createProgressState(1);
    const next = applyProgress(state, { outcome: 'ok', course: 'C', title: 'T', done: 1, total: 1 });
    expect(state.done).toBe(0);
    expect(state.counts.ok).toBe(0);
    expect(next).not.toBe(state);
  });

  it('shows a stable "last folded" summary rather than assuming ordered arrival', () => {
    // Simulates 4 concurrent workers: a lesson that started first can finish
    // after one that started later. `current` must reflect whichever event
    // was folded in most recently, not try to reconstruct start order.
    let state = createProgressState(2);
    state = applyProgress(state, { outcome: 'ok', course: 'A', title: 'started-first-finished-second', done: 2, total: 2 });
    state = applyProgress(state, { outcome: 'failed', course: 'B', title: 'started-second-finished-first', done: 1, total: 2 });
    expect(state.current).toEqual({ course: 'B', title: 'started-second-finished-first' });
    expect(state.counts.ok).toBe(1);
    expect(state.counts.failed).toBe(1);
  });

  it('accumulates counts across many events without cross-outcome leakage', () => {
    let state = createProgressState(4);
    const events: ProgressEvent[] = [
      { outcome: 'ok', course: 'A', title: '1', done: 1, total: 4 },
      { outcome: 'skipped', course: 'A', title: '2', done: 2, total: 4 },
      { outcome: 'ok', course: 'B', title: '3', done: 3, total: 4 },
      { outcome: 'failed', course: 'B', title: '4', done: 4, total: 4 },
    ];
    for (const event of events) state = applyProgress(state, event);
    expect(state.counts).toEqual({ ok: 2, skipped: 1, 'no-video': 0, 'no-access': 0, unavailable: 0, failed: 1 });
    expect(state.done).toBe(4);
  });
});

describe('formatProgressBar', () => {
  it('renders an empty bar at zero progress', () => {
    expect(formatProgressBar(0, 10, 10)).toBe('░░░░░░░░░░  0/10  0%');
  });

  it('renders a full bar when done equals total', () => {
    expect(formatProgressBar(10, 10, 10)).toBe('██████████  10/10  100%');
  });

  it('renders a partial bar', () => {
    expect(formatProgressBar(5, 10, 10)).toBe('█████░░░░░  5/10  50%');
  });

  it('does not divide by zero when total is 0', () => {
    expect(() => formatProgressBar(0, 0, 10)).not.toThrow();
    expect(formatProgressBar(0, 0, 10)).toBe('░░░░░░░░░░  0/0  0%');
  });
});
