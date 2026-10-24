// Ocean swell parameters shared between the GPU shader and CPU buoyancy.
// Each wave: direction (radians), wavelength (m), amplitude (m), steepness.

export interface Wave {
  dir: number;
  length: number;
  amp: number;
  steep: number;
}

export const WAVES: Wave[] = [
  { dir: 0.35, length: 140, amp: 1.1, steep: 0.35 },
  { dir: -0.6, length: 90, amp: 0.65, steep: 0.35 },
  { dir: 1.3, length: 55, amp: 0.35, steep: 0.3 },
  { dir: 2.4, length: 31, amp: 0.18, steep: 0.3 },
];

const G = 9.81;

/** Approximate surface height (ignores horizontal Gerstner displacement). */
export function waveHeight(x: number, z: number, t: number): number {
  let h = 0;
  for (const w of WAVES) {
    const k = (2 * Math.PI) / w.length;
    const c = Math.sqrt(G / k);
    const dx = Math.cos(w.dir);
    const dz = Math.sin(w.dir);
    h += w.amp * Math.sin(k * (dx * x + dz * z - c * t));
  }
  return h;
}
