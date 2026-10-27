import { Color, type Scene } from 'three';
import type { Game } from '../core/Game';
import { contactVisible } from '../core/Targeting';
import type { Ship } from '../ships/Ship';
import type { Team } from '../core/types';
import { audio } from '../fx/Audio';
import { waveHeight } from '../world/Waves';
import { FLICKER_RADIUS } from '../skills/misc/StepperRuntime';
import { reducedMotion, smooth } from './ArchitectPose';
import { stepperSlashLayout } from './StepperSlashLayout';
import { StepperSpatial } from './StepperSpatial';
import type { SpatialDistortion } from './SpatialDistortion';
import { Ribbons } from './Projectiles';

const DARK = new Color(0x100b22), WHITE = new Color(0xf9f2ff).multiplyScalar(3);
const VIOLET = new Color(0xad74ff).multiplyScalar(2), ENEMY = new Color(0xff476e).multiplyScalar(2);
interface Sweep { ship:Ship; ax:number;az:number;bx:number;bz:number;cx:number;cz:number;age:number;seed:number }
interface Finish { ship: Ship; x:number; z:number; radius:number; age:number; paths:Sweep[] }

/** Stepper's ultimate boundaries and slash storm in two fixed-size batches, independent of simulation RNG. */
export class CrossStepFx {
  readonly spatial:StepperSpatial;
  readonly light = new Ribbons(6000, true, false);
  readonly dark = new Ribbons(3000, false, false);
  private finishes: Finish[] = [];
  private heard = new Map<number, number>();
  private off: (() => void)[]=[];
  private sweeps:Sweep[]=[];
  private paths=new Map<number,Sweep[]>();
  readonly distortions:SpatialDistortion[]=[];
  private local: Ship[] = [];
  private reduce = reducedMotion();
  constructor(private scene: Scene, private game: Game) {
    this.spatial=new StepperSpatial(scene,'cross-step');
    this.light.mesh.name = 'cross-step-light';
    this.dark.mesh.name = 'cross-step-fractures';
    this.dark.mesh.renderOrder = 5;
    scene.add(this.dark.mesh, this.light.mesh);
    this.off.push(game.events.on('crossStep', e => {
      if (e.phase !== 'finish') return;
      if (this.finishes.length >= 12) this.finishes.shift();
      this.finishes.push({ ...e, age:0,paths:Array.from({length:6},(_,i)=>{const n=48+i*2,p=stepperSlashLayout(n);return{ship:e.ship,ax:e.x+p.ax,az:e.z+p.az,bx:e.x+p.bx,bz:e.z+p.bz,cx:e.x+p.cx,cz:e.z+p.cz,age:0,seed:1000+n};}) });this.paths.delete(e.ship.id);
      if (!e.ship.stepper?.copy) audio.cue('crossStep','end','impact',e.x,20,e.z,this.local.includes(e.ship));
    }),game.events.on('blink',e=>{
      const f=e.ship.stepper?.cross;if(!f)return;
      const p:Sweep={ship:e.ship,ax:e.fromX,az:e.fromZ,bx:e.ship.pos.x,bz:e.ship.pos.z,cx:f.x,cz:f.z,age:0,seed:f.jumps};
      // Project the departure onto the actual attack boundary if this is the initial entry jump.
      const d=Math.hypot(p.ax-f.x,p.az-f.z);if(d>1000){p.ax=f.x+(p.ax-f.x)*1000/d;p.az=f.z+(p.az-f.z)*1000/d;}
      this.sweeps.push(p);if(this.sweeps.length>96)this.sweeps.shift();
      const history=this.paths.get(e.ship.id)??[];history.push(p);if(history.length>10)history.shift();this.paths.set(e.ship.id,history);
    }),game.events.on('respawn',e=>this.clearShip(e.ship)),game.events.on('shipChanged',e=>this.clearShip(e.old)));
  }
  private clearShip(s:Ship):void{this.sweeps=this.sweeps.filter(p=>p.ship!==s);this.finishes=this.finishes.filter(p=>p.ship!==s);this.paths.delete(s.id);}
  update(dt: number, local: Ship[] = []): void {
    this.local = local;
    if (this.game.over) { this.finishes = [];this.sweeps=[];this.paths.clear();this.distortions.length=0; this.heard.clear(); return; }
    for(const p of this.sweeps)p.age+=dt;
    this.sweeps=this.sweeps.filter(p=>p.age<.6&&p.ship.alive&&!p.ship.withdrawn);
    for(const [id,paths]of this.paths)if(!paths[0]?.ship.alive||!paths[0]?.ship.stepper?.cross)this.paths.delete(id);
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
    this.light.begin(); this.dark.begin(); this.spatial.begin();this.distortions.length=0;
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
        // Damage cuts fill the complete zone independently of the random ship landing positions.
        if(!echo){
          const last=Math.min(59,Math.floor(f.elapsed*20)-1);
          for(let i=Math.max(0,last-4);i<=last;i++){
            const age=(f.elapsed-(i+1)*.05)/.23;if(age<0||age>=1)continue;
            const p=stepperSlashLayout(i),lift=45+(i%3)*75;
            this.spatial.arc(f.x+p.ax,25,f.z+p.az,f.x+p.cx,lift+100,f.z+p.cz,f.x+p.bx,35,f.z+p.bz,210+(i%3)*35,this.reduce?.3:age,color,1000+i,.85*(this.reduce?1-smooth((age-.4)/.6):1),i%2?.75:-.8);
          }
        }
        // All players see the exact zone. Copies share a zone and don't stack five boundaries.
        if (!echo) {
          this.ring(f.x,f.z,1000,color,0.8);
          this.fracturedDome(s,f.x,f.z,f.elapsed,color,team);
        }
      }
      for(const p of this.sweeps){
        if(!this.visible(p.ship,team))continue;
        const echo=!!p.ship.stepper?.copy,color=team===-1||p.ship.team===team?VIOLET:ENEMY;
        const age=p.age/.35;if(age>=0&&age<1)this.sweep(p,2,age,color,echo?.045:.13);
      }
      for (const f of this.finishes) {
        const color = team === -1 || f.ship.team === team ? VIOLET : ENEMY;
        const k = Math.max(0,1-f.age/0.7), radius = f.radius * (0.8+f.age*1.3);
        if (!f.ship.stepper?.copy) this.ring(f.x,f.z,radius,color,k);
        const echo=!!f.ship.stepper?.copy;
        const paths=f.paths.slice(echo?-2:-6);
        for(const p of paths){
          const collapse=this.reduce?.72:Math.max(.08,1-smooth(f.age/.24));
          const path={...p,ax:f.x+(p.ax-f.x)*collapse,az:f.z+(p.az-f.z)*collapse,bx:f.x+(p.bx-f.x)*collapse,bz:f.z+(p.bz-f.z)*collapse,cx:f.x+(p.cx-f.x)*collapse,cz:f.z+(p.cz-f.z)*collapse};
          this.sweep(path,2,.3,color,k*(echo?.22:.85));
        }
        if(!echo){
          this.spatial.tear(f.x,100,f.z,.5,220,220,f.age/.7,color,3,.85);
          if(!this.reduce&&(team===-1||contactVisible(f.ship,team)))this.distortions.push({x:f.x,y:80,z:f.z,radius:650,strength:k,priority:this.local.includes(f.ship)?4:1});
          for(let i=0;i<24;i++){
            const p=paths[i%Math.max(1,paths.length)],a=p?Math.atan2(p.bz-f.z,p.bx-f.x):i*2.39996;
            const r=this.reduce?280:100+smooth(f.age/.7)*750;
            this.spatial.shard(f.x+Math.cos(a)*r,30+(i%4)*25+Math.sin(f.age*Math.PI/.7)*85,f.z+Math.sin(a)*r,a+(this.reduce?0:f.age*2),12*k+2,3,color,k*.65);
          }
        }
      }
    }
    this.light.end(); this.dark.end(); this.spatial.end();
  }
  /** Fragments and torn surfaces describe the broken volume; broad curved blades carry the attack. */
  /** Curves inherit the real departure, arrival and center; sub-cuts share one flowing stroke. */
  private sweep(p:Sweep,index:number,age:number,color:Color,opacity:number):void{
    const dx=p.bx-p.ax,dz=p.bz-p.az,len=Math.max(1,Math.hypot(dx,dz)),offset=(index-2.5)*85;
    const controlX=p.cx-dz/len*offset,controlZ=p.cz+dx/len*offset;
    this.spatial.arc(p.ax,30,p.az,controlX,150+index*35,controlZ,p.bx,35,p.bz,170+index*12,this.reduce?.3:age,color,p.seed,opacity*(this.reduce?1-smooth((age-.4)/.6):1),index%2?.8:-.6);
  }

  private visible(ship:Ship,team:Team|-1):boolean{return ship.alive&&!ship.withdrawn&&!ship.mods.banished&&(team===-1||contactVisible(ship,team));}
  private fracturedDome(ship:Ship,x:number,z:number,elapsed:number,color:Color,team:Team|-1):void {
    if(!this.visible(ship,team))return;
    const history=this.paths.get(ship.id)??[],collapse=this.reduce?0:smooth((elapsed-2.5)/.5);
    for(let i=0;i<history.length;i++){
      const p=history[i],k=1-collapse*.8,px=x+(p.bx-x)*k,pz=z+(p.bz-z)*k;
      this.spatial.shard(px,45+(i%3)*25,pz,p.seed+(this.reduce?0:elapsed*.2),12,3,color,.6);
      if(i>=history.length-3)this.sweep(p,2,.3,color,.05*(1-collapse));
    }
    if(!this.reduce&&(team===-1||contactVisible(ship,team)))this.distortions.push({x,y:40,z,radius:500,strength:smooth((elapsed-2.3)/.7)*.5,priority:this.local.includes(ship)?3:1});
  }
  private ring(x:number,z:number,radius:number,color:Color,k:number): void {
    for (let i=0;i<96;i++) {
      const a=i*Math.PI/48,b=(i+1)*Math.PI/48;
      const ax=x+Math.sin(a)*radius,az=z+Math.cos(a)*radius,bx=x+Math.sin(b)*radius,bz=z+Math.cos(b)*radius;
      const ay=waveHeight(ax,az,this.game.renderTime)+5,by=waveHeight(bx,bz,this.game.renderTime)+5;
      this.dark.push(ax,ay,az,bx,by,bz,DARK,k*.7,8,2.5);
      this.light.push(ax,ay+.3,az,bx,by+.3,bz,color,k,3,1.4);
      this.light.push(ax,ay+.5,az,bx,by+.5,bz,WHITE,k*.45,.7,.65);
    }
  }
  private flickerArea(x: number, z: number, color: Color): void {
    const line = (ax: number, az: number, bx: number, bz: number, core = false) => {
      const ay = waveHeight(ax,az,this.game.renderTime)+8;
      const by = waveHeight(bx,bz,this.game.renderTime)+8;
      // A dark under-stroke keeps the boundary legible on both sunlit and shaded water.
      this.dark.push(ax,ay,az,bx,by,bz,DARK,0.85,20,5);
      this.light.push(ax,ay+0.5,az,bx,by+0.5,bz,color,0.65,6,1.8);
      if (core) this.light.push(ax,ay+1,az,bx,by+1,bz,WHITE,0.45,1.2,0.6);
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
    this.off.forEach(f=>f());this.sweeps=[];this.paths.clear();this.distortions.length=0;this.finishes=[];this.heard.clear();
    this.scene.remove(this.light.mesh,this.dark.mesh); this.light.dispose();this.dark.dispose();this.spatial.dispose();
  }
}
