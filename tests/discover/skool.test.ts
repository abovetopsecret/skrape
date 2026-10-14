import { describe, it, expect } from 'vitest';
import { parseCourseList, parseCourseTree } from '../../src/discover/skool.js';
import { PayloadParseError } from '../../src/fetch/nextdata.js';

const courseListPayload = {
  props: { pageProps: { allCourses: [
    { id: 'c1', metadata: { title: 'START HERE', hasAccess: 1 } },
    { id: 'c2', metadata: { title: 'Locked Course', hasAccess: 0 } },
  ] } },
};

const treePayload = {
  props: { pageProps: { course: { children: [
    {
      course: { id: 's1', metadata: { title: 'Section One', hasAccess: 1 } },
      children: [
        { course: { id: 'l1', metadata: {
            title: 'First Lesson', hasAccess: 1,
            videoLink: 'https://www.loom.com/share/aaa', videoLenMs: 60000 } }, children: [] },
        { course: { id: 'l2', metadata: {
            title: 'Second Lesson', hasAccess: 1, videoLenMs: 0 } }, children: [] },
      ],
    },
  ] } } },
};

describe('parseCourseList', () => {
  it('returns every course with its access flag', () => {
    const courses = parseCourseList(courseListPayload);
    expect(courses).toHaveLength(2);
    expect(courses[0]).toEqual({ id: 'c1', title: 'START HERE', hasAccess: true });
    expect(courses[1]!.hasAccess).toBe(false);
  });

  it('throws PayloadParseError when allCourses is absent', () => {
    expect(() => parseCourseList({ props: { pageProps: {} } })).toThrow(PayloadParseError);
  });
});

describe('parseCourseTree', () => {
  it('flattens nested lessons in document order', () => {
    const { items } = parseCourseTree(treePayload, 'My Course');
    const titles = items.map((i) => i.title);
    expect(titles).toEqual(['Section One', 'First Lesson', 'Second Lesson']);
  });

  it('assigns sequential indexes for stable filenames', () => {
    expect(parseCourseTree(treePayload, 'My Course').items.map((i) => i.index)).toEqual([0, 1, 2]);
  });

  it('records the parent section on nested lessons', () => {
    const { items } = parseCourseTree(treePayload, 'My Course');
    expect(items[0]!.section).toBeNull();
    expect(items[1]!.section).toBe('Section One');
  });

  it('carries the video url and duration through', () => {
    const lesson = parseCourseTree(treePayload, 'My Course').items[1]!;
    expect(lesson.videoUrl).toBe('https://www.loom.com/share/aaa');
    expect(lesson.durationMs).toBe(60000);
  });

  it('represents a lesson with no video as videoUrl null, not a missing item', () => {
    const lesson = parseCourseTree(treePayload, 'My Course').items[2]!;
    expect(lesson.videoUrl).toBeNull();
    expect(lesson.title).toBe('Second Lesson');
  });

  it('stamps every item with the course name and lesson type', () => {
    for (const item of parseCourseTree(treePayload, 'My Course').items) {
      expect(item.course).toBe('My Course');
      expect(item.type).toBe('lesson');
    }
  });

  it('returns an empty array for a course with no children', () => {
    expect(parseCourseTree({ props: { pageProps: { course: {} } } }, 'Empty')).toEqual({ items: [], skipped: [] });
  });

  it('reports no skipped nodes for a fully well-formed tree', () => {
    expect(parseCourseTree(treePayload, 'My Course').skipped).toEqual([]);
  });
});

describe('parseCourseTree — edge cases (Finding 1 & 2)', () => {
  it('skips null elements in children array and processes siblings (Finding 1)', () => {
    const payloadWithNull = {
      props: { pageProps: { course: { children: [
        null,
        {
          course: { id: 'l1', metadata: { title: 'Lesson After Null', hasAccess: 1 } },
          children: [],
        },
        null,
      ] } } },
    };
    const { items, skipped } = parseCourseTree(payloadWithNull, 'Test');
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe('Lesson After Null');
    // Finding 4: null/tombstone nodes are visibly accounted for, not silently dropped.
    expect(skipped).toHaveLength(2);
    expect(skipped.every((s) => s.reason.length > 0)).toBe(true);
  });

  it('handles entirely missing metadata without throwing (Finding 2)', () => {
    const payloadNoMetadata = {
      props: { pageProps: { course: { children: [
        {
          course: { id: 'l1' },
          children: [],
        },
      ] } } },
    };
    // Should not throw; node is skipped because title is missing
    const { items, skipped } = parseCourseTree(payloadNoMetadata, 'Test');
    expect(items).toHaveLength(0);
    // Finding 4: a missing-title node is recorded as skipped, not just absent from items.
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.reason).toMatch(/title/i);
  });

  it('emits lesson with valid title even if sibling field has wrong type (Finding 2 regression)', () => {
    const payloadWrongType = {
      props: { pageProps: { course: { children: [
        {
          course: { id: 'l1', metadata: {
            title: 'Good Lesson',
            hasAccess: true,  // Wrong: boolean instead of number
            videoLenMs: '60000',  // Wrong: string instead of number
          } },
          children: [],
        },
      ] } } },
    };
    const { items, skipped } = parseCourseTree(payloadWrongType, 'Test');
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe('Good Lesson');
    // Bad fields should fall back to defaults
    expect(items[0]!.hasAccess).toBe(true);  // (1 ?? 1) > 0 when hasAccess is undefined
    expect(items[0]!.durationMs).toBe(0);    // (undefined ?? 0)
    expect(skipped).toHaveLength(0);
  });

  it('tracks section parentage across three levels of nesting (Finding 2 context)', () => {
    const threeLevel = {
      props: { pageProps: { course: { children: [
        {
          course: { id: 's1', metadata: { title: 'Section' } },
          children: [
            {
              course: { id: 'l1', metadata: { title: 'Subsection' } },
              children: [
                { course: { id: 'l2', metadata: { title: 'Deep Lesson' } }, children: [] },
              ],
            },
          ],
        },
      ] } } },
    };
    const { items } = parseCourseTree(threeLevel, 'Test');
    expect(items).toHaveLength(3);
    expect(items[0]!.section).toBeNull();
    expect(items[1]!.section).toBe('Section');
    expect(items[2]!.section).toBe('Subsection');
    // Indexes still sequential across all levels
    expect(items.map((i) => i.index)).toEqual([0, 1, 2]);
  });

  it('asymmetric hasAccess defaults: courses default to no access, lessons to access (Finding 3)', () => {
    // Course list: absent hasAccess means no access
    const courseListNoAccess = {
      props: { pageProps: { allCourses: [
        { id: 'c1', metadata: { title: 'Course', hasAccess: undefined } },
      ] } },
    };
    const courses = parseCourseList(courseListNoAccess);
    expect(courses[0]!.hasAccess).toBe(false);

    // Course tree: absent hasAccess means has access
    const treeNoAccess = {
      props: { pageProps: { course: { children: [
        {
          course: { id: 'l1', metadata: { title: 'Lesson', hasAccess: undefined } },
          children: [],
        },
      ] } } },
    };
    const { items } = parseCourseTree(treeNoAccess, 'Test');
    expect(items[0]!.hasAccess).toBe(true);
  });
});

describe('parseCourseTree — skipped-node accounting (Finding 4)', () => {
  it('a node with a non-string title is recorded as skipped, not silently dropped', () => {
    const payloadBadTitleType = {
      props: { pageProps: { course: { children: [
        {
          // title as a number fails the schema's z.string(), and .catch(undefined) maps it to
          // undefined — exactly the "easy to hit" case the finding calls out.
          course: { id: 'l1', metadata: { title: 12345 as unknown as string, hasAccess: 1 } },
          children: [],
        },
      ] } } },
    };
    const { items, skipped } = parseCourseTree(payloadBadTitleType, 'Test');
    expect(items).toHaveLength(0);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.reason).toMatch(/title/i);
  });
});
