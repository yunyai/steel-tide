import { expect, it } from 'vitest';
import { Scene } from 'three';
import { ShipView } from '../src/render/ShipModel';
import { ArchitectFx } from '../src/render/ArchitectFx';
import { emptyGame, place, run } from './helpers';
import { stateHash } from '../src/net/hash';

it('shows ten docking modules and removes the exact deployed turrets from the hull',()=>{
  const g=emptyGame('open',7,'freeplay'),s=place(g,'architect',0,0,1500);
  const view=new ShipView(s.spec);view.update(s,0);
  const docks=Array.from({length:10},(_,i)=>view.root.getObjectByName(`architect-dock-${i}`)!);
  expect(docks.every(d=>d?.visible)).toBe(true);
  s.control.aimX=800;s.control.aimZ=0;s.activateSkill(0);view.update(s,0);
  expect(docks.filter(d=>d.visible)).toHaveLength(8);
  expect(view.root.getObjectByName('architect-turret-0')!.visible).toBe(false);
  expect(view.root.getObjectByName('architect-turret-2')!.visible).toBe(true);
  view.dispose();
});
it('draws fortress panels and charge geometry without consuming simulation state',()=>{
  const g=emptyGame('open',7,'freeplay'),s=place(g,'architect',0,0,1500);
  s.throttle=2;s.speed=0;s.meter=1;s.activateSkill(8);run(g,2);
  const fx=new ArchitectFx(new Scene(),g),before=stateHash(g);
  fx.update(.1,[s]);fx.prepare(0,720);
  expect(fx.ribbons.count).toBeGreaterThan(20);expect(fx.panels.count).toBe(10);
  expect(stateHash(g)).toBe(before);
  g.finish(-1,'test');fx.prepare(0,720);expect(fx.panels.count).toBe(0);expect(fx.ribbons.count).toBe(0);
  fx.dispose();
});

it('keeps Citadel wall bottoms at water across a shoreline and accepts unequal airborne heights',()=>{
  const g=emptyGame('open',7,'freeplay'),s=place(g,'architect',0,0,1500);
  s.throttle=2;s.speed=0;s.meter=1;s.activateSkill(8);run(g,2);
  // Land at one endpoint must not pull the whole shield face above the adjacent water.
  g.map.heightAt=(x:number)=>x>0?100:-100;
  const m=s.architect!.slots[0].entity!;m.pos.y+=80;m.prevPos.copy(m.pos);g.interpolate();
  const fx=new ArchitectFx(new Scene(),g);fx.prepare(0,720);
  const heights=fx.panels.geometry.getAttribute('iHeights');
  expect(fx.panels.count).toBe(10);
  for(let i=0;i<fx.panels.count;i++){
    expect(heights.getX(i)).toBeLessThan(5);expect(heights.getY(i)).toBeLessThan(5);
    expect(heights.getZ(i)).toBeGreaterThan(200);expect(heights.getW(i)).toBeGreaterThan(200);
  }
  expect(Math.abs(heights.getZ(0)-heights.getW(0))).toBeGreaterThan(70);
  fx.dispose();
});

it('removes Citadel enclosures when only one participating platform survives',()=>{
  const g=emptyGame('open',7,'freeplay'),s=place(g,'architect',0,0,1500);
  s.throttle=2;s.speed=0;s.meter=1;s.activateSkill(8);run(g,2);
  const fx=new ArchitectFx(new Scene(),g);
  for(const slot of s.architect!.slots.slice(2))slot.entity!.takeDamage(1e9,null,null,false,true);
  g.interpolate();fx.prepare(0,720);expect(fx.panels.count).toBe(1);
  s.architect!.slots[1].entity!.takeDamage(1e9,null,null,false,true);
  fx.prepare(0,720);expect(fx.panels.count).toBe(0);fx.dispose();
});

it('shows only surviving Assembly satellites and clears the cannon when the battle ends',()=>{
  const g=emptyGame('open',7,'freeplay'),s=place(g,'architect',0,0,1500);
  s.throttle=2;s.speed=0;s.meter=1;s.activateSkill(6);
  s.architect!.slots[3].entity!.takeDamage(1e9,null,null,false,true);run(g,2);g.interpolate();
  const view=new ShipView(s.spec),before=stateHash(g);view.update(s,g.renderTime);
  const satellites=Array.from({length:10},(_,i)=>view.root.getObjectByName(`architect-satellite-${i}`)!);
  expect(satellites.filter(m=>m.visible)).toHaveLength(9);expect(satellites[3].visible).toBe(false);
  expect(stateHash(g)).toBe(before);
  g.finish(-1,'test');view.update(s,g.renderTime);
  expect(view.root.getObjectByName('architect-final-assembly')!.visible).toBe(false);view.dispose();
});

it.each([4,400])('keeps the Assembly blast and travelling rings at muzzle height when aiming at y=%s',targetY=>{
  const g=emptyGame('open',7,'freeplay'),s=place(g,'architect',0,0,1500),fx=new ArchitectFx(new Scene(),g);
  const before=stateHash(g);
  g.events.emit('architectShot',{ship:s,x:0,y:24,z:1500,tx:0,ty:targetY,tz:-4500,width:180,kind:'assembly'});
  fx.update(.1,[s]);fx.prepare(0,720);
  const geo=fx.ribbons.mesh.geometry,a=geo.getAttribute('iA'),b=geo.getAttribute('iB');
  const beam=Array.from({length:fx.ribbons.count},(_,i)=>i).filter(i=>Math.abs(a.getZ(i)-b.getZ(i))>300);
  expect(beam.length).toBeGreaterThan(0);
  for(const i of beam){expect(a.getY(i)).toBeCloseTo(125);expect(b.getY(i)).toBeCloseTo(125);}
  const rings=Array.from({length:fx.ribbons.count},(_,i)=>i).filter(i=>a.getZ(i)<500&&Math.abs(a.getZ(i)-b.getZ(i))<1);
  expect(rings.length).toBeGreaterThan(0);
  const ys=rings.flatMap(i=>[a.getY(i),b.getY(i)]);
  expect((Math.min(...ys)+Math.max(...ys))/2).toBeCloseTo(125);
  expect(stateHash(g)).toBe(before);fx.dispose();
});
