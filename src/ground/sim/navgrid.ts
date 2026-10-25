import { NAV_CELL } from './config';
import { blocksVehicles, type Prop, type Props } from './props';
import { MAT, type Terrain } from './terrain';

// AI path finding on a coarse grid over the map. A cell is shut by water, ground too steep to
// climb, or a standing house, wall, rock or wreck (padded by half a hull). Collapsed props open
// their cells again. Titans plough through props, so they path on the ground alone.

/** Steepest ground (deg) the bots will plan a route over. */
const MAX_SLOPE = 28;
/** Clearance kept from blocking props (m). */
const PAD = 2.6;
const SQRT2 = Math.SQRT2;

export interface Waypoint {
  x: number;
  z: number;
}

export class NavGrid {
  readonly n: number;
  readonly cell = NAV_CELL;
  /** Shut by the ground (water, slope), by standing props, and the two together. */
  private ground: Uint8Array;
  private propBlock: Uint8Array;
  // A* scratch, reused between searches.
  private g: Float32Array;
  private from: Int32Array;
  private seen: Uint32Array;
  private shut: Uint32Array;
  private search = 0;
  private heap: number[] = [];
  private heapF: number[] = [];

  constructor(
    private terrain: Terrain,
    private props: Props,
  ) {
    this.n = Math.floor((terrain.half * 2) / NAV_CELL);
    const size = this.n * this.n;
    this.ground = new Uint8Array(size);
    this.propBlock = new Uint8Array(size);
    this.g = new Float32Array(size);
    this.from = new Int32Array(size);
    this.seen = new Uint32Array(size);
    this.shut = new Uint32Array(size);
    for (let j = 0; j < this.n; j++) {
      for (let i = 0; i < this.n; i++) this.ground[j * this.n + i] = this.groundShut(this.cx(i), this.cx(j)) ? 1 : 0;
    }
    for (const p of props.list) this.updateProp(p);
  }

  /** World centre of column i (or row j). */
  cx(i: number): number {
    return -this.terrain.half + (i + 0.5) * NAV_CELL;
  }

  index(x: number, z: number): number {
    const i = Math.floor((x + this.terrain.half) / NAV_CELL);
    const j = Math.floor((z + this.terrain.half) / NAV_CELL);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return -1;
    return j * this.n + i;
  }

  private groundShut(x: number, z: number): boolean {
    const t = this.terrain;
    const edge = t.half - 30;
    if (Math.abs(x) > edge || Math.abs(z) > edge) return true;
    if (t.materialAt(x, z) === MAT.water || t.heightAt(x, z) < t.waterLevel - 0.3) return true;
    const q = NAV_CELL * 0.35;
    for (const [dx, dz] of [[0, 0], [q, 0], [-q, 0], [0, q], [0, -q]]) if (t.slopeDeg(x + dx, z + dz) > MAX_SLOPE) return true;
    return false;
  }

  private propShut(x: number, z: number): boolean {
    for (const p of this.props.near(x, z, PAD + 1, scratch)) {
      if (!blocksVehicles(p) || p.kind === 'tree' || p.kind === 'fence') continue;
      const c = Math.cos(p.rot);
      const s = Math.sin(p.rot);
      const dx = x - p.x;
      const dz = z - p.z;
      if (Math.abs(c * dx + s * dz) <= p.hw + PAD && Math.abs(-s * dx + c * dz) <= p.hd + PAD) return true;
    }
    return false;
  }

  /** Re-check the cells under a prop that rose or fell. */
  updateProp(p: Prop): void {
    const r = Math.hypot(p.hw, p.hd) + PAD + NAV_CELL;
    const i0 = Math.max(0, Math.floor((p.x - r + this.terrain.half) / NAV_CELL));
    const i1 = Math.min(this.n - 1, Math.floor((p.x + r + this.terrain.half) / NAV_CELL));
    const j0 = Math.max(0, Math.floor((p.z - r + this.terrain.half) / NAV_CELL));
    const j1 = Math.min(this.n - 1, Math.floor((p.z + r + this.terrain.half) / NAV_CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.propBlock[j * this.n + i] = this.propShut(this.cx(i), this.cx(j)) ? 1 : 0;
  }

  open(k: number, titan = false): boolean {
    return k >= 0 && !this.ground[k] && (titan || !this.propBlock[k]);
  }

  openAt(x: number, z: number, titan = false): boolean {
    return this.open(this.index(x, z), titan);
  }

  /** Nearest open cell to a point (searching outward ring by ring), or -1. */
  nearestOpen(x: number, z: number, titan = false, maxRing = 12): number {
    const k = this.index(x, z);
    if (this.open(k, titan)) return k;
    const ci = Math.floor((x + this.terrain.half) / NAV_CELL);
    const cj = Math.floor((z + this.terrain.half) / NAV_CELL);
    for (let r = 1; r <= maxRing; r++) {
      let best = -1;
      let bestD = Infinity;
      for (let j = cj - r; j <= cj + r; j++) {
        for (let i = ci - r; i <= ci + r; i++) {
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r || i < 0 || j < 0 || i >= this.n || j >= this.n) continue;
          const kk = j * this.n + i;
          if (!this.open(kk, titan)) continue;
          const d = Math.hypot(this.cx(i) - x, this.cx(j) - z);
          if (d < bestD) {
            bestD = d;
            best = kk;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /** Can a hull drive straight from a to b over open cells? */
  clearLine(ax: number, az: number, bx: number, bz: number, titan = false): boolean {
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(d / (NAV_CELL * 0.5));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      if (!this.openAt(ax + (bx - ax) * t, az + (bz - az) * t, titan)) return false;
    }
    return true;
  }

  /** Shortest route of waypoints from a to b (string-pulled), or null if there is none. */
  path(ax: number, az: number, bx: number, bz: number, titan = false, budget = 40000): Waypoint[] | null {
    const start = this.nearestOpen(ax, az, titan);
    const goal = this.nearestOpen(bx, bz, titan);
    if (start < 0 || goal < 0) return null;
    const n = this.n;
    const q = ++this.search;
    const gi = goal % n;
    const gj = Math.floor(goal / n);
    const h = (k: number) => {
      const dx = Math.abs((k % n) - gi);
      const dz = Math.abs(Math.floor(k / n) - gj);
      return (Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz)) * 1.02;
    };
    this.heap.length = 0;
    this.heapF.length = 0;
    this.g[start] = 0;
    this.seen[start] = q;
    this.from[start] = -1;
    this.push(start, h(start));
    let found = false;
    let expanded = 0;
    while (this.heap.length) {
      const k = this.pop();
      if (this.shut[k] === q) continue;
      this.shut[k] = q;
      if (k === goal) {
        found = true;
        break;
      }
      if (++expanded > budget) break;
      const i = k % n;
      const j = Math.floor(k / n);
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = i + di;
          const nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
          const nk = nj * n + ni;
          if (!this.open(nk, titan) || this.shut[nk] === q) continue;
          // No cutting corners past a shut cell.
          if (di && dj && (!this.open(j * n + ni, titan) || !this.open(nj * n + i, titan))) continue;
          const ng = this.g[k] + (di && dj ? SQRT2 : 1);
          if (this.seen[nk] === q && ng >= this.g[nk]) continue;
          this.seen[nk] = q;
          this.g[nk] = ng;
          this.from[nk] = k;
          this.push(nk, ng + h(nk));
        }
      }
    }
    if (!found) return null;
    const cells: number[] = [];
    for (let k = goal; k >= 0; k = this.from[k]) cells.push(k);
    cells.reverse();
    const pts = cells.map((k) => ({ x: this.cx(k % n), z: this.cx(Math.floor(k / n)) }));
    pts[pts.length - 1] = { x: bx, z: bz };
    // String-pull: skip every waypoint the hull can drive past in a straight line.
    const out: Waypoint[] = [];
    let a = { x: ax, z: az };
    let idx = 0;
    while (idx < pts.length) {
      let far = idx;
      for (let k = Math.min(pts.length - 1, idx + 24); k > idx; k--) {
        if (this.clearLine(a.x, a.z, pts[k].x, pts[k].z, titan)) {
          far = k;
          break;
        }
      }
      out.push(pts[far]);
      a = pts[far];
      idx = far + 1;
    }
    return out;
  }

  private push(k: number, f: number): void {
    const h = this.heap;
    const hf = this.heapF;
    h.push(k);
    hf.push(f);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hf[p] <= f) break;
      h[i] = h[p];
      hf[i] = hf[p];
      i = p;
    }
    h[i] = k;
    hf[i] = f;
  }

  private pop(): number {
    const h = this.heap;
    const hf = this.heapF;
    const top = h[0];
    const k = h.pop()!;
    const f = hf.pop()!;
    if (h.length) {
      let i = 0;
      const n = h.length;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && hf[r] < hf[l] ? r : l;
        if (hf[c] >= f) break;
        h[i] = h[c];
        hf[i] = hf[c];
        i = c;
      }
      h[i] = k;
      hf[i] = f;
    }
    return top;
  }
}

const scratch: Prop[] = [];
