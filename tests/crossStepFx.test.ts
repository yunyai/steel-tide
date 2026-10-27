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
it('lets retained curved cuts finish their fade before replacing them',()=>{
  const g=emptyGame('open',7,'freeplay'),s=place(g,'stepper',0,0,1500),fx=new CrossStepFx(new Scene(),g);
  s.meter=1;s.control.aimX=s.control.aimZ=0;expect(s.activateSkill(7)).toBe(true);
  s.stepper!.cross!.elapsed=1.349;
  fx.prepare(0,720);
  const phase=fx.spatial.tears.geometry.getAttribute('iPhase');
  const bladeAges=Array.from({length:fx.spatial.tears.count},(_,i)=>i).filter(i=>phase.getW(i)===1).map(i=>phase.getX(i));
  expect(bladeAges.length).toBeGreaterThan(0);expect(Math.max(...bladeAges)).toBeGreaterThan(.99);fx.dispose();
});
it('releases instance GPU buffers along with Cross-step geometry',()=>{
  const g=emptyGame(),fx=new CrossStepFx(new Scene(),g);let releases=0;
  for(const m of [fx.spatial.tears,fx.spatial.shards])m.addEventListener('dispose',()=>releases++);
  fx.dispose();expect(releases).toBe(2);
});
