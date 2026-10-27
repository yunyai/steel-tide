import { Vector3 } from 'three';
import type { Ship } from '../ships/Ship';

/** Presentation coordinates only: +X is the cannon's forward axis. */
export const ASSEMBLY_HEIGHT = 125;
export const ASSEMBLY_MUZZLE = 350;
export const smooth = (v:number):number => {const k=Math.max(0,Math.min(1,v));return k*k*(3-2*k);};
export const reducedMotion = ():boolean => typeof matchMedia==='function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function satellitePose(s:Ship,index:number,reduce:boolean,out:Vector3):Vector3 {
  const u=s.architect!.ultimate!,elapsed=u.elapsed;
  const ring=index%2,angle=Math.floor(index/2)*Math.PI*2/5+ring*Math.PI/5+(reduce?0:Math.max(0,elapsed-1.5)*.18);
  const spread=smooth((elapsed-1.5)/.45)*(1-smooth((elapsed-3.7)/.3)),radius=ring?104:85;
  const t=s.spec.main!.turrets[index],rel=Math.atan2(u.aimX-s.pos.x,-(u.aimZ-s.pos.z))-s.renderHeading,c=Math.cos(rel),sn=Math.sin(rel);
  // Continue from the physical module's docking point, then return to that socket after firing.
  const x=c*t.x+sn*(t.z??0),y=s.spec.freeboard+t.y-ASSEMBLY_HEIGHT,z=-sn*t.x+c*(t.z??0);
  return out.set(x+((ring?145:-80)-x)*spread,y+(Math.sin(angle)*radius-y)*spread,z+(Math.cos(angle)*radius-z)*spread);
}

export function assemblyWorld(s:Ship,x:number,y:number,z:number,out:Vector3):Vector3 {
  const u=s.architect!.ultimate!,h=Math.atan2(u.aimX-s.pos.x,-(u.aimZ-s.pos.z));
  return out.set(s.renderPos.x+Math.sin(h)*x+Math.cos(h)*z,s.renderPos.y+ASSEMBLY_HEIGHT+y,s.renderPos.z-Math.cos(h)*x+Math.sin(h)*z);
}
