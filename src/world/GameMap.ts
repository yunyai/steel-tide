import { MAP_HALF } from '../config';
import { makeRng, segmentHitsCircle } from '../core/math';

// Headless island terrain + map presets. Rendering builds meshes from heightAt().

export interface Island {
  x: number;
  z: number;
  /** Nominal radius. */
  r: number;
  /** Peak height. */
  h: number;
  seed: number;
  /** Radius that blocks line of sight. */
  losR: number;
}

export interface CapPoint {
  name: string;
  x: number;
  z: number;
}

export interface MapPreset {
  id: string;
  name: string;
  description: string;
  sun: { elevation: number; azimuth: number };
  turbidity: number;
  islands: (seed: number) => Island[];
  caps: CapPoint[];
}

// Presets are laid out on the original 18 km chart and shrunk to MAP_SIZE here, so the
// layouts keep their shape whatever the battle scale.
const CHART_HALF = 9000;
const K = MAP_HALF / CHART_HALF;
/** Islands lose less height than footprint so they still hide hulls. */
const HEIGHT_K = Math.min(1, K * 1.4);

function island(x: number, z: number, r: number, h: number, seed: number): Island {
  return { x: x * K, z: z * K, r: r * K, h: h * HEIGHT_K, seed, losR: r * K * 0.62 };
}

function cap(name: string, x: number, z: number): CapPoint {
  return { name, x: x * K, z: z * K };
}

function scatter(seed: number, count: number, minR: number, maxR: number, keepOut: (x: number, z: number) => boolean): Island[] {
  const rng = makeRng(seed);
  const out: Island[] = [];
  let tries = 0;
  while (out.length < count && tries++ < 500) {
    const r = minR + rng() * (maxR - minR);
    const x = (rng() * 2 - 1) * (CHART_HALF - 2500);
    const z = (rng() * 2 - 1) * (CHART_HALF - 1500);
    if (keepOut(x, z)) continue;
    // Channels must stay wide enough for full-size hulls to turn in.
    if (out.some((o) => Math.hypot(o.x / K - x, o.z / K - z) < o.r / K + r + 700 / K)) continue;
    out.push(island(x, z, r, 60 + rng() * 140, Math.floor(rng() * 1e6)));
  }
  return out;
}

/** Chart coordinates. */
const spawnKeepOut = (x: number) => Math.abs(x) > CHART_HALF - 3500;

export const MAPS: MapPreset[] = [
  {
    id: 'strait',
    name: 'Iron Strait',
    description: 'A rocky chain splits the map. Gaps between islands become kill zones; flanks are open water.',
    sun: { elevation: 14, azimuth: 200 },
    turbidity: 6,
    caps: [
      cap('A', 0, -5600),
      cap('B', 0, 0),
      cap('C', 0, 5600),
    ],
    islands: () => [
      island(-600, -2800, 620, 150, 11),
      island(700, -3300, 380, 90, 12),
      island(500, 2800, 650, 170, 13),
      island(-700, 3400, 420, 110, 14),
      island(-2600, -6400, 520, 120, 15),
      island(2600, 6400, 520, 120, 16),
      island(-3200, 1200, 330, 80, 17),
      island(3200, -1200, 330, 80, 18),
      island(0, -8000, 700, 160, 19),
      island(0, 8000, 700, 160, 20),
    ],
  },
  {
    id: 'open',
    name: 'Open Sea',
    description: 'Almost no cover. A long-range gunnery duel where angling your armour decides everything.',
    sun: { elevation: 32, azimuth: 140 },
    turbidity: 3,
    caps: [
      cap('A', 0, -4500),
      cap('B', 0, 0),
      cap('C', 0, 4500),
    ],
    islands: () => [island(-1800, -1800, 280, 70, 31), island(1800, 2000, 300, 70, 32)],
  },
  {
    id: 'archipelago',
    name: 'Shattered Archipelago',
    description: 'Dozens of islands: destroyer and submarine heaven, battleship nightmare.',
    sun: { elevation: 8, azimuth: 250 },
    turbidity: 9,
    caps: [
      cap('A', -800, -5000),
      cap('B', 0, 0),
      cap('C', 800, 5000),
    ],
    islands: (seed) =>
      scatter(seed, 16, 250, 600, (x, z) => spawnKeepOut(x) || [[-800, -5000], [0, 0], [800, 5000]].some(([cx, cz]) => Math.hypot(x - cx, z - cz) < 1500)),
  },
  {
    id: 'dusk',
    name: 'Crimson Dusk',
    description: 'A blood-red sunset over three volcanic rocks. Mid-range brawling where beams and fires light up the dark.',
    sun: { elevation: 5, azimuth: 285 },
    turbidity: 16,
    caps: [
      cap('A', -2500, -4200),
      cap('B', 0, 0),
      cap('C', 2500, 4200),
    ],
    islands: () => [
      island(-2200, 600, 520, 180, 41),
      island(2200, -600, 520, 180, 42),
      island(0, -2600, 300, 120, 43),
      island(0, 2600, 300, 120, 44),
    ],
  },
];

export const MAP_BY_ID: Record<string, MapPreset> = Object.fromEntries(MAPS.map((m) => [m.id, m]));

const SEABED = -40;

export class GameMap {
  readonly islands: Island[];

  constructor(
    readonly preset: MapPreset,
    seed: number,
  ) {
    this.islands = preset.islands(seed);
  }

  /** Lobed radius of an island in a given direction. */
  static radiusAt(isl: Island, angle: number): number {
    const s = isl.seed;
    return isl.r * (1 + 0.22 * Math.sin(3 * angle + s) + 0.13 * Math.sin(5 * angle + s * 1.7) + 0.07 * Math.sin(9 * angle + s * 0.3));
  }

  /** Terrain height at a world point (negative = underwater). */
  heightAt(x: number, z: number): number {
    let h = SEABED;
    for (const isl of this.islands) {
      const dx = x - isl.x;
      const dz = z - isl.z;
      const d2 = dx * dx + dz * dz;
      const reach = isl.r * 1.6;
      if (d2 > reach * reach) continue;
      const d = Math.sqrt(d2);
      const rr = GameMap.radiusAt(isl, Math.atan2(dz, dx));
      const f = 1 - d / rr;
      let v: number;
      if (f > 0) {
        const ridge = 0.85 + 0.15 * Math.sin(dx * 0.02 + isl.seed) * Math.cos(dz * 0.017 + isl.seed);
        v = isl.h * Math.pow(f, 0.9) * ridge + 2;
      } else {
        v = 2 + f * 120;
      }
      if (v > h) h = v;
    }
    return h;
  }

  /** Unit vector pointing away from the nearest island. */
  awayFromLand(x: number, z: number): { x: number; z: number } {
    let best: Island | null = null;
    let bd = Infinity;
    for (const isl of this.islands) {
      const d = Math.hypot(x - isl.x, z - isl.z) - isl.r;
      if (d < bd) {
        bd = d;
        best = isl;
      }
    }
    if (!best) return { x: 0, z: 0 };
    const dx = x - best.x;
    const dz = z - best.z;
    const l = Math.hypot(dx, dz) || 1;
    return { x: dx / l, z: dz / l };
  }

  /** True if islands block the view between two points. */
  losBlocked(ax: number, az: number, bx: number, bz: number): boolean {
    for (const isl of this.islands) {
      if (segmentHitsCircle(ax, az, bx, bz, isl.x, isl.z, isl.losR)) return true;
    }
    return false;
  }
}
