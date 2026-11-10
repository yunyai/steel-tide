import {
  BufferGeometry, CatmullRomCurve3, Color, CylinderGeometry, ExtrudeGeometry,
  Float32BufferAttribute, Quaternion, Shape, TorusGeometry, TubeGeometry, Vector3,
} from 'three';
import type { ShipSpec } from '../core/types';
import { deckHeight, hullHalfWidth } from '../ships/HullShape';
import { Parts, loft } from './Geometry';

export type Point = readonly [number, number, number];
export interface TitanPalette { hull: number; armor: number; edge: number; dark: number; trim: number; light: number; pale: number }

export const TITAN_PALETTES: Record<string, TitanPalette> = {
  judge: { hull: 0x273142, armor: 0xd8d1b8, edge: 0x717987, dark: 0x111a28, trim: 0xb88a43, light: 0xffd38a, pale: 0xf1e6c7 },
  hexweaver: { hull: 0x24252e, armor: 0x675744, edge: 0x94816b, dark: 0x13171f, trim: 0x984c51, light: 0xec7ba3, pale: 0xd9c7a1 },
  gourmand: { hull: 0x362b29, armor: 0x864739, edge: 0xa9b2ad, dark: 0x161c21, trim: 0xbd8a4a, light: 0xff9b36, pale: 0xe3d9b8 },
  faultline: { hull: 0x272b2b, armor: 0x505b59, edge: 0x82928b, dark: 0x151d21, trim: 0xb59a68, light: 0xff6b29, pale: 0xc3c8b7 },
  // Whitewash and red bands over grey stone, with brass for `pale`.
  pharos: { hull: 0x1f2c3c, armor: 0xe6dfcd, edge: 0x7c868b, dark: 0x141c26, trim: 0xb03a2b, light: 0xfff0b0, pale: 0xc7a252 },
};

/** The Pharos's lamp, metres above its deck: where its beams leave the lantern. */
export const PHAROS_LAMP = 100;

/** The actual simulation planform, with a chined keel and separate deck/boot colours. */
export function titanHull(spec: ShipSpec, palette: TitanPalette): BufferGeometry {
  const rings: Vector3[][] = [], colors: Color[][] = [];
  for (let i = 0; i <= 40; i++) {
    const x = (i / 40 - .5) * spec.length, w = hullHalfWidth(spec, x), y = deckHeight(spec, x);
    const ring = [
      new Vector3(x, y, -w), new Vector3(x, 1, -w),
      new Vector3(x, -spec.draft * .68, -w * .76), new Vector3(x, -spec.draft, -w * .26),
      new Vector3(x, -spec.draft, w * .26), new Vector3(x, -spec.draft * .68, w * .76),
      new Vector3(x, 1, w), new Vector3(x, y, w), new Vector3(x, y, -w),
    ];
    rings.push(ring);
    colors.push(ring.map((_, j) => new Color(j === 8 ? palette.armor : j === 0 || j === 7 ? palette.hull : j === 1 || j === 6 ? palette.dark : 0x171b20)));
  }
  return loft(rings, colors, true);
}

/** An irregular plate in the x/z plane; bevels give the fracture edge a readable highlight. */
export function slab(points: readonly (readonly [number, number])[], height: number, bevel = .45): BufferGeometry {
  const shape = new Shape();
  shape.moveTo(points[0][0], -points[0][1]);
  for (const p of points.slice(1)) shape.lineTo(p[0], -p[1]);
  shape.closePath();
  return new ExtrudeGeometry(shape, { depth: height, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, steps: 1 }).rotateX(-Math.PI / 2);
}

/** A blade, pediment or jaw cheek with a custom x/y silhouette, extruded across z. */
export function silhouette(points: readonly (readonly [number, number])[], depth: number, bevel = .3): BufferGeometry {
  const shape = new Shape();
  shape.moveTo(...points[0]);
  for (const p of points.slice(1)) shape.lineTo(...p);
  shape.closePath();
  return new ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, steps: 1 }).translate(0, 0, -depth / 2);
}

/** Stitched cloth and stratified core shapes: elliptical rings, deliberately faceted. */
export function volume(rings: readonly (readonly [number, number, number, number?])[], segments = 16, ripple = 0): BufferGeometry {
  const positions: number[] = [], indices: number[] = [];
  rings.forEach(([y, rx, rz, shift = 0], row) => {
    for (let k = 0; k <= segments; k++) {
      const a = k / segments * Math.PI * 2, r = 1 + Math.sin(a * 5 + row * .7) * ripple;
      positions.push(shift + Math.cos(a) * rx * r, y, Math.sin(a) * rz * r);
    }
  });
  for (let row = 0; row < rings.length - 1; row++) for (let k = 0; k < segments; k++) {
    const a = row * (segments + 1) + k, b = a + segments + 1;
    indices.push(a, b, a + 1, b, b + 1, a + 1);
  }
  for (const row of [0, rings.length - 1]) {
    const [y, , , shift = 0] = rings[row], center = positions.length / 3;
    positions.push(shift, y, 0);
    for (let k = 0; k < segments; k++) {
      const a = row * (segments + 1) + k;
      if (row === 0) indices.push(center, a, a + 1); else indices.push(center, a + 1, a);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function rod(parts: Parts, a: Point, b: Point, radius: number, color: number, tip = radius, segments = 8): void {
  const start = new Vector3(...a), end = new Vector3(...b), direction = end.sub(start), length = direction.length();
  if (length < .001) return;
  const geometry = new CylinderGeometry(tip, radius, length, segments, 1);
  geometry.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.multiplyScalar(1 / length)));
  geometry.translate(start.x + direction.x * length / 2, start.y + direction.y * length / 2, start.z + direction.z * length / 2);
  parts.add(geometry, color);
}

export function pipe(parts: Parts, points: readonly Point[], radius: number, color: number): void {
  parts.add(new TubeGeometry(new CatmullRomCurve3(points.map(p => new Vector3(...p))), Math.max(10, points.length * 5), radius, 6, false), color);
}

/** Alternating, visibly open links, merged into one draw with their parent assembly. */
export function chain(parts: Parts, a: Point, b: Point, radius: number, color: number): void {
  const start = new Vector3(...a), direction = new Vector3(...b).sub(start), length = direction.length();
  const count = Math.max(2, Math.round(length / (radius * 2.2)));
  const align = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.clone().normalize());
  for (let i = 0; i <= count; i++) {
    const at = start.clone().addScaledVector(direction, i / count);
    const link = new TorusGeometry(radius, radius * .27, 4, 10).scale(1, 1.45, 1).rotateY(i % 2 * Math.PI / 2).applyQuaternion(align);
    parts.add(link, color, at.x, at.y, at.z);
  }
}

const GLYPHS: Record<string, readonly (readonly [number, number, number, number])[]> = {
  A: [[0,0,1.5,5],[1.5,5,3,0],[.6,2,2.4,2]], C: [[3,4.5,2.4,5],[2.4,5,.5,5],[.5,5,0,4.5],[0,4.5,0,.5],[0,.5,.5,0],[.5,0,3,0]],
  D: [[0,0,0,5],[0,5,2,5],[2,5,3,4],[3,4,3,1],[3,1,2,0],[2,0,0,0]], E: [[3,5,0,5],[0,5,0,0],[0,0,3,0],[0,2.5,2.4,2.5]],
  F: [[0,0,0,5],[0,5,3,5],[0,2.5,2.4,2.5]], I: [[0,5,3,5],[1.5,5,1.5,0],[0,0,3,0]], J: [[0,5,3,5],[2,5,2,.5],[2,.5,1.5,0],[1.5,0,.5,0],[.5,0,0,.5]],
  L: [[0,5,0,0],[0,0,3,0]], M: [[0,0,0,5],[0,5,1.5,2.5],[1.5,2.5,3,5],[3,5,3,0]], N: [[0,0,0,5],[0,5,3,0],[3,0,3,5]],
  O: [[.5,0,2.5,0],[2.5,0,3,.5],[3,.5,3,4.5],[3,4.5,2.5,5],[2.5,5,.5,5],[.5,5,0,4.5],[0,4.5,0,.5],[0,.5,.5,0]],
  R: [[0,0,0,5],[0,5,2.3,5],[2.3,5,3,4.3],[3,4.3,3,3.2],[3,3.2,2.3,2.5],[2.3,2.5,0,2.5],[1.6,2.5,3,0]],
  S: [[3,5,.5,5],[.5,5,0,4.5],[0,4.5,0,3],[0,3,3,2],[3,2,3,.5],[3,.5,2.5,0],[2.5,0,0,0]],
  T: [[0,5,3,5],[1.5,5,1.5,0]], U: [[0,5,0,.5],[0,.5,.5,0],[.5,0,2.5,0],[2.5,0,3,.5],[3,.5,3,5]],
  V: [[0,5,1.5,0],[1.5,0,3,5]], X: [[0,0,3,5],[0,5,3,0]],
};

/** Raised metal lettering; no DOM, font downloads, textures or per-letter draw calls. */
export function inscription(parts: Parts, text: string, height: number, x: number, y: number, z: number, color: number, face: 'x' | 'z' = 'x'): void {
  const scale = height / 5, width = (text.length * 4 - 1) * scale;
  [...text].forEach((letter, index) => {
    for (const [x0, y0, x1, y1] of GLYPHS[letter] ?? []) {
      const u0 = (index * 4 + x0) * scale - width / 2, u1 = (index * 4 + x1) * scale - width / 2;
      const a: Point = face === 'x' ? [x, y + y0 * scale, z + u0] : [x + u0, y + y0 * scale, z];
      const b: Point = face === 'x' ? [x, y + y1 * scale, z + u1] : [x + u1, y + y1 * scale, z];
      rod(parts, a, b, Math.max(.13, scale * .15), color, undefined, 5);
    }
  });
}
