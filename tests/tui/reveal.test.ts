import { describe, it, expect, vi } from 'vitest';
import { revealOutputFolder, type RevealDeps } from '../../src/tui/reveal.js';

function deps(overrides: Partial<RevealDeps> = {}): RevealDeps & { run: ReturnType<typeof vi.fn>; log: ReturnType<typeof vi.fn> } {
  return {
    run: vi.fn(async () => {}),
    platform: 'darwin',
    log: vi.fn(),
    ...overrides,
  } as RevealDeps & { run: ReturnType<typeof vi.fn>; log: ReturnType<typeof vi.fn> };
}

describe('revealOutputFolder', () => {
  it('on macOS, runs `open <path>` with the exact output directory', async () => {
    const d = deps({ platform: 'darwin' });
    await revealOutputFolder('./out/demo', d);
    expect(d.run).toHaveBeenCalledWith('open', ['./out/demo']);
    expect(d.log).not.toHaveBeenCalled();
  });

  it('on Windows, runs `explorer <path>`', async () => {
    const d = deps({ platform: 'win32' });
    await revealOutputFolder('./out/demo', d);
    expect(d.run).toHaveBeenCalledWith('explorer', ['./out/demo']);
  });

  it('on Linux, runs `xdg-open <path>`', async () => {
    const d = deps({ platform: 'linux' });
    await revealOutputFolder('./out/demo', d);
    expect(d.run).toHaveBeenCalledWith('xdg-open', ['./out/demo']);
  });

  it('falls back to printing the path on an unrecognized platform instead of crashing', async () => {
    const d = deps({ platform: 'aix' });
    await expect(revealOutputFolder('./out/demo', d)).resolves.toBeUndefined();
    expect(d.run).not.toHaveBeenCalled();
    expect(d.log).toHaveBeenCalledWith('./out/demo');
  });

  it('falls back to printing the path when the reveal command fails, instead of throwing', async () => {
    const d = deps({
      platform: 'darwin',
      run: vi.fn(async () => {
        throw new Error('open: command not found');
      }),
    });
    await expect(revealOutputFolder('./out/demo', d)).resolves.toBeUndefined();
    expect(d.log).toHaveBeenCalledWith('./out/demo');
  });
});
