import { BufferAttribute, DynamicDrawUsage, Euler, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshDepthMaterial, RGBADepthPacking, MeshStandardMaterial, Quaternion, TorusGeometry, Vector3, type BufferGeometry, type Scene } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Game } from '../core/Game';
import type { Team } from '../core/types';
import type { ArchitectBatteryLayout, ArchitectBatteryArc, ArchitectBatteryCast, ArchitectBatteryLaunch, ArchitectBatteryMember, ArchitectBatteryPoint, ArchitectBatteryStage } from '../data/architectBattery';
import { buildArchitectBatteryPaths, getArchitectBatteryHeadPose } from '../skills/misc/ArchitectBatteryPose';
import { contactVisible } from '../core/Targeting';
import { reducedMotion } from './ArchitectPose';
import { quality } from './Quality';
import { ARCHETYPES,type ArchitectType } from '../data/architectLoadout';
import type { Ship } from '../ships/Ship';
import { Parts } from './Geometry';
const IVORY=0xd5d9d0,DARK=0x152732,EDGE=0x617d89,BLACK=0x08121a;
const cache=new Map<string,BufferGeometry[]>();
/** Six articulated assemblies, each type authored as physical siege machinery. */
export function siegeGeometry(type:ArchitectType,low=false):BufferGeometry[]{
 const key=type+(low?'-low':'-high'),cached=cache.get(key);if(cached)return cached;
 const c=ARCHETYPES[type].color,base=new Parts(),house=new Parts(),barrel=new Parts(),wing=new Parts(),crown=new Parts(),glow=new Parts();
 base.box(38,17,42,-69,8,0,IVORY,{taper:.2});base.cyl(45,60,12,0,0,0,DARK,{seg:low?6:12});base.cyl(42,45,6,0,12,0,EDGE,{seg:low?6:12});
 for(let i=0;i<6;i++){const a=i*Math.PI/3,x=Math.cos(a)*46,z=Math.sin(a)*46;base.box(35,8,17,x,-4,z,IVORY,{ry:-a,taper:.2});base.box(22,2,6,x,5,z,c,{ry:-a});}
 house.box(65,30,54,-14,22,0,IVORY,{taper:.2,slope:8});house.box(42,18,60,-28,31,0,DARK,{taper:.15});house.box(26,36,61,17,19,0,EDGE,{taper:.1});
 for(const z of [-1,1]){house.box(42,5,5,-17,48,z*26,c);for(let x=-35;x<2;x+=8)house.box(4,15,2,x,27,z*30,BLACK);}
 // All specialists retain an unmistakable heavy gun, including repair and sensor builds.
 barrel.box(96,12,12,53,0,0,DARK);barrel.box(85,4,5,56,8,0,c);barrel.box(20,23,23,98,-5,0,IVORY,{taper:.2});barrel.box(2,11,11,109,1,0,BLACK);
 wing.box(43,20,8,-16,0,0,IVORY,{taper:.25});wing.box(34,3,3,-14,22,0,c);
 if(type==='furnace'){
  for(const z of [-15,15]){barrel.box(90,10,10,48,0,z,EDGE);barrel.box(15,20,16,94,-5,z,IVORY);barrel.box(2,9,8,102,1,z,BLACK);}
  crown.box(42,24,40,-32,0,0,DARK,{taper:.2});for(let x=-48;x<-12;x+=7){crown.box(4,24,42,x,4,0,EDGE);glow.box(2,20,44,x,65,0,c);}
 }else if(type==='cryo'){
  barrel.box(135,8,8,66,1,0,IVORY);for(let x=20;x<100;x+=14)for(const z of [-1,1])barrel.box(5,26,18,x,-5,z*15,EDGE,{rz:z*.2});
  for(const z of [-1,1])crown.cyl(9,9,55,-18,2,z*25,c,{seg:low?6:10,rz:Math.PI/2});
 }else if(type==='storm'){
  for(const z of [-1,1]){crown.box(13,68,13,-18,0,z*26,EDGE,{taper:.2});for(let y=10;y<66;y+=12)crown.cyl(13,13,4,-18,y,z*26,c,{seg:low?6:10});crown.box(36,8,12,-6,65,z*26,IVORY);}
  for(let x=20;x<100;x+=20)barrel.box(7,28,42,x,-8,0,EDGE);
 }else if(type==='gravity'){
  for(let x=15;x<110;x+=29){barrel.add(new TorusGeometry(26,4,low?3:6,low?10:24),EDGE,x,0,0,{ry:Math.PI/2});barrel.add(new TorusGeometry(21,2,low?3:5,low?10:24),c,x,0,0,{ry:Math.PI/2});}
  crown.add(new TorusGeometry(28,6,low?3:6,low?10:20),IVORY,-30,20,0,{ry:Math.PI/2});
 }else if(type==='prism'){
  for(const z of [-1,1]){barrel.box(124,8,9,61,9,z*15,IVORY,{taper:.35});barrel.box(120,2,3,62,18,z*15,c);wing.box(75,32,5,12,4,0,IVORY,{rz:-.2,taper:.4});}
  crown.cyl(3,17,35,-24,0,0,c,{seg:4});
 }else if(type==='sentinel'){
  crown.box(10,46,10,-26,0,0,EDGE);crown.box(64,18,6,-26,44,0,IVORY,{taper:.15});for(let z=-27;z<=27;z+=9)crown.box(3,16,3,-26,46,z,c);
  barrel.box(125,8,8,62,1,0,IVORY);wing.box(7,34,25,-12,14,0,EDGE,{rz:.3});
 }else if(type==='abyss'){
  for(const z of [-22,0,22]){barrel.cyl(11,13,65,27,14,z,EDGE,{seg:low?6:10,rz:Math.PI/2});barrel.cyl(8,8,3,61,14,z,BLACK,{seg:low?6:10,rz:Math.PI/2});barrel.cyl(12,12,3,55,14,z,c,{seg:low?6:10,rz:Math.PI/2});}
  crown.add(new TorusGeometry(24,3,low?3:6,low?10:24),c,-30,10,0,{ry:Math.PI/2});wing.box(48,26,14,-12,0,0,IVORY,{taper:.2});
 }else if(type==='restoration'){
  for(const z of [-1,1]){crown.box(10,37,10,-22,0,z*28,IVORY);crown.box(38,7,9,-6,34,z*28,EDGE);crown.cyl(8,8,12,14,30,z*28,c,{seg:8});}
  barrel.box(100,6,6,51,0,-17,EDGE);barrel.box(100,6,6,51,0,17,EDGE);wing.box(40,3,18,-6,12,0,c);
 }else if(type==='bastion'){
  house.box(78,38,70,-18,18,0,IVORY,{taper:.2});barrel.box(65,20,26,45,-5,0,EDGE);wing.box(90,46,10,10,-8,0,IVORY,{taper:.22});wing.box(72,30,3,10,-1,6,c,{taper:.25});crown.box(48,8,60,-20,1,0,EDGE);
 }else if(type==='resonance'){
  for(const z of [-1,1]){crown.box(9,58,10,-32,0,z*22,IVORY);crown.box(28,6,10,-20,54,z*22,c);barrel.box(94,7,9,52,14,z*19,IVORY);}
  for(let x=20;x<100;x+=25)barrel.add(new TorusGeometry(19,2,low?3:5,low?10:20),c,x,0,0,{ry:Math.PI/2});
 }else{
  for(const z of [-1,1])for(let x=-30;x<=6;x+=18){crown.box(15,35,16,x,0,z*24,IVORY,{taper:.12});crown.box(10,5,11,x,35,z*24,BLACK);crown.box(4,3,5,x,37,z*24,c);}
  wing.box(65,16,30,-12,-5,0,DARK,{taper:.15});for(let x=-30;x<20;x+=15)wing.box(10,3,18,x,13,0,c);
 }
 for(const z of [-1,1]){glow.box(45,2,2,-16,48,z*29,c);glow.box(5,14,2,18,28,z*32,c);}
 const out=[base,house,barrel,wing,crown,glow].map(p=>p.merge());cache.set(key,out);return out;
}

const CAP=320,matrix=new Matrix4(),q=new Quaternion(),euler=new Euler(),pos=new Vector3(),scale=new Vector3();
const mergedCache=new Map<string,BufferGeometry[]>();
/** Two full-height vertical mortars fit fore/aft inside the original 80 × 44 m hub. */
export function foldedSiegeGeometry(type:ArchitectType):BufferGeometry[]{
 const c=ARCHETYPES[type].color,base=new Parts().box(25,11,29,0,0,0,DARK),receiver=new Parts(),barrel=new Parts(),hardware=new Parts();
 receiver.box(23,48,24,0,8,0,IVORY,{taper:.12});receiver.box(17,8,27,0,50,0,DARK);
 barrel.box(110,14,14,55,-7,0,EDGE);barrel.box(14,22,22,106,-11,0,IVORY,{taper:.08});barrel.box(1,12,12,113.5,-6,0,BLACK);
 const fork=type==='prism'||type==='resonance'||type==='restoration',height=fork?40:type==='sentinel'?34:22;
 for(const side of [-1,1]){hardware.box(fork?4:8,height,4,0,50,side*10,IVORY);hardware.box(fork?13:17,5,5,0,50+height,side*10,c);}
 return [base,receiver,barrel,hardware].map(p=>p.merge());
}

/** Four rigid articulation groups per type, shared by all owners. */
export function siegeBatchGeometry(type:ArchitectType,low=false):BufferGeometry[]{
 const key=type+(low?'-low':'-high'),cached=mergedCache.get(key);if(cached)return cached;
 const source=siegeGeometry(type,low),base=source[0].clone(),house=source[1].clone(),left=source[3].clone(),right=source[3].clone(),barrel=source[2].clone(),crown=source[4].clone(),glow=source[5].clone();
 const tag=(g:BufferGeometry,value:number)=>g.setAttribute('wingSide',new BufferAttribute(new Float32Array(g.attributes.position.count).fill(value),1));
 tag(house,0);tag(left,-1);tag(right,1);left.translate(0,25,-51);right.translate(0,25,51);
 const receiver=mergeGeometries([house,left,right])!;house.dispose();left.dispose();right.dispose();
 crown.translate(0,47,0);const hardware=mergeGeometries([crown,glow])!;crown.dispose();glow.dispose();
 const folded=foldedSiegeGeometry(type),out=[base,receiver,barrel,hardware].map((normal,i)=>{
  if(i!==1)tag(normal,0);tag(folded[i],0);
  normal.setAttribute('layoutPart',new BufferAttribute(new Float32Array(normal.attributes.position.count),1));
  folded[i].setAttribute('layoutPart',new BufferAttribute(new Float32Array(folded[i].attributes.position.count).fill(1),1));
  const geometry=mergeGeometries([normal,folded[i]])!;normal.dispose();folded[i].dispose();return geometry;
 });out.forEach(g=>g.computeBoundingSphere());mergedCache.set(key,out);return out;
}
interface Rig {owner:Ship;cast:ArchitectBatteryCast;center:ArchitectBatteryPoint;types:ArchitectType[];paths:Map<string,readonly [ArchitectBatteryArc,ArchitectBatteryArc]>}
export interface BatteryMachineryStats {heads:number;carriers:number;batches:number;triangles:number;peakHeads:number;drops:number;layouts:Record<string,number>}

export class ArchitectSiege {
 private batches=new Map<ArchitectType,InstancedMesh[]>();
 readonly carriers:InstancedMesh[]=[];
 readonly charges:{point:ArchitectBatteryPoint;color:number;strength:number}[]=[];
 private rigs=new Map<number,Rig>();private launches=new Map<string,ArchitectBatteryLaunch>();private off:(()=>void)[]=[];
 private armor=new MeshStandardMaterial({vertexColors:true,metalness:.58,roughness:.57});
 private batchMaterial=this.armor.clone();private receiverMaterial=this.armor.clone();private depthMaterial=new MeshDepthMaterial({depthPacking:RGBADepthPacking});private reduced=reducedMotion();
 readonly stats:BatteryMachineryStats={heads:0,carriers:0,batches:0,triangles:0,peakHeads:0,drops:0,layouts:{wide:0,compact:0,folded:0}};
 constructor(private scene:Scene,private game:Game){
  const layoutShader=(shader:Parameters<MeshStandardMaterial['onBeforeCompile']>[0])=>{
   shader.vertexShader='attribute float layoutPart; attribute float instanceFolded;\n'+shader.vertexShader;
   shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
     if(abs(layoutPart-instanceFolded)>.5)transformed=vec3(0.);`);
  };
  this.batchMaterial.onBeforeCompile=layoutShader;this.batchMaterial.customProgramCacheKey=()=> 'battery-layout-v2';
  this.depthMaterial.onBeforeCompile=layoutShader;this.depthMaterial.customProgramCacheKey=()=> 'battery-layout-depth-v2';
  // Shoulder shutters articulate within the receiver batch, avoiding a draw per flap.
  this.receiverMaterial.onBeforeCompile=shader=>{
   layoutShader(shader);
   shader.vertexShader='attribute float wingSide; attribute float instanceOpen;\n'+shader.vertexShader;
   shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
    if(abs(wingSide)>.5&&instanceFolded<.5){vec2 p=position.yz-vec2(25.,wingSide*51.);float a=wingSide*(1.-instanceOpen)*1.3;transformed.yz=mat2(cos(a),sin(a),-sin(a),cos(a))*p+vec2(25.,wingSide*(27.+24.*instanceOpen));}`);
   shader.vertexShader=shader.vertexShader.replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
    if(abs(wingSide)>.5&&instanceFolded<.5){float a=wingSide*(1.-instanceOpen)*1.3;objectNormal.yz=mat2(cos(a),sin(a),-sin(a),cos(a))*objectNormal.yz;}`);
  };
  this.receiverMaterial.customProgramCacheKey=()=> 'battery-receiver-shutters-v2';
  const truss=new Parts(),shoe=new Parts();
  truss.box(1,16,32,0,0,0,DARK);truss.box(1,4,40,0,13,0,IVORY);truss.box(1,3,5,0,18,-10,EDGE);truss.box(1,3,5,0,18,10,EDGE);
  shoe.box(30,20,36,0,0,0,IVORY,{taper:.15});shoe.box(35,4,43,0,20,0,EDGE);shoe.box(12,4,44,0,24,0,0xffb86a);
  for(const [i,geo] of [truss.merge(),shoe.merge()].entries())this.carriers.push(this.make(geo,this.armor,`architect-battery-carrier-${i}`,CAP*2));
  this.off.push(game.events.on('architectBatteryLaunch',launch=>{this.launches.set(`${launch.owner.id}:${launch.slot}`,launch);}),game.events.on('architectCommand',e=>{
   // Accepted Reconfigure/Recall/Assembly ownership is permanent, including moves
   // that finish between two render frames. Never recreate a cosmetic recovery rig.
   if(!['killbox','end','destroy'].includes(e.kind))this.rigs.delete(e.ship.id);
  }));
 }
 private make(geometry:BufferGeometry,material:MeshStandardMaterial,name:string,cap=CAP):InstancedMesh {
  const mesh=new InstancedMesh(geometry,material,cap);mesh.name=name;mesh.count=0;mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(DynamicDrawUsage);mesh.castShadow=quality().shadowMap>0;mesh.receiveShadow=true;this.scene.add(mesh);return mesh;
 }
 private typeBatches(type:ArchitectType):InstancedMesh[]{
  let meshes=this.batches.get(type);if(meshes)return meshes;
  const low=quality().particles<1;
  meshes=siegeBatchGeometry(type,low).map((g,i)=>{const geometry=g.clone();geometry.setAttribute('instanceFolded',new InstancedBufferAttribute(new Float32Array(CAP),1).setUsage(DynamicDrawUsage));if(i===1)geometry.setAttribute('instanceOpen',new InstancedBufferAttribute(new Float32Array(CAP),1).setUsage(DynamicDrawUsage));const mesh=this.make(geometry,i===1?this.receiverMaterial:this.batchMaterial,`architect-battery-${type}-${i}`);mesh.customDepthMaterial=this.depthMaterial;return mesh;});
  this.batches.set(type,meshes);return meshes;
 }
 private valid(owner:Ship,generation:number){return owner.alive&&!owner.withdrawn&&!!owner.architect&&this.game.battery.generation(owner)===generation&&!this.game.over;}
 update(){
  for(const owner of this.game.ships){const u=owner.architect?.ultimate;if(u?.kind!=='killbox'||!u.battery||!this.valid(owner,u.battery.generation))continue;
   if(this.rigs.get(owner.id)?.cast.id!==u.battery.id)this.rigs.set(owner.id,{owner,cast:u.battery,center:{x:u.x,y:0,z:u.z},types:owner.architect!.slots.map(a=>a.type),paths:new Map()});
  }
  for(const [id,rig] of this.rigs){const u=rig.owner.architect?.ultimate,elapsed=this.game.time-rig.cast.startedAt;
   const movedAfterControl=!u&&elapsed>=7.5&&rig.cast.members.some(member=>!!rig.owner.architect?.slots[member.slot]?.path);
   if(!this.valid(rig.owner,rig.cast.generation)||elapsed>=8.8||movedAfterControl||u&&u.battery?.id!==rig.cast.id)this.rigs.delete(id);
  }
  for(const [key,launch] of this.launches)if(!this.valid(launch.owner,launch.generation)||this.game.time-launch.launchTime>1)this.launches.delete(key);
 }
 private put(mesh:InstancedMesh,x:number,y:number,z:number,yaw:number,pitch:number,sx:number,sy:number,sz:number,layout:ArchitectBatteryLayout='wide'):number {
  if(mesh.count>=mesh.instanceMatrix.count){this.stats.drops++;return -1;}
  const i=mesh.count++;q.setFromEuler(euler.set(0,-yaw,pitch,'YXZ'));matrix.compose(pos.set(x,y,z),q,scale.set(sx,sy,sz));mesh.setMatrixAt(i,matrix);const folded=mesh.geometry.getAttribute('instanceFolded') as InstancedBufferAttribute|undefined;if(folded)folded.setX(i,layout==='folded'?1:0);return i;
 }
 private paths(rig:Rig,member:ArchitectBatteryMember,stage:ArchitectBatteryStage){const key=`${member.slot}:${stage}`;let paths=rig.paths.get(key);if(!paths){paths=buildArchitectBatteryPaths({carrier:member.carrier,center:rig.center,radius:1500,slot:member.slot,stage,type:rig.types[member.slot],layout:member.layout,groundHeight:(x,z)=>this.game.map.heightAt(x,z)});rig.paths.set(key,paths);}return paths;}
 prepare(team:Team|-1){
  this.update();this.charges.length=0;this.stats.heads=0;this.stats.carriers=0;this.stats.batches=0;this.stats.triangles=0;this.stats.layouts={wide:0,compact:0,folded:0};
  for(const meshes of this.batches.values())for(const mesh of meshes)mesh.count=0;for(const mesh of this.carriers)mesh.count=0;
  for(const rig of this.rigs.values()){
   const elapsed=this.game.time-rig.cast.startedAt;
   for(const member of rig.cast.members){
    const slot=rig.owner.architect?.slots[member.slot],platform=slot?.entity;
    if(!platform?.alive||team!==-1&&!contactVisible(platform,team)||elapsed>=7.5&&(slot!.path||slot!.state!=='deployed'))continue;
    const last=this.launches.get(`${rig.owner.id}:${member.slot}`),stage=(elapsed>=7.1?3:elapsed>=5.08?2:elapsed>=3.08?1:0) as ArchitectBatteryStage;
    const latest=last?.castId===rig.cast.id?last:undefined,aimStage=latest&&this.game.time-latest.launchTime<.6?latest.stage:stage,paths=latest&&aimStage===latest.stage?latest.paths:this.paths(rig,member,aimStage);
    const type=rig.types[member.slot],meshes=this.typeBatches(type),dx=platform.renderPos.x-member.carrier.x,dy=platform.renderPos.y-member.carrier.y,dz=platform.renderPos.z-member.carrier.z;
    this.stats.carriers++;this.stats.layouts[member.layout]++;
    for(const head of [0,1] as const){
     const p=getArchitectBatteryHeadPose({carrier:member.carrier,center:rig.center,radius:1500,slot:member.slot,stage:aimStage,type,layout:member.layout,groundHeight:()=>-100,head,elapsed,recoilAge:latest?this.game.time-latest.launchTime:undefined,reducedMotion:this.reduced,path:paths[head]});
     const x=p.position.x+dx,y=p.position.y+dy,z=p.position.z+dz,s=p.scale,baseYaw=member.layout==='folded'?member.carrier.heading-Math.PI/2:Math.atan2(rig.center.z-member.carrier.z,rig.center.x-member.carrier.x);
     this.put(meshes[0],x,y,z,baseYaw,0,s,s,s,member.layout);
     const receiver=this.put(meshes[1],x,y,z,p.yaw,0,s,s*(1-(aimStage===3?.045:0)*p.lock),s,member.layout);if(receiver>=0)(meshes[1].geometry.getAttribute('instanceOpen') as InstancedBufferAttribute).setX(receiver,p.shutter);
     const back=-p.recoil-p.barrelRetraction*(1-p.lock)*s;
     this.put(meshes[2],x+Math.cos(p.yaw)*Math.cos(p.pitch)*back,y+p.pivotHeight*s+Math.sin(p.pitch)*back,z+Math.sin(p.yaw)*Math.cos(p.pitch)*back,p.yaw,p.pitch,s*p.extension,s,s,member.layout);
     this.put(meshes[3],x,y-35*(1-p.lock)*s,z,p.yaw+(this.reduced||member.layout==='folded'?0:(1-p.lock)*.28),0,s,s*(.35+.65*p.lock),s,member.layout);
     const tx=x-platform.renderPos.x,tz=z-platform.renderPos.z,len=Math.hypot(tx,tz),trussYaw=Math.atan2(tz,tx);
     this.put(this.carriers[0],platform.renderPos.x+tx/2,platform.renderPos.y+8,platform.renderPos.z+tz/2,trussYaw,0,Math.max(20,len),1,1);
     // Shoes remain visibly attached to both the ordinary hub and each carriage.
     for(const f of [.15,.7])this.put(this.carriers[1],platform.renderPos.x+tx*f,platform.renderPos.y+9,platform.renderPos.z+tz*f,trussYaw,0,1,1,1);
     const charge=elapsed>=7.1&&elapsed<7.5?(elapsed-7.1)/.4:elapsed>=1.3&&elapsed<1.5?(elapsed-1.3)/.2:-1;
     if(charge>=0)this.charges.push({point:{x:member.layout==='folded'?platform.renderPos.x+(x-platform.renderPos.x)*.85:x-Math.cos(p.yaw)*22*s,y:y+53*s,z:member.layout==='folded'?platform.renderPos.z+(z-platform.renderPos.z)*.85:z-Math.sin(p.yaw)*22*s},color:ARCHETYPES[type].color,strength:charge});
     this.stats.heads++;
    }
   }
  }
  for(const mesh of [...this.carriers,...Array.from(this.batches.values()).flat()]){
   mesh.visible=mesh.count>0;if(!mesh.count)continue;
   // Capacity reserves several simultaneous owners; upload only the live prefix.
   for(const attribute of [mesh.instanceMatrix,mesh.geometry.getAttribute('instanceFolded') as InstancedBufferAttribute|undefined,mesh.geometry.getAttribute('instanceOpen') as InstancedBufferAttribute|undefined])if(attribute){attribute.clearUpdateRanges();attribute.addUpdateRange(0,mesh.count*attribute.itemSize);attribute.needsUpdate=true;}
   this.stats.batches++;this.stats.triangles+=mesh.count*(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3;
  }
  this.stats.peakHeads=Math.max(this.stats.peakHeads,this.stats.heads);
 }
 dispose(){for(const off of this.off)off();for(const mesh of [...this.carriers,...Array.from(this.batches.values()).flat()]){this.scene.remove(mesh);mesh.dispose();mesh.geometry.dispose();}this.armor.dispose();this.batchMaterial.dispose();this.receiverMaterial.dispose();this.depthMaterial.dispose();this.rigs.clear();this.launches.clear();}
}
