import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  RGBAFormat,
} from 'three';
import type { Bridge } from '../sim/maps';
import { fbm, hash2, MAT, type Terrain } from '../sim/terrain';

// The ground as one mesh: the sim's heightfield, coloured per vertex from the materials around
// it, the slope and a little noise, with a tiling grain texture on top. Areas the battle changes
// (rubble where a house fell, craters) are redrawn in place. Plus the canal's water, an apron
// beyond the edge so the world does not end in a cliff, and the bridges' stonework.

/** Material colours (sRGB). */
const MAT_COLOR: Record<number, number> = {
  [MAT.dirt]: 0x6a5c4a,
  [MAT.grass]: 0x4c5732,
  [MAT.road]: 0x58554f,
  [MAT.rubble]: 0x7d7264,
  [MAT.snow]: 0xe6edf2,
  [MAT.deepSnow]: 0xf2f6f9,
  [MAT.ice]: 0x9fc2d4,
  [MAT.water]: 0x3c3a30,
  [MAT.mud]: 0x463c2e,
  [MAT.rail]: 0x3e3730,
};
const ROCK = new Color(0x5e5952);
const SEED = 77;

const tmp = new Color();
const acc = new Color();

/** A soft grey grain that tiles, multiplied over the vertex colours. */
function grainTexture(): DataTexture {
  const n = 128;
  const data = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      // Wrapping noise: sample a torus of lattice points so the edges meet.
      let v = 0;
      let amp = 0.5;
      for (let o = 0; o < 4; o++) {
        const s = 8 << o;
        const fx = (i / n) * s;
        const fz = (j / n) * s;
        const ix = Math.floor(fx);
        const iz = Math.floor(fz);
        const tx = fx - ix;
        const tz = fz - iz;
        const a = hash2(ix % s, iz % s, SEED + o);
        const b = hash2((ix + 1) % s, iz % s, SEED + o);
        const c = hash2(ix % s, (iz + 1) % s, SEED + o);
        const d = hash2((ix + 1) % s, (iz + 1) % s, SEED + o);
        v += (a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz) * amp;
        amp *= 0.5;
      }
      const g = Math.round(255 * (0.72 + v * 0.3));
      const k = (j * n + i) * 4;
      data[k] = data[k + 1] = data[k + 2] = g;
      data[k + 3] = 255;
    }
  }
  const t = new DataTexture(data, n, n, RGBAFormat);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

export class TerrainView {
  readonly group = new Group();
  readonly mesh: Mesh<BufferGeometry, MeshStandardMaterial>;
  private geo: BufferGeometry;
  private grain: DataTexture;
  /** Terrain vertices per mesh vertex step (2 on the lowest quality). */
  private stride: number;
  /** Mesh vertices per side. */
  private N: number;
  private disposables: { dispose(): void }[] = [];

  constructor(
    private terrain: Terrain,
    bridges: Bridge[],
    lite: boolean,
  ) {
    const t = terrain;
    this.stride = lite ? 2 : 1;
    this.N = Math.floor((t.n - 1) / this.stride) + 1;
    const N = this.N;
    const pos = new Float32Array(N * N * 3);
    const nor = new Float32Array(N * N * 3);
    const col = new Float32Array(N * N * 3);
    const uv = new Float32Array(N * N * 2);
    const idx = new Uint32Array((N - 1) * (N - 1) * 6);
    let k = 0;
    for (let j = 0; j < N - 1; j++) {
      for (let i = 0; i < N - 1; i++) {
        const a = j * N + i;
        idx[k++] = a;
        idx[k++] = a + N;
        idx[k++] = a + 1;
        idx[k++] = a + 1;
        idx[k++] = a + N;
        idx[k++] = a + N + 1;
      }
    }
    this.geo = new BufferGeometry();
    this.geo.setAttribute('position', new BufferAttribute(pos, 3));
    this.geo.setAttribute('normal', new BufferAttribute(nor, 3));
    this.geo.setAttribute('color', new BufferAttribute(col, 3));
    this.geo.setAttribute('uv', new BufferAttribute(uv, 2));
    this.geo.setIndex(new BufferAttribute(idx, 1));
    this.fill(0, 0, N - 1, N - 1);
    this.geo.computeBoundingSphere();
    this.grain = grainTexture();
    const mat = new MeshStandardMaterial({ vertexColors: true, map: this.grain, roughness: 0.96, metalness: 0, envMapIntensity: 0.35 });
    this.mesh = new Mesh(this.geo, mat);
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);
    this.disposables.push(this.geo, mat, this.grain);
    t.trackDirty = true;
    t.dirty.length = 0;

    if (Number.isFinite(t.waterLevel)) this.addWater(t.waterLevel);
    this.addApron();
    for (const b of bridges) this.addBridge(b);
  }

  /** Recompute heights, normals and colours for mesh vertices in [i0..i1] x [j0..j1]. */
  private fill(i0: number, j0: number, i1: number, j1: number): void {
    const t = this.terrain;
    const N = this.N;
    const s = this.stride;
    const n = t.n;
    const m = n - 1;
    const pos = this.geo.getAttribute('position').array as Float32Array;
    const nor = this.geo.getAttribute('normal').array as Float32Array;
    const col = this.geo.getAttribute('color').array as Float32Array;
    const uv = this.geo.getAttribute('uv').array as Float32Array;
    const H = (ti: number, tj: number) => t.h[Math.max(0, Math.min(m, tj)) * n + Math.max(0, Math.min(m, ti))];
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const ti = Math.min(m, i * s);
        const tj = Math.min(m, j * s);
        const x = t.vx(ti);
        const z = t.vx(tj);
        const y = H(ti, tj);
        const v = j * N + i;
        pos[v * 3] = x;
        pos[v * 3 + 1] = y;
        pos[v * 3 + 2] = z;
        uv[v * 2] = x / 14;
        uv[v * 2 + 1] = z / 14;
        // Normal from the heightfield by central differences.
        const gx = (H(ti + s, tj) - H(ti - s, tj)) / (2 * s * t.cell);
        const gz = (H(ti, tj + s) - H(ti, tj - s)) / (2 * s * t.cell);
        const inv = 1 / Math.hypot(gx, 1, gz);
        nor[v * 3] = -gx * inv;
        nor[v * 3 + 1] = inv;
        nor[v * 3 + 2] = -gz * inv;
        // Blend the four cells around the vertex.
        acc.setRGB(0, 0, 0);
        for (const [di, dj] of CORNERS) {
          const ci = Math.max(0, Math.min(m - 1, ti + di));
          const cj = Math.max(0, Math.min(m - 1, tj + dj));
          let mat = t.mat[cj * m + ci];
          if (y < t.waterLevel - 0.6) mat = MAT.water;
          tmp.setHex(MAT_COLOR[mat] ?? MAT_COLOR[MAT.dirt]);
          acc.r += tmp.r * 0.25;
          acc.g += tmp.g * 0.25;
          acc.b += tmp.b * 0.25;
        }
        // Steep ground shows bare rock; broad patches and fine speckle break up the flats.
        const slope = 1 - inv;
        acc.lerp(ROCK, Math.min(0.85, Math.max(0, (slope - 0.08) * 3)));
        const k = 1 + fbm(x, z, 90, 2, SEED) * 0.12 + (hash2(ti, tj, SEED + 9) - 0.5) * 0.08;
        col[v * 3] = acc.r * k;
        col[v * 3 + 1] = acc.g * k;
        col[v * 3 + 2] = acc.b * k;
      }
    }
  }

  /** Redraw what the battle changed since last frame. */
  update(): void {
    const t = this.terrain;
    if (!t.dirty.length) return;
    const N = this.N;
    const step = t.cell * this.stride;
    let jMin = N;
    let jMax = -1;
    for (const [x0, z0, x1, z1] of t.dirty) {
      const i0 = Math.max(0, Math.floor((x0 + t.half) / step) - 1);
      const j0 = Math.max(0, Math.floor((z0 + t.half) / step) - 1);
      const i1 = Math.min(N - 1, Math.ceil((x1 + t.half) / step) + 1);
      const j1 = Math.min(N - 1, Math.ceil((z1 + t.half) / step) + 1);
      this.fill(i0, j0, i1, j1);
      jMin = Math.min(jMin, j0);
      jMax = Math.max(jMax, j1);
    }
    t.dirty.length = 0;
    if (jMax < jMin) return;
    for (const name of ['position', 'normal', 'color'] as const) {
      const a = this.geo.getAttribute(name) as BufferAttribute;
      a.clearUpdateRanges();
      a.addUpdateRange(jMin * N * 3, (jMax - jMin + 1) * N * 3);
      a.needsUpdate = true;
    }
  }

  private addWater(level: number): void {
    const half = this.terrain.half;
    const g = new PlaneGeometry(half * 2, half * 2);
    g.rotateX(-Math.PI / 2);
    const m = new MeshStandardMaterial({ color: 0x24302c, roughness: 0.06, metalness: 0.15, envMapIntensity: 1.1, transparent: true, opacity: 0.9 });
    const w = new Mesh(g, m);
    w.position.y = level;
    w.renderOrder = 1;
    this.group.add(w);
    this.disposables.push(g, m);
  }

  /** Flat ground beyond the battlefield edge at about the rim's height, out into the haze. */
  private addApron(): void {
    const t = this.terrain;
    const half = t.half;
    let rim = 0;
    let n = 0;
    for (let k = -half; k <= half; k += 40) {
      rim += t.heightAt(k, -half) + t.heightAt(k, half) + t.heightAt(-half, k) + t.heightAt(half, k);
      n += 4;
    }
    rim /= n;
    const far = 6000;
    const mat = new MeshStandardMaterial({ color: 0x5f5446, roughness: 1, metalness: 0 });
    const strip = (w: number, d: number, x: number, z: number) => {
      const g = new PlaneGeometry(w, d);
      g.rotateX(-Math.PI / 2);
      const s = new Mesh(g, mat);
      s.position.set(x, rim - 1.5, z);
      this.group.add(s);
      this.disposables.push(g);
    };
    const o = half - 2;
    strip(far * 2, far - o, 0, -(o + (far - o) / 2));
    strip(far * 2, far - o, 0, o + (far - o) / 2);
    strip(far - o, o * 2, -(o + (far - o) / 2), 0);
    strip(far - o, o * 2, o + (far - o) / 2, 0);
    this.disposables.push(mat);
  }

  /** Stone faces where a bridge's causeway meets the canal, with a dark arch in each, and the road deck. */
  private addBridge(b: Bridge): void {
    const t = this.terrain;
    const stone = new MeshStandardMaterial({ color: 0x8a8274, roughness: 0.9 });
    const dark = new MeshStandardMaterial({ color: 0x1a1816, roughness: 1 });
    const deckMat = new MeshStandardMaterial({ color: 0x4e4b46, roughness: 0.92 });
    const bed = Number.isFinite(t.waterLevel) ? t.waterLevel - 3 : b.y - 6;
    const g = new Group();
    g.position.set(b.x, 0, b.z);
    g.rotation.y = -b.rot;
    const h = b.y - bed;
    for (const s of [-1, 1]) {
      const wall = new Mesh(new BoxGeometry(0.8, h + 0.6, b.hl * 2), stone);
      wall.position.set(s * (b.hw + 0.2), bed + h / 2 + 0.3, 0);
      wall.castShadow = wall.receiveShadow = true;
      g.add(wall);
      const arch = new Mesh(new BoxGeometry(0.2, h * 0.62, b.hl * 1.1), dark);
      arch.position.set(s * (b.hw + 0.65), bed + h * 0.31, 0);
      g.add(arch);
      // Parapet caps along the deck edges.
      const cap = new Mesh(new BoxGeometry(1.1, 0.35, b.hl * 2 + 1), stone);
      cap.position.set(s * (b.hw + 0.2), b.y + 0.45, 0);
      g.add(cap);
    }
    const deck = new Mesh(new BoxGeometry(b.hw * 2, 0.3, b.hl * 2), deckMat);
    deck.position.set(0, b.y - 0.13, 0);
    deck.receiveShadow = true;
    g.add(deck);
    this.group.add(g);
    g.traverse((o) => {
      if (o instanceof Mesh) this.disposables.push(o.geometry);
    });
    this.disposables.push(stone, dark, deckMat);
  }

  dispose(): void {
    this.terrain.trackDirty = false;
    this.terrain.dirty.length = 0;
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}

const CORNERS: [number, number][] = [
  [-1, -1],
  [0, -1],
  [-1, 0],
  [0, 0],
];
