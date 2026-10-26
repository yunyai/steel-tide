/// <reference types="node" />
import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allAudioAssets, GUN_ASSETS, LOOP_ASSETS, recordedFallbacks, SOUND_KINDS, UI_ASSETS, UI_SOUNDS, WORLD_ASSETS } from '../src/fx/SoundCues';

describe('complete recorded audio coverage', () => {
  it('packages an attributed, nonempty local recording for every world, UI and loop route', () => {
    const manifest = JSON.parse(readFileSync(new URL('../public/audio/manifest.json', import.meta.url), 'utf8')) as { file: string; author: string; license: string; source: string; modifications: string }[];
    expect(SOUND_KINDS.every(kind => WORLD_ASSETS[kind])).toBe(true);
    expect(UI_SOUNDS.every(kind => UI_ASSETS[kind])).toBe(true);
    for (const url of allAudioAssets()) {
      const source = manifest.find(e => url === `/audio/${e.file}`);
      expect(source, url).toBeDefined();
      expect(source?.author, url).toBeTruthy();
      expect(source?.license, url).toBeTruthy();
      expect(source?.modifications, url).toBeTruthy();
      expect(statSync(new URL(`../public${url}`, import.meta.url)).size, url).toBeGreaterThan(1000);
    }
  });

  it('keeps cannon weights, result cues, warnings and battle-mode loops distinguishable', () => {
    expect(new Set(GUN_ASSETS).size).toBe(3);
    expect(UI_ASSETS.victory).not.toBe(UI_ASSETS.defeat);
    expect(UI_ASSETS.alarm).not.toBe(UI_ASSETS.click);
    expect(LOOP_ASSETS.sea).not.toBe(LOOP_ASSETS.wind);
    expect(LOOP_ASSETS.navalEngine).not.toBe(LOOP_ASSETS.groundEngine);
  });

  it('uses only other packaged recordings as fallbacks', () => {
    const known = new Set(allAudioAssets());
    for (const category of ['weapon', 'ability', 'ui'] as const) {
      const fallbacks = recordedFallbacks(category, WORLD_ASSETS.gun);
      expect(fallbacks.length).toBeGreaterThan(1);
      expect(fallbacks.every(url => known.has(url))).toBe(true);
    }
  });

  it('ships PCM loop recordings without lossy encoder padding at the loop seam', () => {
    for (const url of Object.values(LOOP_ASSETS)) {
      const bytes = readFileSync(new URL(`../public${url}`, import.meta.url));
      expect(bytes.toString('ascii', 0, 4), url).toBe('RIFF');
      expect(bytes.toString('ascii', 8, 12), url).toBe('WAVE');
    }
  });
});
