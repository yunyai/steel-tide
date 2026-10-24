import {
  BufferGeometry,
  Color,
  ConeGeometry,
  DataTexture,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  RedFormat,
  Vector3,
} from 'three';
import { makeRng } from '../core/math';
import type { GameMap } from '../world/GameMap';
import { quality } from './Quality';

// Terrain meshes sampled from the headless GameMap.heightAt() so what the
// player sees is exactly what blocks shells, ships and line of sight.

const SAND_WET = new Color(0x8e7f5e);
const SAND = new Color(0xcdbb8c);
const GRASS = new Color(0x56703a);
const GRASS2 = new Color(0x41592c);
const ROCK = new Color(0x7b766c);
const ROCK2 = new Color(0x5d5a54);
const SEABED = new Color(0x3d4a44);

/** Seabed heights the shore map can hold: SHORE_LOW..SHORE_LOW + SHORE_SPAN metres. */
export const SHORE_LOW = -40;
export const SHORE_SPAN = 60;

/**
 * The seabed around every island, baked into a texture covering [-half, half] on both axes,
 * so the sea can tint its shallows and draw surf where the water runs out.
 */
export function shoreTexture(map: GameMap, half: number, size = 1024): DataTexture {
  const data = new Uint8Array(size * size);
  const step = (2 * half) / size;
  for (let j = 0; j < size; j++) {
    const z = -half + (j + 0.5) * step;
    for (let i = 0; i < size; i++) {
      const h = map.heightAt(-half + (i + 0.5) * step, z);
      data[j * size + i] = Math.round(Math.max(0, Math.min(1, (h - SHORE_LOW) / SHORE_SPAN)) * 255);
    }
  }
  const tex = new DataTexture(data, size, size, RedFormat);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export class Islands {
  readonly group = new Group();
  private material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true });
  private treeMaterial = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });

  constructor(map: GameMap, seed: number) {
    const rng = makeRng(seed ^ 0x51ed);
    const treeSpots: { x: number; y: number; z: number; s: number }[] = [];
    for (const isl of map.islands) {
      const reach = isl.r * 1.45;
      const n = Math.round(Math.min(150, Math.max(56, (reach * 2) / 11)));
      const step = (reach * 2) / n;
      const pos: number[] = [];
      const heights: number[] = [];
      for (let i = 0; i <= n; i++) {
        for (let j = 0; j <= n; j++) {
          const x = isl.x - reach + i * step;
          const z = isl.z - reach + j * step;
          const h = map.heightAt(x, z);
          pos.push(x, Math.max(h, -30), z);
          heights.push(h);
        }
      }
      const idx: number[] = [];
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const a = i * (n + 1) + j;
          const b = (i + 1) * (n + 1) + j;
          if (Math.max(heights[a], heights[a + 1], heights[b], heights[b + 1]) < -12) continue;
          idx.push(a, a + 1, b, b, a + 1, b + 1);
        }
      }
      let geo = new BufferGeometry();
      geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo = geo.toNonIndexed();
      geo.computeVertexNormals();
      const p = geo.getAttribute('position');
      const nrm = geo.getAttribute('normal');
      const colors = new Float32Array(p.count * 3);
      const c = new Color();
      for (let k = 0; k < p.count; k++) {
        const y = p.getY(k);
        const ny = nrm.getY(k);
        const wx = p.getX(k);
        const wz = p.getZ(k);
        const noise = Math.sin(wx * 0.05 + isl.seed) * Math.cos(wz * 0.043 - isl.seed) * 0.5 + 0.5;
        if (y < -2) c.copy(SEABED).lerp(SAND_WET, Math.max(0, (y + 30) / 28));
        else if (y < 2.5) c.copy(SAND_WET).lerp(SAND, (y + 2) / 4.5);
        else if (y < 7 && ny > 0.8) c.copy(SAND).lerp(GRASS, (y - 2.5) / 4.5);
        else if (ny < 0.72 || y > isl.h * 0.82) c.copy(ROCK).lerp(ROCK2, noise);
        else c.copy(GRASS).lerp(GRASS2, noise).lerp(ROCK, Math.max(0, (0.86 - ny) * 4));
        colors[k * 3] = c.r;
        colors[k * 3 + 1] = c.g;
        colors[k * 3 + 2] = c.b;
      }
      geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
      const mesh = new Mesh(geo, this.material);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      this.group.add(mesh);

      // Scatter trees on gentle vegetated slopes.
      const count = Math.round(isl.r * isl.r * 0.0016);
      for (let t = 0; t < count * 3 && treeSpots.length < 5000; t++) {
        const a = rng() * Math.PI * 2;
        const d = Math.sqrt(rng()) * isl.r;
        const x = isl.x + Math.cos(a) * d;
        const z = isl.z + Math.sin(a) * d;
        const h = map.heightAt(x, z);
        if (h < 8 || h > isl.h * 0.7) continue;
        const hx = map.heightAt(x + 6, z) - h;
        const hz = map.heightAt(x, z + 6) - h;
        if (Math.hypot(hx, hz) > 4) continue;
        treeSpots.push({ x, y: h - 1, z, s: 0.7 + rng() * 0.8 });
      }
    }
    if (treeSpots.length && quality().trees) {
      const cone = new ConeGeometry(4, 13, 6);
      cone.translate(0, 6.5, 0);
      const trees = new InstancedMesh(cone, this.treeMaterial, treeSpots.length);
      const m = new Matrix4();
      const q = new Quaternion();
      const s = new Vector3();
      const v = new Vector3();
      const col = new Color();
      treeSpots.forEach((t, i) => {
        s.set(t.s, t.s * (0.8 + rng() * 0.5), t.s);
        m.compose(v.set(t.x, t.y, t.z), q, s);
        trees.setMatrixAt(i, m);
        trees.setColorAt(i, col.setHSL(0.27 + rng() * 0.06, 0.35, 0.16 + rng() * 0.07));
      });
      trees.castShadow = true;
      trees.receiveShadow = true;
      this.group.add(trees);
    }
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof Mesh) o.geometry.dispose();
    });
    this.material.dispose();
    this.treeMaterial.dispose();
  }
}
