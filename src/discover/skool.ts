import { z } from 'zod';
import { extractNextData, PayloadParseError } from '../fetch/nextdata.js';
import type { ContentItem, Fetcher } from '../types.js';

export interface CourseRef {
  id: string;
  title: string;
  hasAccess: boolean;
}

const MetadataSchema = z.object({
  title: z.string().optional().catch(undefined),
  hasAccess: z.number().optional().catch(undefined),
  videoLink: z.string().optional().catch(undefined),
  videoLenMs: z.number().optional().catch(undefined),
});

const CourseListSchema = z.object({
  props: z.object({
    pageProps: z.object({
      allCourses: z.array(z.object({ id: z.string(), metadata: MetadataSchema })),
    }),
  }),
});

type TreeNode = { course?: { id?: string; metadata?: unknown }; children?: TreeNode[] };

const TreeSchema = z.object({
  props: z.object({
    pageProps: z.object({
      course: z.object({ children: z.array(z.unknown()).optional() }),
    }),
  }),
});

export function parseCourseList(payload: unknown): CourseRef[] {
  const parsed = CourseListSchema.safeParse(payload);
  if (!parsed.success) throw new PayloadParseError(`unexpected classroom payload: ${parsed.error.message}`);

  return parsed.data.props.pageProps.allCourses.map((course) => ({
    id: course.id,
    title: course.metadata.title ?? '(untitled course)',
    // Fail-safe: courses without explicit access flag default to no access, since we must never
    // probe content the user may not be entitled to. Inside a course (see parseCourseTree),
    // lessons default to accessible because they're already within an accessible parent.
    hasAccess: (course.metadata.hasAccess ?? 0) > 0,
  }));
}

export interface Skipped {
  reason: string;
}

export interface CourseTreeResult {
  items: ContentItem[];
  skipped: Skipped[];
}

export function parseCourseTree(payload: unknown, courseTitle: string): CourseTreeResult {
  const parsed = TreeSchema.safeParse(payload);
  if (!parsed.success) throw new PayloadParseError(`unexpected course payload: ${parsed.error.message}`);

  const items: ContentItem[] = [];
  const skipped: Skipped[] = [];
  let index = 0;

  const walk = (nodes: TreeNode[] | undefined, section: string | null): void => {
    for (const node of nodes ?? []) {
      // Guard against null or non-object elements that may appear as tombstones/placeholders
      // in real Skool data. These are visibly accounted for as skipped, not silently dropped.
      if (node === null || typeof node !== 'object') {
        skipped.push({ reason: 'node skipped: null or non-object node' });
        continue;
      }

      const metadata = MetadataSchema.safeParse(node.course?.metadata);
      const meta = metadata.success ? metadata.data : {};
      const title = meta.title;

      if (title) {
        items.push({
          nativeId: node.course?.id ?? `${courseTitle}:${index}`,
          type: 'lesson',
          title,
          index: index++,
          course: courseTitle,
          section,
          url: null,
          videoUrl: meta.videoLink ?? null,
          durationMs: meta.videoLenMs ?? 0,
          // Fail-safe: lessons without explicit access flag default to accessible, since we're already
          // inside a course the user has access to. Top-level courses default to no access (see parseCourseList).
          hasAccess: (meta.hasAccess ?? 1) > 0,
          publishedAt: null,
          bodyText: null,
        });
      } else {
        // A missing or non-string title (easy to hit, since each field's .catch(undefined) maps a
        // bad type to undefined) must not make the node vanish uncounted — record it as skipped so
        // the acceptance-critical lesson count still balances.
        skipped.push({ reason: 'node skipped: no usable title' });
      }
      walk(node.children, title ?? section);
    }
  };

  walk(parsed.data.props.pageProps.course.children as TreeNode[] | undefined, null);
  return { items, skipped };
}

export async function listCourses(slug: string, fetcher: Fetcher): Promise<CourseRef[]> {
  const html = await fetcher.getPage(`https://www.skool.com/${slug}/classroom`);
  return parseCourseList(extractNextData(html));
}

export async function listLessons(
  slug: string,
  course: CourseRef,
  fetcher: Fetcher,
): Promise<CourseTreeResult> {
  const html = await fetcher.getPage(`https://www.skool.com/${slug}/classroom/${course.id}`);
  return parseCourseTree(extractNextData(html), course.title);
}
