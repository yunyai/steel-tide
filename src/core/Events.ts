import type { Ship } from '../ships/Ship';
import type { AmmoType, ConsumableType, GunLook, HitOutcome, SkillSpec, Team } from './types';
import type { Pickup } from './Pickups';
import type { Strike } from '../weapons/StrikeSystem';

export interface GameEventMap {
  gunFired: { ship: Ship; x: number; y: number; z: number; bearing: number; caliber: number; secondary: boolean; look?: GunLook };
  shellHit: {
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
  fire: { ship: Ship; site: number };
  flood: { ship: Ship };
  /** Skill `index` (0 Q, 1 E, 2 R) triggered / ran out. */
  skill: { ship: Ship; index: number };
  skillEnd: { ship: Ship; index: number };
  /** Damage dealt by a skill (popups show it big, with the skill's name). */
  skillHit: { ship: Ship; attacker: Ship; skill: SkillSpec; damage: number };
  /** A bolt between points; `straight` draws a clean laser line instead of a jagged one. */
  lightning: { points: { x: number; y: number; z: number }[]; color: number; straight?: boolean };
  strike: { strike: Strike };
  strikeHit: { strike: Strike };
  blink: { ship: Ship; fromX: number; fromZ: number };
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

export class EventBus {
  private handlers: { [K in keyof GameEventMap]?: Handler<GameEventMap[K]>[] } = {};

  on<K extends keyof GameEventMap>(type: K, fn: Handler<GameEventMap[K]>): () => void {
    const list = (this.handlers[type] ??= []) as Handler<GameEventMap[K]>[];
    list.push(fn);
    return () => {
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  }

  emit<K extends keyof GameEventMap>(type: K, payload: GameEventMap[K]): void {
    const list = this.handlers[type] as Handler<GameEventMap[K]>[] | undefined;
    if (!list) return;
    for (const fn of list) fn(payload);
  }

  clear(): void {
    this.handlers = {};
  }
}
