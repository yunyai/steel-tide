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
