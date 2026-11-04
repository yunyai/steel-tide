import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  FogExp2,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  SphereGeometry,
  type Scene,
  type BufferGeometry,
} from "three";
import type { Game } from "../core/Game";
import type { Team } from "../core/types";
import type { Ship } from "../ships/Ship";
import { contactVisible } from "../core/Targeting";
import { courtRadius } from "../skills/misc/JudgeRuntime";
import type { DynamicRidge } from "../world/GameMap";
import { reducedMotion } from "./ArchitectPose";
import { Ribbons } from "./Projectiles";

const GOLD = new Color(0xffca73).multiplyScalar(1.4),
  PINK = new Color(0xf290cf).multiplyScalar(1.3),
  FIRE = new Color(0xff793b).multiplyScalar(1.5),
  INK = new Color(0xa45cae),
  WHITE = new Color(0xffe6bd);
const MAX_OBJECTS = 512;
interface Node {
  group: Group;
  pins: Mesh[];
}
/** Read-only battlefield cues. Target-bound cues are rebuilt for each viewport's contact rules. */
export class MiscTitanFx {
  readonly ribbons = new Ribbons(18000, true, false);
  private nodes = new Map<string, Node>();
  private live = new Set<string>();
  private time = 0;
  private reduce = reducedMotion();
  private box = new BoxGeometry(1, 1, 1);
  private round = new SphereGeometry(1, 10, 6);
  private cloth = new OctahedronGeometry(1, 1);
  private cylinder = new CylinderGeometry(0.5, 0.5, 1, 16);
  private clothMaterial = new MeshStandardMaterial({
    color: 0x5e354e,
    roughness: 0.95,
    metalness: 0.08,
  });
  private needleMaterial = new MeshStandardMaterial({
    color: 0xffd18b,
    roughness: 0.25,
    metalness: 0.8,
    emissive: 0x6b240d,
    emissiveIntensity: 0.3,
  });
  private rockMaterial = new MeshStandardMaterial({
    color: 0x353535,
    roughness: 0.94,
    metalness: 0.12,
  });
  private glowMaterial = new MeshBasicMaterial({
    color: 0xf998d0,
    toneMapped: false,
  });
  constructor(
    private scene: Scene,
    private game: Game,
  ) {
    this.ribbons.mesh.name = "misc-titan-energy";
    scene.add(this.ribbons.mesh);
    if (scene.fog instanceof FogExp2)
      this.ribbons.setFog(scene.fog.color, scene.fog.density);
  }
  /** World objects are cached independently of viewer visibility, avoiding split-screen churn. */
  update(time: number, _dt: number): void {
    this.time = this.reduce ? 0 : time;
    this.live.clear();
    for (const r of this.game.map.dynamicRidges) {
      const key = `misc-ridge-${r.owner}-${r.id}`;
      this.live.add(key);
      const n = this.node(key, "ridge");
      if (!n) continue;
      const dx = r.x1 - r.x0,
        dz = r.z1 - r.z0,
        len = Math.hypot(dx, dz);
      n.group.position.set((r.x0 + r.x1) / 2, r.height / 2, (r.z0 + r.z1) / 2);
      n.group.rotation.y = -Math.atan2(dz, dx);
      n.group.children[0].scale.set(len, r.height, r.width);
      for (let i = 1; i <= 2; i++) {
        n.group.children[i].position.x = ((i === 1 ? -1 : 1) * len) / 2;
        n.group.children[i].scale.set(r.width, r.height, r.width);
      }
    }
    for (const s of this.game.ships) {
      if (!s.alive || !s.hexweaver) continue;
      for (const d of s.hexweaver.dolls) {
        const t = this.game.ships.find((t) => t.id === d.target && t.alive);
        if (!t) continue;
        const key = `misc-doll-${s.id}-${t.id}`;
        this.live.add(key);
        const n = this.node(key, "doll");
        if (!n) continue;
        n.group.position.set(
          t.renderPos.x,
          t.renderPos.y + t.spec.freeboard + 75,
          t.renderPos.z,
        );
        n.group.rotation.y = time * 0.65 + s.id * 0.4;
        n.group.rotation.z = Math.sin(time * 2 + t.id) * 0.12;
        n.group.scale.setScalar(12 + (d.burnUntil > this.game.time ? 2 : 0));
        for (let i = 0; i < n.pins.length; i++) n.pins[i].visible = i < d.pins;
      }
      const d = s.hexweaver.decoy;
      if (d && d.until > this.game.time) {
        const key = `misc-decoy-${s.id}`;
        this.live.add(key);
        const n = this.node(key, "doll");
        if (!n) continue;
        n.group.position.set(d.x, 38 + Math.sin(time * 2) * 3, d.z);
        n.group.scale.setScalar(22);
        n.group.rotation.y = time * 0.35;
        for (const p of n.pins) p.visible = false;
      }
    }
    for (const [key, n] of this.nodes)
      if (!this.live.has(key)) {
        this.scene.remove(n.group);
        this.nodes.delete(key);
      }
  }
  private node(key: string, kind: "doll" | "ridge"): Node | null {
    const old = this.nodes.get(key);
    if (old) return old;
    if (this.nodes.size >= MAX_OBJECTS) return null;
    const g = new Group();
    g.name = key;
    g.visible = false;
    const pins: Mesh[] = [];
    if (kind === "ridge") {
      g.add(
        new Mesh(this.box, this.rockMaterial),
        new Mesh(this.cylinder, this.rockMaterial),
        new Mesh(this.cylinder, this.rockMaterial),
      );
      for (const child of g.children) {
        const m = child as Mesh;
        m.receiveShadow = true;
        m.castShadow = true;
      }
    } else {
      const add = (
        geometry: BufferGeometry,
        material: MeshStandardMaterial | MeshBasicMaterial,
        x: number,
        y: number,
        z: number,
        sx: number,
        sy: number,
        sz: number,
      ) => {
        const m = new Mesh(geometry, material);
        m.position.set(x, y, z);
        m.scale.set(sx, sy, sz);
        g.add(m);
        return m;
      };
      add(this.cloth, this.clothMaterial, 0, 0, 0, 0.9, 1.4, 0.5);
      add(this.round, this.clothMaterial, 0, 1.8, 0, 0.72, 0.72, 0.6);
      for (const side of [-1, 1]) {
        const arm = add(
          this.box,
          this.clothMaterial,
          side * 1.15,
          0.5,
          0,
          1.3,
          0.42,
          0.45,
        );
        arm.rotation.z = side * -0.3;
        const leg = add(
          this.box,
          this.clothMaterial,
          side * 0.4,
          -1.65,
          0,
          0.44,
          1.3,
          0.44,
        );
        leg.rotation.z = side * 0.15;
        // Cross stitches on the effigy's face; their glowing eyes read at gameplay distance.
        add(
          this.round,
          this.glowMaterial,
          side * 0.23,
          1.9,
          0.55,
          0.13,
          0.13,
          0.08,
        );
      }
      for (let i = 0; i < 3; i++) {
        const p = new Mesh(this.cylinder, this.needleMaterial);
        p.position.set((i - 1) * 0.75, 0.7 - i * 0.45, 0.8);
        p.scale.set(0.11, 2, 0.11);
        p.rotation.x = Math.PI * 0.45;
        p.rotation.z = (i - 1) * 0.3;
        g.add(p);
        pins.push(p);
      }
    }
    this.scene.add(g);
    const n = { group: g, pins };
    this.nodes.set(key, n);
    return n;
  }
  private visible(s: Ship, team: Team | -1): boolean {
    return (
      s.alive &&
      !s.withdrawn &&
      !s.mods.banished &&
      (team === -1 || s.team === team || contactVisible(s, team))
    );
  }
  private line(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    c: Color,
    a = 0.7,
    w = 3,
  ): void {
    this.ribbons.push(ax, ay, az, bx, by, bz, c, a, w, 1.1);
  }
  private ring(
    x: number,
    z: number,
    r: number,
    y: number,
    c: Color,
    a = 0.55,
    width = 4,
    phase = 0,
    segments = 80,
  ): void {
    for (let i = 0; i < segments; i++) {
      const b = phase + (i * Math.PI * 2) / segments,
        e = phase + ((i + 1) * Math.PI * 2) / segments;
      this.line(
        x + Math.cos(b) * r,
        y,
        z + Math.sin(b) * r,
        x + Math.cos(e) * r,
        y,
        z + Math.sin(e) * r,
        c,
        a,
        width,
      );
    }
  }
  private chain(a: Ship, b: Ship): void {
    const ax = a.renderPos.x,
      az = a.renderPos.z,
      bx = b.renderPos.x,
      bz = b.renderPos.z,
      dx = bx - ax,
      dz = bz - az,
      len = Math.hypot(dx, dz) || 1;
    const count = Math.min(96, Math.max(12, Math.ceil(len / 30)));
    let px = ax,
      py = 30,
      pz = az;
    for (let i = 1; i <= count; i++) {
      const f = i / count,
        angle = f * Math.PI * count * 0.7 + this.time * 4,
        off = Math.sin(angle) * 9;
      const x = ax + dx * f - (dz / len) * off,
        y = 30 + Math.cos(angle) * 9,
        z = az + dz * f + (dx / len) * off;
      this.line(px, py, pz, x, y, z, GOLD, 0.8, 5);
      px = x;
      py = y;
      pz = z;
    }
  }
  private ridgeOutline(r: DynamicRidge, color: Color, alpha: number): void {
    const dx = r.x1 - r.x0,
      dz = r.z1 - r.z0,
      len = Math.hypot(dx, dz) || 1,
      nx = -dz / len,
      nz = dx / len,
      w = r.width / 2;
    for (const side of [-1, 1])
      this.line(
        r.x0 + nx * w * side,
        5,
        r.z0 + nz * w * side,
        r.x1 + nx * w * side,
        5,
        r.z1 + nz * w * side,
        color,
        alpha,
        5,
      );
    const angle = Math.atan2(dz, dx);
    for (let end = 0; end < 2; end++) {
      const x = end ? r.x1 : r.x0,
        z = end ? r.z1 : r.z0,
        start = angle + (end ? -0.5 : 0.5) * Math.PI;
      for (let i = 0; i < 12; i++) {
        const a = start + (i * Math.PI) / 12,
          b = start + ((i + 1) * Math.PI) / 12;
        this.line(
          x + Math.cos(a) * w,
          5,
          z + Math.sin(a) * w,
          x + Math.cos(b) * w,
          5,
          z + Math.sin(b) * w,
          color,
          alpha,
          5,
        );
      }
    }
  }
  /** Call before each viewport render, after update. No hidden target position is emitted. */
  prepare(team: Team | -1, heightPx = 1000): void {
    this.ribbons.begin();
    this.ribbons.material.uniforms.uViewportH.value = heightPx;
    for (const n of this.nodes.values()) n.group.visible = false;
    const now = this.game.time,
      t = this.time;
    for (const r of this.game.map.dynamicRidges) {
      const n = this.nodes.get(`misc-ridge-${r.owner}-${r.id}`);
      if (n) n.group.visible = true;
      const dx = r.x1 - r.x0,
        dz = r.z1 - r.z0,
        len = Math.hypot(dx, dz) || 1;
      const alpha = 0.45 + 0.15 * Math.sin(t * 3 + r.id);
      this.line(
        r.x0,
        r.height + 1,
        r.z0,
        r.x1,
        r.height + 1,
        r.z1,
        FIRE,
        alpha,
        7,
      );
      for (let i = 0; i < 8; i++) {
        const f = (i + 0.5) / 8,
          x = r.x0 + dx * f,
          z = r.z0 + dz * f,
          side = i % 2 ? 1 : -1;
        this.line(
          x,
          r.height + 1,
          z,
          x - (dz / len) * r.width * 0.44 * side,
          r.height + 1,
          z + (dx / len) * r.width * 0.44 * side,
          FIRE,
          0.45,
          3,
        );
      }
    }
    for (const s of this.game.ships) {
      if (!s.alive || s.withdrawn) continue;
      const visible = this.visible(s, team),
        j = s.judge;
      if (j?.court) {
        const p = j.court,
          r = courtRadius(s),
          martial = j.martialUntil > now;
        this.ring(p.x, p.z, r, 5, GOLD, martial ? 0.85 : 0.5, martial ? 9 : 5);
        this.ring(p.x, p.z, r - 25, 5, GOLD, 0.22, 2);
        if (martial) this.ring(p.x, p.z, r - 75, 7, GOLD, 0.45, 4, t * 0.02);
        for (let i = 0; i < 36; i++) {
          const b = (i * Math.PI) / 18,
            c = Math.cos(b),
            z = Math.sin(b),
            length = i % 3 ? 30 : 70;
          this.line(
            p.x + c * (r - length),
            6,
            p.z + z * (r - length),
            p.x + c * (r + 12),
            6,
            p.z + z * (r + 12),
            GOLD,
            0.65,
            4,
          );
          if (i % 3 === 0) {
            const x = p.x + c * (r - 95),
              zz = p.z + z * (r - 95);
            this.line(
              x - z * 20,
              6,
              zz + c * 20,
              x + z * 20,
              6,
              zz - c * 20,
              GOLD,
              0.6,
              4,
            );
          }
        }
        for (const arrest of j.arrests) {
          const target = this.game.ships.find((v) => v.id === arrest.target);
          if (visible && target && this.visible(target, team))
            this.chain(s, target);
        }
      }
      if (s.hexweaver) {
        const h = s.hexweaver;
        for (let i = 0; i < h.dolls.length; i++) {
          const d = h.dolls[i],
            target = this.game.ships.find((v) => v.id === d.target && v.alive);
          if (!target || !this.visible(target, team)) continue;
          const n = this.nodes.get(`misc-doll-${s.id}-${target.id}`);
          if (n) n.group.visible = true;
          const x = target.renderPos.x,
            z = target.renderPos.z,
            y = target.renderPos.y + target.spec.freeboard + 65;
          this.ring(
            x,
            z,
            50 + Math.sin(t * 3) * 4,
            y - 45,
            d.burnUntil > now ? FIRE : PINK,
            0.4,
            3,
            0,
            24,
          );
          if (visible)
            this.line(
              s.renderPos.x,
              s.spec.freeboard + 45,
              s.renderPos.z,
              x,
              y,
              z,
              INK,
              0.27,
              2,
            );
          if (d.stitchedUntil > now)
            for (let k = i + 1; k < h.dolls.length; k++) {
              const other = h.dolls[k];
              if (other.stitchedUntil <= now) continue;
              const v = this.game.ships.find(
                (v) => v.id === other.target && v.alive,
              );
              if (!v || !this.visible(v, team)) continue;
              const dx = v.renderPos.x - x,
                dz = v.renderPos.z - z;
              for (let m = 0; m < 12; m++) {
                const f = m / 12,
                  e = (m + 1) / 12;
                this.line(
                  x + dx * f,
                  y + Math.sin(f * Math.PI) * 35,
                  z + dz * f,
                  x + dx * e,
                  y + Math.sin(e * Math.PI) * 35,
                  z + dz * e,
                  PINK,
                  0.6,
                  3,
                );
              }
            }
        }
        if (visible && h.decoy) {
          const n = this.nodes.get(`misc-decoy-${s.id}`);
          if (n) n.group.visible = true;
          this.ring(h.decoy.x, h.decoy.z, 90, 5, PINK, 0.4, 3, 0, 32);
        }
      }
      if (s.gourmand) {
        const a = s.gourmand;
        if (a.bite) {
          const target = this.game.ships.find((v) => v.id === a.bite!.target);
          if (target && this.visible(target, team))
            this.ring(a.bite.x, a.bite.z, 380, 8, WHITE, 0.75, 7, t * 0.15, 48);
        }
        if (!visible) continue;
        const p = s.localToWorld(s.spec.length * 0.5 + 95, 0, 0),
          active = a.mouthUntil > now || a.banquetUntil > now;
        if (active) {
          const radius = a.banquetUntil > now ? 500 : 310;
          for (let i = 0; i < 3; i++)
            this.ring(
              p.x,
              p.z,
              radius * (0.35 + ((t * 0.5 + i / 3) % 1) * 0.65),
              7,
              FIRE,
              0.24,
              4,
              t * 0.2,
              32,
            );
        }
        if (a.swallow) {
          this.ring(
            s.renderPos.x,
            s.renderPos.z,
            115,
            38,
            FIRE,
            0.65,
            5,
            t * 0.5,
            32,
          );
          this.ring(
            s.renderPos.x,
            s.renderPos.z,
            145,
            48,
            GOLD,
            0.4,
            3,
            -t * 0.5,
            32,
          );
        }
      }
      if (s.faultline) {
        // Fractures and terrain warnings are public hazards, like the resulting solid ridges.
        for (const f of s.faultline.fractures) {
          const dx = f.x1 - f.x0,
            dz = f.z1 - f.z0,
            len = Math.hypot(dx, dz) || 1,
            parts = Math.max(3, Math.ceil(len / 100));
          let x = f.x0,
            z = f.z0;
          for (let i = 1; i <= parts; i++) {
            const n = i === parts ? 0 : Math.sin(i * 2.7 + f.id) * 19,
              nx = f.x0 + (dx * i) / parts - (dz / len) * n,
              nz = f.z0 + (dz * i) / parts + (dx / len) * n;
            this.line(
              x,
              5,
              z,
              nx,
              5,
              nz,
              FIRE,
              0.55 + 0.15 * Math.sin(t * 4 + i),
              5,
            );
            x = nx;
            z = nz;
          }
        }
        for (const p of s.faultline.pending)
          if (p.ridge)
            this.ridgeOutline(p.ridge, FIRE, 0.45 + 0.2 * Math.sin(t * 10));
      }
    }
    this.ribbons.end();
  }
  dispose(): void {
    for (const n of this.nodes.values()) this.scene.remove(n.group);
    this.nodes.clear();
    this.live.clear();
    this.scene.remove(this.ribbons.mesh);
    this.ribbons.dispose();
    this.box.dispose();
    this.round.dispose();
    this.cloth.dispose();
    this.cylinder.dispose();
    this.clothMaterial.dispose();
    this.needleMaterial.dispose();
    this.rockMaterial.dispose();
    this.glowMaterial.dispose();
  }
}
