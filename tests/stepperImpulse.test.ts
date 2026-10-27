import {afterEach,expect,it,vi} from 'vitest';
import { PlayerController } from '../src/player/PlayerController';
import { emptyGame,place } from './helpers';
import { setControls } from '../src/input/Settings';
afterEach(()=>{vi.unstubAllGlobals();setControls({shake:1});});
it('adds a short finisher impulse without changing aim or the underlying camera path',()=>{
  const g=emptyGame('open',7,'freeplay'),s=place(g,'stepper',0,0,1500),a=new PlayerController(s,'mouse',0,g),b=new PlayerController(s,'mouse',0,g);
  s.meter=1;s.control.aimX=s.control.aimZ=0;s.activateSkill(7);g.interpolate();
  a.updateCamera(0);b.updateCamera(0);const aim=[s.control.aimX,s.control.aimZ];
  a.stepFinisher();a.updateCamera(.05);b.updateCamera(.05);expect(a.camera.position.y).toBeGreaterThan(b.camera.position.y);
  expect([s.control.aimX,s.control.aimZ]).toEqual(aim);
  a.updateCamera(.2);b.updateCamera(.2);expect(a.camera.position.distanceTo(b.camera.position)).toBeLessThan(.0001);
});
it('disables the impulse for reduced motion and the saved shake-off preference',()=>{
  const g=emptyGame('open',7,'freeplay'),s=place(g,'stepper',0,0,1500);s.meter=1;s.control.aimX=s.control.aimZ=0;s.activateSkill(7);g.interpolate();
  for(const reduce of [false,true]){
    vi.stubGlobal('matchMedia',()=>({matches:reduce}));setControls({shake:reduce?1:0});
    const pc=new PlayerController(s,'mouse',0,g);pc.updateCamera(0);const before=pc.camera.position.clone();pc.stepFinisher();pc.updateCamera(.05);expect(pc.camera.position.distanceTo(before)).toBeLessThan(.0001);
  }
});
