export interface VttCue {
  start: string | null;
  text: string;
}

export interface ParsedTranscript {
  text: string;
  wordCount: number;
  cueCount: number;
}

const PARAGRAPH_MIN_CHARS = 450;

/** Split a VTT body into cues, dropping structural lines and consecutive duplicates. */
export function parseCues(vtt: string): VttCue[] {
  const cues: VttCue[] = [];
  let currentStart: string | null = null;
  let inNoteBlock = false;
  let currentCueLines: string[] = [];

  const flushCue = () => {
    if (currentCueLines.length === 0) return;
    const text = currentCueLines.join(' ');
    // Rolling captions repeat the previous cue verbatim. Only consecutive
    // repeats are dropped — a speaker genuinely repeating a line later is kept.
    if (cues.length > 0 && cues[cues.length - 1]!.text === text) {
      currentCueLines = [];
      currentStart = null;
      return;
    }
    cues.push({ start: currentStart, text });
    currentCueLines = [];
    currentStart = null;
  };

  for (const raw of vtt.split(/\r?\n/)) {
    const line = raw.trim();

    // Blank lines end NOTE blocks and cue blocks
    if (!line) {
      inNoteBlock = false;
      flushCue();
      continue;
    }

    // Skip WEBVTT header
    if (line === 'WEBVTT') continue;

    // Skip cue numbers (pure digits)
    if (/^\d+$/.test(line)) continue;

    // Enter NOTE block (lines starting with NOTE are skipped until blank line)
    if (line.startsWith('NOTE')) {
      inNoteBlock = true;
      continue;
    }

    // Skip lines inside NOTE blocks
    if (inNoteBlock) continue;

    // Handle timestamp lines
    if (line.includes('-->')) {
      flushCue();
      currentStart = line.split('-->')[0]!.trim();
      continue;
    }

    // Strip speaker tags and collect cue text (accumulate multi-line cues)
    const text = line.replace(/<[^>]+>/g, '').trim();
    if (!text) continue;

    currentCueLines.push(text);
  }

  // Flush any remaining cue lines
  flushCue();

  return cues;
}

/** "01:02:03.456" -> "[62:03]". Hours fold into minutes so anchors never wrap. */
function anchor(ts: string | null): string {
  if (!ts) return '';
  const parts = ts.split(':');

  if (parts.length === 2) {
    // MM:SS.mmm format (no hours)
    const minutes = Number(parts[0]);
    const seconds = parts[1]!.split('.')[0]!;
    if (!Number.isFinite(minutes)) return '';
    return `[${minutes}:${seconds}] `;
  }

  if (parts.length === 3) {
    // HH:MM:SS.mmm format
    const hours = Number(parts[0]);
    const minutes = Number(parts[1]);
    const seconds = parts[2]!.split('.')[0]!;
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return '';
    return `[${hours * 60 + minutes}:${seconds}] `;
  }

  return '';
}

export function parseVtt(vtt: string): ParsedTranscript {
  const cues = parseCues(vtt);

  const paragraphs: string[] = [];
  let buffer: string[] = [];
  let bufferStart: string | null = null;
  let wordCount = 0;

  const flush = () => {
    if (buffer.length === 0) return;
    paragraphs.push(anchor(bufferStart) + buffer.join(' '));
    buffer = [];
    bufferStart = null;
  };

  for (const cue of cues) {
    if (buffer.length === 0) bufferStart = cue.start;
    buffer.push(cue.text);
    wordCount += cue.text.split(/\s+/).filter(Boolean).length;

    const joined = buffer.join(' ');
    if (joined.length > PARAGRAPH_MIN_CHARS && /[.!?]$/.test(cue.text)) flush();
  }
  flush();

  return { text: paragraphs.join('\n\n'), wordCount, cueCount: cues.length };
}
