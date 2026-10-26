import { BoxGeometry, Color, Euler, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, Vector3, type Scene } from 'three';
import type { Game } from '../core/Game';
import type { Ship } from '../ships/Ship';
import type { Team } from '../core/types';
import { audio } from '../fx/Audio';
import { Ribbons } from './Projectiles';

const GOLD=new Color(0xffbd66).multiplyScalar(1.6),BLUE=new Color(0x8be9ff).multiplyScalar(2),RED=new Color(0xff4668).multiplyScalar(2),WHITE=new Color(0xf0fbff).multiplyScalar(3);
interface Shot {ship:Ship;x:number;y:number;z:number;tx:number;ty:number;tz:number;width:number;kind:'assembly'|'killbox';age:number}
const matrix=new Matrix4(),quaternion=new Quaternion(),euler=new Euler(),position=new Vector3(),scale=new Vector3();
/** All ten-module networks share two draw batches, independent of visual quality or simulation RNG. */
export class ArchitectFx {
  readonly ribbons=new Ribbons(12000,true,false);
  readonly panels:InstancedMesh;
  private shots:Shot[]=[];
  private off:(()=>void)[]=[];
  private locals:Ship[]=[];
  private heard=new Map<number,number>();
  constructor(private scene:Scene,private game:Game){
    this.ribbons.mesh.name='architect-energy-network';
    this.panels=new InstancedMesh(new BoxGeometry(1,1,1),new MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.12,depthWrite:false}),640);
    this.panels.name='architect-citadel-panels';this.panels.count=0;this.panels.frustumCulled=false;
    scene.add(this.ribbons.mesh,this.panels);
    this.off.push(game.events.on('architectShot',e=>{
      if(this.shots.length>=160)this.shots.shift();this.shots.push({...e,age:0});
      // Ten simultaneous guns are one audible volley, rather than ten competing cues.
      if(e.kind==='assembly')audio.cue('architectAssembly','impact','beam',e.x,e.y,e.z,this.locals.includes(e.ship));
    }),game.events.on('architectCommand',e=>{
      const local=this.locals.includes(e.ship),kind=e.kind;
      if(kind==='destroy'||kind==='end')return;
      audio.cue(kind==='assembly'?'architectAssembly':kind==='citadel'?'architectCitadel':kind==='killbox'?'architectKillbox':'architectDeploy','activate',kind==='citadel'?'transform':'charge',e.ship.pos.x,20,e.ship.pos.z,local);
    }));
  }
  update(dt:number,locals:Ship[]=[]):void {
    this.locals=locals;
    if(this.game.over){this.shots=[];this.heard.clear();return;}
    for(const shot of this.shots)shot.age+=dt;
    this.shots=this.shots.filter(s=>s.age<(s.kind==='assembly'?.8:.35));
    const active=new Set<number>();
    for(const s of this.game.ships){
      const u=s.architect?.ultimate;if(!s.alive||!u)continue;active.add(s.id);
      const beat=u.kind==='killbox'?u.waves:u.kind==='assembly'?Math.floor(u.elapsed*2):-1;
      if(beat>=0&&this.heard.get(s.id)!==beat){
        this.heard.set(s.id,beat);
        if(u.kind==='killbox'&&beat>0)audio.cue('architectKillbox','impact','impact',u.x,15,u.z,locals.includes(s));
      }
    }
    for(const id of this.heard.keys())if(!active.has(id))this.heard.delete(id);
  }
  prepare(team:Team|-1,heightPx:number):void {
    const r=this.ribbons;r.begin();r.material.uniforms.uViewportH.value=heightPx;this.panels.count=0;
    if(!this.game.over){
      for(const s of this.game.ships){
        const a=s.architect;if(!s.alive||!a)continue;
        const color=team===-1||team===s.team?GOLD:RED;
        for(const slot of a.slots){
          const m=slot.entity;if(!m?.alive)continue;
          if(slot.path){
            r.push(m.pos.x,m.pos.y+3,m.pos.z,slot.path.x,slot.path.y+3,slot.path.z,color,.25,3,1);
            const y=m.pos.y;r.push(m.pos.x-14,y-5,m.pos.z,m.pos.x,y-26,m.pos.z,BLUE,.8,4,2);
            r.push(m.pos.x+14,y-5,m.pos.z,m.pos.x,y-26,m.pos.z,BLUE,.8,4,2);
          }
        }
        if(a.linkUntil>this.game.time)for(const edge of a.links){
          const x=a.slots[edge.a],y=a.slots[edge.b];if(x.state!=='deployed'||y.state!=='deployed'||!x.entity?.alive||!y.entity?.alive)continue;
          const p=x.entity.pos,q=y.entity.pos;
          r.push(p.x,p.y+15,p.z,q.x,q.y+15,q.z,color,.65,5,2);
          r.push(p.x,p.y+15,p.z,q.x,q.y+15,q.z,WHITE,.5,1,1);
        }
        const u=a.ultimate;if(!u)continue;
        if(u.kind==='citadel'&&u.elapsed>=1.5){
          const modules=u.members.map(i=>a.slots[i].entity).filter((m):m is Ship=>!!m?.alive);
          for(let i=0;i<modules.length;i++){
            const p=modules[i].pos,q=modules[(i+1)%modules.length].pos;
            r.push(s.pos.x,42,s.pos.z,p.x,p.y+8,p.z,color,.6,5,2);
            r.push(p.x,p.y+8,p.z,q.x,q.y+8,q.z,BLUE,.8,3,1.5);
            r.push(p.x,p.y+88,p.z,q.x,q.y+88,q.z,color,.7,3,1.5);
            r.push(p.x,p.y+8,p.z,p.x,p.y+88,p.z,color,.8,3,1.5);
            this.panel(p.x,p.y+48,p.z,q.x,q.y+48,q.z,color);
          }
          this.ring(s.pos.x,s.pos.z,900,color,.3);
        }else if(u.kind==='assembly'){
          const heading=Math.atan2(u.aimX-s.pos.x,-(u.aimZ-s.pos.z));
          const x=s.pos.x+Math.sin(heading)*650,z=s.pos.z-Math.cos(heading)*650;
          const k=Math.max(0,Math.min(1,(u.elapsed-1.5)/2));
          r.push(s.pos.x,70,s.pos.z,x,70,z,BLUE,.3+k*.5,5+k*10,2);
          for(let i=0;i<6;i++){
            const angle=i*Math.PI/3+u.elapsed*2,rad=90*(1-k*.7);
            r.push(x+Math.cos(angle)*rad,70+Math.sin(angle)*rad,z,x,70,z,color,k*.8,3,1.5);
          }
        }else if(u.kind==='killbox'){
          this.ring(u.x,u.z,1000,color,.55);
          const warning=Math.max(0,((u.elapsed-1.5)%1-.5)*2);
          if(warning>0)for(const i of u.members){const p=a.slots[i].entity?.pos;if(!p)continue;r.push(p.x,8,p.z,u.x*2-p.x,8,u.z*2-p.z,color,warning*.6,8,2);}
        }
      }
      for(const shot of this.shots){
        const color=team===-1||shot.ship.team===team?BLUE:RED,k=1-shot.age/(shot.kind==='assembly'?.8:.35);
        r.push(shot.x,shot.y,shot.z,shot.tx,shot.ty,shot.tz,color,k*.75,shot.width*.3,shot.kind==='assembly'?8:3);
        r.push(shot.x,shot.y+1,shot.z,shot.tx,shot.ty+1,shot.tz,WHITE,k*.9,shot.width*.06,shot.kind==='assembly'?3:1);
      }
    }
    r.end();this.panels.instanceMatrix.needsUpdate=true;if(this.panels.instanceColor)this.panels.instanceColor.needsUpdate=true;
  }
  private panel(ax:number,ay:number,az:number,bx:number,by:number,bz:number,color:Color):void {
    if(this.panels.count>=640)return;
    const dx=bx-ax,dz=bz-az;position.set((ax+bx)/2,(ay+by)/2,(az+bz)/2);
    quaternion.setFromEuler(euler.set(0,-Math.atan2(dz,dx),0));scale.set(Math.max(1,Math.hypot(dx,dz)-20),80,4);
    matrix.compose(position,quaternion,scale);const i=this.panels.count++;this.panels.setMatrixAt(i,matrix);this.panels.setColorAt(i,color);
  }
  private ring(x:number,z:number,radius:number,color:Color,alpha:number):void {
    for(let i=0;i<80;i++){const a=i*Math.PI/40,b=(i+1)*Math.PI/40;this.ribbons.push(x+Math.sin(a)*radius,5,z+Math.cos(a)*radius,x+Math.sin(b)*radius,5,z+Math.cos(b)*radius,color,alpha,2,1);}
  }
  dispose():void {for(const off of this.off)off();this.shots=[];this.heard.clear();this.scene.remove(this.ribbons.mesh,this.panels);this.ribbons.dispose();this.panels.geometry.dispose();(this.panels.material as MeshBasicMaterial).dispose();}
}
