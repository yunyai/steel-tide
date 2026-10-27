import { expect, it } from 'vitest';
import { Color, Scene } from 'three';
import { StepperSpatial } from '../src/render/StepperSpatial';

it('uses a closed curved surface with real depth rather than a billboard',()=>{
  const fx=new StepperSpatial(new Scene(),'test'),geo=fx.tears.geometry,p=geo.getAttribute('position');
  expect(p.count).toBeGreaterThan(100);
  expect(Array.from({length:p.count},(_,i)=>Math.abs(p.getZ(i))).some(z=>z>.01)).toBe(true);
  expect(geo.index).not.toBeNull();fx.dispose();
});
it('supports degenerate and vertical cuts with finite instance transforms',()=>{
  const fx=new StepperSpatial(new Scene(),'test'),c=new Color('white');
  fx.begin();fx.blade(0,0,0,0,0,0,10,.2,c,1);expect(fx.tears.count).toBe(0);
  fx.blade(0,0,0,0,100,0,10,.2,c,1);fx.tear(10,20,30,1,100,200,.3,c,2);fx.end();
  expect(fx.tears.count).toBe(2);expect(Array.from(fx.tears.instanceMatrix.array).every(Number.isFinite)).toBe(true);fx.dispose();
});

it('keeps a single continuous curve anchored to its world endpoints and control point',()=>{
  const fx=new StepperSpatial(new Scene(),'test'),c=new Color('white');
  fx.arc(-500,30,400,0,240,-300,600,40,500,180,.35,c,4);
  const a=fx.tears.geometry.getAttribute('iCurveA'),b=fx.tears.geometry.getAttribute('iCurveB'),end=fx.tears.geometry.getAttribute('iCurveC');
  expect([a.getX(0),a.getZ(0),b.getY(0),end.getX(0),end.getZ(0)]).toEqual([-500,400,240,600,500]);
  expect(fx.tears.count).toBe(1);fx.dispose();
});
it('does not let full geometry pools overflow the instance attributes',()=>{
  const fx=new StepperSpatial(new Scene(),'test'),c=new Color('white');
  for(let i=0;i<1000;i++)fx.arc(0,0,0,100,50,100,200,0,0,80,.3,c,i);
  expect(fx.tears.count).toBe(384);fx.end();expect(Array.from(fx.tears.geometry.getAttribute('iCurveA').array).every(Number.isFinite)).toBe(true);
  fx.begin();expect(fx.tears.count).toBe(0);fx.dispose();
});
