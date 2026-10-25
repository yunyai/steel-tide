import { MAP_HALF } from '../config';
import { AIController } from '../ai/AIController';
import { randomOf, type Group } from '../core/BattleSetup';
import type { Game } from '../core/Game';
import { bearingTo, pick } from '../core/math';
import type { PickupKind } from '../core/Pickups';
import type { ShipSpec, Team } from '../core/types';
import { SHIP_BY_ID, bossesOf } from '../data/ships';
import type { Ship } from '../ships/Ship';

// Boss Rush: the player holds the middle of the map against escalating waves, with a titan
// every fifth wave. Between waves: a repair, then one of three stacking refit upgrades.
// Survival is the same fight without titans and without an end: how many waves can you last?

export const RUSH_WAVES = 15;
/** Seconds of the intermission card choice before one is picked automatically. */
export const OFFER_TIME = 12;
/** Countdown between choosing an upgrade and the next wave arriving. */
const WARMUP = 4;
/** Kills this close together build the combo. */
const COMBO_WINDOW = 6;
/** Ultimate charge rate of a boss titan. */
const BOSS_ULT_CHARGE = 0.7;
/** Ultimate charge rate of the ships of a wave, which also arrive with their meters empty. */
const WAVE_ULT_CHARGE = 0.5;
/** Skill cooldowns of the ships of a wave: they all hunt the one player, so they pace themselves. */
const WAVE_COOLDOWN = 1.6;
/** A boss titan's ultimate damage and normal-skill cooldowns: the titan-only kits hit harder than the old ones did. */
const BOSS_ULT_DAMAGE = 0.55;
const BOSS_COOLDOWN = 1.3;
/** A boss titan's hit points, against a player titan's. */
const BOSS_HP = 0.4;
/** Undo the player-titan gun buff (reload ×0.75, shell damage ×1.25) on a boss. */
const BOSS_GUNS = { reload: 1 / 0.75, damage: 0.8 };

/** A titan of the battle's era: the first, second or third in its roster (any one past the end). */
type Slot = Group | `titan:${number}`;

/** Waves 1..15. Every fifth is a titan with escorts. */
const WAVES: Slot[][] = [
  ['DD', 'DD', 'DD'],
  ['DD', 'DD', 'cruiser', 'cruiser'],
  ['cruiser', 'cruiser', 'DD', 'SS'],
  ['BB', 'cruiser', 'DD', 'DD'],
  ['titan:0', 'DD', 'DD'],
  ['BB', 'BB', 'DD', 'DD'],
  ['CV', 'cruiser', 'cruiser', 'DD', 'SS'],
  ['BB', 'BB', 'cruiser', 'DD', 'DD'],
  ['BB', 'cruiser', 'cruiser', 'cruiser', 'DD', 'DD'],
  ['titan:1', 'cruiser', 'DD', 'DD'],
  ['BB', 'BB', 'BB', 'DD', 'DD'],
  ['BB', 'BB', 'CV', 'cruiser', 'DD', 'SS'],
  ['BB', 'BB', 'cruiser', 'cruiser', 'DD', 'DD', 'SS'],
  ['BB', 'BB', 'BB', 'cruiser', 'cruiser', 'DD', 'DD'],
  ['titan:2', 'BB', 'cruiser', 'DD', 'DD'],
];

export interface Upgrade {
  id: string;
  name: string;
  description: string;
  /** Applied once per pick; picks stack. */
  apply(ship: Ship, rush: BossRush): void;
}

/** A permanent buff (refits never wear off and survive a cleanse). */
function forever(ship: Ship, id: string, apply: (m: Ship['mods']) => void): void {
  ship.addEffect({ id: `refit:${id}:${ship.effects.filter((e) => e.id.startsWith(`refit:${id}:`)).length}`, time: Infinity, apply });
}

/** Shorthand for an upgrade that is just a permanent modifier. */
function refit(id: string, name: string, description: string, apply: (m: Ship['mods']) => void): Upgrade {
  return { id, name, description, apply: (s) => forever(s, id, apply) };
}

export const UPGRADES: Upgrade[] = [
  {
    id: 'hull',
    name: 'Reinforced hull',
    description: '+20% max HP.',
    apply(s) {
      s.maxHp *= 1.2;
      s.hp += s.maxHp * (0.2 / 1.2);
    },
  },
  refit('reload', 'Fast loaders', 'Main battery reloads 15% faster.', (m) => {
    m.reloadMul *= 0.85;
  }),
  refit('cooldown', 'Overclocked cores', 'Q and E cool down 20% faster.', (m) => {
    m.cooldownMul *= 0.8;
  }),
  refit('ultCharge', 'Capacitor bank', 'Ultimate charges 30% faster.', (m) => {
    m.ultChargeMul *= 1.3;
  }),
  refit('damage', 'Super-heavy shells', '+15% damage from every weapon and skill.', (m) => {
    m.damageMul *= 1.15;
  }),
  refit('dispersion', 'Fire director', 'Shell dispersion 25% tighter.', (m) => {
    m.dispersionMul *= 0.75;
  }),
  refit('speed', 'Turbine refit', '+12% speed and 15% sharper turns.', (m) => {
    m.speedMul *= 1.12;
    m.turnMul *= 1.15;
  }),
  refit('lifesteal', 'Salvage crews', '3% of damage dealt is repaired.', (m) => {
    m.lifesteal += 0.03;
  }),
  refit('fireproof', 'Fire suppression', 'Fires and flooding on you last 40% less.', (m) => {
    m.fireDurationMul *= 0.6;
  }),
  refit('ultDamage', 'Overcharged ultimate', 'Ultimate damage +30%.', (m) => {
    m.ultDamageMul *= 1.3;
  }),
  {
    id: 'chain',
    name: 'Chain reaction',
    description: 'Ships you sink explode for 20k around them.',
    apply(_s, r) {
      r.chainBlast += 20000;
    },
  },
  {
    id: 'waveShield',
    name: 'Wave barrier',
    description: 'Each wave starts with a shield of 15% max HP.',
    apply(_s, r) {
      r.waveShield += 0.15;
    },
  },
  {
    id: 'drops',
    name: 'Scavenger',
    description: 'Wrecks drop supply crates 20% more often.',
    apply(_s, r) {
      r.dropBonus += 0.2;
    },
  },
  {
    id: 'repair',
    name: 'Extra repair kit',
    description: '+1 Repair kit charge.',
    apply(s) {
      const kit = s.consumables[0];
      if (!kit) return;
      kit.spec = { ...kit.spec, charges: kit.spec.charges + 1 };
      kit.charges++;
    },
  },
];

export type RushPhase = 'warmup' | 'fight' | 'offer';

export class BossRush {
  wave = 0;
  phase: RushPhase = 'warmup';
  /** Seconds left in the warm-up countdown or the card choice. */
  timer = WARMUP;
  /** Upgrades on offer during the intermission. */
  offer: Upgrade[] = [];
  /** Ids of every upgrade taken, in order. */
  taken: string[] = [];
  /** The titan of the current wave (alive or not), for the boss bar. */
  boss: Ship | null = null;
  /** The order the battle's titans arrive in, settled at the first boss wave. */
  private titanOrder: ShipSpec[] | null = null;
  player: Ship | null = null;
  /** Wave 15 is behind us: the run is a win whatever happens next. */
  cleared = false;
  score = 0;
  combo = 0;
  /** Sim time of the player's last kill (the combo window runs from it). */
  lastKillTime = -1e9;
  enemiesLeft = 0;
  // Stacking refit effects that live on the director rather than the ship.
  chainBlast = 0;
  waveShield = 0;
  dropBonus = 0;

  constructor(
    private game: Game,
    /** Survival: no titans, no final wave. */
    readonly survival = false,
  ) {}

  /** Spawn the player (and escorts) in open water at the centre. */
  start(): void {
    const g = this.game;
    const cfg = g.config.players[0];
    const spec = SHIP_BY_ID[cfg?.shipId ?? 'yamato'] ?? SHIP_BY_ID.yamato;
    const spot = this.centre();
    const player = g.addShip(spec, 0, 'P1', spot.x, spot.z, Math.PI / 2);
    player.humanIndex = cfg ? 0 : -1;
    player.throttle = 4;
    g.fleet.push(player);
    if (player.humanIndex < 0) g.ai.set(player, new AIController(player, g));
    this.player = player;
    const escorts = g.config.escorts ?? 2;
    const groups: Group[] = ['cruiser', 'DD'];
    for (let i = 0; i < escorts; i++) {
      const p = player.localToWorld(-250, 0, (i % 2 ? 1 : -1) * 300);
      const s = g.addShip(randomOf(groups[i % 2], g.rng, g.config.era), 0, `Escort ${i + 1}`, p.x, p.z, player.heading);
      s.throttle = 4;
      g.fleet.push(s);
      const ai = new AIController(s, g);
      ai.leader = player;
      g.ai.set(s, ai);
    }
    this.phase = 'warmup';
    this.timer = WARMUP;
  }

  /** The best open water near the middle of the map. */
  private centre(): { x: number; z: number } {
    const map = this.game.map;
    const clear = (x: number, z: number) => {
      for (let a = 0; a < 8; a++) {
        if (map.heightAt(x + Math.cos(a) * 400, z + Math.sin(a) * 400) > -8) return false;
      }
      return map.heightAt(x, z) < -10;
    };
    for (let r = 0; r < 3000; r += 150) {
      for (let a = 0; a < 12; a++) {
        const x = Math.cos((a / 12) * Math.PI * 2) * r;
        const z = Math.sin((a / 12) * Math.PI * 2) * r;
        if (clear(x, z)) return { x, z };
      }
    }
    return { x: 0, z: 0 };
  }

  /**
   * Titan `i` of the battle's era. Historic sends its three in order; the newer eras shuffle their
   * four once per battle, so the three boss waves bring three different titans (anime sends its
   * Titan Shift forms); Mixed draws from every era.
   */
  private titan(i: number): ShipSpec {
    const era = this.game.config.era ?? 'historic';
    const list = bossesOf(era);
    if (era === 'mixed') return pick(list, this.game.rng);
    if (!this.titanOrder) {
      const order = [...list];
      if (era !== 'historic') {
        for (let k = order.length - 1; k > 0; k--) {
          const j = Math.floor(this.game.rng() * (k + 1));
          [order[k], order[j]] = [order[j], order[k]];
        }
      }
      this.titanOrder = order;
    }
    return this.titanOrder[i % this.titanOrder.length];
  }

  get isBossWave(): boolean {
    return !this.survival && this.wave > 0 && this.wave % 5 === 0;
  }

  /** The slots of wave `n` (endless waves past 15 are rolled at random). Survival trades each titan for a battleship and a cruiser. */
  private composition(n: number): Slot[] {
    if (this.survival) return this.rolled(n).flatMap((s): Slot[] => (s.startsWith('titan:') ? ['BB', 'cruiser'] : [s]));
    return this.rolled(n);
  }

  private rolled(n: number): Slot[] {
    if (n <= RUSH_WAVES) return WAVES[n - 1];
    const rng = this.game.rng;
    const count = Math.min(9, 5 + Math.floor((n - RUSH_WAVES) / 2));
    const pool: Group[] = ['BB', 'BB', 'cruiser', 'cruiser', 'DD', 'DD', 'SS', 'CV'];
    const out: Slot[] = [];
    if (n % 5 === 0) out.push(`titan:${Math.floor(rng() * bossesOf(this.game.config.era ?? 'historic').length)}`);
    while (out.length < count) out.push(pick(pool, rng));
    return out;
  }

  private spawnWave(): void {
    const g = this.game;
    this.wave++;
    const player = this.player!;
    // Enemies arrive from the side of the map away from the player, out of sight.
    const away = Math.atan2(-player.pos.z, -player.pos.x) + (g.rng() - 0.5) * Math.PI * 0.8;
    const slots = this.composition(this.wave);
    const hpMul = 1 + 0.06 * (this.wave - 1);
    const dmgMul = 1 + 0.04 * (this.wave - 1);
    this.boss = null;
    slots.forEach((slot, i) => {
      const spec: ShipSpec = slot.startsWith('titan:') ? this.titan(Number(slot.slice(6))) : randomOf(slot as Group, g.rng, g.config.era);
      const a = away + (i - (slots.length - 1) / 2) * 0.12;
      const r = MAP_HALF * 0.82;
      const pos = this.openWater(Math.cos(a) * r, Math.sin(a) * r);
      const heading = bearingTo(pos.x, pos.z, player.pos.x, player.pos.z);
      const s = g.addShip(spec, 1 as Team, spec.cls === 'TT' ? spec.name.toUpperCase() : spec.name, pos.x, pos.z, heading);
      const titan = spec.cls === 'TT';
      // A boss titan fights at the strength titans had before the player-titan buff: 40% of the
      // hit points, no Colossus passive, and the old reload and shell damage.
      if (titan) s.colossus = false;
      s.maxHp = s.hp = Math.round(s.maxHp * hpMul * (titan ? BOSS_HP : 1));
      s.throttle = 6;
      s.speed = s.maxSpeed * 0.6;
      if (!titan) s.meter = 0;
      s.addEffect({
        id: 'refit:wave',
        time: Infinity,
        apply(m) {
          m.damageMul *= dmgMul;
          // Damage sticks: a wave never patches itself up while you deal with the rest of it.
          m.regenMul = 0;
          if (!titan) {
            m.ultChargeMul *= WAVE_ULT_CHARGE;
            m.cooldownMul *= WAVE_COOLDOWN;
            return;
          }
          m.damageMul *= BOSS_GUNS.damage;
          m.reloadMul *= BOSS_GUNS.reload;
          // Three ultimates each on a full timer would bury the player; a boss titan fills them slower.
          m.ultChargeMul *= BOSS_ULT_CHARGE;
          m.ultDamageMul *= BOSS_ULT_DAMAGE;
          m.cooldownMul *= BOSS_COOLDOWN;
        },
      });
      g.fleet.push(s);
      const ai = new AIController(s, g);
      ai.hunt = player;
      g.ai.set(s, ai);
      if (spec.cls === 'TT') this.boss = s;
    });
    if (this.waveShield > 0 && player.alive) player.addShield(player.maxHp * this.waveShield, 30);
    this.phase = 'fight';
    g.events.emit('wave', { wave: this.wave, boss: this.boss });
  }

  private openWater(x: number, z: number): { x: number; z: number } {
    const map = this.game.map;
    for (let i = 0; i < 24; i++) {
      // Spiral inward until there is deep water around the hull.
      const k = 1 - i * 0.03;
      const a = i * 0.7;
      const px = x * k + Math.cos(a) * i * 40;
      const pz = z * k + Math.sin(a) * i * 40;
      if (map.heightAt(px, pz) < -12 && map.heightAt(px + 200, pz) < -6 && map.heightAt(px - 200, pz) < -6) return { x: px, z: pz };
    }
    return { x: x * 0.7, z: z * 0.7 };
  }

  /** Three different upgrades for the intermission. */
  private roll(): Upgrade[] {
    const pool = [...UPGRADES];
    const out: Upgrade[] = [];
    while (out.length < 3 && pool.length) out.push(pool.splice(Math.floor(this.game.rng() * pool.length), 1)[0]);
    return out;
  }

  /** Take card `i` of the current offer. */
  choose(i: number): boolean {
    if (this.phase !== 'offer') return false;
    const u = this.offer[i];
    if (!u || !this.player) return false;
    u.apply(this.player, this);
    this.taken.push(u.id);
    this.offer = [];
    this.phase = 'warmup';
    this.timer = WARMUP;
    this.game.events.emit('upgrade', { id: u.id });
    return true;
  }

  private waveCleared(): void {
    const g = this.game;
    const p = this.player!;
    this.score += 5000 * this.wave;
    if (this.wave === RUSH_WAVES && !this.survival) this.cleared = true;
    g.events.emit('waveClear', { wave: this.wave, cleared: this.cleared && this.wave === RUSH_WAVES });
    // Refit between waves: patch the hull, a spare repair kit, some ultimate charge.
    for (const s of g.ships) {
      if (!s.alive || s.team !== p.team) continue;
      s.heal(s.maxHp * 0.35);
      s.extinguish();
    }
    const kit = p.consumables[0];
    if (kit) kit.charges = Math.min(kit.spec.charges, kit.charges + 1);
    p.boostUlts(0.25);
    this.offer = this.roll();
    this.phase = 'offer';
    this.timer = OFFER_TIME;
  }

  update(dt: number): void {
    const g = this.game;
    if (g.over) return;
    if (this.phase === 'fight') {
      this.enemiesLeft = g.ships.filter((s) => s.alive && s.team === 1 && !s.isSummon).length;
      if (this.enemiesLeft === 0) this.waveCleared();
      return;
    }
    this.timer -= dt;
    if (this.timer > 0) return;
    if (this.phase === 'offer') this.choose(0);
    else this.spawnWave();
  }

  onSunk(ship: Ship, killer: Ship | null): void {
    const g = this.game;
    if (ship.team !== 1 || ship.isSummon) return;
    const p = this.player;
    // Wrecks may leave a crate; a titan leaves three.
    const drops = ship.spec.cls === 'TT' ? 3 : g.rng() < 0.35 + this.dropBonus ? 1 : 0;
    const kinds: PickupKind[] = ['repair', 'overcharge', 'reset', 'fury'];
    for (let i = 0; i < drops; i++) {
      const a = (i / Math.max(1, drops)) * Math.PI * 2;
      g.pickups.spawn(i === 0 && ship.spec.cls === 'TT' ? 'repair' : pick(kinds, g.rng), ship.pos.x + Math.cos(a) * 120, ship.pos.z + Math.sin(a) * 120);
    }
    if (!p || killer !== p) return;
    // Kills in quick succession build a combo multiplier.
    this.combo = g.time - this.lastKillTime < COMBO_WINDOW ? this.combo + 1 : 1;
    this.lastKillTime = g.time;
    const mul = 1 + 0.5 * (Math.min(this.combo, 7) - 1);
    this.score += Math.round(1000 * this.wave * mul);
    if (ship.spec.cls === 'TT') this.score += 25000 * Math.ceil(this.wave / 5);
    if (this.chainBlast > 0) {
      g.strikes.spawn(p, { kind: 'mortar', skill: null, x: ship.pos.x, z: ship.pos.z, radius: 260, delay: 0.2, damage: this.chainBlast, fire: 0.5 });
    }
  }

  /** The run ends when the player sinks: a win if wave 15 was cleared (Survival is always a last stand). */
  checkVictory(): void {
    const p = this.player;
    if (!p || p.alive) return;
    const held = Math.max(0, this.wave - 1);
    if (this.survival) return this.game.finish(1, `Held out for ${held} wave${held === 1 ? '' : 's'}`);
    this.game.finish(this.cleared ? 0 : 1, this.cleared ? `Survived ${this.wave} waves` : `Fell on wave ${this.wave}`);
  }

  /** Score with the damage share included (for the live HUD). */
  get total(): number {
    return this.score + Math.round((this.player?.stats.damage ?? 0) / 10);
  }
}

const BEST_KEY = 'steel-tide:bossrush';
const SURVIVAL_KEY = 'steel-tide:survival';

export interface RushBest {
  wave: number;
  score: number;
}

/** Best run per ship id, from local storage (empty when storage is unavailable). */
export function loadBest(survival = false): Record<string, RushBest> {
  try {
    return JSON.parse(localStorage.getItem(survival ? SURVIVAL_KEY : BEST_KEY) ?? '{}') as Record<string, RushBest>;
  } catch {
    return {};
  }
}

/** Record a run; returns true when it beat the ship's previous best score. */
export function saveBest(shipId: string, wave: number, score: number, survival = false): boolean {
  const all = loadBest(survival);
  const prev = all[shipId];
  if (prev && prev.score >= score) return false;
  all[shipId] = { wave: Math.max(wave, prev?.wave ?? 0), score };
  try {
    localStorage.setItem(survival ? SURVIVAL_KEY : BEST_KEY, JSON.stringify(all));
  } catch {
    // Storage blocked (private window): the run still counts on screen.
  }
  return true;
}
