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
//
// Co-op (a LAN lobby): every captain sails on the one fleet and picks their own card. A captain who
// sinks sails again when the wave is beaten; the run ends only when no captain is afloat.

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
/** Skill cooldowns of the ships of a wave: they all hunt the captains, so they pace themselves. */
const WAVE_COOLDOWN = 1.6;
/** Co-op: each captain past the first brings this many more ships to every wave... */
const COOP_SHIPS = 2;
/** ...and this much more hull on every enemy, titans included. */
const COOP_HP = 0.25;
/** Co-op: metres between captains on the starting line. */
const CAPTAIN_GAP = 350;
/** A captain sunk in a wave comes back at its clear with this much of their hull. */
const REVIVE_HP = 0.5;
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
  /** Applied once per pick to the captain's ship (or their share of the run); picks stack. */
  apply(ship: Ship, rush: BossRush): void;
}

/** One captain's share of the run: their own card choice and the refits that live off the ship. */
export interface Captain {
  ship: Ship;
  /** Cards on offer this intermission (empty once they have chosen). */
  offer: Upgrade[];
  /** Chose this intermission: the offer stays up until every captain has. */
  chosen: boolean;
  /** Ids of every upgrade taken, in order. */
  taken: string[];
  chainBlast: number;
  waveShield: number;
  dropBonus: number;
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
    apply(s, r) {
      const c = r.captainOf(s);
      if (c) c.chainBlast += 20000;
    },
  },
  {
    id: 'waveShield',
    name: 'Wave barrier',
    description: 'Each wave starts with a shield of 15% max HP.',
    apply(s, r) {
      const c = r.captainOf(s);
      if (c) c.waveShield += 0.15;
    },
  },
  {
    id: 'drops',
    name: 'Scavenger',
    description: 'Wrecks drop supply crates 20% more often.',
    apply(s, r) {
      const c = r.captainOf(s);
      if (c) c.dropBonus += 0.2;
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
  /** Every captain, in player order (one in a solo run). */
  captains: Captain[] = [];
  /** The titan of the current wave (alive or not), for the boss bar. */
  boss: Ship | null = null;
  /** The order the battle's titans arrive in, settled at the first boss wave. */
  private titanOrder: ShipSpec[] | null = null;
  /** Several eras: how many titans the round-robin order has dealt. */
  titansSent = 0;
  /** Which captain the next enemy to sail hunts, in turn. */
  huntTurn = 0;
  /** Wave 15 is behind us: the run is a win whatever happens next. */
  cleared = false;
  score = 0;
  combo = 0;
  /** Sim time of the captains' last kill (the combo window runs from it). */
  lastKillTime = -1e9;
  enemiesLeft = 0;
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

  /** The first captain's ship (the solo player). */
  get player(): Ship | null {
    return this.captains[0]?.ship ?? null;
  }

  /** The captain sailing `ship`, if any. */
  captainOf(ship: Ship | null): Captain | undefined {
    return ship ? this.captains.find((c) => c.ship === ship) : undefined;
  }

  /** Solo: the player's cards on offer. */
  get offer(): Upgrade[] {
    return this.captains[0]?.offer ?? [];
  }

  /** Solo: the player's upgrades taken, in order. */
  get taken(): string[] {
    return this.captains[0]?.taken ?? [];
  }

  /** The team's Scavenger picks together. */
  get dropBonus(): number {
    return this.captains.reduce((n, c) => n + c.dropBonus, 0);
  }

  /** Spawn the captains (and escorts) in open water at the centre, side by side. */
  start(): void {
    const g = this.game;
    const spot = this.centre();
    const players = g.config.players.length ? g.config.players : [undefined];
    players.forEach((cfg, i) => {
      const spec = SHIP_BY_ID[cfg?.shipId ?? 'yamato'] ?? SHIP_BY_ID.yamato;
      const at = players.length > 1 ? findOpenWater(g.map, spot.x, spot.z + (i - (players.length - 1) / 2) * CAPTAIN_GAP) : spot;
      const ship = g.addShip(spec, 0, cfg?.name ?? `P${i + 1}`, at.x, at.z, Math.PI / 2);
      ship.humanIndex = cfg ? i : -1;
      setArchitectLoadout(ship, copyLoadout(cfg?.architectLoadout));
      ship.throttle = 4;
      g.fleet.push(ship);
      if (ship.humanIndex < 0) g.ai.set(ship, new AIController(ship, g));
      this.captains.push({ ship, offer: [], chosen: false, taken: [], chainBlast: 0, waveShield: 0, dropBonus: 0 });
    });
    const player = this.player!;
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
    return { wave: n, ships: (n <= RUSH_WAVES ? tableSlots(n, k, boss).length + k.extraShips : sc.ships) + this.coopShips, titans: boss ? sc.titans : 0, elites: sc.elite > 0 };
  }

  /** Co-op: the extra ships every wave brings for the captains past the first. */
  private get coopShips(): number {
    return COOP_SHIPS * (this.captains.length - 1);
  }

  /** Captains still afloat, in player order. */
  private afloat(): Ship[] {
    return this.captains.filter((c) => c.ship.alive).map((c) => c.ship);
  }

  /** The captain still afloat nearest (x, z), or the first captain when none is. */
  private nearestCaptain(x: number, z: number): Ship {
    let best = this.player!;
    let d = Infinity;
    for (const s of this.afloat()) {
      const k = Math.hypot(s.pos.x - x, s.pos.z - z);
      if (k < d) [best, d] = [s, k];
    }
    return best;
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
      for (let i = 0; i < k.extraShips + this.coopShips; i++) out.push(pick(POOL, rng));
      return out;
    }
    const sc = waveScale(n, k);
    const out: Slot[] = [];
    if (boss) {
      const first = Math.floor(rng() * bossesOf(configEras(this.game.config)).length);
      for (let t = 0; t < sc.titans; t++) out.push(`titan:${first + t}`);
    }
    while (out.length < sc.ships + this.coopShips) out.push(pick(POOL, rng));
    return out;
  }

  /** Enemies arrive from the side of the map away from the captains, out of sight. */
  private awayAngle(): number {
    const ships = this.afloat().length ? this.afloat() : [this.player!];
    let x = 0;
    let z = 0;
    for (const s of ships) {
      x += s.pos.x / ships.length;
      z += s.pos.z / ships.length;
    }
    return Math.atan2(-z, -x) + (this.game.rng() - 0.5) * Math.PI * 0.8;
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
    const away = this.awayAngle();
    const slots = this.composition(this.wave);
    this.scale = waveScale(this.wave, this.knobs);
    this.boss = null;
    // A wave bigger than MAX_ALIVE holds the rest back as reinforcements.
    this.queue = slots.slice(MAX_ALIVE);
    this.reinforce = this.knobs.stagger;
    this.spawnGroup(slots.slice(0, MAX_ALIVE), away);
    this.enemiesLeft = slots.length;
    for (const { ship, waveShield } of this.captains) if (waveShield > 0 && ship.alive) ship.addShield(ship.maxHp * waveShield, 30);
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
    const { dmg: dmgMul, elite, affixes } = this.scale;
    const hpMul = this.scale.hp * (1 + COOP_HP * (this.captains.length - 1));
    const afloat = this.afloat();
    slots.forEach((slot, i) => {
      const spec: ShipSpec = isTitanSlot(slot) ? this.titan(Number(slot.slice(6))) : randomOf(slot, g.rng, configEras(g.config));
      const a = away + (i - (slots.length - 1) / 2) * 0.12;
      const r = MAP_HALF * 0.82;
      const pos = findOpenWater(this.game.map, Math.cos(a) * r, Math.sin(a) * r);
      // The captains share the hunters out in turn.
      const prey = afloat.length ? afloat[this.huntTurn++ % afloat.length] : this.player!;
      const heading = bearingTo(pos.x, pos.z, prey.pos.x, prey.pos.z);
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
      ai.hunt = prey;
      g.ai.set(s, ai);
      if (titan && !this.boss) this.boss = s;
    });
  }

  /** Three different upgrades for one captain's intermission. */
  private roll(): Upgrade[] {
    const pool = [...UPGRADES];
    const out: Upgrade[] = [];
    while (out.length < 3 && pool.length) out.push(pool.splice(Math.floor(this.game.rng() * pool.length), 1)[0]);
    return out;
  }

  /** Captain `captain` takes card `i` of their offer; the next wave warms up once every captain has. */
  choose(i: number, captain = 0): boolean {
    if (this.phase !== 'offer') return false;
    const c = this.captains[captain];
    const u = c?.offer[i];
    if (!u || c.chosen) return false;
    u.apply(c.ship, this);
    c.taken.push(u.id);
    c.offer = [];
    c.chosen = true;
    this.game.events.emit('upgrade', { id: u.id });
    if (this.captains.every((k) => k.chosen)) {
      this.phase = 'warmup';
      this.timer = WARMUP;
    }
    return true;
  }

  private waveCleared(): void {
    const g = this.game;
    this.score += 5000 * this.wave;
    if (this.wave === RUSH_WAVES && !this.survival) this.cleared = true;
    g.events.emit('waveClear', { wave: this.wave, cleared: this.cleared && this.wave === RUSH_WAVES });
    // Refit between waves: patch the hull, a spare repair kit, some ultimate charge.
    for (const s of g.ships) {
      if (!s.alive || s.team !== 0) continue;
      s.heal(s.maxHp * 0.35);
      s.extinguish();
    }
    // The sunk sail again only if a shipmate saw the wave out; a fleet that went down with it has lost.
    if (this.afloat().length) for (const c of this.captains) if (!c.ship.alive) this.revive(c.ship);
    for (const { ship } of this.captains) {
      const kit = ship.consumables[0];
      if (kit) kit.charges = Math.min(kit.spec.charges, kit.charges + 1);
      ship.boostUlts(0.25);
    }
    for (const c of this.captains) {
      c.offer = this.roll();
      c.chosen = false;
    }
    this.phase = 'offer';
    this.timer = OFFER_TIME;
  }

  /**
   * A captain sunk in the wave sails again beside a shipmate at half strength. Refits stay with the
   * hull; the repair kits (an Extra repair kit among them) are carried over the respawn's fresh set.
   */
  private revive(ship: Ship): void {
    // Sunk in a titan form, the hull's own kits are the ones the form set aside.
    const kits = (ship.form?.saved.consumables ?? ship.consumables).map((k) => ({ spec: k.spec, charges: k.charges }));
    const by = this.afloat()[0];
    const at = by ? findOpenWater(this.game.map, by.pos.x, by.pos.z + CAPTAIN_GAP) : this.centre();
    this.game.revive(ship, at.x, at.z, REVIVE_HP);
    ship.consumables.forEach((k, i) => {
      if (!kits[i]) return;
      k.spec = kits[i].spec;
      k.charges = kits[i].charges;
    });
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
      this.retarget();
      if (this.enemiesLeft === 0) this.waveCleared();
      return;
    }
    this.timer -= dt;
    // A captain under the AI (a dropped LAN peer) never stalls the others: card one, at once.
    if (this.phase === 'offer') this.pickFor((c) => g.ai.has(c.ship));
    if (this.timer > 0) return;
    if (this.phase === 'offer') this.pickFor(() => true);
    else this.spawnWave();
  }

  /** Card one for every captain still choosing that `who` names. */
  private pickFor(who: (c: Captain) => boolean): void {
    this.captains.forEach((c, i) => {
      if (!c.chosen && who(c)) this.choose(0, i);
    });
  }

  /** Hunters whose captain sank turn on the nearest one still afloat. */
  private retarget(): void {
    if (this.captains.every((c) => c.ship.alive)) return;
    for (const [s, ai] of this.game.ai) {
      if (s.team !== 1 || !ai.hunt || ai.hunt.alive || !this.captainOf(ai.hunt)) continue;
      ai.hunt = this.nearestCaptain(s.pos.x, s.pos.z);
    }
  }

  onSunk(ship: Ship, killer: Ship | null): void {
    const g = this.game;
    if (ship.team !== 1 || ship.isSummon) return;
    // Wrecks may leave a crate; a titan leaves three.
    const drops = ship.spec.cls === 'TT' ? 3 : g.rng() < 0.35 + this.dropBonus ? 1 : 0;
    const kinds: PickupKind[] = ['repair', 'overcharge', 'reset', 'fury'];
    for (let i = 0; i < drops; i++) {
      const a = (i / Math.max(1, drops)) * Math.PI * 2;
      g.pickups.spawn(i === 0 && ship.spec.cls === 'TT' ? 'repair' : pick(kinds, g.rng), ship.pos.x + Math.cos(a) * 120, ship.pos.z + Math.sin(a) * 120);
    }
    // Score, combo and Chain reaction follow the kill credit of any captain.
    const c = this.captainOf(killer);
    if (!c) return;
    // Kills in quick succession build a combo multiplier.
    this.combo = g.time - this.lastKillTime < COMBO_WINDOW ? this.combo + 1 : 1;
    this.lastKillTime = g.time;
    const mul = 1 + 0.5 * (Math.min(this.combo, 7) - 1);
    this.score += Math.round(1000 * this.wave * mul);
    if (ship.spec.cls === 'TT') this.score += 25000 * Math.ceil(this.wave / 5);
    if (c.chainBlast > 0) {
      g.strikes.spawn(c.ship, { kind: 'mortar', skill: null, x: ship.pos.x, z: ship.pos.z, radius: 260, delay: 0.2, damage: c.chainBlast, fire: 0.5 });
    }
  }

  /** The run ends when no captain is afloat: a win if wave 15 was cleared (Survival is always a last stand). */
  checkVictory(): void {
    if (!this.captains.length || this.captains.some((c) => c.ship.alive)) return;
    const held = Math.max(0, this.wave - 1);
    if (this.survival) return this.game.finish(1, `Held out for ${held} wave${held === 1 ? '' : 's'}`);
    this.game.finish(this.cleared ? 0 : 1, this.cleared ? `Survived ${this.wave} waves` : `Fell on wave ${this.wave}`);
  }

  /** The host ended the run (or it ran out of LAN time): it is scored as it stands. */
  endRun(): void {
    if (this.game.over) return;
    // Waves beaten: the one being fought does not count yet.
    const held = Math.max(0, this.wave - (this.phase === 'fight' ? 1 : 0));
    if (this.survival) return this.game.finish(1, `Held out for ${held} wave${held === 1 ? '' : 's'}`);
    this.game.finish(this.cleared ? 0 : 1, `Run ended on wave ${Math.max(1, this.wave)}`);
  }

  /** Score with every captain's damage share included (for the live HUD). */
  get total(): number {
    return this.score + Math.round(this.captains.reduce((n, c) => n + c.ship.stats.damage, 0) / 10);
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
