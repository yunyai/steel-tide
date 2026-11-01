// Ocean swell parameters shared between the GPU shader and CPU buoyancy.
// Each wave: direction (radians), wavelength (m), amplitude (m), steepness.
//
// A dozen swells, wavelengths stepping from 158 m down to 24 m and directions fanned to either side
// of the wind (0.35 rad), so the crests cross at many angles. A handful of plane waves all but
// repeat: four of them laid the same egg-crate every few hundred metres. The sea state (height and
// roughness) is the four swells' within a few per cent.

export interface Wave {
  dir: number;
  length: number;
  amp: number;
  steep: number;
}

export const WAVES: Wave[] = [
  { dir: 1.83, length: 158, amp: 0.59, steep: 0.3 },
  { dir: -0.84, length: 141, amp: 0.63, steep: 0.3 },
  { dir: 0.95, length: 117, amp: 0.67, steep: 0.3 },
  { dir: -0.69, length: 97, amp: 0.43, steep: 0.3 },
  { dir: 1.31, length: 82, amp: 0.36, steep: 0.3 },
  { dir: 0.15, length: 71, amp: 0.38, steep: 0.3 },
  { dir: 1.18, length: 57, amp: 0.24, steep: 0.3 },
  { dir: -0.4, length: 47, amp: 0.19, steep: 0.3 },
  { dir: 1.52, length: 40, amp: 0.13, steep: 0.3 },
  { dir: -1.03, length: 34, amp: 0.09, steep: 0.3 },
  { dir: 0.8, length: 28, amp: 0.11, steep: 0.3 },
  { dir: 0.09, length: 24, amp: 0.09, steep: 0.3 },
];

const G = 9.81;

/** Each swell's direction, wavenumber and phase speed, worked out once. */
const TERMS = WAVES.map((w) => {
  const k = (2 * Math.PI) / w.length;
  return { dx: Math.cos(w.dir), dz: Math.sin(w.dir), k, c: Math.sqrt(G / k), amp: w.amp };
});

/** Approximate surface height (ignores horizontal Gerstner displacement). */
export function waveHeight(x: number, z: number, t: number): number {
  let h = 0;
  for (const w of TERMS) h += w.amp * Math.sin(w.k * (w.dx * x + w.dz * z - w.c * t));
  return h;
}
