import { architectBatterySkillGain } from '../fx/ArchitectBatteryAudio';
import { ARCHETYPES, type ArchitectType } from '../data/architectLoadout';
import { AdditiveBlending, Color, CylinderGeometry, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, OctahedronGeometry, Quaternion, ShaderMaterial, SphereGeometry, TorusGeometry, Vector3, type Scene } from 'three';
import type { Game } from '../core/Game';
import type { Ship } from '../ships/Ship';
import type { Team } from '../core/types';
import { contactVisible } from '../core/Targeting';
import { ELEMENT_STYLE, type ElementEvent } from '../skills/misc/ArchitectElements';
import { audio } from '../fx/Audio';
import { reducedMotion } from './ArchitectPose';
import { elementalTurretGeometry } from './ArchitectModel';
import { getVectorMobilityStatus } from '../skills/misc/ArchitectRuntime';
import { quality } from './Quality';
import { ArchitectReactionFx } from './ArchitectReactionFx';
const vertex=`attribute vec4 tint;varying vec4 vTint;varying vec3 vNormal;varying vec3 vEye;void main(){vTint=tint;mat3 im=mat3(instanceMatrix);vec3 n=normal/vec3(dot(im[0],im[0]),dot(im[1],im[1]),dot(im[2],im[2]));vec4 mv=modelViewMatrix*instanceMatrix*vec4(position,1.);vNormal=normalize(normalMatrix*im*n);vEye=-mv.xyz;gl_Position=projectionMatrix*mv;}`;
const fragment=`varying vec4 vTint;varying vec3 vNormal;varying vec3 vEye;void main(){float rim=pow(1.-abs(dot(normalize(vNormal),normalize(vEye))),1.5);gl_FragColor=vec4(vTint.rgb*(.8+rim*.8),vTint.a*(.25+rim*.65));}`;
const CAP=256,mat=new Matrix4(),pos=new Vector3(),scale=new Vector3(),q=new Quaternion(),color=new Color(),up=new Vector3(0,1,0),axis=new Vector3(0,0,1);
interface Pulse {e:ElementEvent;age:number;life:number}
const elementClips={furnace:['blast-shock','blast-heavy'],cryo:['ward-rise','cut-light'],storm:['arcane-charge','energy-pulse'],gravity:['phase-arrival','blast-heavy'],prism:['energy-charge','energy-heavy']} as const;
/** Third layer of a reaction's sting, on top of both elements' impacts. */
const reactionStings:Record<string,string>={'cryo+furnace':'sonniss-splash','furnace+storm':'thunder','furnace+gravity':'collapse','furnace+prism':'energy-heavy','cryo+storm':'zap','cryo+gravity':'collapse','cryo+prism':'cut-heavy','gravity+storm':'thunder','prism+storm':'laser','gravity+prism':'phase-arrival'};
const specialistClips:Partial<Record<ArchitectType,readonly [string,string]>>={
 sentinel:['sensor-ping','sensor-ping'],abyss:['torpedo-launch','sonniss-depth'],restoration:['ward-rise','energy-pulse'],
 bastion:['shield','ward-rise'],resonance:['energy-charge','zap'],swarm:['missile-launch','blast-shock'],
};
/** Shared depth-tested volumes, conductive arcs and solid beam cores; no screen-facing effect cards. */
export class ArchitectElementFx {
 private pools:InstancedMesh[]=[];private pulses:Pulse[]=[];private off:(()=>void)[]=[];
 private heard=new Map<number,number>();private locals:Ship[]=[];private reduced=reducedMotion();private detail=quality().particles;
 readonly reactions:ArchitectReactionFx;
 constructor(private scene:Scene,private game:Game){
  this.reactions=new ArchitectReactionFx(scene,game);
  for(const [i,geo] of [new TorusGeometry(1,.035,5,48),new SphereGeometry(1,12,8),new OctahedronGeometry(1),new CylinderGeometry(1,1,1,8)].entries()){
   geo.setAttribute('tint',new InstancedBufferAttribute(new Float32Array(CAP*4),4).setUsage(DynamicDrawUsage));
   const mesh=new InstancedMesh(geo,new ShaderMaterial({vertexShader:vertex,fragmentShader:fragment,transparent:true,depthWrite:false,blending:AdditiveBlending,toneMapped:false}),CAP);mesh.name=`architect-elements-${i}`;mesh.count=0;mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(DynamicDrawUsage);scene.add(mesh);this.pools.push(mesh);
  }
  const reset=(s:Ship)=>{this.pulses=this.pulses.filter(p=>p.e.ship!==s);this.heard.delete(s.id);this.reactions.drop(s);};
  this.off.push(game.events.on('architectElement',e=>{
   if(game.over)return;const impact=e.phase==='hit';
   if(impact&&e.pair){this.reaction(e);return;}
   // Merge coincident elemental impacts of one attack while keeping each emitter's charge visible.
   if(impact&&this.pulses.some(p=>p.age<.04&&p.e.ship===e.ship&&p.e.element===e.element&&p.e.attack===e.attack&&p.e.phase==='hit'&&Math.hypot(p.e.tx-e.tx,p.e.tz-e.tz)<80))return;
   this.pulses.push({e,age:0,life:impact?(e.attack==='reaction'?.8:1):.4});if(this.pulses.length>160)this.pulses.shift();
   if(game.time-(this.heard.get(e.ship.id)??-100)<.1)return;this.heard.set(e.ship.id,game.time);
   const clips=(e.attack==='skill'&&e.type?specialistClips[e.type]:undefined)??elementClips[e.element];
   const local=this.locals.includes(e.ship);audio.play(impact?'explosion':'charge',impact?e.tx:e.x,impact?e.ty:e.y,impact?e.tz:e.z,impact?2:100,(local?.42:.22)*architectBatterySkillGain(game),{category:'ability',priority:local?3:1,asset:`${import.meta.env.BASE_URL}audio/${clips[impact?1:0]}.m4a`,rate:e.attack==='skill'?.88:1});
  }),game.events.on('respawn',e=>reset(e.ship)),game.events.on('shipChanged',e=>reset(e.old)),game.events.on('shift',e=>reset(e.ship)),game.events.on('shipSunk',e=>reset(e.ship)),game.events.on('gameOver',()=>{this.pulses=[];this.heard.clear();this.reactions.clear();}));
 }
 /** A reaction is its own burst with a layered sting; it never merges into the hit that set it off. */
 private reaction(e:ElementEvent){
  this.reactions.add(e);const local=this.locals.includes(e.ship),gain=(local?.5:.3)*architectBatterySkillGain(this.game),key=[e.pair!,e.element].sort().join('+'),url=(clip:string)=>`${import.meta.env.BASE_URL}audio/${clip}.m4a`;
  for(const [i,el] of [e.pair!,e.element].entries())audio.play('explosion',e.tx,e.ty,e.tz,2,gain*(i?1:.8),{category:'ability',priority:local?3:2,asset:url(elementClips[el][1]),rate:i?1:.82});
  audio.play('charge',e.tx,e.ty,e.tz,2,gain*.75,{category:'ability',priority:local?3:2,asset:url(reactionStings[key]),rate:1.15});
 }
 update(dt:number,locals:Ship[]=[]){this.locals=locals;for(const p of this.pulses)p.age+=dt;this.pulses=this.pulses.filter(p=>p.age<p.life);this.reactions.update();}
 get count(){return this.pools.reduce((n,p)=>n+p.count,0)+this.reactions.count;}
 get distortions(){return this.reactions.distortions;}
 setFog(color:Color,density:number){this.reactions.setFog(color,density);}
 private put(i:number,x:number,y:number,z:number,sx:number,sy:number,sz:number,c:number,a:number,rotation:Quaternion=q.identity()){
  const p=this.pools[i];if(p.count>=CAP||a<.005||Math.min(sx,sy,sz)<=0)return;const n=p.count++;mat.compose(pos.set(x,y,z),rotation,scale.set(sx,sy,sz));p.setMatrixAt(n,mat);color.setHex(c);(p.geometry.getAttribute('tint') as InstancedBufferAttribute).setXYZW(n,color.r,color.g,color.b,a);
 }
 private ring(x:number,y:number,z:number,r:number,c:number,a:number,tilt=Math.PI/2){q.setFromAxisAngle(new Vector3(1,0,0),tilt);this.put(0,x,y,z,r,r,r,c,a,q);}
 private tube(ax:number,ay:number,az:number,bx:number,by:number,bz:number,r:number,c:number,a:number){const d=new Vector3(bx-ax,by-ay,bz-az),len=d.length();if(len<.01)return;q.setFromUnitVectors(up,d.divideScalar(len));this.put(3,(ax+bx)/2,(ay+by)/2,(az+bz)/2,r,len,r,c,a,q);}
 prepare(team:Team|-1,heightPx=720){
  this.reactions.prepare(team,heightPx);
  for(const p of this.pools)p.count=0;
  if(!this.game.over)for(const p of [...this.pulses].sort((a,b)=>Number(b.e.ship.humanIndex>=0)-Number(a.e.ship.humanIndex>=0))){
   const e=p.e;if(!e.ship.alive||!e.ship.architect||e.ship.mods.banished||team!==-1&&!contactVisible(e.ship,team))continue;
   const t=p.age/p.life,fade=(1-t)**1.5,motion=this.reduced?.55:1-(1-t)**3,c=e.type?ARCHETYPES[e.type].color:ELEMENT_STYLE[e.element].color,big=e.attack==='skill'||e.attack==='reaction',x=e.tx,y=Math.max(8,e.ty),z=e.tz,r=Math.max(40,Math.min(450,e.radius||80));
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
  // Stored capacitors occupy the physical dock chamber; drive exhaust follows actual motion.
  if(!this.game.over)for(const s of this.game.ships){
   const a=s.architect;if(!s.alive||!a||team!==-1&&!contactVisible(s,team))continue;
   for(const slot of a.slots){
    if(slot.state!=='docked'||slot.hp<=0||(!slot.capacitorCharged&&!slot.capacitorCycles))continue;
    const house=elementalTurretGeometry(slot.type).house;if(!house.boundingBox)house.computeBoundingBox();
    const socket=s.spec.main!.turrets[slot.index],h=s.renderHeading,x=s.renderPos.x+Math.sin(h)*socket.x+Math.cos(h)*(socket.z??0),z=s.renderPos.z-Math.cos(h)*socket.x+Math.sin(h)*(socket.z??0),y=s.renderPos.y+s.spec.freeboard+socket.y+18+house.boundingBox!.max.y,c=ARCHETYPES[slot.type].color;
    this.put(2,x,y,z,slot.capacitorCharged?5:3,slot.capacitorCharged?10:5,slot.capacitorCharged?5:3,c,slot.capacitorCharged?.95:.5);
   }
   const vector=getVectorMobilityStatus(s);
   if(vector?.unlocked&&a.drive?.moving){const d=a.drive,back=this.reduced?75:180,c=ARCHETYPES.vector.color,h=s.renderHeading;
    for(const side of [-1,1]){const x=s.renderPos.x-Math.sin(h)*s.spec.length*.4+Math.cos(h)*side*s.spec.beam*.24,z=s.renderPos.z+Math.cos(h)*s.spec.length*.4+Math.sin(h)*side*s.spec.beam*.24,y=s.renderPos.y+20;this.tube(x,y,z,x-d.dx*back,y,z-d.dz*back,11,c,.7);this.tube(x,y,z,x-d.dx*back*.8,y,z-d.dz*back*.8,3,0xe5ffff,.9);}
   }
   if(vector?.unlocked&&s.vectorMobility.mobileUntil>this.game.time)for(const slot of a.slots){const m=slot.entity;if(!m?.alive||!slot.follow||slot.state!=='deployed'||a.ultimate||team!==-1&&!contactVisible(m,team))continue;this.put(2,m.renderPos.x,m.renderPos.y-10,m.renderPos.z,8,16,8,ARCHETYPES.vector.color,.65);}
  }
  // Solid elemental bolt heads and volumetric wakes follow the actual simulation shells.
  if(!this.game.over)for(const shell of this.game.shells.shells){
   if(!shell.alive||!shell.element?.kind)continue;
   const c=ELEMENT_STYLE[shell.element.kind].color,len=Math.hypot(shell.vx,shell.vy,shell.vz)||1,tail=Math.min(shell.travelled,this.reduced?40:95);
   this.put(2,shell.x,shell.y,shell.z,5,8,5,c,.95);
   this.tube(shell.x-shell.vx/len*tail,shell.y-shell.vy/len*tail,shell.z-shell.vz/len*tail,shell.x,shell.y,shell.z,4,c,.55);
  }
  // Actual guided ammunition uses simulation positions, never delayed event backlogs.
  if(!this.game.over)for(const s of this.game.ships){if(!s.alive||!s.architect||team!==-1&&!contactVisible(s,team))continue;for(const j of s.architect.elements.jobs){if(!j.projectile)continue;const c=ELEMENT_STYLE[j.element].color,dx=j.tx-j.x,dy=j.ty-j.y,dz=j.tz-j.z,len=Math.hypot(dx,dy,dz)||1;this.put(1,j.x,j.y,j.z,5,5,5,c,1);this.tube(j.x-dx/len*45,j.y-dy/len*45,j.z-dz/len*45,j.x,j.y,j.z,j.underwater?3:2,c,.7);}}
  for(const p of this.pools){p.visible=p.count>0;if(!p.count)continue;for(const attribute of [p.instanceMatrix,p.geometry.getAttribute('tint') as InstancedBufferAttribute]){attribute.clearUpdateRanges();attribute.addUpdateRange(0,p.count*attribute.itemSize);attribute.needsUpdate=true;}}
 }
 dispose(){for(const off of this.off)off();for(const p of this.pools){this.scene.remove(p);p.dispose();p.geometry.dispose();(p.material as ShaderMaterial).dispose();}this.pulses=[];this.heard.clear();this.reactions.dispose();}
}
