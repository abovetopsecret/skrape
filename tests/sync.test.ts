import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncClassroom } from '../src/sync.js';
import { openDb, type Db } from '../src/store/db.js';
import type { Fetcher } from '../src/types.js';

const CLASSROOM = `<script id="__NEXT_DATA__">${JSON.stringify({
  props: { pageProps: { allCourses: [
    { id: 'c1', metadata: { title: 'Course One', hasAccess: 1 } },
    { id: 'c2', metadata: { title: 'Locked', hasAccess: 0 } },
  ] } },
})}</script>`;

const COURSE = `<script id="__NEXT_DATA__">${JSON.stringify({
  props: { pageProps: { course: { children: [
    { course: { id: 'l1', metadata: { title: 'With Video', hasAccess: 1,
        videoLink: 'https://www.loom.com/share/aaa', videoLenMs: 60000 } }, children: [] },
    { course: { id: 'l2', metadata: { title: 'No Video', hasAccess: 1 } }, children: [] },
    { course: { id: 'l3', metadata: { title: 'Bad Video', hasAccess: 1,
        videoLink: 'https://www.loom.com/share/bbb', videoLenMs: 60000 } }, children: [] },
  ] } } },
})}</script>`;

const LOOM_OK = `{\"transcription_status\":\"success\",\"captions_url\":\"https://cdn.loom.com/mediametadata/captions/aaa-5.vtt?Policy=p\"}`;
const LOOM_NONE = `{\"transcription_status\":\"processing\"}`;
const VTT = 'WEBVTT\n\n' +
  Array.from({ length: 60 }, (_, i) => `00:00:${String(i).padStart(2, '0')}.000 --> 00:00:${String(i + 1).padStart(2, '0')}.000\nword${i} filler text here.\n`).join('\n');

const fetcher: Fetcher = {
  async getPage(url) {
    if (url.endsWith('/classroom')) return CLASSROOM;
    if (url.includes('/classroom/c1')) return COURSE;
    if (url.includes('loom.com/share/aaa')) return LOOM_OK;
    if (url.includes('loom.com/share/bbb')) return LOOM_NONE;
    if (url.includes('cdn.loom.com')) return VTT;
    throw new Error(`unexpected url ${url}`);
  },
};

describe('syncClassroom', () => {
  let db: Db;
  let outDir: string;
  beforeEach(async () => {
    db = openDb(':memory:');
    outDir = await mkdtemp(join(tmpdir(), 'skool-sync-'));
  });
  afterEach(() => db.close());

  it('transcribes lessons that have captions', async () => {
    const summary = await syncClassroom({ slug: 'demo', outDir, db, fetcher });
    expect(summary.counts.ok).toBe(1);
  });

  it('buckets a lesson with no video separately from a failure', async () => {
    const summary = await syncClassroom({ slug: 'demo', outDir, db, fetcher });
    expect(summary.counts['no-video']).toBe(1);
  });

  it('records an uncaptioned video as unavailable with a reason, never dropping it', async () => {
    const summary = await syncClassroom({ slug: 'demo', outDir, db, fetcher });
    expect(summary.counts.unavailable).toBe(1);
    const problem = summary.problems.find((p) => p.title === 'Bad Video');
    expect(problem?.reason).toContain('processing');
  });

  it('skips courses the user has no access to', async () => {
    const summary = await syncClassroom({ slug: 'demo', outDir, db, fetcher });
    expect(summary.counts['no-access']).toBe(1);
    expect(summary.problems.some((p) => p.course === 'Locked')).toBe(true);
  });

  it('accounts for every item — counts sum to the number of items seen', async () => {
    const summary = await syncClassroom({ slug: 'demo', outDir, db, fetcher });
    const total = Object.values(summary.counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(4); // 3 lessons + 1 locked course
  });

  it('is resumable — a second run skips already-transcribed lessons', async () => {
    await syncClassroom({ slug: 'demo', outDir, db, fetcher });
    const second = await syncClassroom({ slug: 'demo', outDir, db, fetcher });
    expect(second.counts.skipped).toBe(1);
    expect(second.counts.ok).toBe(0);
  });

  it('keeps going when one lesson throws, rather than aborting the run', async () => {
    const flaky: Fetcher = {
      async getPage(url) {
        if (url.includes('loom.com/share/aaa')) throw new Error('boom');
        return fetcher.getPage(url);
      },
    };
    const summary = await syncClassroom({ slug: 'demo', outDir, db, fetcher: flaky });
    expect(summary.counts.failed).toBe(1);
    expect(summary.counts.unavailable).toBe(1);
  });

  it('reports the total words written', async () => {
    const summary = await syncClassroom({ slug: 'demo', outDir, db, fetcher });
    expect(summary.totalWords).toBeGreaterThan(100);
  });

  it('concurrency 0 still processes every item (Finding 2)', async () => {
    const summary = await syncClassroom({ slug: 'demo', outDir, db, fetcher, concurrency: 0 });
    const total = Object.values(summary.counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(4);
    expect(summary.counts.ok).toBe(1);
  });

  it('concurrency NaN still processes every item (Finding 2)', async () => {
    const summary = await syncClassroom({ slug: 'demo', outDir, db, fetcher, concurrency: Number('abc') });
    const total = Object.values(summary.counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(4);
    expect(summary.counts.ok).toBe(1);
  });

  it('a negative concurrency still processes every item (Finding 2)', async () => {
    const summary = await syncClassroom({ slug: 'demo', outDir, db, fetcher, concurrency: -5 });
    const total = Object.values(summary.counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(4);
  });

  it('emits progress events for each item', async () => {
    const seen: string[] = [];
    await syncClassroom({ slug: 'demo', outDir, db, fetcher, onProgress: (e) => seen.push(e.title) });
    expect(seen).toContain('With Video');
  });

  it('a no-video lesson appears in problems, not just in counts', async () => {
    const summary = await syncClassroom({ slug: 'demo', outDir, db, fetcher });
    const problem = summary.problems.find((p) => p.title === 'No Video');
    expect(problem).toBeDefined();
    expect(problem?.outcome).toBe('no-video');
    expect(problem?.reason.length).toBeGreaterThan(0);
  });

  it('onProgress throwing on every call does not stop the sync and counts stay correct', async () => {
    const summary = await syncClassroom({
      slug: 'demo', outDir, db, fetcher,
      onProgress: () => { throw new Error('callback exploded'); },
    });
    expect(summary.counts.ok).toBe(1);
    expect(summary.counts['no-video']).toBe(1);
    expect(summary.counts.unavailable).toBe(1);
    expect(summary.counts['no-access']).toBe(1);
    const total = Object.values(summary.counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(4);
  });
});

describe('syncClassroom — course-level and per-lesson resilience', () => {
  let db: Db;
  let outDir: string;
  beforeEach(async () => {
    db = openDb(':memory:');
    outDir = await mkdtemp(join(tmpdir(), 'skool-sync-'));
  });
  afterEach(() => db.close());

  it("one course's listLessons rejecting does not abort the sync — the other course still processes, and the failed course appears in problems", async () => {
    const TWO_COURSES = `<script id="__NEXT_DATA__">${JSON.stringify({
      props: { pageProps: { allCourses: [
        { id: 'good', metadata: { title: 'Good Course', hasAccess: 1 } },
        { id: 'bad', metadata: { title: 'Bad Course', hasAccess: 1 } },
      ] } },
    })}</script>`;

    const flaky: Fetcher = {
      async getPage(url) {
        if (url.endsWith('/classroom')) return TWO_COURSES;
        if (url.includes('/classroom/good')) return COURSE;
        if (url.includes('/classroom/bad')) throw new Error('network blip listing bad course');
        if (url.includes('loom.com/share/aaa')) return LOOM_OK;
        if (url.includes('loom.com/share/bbb')) return LOOM_NONE;
        if (url.includes('cdn.loom.com')) return VTT;
        throw new Error(`unexpected url ${url}`);
      },
    };

    const summary = await syncClassroom({ slug: 'demo', outDir, db, fetcher: flaky });

    // The good course's 3 lessons were still processed.
    expect(summary.counts.ok).toBe(1);
    expect(summary.counts['no-video']).toBe(1);
    expect(summary.counts.unavailable).toBe(1);

    // The bad course is recorded as a failure with its reason, not silently dropped.
    expect(summary.counts.failed).toBe(1);
    const problem = summary.problems.find((p) => p.course === 'Bad Course');
    expect(problem).toBeDefined();
    expect(problem?.reason).toContain('network blip listing bad course');

    // Every item seen (3 lessons from the good course + 1 failed course) is accounted for.
    const total = Object.values(summary.counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(4);
  });

  it('a write failure is recorded as failed with a write-related reason, completes the sync, and does not mark the item ok (regression test for permanent-skip bug)', async () => {
    // Point outDir at a path that is a plain FILE, not a directory. mkdir(recursive) for any
    // path underneath it must fail (ENOTDIR), simulating a disk/permission failure during write.
    const blockerFile = join(tmpdir(), `skool-sync-blocker-${Date.now()}`);
    await writeFile(blockerFile, 'not a directory');

    const singleLessonCourse = `<script id="__NEXT_DATA__">${JSON.stringify({
      props: { pageProps: { course: { children: [
        { course: { id: 'l1', metadata: { title: 'With Video', hasAccess: 1,
            videoLink: 'https://www.loom.com/share/aaa', videoLenMs: 60000 } }, children: [] },
      ] } } },
    })}</script>`;

    const singleCourseClassroom = `<script id="__NEXT_DATA__">${JSON.stringify({
      props: { pageProps: { allCourses: [
        { id: 'c1', metadata: { title: 'Course One', hasAccess: 1 } },
      ] } },
    })}</script>`;

    const writeFailFetcher: Fetcher = {
      async getPage(url) {
        if (url.endsWith('/classroom')) return singleCourseClassroom;
        if (url.includes('/classroom/c1')) return singleLessonCourse;
        if (url.includes('loom.com/share/aaa')) return LOOM_OK;
        if (url.includes('cdn.loom.com')) return VTT;
        throw new Error(`unexpected url ${url}`);
      },
    };

    const summary = await syncClassroom({ slug: 'demo', outDir: blockerFile, db, fetcher: writeFailFetcher });

    expect(summary.counts.failed).toBe(1);
    expect(summary.counts.ok).toBe(0);
    const problem = summary.problems.find((p) => p.title === 'With Video');
    expect(problem).toBeDefined();
    expect(problem?.reason).toMatch(/write/i);

    // Regression check: the DB must not claim this transcript is 'ok', or resumability would
    // skip it forever on every future run.
    const id = 'demo:lesson:l1';
    expect(db.getTranscriptStatus(id)).not.toBe('ok');
  });

  it('a saveTranscript store error becomes a failed outcome with a reason, and other items still process (Finding 3)', async () => {
    // db.upsertItem returns id = `${community}:${item.type}:${item.nativeId}`. Only the "With
    // Video" lesson (l1) reaches the ok path and calls saveTranscript with a status of 'ok' —
    // make exactly that call throw, simulating a locked/disk-full sqlite error mid-run.
    const realDb = db;
    const flakyDb: Db = {
      ...realDb,
      saveTranscript(itemId, result) {
        if (itemId === 'demo:lesson:l1' && result.status === 'ok') {
          throw new Error('database is locked');
        }
        return realDb.saveTranscript(itemId, result);
      },
    };

    const summary = await syncClassroom({ slug: 'demo', outDir, db: flakyDb, fetcher });

    // The item whose save failed is bucketed as failed with a reason, not silently dropped or
    // wrongly marked ok.
    expect(summary.counts.ok).toBe(0);
    expect(summary.counts.failed).toBe(1);
    const problem = summary.problems.find((p) => p.title === 'With Video');
    expect(problem).toBeDefined();
    expect(problem?.reason).toMatch(/save transcript/i);

    // Other items (no-video, unavailable, locked course) still processed normally.
    expect(summary.counts['no-video']).toBe(1);
    expect(summary.counts.unavailable).toBe(1);
    expect(summary.counts['no-access']).toBe(1);

    // Bucket-sum invariant still holds.
    const total = Object.values(summary.counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(4);
  });

  it('a course with 100+ lessons that have video URLs writes files with a 3-digit zero-padded index prefix', async () => {
    const LESSON_COUNT = 120;
    const manyLessonsCourse = `<script id="__NEXT_DATA__">${JSON.stringify({
      props: { pageProps: { course: { children: Array.from({ length: LESSON_COUNT }, (_, i) => ({
        course: {
          id: `l${i}`,
          metadata: {
            title: `Lesson ${i}`,
            hasAccess: 1,
            videoLink: `https://www.loom.com/share/v${i}`,
            videoLenMs: 60000,
          },
        },
        children: [],
      })) } } },
    })}</script>`;

    const bigCourseClassroom = `<script id="__NEXT_DATA__">${JSON.stringify({
      props: { pageProps: { allCourses: [
        { id: 'c1', metadata: { title: 'Big Course', hasAccess: 1 } },
      ] } },
    })}</script>`;

    const bigFetcher: Fetcher = {
      async getPage(url) {
        if (url.endsWith('/classroom')) return bigCourseClassroom;
        if (url.includes('/classroom/c1')) return manyLessonsCourse;
        if (url.includes('loom.com/share/')) {
          const captionsUrl = `https://cdn.loom.com/mediametadata/captions/${url.split('/').pop()}.vtt?Policy=p`;
          return `{\"transcription_status\":\"success\",\"captions_url\":\"${captionsUrl}\"}`;
        }
        if (url.includes('cdn.loom.com')) return VTT;
        throw new Error(`unexpected url ${url}`);
      },
    };

    const summary = await syncClassroom({ slug: 'demo', outDir, db, fetcher: bigFetcher });
    expect(summary.counts.ok).toBe(LESSON_COUNT);

    const dir = join(outDir, 'transcripts', 'big-course');
    const files = await readdir(dir);
    expect(files.some((f) => /^000-/.test(f))).toBe(true);
    expect(files.some((f) => /^119-/.test(f))).toBe(true);
  });
});

describe('syncClassroom — resume is per output folder', () => {
  it('re-writes transcripts into a new folder instead of skipping them as already done', async () => {
    const db = openDb(':memory:');
    try {
      await syncClassroom({ slug: 'demo', outDir: await mkdtemp(join(tmpdir(), 'skool-a-')), db, fetcher });
      const second = await mkdtemp(join(tmpdir(), 'skool-b-'));
      const summary = await syncClassroom({ slug: 'demo', outDir: second, db, fetcher });
      expect(summary.counts.ok).toBe(1);
      expect(summary.counts.skipped).toBe(0);
      expect(await readdir(join(second, 'transcripts', 'course-one'))).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});
