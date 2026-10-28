import {expect,it} from 'vitest';
import {emptyGame,place,run} from './helpers';
import {updateArchitectUltimate} from '../src/skills/misc/ArchitectUltimates';
it('Grand Battery covers the perimeter for 2.4M baseline with ten live platforms',()=>{
 const g=emptyGame('open',53,'freeplay'),s=place(g,'architect',0,0,3000),t=place(g,'leviathan',1,1400,0);t.colossus=false;t.hp=t.maxHp=1e8;t.throttle=2;s.control.aimX=s.control.aimZ=0;s.meter=1;
 let damage=0;g.events.on('skillHit',e=>{if(e.skill.id==='architectKillbox')damage+=e.damage;});
 expect(s.activateSkill(7)).toBe(true);for(let i=0;i<480;i++){g.time+=1/60;updateArchitectUltimate(s,1/60);g.battery.update();}
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

import type {ArchitectBatteryLaunch,ArchitectBatteryImpact} from '../src/data/architectBattery';
import {stateHash} from '../src/net/hash';
import {SHIP_BY_ID} from '../src/data/ships';
function flightArena(){
 const g=emptyGame('open',53,'freeplay'),s=place(g,'architect',0,0,3000),t=place(g,'leviathan',1,0,0);
 t.colossus=false;t.hp=t.maxHp=1e8;t.throttle=s.throttle=2;t.secondaries=[];s.secondaries=[];
 s.control.aimX=s.control.aimZ=0;s.meter=1;expect(s.activateSkill(7)).toBe(true);
 s.addEffect({id:'test-guns-off',time:100,apply:m=>{m.disarmed=true;}});
 for(const slot of s.architect!.slots){slot.skillTimer=100;slot.opening=false;slot.entity!.addEffect({id:'test-guns-off',time:100,apply:m=>{m.disarmed=true;}});}
 const launches:ArchitectBatteryLaunch[]=[],impacts:ArchitectBatteryImpact[]=[];let damage=0,hits=0;
 g.events.on('architectBatteryLaunch',e=>launches.push(e));g.events.on('architectBatteryImpact',e=>impacts.push(e));
 g.events.on('skillHit',e=>{if(e.skill.id==='architectKillbox'){damage+=e.damage;hits++;}});
 return {g,s,t,launches,impacts,damage:()=>damage,hits:()=>hits};
}
it('commits launches on the existing sweep but resolves each contribution .42 seconds later',()=>{
 const {g,s,t,launches,impacts,damage,hits}=flightArena();run(g,1.9);expect(damage()).toBe(0);
 expect(launches[0].launchTime).toBeCloseTo(1.5);expect(launches[0].arrivalTime).toBeCloseTo(1.92);expect(launches[0].paths).toHaveLength(2);
 g.step();expect(damage()).toBe(0);g.step();expect(damage()).toBe(50000);expect(impacts[0].resolvedAt).toBeGreaterThanOrEqual(1.92);expect(impacts[0].resolvedAt).toBeLessThan(1.92+1/60);
 while(g.time<7.5-1e-8)g.step();expect(s.architect!.ultimate).toBeNull();expect(damage()).toBe(1500000);expect(g.battery.pending).toHaveLength(10);
 expect(launches.filter(e=>e.stage===3).every(e=>Math.abs(e.launchTime-7.5)<1e-8)).toBe(true);
 while(g.time<7.92)g.step();expect(damage()).toBe(2400000);expect(hits()).toBe(40);expect(impacts).toHaveLength(40);expect(g.battery.pending).toHaveLength(0);
 expect(impacts.every(e=>e.recipients.length===1&&e.recipients[0].target===t)).toBe(true);
 expect(new Set(launches.map(e=>e.id)).size).toBe(40);expect(new Set(launches.map(e=>`${e.castId}:${e.slot}:${e.stage}`)).size).toBe(40);
});
it('snapshots source multipliers and frozen selection while applying arrival defenses and Hunt once',()=>{
 const {g,s,t,launches,impacts}=flightArena();s.mods.damageMul=2;s.mods.ultDamageMul=3;
 // The launch tick refreshes actual modifiers, so use a lasting source effect.
 s.addEffect({id:'source',time:100,apply:m=>{m.damageMul*=2;m.ultDamageMul*=3;}});run(g,1.5);
 const first=launches[0],frozenType=first.type,frozenElement=first.element;expect(first.damageMultiplier).toBe(6);const before=t.stats.received;
 s.effects=s.effects.filter(e=>e.id!=='source');s.refreshModifiers();s.architect!.slots[0].type='prism';s.architect!.slots[0].element='prism';
 s.architect!.huntTarget=t.id;s.architect!.huntUntil=g.time+10;
 t.addEffect({id:'arrival-defense',time:100,apply:m=>{m.damageTakenMul*=.5;}});run(g,.44);
 expect(impacts[0].recipients[0].damage).toBeCloseTo(210000);expect(t.stats.received-before).toBeCloseTo(210000);
 expect(impacts[0].launch.type).toBe(frozenType);expect(impacts[0].launch.element).toBe(frozenElement);
});
it('drops future launches when a member dies but retains that member committed flight',()=>{
 const {g,s,t,launches,impacts}=flightArena();run(g,1.5);s.architect!.slots[0].entity!.takeDamage(1e9,t,null,false,true);run(g,6.5);
 expect(launches.filter(e=>e.slot===0)).toHaveLength(1);expect(impacts.filter(e=>e.launch.slot===0)).toHaveLength(1);expect(launches).toHaveLength(37);
});
it('keeps old trajectories and arrivals when Assembly takes command at 7.5 seconds',()=>{
 const {g,s,launches,impacts}=flightArena();run(g,7.5);const final=launches.filter(e=>e.stage===3),paths=JSON.stringify(final.map(e=>e.paths));
 s.effects=s.effects.filter(e=>e.id!=='test-guns-off');s.refreshModifiers();s.meter=1;expect(s.activateSkill(6)).toBe(true);run(g,.45);
 expect(s.architect!.ultimate?.kind).toBe('assembly');expect(JSON.stringify(final.map(e=>e.paths))).toBe(paths);expect(impacts.filter(e=>e.launch.stage===3)).toHaveLength(10);
});
for(const action of ['death','withdraw','respawn','ship-change','shift','clear','game-over'] as const)it(`cancels committed flight on owner ${action}`,()=>{
 const {g,s,t,impacts}=flightArena();run(g,1.5);const generation=g.battery.generation(s);expect(g.battery.pending.length).toBeGreaterThan(0);
 if(action==='death')s.takeDamage(1e9,t,null,false,true);
 if(action==='withdraw')s.withdraw();
 if(action==='respawn')s.respawn(0,3000,0);
 if(action==='ship-change'){g.pickShip(s,'yamato');g.redeploy(s);g.respawns[0].at=g.time;g.step();expect(g.ships.some(m=>m!==s&&m.spec.id==='yamato')).toBe(true);}
 if(action==='shift'){s.queueShift(SHIP_BY_ID.stepper,10,[6,7,8]);g.step();}
 if(action==='clear')g.battery.clear();
 if(action==='game-over')g.finish(-1,'test');
 expect(g.battery.generation(s)).toBeGreaterThan(generation);expect(g.battery.pending).toHaveLength(0);run(g,.5);expect(impacts).toHaveLength(0);
});
it('hashes cast identity, frozen layout, pending offense, paths, and cancellation generation',()=>{
 const {g,s}=flightArena();const active=stateHash(g);const cast=s.architect!.ultimate!.battery!;
 (cast.members[0] as any).layout=cast.members[0].layout==='folded'?'wide':'folded';expect(stateHash(g)).not.toBe(active);
 run(g,1.5);const pending=g.battery.pending[0];const h=stateHash(g);g.battery.cancelOwner(s);expect(stateHash(g)).not.toBe(h);expect(g.battery.pending).toHaveLength(0);
 // A cancelled generation cannot reintroduce a stale launch.
 g.battery.launch(pending);expect(g.battery.pending).toHaveLength(0);
});
it('evaluates zone membership, surface eligibility, terrain cover and defenses at arrival',()=>{
 const {g,s,t,impacts}=flightArena();
 const deep=place(g,'virginia',1,0,-400),high=place(g,'iowa',1,-300,0),covered=place(g,'iowa',1,500,0);
 for(const v of [deep,high,covered]){v.throttle=2;v.secondaries=[];v.colossus=false;v.hp=v.maxHp=1e8;}
 run(g,1.5);deep.pos.y=-50;deep.depthState=2;high.pos.y=200;
 g.map.heightAt=(x,z)=>x>200&&x<350&&Math.abs(z)<40?100:-100;
 t.addEffect({id:'arrival-shield',time:100,apply:m=>{m.invulnerable=true;}});run(g,.44);
 const hit=impacts[0].recipients;expect(hit.find(v=>v.target===t)!.damage).toBe(0);
 expect(hit.some(v=>v.target===deep||v.target===high||v.target===covered)).toBe(false);
 expect(s.architect!.ultimate?.kind).toBe('killbox');
});
it('accepts a victim entering the zone during flight and excludes one leaving it',()=>{
 const {g,t,impacts}=flightArena(),entrant=place(g,'iowa',1,4000,0);entrant.throttle=2;entrant.secondaries=[];entrant.hp=entrant.maxHp=1e8;
 run(g,1.5);t.pos.set(4000,0,0);entrant.pos.set(0,0,0);run(g,.44);
 expect(impacts[0].recipients.map(r=>r.target)).toEqual([entrant]);expect(impacts[0].recipients[0].damage).toBe(50000);
});
it('applies one hit cap and one elemental mark transaction for a paired-head contribution',()=>{
 const {g,s,t,impacts}=flightArena();t.maxHp=100000;t.hp=100000;t.addEffect({id:'cap',time:100,apply:m=>{m.hitCap=.1;}});
 s.architect!.slots[0].element='furnace';s.architect!.slots[1].element='cryo';run(g,1.94);
 expect(impacts).toHaveLength(1);expect(impacts[0].recipients[0].damage).toBe(10000);expect(t.stats.received).toBe(10000);
 expect(s.architect!.elements.marks.find(m=>m.target===t.id)?.element).toBe('furnace');
});
it('stops Battery gun bonuses and slow refresh at 7.5 while arrivals remain pending',()=>{
 const {g,s,t}=flightArena();run(g,7.5);expect(s.architect!.ultimate).toBeNull();expect(g.battery.pending).toHaveLength(10);
 for(const a of s.architect!.slots){expect(a.reloadScale).toBe(.5);expect(a.entity!.mods.damageMul).toBe(3);}
 run(g,.12);expect(t.effects.some(e=>e.id==='debuff:grandBattery')).toBe(false);expect(g.battery.pending.length).toBeGreaterThan(0);
});
it('lets Recall and a later Battery replace presentation without relocating or duplicating old flight',()=>{
 const {g,s,launches,impacts}=flightArena();run(g,7.5);const old=launches.filter(r=>r.stage===3),paths=JSON.stringify(old.map(r=>r.paths));const firstCast=old[0].castId;
 expect(s.activateSkill(4)).toBe(true);run(g,.45);expect(impacts.filter(e=>e.launch.castId===firstCast&&e.launch.stage===3)).toHaveLength(10);expect(JSON.stringify(old.map(r=>r.paths))).toBe(paths);
 s.skills[7].cooldown=0;s.meter=1;s.control.aimX=1000;s.control.aimZ=0;expect(s.activateSkill(7)).toBe(true);run(g,1.5);
 const next=launches.find(r=>r.castId!==firstCast)!;expect(next.castId).toBeGreaterThan(firstCast);expect(next.id).toBeGreaterThan(old.at(-1)!.id);expect(next.center.x).toBe(1000);
});
it('never schedules future stages for a contributor destroyed before its first launch',()=>{
 const {g,s,t,launches}=flightArena();s.architect!.slots[0].entity!.takeDamage(1e9,t,null,false,true);run(g,8);
 expect(launches.some(r=>r.slot===0)).toBe(false);expect(launches).toHaveLength(36);
});
it('fingerprints every pending offense, identity, layout and trajectory field',()=>{
 const {g}=flightArena();run(g,1.5);const original=g.battery.pending[0],system=g.battery as unknown as {queue:ArchitectBatteryLaunch[]};
 const mutate=(record:ArchitectBatteryLaunch)=>{const before=stateHash(g);system.queue[0]=record;expect(stateHash(g)).not.toBe(before);system.queue[0]=original;};
 for(const field of ['generation','castId','slot','stage','launchTime','arrivalTime','radius','baseDamage','damageMultiplier','skill'] as const)mutate({...original,[field]:original[field]+1});
 mutate({...original,type:original.type==='prism'?'furnace':'prism'});mutate({...original,element:original.element==='prism'?'furnace':'prism'});mutate({...original,layout:original.layout==='wide'?'compact':'wide'});
 for(const field of ['x','y','z'] as const)mutate({...original,center:{...original.center,[field]:original.center[field]+1}});
 for(const field of ['x','y','z','heading'] as const)mutate({...original,carrier:{...original.carrier,[field]:original.carrier[field]+1}});
 for(const node of ['muzzle','control','impact'] as const)for(const field of ['x','y','z'] as const)mutate({...original,paths:[{...original.paths[0],[node]:{...original.paths[0][node],[field]:original.paths[0][node][field]+1}},original.paths[1]]});
});
it('lets a new Battery begin at 7.5 while the previous cast finale remains committed',()=>{
 const {g,s,launches,impacts}=flightArena();run(g,7.5);const old=launches[0].castId,lastOld=launches.at(-1)!.id;
 s.skills[7].cooldown=0;s.meter=1;s.control.aimX=1000;expect(s.activateSkill(7)).toBe(true);const next=s.architect!.ultimate!.battery!;expect(next.id).toBeGreaterThan(old);expect(g.battery.pending).toHaveLength(10);
 run(g,.45);expect(impacts.filter(e=>e.launch.castId===old&&e.launch.stage===3)).toHaveLength(10);expect(s.architect!.ultimate!.battery!.id).toBe(next.id);
 run(g,1.05);const firstNew=launches.find(r=>r.castId===next.id)!;expect(firstNew.id).toBeGreaterThan(lastOld);expect(firstNew.launchTime).toBeCloseTo(9);expect(firstNew.arrivalTime).toBeCloseTo(9.42);
});
it('resolves forty contributions per eligible victim without paired-head duplication',()=>{
 const {g,t,impacts}=flightArena(),other=place(g,'iowa',1,800,0);other.throttle=2;other.secondaries=[];other.hp=other.maxHp=1e8;run(g,8);
 const receipts=impacts.flatMap(e=>e.recipients.map(r=>`${e.launch.slot}:${e.launch.stage}:${r.target.id}`));expect(new Set(receipts).size).toBe(80);
 for(const victim of [t,other])expect(impacts.filter(e=>e.recipients.some(r=>r.target===victim))).toHaveLength(40);
});

it('keeps every ordinary hub gun firing at an off-center victim while carriers hold formation',()=>{
 for(const x of [0,800]){
  const g=emptyGame('open',53,'freeplay'),s=place(g,'architect',0,0,3000),t=place(g,'leviathan',1,x,0);g.map.heightAt=()=>-100;s.throttle=t.throttle=2;s.secondaries=[];t.secondaries=[];t.colossus=false;t.hp=t.maxHp=1e8;
  t.addEffect({id:'test-enemy-weapons-off',time:100,apply:m=>{m.disarmed=true;}});s.control.aimX=s.control.aimZ=0;s.meter=1;expect(s.activateSkill(7)).toBe(true);
  for(const a of s.architect!.slots){a.skillTimer=100;a.opening=false;}
  run(g,7.4);
  for(const a of s.architect!.slots){const m=a.entity!,carrier=s.architect!.ultimate!.battery!.members.find(v=>v.slot===a.index)!.carrier;expect(m.heading).toBeCloseTo(carrier.heading);expect(m.stats.shotsFired,`victim x=${x}, slot ${a.index}`).toBe(8);}
 }
});
