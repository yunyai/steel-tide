import { afterEach, expect, it, vi } from 'vitest';

/** A fresh Settings module over a stub localStorage holding `saved` for the display record. */
async function load(saved?: unknown) {
  const data = new Map<string, string>();
  if (saved !== undefined) data.set('steel-tide.display', JSON.stringify(saved));
  vi.stubGlobal('window', { localStorage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) } });
  vi.resetModules();
  return { settings: await import('../src/input/Settings'), data };
}
afterEach(() => vi.unstubAllGlobals());

it('defaults damage numbers to 100%', async () => {
  const { settings } = await load();
  expect(settings.display().damageScale).toBe(1);
});
it('round-trips every offered damage number size', async () => {
  for (const scale of [0.75, 1, 1.25, 1.5, 2]) {
    const { settings, data } = await load();
    settings.setDisplay({ damageScale: scale });
    const { settings: again } = await load(JSON.parse(data.get('steel-tide.display')!));
    expect(again.display().damageScale).toBe(scale);
  }
});
it('rejects sizes the sheet does not offer and keeps the other display fields', async () => {
  for (const bad of [0, 3, '2', null, 1.1]) {
    const { settings } = await load({ colourBlind: true, perf: true, damageScale: bad });
    expect(settings.display()).toEqual({ colourBlind: true, perf: true, damageScale: 1, shortDamage: false });
  }
});
it('defaults to full damage digits and round-trips the short format',async()=>{
  const { settings, data } = await load();
  expect(settings.display().shortDamage).toBe(false);
  settings.setDisplay({ shortDamage: true });
  const { settings: again } = await load(JSON.parse(data.get('steel-tide.display')!));
  expect(again.display().shortDamage).toBe(true);
  const { settings: bad } = await load({ shortDamage: 'yes' });
  expect(bad.display().shortDamage).toBe(false);
});
