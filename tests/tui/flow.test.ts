import { describe, it, expect } from 'vitest';
import { nextStepForMenuChoice, MENU_ITEMS, type DoneState } from '../../src/tui/flow.js';

const done: DoneState = {
  slug: 'demo',
  name: 'Skool Builders',
  courseCount: 3,
  outDir: './out/demo',
  summary: { counts: { ok: 1, skipped: 0, 'no-video': 0, 'no-access': 0, unavailable: 0, failed: 0 }, problems: [], totalWords: 100 },
};

describe('MENU_ITEMS', () => {
  it('offers exactly the four documented choices, in order', () => {
    expect(MENU_ITEMS.map((item) => item.value)).toEqual(['sync-another', 'sync-again', 'open-folder', 'quit']);
  });
});

describe('nextStepForMenuChoice', () => {
  it('"sync another community" returns to the community-discovery step (skipping session check)', () => {
    const transition = nextStepForMenuChoice(done, 'sync-another');
    expect(transition).toEqual({ kind: 'discovering' });
  });

  it('"sync this community again" skips the picker and goes straight to confirm with the same slug', () => {
    const transition = nextStepForMenuChoice(done, 'sync-again');
    expect(transition).toEqual({
      kind: 'confirming',
      slug: 'demo',
      name: 'Skool Builders',
      courseCount: 3,
      outDir: './out/demo',
    });
  });

  it('"open output folder" is not a step transition — it is a side effect performed in place', () => {
    expect(nextStepForMenuChoice(done, 'open-folder')).toBeNull();
  });

  it('"quit" is not a step transition — it exits instead', () => {
    expect(nextStepForMenuChoice(done, 'quit')).toBeNull();
  });

  it('"sync again" reuses whatever slug/outDir the most recently completed sync had, not a hardcoded one', () => {
    const otherDone: DoneState = { ...done, slug: 'other-community', outDir: './out/other-community', name: 'Other' };
    const transition = nextStepForMenuChoice(otherDone, 'sync-again');
    expect(transition).toEqual({
      kind: 'confirming',
      slug: 'other-community',
      name: 'Other',
      courseCount: 3,
      outDir: './out/other-community',
    });
  });
});
