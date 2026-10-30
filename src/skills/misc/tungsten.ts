import type { SkillIcon } from '../../core/types';
import { hpFrac, underFire } from '../kit';
import { def, type SkillDef } from '../types';
import type { Ship } from '../../ships/Ship';
import { CUBE, SIGNATURE, TUNGSTEN_MODES } from './TungstenModes';
import {
  collapse,
  dockCubes,
  foesNearCube,
  inFlight,
  lungeToCube,
  meteor,
  overdrive,
  overdriveOn,
  raiseShield,
  signature,
  switchMode,
  throwCubes,
  tungstenWantedMode,
} from './TungstenRuntime';

const CYAN = 0x3ff0ff;
const spec = (id: string, name: string, short: string, cooldown: number, duration: number, icon: SkillIcon, description: string, ult = false) => ({
  id,
  name,
  short,
  description,
  cooldown,
  duration,
  icon,
  accent: CYAN,
  ult,
});
const cube = (s: Ship) => s.tungsten!.cubes[0];
const range = (s: Ship, t: Ship | null) => (t ? Math.hypot(t.pos.x - s.pos.x, t.pos.z - s.pos.z) : Infinity);
const free = (s: Ship) => {
  const c = cube(s);
  return c.state !== 'broken' && c.state !== 'meteor' && c.state !== 'collapse';
};

export const TUNGSTEN_SKILLS: SkillDef[] = [
  def(
    spec('tungstenLunge', 'Magnet Lunge', 'LUNGE', 12, 0, 'magnet', 'The magnet reels the ship to its hovering cube, up to 4 km away. Hulls in the way take 60k; the ship takes 40% less damage on the way and the cube docks on arrival.'),
    {
      activate: (s, _g, st) => lungeToCube(s, st.index),
      aiShouldUse(s, _g, t) {
        const c = cube(s);
        if (c.state !== 'hover') return false;
        const d = Math.hypot(c.x - s.pos.x, c.z - s.pos.z);
        return d > 1800 && d < CUBE.lunge.range && (foesNearCube(s, c, 1500).length > 0 || (hpFrac(s) < 0.4 && !t));
      },
    },
  ),
  def(spec('tungstenSwitch', 'Switch', 'MODE', 0.5, 0, 'swap', 'Cycle the cube to its next mode: Kinetic, Crush, Shard, Repel, Tether, Mend.'), {
    activate: (s) => switchMode(s),
    aiShouldUse(s, g, t) {
      return !overdriveOn(s) && !inFlight(cube(s)) && tungstenWantedMode(s, t, underFire(s, g, 1500)) !== s.tungsten!.mode;
    },
  }),
  def(spec('tungstenSignature', 'Signature', 'SIG', 14, 0, 'rune', "The current mode's move, from the cube: Ricochet, Slam, Fragment Storm, Repulse, Reel or Restore."), {
    activate: (s, _g, st) => signature(s, st.index),
    aiShouldUse(s, g) {
      if (!free(s)) return false;
      const c = cube(s);
      const sig = TUNGSTEN_MODES[c.mode].signature;
      if (sig.id === 'restore') return hpFrac(s) < 0.75;
      if (sig.id === 'repulse') return underFire(s, g, 1200) > 4 || foesNearCube(s, c, sig.radius).length > 0;
      return foesNearCube(s, c, sig.id === 'ricochet' ? SIGNATURE.ricochet.reach : sig.radius).length > 0;
    },
  }),
  def(spec('tungstenShot', 'Tungsten Shot', 'SHOT', 6, 0, 'ram', 'Hurl the cube at the reticle, up to 4 km. It ploughs through every hull for 80k with the mode effect, then hovers where it stops.'), {
    activate: (s, _g, st) => throwCubes(s, st.index),
    aiShouldUse(s, _g, t) {
      const c = cube(s);
      return !!t && free(s) && c.state !== 'flying' && Math.hypot(t.pos.x - c.x, t.pos.z - c.z) < CUBE.shot.range - 100;
    },
  }),
  def(spec('tungstenDock', 'Dock', 'DOCK', 12, 0, 'heal', 'Call the cube home through anything in the way (50k). On docking the ship repairs 6% plus 20% of the damage dealt and the cube 15%.'), {
    activate: (s, _g, st) => dockCubes(s, st.index),
    aiShouldUse(s) {
      const c = cube(s);
      return c.state === 'hover' && (Math.hypot(c.x - s.pos.x, c.z - s.pos.z) > 2500 || hpFrac(s) < 0.5);
    },
  }),
  def(spec('tungstenShield', 'Tungsten Shield', 'SHIELD', 18, CUBE.guard.time, 'shield', 'The cube guards the reticle side and captures every shell, missile, beam and torpedo nearby. Stored damage (up to 600k) rides the next cube hit. In Overdrive the cubes orbit and batter hulls.'), {
    activate: (s, _g, st) => raiseShield(s, st.index),
    aiShouldUse(s, g, t) {
      return free(s) && (underFire(s, g, 1500) >= 6 || (overdriveOn(s) && range(s, t) < 900));
    },
  }),
  def(spec('tungstenCollapse', 'Collapse', 'COLLAPSE', 100, 3.6, 'gravity', 'The cube collapses into a singularity at the reticle (4.5 km): enemies within 1.6 km are dragged in and the core burns, then it bursts for up to 400k.', true), {
    activate: (s, _g, st) => collapse(s, st.index),
    aiShouldUse(s, g, t) {
      if (!t || range(s, t) > CUBE.collapse.range) return false;
      return g.ships.filter((o) => o.alive && o.team !== s.team && Math.hypot(o.pos.x - t.pos.x, o.pos.z - t.pos.z) < 1600).length >= 2 || t.spec.cls === 'TT';
    },
  }),
  def(spec('tungstenMeteor', 'Tungsten Meteor', 'METEOR', 110, 3.6, 'meteor', 'The cube rises, grows eightfold and falls on the reticle (5 km) for up to 700k with its mode effect.', true), {
    activate: (s, _g, st) => meteor(s, st.index),
    aiShouldUse(s, _g, t) {
      return !!t && range(s, t) < CUBE.meteor.range;
    },
  }),
  def(spec('tungstenOverdrive', 'Overdrive', 'OVERDRIVE', 130, 0, 'fleet', 'Five more cubes leave the magnet, one in each other mode. Every cube skill drives all six and every passive is live for 20 s.', true), {
    activate: (s) => overdrive(s),
    aiShouldUse(s, _g, t) {
      return !!t && range(s, t) < 5000;
    },
  }),
];
