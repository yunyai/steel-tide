import type { Game } from '../../core/Game';
import { bearingTo } from '../../core/math';
import type { SkillSpec, TorpedoSpec } from '../../core/types';
import type { Ship } from '../../ships/Ship';
import {
  blink,
  buff,
  dist,
  enemiesWithin,
  hpFrac,
  intercept,
  nearestEnemy,
  underFire,
  within,
} from '../kit';
import { def, type SkillDef } from '../types';

// Fletcher, Shimakaze, Akagi, Gato.

/** Fallback when a ship without tubes fires a torpedo skill. */
const SKILL_TORP: TorpedoSpec = {
  name: 'Skill torpedo',
  launchers: [],
  tubes: 1,
  reload: 0,
  speed: 60,
  range: 3000,
  damage: 10000,
  floodChance: 0.3,
  spread: 0,
  detect: 500,
};

/**
 * Fire `n` homing torpedoes: each picks a target (cycling through `targets`) or runs straight
 * along the reticle bearing in a fan when there is none.
 */
export function homingSpread(ship: Ship, game: Game, skill: SkillSpec, n: number, targets: Ship[], o: Partial<TorpedoSpec>): void {
  const base = ship.spec.torpedoes ?? SKILL_TORP;
  const spec: TorpedoSpec = { ...base, ...o };
  const { aimX, aimZ } = ship.control;
  for (let i = 0; i < n; i++) {
    const bow = i % 2 === 0;
    const p = ship.localToWorld((bow ? 0.46 : 0.2) * ship.spec.length, 0, ((i % 3) - 1) * 3);
    const target = targets.length ? targets[i % targets.length] : null;
    const heading = target
      ? bearingTo(p.x, p.z, target.pos.x, target.pos.z) + ((i % 5) - 2) * 0.05
      : bearingTo(p.x, p.z, aimX, aimZ) + (i / Math.max(1, n - 1) - 0.5) * 0.5;
    const t = game.torps.launch(ship, p.x, p.z, heading, spec, target);
    t.skill = skill;
  }
  game.events.emit('torpLaunched', { ship, x: ship.pos.x, z: ship.pos.z, count: n });
}

export const LIGHT_SKILLS: SkillDef[] = [
  // ------------------------------------------------------------------ Fletcher
  def(
    {
      id: 'smokeDash',
      name: 'Smoke Dash',
      short: 'SMOKE DASH',
      description: '5 s: 1.6x speed while pouring out a smoke wall behind you.',
      cooldown: 18,
      duration: 5,
      accent: 0xb8c4d0,
      icon: 'speed',
    },
    {
      activate(ship, _g, st) {
        ship.throttle = 6;
        st.data.tick = 0;
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.speedMul *= 1.6;
          m.turnMul *= 1.2;
        });
      },
      update(ship, game, dt, st) {
        st.data.tick = (st.data.tick as number) - dt;
        if ((st.data.tick as number) > 0) return;
        st.data.tick = 0.45;
        const p = ship.localToWorld(-ship.spec.length * 0.5, 0, 0);
        game.addSmoke(p.x, p.z, ship.team);
      },
      aiShouldUse(ship, game) {
        return hpFrac(ship) < 0.6 && underFire(ship, game, 700) >= 4;
      },
    },
  ),
  def(
    {
      id: 'screenFleet',
      name: 'Screen the Fleet',
      short: 'SCREEN',
      description: '10 s: you screen the nearest ally within 1.5 km. It takes 40% less damage, and enemy torpedoes within 600 m of either of you are shot up.',
      cooldown: 20,
      duration: 10,
      accent: 0x80ffd0,
      icon: 'shield',
    },
    {
      activate(ship, game, st) {
        let ward: Ship | null = null;
        for (const s of game.ships) {
          if (s === ship || !s.alive || s.team !== ship.team || dist(s, ship) > 1500) continue;
          if (!ward || dist(s, ship) < dist(ward, ship)) ward = s;
        }
        if (!ward && ship.humanIndex < 0) return false;
        st.data.ward = ward;
      },
      update(ship, game, dt, st) {
        const ward = st.data.ward as Ship | null;
        intercept(ship, game, ship.pos.x, ship.pos.z, 600, dt, { torps: true });
        if (!ward?.alive || dist(ward, ship) > 2500) return;
        intercept(ship, game, ward.pos.x, ward.pos.z, 600, dt, { torps: true });
        buff(ward, st.spec.id, 0.3, (m) => {
          m.damageTakenMul *= 0.6;
        });
      },
      aiShouldUse(ship, game) {
        return game.ships.some((s) => s !== ship && s.alive && s.team === ship.team && dist(s, ship) < 1400 && hpFrac(s) < 0.8 && underFire(s, game, 900) >= 4);
      },
    },
  ),
  def(
    {
      id: 'littleBeavers',
      name: 'Little Beavers',
      short: 'LITTLE BEAVERS',
      description: 'Three AI destroyers join your division for 30 s.',
      ult: true,
      cooldown: 80,
      duration: 30,
      accent: 0x9fd8ff,
      icon: 'drone',
    },
    {
      activate(ship, game, st) {
        for (const lat of [-220, 220, 0]) game.spawnWingman(ship, lat, st.spec.duration, lat === 0 ? -260 : -60);
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 4000).length > 0;
      },
    },
  ),

  // ------------------------------------------------------------------ Shimakaze
  def(
    {
      id: 'shadowBlink',
      name: 'Shadow Blink',
      short: 'BLINK',
      description: 'Teleport 400 m ahead and cloak for 2 s: nothing can lock on or home in.',
      cooldown: 14,
      duration: 2,
      accent: 0xb48cff,
      icon: 'blink',
    },
    {
      activate(ship, game, st) {
        if (!blink(ship, game, 400)) return false;
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.untargetable = true;
        });
      },
      aiShouldUse(ship, game) {
        return hpFrac(ship) < 0.7 && underFire(ship, game, 500) >= 3;
      },
    },
  ),
  def(
    {
      id: 'longLance',
      name: 'Long Lance Reload',
      short: 'LONG LANCE',
      description: 'Instant torpedo reload. The next spread homes in and runs 30% faster.',
      cooldown: 32,
      duration: 0,
      accent: 0x7affc8,
      icon: 'torpedo',
    },
    {
      activate(ship, _g, st) {
        for (const l of ship.launchers) l.reload = 0;
        ship.torpBuff = { skill: st.spec, speedMul: 1.3, spreads: 1 };
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, (ship.spec.torpedoes?.range ?? 3000) * 0.8) && ship.launchers.every((l) => l.reload > 5);
      },
    },
  ),
  def(
    {
      id: 'type93Salvo',
      name: 'Type 93 Salvo',
      short: 'TYPE 93',
      description: 'Every launcher fires three spreads at the reticle over 3 s, oxygen-fuelled: no wake until 500 m out.',
      ult: true,
      cooldown: 80,
      duration: 3,
      accent: 0x9d6bff,
      icon: 'torpedo',
    },
    {
      activate(ship, _g, st) {
        if (!ship.spec.torpedoes) return false;
        st.data.next = 0;
      },
      update(ship, _g, _dt, st) {
        const tspec = ship.spec.torpedoes!;
        const fired = 3 - Math.ceil(st.time);
        if ((st.data.next as number) > fired) return;
        st.data.next = fired + 1;
        // A Long Lance load waiting in the tubes keeps for the spread after.
        const held = ship.torpBuff;
        ship.torpBuff = { skill: st.spec, speedMul: 1.1, spreads: 1, homing: false, wakeless: true };
        ship.launchSpread(tspec, true);
        ship.torpBuff = held;
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, (ship.spec.torpedoes?.range ?? 3000) * 0.7) && !target.deep;
      },
    },
  ),

  // ------------------------------------------------------------------ Akagi
  def(
    {
      id: 'fighterUmbrella',
      name: 'Fighter Umbrella',
      short: 'UMBRELLA',
      description: '10 s: a combat air patrol downs every plane and missile within 800 m.',
      cooldown: 20,
      duration: 10,
      accent: 0x9fe0ff,
      icon: 'plane',
      zone: 800,
    },
    {
      activate() {},
      update(ship, game, dt, st) {
        intercept(ship, game, ship.pos.x, ship.pos.z, st.spec.zone!, dt, { missiles: true, planes: 30000 });
      },
      aiShouldUse(ship, game) {
        const near = (x: number, z: number) => Math.hypot(x - ship.pos.x, z - ship.pos.z) < 1600;
        return game.air.squadrons.some((q) => q.alive && q.team !== ship.team && near(q.x, q.z)) || game.missiles.missiles.some((m) => m.alive && m.team !== ship.team && near(m.x, m.z));
      },
    },
  ),
  def(
    {
      id: 'repairWing',
      name: 'Repair Wing',
      short: 'REPAIR WING',
      description: 'Medical flights heal you and every ally within 1.5 km by 20% over 8 s.',
      cooldown: 24,
      duration: 8,
      accent: 0x7dffa0,
      icon: 'heal',
    },
    {
      activate() {},
      update(ship, game, dt, st) {
        for (const a of game.ships) {
          if (!a.alive || a.team !== ship.team || dist(a, ship) > 1500) continue;
          a.heal((a.maxHp * 0.2 * dt) / st.spec.duration);
        }
      },
      aiShouldUse(ship, game) {
        return game.ships.some((a) => a.alive && a.team === ship.team && dist(a, ship) < 1500 && hpFrac(a) < 0.6);
      },
    },
  ),
  def(
    {
      id: 'alphaStrike',
      name: 'Alpha Strike',
      short: 'ALPHA STRIKE',
      description: 'Every squadron launches at the reticle at once, then the hangar instantly rearms.',
      ult: true,
      cooldown: 80,
      duration: 0,
      accent: 0xff6060,
      icon: 'plane',
    },
    {
      activate(ship, game) {
        const { aimX, aimZ } = ship.control;
        game.air.launch(ship, 'fighter', aimX, aimZ, true);
        game.air.launch(ship, 'torpedo', aimX, aimZ, true);
        game.air.launch(ship, 'dive', aimX, aimZ, true);
        game.air.launch(ship, 'torpedo', aimX + 150, aimZ + 150, true);
        game.air.launch(ship, 'dive', aimX - 150, aimZ - 150, true);
        game.air.launch(ship, 'dive', aimX + 150, aimZ - 150, true);
        const air = ship.spec.air;
        if (air && ship.air) {
          ship.air.hangar = { torpedo: air.torpedo.hangar, dive: air.dive.hangar, fighter: air.fighter.hangar };
          ship.air.cooldown = 0;
        }
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, (ship.spec.air?.range ?? 0) * 0.9);
      },
    },
  ),

  // ------------------------------------------------------------------ Gato
  def(
    {
      id: 'silentRunning',
      name: 'Silent Running',
      short: 'SILENT',
      description: '10 s: cloaked (no lock-ons, homing or AI fire), 30% faster, and the battery does not drain.',
      cooldown: 20,
      duration: 10,
      accent: 0x5fe0c0,
      icon: 'cloak',
    },
    {
      activate(ship, _g, st) {
        buff(ship, st.spec.id, st.spec.duration, (m) => {
          m.untargetable = true;
          m.batteryFree = true;
          m.speedMul *= 1.3;
        });
      },
      aiShouldUse(ship, game) {
        return hpFrac(ship) < 0.8 && enemiesWithin(ship, game, 2500).length > 0;
      },
    },
  ),
  def(
    {
      id: 'mineDrop',
      name: 'Mine Drop',
      short: 'MINES',
      description: 'Lay six proximity mines astern (15k each). They stay for a minute.',
      cooldown: 20,
      duration: 0,
      accent: 0xffd36b,
      icon: 'mine',
    },
    {
      activate(ship, game, st) {
        for (let i = 0; i < 6; i++) {
          const p = ship.localToWorld(-ship.spec.length * 0.6 - (i >> 1) * 70, 0, (i % 2 ? 1 : -1) * 40);
          game.strikes.spawn(ship, { kind: 'mine', skill: st.spec, x: p.x, z: p.z, radius: 70, delay: 2, damage: 15000, flood: 0.5, life: 60 });
        }
      },
      aiShouldUse(ship, game) {
        const e = nearestEnemy(ship, game, 1500);
        return !!e;
      },
    },
  ),
  def(
    {
      id: 'wolfpack',
      name: 'Wolfpack',
      short: 'WOLFPACK',
      description: 'Twelve homing torpedoes, each hunting a different enemy within 2.4 km.',
      ult: true,
      cooldown: 80,
      duration: 0,
      accent: 0x80ffd0,
      icon: 'torpedo',
    },
    {
      activate(ship, game, st) {
        const enemies = enemiesWithin(ship, game, 2400, false).sort((a, b) => dist(a, ship) - dist(b, ship));
        const spec = ship.spec.torpedoes;
        homingSpread(ship, game, st.spec, 12, enemies, { range: 3000, speed: (spec?.speed ?? 50) * 1.25 });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 2200).length > 0;
      },
    },
  ),
];
