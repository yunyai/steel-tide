import type { PickupKind } from '../core/Pickups';
import type { ConsumableType, ShipClass, SkillIcon } from '../core/types';
import type { GroundConsumableType, VehicleClass } from '../ground/sim/types';

// Inline SVG glyphs for skills, consumables, pickups, status and ship classes. Every glyph sits
// in a 24-unit box centred on the origin and takes its colour from `currentColor`.

const S = 'fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"';
const F = 'fill="currentColor" stroke="none"';

const GLYPHS: Record<string, string> = {
  beam: `<path ${F} d="M-11 -4 h5 v8 h-5 z"/><path ${S} stroke-width="3.6" d="M-5 0 H11"/><path ${S} opacity=".55" d="M-3 -6 L11 -3 M-3 6 L11 3"/>`,
  laser: `<circle ${F} cx="-7" cy="7" r="3"/><path ${S} stroke-width="2.6" d="M-5 5 L9 -9"/><path ${S} d="M4 -10 L10 -10 L10 -4"/>`,
  missile: `<path ${F} d="M10 -10 L6.5 -2 L-3 7.5 L-7.5 3 L2 -6.5 Z"/><path ${S} d="M-6 3 L-10 3 L-8 6 M-3 6 L-3 10 L-6 8"/>`,
  shield: `<path ${S} d="M0 -10 L8 -6.5 V0.5 C8 5.5 4.5 8.5 0 10.5 C-4.5 8.5 -8 5.5 -8 0.5 V-6.5 Z"/><path ${S} d="M-3.5 0.5 L-0.8 3.2 L4 -2"/>`,
  lightning: `<path ${F} d="M2.5 -11 L-7 1.5 H-0.5 L-2.5 11 L7 -1.5 H0.5 Z"/>`,
  // Titan Shift: a small hull rising into a burst.
  shift: `<path ${F} d="M-7 10 H7 L5 6.5 H-5 Z"/><path ${S} stroke-width="2.4" d="M0 4 V-6 M-4.5 -2 L0 -6.5 L4.5 -2"/><path ${S} opacity=".6" d="M-9 -4 L-6.5 -6.5 M9 -4 L6.5 -6.5 M-4 -10 L-2.6 -8 M4 -10 L2.6 -8"/>`,
  fist: `<path ${F} d="M-8 -3.5 C-8 -6.5 -6 -7.5 -4 -7.5 H5 C7.5 -7.5 9 -6 9 -3.5 V3 C9 7 6.5 9.5 3 9.5 H-3 C-6 9.5 -8 7.5 -8 4.5 Z"/><path fill="none" stroke="#000" stroke-opacity=".45" stroke-width="1.4" stroke-linecap="round" d="M-3.5 -7 V-2 M1 -7 V-2 M5 -7 V-2 M-8 0.5 H-2"/>`,
  blink: `<path ${S} d="M-10 -6 L-4.5 0 L-10 6 M-3 -6 L2.5 0 L-3 6"/><circle ${F} cx="8" cy="0" r="2.6"/>`,
  strike: `<circle ${S} r="7.5"/><path ${S} d="M0 -11 V-4 M0 4 V11 M-11 0 H-4 M4 0 H11"/><circle ${F} r="1.8"/>`,
  heal: `<path ${F} d="M-2.6 -9 H2.6 V-2.6 H9 V2.6 H2.6 V9 H-2.6 V2.6 H-9 V-2.6 H-2.6 Z"/>`,
  cloak: `<path ${S} d="M-10 0 C-6 -6 6 -6 10 0 C6 6 -6 6 -10 0 Z"/><circle ${F} r="2.4"/><path ${S} d="M-9 9 L9 -9"/>`,
  torpedo: `<rect ${F} x="-8" y="-2.6" width="15" height="5.2" rx="2.6"/><path ${S} d="M-10.5 -4.5 V4.5 M9 0 H11.5"/>`,
  plane: `<path ${F} d="M0 -10.5 L1.6 -3 L9.5 1 V3.2 L1.6 1.2 L1.1 6.8 L3.6 8.8 V10.2 L0 9.2 L-3.6 10.2 V8.8 L-1.1 6.8 L-1.6 1.2 L-9.5 3.2 V1 L-1.6 -3 Z"/>`,
  mine: `<circle ${F} r="5"/><path ${S} d="M0 -10 V-6 M0 6 V10 M-10 0 H-6 M6 0 H10 M-7 -7 L-4.4 -4.4 M7 -7 L4.4 -4.4 M-7 7 L-4.4 4.4 M7 7 L4.4 4.4"/>`,
  wave: `<path ${S} d="M-11 -2 C-7.5 -7 -4 -7 -0.5 -2 S7 3 11 -2"/><path ${S} d="M-11 5 C-7.5 0 -4 0 -0.5 5 S7 10 11 5"/>`,
  speed: `<path ${S} stroke-width="2.4" d="M-9 -7 L-1.5 0 L-9 7 M0 -7 L7.5 0 L0 7"/>`,
  reveal: `<circle ${S} r="9"/><circle ${S} r="4.5" opacity=".6"/><path ${S} d="M0 0 L6.4 -6.4"/><circle ${F} cx="3.5" cy="4" r="1.6"/>`,
  salvo: `<path ${F} d="M-8.5 9 V-3 C-8.5 -6 -4.5 -6 -4.5 -3 V9 Z M-2 9 V-6 C-2 -9 2 -9 2 -6 V9 Z M4.5 9 V-3 C4.5 -6 8.5 -6 8.5 -3 V9 Z"/>`,
  nuke: `<circle ${F} r="2.2"/><g ${F}><path d="M-1.9 -3.3 L-5.2 -9 A10.4 10.4 0 0 1 5.2 -9 L1.9 -3.3 A3.8 3.8 0 0 0 -1.9 -3.3 Z"/><path d="M-1.9 -3.3 L-5.2 -9 A10.4 10.4 0 0 1 5.2 -9 L1.9 -3.3 A3.8 3.8 0 0 0 -1.9 -3.3 Z" transform="rotate(120)"/><path d="M-1.9 -3.3 L-5.2 -9 A10.4 10.4 0 0 1 5.2 -9 L1.9 -3.3 A3.8 3.8 0 0 0 -1.9 -3.3 Z" transform="rotate(240)"/></g>`,
  flak: `<path ${F} d="M0 -10.5 L2.2 -3.2 L9.5 -5.2 L4.2 0 L9.5 5.2 L2.2 3.2 L0 10.5 L-2.2 3.2 L-9.5 5.2 L-4.2 0 L-9.5 -5.2 L-2.2 -3.2 Z"/>`,
  ram: `<path ${S} stroke-width="2.4" d="M-10 0 H4 M-1 -5 L4 0 L-1 5"/><path ${S} stroke-width="2.6" d="M8.5 -9 V9"/>`,
  cryo: `<path ${S} d="M0 -10.5 V10.5 M-9 -5.2 L9 5.2 M-9 5.2 L9 -5.2 M-3 -8.5 L0 -5.5 L3 -8.5 M-3 8.5 L0 5.5 L3 8.5"/>`,
  drone: `<rect ${F} x="-3" y="-3" width="6" height="6" rx="1"/><path ${S} d="M-3 -3 L-7 -7 M3 -3 L7 -7 M-3 3 L-7 7 M3 3 L7 7"/><circle ${S} cx="-7.5" cy="-7.5" r="2.8"/><circle ${S} cx="7.5" cy="-7.5" r="2.8"/><circle ${S} cx="-7.5" cy="7.5" r="2.8"/><circle ${S} cx="7.5" cy="7.5" r="2.8"/>`,
  magnet: `<path ${S} stroke-width="3" d="M-6.5 -9 V0.5 A6.5 6.5 0 0 0 6.5 0.5 V-9"/><path ${S} stroke-width="3" opacity=".5" d="M-6.5 -9 V-5.5 M6.5 -9 V-5.5"/><path ${S} d="M-11 9 L-8.5 6.5 M11 9 L8.5 6.5"/>`,
  fleet: `<path ${F} d="M-11 -6.5 H3 L6 -9.5 H-8.5 Z M-8 1.5 H6 L9 -1.5 H-5.5 Z M-5 9.5 H9 L12 6.5 H-2.5 Z"/>`,
  wall: `<path ${F} d="M-11.5 10 L-8.5 -3 L-5.5 10 Z M-6.5 10 L-2 -10 L2.5 10 Z M1.5 10 L5.5 -5 L8.5 10 Z M7 10 L9.5 1 L11.5 10 Z"/>`,
  snow: `<path ${S} d="M-11 -4 H3 A3.5 3.5 0 1 0 -0.5 -7.5 M-11 2.5 H7 A3.5 3.5 0 1 1 3.5 6"/><circle ${F} cx="-6" cy="8.5" r="1.5"/><circle ${F} cx="8" cy="-9" r="1.5"/><circle ${F} cx="-4" cy="-10" r="1.2"/>`,
  drums: `<circle ${S} r="7.5" opacity=".45"/><circle ${F} cx="0" cy="-7.5" r="2.4"/><circle ${F} cx="6.5" cy="-3.75" r="2.4"/><circle ${F} cx="6.5" cy="3.75" r="2.4"/><circle ${F} cx="0" cy="7.5" r="2.4"/><circle ${F} cx="-6.5" cy="3.75" r="2.4"/><circle ${F} cx="-6.5" cy="-3.75" r="2.4"/><path ${F} d="M1 -4 L-2.5 0.8 H0 L-1 4 L2.5 -0.8 H0 Z"/>`,
  gale: `<path ${S} d="M-11 -5 H4 A4 4 0 1 0 0 -9"/><path ${S} d="M-11 1 H8 A4 4 0 1 1 4 5"/><path ${S} d="M-11 7 H0"/>`,
  rod: `<path ${S} stroke-width="2.4" d="M-5 11 V-5"/><path ${S} d="M-8.5 -5 H-1.5 M-5 -5 V-11"/><path ${F} d="M7.5 -10.5 L2 -0.5 H5.5 L3 9 L10 -2.5 H6.5 Z"/>`,
  blade: `<path ${F} d="M10.5 -10.5 L9 -3.5 L-2.5 8 L-5.5 5 L6 -6.5 Z"/><path ${S} stroke-width="2.2" d="M-8.5 2.5 L-2.5 8.5 M-5.5 7.5 L-10 11.5"/>`,

  // Spells, control and the later eras.
  root: `<path ${S} d="M0 -11 V2 M0 -5 C-3 -6.5 -6 -6.5 -8 -9 M0 -7 C2.5 -8 4.5 -9.5 5.5 -11.5 M0 2 C-2 6 -6 7 -9.5 10 M0 2 C2 6 6 7 9.5 10 M0 3 V10.5"/>`,
  silence: `<path ${F} d="M-10 -3.5 H-6 L-1 -8 V8 L-6 3.5 H-10 Z"/><path ${S} stroke-width="2.2" d="M3 -4 L10 4 M10 -4 L3 4"/>`,
  fear: `<path ${S} d="M-7.5 10 V-2 A7.5 7.5 0 0 1 7.5 -2 V10 L5 7.5 L2.5 10 L0 7.5 L-2.5 10 L-5 7.5 Z"/><circle ${F} cx="-3" cy="-1.5" r="1.8"/><circle ${F} cx="3" cy="-1.5" r="1.8"/>`,
  skull: `<path ${F} fill-rule="evenodd" d="M0 -10.5 C-6 -10.5 -9.5 -6.5 -9.5 -1.5 C-9.5 2 -7.5 3.8 -5.5 4.8 V9.5 H5.5 V4.8 C7.5 3.8 9.5 2 9.5 -1.5 C9.5 -6.5 6 -10.5 0 -10.5 Z M-6.8 -1 a2.7 2.7 0 1 0 5.4 0 a2.7 2.7 0 1 0 -5.4 0 Z M1.4 -1 a2.7 2.7 0 1 0 5.4 0 a2.7 2.7 0 1 0 -5.4 0 Z M0 2.6 L-1.6 5 H1.6 Z"/>`,
  rune: `<path ${S} d="M-6 -10.5 H6 L8.5 10.5 H-8.5 Z"/><path ${S} stroke-width="2.2" d="M0 -6.5 V6.5 M0 -3 L4 -6.5 M0 1 L-4 -2.5"/>`,
  meteor: `<circle ${F} cx="4" cy="4" r="5.8"/><path ${S} d="M-0.5 -0.5 L-10.5 -10.5 M-2 4.5 L-9.5 -3 M4.5 -2 L-3 -9.5"/>`,
  time: `<path ${S} d="M-8 -10.5 H8 M-8 10.5 H8"/><path ${S} d="M-6 -10.5 C-6 -4 -1.5 -2 -1.5 0 C-1.5 2 -6 4 -6 10.5 M6 -10.5 C6 -4 1.5 -2 1.5 0 C1.5 2 6 4 6 10.5"/><path ${F} d="M-4.5 10 C-4.5 6.5 -1 5 0 3 C1 5 4.5 6.5 4.5 10 Z"/>`,
  portal: `<path ${S} d="M0 0 A2 2 0 0 1 2 2 A4 4 0 0 1 -2 6 A6 6 0 0 1 -6 -2 A8 8 0 0 1 2 -9 A10 10 0 0 1 10.5 2"/>`,
  beast: `<ellipse ${F} cx="0" cy="4.5" rx="5.2" ry="4.4"/><circle ${F} cx="-7" cy="-2.5" r="2.4"/><circle ${F} cx="-2.6" cy="-7.5" r="2.4"/><circle ${F} cx="2.6" cy="-7.5" r="2.4"/><circle ${F} cx="7" cy="-2.5" r="2.4"/>`,
  hammer: `<path ${F} d="M-10 -10.5 H6 V-3.5 H-10 Z"/><path ${F} d="M6 -9 H9.5 V-5 H6 Z" opacity=".6"/><path ${S} stroke-width="3.2" d="M-2 -3.5 V11"/>`,
  eye: `<path ${S} d="M-11 0 C-6 -7.5 6 -7.5 11 0 C6 7.5 -6 7.5 -11 0 Z"/><circle ${F} r="3.6"/>`,
  swap: `<path ${S} stroke-width="2.2" d="M-9.5 -4.5 H8 M4 -8.5 L8 -4.5 L4 -0.5 M9.5 4.5 H-8 M-4 0.5 L-8 4.5 L-4 8.5"/>`,
  gravity: `<circle ${F} r="3.6"/><ellipse ${S} rx="10.5" ry="4" transform="rotate(-20)"/><ellipse ${S} rx="7" ry="2.4" opacity=".55" transform="rotate(-20)"/>`,
  radar: `<path ${S} d="M-9.5 -2.5 A9 9 0 0 0 2.5 9.5 Z"/><path ${S} d="M-3.5 3.5 L3 -3"/><path ${S} d="M2.5 -6.5 A5 5 0 0 1 6.5 -2.5 M3 -10.5 A9 9 0 0 1 10.5 -3"/><path ${S} d="M-6 6 L-10 10.5 H-3"/>`,

  // Consumables.
  repairKit: `<path ${S} stroke-width="2.4" d="M-8 8 L2 -2"/><path ${S} d="M1 -3 C-1 -7 3 -11 7 -9.5 L3.5 -6 L4.5 -3.5 L7 -2.5 L10.5 -6 C12 -2 8 2 4 0"/>`,
  smoke: `<path ${F} d="M-9 6 C-12 6 -12 1 -8.5 0.5 C-9 -4 -3.5 -6 -1.5 -2.5 C0 -7 7.5 -6.5 7.5 -1 C11 -1 11.5 6 7.5 6 Z"/>`,
  hydro: `<circle ${F} r="2.2"/><path ${S} d="M-5 -5 A7 7 0 0 0 -5 5 M5 -5 A7 7 0 0 1 5 5 M-8.5 -8.5 A12 12 0 0 0 -8.5 8.5 M8.5 -8.5 A12 12 0 0 1 8.5 8.5"/>`,
  depth: `<rect ${S} x="-6" y="-9" width="12" height="11" rx="2"/><path ${S} d="M-6 -4.5 H6 M-6 -0.5 H6 M0 4 V10.5 M-3 7.5 L0 10.5 L3 7.5"/>`,

  // Pickups and status.
  reset: `<path ${S} stroke-width="2.2" d="M8.5 -2 A8.5 8.5 0 1 1 4.5 -7.5"/><path ${F} d="M3 -11.5 L10 -9 L5 -3.5 Z"/>`,
  fire: `<path ${F} d="M0 -11 C2 -6 8 -3.5 8 3 C8 7.5 4.5 10.5 0 10.5 C-4.5 10.5 -8 7.5 -8 3 C-8 -1 -5 -3 -4 -6 C-2.5 -3.5 -1.5 -2 -1 0 C1.5 -2.5 1.5 -6.5 0 -11 Z"/>`,
  flood: `<path ${F} d="M0 -10.5 C3 -5.5 7.5 -1 7.5 3.5 A7.5 7.5 0 0 1 -7.5 3.5 C-7.5 -1 -3 -5.5 0 -10.5 Z"/>`,
  wrench: `<path ${S} stroke-width="2.2" d="M-8 8 L1 -1"/><path ${S} d="M0 -2 C-1.5 -6.5 3 -10.5 7.5 -8.5 L4 -5 L5 -3 L7 -2 L10.5 -5.5 C12 -1 7.5 3 3 1.5"/>`,
  star: `<path ${F} d="M0 -10.5 L3 -3.5 L10.5 -3 L4.8 2 L6.5 9.5 L0 5.5 L-6.5 9.5 L-4.8 2 L-10.5 -3 L-3 -3.5 Z"/>`,
};

const CONSUMABLE_GLYPH: Record<ConsumableType, string> = {
  repair: 'repairKit',
  smoke: 'smoke',
  search: 'radar',
  speedBoost: 'speed',  depthCharges: 'depth',
};

const PICKUP_GLYPH: Record<PickupKind, string> = {
  repair: 'heal',
  overcharge: 'lightning',
  reset: 'reset',
  fury: 'fire',
};

/** Ship-class marks for the kill feed and markers, after the naval chart symbols. */
const CLASS_GLYPH: Record<ShipClass, string> = {
  BB: `<path ${F} d="M-10 -5 H10 V5 H-10 Z"/>`,
  CB: `<path ${F} d="M-10 -5 H10 V5 H-10 Z" opacity=".7"/><path ${F} d="M-6 -2 H6 V2 H-6 Z"/>`,
  CA: `<path ${F} d="M0 -8 L10 0 L0 8 L-10 0 Z"/>`,
  CL: `<path ${S} stroke-width="2.6" d="M0 -7.5 L9 0 L0 7.5 L-9 0 Z"/>`,
  DD: `<path ${F} d="M0 -8.5 L9 7 H-9 Z"/>`,
  CV: `<path ${F} d="M-11 -3 H11 V3 H-11 Z"/><path ${F} d="M-3 -8 H3 V-3 H-3 Z"/>`,
  SS: `<circle ${S} stroke-width="2.6" r="6.5"/>`,
  TT: GLYPHS.star,
  AK: `<path ${F} d="M-10 -3 H10 L7 5 H-7 Z"/><path ${F} d="M-3 -8 H3 V-3 H-3 Z"/>`,
};

/** Vehicle-class marks, after the map symbols for armour: heavier classes read as solid blocks. */
const VEHICLE_GLYPH: Record<VehicleClass, string> = {
  HT: `<path ${F} d="M-10 -6.5 H10 V6.5 H-10 Z"/><path fill="#000" fill-opacity=".45" d="M-6 0 A6 3.2 0 1 0 6 0 A6 3.2 0 1 0 -6 0 Z"/>`,
  MT: `<path ${S} stroke-width="2.4" d="M-9.5 -6 H9.5 V6 H-9.5 Z"/><ellipse ${F} rx="5" ry="2.6"/>`,
  LT: `<path ${S} stroke-width="2.6" d="M-9 5 L0 -5 L9 5"/><path ${S} stroke-width="2.6" opacity=".55" d="M-6 9.5 L0 3 L6 9.5"/>`,
  TD: `<path ${F} d="M-10 -7 H10 L0 8.5 Z"/>`,
  SPG: `<circle ${S} stroke-width="2.4" r="7.5"/><circle ${F} r="3.2"/>`,
  MSL: GLYPHS.missile,
  SUP: `<path ${S} stroke-width="2.4" d="M-9.5 -6.5 H9.5 V6.5 H-9.5 Z"/><path ${F} d="M-1.6 -4.6 H1.6 V-1.6 H4.6 V1.6 H1.6 V4.6 H-1.6 V1.6 H-4.6 V-1.6 H-1.6 Z"/>`,
  TT: GLYPHS.star,
};

const GROUND_CONSUMABLE_GLYPH: Record<GroundConsumableType, string> = {
  repair: 'repairKit',
  applique: 'shield',
  overdrive: 'speed',
  smoke: 'smoke',
  steady: 'strike',
  relocate: 'speed',
  rapidReload: 'reset',
  fieldRepair: 'heal',
  bulwark: 'shield',
};

function svg(body: string, cls: string): string {
  return `<svg class="ico${cls ? ` ${cls}` : ''}" viewBox="-12 -12 24 24" aria-hidden="true">${body}</svg>`;
}

export function skillIcon(name: SkillIcon | string, cls = ''): string {
  return svg(GLYPHS[name] ?? GLYPHS.star, cls);
}

export function consumableIcon(type: ConsumableType, cls = ''): string {
  return svg(GLYPHS[CONSUMABLE_GLYPH[type]], cls);
}

export function pickupIcon(kind: PickupKind, cls = ''): string {
  return svg(GLYPHS[PICKUP_GLYPH[kind]], cls);
}

export function classIcon(cls: ShipClass, extra = ''): string {
  return svg(CLASS_GLYPH[cls], extra);
}

export function vehicleClassIcon(cls: VehicleClass, extra = ''): string {
  return svg(VEHICLE_GLYPH[cls], extra);
}

export function groundConsumableIcon(type: GroundConsumableType, cls = ''): string {
  return svg(GLYPHS[GROUND_CONSUMABLE_GLYPH[type]], cls);
}

export function glyph(name: string, cls = ''): string {
  return svg(GLYPHS[name] ?? '', cls);
}
