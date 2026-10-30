import {describe,it,expect} from 'vitest';
import {ALL} from '../src/data/ships';
import {Parts} from '../src/render/Geometry';
import {FLEET_DETAILS,addFleetDetails} from '../src/render/FleetDetails';
describe('fleet detailing',()=>{
 it('covers the entire remaining roster with bounded finite geometry without changing specs',()=>{
  for(const s of ALL){
   if(['stepper','tungsten','architect','architectPlatform'].includes(s.id)){expect(FLEET_DETAILS[s.id]).toBeUndefined();continue;}
   expect(FLEET_DETAILS[s.id],s.id).toBeDefined();const before=JSON.stringify(s),p=new Parts();addFleetDetails(p,s);const g=p.merge();
   const positions=Array.from(g.getAttribute('position').array);expect(positions.length,s.id).toBeGreaterThan(200);expect(positions.length,s.id).toBeLessThan(90000);expect(positions.every(Number.isFinite),s.id).toBe(true);expect(JSON.stringify(s)).toBe(before);g.dispose();
  }
 });
});
import {Scene} from 'three';
import {emptyGame,place} from './helpers';
import {stateHash} from '../src/net/hash';
import {FleetFx} from '../src/render/FleetFx';
it('bounds fleet geometry, preserves concealment per viewport, and cleans up without simulation writes',()=>{
 const g=emptyGame('open',7,'freeplay'),s=place(g,'gojoHonored',1,0,1500),fx=new FleetFx(new Scene(),g);place(g,'yamato',0,0,-4000);s.mods.untargetable=true;
 const hash=stateHash(g);
 for(let i=0;i<300;i++)g.events.emit('skill',{ship:s,index:6});
 fx.update(.15);fx.prepare(0);expect(fx.count).toBe(0);fx.prepare(1);expect(fx.count).toBeGreaterThan(0);expect(fx.count).toBeLessThanOrEqual(768);
 fx.prepare(0);expect(fx.count).toBe(0);s.mods.revealed=true;fx.prepare(0);expect(fx.count).toBeGreaterThan(0);s.mods.revealed=false;
 expect(stateHash(g)).toBe(hash);fx.update(3);fx.prepare(1);expect(fx.count).toBe(0);
 g.events.emit('skill',{ship:s,index:6});g.finish(-1,'done');fx.prepare(1);expect(fx.count).toBe(0);fx.dispose();
});
it('does not add fleet effects to Architect or Stepper',()=>{
 const g=emptyGame(),fx=new FleetFx(new Scene(),g);for(const id of ['stepper','architect']){const s=place(g,id,0,0,0);g.events.emit('skill',{ship:s,index:6});}fx.update(.1);fx.prepare(0);expect(fx.count).toBe(0);fx.dispose();
});
it('emits finite geometry for every included skill icon, not just the titan sample',()=>{
 const g=emptyGame('open',7,'freeplay'),fx=new FleetFx(new Scene(),g);
 for(const spec of ALL){if(!FLEET_DETAILS[spec.id])continue;const s=place(g,spec.id,0,0,1500);for(let index=0;index<s.skills.length;index++){
  g.events.emit('skill',{ship:s,index});fx.update(.15);fx.prepare(0);
  const pools=(fx as unknown as {pools:{instanceMatrix:{array:ArrayLike<number>}}[]}).pools;
  expect(pools.every(p=>Array.from(p.instanceMatrix.array).every(Number.isFinite)),s.skills[index].spec.id).toBe(true);fx.update(3);
 }s.withdraw();}
 fx.dispose();
});
