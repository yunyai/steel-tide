import { CUBE, TUNGSTEN_MODES } from '../skills/misc/TungstenModes';
import type { TungstenState } from '../skills/misc/TungstenRuntime';
import type { Team } from '../core/types';
import type { Ship } from '../ships/Ship';

export interface TungstenStatusLine {
  text: string;
  /** Shown in the buff colour; false for setbacks such as a broken cube. */
  buff: boolean;
  /** HUD glyph name. */
  icon: string;
}

/** What the HUD shows for a Tungsten: live Switch and Signature buttons, and its status lines. */
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
}

const css = (color: number) => `#${color.toString(16).padStart(6, '0')}`;
const thousands = (v: number) => `${Math.round(v / 1000)}k`;

/** The Tungsten's HUD state at game time `time`, for a ship standing at (x, z). */
export function tungstenPresentation(t: TungstenState, time: number, x: number, z: number): TungstenView {
  const mode = TUNGSTEN_MODES[t.mode];
  const sig = mode.signature;
  const overdrive = t.overdriveUntil - time;
  const status: TungstenStatusLine[] = [];

  if (overdrive > 0) status.push({ text: `Overdrive · all modes · ${Math.ceil(overdrive)}s`, buff: true, icon: 'fleet' });

  // The cradle cube; a quiet line, or none, while it sits whole on the magnet.
  const c = t.cubes.find((k) => k.slot === 0 && !k.extra);
  if (c) {
    const hp = c.hp < c.maxHp ? ` · ${Math.round((c.hp / c.maxHp) * 100)}%` : '';
    if (c.state === 'broken') status.push({ text: `Cube re-forming · ${Math.ceil(c.reform)}s`, buff: false, icon: 'magnet' });
    else if (c.state !== 'docked') status.push({ text: `Cube out · ${(Math.hypot(c.x - x, c.z - z) / 1000).toFixed(1)} km${hp}`, buff: true, icon: 'magnet' });
    else if (hp) status.push({ text: `Cube docked${hp}`, buff: true, icon: 'magnet' });
  }

  const guard = t.guardUntil - time;
  if (guard > 0) status.push({ text: `Shield ${Math.ceil(guard)}s${t.charge > 0 ? ` · ${thousands(t.charge)} stored` : ''}`, buff: true, icon: 'shield' });
  else if (t.charge > 0) status.push({ text: `Charge ${thousands(t.charge)} / ${thousands(CUBE.chargeCap)}`, buff: true, icon: 'shield' });

  const tethered = t.tethers.filter((k) => k.until > time).length;
  if (tethered) status.push({ text: `Tethered ×${tethered}`, buff: true, icon: 'magnet' });

  return {
    switchLabel: overdrive > 0 ? 'ALL' : mode.name.toUpperCase(),
    switchTitle: overdrive > 0 ? 'Every mode is active during Overdrive.' : `${mode.name} now; tap for ${TUNGSTEN_MODES[(t.mode + 1) % TUNGSTEN_MODES.length].name}.`,
    signatureLabel: overdrive > 0 ? 'ALL' : sig.id.toUpperCase(),
    signatureTitle: overdrive > 0 ? "Every cube fires its own mode's move." : `Now ${sig.name}, ${(sig.radius / 1000).toFixed(1)} km round the cube.`,
    accent: css(mode.color),
    status,
  };
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
