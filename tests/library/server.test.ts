import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import type { Server } from 'node:http';
import { openDb } from '../../src/store/db.js';
import { videoPath } from '../../src/store/markdown.js';
import { startLibrary, snippet } from '../../src/library/server.js';
import type { ContentItem } from '../../src/types.js';

const lesson: ContentItem = {
  nativeId: 'l1', type: 'lesson', title: 'Pricing 100%', index: 1, course: 'Offers', section: null,
  url: null, videoUrl: 'https://www.loom.com/share/a', durationMs: 60_000, hasAccess: true, publishedAt: null, bodyText: null,
};

describe('library server', () => {
  let dir: string, server: Server, url: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'skrape-lib-'));
    const db = openDb(join(dir, 'skool.db'));
    db.upsertCommunity('demo', 'demo');
    const { id } = db.upsertItem('demo', lesson);
    db.saveTranscript(id, { status: 'ok', text: '[0:00] Sell the outcome.\n\n[0:30] Deliver the system.', wordCount: 6, provider: 'loom', sourceUrl: 'x' });
    db.close();
    const video = videoPath(join(dir, 'out', 'demo'), lesson, 2);
    mkdirSync(dirname(video), { recursive: true });
    writeFileSync(video, '0123456789');
    ({ server, url } = await startLibrary({ dbFile: join(dir, 'skool.db'), outRoot: join(dir, 'out'), port: 0 }));
  });
  afterAll(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

  it('lists communities with their lessons and finds videos on disk', async () => {
    const [community] = await (await fetch(`${url}api/library`)).json();
    expect(community.items).toHaveLength(1);
    expect(community.items[0]).toMatchObject({ title: 'Pricing 100%', status: 'ok', has_video: true });
  });

  it('searches transcripts and treats % literally', async () => {
    expect(await (await fetch(`${url}api/search?q=system`)).json()).toHaveLength(1);
    expect(await (await fetch(`${url}api/search?q=${encodeURIComponent('100%')}`)).json()).toHaveLength(1);
    expect(await (await fetch(`${url}api/search?q=${encodeURIComponent('g%')}`)).json()).toHaveLength(0);
  });

  it('serves byte ranges so the player can seek', async () => {
    const res = await fetch(`${url}video?id=${encodeURIComponent('demo:lesson:l1')}`, { headers: { range: 'bytes=2-4' } });
    expect(res.status).toBe(206);
    expect(await res.text()).toBe('234');
  });

  it('refuses requests for another host name', async () => {
    const { request } = await import('node:http');
    const status = await new Promise((resolve) => request(`${url}api/library`, { headers: { host: 'evil.example' } }, (r) => resolve(r.statusCode)).end());
    expect(status).toBe(403);
  });

  it('cuts a snippet around the match without timestamps', () => {
    expect(snippet('[0:00] aaa needle bbb', 'needle', 4)).toBe('…aaa needle bbb…');
  });
});
