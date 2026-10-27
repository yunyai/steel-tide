import {it,expect,vi} from 'vitest';
import {Scene} from 'three';
import {emptyGame,place} from './helpers';
import {SkillFx} from '../src/render/SkillFx';
import {ParticleSystem} from '../src/fx/Particles';
import {audio} from '../src/fx/Audio';
it('releases beam audio on simulated fire and never after cancelled charge or scene disposal',()=>{
 vi.useFakeTimers();vi.stubGlobal('window',{setTimeout});const play=vi.spyOn(audio,'play').mockImplementation(()=>{});
 const g=emptyGame('open',7,'freeplay'),s=place(g,'goku',0,0,1500),particles=[new ParticleSystem(100,'alpha'),new ParticleSystem(100,'add'),new ParticleSystem(100,'flat')],fx=new SkillFx(g,new Scene(),particles[0],particles[1],particles[2]);
 try{
  const beam=g.beams.fire(s,{mode:'aim',skill:s.skills[0].spec,charge:1,time:2,dps:0,width:30,length:2000});fx.update(0);play.mockClear();vi.advanceTimersByTime(2000);expect(play.mock.calls.some(c=>c[0]==='laser')).toBe(false);
  beam.age=1.1;fx.update(0);expect(play.mock.calls.filter(c=>c[0]==='laser')).toHaveLength(1);fx.update(0);expect(play.mock.calls.filter(c=>c[0]==='laser')).toHaveLength(1);
  beam.alive=false;g.beams.fire(s,{mode:'aim',skill:s.skills[0].spec,charge:1,time:2,dps:0,width:30,length:2000});fx.update(0);play.mockClear();fx.dispose();vi.advanceTimersByTime(2000);expect(play).not.toHaveBeenCalled();
 }finally{play.mockRestore();vi.useRealTimers();vi.unstubAllGlobals();for(const p of particles)p.dispose();}
});
