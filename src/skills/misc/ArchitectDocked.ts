import { ARCHETYPES, type ArchitectType } from '../../data/architectLoadout';
import type { Mods, Ship } from '../../ships/Ship';
import type { SkillSpec } from '../../core/types';
import { canTrack } from '../../core/Targeting';
import { buff } from '../kit';

// Docked passives: every platform sitting whole on its dock lends the hull its type's passive.
// Shell passives ride on the shells a docked gun fires (the type is read at the muzzle, so a
// platform that launches while its shells are in flight still delivers them); hull passives count
// the docked platforms of a type, each up to its cap.

export const DOCKED = {
  kindling: { dps: 3000, time: 3 },
  rime: { speed: 0.1, traverse: 0.15, time: 3 },
  arc: { share: 0.25, range: 600 },
  massDriver: { velocity: 1.3, reach: 1.2 },
  /** Shell damage, and the total against a shielded target. */
  lens: { damage: 1.25, shield: 1.5 },
  watch: { surface: 4000, periscope: 2000, extra: 1000, cap: 6000 },
  sonar: { range: 2500, torp: 0.1, torpCap: 0.3 },
  fieldRepair: { perSecond: 0.001, cap: 0.003 },
  plating: { dr: 0.04, cap: 0.16 },
  harmonic: { reload: 0.1, cap: 0.4 },
  flak: { range: 1500, every: 3 },
  vanes: { speed: 0.03, rudder: 0.1, dash: 0.1 },
} as const;

/** A reveal lapses this long after the passive stops renewing it. */
const REVEAL_HOLD = 0.5;

/** The slot's type while its platform sits whole on its dock, else null. */
export function dockedType(s: Ship, index: number): ArchitectType | null {
  const slot = s.architect?.slots[index];
  return slot && slot.state === 'docked' && slot.hp > 0 ? slot.type : null;
}

export function dockedCount(s: Ship, type: ArchitectType): number {
  let n = 0;
  for (const v of s.architect?.slots ?? []) if (v.type === type && v.state === 'docked' && v.hp > 0) n++;
  return n;
}

/** Plating, Sonar Net's torpedo screen and Thrust Vanes, on the hull's modifiers. */
export function applyDockedPassives(s: Ship, m: Mods): void {
  if (!s.architect) return;
  const bastion = dockedCount(s, 'bastion'), abyss = dockedCount(s, 'abyss'), vector = dockedCount(s, 'vector');
  if (bastion) m.damageTakenMul *= 1 - Math.min(DOCKED.plating.cap, DOCKED.plating.dr * bastion);
  if (abyss) m.torpTakenMul *= 1 - Math.min(DOCKED.sonar.torpCap, DOCKED.sonar.torp * abyss);
  if (vector) {
    m.speedMul *= 1 + DOCKED.vanes.speed * vector;
    m.rudderMul *= 1 + DOCKED.vanes.rudder * vector;
  }
}

/** Harmonic: how much faster docked Resonance makes this docked gun reload (1 for Resonance itself). */
export function harmonicTempo(s: Ship, type: ArchitectType): number {
  if (type === 'resonance') return 1;
  return 1 + Math.min(DOCKED.harmonic.cap, DOCKED.harmonic.reload * dockedCount(s, 'resonance'));
}

/** Thrust Vanes: Hull Dash recharges this much faster while any Vector is docked. */
export function vanesDashTempo(s: Ship): number {
  return dockedCount(s, 'vector') ? 1 + DOCKED.vanes.dash : 1;
}

/** Muzzle effects of a docked gun: shell damage, speed and how far a miss carries. */
export function dockedShot(type: ArchitectType | null): { damage: number; pace: number; reach: number } {
  if (type === 'prism') return { damage: DOCKED.lens.damage, pace: 1, reach: 1 };
  if (type === 'gravity') return { damage: 1, pace: DOCKED.massDriver.velocity, reach: DOCKED.massDriver.reach };
  return { damage: 1, pace: 1, reach: 1 };
}

/** Lens: the extra a docked Prism shell deals to a shielded target. */
export function dockedHitMul(type: ArchitectType, t: Ship): number {
  return type === 'prism' && t.shield > 0 ? DOCKED.lens.shield / DOCKED.lens.damage : 1;
}

function spec(s: Ship, type: ArchitectType, name: string): SkillSpec {
  return { ...s.skills[1].spec, id: `architect:docked:${type}`, name, short: name.toUpperCase(), element: ARCHETYPES[type].element, ult: false };
}

/** A docked gun's shell dealt `dealt` to `t`: Kindling, Rime and Arc. */
export function dockedHit(s: Ship, type: ArchitectType, t: Ship, dealt: number): void {
  const a = s.architect;
  if (!a || !s.alive) return;
  const g = s.game;
  if (type === 'furnace') {
    const until = g.time + DOCKED.kindling.time;
    const burn = a.kindling.find((k) => k.target === t.id);
    if (burn) burn.until = until;
    else a.kindling.push({ target: t.id, until });
  } else if (type === 'cryo') {
    buff(t, 'debuff:architectRime', DOCKED.rime.time, (m) => {
      m.speedMul *= 1 - DOCKED.rime.speed;
      m.traverseMul *= 1 - DOCKED.rime.traverse;
    });
  } else if (type === 'storm' && dealt > 0) {
    let best: Ship | null = null, dist: number = DOCKED.arc.range;
    for (const v of g.ships) {
      if (v === t || !v.alive || v.submerged || !canTrack(s, v)) continue;
      const d = Math.hypot(v.pos.x - t.pos.x, v.pos.z - t.pos.z);
      if (d <= dist) { best = v; dist = d; }
    }
    if (!best) return;
    best.takeDamage(dealt * DOCKED.arc.share, s, spec(s, type, 'Arc'));
    g.events.emit('lightning', { points: [{ x: t.pos.x, y: t.pos.y + 12, z: t.pos.z }, { x: best.pos.x, y: best.pos.y + 12, z: best.pos.z }], color: ARCHETYPES.storm.color, straight: true });
  }
}

/** Hull passives that act over time: Watch, Sonar Net, Field Repair, Flak Nest and Kindling burns. */
export function updateDockedPassives(s: Ship, dt: number): void {
  const a = s.architect;
  if (!a) return;
  const g = s.game;
  const sentinel = dockedCount(s, 'sentinel'), abyss = dockedCount(s, 'abyss');
  if (sentinel || abyss) {
    const extra = DOCKED.watch.extra * Math.max(0, sentinel - 1);
    const surface = sentinel ? Math.min(DOCKED.watch.cap, DOCKED.watch.surface + extra) : 0;
    const periscope = sentinel ? Math.min(DOCKED.watch.cap, DOCKED.watch.periscope + extra) : 0;
    const deep = abyss ? DOCKED.sonar.range : 0;
    for (const t of g.ships) {
      if (!t.alive || t.withdrawn || t.team === s.team || t.mods.banished) continue;
      const reach = t.deep ? deep : t.submerged ? periscope : t.mods.untargetable || g.inSmoke(t.pos.x, t.pos.z) ? surface : 0;
      if (reach && Math.hypot(t.pos.x - s.pos.x, t.pos.z - s.pos.z) <= reach) t.architectReveal[s.team] = Math.max(t.architectReveal[s.team], g.time + REVEAL_HOLD);
    }
  }
  const restoration = dockedCount(s, 'restoration');
  if (restoration && s.alive) s.heal(a.fullHp * Math.min(DOCKED.fieldRepair.cap, DOCKED.fieldRepair.perSecond * restoration) * dt * s.mods.regenMul);
  const swarm = dockedCount(s, 'swarm');
  if (swarm && s.alive && g.time >= a.flakReadyAt && flak(s, swarm)) a.flakReadyAt = g.time + DOCKED.flak.every;
  if (a.kindling.length) burn(s, dt);
}

/** Flak Nest: down up to `n` enemy missiles or planes near the hull, nearest first. */
function flak(s: Ship, n: number): boolean {
  const g = s.game, r2 = DOCKED.flak.range * DOCKED.flak.range;
  let downed = 0;
  for (let i = 0; i < n; i++) {
    let best = r2, kill: (() => void) | null = null, at = { x: 0, y: 0, z: 0 };
    const near = (x: number, z: number) => (x - s.pos.x) * (x - s.pos.x) + (z - s.pos.z) * (z - s.pos.z);
    for (const m of g.missiles.missiles) {
      if (!m.alive || m.delay > 0 || m.team === s.team || m.uninterceptable) continue;
      const d = near(m.x, m.z);
      if (d < best) { best = d; at = { x: m.x, y: m.y, z: m.z }; kill = () => { m.alive = false; }; }
    }
    for (const sq of g.air.squadrons) {
      if (!sq.alive || sq.team === s.team) continue;
      const d = near(sq.x, sq.z);
      if (d < best) { best = d; at = { x: sq.x, y: sq.y, z: sq.z }; kill = () => g.air.damage(sq, Math.max(1, sq.planeHp) * sq.armour); }
    }
    if (!kill) break;
    kill();
    downed++;
    g.events.emit('intercept', at);
  }
  return downed > 0;
}

/** Kindling: each marked target burns until its mark lapses; a dead or vanished one drops off. */
function burn(s: Ship, dt: number): void {
  const a = s.architect!, g = s.game;
  let spent: SkillSpec | null = null;
  a.kindling = a.kindling.filter((k) => {
    const t = g.ships.find((v) => v.id === k.target);
    if (!t?.alive || k.until <= g.time) return false;
    if (s.alive) t.takeDamage(DOCKED.kindling.dps * Math.min(dt, k.until - g.time) * s.mods.damageMul, s, (spent ??= spec(s, 'furnace', 'Kindling')), false, false, true);
    return t.alive;
  });
}
