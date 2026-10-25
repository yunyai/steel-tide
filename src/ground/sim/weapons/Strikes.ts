import type { SkillSpec } from '../../../core/types';
import type { GroundGame } from '../GroundGame';
import type { Vehicle } from '../Vehicle';

// Telegraphed blasts: a marker on the ground, then whatever was ordered comes down on it after the
// delay (barrage shells, satchel charges, bombs, rods, an 800 mm shell). The view draws the warning
// circle and the fall from `kind`.

export type StrikeKind = 'shell' | 'satchel' | 'rocket' | 'bomb' | 'rod' | 'missile' | 'gustav' | 'meteor' | 'spell';

export interface StrikeInit {
  owner: Vehicle;
  x: number;
  z: number;
  r: number;
  delay: number;
  damage: number;
  skill: SkillSpec | null;
  kind: StrikeKind;
  color?: number;
  /** Damage to props as a share of `damage` (default 1). */
  props?: number;
  stun?: number;
  /** Outward shove (m/s) at the centre. */
  knock?: number;
  /** Leaves fire behind: radius share, seconds and damage a second. */
  fire?: { life: number; dps: number };
  /** Ignores armour entirely (most do; shells may not). */
  onHit?: (v: Vehicle) => void;
  /** Leaves a crater this deep in the ground. */
  crater?: number;
}

export interface Strike extends StrikeInit {
  id: number;
  t: number;
  y: number;
  done: boolean;
}

export class Strikes {
  list: Strike[] = [];
  private nextId = 1;

  constructor(private g: GroundGame) {}

  add(init: StrikeInit): Strike {
    const s: Strike = { ...init, id: this.nextId++, t: 0, y: this.g.terrain.surfaceAt(init.x, init.z), done: false };
    this.list.push(s);
    this.g.events.emit('strike', { strike: s });
    return s;
  }

  update(dt: number): void {
    const g = this.g;
    for (const s of this.list) {
      s.t += dt;
      if (s.done || s.t < s.delay) continue;
      s.done = true;
      s.y = g.terrain.surfaceAt(s.x, s.z);
      g.events.emit('strikeHit', { strike: s });
      const hit = g.blast(s.owner, s.x, s.y, s.z, s.r, s.damage, { skill: s.skill, props: s.props ?? 1, stun: s.stun, knock: s.knock, flat: true });
      if (s.onHit) for (const v of hit) s.onHit(v);
      if (s.fire) g.fields.add({ owner: s.owner, x: s.x, z: s.z, r: s.r * 0.8, life: s.fire.life, enemyDps: s.fire.dps, color: 0xff7a2a, skill: s.skill, fire: true });
      if (s.crater) g.crater(s.x, s.z, s.r * 0.5, s.crater);
    }
    if (this.list.some((s) => s.done)) this.list = this.list.filter((s) => !s.done);
  }
}
