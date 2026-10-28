import { expect,it } from 'vitest';
import { architectSkillPresentation,architectModuleSkillPresentation } from '../src/ui/ArchitectSkillPresentation';
import { emptyGame,place,run } from './helpers';

it('shows successful Hunt, Connect and Fortify lifetimes independently from command recharge',()=>{
 const g=emptyGame('open',1,'freeplay'),s=place(g,'architect',0,0,3000),t=place(g,'yamato',1,0,1000);s.control.targetId=t.id;
 expect(s.activateSkill(1)).toBe(true);expect(architectSkillPresentation(s,1)).toMatchObject({activeRemaining:10,activeTotal:10,phase:'Hunt'});
 expect(s.activateSkill(5)).toBe(true);expect(architectSkillPresentation(s,5)).toMatchObject({activeRemaining:8,activeTotal:8,phase:'Fortify'});
 s.control.aimX=0;s.control.aimZ=1500;s.activateSkill(0);run(g,2);expect(s.activateSkill(2)).toBe(true);
 expect(architectSkillPresentation(s,2)).toMatchObject({activeRemaining:10,activeTotal:10,phase:'Connect'});
 run(g,8.1);expect(architectSkillPresentation(s,5)).toMatchObject({activeRemaining:0,activeTotal:8,phase:'Cooldown'});expect(architectSkillPresentation(s,5).cooldownRemaining).toBeGreaterThan(0);
 expect(s.skills[1].spec.duration).toBe(0);expect(s.skills[2].spec.duration).toBe(0);expect(s.skills[5].spec.duration).toBe(0);
});
it('shows no active countdown after failed casts or death and clears old Fortify on respawn',()=>{
 const g=emptyGame('open',1,'freeplay'),s=place(g,'architect',0,0,3000);
 expect(s.activateSkill(1)).toBe(false);expect(s.activateSkill(2)).toBe(false);expect(architectSkillPresentation(s,1).activeRemaining).toBe(0);expect(architectSkillPresentation(s,2).activeRemaining).toBe(0);
 s.activateSkill(5);expect(architectSkillPresentation(s,5).activeRemaining).toBe(8);s.alive=false;expect(architectSkillPresentation(s,5).activeRemaining).toBe(0);
 s.respawn(0,3000,0);expect(architectSkillPresentation(s,5).activeRemaining).toBe(0);
 expect(architectSkillPresentation(place(g,'yamato',0,500,3000),0).activeRemaining).toBe(0);
});
it('preserves reduced-cooldown recasts during an existing active presentation',()=>{
 const g=emptyGame('open',1,'freeplay'),s=place(g,'architect',0,0,3000);s.activateSkill(5);s.skills[5].cooldown=0;
 expect(s.activateSkill(5)).toBe(true);expect(architectSkillPresentation(s,5).activeRemaining).toBe(8);
});
it('describes Assembly charge, aim lock, firing and recovery with the four-second lifetime',()=>{
 const g=emptyGame('open',1,'freeplay'),s=place(g,'architect',0,0,3000);s.meter=1;s.control.aimZ=1000;expect(s.activateSkill(6)).toBe(true);
 expect(architectSkillPresentation(s,6)).toMatchObject({activeRemaining:4,activeTotal:4,phase:'Assembling',members:10});
 for(const [elapsed,phase] of [[2,'Charging'],[3.2,'Aim locked'],[3.51,'Firing'],[3.9,'Recovery']] as const){s.architect!.ultimate!.elapsed=elapsed;expect(architectSkillPresentation(s,6).phase).toBe(phase);}
});
it('distinguishes Citadel ascent from its twelve-second airborne operation',()=>{
 const g=emptyGame('open',1,'freeplay'),s=place(g,'architect',0,0,3000);s.meter=1;s.activateSkill(8);
 expect(architectSkillPresentation(s,8)).toMatchObject({activeRemaining:13.5,activeTotal:13.5,phase:'Ascending'});
 s.architect!.ultimate!.elapsed=1.5;expect(architectSkillPresentation(s,8)).toMatchObject({activeRemaining:12,activeTotal:13.5,phase:'Airborne'});
 s.architect!.slots[0].state='destroyed';expect(architectSkillPresentation(s,8).members).toBe(9);
});
it('uses recharge work for one selected-skill ring and real-rate seconds for its accessible label',()=>{
 const g=emptyGame('open',1,'freeplay'),s=place(g,'architect',0,0,3000);s.control.aimZ=1000;s.activateSkill(0);run(g,2);
 const a=s.architect!.slots[0];a.skillTimer=8;
 expect(architectModuleSkillPresentation(s,0)).toMatchObject({eta:8,phase:'recharging',progress:0,name:'Inferno Barrage'});
 a.state='citadel';expect(architectModuleSkillPresentation(s,0)).toMatchObject({eta:1.6});
 a.state='deployed';a.boostUntil=g.time+5;s.architect!.linkUntil=g.time+5;s.architect!.links=[{a:0,b:1}];
 expect(architectModuleSkillPresentation(s,0).eta).toBeCloseTo(8/1.5);
 a.boostUntil=0;s.architect!.linkUntil=0;expect(architectModuleSkillPresentation(s,0).eta).toBe(8);
 a.state='moving';expect(architectModuleSkillPresentation(s,0)).toMatchObject({eta:null,phase:'paused',label:expect.stringMatching(/Paused/)});
 a.state='deployed';a.disabled=2;expect(architectModuleSkillPresentation(s,0)).toMatchObject({phase:'disabled',label:expect.stringMatching(/Disabled/)});
});

it('keeps Battery lifecycle time continuous across gathering and shows launched rounds after control ends',async()=>{
 const {architectIncomingBattery}=await import('../src/ui/ArchitectSkillPresentation');
 const g=emptyGame('open',1,'freeplay'),s=place(g,'architect',0,0,3000);s.meter=1;s.control.aimX=0;s.control.aimZ=1000;
 expect(s.activateSkill(7)).toBe(true);expect(architectSkillPresentation(s,7)).toMatchObject({activeRemaining:7.5,activeTotal:7.5,phase:'Gathering'});
 run(g,1.6);expect(architectSkillPresentation(s,7).activeRemaining).toBeCloseTo(5.9);expect(architectSkillPresentation(s,7)).toMatchObject({activeTotal:7.5,phase:'Bombardment'});
 run(g,5.9);expect(s.architect!.ultimate).toBeNull();const incoming=architectIncomingBattery(s);expect(incoming?.count).toBeGreaterThan(0);expect(incoming?.remaining).toBeCloseTo(.42);
 run(g,.5);expect(architectIncomingBattery(s)).toBeNull();
});
it('ignores generic shields when presenting Fortify and derives no active time from an uncast skill',()=>{
 const g=emptyGame('open',1,'freeplay'),s=place(g,'architect',0,0,3000);s.shield=900000;s.shieldTime=99;
 expect(architectSkillPresentation(s,5).activeRemaining).toBe(0);s.mods.silenced=true;expect(s.activateSkill(5)).toBe(false);expect(architectSkillPresentation(s,5).activeRemaining).toBe(0);
});
it('shows Vector as the shared manual utility even while the retained Search is cooling down',()=>{
 const g=emptyGame('open',1,'freeplay'),s=place(g,'architect',0,0,3000);s.architect!.slots[0].type='vector';s.architect!.slots[0].skill=0;
 s.consumables.find(c=>c.spec.type==='search')!.cooldown=50;
 expect(architectModuleSkillPresentation(s,0)).toMatchObject({name:'Hull Dash',phase:'ready',label:expect.stringMatching(/manual utility/)});
 s.architectDriveReadyAt=g.time+9;
 expect(architectModuleSkillPresentation(s,0)).toMatchObject({eta:9,phase:'recharging',progress:.5,label:expect.stringMatching(/9.0s/)});
 s.architectDriveReadyAt=0;s.mods.rooted=true;
 expect(architectModuleSkillPresentation(s,0)).toMatchObject({phase:'disabled',label:expect.stringMatching(/Rooted/i)});
});

it('never displays retained Search recharge as a destroyed Vector drive timer',()=>{
 const g=emptyGame('open',1,'freeplay'),s=place(g,'architect',0,0,3000),slot=s.architect!.slots[0];slot.type='vector';slot.state='destroyed';slot.hp=0;
 s.architectDriveReadyAt=g.time+9;s.consumables.find(c=>c.spec.type==='search')!.cooldown=50;
 expect(architectModuleSkillPresentation(s,0)).toMatchObject({eta:9,phase:'disabled',label:expect.stringMatching(/Platform destroyed/)});
});
