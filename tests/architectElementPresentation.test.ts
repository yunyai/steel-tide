import { expect,it } from 'vitest';
import { InstancedMesh,Matrix4,Scene,Vector3 } from 'three';
import { ArchitectElementFx } from '../src/render/ArchitectElementFx';
import { architectTurretGeometry } from '../src/render/ArchitectModel';
import { ELEMENTS,ELEMENT_STYLE } from '../src/skills/misc/ArchitectElements';
import { emptyGame,place,run } from './helpers';
import { stateHash } from '../src/net/hash';
it('gives five modules different finite hardware within their docking footprints',()=>{const counts=[];for(const e of ELEMENTS){const g=architectTurretGeometry(e);g.house.computeBoundingBox();expect(g.house.boundingBox!.max.y).toBeLessThan(50);expect(g.house.boundingBox!.max.z).toBeLessThan(25);expect(Array.from(g.house.attributes.position.array).every(Number.isFinite)).toBe(true);counts.push(g.house.attributes.position.count);g.house.dispose();g.guns.dispose();}expect(new Set(counts).size).toBeGreaterThanOrEqual(4);expect(new Set(Object.values(ELEMENT_STYLE).map(s=>s.color)).size).toBe(5);});
it('bounds elemental effects, conceals emitters per viewport, clears lifecycle events and never changes simulation',()=>{const g=emptyGame('open',7,'freeplay'),s=place(g,'architect',1,0,2500),scene=new Scene(),fx=new ArchitectElementFx(scene,g);place(g,'yamato',0,0,-3000);s.mods.untargetable=true;const h=stateHash(g);for(let i=0;i<500;i++)g.events.emit('architectElement',{ship:s,slot:i%10,element:ELEMENTS[i%5],attack:'skill',phase:'hit',id:i,x:0,y:50,z:2500,tx:i*5,ty:12,tz:500,radius:450});fx.update(.1);fx.prepare(0);expect(fx.count).toBe(0);fx.prepare(1);expect(fx.count).toBeGreaterThan(0);expect(fx.count).toBeLessThanOrEqual(1024);for(const mesh of scene.children as any[])expect(Array.from(mesh.instanceMatrix.array).every(Number.isFinite)).toBe(true);expect(stateHash(g)).toBe(h);g.events.emit('respawn',{ship:s});fx.prepare(1);expect(fx.count).toBe(0);fx.dispose();expect(scene.children).toHaveLength(0);});
import {ARCHITECT_TYPES} from '../src/data/architectLoadout';
import {siegeGeometry,ArchitectSiege} from '../src/render/ArchitectSiege';
it('builds twelve finite articulated siege cannons and hides destroyed participants',()=>{
 const signatures=[];for(const type of ARCHITECT_TYPES){const geo=siegeGeometry(type);expect(geo).toHaveLength(6);signatures.push(geo.map(g=>g.attributes.position.count).join(','));for(const g of geo)expect(Array.from(g.attributes.position.array).every(Number.isFinite)).toBe(true);}
 expect(new Set(signatures).size).toBe(ARCHITECT_TYPES.length);
 const g=emptyGame('open',1,'freeplay'),s=place(g,'architect',0,0,3000);s.control.aimX=s.control.aimZ=0;s.meter=1;s.activateSkill(7);const m=s.architect!.slots[0].entity!,model=new ArchitectSiege(new Scene(),g);run(g,1.5);model.prepare(0);expect(model.stats.heads).toBe(20);m.takeDamage(1e9,null,null,false,true);model.prepare(0);expect(model.stats.heads).toBe(18);model.dispose();
});

it('keeps stored capacitor cores above the opaque docked gun housings',()=>{
 const g=emptyGame('open',1,'freeplay'),s=place(g,'architect',0,0,1500),scene=new Scene(),fx=new ArchitectElementFx(scene,g);
 s.architect!.slots[0].capacitorCharged=true;g.interpolate();fx.prepare(0);
 const mesh=scene.getObjectByName('architect-elements-2') as InstancedMesh,matrix=new Matrix4();expect(mesh.count).toBe(1);mesh.getMatrixAt(0,matrix);
 const socket=s.spec.main!.turrets[0],house=architectTurretGeometry(s.architect!.slots[0].type).house;house.computeBoundingBox();
 expect(new Vector3().setFromMatrixPosition(matrix).y).toBeGreaterThan(s.renderPos.y+s.spec.freeboard+socket.y+12+house.boundingBox!.max.y);
 house.dispose();fx.dispose();
});

it.each([[0,0,-1],[0,1,0],[Math.PI/2,1,0],[Math.PI/2,0,-1]])('anchors Vector exhaust to the physical stern at hull heading %s and drive %s/%s',(heading,dx,dz)=>{
 const g=emptyGame('open',1,'freeplay'),s=place(g,'architect',0,0,1500),scene=new Scene(),fx=new ArchitectElementFx(scene,g);
 s.architect!.slots[0].type='vector';s.architect!.drive={dx,dz,elapsed:.2,distance:650,moving:true,from:0,travelled:0,hit:[]};g.interpolate();s.renderHeading=heading;const before=stateHash(g);fx.prepare(0);
 const mesh=scene.getObjectByName('architect-elements-3') as InstancedMesh,matrix=new Matrix4();expect(mesh.count).toBe(4);
 for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,matrix);const ends=[-.5,.5].map(y=>new Vector3(0,y,0).applyMatrix4(matrix));expect(ends.some(p=>{const x=p.x-s.renderPos.x,z=p.z-s.renderPos.z,across=x*Math.cos(heading)+z*Math.sin(heading),along=x*Math.sin(heading)-z*Math.cos(heading);return Math.abs(across)<=s.spec.beam/2&&along < -s.spec.length*.25&&along > -s.spec.length*.5;})).toBe(true);}
 expect(stateHash(g)).toBe(before);fx.dispose();
});

it('stops Vector exhaust when movement is blocked or the last Vector is lost',()=>{
 const g=emptyGame('open',1,'freeplay'),s=place(g,'architect',0,0,1500),fx=new ArchitectElementFx(new Scene(),g);
 s.architect!.slots[0].type='vector';const drive={dx:1,dz:0,elapsed:.2,distance:800,moving:false,from:0,travelled:0,hit:[] as number[]};s.architect!.drive=drive;
 fx.prepare(0);expect(fx.count).toBe(0);
 drive.moving=true;fx.prepare(0);expect(fx.count).toBeGreaterThan(0);
 s.architect!.slots[0].hp=0;fx.prepare(0);expect(fx.count).toBe(0);fx.dispose();
});
