import type { SkyPreset } from '../../render/Environment';
import { type Prop, PROP_DAMAGED, PROP_RUBBLE, type PropKind, Props } from './props';
import { fbm, hash2, MAT, type Material, Terrain } from './terrain';

// Land maps. Each builds its terrain and props from a fixed layout seed, so a map is the same
// every battle and players can learn it; the battle seed only shuffles who spawns where.

export interface GroundCap {
  name: string;
  x: number;
  z: number;
}

/** A road deck over water, drawn by the view (the terrain carries the vehicles). */
export interface Bridge {
  x: number;
  z: number;
  /** Half width across the deck and half length along it, and the deck's heading. */
  hw: number;
  hl: number;
  rot: number;
  y: number;
}

export interface GroundMapPreset extends SkyPreset {
  name: string;
  description: string;
  half: number;
  caps: GroundCap[];
  /** Spawn edges: team 0 west (-x), team 1 east (+x); lanes run along z within this half-width. */
  spawnSpread: number;
  /** Falling snow in the view. */
  snow?: boolean;
  build(): GroundWorld;
}

export interface GroundWorld {
  terrain: Terrain;
  props: Props;
  bridges: Bridge[];
}

function addProp(props: Props, t: Terrain, kind: PropKind, x: number, z: number, hw: number, hd: number, h: number, rot: number, style: number): Prop {
  return props.add({ kind, x, z, y: t.heightAt(x, z), hw, hd, h, rot, style });
}

// ---------------------------------------------------------------------------------------------
// Ruined city: a street grid of half-ruined blocks cut by a canal with three bridges. Captures at
// the rail yard (north), the central plaza and the cathedral park (south of the canal).

const CITY_SEED = 9113;
const CITY_HALF = 800;
const STREET_PITCH = 110;
const STREET_HALF = 9;
const BRIDGE_X = [-440, 0, 440];
/** Half-width of a bridge deck: wide enough for the nav grid's 8 m cells to see two flat lanes. */
const BRIDGE_HALF = 12;
const PLAZA = { x: 0, z: -40, r: 75 };
const YARD = { x: 0, z: -470, hw: 190, hd: 72 };
const PARK = { x: 0, z: 430, r: 120 };

/** Canal centreline (mirrored about x = 0 so neither side gets the better ground). */
function canalZ(x: number): number {
  return 170 - 60 * Math.cos(x / 260);
}
const CANAL_BED = 13;
const CANAL_BANK = 16;

function nearStreet(v: number): number {
  return Math.abs(v - Math.round(v / STREET_PITCH) * STREET_PITCH);
}

function onBridge(x: number, z: number): boolean {
  for (const bx of BRIDGE_X) if (Math.abs(x - bx) < BRIDGE_HALF && Math.abs(z - canalZ(bx)) < CANAL_BANK + 4) return true;
  return false;
}

function cityHeight(x: number, z: number): number {
  const ax = Math.abs(x);
  const az = Math.abs(z);
  // Outskirts roll a little; the streets stay near flat.
  const out = Math.max(0, Math.min(1, (ax - 560) / 120));
  let h = fbm(x, z, 140, 3, CITY_SEED) * (0.6 + out * 3);
  // Rubble embankments ring the battlefield.
  const edge = Math.max(ax, az) - 730;
  if (edge > 0) h += edge * 0.45 + fbm(x, z, 30, 2, CITY_SEED + 5) * 2;
  // The canal: a flat bed between steep stone banks, spanned by the bridges.
  const d = Math.abs(z - canalZ(x));
  if (d < CANAL_BANK && !onBridge(x, z)) {
    const bed = -6;
    h = d < CANAL_BED ? bed : bed + ((d - CANAL_BED) / (CANAL_BANK - CANAL_BED)) * (h - bed);
  }
  return h;
}

function cityMaterial(x: number, z: number, h: number): Material {
  if (onBridge(x, z)) return MAT.road;
  if (h < -1) return MAT.mud;
  const dc = Math.abs(z - canalZ(x));
  if (dc < CANAL_BANK + 6) return MAT.grass;
  if (Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.r) return MAT.road;
  if (Math.abs(x - YARD.x) < YARD.hw && Math.abs(z - YARD.z) < YARD.hd) {
    return Math.abs(((z - YARD.z + 400) % 14) - 7) < 1.6 ? MAT.rail : MAT.dirt;
  }
  if (Math.hypot(x - PARK.x, z - PARK.z) < PARK.r) {
    // Gravel paths quarter the park.
    return Math.min(Math.abs(x - PARK.x), Math.abs(z - PARK.z)) < 3 ? MAT.road : MAT.grass;
  }
  if (Math.max(Math.abs(x), Math.abs(z)) > 730) return MAT.rubble;
  if (nearStreet(x) < STREET_HALF || nearStreet(z) < STREET_HALF) return MAT.road;
  return Math.abs(x) > 600 ? MAT.grass : MAT.dirt;
}

/** Is this block (by its centre) left open: plaza, rail yard, park, canal or the spawn fields? */
function openGround(x: number, z: number, r: number): boolean {
  if (Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.r + r) return true;
  if (Math.abs(x - YARD.x) < YARD.hw + r && Math.abs(z - YARD.z) < YARD.hd + r) return true;
  if (Math.hypot(x - PARK.x, z - PARK.z) < PARK.r + r) return true;
  if (Math.abs(z - canalZ(x)) < CANAL_BANK + 6 + r) return true;
  return Math.max(Math.abs(x), Math.abs(z)) > 712 - r;
}

function buildCity(): GroundWorld {
  const t = new Terrain(CITY_HALF);
  t.shape(cityHeight);
  t.waterLevel = -3.5;
  t.paint(cityMaterial);
  const props = new Props(CITY_HALF);
  const rnd = (a: number, b: number, k: number) => hash2(a, b, CITY_SEED + k);

  // City blocks: two or three lots a side, most built on, some already rubble.
  const blocks = Math.ceil(CITY_HALF / STREET_PITCH);
  for (let bj = -blocks; bj < blocks; bj++) {
    for (let bi = -blocks; bi < blocks; bi++) {
      const x0 = bi * STREET_PITCH + STREET_HALF;
      const z0 = bj * STREET_PITCH + STREET_HALF;
      const size = STREET_PITCH - STREET_HALF * 2;
      const nx = rnd(bi, bj, 1) < 0.6 ? 2 : 3;
      const nz = rnd(bi, bj, 2) < 0.6 ? 2 : 3;
      const lw = size / nx;
      const ld = size / nz;
      const centre = Math.hypot(x0 + size / 2, z0 + size / 2);
      const outskirts = Math.abs(x0 + size / 2) > 560;
      for (let lj = 0; lj < nz; lj++) {
        for (let li = 0; li < nx; li++) {
          const cx = x0 + (li + 0.5) * lw;
          const cz = z0 + (lj + 0.5) * ld;
          if (openGround(cx, cz, Math.max(lw, ld) / 2)) continue;
          const k = bi * 7 + li * 3;
          const m = bj * 7 + lj * 3;
          const roll = rnd(k, m, 3);
          if (outskirts && roll < 0.55) continue;
          const hw = (lw / 2 - 2) * (0.72 + rnd(k, m, 4) * 0.28);
          const hd = (ld / 2 - 2) * (0.72 + rnd(k, m, 5) * 0.28);
          if (roll < 0.14) {
            // Already rubble: a low heap, slow going.
            const p = addProp(props, t, 'building', cx, cz, hw, hd, 2.5, 0, Math.floor(rnd(k, m, 6) * 4));
            p.state = PROP_RUBBLE;
            p.hp = 0;
            t.paintBox(cx, cz, hw, hd, 0, MAT.rubble);
            continue;
          }
          if (roll < 0.22) {
            // A walled yard.
            addProp(props, t, 'wall', cx, cz - hd, hw, 0.4, 2.2, 0, 0);
            addProp(props, t, 'wall', cx - hw, cz, 0.4, hd, 2.2, 0, 0);
            if (rnd(k, m, 7) < 0.5) addProp(props, t, 'tree', cx + hw * 0.3, cz + hd * 0.2, 1.2, 1.2, 9, 0, 1);
            continue;
          }
          const tall = Math.max(0, 1 - centre / 700);
          const h = 8 + rnd(k, m, 8) * 12 + tall * 14;
          const p = addProp(props, t, 'building', cx, cz, hw, hd, h, 0, Math.floor(rnd(k, m, 9) * 4));
          if (rnd(k, m, 10) < 0.3) {
            p.state = PROP_DAMAGED;
            p.hp = Math.round(p.maxHp * 0.45);
          }
        }
      }
    }
  }

  // Burned-out cars along the streets.
  for (let i = 0; i < 90; i++) {
    const alongX = rnd(i, 0, 20) < 0.5;
    const line = (Math.round((rnd(i, 1, 21) - 0.5) * 14) * STREET_PITCH);
    const pos = (rnd(i, 2, 22) - 0.5) * 1360;
    const off = (rnd(i, 3, 23) < 0.5 ? -1 : 1) * (4 + rnd(i, 4, 24) * 3);
    const x = alongX ? pos : line + off;
    const z = alongX ? line + off : pos;
    if (Math.abs(z - canalZ(x)) < CANAL_BANK + 4 || Math.hypot(x - PLAZA.x, z - PLAZA.z) < 30) continue;
    if (props.blockedAt(x, z, 3)) continue;
    addProp(props, t, 'car', x, z, 1.0, 2.2, 1.5, (alongX ? Math.PI / 2 : 0) + (rnd(i, 5, 25) - 0.5) * 0.6, Math.floor(rnd(i, 6, 26) * 3));
  }

  // The plaza: a fountain to fight around and broken statues.
  addProp(props, t, 'rock', PLAZA.x, PLAZA.z, 7, 7, 2.2, 0, 1);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    addProp(props, t, 'rock', PLAZA.x + Math.sin(a) * 42, PLAZA.z + Math.cos(a) * 42, 2, 2, 5, a, 2);
  }

  // Rail yard: rows of freight wagons for cover, a station along the north side.
  for (let row = 0; row < 5; row++) {
    const z = YARD.z - 42 + row * 21;
    for (let i = 0; i < 9; i++) {
      if (rnd(row, i, 30) < 0.35) continue;
      const x = YARD.x - 160 + i * 40 + (rnd(row, i, 31) - 0.5) * 8;
      addProp(props, t, 'car', x, z, 7.5, 1.6, 3.6, Math.PI / 2, 3 + Math.floor(rnd(row, i, 32) * 2));
    }
  }
  addProp(props, t, 'building', YARD.x, YARD.z - YARD.hd - 14, 48, 9, 12, 0, 5);

  // Cathedral park: trees, low walls, and the cathedral on its south side.
  for (let i = 0; i < 70; i++) {
    const a = rnd(i, 0, 40) * Math.PI * 2;
    const r = 28 + rnd(i, 1, 41) * (PARK.r - 34);
    const x = PARK.x + Math.sin(a) * r;
    const z = PARK.z + Math.cos(a) * r;
    if (Math.min(Math.abs(x - PARK.x), Math.abs(z - PARK.z)) < 5) continue;
    addProp(props, t, 'tree', x, z, 1.2, 1.2, 10 + rnd(i, 2, 42) * 6, 0, 1);
  }
  for (const s of [-1, 1]) addProp(props, t, 'hedge', PARK.x + s * 55, PARK.z - 40, 14, 1, 2.2, 0, 0);
  addProp(props, t, 'building', PARK.x, PARK.z + PARK.r + 28, 18, 32, 30, Math.PI / 2, 9);

  // Trees along the canal banks; railings on the bridges.
  for (let x = -700; x <= 700; x += 26) {
    if (BRIDGE_X.some((b) => Math.abs(x - b) < 20)) continue;
    for (const s of [-1, 1]) {
      const z = canalZ(x) + s * (CANAL_BANK + 4);
      if (hash2(x, s, CITY_SEED + 50) < 0.6) addProp(props, t, 'tree', x, z, 1.2, 1.2, 11, 0, 1);
    }
  }
  const bridges: Bridge[] = [];
  for (const bx of BRIDGE_X) {
    const bz = canalZ(bx);
    bridges.push({ x: bx, z: bz, hw: BRIDGE_HALF, hl: CANAL_BANK + 2, rot: 0, y: t.heightAt(bx, bz) });
    for (const s of [-1, 1]) addProp(props, t, 'fence', bx + s * (BRIDGE_HALF - 0.4), bz, 0.3, CANAL_BANK, 1.1, 0, 2);
  }

  // Shell craters dent the open ground.
  for (let i = 0; i < 46; i++) {
    const x = (rnd(i, 0, 60) - 0.5) * 1300;
    const z = (rnd(i, 1, 61) - 0.5) * 1300;
    if (Math.abs(z - canalZ(x)) < CANAL_BANK + 6 || props.blockedAt(x, z, 6)) continue;
    crater(t, x, z, 4 + rnd(i, 2, 62) * 4, 1.2 + rnd(i, 3, 63));
  }
  return { terrain: t, props, bridges };
}

/** Press a bowl into the ground and scatter rubble round its lip. */
export function crater(t: Terrain, x: number, z: number, r: number, depth: number): void {
  const n = t.n;
  const c = t.cell;
  const i0 = Math.max(0, Math.floor((x - r - t.vx(0)) / c));
  const i1 = Math.min(n - 1, Math.ceil((x + r - t.vx(0)) / c));
  const j0 = Math.max(0, Math.floor((z - r - t.vx(0)) / c));
  const j1 = Math.min(n - 1, Math.ceil((z + r - t.vx(0)) / c));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(t.vx(i) - x, t.vx(j) - z) / r;
      if (d >= 1) continue;
      t.h[j * n + i] -= depth * (1 - d * d);
    }
  }
  for (let a = 0; a < 8; a++) t.setMaterial(x + Math.sin(a * 0.785) * r, z + Math.cos(a * 0.785) * r, MAT.rubble);
  t.markDirty(x - r - c, z - r - c, x + r + c, z + r + c);
}

export const GROUND_MAPS: GroundMapPreset[] = [
  {
    id: 'city',
    name: 'Ruined city',
    description: 'Street fighting through half-fallen blocks. A canal splits the south, crossed by three bridges.',
    half: CITY_HALF,
    sun: { elevation: 14, azimuth: 250 },
    turbidity: 7,
    caps: [
      { name: 'Rail yard', x: YARD.x, z: YARD.z },
      { name: 'Plaza', x: PLAZA.x, z: PLAZA.z },
      { name: 'Cathedral park', x: PARK.x, z: PARK.z },
    ],
    spawnSpread: 380,
    build: buildCity,
  },
];

export const GROUND_MAP_BY_ID: Record<string, GroundMapPreset> = Object.fromEntries(GROUND_MAPS.map((m) => [m.id, m]));
