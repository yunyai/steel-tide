import {AdditiveBlending,Color,CylinderGeometry,DynamicDrawUsage,InstancedBufferAttribute,InstancedMesh,Matrix4,OctahedronGeometry,Quaternion,ShaderMaterial,SphereGeometry,TorusGeometry,Vector3,type BufferGeometry,type Scene} from 'three';
import type {Game} from '../core/Game';
import type {Ship} from '../ships/Ship';
import type {SkillSpec,Team} from '../core/types';
import {contactVisible} from '../core/Targeting';
import {waveHeight} from '../world/Waves';
import {quality} from './Quality';
import {FLEET_DETAILS} from './FleetDetails';
import {skillTreatment,type SkillTreatment} from './FleetStyle';

const vertex=`attribute vec4 tint;varying vec4 vTint;varying vec3 vP;varying vec3 vN;varying vec3 vV;void main(){vTint=tint;vP=position;vec4 mv=modelViewMatrix*instanceMatrix*vec4(position,1.);mat3 im=mat3(instanceMatrix);vec3 nn=normal/vec3(dot(im[0],im[0]),dot(im[1],im[1]),dot(im[2],im[2]));vN=normalize(normalMatrix*im*nn);vV=-mv.xyz;gl_Position=projectionMatrix*mv;}`;
const fragment=`varying vec4 vTint;varying vec3 vP;varying vec3 vN;varying vec3 vV;void main(){float rim=pow(1.-abs(dot(normalize(vN),normalize(vV))),1.7);float grain=.86+.14*sin(vP.y*48.+vP.x*24.+vP.z*31.);float a=vTint.a*(.18+.65*rim)*grain;gl_FragColor=vec4(vTint.rgb*(.75+rim*.5),a);}`;
const CAP=192,up=new Vector3(0,1,0),v=new Vector3(),q=new Quaternion(),m=new Matrix4(),scale=new Vector3(),color=new Color();
interface Pulse {ship:Ship;spec:SkillSpec;age:number;life:number;x?:number;y?:number;z?:number}
/** Four bounded, depth-tested geometry pools. Personal flourishes are rebuilt for each viewport. */
export class FleetFx{
 private pools:InstancedMesh[]=[];
 private pulses:Pulse[]=[];
 private off:(()=>void)[]=[];
 private impactAt=new Map<string,number>();
 private time=0;
 private reduced=typeof matchMedia!=='undefined'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
 private detail=quality().particles;
 constructor(private scene:Scene,private game:Game){
  for(const geo of [new TorusGeometry(1,.045,5,40),new SphereGeometry(1,14,10),new OctahedronGeometry(1),new CylinderGeometry(1,1,1,12)]){
   geo.setAttribute('tint',new InstancedBufferAttribute(new Float32Array(CAP*4),4).setUsage(DynamicDrawUsage));
   const mesh=new InstancedMesh(geo,new ShaderMaterial({vertexShader:vertex,fragmentShader:fragment,transparent:true,depthWrite:false,blending:AdditiveBlending}),CAP);mesh.count=0;mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(DynamicDrawUsage);scene.add(mesh);this.pools.push(mesh);
  }
  this.off.push(game.events.on('skill',e=>{
   const spec=e.ship.skills[e.index]?.spec;if(!spec||!FLEET_DETAILS[e.ship.spec.id])return;
   this.enqueue({ship:e.ship,spec,age:0,life:spec.ult?1.25:.7});
  }),game.events.on('skillHit',e=>{
   if(!FLEET_DETAILS[e.attacker.spec.id])return;
   const key=`${e.attacker.id}:${e.ship.id}`,last=this.impactAt.get(key)??-10;if(this.time-last<.16)return;this.impactAt.set(key,this.time);
   this.enqueue({ship:e.ship,spec:e.skill,age:0,life:.48,x:e.ship.pos.x,y:e.ship.pos.y+e.ship.spec.freeboard,z:e.ship.pos.z});
  }),game.events.on('respawn',e=>this.clearShip(e.ship)),game.events.on('shipChanged',e=>this.clearShip(e.ship)),game.events.on('gameOver',()=>{this.pulses=[];this.impactAt.clear();}));
 }
 private clearShip(s:Ship){this.pulses=this.pulses.filter(p=>p.ship!==s);}
 private enqueue(p:Pulse){this.pulses.push(p);if(this.pulses.length>96)this.pulses.splice(0,this.pulses.length-96);}
 get count(){return this.pools.reduce((n,p)=>n+p.count,0);}
 update(dt:number){this.time+=dt;for(const p of this.pulses)p.age+=dt;this.pulses=this.pulses.filter(p=>p.age<p.life);for(const [k,t] of this.impactAt)if(this.time-t>2)this.impactAt.delete(k);}
 private visible(s:Ship,team:Team|-1){return s.alive&&!s.withdrawn&&!s.mods.banished&&(team===-1||contactVisible(s,team));}
 private put(pool:number,x:number,y:number,z:number,sx:number,sy:number,sz:number,c:number,a:number,rotation:Quaternion=q.identity()){
  const mesh=this.pools[pool];if(mesh.count>=CAP||a<.005||Math.min(sx,sy,sz)<=0)return;const i=mesh.count++;m.compose(v.set(x,y,z),rotation,scale.set(sx,sy,sz));mesh.setMatrixAt(i,m);color.setHex(c);(mesh.geometry.getAttribute('tint') as InstancedBufferAttribute).setXYZW(i,color.r,color.g,color.b,a);
 }
 private ring(x:number,y:number,z:number,r:number,c:number,a:number,tilt=Math.PI/2){q.setFromAxisAngle(new Vector3(1,0,0),tilt);this.put(0,x,y,z,r,r,r,c,a,q);}
 private tube(ax:number,ay:number,az:number,bx:number,by:number,bz:number,r:number,c:number,a:number){const dir=new Vector3(bx-ax,by-ay,bz-az),len=dir.length();if(len<.01)return;q.setFromUnitVectors(up,dir.divideScalar(len));this.put(3,(ax+bx)/2,(ay+by)/2,(az+bz)/2,r,len,r,c,a,q);}
 prepare(team:Team|-1){
  for(const p of this.pools)p.count=0;
  if(!this.game.over){
   // Local hulls first; a crowded scene cannot starve the player's activation.
   const pulses=[...this.pulses].sort((a,b)=>Number(b.ship.humanIndex>=0)-Number(a.ship.humanIndex>=0));
   for(const p of pulses){if(!this.visible(p.ship,team))continue;this.pulse(p);}
   for(const s of this.game.ships){
    if(!FLEET_DETAILS[s.spec.id]||!this.visible(s,team))continue;
    for(const st of s.skills){if(!st.active)continue;const kind=skillTreatment(st.spec);
     if(['ward','repair','summon','scan'].includes(kind))this.sustain(s,st.spec,kind);
    }
   }
   for(const b of this.game.beams.beams){
    if(!b.alive||!FLEET_DETAILS[b.owner.spec.id]||!this.visible(b.owner,team))continue;
    const charging=b.age<b.charge,k=charging?b.age/Math.max(.01,b.charge):1,c=b.skill.accent,w=Math.max(3,b.width);
    const ax=b.mode==='orbital'?b.x1:b.x0,ay=b.mode==='orbital'?2400:b.y0,az=b.mode==='orbital'?b.z1:b.z0;
    if(charging){this.put(1,ax,ay,az,w*(.2+k*.45),w*(.2+k*.45),w*(.2+k*.45),c,.65*k);}
    else{
     this.tube(ax,ay,az,b.x1,b.y1,b.z1,w*.26,c,.6);this.tube(ax,ay,az,b.x1,b.y1,b.z1,w*.07,0xeefaff,.85);
     // Moving collars give long beams a directed pulse without a screen-facing card.
     const dir=new Vector3(b.x1-ax,b.y1-ay,b.z1-az);if(dir.lengthSq()>1){q.setFromUnitVectors(new Vector3(0,0,1),dir.clone().normalize());
      for(let j=0;j<3;j++){const t=this.reduced?(j+.5)/3:((b.age-b.charge)*1.3+j/3)%1;this.put(0,ax+dir.x*t,ay+dir.y*t,az+dir.z*t,w*.42,w*.42,w*.42,c,.35,q);}
     }
    }
   }
  }
  for(const p of this.pools){p.instanceMatrix.needsUpdate=true;(p.geometry.getAttribute('tint') as InstancedBufferAttribute).needsUpdate=true;}
 }
 private pulse(p:Pulse){
  const s=p.ship,impact=p.x!==undefined,t=p.age/p.life,ease=1-Math.pow(1-t,3),fade=Math.sin(Math.PI*Math.min(1,t*2))*(1-t)+Math.sin(Math.PI*t)*.3;
  const x=p.x??s.renderPos.x,z=p.z??s.renderPos.z,y=p.y??(s.renderPos.y+s.spec.freeboard+8),c=p.spec.accent;
  const r=impact?35:(s.spec.cls==='TT'?s.spec.beam*1.1:Math.max(18,s.spec.beam*.8)),kind=impact?'blast':skillTreatment(p.spec),motion=this.reduced?.45:ease;
  if(kind==='cut'){
   const h=s.renderHeading,fx=Math.sin(h),fz=-Math.cos(h),rightX=Math.cos(h),rightZ=Math.sin(h);
   for(let i=0;i<3;i++){const a=-1.2+i*.8+motion*.7;const dx=rightX*Math.cos(a)+fx*Math.sin(a),dz=rightZ*Math.cos(a)+fz*Math.sin(a);q.setFromAxisAngle(up,-h+a);this.put(2,x+dx*r,y+10+i*6,z+dz*r,r*.9,3,r*.1,c,fade*.8,q);}
  }else if(kind==='battery'){
   for(const turret of s.spec.main?.turrets??[]){const pos=s.localToWorld(turret.x,0,turret.z??0);this.put(1,pos.x,y+turret.y,pos.z,8+motion*8,4,8+motion*8,0xffd59c,fade*.5);}
  }else if(kind==='energy'||kind==='storm'){
   const count=p.spec.ult?6:3;
   for(let i=0;i<count;i++){const a=i*Math.PI*2/count+(this.reduced?0:t*.7),rr=r*(1-motion*.6);this.put(2,x+Math.cos(a)*rr,y+12+Math.sin(a*2)*r*.2,z+Math.sin(a)*rr,r*.11,r*.35,r*.11,c,fade*.9);}
   if(kind==='energy')this.put(1,x,y+12,z,r*.35*motion,r*.35*motion,r*.35*motion,c,fade*.6);
  }else if(kind==='wake'){
   const h=s.renderHeading;for(const side of [-1,1]){const dx=Math.cos(h)*side,dz=Math.sin(h)*side;this.tube(x+dx*r,y,z+dz*r,x+dx*r-Math.sin(h)*s.spec.length*.4*motion,y-3,z+dz*r+Math.cos(h)*s.spec.length*.4*motion,2,c,fade*.6);}
  }else if(kind==='ward'||kind==='repair'||kind==='scan'||kind==='summon'){
   this.ring(x,y+motion*25,z,r*(.65+motion*.4),kind==='repair'?0x80e9bd:c,fade*.65);
   if(p.spec.ult)this.signature(s,p.spec,r,fade,motion);
  }else{
   this.put(1,x,y,z,r*(.2+motion),r*(.1+motion*.65),r*(.2+motion),c,fade*.65);
   for(let i=0;i<(this.detail<1?4:8);i++){const a=i*2.39996;this.put(2,x+Math.cos(a)*r*motion*1.8,y+Math.sin(Math.PI*t)*r*.5,z+Math.sin(a)*r*motion*1.8,2,r*.18,2,c,fade*.65);}
  }
  if(p.spec.ult&&!impact&&!['ward','repair','scan','summon'].includes(kind))this.signature(s,p.spec,r,fade,motion);
  // An expanding low water crest only where the event actually intersects open water.
  const water=waveHeight(x,z,this.game.renderTime);
  if((impact||p.spec.ult)&&Math.abs(y-water)<80&&this.game.map.heightAt(x,z)<water-2){
   const rr=r*(1+motion*2);let clear=true;for(let i=0;i<12;i++){const a=i*Math.PI/6;if(this.game.map.heightAt(x+Math.cos(a)*rr,z+Math.sin(a)*rr)>water-2)clear=false;}
   if(clear)this.ring(x,water+2,z,rr,0x9dcbd2,fade*.28);
  }
 }
 private signature(s:Ship,spec:SkillSpec,r:number,a:number,t:number){
  const d=FLEET_DETAILS[s.spec.id],n=Math.min(8,d.count),x=s.renderPos.x,y=s.renderPos.y+s.spec.freeboard+15,z=s.renderPos.z;
  // Echo the ship's construction: paired blades, orbital coils, or rising ribs/crystals.
  for(let i=0;i<n;i++){const angle=i*Math.PI*2/n+(this.reduced?0:t*.4),rx=Math.cos(angle)*r*1.3,rz=Math.sin(angle)*r*1.3;
   if(['coil','solar','drum','depth'].includes(d.motif))this.ring(x+rx,y+20+t*25,z+rz,r*.23,spec.accent,a*.4,.4+angle);
   else{q.setFromAxisAngle(up,angle);this.put(2,x+rx,y+t*r*.35,z+rz,r*.13,r*(d.motif==='blade'?.6:.28),r*.07,spec.accent,a*.5,q);}
  }
 }
 private sustain(s:Ship,spec:SkillSpec,kind:SkillTreatment){
  const r=Math.max(16,s.spec.beam*.7),c=kind==='repair'?0x80e9bd:spec.accent,x=s.renderPos.x,y=s.renderPos.y+s.spec.freeboard+10,z=s.renderPos.z,t=this.reduced?0:this.time*.5;
  for(const side of [-1,1]){const a=t+side*Math.PI;this.put(2,x+Math.cos(a)*r,y+6,z+Math.sin(a)*r,3,kind==='repair'?8:4,3,c,.35);}
 }
 dispose(){for(const f of this.off)f();this.pulses=[];this.impactAt.clear();for(const m of this.pools){this.scene.remove(m);m.dispose();(m.geometry as BufferGeometry).dispose();(m.material as ShaderMaterial).dispose();}}
}
