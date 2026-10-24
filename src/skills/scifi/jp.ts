import { bearingTo, forwardX, forwardZ } from '../../core/math';
import type { Ship } from '../../ships/Ship';
import {
  aimPoint,
  blink,
  blinkTo,
  buff,
  enemiesOnLine,
  enemiesWithin,
  hurt,
  nearestEnemy,
  nextSalvo,
  stun,
  swapPlaces,
  targetInGunRange,
  underFire,
  within,
} from '../kit';
import { def, type SkillDef } from '../types';
import { arc, clingTo, droneDive, enemiesAround, landNear, reticleTarget } from './common';

// Japan Kage Fleet: Tsurugi, Oboro, Kunai, Shiden, Kage.
// Glass cannons and ninja tricks. Every blink, swap and cloak here primes the Kage ambush hit.

export const JP_SF_SKILLS: SkillDef[] = [
  // ------------------------------------------------------------------ Tsurugi
  def(
    {
      id: 'iaido',
      name: 'Iaido',
      short: 'IAIDO',
      description: 'Blink 300 m ahead and draw: the guns reload at once and the next salvo groups twice as tight.',
      cooldown: 16,
      duration: 0,
      accent: 0xff3a5a,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        blink(ship, game, 300);
        nextSalvo(ship, st.spec, { dispersionMul: 0.5 });
      },
      aiShouldUse(ship, _g, target) {
        return targetInGunRange(ship, target, 0.9) && ship.turrets.every((t) => t.reload > 2);
      },
    },
  ),
  def(
    {
      id: 'kawarimi',
      name: 'Kawarimi',
      short: 'KAWARIMI',
      description: 'For 6 s, the next hit worth 5% of your hull or more strikes an empty decoy, and you reappear 300 m to the side.',
      cooldown: 18,
      duration: 6,
      accent: 0xf2f4f6,
      icon: 'swap',
    },
    {
      activate(ship, game, st) {
        ship.guard = {
          left: 1,
          min: ship.maxHp * 0.05,
          until: game.time + st.spec.duration,
          skill: st.spec,
          onBlock: () => {
            const side = game.rng() < 0.5 ? 1 : -1;
            landNear(ship, game, ship.pos.x, ship.pos.z, 300, ship.heading + (side * Math.PI) / 2);
          },
        };
      },
      end(ship, _g, st) {
        if (ship.guard?.skill === st.spec) ship.guard = null;
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 700) >= 6;
      },
    },
  ),
  def(
    {
      id: 'senbonzakura',
      name: 'Senbonzakura',
      short: 'SENBONZAKURA',
      description: 'A thousand blade drones scatter like petals onto every enemy within 3 km: six apiece, 6k each. For 8 s after, their armour cannot bounce your AP and it hits them 30% harder.',
      ult: true,
      cooldown: 85,
      duration: 0,
      accent: 0xff7a9a,
      icon: 'blade',
      zone: 3000,
    },
    {
      activate(ship, game, st) {
        const prey = enemiesWithin(ship, game, 3000).filter((s) => !s.submerged);
        if (!prey.length) return false;
        const cut = (s: Ship) =>
          buff(s, 'debuff:senbonzakura', 8, (m) => {
            m.apTakenMul *= 1.3;
            m.noBounce = true;
          });
        for (const t of prey) droneDive(ship, game, t, 6, 6000, st.spec, 0.8, cut);
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 2800).filter((s) => !s.submerged).length >= 1;
      },
    },
  ),

  // ------------------------------------------------------------------ Oboro
  def(
    {
      id: 'phantomBattery',
      name: 'Phantom Battery',
      short: 'PHANTOM',
      description: 'The guns reload at once. For 10 s, every shell that hits is shadowed by a phantom strike on the same spot a moment later, worth 60% of an AP round.',
      cooldown: 20,
      duration: 10,
      accent: 0xc8203a,
      icon: 'salvo',
    },
    {
      activate(ship, game, st) {
        const echo = (ship.spec.main?.ap?.damage ?? 3000) * 0.6;
        for (const t of ship.turrets) t.reload = 0;
        ship.salvo = {
          skill: st.spec,
          left: 999,
          dispersionMul: 1,
          damageMul: 1,
          railgun: false,
          guaranteedFire: false,
          cluster: false,
          onHit: (_t, x, z) => {
            game.strikes.spawn(ship, { kind: 'rod', skill: st.spec, x, z, radius: 60, delay: 0.4, damage: echo });
          },
        };
      },
      end(ship, _g, st) {
        if (ship.salvo?.skill === st.spec) ship.salvo = null;
      },
      aiShouldUse(ship, _g, target) {
        return targetInGunRange(ship, target, 0.8) && !target!.submerged;
      },
    },
  ),
  def(
    {
      id: 'shadowSwap',
      name: 'Shadow Swap',
      short: 'SHADOW SWAP',
      description: 'Trade places with the enemy under the reticle (2 km). It comes out of the swap dazed: stunned 1.5 s.',
      cooldown: 20,
      duration: 0,
      accent: 0x9a2a4a,
      icon: 'swap',
    },
    {
      activate(ship, game, st) {
        const t = reticleTarget(ship, game, 2000, 400);
        if (!t || t.spec.cls === 'TT' || t.deep) return false;
        swapPlaces(ship, t, game);
        stun(t, 1.5);
        arc(game, ship, t, st.spec.accent);
      },
      aiShouldUse(ship, game, target) {
        // Swap with a ship that has us in a crossfire, or pull one out of its formation.
        return within(ship, target, 1800) && target.spec.cls !== 'TT' && !target.deep && underFire(ship, game, 800) >= 4;
      },
    },
  ),
  def(
    {
      id: 'tsukuyomiGate',
      name: 'Tsukuyomi Gate',
      short: 'TSUKUYOMI',
      description: 'The moon gate opens: every enemy within 1.5 km takes 15k, is flung to a point 1.5 km away and stunned 2 s.',
      ult: true,
      cooldown: 85,
      duration: 0,
      accent: 0xb070ff,
      icon: 'portal',
      zone: 1500,
    },
    {
      activate(ship, game, st) {
        const prey = enemiesWithin(ship, game, 1500).filter((s) => !s.deep);
        if (!prey.length) return false;
        for (const s of prey) {
          hurt(ship, s, 15000, st.spec);
          if (!s.alive) continue;
          if (s.spec.cls !== 'TT') landNear(s, game, ship.pos.x, ship.pos.z, 1500, bearingTo(ship.pos.x, ship.pos.z, s.pos.x, s.pos.z) + (game.rng() - 0.5));
          stun(s, 2);
        }
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 1300).filter((s) => !s.deep).length >= 2 || (enemiesWithin(ship, game, 1000).length >= 1 && ship.hp < ship.maxHp * 0.4);
      },
    },
  ),

  // ------------------------------------------------------------------ Kunai
  def(
    {
      id: 'shunpo',
      name: 'Shunpo',
      short: 'SHUNPO',
      description: 'Flash step to the reticle, up to 700 m away in any direction.',
      cooldown: 12,
      duration: 0,
      accent: 0xff3a5a,
      icon: 'blink',
    },
    {
      activate(ship, game) {
        const p = aimPoint(ship, 700);
        return blinkTo(ship, game, p.x, p.z);
      },
      aiShouldUse(ship, game, target) {
        // In: close to torpedo range. Out: when the shells start converging.
        return (within(ship, target, 3500) && !within(ship, target, 1800)) || underFire(ship, game, 600) >= 6;
      },
    },
  ),
  def(
    {
      id: 'venomTorps',
      name: 'Venom Torpedoes',
      short: 'VENOM',
      description: 'The next spread is laced with nanite venom: each ship it hits corrodes 1.2% of its hull a second for 8 s (4k at most; one dose per ship) and cannot repair.',
      cooldown: 18,
      duration: 12,
      accent: 0x9aff3a,
      icon: 'torpedo',
    },
    {
      activate(ship, game, st) {
        if (!ship.spec.torpedoes) return false;
        const dosed: Ship[] = [];
        ship.torpBuff = {
          skill: st.spec,
          speedMul: 1,
          spreads: 1,
          onHit: (t) => {
            if (dosed.includes(t)) return;
            dosed.push(t);
            clingTo(ship, game, t, Math.min(4000, t.maxHp * 0.012), 8, st.spec, { healBlock: true });
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
      id: 'shadowAssassination',
      name: 'Shadow Assassination',
      short: 'ASSASSINATE',
      description: 'Vanish for 3 s, then strike from 250 m behind the enemy under the reticle (3 km): 18% of its hull (60k at most) and four homing lances at point blank.',
      ult: true,
      cooldown: 85,
      duration: 3,
      accent: 0xff1a3a,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        const t = reticleTarget(ship, game, 3000, 600);
        if (!t) return false;
        st.data.t = t;
      },
      update(ship, _g, _dt, st) {
        buff(ship, st.spec.id, 0.3, (m) => {
          m.untargetable = true;
          m.speedMul *= 1.3;
        });
      },
      end(ship, game, st) {
        const t = st.data.t as Ship;
        if (!ship.alive || !t.alive) return;
        landNear(ship, game, t.pos.x, t.pos.z, 250, t.heading + Math.PI);
        hurt(ship, t, Math.min(60000, t.maxHp * 0.18), st.spec);
        arc(game, ship, t, st.spec.accent);
        const spec = ship.spec.torpedoes;
        if (!spec || !t.alive) return;
        const h = bearingTo(ship.pos.x, ship.pos.z, t.pos.x, t.pos.z);
        for (let i = 0; i < 4; i++) {
          const tp = game.torps.launch(ship, ship.pos.x, ship.pos.z, h + (i - 1.5) * 0.06, spec, t);
          tp.skill = st.spec;
          tp.look = 'lance';
        }
      },
      aiShouldUse(ship, _g, target) {
        return within(ship, target, 2800) && target.hp > target.maxHp * 0.25;
      },
    },
  ),

  // ------------------------------------------------------------------ Shiden
  def(
    {
      id: 'shinobiDrones',
      name: 'Shinobi Drones',
      short: 'SHINOBI',
      description: 'The next dive squadron does not bomb: its drones fly straight into the target hull for double the payload, and are spent.',
      cooldown: 16,
      duration: 0,
      accent: 0xff3a5a,
      icon: 'drone',
    },
    {
      activate(ship, game, st) {
        if (!ship.spec.air) return false;
        ship.airBuff = {
          skill: st.spec,
          types: ['dive'],
          onDrop: (sq, t) => {
            hurt(ship, t, sq.spec.damage * sq.planes * sq.damageMul * 2, st.spec);
            game.events.emit('explosion', { x: t.pos.x, y: t.spec.freeboard, z: t.pos.z, size: 1.6 });
            sq.alive = false;
          },
        };
      },
      aiShouldUse(ship, _g, target) {
        const air = ship.spec.air;
        return !!air && !!ship.air && ship.air.hangar.dive > 0 && within(ship, target, air.range * 0.9) && !target.submerged;
      },
    },
  ),
  def(
    {
      id: 'shurikenFan',
      name: 'Shuriken Fan',
      short: 'SHURIKEN',
      description: 'Twelve shuriken drones fan out 60 degrees toward the reticle, 2.5 km deep: 5k each, and a hull they hit has its AA blinded for 6 s.',
      cooldown: 16,
      duration: 0,
      accent: 0xf2f4f6,
      icon: 'blade',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, 2500);
        const brg = bearingTo(ship.pos.x, ship.pos.z, p.x, p.z);
        const blind = (s: Ship) =>
          buff(s, 'debuff:shuriken', 6, (m) => {
            m.aaMul = 0;
          });
        for (let i = 0; i < 12; i++) {
          const b = brg + ((i / 11 - 0.5) * Math.PI) / 3;
          const ex = ship.pos.x + forwardX(b) * 2500;
          const ez = ship.pos.z + forwardZ(b) * 2500;
          const near = (s: Ship) => (s.pos.x - ship.pos.x) * (s.pos.x - ship.pos.x) + (s.pos.z - ship.pos.z) * (s.pos.z - ship.pos.z);
          const hit = enemiesOnLine(ship, game, ship.pos.x, ship.pos.z, ex, ez, 40)
            .filter((s) => !s.submerged && !s.mods.untargetable)
            .sort((a, c) => near(a) - near(c))[0];
          game.missiles.launch(ship, hit?.pos.x ?? ex, hit?.pos.z ?? ez, i * 0.04, 5000, { profile: 'skim', speed: 380, look: 'drone', blast: 40, fire: 0, target: hit ?? null, skill: st.spec, onHit: blind, hp: 300 });
        }
      },
      aiShouldUse(ship, game, target) {
        return within(ship, target, 2300) && !target.submerged && enemiesAround(ship, game, target.pos.x, target.pos.z, 900).length >= 1;
      },
    },
  ),
  def(
    {
      id: 'raidenSwarm',
      name: 'Raiden Swarm',
      short: 'RAIDEN',
      description: 'Thirty thunder drones dive on the five enemies nearest the reticle: 5k each, and every hit arcs 3k on to the nearest other enemy within 600 m.',
      ult: true,
      cooldown: 85,
      duration: 0,
      accent: 0x8ab0ff,
      icon: 'lightning',
    },
    {
      activate(ship, game, st) {
        const p = aimPoint(ship, ship.spec.air?.range ?? 6000);
        const prey = enemiesAround(ship, game, p.x, p.z, 2500).filter((s) => !s.submerged).slice(0, 5);
        if (!prey.length) return false;
        const jump = (s: Ship) => {
          let best: Ship | null = null;
          let bd = 600;
          for (const o of game.ships) {
            if (!o.alive || o === s || o.team === ship.team || o.deep) continue;
            const d = Math.hypot(o.pos.x - s.pos.x, o.pos.z - s.pos.z);
            if (d < bd) {
              bd = d;
              best = o;
            }
          }
          if (!best) return;
          arc(game, s, best, st.spec.accent, false);
          hurt(ship, best, 3000, st.spec);
        };
        for (let i = 0; i < 30; i++) droneDive(ship, game, prey[i % prey.length], 1, 5000, st.spec, 0, jump)[0].delay = i * 0.06;
      },
      aiShouldUse(ship, game, target) {
        const air = ship.spec.air;
        return !!air && within(ship, target, air.range * 0.9) && !target.submerged && enemiesAround(ship, game, target.pos.x, target.pos.z, 2500).length >= 1;
      },
    },
  ),

  // ------------------------------------------------------------------ Kage
  def(
    {
      id: 'inkCloud',
      name: 'Ink Cloud',
      short: 'INK CLOUD',
      description: 'Vent a 400 m cloud of black nanite ink: you vanish from every lock for 6 s, and enemy guns inside it scatter 3x.',
      cooldown: 18,
      duration: 6,
      accent: 0x3a3e48,
      icon: 'cloak',
      zone: 400,
    },
    {
      activate(ship, game, st) {
        game.fields.add(ship, { x: ship.pos.x, z: ship.pos.z, r: 400, life: st.spec.duration, skill: st.spec, look: 'mist', color: 0x1a1c22, scatter: 3 });
      },
      update(ship, _g, _dt, st) {
        buff(ship, st.spec.id, 0.3, (m) => {
          m.untargetable = true;
        });
      },
      aiShouldUse(ship, game) {
        return underFire(ship, game, 700) >= 4 || !!nearestEnemy(ship, game, 900);
      },
    },
  ),
  def(
    {
      id: 'kageBunshin',
      name: 'Kage Bunshin',
      short: 'BUNSHIN',
      description: 'A shadow clone of your boat runs beside you for 10 s. It draws every eye and homing weapon in range, and fights with your tubes.',
      cooldown: 22,
      duration: 0,
      accent: 0x8a8e98,
      icon: 'fleet',
    },
    {
      activate(ship, game) {
        if (ship.isSummon) return false;
        const c = game.spawnWingman(ship, 140, 10, 40, ship.spec.id, `${ship.name} Bunshin`);
        c.depthState = 0;
        buff(c, 'bunshin', 999, (m) => {
          m.taunt = true;
        });
      },
      aiShouldUse(ship, game) {
        return !!nearestEnemy(ship, game, 3000);
      },
    },
  ),
  def(
    {
      id: 'benihana',
      name: 'Benihana',
      short: 'BENIHANA',
      description: 'A crimson flower blooms: 24 plasma lances burst out in every direction. 15k each, and they stun what they hit for 2 s.',
      ult: true,
      cooldown: 85,
      duration: 0,
      accent: 0xff2040,
      icon: 'torpedo',
    },
    {
      activate(ship, game, st) {
        const spec = ship.spec.torpedoes;
        if (!spec) return false;
        const lance = { ...spec, damage: 15000, speed: Math.max(spec.speed, 60) };
        for (let i = 0; i < 24; i++) {
          const tp = game.torps.launch(ship, ship.pos.x, ship.pos.z, ship.heading + (i / 24) * Math.PI * 2, lance);
          tp.skill = st.spec;
          tp.look = 'lance';
          tp.onHit = (s) => stun(s, 2);
        }
      },
      aiShouldUse(ship, game) {
        return enemiesWithin(ship, game, 1800).filter((s) => !s.deep).length >= 1;
      },
    },
  ),
];
