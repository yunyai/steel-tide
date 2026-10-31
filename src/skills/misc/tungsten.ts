import type { SkillIcon } from '../../core/types';
import { hpFrac, underFire } from '../kit';
import { def, type SkillDef } from '../types';
import type { Ship } from '../../ships/Ship';
import type { Cube } from './TungstenRuntime';
import { CUBE, SIGNATURE, TUNGSTEN_MODES } from './TungstenModes';
import {
  collapse,
  dockCubes,
  foesNearCube,
  inFlight,
  lungeCube,
  lungeToCube,
  meteor,
  overdrive,
  overdriveOn,
  raiseShield,
  signature,
  rollDie,
  switchMode,
  tungstenWantedMode,
} from './TungstenRuntime';

const CYAN = 0x3ff0ff;
const spec = (id: string, name: string, short: string, cooldown: number, duration: number, icon: SkillIcon, description: string, ult = false, empowers = false) => ({
  id,
  name,
  short,
  description,
  cooldown,
  duration,
  icon,
  accent: CYAN,
  ult,
  empowers,
});
const cube = (s: Ship) => s.tungsten!.cubes[0];
const range = (s: Ship, t: Ship | null) => (t ? Math.hypot(t.pos.x - s.pos.x, t.pos.z - s.pos.z) : Infinity);
const isFree = (c: Cube) => !c.gone && c.state !== 'broken' && c.state !== 'meteor' && c.state !== 'collapse';
/** The cubes the AI weighs: the cube itself, or all six as equals in Overdrive. */
const pool = (s: Ship) => (overdriveOn(s) ? s.tungsten!.cubes : [cube(s)]);
const free = (s: Ship) => pool(s).some(isFree);

export const TUNGSTEN_SKILLS: SkillDef[] = [
  def(
    spec('tungstenLunge', 'Magnet Lunge', 'LUNGE', 12, 0, 'magnet', 'The magnet reels the ship to its cube out on the water, up to 4 km away. Hulls in the way take 60k; the ship takes 40% less damage on the way and the cube docks on arrival.'),
    {
      activate: (s, _g, st) => lungeToCube(s, st.index),
      aiShouldUse(s, _g, t) {
        const c = lungeCube(s);
        if (c.state !== 'hover') return false;
        const d = Math.hypot(c.x - s.pos.x, c.z - s.pos.z);
        return d > 1800 && d < CUBE.lunge.range && (foesNearCube(s, c, 1500).length === 1 || (hpFrac(s) < 0.4 && !t));
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
      return pool(s).some((c) => {
        if (!isFree(c)) return false;
        const sig = TUNGSTEN_MODES[c.mode].signature;
        if (sig.id === 'restore') return hpFrac(s) < 0.75;
        if (sig.id === 'repulse') return underFire(s, g, 1200) > 4 || foesNearCube(s, c, sig.radius).length > 0;
        return foesNearCube(s, c, sig.id === 'ricochet' ? SIGNATURE.ricochet.reach : sig.radius).length > 0;
      });
    },
  }),
  def(
    spec('tungstenDie', 'Loaded Die', 'DIE', CUBE.die.cooldown, 0, 'dice', "Roll the cube to the reticle, up to 4 km, over anything in the way; free, and a spent cube stays spent. It lands for 120k to every foe within 600 m, then the face it rolls fires at double strength: Kinetic hits harder the farther it rolled, Crush stuns, Shard knocks out turrets, Repel flings hulls and tears up fire, Tether chains and Mend heals the ship. Roll the cube's own mode for a jackpot: every face at once. In Overdrive all six roll into a ring round the reticle."),
    {
      activate: (s, _g, st) => rollDie(s, st.index),
      aiShouldUse(s, _g, t) {
        // Not while the cube shields the ship or the magnet reels it in.
        if (!t || s.tungsten!.lunge) return false;
        return pool(s).some((c) => isFree(c) && c.state !== 'guard' && c.state !== 'orbit' && Math.hypot(c.x - t.pos.x, c.z - t.pos.z) < CUBE.die.range);
      },
    },
  ),
  def(spec('tungstenDock', 'Dock', 'DOCK', 10, 0, 'heal', 'Call the cube home through anything in the way (50k). On docking the ship repairs 6% plus 20% of the damage dealt and the cube 15%, and a spent cube wakes.'), {
    activate: (s, _g, st) => dockCubes(s, st.index),
    aiShouldUse(s) {
      return pool(s).some((c) => c.state === 'hover' && (s.tungsten!.spent || Math.hypot(c.x - s.pos.x, c.z - s.pos.z) > 2500 || hpFrac(s) < 0.5));
    },
  }),
  def(spec('tungstenShield', 'Tungsten Shield', 'SHIELD', 18, CUBE.guard.time, 'shield', 'The cube guards the reticle side for 8 s and captures every shell, missile, beam and torpedo nearby. Stored damage (up to 1M) rides the next cube hit, and hulls the cube touches take 40k plus 10% of the store. In Overdrive all six orbit for 10 s, each capturing fire, battering hulls for 80k plus 5% of the store, cutting damage to the ship by 30% and storing up to 3M.'), {
    activate: (s, _g, st) => raiseShield(s, st.index),
    // The skill runs as long as the cubes hold: longer in Overdrive, and not past a hold cut short.
    update(s, g, _dt, st) {
      st.time = s.tungsten!.guardUntil - g.time;
    },
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
  def(spec('tungstenMeteor', 'Tungsten Meteor', 'METEOR', 110, 3.6, 'meteor', 'The cube rises, grows fourfold and falls on the reticle (5 km) for up to 700k with its mode effect.', true), {
    activate: (s, _g, st) => meteor(s, st.index),
    aiShouldUse(s, _g, t) {
      return !!t && range(s, t) < CUBE.meteor.range;
    },
  }),
  def(spec('tungstenOverdrive', 'Overdrive', 'OVERDRIVE', 130, CUBE.overdrive.time, 'fleet', 'For 20 s five more cubes leave the magnet, one in each other mode. Throws are free and hurl all six abreast, every cube skill drives all six and every passive is live.', true, true), {
    activate: (s) => overdrive(s),
    aiShouldUse(s, _g, t) {
      return !!t && range(s, t) < 5000;
    },
  }),
];
