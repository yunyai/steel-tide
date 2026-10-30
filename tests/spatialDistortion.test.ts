import { expect,it } from 'vitest';
import { PerspectiveCamera } from 'three';
import { projectDistortions,MAX_DISTORTIONS,LENS_SHIFT_GLSL,type SpatialDistortion } from '../src/render/SpatialDistortion';
const camera=()=>{const c=new PerspectiveCamera(60,16/9,1,10000);c.position.set(0,0,1000);c.lookAt(0,0,0);c.updateMatrixWorld(true);return c;};
const field=(x=0):SpatialDistortion=>({x,y:0,z:0,radius:100,strength:.7,priority:1});
it('projects visible fields and rejects behind-camera and invalid anchors',()=>{
  const result=projectDistortions([field(),{...field(),z:1100},{...field(),x:NaN},{...field(),x:1e8}],camera());
  expect(result).toHaveLength(1);expect(result[0].shape.x).toBeCloseTo(.5);expect(result[0].depth.x).toBeCloseTo(1000);
});
it('prioritizes local actions and merges overlapping copies without stacking strength',()=>{
  const result=projectDistortions([...Array.from({length:80},()=>field()),{...field(),priority:4,strength:.9}],camera());
  expect(result).toHaveLength(1);expect(result[0].shape.w).toBeCloseTo(.9);
});
it('bounds the viewport field budget and does not retain previous viewport data',()=>{
  const fields=Array.from({length:100},(_,i)=>({...field((i%10-5)*100),y:(Math.floor(i/10)-5)*80,radius:12}));
  expect(projectDistortions(fields,camera())).toHaveLength(MAX_DISTORTIONS);expect(projectDistortions([],camera())).toHaveLength(0);
});
it('marks gravitational lenses apart from ring bends',()=>{
  const [ring,lens]=projectDistortions([field(-300),{...field(300),kind:'lens'}],camera()).sort((a,b)=>a.shape.x-b.shape.x);
  expect(ring.depth.z).toBe(0);expect(lens.depth.z).toBe(1);
});
it('bends only the ring between a black hole and its lens rim',()=>{
  // The profile is GLSL written in the subset JavaScript parses, so this runs exactly what the shader runs.
  const clamp=(x:number,a:number,b:number)=>Math.min(b,Math.max(a,x)),mix=(a:number,b:number,k:number)=>a+(b-a)*k;
  const smoothstep=(a:number,b:number,x:number)=>{const k=clamp((x-a)/(b-a),0,1);return k*k*(3-2*k);};
  const js=LENS_SHIFT_GLSL.replace('float lensShift(float r)','function lensShift(r)').replace(/\bfloat /g,'let ');
  const shift=new Function('clamp','mix','smoothstep',`${js};return lensShift;`)(clamp,mix,smoothstep) as (r:number)=>number;
  for(const r of [0,.15,.3])expect(shift(r)).toBe(0);
  for(const r of [.4,.6,.8])expect(shift(r)).toBeGreaterThan(0);
  expect(shift(.999)).toBeLessThan(.01);
  for(const r of [1,1.5,3,10])expect(shift(r)).toBe(0);
});
