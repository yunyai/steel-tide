import { expect, it } from 'vitest';
import { emptyGame, place, run } from './helpers';
import { attachModule, materialize, preparePlatform } from '../src/skills/misc/ArchitectRuntime';
function setup(){
  const g=emptyGame('open',713,'freeplay'),s=place(g,'architect',0,0,1500),t=place(g,'leviathan',1,800,-1000);
  s.throttle=t.throttle=2;s.speed=t.speed=0;s.control.aimX=800;s.control.aimZ=0;
  s.activateSkill(0);run(g,2);return{g,s,t,slot:s.architect!.slots[0],m:s.architect!.slots[0].entity!};
}
it('doubles ordinary deployed shell damage and reloads in 4.5 seconds',()=>{
  const {g,s,m}=setup();g.shells.shells=[];m.turrets[0].reload=0;m.refreshModifiers();preparePlatform(m);
  m.fireTurret(0,'AP');
  const shells=g.shells.shells.filter(p=>p.owner===m);
  expect(shells).toHaveLength(2);expect(shells[0].spec.damage*shells[0].dmgMul).toBe(s.spec.main!.ap!.damage*2);
  expect(m.turrets[0].reload).toBe(4.5);expect(s.spec.main!.reload).toBe(6);
});
it('stacks Citadel reload to 2.25 seconds without another damage multiplier',()=>{
  const {g,s,m,slot}=setup();slot.state='citadel';m.refreshModifiers();preparePlatform(m);
  g.shells.shells=[];m.turrets[0].reload=0;m.fireTurret(0,'AP');
  expect(m.turrets[0].reload).toBe(2.25);
  expect(g.shells.shells[0].spec.damage*g.shells.shells[0].dmgMul).toBe(s.spec.main!.ap!.damage*2);
});
it('does not apply deployment bonuses to moving platforms or docked guns',()=>{
  const {s,m,slot}=setup();slot.state='moving';m.refreshModifiers();preparePlatform(m);
  expect(m.mods.damageMul).toBe(s.mods.damageMul);expect(m.mods.reloadMul).toBe(s.mods.reloadMul);
  expect(m.control.fire).toBe(false);expect(s.mods.damageMul).toBe(1);expect(s.mods.reloadMul).toBe(1);
});
it('preserves reload percentage through recall and redeployment without resetting it',()=>{
  const {s,m,slot}=setup();m.refreshModifiers();preparePlatform(m);m.turrets[0].reload=2.25;
  attachModule(s,slot);expect(s.turrets[0].reload).toBe(3);
  const again=materialize(s,slot);slot.state='deployed';again.refreshModifiers();preparePlatform(again);
  expect(again.turrets[0].reload).toBe(2.25);
  slot.state='citadel';again.refreshModifiers();preparePlatform(again);expect(again.turrets[0].reload).toBe(1.125);
  slot.state='deployed';again.refreshModifiers();preparePlatform(again);expect(again.turrets[0].reload).toBe(2.25);
});
it('keeps Commanded Burst shell damage fixed and uses each gun’s ordinary reload duration',()=>{
  const {g,s,m}=setup();g.shells.shells=[];s.control.aimX=800;s.control.aimZ=-1000;s.activateSkill(1);
  expect(g.shells.shells).toHaveLength(20);
  expect(g.shells.shells.every(p=>p.spec.damage===20000&&p.dmgMul===s.mods.damageMul&&p.skill?.id==='architectBurst')).toBe(true);
  expect(m.turrets[0].reload).toBe(4.5);expect(s.turrets[2].reload).toBe(6);
});
it('survives three seconds of 50k-per-second incoming damage without special protection',()=>{
  const {m}=setup();m.shield=0;m.colossus=false;
  for(let i=0;i<3;i++)m.takeDamage(50000,null,null,false,true);
  expect(m.alive).toBe(true);expect(m.hp).toBe(50000);
});
