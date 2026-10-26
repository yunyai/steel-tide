import type { CrossState } from './CrossStep';
import { MAP_HALF, SHELL_TIME_SCALE } from '../../config';
import type { Game } from '../../core/Game';
import { canTrack } from '../../core/Targeting';
import { distToHull, segmentHitsHull } from '../../core/hull';
import { bearingTo, forwardX, forwardZ } from '../../core/math';
import type { Ship } from '../../ships/Ship';

export const FLICKER_RADIUS = 2000;

export interface StepperState {
  mirrorAim: { x: number; z: number; aimX: number; aimZ: number; landingX: number; landingZ: number } | null;
  copy: boolean;
  slot: number;
  ownerId: number;
  until: number;
  copies: number[];
  dodgeReady: number;
  phaseUntil: number;
  sideUntil: number;
  broadUntil: number;
  broadTarget: number;
  cross: CrossState | null;
  repair: { remaining: number } | null;
  repairInterruptedUntil: number;
  flicker: { x: number; z: number; elapsed: number; count: number } | null;
  rush: { x0: number; z0: number; x1: number; z1: number; elapsed: number; hit: number[] } | null;
}
export function newStepperState(): StepperState {
  return {
    mirrorAim: null,
    copy: false,
    slot: -1,
    ownerId: 0,
    until: Infinity,
    copies: [],
    dodgeReady: 0,
    phaseUntil: 0,
    sideUntil: 0,
    broadUntil: 0,
    broadTarget: 0,
    cross: null,
    repair: null,
    repairInterruptedUntil: 0,
    flicker: null,
    rush: null,
  };
}
export function stepState(s: Ship): StepperState {
  return (s.stepper ??= newStepperState());
}
export interface Landing {
  x: number;
  z: number;
  heading: number;
}

/** Footprint samples include the beam and both ends, not just the hull centre. */
export function safeStep(
  s: Ship,
  x: number,
  z: number,
  heading = s.heading,
  ignoreEnemies = false,
  reservations: Landing[] = [],
): boolean {
  if (!Number.isFinite(x + z + heading)) return false;
  const fx = forwardX(heading),
    fz = forwardZ(heading),
    rx = -fz,
    rz = fx;
  const half = s.spec.length / 2 + 8,
    beam = s.spec.beam / 2 + 8;
  for (let a = -half; a <= half + 0.01; a += half / Math.ceil(half / 20)) {
    for (const b of [-beam, 0, beam]) {
      const px = x + fx * a + rx * b,
        pz = z + fz * a + rz * b;
      if (
        Math.abs(px) > MAP_HALF - 150 ||
        Math.abs(pz) > MAP_HALF - 150 ||
        s.game.map.heightAt(px, pz) > -Math.max(6, s.spec.draft)
      )
        return false;
    }
  }
  const pose = { pos: { x, z }, heading, spec: s.spec } as Ship;
  for (const w of s.game.walls) {
    if (w.age < w.life && segmentHitsHull(pose, w.x0, w.z0, w.x1, w.z1, 25) >= 0) return false;
  }
  const corners = (p: Landing, len: number, width: number) =>
    [-1, 1].flatMap((a) =>
      [-1, 1].map((b) => ({
        x: p.x + (forwardX(p.heading) * len * a) / 2 + (Math.cos(p.heading) * width * b) / 2,
        z: p.z + (forwardZ(p.heading) * len * a) / 2 + (Math.sin(p.heading) * width * b) / 2,
      })),
    );
  const collides = (other: Ship) => {
    if (distToHull(other, x, z) < beam || distToHull(pose, other.pos.x, other.pos.z) < other.spec.beam / 2 + 8)
      return true;
    const c = corners({ x, z, heading }, s.spec.length + 16, s.spec.beam + 16);
    for (const [a, b] of [
      [0, 1],
      [0, 2],
      [1, 3],
      [2, 3],
    ])
      if (segmentHitsHull(other, c[a].x, c[a].z, c[b].x, c[b].z, 8) >= 0) return true;
    return false;
  };
  for (const o of s.game.ships)
    if (
      o !== s &&
      o.alive &&
      !o.deep &&
      !o.mods.banished &&
      !(
        ignoreEnemies &&
        (o.team !== s.team || (s.stepper?.copy && (o === s.summonOwner || o.summonOwner === s.summonOwner)))
      ) &&
      collides(o)
    )
      return false;
  for (const p of reservations)
    if (collides({ pos: p, heading: p.heading, spec: s.spec } as unknown as Ship)) return false;
  return true;
}
export function snapStep(s: Ship, p: Landing, dodge = false): void {
  const fromHeading = s.heading;
  const fromX = s.pos.x,
    fromZ = s.pos.z;
  s.pos.x = p.x;
  s.pos.z = p.z;
  s.heading = s.prevHeading = s.renderHeading = p.heading;
  s.prevPos.copy(s.pos);
  s.renderPos.copy(s.pos);
  s.game.events.emit('blink', { ship: s, fromX, fromZ, fromHeading, dodge });
}
export function aimedLanding(s: Ship, range: number): Landing | null {
  const owner = s.stepper?.copy ? s.summonOwner! : s;
  const command = s.stepper?.mirrorAim;
  if (s.stepper?.copy && command) {
    const a = ((s.stepper.slot + 0.5) * Math.PI) / 2;
    for (const off of [0, 0.15, -0.15, 0.3, -0.3, 0.6, -0.6]) {
      const p = {
        x: command.landingX + Math.cos(a + off) * 500,
        z: command.landingZ + Math.sin(a + off) * 500,
        heading: s.heading,
      };
      if (safeStep(s, p.x, p.z, p.heading)) return p;
    }
    return null;
  }
  let dx = owner.control.aimX - owner.pos.x,
    dz = owner.control.aimZ - owner.pos.z;
  const d = Math.hypot(dx, dz),
    max = range * s.mods.reachMul;
  if (d < 1) return null;
  dx /= d;
  dz /= d;
  const slot = s.stepper?.copy ? ((s.stepper.slot + 0.5) * Math.PI) / 2 : 0;
  const ox = s.stepper?.copy ? Math.cos(slot) * 500 : 0,
    oz = s.stepper?.copy ? Math.sin(slot) * 500 : 0;
  for (let t = Math.min(d, max); t >= 40; t -= 25) {
    const p = { x: owner.pos.x + dx * t + ox, z: owner.pos.z + dz * t + oz, heading: s.heading };
    if (safeStep(s, p.x, p.z, p.heading)) return p;
  }
  return null;
}
export function stepTarget(s: Ship, range: number): Ship | null {
  const source = s.stepper?.copy ? s.summonOwner! : s;
  const command = s.stepper?.mirrorAim;
  const origin = command ? { x: command.x, z: command.z } : source.pos;
  return (
    s.game.ships
      .filter(
        (o) =>
          canTrack(s, o) &&
          !o.deep &&
          Math.hypot(o.pos.x - origin.x, o.pos.z - origin.z) <= range * s.mods.reachMul + 0.001 &&
          distToHull(o, source.control.aimX, source.control.aimZ) <= 500,
      )
      .sort(
        (a, b) =>
          distToHull(a, source.control.aimX, source.control.aimZ) -
            distToHull(b, source.control.aimX, source.control.aimZ) || a.id - b.id,
      )[0] ?? null
  );
}
export function aroundTarget(s: Ship, t: Ship, r: number, broad = false): Landing | null {
  const a =
    bearingTo(t.pos.x, t.pos.z, s.pos.x, s.pos.z) + (s.stepper?.copy ? ((s.stepper.slot + 1) * Math.PI) / 3 : 0);
  for (const offset of [0, Math.PI / 6, -Math.PI / 6, Math.PI / 3, -Math.PI / 3, Math.PI]) {
    const h = a + offset,
      x = t.pos.x + forwardX(h) * r,
      z = t.pos.z + forwardZ(h) * r;
    const heading = bearingTo(x, z, t.pos.x, t.pos.z) + (broad ? Math.PI / 2 : Math.PI);
    if (safeStep(s, x, z, heading)) return { x, z, heading };
  }
  return null;
}
export const SIDESTEP = { distance: 100, phase: 0.08, retrigger: 0.12, lookAhead: 0.16 } as const;

/** React to an imminent collision as well as the damage fallback used by beams/area hits. */
export function evadeIncoming(s: Ship): void {
  const st = s.stepper,
    g = s.game;
  if (
    !st ||
    !s.alive ||
    st.sideUntil <= g.time ||
    st.dodgeReady > g.time ||
    st.phaseUntil > g.time ||
    st.rush ||
    st.flicker ||
    st.cross ||
    s.mods.invulnerable ||
    s.mods.stunned ||
    s.mods.silenced
  )
    return;
  const horizon = SIDESTEP.lookAhead;
  for (const p of g.shells.shells) {
    if (!p.alive || p.team === s.team || p.hit.includes(s.id)) continue;
    const reach = s.spec.length / 2 + Math.hypot(p.vx, p.vz) * SHELL_TIME_SCALE * horizon + 30;
    if (Math.hypot(p.x - s.pos.x, p.z - s.pos.z) > reach) continue;
    const hit = g.shells.predictImpact(p, horizon * g.fields.timeScale(p.team, p.x, p.z));
    if (
      hit?.ship === s &&
      incomingStep(s, p.owner, false, false, false, Math.hypot(p.vx, p.vz) > 1 ? Math.atan2(p.vx, -p.vz) : undefined)
    )
      return;
  }
  for (const p of g.torps.torps) {
    if (!p.alive || p.team === s.team || p.travelled + p.speed * horizon < 120) continue;
    const d = p.speed * horizon * g.fields.timeScale(p.team, p.x, p.z);
    if (
      segmentHitsHull(s, p.x, p.z, p.x + forwardX(p.heading) * d, p.z + forwardZ(p.heading) * d, 12) >= 0 &&
      incomingStep(s, p.owner, false, false, false, p.heading)
    )
      return;
  }
  for (const p of g.missiles.missiles) {
    if (!p.alive || p.team === s.team || p.delay > 0 || p.state === 'boost') continue;
    const d = p.speed * horizon * g.fields.timeScale(p.team, p.x, p.z);
    const drop =
      p.state === 'dive'
        ? Math.max(60, (p.y / Math.max(30, Math.hypot(p.tx - p.x, p.tz - p.z))) * p.speed) * horizon
        : 0;
    if (p.y - drop > s.pos.y + s.spec.freeboard + 35) continue;
    if (
      segmentHitsHull(s, p.x, p.z, p.x + forwardX(p.heading) * d, p.z + forwardZ(p.heading) * d, 16) >= 0 &&
      incomingStep(s, p.owner, false, false, false, p.heading)
    )
      return;
  }
}
export function incomingStep(
  s: Ship,
  attacker: Ship | null,
  reflected: boolean,
  pierce: boolean,
  periodic: boolean,
  incomingHeading?: number,
): boolean {
  const st = s.stepper,
    now = s.game.time;
  if (!st || !attacker || attacker.team === s.team || pierce || periodic || reflected) return false;
  if (st.phaseUntil > now) return true;
  if (st.sideUntil <= now || st.dodgeReady > now || st.rush || st.flicker || st.cross || s.mods.stunned || s.mods.silenced)
    return false;
  const away = (incomingHeading ?? bearingTo(attacker.pos.x, attacker.pos.z, s.pos.x, s.pos.z)) + Math.PI / 2;
  // Prefer a full lateral jump, trying the opposite side before shorter/diagonal escapes.
  for (const distance of [SIDESTEP.distance, (SIDESTEP.distance * 2) / 3, SIDESTEP.distance / 3])
    for (const offset of [
      0,
      Math.PI,
      Math.PI / 4,
      -Math.PI / 4,
      (Math.PI * 3) / 4,
      (-Math.PI * 3) / 4,
      Math.PI / 2,
      -Math.PI / 2,
    ]) {
      const a = away + offset,
        p = { x: s.pos.x + forwardX(a) * distance, z: s.pos.z + forwardZ(a) * distance, heading: s.heading };
      if (!safeStep(s, p.x, p.z, p.heading)) continue;
      st.phaseUntil = now + SIDESTEP.phase;
      st.dodgeReady = now + SIDESTEP.retrigger;
      snapStep(s, p, true);
      return true;
    }
  return false;
}
export function clearStepper(s: Ship): void {
  if (!s.stepper) return;
  for (const id of s.stepper.copies) {
    const c = s.game.ships.find((o) => o.id === id);
    if (c?.alive) c.withdraw();
  }
  if (s.stepper.copy) {
    s.stepper.flicker = null;
    s.stepper.cross = null;
    s.stepper.repair = null;
    s.stepper.phaseUntil = 0;
    s.stepper.rush = null;
  } else s.stepper = newStepperState();
}
export function syncStepCopies(g: Game): void {
  for (const s of g.ships) {
    const st = s.stepper;
    if (!st?.copy || !s.alive) continue;
    const o = s.summonOwner;
    if (g.over || !o?.alive || o.withdrawn || !g.ships.includes(o) || g.time >= st.until) {
      s.withdraw();
      continue;
    }
    s.control = { ...o.control, slot: o.control.slot ?? o.slot, skill: -1, consumable: -1 };
    s.control.targetId = o.control.targetId;
    s.throttle = o.throttle;
  }
}
export function mirrorStep(s: Ship, index: number, origin: { x: number; z: number; aimX: number; aimZ: number }): void {
  if (!s.stepper || s.stepper.copy || index === 8) return;
  for (const id of s.stepper.copies) {
    const c = s.game.ships.find((o) => o.id === id);
    if (!c?.alive) continue;
    c.control = { ...s.control, slot: s.slot, skill: -1, consumable: -1 };
    c.stepper!.mirrorAim = { ...origin, landingX: s.pos.x, landingZ: s.pos.z };
    c.activateSkill(index, true);
    c.stepper!.mirrorAim = null;
  }
}
