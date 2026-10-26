import { expect, it } from 'vitest';
import { emptyGame, place, run } from './helpers';
import { hullHealthDisplay } from '../src/ui/HullHealth';
it('keeps the full maximum and shows detached capacity separately from damage',()=>{
  const g=emptyGame('open',713,'freeplay'),s=place(g,'architect',0,0,1500);
  s.control.aimX=800;s.control.aimZ=0;s.activateSkill(0);run(g,2);
  expect(hullHealthDisplay(s)).toEqual({maximum:2500000,reserved:200000,platformHp:400000,platformMaxHp:400000});
  s.architect!.slots[0].entity!.hp=100000;s.hp-=300000;
  expect(hullHealthDisplay(s)).toEqual({maximum:2500000,reserved:200000,platformHp:300000,platformMaxHp:400000});
});
it('keeps destroyed platform capacity gray until rebuilding restores it',()=>{
  const g=emptyGame('open',713,'freeplay'),s=place(g,'architect',0,0,1500);
  s.control.aimX=800;s.control.aimZ=0;s.activateSkill(0);run(g,2);
  s.architect!.slots[0].entity!.takeDamage(1e9,null,null,false,true);
  expect(hullHealthDisplay(s).reserved).toBe(200000);
  expect(hullHealthDisplay(s).platformMaxHp).toBe(200000);
  run(g,12);expect(hullHealthDisplay(s).reserved).toBe(100000);
});
it('uses ordinary max HP for other ships and for uninitialized scaled Architect hulls',()=>{
  const g=emptyGame(),s=place(g,'iowa',0,0,0);
  expect(hullHealthDisplay(s)).toEqual({maximum:s.maxHp,reserved:0,platformHp:0,platformMaxHp:0});
  const a=place(g,'architect',0,0,1500);a.maxHp=5000000;
  expect(hullHealthDisplay(a)).toEqual({maximum:5000000,reserved:0,platformHp:0,platformMaxHp:0});
});
