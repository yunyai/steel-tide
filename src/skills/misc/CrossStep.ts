import type { Ship } from '../../ships/Ship';
import type { SkillState } from '../types';
import { buff, hurt } from '../kit';
import { bearingTo, forwardX, forwardZ } from '../../core/math';
import { safeStep, snapStep, stepState, type Landing } from './StepperRuntime';

export const CROSS = { range: 3500, radius: 1000, duration: 3, cuts: 100, damage: 4000, finisher: 150000 } as const;
export interface CrossState {
  x: number;
  z: number;
  elapsed: number;
  count: number;
  jumps: number;
  finish: Landing;
}

/** Deterministic search; only the starting angle of an actual step consumes simulation RNG. */
function perimeter(s: Ship, x: number, z: number, angle: number): Landing | null {
  for (let i = 0; i < 36; i++) {
    const a = angle + i * Math.PI * 2 / 36;
    const p = { x: x + forwardX(a) * CROSS.radius, z: z + forwardZ(a) * CROSS.radius, heading: a + Math.PI / 2 };
    if (Math.hypot(p.x - s.pos.x, p.z - s.pos.z) < 150) continue;
    if (safeStep(s, p.x, p.z, p.heading)) return p;
  }
  return null;
}
function center(s: Ship, x: number, z: number, heading: number): Landing | null {
  if (safeStep(s, x, z, heading)) return { x, z, heading };
  const offset = s.stepper?.copy ? (s.stepper.slot + 1) * Math.PI / 2 : 0;
  for (let r = 50; r < CROSS.radius; r += 50)
    for (let i = 0; i < 24; i++) {
      const a = offset + i * Math.PI * 2 / 24;
      const p = { x: x + forwardX(a) * r, z: z + forwardZ(a) * r, heading };
      if (safeStep(s, p.x, p.z, heading)) return p;
    }
  return null;
}
export function beginCross(s: Ship): boolean {
  const command = s.stepper?.mirrorAim;
  const owner = s.stepper?.copy ? s.summonOwner! : s;
  const origin = command ?? owner.pos;
  const dx = (command?.aimX ?? owner.control.aimX) - origin.x;
  const dz = (command?.aimZ ?? owner.control.aimZ) - origin.z;
  const d = Math.hypot(dx, dz), k = Math.min(1, CROSS.range * s.mods.reachMul / Math.max(1, d));
  // Echoes inherit the already-resolved zone, including owner-only reach modifiers.
  const resolved = s.stepper?.copy && command ? owner.stepper?.cross : null;
  const x = resolved ? resolved.x : origin.x + dx * k, z = resolved ? resolved.z : origin.z + dz * k;
  const finish = center(s, x, z, s.heading);
  const first = perimeter(s, x, z, bearingTo(x, z, s.pos.x, s.pos.z));
  if (!finish || !first) return s.failSkill('Cross-step: no safe perimeter or finishing water');
  const p = perimeter(s, x, z, s.game.rng() * Math.PI * 2) ?? first;
  const a = stepState(s);
  a.cross = { x, z, elapsed: 0, count: 0, jumps: 1, finish };
  a.phaseUntil = s.game.time + CROSS.duration;
  buff(s, 'crossStep:phase', CROSS.duration, m => { m.invulnerable = true; });
  s.mods.invulnerable = true;
  snapStep(s, p);
  s.game.events.emit('crossStep', { ship: s, x, z, radius: CROSS.radius, phase: 'start' });
  return true;
}
function cut(s: Ship, st: SkillState, amount: number): void {
  const f = s.stepper!.cross!;
  for (const t of s.game.ships) {
    if (!s.alive) break;
    if (t.alive && t.team !== s.team && !t.deep && Math.hypot(t.pos.x - f.x, t.pos.z - f.z) <= CROSS.radius)
      hurt(s, t, amount, st.spec);
  }
}
export function updateCross(s: Ship, dt: number, st: SkillState): void {
  const f = s.stepper?.cross;
  if (!f) { st.time = 0; return; }
  f.elapsed = Math.min(CROSS.duration, f.elapsed + dt);
  while (s.alive && f.count < CROSS.cuts && f.elapsed + 1e-8 >= (f.count + 1) * CROSS.duration / CROSS.cuts) {
    cut(s, st, CROSS.damage);
    f.count++;
  }
  if (!s.alive || s.stepper?.cross !== f) return;
  if (f.elapsed + 1e-8 >= CROSS.duration) {
    cut(s, st, CROSS.finisher);
    if (!s.alive || s.stepper?.cross !== f) return;
    s.game.events.emit('crossStep', { ship: s, x: f.x, z: f.z, radius: CROSS.radius, phase: 'finish' });
    const p = center(s, f.x, f.z, f.finish.heading);
    if (p) snapStep(s, p);
    endCross(s);
    st.time = 0;
    return;
  }
  while (f.jumps < 10 && f.elapsed + 1e-8 >= f.jumps * 0.3) {
    const p = perimeter(s, f.x, f.z, s.game.rng() * Math.PI * 2);
    if (p) snapStep(s, p);
    f.jumps++;
  }
}
export function endCross(s: Ship): void {
  if (s.stepper) { s.stepper.cross = null; s.stepper.phaseUntil = 0; }
  s.effects = s.effects.filter(e => e.id !== 'crossStep:phase');
  s.refreshModifiers();
}
