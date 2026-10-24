import { dist2D } from '../../core/math';
import type { Ship } from '../../ships/Ship';
import {
  aimPoint,
  blinkTo,
  buff,
  enemiesWithin,
  hpFrac,
  intercept,
  nextSalvo,
  root,
  stun,
  targetInGunRange,
  underFire,
  within,
} from '../kit';
import { def, type SkillDef } from '../types';
import { enemiesAround, spendHull } from './common';

// Russian Bastion Fleet: Buran, Tunguska, Molniya, Mir, Vostok.
// The unbreakable bastion: gravity, EMP and armour. Bastion hulls shrug off half of every stun.

export const RU_SF_SKILLS: SkillDef[] = [
  // ------------------------------------------------------------------ Buran
  def(
    {
      id: 'gravitonShell',
      name: 'Graviton Shell',
      short: 'GRAVITON',
      description: 'The next salvo carries graviton cores: every hit opens a 150 m gravity pocket for 3 s that drags hulls into it and slows them.',
      cooldown: 16,
      duration: 0,
      accent: 0xa050ff,
      icon: 'gravity',
    },
    {
      activate(ship, game, st) {
        nextSalvo(ship, st.spec, {
          onHit: (_t, x, z) => {
            game.fields.add(ship, { x, z, r: 150, life: 3, skill: st.spec, look: 'void', color: st.spec.accent, pull: 60, slow: 0.6 });
          },
        });
      },
      aiShouldUse(ship, _g, target) {
        return targetInGunRange(ship, target, 0.9) && !target!.submerged;
      },
    },
  ),
  def(
    {
      id: 'ablativeArmour',
      name: 'Ablative Armour',
      short: 'ABLATIVE',
      description: '10 s: the plating hardens as it is struck. Every 3% of your hull you lose cuts the damage you take by another 10%, down to 60% less.',
      cooldown: 22,
      duration: 10,
      accent: 0xd84a1a,
      icon: 'shield',
    },
    {
      activate(ship, _g, st) {
        st.data.i0 = ship.intake;
      },
      update(ship, _g, _dt, st) {
        const steps = Math.floor((ship.intake - (st.data.i0 as number)) / (ship.maxHp * 0.03));
        const mul = Math.max(0.4, 1 - steps * 0.1);
        buff(ship, st.spec.id, 0.3, (m) => {
          m.damageTakenMul *= mul;
        });
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 1000) >= 6;
      },
    },
  ),
  def(
    {
      id: 'eventHorizon',
      name: 'Event Horizon',
      short: 'EVENT HORIZON',
      description: 'A black hole opens at the reticle (6 km) for 6 s. Everything within 1.5 km is dragged toward it, and the 250 m core deals 12k a second.',
      ult: true,
      cooldown: 90,
      duration: 0,
      accent: 0x7020c0,
      icon: 'gravity',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 6000);
        game.fields.add(ship, { x: p.x, z: p.z, r: 1500, life: 6, skill: st.spec, look: 'void', color: st.spec.accent, pull: 120 });
        game.fields.add(ship, { x: p.x, z: p.z, r: 250, life: 6, skill: st.spec, look: 'void', color: 0x200040, dps: 12000 });
      },
      aiShouldUse(ship, game, target) {
        if (!within(ship, target, 5800) || target.deep) return false;
        ship.control.aimX = target.pos.x;
        ship.control.aimZ = target.pos.z;
        return enemiesAround(ship, game, target.pos.x, target.pos.z, 1500).length >= 1;
      },
    },
  ),

  // ------------------------------------------------------------------ Tunguska
  def(
    {
      id: 'empShell',
      name: 'EMP Shell',
      short: 'EMP SHELL',
      description: 'The next salvo is loaded with EMP cores: every hit stuns its target for 1.5 s.',
      cooldown: 18,
      duration: 0,
      accent: 0x60c0ff,
      icon: 'lightning',
    },
    {
      activate(ship, _g, st) {
        nextSalvo(ship, st.spec, {
          onHit: (t) => stun(t, 1.5),
        });
      },
      aiShouldUse(ship, _g, target) {
        return targetInGunRange(ship, target, 0.85) && !target!.submerged;
      },
    },
  ),
  def(
    {
      id: 'overcharge',
      name: 'Overcharge',
      short: 'OVERCHARGE',
      description: 'Bleed the reactor into the guns: spend 10% of your hull for 6 s of reloads three times as fast and 40% more damage.',
      cooldown: 22,
      duration: 6,
      accent: 0xff6a20,
      icon: 'drums',
    },
    {
      activate(ship) {
        if (hpFrac(ship) < 0.15) return false;
        spendHull(ship, 0.1);
      },
      update(ship, _g, _dt, st) {
        buff(ship, st.spec.id, 0.3, (m) => {
          m.reloadMul *= 0.33;
          m.damageMul *= 1.4;
        });
      },
      aiShouldUse(ship, _g, target) {
        return targetInGunRange(ship, target, 0.8) && hpFrac(ship) > 0.45;
      },
    },
  ),
  def(
    {
      id: 'tunguskaEvent',
      name: 'Tunguska Event',
      short: 'TUNGUSKA',
      description: 'An airburst over the reticle (7 km) 2 s later flattens 1.2 km of sea: 40k at the centre, a 3 s stun, every normal skill they have sent back to full cooldown and 30% off their ultimates.',
      ult: true,
      cooldown: 90,
      duration: 2,
      accent: 0xff8a40,
      icon: 'nuke',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 7000);
        st.data.x = p.x;
        st.data.z = p.z;
        game.strikes.spawn(ship, { kind: 'nuke', skill: st.spec, x: p.x, z: p.z, radius: 1200, delay: 2, damage: 40000, stun: 3, fire: 0.5 });
      },
      end(ship, game, st) {
        const x = st.data.x as number;
        const z = st.data.z as number;
        for (const s of game.ships) {
          if (!s.alive || s.team === ship.team || s.deep || dist2D(s.pos.x, s.pos.z, x, z) > 1200) continue;
          for (const k of s.skills) {
            if (k.spec.ult) {
              if (!k.active) k.meter = Math.max(0, k.meter - 0.3);
            } else k.cooldown = Math.max(k.cooldown, k.spec.cooldown);
          }
        }
      },
      aiShouldUse(ship, game, target) {
        if (!within(ship, target, 6800) || target.deep) return false;
        ship.control.aimX = target.pos.x + (target.pos.x - ship.pos.x) * 0.02;
        ship.control.aimZ = target.pos.z + (target.pos.z - ship.pos.z) * 0.02;
        return enemiesAround(ship, game, target.pos.x, target.pos.z, 1200).length >= 1;
      },
    },
  ),

  // ------------------------------------------------------------------ Molniya
  def(
    {
      id: 'ballLightning',
      name: 'Ball Lightning',
      short: 'BALL LIGHTNING',
      description: 'Ball lightning settles over the reticle (5 km) for 8 s, zapping every enemy within 300 m for 4k a second.',
      cooldown: 16,
      duration: 0,
      accent: 0x80c0ff,
      icon: 'lightning',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 5000);
        game.fields.add(ship, { x: p.x, z: p.z, r: 300, life: 8, skill: st.spec, look: 'storm', color: st.spec.accent, dps: 4000 });
      },
      aiShouldUse(ship, _g, target) {
        if (!within(ship, target, 4800) || target.deep) return false;
        ship.control.aimX = target.pos.x;
        ship.control.aimZ = target.pos.z;
        return target.speed < 25;
      },
    },
  ),
  def(
    {
      id: 'staticDash',
      name: 'Static Dash',
      short: 'STATIC DASH',
      description: 'Blink 500 m toward the reticle, leaving a charged trail for 6 s. An enemy that crosses it takes 5k and is stunned 2 s.',
      cooldown: 14,
      duration: 0,
      accent: 0x60d0ff,
      icon: 'blink',
    },
    {
      activate(ship, game, st) {
        const x0 = ship.pos.x;
        const z0 = ship.pos.z;
        const p = aimPoint(ship, 500);
        if (!blinkTo(ship, game, p.x, p.z)) return false;
        game.fields.addWire(
          ship,
          x0,
          z0,
          ship.pos.x,
          ship.pos.z,
          6,
          (s) => {
            s.takeDamage(5000 * ship.mods.damageMul, ship, st.spec);
            if (s.alive) stun(s, 2);
          },
          st.spec,
        );
      },
      aiShouldUse(ship, game, target) {
        return underFire(ship, game, 600) >= 6 || (within(ship, target, 2400) && !within(ship, target, 1200));
      },
    },
  ),
  def(
    {
      id: 'thunderdome',
      name: 'Thunderdome',
      short: 'THUNDERDOME',
      description: 'An 8 s lightning cage 1 km wide around you: enemies inside cannot sail out, and take 6k a second.',
      ult: true,
      cooldown: 85,
      duration: 0,
      accent: 0x9ad0ff,
      icon: 'lightning',
      zone: 1000,
    },
    {
      activate(ship, game, st) {
        game.fields.add(ship, { x: ship.pos.x, z: ship.pos.z, r: 1000, life: 8, skill: st.spec, look: 'storm', color: st.spec.accent, dps: 6000, cage: true });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 800).filter((s) => !s.deep).length >= 1;
      },
    },
  ),

  // ------------------------------------------------------------------ Mir
  def(
    {
      id: 'heavyDrones',
      name: 'Heavy Drones',
      short: 'HEAVY DRONES',
      description: 'The next strike squadron flies armoured drones: they take a third of the damage from AA and fighters, and hit 20% harder.',
      cooldown: 16,
      duration: 0,
      accent: 0xd84a1a,
      icon: 'drone',
    },
    {
      activate(ship, _g, st) {
        if (!ship.spec.air) return false;
        ship.airBuff = { skill: st.spec, types: ['torpedo', 'dive'], armour: 3, damageMul: 1.2 };
      },
      aiShouldUse(ship, _g, target) {
        const air = ship.spec.air;
        return !!air && !!ship.air && ship.air.hangar.dive + ship.air.hangar.torpedo > 0 && within(ship, target, air.range * 0.9) && !target.submerged;
      },
    },
  ),
  def(
    {
      id: 'gravityLens',
      name: 'Gravity Lens',
      short: 'GRAVITY LENS',
      description: '8 s: a gravity lens bends the sky around you. Enemy shells within 1.5 km are dragged outward and fall up to 100 m off.',
      cooldown: 20,
      duration: 8,
      accent: 0xa070ff,
      icon: 'gravity',
      zone: 1500,
    },
    {
      activate() {},
      update(ship, game, dt) {
        for (const s of game.shells.shells) {
          if (!s.alive || s.team === ship.team) continue;
          const dx = s.x - ship.pos.x;
          const dz = s.z - ship.pos.z;
          const d = Math.hypot(dx, dz);
          if (d > 1500 || d < 1) continue;
          s.x += (dx / d) * 90 * dt;
          s.z += (dz / d) * 90 * dt;
        }
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 1500) >= 6;
      },
    },
  ),
  def(
    {
      id: 'gravityWellStation',
      name: 'Gravity Well Station',
      short: 'GRAVITY WELL',
      description: 'A station anchors over the reticle for 10 s: shells, torpedoes, missiles and planes within 1 km are crushed, and enemy ships there are slowed 50% and take 3k a second.',
      ult: true,
      cooldown: 85,
      duration: 10,
      accent: 0x9050e0,
      icon: 'gravity',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, ship.spec.air?.range ?? 6000);
        st.data.x = p.x;
        st.data.z = p.z;
        game.fields.add(ship, { x: p.x, z: p.z, r: 1000, life: st.spec.duration, skill: st.spec, look: 'void', color: st.spec.accent, slow: 0.5, dps: 3000 });
      },
      update(ship, game, dt, st) {
        intercept(ship, game, st.data.x as number, st.data.z as number, 1000, dt, { shells: true, torps: true, missiles: true, planes: 20000 });
      },
      aiShouldUse(ship, game, target) {
        const air = ship.spec.air;
        return !!air && within(ship, target, air.range * 0.9) && !target.deep && enemiesAround(ship, game, target.pos.x, target.pos.z, 1000).length >= 1;
      },
    },
  ),

  // ------------------------------------------------------------------ Vostok
  def(
    {
      id: 'cryoTorpedo',
      name: 'Cryo Torpedo',
      short: 'CRYO TORP',
      description: 'The next spread carries cryo warheads: a hit freezes the target in place, hull and turrets, for 3 s.',
      cooldown: 16,
      duration: 12,
      accent: 0x9ae8ff,
      icon: 'cryo',
    },
    {
      activate(ship, _g, st) {
        if (!ship.spec.torpedoes) return false;
        ship.torpBuff = {
          skill: st.spec,
          speedMul: 1,
          spreads: 1,
          onHit: (t) => {
            root(t, 3);
            buff(t, 'debuff:cryo', t.spec.cls === 'TT' ? 1.2 : 3, (m) => {
              m.traverseMul = 0;
            });
          },
        };
      },
      end(ship, _g, st) {
        if (ship.torpBuff?.skill === st.spec) ship.torpBuff = null;
      },
      aiShouldUse(ship, _g, target) {
        const t = ship.spec.torpedoes;
        return !!t && within(ship, target, t.range * 0.8) && ship.launchers.some((l) => l.reload <= 0);
      },
    },
  ),
  def(
    {
      id: 'iceBreaker',
      name: 'Ice Breaker',
      short: 'ICE BREAKER',
      description: 'Burst to the surface: the shock deals 20k to every enemy within 400 m and stuns it 2 s.',
      cooldown: 16,
      duration: 0,
      accent: 0xc0f0ff,
      icon: 'snow',
      zone: 400,
    },
    {
      activate(ship, game, st) {
        ship.depthState = 0;
        game.strikes.spawn(ship, { kind: 'shock', skill: st.spec, x: ship.pos.x, z: ship.pos.z, radius: 400, delay: 0, damage: 20000, stun: 2, speed: 500, hitsSubs: true });
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 380).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'underwaterVolcano',
      name: 'Underwater Volcano',
      short: 'VOLCANO',
      description: 'The seabed erupts under the reticle (4 km) for 8 s: within 600 m enemies take 15k a second, catch fire, and are heaved outward.',
      ult: true,
      cooldown: 85,
      duration: 0,
      accent: 0xff5a20,
      icon: 'meteor',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 4000);
        game.fields.add(ship, {
          x: p.x,
          z: p.z,
          r: 600,
          life: 8,
          skill: st.spec,
          look: 'fire',
          color: st.spec.accent,
          dps: 15000,
          onTick: (s: Ship, f) => {
            if (s.team === ship.team) return;
            const dx = s.pos.x - f.x;
            const dz = s.pos.z - f.z;
            const d = Math.max(1, Math.hypot(dx, dz));
            s.shove((dx / d) * 30, (dz / d) * 30);
            if (game.rng() < 0.1) s.startFire(Math.floor(game.rng() * 4), ship);
          },
        });
      },
      aiShouldUse(ship, game, target) {
        if (!within(ship, target, 3800) || target.deep) return false;
        ship.control.aimX = target.pos.x;
        ship.control.aimZ = target.pos.z;
        return enemiesAround(ship, game, target.pos.x, target.pos.z, 600).length >= 1;
      },
    },
  ),
];
