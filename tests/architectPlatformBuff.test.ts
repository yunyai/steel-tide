import { expect, it } from 'vitest';
import { emptyGame, place, run } from './helpers';
import { attachModule, materialize, preparePlatform } from '../src/skills/misc/ArchitectRuntime';
function setup(){
  const g=emptyGame('open',713,'freeplay'),s=place(g,'architect',0,0,1500),t=place(g,'leviathan',1,800,-1000);
  s.throttle=t.throttle=2;s.speed=t.speed=0;s.control.aimX=800;s.control.aimZ=0;
  s.activateSkill(0);run(g,2);return{g,s,t,slot:s.architect!.slots[0],m:s.architect!.slots[0].entity!};
}
it('triples ordinary deployed shell damage and reloads in 3 seconds',()=>{
  const {g,s,m}=setup();g.shells.shells=[];m.turrets[0].reload=0;m.refreshModifiers();preparePlatform(m);
  m.fireTurret(0,'AP');
  const shells=g.shells.shells.filter(p=>p.owner===m);
  expect(shells).toHaveLength(2);expect(shells[0].spec.damage*shells[0].dmgMul).toBe(s.spec.main!.ap!.damage*3);
  expect(m.turrets[0].reload).toBe(3);expect(s.spec.main!.reload).toBe(6);
});
it('stacks Citadel reload to 1 second without another damage multiplier',()=>{
  const {g,s,m,slot}=setup();slot.state='citadel';m.refreshModifiers();preparePlatform(m);
  g.shells.shells=[];m.turrets[0].reload=0;m.fireTurret(0,'AP');
  expect(m.turrets[0].reload).toBe(1);
  expect(g.shells.shells[0].spec.damage*g.shells.shells[0].dmgMul).toBe(s.spec.main!.ap!.damage*3);
});
it('does not apply deployment bonuses to moving platforms or docked guns',()=>{
  const {s,m,slot}=setup();slot.state='moving';m.refreshModifiers();preparePlatform(m);
  expect(m.mods.damageMul).toBe(s.mods.damageMul);expect(m.mods.reloadMul).toBe(s.mods.reloadMul);
  expect(m.control.fire).toBe(false);expect(s.mods.damageMul).toBe(1);expect(s.mods.reloadMul).toBe(1);
});
it('preserves reload percentage through recall and redeployment without resetting it',()=>{
  const {s,m,slot}=setup();m.refreshModifiers();preparePlatform(m);m.turrets[0].reload=1.5;
  attachModule(s,slot);expect(s.turrets[0].reload).toBe(2);
  const again=materialize(s,slot);slot.state='deployed';again.refreshModifiers();preparePlatform(again);
  expect(again.turrets[0].reload).toBe(1.5);
  slot.state='citadel';again.refreshModifiers();preparePlatform(again);expect(again.turrets[0].reload).toBe(.5);
  slot.state='deployed';again.refreshModifiers();preparePlatform(again);expect(again.turrets[0].reload).toBe(1.5);
});
it('activates Hunt without interrupting docked or deployed reloads',()=>{
  const {g,s,m}=setup();g.shells.shells=[];s.control.aimX=800;s.control.aimZ=-1000;const reloads=[m.turrets[0].reload,s.turrets[2].reload];s.activateSkill(1);
  expect(g.shells.shells).toHaveLength(0);
  expect(g.shells.shells.every(p=>p.spec.damage===30000&&p.dmgMul===s.mods.damageMul&&p.skill?.id==='architectBurst')).toBe(true);
  expect(m.turrets[0].reload).toBeCloseTo(reloads[0]/1.25);expect(s.turrets[2].reload).toBeCloseTo(reloads[1]/1.25);
});
it('survives three seconds of 50k-per-second incoming damage without special protection',()=>{
  const {m}=setup();m.shield=0;m.colossus=false;
  for(let i=0;i<3;i++)m.takeDamage(50000,null,null,false,true);
  expect(m.alive).toBe(true);expect(m.hp).toBe(50000);
});

it('triples HE as well as AP and keeps owner gun modifiers multiplicative',()=>{
  const {g,s,m}=setup();s.mods.damageMul=1.4;m.turrets[0].reload=0;m.refreshModifiers();preparePlatform(m);
  g.shells.shells=[];expect(m.fireTurret(0,'HE')).toBe(true);
  expect(g.shells.shells[0].spec.damage*g.shells.shells[0].dmgMul).toBeCloseTo(s.spec.main!.he!.damage*3*1.4);
});

function targetingSetup(){
  const g=emptyGame('open',713,'freeplay');g.map.heightAt=()=>-100;
  const s=place(g,'architect',0,0,0),slot=s.architect!.slots[0],m=materialize(s,slot);
  slot.state='deployed';m.pos.set(0,0,0);m.refreshModifiers();
  return {g,s,m};
}
it('does not trace cover for farther or tied candidates after finding the nearest visible target',()=>{
  const {g,m}=targetingSetup();
  place(g,'iowa',1,1000,0);place(g,'iowa',1,2000,0);place(g,'iowa',1,-1000,0);
  let terrainSamples=0;g.map.heightAt=()=>{terrainSamples++;return -100;};
  preparePlatform(m);
  expect(m.control.fire).toBe(true);expect([m.control.aimX,m.control.aimZ]).toEqual([1000,0]);
  expect(terrainSamples).toBe(50);
});
it('preserves explicit target and active Hunt priority over nearer candidates',()=>{
  const {g,s,m}=targetingSetup();
  place(g,'iowa',1,1000,0);const selected=place(g,'iowa',1,2000,400),hunted=place(g,'iowa',1,-2500,0);
  s.control.targetId=selected.id;preparePlatform(m);
  expect([m.control.aimX,m.control.aimZ]).toEqual([2000,400]);
  s.architect!.huntTarget=hunted.id;s.architect!.huntUntil=g.time+10;preparePlatform(m);
  expect([m.control.aimX,m.control.aimZ]).toEqual([-2500,0]);
  s.architect!.huntUntil=g.time;preparePlatform(m);
  expect([m.control.aimX,m.control.aimZ]).toEqual([2000,400]);
});
it('reevaluates fallback targeting immediately when cover, walls or positions change within a tick',()=>{
  const {g,s,m}=targetingSetup();
  const near=place(g,'iowa',1,1000,0),selected=place(g,'iowa',1,2000,400);
  place(g,'iowa',1,-1500,0);s.control.targetId=selected.id;
  g.addWall(selected,500,50,500,150,10,0xffffff);preparePlatform(m);
  expect([m.control.aimX,m.control.aimZ]).toEqual([1000,0]);
  g.walls.length=0;preparePlatform(m);
  expect([m.control.aimX,m.control.aimZ]).toEqual([2000,400]);
  g.map.heightAt=(x,z)=>x>=480&&x<=520&&z>50?100:-100;preparePlatform(m);
  expect([m.control.aimX,m.control.aimZ]).toEqual([1000,0]);
  near.pos.x=3000;preparePlatform(m);
  expect([m.control.aimX,m.control.aimZ]).toEqual([-1500,0]);
});
