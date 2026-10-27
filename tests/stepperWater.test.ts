import { expect,it,vi } from 'vitest';
import { Scene } from 'three';
import { StepperWater } from '../src/render/StepperWater';
import { emptyGame } from './helpers';

it('conforms water wakes to the sea and excludes land triangles',()=>{
  const game=emptyGame(),scene=new Scene(),water=new StepperWater(scene,game);
  vi.spyOn(game.map,'heightAt').mockImplementation(x=>x>0?100:-100);
  water.begin();water.add(-50,0,0,.2,.6);water.end();
  const g=water.mesh.geometry,p=g.getAttribute('position');expect(g.drawRange.count).toBeGreaterThan(0);
  for(let i=0;i<g.drawRange.count;i++){expect(p.getX(i)).toBeLessThanOrEqual(0);expect(Number.isFinite(p.getY(i))).toBe(true);}
  water.begin();water.add(100,0,0,.2,.6);water.end();expect(g.drawRange.count).toBe(0);water.dispose();expect(scene.children).toHaveLength(0);
});
it('bounds simultaneous wakes and clears expired ripples',()=>{
  const game=emptyGame(),water=new StepperWater(new Scene(),game);vi.spyOn(game.map,'heightAt').mockReturnValue(-100);
  water.begin();for(let i=0;i<200;i++)water.add(i*10,0,0,.2,.6);water.end();
  expect(water.mesh.geometry.drawRange.count).toBeLessThanOrEqual(water.mesh.geometry.getAttribute('position').count);
  water.begin();water.add(0,0,0,1,.6);water.end();expect(water.mesh.geometry.drawRange.count).toBe(0);water.dispose();
});
