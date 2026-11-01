import { MAP_HALF } from '../config';
import { AIController } from '../ai/AIController';
import { randomOf, type Group } from '../core/BattleSetup';
import type { Game } from '../core/Game';
import { bearingTo, pick } from '../core/math';
import type { PickupKind } from '../core/Pickups';
import type { Era, ShipSpec, Team } from '../core/types';
import { configEras } from '../data/eras';
import { SHIP_BY_ID, bossesOf } from '../data/ships';
import type { Ship } from '../ships/Ship';
import { copyLoadout } from '../data/architectLoadout';
import { setArchitectLoadout } from '../skills/misc/ArchitectRuntime';
import { findOpenWater } from '../world/openWater';
import { AFFIXES, AFFIX_LABEL, MAX_ALIVE, RUSH_WAVES, isBossWave, isTitanSlot, rushKnobs, rushRecordKey, tableSlots, waveScale, type Affix, type RushDifficulty, type RushKnobs, type Slot, type WaveScale } from './RushDifficulty';

// Boss Rush: the player holds the middle of the map against escalating waves, with a titan
// every fifth wave (every `bossEvery` on other difficulties, see RushDifficulty). Between waves: a
// repair, then one of three stacking refit upgrades. Survival is the same fight without titans and
// without an end: how many waves can you last?

export { RUSH_WAVES };
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
/** Fisher–Yates in place, drawing from the battle's rng. */
function shuffle<T>(a: T[], rng: () => number): T[] {
  for (let k = a.length - 1; k > 0; k--) {
    const j = Math.floor(rng() * (k + 1));
    [a[k], a[j]] = [a[j], a[k]];
  }
  return a;
}

/** A boss titan's ultimate damage and normal-skill cooldowns: the titan-only kits hit harder than the old ones did. */
const BOSS_ULT_DAMAGE = 0.55;
const BOSS_COOLDOWN = 1.3;
/** A boss titan's hit points, against a player titan's. */
const BOSS_HP = 0.4;
/** Undo the player-titan gun buff (reload ×0.75, shell damage ×1.25) on a boss. */
const BOSS_GUNS = { reload: 1 / 0.75, damage: 0.8 };

/** The line ships extras and endless waves are drawn from. */
const POOL: Group[] = ['BB', 'BB', 'cruiser', 'cruiser', 'DD', 'DD', 'SS', 'CV'];

/** What each elite affix does to the ship that carries it (Warded also arrives behind a shield). */
const ELITE: Record<Affix, (m: Ship['mods']) => void> = {
  armored: (m) => {
    m.damageTakenMul *= 0.7;
  },
  swift: (m) => {
    m.speedMul *= 1.25;
    m.turnMul *= 1.3;
  },
  gunner: (m) => {
    m.reloadMul *= 0.75;
    m.dispersionMul *= 0.8;
  },
  warded: (m) => {
    m.fireDurationMul *= 0.5;
  },
};
/** A Warded elite's shield, in its max HP. */
const WARD = 0.25;

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
  /** Several eras: how many titans the round-robin order has dealt. */
  private titansSent = 0;
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
  /** The difficulty's knobs (Normal when the battle sets none). */
  readonly knobs: RushKnobs;
  /** Ships of the current wave held back while MAX_ALIVE enemies are afloat. */
  queue: Slot[] = [];
  /** Seconds until the next reinforcement group may sail. */
  reinforce = 0;
  /** How hard the current wave hits (its reinforcements too). */
  private scale: WaveScale;

  constructor(
    private game: Game,
    /** Survival: no titans, no final wave. */
    readonly survival = false,
  ) {
    this.knobs = rushKnobs(game.config.rush);
    this.scale = waveScale(1, this.knobs);
  }

  /** Spawn the player (and escorts) in open water at the centre. */
  start(): void {
    const g = this.game;
    const cfg = g.config.players[0];
    const spec = SHIP_BY_ID[cfg?.shipId ?? 'yamato'] ?? SHIP_BY_ID.yamato;
    const spot = this.centre();
    const player = g.addShip(spec, 0, 'P1', spot.x, spot.z, Math.PI / 2);
    player.humanIndex = cfg ? 0 : -1;
    setArchitectLoadout(player, copyLoadout(cfg?.architectLoadout));
    player.throttle = 4;
    g.fleet.push(player);
    if (player.humanIndex < 0) g.ai.set(player, new AIController(player, g));
    this.player = player;
    const escorts = g.config.escorts ?? 2;
    const groups: Group[] = ['cruiser', 'DD'];
    for (let i = 0; i < escorts; i++) {
      const p = player.localToWorld(-250, 0, (i % 2 ? 1 : -1) * 300);
      const s = g.addShip(randomOf(groups[i % 2], g.rng, configEras(g.config)), 0, `Escort ${i + 1}`, p.x, p.z, player.heading);
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
   * Titan Shift forms). Several eras (Mixed among them) take turns, see `dealt`.
   */
  private titan(i: number): ShipSpec {
    const eras = configEras(this.game.config);
    if (eras.length > 1) return this.dealt(eras);
    if (!this.titanOrder) this.titanOrder = this.shuffled(eras[0]);
    return this.titanOrder[i % this.titanOrder.length];
  }

  /** An era's bosses in the order it sends them: historic as listed, the others shuffled once. */
  private shuffled(era: Era): ShipSpec[] {
    const order = [...bossesOf(era)];
    if (era !== 'historic') shuffle(order, this.game.rng);
    return order;
  }

  /**
   * Several eras: each era's bosses in its own order, the eras themselves in a shuffled turn, dealt
   * one era at a time. No boss comes twice until every one of them has sailed.
   */
  private dealt(eras: Era[]): ShipSpec {
    if (!this.titanOrder) {
      const lists = shuffle(eras.map((e) => this.shuffled(e)).filter((l) => l.length), this.game.rng);
      const order: ShipSpec[] = [];
      for (let k = 0; lists.some((l) => k < l.length); k++) for (const l of lists) if (k < l.length) order.push(l[k]);
      this.titanOrder = order;
    }
    return this.titanOrder[this.titansSent++ % this.titanOrder.length];
  }

  get isBossWave(): boolean {
    return !this.survival && isBossWave(this.wave, this.knobs);
  }

  /** What the next wave brings, for the intermission card. */
  get next(): { wave: number; ships: number; titans: number; elites: boolean } {
    const n = this.wave + 1;
    const k = this.knobs;
    const sc = waveScale(n, k);
    const boss = !this.survival && isBossWave(n, k);
    return { wave: n, ships: n <= RUSH_WAVES ? tableSlots(n, k, boss).length + k.extraShips : sc.ships, titans: boss ? sc.titans : 0, elites: sc.elite > 0 };
  }

  /**
   * The slots of wave `n`: waves 1..15 from the table plus the difficulty's extras, endless waves
   * rolled at random. Survival never sends a titan.
   */
  private composition(n: number): Slot[] {
    const k = this.knobs;
    const rng = this.game.rng;
    const boss = !this.survival && isBossWave(n, k);
    if (n <= RUSH_WAVES) {
      const out = tableSlots(n, k, boss);
      for (let i = 0; i < k.extraShips; i++) out.push(pick(POOL, rng));
      return out;
    }
    const sc = waveScale(n, k);
    const out: Slot[] = [];
    if (boss) {
      const first = Math.floor(rng() * bossesOf(configEras(this.game.config)).length);
      for (let t = 0; t < sc.titans; t++) out.push(`titan:${first + t}`);
    }
    while (out.length < sc.ships) out.push(pick(POOL, rng));
    return out;
  }

  /** Enemies arrive from the side of the map away from the player, out of sight. */
  private awayAngle(): number {
    const p = this.player!;
    return Math.atan2(-p.pos.z, -p.pos.x) + (this.game.rng() - 0.5) * Math.PI * 0.8;
  }

  /** `n` affixes, all different, for an elite. */
  private affixes(n: number): Affix[] {
    const pool = [...AFFIXES];
    const out: Affix[] = [];
    while (out.length < n && pool.length) out.push(pool.splice(Math.floor(this.game.rng() * pool.length), 1)[0]);
    return out;
  }

  private spawnWave(): void {
    const g = this.game;
    this.wave++;
    const player = this.player!;
    const away = this.awayAngle();
    const slots = this.composition(this.wave);
    this.scale = waveScale(this.wave, this.knobs);
    this.boss = null;
    // A wave bigger than MAX_ALIVE holds the rest back as reinforcements.
    this.queue = slots.slice(MAX_ALIVE);
    this.reinforce = this.knobs.stagger;
    this.spawnGroup(slots.slice(0, MAX_ALIVE), away);
    this.enemiesLeft = slots.length;
    if (this.waveShield > 0 && player.alive) player.addShield(player.maxHp * this.waveShield, 30);
    this.phase = 'fight';
    g.events.emit('wave', { wave: this.wave, boss: this.boss });
  }

  /** Send `room` more of the wave's held-back ships. */
  private reinforcements(room: number): void {
    const group = this.queue.splice(0, room);
    this.spawnGroup(group, this.awayAngle());
    this.reinforce = this.knobs.stagger;
    this.game.events.emit('reinforcements', { wave: this.wave, count: group.length, left: this.queue.length });
  }

  private spawnGroup(slots: Slot[], away: number): void {
    const g = this.game;
    const player = this.player!;
    const { hp: hpMul, dmg: dmgMul, elite, affixes } = this.scale;
    slots.forEach((slot, i) => {
      const spec: ShipSpec = isTitanSlot(slot) ? this.titan(Number(slot.slice(6))) : randomOf(slot, g.rng, configEras(g.config));
      const a = away + (i - (slots.length - 1) / 2) * 0.12;
      const r = MAP_HALF * 0.82;
      const pos = findOpenWater(this.game.map, Math.cos(a) * r, Math.sin(a) * r);
      const heading = bearingTo(pos.x, pos.z, player.pos.x, player.pos.z);
      const titan = spec.cls === 'TT';
      // Late endless waves sail elites: a line ship with one or two affixes in its name.
      const traits = !titan && elite > 0 && g.rng() < elite ? this.affixes(affixes) : [];
      const name = titan ? spec.name.toUpperCase() : [...traits.map((t) => AFFIX_LABEL[t]), spec.name].join(' ');
      const s = g.addShip(spec, 1 as Team, name, pos.x, pos.z, heading);
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
      for (const t of traits) s.addEffect({ id: `refit:elite:${t}`, time: Infinity, apply: ELITE[t] });
      if (traits.includes('warded')) s.addShield(s.maxHp * WARD, Infinity);
      g.fleet.push(s);
      const ai = new AIController(s, g);
      ai.hunt = player;
      g.ai.set(s, ai);
      if (titan && !this.boss) this.boss = s;
    });
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
      const afloat = g.ships.filter((s) => s.alive && s.team === 1 && !s.isSummon);
      this.enemiesLeft = afloat.length + this.queue.length;
      if (this.queue.length) {
        this.reinforce -= dt;
        if (this.reinforce <= 0 && afloat.length < MAX_ALIVE) this.reinforcements(MAX_ALIVE - afloat.length);
      }
      // The boss bar follows the wave's next titan when the first one sinks.
      if (this.boss && !this.boss.alive) this.boss = afloat.find((s) => s.spec.cls === 'TT') ?? this.boss;
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

/** Where a difficulty's records live: Normal keeps the keys from before difficulties existed. */
function recordKey(survival: boolean, d?: RushDifficulty): string {
  const base = survival ? SURVIVAL_KEY : BEST_KEY;
  const k = rushRecordKey(d);
  return k === 'normal' ? base : `${base}:${k}`;
}

export interface RushBest {
  wave: number;
  score: number;
}

/** Best run per ship id at a difficulty, from local storage (empty when storage is unavailable). */
export function loadBest(survival = false, d?: RushDifficulty): Record<string, RushBest> {
  try {
    return JSON.parse(localStorage.getItem(recordKey(survival, d)) ?? '{}') as Record<string, RushBest>;
  } catch {
    return {};
  }
}

/** Record a run; returns true when it beat the ship's previous best score. */
export function saveBest(shipId: string, wave: number, score: number, survival = false, d?: RushDifficulty): boolean {
  const all = loadBest(survival, d);
  const prev = all[shipId];
  if (prev && prev.score >= score) return false;
  all[shipId] = { wave: Math.max(wave, prev?.wave ?? 0), score };
  try {
    localStorage.setItem(recordKey(survival, d), JSON.stringify(all));
  } catch {
    // Storage blocked (private window): the run still counts on screen.
  }
  return true;
}
