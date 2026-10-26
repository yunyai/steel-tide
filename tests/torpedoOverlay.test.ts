import { expect, it } from 'vitest';
import { TorpedoAim } from '../src/render/TorpedoAim';
import { emptyGame, place } from './helpers';
import { stateHash } from '../src/net/hash';

it('draws ready and unavailable launchers for Stepper and other ships without touching the simulation', () => {
  const g = emptyGame(); const preview = new TorpedoAim();
  for (const id of ['stepper', 'shimakaze']) {
    const s = place(g, id, 0, 0, 0);
    s.slot = s.slots.findIndex(p => p.kind === 'torp');
    if (id === 'shimakaze') s.launchers[s.launchers.length - 1].reload = 10;
    const before = stateHash(g);
    preview.update({ ship:s, aim:{x:5000,z:0} }, 720);
    expect(preview.root.visible).toBe(true);
    expect(preview.ribbons.count).toBeGreaterThan(40);
    expect(preview.fan.geometry.drawRange.count).toBeGreaterThan(0);
    const colors = preview.fan.geometry.getAttribute('color');
    let green = false, red = false;
    for (let i = 0; i < colors.count; i++) {
      green ||= colors.getY(i) > colors.getX(i);
      red ||= colors.getX(i) > colors.getY(i);
    }
    expect(green && red).toBe(true);
    expect(stateHash(g)).toBe(before);
    s.slot = 0;
    preview.update({ ship:s, aim:{x:5000,z:0} }, 720);
    expect(preview.root.visible).toBe(false);
  }
  preview.dispose();
});
it('hides on spectator viewports, battle end, death, and ships without torpedoes', () => {
  const g = emptyGame(); const preview = new TorpedoAim();
  const s = place(g, 'stepper', 0, 0, 0);
  s.slot = s.slots.findIndex(p => p.kind === 'torp');
  preview.update({ ship:s, aim:{x:5000,z:0} }, 720);
  expect(preview.root.visible).toBe(true);
  preview.update(undefined, 720);
  expect(preview.root.visible).toBe(false);
  s.alive = false;
  preview.update({ ship:s, aim:{x:5000,z:0} }, 720);
  expect(preview.root.visible).toBe(false);
  s.alive = true; g.over = true;
  preview.update({ ship:s, aim:{x:5000,z:0} }, 720);
  expect(preview.root.visible).toBe(false);
  preview.dispose();
});
