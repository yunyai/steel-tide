import { arsenalTeam } from './ArchitectTargets';
import { ARCHETYPES, validSelection, copyLoadout, type ArchitectLoadout, type ArchitectType } from '../../data/architectLoadout';
import { newElementState, updateElements, moduleLinked, elementTarget, fireCapacitorBolt, type ArchitectElement, type ElementState } from './ArchitectElements';
import { ensureArchitectHealth, detachArchitectHealth, returnArchitectHealth, rebuildArchitectHealth, ARCHITECT_FULL_HP, MODULE_COMBAT_HP, PLATFORM_HEALTH_RATIO } from './ArchitectHealth';
import { Vector3 } from 'three';
import type { Mods, Ship, TurretState } from '../../ships/Ship';
import type { SkillSpec } from '../../core/types';
import { canTrack } from '../../core/Targeting';
import { MAP_HALF } from '../../config';
import { bearingTo, DEG, wrapAngle, wrapDeg } from '../../core/math';
import { distToHull, segmentHitsHull } from '../../core/hull';
import { hurt } from '../kit';
import { safeStep, type Landing } from './StepperRuntime';
import { updateArchitectUltimate, endArchitectUltimate, type ArchitectUltimate } from './ArchitectUltimates';
import { BATTERY_FOLD_TIME } from './ArchitectBatteryPose';

export type ModuleMode = 'docked'|'launching'|'deployed'|'moving'|'returning'|'destroyed'|'assembling'|'citadel';
export interface ModuleSlot {
  type:ArchitectType; skill:0|1; element:ArchitectElement; skillTimer:number; castGap:number; opening:boolean; boostUntil:number; reactionUntil:number; aboard:boolean; index:number; state:ModuleMode; hp:number; reload:number; reloadScale:number; disabled:number; rebuild:number; dockedFor:number;
  entity:Ship|null;
  path:{ x:number;y:number;z:number;tx:number;ty:number;tz:number;elapsed:number;duration:number;hit:number[];damage:boolean;settling?:boolean }|null;
  capacitorCycles:0|1;capacitorCharged:boolean;
  follow:HoverOrbit|null;
}
export interface ArchitectState {
  huntTarget:number;huntUntil:number;elements:ElementState; fullHp:number;moduleHp:number;healthReady:boolean;healthTransfer:boolean;
  slots:ModuleSlot[];
  links:{a:number;b:number}[];linkUntil:number;linkTick:number;
  ultimate:ArchitectUltimate|null;
  clearing:boolean;
  drive:{dx:number;dz:number;elapsed:number;distance:number;moving:boolean;from:number;travelled:number;hit:number[]}|null;
  capacitorReadyAt:number;
}
export interface ArchitectPlatform { owner:Ship; index:number }
/** One Mobile Battery escort: each platform keeps its own orbit radius, altitude, tilt and pace around Architect. */
export interface HoverOrbit { angle:number;radius:number;height:number;tilt:number;phase:number;rate:number }
export const MODULE_HP=MODULE_COMBAT_HP;
const smooth=(x:number)=>{const t=Math.max(0,Math.min(1,x));return t*t*(3-2*t);};
export function newArchitectState(_rng:()=>number=()=>.5,loadout?:ArchitectLoadout):ArchitectState {
  const selections=copyLoadout(loadout);
  return {huntTarget:-1,huntUntil:0,elements:newElementState(),fullHp:ARCHITECT_FULL_HP,moduleHp:MODULE_COMBAT_HP,healthReady:false,healthTransfer:false,slots:Array.from({length:10},(_,index)=>({type:selections[index].type,skill:selections[index].skill,element:ARCHETYPES[selections[index].type].element,skillTimer:0,castGap:0,opening:false,boostUntil:0,reactionUntil:0,aboard:true,index,state:'docked',hp:MODULE_HP,reload:0,reloadScale:2/3,disabled:0,rebuild:0,dockedFor:0,entity:null,path:null,capacitorCycles:0,capacitorCharged:false,follow:null})),links:[],linkUntil:0,linkTick:0,ultimate:null,clearing:false,drive:null,capacitorReadyAt:0};
}
export function architectDockingStatus(s:Ship){
  const a=s.architect,slots=a?.slots.filter(v=>v.state==='docked'&&v.hp>0)??[];
  return {count:slots.length,damageReduction:Math.min(.2,slots.length*.02),hullRegenPerSecond:(a?.fullHp??0)*Math.min(.004,slots.filter(v=>v.dockedFor>2).length*.0004),capacitors:a?.slots.filter(v=>v.capacitorCharged).length??0,chargingCycles:a?.slots.reduce((n,v)=>n+v.capacitorCycles,0)??0};
}
export interface VectorMobilityState {
  /** Charges ready now, and the time each spent charge comes back (ascending); spent charges recharge in parallel. */
  dashCharges:number;dashRecharge:number[];mobileReadyAt:number;mobileUntil:number;mobileDuration:number;
}
const DASH_TIME=.55,DASH_RECHARGE=10,MOBILE_COOLDOWN=14,HOVER_SPEED=1200,HOVER_CLEARANCE=80,HOVER_LANDING=1.2;
/** Hull Dash pose: the bow swings onto the dash bearing, the hull lifts clear of the water and sets back down. */
const DASH_TURN=.15,DASH_RISE=.12,DASH_LIFT=50;
/** Per living Vector, with no cap: the arsenal is meant to stack into something ridiculous. */
export const VECTOR_THRUST={speed:.06,accel:.2,turn:.12,rudder:.12,traverse:.15,escort:.15} as const;
/** Per living Resonance, with no cap: every gun on the hull and the platforms reloads this much faster. */
export const RESONANCE_TEMPO=.1;
function living(s:Ship,type:ArchitectType):ModuleSlot[]{return s.architect?.slots.filter(v=>v.type===type&&v.state!=='destroyed'&&v.hp>0&&(!v.entity||v.entity.alive&&v.entity.hp>0))??[];}
const livingVectors=(s:Ship)=>living(s,'vector');
/** Living Vectors and their specializations; destroyed Vectors stop counting until rebuilt. */
export function vectorStats(s:Ship):{count:number;dashSpecs:number;mobileSpecs:number}{
  const v=livingVectors(s);return {count:v.length,dashSpecs:v.filter(x=>x.skill===0).length,mobileSpecs:v.filter(x=>x.skill===1).length};
}
/**
 * Arsenal passives on the hull. Thrusters: every living Vector adds speed, acceleration, helm and
 * turret traverse. Tempo: every living Resonance shortens gun reloads; platforms inherit it from the hull.
 */
export function applyArsenalPassives(s:Ship,m:Mods):void{
  const n=livingVectors(s).length,r=living(s,'resonance').length;
  if(n){m.speedMul*=1+VECTOR_THRUST.speed*n;m.accelMul*=1+VECTOR_THRUST.accel*n;m.turnMul*=1+VECTOR_THRUST.turn*n;m.rudderMul*=1+VECTOR_THRUST.rudder*n;m.traverseMul*=1+VECTOR_THRUST.traverse*n;}
  if(r)m.reloadMul/=1+RESONANCE_TEMPO*r;
}
/** Dash specializations add reach and charges; Mobile Battery specializations add time and shorten the recharge. */
export function vectorTuning(s:Ship){
  const {count,dashSpecs,mobileSpecs}=vectorStats(s),extraDash=Math.max(0,dashSpecs-1),extraMobile=Math.max(0,mobileSpecs-1);
  let cooldown=MOBILE_COOLDOWN;for(let i=0;i<extraMobile;i++)cooldown*=.85;
  const extra=Math.max(0,count-1);
  return {count,dashSpecs,mobileSpecs,dashDistance:dashSpecs?1100+150*extraDash:800,dashCharges:2+extraDash,mobileDuration:mobileSpecs?14+3*extraMobile:10,mobileCooldown:cooldown,
    pathDamage:15000+3000*extra,landDamage:25000+5000*extra,landRadius:450+50*extra,escortSpeed:HOVER_SPEED*(1+VECTOR_THRUST.escort*count)};
}
const dashSpec=(s:Ship):SkillSpec=>({...s.skills[1].spec,id:'architectHullDash',name:'Hull Dash',short:'HULL DASH',accent:ARCHETYPES.vector.color,ult:false});
function vectorMovementBlock(s:Ship):string{
  return !s.alive?'Ship sunk':!livingVectors(s).length?'Requires a living Vector':s.architect?.ultimate?.kind==='assembly'?'Final Assembly active':s.stepper?.cross||s.stepper?.flicker||s.stepper?.rush?'Stepping':s.mods.banished?'Banished':s.mods.stunned?'Stunned':s.mods.rooted?'Rooted':s.mods.feared?'Feared':'';
}
/**
 * A pure snapshot lets presentation read timers without advancing authoritative state. Every spent
 * charge recharges on its own clock. A lost Vector drops the latest pending charges; a rebuilt or
 * refitted one starts recharging the new slot.
 */
function vectorCharges(s:Ship,max=vectorTuning(s).dashCharges):{charges:number;recharge:number[]}{
  const time=s.game.time;let charges=Math.min(max,s.vectorMobility.dashCharges);
  const recharge=s.vectorMobility.dashRecharge.slice(0,Math.max(0,max-charges));
  while(recharge.length&&time+1e-8>=recharge[0]){recharge.shift();charges++;}
  while(charges+recharge.length<max)recharge.push(time+DASH_RECHARGE);
  return {charges,recharge};
}
export function updateVectorMobilityTimers(s:Ship):void{
  const max=vectorTuning(s).dashCharges,v=s.vectorMobility;
  if(v.dashCharges===max&&!v.dashRecharge.length)return;
  const q=vectorCharges(s,max);v.dashCharges=q.charges;v.dashRecharge=q.recharge;
}
export function getVectorMobilityStatus(s:Ship){
  const a=s.architect;if(!a)return null;
  const vectors=livingVectors(s),tuning=vectorTuning(s),q=vectorCharges(s,tuning.dashCharges),v=s.vectorMobility,reason=vectorMovementBlock(s);
  const escort=a.ultimate?.kind==='killbox'?'Grand Battery active':a.ultimate?.kind==='citadel'?'Citadel active':!a.slots.some(slot=>slot.state==='deployed'&&slot.entity?.alive)?'No deployed platforms':'';
  const cooldownRemaining=Math.max(0,v.mobileReadyAt-s.game.time),activeRemaining=Math.max(0,v.mobileUntil-s.game.time);
  // Equipped but all destroyed: the soonest rebuild, for the greyed-out HUD tiles.
  const rebuild=vectors.length?0:Math.min(Infinity,...a.slots.filter(slot=>slot.type==='vector'&&slot.state==='destroyed').map(slot=>Math.max(0,slot.rebuild)));
  return {unlocked:vectors.length>0,equipped:a.slots.some(slot=>slot.type==='vector'),vectors:vectors.length,rebuildRemaining:Number.isFinite(rebuild)?rebuild:0,
    hullDash:{charges:q.charges,maxCharges:tuning.dashCharges,rechargeRemaining:q.recharge.length?Math.max(0,q.recharge[0]-s.game.time):0,pending:q.recharge.length,rechargeDuration:DASH_RECHARGE,activeRemaining:a.drive?Math.max(0,DASH_TIME-a.drive.elapsed):0,duration:DASH_TIME,distance:tuning.dashDistance,pathDamage:tuning.pathDamage,landDamage:tuning.landDamage,landRadius:tuning.landRadius,blockedReason:reason||(a.drive?'Hull Dash active':q.charges<=0?'Hull Dash recharging':'')},
    mobileBattery:{cooldownRemaining,cooldownDuration:tuning.mobileCooldown,activeRemaining,duration:activeRemaining>0?v.mobileDuration:tuning.mobileDuration,speed:tuning.escortSpeed,blockedReason:reason||(cooldownRemaining>0?'Mobile Battery recharging':escort)},
  };
}
export function activateArchitectHullDash(s:Ship):boolean{
  const status=getVectorMobilityStatus(s),a=s.architect;if(!a||!status)return false;
  if(status.hullDash.blockedReason)return s.failSkill(status.hullDash.blockedReason);
  const dx=s.control.aimX-s.pos.x,dz=s.control.aimZ-s.pos.z,d=Math.hypot(dx,dz);
  if(!Number.isFinite(d)||d<1)return s.failSkill('Hull Dash: aim away from the hull');
  const want=Math.min(d,status.hullDash.distance),heading=bearingTo(0,0,dx,dz),step=Math.min(8,want);
  if(!dashAir(s,s.pos.x+dx/d*step,s.pos.z+dz/d*step,heading))return s.failSkill('Hull Dash: movement blocked');
  const distance=planDashLanding(s,dx/d,dz/d,want,status.hullDash.distance);
  if(distance===null)return s.failSkill('Hull Dash: no open water to land on');
  updateVectorMobilityTimers(s);const v=s.vectorMobility;
  v.dashCharges--;v.dashRecharge.push(s.game.time+DASH_RECHARGE);a.drive={dx:dx/d,dz:dz/d,elapsed:0,distance,moving:false,from:s.heading,travelled:0,hit:[]};
  s.game.events.emit('architectDash',{ship:s,phase:'launch',x:s.pos.x,z:s.pos.z,radius:0,vectors:status.vectors});
  return true;
}
export function activateArchitectMobileBattery(s:Ship):boolean{
  const status=getVectorMobilityStatus(s),a=s.architect;if(!a||!status)return false;
  if(status.mobileBattery.blockedReason)return s.failSkill(status.mobileBattery.blockedReason);
  const v=s.vectorMobility;v.mobileDuration=status.mobileBattery.duration;v.mobileUntil=s.game.time+v.mobileDuration;v.mobileReadyAt=s.game.time+status.mobileBattery.cooldownDuration;
  const escorts=a.slots.filter(slot=>slot.state==='deployed'&&slot.entity?.alive),rng=s.game.rng;
  // Shuffled radius bands keep escorts apart; altitude, tilt and pace are drawn per platform.
  const bands=escorts.map((_,n)=>n);
  for(let i=bands.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[bands[i],bands[j]]=[bands[j],bands[i]];}
  escorts.forEach((slot,n)=>{const m=slot.entity!;
    slot.follow={angle:Math.atan2(m.pos.x-s.pos.x,-(m.pos.z-s.pos.z)),radius:420+(escorts.length>1?bands[n]/(escorts.length-1):.5)*480+(rng()-.5)*40,
      height:140+rng()*130,tilt:15+rng()*30,phase:rng()*Math.PI*2,rate:.16+rng()*.18};
  });
  return true;
}
/** Escort point on a platform's tilted, slightly elliptical orbit. */
export function hoverPoint(s:Ship,f:HoverOrbit):{x:number;y:number;z:number} {
  const r=f.radius*(1+.08*Math.sin(f.angle*2+f.phase)),lim=MAP_HALF-100;
  const x=Math.max(-lim,Math.min(lim,s.pos.x+Math.sin(f.angle)*r)),z=Math.max(-lim,Math.min(lim,s.pos.z-Math.cos(f.angle)*r));
  return {x,y:Math.max(f.height+f.tilt*Math.sin(f.angle+f.phase)+8*Math.sin(s.game.time*1.7+f.phase*3),s.game.map.heightAt(x,z)+HOVER_CLEARANCE+20),z};
}
function moveHovering(s:Ship,slot:ModuleSlot,dt:number,speed:number):void {
  const m=slot.entity!,f=slot.follow!;f.angle+=f.rate*dt;
  const t=hoverPoint(s,f),dx=t.x-m.pos.x,dy=t.y-m.pos.y,dz=t.z-m.pos.z,d=Math.hypot(dx,dy,dz);
  // Eases into the moving orbit point instead of snapping onto it.
  const k=Math.min(1,Math.min(speed,150+d*4)*dt/Math.max(1e-6,d)),x=m.pos.x+dx*k,z=m.pos.z+dz*k,h=Math.hypot(dx,dz);
  let y=m.pos.y+dy*k;
  const ahead=h>1?Math.min(150,h)/h:0,ground=Math.max(s.game.map.heightAt(x,z),s.game.map.heightAt(x+dx*ahead,z+dz*ahead))+HOVER_CLEARANCE;
  // Climb ahead of terrain at a bounded rate; never sink into the ground directly below.
  if(y<ground)y=Math.max(Math.min(ground,Math.max(y,m.pos.y)+600*dt),s.game.map.heightAt(x,z)+20);
  m.pos.set(x,y,z);m.heading=bearingTo(m.pos.x,m.pos.z,s.pos.x,s.pos.z);
}
/** Escorts never stay airborne: each folds and descends to reserved nearby water, or returns home. */
function landHovering(s:Ship):void {
  const reservations:Landing[]=[];
  for(const slot of s.architect!.slots){
    const m=slot.entity;if(!slot.follow)continue;slot.follow=null;
    if(slot.state!=='deployed'||!m?.alive)continue;
    const p=moduleLanding(s,slot,m.pos.x,m.pos.z,m.heading,reservations,1000);
    if(p){reservations.push(p);moveModule(s,slot,p,'moving',BATTERY_FOLD_TIME+HOVER_LANDING);}
    else {const dock=dockPoint(s,slot.index);moveModule(s,slot,dock,'returning',BATTERY_FOLD_TIME+Math.max(1,Math.hypot(dock.x-m.pos.x,dock.z-m.pos.z)/1200));}
    slot.path!.settling=true;
  }
}
/** Protection ends immediately on interruption, collision, Vector loss or the last motion tick. */
export function architectDashDamageReduction(s:Ship):number{return s.architect?.drive?.moving&&!vectorMovementBlock(s)? .7:0;}
function architectStepLegal(m:Ship,x:number,z:number):boolean{
  const owner=m.architectPlatform?.owner??m,bottom=m.pos.y-m.spec.draft,top=m.pos.y+m.spec.freeboard+30;
  return safeStep(m,x,z,m.heading,false,[],o=>o.architectDrone?.owner===owner||o.pos.y-o.spec.draft>top||bottom>o.pos.y+o.spec.freeboard+30);
}
/** Small swept steps stop at the last legal footprint, including thin terrain and walls. */
function moveArchitectLegally(m:Ship,x:number,z:number,legal=(nx:number,nz:number)=>architectStepLegal(m,nx,nz)):boolean{
  const dx=x-m.pos.x,dz=z-m.pos.z,n=Math.max(1,Math.ceil(Math.hypot(dx,dz)/8)),ox=m.pos.x,oz=m.pos.z;
  for(let i=1;i<=n;i++){
    const nx=ox+dx*i/n,nz=oz+dz*i/n;
    if(!legal(nx,nz))return false;
    m.pos.x=nx;m.pos.z=nz;
  }
  return true;
}
/**
 * Hull Dash flies: islands and every hull pass beneath it (enemies in the path are rammed), so only
 * walls and the map edge stop it in flight. It must still set down on open water.
 */
const dashAir=(s:Ship,x:number,z:number,heading:number)=>safeStep(s,x,z,heading,true,[],()=>true,true);
const dashWater=(s:Ship,x:number,z:number,heading:number)=>safeStep(s,x,z,heading,true,[],()=>true);
/** Open water nearest the reticle along the dash line, reaching up to 600 m past it to clear an island. */
function planDashLanding(s:Ship,dx:number,dz:number,want:number,max:number):number|null{
  const heading=bearingTo(0,0,dx,dz),open=(d:number)=>dashWater(s,s.pos.x+dx*d,s.pos.z+dz*d,heading);
  if(open(want))return want;
  for(let k=1;;k++){
    const ahead=want+k*25,back=want-k*25;
    if(ahead>max+600&&back<8)return null;
    if(ahead<=max+600&&open(ahead))return ahead;
    if(back>=8&&open(back))return back;
  }
}
/** Blocked in flight over land: back along the path to the nearest open water, or the launch point. */
function dashRetreat(s:Ship,p:NonNullable<ArchitectState['drive']>):void{
  for(let back=0;back<p.travelled;back+=10){const x=s.pos.x-p.dx*back,z=s.pos.z-p.dz*back;if(dashWater(s,x,z,s.heading)){s.pos.x=x;s.pos.z=z;return;}}
  s.pos.x-=p.dx*p.travelled;s.pos.z-=p.dz*p.travelled;s.heading=p.from;
}
/** Highest ground under and just ahead of the hull, so the dash climbs before it reaches a shore. */
function dashClearance(s:Ship,p:NonNullable<ArchitectState['drive']>):number{
  let ground=-Infinity;const half=s.spec.length/2;
  for(let a=-half;a<=half+250;a+=40)ground=Math.max(ground,s.game.map.heightAt(s.pos.x+p.dx*a,s.pos.z+p.dz*a));
  return ground+s.spec.draft+15;
}
const dashEnemy=(s:Ship,t:Ship)=>t.alive&&t.team!==s.team&&!t.deep&&!t.mods.banished;
/** Every enemy hull the dash sweeps is hit once and flung off the path. */
function dashThrough(s:Ship,ox:number,oz:number,damage:number):void{
  const p=s.architect!.drive!;
  for(const t of s.game.ships){
    if(!dashEnemy(s,t)||p.hit.includes(t.id)||segmentHitsHull(t,ox,oz,s.pos.x,s.pos.z,s.spec.beam/2+20)<0)continue;
    p.hit.push(t.id);
    const side=(t.pos.x-s.pos.x)*p.dz-(t.pos.z-s.pos.z)*p.dx<0?-1:1;
    hurt(s,t,damage,dashSpec(s));
    if(t.alive)t.shove(p.dz*side*380+p.dx*80,-p.dx*side*380+p.dz*80);
  }
}
/** The hull sets down with a shockwave that shoves and damages enemies around it. */
function dashLanding(s:Ship,tuning:ReturnType<typeof vectorTuning>):void{
  for(const t of s.game.ships){
    if(!dashEnemy(s,t)||distToHull(t,s.pos.x,s.pos.z)>tuning.landRadius)continue;
    hurt(s,t,tuning.landDamage,dashSpec(s));
    if(t.alive){const dx=t.pos.x-s.pos.x,dz=t.pos.z-s.pos.z,d=Math.hypot(dx,dz)||1;t.shove(dx/d*220,dz/d*220);}
  }
  s.game.events.emit('architectDash',{ship:s,phase:'land',x:s.pos.x,z:s.pos.z,radius:tuning.landRadius,vectors:tuning.count});
}
/** Height of the hull above the water partway through a dash. */
export function dashLift(elapsed:number):number{return DASH_LIFT*smooth(elapsed/DASH_RISE)*smooth((DASH_TIME-elapsed)/DASH_RISE);}
function updateArchitectDrive(s:Ship,dt:number):void{
  const a=s.architect!,p=a.drive;
  if(p){
    if(vectorMovementBlock(s)){a.drive=null;if(!dashWater(s,s.pos.x,s.pos.z,s.heading))dashRetreat(s,p);s.pos.y=0;}
    else {const tuning=vectorTuning(s),step=Math.min(dt,DASH_TIME-p.elapsed),d=p.distance*step/DASH_TIME;p.elapsed+=step;
      // The bow swings onto the dash bearing first, so the hull travels bow-first.
      s.heading=wrapAngle(p.from+wrapAngle(bearingTo(0,0,p.dx,p.dz)-p.from)*smooth(p.elapsed/DASH_TURN));
      const ox=s.pos.x,oz=s.pos.z,legal=moveArchitectLegally(s,s.pos.x+p.dx*d,s.pos.z+p.dz*d,(x,z)=>dashAir(s,x,z,s.heading));p.moving=s.pos.x!==ox||s.pos.z!==oz;
      p.travelled+=Math.hypot(s.pos.x-ox,s.pos.z-oz);
      dashThrough(s,ox,oz,tuning.pathDamage);
      // Rise with the lift curve, climb early over land ahead, and come down no faster than 900 m/s.
      const target=Math.max(dashLift(p.elapsed),dashClearance(s,p));
      s.pos.y=target>=s.pos.y?target:Math.max(target,s.pos.y-900*step);
      if(!legal||p.elapsed>=DASH_TIME-1e-8){
        a.drive=null;
        if(!dashWater(s,s.pos.x,s.pos.z,s.heading))dashRetreat(s,p);
        s.pos.y=0;if(p.travelled>1)dashLanding(s,tuning);
      }
    }
  }
  if(a.ultimate)return;
  if(s.vectorMobility.mobileUntil>s.game.time&&livingVectors(s).length){
    const speed=vectorTuning(s).escortSpeed;
    // Crowd control holds escorts in place; the clock keeps running.
    if(!s.mods.stunned&&!s.mods.rooted&&!s.mods.feared&&!s.mods.banished)for(const slot of a.slots){
      const m=slot.entity;if(!slot.follow||slot.state!=='deployed'||!m?.alive||m.mods.stunned||m.mods.rooted||m.mods.feared||m.mods.banished)continue;
      moveHovering(s,slot,dt,speed);
    }
  }else if(a.slots.some(slot=>slot.follow))landHovering(s);
}
export function recordArchitectGunCycle(s:Ship,index:number):void{
  const slot=s.architect?.slots[index];if(!slot||slot.state!=='docked'||slot.hp<=0||slot.capacitorCharged)return;
  if(slot.capacitorCycles===0)slot.capacitorCycles=1;else{slot.capacitorCycles=0;slot.capacitorCharged=true;}
}
function updateCapacitors(s:Ship):void{
  const a=s.architect!;if(a.capacitorReadyAt>s.game.time||a.ultimate?.kind==='assembly'||s.mods.stunned||s.mods.disarmed||s.mods.silenced)return;
  for(const slot of a.slots){
    if(slot.state!=='docked'||slot.hp<=0||slot.disabled>0||!slot.capacitorCharged)continue;
    const target=elementTarget(s,slot,true);if(!target)continue;
    if(fireCapacitorBolt(s,slot,target)){slot.capacitorCharged=false;a.capacitorReadyAt=s.game.time+.6;return;}
  }
}
export function dockPoint(s:Ship,i:number):Vector3 {
  const t=s.spec.main!.turrets[i];return s.localToWorld(t.x,s.spec.freeboard+t.y,t.z??0);
}
export function available(s:Ship):ModuleSlot[]{return s.architect!.slots.filter(a=>a.state!=='destroyed');}
export function archAim(s:Ship,range=4500):{x:number;z:number} {
  const dx=s.control.aimX-s.pos.x,dz=s.control.aimZ-s.pos.z,d=Math.hypot(dx,dz),k=Math.min(1,range*s.mods.reachMul/Math.max(1,d));
  return {x:s.pos.x+dx*k,z:s.pos.z+dz*k};
}
function modulePose(s:Ship,a:ModuleSlot):Ship {
  return a.entity??({game:s.game,pos:new Vector3(),heading:s.heading,spec:s.game.shipSpec('architectPlatform')} as Ship);
}
export function moduleLanding(s:Ship,a:ModuleSlot,x:number,z:number,heading:number,reservations:Landing[]=[],search=0):Landing|null {
  const m=modulePose(s,a);
  for(let r=0;r<=search;r+=50)for(let i=0;i<(r?24:1);i++){
    const angle=i*Math.PI/12,p={x:x+Math.sin(angle)*r,z:z+Math.cos(angle)*r,heading};
    if(safeStep(m,p.x,p.z,heading,false,reservations))return p;
  }
  return null;
}
export function formation(s:Ship,slots:ModuleSlot[],x:number,z:number,radius:number):Landing[]|null {
  const poses:Landing[]=[];
  for(let n=0;n<slots.length;n++){
    const a=slots[n],angle=n*Math.PI*2/slots.length;
    const p=moduleLanding(s,a,x+Math.sin(angle)*radius,z-Math.cos(angle)*radius,angle+Math.PI,poses,250);
    if(!p)return null;poses.push(p);
  }
  return poses;
}
function disableDocked(s:Ship,a:ModuleSlot):void {
  const t=s.turrets[a.index];if(t)t.disabled=Infinity;
}
export function materialize(s:Ship,a:ModuleSlot):Ship {
  if(a.entity?.alive)return a.entity;
  if(a.state==='docked'){a.reload=Math.max(0,s.turrets[a.index].reload);a.disabled=Math.max(0,s.turrets[a.index].disabled);}
  detachArchitectHealth(s,a);
  const p=dockPoint(s,a.index);
  const m=s.game.addShip(s.game.shipSpec('architectPlatform'),s.team,`${s.name} · ${a.index+1}`,p.x,p.z,s.heading);
  m.pos.y=p.y;m.prevPos.copy(m.pos);m.renderPos.copy(m.pos);
  m.architectPlatform={owner:s,index:a.index};m.isSummon=true;m.summonOwner=s;m.colossus=false;
  m.hp=a.hp;m.maxHp=s.architect!.moduleHp;m.throttle=2;m.speed=0;
  m.turrets[0].reload=a.reload;m.turrets[0].disabled=a.disabled;
  a.entity=m;disableDocked(s,a);return m;
}
export function moveModule(s:Ship,a:ModuleSlot,p:{x:number;y?:number;z:number;heading?:number},mode:ModuleMode,duration?:number,damage=false):void {
  if(mode==='returning'||mode==='assembling'){a.opening=false;}
  if(a.state==='docked'){const t=s.turrets[a.index];a.reload=t.reload;a.disabled=t.disabled;}
  const m=materialize(s,a);m.control.fire=false;
  a.state=mode;a.dockedFor=0;a.follow=null;
  if(p.heading!==undefined)m.heading=p.heading;
  a.path={x:m.pos.x,y:m.pos.y,z:m.pos.z,tx:p.x,ty:p.y??0,tz:p.z,elapsed:0,duration:duration??Math.max(.05,Math.hypot(m.pos.x-p.x,m.pos.z-p.z)/1200),hit:[],damage};
  disableDocked(s,a);
}
export function attachModule(s:Ship,a:ModuleSlot):void {
  setModuleReloadScale(s,a,architectGunReloadScale(s,'docked'));
  const m=a.entity;
  if(m){a.hp=m.hp;a.reload=Math.max(0,m.turrets[0].reload);a.disabled=Math.max(0,m.turrets[0].disabled);m.withdraw(true);}
  returnArchitectHealth(s,a);
  a.entity=null;a.path=null;a.state='docked';a.dockedFor=0;
  a.follow=null;
  const t=s.turrets[a.index];if(t){t.disabled=a.disabled;t.reload=a.reload;}
}
export function deployModules(s:Ship):boolean {
  ensureArchitectHealth(s);
  const slots=s.architect!.slots.filter(a=>a.state==='docked'&&a.hp>0&&a.disabled<=0).slice(0,2);
  if(!slots.length)return s.failSkill('Deploy: no repaired docked modules');
  const p=archAim(s),heading=bearingTo(s.pos.x,s.pos.z,p.x,p.z),poses:Landing[]=[];
  for(let n=0;n<slots.length;n++){
    const off=slots.length===1?0:(n?150:-150);
    const q=moduleLanding(s,slots[n],p.x+Math.cos(heading)*off,p.z+Math.sin(heading)*off,heading,poses);
    if(!q)return s.failSkill('Deploy: blocked platforms; aim at safe water');poses.push(q);
  }
  slots.forEach((a,i)=>{a.opening=true;moveModule(s,a,poses[i],'launching');});
  s.game.events.emit('architectCommand',{ship:s,kind:'deploy'});return true;
}
export function recallModules(s:Ship):boolean {
  if(s.architect?.ultimate)endArchitectUltimate(s,true);
  const slots=available(s).filter(a=>a.state!=='docked');
  if(!slots.length)return s.failSkill('Recall: all surviving modules are docked');
  for(const a of slots){const p=dockPoint(s,a.index);moveModule(s,a,p,'returning');}
  s.game.events.emit('architectCommand',{ship:s,kind:'recall'});return true;
}
export function reconfigureModules(s:Ship):boolean {
  const slots=available(s).filter(a=>a.state==='deployed'||a.state==='moving'&&a.path?.settling);
  if(!slots.length)return s.failSkill('Reconfigure: deploy platforms first');
  const p=archAim(s),poses=formation(s,slots,p.x,p.z,900);
  if(!poses)return s.failSkill('Reconfigure: no safe formation in aimed water');
  slots.forEach((a,i)=>moveModule(s,a,poses[i],'moving',undefined,true));
  s.game.events.emit('architectCommand',{ship:s,kind:'reconfigure'});return true;
}
export function raiseShield(s:Ship,amount:number,life=6):void {
  s.shield=Math.max(s.shield,amount);s.shieldMax=Math.max(s.shieldMax,s.shield);s.shieldTime=Math.max(s.shieldTime,life);
}
export function fortify(s:Ship):void {
  raiseShield(s,300000,8);
  for(const a of available(s))if(a.entity?.alive)raiseShield(a.entity,100000,8);
}
export function clearLine(s:Ship,x:number,z:number,tx:number,tz:number,y=5,ty=5):number {
  const d=Math.hypot(tx-x,tz-z),n=Math.max(1,Math.ceil(d/20));
  for(let i=1;i<=n;i++){
    const f=i/n,px=x+(tx-x)*f,pz=z+(tz-z)*f,py=y+(ty-y)*f;
    if(Math.abs(px)>MAP_HALF-5||Math.abs(pz)>MAP_HALF-5||s.game.map.heightAt(px,pz)>py)return (i-1)/n;
    const last=(i-1)/n;
    if(Math.min(py,y+(ty-y)*last)<90&&s.game.wallHit(s.team,x+(tx-x)*last,z+(tz-z)*last,px,pz)>=0)return last;
  }
  return 1;
}
export function connectModules(s:Ship):boolean {
  const a=s.architect!,slots=a.slots.filter(v=>v.state==='deployed'&&v.entity?.alive);
  if(slots.length<2)return s.failSkill('Connect: at least two anchored platforms required');
  a.links=[];
  for(let i=0;i<slots.length;i++)for(let j=i+1;j<slots.length;j++){
    const m=slots[i],n=slots[j],p=m.entity!.pos,q=n.entity!.pos;
    if(Math.hypot(p.x-q.x,p.z-q.z)<=2500&&clearLine(s,p.x,p.z,q.x,q.z)===1)a.links.push({a:m.index,b:n.index});
  }
  if(!a.links.length)return s.failSkill('Connect: two anchored platforms need a clear link within 2.5 km');
  a.linkUntil=s.game.time+10;a.linkTick=0;return true;
}
/** Keep the completed fraction of a reload when changing deployment modes. */
function setModuleReloadScale(s:Ship,slot:ModuleSlot,scale:number):void {
  if(slot.reloadScale===scale)return;
  const turret=slot.entity?.turrets[0]??(slot.state==='docked'?s.turrets[slot.index]:undefined);
  slot.reload=(turret?.reload??slot.reload)*scale/slot.reloadScale;
  if(turret)turret.reload=slot.reload;
  slot.reloadScale=scale;
}
export function architectGunReloadScale(s:Ship,state:ModuleMode):number {
  const base=state==='docked'?2/3:state==='citadel'?1/6:s.architect?.ultimate?.kind==='killbox'&&state==='deployed'?.25:state==='deployed'?.5:1;
  return base/(s.architect!.huntUntil>s.game.time?1.25:1);
}
export function commandedBurst(s:Ship,_spec:SkillSpec):boolean {
 const eligible=(t:Ship)=>canTrack(s,t)&&Math.hypot(t.pos.x-s.pos.x,t.pos.z-s.pos.z)<=6000;
 const candidates=arsenalTeam(s,true).filter(eligible);
 const aimed=candidates.filter(t=>Math.hypot(t.pos.x-s.control.aimX,t.pos.z-s.control.aimZ)<=Math.max(250,t.spec.length/2)).sort((a,b)=>Math.hypot(a.pos.x-s.control.aimX,a.pos.z-s.control.aimZ)-Math.hypot(b.pos.x-s.control.aimX,b.pos.z-s.control.aimZ)||a.id-b.id)[0];
 const target=aimed??candidates.find(t=>t.id===s.control.targetId);
 if(!target)return s.failSkill('Hunt: aim at a tracked enemy within 6 km');
 s.architect!.huntTarget=target.id;s.architect!.huntUntil=s.game.time+10;
 for(const slot of s.architect!.slots)setModuleReloadScale(s,slot,architectGunReloadScale(s,slot.state));return true;
}
export function huntedTarget(s:Ship):Ship|null {
 const a=s.architect;if(!a||a.huntUntil<=s.game.time)return null;
 return s.game.ships.find(t=>t.id===a.huntTarget&&canTrack(s,t)&&!t.submerged&&Math.hypot(t.pos.x-s.pos.x,t.pos.z-s.pos.z)<=s.mainRange&&clearLine(s,s.pos.x,s.pos.z,t.pos.x,t.pos.z,s.pos.y+s.spec.freeboard+20,t.pos.y+12)===1)??null;
}
export function destroyPlatform(m:Ship):void {
  const tag=m.architectPlatform;if(!tag)return;
  const a=tag.owner.architect;if(!a||a.clearing)return;
  const slot=a.slots[tag.index];slot.skillTimer=ARCHETYPES[slot.type].skills[slot.skill].cooldown;slot.castGap=0;slot.opening=false;slot.hp=0;slot.state='destroyed';slot.rebuild=5;slot.entity=null;slot.path=null;slot.disabled=0;
  slot.capacitorCycles=0;slot.capacitorCharged=false;
  slot.follow=null;
  disableDocked(tag.owner,slot);
  m.game.events.emit('architectCommand',{ship:tag.owner,kind:'destroy'});
}
export function clearArchitect(s:Ship):void {
  const a=s.architect;if(!a)return;
  if(a.drive)s.pos.y=0;
  s.game.battery.cancelOwner(s);
  const full=a.healthReady?a.fullHp:s.maxHp;
  s.maxHp=full;
  a.clearing=true;
  for(const d of a.elements.drones)s.game.ships.find(m=>m.id===d.id)?.withdraw();
  for(const slot of a.slots)if(slot.entity?.alive)slot.entity.withdraw();
  s.architect=s.spec.id==='architect'?newArchitectState(s.game.rng,s.architectLoadout):null;
  if(s.architect){s.architect.fullHp=full;s.architect.moduleHp=full*MODULE_COMBAT_HP/ARCHITECT_FULL_HP;}
}
export function syncArchitectSlot(s:Ship):void {
  if(s.architectPlatform){const {owner,index}=s.architectPlatform;const slot=owner.architect?.slots[index];if(slot&&slot.entity===s){slot.hp=s.hp;slot.reload=Math.max(0,s.turrets[0].reload);slot.disabled=Math.max(0,s.turrets[0].disabled);}return;}
  for(const a of s.architect?.slots??[])if(a.state==='docked'){a.reload=Math.max(0,s.turrets[a.index].reload);a.disabled=Math.max(0,s.turrets[a.index].disabled);}
}
export function updateModulePath(s:Ship,a:ModuleSlot,dt:number):void {
  const p=a.path,m=a.entity;if(!p||!m)return;
  if(a.state==='returning'){const q=dockPoint(s,a.index);p.tx=q.x;p.ty=q.y;p.tz=q.z;}
  const ox=m.pos.x,oz=m.pos.z;
  p.elapsed+=dt;const f=p.settling?smooth((p.elapsed-BATTERY_FOLD_TIME)/Math.max(.001,p.duration-BATTERY_FOLD_TIME)):Math.min(1,p.elapsed/p.duration);
  m.pos.set(p.x+(p.tx-p.x)*f,p.y+(p.ty-p.y)*f,p.z+(p.tz-p.z)*f);
  if(f<1&&!p.settling){m.pos.y+=Math.sin(f*Math.PI)*160;m.pos.y=Math.max(m.pos.y,s.game.map.heightAt(m.pos.x,m.pos.z)+60);}
  // Descents follow the ground over islands instead of cutting through them.
  else if(f<1)m.pos.y=Math.max(m.pos.y,s.game.map.heightAt(m.pos.x,m.pos.z)+40);
  if(p.damage)for(const t of s.game.ships){if(t.alive&&t.team!==s.team&&!t.deep&&!p.hit.includes(t.id)&&segmentHitsHull(t,ox,oz,m.pos.x,m.pos.z,22)>=0){p.hit.push(t.id);hurt(s,t,20000,s.skills[3].spec);}}
  if(f>=1){
    if(a.state==='returning'){attachModule(s,a);return;}
    if(a.state==='assembling'){a.path=null;return;}
    const q=moduleLanding(s,a,p.tx,p.tz,m.heading,[],250);
    if(q){m.pos.set(q.x,0,q.z);a.state='deployed';a.path=null;}
    else moveModule(s,a,dockPoint(s,a.index),'returning');
  }
}
export function updateArchitect(s:Ship,dt:number):void {
  const a=s.architect;if(!a)return;
  ensureArchitectHealth(s);
  updateArchitectDrive(s,dt);
  let repairBudget=0;
  for(const slot of a.slots){
    const t=s.turrets[slot.index];
    if(slot.state==='docked'){
      setModuleReloadScale(s,slot,architectGunReloadScale(s,'docked'));
      slot.reload=Math.max(0,t.reload);slot.disabled=Math.max(0,t.disabled);slot.dockedFor+=dt;
      if(slot.hp>0&&slot.dockedFor>2){const time=Math.min(dt,slot.dockedFor-2);repairBudget+=Math.max(0,Math.min(a.moduleHp-slot.hp,a.moduleHp*.2*time))/PLATFORM_HEALTH_RATIO+a.fullHp*.0004*time;}
    }else if(slot.state==='destroyed'){
      slot.rebuild-=dt;disableDocked(s,slot);
      if(slot.rebuild<=1e-8){slot.state='docked';slot.reloadScale=architectGunReloadScale(s,'docked');slot.rebuild=0;rebuildArchitectHealth(s,slot);slot.reload=0;slot.disabled=0;slot.dockedFor=0;t.disabled=0;t.reload=0;}
    }else{
      disableDocked(s,slot);
      if(slot.entity?.alive){slot.hp=slot.entity.hp;slot.reload=Math.max(0,slot.entity.turrets[0].reload);slot.disabled=Math.max(0,slot.entity.turrets[0].disabled);}
      if(!a.ultimate)updateModulePath(s,slot,dt);
    }
  }
  if(repairBudget>0)s.heal(repairBudget*s.mods.regenMul);
  updateArchitectUltimate(s,dt);
  updateElements(s,dt);
  updateCapacitors(s);
  if(a.linkUntil>s.game.time){
    a.linkTick+=dt;
    while(a.linkTick+1e-8>=.25){
      a.linkTick-=.25;
      for(const t of s.game.ships){
        if(!t.alive||t.team===s.team||t.deep||t.pos.y>30)continue;
        const hit=a.links.some(edge=>{
          const x=a.slots[edge.a],y=a.slots[edge.b];if(x.state!=='deployed'||y.state!=='deployed'||!x.entity?.alive||!y.entity?.alive)return false;
          const p=x.entity.pos,q=y.entity.pos;return Math.hypot(p.x-q.x,p.z-q.z)<=2500&&clearLine(s,p.x,p.z,q.x,q.z)===1&&segmentHitsHull(t,p.x,p.z,q.x,q.z,30)>=0;
        });
        if(hit)hurt(s,t,3000,s.skills[2].spec);
      }
    }
  }else a.links=[];
}
/** Auxiliary ships keep normal damage/weapon timers, but movement and targeting belong to the arsenal. */
export function preparePlatform(m:Ship):void {
  const tag=m.architectPlatform;if(!tag)return;
  const s=tag.owner,a=s.architect,slot=a?.slots[tag.index];
  if(!s.alive||!a||a.clearing||s.game.over||!slot||slot.entity!==m){m.withdraw();return;}
  m.mods.regenMul=0;m.mods.knockImmune=true;m.pushX=m.pushZ=0;m.speed=0;m.throttle=2;
  m.mods.damageMul*=s.mods.damageMul;m.mods.apDamageMul*=s.mods.apDamageMul;m.mods.reloadMul*=s.mods.reloadMul;
  setModuleReloadScale(s,slot,architectGunReloadScale(s,slot.state));
  if(slot.state==='deployed'||slot.state==='citadel'){
    m.mods.damageMul*=3;m.mods.reloadMul*=slot.reloadScale/(slot.state!=='citadel'&&a.ultimate?.kind!=='killbox'&&moduleLinked(s,slot)?1.25:1);if(a.ultimate?.kind==='killbox')m.mods.damageMul*=1.5;
  }
  m.control.fire=false;
  if(slot.state!=='deployed'&&slot.state!=='citadel')return;
  if(a.ultimate&&a.ultimate.kind==='assembly'&&a.ultimate.members.includes(slot.index))return;
  let target:Ship|null=null,dist=Infinity;
  for(const t of arsenalTeam(m,true)){
    if(!canTrack(m,t)||t.submerged)continue;
    const d=Math.hypot(t.pos.x-m.pos.x,t.pos.z-m.pos.z);if(d>m.mainRange)continue;
    if(a.ultimate?.kind==='killbox'&&Math.hypot(t.pos.x-a.ultimate.x,t.pos.z-a.ultimate.z)>1500)continue;
    const priority=t.id===(a.huntUntil>s.game.time?a.huntTarget:s.control.targetId)?-1:d;
    // A visible winner cannot be displaced by a farther or tied candidate; preserve the first tie.
    if(!(priority<dist))continue;
    if(clearLine(s,m.pos.x,m.pos.z,t.pos.x,t.pos.z,m.pos.y+30,t.pos.y+12)<1)continue;
    target=t;dist=priority;
  }
  if(!target)return;
  m.control.aimX=target.pos.x;m.control.aimZ=target.pos.z;m.control.aimY=target.pos.y>20?target.pos.y+4:undefined;
  const bearing=bearingTo(m.pos.x,m.pos.z,target.pos.x,target.pos.z);
  const carrier=a.ultimate?.kind==='killbox'?a.ultimate.battery?.members.find(member=>member.slot===slot.index)?.carrier:undefined;
  m.heading=carrier?.heading??bearing;m.prevHeading=m.renderHeading=m.heading;
  m.turrets[0].yaw=wrapDeg((bearing-m.heading)/DEG-m.turrets[0].spec.facing);m.turrets[0].canBear=m.turrets[0].aligned=true;m.control.fire=true;
}
export function endArchitect(s:Ship):void {if(s.architect?.ultimate)endArchitectUltimate(s);}
export function turretInDock(s:Ship,t:TurretState):boolean {
  const i=s.turrets.indexOf(t);return !s.architect||s.architect.slots[i]?.state==='docked';
}
/** Configuration is copied onto the captain so hull changes and respawns preserve it. */
export function setArchitectLoadout(s:Ship,loadout:ArchitectLoadout):void{
 s.architectLoadout=copyLoadout(loadout);
 if(s.architect)for(const a of s.architect.slots){const pick=s.architectLoadout[a.index];a.type=pick.type;a.skill=pick.skill;a.element=ARCHETYPES[a.type].element;}
 // A fresh hull starts with every dash charge its arsenal grants.
 s.vectorMobility.dashCharges=vectorTuning(s).dashCharges;s.vectorMobility.dashRecharge=[];
}
export function refitArchitect(s:Ship,index:number,pick:import('../../data/architectLoadout').ArchitectSelection):boolean{
 const result=(accepted:boolean,reason?:string)=>{s.game.events.emit('architectRefit',{ship:s,index,pick:{...pick},accepted,...(reason?{reason}:{})});return accepted;};
 if(!validSelection(pick)||!Number.isInteger(index)||index<0||index>=10)return result(false,'Refit: invalid platform selection');
 if(s.game.config.type!=='freeplay')return result(false,'Refit: available in Free play only');
 if(!s.alive)return result(false,'Refit: ship is unavailable');
 if(s.architect?.ultimate)return result(false,'Refit: wait for the transformation to finish');
 const a=s.architect?.slots[index];if(!a||a.state!=='docked'){const reason='Refit: recall this platform first';s.failSkill(reason);return result(false,reason);}
 if(a.type===pick.type&&a.skill===pick.skill)return result(true);
 s.architectLoadout[index]={...pick};a.type=pick.type;a.skill=pick.skill;a.element=ARCHETYPES[a.type].element;a.skillTimer=ARCHETYPES[a.type].skills[a.skill].cooldown;a.opening=false;
 a.capacitorCycles=0;a.capacitorCharged=false;
 s.architect!.elements.jobs=s.architect!.elements.jobs.filter(j=>j.slot!==index||!j.channel);return result(true);
}
