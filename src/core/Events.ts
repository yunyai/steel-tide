import type { ElementEvent } from '../skills/misc/ArchitectElements';
import type { Ship } from '../ships/Ship';
import type { AmmoType, ConsumableType, GunLook, HitOutcome, SkillSpec, Team } from './types';
import type { Pickup } from './Pickups';
import type { Strike } from '../weapons/StrikeSystem';

export type TungstenEventKind =
  | 'throw' | 'hit' | 'land' | 'dock' | 'break' | 'reform' | 'switch' | 'signature' | 'slam' | 'reel'
  | 'lunge' | 'arrive' | 'capture' | 'block' | 'shield' | 'contact'
  | 'collapse' | 'collapseHold' | 'collapseBurst' | 'meteorRise' | 'meteorFall' | 'meteorImpact' | 'fragment'
  | 'overdrive' | 'overdriveEnd' | 'spent' | 'charged' | 'die' | 'mirror';

/** How a hit landed, for the Sandbox DPS meter: set by the weapon system around `takeDamage`. */
export type HitKind = 'gun' | 'secondary' | 'torp' | 'air' | 'missile' | 'skill' | 'dot' | 'reflect';

export interface GameEventMap {
  gunFired: { ship: Ship; x: number; y: number; z: number; bearing: number; caliber: number; secondary: boolean; look?: GunLook };
  shellHit: {
    element?:import('../data/architectLoadout').ArchitectElement;
    attacker: Ship;
    target: Ship;
    outcome: HitOutcome;
    damage: number;
    x: number;
    y: number;
    z: number;
    caliber: number;
    ammo: AmmoType;
    /** Fired by a secondary battery. */
    secondary?: boolean;
  };
  splash: { x: number; y: number; z: number; caliber: number };
  terrainHit: { x: number; y: number; z: number; caliber: number };
  torpLaunched: { ship: Ship; x: number; z: number; count: number };
  torpHit: { attacker: Ship; target: Ship; damage: number; x: number; z: number };
  explosion: { x: number; y: number; z: number; size: number };
  shipSunk: { ship: Ship; killer: Ship | null };
  /** A magazine went up as the ship sank: the hull breaks in two. */
  detonation: { ship: Ship; killer: Ship | null };
  /** Convoy: a cargo ship reached port or went down. */
  convoy: { ship: Ship; kind: 'arrived' | 'sunk' };
  /** A sunk ship sails again (Domination, Free play). */
  respawn: { ship: Ship };
  /** Free play: a captain's next ship replaced `old` in the fleet (it then respawns). */
  shipChanged: { old: Ship; ship: Ship };
  /** Titan Shift: the ship took its titan form (`on`), or the form lapsed and it is itself again. */
  /** A Titan Shift (`on`) or the return to the base hull; `quiet` when a respawn did it (no FX). */
  shift: { ship: Ship; on: boolean; quiet?: boolean };
  fire: { ship: Ship; site: number };
  flood: { ship: Ship };
  /** Skill `index` (0 Q, 1 E, 2 R) triggered / ran out. */
  skill: { ship: Ship; index: number };
  skillEnd: { ship: Ship; index: number };
  /** Damage dealt by a skill (popups show it big, with the skill's name). */
  skillHit: { ship: Ship; attacker: Ship; skill: SkillSpec; damage: number };
  /** Every bit of hull damage a ship takes, once, after armour and reductions. */
  damage: { target: Ship; attacker: Ship | null; amount: number; skill: SkillSpec | null; kind: HitKind };
  /** A bolt between points; `straight` draws a clean laser line instead of a jagged one. */
  lightning: { points: { x: number; y: number; z: number }[]; color: number; straight?: boolean };
  strike: { strike: Strike };
  strikeHit: { strike: Strike };
  architectRefit: {ship:Ship;index:number;pick:import('../data/architectLoadout').ArchitectSelection;accepted:boolean;reason?:string};
  architectBatteryLaunch: import('../data/architectBattery').ArchitectBatteryLaunch;
  architectBatteryImpact: import('../data/architectBattery').ArchitectBatteryImpact;
  architectElement: ElementEvent;
  architectCommand: { ship: Ship; kind: 'deploy'|'recall'|'reconfigure'|'destroy'|'assembly'|'killbox'|'citadel'|'end' };
  /** Hull Dash lift-off and landing shockwave (radius in metres, 0 at launch). */
  architectDash: { ship: Ship; phase: 'launch'|'land'; x: number; z: number; radius: number; vectors: number };
  architectShot: { ship: Ship; x:number;y:number;z:number;tx:number;ty:number;tz:number;width:number;kind:'assembly'|'killbox';slot?:number };
  crossStep: { ship: Ship; x: number; z: number; radius: number; phase: 'start' | 'finish' };
  /** The Tungsten's cube: throws, hits, docking, Shield captures, signatures and both cube ultimates. `mode` indexes TUNGSTEN_MODES. */
  /**
   * `face` and `jackpot`: what a Loaded Die rolled; `merged` for an Overdrive die. `toX`/`toZ`: where a Signature
   * reaches (a cone's tip, a leap's hull). A `mirror` is a shell turned back at its firer, the `target`.
   */
  tungsten: { ship: Ship; kind: TungstenEventKind; cube: number; x: number; y: number; z: number; radius: number; mode: number; target?: Ship; face?: number; jackpot?: boolean; merged?: boolean; toX?: number; toZ?: number };
  stepImpact: { ship: Ship; x: number; z: number; radius: number; kind: 'flicker' | 'copies' };
  blink: { ship: Ship; fromX: number; fromZ: number; fromHeading?: number; dodge?: boolean; step?: 'flash' | 'ram' | 'broad' | 'over' | 'back' };
  /** A ship refused to sink, or was raised from its wreck. */
  revive: { ship: Ship; skill: SkillSpec | null };
  shieldHit: { ship: Ship; amount: number };
  /** Boss Rush: a wave arrives (`boss` is its titan), is cleared, or a refit is taken. */
  wave: { wave: number; boss: Ship | null };
  waveClear: { wave: number; cleared: boolean };
  upgrade: { id: string };
  pickupSpawn: { pickup: Pickup };
  pickupTaken: { pickup: Pickup; ship: Ship };
  consumable: { ship: Ship; type: ConsumableType };
  ribbon: { ship: Ship; kind: string; damage: number; target?: Ship };
  capture: { cap: number; team: Team };
  planeDown: { x: number; y: number; z: number; team: Team };
  intercept: { x: number; y: number; z: number };
  depthCharge: { x: number; z: number };
  squadronLaunched: { ship: Ship };
  missileLaunched: { ship: Ship; x: number; y: number; z: number };
  gameOver: { winner: Team | -1; reason: string };
}

type Handler<T> = (payload: T) => void;

type Table<M> = { [K in keyof M]?: Handler<M[K]>[] };

/**
 * Typed publish/subscribe; `M` maps each event name to its payload (naval by default).
 * Two tiers: `on` is for the simulation and `view` for rendering, sound and HUD. Every sim
 * listener runs before any view listener, and a view listener that throws is caught, so the
 * view can never cut a step short on one LAN peer and leave it out of step with the others.
 * Lists are replaced, never edited in place, so joining or leaving mid-emit is safe.
 */
export class EventBus<M = GameEventMap> {
  private sim: Table<M> = {};
  private views: Table<M> = {};
  private failed = new Set<keyof M>();
  /** Reports a view listener's error; by default logs the first one per event type. */
  onViewError: (error: unknown, type: keyof M) => void = (error, type) => {
    if (this.failed.has(type)) return;
    this.failed.add(type);
    console.error(`A '${String(type)}' view listener failed; the battle carries on.`, error);
  };

  /** Subscribes a simulation listener. */
  on<K extends keyof M>(type: K, fn: Handler<M[K]>): () => void {
    return this.add(this.sim, type, fn);
  }

  /** Subscribes a view listener: it runs after the sim listeners and its errors are contained. */
  view<K extends keyof M>(type: K, fn: Handler<M[K]>): () => void {
    return this.add(this.views, type, fn);
  }

  emit<K extends keyof M>(type: K, payload: M[K]): void {
    const sim = this.sim[type] as Handler<M[K]>[] | undefined;
    if (sim) for (const fn of sim) fn(payload);
    const views = this.views[type] as Handler<M[K]>[] | undefined;
    if (!views) return;
    for (const fn of views) {
      try {
        fn(payload);
      } catch (e) {
        this.onViewError(e, type);
      }
    }
  }

  clear(): void {
    this.sim = {};
    this.views = {};
  }

  private add<K extends keyof M>(table: Table<M>, type: K, fn: Handler<M[K]>): () => void {
    table[type] = [...((table[type] as Handler<M[K]>[] | undefined) ?? []), fn] as Table<M>[K];
    let live = true;
    return () => {
      if (!live) return;
      live = false;
      const list = (table[type] as Handler<M[K]>[] | undefined) ?? [];
      const i = list.indexOf(fn);
      if (i >= 0) table[type] = [...list.slice(0, i), ...list.slice(i + 1)] as Table<M>[K];
    };
  }
}
