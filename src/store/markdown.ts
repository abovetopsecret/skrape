import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ContentItem } from '../types.js';

export function slugify(text: string, maxLength = 60): string {
  const cleaned = text
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return cleaned || 'untitled';
}

function lessonPath(outDir: string, kind: string, ext: string, item: ContentItem, padWidth: number): string {
  const course = slugify(item.course ?? 'uncategorized');
  const width = Math.max(2, padWidth);
  const name = `${String(item.index).padStart(width, '0')}-${slugify(item.title)}.${ext}`;
  return join(outDir, kind, course, name);
}

export function transcriptPath(outDir: string, item: ContentItem, padWidth = 2): string {
  return lessonPath(outDir, 'transcripts', 'md', item, padWidth);
}

export function videoPath(outDir: string, item: ContentItem, padWidth = 2): string {
  return lessonPath(outDir, 'videos', 'mp4', item, padWidth);
}

export async function writeTranscript(
  outDir: string,
  item: ContentItem,
  body: string,
  meta: { wordCount: number; sourceUrl: string },
  padWidth = 2,
): Promise<string> {
  const path = transcriptPath(outDir, item, padWidth);
  await mkdir(dirname(path), { recursive: true });

  const minutes = Math.round(item.durationMs / 60_000);
  const cleanTitle = item.title.replace(/\s+/g, ' ');
  const cleanCourse = (item.course ?? '-').replace(/\s+/g, ' ');
  const cleanSection = item.section?.replace(/\s+/g, ' ');

  const header = [
    `# ${cleanTitle}`,
    '',
    `> Course: ${cleanCourse}` +
      (cleanSection ? `  |  Section: ${cleanSection}` : '') +
      `  |  ${minutes} min  |  ${meta.wordCount.toLocaleString('en-US')} words`,
    `> Source: ${meta.sourceUrl}`,
    '',
    '---',
    '',
  ].join('\n');

  await writeFile(path, `${header}${body}\n`, 'utf-8');
  return path;
}
