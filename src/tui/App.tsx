import React from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { SelectList } from './SelectList.js';
import { applyProgress, createProgressState, formatProgressBar, type ProgressState } from './progress.js';
import { formatVideoLine, nothingTranscribed, sortedProblems } from './summary.js';
import { ACCENT, OUTCOME_STYLE, displayPath, estimateRemainingMs, formatDuration } from './theme.js';
import { isValidSlug, normalizeSlug } from './slug.js';
import { MENU_ITEMS, nextStepForMenuChoice, type DoneState, type MenuChoice } from './flow.js';
import { revealOutputFolder } from './reveal.js';
import type { CommunityRef } from '../discover/communities.js';
import type { Outcome, ProgressEvent, SyncSummary } from '../sync.js';

export interface AppControllers {
  /** Absolute output root, e.g. ~/skrape; the community slug is appended. */
  outRoot: string;
  checkLoggedIn: () => Promise<boolean>;
  login: () => Promise<void>;
  discoverCommunities: () => Promise<CommunityRef[] | null>;
  countAccessibleCourses: (slug: string) => Promise<number>;
  /** Checked when the user picks videos, so installing it in another terminal works without a restart. */
  hasYtDlp: () => Promise<boolean>;
  runSync: (
    slug: string,
    outDir: string,
    onProgress: (event: ProgressEvent) => void,
    videos: boolean,
  ) => Promise<SyncSummary>;
}

type Step =
  | { kind: 'checking-session' }
  | { kind: 'login-needed' }
  | { kind: 'logging-in' }
  | { kind: 'discovering' }
  | { kind: 'picking'; communities: CommunityRef[] }
  | { kind: 'manual-slug'; value: string; error: string | null }
  | { kind: 'counting'; slug: string; name: string }
  | { kind: 'confirming'; slug: string; name: string; courseCount: number; outDir: string; notice?: string }
  | { kind: 'syncing'; slug: string; name: string; courseCount: number; outDir: string; videos: boolean; startedAt: number; progress: ProgressState }
  | { kind: 'done'; slug: string; name: string; courseCount: number; outDir: string; elapsedMs: number; summary: SyncSummary }
  | { kind: 'error'; message: string };

const MAX_ERROR_LINES = 6;
const MAX_ERROR_CHARS = 800;

/**
 * Caps error text shown in the TUI. Some failures (e.g. a raw Playwright
 * browser-launch error) can be a multi-hundred-line dump — that's useless in
 * a terminal UI and pushes everything else off screen, so keep only the
 * first few lines and a hard character cap.
 */
export function truncateErrorText(message: string): string {
  const lines = message.split('\n');
  const truncatedByLines = lines.length > MAX_ERROR_LINES;
  const limitedLines = lines.slice(0, MAX_ERROR_LINES).join('\n');
  const truncatedByChars = limitedLines.length > MAX_ERROR_CHARS;
  const limited = limitedLines.slice(0, MAX_ERROR_CHARS);
  return truncatedByLines || truncatedByChars ? `${limited}\n… (truncated)` : limited;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return truncateErrorText(message);
}

function ConfirmPrompt({ onConfirm }: { onConfirm: () => void }): React.JSX.Element {
  const { exit } = useApp();
  useInput((input, key) => {
    if (key.return) onConfirm();
    else if (input === 'q' || key.escape) exit();
  });
  return <Text dimColor>enter continue · q quit</Text>;
}

function Header(): React.JSX.Element {
  return (
    <Box marginBottom={1}>
      <Text color={ACCENT} bold>
        ◆ skrape
      </Text>
      <Text dimColor>  read the course, skip the video</Text>
    </Box>
  );
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function Spinner({ label }: { label: string }): React.JSX.Element {
  const [frame, setFrame] = React.useState(0);
  React.useEffect(() => {
    const timer = setInterval(() => setFrame((current) => (current + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(timer);
  }, []);
  return (
    <Text>
      <Text color={ACCENT}>{SPINNER_FRAMES[frame]}</Text> {label}
    </Text>
  );
}

/** Label/value rows inside a rounded card, labels aligned. */
function Card({ rows }: { rows: Array<[string, React.ReactNode]> }): React.JSX.Element {
  const width = Math.max(...rows.map(([label]) => label.length));
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} alignSelf="flex-start">
      {rows.map(([label, value]) => (
        <Box key={label}>
          <Text dimColor>{label.padEnd(width + 3)}</Text>
          <Text>{value}</Text>
        </Box>
      ))}
    </Box>
  );
}

function OutcomeChips({ counts, always = [] }: { counts: Record<Outcome, number>; always?: Outcome[] }): React.JSX.Element {
  const shown = (Object.keys(OUTCOME_STYLE) as Outcome[]).filter((o) => counts[o] > 0 || always.includes(o));
  return (
    <Text>
      {shown.map((outcome, index) => (
        <Text key={outcome}>
          {index > 0 && '   '}
          <Text color={OUTCOME_STYLE[outcome].color}>{OUTCOME_STYLE[outcome].icon}</Text> {counts[outcome]}{' '}
          <Text dimColor>{OUTCOME_STYLE[outcome].label}</Text>
        </Text>
      ))}
    </Text>
  );
}

/** Ticks once a second on its own so the rest of the screen only re-renders on progress. */
function Timing({ startedAt, done, total }: { startedAt: number; done: number; total: number }): React.JSX.Element {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const elapsed = now - startedAt;
  const remaining = estimateRemainingMs(elapsed, done, total);
  return (
    <Text dimColor>
      {formatDuration(elapsed)} elapsed{remaining !== null && ` · ~${formatDuration(remaining)} left`}
    </Text>
  );
}

type SyncMode = 'transcripts' | 'videos' | 'quit';

const YT_DLP_MISSING =
  'Video downloads need yt-dlp, which isn\'t installed. In another terminal run: brew install yt-dlp ffmpeg (or see github.com/yt-dlp/yt-dlp), then pick again.';

const MODE_ITEMS: Array<{ label: string; value: SyncMode; hint?: string }> = [
  { label: 'Transcripts', value: 'transcripts', hint: 'fast · text only' },
  { label: 'Transcripts + videos', value: 'videos', hint: 'needs yt-dlp · large download' },
  { label: 'Quit', value: 'quit' },
];

function ExitPrompt({ label }: { label: string }): React.JSX.Element {
  const { exit } = useApp();
  useInput(() => exit());
  return <Text dimColor>{label}</Text>;
}

function ManualSlugInput({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
}): null {
  useInput((input, key) => {
    if (key.return) {
      onSubmit(value);
      return;
    }
    if (key.backspace || key.delete) {
      onChange(value.slice(0, -1));
      return;
    }
    if (key.ctrl || key.meta || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) return;
    if (input) onChange(value + input);
  });
  return null;
}

export function App({ controllers }: { controllers: AppControllers }): React.JSX.Element {
  const { exit } = useApp();
  const [step, setStep] = React.useState<Step>({ kind: 'checking-session' });

  useInput((input, key) => {
    if (key.ctrl && input === 'c') exit();
  });

  const fail = React.useCallback((error: unknown) => {
    setStep({ kind: 'error', message: errorMessage(error) });
  }, []);

  // Step 1: is the saved Chrome profile signed in?
  React.useEffect(() => {
    if (step.kind !== 'checking-session') return;
    let cancelled = false;
    controllers
      .checkLoggedIn()
      .then((loggedIn) => {
        if (cancelled) return;
        setStep(loggedIn ? { kind: 'discovering' } : { kind: 'login-needed' });
      })
      .catch((error: unknown) => {
        if (!cancelled) fail(error);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.kind]);

  // Step 1b: the user asked us to open the browser so they can sign in.
  React.useEffect(() => {
    if (step.kind !== 'logging-in') return;
    let cancelled = false;
    controllers
      .login()
      .then(() => {
        if (!cancelled) setStep({ kind: 'discovering' });
      })
      .catch((error: unknown) => {
        if (!cancelled) fail(error);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.kind]);

  // Step 2: fetch the communities the signed-in user belongs to.
  React.useEffect(() => {
    if (step.kind !== 'discovering') return;
    let cancelled = false;
    controllers
      .discoverCommunities()
      .then((communities) => {
        if (cancelled) return;
        if (communities && communities.length > 0) {
          setStep({ kind: 'picking', communities });
        } else {
          setStep({ kind: 'manual-slug', value: '', error: null });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) fail(error);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.kind]);

  const chooseCommunity = React.useCallback((slug: string, name: string) => {
    setStep({ kind: 'counting', slug, name });
  }, []);

  // Step 2b/3: count accessible courses for the confirmation screen.
  React.useEffect(() => {
    if (step.kind !== 'counting') return;
    let cancelled = false;
    const { slug, name } = step;
    controllers
      .countAccessibleCourses(slug)
      .then((courseCount) => {
        if (cancelled) return;
        setStep({ kind: 'confirming', slug, name, courseCount, outDir: `${controllers.outRoot}/${slug}` });
      })
      .catch((error: unknown) => {
        if (!cancelled) fail(error);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Step 4: run the sync, folding progress events into render state.
  React.useEffect(() => {
    if (step.kind !== 'syncing') return;
    let cancelled = false;
    const { slug, name, courseCount, outDir, videos, startedAt } = step;
    controllers
      .runSync(slug, outDir, (event) => {
        if (cancelled) return;
        setStep((previous) =>
          previous.kind === 'syncing' ? { ...previous, progress: applyProgress(previous.progress, event) } : previous,
        );
      }, videos)
      .then((summary) => {
        if (!cancelled) setStep({ kind: 'done', slug, name, courseCount, outDir, elapsedMs: Date.now() - startedAt, summary });
      })
      .catch((error: unknown) => {
        if (!cancelled) fail(error);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.kind]);

  // Step 5: after a sync finishes, act on the post-summary menu choice —
  // loops back into an earlier step (never nests/recurses; `step` is simply
  // replaced again like every other transition) or performs an in-place
  // side effect that leaves the menu on screen.
  const handleMenuChoice = React.useCallback(
    (done: DoneState, choice: MenuChoice) => {
      if (choice === 'quit') {
        exit();
        return;
      }
      if (choice === 'open-folder') {
        // revealOutputFolder never throws (it falls back to printing the
        // path on failure) — this catch is a last-resort guard so a future
        // change there can never crash the TUI.
        void revealOutputFolder(done.outDir).catch(() => {});
        return;
      }
      const transition = nextStepForMenuChoice(done, choice);
      if (!transition) return;
      if (transition.kind === 'discovering') {
        setStep({ kind: 'discovering' });
      } else {
        setStep({
          kind: 'confirming',
          slug: transition.slug,
          name: transition.name,
          courseCount: transition.courseCount,
          outDir: transition.outDir,
        });
      }
    },
    [exit],
  );

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Header />
      {renderStep()}
    </Box>
  );

  function renderStep(): React.JSX.Element {
    switch (step.kind) {
      case 'checking-session':
        return <Spinner label="Checking your Skool session…" />;

      case 'login-needed':
        return (
          <Box flexDirection="column">
            <Text color="yellow">You're not signed in to Skool yet.</Text>
            <Text dimColor>A browser window will open and you sign in yourself. skrape never sees your password.</Text>
            <Text> </Text>
            <ConfirmPrompt onConfirm={() => setStep({ kind: 'logging-in' })} />
          </Box>
        );

      case 'logging-in':
        return (
          <Box flexDirection="column">
            <Spinner label="Waiting for you to sign in in the browser window…" />
            <Text dimColor>Ctrl+C to cancel</Text>
          </Box>
        );

      case 'discovering':
        return <Spinner label="Finding your communities…" />;

      case 'picking': {
        const items = [
          ...step.communities.map((community) => ({
            label: community.name,
            hint: `skool.com/${community.slug}`,
            value: community as CommunityRef | null,
          })),
          { label: 'Enter a slug manually…', value: null },
        ];
        return (
          <Box flexDirection="column">
            <Text bold>Which community?</Text>
            <Text> </Text>
            <SelectList
              items={items}
              onSelect={(value) => {
                if (value === null) setStep({ kind: 'manual-slug', value: '', error: null });
                else chooseCommunity(value.slug, value.name);
              }}
            />
          </Box>
        );
      }

      case 'manual-slug':
        return (
          <Box flexDirection="column">
            <Text bold>Community slug</Text>
            <Text dimColor>The part after skool.com/, e.g. skool.com/<Text color={ACCENT}>my-community</Text></Text>
            <Text> </Text>
            <Text>
              <Text color={ACCENT}>❯ </Text>
              {step.value}
              <Text color={ACCENT}>▌</Text>
            </Text>
            {step.error && <Text color="red">{step.error}</Text>}
            <ManualSlugInput
              value={step.value}
              onChange={(value) => setStep({ kind: 'manual-slug', value, error: null })}
              onSubmit={(value) => {
                const slug = normalizeSlug(value);
                if (!isValidSlug(slug)) {
                  setStep({ kind: 'manual-slug', value, error: `"${value}" doesn't look like a valid slug.` });
                  return;
                }
                chooseCommunity(slug, slug);
              }}
            />
          </Box>
        );

      case 'counting':
        return <Spinner label={`Looking up courses in ${step.name}…`} />;

      case 'confirming': {
        const { slug, name, courseCount, outDir } = step;
        return (
          <Box flexDirection="column">
            <Card
              rows={[
                ['Community', <Text bold>{name}</Text>],
                ['URL', `skool.com/${slug}`],
                ['Courses', `${courseCount} you can access`],
                ['Saving to', displayPath(outDir)],
              ]}
            />
            <Text> </Text>
            <Text bold>What should skrape pull?</Text>
            <Text> </Text>
            <SelectList
              items={MODE_ITEMS}
              onSelect={(mode) => {
                if (mode === 'quit') {
                  exit();
                  return;
                }
                const start = () =>
                  setStep({
                    kind: 'syncing', slug, name, courseCount, outDir,
                    videos: mode === 'videos',
                    startedAt: Date.now(),
                    progress: createProgressState(0),
                  });
                if (mode !== 'videos') {
                  start();
                  return;
                }
                controllers
                  .hasYtDlp()
                  .catch(() => false)
                  .then((ok) => {
                    if (ok) start();
                    else setStep({ ...step, notice: YT_DLP_MISSING });
                  });
              }}
            />
            {step.notice && (
              <Box marginTop={1}>
                <Text color="yellow">{step.notice}</Text>
              </Box>
            )}
          </Box>
        );
      }

      case 'syncing': {
        const { progress } = step;
        return (
          <Box flexDirection="column">
            <Text>
              Syncing <Text bold>{step.name}</Text>
              <Text dimColor>{step.videos ? '  · transcripts + videos' : '  · transcripts'}</Text>
            </Text>
            <Text> </Text>
            <Text color={ACCENT}>{formatProgressBar(progress.done, progress.total, 32)}</Text>
            {progress.current ? (
              <Spinner label={`${progress.current.course} › ${progress.current.title}`} />
            ) : (
              <Spinner label="Reading the course tree…" />
            )}
            <Text> </Text>
            <OutcomeChips counts={progress.counts} always={['ok']} />
            <Timing startedAt={step.startedAt} done={progress.done} total={progress.total} />
          </Box>
        );
      }

      case 'done': {
        const { summary } = step;
        const empty = nothingTranscribed(summary);
        const videoLine = formatVideoLine(summary);
        const done: DoneState = {
          slug: step.slug,
          name: step.name,
          courseCount: step.courseCount,
          outDir: step.outDir,
          summary,
        };
        const rows: Array<[string, React.ReactNode]> = [
          ['Words', summary.totalWords.toLocaleString('en-US')],
          ['Lessons', <OutcomeChips counts={summary.counts} />],
        ];
        if (videoLine) rows.push(['Videos', videoLine]);
        rows.push(['Saved to', <Text color={ACCENT}>{displayPath(step.outDir)}</Text>]);
        return (
          <Box flexDirection="column">
            {empty && summary.counts.skipped === 0 ? (
              <Text color="yellow" bold>⚠ Nothing was transcribed.</Text>
            ) : (
              <Text color="green" bold>
                ✓ {empty ? `${step.name} is up to date` : `Synced ${step.name}`}
                <Text dimColor bold={false}>  in {formatDuration(step.elapsedMs)}</Text>
              </Text>
            )}
            <Text> </Text>
            <Card rows={rows} />
            {summary.problems.length > 0 && (
              <Box flexDirection="column" marginTop={1}>
                <Text bold>Needs attention ({summary.problems.length})</Text>
                {sortedProblems(summary).map((problem, index) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <Text key={index} wrap="truncate-end">
                    <Text color={OUTCOME_STYLE[problem.outcome].color}>{OUTCOME_STYLE[problem.outcome].icon}</Text>{' '}
                    {problem.course} › {problem.title}  <Text dimColor>{problem.reason}</Text>
                  </Text>
                ))}
              </Box>
            )}
            <Text> </Text>
            <Text bold>What next?</Text>
            <Text> </Text>
            <SelectList items={MENU_ITEMS} onSelect={(choice) => handleMenuChoice(done, choice)} />
          </Box>
        );
      }

      case 'error':
        return (
          <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1} alignSelf="flex-start">
            <Text color="red" bold>✗ Something went wrong</Text>
            <Text>{step.message}</Text>
            <Text> </Text>
            <ExitPrompt label="Press any key to exit." />
          </Box>
        );
    }
  }
}
