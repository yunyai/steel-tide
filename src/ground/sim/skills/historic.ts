import {
  aimPoint,
  alliesWithin,
  barrage,
  buff,
  clusterAround,
  dist,
  enemiesAtAim,
  enemiesWithin,
  forward,
  hpFrac,
  hurtAllies,
  inRange,
  nextShots,
  rocketVolley,
  strikeAt,
  underFire,
  weaponRange,
} from './kit';
import { gdef, type GroundSkillDef } from './types';

// Tiger II, T-34-85, M24 Chaffee, Archer, Type 4 Ho-Ro, Katyusha BM-13, Churchill AVRE.

export const HISTORIC_GROUND_SKILLS: GroundSkillDef[] = [
  // ------------------------------------------------------------------ Tiger II
  gdef(
    {
      id: 'zimmeritBrace',
      name: 'Zimmerit Brace',
      short: 'ZIMMERIT',
      description: '8 s: take 40% less damage; crits are cleared and cannot happen.',
      cooldown: 22,
      duration: 8,
      accent: 0xd8c08a,
      icon: 'shield',
    },
    {
      activate(v, _g, st) {
        v.crits.tracks = v.crits.fire = 0;
        buff(v, st.spec.id, st.spec.duration, (m) => {
          m.damageTakenMul *= 0.6;
          m.critImmune = true;
        });
      },
      aiShouldUse(v, g) {
        return (underFire(v, g) && hpFrac(v) < 0.8) || v.crits.tracks > 0 || v.crits.fire > 0;
      },
    },
  ),
  gdef(
    {
      id: 'flakBurst',
      name: '88 Flak Burst',
      short: 'FLAK 88',
      description: 'Loads at once. The next 3 rounds burst in the air beside the target, 14 m blast, +20% damage.',
      cooldown: 16,
      duration: 0,
      accent: 0xffc35a,
      icon: 'flak',
    },
    {
      activate(v, _g, st) {
        v.reload = Math.min(v.reload, 0.2);
        nextShots(v, st.spec, 3, { airburst: 14, damageMul: 1.2, instant: true });
      },
      aiShouldUse(v, _g, t) {
        return inRange(v, t, weaponRange(v) * 0.7);
      },
    },
  ),
  gdef(
    {
      id: 'konigstigerStampede',
      name: 'Königstiger Stampede',
      short: 'STAMPEDE',
      description: '10 s: unstoppable charge at +60% speed. Rams hit 3× harder and flatten houses, reload halved, 40% less damage taken.',
      ult: true,
      cooldown: 120,
      duration: 10,
      accent: 0xff6a3a,
      icon: 'ram',
    },
    {
      activate(v, _g, st) {
        v.crits.tracks = 0;
        buff(v, st.spec.id, st.spec.duration, (m) => {
          m.unstoppable = true;
          m.speedMul *= 1.6;
          m.accelMul *= 2.2;
          m.turnMul *= 1.3;
          m.ramMul *= 3;
          m.ramSkill = st.spec;
          m.reloadMul *= 0.5;
          m.damageTakenMul *= 0.6;
        });
      },
      aiShouldUse(v, g, t) {
        return inRange(v, t, 450) || enemiesWithin(v, g, 300).length >= 2;
      },
    },
  ),

  // ------------------------------------------------------------------ T-34-85
  gdef(
    {
      id: 'ura',
      name: 'Ura!',
      short: 'URA!',
      description: '6 s: +50% speed, double acceleration and turret traverse, and the aim circle shrinks on the move.',
      cooldown: 18,
      duration: 6,
      accent: 0xff4a3a,
      icon: 'speed',
    },
    {
      activate(v, _g, st) {
        buff(v, st.spec.id, st.spec.duration, (m) => {
          m.speedMul *= 1.5;
          m.accelMul *= 2;
          m.turnMul *= 1.4;
          m.traverseMul *= 2;
          m.dispersionMul *= 0.6;
        });
      },
      aiShouldUse(v, g, t) {
        return (!!t && dist(v, t) > 350) || (underFire(v, g) && hpFrac(v) < 0.5);
      },
    },
  ),
  gdef(
    {
      id: 'desantSatchels',
      name: 'Desant Satchels',
      short: 'SATCHELS',
      description: 'Riders hurl demolition charges at the crosshair (up to 140 m): 750 damage over 11 m, brings down houses.',
      cooldown: 16,
      duration: 0,
      accent: 0xc9a46a,
      icon: 'mine',
    },
    {
      activate(v, g, st) {
        const a = aimPoint(v, 140);
        strikeAt(v, g, st.spec, a.x, a.z, { r: 11, delay: 1.1, damage: 750, kind: 'satchel', props: 4, knock: 7 });
      },
      aiShouldUse(v, _g, t) {
        return inRange(v, t, 130);
      },
    },
  ),
  gdef(
    {
      id: 'steelAvalanche',
      name: 'Steel Avalanche',
      short: 'AVALANCHE',
      description: 'Six T-34s roll in behind you and fight at your side for 25 s.',
      ult: true,
      cooldown: 120,
      duration: 25,
      accent: 0xd0302a,
      icon: 'fleet',
    },
    {
      activate(v, g, st) {
        const slots: [number, number][] = [
          [-14, 18],
          [14, 18],
          [-28, 30],
          [28, 30],
          [-10, 42],
          [10, 42],
        ];
        for (const [right, back] of slots) g.spawnWingman(v, 't34_85', right, back, st.spec.duration, 'Avalanche T-34');
      },
      aiShouldUse(v, g) {
        return enemiesWithin(v, g, 700).length >= 1;
      },
    },
  ),

  // ------------------------------------------------------------------ M24 Chaffee
  gdef(
    {
      id: 'smokeDash',
      name: 'Smoke and Dash',
      short: 'SMOKE DASH',
      description: 'Drop a smoke screen and sprint: +70% speed for 4 s.',
      cooldown: 18,
      duration: 4,
      accent: 0xb8c4cc,
      icon: 'cloak',
    },
    {
      activate(v, g, st) {
        const [fx, fz] = forward(v);
        for (const k of [-1, 0, 1]) g.addSmoke(v.x - fx * 6 - fz * k * 16, v.z - fz * 6 + fx * k * 16, v.team);
        buff(v, st.spec.id, st.spec.duration, (m) => {
          m.speedMul *= 1.7;
          m.accelMul *= 2.5;
          m.turnMul *= 1.3;
        });
      },
      aiShouldUse(v, g) {
        return underFire(v, g) && hpFrac(v) < 0.65;
      },
    },
  ),
  gdef(
    {
      id: 'spotterFlare',
      name: 'Spotter Flare',
      short: 'FLARE',
      description: 'A flare over the crosshair (up to 600 m): enemies within 80 m take 25% more damage from everyone for 10 s.',
      cooldown: 20,
      duration: 0,
      accent: 0xffe27a,
      icon: 'reveal',
    },
    {
      activate(v, g, st) {
        const hit = enemiesAtAim(v, g, 600, 80);
        for (const e of hit) e.addEffect('marked', 10, (m) => (m.marked *= 1.25));
        const a = aimPoint(v, 600);
        g.events.emit('lightning', { points: [{ x: a.x, y: g.terrain.heightAt(a.x, a.z) + 60, z: a.z }], color: st.spec.accent });
      },
      aiShouldUse(v, g, t) {
        return inRange(v, t, 600) && clusterAround(v, g, t, 80) >= 1;
      },
    },
  ),
  gdef(
    {
      id: 'thunderboltRun',
      name: 'Thunderbolt Run',
      short: 'THUNDERBOLT',
      description: 'P-47s rocket a 320 m strip from you toward the crosshair: 24 rockets, 450 damage each.',
      ult: true,
      cooldown: 120,
      duration: 0,
      accent: 0x7ab8ff,
      icon: 'plane',
    },
    {
      activate(v, g, st) {
        const c = v.control;
        const bearing = Math.atan2(c.aimX - v.x, -(c.aimZ - v.z));
        const sx = Math.sin(bearing);
        const sz = -Math.cos(bearing);
        const start = Math.max(40, Math.min(500, Math.hypot(c.aimX - v.x, c.aimZ - v.z)) - 160);
        for (let i = 0; i < 24; i++) {
          const along = start + (i / 23) * 320;
          const lateral = (i % 3) - 1;
          const x = v.x + sx * along - sz * lateral * 9 + (g.rng() - 0.5) * 6;
          const z = v.z + sz * along + sx * lateral * 9 + (g.rng() - 0.5) * 6;
          strikeAt(v, g, st.spec, x, z, { r: 13, delay: 2 + i * 0.07, damage: 450, kind: 'rocket', props: 1.5, knock: 5 });
        }
      },
      aiShouldUse(v, g, t) {
        return inRange(v, t, 650) && (clusterAround(v, g, t, 100) >= 2 || hpFrac(t) < 0.5);
      },
    },
  ),

  // ------------------------------------------------------------------ Archer
  gdef(
    {
      id: 'shootAndScoot',
      name: 'Shoot and Scoot',
      short: 'SCOOT',
      description: 'Loads at once; 6 s of +50% speed, full speed in reverse and reload halved.',
      cooldown: 18,
      duration: 6,
      accent: 0x9ad08a,
      icon: 'speed',
    },
    {
      activate(v, _g, st) {
        v.reload = Math.min(v.reload, 0.2);
        buff(v, st.spec.id, st.spec.duration, (m) => {
          m.fastReverse = true;
          m.speedMul *= 1.5;
          m.accelMul *= 2;
          m.reloadMul *= 0.5;
        });
      },
      aiShouldUse(v, g, t) {
        return (underFire(v, g) && hpFrac(v) < 0.7) || (inRange(v, t, weaponRange(v)) && v.reload > 2);
      },
    },
  ),
  gdef(
    {
      id: 'apdsSabot',
      name: 'APDS Sabot',
      short: 'SABOT',
      description: 'Loads at once. The next round ignores angling and nothing ricochets: +50% penetration, +40% damage.',
      cooldown: 14,
      duration: 0,
      accent: 0xe8f0ff,
      icon: 'beam',
    },
    {
      activate(v, _g, st) {
        v.reload = Math.min(v.reload, 0.2);
        nextShots(v, st.spec, 1, { ignoreAngle: true, penMul: 1.5, damageMul: 1.4, instant: true });
      },
      aiShouldUse(v, _g, t) {
        return inRange(v, t, weaponRange(v) * 0.9) && (t.titan || t.spec.cls === 'HT' || hpFrac(t) < 0.4);
      },
    },
  ),
  gdef(
    {
      id: 'montysLongShot',
      name: "Monty's Long Shot",
      short: 'LONG SHOT',
      description: '3 rounds in quick succession that punch through every tank and house in their path: triple penetration, double damage.',
      ult: true,
      cooldown: 120,
      duration: 15,
      accent: 0xffd34a,
      icon: 'rod',
    },
    {
      activate(v, _g, st) {
        v.reload = Math.min(v.reload, 0.2);
        nextShots(v, st.spec, 3, { pierce: true, penMul: 3, damageMul: 2, ignoreAngle: true, instant: true });
      },
      end(v, _g, st) {
        if (v.shotBuff?.skill === st.spec) v.shotBuff = null;
      },
      aiShouldUse(v, _g, t) {
        return inRange(v, t, weaponRange(v) * 0.9);
      },
    },
  ),

  // ------------------------------------------------------------------ Type 4 Ho-Ro
  gdef(
    {
      id: 'creepingBarrage',
      name: 'Creeping Barrage',
      short: 'CREEPING',
      description: 'A line of shells walks 100 m forward from the crosshair: 5 rows of 4, 380 damage each.',
      cooldown: 20,
      duration: 0,
      accent: 0xff9a4a,
      icon: 'strike',
    },
    {
      activate(v, g, st) {
        const a = aimPoint(v, weaponRange(v));
        const d = Math.hypot(a.x - v.x, a.z - v.z) || 1;
        const ux = (a.x - v.x) / d;
        const uz = (a.z - v.z) / d;
        for (let row = 0; row < 5; row++) {
          for (let k = 0; k < 4; k++) {
            const lat = (k - 1.5) * 14;
            const x = a.x + ux * (row * 22 - 22) - uz * lat + (g.rng() - 0.5) * 5;
            const z = a.z + uz * (row * 22 - 22) + ux * lat + (g.rng() - 0.5) * 5;
            strikeAt(v, g, st.spec, x, z, { r: 10, delay: 2 + row * 0.8 + k * 0.05, damage: 380, kind: 'shell', props: 1.5, crater: 0.8 });
          }
        }
      },
      aiShouldUse(v, g, t) {
        return inRange(v, t, weaponRange(v)) && (clusterAround(v, g, t, 60) >= 2 || Math.abs(t.speed) < 2);
      },
    },
  ),
  gdef(
    {
      id: 'smokeCurtain',
      name: 'Smoke Curtain',
      short: 'CURTAIN',
      description: 'Smoke shells lay a 120 m screen across the line of fire at the crosshair.',
      cooldown: 22,
      duration: 0,
      accent: 0xc8ccd0,
      icon: 'wall',
    },
    {
      activate(v, g, _st) {
        const a = aimPoint(v, weaponRange(v));
        const d = Math.hypot(a.x - v.x, a.z - v.z) || 1;
        const ux = (a.x - v.x) / d;
        const uz = (a.z - v.z) / d;
        for (let k = -2; k <= 2; k++) g.addSmoke(a.x - uz * k * 26, a.z + ux * k * 26, v.team, 30, 26);
      },
      aiShouldUse(v, g, t) {
        if (!t) return false;
        return alliesWithin(v, g, 2000).some((a) => a !== v && hpFrac(a) < 0.45 && Math.hypot(a.x - t.x, a.z - t.z) < 250);
      },
    },
  ),
  gdef(
    {
      id: 'tenchuBarrage',
      name: 'Tenchu Barrage',
      short: 'TENCHU',
      description: '12 heavy shells saturate 45 m around the crosshair: 750 damage each, stun 2.5 s, craters and fallen houses.',
      ult: true,
      cooldown: 120,
      duration: 0,
      accent: 0xff3a5a,
      icon: 'meteor',
    },
    {
      activate(v, g, st) {
        const a = aimPoint(v, weaponRange(v) * 1.1);
        barrage(v, g, st.spec, a.x, a.z, 45, 12, 0.14, { r: 16, delay: 2.4, damage: 750, kind: 'shell', props: 2.5, stun: 2.5, crater: 1.6, knock: 6 });
      },
      aiShouldUse(v, g, t) {
        return inRange(v, t, weaponRange(v)) && (clusterAround(v, g, t, 60) >= 2 || t.titan || hpFrac(t) < 0.6);
      },
    },
  ),

  // ------------------------------------------------------------------ Katyusha BM-13
  gdef(
    {
      id: 'stalinsOrgan',
      name: "Stalin's Organ",
      short: 'ORGAN',
      description: 'Two full salvos at once: 32 rockets onto the crosshair, +20% damage. Rails reload at once after.',
      cooldown: 18,
      duration: 0,
      accent: 0xff5040,
      icon: 'salvo',
    },
    {
      activate(v, g, st) {
        const l = v.spec.launcher;
        if (!l) return false;
        const a = aimPoint(v, l.range);
        const d = Math.hypot(a.x - v.x, a.z - v.z);
        rocketVolley(v, g, st.spec, l.salvo * 2, { x: a.x, z: a.z, r: Math.max(12, (l.spread * d) / 100), damage: l.damage * 1.2, splash: l.splash, pen: l.pen, interval: l.interval * 0.6 });
        v.launcherReload = 0;
      },
      aiShouldUse(v, _g, t) {
        return inRange(v, t, (v.spec.launcher?.range ?? 0) * 0.9);
      },
    },
  ),
  gdef(
    {
      id: 'incendiaryRockets',
      name: 'Incendiary Rockets',
      short: 'INCENDIARY',
      description: '16 fire rockets carpet the crosshair: every one leaves a patch of fire burning for 6 s.',
      cooldown: 20,
      duration: 0,
      accent: 0xff8a2a,
      icon: 'nuke',
    },
    {
      activate(v, g, st) {
        const l = v.spec.launcher;
        if (!l) return false;
        const a = aimPoint(v, l.range);
        rocketVolley(v, g, st.spec, 16, { x: a.x, z: a.z, r: 34, damage: l.damage, splash: l.splash, pen: l.pen, interval: l.interval, fire: true });
      },
      aiShouldUse(v, g, t) {
        return inRange(v, t, (v.spec.launcher?.range ?? 0) * 0.9) && (clusterAround(v, g, t, 50) >= 2 || Math.abs(t.speed) < 2);
      },
    },
  ),
  gdef(
    {
      id: 'frontStorm',
      name: 'Front Storm',
      short: 'FRONT STORM',
      description: 'Phantom batteries behind the line fire 80 rockets over 70 m around the crosshair: 320 damage each.',
      ult: true,
      cooldown: 120,
      duration: 0,
      accent: 0xff2a2a,
      icon: 'salvo',
    },
    {
      activate(v, g, st) {
        const l = v.spec.launcher;
        const a = aimPoint(v, (l?.range ?? 1200) * 1.2);
        const home = v.team === 0 ? -1 : 1;
        rocketVolley(v, g, st.spec, 80, {
          x: a.x,
          z: a.z,
          r: 70,
          damage: 320,
          splash: 9,
          pen: 60,
          speed: 220,
          interval: 0.07,
          props: 1,
          from: (i) => {
            const lane = ((i % 8) - 3.5) * 30;
            const bx = v.x + home * 260 + (g.rng() - 0.5) * 20;
            const bz = v.z + lane;
            return { x: bx, y: g.terrain.heightAt(bx, bz) + 3, z: bz };
          },
        });
      },
      aiShouldUse(v, g, t) {
        return inRange(v, t, (v.spec.launcher?.range ?? 0) * 1.1) && (clusterAround(v, g, t, 80) >= 2 || t.titan);
      },
    },
  ),

  // ------------------------------------------------------------------ Churchill AVRE
  gdef(
    {
      id: 'fieldWorkshop',
      name: 'Field Workshop',
      short: 'WORKSHOP',
      description: '8 s: allies within 45 m repair 4% of their HP a second and have their crits cleared.',
      cooldown: 22,
      duration: 8,
      accent: 0x7dffa0,
      icon: 'heal',
      zone: 45,
    },
    {
      activate(v, g, st) {
        g.fields.add({ owner: v, x: v.x, z: v.z, r: 45, life: st.spec.duration, follow: v, allyHeal: 0.04, clearCrits: true, color: st.spec.accent, skill: st.spec });
      },
      aiShouldUse(v, g) {
        return hurtAllies(v, g, 60, 0.75).some((a) => a !== v) || hpFrac(v) < 0.6;
      },
    },
  ),
  gdef(
    {
      id: 'bocageWall',
      name: 'Bocage Wall',
      short: 'BOCAGE',
      description: 'Raise a 26 m earth-and-hedge wall 14 m ahead, across the line to the crosshair. Stops rounds for 20 s.',
      cooldown: 18,
      duration: 0,
      accent: 0x6aa04a,
      icon: 'wall',
    },
    {
      activate(v, g, _st) {
        const c = v.control;
        const d = Math.hypot(c.aimX - v.x, c.aimZ - v.z) || 1;
        const ux = (c.aimX - v.x) / d;
        const uz = (c.aimZ - v.z) / d;
        // A prop's long (hw) axis runs along (cos rot, sin rot); lay it across the line of fire.
        g.raiseWall(v, v.x + ux * 14, v.z + uz * 14, 26, Math.atan2(ux, -uz), 20, 5000, 1);
      },
      aiShouldUse(v, g, t) {
        return underFire(v, g) && inRange(v, t, 600);
      },
    },
  ),
  gdef(
    {
      id: 'overlord',
      name: 'Overlord',
      short: 'OVERLORD',
      description: '10 s: every ally within 150 m gets a shield of 40% of its HP, reloads 40% faster and deals 20% more damage.',
      ult: true,
      cooldown: 120,
      duration: 10,
      accent: 0x8ac8ff,
      icon: 'fleet',
      zone: 150,
    },
    {
      activate(v, g, st) {
        for (const a of alliesWithin(v, g, 150)) {
          a.addShield(a.maxHp * 0.4, st.spec.duration);
          a.addEffect(st.spec.id, st.spec.duration, (m) => {
            m.reloadMul *= 0.6;
            m.damageMul *= 1.2;
          });
        }
      },
      aiShouldUse(v, g) {
        return alliesWithin(v, g, 150).length >= 3 && enemiesWithin(v, g, 700).length >= 2;
      },
    },
  ),
];
