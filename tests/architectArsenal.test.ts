import { expect,it } from 'vitest';
import { emptyGame,place,run } from './helpers';
import { grantSupportShield,supportHeal } from '../src/skills/misc/ArchitectSupport';
import { ARCHETYPES } from '../src/data/architectLoadout';
import { startElementAttack,updateElements } from '../src/skills/misc/ArchitectElements';
function setup(){const g=emptyGame('open',713,'freeplay'),s=place(g,'architect',0,0,2000),t=place(g,'leviathan',1,0,-1000);t.hp=t.maxHp=1e8;t.colossus=false;s.control.aimZ=0;s.throttle=t.throttle=2;s.secondaries.length=t.secondaries.length=0;return {g,s,t};}
it('heals at full strength from every support emitter and owner with no diminishing returns',()=>{const {g,s}=setup();const ally=place(g,'architect',0,100,2000),hurtShip=place(g,'iowa',0,0,1000);hurtShip.hp=hurtShip.maxHp=1e8;hurtShip.hp=1e7;
 for(let i=0;i<10;i++)for(const owner of [s,ally]){const before=hurtShip.hp;supportHeal(owner,hurtShip,20000);expect(hurtShip.hp-before).toBeCloseTo(20000);}
 expect(hurtShip.hp).toBeCloseTo(1e7+20*20000);});
it('weak repeated grants do not extend a stronger shield',()=>{const {s,t}=setup();t.shield=500000;t.shieldTime=1;grantSupportShield(s,t,120000,5);expect(t.shield).toBe(500000);expect(t.shieldTime).toBe(1);});
it('Hunt focuses a tracked enemy without firing a free salvo and adds 40% once',()=>{const {g,s,t}=setup();s.control.targetId=t.id;expect(s.activateSkill(1)).toBe(true);expect(g.shells.shells).toHaveLength(0);expect(s.architect!.huntTarget).toBe(t.id);expect(s.skills[1].cooldown).toBe(18);expect(t.takeDamage(100,s)).toBeCloseTo(140);const other=place(g,'iowa',1,1000,0);expect(other.takeDamage(100,s)).toBeCloseTo(100);});
it('Fortify uses the agreed shields duration and cooldown',()=>{const {s}=setup();s.activateSkill(5);expect(s.shield).toBe(300000);expect(s.shieldTime).toBe(8);expect(s.skills[5].cooldown).toBe(16);});
it('Citadel readies one selected skill and recharges fivefold',()=>{const {g,s,t}=setup();t.withdraw();s.meter=1;s.activateSkill(8);run(g,1.6);const a=s.architect!.slots[0];expect(a.skillTimer).toBe(0);a.skillTimer=8;updateElements(s,1);expect(a.skillTimer).toBe(3);expect(s.shield).toBeGreaterThan(490000);expect(s.mods.citadelDR).toBeCloseTo(.6);expect(a.reloadScale).toBeCloseTo(1/6);});
it('each offensive selection deals its configured damage and starts the selected cooldown',()=>{
 const cases=[['furnace',0,108000],['furnace',1,96000],['cryo',0,90000],['cryo',1,110000],['storm',0,36000],['storm',1,108000],['gravity',0,108000],['gravity',1,100000],['prism',0,108000],['prism',1,108000],['abyss',0,90000],['abyss',1,96000],['swarm',0,108000]] as const;
 for(const [type,skill,expected] of cases){const {g,s,t}=setup();s.activateSkill(0);run(g,2);const a=s.architect!.slots[0];a.type=type;a.element=ARCHETYPES[type].element;a.skill=skill;
  s.architect!.elements.jobs=[];s.architect!.elements.marks=[];for(const b of s.architect!.slots){b.skillTimer=100;b.opening=false;}a.skillTimer=0;a.castGap=0;
  const before=t.stats.received;updateElements(s,1/60);expect(a.skillTimer,`${type}/${skill} cooldown`).toBe(ARCHETYPES[type].skills[skill].cooldown);
  for(let i=0;i<360;i++){g.time+=1/60;updateElements(s,1/60);}
  expect(t.stats.received-before,`${type}/${skill} damage`).toBeCloseTo(expected);
 }
});
import {setArchitectLoadout,refitArchitect,recallModules} from '../src/skills/misc/ArchitectRuntime';
import {copyLoadout} from '../src/data/architectLoadout';
import {canTrack} from '../src/core/Targeting';
import {stateHash} from '../src/net/hash';
it('casts all support skills and distinguishes surface scans from submarine scans',()=>{
 for(const type of ['sentinel','restoration','bastion','resonance'] as const)for(const skill of [0,1] as const){
  const {g,s,t}=setup();s.activateSkill(0);run(g,2);const a=s.architect!.slots[0];a.type=type;a.skill=skill;a.element=ARCHETYPES[type].element;
  const ally=a.entity!;ally.hp=50000;t.pos.set(1000,0,0);t.addEffect({id:'cloak-test',time:100,apply:m=>m.untargetable=true});t.refreshModifiers();
  const sub=place(g,'virginia',1,1000,0);sub.pos.y=-50;sub.depthState=2;
  s.architect!.elements.jobs=[];const h=stateHash(g);startElementAttack(s,a,type==='sentinel'?(skill?sub:t):ally,'skill');updateElements(s,.3);
  expect(stateHash(g)).not.toBe(h);
  if(type==='sentinel'){expect(canTrack(s,skill?sub:t)).toBe(true);expect((skill?t:sub).architectReveal[0]).toBe(0);}
  if(type==='restoration')expect(ally.hp).toBeGreaterThan(50000);
  if(type==='bastion'){if(skill===0)expect(ally.shield).toBe(120000);else expect(ally.effects.some(e=>e.id==='architectBulwark')).toBe(true);}
  if(type==='resonance'){const b=s.architect!.slots[1];expect(skill?b.reactionUntil:b.boostUntil).toBeGreaterThan(g.time);}
 }
});
it('Abyss damages revealed submarines while ordinary skills remain depth restricted',()=>{
 const {g,s,t}=setup();t.withdraw();s.activateSkill(0);run(g,2);const sub=place(g,'virginia',1,0,-1000);sub.hp=sub.maxHp=1e7;sub.pos.y=-30;sub.depthState=2;sub.architectReveal[0]=100;
 const a=s.architect!.slots[0];a.type='abyss';a.element='cryo';a.skill=0;s.architect!.elements.jobs=[];startElementAttack(s,a,sub,'skill');updateElements(s,1);expect(sub.stats.received).toBeGreaterThanOrEqual(90000);
 a.type='furnace';a.element='furnace';const before=sub.stats.received;startElementAttack(s,a,sub,'skill');updateElements(s,2);expect(sub.stats.received).toBe(before);
});
it('caps Brood and removes it on recall and owner death without kill rewards',()=>{
 const {g,s,t}=setup();s.activateSkill(0);run(g,2);const a=s.architect!.slots[0];a.type='swarm';a.skill=1;
 for(let i=0;i<30;i++)startElementAttack(s,a,t,'skill');expect(g.ships.filter(m=>m.alive&&m.architectDrone)).toHaveLength(2);
 const drone=g.ships.find(m=>m.architectDrone)!;drone.takeDamage(1e9,t,null,false,true);expect(t.stats.kills).toBe(0);
 recallModules(s);updateElements(s,.1);expect(g.ships.filter(m=>m.alive&&m.architectDrone)).toHaveLength(0);
});
it('refits docked slots only, preserves health and persists through respawn',()=>{
 const {g,s}=setup();const hp=s.hp;expect(refitArchitect(s,0,{type:'swarm',skill:1})).toBe(true);expect(s.hp).toBe(hp);expect(s.architect!.slots[0].skillTimer).toBe(12);
 s.activateSkill(0);run(g,2);expect(refitArchitect(s,0,{type:'bastion',skill:0})).toBe(false);
 s.respawn(0,2000,0);expect(s.architect!.slots[0].type).toBe('swarm');expect(s.architect!.slots[0].skill).toBe(1);
 const load=copyLoadout(undefined);load[2]={type:'sentinel',skill:1};setArchitectLoadout(s,load);expect(s.architect!.slots[2].element).toBe('storm');
});
it('projectiles retain their element and selected skill after a docked refit',()=>{
 const {g,s,t}=setup();s.control.aimX=t.pos.x;s.control.aimZ=t.pos.z;s.control.fire=true;run(g,.1);const shell=g.shells.shells.find(x=>x.owner===s)!;expect(shell).toBeDefined();const before=shell.element!.kind;expect(before).toBeDefined();refitArchitect(s,shell.element!.slot,{type:'prism',skill:1});expect(shell.element!.kind).toBe(before);
});
it('Brood deaths do not grant ship kill healing cooldowns meters or ribbons',()=>{
 const {g,s,t}=setup();s.activateSkill(0);run(g,2);const a=s.architect!.slots[0];a.type='swarm';a.skill=1;startElementAttack(s,a,t,'skill');
 const drone=g.ships.find(m=>m.architectDrone)!;t.hp=t.maxHp*.5;t.meter=0;t.skills[0].cooldown=10;const hp=t.hp,events:string[]=[];g.events.on('ribbon',e=>events.push(e.kind));drone.sink(t);
 expect(t.hp).toBe(hp);expect(t.meter).toBe(0);expect(t.skills[0].cooldown).toBe(10);expect(events).not.toContain('Destroyed');expect(events).not.toContain('Kill bonus');expect(t.stats.kills).toBe(0);
});

it('automatically acquires both Amplifiers with eight nearby docked elemental recipients',()=>{
 const {g,s,t}=setup();t.withdraw();s.activateSkill(0);run(g,2);
 const casts:number[]=[];g.events.on('architectElement',e=>{if(e.phase==='cast'&&e.attack==='skill')casts.push(e.slot);});
 for(const a of s.architect!.slots){a.opening=false;a.skillTimer=100;}
 for(const a of s.architect!.slots.slice(0,2)){a.type='resonance';a.skill=1;a.element='storm';a.skillTimer=0;a.castGap=0;a.entity!.pos.set(s.pos.x+(a.index?100:-100),0,s.pos.z);}
 updateElements(s,.3);
 expect(casts).toEqual([0,1]);
 for(const a of s.architect!.slots.slice(2))expect(a.reactionUntil).toBeCloseTo(g.time+4);
});
it('keeps all-Resonance Accelerando ineligible and excludes distant Amplifier recipients',()=>{
 const {g,s,t}=setup();t.withdraw();s.activateSkill(0);run(g,2);
 for(const a of s.architect!.slots){a.type='resonance';a.skill=0;a.element='storm';a.skillTimer=0;a.opening=false;a.castGap=0;if(a.entity)a.entity.pos.set(s.pos.x+a.index*100,0,s.pos.z);}
 const casts:number[]=[];g.events.on('architectElement',e=>{if(e.phase==='cast')casts.push(e.slot);});updateElements(s,.3);expect(casts).toHaveLength(0);
 for(const a of s.architect!.slots.slice(0,2)){a.skill=1;a.entity!.pos.z-=3000;}
 updateElements(s,.3);expect(s.architect!.slots.slice(2).every(a=>a.reactionUntil===0)).toBe(true);
});
it('emits an execution result for accepted and rejected refits',()=>{
 const {g,s}=setup(),results:any[]=[];g.events.on('architectRefit' as any,(e:any)=>results.push(e));
 expect(refitArchitect(s,0,{type:'swarm',skill:1})).toBe(true);
 s.activateSkill(0);run(g,2);expect(refitArchitect(s,0,{type:'prism',skill:0})).toBe(false);
 expect(results.map(e=>[e.index,e.pick.type,e.accepted])).toEqual([[0,'swarm',true],[0,'prism',false]]);expect(results[1].reason).toMatch(/recall/i);
});
it('Fortify records its presentation expiry without changing active time or recast behavior',()=>{
 const {g,s}=setup();g.time=12;s.activateSkill(5);expect(s.skills[5].data.activeUntil).toBe(20);expect(s.skills[5].active).toBe(false);expect(s.skills[5].spec.duration).toBe(0);expect(s.skills[5].cooldown).toBe(16);
});

it('resolves exact support output, duration and strongest nonstacking buffs',()=>{
 const {g,s,t}=setup();t.withdraw();s.activateSkill(0);run(g,2);const [a,b]=s.architect!.slots,target=b.entity!;
 for(const slot of s.architect!.slots){slot.skillTimer=100;slot.opening=false;slot.castGap=0;}s.architect!.elements.jobs=[];
 a.entity!.pos.copy(target.pos);target.hp=10000;a.type='restoration';a.skill=0;startElementAttack(s,a,target,'skill');updateElements(s,2);expect(target.hp).toBe(90000);
 a.skill=1;startElementAttack(s,a,target,'skill');updateElements(s,.3);expect(target.hp).toBe(115000);
 a.type='bastion';a.skill=0;startElementAttack(s,a,target,'skill');updateElements(s,.3);expect(target.shield).toBe(120000);expect(target.shieldTime).toBe(5);
 a.skill=1;startElementAttack(s,a,target,'skill');updateElements(s,.3);target.refreshModifiers();expect(target.mods.citadelDR).toBe(.2);expect(target.effects.find(e=>e.id==='architectBulwark')!.time).toBe(4);
 startElementAttack(s,a,target,'skill');updateElements(s,.3);target.refreshModifiers();expect(target.mods.citadelDR).toBe(.2);
 a.type='resonance';a.skill=0;startElementAttack(s,a,target,'skill');updateElements(s,.3);expect(b.boostUntil).toBe(g.time+4);
 a.skill=1;startElementAttack(s,a,target,'skill');updateElements(s,.3);expect(b.reactionUntil).toBe(g.time+4);
});
it('Hunt strengthens repair and shield output by forty percent exactly once',()=>{
 const {g,s,t}=setup();t.withdraw();s.activateSkill(0);run(g,2);const [a,b]=s.architect!.slots,target=b.entity!;
 for(const slot of s.architect!.slots){slot.skillTimer=100;slot.opening=false;}s.architect!.elements.jobs=[];s.architect!.huntUntil=g.time+10;
 a.entity!.pos.copy(target.pos);target.hp=10000;a.type='restoration';a.skill=0;startElementAttack(s,a,target,'skill');updateElements(s,2);expect(target.hp).toBe(122000);
 a.type='bastion';a.skill=0;startElementAttack(s,a,target,'skill');updateElements(s,.3);expect(target.shield).toBe(168000);
});
