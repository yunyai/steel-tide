import { Color } from 'three';
import { display } from '../input/Settings';

// Team and cue colours. The colour-blind palette keeps ally cyan but turns enemy red to
// vermilion and green cues to sky blue, so no cue depends on telling red from green.

const STANDARD = { enemy: '#ff3b4e', good: '#5dff9a' };
const COLOUR_BLIND = { enemy: '#ff7424', good: '#5cb8ff' };

export const ALLY = '#4de8ff';
/** The enemy colour for 3D effects, kept in step with the palette. */
export const ENEMY_COLOR = new Color(STANDARD.enemy);

export function palette(): { enemy: string; good: string } {
  return display().colourBlind ? COLOUR_BLIND : STANDARD;
}

/** Put the palette on the page's CSS variables and the 3D effects. */
export function applyPalette(): void {
  ENEMY_COLOR.set(palette().enemy);
  if (typeof document !== 'undefined') document.documentElement.toggleAttribute('data-colour-blind', display().colourBlind);
}
