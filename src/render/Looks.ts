import { Color } from 'three';
import type { GunLook, MissileLook, TorpLook } from '../core/types';

// How each era's rounds read in flight: tracer colour and shape, muzzle flash, and wake.

export interface GunStyle {
  /** Tracer colour (HDR, so it blooms). */
  color: Color;
  /** Tracer width and length multipliers over a plain shell of the same calibre. */
  width: number;
  length: number;
  /** Muzzle flash, inner and outer colour. */
  flash: number;
  flash1: number;
  /** Share of the usual gun smoke (magic and energy weapons hardly smoke). */
  smoke: number;
}

const style = (color: number, k: number, width: number, length: number, flash: number, flash1: number, smoke: number): GunStyle => ({
  color: new Color(color).multiplyScalar(k),
  width,
  length,
  flash,
  flash1,
  smoke,
});

/** `shell` keeps the AP/HE colours; the others replace them. */
export const GUN_STYLE: Record<GunLook, GunStyle> = {
  shell: style(0xd8ecff, 2.2, 1, 1, 0xffe0a0, 0xff5a10, 1),
  starbolt: style(0xe4f4ff, 3.2, 0.8, 1.8, 0xf4fbff, 0x9fd8ff, 0.15),
  runefire: style(0xff7a20, 3, 1.3, 1.1, 0xffc060, 0xff3a00, 0.6),
  soulfire: style(0x60ff9a, 2.8, 1.2, 1.2, 0xc0ffd8, 0x20c060, 0.2),
  arcane: style(0xb070ff, 3, 1.7, 0.55, 0xe8d0ff, 0x8040ff, 0.1),
  rail: style(0x60e8ff, 3, 2.5, 10, 0xd0f8ff, 0x40a0ff, 0.3),
  laser: style(0xff4a6a, 3.6, 1.5, 30, 0xffd0e0, 0xff2050, 0),
  plasma: style(0x70ffe0, 3, 2.2, 0.5, 0xe0fff8, 0x20d0b0, 0.2),
};

/** Missiles drawn as a glowing streak instead of a body, and their colour. */
export const MISSILE_GLOW: Partial<Record<MissileLook, Color>> = {
  bolt: new Color(0xb070ff).multiplyScalar(3),
  arrow: new Color(0xd8ffe0).multiplyScalar(3),
  rune: new Color(0xffa040).multiplyScalar(3),
  hammer: new Color(0xb8e0ff).multiplyScalar(4),
  boar: new Color(0xffc840).multiplyScalar(3.5),
  spear: new Color(0xfff0b0).multiplyScalar(5),
  star: new Color(0xd0b8ff).multiplyScalar(4),
};

/** Wake colours of torpedoes that glow (own side, enemy side). */
export const TORP_WAKE: Partial<Record<TorpLook, [Color, Color]>> = {
  eel: [new Color(0x80ffd0).multiplyScalar(1.6), new Color(0xa0ffc0).multiplyScalar(2)],
  lance: [new Color(0x70c8ff).multiplyScalar(1.8), new Color(0xff90c0).multiplyScalar(2)],
};
