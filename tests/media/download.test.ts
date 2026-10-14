import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { chmod, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncClassroom } from '../../src/sync.js';
import { openDb, type Db } from '../../src/store/db.js';
import type { Fetcher } from '../../src/types.js';

// Stand-in for yt-dlp: writes the output template as .mp4, fails for any "bad" url.
const FAKE = `#!/bin/sh
[ "$1" = "--version" ] && exit 0
for a; do [ "$prev" = "-o" ] && out="$a"; prev="$a"; url="$a"; done
case "$url" in *bad*) echo "ERROR: [loom] bad: video gone" >&2; exit 1;; esac
echo x > "$(echo "$out" | sed 's/%(ext)s/mp4/')"
`;

const page = (data: unknown) => `<script id="__NEXT_DATA__">${JSON.stringify(data)}</script>`;
const lesson = (id: string, title: string, videoLink?: string) =>
  ({ course: { id, metadata: { title, hasAccess: 1, videoLink } }, children: [] });

// Transcripts are irrelevant here: every Loom page lacks captions, so each video lesson is 'unavailable'.
const fetcher: Fetcher = {
  async getPage(url) {
    if (url.endsWith('/classroom')) return page({ props: { pageProps: { allCourses: [{ id: 'c1', metadata: { title: 'Course', hasAccess: 1 } }] } } });
    if (url.includes('/classroom/c1')) return page({ props: { pageProps: { course: { children: [
      lesson('l1', 'Good', 'https://www.loom.com/share/good'),
      lesson('l2', 'Bad', 'https://www.loom.com/share/bad'),
      lesson('l3', 'Text only'),
    ] } } } });
    return '{"transcription_status":"processing"}';
  },
};

describe('syncClassroom with videos', () => {
  let db: Db;
  let outDir: string;
  beforeAll(async () => {
    const bin = join(await mkdtemp(join(tmpdir(), 'fake-ytdlp-')), 'yt-dlp');
    await writeFile(bin, FAKE);
    await chmod(bin, 0o755);
    process.env.SKRAPE_YT_DLP = bin;
  });
  afterAll(() => { delete process.env.SKRAPE_YT_DLP; });
  beforeEach(async () => {
    db = openDb(':memory:');
    outDir = await mkdtemp(join(tmpdir(), 'skool-videos-'));
  });
  afterEach(() => db.close());

  it('downloads each video once and reports failures with a reason', async () => {
    const first = await syncClassroom({ slug: 'demo', outDir, db, fetcher, videos: true });
    expect(first.videos).toEqual({ downloaded: 1, existing: 0, failed: 1 });
    expect(await readdir(join(outDir, 'videos', 'course'))).toEqual(['00-good.mp4']);
    expect(first.problems.find((p) => p.title === 'Bad')?.reason).toContain('video download: ERROR');

    const second = await syncClassroom({ slug: 'demo', outDir, db, fetcher, videos: true });
    expect(second.videos).toEqual({ downloaded: 0, existing: 1, failed: 1 });
  });

  it('does nothing video-related unless asked', async () => {
    const summary = await syncClassroom({ slug: 'demo', outDir, db, fetcher });
    expect(summary.videos).toBeUndefined();
  });

  it('fails fast with install help when yt-dlp is missing', async () => {
    const saved = process.env.SKRAPE_YT_DLP;
    process.env.SKRAPE_YT_DLP = join(outDir, 'nope');
    try {
      await expect(syncClassroom({ slug: 'demo', outDir, db, fetcher, videos: true })).rejects.toThrow(/brew install yt-dlp/);
    } finally {
      process.env.SKRAPE_YT_DLP = saved;
    }
  });
});
