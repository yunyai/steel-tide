import { DEG } from '../core/math';
import type { TorpedoLauncherSpec } from '../core/types';

export type TorpedoReadiness = 'ready' | 'reloading' | 'outside arc' | 'too deep' | 'stunned' | 'disarmed';
export interface TorpedoSolution {
  x: number;
  z: number;
  bearing: number;
  range: number;
  spread: number;
  headings: number[];
  /** Relative to the ship heading, inclusive, in radians. */
  sectors: [number, number][];
  readiness: TorpedoReadiness;
}
/** Shared by firing eligibility and the water-plane firing sector overlay. */
export function torpedoSectors(side: TorpedoLauncherSpec['side']): [number, number][] {
  const sectors: [number, number][] = side === 1 ? [[25, 155]] : side === -1 ? [[-155, -25]]
    : side === 2 ? [[-40, 40]] : side === -2 ? [[-180, -140], [140, 180]] : [[-155, -25], [25, 155]];
  return sectors.map(([lo, hi]) => [lo * DEG, hi * DEG]);
}
