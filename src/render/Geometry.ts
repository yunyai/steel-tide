import { BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, Euler, Float32BufferAttribute, Matrix4, Quaternion, SphereGeometry, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Small helpers for building vertex-coloured, merged procedural meshes.

export type ColorFn = (x: number, y: number, z: number) => Color;
export type Paint = number | Color | ColorFn;

const tmp = new Color();
const v = new Vector3();

export function colorize(g: BufferGeometry, paint: Paint): void {
  const pos = g.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    let c: Color;
    if (typeof paint === 'function') {
      v.fromBufferAttribute(pos, i);
      c = paint(v.x, v.y, v.z);
    } else c = typeof paint === 'number' ? tmp.setHex(paint) : paint;
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new BufferAttribute(colors, 3));
}

export interface PartOpts {
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
}

const m4 = new Matrix4();
const q = new Quaternion();
const e = new Euler();
const s = new Vector3();
const p = new Vector3();

/** Accumulates coloured primitives in a shared local space and merges them. */
export class Parts {
  list: BufferGeometry[] = [];

  add(geo: BufferGeometry, paint: Paint, x = 0, y = 0, z = 0, o: PartOpts = {}): this {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    if (g.getAttribute('uv')) g.deleteAttribute('uv');
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    e.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0, 'YZX');
    q.setFromEuler(e);
    s.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
    p.set(x, y, z);
    m4.compose(p, q, s);
    g.applyMatrix4(m4);
    colorize(g, paint);
    this.list.push(g);
    return this;
  }

  /** Box resting on y (bottom face at y). `taper` shrinks the top face. */
  box(len: number, h: number, w: number, x: number, y: number, z: number, paint: Paint, o: PartOpts & { taper?: number; slope?: number } = {}): this {
    const g = new BoxGeometry(len, h, w);
    g.translate(0, h / 2, 0);
    if (o.taper || o.slope) {
      const pos = g.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) > h * 0.5) {
          const t = 1 - (o.taper ?? 0);
          pos.setX(i, pos.getX(i) * t - (pos.getX(i) > 0 ? (o.slope ?? 0) : 0));
          pos.setZ(i, pos.getZ(i) * t);
        }
      }
      g.deleteAttribute('normal');
    }
    return this.add(g, paint, x, y, z, o);
  }

  /** Vertical cylinder resting on y. */
  cyl(rTop: number, rBot: number, h: number, x: number, y: number, z: number, paint: Paint, o: PartOpts & { seg?: number } = {}): this {
    const g = new CylinderGeometry(rTop, rBot, h, o.seg ?? 12, 1);
    g.translate(0, h / 2, 0);
    return this.add(g, paint, x, y, z, o);
  }

  /** Cylinder lying along +X starting at x. */
  barrel(r0: number, r1: number, len: number, x: number, y: number, z: number, paint: Paint, seg = 8): this {
    const g = new CylinderGeometry(r1, r0, len, seg, 1);
    g.translate(0, len / 2, 0);
    g.rotateZ(-Math.PI / 2);
    return this.add(g, paint, x, y, z);
  }

  sphere(r: number, x: number, y: number, z: number, paint: Paint, o: PartOpts = {}): this {
    return this.add(new SphereGeometry(r, 10, 6), paint, x, y, z, o);
  }

  merge(): BufferGeometry {
    if (!this.list.length) {
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute([], 3));
      g.setAttribute('normal', new Float32BufferAttribute([], 3));
      g.setAttribute('color', new Float32BufferAttribute([], 3));
      return g;
    }
    const merged = mergeGeometries(this.list, false)!;
    for (const g of this.list) g.dispose();
    this.list = [];
    merged.computeBoundingSphere();
    return merged;
  }
}

/** Builds an indexed grid of stations x ring points, then smooth normals. */
export function loft(rings: Vector3[][], colors: Color[][], closeEnds: boolean): BufferGeometry {
  const n = rings.length;
  const m = rings[0].length;
  const pos: number[] = [];
  const col: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const r = rings[i][j];
      pos.push(r.x, r.y, r.z);
      const c = colors[i][j];
      col.push(c.r, c.g, c.b);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < m - 1; j++) {
      const a = i * m + j;
      const b = (i + 1) * m + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  if (closeEnds) {
    // Fan caps from the ring centroid (used for transoms).
    for (const i of [0, n - 1]) {
      const c = new Vector3();
      for (const r of rings[i]) c.add(r);
      c.divideScalar(m);
      const ci = pos.length / 3;
      pos.push(c.x, c.y, c.z);
      const cc = colors[i][Math.floor(m / 2)];
      col.push(cc.r, cc.g, cc.b);
      for (let j = 0; j < m; j++) {
        const a = i * m + j;
        const b = i * m + ((j + 1) % m);
        if (i === 0) idx.push(ci, a, b);
        else idx.push(ci, b, a);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
