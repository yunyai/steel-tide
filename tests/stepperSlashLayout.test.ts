import {expect,it} from 'vitest';
import {stepperSlashLayout} from '../src/render/StepperSlashLayout';
it('distributes consecutive slash directions and offsets across the whole attack zone',()=>{
  const cuts=Array.from({length:60},(_,i)=>stepperSlashLayout(i));
  for(let i=1;i<cuts.length;i++){
    const a=cuts[i-1],b=cuts[i],ax=a.bx-a.ax,az=a.bz-a.az,bx=b.bx-b.ax,bz=b.bz-b.az;
    const parallel=Math.abs((ax*bx+az*bz)/Math.hypot(ax,az)/Math.hypot(bx,bz));expect(parallel).toBeLessThan(.8);
    expect(Math.hypot(a.cx-b.cx,a.cz-b.cz)).toBeGreaterThan(180);
  }
  for(const p of cuts){expect(Math.hypot(p.ax,p.az)).toBeCloseTo(1000);expect(Math.hypot(p.bx,p.bz)).toBeCloseTo(1000);expect(Math.hypot(p.cx,p.cz)).toBeLessThan(1000);}
});
