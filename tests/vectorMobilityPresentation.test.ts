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
it('shows a remaining charge as usable while another recharges', () => {
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
it('greys both actions out with the soonest rebuild while every Vector is destroyed', () => {
  const { s } = arena(); activateArchitectMobileBattery(s); const v = s.architect!.slots[0]; v.state = 'destroyed'; v.hp = 0; v.rebuild = 4.2;
  const p = vectorMobilityPresentation(s.getVectorMobilityStatus()!);
  expect(p.mobile).toMatchObject({ tone: 'off', ready: false, timer: '5', sweep: 1 }); expect(p.mobile.detail).toContain('rebuild in 4.2s');
  expect(p.mobile.title).toContain('14.0s'); expect(p.dash).toMatchObject({ tone: 'off', ready: false, timer: '5' });
});
it('keeps the hex clear while a dash charge remains and counts down once both are spent', () => {
  const { s } = arena(); activateArchitectHullDash(s); s.architect!.drive = null;
  expect(vectorMobilityPresentation(s.getVectorMobilityStatus()!).dash).toMatchObject({ timer: '', sweep: 0 });
  activateArchitectHullDash(s); s.architect!.drive = null;
  expect(vectorMobilityPresentation(s.getVectorMobilityStatus()!).dash).toMatchObject({ tone: 'recharging', timer: '10', count: '0/2' });
});
it('reports a hidden state when no Vector is equipped', () => {
  const { s } = arena(); s.architect!.slots[0].type = 'storm';
  expect(s.getVectorMobilityStatus()).toMatchObject({ equipped: false, unlocked: false });
});
