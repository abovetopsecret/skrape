import { createServer, type Server } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { slugify } from '../store/markdown.js';

// Copied next to the compiled server by `npm run build`.
const PAGE = readFileSync(new URL('./page.html', import.meta.url), 'utf-8');

interface Row { [key: string]: unknown }

export interface LibraryOptions {
  dbFile: string;
  outRoot: string;
  port: number;
}

/**
 * Where sync put a lesson's video, checking each candidate community folder in order.
 * The db doesn't keep padWidth, so try the widths sync can produce.
 */
export function findVideo(communityDirs: string[], course: string | null, position: number, title: string): string | null {
  for (const communityDir of communityDirs) {
    const dir = join(communityDir, 'videos', slugify(course ?? 'uncategorized'));
    for (let width = 2; width <= 5; width++) {
      const path = join(dir, `${String(position).padStart(width, '0')}-${slugify(title)}.mp4`);
      if (existsSync(path)) return path;
    }
  }
  return null;
}

/** A short excerpt around the first hit, so search results show why they matched. */
export function snippet(text: string, query: string, radius = 90): string {
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return text.slice(0, radius * 2).replace(/\[\d+:\d{2}\] /g, '');
  const start = Math.max(0, at - radius);
  return (start > 0 ? '…' : '') + text.slice(start, at + query.length + radius).replace(/\[\d+:\d{2}\] /g, '') + '…';
}

export function startLibrary({ dbFile, outRoot, port }: LibraryOptions): Promise<{ server: Server; url: string }> {
  // Read-only: the library never writes, so it can stay open while a sync runs.
  const db = existsSync(dbFile) ? new DatabaseSync(dbFile, { readOnly: true }) : null;
  const all = (sql: string, ...args: (string | number)[]): Row[] => (db ? (db.prepare(sql).all(...args) as Row[]) : []);

  const lessonRow = (id: string): Row | undefined => all(
    `SELECT i.id, i.community, i.course, i.section, i.position, i.title, i.url, i.duration_ms,
            i.body_text, i.resources, t.status, t.reason, t.text, t.word_count, t.source_url
     FROM items i LEFT JOIN transcripts t ON t.item_id = i.id WHERE i.id = ?`, id)[0];

  // Where the last sync wrote (recorded since 0.3.0), then the default folder for older syncs.
  // A db last written before 0.3.0 has no out_dir column, and read-only can't add it.
  const hasOutDir = all('PRAGMA table_info(communities)').some((c) => c.name === 'out_dir');
  const dirsFor = (slug: string): string[] => {
    const recorded = hasOutDir ? all('SELECT out_dir FROM communities WHERE slug = ?', slug)[0]?.out_dir : null;
    return [...new Set([recorded, join(outRoot, slug)].filter((d): d is string => typeof d === 'string'))];
  };
  const videoFor = (row: Row): string | null =>
    findVideo(dirsFor(String(row.community)), row.course as string | null, Number(row.position), String(row.title));

  const routes: Record<string, (q: URLSearchParams) => unknown> = {
    '/api/library': () => {
      const communities = all('SELECT slug, name, last_synced_at FROM communities ORDER BY last_synced_at DESC');
      const items = all(
        `SELECT i.id, i.community, i.course, i.section, i.position, i.title, i.duration_ms, i.has_access,
                t.status, t.word_count
         FROM items i LEFT JOIN transcripts t ON t.item_id = i.id
         WHERE i.type = 'lesson' ORDER BY i.community, i.rowid`);
      for (const item of items) item.has_video = videoFor(item) !== null;
      return communities
        .map((c) => ({ ...c, items: items.filter((i) => i.community === c.slug) }))
        .filter((c) => c.items.length > 0);
    },
    '/api/item': (q) => {
      const row = lessonRow(q.get('id') ?? '');
      return row ? { ...row, has_video: videoFor(row) !== null } : null;
    },
    '/api/search': (q) => {
      const term = (q.get('q') ?? '').trim();
      if (term.length < 2) return [];
      const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      // ponytail: LIKE scan over every transcript; move to FTS5 if libraries get past ~10k lessons.
      return all(
        `SELECT i.id, i.community, i.course, i.title, t.text
         FROM items i LEFT JOIN transcripts t ON t.item_id = i.id
         WHERE i.type = 'lesson' AND (i.title LIKE ?1 ESCAPE '\\' OR t.text LIKE ?1 ESCAPE '\\')
         LIMIT 60`, like,
      ).map(({ text, ...rest }) => ({ ...rest, snippet: snippet(String(text ?? ''), term) }));
    },
  };

  const server = createServer((req, res) => {
    // Only answer to our own address, so another website can't read your library via DNS rebinding.
    const host = req.headers.host ?? '';
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) {
      res.writeHead(403).end();
      return;
    }
    const url = new URL(req.url ?? '/', `http://${host}`);

    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE);
      return;
    }

    if (url.pathname === '/video') {
      const row = lessonRow(url.searchParams.get('id') ?? '');
      const path = row && videoFor(row);
      if (!path) {
        res.writeHead(404).end();
        return;
      }
      // Range support is what lets the <video> element seek when a timestamp is clicked.
      const size = statSync(path).size;
      const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
      if (!range) {
        res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': size, 'accept-ranges': 'bytes' });
        createReadStream(path).pipe(res);
        return;
      }
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start >= size || start > end) {
        res.writeHead(416, { 'content-range': `bytes */${size}` }).end();
        return;
      }
      res.writeHead(206, {
        'content-type': 'video/mp4', 'content-length': end - start + 1,
        'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes',
      });
      createReadStream(path, { start, end }).pipe(res);
      return;
    }

    const route = routes[url.pathname];
    if (!route) {
      res.writeHead(404).end();
      return;
    }
    try {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(route(url.searchParams)));
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: (error as Error).message }));
    }
  });
  server.on('close', () => db?.close());

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const actual = typeof address === 'object' && address ? address.port : port;
      resolve({ server, url: `http://127.0.0.1:${actual}/` });
    });
  });
}
