import {expect,it} from 'vitest';
import {emptyGame,place,run} from './helpers';
import {ArchitectBatteryAudio,architectBatterySkillGain} from '../src/fx/ArchitectBatteryAudio';
import type {AudioEngine} from '../src/fx/Audio';
it('plays one launch and arrival cue per stage and keeps the finale audible after control ends',()=>{
 const g=emptyGame('open',713,'freeplay'),s=place(g,'architect',0,0,3000);s.throttle=2;s.control.aimX=s.control.aimZ=0;s.meter=1;
 const calls:Parameters<AudioEngine['play']>[]=[],binder=new ArchitectBatteryAudio(g,{play:(...args)=>{calls.push(args);}});binder.update([s]);s.activateSkill(7);
 run(g,7.5);expect(calls.filter(c=>c[0]==='gun')).toHaveLength(4);expect(calls.filter(c=>c[0]==='explosion')).toHaveLength(3);expect(architectBatterySkillGain(g)).toBeLessThan(1);
 run(g,.45);expect(calls.filter(c=>c[0]==='explosion')).toHaveLength(4);expect(calls.at(-1)![6]?.priority).toBe(3);
 run(g,1);binder.update([s]);expect(architectBatterySkillGain(g)).toBe(1);binder.dispose();
});
it('unsubscribes on disposal and clears finale ducking on game-over',()=>{
 const g=emptyGame('open',713,'freeplay'),s=place(g,'architect',0,0,3000);s.throttle=2;s.control.aimX=s.control.aimZ=0;s.meter=1;let calls=0;
 const binder=new ArchitectBatteryAudio(g,{play:()=>{calls++;}});s.activateSkill(7);run(g,7.5);expect(architectBatterySkillGain(g)).toBeLessThan(1);g.finish(-1,'test');expect(architectBatterySkillGain(g)).toBe(1);
 binder.dispose();s.respawn(0,3000,0);s.meter=1;s.skills[7].cooldown=0;s.activateSkill(7);const before=calls;run(g,2);expect(calls).toBe(before);
});
