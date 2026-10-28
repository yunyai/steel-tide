import { afterEach, expect, it, vi } from 'vitest';
import type { Shell } from '../src/app/Shell';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it('keeps a static host on the title screen without opening a LAN connection', async () => {
  vi.stubEnv('VITE_STATIC_HOST', 'true');
  vi.resetModules();
  const { LanLink } = await import('../src/app/LanLink');
  const showTitle = vi.fn();
  const shell = { menu: { showTitle } } as unknown as Shell;
  const link = new LanLink(shell, {} as HTMLElement);

  // Node has no page location or WebSocket server: trying to connect would throw.
  expect(() => link.open()).not.toThrow();
  expect(link.client).toBeNull();
  expect(showTitle).toHaveBeenCalledOnce();
});
