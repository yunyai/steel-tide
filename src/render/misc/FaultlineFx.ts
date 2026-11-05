import { BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshStandardMaterial } from 'three';
import type { Team } from '../../core/types';
import type { Ship } from '../../ships/Ship';
import { FAULTLINE, type FaultlineState, type FaultPending, type Fracture, type MagmaWake } from '../../skills/misc/FaultlineRuntime';
import type { MiscFxKind } from '../../skills/misc/MiscEvents';
import type { Shell } from '../../weapons/ShellSystem';
import type { DynamicRidge } from '../../world/GameMap';
import { BK, hash01 } from '../BurstParticles';
import { bump, clamp01, easeOut, hot, mix, TAU } from './MiscFxKit';
import { MiscShipFx, type MiscBurst } from './MiscShipFx';

const MAGMA = 0xff5a14;
const LAVA = 0xff8a2a;
const EMBER = 0xffc060;
const WHITE = 0xfff0c0;
const BASALT = 0x2a2522;
const CRUST = 0x5a1a08;
const ASH = 0x6a625c;
const STEAM = 0xe8eef2;
const SEA = 0xf4f8ff;

/** Seconds a ridge takes to heave out of the sea, and to sink back when it crumbles. */
const RISE = 0.7;
const SINK = 1.6;
/** Seconds a fracture takes to tear open along its length. */
const TEAR = 0.35;
/** Rows across a ridge's mesh; even, so the middle row is its crest. */
const ROWS = 8;
/** Lava cracks running down each ridge's flanks. */
const CRACKS = 5;

/** Seconds each Faultline burst plays. */
const LIFE: Partial<Record<MiscFxKind, number>> = {
  gunHit: 1.1,
  gunLand: 1.2,
  fracture: 1,
  rupture: 1.3,
  uplift: 1.6,
  subduct: FAULTLINE.subduction.time + 0.2,
  crush: 1.4,
  slip: FAULTLINE.slip.time + 0.7,
  boulder: 1.6,
  bedrock: 0.9,
  rebound: 1.3,
  caldera: FAULTLINE.caldera.time + 0.1,
  eruption: 2.4,
  worldbreaker: 1.8,
  collapse: SINK + 0.4,
  crumble: SINK,
};

/** Bursts that belong to the Faultline's own hull, shown only where it may be seen. Everything else is terrain. */
const OWN = new Set<MiscFxKind>(['slip', 'bedrock', 'rebound', 'worldbreaker']);

/** A ridge's basalt mesh and the lava seams drawn over it, in the ridge's own frame (x along it, y up). */
interface Rock {
  geometry: BufferGeometry;
  /** The crest: (x, y) per column. */
  crest: Float32Array;
  /** `CRACKS` polylines from the crest down one flank: (x, y, z) per point. */
  cracks: Float32Array;
}

/** A straight line on the water: its ends, length, unit direction and unit left-hand normal. */
interface Line {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  len: number;
  ux: number;
  uz: number;
  nx: number;
  nz: number;
}

function lineOf(x0: number, z0: number, x1: number, z1: number): Line {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const ux = len > 0 ? (x1 - x0) / len : 1;
  const uz = len > 0 ? (z1 - z0) / len : 0;
  return { x0, z0, x1, z1, len, ux, uz, nx: -uz, nz: ux };
}

/**
 * A jagged basalt ridge `length` by `width`, `height` tall, seeded so every ridge has its own
 * skyline. Rounded ends, a skirt below the waterline so it can rise and sink without showing a
 * bottom, columnar steps and darker rock where the sea wets it.
 */
function rockOf(seed: number, length: number, width: number, height: number): Rock {
  const cols = Math.max(12, Math.round(length / 28));
  const half = length / 2;
  const w = width / 2;
  const base = -height * 0.7;
  const verts = (cols + 1) * (ROWS + 1);
  const pos = new Float32Array(verts * 3);
  const col = new Float32Array(verts * 3);
  const crest = new Float32Array((cols + 1) * 2);
  const phase = hash01(seed, 999) * TAU;
  for (let i = 0; i <= cols; i++) {
    const u = i / cols;
    const x = -half + length * u;
    const end = Math.max(0, Math.abs(x) - (half - w)) / w;
    const taper = Math.sqrt(Math.max(0, 1 - end * end));
    // A few broad peaks along the crest, with jagged teeth on them.
    const skyline = 0.7 + 0.16 * Math.sin(u * 6.3 + phase) + 0.1 * Math.sin(u * 15.7 + phase * 2.3) + (hash01(seed, i) - 0.5) * 0.24;
    for (let j = 0; j <= ROWS; j++) {
      const v = (j / ROWS) * 2 - 1;
      const k = (i * (ROWS + 1) + j) * 3;
      const rim = j === 0 || j === ROWS || i === 0 || i === cols;
      const n = hash01(seed * 31 + i, j);
      let px = x;
      let py = base;
      let pz = v * w * 1.06 * taper;
      if (!rim) {
        const lift = 1 - Math.abs(v) ** 1.4;
        const raw = height * skyline * lift * taper ** 0.6;
        // Columnar basalt: heights lean toward 9 m steps.
        py = raw * 0.55 + Math.round(raw / 9) * 9 * 0.45 + (n - 0.5) * height * 0.16 * lift;
        px = x + (hash01(seed + 7, i * 13 + j) - 0.5) * (length / cols) * 0.5;
        pz = v * w * Math.max(taper, 0.1) + (hash01(seed + 3, i * 17 + j) - 0.5) * w * 0.16;
      }
      pos[k] = px;
      pos[k + 1] = py;
      pos[k + 2] = pz;
      // Black and wet at the waterline, ash-grey on the teeth, scorched red down the crest.
      const shade = 0.07 + 0.07 * n + 0.1 * clamp01(py / height);
      const scorch = j === ROWS / 2 ? 0.06 : 0;
      col[k] = shade + scorch * 1.6;
      col[k + 1] = shade * 0.94 + scorch * 0.3;
      col[k + 2] = shade * 0.9;
      if (j === ROWS / 2) {
        crest[i * 2] = px;
        crest[i * 2 + 1] = py;
      }
    }
  }
  const index: number[] = [];
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < ROWS; j++) {
      const a = i * (ROWS + 1) + j;
      const b = a + ROWS + 1;
      index.push(a, a + 1, b, b, a + 1, b + 1);
    }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(pos, 3));
  geometry.setAttribute('color', new BufferAttribute(col, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const points = ROWS / 2 + 1;
  const cracks = new Float32Array(CRACKS * points * 3);
  for (let c = 0; c < CRACKS; c++) {
    const i = Math.max(1, Math.min(cols - 1, Math.round(cols * (0.12 + (0.76 * c) / (CRACKS - 1) + (hash01(seed, c + 70) - 0.5) * 0.08))));
    const side = c % 2 ? 1 : -1;
    for (let s = 0; s < points; s++) {
      const k = (i * (ROWS + 1) + ROWS / 2 + s * side) * 3;
      const o = (c * points + s) * 3;
      cracks[o] = pos[k];
      cracks[o + 1] = pos[k + 1] + 1.5;
      cracks[o + 2] = pos[k + 2] * 1.04 + side * 1.5;
    }
  }
  return { geometry, crest, cracks };
}

/** Each ridge's seed: its id and owner, so two Faultlines' ridge 7 still differ. */
const seedOf = (owner: number, id: number) => id * 7919 + owner * 104729;

/**
 * The Faultline: basalt ridges that heave out of the sea and crumble back, glowing fractures,
 * warned ruptures with rock spikes and geysers, Subduction's basin, Slip's magma wake, Bedrock's
 * plates, the Caldera's crater and eruption, Worldbreaker's split sea and the magma mortar.
 */
export class FaultlineFx extends MiscShipFx {
  readonly look = 'magma' as const;
  readonly palette = { main: MAGMA, hot: WHITE, deep: BASALT };
  /** Colours held across many draws; `hot` and `mix` only keep four scratch colours alive. */
  private readonly held = [new Color(), new Color(), new Color(), new Color()];
  private readonly material = new MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.93, metalness: 0.05, flatShading: true });
  /** Each ridge's mesh by `owner:id`, kept while the ridge stands or its crumble plays. */
  private readonly stone = new Map<string, Rock>();

  /** Ridge meshes alive now. */
  get rocks(): number {
    return this.stone.size;
  }

  owns(s: Ship): boolean {
    return !!s.faultline;
  }

  protected life(kind: MiscFxKind): number {
    return LIFE[kind] ?? super.life(kind);
  }

  protected arrive(b: MiscBurst): void {
    const { kit } = this;
    const { ship, kind, x, z } = b.e;
    const shake = (k: number) => {
      if (!kit.reduce) kit.onShake?.(ship, x, z, k);
    };
    if (kind === 'worldbreaker') {
      kit.onFlash?.(x, z, 0.75, MAGMA);
      shake(0.8);
    } else if (kind === 'eruption') {
      kit.onFlash?.(x, z, 0.6, LAVA);
      shake(0.55);
    } else if (kind === 'collapse') {
      kit.onFlash?.(x, z, 0.2, MAGMA);
      shake(0.4);
    } else if (kind === 'rebound' || kind === 'crush') {
      kit.onFlash?.(x, z, 0.25, LAVA);
      shake(0.4);
    } else if (kind === 'uplift') shake(0.25);
  }

  protected shows(b: MiscBurst, team: Team | -1): boolean {
    return OWN.has(b.e.kind) ? this.kit.visible(b.e.ship, team) : true;
  }

  protected burst(b: MiscBurst, age: number): void {
    switch (b.e.kind) {
      case 'gunHit':
        return this.gunHit(b, age);
      case 'gunLand':
        return this.gunLand(b, age);
      case 'fracture':
        return this.tear(b, age);
      case 'rupture':
        return this.rupture(b, age);
      case 'uplift':
        return this.uplift(b, age);
      case 'subduct':
        return this.basin(b, age);
      case 'crush':
        return this.crush(b, age);
      case 'slip':
        return this.slip(b, age);
      case 'boulder':
        return this.boulders(b, age);
      case 'bedrock':
        return this.brace(b, age);
      case 'rebound':
        return this.rebound(b, age);
      case 'caldera':
        return this.crater(b, age);
      case 'eruption':
        return this.eruption(b, age);
      case 'worldbreaker':
        return this.split(b, age);
      case 'collapse':
        return this.fall(b, age, true);
      case 'crumble':
        return this.fall(b, age, false);
      default:
    }
  }

  // ------------------------------------------------------------------ ridge meshes

  /** Builds and poses every standing ridge and every ridge still sinking from a crumble. */
  protected persist(live: Set<string>): void {
    const { kit } = this;
    const now = kit.game.time;
    const keep = new Set<string>();
    for (const r of kit.game.map.dynamicRidges) {
      const id = `${r.owner}:${r.id}`;
      keep.add(id);
      const key = `misc-ridge-${r.owner}-${r.id}`;
      live.add(key);
      const rock = this.rock(id, seedOf(r.owner, r.id), r.x0, r.z0, r.x1, r.z1, r.width, r.height);
      const g = kit.node(key, () => this.mesh(rock));
      if (!g) continue;
      const rise = easeOut((now - (r.expiresAt - FAULTLINE.ridgeLife)) / RISE);
      const rumble = rise < 1 && !kit.reduce ? Math.sin(kit.t * 60 + r.id) * 3 * (1 - rise) : 0;
      this.pose(g, r.x0, r.z0, r.x1, r.z1, -r.height * 1.5 * (1 - rise), rumble, 0);
    }
    for (const b of this.list) {
      const e = b.e;
      if (e.kind !== 'crumble' && e.kind !== 'collapse') continue;
      const n = e.n ?? 0;
      const id = `${e.ship.id}:${n}`;
      keep.add(id);
      const key = `misc-ridge-fall-${b.id}`;
      live.add(key);
      const tx = e.tx ?? e.x;
      const tz = e.tz ?? e.z;
      const rock = this.rock(id, seedOf(e.ship.id, n), e.x, e.z, tx, tz, FAULTLINE.ridgeWidth, FAULTLINE.ridgeHeight);
      const g = kit.node(key, () => this.mesh(rock));
      if (!g) continue;
      const f = clamp01((now - b.time) / SINK);
      const quake = kit.reduce ? 0 : Math.sin(kit.t * 50 + b.id) * 4 * (1 - f);
      const roll = (hash01(b.id, 3) < 0.5 ? -1 : 1) * 0.12 * f;
      this.pose(g, e.x, e.z, tx, tz, -FAULTLINE.ridgeHeight * 1.7 * f * f, quake, roll);
    }
    for (const [id, rock] of this.stone)
      if (!keep.has(id)) {
        rock.geometry.dispose();
        this.stone.delete(id);
      }
  }

  private rock(id: string, seed: number, x0: number, z0: number, x1: number, z1: number, width: number, height: number): Rock {
    let rock = this.stone.get(id);
    if (!rock) {
      rock = rockOf(seed, Math.max(width, Math.hypot(x1 - x0, z1 - z0)), width, height);
      this.stone.set(id, rock);
    }
    return rock;
  }

  private mesh(rock: Rock): Group {
    const g = new Group();
    const m = new Mesh(rock.geometry, this.material);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return g;
  }

  /** Lays a ridge group along (x0, z0)–(x1, z1) at height `y`, nudged `jitter` and rolled about its length. */
  private pose(g: Group, x0: number, z0: number, x1: number, z1: number, y: number, jitter: number, roll: number): void {
    g.position.set((x0 + x1) / 2 + jitter, y, (z0 + z1) / 2);
    g.rotation.set(roll, -Math.atan2(z1 - z0, x1 - x0), 0, 'YXZ');
  }

  // ------------------------------------------------------------------ persistent cues

  protected cues(team: Team | -1): void {
    const { kit } = this;
    const now = kit.game.time;
    const breaking = new Set<number>();
    for (const s of kit.game.ships) if (s.faultline?.pending.some((p) => p.kind === 'collapse')) breaking.add(s.id);
    // Ridges are terrain: everyone sees them, their seams and their rising.
    for (const r of kit.game.map.dynamicRidges) {
      const g = kit.peek(`misc-ridge-${r.owner}-${r.id}`);
      const rock = this.stone.get(`${r.owner}:${r.id}`);
      if (!g || !rock) continue;
      g.visible = true;
      this.seams(g, rock, r, now, breaking.has(r.owner));
    }
    for (const b of this.list) {
      if (b.e.kind !== 'crumble' && b.e.kind !== 'collapse') continue;
      const g = kit.peek(`misc-ridge-fall-${b.id}`);
      if (g) g.visible = true;
    }
    for (const s of kit.game.ships) {
      const a = s.faultline;
      if (!a || !s.alive || s.withdrawn) continue;
      // Fractures, warnings and the magma wake are public hazards, like the ridges they become.
      for (const f of a.fractures) if (f.expiresAt > now) this.crack(f, now);
      for (const p of a.pending) this.warning(s, p, now);
      for (const w of a.wakes) if (w.until > now) this.wake(w, now);
      if (!kit.visible(s, team)) continue;
      if (a.bedrockUntil > now) this.plates(s, a, now);
      if (a.pressure > 0) this.vents(s, a.pressure);
    }
  }

  /** A standing ridge's lava seams: a fissure down the crest and cracks down the flanks, brighter as it rises or is about to fall. */
  private seams(g: Group, rock: Rock, r: DynamicRidge, now: number, breaking: boolean): void {
    const { kit } = this;
    const L = lineOf(r.x0, r.z0, r.x1, r.z1);
    const mx = g.position.x;
    const mz = g.position.z;
    const y0 = g.position.y;
    const age = now - (r.expiresAt - FAULTLINE.ridgeLife);
    const left = r.expiresAt - now;
    const failing = breaking || left < 1.5;
    const heat = (0.55 + 0.15 * Math.sin(kit.t * 2.2 + r.id)) * (age < RISE ? 1.8 : 1) * (failing ? 1.6 + 0.4 * Math.sin(kit.t * 18) : 1);
    const lava = this.held[0].copy(hot(LAVA, 1.6 * heat));
    const core = this.held[1].copy(hot(WHITE, 1.3 * heat));
    const wx = (lx: number, lz: number) => mx + L.ux * lx + L.nx * lz;
    const wz = (lx: number, lz: number) => mz + L.uz * lx + L.nz * lz;
    const c = rock.crest;
    for (let i = 2; i < c.length / 2; i += 2) {
      const ax = c[(i - 2) * 2];
      const ay = c[(i - 2) * 2 + 1] + 2;
      const bx = c[i * 2];
      const by = c[i * 2 + 1] + 2;
      kit.line(wx(ax, 0), y0 + ay, wz(ax, 0), wx(bx, 0), y0 + by, wz(bx, 0), lava, 0.55, 8);
      kit.line(wx(ax, 0), y0 + ay + 1, wz(ax, 0), wx(bx, 0), y0 + by + 1, wz(bx, 0), core, 0.45, 2.5);
    }
    const k = rock.cracks;
    const points = ROWS / 2 + 1;
    for (let n = 0; n < CRACKS; n++)
      for (let s = 1; s < points; s++) {
        const a = (n * points + s - 1) * 3;
        const b = (n * points + s) * 3;
        kit.line(wx(k[a], k[a + 2]), y0 + k[a + 1], wz(k[a], k[a + 2]), wx(k[b], k[b + 2]), y0 + k[b + 1], wz(k[b], k[b + 2]), lava, 0.5, 4.5);
      }
    // Where the hot rock meets the sea it steams.
    const w = r.width / 2 + 10;
    const puffs = Math.max(1, Math.round(3 * kit.k));
    for (let i = 0; i < puffs; i++) {
      const ph = (kit.t * 0.3 + hash01(r.id, i)) % 1;
      const along = (hash01(r.id, i + 10) - 0.5) * L.len * 0.9;
      const side = i % 2 ? 1 : -1;
      kit.particles.push(BK.Smoke, wx(along, w * side), 8 + 50 * ph, wz(along, w * side), 50 + 60 * ph, hot(STEAM, 1), 0.2 * (1 - ph), ph * 4, r.id + i);
    }
    if (age >= RISE + 0.6) return;
    // Rising: spray sheets off both flanks, dust over the crest and rock falling away.
    const f = clamp01(age / (RISE + 0.6));
    const fade = 1 - f;
    const n = Math.max(3, Math.round((L.len / 90) * kit.k));
    for (let i = 0; i < n; i++) {
      const along = ((i + 0.5) / n - 0.5) * L.len;
      for (const side of [-1, 1]) kit.particles.push(BK.Spray, wx(along, (w + 25) * side), 20 + 70 * easeOut(f * 2), wz(along, (w + 25) * side), 90 + 50 * f, hot(SEA, 1), 0.6 * fade, r.id + i * 2 + side);
      if (i % 2) kit.particles.push(BK.Smoke, wx(along, 0), y0 + r.height + 20 + 60 * f, wz(along, 0), 110 + 80 * f, hot(ASH, 1), 0.4 * fade, i, r.id + i);
      const drop = (hash01(r.id, i + 40) - 0.5) * r.width;
      kit.particles.push(BK.Shard, wx(along, drop), y0 + r.height * (1 - f) + 10, wz(along, drop), 16 + 10 * hash01(r.id, i), hot(BASALT, 1.3), fade, f * 6 + i, r.id + i);
    }
  }

  /** A fracture: a jagged lava crack that tears open, glows with embers and steam, and fades. */
  private crack(f: Fracture, now: number): void {
    const { kit } = this;
    const age = now - (f.expiresAt - FAULTLINE.fractureLife);
    const open = easeOut(age / TEAR);
    const fade = clamp01((f.expiresAt - now) / 1.5);
    const L = lineOf(f.x0, f.z0, f.x1, f.z1);
    const reach = L.len * open;
    const parts = Math.max(3, Math.ceil(L.len / 90));
    const glow = this.held[2].copy(hot(MAGMA, 1.2));
    const core = this.held[3].copy(hot(EMBER, 1.8));
    let px = f.x0;
    let pz = f.z0;
    for (let i = 1; i <= parts; i++) {
      const d = Math.min((L.len * i) / parts, reach);
      const j = i === parts ? 0 : Math.sin(i * 2.7 + f.id) * 22 + (hash01(f.id, i) - 0.5) * 18;
      const nx = f.x0 + L.ux * d + L.nx * j;
      const nz = f.z0 + L.uz * d + L.nz * j;
      const flicker = 0.75 + 0.25 * Math.sin(kit.t * 4 + i * 1.7 + f.id);
      kit.line(px, 4, pz, nx, 4, nz, glow, 0.22 * fade * flicker, 24);
      kit.line(px, 5, pz, nx, 5, nz, core, 0.75 * fade * flicker, 5);
      // A short spur off every third joint.
      if (i % 3 === 1 && i < parts) {
        const side = hash01(f.id, i + 30) < 0.5 ? -1 : 1;
        const len = 40 + 50 * hash01(f.id, i + 40);
        kit.line(nx, 5, nz, nx + (L.nx * side + L.ux * 0.4) * len, 5, nz + (L.nz * side + L.uz * 0.4) * len, core, 0.45 * fade * flicker, 3);
      }
      px = nx;
      pz = nz;
      if (d >= reach) break;
    }
    const m = Math.max(1, Math.round(4 * kit.k));
    for (let i = 0; i < m; i++) {
      const g = hash01(f.id, i + 50) * open;
      const x = f.x0 + L.ux * L.len * g;
      const z = f.z0 + L.uz * L.len * g;
      const ph = (kit.t * 0.6 + hash01(f.id, i)) % 1;
      kit.particles.push(BK.Spark, x, 6 + 60 * ph, z, 3, hot(EMBER, 2), 0.8 * (1 - ph) * fade, 0, i, 0, 6, 0, 1.5);
      kit.particles.push(BK.Smoke, x, 10 + 50 * ph, z, 40 + 40 * ph, hot(STEAM, 1), 0.22 * (1 - ph) * fade, ph * 3, f.id + i);
    }
    const cx = (f.x0 + f.x1) / 2;
    const cz = (f.z0 + f.z1) / 2;
    kit.glow(cx, 4, cz, Math.max(80, L.len * 0.3), hot(LAVA, 0.7), 0.18 * fade * open);
    if (!kit.reduce) kit.distortions.push({ x: cx, y: 20, z: cz, radius: Math.min(300, L.len * 0.3), strength: 0.15 * fade, priority: 1 });
  }

  /** What is about to land: a ring filling for each pulse, a footprint for each ridge. */
  private warning(s: Ship, p: FaultPending, now: number): void {
    const { kit } = this;
    const left = p.at - now;
    const urgent = 1 - clamp01(left / 1.2);
    const beat = 0.6 + 0.4 * Math.sin(kit.t * (8 + 10 * urgent));
    if (p.kind === 'ridge' && p.ridge) {
      this.outline(p.ridge, p.ridge.width / 2, (0.35 + 0.35 * urgent) * beat, false);
      // The sea boils along the line before the rock breaks through.
      const L = lineOf(p.ridge.x0, p.ridge.z0, p.ridge.x1, p.ridge.z1);
      const n = Math.max(2, Math.round(5 * kit.k));
      for (let i = 0; i < n; i++) {
        const g = hash01(p.id, i);
        const ph = (kit.t * 1.5 + hash01(p.id, i + 9)) % 1;
        kit.particles.push(BK.Foam, L.x0 + L.ux * L.len * g, 3, L.z0 + L.uz * L.len * g, 50 + 40 * ph, hot(SEA, 1), 0.4 * (1 - ph) * (0.4 + urgent), ph * 3, p.id + i);
      }
      return;
    }
    if (p.kind === 'boulders' && p.ridge) {
      this.outline(p.ridge, p.radius, (0.2 + 0.3 * urgent) * beat, true);
      return;
    }
    if (p.kind === 'collapse') {
      for (const r of kit.game.map.dynamicRidges)
        if (r.owner === s.id) kit.ring((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, p.radius, 6, hot(MAGMA, 1.4), (0.3 + 0.4 * urgent) * beat, 6, kit.t * 0.4, 64, true);
      return;
    }
    const y = kit.surface(p.x, p.z) + 3;
    const big = p.radius > 500;
    kit.ring(p.x, p.z, p.radius, y, hot(MAGMA, 1.3 + urgent), (0.3 + 0.45 * urgent) * beat, big ? 9 : 5, kit.t * 0.2, big ? 72 : 24, big);
    kit.ring(p.x, p.z, p.radius * clamp01(left / 1.2), y, hot(WHITE, 1.4), 0.25 + 0.35 * urgent, 3, 0, big ? 48 : 16);
    kit.glow(p.x, y + 3, p.z, p.radius * 0.6, hot(LAVA, 0.8 + urgent), 0.15 + 0.3 * urgent);
  }

  /** The capsule a ridge, or its reach, covers. */
  private outline(r: DynamicRidge, half: number, alpha: number, dash: boolean): void {
    const { kit } = this;
    const c = this.held[2].copy(hot(LAVA, 1.5));
    const L = lineOf(r.x0, r.z0, r.x1, r.z1);
    for (const side of [-1, 1]) {
      const steps = dash ? Math.max(2, Math.round(L.len / 60)) : 1;
      for (let i = 0; i < steps; i++) {
        if (dash && i % 2) continue;
        const a = (i / steps) * L.len;
        const b = ((i + 1) / steps) * L.len;
        kit.line(r.x0 + L.ux * a + L.nx * half * side, 5, r.z0 + L.uz * a + L.nz * half * side, r.x0 + L.ux * b + L.nx * half * side, 5, r.z0 + L.uz * b + L.nz * half * side, c, alpha, 5);
      }
    }
    const angle = Math.atan2(L.uz, L.ux);
    for (let end = 0; end < 2; end++) {
      const x = end ? r.x1 : r.x0;
      const z = end ? r.z1 : r.z0;
      const start = angle + (end ? -0.5 : 0.5) * Math.PI;
      for (let i = 0; i < 12; i++) {
        if (dash && i % 2) continue;
        const a = start + (i * Math.PI) / 12;
        const b = start + ((i + 1) * Math.PI) / 12;
        kit.line(x + Math.cos(a) * half, 5, z + Math.sin(a) * half, x + Math.cos(b) * half, 5, z + Math.sin(b) * half, c, alpha, 5);
      }
    }
  }

  /** Slip's magma wake: a molten streak that cools from orange to a dark crust before it goes out. */
  private wake(w: MagmaWake, now: number): void {
    const { kit } = this;
    const heat = clamp01((w.until - now) / FAULTLINE.slip.wakeTime);
    const fade = clamp01((w.until - now) / 0.5);
    const L = lineOf(w.x0, w.z0, w.x1, w.z1);
    const lava = this.held[2].copy(mix(CRUST, LAVA, heat, 1 + heat));
    const core = this.held[3].copy(hot(EMBER, 0.8 + 1.4 * heat));
    const parts = Math.max(2, Math.ceil(L.len / 80));
    const seed = Math.round(w.x0 * 7 + w.z0 * 13);
    let px = w.x0;
    let pz = w.z0;
    for (let i = 1; i <= parts; i++) {
      const d = (L.len * i) / parts;
      const j = i === parts ? 0 : (hash01(seed, i) - 0.5) * 20;
      const nx = w.x0 + L.ux * d + L.nx * j;
      const nz = w.z0 + L.uz * d + L.nz * j;
      kit.line(px, 4, pz, nx, 4, nz, lava, (0.45 + 0.3 * heat) * fade, 22 + 18 * heat);
      kit.line(px, 5, pz, nx, 5, nz, core, 0.6 * heat * fade, 5);
      px = nx;
      pz = nz;
    }
    const n = Math.max(1, Math.round(4 * kit.k));
    for (let i = 0; i < n; i++) {
      const g = hash01(seed, i + 40);
      const ph = (kit.t * 0.8 + hash01(seed, i + 60)) % 1;
      const x = w.x0 + L.ux * L.len * g;
      const z = w.z0 + L.uz * L.len * g;
      kit.particles.push(BK.Smoke, x, 10 + 50 * ph, z, 50 + 50 * ph, hot(STEAM, 1), 0.3 * (1 - ph) * fade, ph * 3, seed + i);
      kit.particles.push(BK.Spark, x, 6 + 40 * ph, z, 3, hot(EMBER, 2), 0.8 * heat * (1 - ph), 0, i, 0, 5, 0, 1.5);
    }
  }

  /** Bedrock: basalt slabs over the hull, their seams glowing hotter as pressure builds. */
  private plates(s: Ship, a: FaultlineState, now: number): void {
    const { kit } = this;
    const left = a.bedrockUntil - now;
    const on = easeOut((FAULTLINE.bedrock.time - left) / 0.3);
    const off = clamp01(left / 0.4);
    const p = s.renderPos;
    const fx = Math.sin(s.renderHeading);
    const fz = -Math.cos(s.renderHeading);
    const half = s.spec.length * 0.46;
    const beam = s.spec.beam / 2 + 8;
    const top = s.spec.freeboard + 14;
    const heat = 0.4 + (a.pressure / FAULTLINE.maxPressure) * 1.6;
    const seam = this.held[0].copy(hot(LAVA, 1.2 + heat));
    const rock = this.held[1].copy(hot(BASALT, 1.1));
    const lift = (1 - on) * 60;
    const yb = p.y + 2 + lift;
    const yt = p.y + top + lift;
    const n = 6;
    for (const side of [-1, 1]) {
      const across = beam * side;
      const X = (along: number) => p.x + fx * along - fz * across;
      const Z = (along: number) => p.z + fz * along + fx * across;
      for (let i = 0; i < n; i++) {
        const a0 = -half + (2 * half * i) / n + 3;
        const a1 = -half + (2 * half * (i + 1)) / n - 3;
        kit.line(X(a0), (yb + yt) / 2, Z(a0), X(a1), (yb + yt) / 2, Z(a1), rock, 0.92 * off, top - 2, true);
        kit.line(X(a1 + 3), yb, Z(a1 + 3), X(a1 + 3), yt, Z(a1 + 3), seam, 0.75 * off, 4);
        const crack = yb + (yt - yb) * (0.35 + 0.3 * hash01(s.id, i + side * 10));
        kit.line(X(a0), crack, Z(a0), X(a1), crack + 4, Z(a1), seam, 0.5 * off, 2.5);
      }
    }
    kit.ring(p.x, p.z, s.spec.length * 0.6, p.y + top * 0.5, hot(MAGMA, 0.9 + heat * 0.5), 0.3 * off, 4, kit.t * 0.4, 48, true);
    kit.glow(p.x, p.y + top, p.z, 80 + a.pressure * 1.5, hot(LAVA, 1 + heat), 0.35 * off);
  }

  /** Pressure venting from the hull: embers that thicken as it builds, smoke once it runs hot. */
  private vents(s: Ship, pressure: number): void {
    const { kit } = this;
    const k = pressure / FAULTLINE.maxPressure;
    const p = s.renderPos;
    const fx = Math.sin(s.renderHeading);
    const fz = -Math.cos(s.renderHeading);
    const deck = p.y + s.spec.freeboard + 8;
    const n = Math.max(1, Math.round(6 * k * kit.k));
    for (let i = 0; i < n; i++) {
      const along = (hash01(s.id, i) - 0.5) * s.spec.length * 0.6;
      const ph = (kit.t * (0.5 + 0.5 * hash01(s.id, i + 20)) + hash01(s.id, i + 9)) % 1;
      kit.particles.push(BK.Spark, p.x + fx * along, deck + 90 * ph, p.z + fz * along, 3 + 3 * k, hot(EMBER, 2), 0.8 * (1 - ph), 0, i, 0, 8, 0, 1.5);
    }
    kit.glow(p.x, deck + 2, p.z, 60 + 120 * k, hot(LAVA, 0.8 + 1.4 * k), 0.15 + 0.3 * k);
    if (k < 0.8) return;
    const ph = (kit.t * 0.4) % 1;
    kit.particles.push(BK.Smoke, p.x, deck + 40 + 80 * ph, p.z, 90 + 80 * ph, hot(ASH, 1), 0.35 * (1 - ph), ph * 3, s.id);
    kit.particles.push(BK.Flare, p.x, deck + 10, p.z, 60, hot(WHITE, 1.8), 0.4 + 0.2 * Math.sin(kit.t * 12), s.id);
  }

  // ------------------------------------------------------------------ the magma mortar

  /** An ember rock trailing smoke and sparks. */
  protected flight(s: Shell, x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
    const { kit } = this;
    kit.particles.push(BK.Shard, x, y, z, 26, hot(BASALT, 1.6), 1, kit.t * 7 + s.id, s.id);
    kit.glow(x, y, z, 34, hot(MAGMA, 2.2), 0.85);
    kit.particles.push(BK.Flare, x, y, z, 20, hot(EMBER, 2.4), 0.8, kit.t * 5 + s.id, s.id);
    const n = Math.max(2, Math.round(6 * kit.k));
    for (let i = 1; i <= n; i++) {
      const back = i * 18;
      kit.particles.push(BK.Smoke, x - dx * back, y - dy * back + i * 3, z - dz * back, 14 + i * 7, hot(BASALT, 1), 0.5 * (1 - i / (n + 1)), i + s.id, s.id + i);
      if (i % 2) kit.particles.push(BK.Spark, x - dx * back * 0.6, y - dy * back * 0.6, z - dz * back * 0.6, 3, hot(MAGMA, 2), 0.8, 0, i, -dx * 10, -dy * 10 + 3, -dz * 10, 1.5);
    }
  }

  /** Molten gobs thrown from (x, y, z), falling back under gravity. */
  private gobs(b: MiscBurst, x: number, y: number, z: number, age: number, fade: number, count: number, floor: number): void {
    const { kit } = this;
    const n = Math.round(count * kit.k);
    for (let i = 0; i < n; i++) {
      const a = hash01(b.id, i) * TAU;
      const v = 60 + hash01(b.id, i + 30) * 90;
      const up = 90 + hash01(b.id, i + 60) * 110;
      const py = y + up * age - 220 * age * age;
      if (py < floor) continue;
      const c = Math.cos(a);
      const s = Math.sin(a);
      kit.particles.push(BK.Spark, x + c * v * age, py, z + s * v * age, 6, hot(EMBER, 2.4), 0.95 * fade, 0, i, c * 8, (up - 440 * age) * 0.08, s * 8, 2);
    }
  }

  /** An ember rock striking a hull: a molten splash, burning gobs and black smoke. */
  protected gunHit(b: MiscBurst, age: number): void {
    const { kit } = this;
    const { x, z, target } = b.e;
    const f = clamp01(age / this.life('gunHit'));
    const fade = 1 - f;
    const y = target ? target.renderPos.y + target.spec.freeboard * 0.6 : kit.surface(x, z) + 8;
    kit.glow(x, y, z, 40 + 120 * fade, hot(WHITE, 2.2), 0.9 * fade);
    kit.particles.push(BK.Flare, x, y, z, 170 * easeOut(age * 6) * fade, hot(MAGMA, 2), 0.85 * fade, b.id);
    kit.particles.push(BK.Smoke, x, y + 30 + 70 * age, z, 60 + 100 * f, hot(BASALT, 1), 0.55 * fade, b.id * 0.7, b.id);
    this.gobs(b, x, y, z, age, fade, 10, y - 20);
    kit.shock(x, z, 30 + 150 * easeOut(f), hot(MAGMA, 1.3), 0.5 * fade);
  }

  /** An ember rock falling in the sea: a steam burst, a glowing ring and lava thrown up. */
  protected gunLand(b: MiscBurst, age: number): void {
    const { kit } = this;
    const { x, z } = b.e;
    const f = clamp01(age / this.life('gunLand'));
    const fade = 1 - f;
    const y = kit.surface(x, z);
    kit.particles.push(BK.Spray, x, y + 40 * easeOut(age * 3), z, 70 + 70 * f, hot(SEA, 1), 0.7 * fade, b.id);
    kit.particles.push(BK.Smoke, x, y + 30 + 90 * easeOut(age), z, 60 + 120 * f, hot(STEAM, 1.1), 0.5 * fade, b.id * 0.7, b.id);
    kit.glow(x, y + 8, z, 30 + 90 * (1 - easeOut(age * 2)), hot(LAVA, 2.2), 0.8 * fade);
    kit.shock(x, z, 20 + 170 * easeOut(f), hot(MAGMA, 1.4), 0.55 * fade);
    this.gobs(b, x, y, z, age, fade, 8, y);
  }

  // ------------------------------------------------------------------ bursts

  /** A fracture opening: a white-hot tip running along it, spray and steam bursting up behind. */
  private tear(b: MiscBurst, age: number): void {
    const { kit } = this;
    const { x, z } = b.e;
    const tx = b.e.tx ?? x;
    const tz = b.e.tz ?? z;
    const small = b.e.n === 1;
    const f = clamp01(age / TEAR);
    const fade = 1 - clamp01(age / this.life('fracture'));
    const run = easeOut(f);
    const hx = x + (tx - x) * run;
    const hz = z + (tz - z) * run;
    kit.glow(hx, 14, hz, (small ? 60 : 110) * (1 - f * 0.5), hot(WHITE, 2.4), 0.9 * fade);
    kit.line(x, 6, z, hx, 6, hz, hot(WHITE, 2), 0.7 * fade, small ? 10 : 16);
    const m = Math.round((small ? 5 : 9) * kit.k);
    for (let i = 0; i < m; i++) {
      const g = (i + 0.5) / m;
      if (g > run) break;
      const since = age - g * TEAR;
      const px = x + (tx - x) * g;
      const pz = z + (tz - z) * g;
      const life = 1 - clamp01(since / 0.8);
      kit.particles.push(BK.Spray, px, 6 + 30 * easeOut(since * 3), pz, 50 + 60 * since, hot(SEA, 1), 0.6 * life, b.id + i);
      kit.particles.push(BK.Smoke, px, 20 + 60 * since, pz, 40 + 70 * since, hot(STEAM, 1), 0.35 * life, since * 3, b.id + i);
    }
  }

  /** A rupture pulse: basalt spikes punch up, a lava geyser and a shock ring. */
  private rupture(b: MiscBurst, age: number): void {
    const { kit } = this;
    const { x, z } = b.e;
    const r = b.e.radius ?? FAULTLINE.pulseRadius;
    const big = (b.e.n ?? 0) >= 2 ? 1.35 : 1;
    const f = clamp01(age / this.life('rupture'));
    const fade = 1 - f;
    const y = kit.surface(x, z);
    const rise = easeOut(age * 5) * (1 - clamp01((age - 0.5) / 0.7));
    const spikes = Math.round(7 * Math.max(0.6, kit.k));
    for (let i = 0; i < spikes; i++) {
      const a = hash01(b.id, i) * TAU;
      const d = r * (0.15 + 0.6 * hash01(b.id, i + 20));
      const px = x + Math.cos(a) * d;
      const pz = z + Math.sin(a) * d;
      const h = (40 + 70 * hash01(b.id, i + 40)) * big * rise;
      if (h < 2) continue;
      const lean = 0.25 * (hash01(b.id, i + 60) - 0.5);
      const tx = px + Math.cos(a) * h * lean;
      const tz = pz + Math.sin(a) * h * lean;
      kit.line(px, y - 4, pz, tx, y + h, tz, hot(BASALT, 1), 0.95, 14 * big, true);
      kit.line(px, y, pz, (px + tx) / 2, y + h * 0.6, (pz + tz) / 2, hot(LAVA, 1.8), 0.6 * fade, 3);
    }
    const gh = 160 * big * easeOut(age * 3) * fade;
    for (let k = 0; k < 4; k++) kit.particles.push(BK.Flare, x, y + (gh * k) / 4, z, (70 - k * 10) * big, hot(k < 2 ? WHITE : LAVA, 2.2), 0.8 * fade, b.id + k);
    this.gobs(b, x, y + 20, z, age, fade, 8 * big, y);
    kit.shock(x, z, r * easeOut(f * 1.6), hot(MAGMA, 1.5), 0.6 * fade);
    kit.particles.push(BK.Spray, x, y + 20, z, r * 0.7 * easeOut(age * 2), hot(SEA, 1), 0.5 * fade, b.id);
    kit.particles.push(BK.Smoke, x, y + 60 + 80 * age, z, 120 + 160 * f, hot(ASH, 1), 0.45 * fade, b.id);
  }

  /** Uplift: an eruption wall bursts out of the line as the ridge rises, and its front throws ships clear. */
  private uplift(b: MiscBurst, age: number): void {
    const { kit } = this;
    const L = lineOf(b.e.x, b.e.z, b.e.tx ?? b.e.x, b.e.tz ?? b.e.z);
    const w = (b.e.radius ?? FAULTLINE.ridgeWidth) / 2;
    const f = clamp01(age / this.life('uplift'));
    const fade = 1 - f;
    const n = Math.max(4, Math.round((L.len / 90) * Math.max(0.5, kit.k)));
    for (let i = 0; i < n; i++) {
      const g = (i + 0.5) / n;
      const px = L.x0 + L.ux * L.len * g;
      const pz = L.z0 + L.uz * L.len * g;
      const a = clamp01((age - hash01(b.id, i) * 0.25) / 0.9);
      if (a <= 0) continue;
      const h = (120 + 80 * hash01(b.id, i + 9)) * bump(a) + FAULTLINE.ridgeHeight;
      kit.line(px, 0, pz, px, h, pz, hot(LAVA, 2), 0.5 * (1 - a), 12);
      kit.particles.push(BK.Flare, px, h * 0.5, pz, 60 + 40 * hash01(b.id, i + 5), hot(LAVA, 2.2), 0.8 * (1 - a), b.id + i);
      kit.particles.push(BK.Flare, px, h, pz, 40, hot(WHITE, 2), 0.6 * (1 - a), b.id + i + 50);
      for (const side of [-1, 1]) kit.particles.push(BK.Spray, px + L.nx * (w + 20) * side, 20 + 50 * easeOut(a * 2), pz + L.nz * (w + 20) * side, 90, hot(SEA, 1), 0.55 * (1 - a), b.id + i * 2 + side);
    }
    const reach = w + FAULTLINE.uplift.reach * easeOut(f * 2);
    for (const side of [-1, 1])
      kit.line(L.x0 + L.nx * reach * side, 4, L.z0 + L.nz * reach * side, L.x1 + L.nx * reach * side, 4, L.z1 + L.nz * reach * side, hot(MAGMA, 1.6), 0.6 * fade, 8);
    kit.particles.push(BK.Smoke, (L.x0 + L.x1) / 2, 60 + 100 * f, (L.z0 + L.z1) / 2, L.len * 0.6, hot(ASH, 1), 0.35 * fade, b.id);
  }

  /** Subduction: the sea spirals and drains into the gaping fracture while rock jaws rise to close it. */
  private basin(b: MiscBurst, age: number): void {
    const { kit } = this;
    const { x, z } = b.e;
    const R = b.e.radius ?? FAULTLINE.subduction.radius;
    const T = FAULTLINE.subduction.time;
    const f = clamp01(age / T);
    const fade = 1 - clamp01((age - T) / 0.2);
    const y = kit.surface(x, z) + 2;
    const sea = this.held[2].copy(hot(SEA, 1.2));
    for (let arm = 0; arm < 6; arm++) {
      let px = x + Math.cos((arm / 6) * TAU + kit.t * 1.6) * R;
      let pz = z + Math.sin((arm / 6) * TAU + kit.t * 1.6) * R;
      for (let i = 1; i <= 12; i++) {
        const g = i / 12;
        const ang = (arm / 6) * TAU + g * 2.4 + kit.t * 1.6;
        const rr = R * (1 - g);
        const nx = x + Math.cos(ang) * rr;
        const nz = z + Math.sin(ang) * rr;
        kit.line(px, y, pz, nx, y, nz, sea, 0.4 * fade * (0.4 + g), 5);
        px = nx;
        pz = nz;
      }
    }
    for (let k = 0; k < 3; k++) {
      const ph = (age * 0.9 + k / 3) % 1;
      kit.ring(x, z, R * (1 - ph), y, hot(SEA, 1.2), 0.45 * ph * fade, 5, 0, 48);
    }
    kit.ring(x, z, R, y + 1, hot(MAGMA, 1.4), 0.5 * fade, 6, kit.t * 0.3, 64, true);
    // The crack gapes along the fracture, and the jaws rise either side of it.
    const dl = Math.hypot(b.e.tx ?? 1, b.e.tz ?? 0) || 1;
    const ux = (b.e.tx ?? 1) / dl;
    const uz = (b.e.tz ?? 0) / dl;
    const open = easeOut(f);
    kit.line(x - ux * 260, y, z - uz * 260, x + ux * 260, y, z + uz * 260, hot(BASALT, 1), 0.9 * fade, 10 + 30 * open, true);
    kit.line(x - ux * 240, y + 1, z - uz * 240, x + ux * 240, y + 1, z + uz * 240, hot(LAVA, 2), 0.7 * fade, 6 + 6 * open);
    for (const side of [-1, 1])
      for (let i = -4; i <= 4; i++) {
        const gap = 160 * (1 - f) + 40;
        const bx = x + ux * i * 55 - uz * gap * side;
        const bz = z + uz * i * 55 + ux * gap * side;
        const h = (30 + 60 * f) * (0.7 + 0.3 * hash01(b.id, i + 10 + side));
        kit.line(bx, y - 4, bz, bx + uz * 20 * side, y + h, bz - ux * 20 * side, hot(BASALT, 1), 0.95 * fade, 16, true);
      }
    const foam = Math.round(10 * kit.k);
    for (let i = 0; i < foam; i++) {
      const ph = (age * 0.7 + hash01(b.id, i)) % 1;
      const ang = hash01(b.id, i + 30) * TAU + ph * 2.4;
      kit.particles.push(BK.Foam, x + Math.cos(ang) * R * (1 - ph), y, z + Math.sin(ang) * R * (1 - ph), 50, hot(SEA, 1), 0.5 * fade, ang, b.id + i);
    }
  }

  /** The jaws slamming shut: teeth driving into the centre, a flash, shards and a shock ring. */
  private crush(b: MiscBurst, age: number): void {
    const { kit } = this;
    const { x, z } = b.e;
    const R = b.e.radius ?? FAULTLINE.subduction.crush;
    const f = clamp01(age / this.life('crush'));
    const fade = 1 - f;
    const y = kit.surface(x, z);
    const shut = easeOut(age * 6);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + hash01(b.id, i) * 0.3;
      const d = R * 0.5 * (1 - shut) + 60;
      const bx = x + Math.cos(a) * d;
      const bz = z + Math.sin(a) * d;
      const h = 90 * (1 - clamp01((age - 0.6) / 0.8));
      kit.line(bx, y - 4, bz, bx - Math.cos(a) * 60, y + h, bz - Math.sin(a) * 60, hot(BASALT, 1), 0.95 * fade, 22, true);
    }
    kit.glow(x, y + 30, z, 300 * (1 - easeOut(age * 3)), hot(WHITE, 2.4), 0.9 * fade);
    kit.shock(x, z, R * easeOut(f * 1.8), hot(MAGMA, 1.6), 0.65 * fade);
    kit.particles.push(BK.Spray, x, y + 80 * easeOut(age * 2), z, 260 + 200 * f, hot(SEA, 1), 0.6 * fade, b.id);
    const n = Math.round(14 * kit.k);
    for (let i = 0; i < n; i++) {
      const a = hash01(b.id, i + 50) * TAU;
      const v = 150 + 200 * hash01(b.id, i + 70);
      const py = y + 160 * age - 200 * age * age;
      if (py < y) continue;
      kit.particles.push(BK.Shard, x + Math.cos(a) * v * age, py, z + Math.sin(a) * v * age, 24, hot(BASALT, 1.3), fade, age * 6 + i, b.id + i);
    }
    if (age < 0.4 && !kit.reduce) kit.distortions.push({ x, y: 40, z, radius: R * 0.5, strength: 0.6 * (1 - age / 0.4), priority: 3 });
  }

  /** Slip: a molten streak behind the hull, sparks thrown off its bow, steam along the line. */
  private slip(b: MiscBurst, age: number): void {
    const { kit } = this;
    const { x, z } = b.e;
    const tx = b.e.tx ?? x;
    const tz = b.e.tz ?? z;
    const T = FAULTLINE.slip.time;
    const f = clamp01(age / T);
    const fade = 1 - clamp01((age - T) / 0.7);
    const hx = x + (tx - x) * f;
    const hz = z + (tz - z) * f;
    kit.line(x, 6, z, hx, 6, hz, hot(LAVA, 2), 0.8 * fade, 26);
    kit.line(x, 7, z, hx, 7, hz, hot(WHITE, 2.2), 0.6 * fade, 8);
    const L = lineOf(x, z, tx, tz);
    if (f < 1) {
      kit.glow(hx, 20, hz, 160, hot(LAVA, 2.2), 0.8);
      const n = Math.round(12 * kit.k);
      for (let i = 0; i < n; i++) {
        const side = i % 2 ? 1 : -1;
        const sp = 0.4 + hash01(b.id, i + Math.floor(age * 30)) * 0.8;
        kit.particles.push(BK.Spark, hx + L.nx * 40 * side, 10 + 20 * sp, hz + L.nz * 40 * side, 4, hot(EMBER, 2.4), 0.9, 0, i, (L.nx * side - L.ux) * 14 * sp, 6 * sp, (L.nz * side - L.uz) * 14 * sp, 2);
      }
      kit.particles.push(BK.Spray, hx + L.ux * 60, 20, hz + L.uz * 60, 140, hot(SEA, 1), 0.6, b.id);
    }
    const m = Math.round(6 * kit.k);
    for (let i = 0; i < m; i++) {
      const g = ((i + 0.5) / m) * f;
      const since = age - g * T;
      kit.particles.push(BK.Smoke, x + (tx - x) * g, 20 + 40 * since, z + (tz - z) * g, 60 + 50 * since, hot(STEAM, 1), 0.35 * (1 - clamp01(since / 1.2)), since * 3, b.id + i);
    }
  }

  /** Aftershock's boulders: rocks shed from a ridge's crest arcing out and splashing down. */
  private boulders(b: MiscBurst, age: number): void {
    const { kit } = this;
    const L = lineOf(b.e.x, b.e.z, b.e.tx ?? b.e.x, b.e.tz ?? b.e.z);
    const reach = b.e.radius ?? FAULTLINE.aftershock.reach;
    const top = FAULTLINE.ridgeHeight * 0.8;
    const n = Math.round(9 * Math.max(0.6, kit.k));
    for (let i = 0; i < n; i++) {
      const g = hash01(b.id, i);
      const sx = L.x0 + L.ux * L.len * g;
      const sz = L.z0 + L.uz * L.len * g;
      const side = i % 2 ? 1 : -1;
      const d = FAULTLINE.ridgeWidth / 2 + 60 + hash01(b.id, i + 20) * (reach - 60);
      const slide = (hash01(b.id, i + 30) - 0.5) * 120;
      const ex = sx + L.nx * d * side + L.ux * slide;
      const ez = sz + L.nz * d * side + L.uz * slide;
      const delay = hash01(b.id, i + 40) * 0.35;
      const T = 0.7;
      const a = (age - delay) / T;
      if (a < 0) continue;
      if (a < 1) {
        const p = kit.arcAt(sx, top, sz, ex, kit.surface(ex, ez), ez, 120, a);
        kit.particles.push(BK.Shard, p.x, p.y, p.z, 34 + 20 * hash01(b.id, i + 50), hot(BASALT, 1.4), 1, age * 6 + i, b.id + i);
        kit.glow(p.x, p.y, p.z, 30, hot(MAGMA, 1.8), 0.6);
        kit.particles.push(BK.Smoke, p.x, p.y + 10, p.z, 50, hot(ASH, 1), 0.35, i, b.id + i);
        continue;
      }
      const since = age - delay - T;
      const life = 1 - clamp01(since / 0.6);
      if (life <= 0) continue;
      const sy = kit.surface(ex, ez);
      kit.particles.push(BK.Spray, ex, sy + 50 * easeOut(since * 3), ez, 80 + 80 * since, hot(SEA, 1), 0.7 * life, b.id + i);
      kit.shock(ex, ez, 30 + 120 * easeOut(since * 2), hot(MAGMA, 1.3), 0.5 * life);
    }
    const fade = 1 - clamp01(age / this.life('boulder'));
    kit.particles.push(BK.Smoke, (L.x0 + L.x1) / 2, top + 40, (L.z0 + L.z1) / 2, L.len * 0.5, hot(ASH, 1), 0.3 * fade, b.id);
  }

  /** Bedrock: slabs of basalt slam onto the hull from all round, then a hot ring and dust. */
  private brace(b: MiscBurst, age: number): void {
    const { kit } = this;
    const s = b.e.ship;
    const p = s.renderPos;
    const fade = 1 - clamp01(age / this.life('bedrock'));
    const close = easeOut(age * 3);
    const n = Math.round(12 * kit.k);
    for (let i = 0; i < n; i++) {
      const a = hash01(b.id, i) * TAU;
      const d = 260 * (1 - close) + s.spec.length * 0.3;
      kit.particles.push(BK.Shard, p.x + Math.cos(a) * d, p.y + 120 * (1 - close) + 10, p.z + Math.sin(a) * d, 40 + 20 * hash01(b.id, i + 9), hot(BASALT, 1.3), fade, a + age * 4, b.id + i);
    }
    kit.glow(p.x, p.y + s.spec.freeboard, p.z, 160 * close, hot(LAVA, 1.8), 0.5 * fade);
    if (age < 0.3) return;
    const since = age - 0.3;
    kit.ring(p.x, p.z, s.spec.length * 0.6 + 200 * easeOut(since * 2), p.y + 6, hot(LAVA, 1.6), 0.6 * (1 - clamp01(since / 0.6)), 10, 0, 64);
    kit.particles.push(BK.Smoke, p.x, p.y + 30, p.z, s.spec.length * (1 + since), hot(ASH, 1), 0.4 * fade, b.id);
  }

  /** The Rebound: a wave of rock and lava rolling out over its reach, hotter for every point of pressure. */
  private rebound(b: MiscBurst, age: number): void {
    const { kit } = this;
    const { x, z } = b.e;
    const R = b.e.radius ?? FAULTLINE.bedrock.radius;
    const heat = 0.6 + (b.e.n ?? 0) / FAULTLINE.maxPressure;
    const f = clamp01(age / this.life('rebound'));
    const fade = 1 - f;
    const y = kit.surface(x, z);
    const front = R * easeOut(age * 2.5);
    kit.ring(x, z, front, y + 6, hot(BASALT, 1), 0.9 * fade, 22, 0, 64, false, true);
    kit.ring(x, z, front, y + 12, hot(LAVA, 1.6 * heat), 0.7 * fade, 8, 0, 64);
    kit.shock(x, z, front, hot(MAGMA, 1.4), 0.5 * fade);
    kit.glow(x, y + 30, z, 200 * heat * (1 - easeOut(age * 3)), hot(WHITE, 2), 0.8 * fade);
    const n = Math.round(14 * kit.k);
    for (let i = 0; i < n; i++) {
      const a = hash01(b.id, i) * TAU;
      const d = front * (0.85 + 0.15 * hash01(b.id, i + 9));
      kit.particles.push(BK.Shard, x + Math.cos(a) * d, y + 30 * bump(f) + 10, z + Math.sin(a) * d, 28, hot(BASALT, 1.3), fade, a + age * 5, b.id + i);
    }
    if (age < 0.4 && !kit.reduce) kit.distortions.push({ x, y: 30, z, radius: R * 0.6, strength: 0.6 * (1 - age / 0.4), priority: 3 });
  }

  /** Caldera's warning: a crater rim of teeth, water sucked inward, magma glowing up and a ring closing on the eruption. */
  private crater(b: MiscBurst, age: number): void {
    const { kit } = this;
    const { x, z } = b.e;
    const R = b.e.radius ?? FAULTLINE.caldera.pull;
    const f = clamp01(age / FAULTLINE.caldera.time);
    const y = kit.surface(x, z);
    const teeth = 36;
    const rim = easeOut(age * 2);
    for (let i = 0; i < teeth; i++) {
      const a = (i / teeth) * TAU;
      const rr = R * (0.92 + 0.06 * hash01(b.id, i));
      const h = (20 + 40 * hash01(b.id, i + 40)) * rim;
      kit.line(x + Math.cos(a) * rr, y - 2, z + Math.sin(a) * rr, x + Math.cos(a) * rr * 0.97, y + h, z + Math.sin(a) * rr * 0.97, hot(BASALT, 1), 0.9, 22, true);
    }
    kit.ring(x, z, R * 0.9, y + 3, hot(MAGMA, 1.5), 0.55, 8, 0, 72);
    const streaks = Math.round(18 * kit.k);
    for (let i = 0; i < streaks; i++) {
      const a = hash01(b.id, i + 80) * TAU + kit.t * 0.2;
      const ph = (age * 0.8 + hash01(b.id, i + 90)) % 1;
      const r1 = R * (1 - ph);
      const r2 = Math.max(0, r1 - 120);
      kit.line(x + Math.cos(a) * r1, y + 4, z + Math.sin(a) * r1, x + Math.cos(a) * r2, y + 4, z + Math.sin(a) * r2, hot(SEA, 1.2), 0.5 * ph, 5);
    }
    kit.glow(x, y + 10, z, 200 + 500 * f, hot(LAVA, 1.2 + 1.5 * f), 0.4 + 0.5 * f);
    kit.particles.push(BK.Smoke, x, y + 80 + 200 * f, z, 300 + 300 * f, hot(ASH, 1), 0.3 + 0.3 * f, b.id);
    kit.ring(x, z, R * (1 - f), y + 5, hot(WHITE, 1.8), 0.7, 6, 0, 64, true);
  }

  /** The Caldera erupting: a lava column, a mushroom of ash, lava bombs raining over the crater and a shock front. */
  private eruption(b: MiscBurst, age: number): void {
    const { kit } = this;
    const { x, z } = b.e;
    const R = b.e.radius ?? FAULTLINE.caldera.radius;
    const heat = 0.7 + ((b.e.n ?? 0) / FAULTLINE.maxPressure) * 0.6;
    const f = clamp01(age / this.life('eruption'));
    const fade = 1 - f;
    const y = kit.surface(x, z);
    const H = 900 * easeOut(age * 1.8) * (1 - clamp01((age - 1.2) / 1.2));
    for (let k = 0; k < 10; k++) {
      const wob = Math.sin(age * 9 + k) * 20;
      kit.particles.push(BK.Flare, x + wob, y + (H * k) / 10, z - wob, 260 - k * 14, hot(k < 3 ? WHITE : LAVA, 2.4 * heat), 0.85 * fade, b.id + k);
    }
    kit.line(x, y, z, x, y + H, z, hot(LAVA, 2 * heat), 0.6 * fade, 120);
    kit.particles.push(BK.Smoke, x, y + H + 60, z, 500 + 500 * f, hot(ASH, 1), 0.55 * fade, b.id);
    kit.particles.push(BK.Smoke, x + 150, y + H * 0.8, z, 380 + 300 * f, hot(BASALT, 1.4), 0.4 * fade, b.id + 1);
    const n = Math.round(22 * kit.k);
    for (let i = 0; i < n; i++) {
      const a = hash01(b.id, i) * TAU;
      const d = R * (0.3 + 0.7 * hash01(b.id, i + 20));
      const ex = x + Math.cos(a) * d;
      const ez = z + Math.sin(a) * d;
      const T = 0.9 + 0.5 * hash01(b.id, i + 40);
      const p = (age - hash01(b.id, i + 60) * 0.3) / T;
      if (p < 0) continue;
      if (p < 1) {
        const q = kit.arcAt(x, y + 200, z, ex, kit.surface(ex, ez), ez, 400 + 300 * hash01(b.id, i + 80), p);
        kit.particles.push(BK.Flare, q.x, q.y, q.z, 50, hot(EMBER, 2.4), 0.95, b.id + i);
        kit.particles.push(BK.Smoke, q.x, q.y + 20, q.z, 60, hot(BASALT, 1.2), 0.4, i, b.id + i);
        continue;
      }
      const since = age - hash01(b.id, i + 60) * 0.3 - T;
      const life = 1 - clamp01(since / 0.6);
      if (life <= 0) continue;
      kit.particles.push(BK.Spray, ex, y + 40 * easeOut(since * 3), ez, 80 + 60 * since, hot(SEA, 1), 0.6 * life, b.id + i);
      kit.glow(ex, y + 6, ez, 60, hot(LAVA, 2), 0.6 * life);
    }
    kit.shock(x, z, R * easeOut(f * 2.5), hot(MAGMA, 1.6), 0.7 * fade);
    kit.ring(x, z, R * easeOut(age * 3), y + 8, hot(LAVA, 1.8), 0.7 * fade, 14, 0, 96);
    if (age < 1.2 && !kit.reduce) kit.distortions.push({ x, y: 200, z, radius: R * 0.6, strength: 1 - age / 1.2, priority: 4 });
  }

  /** Worldbreaker's cast: the sea splits outward from the hull in every direction. */
  private split(b: MiscBurst, age: number): void {
    const { kit } = this;
    const { x, z } = b.e;
    const f = clamp01(age / this.life('worldbreaker'));
    const fade = 1 - f;
    const y = kit.surface(x, z);
    const reach = 700 * easeOut(age * 2.2);
    const lava = this.held[2].copy(hot(LAVA, 2));
    const crust = this.held[3].copy(hot(BASALT, 1));
    for (let i = 0; i < 10; i++) {
      const base = (i / 10) * TAU + hash01(b.id, i) * 0.3;
      let px = x;
      let pz = z;
      for (let s = 1; s <= 6; s++) {
        const d = (reach * s) / 6;
        const a = base + (hash01(b.id, i * 10 + s) - 0.5) * 0.35;
        const nx = x + Math.cos(a) * d;
        const nz = z + Math.sin(a) * d;
        kit.line(px, y + 2, pz, nx, y + 2, nz, crust, 0.85 * fade, 26, true);
        kit.line(px, y + 3, pz, nx, y + 3, nz, lava, 0.8 * fade, 7);
        px = nx;
        pz = nz;
      }
    }
    kit.glow(x, y + 40, z, 400 * (1 - f), hot(WHITE, 2), 0.9 * fade);
    kit.ring(x, z, 900 * easeOut(f * 1.5), y + 8, hot(MAGMA, 1.8), 0.6 * fade, 14, 0, 96);
    this.gobs(b, x, y + 30, z, age, fade, 14, y);
    if (age < 0.6 && !kit.reduce) kit.distortions.push({ x, y: 60, z, radius: 500, strength: 0.8 * (1 - age / 0.6), priority: 4 });
  }

  /** A ridge going under: spray along both flanks, dust and falling rock; a collapse also throws a shock front. */
  private fall(b: MiscBurst, age: number, big: boolean): void {
    const { kit } = this;
    const L = lineOf(b.e.x, b.e.z, b.e.tx ?? b.e.x, b.e.tz ?? b.e.z);
    const w = FAULTLINE.ridgeWidth / 2;
    const h = FAULTLINE.ridgeHeight;
    const f = clamp01(age / SINK);
    const fade = 1 - clamp01(age / this.life(big ? 'collapse' : 'crumble'));
    const n = Math.max(3, Math.round((L.len / 80) * kit.k));
    for (let i = 0; i < n; i++) {
      const along = (i + 0.5) / n;
      const px = L.x0 + L.ux * L.len * along;
      const pz = L.z0 + L.uz * L.len * along;
      for (const side of [-1, 1]) kit.particles.push(BK.Spray, px + L.nx * (w + 15) * side, 20 + 60 * easeOut(age * 2), pz + L.nz * (w + 15) * side, 90 + 60 * f, hot(SEA, 1), 0.6 * fade, b.id + i * 2 + side);
      if (i % 2) kit.particles.push(BK.Smoke, px, h * (1 - f) + 30, pz, 120 + 80 * f, hot(ASH, 1), 0.4 * fade, i, b.id + i);
      const drop = h * 0.8 - 200 * age * age;
      if (drop > 0) kit.particles.push(BK.Shard, px + L.nx * (hash01(b.id, i) - 0.5) * w * 2, drop, pz + L.nz * (hash01(b.id, i) - 0.5) * w * 2, 20, hot(BASALT, 1.3), fade, age * 6 + i, b.id + i);
    }
    const cx = (L.x0 + L.x1) / 2;
    const cz = (L.z0 + L.z1) / 2;
    if (!big) {
      kit.shock(cx, cz, L.len * 0.4 + 100 * f, hot(SEA, 1), 0.3 * fade, BK.Foam);
      return;
    }
    const R = b.e.radius ?? FAULTLINE.worldbreaker.radius;
    kit.shock(cx, cz, R * easeOut(age * 2), hot(MAGMA, 1.6), 0.7 * fade);
    kit.ring(cx, cz, R * easeOut(age * 2), 10, hot(LAVA, 1.8), 0.6 * fade, 12, 0, 80);
    kit.glow(cx, 60, cz, L.len * 0.5 * (1 - easeOut(age * 2)), hot(LAVA, 2), 0.7 * fade);
    this.gobs(b, cx, 40, cz, age, fade, 10, 0);
  }

  dispose(): void {
    super.dispose();
    for (const rock of this.stone.values()) rock.geometry.dispose();
    this.stone.clear();
    this.material.dispose();
  }
}
