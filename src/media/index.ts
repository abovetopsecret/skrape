import { loomTranscript } from './loom.js';
import type { Fetcher, TranscriptResult } from '../types.js';

type Provider = (videoUrl: string, fetcher: Fetcher) => Promise<TranscriptResult>;

/** Host substring -> provider. Add YouTube/Whisper here without touching callers. */
const PROVIDERS: Array<[string, Provider]> = [['loom.com', loomTranscript]];

export async function getTranscript(videoUrl: string, fetcher: Fetcher): Promise<TranscriptResult> {
  const entry = PROVIDERS.find(([host]) => videoUrl.includes(host));
  if (!entry) {
    return { status: 'unavailable', reason: `unsupported video host: ${videoUrl}`, provider: 'none' };
  }
  return entry[1](videoUrl, fetcher);
}

export { loomTranscript };
