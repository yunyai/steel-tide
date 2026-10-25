import type { ShipSpec } from '../../core/types';
import { AOT, AOT_FORMS, AOT_SUMMONS } from './aot';
import { BLEACH, BLEACH_FORMS, BLEACH_SUMMONS } from './bleach';
import { DEMONSLAYER, DEMONSLAYER_FORMS, DEMONSLAYER_SUMMONS } from './demonslayer';
import { DRAGONBALL, DRAGONBALL_FORMS } from './dragonball';
import { JJK, JJK_FORMS, JJK_SUMMONS } from './jjk';
import { MHA, MHA_FORMS } from './mha';
import { NARUTO_FORMS, NARUTO_SHIPS, NARUTO_SUMMONS } from './naruto';
import { ONEPIECE, ONEPIECE_FORMS } from './onepiece';

// The anime roster: three ships per series, one per character, written on the historic scale like
// every line ship. Each one's ultimate is a Titan Shift into its form (ANIME_FORMS): a hidden
// titan, at final HP like the other titans, that the ship turns into for a short while (see
// Ship.shiftNow).

/** Every anime line ship, series by series. */
export const ANIME: ShipSpec[] = [...JJK, ...NARUTO_SHIPS, ...ONEPIECE, ...DRAGONBALL, ...BLEACH, ...AOT, ...DEMONSLAYER, ...MHA];

/** The Titan Shift forms: hidden titans, never in the hangar; Boss Rush sends them in as bosses. */
export const ANIME_FORMS: ShipSpec[] = [
  ...JJK_FORMS,
  ...NARUTO_FORMS,
  ...ONEPIECE_FORMS,
  ...DRAGONBALL_FORMS,
  ...BLEACH_FORMS,
  ...AOT_FORMS,
  ...DEMONSLAYER_FORMS,
  ...MHA_FORMS,
];

/** Summon-only hulls (clones, shikigami, mirages, Wall Titans, Nezuko, Upper Moons). */
export const ANIME_SUMMONS: ShipSpec[] = [...JJK_SUMMONS, ...NARUTO_SUMMONS, ...BLEACH_SUMMONS, ...AOT_SUMMONS, ...DEMONSLAYER_SUMMONS];
