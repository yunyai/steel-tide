import { expect, it } from 'vitest';
import { Scene } from 'three';
import { emptyGame, place, run } from './helpers';
import { stateHash } from '../src/net/hash';
import { ArchitectElementFx } from '../src/render/ArchitectElementFx';
import { BK } from '../src/render/BurstParticles';
import { applyElementMark, ELEMENTS, REACTION_NAMES, type ElementEvent } from '../src/skills/misc/ArchitectElements';

function setup(){
 const g=emptyGame('open',713,'freeplay'),s=place(g,'architect',0,0,1800),t=place(g,'leviathan',1,0,-1000),scene=new Scene(),fx=new ArchitectElementFx(scene,g);
 s.throttle=t.throttle=2;s.speed=t.speed=0;t.colossus=false;t.hp=t.maxHp=1e8;s.secondaries.length=t.secondaries.length=0;s.control.aimX=0;s.control.aimZ=0;
 return {g,s,t,scene,fx};
}
const signature=(fx:ArchitectElementFx)=>{const n=Array(9).fill(0);for(const b of Object.values(fx.reactions.particles.batches))for(let i=0;i<b.count;i++)n[b.kindAt(i)]++;return `${n.join(',')}|${fx.reactions.streaks.count}`;};

it('gives every reaction its own two-colour recipe without touching the simulation',()=>{
 const seen=new Set<string>();
 for(const key of Object.keys(REACTION_NAMES)){
  const {g,s,t,fx}=setup(),[pair,element]=key.split('+') as [typeof ELEMENTS[number],typeof ELEMENTS[number]];
  g.events.emit('architectElement',{ship:s,slot:0,element,pair,attack:'reaction',phase:'hit',id:1,x:0,y:40,z:1800,tx:t.pos.x,ty:t.pos.y+12,tz:t.pos.z,radius:300});
  run(g,.4);g.interpolate();const before=stateHash(g);fx.update(0);fx.prepare(-1);
  expect(stateHash(g)).toBe(before);expect(fx.reactions.drawn).toEqual([key]);seen.add(signature(fx));
  run(g,1);fx.update(0);fx.prepare(-1);expect(fx.reactions.drawn).toHaveLength(0);fx.dispose();
 }
 expect(seen.size).toBe(10);
});

it('arcs a storm reaction to the secondary victims the simulation hit',()=>{
 const {g,s,t,fx}=setup(),near=place(g,'iowa',1,300,-1000);near.throttle=2;near.speed=0;near.secondaries.length=0;near.colossus=false;
 const events:ElementEvent[]=[];g.events.on('architectElement',e=>{if(e.attack==='reaction')events.push(e);});
 const [a,b]=s.architect!.slots;a.element='furnace';b.element='storm';applyElementMark(s,a,t);applyElementMark(s,b,t);
 expect(events).toHaveLength(1);expect(events[0].chain).toHaveLength(1);expect(events[0].chain![0].x).toBeCloseTo(near.pos.x);
 fx.prepare(-1);const chained=fx.reactions.streaks.count;
 const alone=new ArchitectElementFx(new Scene(),g);alone.reactions.add({...events[0],chain:undefined});alone.prepare(-1);
 expect(chained).toBeGreaterThan(alone.reactions.streaks.count);fx.dispose();alone.dispose();
});

it('never drops a reaction that lands on the same tick and spot as the hit that set it off',()=>{
 const {g,s,t,fx}=setup(),hit={ship:s,slot:0,element:'cryo' as const,attack:'salvo' as const,phase:'hit' as const,id:1,x:0,y:40,z:1800,tx:t.pos.x,ty:t.pos.y+12,tz:t.pos.z,radius:120};
 g.events.emit('architectElement',hit);g.events.emit('architectElement',{...hit,attack:'reaction',pair:'furnace',id:2,radius:250});
 fx.prepare(-1);expect(fx.reactions.drawn).toEqual(['cryo+furnace']);fx.dispose();
});

it('shows primed marks to the marking team only, and only on visible targets',()=>{
 const {g,s,t,fx,scene}=setup();applyElementMark(s,s.architect!.slots[0],t);g.interpolate();
 fx.prepare(s.team);expect(fx.reactions.marks).toBe(1);
 const flat=fx.reactions.particles.batches.flat;let ring=false;for(let i=0;i<flat.count;i++)if(flat.kindAt(i)===BK.Ring)ring=true;expect(ring).toBe(true);
 fx.prepare(t.team);expect(fx.reactions.marks).toBe(0);
 t.mods.untargetable=true;fx.prepare(s.team);expect(fx.reactions.marks).toBe(0);t.mods.untargetable=false;
 run(g,4.2);fx.prepare(s.team);expect(fx.reactions.marks).toBe(0);
 fx.dispose();expect(scene.children).toHaveLength(0);
});
