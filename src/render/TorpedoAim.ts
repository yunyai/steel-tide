import { BufferAttribute, BufferGeometry, Color, DoubleSide, DynamicDrawUsage, Group, Mesh, MeshBasicMaterial } from 'three';
import { forwardX, forwardZ } from '../core/math';
import type { Ship } from '../ships/Ship';
import type { TorpedoSolution } from '../weapons/TorpedoAim';
import { waveHeight } from '../world/Waves';
import { Ribbons } from './Projectiles';

export interface TorpedoAimSource { ship: Ship; aim: { x:number; z:number } }
const READY = new Color(0x48f6a3), UNAVAILABLE = new Color(0xff596f), ARC = new Color(0x9fc8d7);
const MAX_VERTICES = 16384;

/** Local presentation only. Rebuilt per viewport, with a fixed GPU allocation per battle. */
export class TorpedoAim {
  readonly root = new Group();
  readonly ribbons = new Ribbons(4096, false, false);
  readonly fan: Mesh<BufferGeometry, MeshBasicMaterial>;
  private positions = new Float32Array(MAX_VERTICES * 3);
  private colors = new Float32Array(MAX_VERTICES * 3);
  private vertices = 0;
  private time = 0;

  constructor() {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage));
    geometry.setAttribute('color', new BufferAttribute(this.colors, 3).setUsage(DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    this.fan = new Mesh(geometry, new MeshBasicMaterial({ vertexColors:true, transparent:true, opacity:0.075, depthWrite:false, side:DoubleSide, toneMapped:false }));
    this.fan.frustumCulled = false;
    this.fan.renderOrder = 3;
    this.ribbons.mesh.renderOrder = 4;
    this.root.add(this.fan, this.ribbons.mesh);
    this.root.name = 'torpedo-aiming-overlay';
    this.root.visible = false;
  }
  update(source: TorpedoAimSource | undefined, heightPx: number): void {
    const s = source?.ship;
    this.root.visible = !!s && s.alive && !s.withdrawn && !s.game.over && s.currentSlot?.kind === 'torp' && !!s.spec.torpedoes;
    if (!this.root.visible || !s || !source) return;
    this.time = s.game.renderTime;
    this.vertices = 0;
    this.ribbons.begin();
    this.ribbons.material.uniforms.uViewportH.value = heightPx;
    let ready = false;
    const solutions = s.launchers.map(l => s.torpedoSolution(l, source.aim.x, source.aim.z));
    solutions.sort((a,b) => Number(a.readiness === 'ready') - Number(b.readiness === 'ready'));
    for (const p of solutions) {
      ready ||= p.readiness === 'ready';
      this.launcher(p, s.renderHeading);
    }
    // The actual point on the sea being aimed at, even when beyond torpedo travel distance.
    const c = ready ? READY : UNAVAILABLE;
    const { x, z } = source.aim;
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2, b = (i + 1) * Math.PI / 2;
      this.line(x + Math.sin(a) * 35, z + Math.cos(a) * 35, x + Math.sin(b) * 35, z + Math.cos(b) * 35, c, 0.9, 1.6);
    }
    this.ribbons.end();
    this.fan.geometry.setDrawRange(0, this.vertices);
    for (const name of ['position','color']) {
      const a = this.fan.geometry.getAttribute(name) as BufferAttribute;
      a.addUpdateRange(0, this.vertices * 3);
      a.needsUpdate = true;
    }
  }
  private height(x: number, z: number): number { return waveHeight(x, z, this.time) + 4; }
  private line(ax: number, az: number, bx: number, bz: number, color: Color, alpha: number, minPx = 1): void {
    this.ribbons.push(ax, this.height(ax,az), az, bx, this.height(bx,bz), bz, color, alpha, 1.5, minPx);
  }
  private ray(p: TorpedoSolution, a: number, color: Color, dashed: boolean, alpha: number): void {
    const n = 40;
    for (let i = 0; i < n; i++) {
      if (dashed && i % 2) continue;
      const d0 = p.range * i / n, d1 = p.range * (i + 1) / n;
      this.line(p.x + forwardX(a)*d0, p.z + forwardZ(a)*d0, p.x + forwardX(a)*d1, p.z + forwardZ(a)*d1, color, alpha, 1.2);
    }
  }
  private launcher(p: TorpedoSolution, heading: number): void {
    const ready = p.readiness === 'ready', color = ready ? READY : UNAVAILABLE;
    for (const [lo,hi] of p.sectors) {
      this.ray(p, heading + lo, ARC, true, 0.2);
      this.ray(p, heading + hi, ARC, true, 0.2);
      this.arc(p, heading + lo, heading + hi, ARC, 0.3);
    }
    const spread = p.headings.length > 1 ? p.spread : 0.003;
    const lo = p.bearing - spread / 2, hi = p.bearing + spread / 2;
    this.arc(p, lo, hi, color, 0.9);
    for (const h of p.headings) this.ray(p, h, color, !ready, ready ? 0.8 : 0.65);
    const fillColor = ready ? color : color.clone().multiplyScalar(0.45);
    // Tessellate the translucent fan so it follows waves instead of cutting through the sea.
    for (let ring = 0; ring < 24; ring++) for (let wedge = 0; wedge < 4; wedge++) {
      const d0 = p.range * ring / 24, d1 = p.range * (ring + 1) / 24;
      const a = lo + (hi - lo) * wedge / 4, b = lo + (hi - lo) * (wedge + 1) / 4;
      const point = (d: number, h: number): [number,number] => [p.x + forwardX(h)*d, p.z + forwardZ(h)*d];
      const A = point(d0,a), B = point(d1,a), C = point(d1,b), D = point(d0,b);
      for (const [x,z] of [A,B,C,A,C,D]) this.vertex(x,z,fillColor);
    }
  }
  private arc(p: TorpedoSolution, lo: number, hi: number, color: Color, alpha: number): void {
    const n = Math.max(2, Math.ceil((hi-lo) * 32));
    for (let i = 0; i < n; i++) {
      const a = lo + (hi-lo)*i/n, b = lo + (hi-lo)*(i+1)/n;
      this.line(p.x + forwardX(a)*p.range, p.z + forwardZ(a)*p.range, p.x + forwardX(b)*p.range, p.z + forwardZ(b)*p.range, color, alpha);
    }
  }
  private vertex(x: number, z: number, color: Color): void {
    if (this.vertices >= MAX_VERTICES) return;
    const i = this.vertices++ * 3;
    this.positions.set([x,this.height(x,z),z],i);
    this.colors.set([color.r,color.g,color.b],i);
  }
  dispose(): void {
    this.ribbons.dispose(); this.fan.geometry.dispose(); this.fan.material.dispose(); this.root.removeFromParent();
  }
}
