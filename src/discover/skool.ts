import { z } from 'zod';
import { extractNextData, PayloadParseError } from '../fetch/nextdata.js';
import type { ContentItem, Fetcher, Resource } from '../types.js';

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
  resources: z.string().optional().catch(undefined),
  desc: z.string().optional().catch(undefined),
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
      course: z.object({
        children: z.array(z.unknown()).optional(),
        course: z.object({ name: z.string().optional().catch(undefined) }).optional().catch(undefined),
      }),
    }),
  }),
});

/** Skool stores resources as a JSON string: links ({title, link}) and uploads ({title, file_name, ...}). */
export function parseResources(raw: string | undefined): Resource[] {
  if (!raw) return [];
  let entries: unknown;
  try { entries = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry): Resource[] => {
    if (!entry || typeof entry !== 'object') return [];
    const { title, link, file_name: fileName } = entry as Record<string, unknown>;
    const url = typeof link === 'string' && /^https?:\/\//.test(link) ? link : null;
    const name = typeof title === 'string' && title.trim() ? title.trim() : typeof fileName === 'string' ? fileName : url;
    if (!name || (!url && typeof fileName !== 'string')) return [];
    return [{ title: name, url, ...(typeof fileName === 'string' ? { fileName } : {}) }];
  });
}

/** Lesson descriptions are plain text, or "[v2]" + a rich-text JSON tree; either way, return readable text. */
export function descriptionText(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  if (!raw.startsWith('[v2]')) return raw.trim();
  let tree: unknown;
  try { tree = JSON.parse(raw.slice(4)); } catch { return null; }
  const blocks: string[] = [];
  const inline = (node: unknown): string => {
    if (!node || typeof node !== 'object') return '';
    const { type, text, content, marks } = node as { type?: string; text?: string; content?: unknown[]; marks?: Array<{ type?: string; attrs?: { href?: string } }> };
    if (type === 'text') {
      const href = marks?.find((m) => m.type === 'link')?.attrs?.href;
      return href && href !== text ? `${text ?? ''} (${href})` : (text ?? '');
    }
    if (type === 'hardBreak') return '\n';
    return (content ?? []).map(inline).join('');
  };
  const block = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const { content } = node as { content?: unknown[] };
    // A node whose children are all inline is one block of text; anything else nests blocks.
    if (!content?.length || content.every((c) => (c as { type?: string })?.type === 'text' || (c as { type?: string })?.type === 'hardBreak')) {
      const line = inline(node).trim();
      if (line) blocks.push(line);
    } else content.forEach(block);
  };
  (Array.isArray(tree) ? tree : [tree]).forEach(block);
  return blocks.join('\n\n') || null;
}

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

/** With `slug`, each lesson gets its Skool URL (classroom/<course name>?md=<lesson id>). */
export function parseCourseTree(payload: unknown, courseTitle: string, slug?: string): CourseTreeResult {
  const parsed = TreeSchema.safeParse(payload);
  if (!parsed.success) throw new PayloadParseError(`unexpected course payload: ${parsed.error.message}`);

  const items: ContentItem[] = [];
  const skipped: Skipped[] = [];
  let index = 0;
  const courseName = parsed.data.props.pageProps.course.course?.name;
  const courseUrl = slug && courseName ? `https://www.skool.com/${slug}/classroom/${courseName}` : null;

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
        const nativeId = node.course?.id ?? `${courseTitle}:${index}`;
        items.push({
          nativeId,
          type: 'lesson',
          title,
          index: index++,
          course: courseTitle,
          section,
          url: courseUrl && node.course?.id ? `${courseUrl}?md=${node.course.id}` : null,
          videoUrl: meta.videoLink ?? null,
          durationMs: meta.videoLenMs ?? 0,
          // Fail-safe: lessons without explicit access flag default to accessible, since we're already
          // inside a course the user has access to. Top-level courses default to no access (see parseCourseList).
          hasAccess: (meta.hasAccess ?? 1) > 0,
          publishedAt: null,
          bodyText: descriptionText(meta.desc),
          resources: parseResources(meta.resources),
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
  return parseCourseTree(extractNextData(html), course.title, slug);
}
