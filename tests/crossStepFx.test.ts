import { expect, it } from 'vitest';
import { Scene } from 'three';
import { CrossStepFx } from '../src/render/CrossStepFx';
import { emptyGame, place, run } from './helpers';
import { stateHash } from '../src/net/hash';
import { cueAsset, FAMILY_ASSETS } from '../src/fx/SoundCues';

it('renders a bounded slash storm and finisher without altering simulation state', () => {
  const g = emptyGame('open', 7, 'freeplay');
  const s = place(g, 'stepper', 0, 0, 1500);
  const t = place(g, 'leviathan', 1, 0, 0);
  s.throttle = t.throttle = 2; s.speed = t.speed = 0;
  s.control.aimX = s.control.aimZ = 0; s.meter = 1;
  const fx = new CrossStepFx(new Scene(), g);
  s.activateSkill(7); run(g, 0.5);
  const before = stateHash(g);
  fx.update(0.1); fx.prepare(0, 720);
  expect(fx.light.count).toBeGreaterThan(100);
  expect(fx.dark.count).toBeGreaterThan(0);
  expect(stateHash(g)).toBe(before);
  run(g, 2.5); fx.update(0.01); fx.prepare(0, 720);
  expect(fx.light.count).toBeGreaterThan(0);
  fx.update(1); fx.prepare(0, 720);
  expect(fx.light.count).toBe(0);
  expect(fx.dark.count).toBe(0);
  fx.dispose();
});
it('routes the continuous Cross-step impacts to slash recordings', () => {
  expect(cueAsset('crossStep','activate','impact')).toBe(FAMILY_ASSETS.slash);
  expect(cueAsset('crossStep','impact','impact')).toBe(FAMILY_ASSETS.slash);
});
