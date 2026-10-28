import { expect, it } from 'vitest';
import { buildArchitectBatteryPaths, getArchitectBatteryHeadPose, planArchitectBatteryLayout, planArchitectBatteryFormation, sampleArchitectBatteryArc } from '../src/skills/misc/ArchitectBatteryPose';
import { ARCHITECT_TYPES } from '../src/data/architectLoadout';

const carrier={x:0,y:0,z:-1500,heading:Math.PI},center={x:0,y:0,z:0};
const water=()=>-100;
const input={carrier,center,radius:1500,slot:0,stage:0 as const,type:'furnace' as const,layout:'wide' as const,groundHeight:water};

it('keeps full paired artillery over islands instead of folding or omitting heads',()=>{
  expect(planArchitectBatteryLayout(carrier,center,water)).toBe('wide');
  expect(planArchitectBatteryLayout(carrier,center,()=>600)).toBe('wide');
  const ground=(x:number,z:number)=>Math.abs(x-2300)<600&&Math.abs(z-2200)<800?420:-100;
  const a=planArchitectBatteryFormation({x:4400,z:4400},10,ground);
  expect(a).toEqual(planArchitectBatteryFormation({x:4400,z:4400},10,ground));
  expect(a).toHaveLength(10);expect(new Set(a.map(p=>`${p.x}:${p.z}`)).size).toBe(10);
  for(const p of a){expect(Math.abs(p.x)).toBeLessThan(4200);expect(Math.abs(p.z)).toBeLessThan(4200);expect(p.y).toBeGreaterThanOrEqual(55);for(let x=-260;x<=260;x+=20)for(let z=-260;z<=260;z+=20)expect(p.y).toBeGreaterThan(ground(p.x+x,p.z+z)+35);}
});

it('transports only ordinary hubs before building machinery between .9 and 1.5 seconds',()=>{
  const {g,fx}=fixture();run(g,.85);g.interpolate();fx.prepare(0);expect(fx.stats.machinery.heads).toBe(0);
  run(g,.4);g.interpolate();fx.prepare(0);expect(fx.stats.machinery.heads).toBe(20);
  const pose=getArchitectBatteryHeadPose({...input,head:0,elapsed:1.5});expect(pose.carriage).toBe(1);expect(pose.lock).toBe(1);fx.dispose();
});

it('keeps two separated cosmetic cells inside each spoke and shares launch sockets with deployed receiver poses',()=>{
  for(const type of ARCHITECT_TYPES)for(const stage of [0,1,2,3] as const){
    const paths=buildArchitectBatteryPaths({...input,type,stage});
    expect(paths).toHaveLength(2);
    expect(Math.hypot(paths[0].impact.x-paths[1].impact.x,paths[0].impact.z-paths[1].impact.z)).toBeGreaterThan(350);
    for(const head of [0,1] as const){
      const pose=getArchitectBatteryHeadPose({...input,type,stage,head,elapsed:1.5});
      expect(pose.muzzle).toEqual(paths[head].muzzle);
      const tangent={x:paths[head].control.x-pose.muzzle.x,y:paths[head].control.y-pose.muzzle.y,z:paths[head].control.z-pose.muzzle.z};
      expect(Math.atan2(tangent.y,Math.hypot(tangent.x,tangent.z))).toBeCloseTo(pose.pitch,5);
      expect(Math.atan2(tangent.z,tangent.x)).toBeCloseTo(pose.yaw,5);
      expect(Math.hypot(paths[head].impact.x,paths[head].impact.z)).toBeLessThan(1500);
    }
  }
});

it('raises committed arcs above sampled terrain without mutating carrier inputs',()=>{
  const before=JSON.stringify(input),groundHeight=(_x:number,z:number)=>z>-1100&&z<-700?600:-100;
  const paths=buildArchitectBatteryPaths({...input,groundHeight});
  for(const path of paths)for(let n=0;n<=64;n++){
    const p=sampleArchitectBatteryArc(path,n/64);
    expect(p.y).toBeGreaterThanOrEqual(groundHeight(p.x,p.z));
  }
  expect(JSON.stringify(input)).toBe(before);
});

it('uses authored deployment and receiver-only recoil, with reduced motion retaining both head sockets',()=>{
  const folded=getArchitectBatteryHeadPose({...input,head:0,elapsed:0});
  const open=getArchitectBatteryHeadPose({...input,head:0,elapsed:1.5});
  expect(folded.scale).toBe(open.scale);
  expect(folded.extension).toBeGreaterThanOrEqual(.3);
  const normal=getArchitectBatteryHeadPose({...input,head:0,elapsed:2,recoilAge:.07});
  const reduced=getArchitectBatteryHeadPose({...input,head:0,elapsed:2,recoilAge:.07,reducedMotion:true});
  expect(normal.position).toEqual(open.position);
  expect(normal.recoil).toBeCloseTo(28);
  expect(reduced.recoil).toBeCloseTo(5.6);
});

import { BufferAttribute, InstancedMesh, Matrix4, Scene, Vector3 } from 'three';
import { ArchitectBatteryFx, BATTERY_FX_CAPS } from '../src/render/ArchitectBatteryFx';
import { siegeBatchGeometry } from '../src/render/ArchitectSiege';
import { ShipView } from '../src/render/ShipModel';
import { emptyGame, place, run } from './helpers';
import { stateHash } from '../src/net/hash';
import type { ArchitectBatteryLaunch } from '../src/data/architectBattery';

function fixture(){
 const g=emptyGame('open',7,'freeplay'),owner=place(g,'architect',0,0,3000),scene=new Scene(),fx=new ArchitectBatteryFx(scene,g);
 owner.throttle=2;owner.speed=0;owner.control.aimX=owner.control.aimZ=0;owner.meter=1;owner.activateSkill(7);
 return {g,owner,scene,fx};
}

it('keeps the ten ordinary turrets, logical platforms and HP pools while rendering twenty connected heads',()=>{
 const {g,owner,fx,scene}=fixture();run(g,1.6);g.interpolate();const before=stateHash(g),health=owner.architect!.slots.map(a=>a.entity!.hp);
 fx.prepare(0);expect(fx.stats.machinery.heads).toBe(20);expect(fx.stats.machinery.carriers).toBe(10);
 expect(g.ships.filter(s=>s.architectPlatform&&s.alive)).toHaveLength(10);
 const launch=g.battery.pending.find(r=>r.slot===0)!,member=owner.architect!.ultimate!.battery!.members.find(m=>m.slot===0)!,platform=owner.architect!.slots[0].entity!;
 const pose=getArchitectBatteryHeadPose({...input,carrier:member.carrier,layout:member.layout,type:launch.type,head:0,elapsed:owner.architect!.ultimate!.elapsed,recoilAge:g.time-launch.launchTime,path:launch.paths[0]});
 const actual=new Vector3(pose.socketX,pose.socketY,0),barrel=scene.getObjectByName('architect-battery-furnace-2') as InstancedMesh,transform=new Matrix4();barrel.getMatrixAt(0,transform);actual.applyMatrix4(transform);
 expect(actual.x).toBeCloseTo(pose.muzzle.x+platform.renderPos.x-member.carrier.x,3);expect(actual.y).toBeCloseTo(pose.muzzle.y+platform.renderPos.y-member.carrier.y,3);expect(actual.z).toBeCloseTo(pose.muzzle.z+platform.renderPos.z-member.carrier.z,3);

 const view=new ShipView(owner.architect!.slots[0].entity!.spec);view.update(owner.architect!.slots[0].entity!,g.renderTime);
 const turrets=(view as unknown as {turrets:{yaw:{visible:boolean}}[]}).turrets;
 expect(turrets[0].yaw.visible).toBe(true);
 expect(owner.architect!.slots.map(a=>a.entity!.hp)).toEqual(health);expect(stateHash(g)).toBe(before);view.dispose();fx.dispose();
});

it('instances all twelve hardware identities within the batch and low detail geometry budgets',()=>{
 for(const type of ARCHITECT_TYPES){
  const high=siegeBatchGeometry(type),low=siegeBatchGeometry(type,true);
  for(const batches of [high,low])for(const geometry of batches){geometry.computeBoundingBox();expect(Array.from(geometry.attributes.position.array).every(Number.isFinite)).toBe(true);}
  expect(high.reduce((n,g)=>n+g.attributes.position.count/3,0)).toBeLessThanOrEqual(5000);
  expect(low.reduce((n,g)=>n+g.attributes.position.count/3,0)).toBeLessThanOrEqual(1200);
 }
 const {g,owner,fx}=fixture();owner.architect!.slots.forEach((a,i)=>a.type=ARCHITECT_TYPES[i]);
 const other=place(g,'architect',0,1000,3000);other.architect!.slots.forEach(a=>a.type='swarm');other.control.aimX=other.control.aimZ=0;other.meter=1;other.activateSkill(7);
 run(g,1.5);fx.prepare(0);expect(fx.stats.machinery.batches).toBeLessThanOrEqual(46);expect(fx.stats.machinery.heads).toBe(40);fx.dispose();
});

it('keeps launched world paths after platform loss or concealment, clears hard owner generations, and is hash pure',()=>{
 const {g,owner,fx}=fixture();let first:ArchitectBatteryLaunch|undefined;g.events.on('architectBatteryLaunch',e=>{first??=e;});run(g,1.55);g.interpolate();
 expect(first).toBeDefined();owner.architect!.slots[first!.slot].entity!.takeDamage(1e9,null,null,false,true);owner.mods.untargetable=true;
 const before=stateHash(g);fx.prepare(1);expect(fx.pools.shells.count).toBeGreaterThan(0);expect(fx.stats.machinery.heads).toBe(18);expect(stateHash(g)).toBe(before);
 g.battery.cancelOwner(owner);fx.prepare(1);expect(fx.count).toBe(0);expect(fx.stats.machinery.heads).toBe(0);expect(fx.hazard.count).toBe(0);fx.dispose();
});

it('reserves opaque damage-timed contacts, merges coincident hit feedback, and conceals victim-attached details per viewport',()=>{
 const {g,fx}=fixture(),victim=place(g,'leviathan',1,8000,8000);victim.mods.untargetable=true;
 let launch:ArchitectBatteryLaunch|undefined;g.events.on('architectBatteryLaunch',e=>{launch??=e;});run(g,1.55);victim.mods.untargetable=true;
 for(let i=0;i<5;i++)g.events.emit('architectBatteryImpact',{launch:launch!,resolvedAt:g.time-.1,recipients:[{target:victim,x:8000,y:40,z:8000,damage:50000}]});
 fx.prepare(0);const concealed=fx.pools.lobes.count;fx.prepare(1);expect(fx.pools.lobes.count-concealed).toBe(2);expect(fx.stats.mergedContacts).toBe(4);
 expect((fx.pools.lobes.mesh.material as any).transparent).toBe(false);expect((fx.pools.lobes.mesh.material as any).depthWrite).toBe(true);fx.dispose();
});

it('renders the exact committed shell position and no source anchor rays, then yields recovery to a new command',()=>{
 const {g,owner,fx}=fixture();let launch:ArchitectBatteryLaunch|undefined;g.events.on('architectBatteryLaunch',e=>{launch??=e;});run(g,1.6);fx.prepare(0);
 const matrix=new Matrix4(),point=new Vector3();fx.pools.shells.mesh.getMatrixAt(0,matrix);point.setFromMatrixPosition(matrix);
 const expected=sampleArchitectBatteryArc(launch!.paths[0],(g.time-launch!.launchTime)/.42);
 expect(point.x).toBeCloseTo(expected.x,3);expect(point.y).toBeCloseTo(expected.y,3);expect(point.z).toBeCloseTo(expected.z,3);
 run(g,6);fx.prepare(0);expect(owner.architect!.ultimate).toBeNull();expect(fx.stats.machinery.heads).toBe(20);expect(fx.hazard.count).toBeGreaterThan(0);
 owner.activateSkill(4);fx.prepare(0);expect(fx.stats.machinery.heads).toBe(20);expect(fx.pools.shells.count).toBeGreaterThan(0);run(g,.31);fx.prepare(0);expect(fx.stats.machinery.heads).toBe(0);
 run(g,2);fx.prepare(0);expect(fx.count).toBe(0);expect(fx.hazard.count).toBe(0);fx.dispose();
});

it('bounds synchronous three-owner finales, prioritizes semantic feedback and cleans every render instance',()=>{
 const {g,owner,fx,scene}=fixture();let launch:ArchitectBatteryLaunch|undefined;g.events.on('architectBatteryLaunch',e=>{launch??=e;});run(g,1.55);
 const victims=Array.from({length:20},(_,i)=>place(g,'yamato',1,100+i*60,0));
 for(let i=0;i<30;i++)g.events.emit('architectBatteryImpact',{launch:{...launch!,id:100+i,castId:i%3,slot:i%10,stage:3},resolvedAt:g.time-.22,recipients:victims.map(target=>({target,x:target.pos.x,y:30,z:target.pos.z,damage:90000}))});
 const before=stateHash(g);fx.prepare(-1);expect(fx.stats.batches).toBeLessThanOrEqual(10);expect(fx.pools.lobes.count).toBeGreaterThanOrEqual(40);
 for(const name of Object.keys(BATTERY_FX_CAPS) as (keyof typeof BATTERY_FX_CAPS)[])expect(fx.pools[name].count).toBeLessThanOrEqual(BATTERY_FX_CAPS[name]);
 expect(fx.pools.skirts.count+fx.pools.pressure.count).toBeLessThanOrEqual(96);
 for(const mesh of scene.children.filter(x=>x instanceof InstancedMesh) as InstancedMesh[])expect(Array.from(mesh.instanceMatrix.array).every(Number.isFinite)).toBe(true);
 expect(stateHash(g)).toBe(before);g.finish(-1,'test');fx.prepare(-1);expect(fx.count).toBe(0);expect(fx.stats.machinery.heads).toBe(0);fx.dispose();expect(scene.children).toHaveLength(0);
 expect(owner.architect).toBeTruthy();
});

import { banish } from '../src/skills/kit';

it('keeps public committed flight and visible platforms when only the owner is banished',()=>{
 const {g,owner,fx}=fixture(),victim=place(g,'leviathan',1,0,0);victim.hp=victim.maxHp=1e9;
 run(g,1.5);g.interpolate();fx.prepare(0);expect(fx.pools.shells.count).toBeGreaterThan(0);
 const generation=g.battery.generation(owner),pending=g.battery.pending.length;
 banish(owner,3);run(g,1/60);expect(owner.mods.banished).toBe(true);fx.prepare(0);
 expect(g.battery.generation(owner)).toBe(generation);expect(g.battery.pending.length).toBe(pending);
 expect(fx.stats.machinery.heads).toBe(20);expect(fx.pools.shells.count).toBeGreaterThan(0);expect(fx.hazard.count).toBeGreaterThan(0);
 run(g,.5);fx.prepare(0);expect(fx.stats.committedImpacts).toBeGreaterThan(0);expect(fx.pools.lobes.count).toBeGreaterThan(0);fx.dispose();
});

it.each([true,false])('permanently retires a Battery after Reconfigure, including sparse renders=%s',sparse=>{
 const {g,owner,fx}=fixture();run(g,1.6);fx.prepare(0);expect(fx.stats.machinery.heads).toBe(20);
 run(g,5.9);const paths=g.battery.pending.map(r=>JSON.stringify(r.paths));expect(paths.length).toBeGreaterThan(0);
 expect(owner.activateSkill(3)).toBe(true);
 if(!sparse){run(g,1/60);fx.prepare(0);expect(fx.stats.machinery.heads).toBe(20);expect(fx.pools.shells.count).toBeGreaterThan(0);expect(g.battery.pending.map(r=>JSON.stringify(r.paths))).toEqual(paths);}
 run(g,.65);expect(owner.architect!.slots.every(a=>a.state==='deployed')).toBe(true);fx.prepare(0);
 expect(fx.stats.machinery.heads).toBe(0);expect(fx.stats.committedImpacts).toBe(40);fx.dispose();
});

it('gives a folded shoreline pair two tall vertical launch sockets while retaining the original hub footprint',()=>{
 for(const type of ['prism','resonance'] as const)for(const head of [0,1] as const){
  const args={...input,type,layout:'folded' as const,head,elapsed:1.5},pose=getArchitectBatteryHeadPose(args),path=buildArchitectBatteryPaths(args)[head];
  expect(pose.muzzle.y-carrier.y).toBeGreaterThan(150);
  expect(pose.pitch).toBeCloseTo(Math.PI/2,5);
  expect(pose.muzzle).toEqual(path.muzzle);expect(path.control.x).toBeCloseTo(path.muzzle.x,5);expect(path.control.z).toBeCloseTo(path.muzzle.z,5);
  expect(Math.abs(pose.position.x-carrier.x)).toBeLessThan(22);expect(Math.abs(pose.position.z-carrier.z)).toBeLessThan(40);
 }
 const a=getArchitectBatteryHeadPose({...input,layout:'folded',head:0,elapsed:1.5}),b=getArchitectBatteryHeadPose({...input,layout:'folded',head:1,elapsed:1.5});
 expect(Math.hypot(a.position.x-b.position.x,a.position.z-b.position.z)).toBeGreaterThanOrEqual(50);
});


it('renders the authored folded mortars inside the legal footprint with exact world muzzle matrices',()=>{
 const {g,owner,fx,scene}=fixture(),u=owner.architect!.ultimate!;
 u.battery={...u.battery!,members:u.battery!.members.map(m=>({...m,layout:'folded' as const}))};
 run(g,1.6);g.interpolate();fx.prepare(0);
 const member=u.battery.members[0],platform=owner.architect!.slots[0].entity!,launch=g.battery.pending.find(r=>r.slot===member.slot)!;
 for(const head of [0,1] as const){
  const pose=getArchitectBatteryHeadPose({...input,carrier:member.carrier,layout:'folded',type:launch.type,head,elapsed:u.elapsed,recoilAge:g.time-launch.launchTime,path:launch.paths[head]});
  const mesh=scene.getObjectByName('architect-battery-furnace-2') as InstancedMesh,matrix=new Matrix4();mesh.getMatrixAt(head,matrix);
  const actual=new Vector3(pose.socketX,pose.socketY,0).applyMatrix4(matrix);
  expect(actual.x).toBeCloseTo(pose.muzzle.x+platform.renderPos.x-member.carrier.x,3);expect(actual.y).toBeCloseTo(pose.muzzle.y+platform.renderPos.y-member.carrier.y,3);expect(actual.z).toBeCloseTo(pose.muzzle.z+platform.renderPos.z-member.carrier.z,3);
  for(let part=0;part<4;part++){
   const batch=scene.getObjectByName(`architect-battery-furnace-${part}`) as InstancedMesh;batch.getMatrixAt(head,matrix);
   expect(batch.geometry.getAttribute('instanceFolded').getX(head)).toBe(1);
   const vertices=batch.geometry.attributes.position,layout=batch.geometry.getAttribute('layoutPart');
   for(let n=0;n<vertices.count;n++)if(layout.getX(n)===1){
    const point=new Vector3().fromBufferAttribute(vertices,n).applyMatrix4(matrix).sub(platform.renderPos);
    const along=point.x*Math.sin(member.carrier.heading)-point.z*Math.cos(member.carrier.heading),across=point.x*Math.cos(member.carrier.heading)+point.z*Math.sin(member.carrier.heading);
    expect(Math.abs(along)).toBeLessThanOrEqual(40.001);expect(Math.abs(across)).toBeLessThanOrEqual(22.001);
   }
  }
 }
 expect(fx.stats.machinery.heads).toBe(20);expect(fx.stats.machinery.batches).toBeLessThanOrEqual(46);fx.dispose();
});


it('uploads only live Battery instance data and submits no empty machinery or effects',()=>{
 const {g,fx,scene}=fixture();run(g,1.6);g.interpolate();const before=stateHash(g);fx.prepare(0);
 // Two prepares may occur before a renderer upload; stale ranges must not accumulate.
 fx.prepare(0);
 const meshes=scene.children.filter(x=>x instanceof InstancedMesh) as InstancedMesh[];
 for(const mesh of meshes){
  expect(mesh.visible).toBe(mesh.count>0);
  if(!mesh.count)continue;
  const attributes=[mesh.instanceMatrix,mesh.instanceColor,...['instanceFolded','instanceOpen','instanceFade'].map(k=>mesh.geometry.getAttribute(k))].filter(Boolean);
  for(const attribute of attributes){
   expect(attribute).toBeInstanceOf(BufferAttribute);if(!(attribute instanceof BufferAttribute))continue;
   const uploaded=attribute.updateRanges.reduce((n,r)=>n+r.count,0);
   expect(uploaded).toBe(mesh.count*attribute!.itemSize);
  }
 }
 expect(stateHash(g)).toBe(before);
 g.finish(-1,'test');fx.prepare(-1);
 for(const mesh of meshes)expect(mesh.visible).toBe(false);
 const versions=meshes.map(mesh=>mesh.instanceMatrix.version);fx.prepare(-1);
 expect(meshes.map(mesh=>mesh.instanceMatrix.version)).toEqual(versions);fx.dispose();
});

it('retains volumetric neon trails briefly after impact and cleans them on hard owner reset',()=>{
 const {g,owner,fx}=fixture();run(g,1.96);fx.prepare(0);
 expect(fx.pools.trails.count).toBeGreaterThan(0);expect(fx.pools.trails.mesh.material).toHaveProperty('transparent',true);
 g.battery.cancelOwner(owner);fx.prepare(0);expect(fx.pools.trails.count).toBe(0);fx.dispose();
});

it('gives five elemental impacts distinct volumetric silhouettes larger than the artillery footprint',()=>{
 const signatures=[];
 for(const type of ['furnace','cryo','storm','gravity','prism'] as const){
  const {g,fx}=fixture();run(g,1.55);const launch=g.battery.pending[0];
  g.events.emit('architectBatteryImpact',{launch:{...launch,type,element:type},resolvedAt:g.time-.3,recipients:[]});fx.prepare(0);
  signatures.push(Object.values(fx.pools).map(p=>p.count).join(','));
  const matrix=new Matrix4(),scale=new Vector3();let largest=0;
  for(const name of ['lobes','fragments','skirts','arcs'] as const){const p=fx.pools[name];for(let i=0;i<p.count;i++){p.mesh.getMatrixAt(i,matrix);scale.setFromMatrixScale(matrix);largest=Math.max(largest,scale.length());}}
  expect(largest).toBeGreaterThan(220);fx.dispose();
 }
 expect(new Set(signatures).size).toBe(5);
});

it('creates elemental destruction only on true platform loss and clears it on match end',()=>{
 const {g,owner,fx}=fixture();run(g,1.6);const before=stateHash(g);
 g.events.emit('architectCommand',{ship:owner,kind:'recall'});fx.prepare(0);expect(fx.stats.activeDeaths).toBe(0);expect(stateHash(g)).toBe(before);
 owner.architect!.slots[0].entity!.takeDamage(1e9,null,null,false,true);fx.prepare(0);expect(fx.stats.activeDeaths).toBe(1);
 g.finish(-1,'test');fx.prepare(0);expect(fx.stats.activeDeaths).toBe(0);fx.dispose();
});
