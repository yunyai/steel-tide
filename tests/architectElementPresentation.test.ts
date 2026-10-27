import { expect,it } from 'vitest';
import { Scene } from 'three';
import { ArchitectElementFx } from '../src/render/ArchitectElementFx';
import { architectTurretGeometry } from '../src/render/ArchitectModel';
import { ELEMENTS,ELEMENT_STYLE } from '../src/skills/misc/ArchitectElements';
import { emptyGame,place } from './helpers';
import { stateHash } from '../src/net/hash';
it('gives five modules different finite hardware within their docking footprints',()=>{const counts=[];for(const e of ELEMENTS){const g=architectTurretGeometry(e);g.house.computeBoundingBox();expect(g.house.boundingBox!.max.y).toBeLessThan(50);expect(g.house.boundingBox!.max.z).toBeLessThan(25);expect(Array.from(g.house.attributes.position.array).every(Number.isFinite)).toBe(true);counts.push(g.house.attributes.position.count);g.house.dispose();g.guns.dispose();}expect(new Set(counts).size).toBeGreaterThanOrEqual(4);expect(new Set(Object.values(ELEMENT_STYLE).map(s=>s.color)).size).toBe(5);});
it('bounds elemental effects, conceals emitters per viewport, clears lifecycle events and never changes simulation',()=>{const g=emptyGame('open',7,'freeplay'),s=place(g,'architect',1,0,2500),scene=new Scene(),fx=new ArchitectElementFx(scene,g);place(g,'yamato',0,0,-3000);s.mods.untargetable=true;const h=stateHash(g);for(let i=0;i<500;i++)g.events.emit('architectElement',{ship:s,slot:i%10,element:ELEMENTS[i%5],attack:'skill',phase:'hit',id:i,x:0,y:50,z:2500,tx:i*5,ty:12,tz:500,radius:450});fx.update(.1);fx.prepare(0);expect(fx.count).toBe(0);fx.prepare(1);expect(fx.count).toBeGreaterThan(0);expect(fx.count).toBeLessThanOrEqual(1024);for(const mesh of scene.children as any[])expect(Array.from(mesh.instanceMatrix.array).every(Number.isFinite)).toBe(true);expect(stateHash(g)).toBe(h);g.events.emit('respawn',{ship:s});fx.prepare(1);expect(fx.count).toBe(0);fx.dispose();expect(scene.children).toHaveLength(0);});
import {ARCHITECT_TYPES} from '../src/data/architectLoadout';
import {siegeGeometry,ArchitectSiege} from '../src/render/ArchitectSiege';
import {Mesh} from 'three';
it('builds eleven finite articulated siege cannons and hides destroyed participants',()=>{
 const signatures=[];for(const type of ARCHITECT_TYPES){const geo=siegeGeometry(type);expect(geo).toHaveLength(6);signatures.push(geo.map(g=>g.attributes.position.count).join(','));for(const g of geo)expect(Array.from(g.attributes.position.array).every(Number.isFinite)).toBe(true);}
 expect(new Set(signatures).size).toBe(11);
 const g=emptyGame('open',1,'freeplay'),s=place(g,'architect',0,0,3000);s.control.aimX=s.control.aimZ=0;s.meter=1;s.activateSkill(7);const m=s.architect!.slots[0].entity!,model=new ArchitectSiege((g,m)=>new Mesh(g,m));expect(model.pose(m,0)).toBe(true);m.takeDamage(1e9,null,null,false,true);expect(model.pose(m,1)).toBe(false);
});
