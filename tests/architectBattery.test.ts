import {expect,it} from 'vitest';
import {emptyGame,place,run} from './helpers';
import {updateArchitectUltimate} from '../src/skills/misc/ArchitectUltimates';
it('Grand Battery covers the perimeter for 2.4M baseline with ten live platforms',()=>{
 const g=emptyGame('open',53,'freeplay'),s=place(g,'architect',0,0,3000),t=place(g,'leviathan',1,1400,0);t.colossus=false;t.hp=t.maxHp=1e8;t.throttle=2;s.control.aimX=s.control.aimZ=0;s.meter=1;
 let damage=0;g.events.on('skillHit',e=>{if(e.skill.id==='architectKillbox')damage+=e.damage;});
 expect(s.activateSkill(7)).toBe(true);for(let i=0;i<451;i++)updateArchitectUltimate(s,1/60);
 expect(damage).toBeCloseTo(2400000);expect(s.architect!.ultimate).toBeNull();
});
it('Grand Battery allows ordinary guns and skills between broadsides',()=>{
 const g=emptyGame('open',53,'freeplay'),s=place(g,'architect',0,0,3000),t=place(g,'leviathan',1,0,0);t.colossus=false;t.hp=t.maxHp=1e8;t.throttle=s.throttle=2;s.control.aimX=s.control.aimZ=0;s.meter=1;
 let skills=0;g.events.on('architectElement',e=>{if(e.attack==='skill'&&e.phase==='cast')skills++;});s.activateSkill(7);run(g,3);
 expect(skills).toBeGreaterThan(0);expect(s.architect!.slots.some(a=>a.entity!.stats.shotsFired>0)).toBe(true);
 expect(s.architect!.slots[0].reloadScale).toBe(.25);
});
it('finishes gathering at the exact safe endpoint rather than retaining the flight terrain clearance',()=>{
 const g=emptyGame('open',53,'freeplay'),s=place(g,'architect',0,0,3000);s.control.aimX=s.control.aimZ=0;s.meter=1;s.activateSkill(7);
 for(let i=0;i<90;i++)updateArchitectUltimate(s,1/60);
 expect(s.architect!.slots.every(a=>Math.abs(a.entity!.pos.y)<.001)).toBe(true);
});
