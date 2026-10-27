import { Color, DoubleSide, Euler, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3, type Scene } from 'three';
import type { Game } from '../core/Game';
import type { Ship } from '../ships/Ship';
import type { Team } from '../core/types';
import { audio } from '../fx/Audio';
import { Ribbons } from './Projectiles';
import { waveHeight } from '../world/Waves';
import { ASSEMBLY_HEIGHT, ASSEMBLY_MUZZLE, assemblyWorld, reducedMotion, satellitePose, smooth } from './ArchitectPose';

const GOLD=new Color(0xffbd66).multiplyScalar(1.6),BLUE=new Color(0x8be9ff).multiplyScalar(2),RED=new Color(0xff4668).multiplyScalar(2),WHITE=new Color(0xf0fbff).multiplyScalar(3);
const ASSEMBLY_BEAM_LIFE=1.1;
interface Shot {ship:Ship;x:number;y:number;z:number;tx:number;ty:number;tz:number;width:number;kind:'assembly'|'killbox';age:number}
const matrix=new Matrix4(),quaternion=new Quaternion(),euler=new Euler(),position=new Vector3(),scale=new Vector3();
const muzzle=new Vector3(),core=new Vector3(),satellite=new Vector3();
/** All ten-module networks share two draw batches, independent of visual quality or simulation RNG. */
export class ArchitectFx {
  readonly ribbons=new Ribbons(12000,true,false);
  readonly panels:InstancedMesh;
  private shots:Shot[]=[];
  private off:(()=>void)[]=[];
  private locals:Ship[]=[];
  private heard=new Map<number,number>();
  private heights=new InstancedBufferAttribute(new Float32Array(640*4),4);
  private clock={value:0};
  private reduce=reducedMotion();
  constructor(private scene:Scene,private game:Game){
    this.ribbons.mesh.name='architect-energy-network';
    const geometry=new PlaneGeometry(1,1),material=new MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.13,depthWrite:false,side:DoubleSide});
    geometry.setAttribute('iHeights',this.heights);
    material.onBeforeCompile=shader=>{
      shader.uniforms.uArchTime=this.clock;
      shader.vertexShader='attribute vec4 iHeights; varying vec2 vPanel;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
        vPanel=position.xy+0.5;
        transformed.y=mix(mix(iHeights.x,iHeights.y,vPanel.x),mix(iHeights.z,iHeights.w,vPanel.x),vPanel.y);`);
      shader.fragmentShader='uniform float uArchTime; varying vec2 vPanel;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
        float seam=pow(abs(vPanel.x-0.5)*2.0,22.0);
        float scan=pow(0.5+0.5*sin(vPanel.y*45.0+uArchTime*1.4),16.0);
        diffuseColor.a*=0.35+seam*0.9+scan*0.32;`);
    };
    material.customProgramCacheKey=()=> 'architect-water-walls';
    this.panels=new InstancedMesh(geometry,material,640);
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
    this.shots=this.shots.filter(s=>s.age<(s.kind==='assembly'?ASSEMBLY_BEAM_LIFE:.35));
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
    this.clock.value=this.reduce?0:this.game.time;
    if(!this.game.over){
      for(const s of this.game.ships){
        const a=s.architect;if(!s.alive||s.withdrawn||!a)continue;
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
          const modules=u.members.map(i=>a.slots[i]).filter(slot=>slot.state==='citadel'&&slot.entity?.alive).map(slot=>slot.entity!);
          for(let i=0;i<modules.length;i++){
            const p=modules[i].renderPos,q=modules[(i+1)%modules.length].renderPos;
            r.push(s.renderPos.x,s.renderPos.y+42,s.renderPos.z,p.x,p.y+8,p.z,color,.35,4,1.5);
            if(modules.length<2||(modules.length===2&&i===1))continue;
            const bottom=this.surface(p.x,p.z),endBottom=this.surface(q.x,q.z),top=p.y+70,endTop=q.y+70;
            r.push(p.x,p.y+8,p.z,q.x,q.y+8,q.z,color,.8,7,2);
            r.push(p.x,top,p.z,q.x,endTop,q.z,color,.8,4,1.5);
            r.push(p.x,bottom,p.z,p.x,top,p.z,color,.75,4,1.5);
            r.push(q.x,endBottom,q.z,q.x,endTop,q.z,color,.75,4,1.5);
            // The face always reaches the sea; opaque terrain masks it locally. Raising a
            // whole endpoint to land height would leave a triangular gap over adjacent water.
            this.panel(p.x,waveHeight(p.x,p.z,this.game.time)+2,top,p.z,q.x,waveHeight(q.x,q.z,this.game.time)+2,endTop,q.z,color);
            for(let j=0;j<12;j++){
              const f=j/12,n=(j+1)/12,x=p.x+(q.x-p.x)*f,z=p.z+(q.z-p.z)*f,nx=p.x+(q.x-p.x)*n,nz=p.z+(q.z-p.z)*n;
              r.push(x,this.surface(x,z),z,nx,this.surface(nx,nz),nz,color,.8,5,2);
            }
            // Suspended braces make the floating perimeter read as a built structure.
            for(const f of [.25,.5,.75]){
              const x=p.x+(q.x-p.x)*f,z=p.z+(q.z-p.z)*f,y=top+(endTop-top)*f;
              r.push(x,y,z,x,y-35,z,color,.35,2,1);
            }
          }
          if(modules.length>=2)this.ring(s.renderPos.x,s.renderPos.z,900,color,.3);
        }else if(u.kind==='assembly'){
          const k=smooth((u.elapsed-1.5)/2);
          if(u.elapsed>=1.5){
            assemblyWorld(s,-45,0,0,core);assemblyWorld(s,ASSEMBLY_MUZZLE,0,0,muzzle);
            r.push(core.x,core.y,core.z,muzzle.x,muzzle.y,muzzle.z,BLUE,.3+k*.5,4+k*9,2);
            for(const i of u.members){
              if(a.slots[i].state!=='assembling')continue;
              satellitePose(s,i,this.reduce,satellite);
              assemblyWorld(s,satellite.x,satellite.y+15,satellite.z,satellite);
              r.push(satellite.x,satellite.y,satellite.z,core.x,core.y,core.z,color,.3+k*.5,2+k*2,1.3);
              // Charges run toward the breech, with a stationary alternative for reduced motion.
              const f=this.reduce?.5:(u.elapsed*1.3+i*.1)%1;
              r.push(satellite.x+(core.x-satellite.x)*f,satellite.y+(core.y-satellite.y)*f,satellite.z+(core.z-satellite.z)*f,core.x,core.y,core.z,WHITE,k*.35,1,1);
            }
            this.focusRing(s,ASSEMBLY_MUZZLE,42-k*12,color,.65);
            this.focusRing(s,0,62+k*10,color,.35);
          }
        }else if(u.kind==='killbox'){
          this.ring(u.x,u.z,1000,color,.55);
          const warning=Math.max(0,((u.elapsed-1.5)%1-.5)*2);
          if(warning>0)for(const i of u.members){const p=a.slots[i].entity?.pos;if(!p)continue;r.push(p.x,8,p.z,u.x*2-p.x,8,u.z*2-p.z,color,warning*.6,8,2);}
        }
      }
      for(const shot of this.shots){
        const color=team===-1||shot.ship.team===team?BLUE:RED;
        // Hold the full blast briefly, then leave a readable afterglow.
        const k=shot.kind==='assembly'?1-smooth((shot.age-.18)/(ASSEMBLY_BEAM_LIFE-.18)):1-shot.age/.35;
        const sx=shot.x,sy=shot.y,sz=shot.z;
        if(shot.kind==='assembly'){
          // Keep the presentation level with the raised cannon. The event still supplies
          // the obstacle-clipped range; its combat trajectory and damage stay in simulation.
          const h=Math.atan2(shot.tx-shot.x,-(shot.tz-shot.z));
          const x=shot.x+Math.sin(h)*ASSEMBLY_MUZZLE,z=shot.z-Math.cos(h)*ASSEMBLY_MUZZLE,y=shot.y-24+ASSEMBLY_HEIGHT;
          const distance=Math.hypot(shot.tx-shot.x,shot.tz-shot.z);
          if(distance>ASSEMBLY_MUZZLE)this.assemblyBeam(x,y,z,shot.tx,y,shot.tz,color,k,shot.width);
          const flash=1-smooth(shot.age/.42);
          this.shockRing(x,y,z,h,this.reduce?80:55+shot.age*240,color,flash*.85,8);
          this.shockRing(x,y,z,h,this.reduce?55:35+shot.age*130,WHITE,flash*.85,5);
          for(let i=0;i<8;i++){
            const a=i*Math.PI/4,rad=(this.reduce?90:130+shot.age*220)*flash;
            r.push(x,y,z,x+Math.cos(h)*Math.cos(a)*rad,y+Math.sin(a)*rad,z+Math.sin(h)*Math.cos(a)*rad,color,flash*.65,8,3);
          }
          if(!this.reduce&&distance>ASSEMBLY_MUZZLE)for(let i=0;i<3;i++){
            const travel=(shot.age-i*.06)/.32;if(travel<=0||travel>=1)continue;
            this.shockRing(x+(shot.tx-x)*travel,y,z+(shot.tz-z)*travel,h,65+travel*95,color,(1-travel)*.65,5);
          }
        }else{
          r.push(sx,sy,sz,shot.tx,shot.ty,shot.tz,color,k*.75,shot.width*.3,3);
          r.push(sx,sy+1,sz,shot.tx,shot.ty+1,shot.tz,WHITE,k*.9,shot.width*.06,1);
        }
      }
    }
    r.end();this.heights.needsUpdate=true;this.panels.instanceMatrix.needsUpdate=true;if(this.panels.instanceColor)this.panels.instanceColor.needsUpdate=true;
  }
  private panel(ax:number,bottomA:number,topA:number,az:number,bx:number,bottomB:number,topB:number,bz:number,color:Color):void {
    if(this.panels.count>=640)return;
    const dx=bx-ax,dz=bz-az;position.set((ax+bx)/2,0,(az+bz)/2);
    quaternion.setFromEuler(euler.set(0,-Math.atan2(dz,dx),0));scale.set(Math.max(1,Math.hypot(dx,dz)),1,1);
    matrix.compose(position,quaternion,scale);const i=this.panels.count++;this.panels.setMatrixAt(i,matrix);this.panels.setColorAt(i,color);
    this.heights.setXYZW(i,bottomA,bottomB,Math.max(bottomA,topA),Math.max(bottomB,topB));
  }
  private surface(x:number,z:number):number {return Math.max(waveHeight(x,z,this.game.time)+2,this.game.map.heightAt(x,z)+1);}
  private assemblyBeam(ax:number,ay:number,az:number,bx:number,by:number,bz:number,color:Color,k:number,width:number):void {
    // Bright body matches the attack's width; only its soft glow extends beyond it.
    const r=this.ribbons;
    r.push(ax,ay,az,bx,by,bz,color,k*.18,width*1.2,14);
    r.push(ax,ay,az,bx,by,bz,color,k*.95,width*.5,10);
    r.push(ax,ay,az,bx,by,bz,WHITE,k,width*.18,5);
    r.push(ax,ay,az,bx,by,bz,WHITE,k,width*.045,2);
  }
  private shockRing(x:number,y:number,z:number,h:number,radius:number,color:Color,alpha:number,width:number):void {
    for(let i=0;i<24;i++){
      const a=i*Math.PI/12,b=(i+1)*Math.PI/12;
      this.ribbons.push(x+Math.cos(h)*Math.cos(a)*radius,y+Math.sin(a)*radius,z+Math.sin(h)*Math.cos(a)*radius,x+Math.cos(h)*Math.cos(b)*radius,y+Math.sin(b)*radius,z+Math.sin(h)*Math.cos(b)*radius,color,alpha,width,2);
    }
  }
  private focusRing(s:Ship,x:number,radius:number,color:Color,alpha:number):void {
    for(let i=0;i<32;i++){
      const a=i*Math.PI/16,b=(i+1)*Math.PI/16;
      assemblyWorld(s,x,Math.sin(a)*radius,Math.cos(a)*radius,core);
      assemblyWorld(s,x,Math.sin(b)*radius,Math.cos(b)*radius,muzzle);
      this.ribbons.push(core.x,core.y,core.z,muzzle.x,muzzle.y,muzzle.z,color,alpha,2,1.3);
    }
  }
  private ring(x:number,z:number,radius:number,color:Color,alpha:number):void {
    for(let i=0;i<80;i++){const a=i*Math.PI/40,b=(i+1)*Math.PI/40;this.ribbons.push(x+Math.sin(a)*radius,5,z+Math.cos(a)*radius,x+Math.sin(b)*radius,5,z+Math.cos(b)*radius,color,alpha,2,1);}
  }
  dispose():void {for(const off of this.off)off();this.shots=[];this.heard.clear();this.scene.remove(this.ribbons.mesh,this.panels);this.ribbons.dispose();this.panels.geometry.dispose();(this.panels.material as MeshBasicMaterial).dispose();}
}
