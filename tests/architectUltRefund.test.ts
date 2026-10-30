import { describe, expect, it } from 'vitest';
import { emptyGame, place, run } from './helpers';

const ASSEMBLY=6,BATTERY=7,CITADEL=8;
function cast(skill:number){
 const g=emptyGame('open',53,'freeplay');g.map.heightAt=()=>-100;
 const s=place(g,'architect',0,0,3000),t=place(g,'iowa',1,0,-3000);
 for(const m of [s,t]){m.throttle=2;m.speed=0;m.secondaries=[];}
 s.control.aimX=0;s.control.aimZ=0;s.meter=1;expect(s.activateSkill(skill)).toBe(true);
 return {g,s,t,st:s.skills[skill]};
}
const sinkMembers=(s:ReturnType<typeof cast>['s'],t:ReturnType<typeof cast>['t'])=>{
 for(const i of s.architect!.ultimate!.members)s.architect!.slots[i].entity?.takeDamage(1e12,t,null,false,true);
};

describe('Architect ultimate early end',()=>{
 it.each([[BATTERY,7.5],[CITADEL,13.5]])('refunds the unused share of skill %i on Recall',(skill,duration)=>{
  const {g,s,st}=cast(skill);run(g,3);expect(s.activateSkill(4)).toBe(true);
  expect(s.architect!.ultimate).toBeNull();expect(st.active).toBe(false);
  expect(st.meter).toBeCloseTo((duration-3)/duration,1);
 });
 it.each([[ASSEMBLY,4],[BATTERY,7.5],[CITADEL,13.5]])('keeps no meter when skill %i runs to the end',(skill,duration)=>{
  const {g,s,st}=cast(skill);run(g,duration+.05);
  expect(s.architect!.ultimate).toBeNull();expect(st.meter).toBeLessThan(.01);
 });
 it.each([[ASSEMBLY,4,.5],[BATTERY,7.5,2],[CITADEL,13.5,2]])('stands skill %i down early with a refund once every participating platform is lost',(skill,duration,at)=>{
  const {g,s,t,st}=cast(skill);run(g,at);sinkMembers(s,t);g.step();
  expect(s.architect!.ultimate).toBeNull();expect(st.active).toBe(false);
  expect(st.meter).toBeCloseTo((duration-at)/duration,1);
 });
 it('keeps fighting while any participating platform survives',()=>{
  const {g,s,t}=cast(BATTERY);run(g,2);const members=s.architect!.ultimate!.members;
  for(const i of members.slice(1))s.architect!.slots[i].entity?.takeDamage(1e12,t,null,false,true);
  run(g,.5);expect(s.architect!.ultimate?.kind).toBe('killbox');
 });
 it('refunds nothing when the Architect itself is sunk',()=>{
  const {g,s,t,st}=cast(BATTERY);run(g,2);s.takeDamage(1e12,t,null,false,true);run(g,.5);
  expect(st.meter).toBeLessThan(.01);
 });
});
