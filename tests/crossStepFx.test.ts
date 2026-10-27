import { expect, it } from 'vitest';
import { Scene } from 'three';
import { CrossStepFx } from '../src/render/CrossStepFx';
import { emptyGame, place, run } from './helpers';
import { stateHash } from '../src/net/hash';
import { cueAsset, FAMILY_ASSETS } from '../src/fx/SoundCues';

it('renders a bounded slash storm and finisher without altering simulation state', () => {
  const g = emptyGame('open', 7, 'freeplay');
  const s = place(g, 'stepper', 0, 0, 1500);
  const t = place(g, 'leviathan', 1, 0, 0);
  s.throttle = t.throttle = 2; s.speed = t.speed = 0;
  s.control.aimX = s.control.aimZ = 0; s.meter = 1;
  const fx = new CrossStepFx(new Scene(), g);
  s.activateSkill(7); run(g, 0.5);
  const before = stateHash(g);
  fx.update(0.1); fx.prepare(0, 720);
  expect(fx.light.count).toBeGreaterThan(100);
  expect(fx.dark.count).toBeGreaterThan(0);
  expect(fx.spatial.tears.count).toBeGreaterThan(0);
  expect(fx.spatial.shards.count).toBeGreaterThan(0);
  expect(stateHash(g)).toBe(before);
  run(g, 2.5); fx.update(0.01); fx.prepare(0, 720);
  expect(fx.light.count).toBeGreaterThan(0);
  fx.update(1); fx.prepare(0, 720);
  expect(fx.light.count).toBe(0);
  expect(fx.dark.count).toBe(0);
  expect(fx.spatial.tears.count).toBe(0);
  expect(fx.spatial.shards.count).toBe(0);
  fx.dispose();
});
it('routes the continuous Cross-step impacts to slash recordings', () => {
  expect(cueAsset('crossStep','activate','impact')).toBe(FAMILY_ASSETS.slash);
  expect(cueAsset('crossStep','impact','impact')).toBe(FAMILY_ASSETS.slash);
});
it('advances actual jump sweeps continuously and lets them fade before retirement',()=>{
  const g=emptyGame('open',7,'freeplay'),s=place(g,'stepper',0,0,1500),fx=new CrossStepFx(new Scene(),g);
  s.meter=1;s.control.aimX=s.control.aimZ=0;expect(s.activateSkill(7)).toBe(true);
  fx.update(.34);fx.prepare(0,720);
  const phase=fx.spatial.tears.geometry.getAttribute('iPhase');
  const ages=Array.from({length:fx.spatial.tears.count},(_,i)=>i).filter(i=>phase.getW(i)===2).map(i=>phase.getX(i));
  expect(ages.some(age=>age>.95)).toBe(true);
  fx.update(.28);fx.prepare(0,720);
  // Only the quiet persistent scar remains after the active sweep has dissipated.
  expect(fx.spatial.tears.count).toBe(1);fx.dispose();
});
it('releases instance GPU buffers along with Cross-step geometry',()=>{
  const g=emptyGame(),fx=new CrossStepFx(new Scene(),g);let releases=0;
  for(const m of [fx.spatial.tears,fx.spatial.shards])m.addEventListener('dispose',()=>releases++);
  fx.dispose();expect(releases).toBe(2);
});
it('keeps the public zone but hides actual Cross jump paths from enemies while concealed',()=>{
  const g=emptyGame('open',7,'freeplay'),s=place(g,'stepper',1,0,1500),fx=new CrossStepFx(new Scene(),g);
  place(g,'yamato',0,0,-6000);s.meter=1;s.control.aimX=s.control.aimZ=0;expect(s.activateSkill(7)).toBe(true);
  s.mods.untargetable=true;s.mods.revealed=false;s.stepper!.cross!.elapsed=.15;fx.update(.1);
  const curves=()=>{const phase=fx.spatial.tears.geometry.getAttribute('iPhase');return Array.from({length:fx.spatial.tears.count},(_,i)=>phase.getW(i)).filter((k,i)=>k===2&&phase.getZ(i)<1000).length;};
  fx.prepare(0,720);expect(fx.light.count).toBeGreaterThan(0);expect(curves()).toBe(0);expect(fx.spatial.shards.count).toBe(0);expect(fx.distortions).toHaveLength(0);
  fx.prepare(1,720);expect(curves()).toBeGreaterThan(0);expect(fx.spatial.shards.count).toBeGreaterThan(0);
  s.mods.revealed=true;fx.prepare(0,720);expect(curves()).toBeGreaterThan(0);
  s.mods.revealed=false;g.events.emit('crossStep',{ship:s,x:0,z:0,radius:1000,phase:'finish'});fx.update(.05);fx.prepare(0,720);expect(curves()).toBe(0);
  // The finisher may still show a public center burst, but no ship-position-derived curve.
  fx.prepare(1,720);expect(curves()).toBeGreaterThan(0);fx.dispose();
});
it('spreads the visible slash storm even when successive ship landings coincide',()=>{
  const g=emptyGame('open',7,'freeplay'),s=place(g,'stepper',0,0,1500),fx=new CrossStepFx(new Scene(),g);
  s.meter=1;s.control.aimX=s.control.aimZ=0;s.activateSkill(7);s.stepper!.cross!.elapsed=1.12;
  for(let i=0;i<5;i++)g.events.emit('blink',{ship:s,fromX:s.pos.x+1,fromZ:s.pos.z});
  fx.update(.1);fx.prepare(0,720);
  const geo=fx.spatial.tears.geometry,p=geo.getAttribute('iPhase'),a=geo.getAttribute('iCurveA'),b=geo.getAttribute('iCurveC');
  const cuts=Array.from({length:fx.spatial.tears.count},(_,i)=>i).filter(i=>p.getZ(i)>=1000);
  expect(cuts.length).toBeGreaterThanOrEqual(4);
  const quadrants=new Set(cuts.map(i=>`${Math.sign(a.getX(i))}/${Math.sign(a.getZ(i))}`));expect(quadrants.size).toBeGreaterThanOrEqual(3);
  for(const i of cuts)expect(Math.hypot(a.getX(i)-b.getX(i),a.getZ(i)-b.getZ(i))).toBeGreaterThan(1000);
  fx.dispose();
});
it('converges distributed cut controls along with their endpoints at the finisher',()=>{
  const g=emptyGame('open',7,'freeplay'),s=place(g,'stepper',0,0,1500),fx=new CrossStepFx(new Scene(),g);
  g.events.emit('crossStep',{ship:s,x:0,z:0,radius:1000,phase:'finish'});fx.update(.3);fx.prepare(0,720);
  const geo=fx.spatial.tears.geometry,phase=geo.getAttribute('iPhase'),control=geo.getAttribute('iCurveB');
  const cuts=Array.from({length:fx.spatial.tears.count},(_,i)=>i).filter(i=>phase.getZ(i)>=1000);
  expect(cuts).toHaveLength(6);for(const i of cuts)expect(Math.hypot(control.getX(i),control.getZ(i))).toBeLessThan(110);fx.dispose();
});
