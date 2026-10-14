import { spawn } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Run yt-dlp, resolving with its exit code and the tail of stderr. Never rejects on a bad exit. */
function run(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.SKRAPE_YT_DLP ?? 'yt-dlp', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stderr }));
  });
}

export async function hasYtDlp(): Promise<boolean> {
  try {
    return (await run(['--version'])).code === 0;
  } catch {
    return false;
  }
}

export type DownloadResult = { status: 'downloaded' | 'exists' } | { status: 'failed'; reason: string };

/**
 * Download one lesson video to `destPath` (an .mp4). An existing file is treated as complete:
 * yt-dlp writes to a .part file and only renames on success, so a partial never lands at destPath.
 */
export async function downloadVideo(videoUrl: string, destPath: string): Promise<DownloadResult> {
  try {
    await access(destPath);
    return { status: 'exists' };
  } catch {
    // not there yet — download it
  }
  await mkdir(dirname(destPath), { recursive: true });
  try {
    const { code, stderr } = await run([
      '--quiet', '--no-progress', '--no-playlist',
      '--referer', 'https://www.skool.com/',
      '--merge-output-format', 'mp4', '--remux-video', 'mp4',
      // Let yt-dlp pick the source extension; --remux-video lands the final file at destPath.
      '-o', destPath.replace(/\.mp4$/, '.%(ext)s'),
      videoUrl,
    ]);
    if (code === 0) return { status: 'downloaded' };
    const lastError = stderr.split('\n').filter((line) => line.includes('ERROR')).pop();
    return { status: 'failed', reason: (lastError ?? stderr.trim().split('\n').pop() ?? `yt-dlp exit ${code}`).trim() };
  } catch (error) {
    return { status: 'failed', reason: (error as Error).message };
  }
}
