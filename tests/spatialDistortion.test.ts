import { expect,it } from 'vitest';
import { PerspectiveCamera } from 'three';
import { projectDistortions,MAX_DISTORTIONS,type SpatialDistortion } from '../src/render/SpatialDistortion';
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
