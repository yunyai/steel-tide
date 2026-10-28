import type { ArchitectType } from '../../data/architectLoadout';
import type { ArchitectBatteryArc, ArchitectBatteryCarrier, ArchitectBatteryHeadPose, ArchitectBatteryLayout, ArchitectBatteryPoint, ArchitectBatteryStage } from '../../data/architectBattery';
import { MAP_HALF } from '../../config';

export const BATTERY_HEAD_SCALE=2.25;
export const BATTERY_HEAD_RADIUS=145;
const clamp=(x:number)=>Math.max(0,Math.min(1,x));
const smooth=(x:number)=>{const t=clamp(x);return t*t*(3-2*t);};
const socketX:Record<ArchitectType,number>={furnace:110,cryo:133.5,storm:110,gravity:110,prism:123,sentinel:124.5,abyss:110,restoration:110,bastion:110,resonance:110,swarm:110};
const socketY:Partial<Record<ArchitectType,number>>={cryo:5,prism:13,sentinel:5};
export interface BatteryPathInput {
  readonly carrier:ArchitectBatteryCarrier; readonly center:ArchitectBatteryPoint; readonly radius:number;
  readonly slot:number; readonly stage:ArchitectBatteryStage; readonly type:ArchitectType;
  readonly layout:ArchitectBatteryLayout; readonly groundHeight:(x:number,z:number)=>number;
}
export interface BatteryPoseInput extends BatteryPathInput {
  readonly head:0|1; readonly elapsed:number; readonly recoilAge?:number; readonly reducedMotion?:boolean;
  /** A cached/committed arc skips terrain planning during presentation. */
  readonly path?:ArchitectBatteryArc;
}
export interface BatteryHeadPose extends ArchitectBatteryHeadPose {
  readonly scale:number; readonly shutter:number; readonly carriage:number; readonly lock:number;
  readonly socketX:number; readonly socketY:number; readonly pivotHeight:number; readonly barrelRetraction:number;
}

/** Frozen positions are independent of normal weapon tracking and recipient visibility. */
export function architectBatteryHeadPosition(carrier:ArchitectBatteryCarrier,center:ArchitectBatteryPoint,layout:ArchitectBatteryLayout,head:0|1):ArchitectBatteryPoint {
  const side=head?1:-1;
  if(layout==='folded')return {x:carrier.x+Math.sin(carrier.heading)*side*26,y:carrier.y+12,z:carrier.z-Math.cos(carrier.heading)*side*26};
  const angle=Math.atan2(carrier.z-center.z,carrier.x-center.x),radius=Math.hypot(carrier.x-center.x,carrier.z-center.z),offset=(layout==='wide'?9:6)*Math.PI/180;
  return {x:center.x+Math.cos(angle+side*offset)*radius,y:carrier.y+13,z:center.z+Math.sin(angle+side*offset)*radius};
}

/** Test complete feet, swept barrel footprints and both sides of each solid truss. */
export function planArchitectBatteryLayout(carrier:ArchitectBatteryCarrier,center:ArchitectBatteryPoint,groundHeight:(x:number,z:number)=>number):ArchitectBatteryLayout {
  const wet=(x:number,z:number)=>Math.abs(x)<MAP_HALF-8&&Math.abs(z)<MAP_HALF-8&&groundHeight(x,z)<0;
  for(const layout of ['wide','compact'] as const){
    let fits=true;
    for(const head of [0,1] as const){
      const p=architectBatteryHeadPosition(carrier,center,layout,head),yaw=Math.atan2(center.z-p.z,center.x-p.x),fx=Math.cos(yaw),fz=Math.sin(yaw);
      for(let i=0;i<24;i++){const a=i*Math.PI/12;if(!wet(p.x+Math.cos(a)*BATTERY_HEAD_RADIUS,p.z+Math.sin(a)*BATTERY_HEAD_RADIUS))fits=false;}
      for(let d=-200;d<=310;d+=25)for(const side of [-50,0,50])if(!wet(p.x+fx*d-fz*side,p.z+fz*d+fx*side))fits=false;
      const dx=p.x-carrier.x,dz=p.z-carrier.z,len=Math.hypot(dx,dz)||1;
      for(let d=0;d<=len;d+=20)for(const side of [-24,0,24])if(!wet(carrier.x+dx*d/len-dz/len*side,carrier.z+dz*d/len+dx/len*side))fits=false;
    }
    if(fits)return layout;
  }
  // The original targetable hub was validated by formation(). Cosmetic scale cannot veto it.
  return 'folded';
}

export function architectBatteryImpactCell(input:BatteryPathInput,head:0|1):ArchitectBatteryPoint {
  const {carrier,center,radius,stage,slot,groundHeight}=input;
  const angle=Math.atan2(carrier.z-center.z,carrier.x-center.x)+(head?.085:-.085);
  const inner=[.34,.43,.39,.46][stage],outer=[.75,.82,.72,.84][stage],r=radius*((head?outer:inner)+(slot%2?.015:-.015));
  const x=center.x+Math.cos(angle)*r,z=center.z+Math.sin(angle)*r;
  return {x,y:Math.max(2,groundHeight(x,z)+2),z};
}

export function sampleArchitectBatteryArc(arc:ArchitectBatteryArc,t:number):ArchitectBatteryPoint {
  const f=clamp(t),a=(1-f)*(1-f),b=2*f*(1-f),c=f*f;
  return {x:a*arc.muzzle.x+b*arc.control.x+c*arc.impact.x,y:a*arc.muzzle.y+b*arc.control.y+c*arc.impact.y,z:a*arc.muzzle.z+b*arc.control.z+c*arc.impact.z};
}

/** The shoreline form is authored at full dimensions, not a uniformly shrunk siege gun. */
export function architectBatteryHardware(type:ArchitectType,layout:ArchitectBatteryLayout){
 return layout==='folded'?{scale:1,pivotHeight:58,socketX:114,socketY:0,barrelRetraction:55}:{scale:BATTERY_HEAD_SCALE,pivotHeight:39,socketX:socketX[type],socketY:socketY[type]??6.5,barrelRetraction:55};
}

function solve(input:BatteryPathInput,head:0|1):{path:ArchitectBatteryArc;yaw:number;pitch:number} {
  const position=architectBatteryHeadPosition(input.carrier,input.center,input.layout,head),hardware=architectBatteryHardware(input.type,input.layout),scale=hardware.scale;
  const impact=architectBatteryImpactCell(input,head),pivot={x:position.x,y:position.y+hardware.pivotHeight*scale,z:position.z};
  let lift=input.stage===3?550:400,yaw=Math.atan2(impact.z-pivot.z,impact.x-pivot.x),pitch=.6;
  let muzzle:ArchitectBatteryPoint=pivot,control:ArchitectBatteryPoint=pivot;
  const sx=hardware.socketX*scale,sy=hardware.socketY*scale;
  for(let clearance=0;clearance<4;clearance++){
    if(input.layout==='folded'){
      // A vertical initial tangent keeps every physical part inside the validated hub;
      // the quadratic path bends toward its independent saturation cell after launch.
      yaw=input.carrier.heading-Math.PI/2;pitch=Math.PI/2;
      muzzle={x:pivot.x,y:pivot.y+sx,z:pivot.z};
      control={x:muzzle.x,y:(muzzle.y+impact.y)/2+2*lift,z:muzzle.z};
    }else for(let i=0;i<24;i++){
      const horizontal=sx*Math.cos(pitch)-sy*Math.sin(pitch);
      muzzle={x:pivot.x+Math.cos(yaw)*horizontal,y:pivot.y+sx*Math.sin(pitch)+sy*Math.cos(pitch),z:pivot.z+Math.sin(yaw)*horizontal};
      control={x:(muzzle.x+impact.x)/2,y:(muzzle.y+impact.y)/2+2*lift,z:(muzzle.z+impact.z)/2};
      yaw=Math.atan2(control.z-muzzle.z,control.x-muzzle.x);
      pitch=Math.atan2(control.y-muzzle.y,Math.hypot(control.x-muzzle.x,control.z-muzzle.z));
    }
    const arc={muzzle,control,impact};let extra=0;
    const samples=Math.max(64,Math.ceil(Math.hypot(impact.x-muzzle.x,impact.z-muzzle.z)/12));
    for(let n=1;n<samples;n++){
      const t=n/samples,p=sampleArchitectBatteryArc(arc,t),ground=input.groundHeight(p.x,p.z);
      if(ground>=0)extra=Math.max(extra,(ground+18-p.y)/(4*t*(1-t)));
    }
    if(extra<=.001)return {path:arc,yaw,pitch};
    lift+=extra+5;
  }
  return {path:{muzzle,control,impact},yaw,pitch};
}

export function buildArchitectBatteryPaths(input:BatteryPathInput):readonly [ArchitectBatteryArc,ArchitectBatteryArc] {
  return [solve(input,0).path,solve(input,1).path];
}

/** One pose drives receiver/barrel transforms and launch sockets. No game or render state is written. */
export function getArchitectBatteryHeadPose(input:BatteryPoseInput):BatteryHeadPose {
  const full=architectBatteryHeadPosition(input.carrier,input.center,input.layout,input.head),hardware=architectBatteryHardware(input.type,input.layout),scale=hardware.scale;
  const elapsed=input.elapsed,recovery=1-smooth((elapsed-8.15)/.65),shutter=smooth(elapsed/.35)*recovery,carriage=smooth((elapsed-.35)/.6)*recovery,lock=smooth((elapsed-.95)/.35)*recovery;
  const position={x:input.carrier.x+(full.x-input.carrier.x)*carriage,y:full.y-(input.layout==='folded'?65:170)*(1-carriage),z:input.carrier.z+(full.z-input.carrier.z)*carriage};
  const solved=input.path?{path:input.path,yaw:Math.atan2(input.path.control.z-input.path.muzzle.z,input.path.control.x-input.path.muzzle.x),pitch:Math.atan2(input.path.control.y-input.path.muzzle.y,Math.hypot(input.path.control.x-input.path.muzzle.x,input.path.control.z-input.path.muzzle.z))}:solve(input,input.head);
  const yaw=input.layout==='folded'?input.carrier.heading-Math.PI/2:solved.yaw,pitch=input.layout==='folded'?Math.PI/2:solved.pitch+(1-lock)*.65,extension=.3+.7*lock;
  const kick=input.stage===3?42:28,attack=input.stage===3?.09:.07,release=input.stage===3?.4:.26,age=input.recoilAge??Infinity;
  const recoil=age<0?0:age<attack?kick*smooth(age/attack):kick*(1-smooth((age-attack)/release));
  const back=recoil*(input.reducedMotion?.2:1),sx=hardware.socketX*scale*extension-back-hardware.barrelRetraction*(1-lock)*scale,sy=hardware.socketY*scale;
  const horizontal=sx*Math.cos(pitch)-sy*Math.sin(pitch);
  const muzzle={x:position.x+Math.cos(yaw)*horizontal,y:position.y+hardware.pivotHeight*scale+sx*Math.sin(pitch)+sy*Math.cos(pitch),z:position.z+Math.sin(yaw)*horizontal};
  return {position,yaw,pitch,extension,recoil:back,muzzle:lock===1&&back===0?solved.path.muzzle:muzzle,scale,shutter,carriage,lock,socketX:hardware.socketX,socketY:hardware.socketY,pivotHeight:hardware.pivotHeight,barrelRetraction:hardware.barrelRetraction};
}
