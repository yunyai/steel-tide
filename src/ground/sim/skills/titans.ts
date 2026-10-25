import {
  aimPoint,
  barrage,
  buff,
  clusterAround,
  enemiesAtAim,
  enemiesWithin,
  hpFrac,
  inRange,
  strikeAt,
  underFire,
  weaponRange,
} from './kit';
import { gdef, type GroundSkillDef } from './types';

// Landkreuzer P.1000 Ratte: six normal skills, three ultimates.

export const GROUND_TITAN_SKILLS: GroundSkillDef[] = [
  gdef(
    {
      id: 'flakWall',
      name: 'Flak Wall',
      short: 'FLAK WALL',
      description: '10 s: the flak batteries shoot down 80% of shells and missiles coming within 60 m.',
      cooldown: 20,
      duration: 10,
      accent: 0xffd27a,
      icon: 'flak',
      zone: 60,
    },
    {
      activate(v, _g, st) {
        buff(v, st.spec.id, st.spec.duration, (m) => {
          m.aps = Math.max(m.aps, 0.8);
          m.apsRange = Math.max(m.apsRange, 60);
        });
      },
      aiShouldUse(v, g) {
        return underFire(v, g) || g.missiles.list.some((m) => m.owner.team !== v.team && Math.hypot(m.x - v.x, m.z - v.z) < 300);
      },
    },
  ),
  gdef(
    {
      id: 'crushingTreads',
      name: 'Crushing Treads',
      short: 'TREADS',
      description: '8 s: +80% speed, rams hit 3× harder, and anything within 20 m of the treads takes 140 damage a second.',
      cooldown: 18,
      duration: 8,
      accent: 0xa08a6a,
      icon: 'ram',
      zone: 20,
    },
    {
      activate(v, g, st) {
        buff(v, st.spec.id, st.spec.duration, (m) => {
          m.speedMul *= 1.8;
          m.accelMul *= 2;
          m.ramMul *= 3;
          m.ramSkill = st.spec;
        });
        g.fields.add({ owner: v, x: v.x, z: v.z, r: 20, life: st.spec.duration, follow: v, enemyDps: 140, color: st.spec.accent, skill: st.spec });
      },
      aiShouldUse(v, g) {
        return enemiesWithin(v, g, 200).length >= 1;
      },
    },
  ),
  gdef(
    {
      id: 'barrage128',
      name: '128 mm Barrage',
      short: '128 BARRAGE',
      description: 'The secondary turrets drop 10 shells over 30 m around the crosshair: 340 damage each.',
      cooldown: 14,
      duration: 0,
      accent: 0xff9a4a,
      icon: 'strike',
    },
    {
      activate(v, g, st) {
        const a = aimPoint(v, weaponRange(v));
        barrage(v, g, st.spec, a.x, a.z, 30, 10, 0.12, { r: 9, delay: 1, damage: 340, kind: 'shell', props: 1.5 });
      },
      aiShouldUse(v, _g, t) {
        return inRange(v, t, weaponRange(v));
      },
    },
  ),
  gdef(
    {
      id: 'panzerEscort',
      name: 'Panzer Escort',
      short: 'ESCORT',
      description: 'Two Tiger IIs join the Ratte for 30 s.',
      cooldown: 45,
      duration: 30,
      accent: 0xd8c08a,
      icon: 'fleet',
    },
    {
      activate(v, g, st) {
        g.spawnWingman(v, 'tiger2', -22, 10, st.spec.duration, 'Escort Tiger');
        g.spawnWingman(v, 'tiger2', 22, 10, st.spec.duration, 'Escort Tiger');
      },
      aiShouldUse(v, g) {
        return enemiesWithin(v, g, 800).length >= 1;
      },
    },
  ),
  gdef(
    {
      id: 'smokeBattery',
      name: 'Smoke Battery',
      short: 'SMOKE',
      description: 'A ring of smoke around the hull, and 6 s of 30% less damage taken.',
      cooldown: 25,
      duration: 6,
      accent: 0xb8c4cc,
      icon: 'cloak',
    },
    {
      activate(v, g, st) {
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          g.addSmoke(v.x + Math.sin(a) * 34, v.z - Math.cos(a) * 34, v.team, 30, 24);
        }
        buff(v, st.spec.id, st.spec.duration, (m) => (m.damageTakenMul *= 0.7));
      },
      aiShouldUse(v, g) {
        return underFire(v, g) && (hpFrac(v) < 0.85 || enemiesWithin(v, g, 500).length >= 2);
      },
    },
  ),
  gdef(
    {
      id: 'ironRam',
      name: 'Iron Ram',
      short: 'IRON RAM',
      description: '3 s lunge at 2.5× speed; rams hit 5× harder.',
      cooldown: 16,
      duration: 3,
      accent: 0xc8d6e8,
      icon: 'ram',
    },
    {
      activate(v, _g, st) {
        buff(v, st.spec.id, st.spec.duration, (m) => {
          m.speedMul *= 2.5;
          m.accelMul *= 6;
          m.ramMul *= 5;
          m.ramSkill = st.spec;
        });
      },
      aiShouldUse(v, _g, t) {
        if (!inRange(v, t, 160)) return false;
        const want = Math.atan2(t.x - v.x, -(t.z - v.z));
        return Math.abs(Math.atan2(Math.sin(want - v.heading), Math.cos(want - v.heading))) < 0.35;
      },
    },
  ),
  // Ultimates.
  gdef(
    {
      id: 'schwererGustav',
      name: 'Schwerer Gustav',
      short: 'GUSTAV',
      description: 'An 800 mm shell falls on the crosshair after 4 s: 4500 damage over 60 m, levels the block and leaves a crater.',
      ult: true,
      cooldown: 140,
      duration: 0,
      accent: 0xff3a1a,
      icon: 'nuke',
    },
    {
      activate(v, g, st) {
        const a = aimPoint(v, 1600);
        strikeAt(v, g, st.spec, a.x, a.z, { r: 60, delay: 4, damage: 4500, kind: 'gustav', props: 20, crater: 6, knock: 25, stun: 2 });
      },
      aiShouldUse(v, g, t) {
        return inRange(v, t, 1500) && (clusterAround(v, g, t, 60) >= 2 || t.titan);
      },
    },
  ),
  gdef(
    {
      id: 'broadside',
      name: 'Broadside',
      short: 'BROADSIDE',
      description: 'Three volleys from every gun onto the crosshair: two 280 mm and six 128 mm shells each.',
      ult: true,
      cooldown: 140,
      duration: 0,
      accent: 0xffb04a,
      icon: 'salvo',
    },
    {
      activate(v, g, st) {
        const a = aimPoint(v, weaponRange(v));
        for (let i = 0; i < 3; i++) {
          barrage(v, g, st.spec, a.x, a.z, 15, 2, 0.05, { r: 14, delay: 1 + i * 1.2, damage: 1100, kind: 'shell', props: 3, crater: 1.5, knock: 8 });
          barrage(v, g, st.spec, a.x, a.z, 35, 6, 0.04, { r: 8, delay: 1.1 + i * 1.2, damage: 300, kind: 'shell', props: 1.5 });
        }
      },
      aiShouldUse(v, _g, t) {
        return inRange(v, t, weaponRange(v));
      },
    },
  ),
  gdef(
    {
      id: 'v2Strike',
      name: 'V-2 Strike',
      short: 'V-2',
      description: 'Three V-2 rockets dive on the three enemies nearest the crosshair (within 250 m) after 5 s: 2600 damage over 40 m each.',
      ult: true,
      cooldown: 140,
      duration: 0,
      accent: 0xe8e8e8,
      icon: 'missile',
    },
    {
      activate(v, g, st) {
        const hit = enemiesAtAim(v, g, 2000, 250).slice(0, 3);
        const a = aimPoint(v, 2000);
        const spots = hit.length ? hit.map((e) => [e.x, e.z]) : [[a.x, a.z]];
        while (spots.length < 3) spots.push([spots[0][0] + (g.rng() - 0.5) * 80, spots[0][1] + (g.rng() - 0.5) * 80]);
        spots.forEach(([x, z], i) => strikeAt(v, g, st.spec, x, z, { r: 40, delay: 5 + i * 0.4, damage: 2600, kind: 'missile', props: 8, crater: 4, knock: 18 }));
      },
      aiShouldUse(v, g) {
        return enemiesWithin(v, g, 1600).length >= 2;
      },
    },
  ),
];
