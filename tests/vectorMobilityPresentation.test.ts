import { expect, it } from 'vitest';
import { vectorMobilityPresentation } from '../src/ui/VectorMobilityPresentation';
import { activateArchitectHullDash, activateArchitectMobileBattery, materialize } from '../src/skills/misc/ArchitectRuntime';
import { emptyGame, place } from './helpers';

function arena() {
  const g = emptyGame('open', 7, 'freeplay'), s = place(g, 'architect', 0, 0, 3000);
  s.architect!.slots[0].type = 'vector'; s.control.aimX = 2000; s.control.aimZ = 3000;
  // Mobile Battery needs a deployed platform to lift.
  const escort = s.architect!.slots[1], m = materialize(s, escort); escort.state = 'deployed'; m.pos.set(1500, 0, 3000);
  return { g, s };
}
it('presents both actions ready from one Vector independently of Search cooldown', () => {
  const { s } = arena(); s.consumables[1].cooldown = 50;
  const p = vectorMobilityPresentation(s.getVectorMobilityStatus()!);
  expect(p.dash).toMatchObject({ ready: true, tone: 'ready', count: '2/2', detail: 'Ready' });
  expect(p.mobile).toMatchObject({ ready: true, tone: 'ready', detail: 'Ready · 10s duration' });
});
it('shows a remaining charge as usable during sequential recharge', () => {
  const { s } = arena(); expect(activateArchitectHullDash(s)).toBe(true); s.architect!.drive = null;
  const p = vectorMobilityPresentation(s.getVectorMobilityStatus()!);
  expect(p.dash).toMatchObject({ ready: true, count: '1/2', detail: 'Ready · +1 in 10.0s' });
  expect(p.mobile.ready).toBe(true);
});
it('presents active Mobile Battery duration and its activation cooldown separately', () => {
  const { s } = arena(); expect(activateArchitectMobileBattery(s)).toBe(true);
  expect(vectorMobilityPresentation(s.getVectorMobilityStatus()!).mobile).toMatchObject({ tone: 'active', ready: false, detail: 'Active 10.0s · ready in 14.0s' });
});
it('keeps movement blockers visible while recharge progresses', () => {
  const { s } = arena(); activateArchitectHullDash(s); s.architect!.drive = null; s.mods.rooted = true;
  const p = vectorMobilityPresentation(s.getVectorMobilityStatus()!);
  expect(p.dash).toMatchObject({ ready: false, tone: 'blocked', count: '1/2', detail: 'Rooted · +1 in 10.0s' });
  expect(p.mobile.detail).toBe('Rooted');
});
it('identifies lost Vector access without hiding stored timers', () => {
  const { s } = arena(); activateArchitectMobileBattery(s); s.architect!.slots[0].state = 'destroyed';
  const p = vectorMobilityPresentation(s.getVectorMobilityStatus()!);
  expect(p.mobile.tone).toBe('blocked'); expect(p.mobile.detail).toContain('Requires a living Vector');
  expect(p.mobile.title).toContain('14.0s'); expect(p.dash.ready).toBe(false);
});
