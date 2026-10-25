import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Euler,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
import { colorize, Parts } from '../../render/Geometry';
import { type Prop, PROP_DAMAGED, PROP_RUBBLE, type Props } from '../sim/props';
import { hash2 } from '../sim/terrain';

// Everything standing on the ground, drawn as instanced unit shapes stretched to each prop's
// box: houses with a window pattern worked out on the GPU from the world position, broken
// rooflines once damaged, rubble heaps, walls, railings, trees, burned-out cars and wagons,
// fountains and statues. A prop moves between shapes as the battle wears it down; a falling
// house sinks into its own dust before the heap is all that is left.

/** Seconds a house takes to come down. */
const FALL_TIME = 1.4;

type ShapeId = 'house' | 'broken' | 'heap' | 'wall' | 'fence' | 'trunk' | 'crown' | 'car' | 'wagon' | 'basin' | 'statue' | 'boulder' | 'hedge';

/** Facade colours by house style (0..3 streets, 5 the station, 9 the cathedral). */
const FACADE: Record<number, number> = { 0: 0x8a5844, 1: 0xb5a78e, 2: 0x8d8b85, 3: 0xa38a5e, 5: 0x7a4a3a, 9: 0xa29a8a };

const m4 = new Matrix4();
const m4b = new Matrix4();
const q = new Quaternion();
const e = new Euler();
const pos = new Vector3();
const scl = new Vector3();
const col = new Color();
const ZERO = new Matrix4().makeScale(0, 0, 0);

/** Unit box resting on y = 0, footprint -0.5..0.5. */
function unitBox(): BoxGeometry {
  const g = new BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  colorize(g, 0xffffff);
  return g;
}

/** A plain shape tinted white, so the instance colour alone sets it. */
function white<T extends BufferGeometry>(g: T): T {
  colorize(g, 0xffffff);
  return g;
}

/** A unit box whose roofline is torn: the top vertices dropped by a jagged amount. */
function brokenGeometry(): BufferGeometry {
  const g = new BoxGeometry(1, 1, 1, 6, 1, 6);
  g.translate(0, 0.5, 0);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) < 0.99) continue;
    const x = p.getX(i);
    const z = p.getZ(i);
    const k = hash2(Math.round(x * 12), Math.round(z * 12), 41);
    p.setY(i, 1 - k * 0.45 - (Math.abs(x) < 0.3 && Math.abs(z) < 0.3 ? 0.25 : 0));
  }
  g.computeVertexNormals();
  return g;
}

/** A low mound of masonry over the unit footprint, height 1 at its crown. */
function heapGeometry(): BufferGeometry {
  const g = new PlaneGeometry(1, 1, 10, 10);
  g.rotateX(-Math.PI / 2);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const r = Math.max(Math.abs(x), Math.abs(z)) * 2;
    const n = hash2(Math.round(x * 20), Math.round(z * 20), 43);
    p.setY(i, Math.max(0, (1 - r * r) * (0.55 + n * 0.45)));
  }
  g.computeVertexNormals();
  const parts = new Parts();
  parts.add(g, (_x, y) => col.setHex(0x8a7c6a).lerp(new Color(0x5a5048), Math.max(0, 0.6 - y)).clone());
  // A few big blocks poking out of the pile.
  for (let k = 0; k < 6; k++) {
    const a = hash2(k, 1, 44) * Math.PI * 2;
    const r = 0.1 + hash2(k, 2, 44) * 0.25;
    parts.box(0.18, 0.3, 0.12, Math.cos(a) * r, 0.15 + hash2(k, 3, 44) * 0.3, Math.sin(a) * r, 0x7a6a5a, { ry: a, rz: 0.4 });
  }
  return parts.merge();
}

function fenceGeometry(): BufferGeometry {
  const p = new Parts();
  const c = 0x2c2a28;
  // Long along z; the posts stay thin however far the railing is stretched.
  p.box(0.3, 0.08, 1, 0, 0.92, 0, c);
  p.box(0.25, 0.06, 1, 0, 0.35, 0, c);
  for (let k = 0; k <= 16; k++) p.box(0.25, 1, 0.006, 0, 0, -0.5 + k / 16, c);
  return p.merge();
}

function crownGeometry(): BufferGeometry {
  const g = new IcosahedronGeometry(0.5, 1);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const k = 0.85 + hash2(Math.round(p.getX(i) * 9), Math.round(p.getY(i) * 9) + Math.round(p.getZ(i) * 9) * 7, 45) * 0.3;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  const parts = new Parts();
  parts.add(g, (_x, y) => col.setHex(0x44542c).lerp(new Color(0x2c3820), Math.max(0, -y)).clone());
  return parts.merge();
}

function carGeometry(): BufferGeometry {
  const p = new Parts();
  p.box(1, 0.5, 1, 0, 0.12, 0, 0xffffff);
  p.box(0.9, 0.4, 0.45, 0, 0.6, 0.02, 0xd8d8d8, { taper: 0.15 });
  // Long along z and stretched about 2:1, so the wheels are squashed to stay round.
  for (const sx of [-0.44, 0.56]) for (const sz of [-0.32, 0.32]) p.cyl(0.22, 0.22, 0.12, sx, 0.22, sz, 0x1a1816, { rz: Math.PI / 2, sz: 0.36, seg: 8 });
  return p.merge();
}

function wagonGeometry(): BufferGeometry {
  const p = new Parts();
  p.box(1, 0.12, 0.9, 0, 0.18, 0, 0x2a2826);
  p.box(0.97, 0.7, 1, 0, 0.3, 0, 0xffffff);
  p.box(0.98, 0.04, 1.02, 0, 0.98, 0, 0xc8c8c8);
  for (const sx of [-0.36, 0.36]) for (const sz of [-0.3, 0.3]) p.cyl(0.1, 0.1, 0.1, sx, 0.08, sz, 0x1a1816, { rx: Math.PI / 2, seg: 8 });
  return p.merge();
}

function basinGeometry(): BufferGeometry {
  const p = new Parts();
  p.cyl(0.5, 0.5, 0.3, 0, 0, 0, 0x9a948a, { seg: 20 });
  p.cyl(0.44, 0.44, 0.02, 0, 0.3, 0, 0x2a3a3a, { seg: 20 });
  p.cyl(0.08, 0.1, 0.8, 0, 0.3, 0, 0x8c867c, { seg: 10 });
  p.cyl(0.18, 0.14, 0.08, 0, 0.9, 0, 0x8c867c, { seg: 12 });
  return p.merge();
}

function statueGeometry(): BufferGeometry {
  const p = new Parts();
  p.box(1, 0.45, 1, 0, 0, 0, 0x8c867c);
  p.cyl(0.18, 0.26, 0.38, 0, 0.45, 0, 0x5a6458, { seg: 8 });
  p.sphere(0.13, 0, 0.92, 0, 0x5a6458);
  p.box(0.5, 0.06, 0.08, 0.1, 0.72, 0, 0x5a6458, { rz: 0.6 });
  return p.merge();
}

function hedgeGeometry(): BufferGeometry {
  const p = new Parts();
  p.box(1, 0.4, 1, 0, 0, 0, 0x5a4a34, { taper: 0.1 });
  const g = new BoxGeometry(1, 0.65, 0.8, 8, 2, 2);
  const a = g.getAttribute('position');
  for (let i = 0; i < a.count; i++) {
    const k = hash2(Math.round(a.getX(i) * 30), Math.round(a.getY(i) * 10) + Math.round(a.getZ(i) * 10) * 5, 46);
    a.setY(i, a.getY(i) + (a.getY(i) > 0 ? k * 0.15 : 0));
    a.setZ(i, a.getZ(i) * (0.9 + k * 0.2));
  }
  g.deleteAttribute('normal');
  p.add(g, 0x3a4a24, 0, 0.7, 0);
  return p.merge();
}

/** Facade windows, cornices and darker roofs from the world position: no UVs or textures needed. */
function facadeMaterial(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, envMapIntensity: 0.4 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying vec3 vWN;\nvarying float vH;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
  vec4 lp = vec4(transformed, 1.0);
  vec3 ln = objectNormal;
#ifdef USE_INSTANCING
  lp = instanceMatrix * lp;
  ln = mat3(instanceMatrix) * ln;
  vH = lp.y - instanceMatrix[3][1];
#else
  vH = lp.y;
#endif
  vWP = (modelMatrix * lp).xyz;
  vWN = normalize(mat3(modelMatrix) * ln);`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying vec3 vWN;\nvarying float vH;\nfloat vWin = 0.0;\nfloat vLit = 0.0;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  {
    float wall = 1.0 - step(0.5, abs(vWN.y));
    float u = abs(vWN.x) > 0.5 ? vWP.z : vWP.x;
    vec2 g = vec2(fract(u / 3.8), fract(vH / 3.4));
    float storey = floor(vH / 3.4);
    vWin = step(0.28, g.x) * step(g.x, 0.72) * step(0.3, g.y) * step(g.y, 0.8) * step(0.5, storey) * wall;
    vec2 cell = floor(vec2(u / 3.8, vH / 3.4)) + floor(vWP.xz * 0.013);
    float r = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
    vLit = step(0.94, r) * vWin;
    diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.02, 0.025, 0.03), vec3(0.05, 0.04, 0.035), r), vWin);
    diffuseColor.rgb *= 1.0 - (1.0 - step(0.07, g.y)) * wall * 0.3;
    diffuseColor.rgb *= mix(1.0, 0.62, step(0.5, vWN.y));
    diffuseColor.rgb *= 0.8 + 0.2 * smoothstep(0.0, 2.5, vH);
  }`,
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vLit * vec3(1.4, 0.75, 0.32);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, 0.25, vWin);');
  };
  m.customProgramCacheKey = () => 'ground-facade';
  return m;
}

/** One instanced shape: slots handed out to props and taken back when they change shape. */
class Shape {
  readonly mesh: InstancedMesh;
  private free: number[] = [];
  private used = 0;

  constructor(geo: BufferGeometry, mat: MeshStandardMaterial, readonly capacity: number, shadows: boolean) {
    this.mesh = new InstancedMesh(geo, mat, Math.max(1, capacity));
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = shadows;
    this.mesh.receiveShadow = true;
    // Instance colours exist from the start, so the shader is compiled for them once.
    this.mesh.setColorAt(0, col.setRGB(1, 1, 1));
  }

  take(): number {
    const s = this.free.pop() ?? (this.used < this.capacity ? this.used++ : -1);
    if (s >= 0) this.mesh.count = Math.max(this.mesh.count, s + 1);
    return s;
  }

  release(slot: number): void {
    this.mesh.setMatrixAt(slot, ZERO);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.free.push(slot);
  }

  set(slot: number, m: Matrix4, color: Color): void {
    this.mesh.setMatrixAt(slot, m);
    this.mesh.setColorAt(slot, color);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

interface Placed {
  shape: Shape;
  slot: number;
}

interface Falling {
  shape: Shape;
  slot: number;
  prop: Prop;
  t: number;
  h: number;
  color: Color;
}

export class PropsView {
  readonly group = new Group();
  private shapes = new Map<ShapeId, Shape>();
  /** Where each prop is drawn (a tree takes two shapes). */
  private placed = new Map<number, Placed[]>();
  private falling: Falling[] = [];
  private disposables: { dispose(): void }[] = [];

  constructor(
    props: Props,
    shadows: boolean,
  ) {
    const list = props.list;
    const n = (k: Prop['kind']) => list.filter((p) => p.kind === k).length;
    const houses = n('building');
    // Raised walls arrive during the battle; leave room for them.
    const extra = 96;
    const facade = facadeMaterial();
    const plain = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.05, envMapIntensity: 0.4 });
    const metal = new MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.35, envMapIntensity: 0.6 });
    const leaf = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, envMapIntensity: 0.3 });
    this.disposables.push(facade, plain, metal, leaf);
    const cars = list.filter((p) => p.kind === 'car');
    const add = (id: ShapeId, geo: BufferGeometry, mat: MeshStandardMaterial, cap: number, shadow = shadows) => {
      const s = new Shape(geo, mat, cap, shadow);
      this.shapes.set(id, s);
      this.group.add(s.mesh);
      this.disposables.push(geo, s.mesh);
    };
    add('house', unitBox(), facade, houses);
    add('broken', brokenGeometry(), facade, houses);
    add('heap', heapGeometry(), plain, houses + n('wall') + extra, false);
    add('wall', unitBox(), plain, n('wall'));
    add('fence', fenceGeometry(), metal, n('fence'), false);
    add('trunk', white(new CylinderGeometry(0.5, 0.5, 1, 6).translate(0, 0.5, 0)), plain, n('tree'), false);
    add('crown', crownGeometry(), leaf, n('tree'));
    add('car', carGeometry(), metal, cars.filter((p) => p.style < 3).length);
    add('wagon', wagonGeometry(), metal, cars.filter((p) => p.style >= 3).length);
    add('basin', basinGeometry(), plain, list.filter((p) => p.kind === 'rock' && p.style === 1).length);
    add('statue', statueGeometry(), plain, list.filter((p) => p.kind === 'rock' && p.style === 2).length);
    add('boulder', white(new IcosahedronGeometry(0.5, 0).translate(0, 0.35, 0)), plain, list.filter((p) => p.kind === 'rock' && p.style !== 1 && p.style !== 2).length);
    add('hedge', hedgeGeometry(), leaf, n('hedge') + extra);
    for (const p of list) this.place(p);
  }

  private shape(id: ShapeId): Shape {
    return this.shapes.get(id)!;
  }

  /** Base matrix: the prop's box at its place and turn, with `sy` the drawn height. */
  private boxMatrix(p: Prop, sy: number, out: Matrix4): Matrix4 {
    pos.set(p.x, p.y, p.z);
    q.setFromEuler(e.set(0, -p.rot, 0));
    scl.set(p.hw * 2, sy, p.hd * 2);
    return out.compose(pos, q, scl);
  }

  private put(id: ShapeId, m: Matrix4, color: Color, into: Placed[]): void {
    const shape = this.shape(id);
    const slot = shape.take();
    if (slot < 0) return;
    shape.set(slot, m, color);
    into.push({ shape, slot });
  }

  /** Draw a prop as its state says, replacing whatever it was drawn as before. */
  private place(p: Prop): void {
    const old = this.placed.get(p.id);
    if (old) for (const o of old) o.shape.release(o.slot);
    const out: Placed[] = [];
    this.placed.set(p.id, out);
    const rubble = p.state === PROP_RUBBLE;
    const k = hash2(p.id, 7, 51);
    switch (p.kind) {
      case 'building': {
        const c = col.setHex(FACADE[p.style] ?? FACADE[0]).multiplyScalar(0.9 + k * 0.2);
        if (rubble) {
          this.put('heap', this.boxMatrix(p, Math.min(4.5, 1.5 + p.h * 0.12), m4), c.multiplyScalar(0.85), out);
        } else if (p.state === PROP_DAMAGED) {
          // Fire-blackened, its top floors gone.
          this.put('broken', this.boxMatrix(p, p.h * 0.72, m4), c.multiplyScalar(0.72), out);
        } else this.put('house', this.boxMatrix(p, p.h, m4), c, out);
        break;
      }
      case 'wall':
        if (rubble) this.put('heap', this.boxMatrix(p, 0.7, m4), col.setHex(0x8a7f70), out);
        else this.put('wall', this.boxMatrix(p, p.h, m4), col.setHex(0x8a7f70).multiplyScalar(0.9 + k * 0.2), out);
        break;
      case 'fence':
        this.put('fence', this.boxMatrix(p, rubble ? 0.08 : p.h, m4), col.setRGB(1, 1, 1), out);
        break;
      case 'hedge':
        // Spent cover sinks away (see `update`); a hedge shot to pieces leaves a low bank.
        if (!rubble) this.put('hedge', this.boxMatrix(p, p.h, m4), col.setRGB(0.9 + k * 0.2, 0.9 + k * 0.2, 0.9), out);
        else if (p.expires === undefined) this.put('heap', this.boxMatrix(p, 0.6, m4), col.setHex(0x5a4a34), out);
        break;
      case 'tree':
        this.placeTree(p, rubble, k, out);
        break;
      case 'car': {
        const wagon = p.style >= 3;
        const c = wagon ? col.setHex(p.style === 3 ? 0x5a3a2a : 0x4a4c4e) : col.setHex([0x4a3426, 0x2c2826, 0x3a3e40][p.style] ?? 0x3a3a3a);
        this.put(wagon ? 'wagon' : 'car', this.boxMatrix(p, p.h * (rubble ? 0.35 : 1), m4), c.multiplyScalar(0.9 + k * 0.2), out);
        break;
      }
      case 'rock': {
        const id: ShapeId = p.style === 1 ? 'basin' : p.style === 2 ? 'statue' : 'boulder';
        this.put(id, this.boxMatrix(p, p.h, m4), col.setRGB(1, 1, 1), out);
        break;
      }
    }
  }

  /** Trunk and crown, upright, or lying where the tree was knocked down. */
  private placeTree(p: Prop, down: boolean, k: number, out: Placed[]): void {
    const h = p.h;
    // The fall: about a horizontal axis through the foot, in a direction of its own.
    const fall = m4b.identity();
    if (down) {
      const a = k * Math.PI * 2;
      fall.makeRotationAxis(pos.set(Math.cos(a), 0, Math.sin(a)), 1.45);
    }
    const base = new Matrix4().makeTranslation(p.x, p.y, p.z).multiply(fall);
    const trunk = new Matrix4().compose(pos.set(0, 0, 0), q.identity(), scl.set(0.5, h * 0.55, 0.5));
    this.put('trunk', base.clone().multiply(trunk), col.setHex(0x4a3a2a), out);
    const r = 2.6 + h * 0.12;
    const crown = new Matrix4().compose(pos.set(0, h * 0.62, 0), q.setFromEuler(e.set(0, k * 6, 0)), scl.set(r * 2, h * 0.62, r * 2));
    const shade = down ? 0.75 : 0.85 + k * 0.3;
    this.put('crown', base.multiply(crown), col.setRGB(shade, shade, shade * 0.9), out);
  }

  /** Re-draw props the sim changed; a house that fell first sinks into its dust. */
  update(dt: number, dirty: Prop[]): void {
    for (const p of dirty) {
      const was = this.placed.get(p.id);
      const tall = was?.find((o) => o.shape === this.shape('house') || o.shape === this.shape('broken') || o.shape === this.shape('hedge'));
      if (p.state === PROP_RUBBLE && tall) {
        // Keep the standing shape for the fall; the rest swaps over now.
        const keep = tall;
        was!.splice(was!.indexOf(keep), 1);
        const h = keep.shape === this.shape('broken') ? p.h * 0.72 : p.h;
        const c = new Color();
        keep.shape.mesh.getColorAt(keep.slot, c);
        this.falling.push({ ...keep, prop: p, t: 0, h, color: c });
      }
      this.place(p);
    }
    for (const f of this.falling) {
      f.t += dt;
      const k = Math.min(1, f.t / FALL_TIME);
      const sink = k * k;
      this.boxMatrix(f.prop, Math.max(0.01, f.h * (1 - sink)), m4);
      // Slumps a touch as it goes, and sinks below the heap.
      m4.elements[13] -= sink * 1.5;
      f.shape.set(f.slot, m4, f.color);
      if (k >= 1) f.shape.release(f.slot);
    }
    if (this.falling.length) this.falling = this.falling.filter((f) => f.t < FALL_TIME);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.placed.clear();
  }
}
