import { CUBE, TUNGSTEN_MODES } from '../skills/misc/TungstenModes';
import type { Cube, CubeState, TungstenState } from '../skills/misc/TungstenRuntime';
import type { Team } from '../core/types';
import type { Ship } from '../ships/Ship';

export interface TungstenStatusLine {
  text: string;
  /** Shown in the buff colour; false for setbacks such as a broken cube. */
  buff: boolean;
  /** HUD glyph name. */
  icon: string;
}

/** One bar of the Tungsten panel. */
export interface TungstenGauge {
  frac: number;
  text: string;
  /** Drawn in the warning colour. */
  low: boolean;
}

/** The panel over the Tungsten's hull bar: where the cube is, the magnet's energy, the cube's health and the Shield store. */
export interface TungstenPanel {
  where: string;
  energy: TungstenGauge;
  cube: TungstenGauge;
  /** Shown while the Shield is up or holds damage. */
  store: TungstenGauge | null;
  /** In Overdrive, one health bar per cube, in mode order. */
  cubes: { color: string; frac: number }[];
}

/** What the HUD shows for a Tungsten: live Switch and Signature buttons, its status lines and its panel. */
export interface TungstenView {
  switchLabel: string;
  /** Live line added to the Switch tooltip. */
  switchTitle: string;
  signatureLabel: string;
  /** Live line added to the Signature tooltip. */
  signatureTitle: string;
  /** The current mode's colour, for the Switch and Signature buttons. */
  accent: string;
  status: TungstenStatusLine[];
  panel: TungstenPanel;
}

const css = (color: number) => `#${color.toString(16).padStart(6, '0')}`;
const amount = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : `${Math.round(v / 1000)}k`);
/** Whole seconds left, without float dust turning 20 into 21. */
const secs = (v: number) => Math.ceil(v - 1e-6);
const km = (d: number) => `${(d / 1000).toFixed(1)} km`;
const primary = (t: TungstenState) => t.cubes.find((k) => k.slot === 0 && !k.extra) ?? t.cubes[0];
const PLACE: Record<CubeState, string> = { docked: 'Docked', flying: 'In flight', hover: 'Out', guard: 'Shielding', orbit: 'Shielding', meteor: 'Meteor', collapse: 'Collapse', broken: 'Shattered' };

/** The Tungsten's HUD state at game time `time`, for a ship standing at (x, z). */
export function tungstenPresentation(t: TungstenState, time: number, x: number, z: number): TungstenView {
  const mode = TUNGSTEN_MODES[t.mode];
  const sig = mode.signature;
  const overdrive = t.overdriveUntil - time;
  const status: TungstenStatusLine[] = [];

  if (overdrive > 0) status.push({ text: `Overdrive · all modes · ${Math.ceil(overdrive)}s`, buff: true, icon: 'fleet' });
  const surge = t.surgeUntil - time;
  if (surge > 0) status.push({ text: `Surge · ${Math.ceil(surge)}s`, buff: true, icon: 'magnet' });
  const guard = t.guardUntil - time;
  if (guard > 0) status.push({ text: `Shield ${Math.ceil(guard)}s`, buff: true, icon: 'shield' });
  const tethered = t.tethers.filter((k) => k.until > time).length;
  if (tethered) status.push({ text: `Tethered ×${tethered}`, buff: true, icon: 'magnet' });

  const next = TUNGSTEN_MODES[(t.mode + 1) % TUNGSTEN_MODES.length];
  return {
    switchLabel: overdrive > 0 ? 'ALL' : mode.name.toUpperCase(),
    switchTitle: overdrive > 0 ? 'Every mode is active during Overdrive.' : `${mode.name} now; tap for ${next.name}.\nThrow: ${mode.hit}\nPassive: ${mode.passive}`,
    signatureLabel: overdrive > 0 ? 'ALL' : sig.id.toUpperCase(),
    signatureTitle: overdrive > 0 ? "Every cube fires its own mode's move." : `Now ${sig.name}, ${(sig.radius / 1000).toFixed(1)} km round the cube.`,
    accent: css(mode.color),
    status,
    panel: panel(t, time, x, z),
  };
}

function panel(t: TungstenState, time: number, x: number, z: number): TungstenPanel {
  const c = primary(t);
  const where = t.overdriveUntil > time ? overdriveWhere(t) : c.state === 'hover' || c.state === 'flying' ? `${PLACE[c.state]} · ${km(Math.hypot(c.x - x, c.z - z))}` : PLACE[c.state];

  let energy: string;
  if (t.surgeUntil > time) energy = `Surge ${Math.ceil(t.surgeUntil - time)}s · free throws`;
  else if (t.overdriveUntil > time) energy = 'Overdrive · free throws';
  else if (t.spent) {
    const docked = c.state === 'docked';
    const wait = secs((1 - t.energy) / (docked ? CUBE.energy.dockRegen : CUBE.energy.regen));
    energy = docked ? `Spent · charging ${wait}s` : `Spent · dock or wait ${wait}s`;
  } else {
    // Any energy left buys a throw; the one that empties the magnet spends it.
    const n = secs(t.energy / CUBE.shot.cost);
    energy = `${n} throw${n === 1 ? '' : 's'}${t.energy < 1 ? ' · recharging' : ''}`;
  }
  const free = t.surgeUntil > time || t.overdriveUntil > time;

  const cube: TungstenGauge =
    c.state === 'broken'
      ? { frac: 1 - c.reform / CUBE.reform, text: `Re-forming ${secs(c.reform)}s`, low: true }
      : { frac: c.hp / c.maxHp, text: `${amount(c.hp)} / ${amount(c.maxHp)}`, low: c.hp / c.maxHp < 0.3 };

  // A store kept from Overdrive reads as full.
  const cap = Math.max(t.charge, CUBE.chargeCap * (t.overdriveUntil > time ? CUBE.orbit.cap : 1));
  const store = t.guardUntil > time || t.charge > 0 ? { frac: t.charge / cap, text: `${amount(t.charge)} / ${amount(cap)}`, low: false } : null;

  const cubes =
    t.overdriveUntil > time
      ? TUNGSTEN_MODES.map((m, i) => {
          const k = t.cubes.find((o) => o.mode === i && !o.gone);
          return { color: css(m.color), frac: k && k.state !== 'broken' ? k.hp / k.maxHp : 0 };
        })
      : [];

  return { where, energy: { frac: t.energy, text: energy, low: !free && (t.spent || t.energy < CUBE.shot.cost) }, cube, store, cubes };
}

/** In Overdrive the six are equals: count them out, home and shattered rather than following one. */
function overdriveWhere(t: TungstenState): string {
  const live = t.cubes.filter((k) => !k.gone);
  const home = live.filter((k) => k.state === 'docked').length,
    broken = live.filter((k) => k.state === 'broken').length;
  return `Overdrive · ${live.length - home - broken} out · ${home} home${broken ? ` · ${broken} shattered` : ''}`;
}

/** The cube a throw is timed from: the main cube, or in Overdrive the first of the six that can be thrown. */
function thrower(t: TungstenState, time: number): Cube {
  const c = primary(t);
  if (t.overdriveUntil <= time || c.state === 'docked' || c.state === 'hover') return c;
  return t.cubes.find((k) => !k.gone && (k.state === 'docked' || k.state === 'hover')) ?? c;
}

/** The reticle's line for the fire button: how far and how long the throw is, or why there is none. */
export function cubeReticle(t: TungstenState, time: number, aimX: number, aimZ: number): { text: string; out: boolean } {
  const c = thrower(t, time);
  if (c.state === 'broken') return { text: `Cube re-forming · ${secs(c.reform)}s`, out: true };
  if (t.spent) return { text: 'Spent: Dock or Surge to throw', out: true };
  if (c.state !== 'docked' && c.state !== 'hover') return { text: c.state === 'flying' ? 'Cube in flight' : 'Cube busy', out: true };
  const d = Math.hypot(aimX - c.x, aimZ - c.z);
  if (d > CUBE.shot.range) return { text: `Beyond the ${CUBE.shot.range / 1000} km throw: it lands short`, out: true };
  const speed = CUBE.shot.speed * TUNGSTEN_MODES[c.mode].speed * (t.surgeUntil > time ? CUBE.surge.speed : 1);
  return { text: `Throw ${km(d)}, ${(d / speed).toFixed(1)} s`, out: false };
}

/** The cube's weapon slot: its throw reload, or why it cannot throw. */
export function cubeSlot(t: TungstenState, time: number): { frac: number; info: string } {
  if (thrower(t, time).state === 'broken') return { frac: 0, info: 'Re-forming' };
  if (t.spent) return { frac: 0, info: 'Spent' };
  return t.reload > 0 ? { frac: 1 - t.reload / CUBE.shot.reload, info: `${t.reload.toFixed(1)}s` } : { frac: 1, info: 'Ready' };
}

export interface CubeMarker {
  x: number;
  z: number;
  /** The cube's mode colour. */
  color: string;
  ally: boolean;
  /** Cube scale: 1 normally, larger while a meteor. */
  size: number;
}

/**
 * Minimap markers for cubes away from their magnet. A cube in the open is visible to everyone;
 * a docked cube rides on its ship, which the minimap already draws when it is visible.
 */
export function minimapCubes(ships: readonly Ship[], team: Team): CubeMarker[] {
  const marks: CubeMarker[] = [];
  for (const s of ships) {
    if (!s.tungsten || !s.alive || s.withdrawn) continue;
    for (const c of s.tungsten.cubes) {
      if (c.state === 'docked' || c.state === 'broken') continue;
      marks.push({ x: c.x, z: c.z, color: css(TUNGSTEN_MODES[c.mode].color), ally: s.team === team, size: c.scale });
    }
  }
  return marks;
}
