import { ARCHETYPES, type ArchitectType } from '../data/architectLoadout';
import { AdditiveBlending, Color, CylinderGeometry, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, OctahedronGeometry, Quaternion, ShaderMaterial, SphereGeometry, TorusGeometry, Vector3, type Scene } from 'three';
import type { Game } from '../core/Game';
import type { Ship } from '../ships/Ship';
import type { Team } from '../core/types';
import { contactVisible } from '../core/Targeting';
import { ELEMENT_STYLE, type ElementEvent } from '../skills/misc/ArchitectElements';
import { audio } from '../fx/Audio';
import { reducedMotion } from './ArchitectPose';
import { quality } from './Quality';
const vertex=`attribute vec4 tint;varying vec4 vTint;varying vec3 vNormal;varying vec3 vEye;void main(){vTint=tint;mat3 im=mat3(instanceMatrix);vec3 n=normal/vec3(dot(im[0],im[0]),dot(im[1],im[1]),dot(im[2],im[2]));vec4 mv=modelViewMatrix*instanceMatrix*vec4(position,1.);vNormal=normalize(normalMatrix*im*n);vEye=-mv.xyz;gl_Position=projectionMatrix*mv;}`;
const fragment=`varying vec4 vTint;varying vec3 vNormal;varying vec3 vEye;void main(){float rim=pow(1.-abs(dot(normalize(vNormal),normalize(vEye))),1.5);gl_FragColor=vec4(vTint.rgb*(.8+rim*.8),vTint.a*(.25+rim*.65));}`;
const CAP=256,mat=new Matrix4(),pos=new Vector3(),scale=new Vector3(),q=new Quaternion(),color=new Color(),up=new Vector3(0,1,0),axis=new Vector3(0,0,1);
interface Pulse {e:ElementEvent;age:number;life:number}
const elementClips={furnace:['blast-shock','blast-heavy'],cryo:['ward-rise','cut-light'],storm:['arcane-charge','energy-pulse'],gravity:['phase-arrival','blast-heavy'],prism:['energy-charge','energy-heavy']} as const;
const specialistClips:Partial<Record<ArchitectType,readonly [string,string]>>={
 sentinel:['sensor-ping','sensor-ping'],abyss:['torpedo-launch','sonniss-depth'],restoration:['ward-rise','energy-pulse'],
 bastion:['shield','ward-rise'],resonance:['energy-charge','zap'],swarm:['missile-launch','blast-shock'],
};
/** Shared depth-tested volumes, conductive arcs and solid beam cores; no screen-facing effect cards. */
export class ArchitectElementFx {
 private pools:InstancedMesh[]=[];private pulses:Pulse[]=[];private off:(()=>void)[]=[];
 private heard=new Map<number,number>();private locals:Ship[]=[];private reduced=reducedMotion();private detail=quality().particles;
 constructor(private scene:Scene,private game:Game){
  for(const [i,geo] of [new TorusGeometry(1,.035,5,48),new SphereGeometry(1,12,8),new OctahedronGeometry(1),new CylinderGeometry(1,1,1,8)].entries()){
   geo.setAttribute('tint',new InstancedBufferAttribute(new Float32Array(CAP*4),4).setUsage(DynamicDrawUsage));
   const mesh=new InstancedMesh(geo,new ShaderMaterial({vertexShader:vertex,fragmentShader:fragment,transparent:true,depthWrite:false,blending:AdditiveBlending}),CAP);mesh.name=`architect-elements-${i}`;mesh.count=0;mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(DynamicDrawUsage);scene.add(mesh);this.pools.push(mesh);
  }
  const reset=(s:Ship)=>{this.pulses=this.pulses.filter(p=>p.e.ship!==s);this.heard.delete(s.id);};
  this.off.push(game.events.on('architectElement',e=>{
   if(game.over)return;const impact=e.phase==='hit';
   // Merge coincident elemental impacts while keeping each emitter's charge visible.
   if(impact&&this.pulses.some(p=>p.age<.04&&p.e.ship===e.ship&&p.e.element===e.element&&p.e.phase==='hit'&&Math.hypot(p.e.tx-e.tx,p.e.tz-e.tz)<80))return;
   this.pulses.push({e,age:0,life:impact?(e.attack==='reaction'?.8:1):.4});if(this.pulses.length>160)this.pulses.shift();
   if(game.time-(this.heard.get(e.ship.id)??-100)<.1)return;this.heard.set(e.ship.id,game.time);
   const clips=(e.attack==='skill'&&e.type?specialistClips[e.type]:undefined)??elementClips[e.element];
   const local=this.locals.includes(e.ship);audio.play(impact?'explosion':'charge',impact?e.tx:e.x,impact?e.ty:e.y,impact?e.tz:e.z,impact?2:100,local?.42:.22,{category:'ability',priority:local?3:1,asset:`/audio/${clips[impact?1:0]}.m4a`,rate:e.attack==='skill'?.88:1});
  }),game.events.on('architectShot',e=>{
   if(e.kind!=='killbox'||e.slot===undefined)return;const a=e.ship.architect?.slots[e.slot];if(!a)return;
   this.pulses.push({e:{...e,slot:e.slot,element:a.element,type:a.type,attack:'killbox',phase:'hit',id:e.slot+(e.ship.architect!.ultimate?.waves??0)*13,radius:e.width},age:0,life:1.35});if(this.pulses.length>160)this.pulses.shift();
  }),game.events.on('respawn',e=>reset(e.ship)),game.events.on('shipChanged',e=>reset(e.old)),game.events.on('shift',e=>reset(e.ship)),game.events.on('shipSunk',e=>reset(e.ship)),game.events.on('gameOver',()=>{this.pulses=[];this.heard.clear();}));
 }
 update(dt:number,locals:Ship[]=[]){this.locals=locals;for(const p of this.pulses)p.age+=dt;this.pulses=this.pulses.filter(p=>p.age<p.life);}
 get count(){return this.pools.reduce((n,p)=>n+p.count,0);}
 private put(i:number,x:number,y:number,z:number,sx:number,sy:number,sz:number,c:number,a:number,rotation:Quaternion=q.identity()){
  const p=this.pools[i];if(p.count>=CAP||a<.005||Math.min(sx,sy,sz)<=0)return;const n=p.count++;mat.compose(pos.set(x,y,z),rotation,scale.set(sx,sy,sz));p.setMatrixAt(n,mat);color.setHex(c);(p.geometry.getAttribute('tint') as InstancedBufferAttribute).setXYZW(n,color.r,color.g,color.b,a);
 }
 private ring(x:number,y:number,z:number,r:number,c:number,a:number,tilt=Math.PI/2){q.setFromAxisAngle(new Vector3(1,0,0),tilt);this.put(0,x,y,z,r,r,r,c,a,q);}
 private tube(ax:number,ay:number,az:number,bx:number,by:number,bz:number,r:number,c:number,a:number){const d=new Vector3(bx-ax,by-ay,bz-az),len=d.length();if(len<.01)return;q.setFromUnitVectors(up,d.divideScalar(len));this.put(3,(ax+bx)/2,(ay+by)/2,(az+bz)/2,r,len,r,c,a,q);}
 prepare(team:Team|-1){
  for(const p of this.pools)p.count=0;
  if(!this.game.over)for(const p of [...this.pulses].sort((a,b)=>Number(b.e.ship.humanIndex>=0)-Number(a.e.ship.humanIndex>=0))){
   const e=p.e;if(!e.ship.alive||!e.ship.architect||e.ship.mods.banished||team!==-1&&!contactVisible(e.ship,team))continue;
   const t=p.age/p.life,fade=(1-t)**1.5,motion=this.reduced?.55:1-(1-t)**3,c=ELEMENT_STYLE[e.element].color,big=e.attack==='skill'||e.attack==='reaction',x=e.tx,y=Math.max(8,e.ty),z=e.tz,r=Math.max(40,Math.min(450,e.radius||80));
   if(e.attack==='killbox'){
    const final=e.radius>300,travel=Math.min(1,p.age/.42),blast=Math.max(0,(p.age-.42)/.93),cannon=ARCHETYPES[e.type??'furnace'].color;
    const muzzle=1-Math.min(1,p.age/.32);this.put(1,e.x,e.y,e.z,70*muzzle,45*muzzle,70*muzzle,cannon,muzzle*.8);this.ring(e.x,9,e.z,65+p.age*120,cannon,muzzle*.45);
    for(let i=0;i<(this.detail<1?3:5);i++){
     const angle=(e.id*5+i)*2.39996,rr=Math.sqrt(((e.id*17+i*37)%97)/97)*1420,tx=e.tx+Math.cos(angle)*rr,tz=e.tz+Math.sin(angle)*rr;
     const px=e.x+(tx-e.x)*travel,pz=e.z+(tz-e.z)*travel,py=e.y*(1-travel)+8*travel+Math.sin(travel*Math.PI)*(final?550:400);
     if(travel<1){this.put(1,px,py,pz,12,12,12,cannon,1);const back=Math.max(0,travel-.12);this.tube(e.x+(tx-e.x)*back,e.y*(1-back)+8*back+Math.sin(back*Math.PI)*(final?550:400),e.z+(tz-e.z)*back,px,py,pz,5,cannon,.8);}
     else {const fade=(1-blast)**2,size=(final?320:230)*Math.sqrt(blast);this.put(1,tx,18+size*.3,tz,size*.55,size*.8,size*.55,cannon,fade*.65);this.put(1,tx,20,tz,size*.27,size*.7,size*.27,0xffffff,fade*.75);this.ring(tx,7,tz,size*1.5,cannon,fade*.65);this.ring(tx,10,tz,size*1.15,0xd5efff,fade*.35);for(let k=0;k<3;k++){const aa=angle+k*2.1;this.put(2,tx+Math.cos(aa)*size*.75,30+Math.sin(blast*Math.PI)*180,tz+Math.sin(aa)*size*.75,7,35,8,cannon,fade);}}
    }
    continue;
   }
   if(e.type&&['sentinel','restoration','bastion','resonance'].includes(e.type)){
    const tint=ARCHETYPES[e.type].color;
    if(e.type==='sentinel'){this.ring(e.x,5,e.z,e.radius*motion,tint,fade*.5);this.ring(e.x,7,e.z,e.radius*motion*.92,tint,fade*.2);}
    else if(e.type==='restoration'){this.tube(e.x,e.y,e.z,x,y,z,5,tint,fade*.6);for(let i=0;i<3;i++)this.ring(x,y+motion*60+i*15,z,30+i*12,tint,fade*.7);}
    else if(e.type==='bastion'){this.put(1,x,y,z,70,100,70,tint,fade*.22);this.ring(x,y,z,100,tint,fade*.6);}
    else {for(let i=0;i<3;i++)this.ring(e.x,e.y+i*18,e.z,70+motion*140+i*30,tint,fade*.5);}
    continue;
   }
   if(e.phase==='cast'){
    const size=e.attack==='salvo'?10:big?30:20;
    this.put(1,e.x,e.y,e.z,size*(.5+motion),size*.65,size*(.5+motion),c,fade*.6);
    const d=new Vector3(x-e.x,y-e.y,z-e.z).normalize();q.setFromUnitVectors(axis,d);this.put(0,e.x,e.y,e.z,size,size,size,c,fade,q);
    if(e.element==='storm')for(let i=0;i<3;i++)this.tube(e.x-13,e.y+8+i*4,e.z-8,e.x+13,e.y+16-i*4,e.z+8,1.6,c,fade);
    continue;
   }
   if(e.element==='prism'||e.element==='cryo'&&e.attack==='skill'){
    const width=e.element==='prism'?(big?14:10):18;
    this.tube(e.x,e.y,e.z,x,y,z,width,c,fade*.65);this.tube(e.x,e.y,e.z,x,y,z,width*.24,0xffffff,fade);
    if(e.element==='prism'&&big){const d=new Vector3(x-e.x,0,z-e.z).normalize();for(const side of [-1,1])this.tube(e.x+d.z*side*65,e.y+30,e.z-d.x*side*65,x,y,z,6,c,fade*.6);}
   }
   if(e.element==='storm'){
    let ax=e.x,ay=e.y,az=e.z;const lightning=e.attack!=='skill';if(lightning){ax=x;ay=y+500;az=z;}
    for(let i=1;i<=9;i++){const f=i/9,offset=i===9?0:Math.sin(i*8.4+e.id)*35;const bx=ax+(x-ax)*f+offset,by=ay+(y-ay)*f,bz=az+(z-az)*f-offset*.6;const prev=(i-1)/9,po=i===1?0:Math.sin((i-1)*8.4+e.id)*35;this.tube(ax+(x-ax)*prev+po,ay+(y-ay)*prev,az+(z-az)*prev-po*.6,bx,by,bz,big?5:3,c,fade);}
   }
   if(e.element==='gravity'){
    const shrink=1-motion*.8;this.put(1,x,y+30,z,r*.35*shrink,r*.35*shrink,r*.35*shrink,0x44255c,fade*.8);
    for(let i=0;i<3;i++)this.ring(x,y+20+i*15,z,r*(.4+i*.2)*shrink,c,fade*.7,Math.PI/2+i*.3);
   }else{
    this.put(1,x,y,z,r*(.15+motion*.3),r*(e.element==='furnace'?.55:.18)*motion,r*(.15+motion*.3),c,fade*.45);
    this.ring(x,y,z,r*(.2+motion*.7),c,fade*.55);
   }
   const n=this.detail<1?6:12;
   for(let i=0;i<n;i++){const a=i*2.39996+e.id*.1,rr=r*(e.element==='gravity'?1-motion*.85:motion)*.75,sy=e.element==='cryo'?r*.35:r*.12;
    q.setFromAxisAngle(up,a);this.put(2,x+Math.cos(a)*rr,y+12+Math.sin(Math.PI*t)*r*.25,z+Math.sin(a)*rr,e.element==='cryo'?8:4,sy,5,c,fade*.7,q);
   }
   if(e.pair)this.ring(x,y+20,z,r*(.5+motion*.5),ELEMENT_STYLE[e.pair].color,fade*.65,Math.PI/2+.35);
  }
  // Actual guided ammunition uses simulation positions, never delayed event backlogs.
  for(const s of this.game.ships){if(!s.alive||!s.architect||team!==-1&&!contactVisible(s,team))continue;for(const j of s.architect.elements.jobs){if(!j.projectile)continue;const c=ELEMENT_STYLE[j.element].color,dx=j.tx-j.x,dy=j.ty-j.y,dz=j.tz-j.z,len=Math.hypot(dx,dy,dz)||1;this.put(1,j.x,j.y,j.z,5,5,5,c,1);this.tube(j.x-dx/len*45,j.y-dy/len*45,j.z-dz/len*45,j.x,j.y,j.z,j.underwater?3:2,c,.7);}}
  for(const p of this.pools){p.instanceMatrix.needsUpdate=true;(p.geometry.getAttribute('tint') as InstancedBufferAttribute).needsUpdate=true;}
 }
 dispose(){for(const off of this.off)off();for(const p of this.pools){this.scene.remove(p);p.dispose();p.geometry.dispose();(p.material as ShaderMaterial).dispose();}this.pulses=[];this.heard.clear();}
}
