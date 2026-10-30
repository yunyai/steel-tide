import { afterEach, expect, it, vi } from 'vitest';
import { Box3, Mesh, MeshStandardMaterial, Scene, Vector3 } from 'three';
import { StepperModel } from '../src/render/StepperModel';
import { ShipView } from '../src/render/ShipModel';
import { stateHash } from '../src/net/hash';
import { emptyGame, place, run } from './helpers';

afterEach(()=>vi.unstubAllGlobals());
const opacity=(v:ShipView)=>{let value=1;v.root.traverse(o=>{if(o instanceof Mesh&&o.material instanceof MeshStandardMaterial)value=Math.min(value,o.material.opacity);});return value;};
const size=(root:import('three').Object3D)=>new Box3().setFromObject(root).getSize(new Vector3());
it('transforms during Cross-step and resets on battle end without changing combat state',()=>{
  const g=emptyGame('open',7,'freeplay'),s=place(g,'stepper',0,0,1500),view=new ShipView(s.spec);
  view.update(s,0);const idle=size(view.root);
  s.control.aimX=0;s.control.aimZ=0;s.meter=1;expect(s.activateSkill(7)).toBe(true);run(g,1);g.interpolate();
  const before=stateHash(g);view.update(s,g.renderTime);const active=size(view.root);
  expect(Math.max(active.x,active.z)).toBeGreaterThan(Math.max(idle.x,idle.z)+10);
  expect(stateHash(g)).toBe(before);
  g.finish(-1,'test');view.update(s,g.renderTime);
  const ended=size(view.root);expect(Math.max(ended.x,ended.z)).toBeLessThan(Math.max(active.x,active.z)-10);view.dispose();
});
it('freezes continuous phase-drive motion under reduced motion',()=>{
  vi.stubGlobal('matchMedia',()=>({matches:true}));
  const model=new StepperModel((g,m)=>new Mesh(g,m));
  const transforms=()=>{model.root.updateMatrixWorld(true);const out:number[]=[];model.root.traverse(o=>out.push(...o.matrix.elements));return out;};
  model.pose(1);const a=transforms();model.pose(9);expect(transforms()).toEqual(a);model.dispose();
});
it('keeps spectral materials independent of the real ship',()=>{
  const g=emptyGame('open',7,'freeplay'),s=place(g,'stepper',0,0,1500);s.meter=1;s.activateSkill(8);
  const copy=g.ships.find(c=>c.summonOwner===s)!,real=new ShipView(s.spec),echo=new ShipView(copy.spec);
  real.update(s,0);echo.update(copy,0);expect(opacity(real)).toBe(1);expect(opacity(echo)).toBeLessThan(.6);
  echo.dispose();real.update(s,1);expect(opacity(real)).toBe(1);real.dispose();
});

// These exercise real event payloads and rendering buffers, not a mocked particle engine.
it('bounds rapid teleport silhouettes, keeps finite geometry, and clears on battle end',async()=>{
  const {StepperFx}=await import('../src/render/StepperFx');
  const g=emptyGame('open',7,'freeplay'),s=place(g,'stepper',0,0,1500),scene=new Scene(),fx=new StepperFx(scene,g);
  const before=stateHash(g);
  for(let i=0;i<300;i++)g.events.emit('blink',{ship:s,fromX:i,fromZ:1500,fromHeading:0,dodge:true});
  fx.update(.03,[s]);fx.prepare(0,720);
  expect(fx.ghosts.count).toBeGreaterThan(0);expect(fx.ghosts.count).toBeLessThanOrEqual(64);
  expect(fx.spatial.tears.count).toBeGreaterThan(0);expect(fx.spatial.tears.count).toBeLessThanOrEqual(384);
  expect(fx.spatial.shards.count).toBeGreaterThan(0);
  expect(fx.water.mesh.geometry.drawRange.count).toBeGreaterThan(0);expect(fx.light.count).toBeLessThanOrEqual(fx.light.max);
  for(const name of ['iA','iB','iW']){
    const a=fx.light.mesh.geometry.getAttribute(name);
    expect(Array.from(a.array).slice(0,fx.light.count*a.itemSize).every(Number.isFinite)).toBe(true);
  }
  expect(stateHash(g)).toBe(before);
  fx.update(2,[s]);fx.prepare(0,720);expect(fx.ghosts.count).toBe(0);
  g.events.emit('blink',{ship:s,fromX:0,fromZ:0});g.finish(-1,'test');fx.update(0,[s]);fx.prepare(0,720);
  expect(fx.light.count).toBe(0);expect(fx.ghosts.count).toBe(0);expect(fx.spatial.tears.count).toBe(0);expect(fx.spatial.shards.count).toBe(0);fx.dispose();expect(scene.children).toHaveLength(0);
});
it('does not expose a concealed enemy through personal effects or teleport ghosts',async()=>{
  const {StepperFx}=await import('../src/render/StepperFx');
  const g=emptyGame('open',7,'freeplay'),s=place(g,'stepper',1,0,1500),fx=new StepperFx(new Scene(),g);
  place(g,'yamato',0,0,-4000);s.mods.untargetable=true;
  g.events.emit('blink',{ship:s,fromX:100,fromZ:1500,dodge:true});fx.update(.05);fx.prepare(0,720);
  expect(fx.ghosts.count).toBe(0);expect(fx.light.count).toBe(0);
  fx.prepare(1,720);expect(fx.ghosts.count).toBeGreaterThan(0);
  s.mods.revealed=true;fx.prepare(0,720);expect(fx.ghosts.count).toBeGreaterThan(0);fx.dispose();
});
it('removes repair geometry as soon as repair is interrupted',async()=>{
  const {StepperFx}=await import('../src/render/StepperFx');
  const g=emptyGame('open',7,'freeplay'),s=place(g,'stepper',0,0,1500),fx=new StepperFx(new Scene(),g);
  s.hp*=.5;expect(s.activateSkill(4)).toBe(true);run(g,2.2);g.interpolate();fx.update(2.2,[s]);fx.prepare(0,720);
  expect(fx.light.count).toBeGreaterThan(0);s.takeDamage(1000,null,null,false,true);fx.prepare(0,720);
  expect(s.stepper!.repair).toBeNull();expect(fx.light.count).toBe(0);fx.dispose();
});
it('clears old teleport snapshots when the same ship respawns',async()=>{
  const {StepperFx}=await import('../src/render/StepperFx');
  const g=emptyGame('open',7,'freeplay'),s=place(g,'stepper',0,0,1500),fx=new StepperFx(new Scene(),g);
  g.events.emit('blink',{ship:s,fromX:300,fromZ:0});fx.prepare(0,720);expect(fx.ghosts.count).toBe(1);
  g.events.emit('respawn',{ship:s});fx.prepare(0,720);expect(fx.ghosts.count).toBe(0);expect(fx.light.count).toBe(0);fx.dispose();
});
it('dissolves withdrawn copies once and releases their presentation state',async()=>{
  const {StepperFx}=await import('../src/render/StepperFx');
  const g=emptyGame('open',7,'freeplay'),s=place(g,'stepper',0,0,1500),fx=new StepperFx(new Scene(),g);
  s.meter=1;s.activateSkill(8);g.interpolate();fx.update(.8,[s]);fx.prepare(0,720);
  const copies=g.ships.filter(c=>c.summonOwner===s);expect(copies).toHaveLength(4);
  for(const c of copies)c.withdraw();fx.update(0,[s]);fx.prepare(0,720);expect(fx.ghosts.count).toBe(4);
  fx.update(.7,[s]);fx.prepare(0,720);expect(fx.ghosts.count).toBe(0);
  fx.update(.1,[s]);fx.prepare(0,720);expect(fx.ghosts.count).toBe(0);fx.dispose();
});
it('snapshots both ends of a teleport before the ship moves again',async()=>{
  const {StepperFx}=await import('../src/render/StepperFx');
  const g=emptyGame('open',7,'freeplay'),s=place(g,'stepper',0,0,1500),fx=new StepperFx(new Scene(),g);
  g.events.emit('blink',{ship:s,fromX:300,fromZ:1500});s.pos.set(9000,0,9000);g.interpolate();fx.prepare(0,720);
  const a=fx.spatial.tears.geometry.getAttribute('iCurveA');
  expect(fx.spatial.tears.count).toBeGreaterThan(0);expect(Array.from({length:fx.spatial.tears.count},(_,i)=>a.getX(i)).every(x=>x<1000)).toBe(true);fx.dispose();
});
it('releases every pooled instance buffer when a battle renderer is disposed',async()=>{
  const {StepperFx}=await import('../src/render/StepperFx');
  const g=emptyGame(),fx=new StepperFx(new Scene(),g);let releases=0;
  for(const m of [fx.ghosts,fx.spatial.tears,fx.spatial.shards])m.addEventListener('dispose',()=>releases++);
  fx.dispose();expect(releases).toBe(3);
});
it('keeps refraction viewport-specific and disables it under reduced motion',async()=>{
  const {StepperFx}=await import('../src/render/StepperFx');
  const g=emptyGame('open',7,'freeplay'),s=place(g,'stepper',1,0,1500);place(g,'yamato',0,0,-4000);s.mods.untargetable=true;
  const fx=new StepperFx(new Scene(),g);g.events.emit('blink',{ship:s,fromX:300,fromZ:1500});fx.update(.08);fx.prepare(0,720);expect(fx.distortions).toHaveLength(0);
  fx.prepare(1,720);expect(fx.distortions.length).toBeGreaterThan(0);fx.prepare(0,720);expect(fx.distortions).toHaveLength(0);fx.dispose();
  vi.stubGlobal('matchMedia',()=>({matches:true}));const reduced=new StepperFx(new Scene(),g);
  g.events.emit('blink',{ship:s,fromX:300,fromZ:1500});reduced.update(.08);reduced.prepare(1,720);expect(reduced.distortions).toHaveLength(0);expect(reduced.spatial.tears.count).toBeGreaterThan(0);reduced.dispose();
});
it('swings a Flicker arrival onto its target before the slash shows, and skips the swing under reduced motion',async()=>{
  const {StepperFx,FLICKER_TURN}=await import('../src/render/StepperFx');
  const g=emptyGame('open',7,'freeplay'),s=place(g,'stepper',0,0,1500),foe=place(g,'leviathan',1,0,0);
  foe.colossus=false;foe.hp=foe.maxHp=1e8;s.speed=foe.speed=0;s.throttle=foe.throttle=2;s.control.aimX=s.control.aimZ=0;s.meter=1;
  const fx=new StepperFx(new Scene(),g);
  expect(s.activateSkill(6)).toBe(true);
  while(!s.stepper!.flicker!.count)g.step();
  g.interpolate();const before=stateHash(g);
  const turn=fx.turnOffset(s);expect(Math.abs(turn)).toBeGreaterThan(.05);expect(Math.abs(turn)).toBeLessThanOrEqual(Math.PI);
  fx.update(FLICKER_TURN*.5,[s]);expect(Math.abs(fx.turnOffset(s))).toBeLessThan(Math.abs(turn));
  fx.update(FLICKER_TURN*.5+.001,[s]);expect(fx.turnOffset(s)).toBe(0);
  fx.prepare(0,720);expect(stateHash(g)).toBe(before);fx.dispose();
  // The slash blade waits for the swing.
  const slash=new StepperFx(new Scene(),g);
  g.events.emit('stepImpact',{ship:s,x:0,z:0,radius:150,kind:'flicker'});
  slash.update(0,[s]);slash.prepare(0,720);const early=slash.spatial.tears.count;
  slash.update(FLICKER_TURN+.01,[s]);slash.prepare(0,720);expect(slash.spatial.tears.count).toBeGreaterThan(early);slash.dispose();
  vi.stubGlobal('matchMedia',()=>({matches:true}));
  const reduced=new StepperFx(new Scene(),g);
  g.events.emit('stepImpact',{ship:s,x:0,z:0,radius:150,kind:'flicker'});reduced.update(0,[s]);reduced.prepare(0,720);
  expect(reduced.spatial.tears.count).toBeGreaterThan(early);
  g.events.emit('blink',{ship:s,fromX:900,fromZ:900,fromHeading:0});expect(reduced.turnOffset(s)).toBe(0);reduced.dispose();
});
