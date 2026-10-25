import type { Team } from '../../core/types';
import { PROP_BUCKET } from './config';

// Everything standing on the ground: houses, walls, fences, trees, rocks and burned-out cars.
// Each is an upright box turned about its centre. Props wear down through intact, damaged and
// rubble; rubble no longer stops shells, sight or tanks. Bucketed for quick lookups.

export type PropKind = 'building' | 'wall' | 'fence' | 'tree' | 'rock' | 'car' | 'hedge';

export const PROP_INTACT = 0;
export const PROP_DAMAGED = 1;
export const PROP_RUBBLE = 2;
export type PropState = 0 | 1 | 2;

export interface Prop {
  id: number;
  kind: PropKind;
  x: number;
  z: number;
  /** Ground height at the base. */
  y: number;
  /** Half extents along the prop's own x and z. */
  hw: number;
  hd: number;
  /** Yaw of the prop's x axis (radians, about +Y). */
  rot: number;
  h: number;
  hp: number;
  maxHp: number;
  state: PropState;
  /** Look variant for the render (facade, tree species...). */
  style: number;
  /** Raised by a skill: whose cover it is, and the sim time it fades. */
  team?: Team;
  expires?: number;
}

/** What a prop stops while it stands. */
export function blocksShells(p: Prop): boolean {
  if (p.state === PROP_RUBBLE) return false;
  return p.kind !== 'tree' && p.kind !== 'fence';
}

export function blocksVehicles(p: Prop): boolean {
  return p.state !== PROP_RUBBLE;
}

/** Tonnes a vehicle needs to drive straight through a prop (Infinity: never). */
export function flattenMass(p: Prop): number {
  switch (p.kind) {
    case 'fence':
      return 0;
    case 'tree':
      return 6;
    case 'hedge':
      return 25;
    case 'wall':
    case 'car':
      return 30;
    default:
      return Infinity;
  }
}

/** Hit points for a prop of this kind and footprint. */
export function propHp(kind: PropKind, hw: number, hd: number, h: number): number {
  switch (kind) {
    case 'building':
      return Math.round(900 + hw * hd * 4 * 4 + h * 40);
    case 'wall':
      return 700;
    case 'hedge':
      return 1500;
    case 'car':
      return 500;
    case 'fence':
      return 80;
    case 'tree':
      return 250;
    default:
      return Infinity;
  }
}

export interface PropHit {
  prop: Prop;
  /** Fraction along the segment. */
  t: number;
  /** World normal of the face struck (y up for the roof). */
  nx: number;
  ny: number;
  nz: number;
}

export class Props {
  readonly list: Prop[] = [];
  private readonly buckets: number[][];
  private readonly side: number;
  /** Per-query stamps so a prop in several buckets is visited once. */
  private stamp: Uint32Array = new Uint32Array(64);
  private query = 0;

  constructor(readonly half: number) {
    this.side = Math.ceil((half * 2) / PROP_BUCKET);
    this.buckets = Array.from({ length: this.side * this.side }, () => []);
  }

  add(p: Omit<Prop, 'id' | 'hp' | 'maxHp' | 'state'> & { hp?: number; state?: PropState }): Prop {
    const hp = p.hp ?? propHp(p.kind, p.hw, p.hd, p.h);
    const prop: Prop = { ...p, id: this.list.length, hp, maxHp: hp, state: p.state ?? PROP_INTACT };
    this.list.push(prop);
    if (this.stamp.length < this.list.length) {
      const s = new Uint32Array(this.stamp.length * 2);
      s.set(this.stamp);
      this.stamp = s;
    }
    const r = Math.hypot(prop.hw, prop.hd);
    this.eachBucket(prop.x - r, prop.z - r, prop.x + r, prop.z + r, (b) => this.buckets[b].push(prop.id));
    return prop;
  }

  private eachBucket(x0: number, z0: number, x1: number, z1: number, f: (b: number) => void): void {
    const s = this.side;
    const i0 = Math.max(0, Math.floor((x0 + this.half) / PROP_BUCKET));
    const j0 = Math.max(0, Math.floor((z0 + this.half) / PROP_BUCKET));
    const i1 = Math.min(s - 1, Math.floor((x1 + this.half) / PROP_BUCKET));
    const j1 = Math.min(s - 1, Math.floor((z1 + this.half) / PROP_BUCKET));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) f(j * s + i);
  }

  /** Props whose buckets touch the box, each once. */
  inBox(x0: number, z0: number, x1: number, z1: number, out: Prop[] = []): Prop[] {
    out.length = 0;
    const q = ++this.query;
    this.eachBucket(x0, z0, x1, z1, (b) => {
      for (const id of this.buckets[b]) {
        if (this.stamp[id] === q) continue;
        this.stamp[id] = q;
        out.push(this.list[id]);
      }
    });
    return out;
  }

  near(x: number, z: number, r: number, out: Prop[] = []): Prop[] {
    return this.inBox(x - r, z - r, x + r, z + r, out);
  }

  /** A world point in the prop's frame. */
  static local(p: Prop, x: number, z: number): { lx: number; lz: number } {
    const dx = x - p.x;
    const dz = z - p.z;
    const c = Math.cos(p.rot);
    const s = Math.sin(p.rot);
    return { lx: c * dx + s * dz, lz: -s * dx + c * dz };
  }

  /**
   * Push a circle out of the prop's footprint: the shove (world x, z) or null if they do not touch.
   */
  static circlePush(p: Prop, x: number, z: number, r: number): { px: number; pz: number } | null {
    const { lx, lz } = Props.local(p, x, z);
    const cx = Math.max(-p.hw, Math.min(p.hw, lx));
    const cz = Math.max(-p.hd, Math.min(p.hd, lz));
    let ex = lx - cx;
    let ez = lz - cz;
    let d = Math.hypot(ex, ez);
    let push: number;
    if (d > 1e-6) {
      if (d >= r) return null;
      push = r - d;
      ex /= d;
      ez /= d;
    } else {
      // Centre inside the box: out through the nearest face.
      const ox = p.hw - Math.abs(lx);
      const oz = p.hd - Math.abs(lz);
      if (ox < oz) {
        ex = lx < 0 ? -1 : 1;
        ez = 0;
        push = ox + r;
      } else {
        ex = 0;
        ez = lz < 0 ? -1 : 1;
        push = oz + r;
      }
      d = 0;
    }
    const c = Math.cos(p.rot);
    const s = Math.sin(p.rot);
    return { px: (c * ex - s * ez) * push, pz: (s * ex + c * ez) * push };
  }

  /** Does a point stand inside a prop that blocks vehicles? */
  blockedAt(x: number, z: number, pad = 0): Prop | null {
    for (const p of this.near(x, z, pad + 1)) {
      if (!blocksVehicles(p) || p.kind === 'tree' || p.kind === 'fence') continue;
      const { lx, lz } = Props.local(p, x, z);
      if (Math.abs(lx) <= p.hw + pad && Math.abs(lz) <= p.hd + pad) return p;
    }
    return null;
  }

  /** First standing prop that stops a shell along the segment (nearest), or null. */
  segment(ax: number, ay: number, az: number, bx: number, by: number, bz: number, skip?: (p: Prop) => boolean): PropHit | null {
    const cand = this.inBox(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), segScratch);
    let best: PropHit | null = null;
    for (const p of cand) {
      if (!blocksShells(p) || skip?.(p)) continue;
      const hit = segmentProp(p, ax, ay, az, bx, by, bz);
      if (hit && (!best || hit.t < best.t)) best = hit;
    }
    return best;
  }
}

const segScratch: Prop[] = [];

/** Slab test of a segment against a prop's turned box. */
export function segmentProp(p: Prop, ax: number, ay: number, az: number, bx: number, by: number, bz: number): PropHit | null {
  const c = Math.cos(p.rot);
  const s = Math.sin(p.rot);
  const dx0 = ax - p.x;
  const dz0 = az - p.z;
  const o = [c * dx0 + s * dz0, ay - p.y, -s * dx0 + c * dz0];
  const ddx = bx - ax;
  const ddz = bz - az;
  const d = [c * ddx + s * ddz, by - ay, -s * ddx + c * ddz];
  const lo = [-p.hw, 0, -p.hd];
  const hi = [p.hw, p.h, p.hd];
  let t0 = 0;
  let t1 = 1;
  let axis = -1;
  let sign = 1;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < lo[i] || o[i] > hi[i]) return null;
      continue;
    }
    let ta = (lo[i] - o[i]) / d[i];
    let tb = (hi[i] - o[i]) / d[i];
    let sg = -1;
    if (ta > tb) {
      const tmp = ta;
      ta = tb;
      tb = tmp;
      sg = 1;
    }
    if (ta > t0) {
      t0 = ta;
      axis = i;
      sign = sg;
    }
    if (tb < t1) t1 = tb;
    if (t0 > t1) return null;
  }
  if (axis < 0) return { prop: p, t: 0, nx: 0, ny: 1, nz: 0 };
  // Local face normal back to world.
  const lnx = axis === 0 ? sign : 0;
  const lny = axis === 1 ? sign : 0;
  const lnz = axis === 2 ? sign : 0;
  return { prop: p, t: t0, nx: c * lnx - s * lnz, ny: lny, nz: s * lnx + c * lnz };
}
