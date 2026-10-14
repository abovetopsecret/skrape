import type { SyncSummary } from '../sync.js';

/**
 * Pure screen-sequencing logic for what happens after a sync finishes and the
 * user picks an option from the post-summary menu. Kept free of Ink/React so
 * the transitions themselves — independent of how they get rendered or which
 * keys drive them — are unit-testable.
 *
 * This models a genuine loop: the caller (App.tsx) folds the returned Step
 * back into its single `step` state slot exactly like every other
 * transition already in the guided flow, so a long interactive session
 * (sync A -> menu -> sync A again -> menu -> sync B -> menu -> quit -> ...)
 * never nests components or accumulates state — each transition just
 * replaces `step`.
 */

/** The subset of an App `Step` this module needs to know about, expressed
 *  structurally so this file doesn't have to import App's full Step union
 *  (which would create a cycle back into the Ink-aware module). */
export interface DoneState {
  slug: string;
  name: string;
  courseCount: number;
  outDir: string;
  summary: SyncSummary;
}

export type MenuChoice = 'sync-another' | 'sync-again' | 'open-folder' | 'quit';

export interface MenuItem {
  label: string;
  value: MenuChoice;
}

export const MENU_ITEMS: MenuItem[] = [
  { label: 'Sync another community', value: 'sync-another' },
  { label: 'Sync this community again', value: 'sync-again' },
  { label: 'Open output folder', value: 'open-folder' },
  { label: 'Quit', value: 'quit' },
];

/** The next screen-sequencing step to fold into state after a menu choice.
 *  `'discovering'` re-enters the same community-discovery step that ran
 *  after login, skipping the session check entirely since the user is
 *  already signed in. `'confirming'` re-uses the slug/name/courseCount/outDir
 *  from the sync that just finished, skipping both the picker and the course
 *  count so "sync again" goes straight to confirm -> progress -> summary. */
export type FlowTransition =
  | { kind: 'discovering' }
  | { kind: 'confirming'; slug: string; name: string; courseCount: number; outDir: string };

/**
 * Given the state of the sync that just completed and the menu choice the
 * user made, returns the next step transition — or `null` when the choice
 * doesn't move to a new screen at all: `'open-folder'` is a side effect
 * performed in place (the menu stays up), and `'quit'` exits instead of
 * transitioning to another step.
 */
export function nextStepForMenuChoice(done: DoneState, choice: MenuChoice): FlowTransition | null {
  switch (choice) {
    case 'sync-another':
      return { kind: 'discovering' };
    case 'sync-again':
      return {
        kind: 'confirming',
        slug: done.slug,
        name: done.name,
        courseCount: done.courseCount,
        outDir: done.outDir,
      };
    case 'open-folder':
    case 'quit':
      return null;
  }
}
