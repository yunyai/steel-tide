import { Color, type Scene } from 'three';
import type { Game } from '../core/Game';
import type { Ship } from '../ships/Ship';
import type { Team } from '../core/types';
import { audio } from '../fx/Audio';
import { waveHeight } from '../world/Waves';
import { FLICKER_RADIUS } from '../skills/misc/StepperRuntime';
import { quality } from './Quality';
import { Ribbons } from './Projectiles';

const DARK = new Color(0x100b22), WHITE = new Color(0xf9f2ff).multiplyScalar(3);
const VIOLET = new Color(0xad74ff).multiplyScalar(2), ENEMY = new Color(0xff476e).multiplyScalar(2);
const hash = (n: number) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
interface Finish { ship: Ship; x:number; z:number; radius:number; age:number }

/** Stepper's ultimate boundaries and slash storm in two fixed-size batches, independent of simulation RNG. */
export class CrossStepFx {
  readonly light = new Ribbons(6000, true, false);
  readonly dark = new Ribbons(3000, false, false);
  private finishes: Finish[] = [];
  private heard = new Map<number, number>();
  private off: () => void;
  private local: Ship[] = [];
  constructor(private scene: Scene, private game: Game) {
    this.light.mesh.name = 'cross-step-light';
    this.dark.mesh.name = 'cross-step-fractures';
    this.dark.mesh.renderOrder = 5;
    scene.add(this.dark.mesh, this.light.mesh);
    this.off = game.events.on('crossStep', e => {
      if (e.phase !== 'finish') return;
      if (this.finishes.length >= 12) this.finishes.shift();
      this.finishes.push({ ...e, age:0 });
      if (!e.ship.stepper?.copy) audio.cue('crossStep','end','impact',e.x,20,e.z,this.local.includes(e.ship));
    });
  }
  update(dt: number, local: Ship[] = []): void {
    this.local = local;
    if (this.game.over) { this.finishes = []; this.heard.clear(); return; }
    for (const f of this.finishes) f.age += dt;
    this.finishes = this.finishes.filter(f => f.age < 0.7 && f.ship.alive && !f.ship.withdrawn);
    const active = new Set<number>();
    for (const s of this.game.ships) {
      const f = s.alive && s.stepper?.cross;
      if (!f || s.stepper?.copy) continue;
      active.add(s.id);
      const beat = Math.floor(f.elapsed / 0.18);
      if (this.heard.get(s.id) === beat) continue;
      this.heard.set(s.id, beat);
      audio.cue('crossStep','impact','slash',f.x,25,f.z,local.includes(s));
    }
    for (const id of this.heard.keys()) if (!active.has(id)) this.heard.delete(id);
  }
  prepare(team: Team | -1, heightPx: number): void {
    this.light.begin(); this.dark.begin();
    this.light.material.uniforms.uViewportH.value = this.dark.material.uniforms.uViewportH.value = heightPx;
    if (!this.game.over) {
      for (const s of this.game.ships) {
        if (!s.alive || s.withdrawn) continue;
        const color = team === -1 || s.team === team ? VIOLET : ENEMY;
        const echo = !!s.stepper?.copy;
        const flicker = s.stepper?.flicker;
        if (flicker && !echo) this.flickerArea(flicker.x, flicker.z, color);
        const f = s.stepper?.cross;
        if (!f) continue;
        // All players see the exact zone. Copies share a zone and don't stack five boundaries.
        if (!echo) this.ring(f.x,f.z,1000,color,0.8);
        const rate = echo ? 45 : 110;
        const last = Math.floor(f.elapsed * rate);
        const layers = echo ? 5 : 18;
        for (let i = Math.max(0,last-layers); i <= last; i++) {
          const age = f.elapsed - i / rate;
          if (age < 0 || age > 0.18) continue;
          const seed = i + s.id * 811;
          const a = hash(seed) * Math.PI * 2, offset = (hash(seed+0.3)-0.5)*1500;
          const half = Math.sqrt(1000000-offset*offset);
          const dx = Math.cos(a), dz = Math.sin(a), px = -dz*offset, pz = dx*offset;
          const ax = f.x + px-dx*half, az = f.z+pz-dz*half;
          const bx = f.x + px+dx*half, bz = f.z+pz+dz*half;
          const k = Math.sin(Math.min(1,age/0.18)*Math.PI);
          const rising = i % 3 === 0;
          const ay = waveHeight(ax,az,this.game.renderTime)+8+(rising?hash(seed+1)*360:0);
          const by = waveHeight(bx,bz,this.game.renderTime)+8+(rising?hash(seed+2)*220:0);
          this.slash(ax,ay,az,bx,by,bz,color,k,echo?0.6:1);
          // Small parallel fractures make the cutting feel relentless without whitening the sea.
          if (!echo && quality().particles >= 0.8) {
            this.light.push(ax,ay+18,az,bx,by+18,bz,color,k*0.35,1,1);
          }
        }
      }
      for (const f of this.finishes) {
        const color = team === -1 || f.ship.team === team ? VIOLET : ENEMY;
        const k = Math.max(0,1-f.age/0.7), radius = f.radius * (0.8+f.age*1.3);
        if (!f.ship.stepper?.copy) this.ring(f.x,f.z,radius,color,k);
        for (let i=0;i<6;i++) {
          const a=i*Math.PI/6, dx=Math.cos(a)*f.radius, dz=Math.sin(a)*f.radius;
          this.slash(f.x-dx,10+f.age*100,f.z-dz,f.x+dx,10+f.age*100,f.z+dz,color,k,2.5);
        }
        // Final vertical fracture, rising out of the convergence rather than a fireball.
        this.slash(f.x,4,f.z,f.x,700+f.age*900,f.z+1,color,k,2);
      }
    }
    this.light.end(); this.dark.end();
  }
  private slash(ax:number,ay:number,az:number,bx:number,by:number,bz:number,color:Color,k:number,scale:number): void {
    this.dark.push(ax,ay,az,bx,by,bz,DARK,k*0.9,15*scale*k,8*scale*k);
    this.light.push(ax,ay+0.6,az,bx,by+0.6,bz,color,k*0.8,6*scale*k,3.2*scale*k);
    this.light.push(ax,ay+1,az,bx,by+1,bz,WHITE,k*0.8,1.2*scale*k,1.2*scale*k);
  }
  private ring(x:number,z:number,radius:number,color:Color,k:number): void {
    for (let i=0;i<96;i++) {
      const a=i*Math.PI/48,b=(i+1)*Math.PI/48;
      const ax=x+Math.sin(a)*radius,az=z+Math.cos(a)*radius,bx=x+Math.sin(b)*radius,bz=z+Math.cos(b)*radius;
      this.light.push(ax,waveHeight(ax,az,this.game.renderTime)+5,az,bx,waveHeight(bx,bz,this.game.renderTime)+5,bz,color,k,2,1.2);
    }
  }
  private flickerArea(x: number, z: number, color: Color): void {
    const line = (ax: number, az: number, bx: number, bz: number, core = false) => {
      const ay = waveHeight(ax,az,this.game.renderTime)+8;
      const by = waveHeight(bx,bz,this.game.renderTime)+8;
      // A dark under-stroke keeps the boundary legible on both sunlit and shaded water.
      this.dark.push(ax,ay,az,bx,by,bz,DARK,0.85,20,5);
      this.light.push(ax,ay+0.5,az,bx,by+0.5,bz,color,0.95,9,2.5);
      if (core) this.light.push(ax,ay+1,az,bx,by+1,bz,WHITE,0.75,2,0.8);
    };
    for (let i = 0; i < 96; i++) {
      const a = i * Math.PI / 48, b = (i+1) * Math.PI / 48;
      line(x+Math.sin(a)*FLICKER_RADIUS,z+Math.cos(a)*FLICKER_RADIUS,
        x+Math.sin(b)*FLICKER_RADIUS,z+Math.cos(b)*FLICKER_RADIUS,true);
    }
    // Inward range ticks distinguish the fixed target area from the small strike rings.
    for (let i = 0; i < 32; i++) {
      const a = i * Math.PI / 16, inner = FLICKER_RADIUS - (i % 8 === 0 ? 150 : 65);
      line(x+Math.sin(a)*inner,z+Math.cos(a)*inner,
        x+Math.sin(a)*FLICKER_RADIUS,z+Math.cos(a)*FLICKER_RADIUS);
    }
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2, b = (i+1) * Math.PI / 2;
      line(x+Math.sin(a)*45,z+Math.cos(a)*45,x+Math.sin(b)*45,z+Math.cos(b)*45);
    }
  }
  dispose(): void {
    this.off();this.finishes=[];this.heard.clear();
    this.scene.remove(this.light.mesh,this.dark.mesh); this.light.dispose();this.dark.dispose();
  }
}
