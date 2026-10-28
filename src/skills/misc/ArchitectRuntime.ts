import { arsenalTeam } from './ArchitectTargets';
import { ARCHETYPES, validSelection, copyLoadout, type ArchitectLoadout, type ArchitectType } from '../../data/architectLoadout';
import { newElementState, updateElements, moduleLinked, type ArchitectElement, type ElementState } from './ArchitectElements';
import { ensureArchitectHealth, detachArchitectHealth, returnArchitectHealth, rebuildArchitectHealth, ARCHITECT_FULL_HP, MODULE_COMBAT_HP, PLATFORM_HEALTH_RATIO } from './ArchitectHealth';
import { Vector3 } from 'three';
import type { Ship, TurretState } from '../../ships/Ship';
import type { SkillSpec } from '../../core/types';
import { canTrack } from '../../core/Targeting';
import { MAP_HALF } from '../../config';
import { bearingTo, DEG, wrapDeg } from '../../core/math';
import { segmentHitsHull } from '../../core/hull';
import { hurt } from '../kit';
import { safeStep, type Landing } from './StepperRuntime';
import { updateArchitectUltimate, endArchitectUltimate, type ArchitectUltimate } from './ArchitectUltimates';

export type ModuleMode = 'docked'|'launching'|'deployed'|'moving'|'returning'|'destroyed'|'assembling'|'citadel';
export interface ModuleSlot {
  type:ArchitectType; skill:0|1; element:ArchitectElement; skillTimer:number; castGap:number; opening:boolean; boostUntil:number; reactionUntil:number; aboard:boolean; index:number; state:ModuleMode; hp:number; reload:number; reloadScale:number; disabled:number; rebuild:number; dockedFor:number;
  entity:Ship|null;
  path:{ x:number;y:number;z:number;tx:number;ty:number;tz:number;elapsed:number;duration:number;hit:number[];damage:boolean }|null;
}
export interface ArchitectState {
  huntTarget:number;huntUntil:number;elements:ElementState; fullHp:number;moduleHp:number;healthReady:boolean;healthTransfer:boolean;
  slots:ModuleSlot[];
  links:{a:number;b:number}[];linkUntil:number;linkTick:number;
  ultimate:ArchitectUltimate|null;
  clearing:boolean;
}
export interface ArchitectPlatform { owner:Ship; index:number }
export const MODULE_HP=MODULE_COMBAT_HP;
export function newArchitectState(_rng:()=>number=()=>.5,loadout?:ArchitectLoadout):ArchitectState {
  const selections=copyLoadout(loadout);
  return {huntTarget:-1,huntUntil:0,elements:newElementState(),fullHp:ARCHITECT_FULL_HP,moduleHp:MODULE_COMBAT_HP,healthReady:false,healthTransfer:false,slots:Array.from({length:10},(_,index)=>({type:selections[index].type,skill:selections[index].skill,element:ARCHETYPES[selections[index].type].element,skillTimer:0,castGap:0,opening:false,boostUntil:0,reactionUntil:0,aboard:true,index,state:'docked',hp:MODULE_HP,reload:0,reloadScale:1,disabled:0,rebuild:0,dockedFor:0,entity:null,path:null})),links:[],linkUntil:0,linkTick:0,ultimate:null,clearing:false};
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
  a.state=mode;a.dockedFor=0;
  if(p.heading!==undefined)m.heading=p.heading;
  a.path={x:m.pos.x,y:m.pos.y,z:m.pos.z,tx:p.x,ty:p.y??0,tz:p.z,elapsed:0,duration:duration??Math.max(.05,Math.hypot(m.pos.x-p.x,m.pos.z-p.z)/1200),hit:[],damage};
  disableDocked(s,a);
}
export function attachModule(s:Ship,a:ModuleSlot):void {
  setModuleReloadScale(a,1);
  const m=a.entity;
  if(m){a.hp=m.hp;a.reload=Math.max(0,m.turrets[0].reload);a.disabled=Math.max(0,m.turrets[0].disabled);m.withdraw();}
  returnArchitectHealth(s,a);
  a.entity=null;a.path=null;a.state='docked';a.dockedFor=0;
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
  const slots=available(s).filter(a=>a.state!=='docked');
  if(!slots.length)return s.failSkill('Recall: all surviving modules are docked');
  for(const a of slots){const p=dockPoint(s,a.index);moveModule(s,a,p,'returning');}
  s.game.events.emit('architectCommand',{ship:s,kind:'recall'});return true;
}
export function reconfigureModules(s:Ship):boolean {
  const slots=available(s).filter(a=>a.state==='deployed');
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
function setModuleReloadScale(slot:ModuleSlot,scale:number):void {
  if(slot.reloadScale===scale)return;
  const turret=slot.entity?.turrets[0];
  slot.reload=(turret?.reload??slot.reload)*scale/slot.reloadScale;
  if(turret)turret.reload=slot.reload;
  slot.reloadScale=scale;
}
function platformReloadScale(slot:ModuleSlot):number {
  return slot.state==='citadel'?1/6:slot.entity?.architectPlatform?.owner.architect?.ultimate?.kind==='killbox'?.25:slot.state==='deployed'?.5:1;
}
export function commandedBurst(s:Ship,_spec:SkillSpec):boolean {
 const eligible=(t:Ship)=>canTrack(s,t)&&Math.hypot(t.pos.x-s.pos.x,t.pos.z-s.pos.z)<=6000;
 const candidates=arsenalTeam(s,true).filter(eligible);
 const aimed=candidates.filter(t=>Math.hypot(t.pos.x-s.control.aimX,t.pos.z-s.control.aimZ)<=Math.max(250,t.spec.length/2)).sort((a,b)=>Math.hypot(a.pos.x-s.control.aimX,a.pos.z-s.control.aimZ)-Math.hypot(b.pos.x-s.control.aimX,b.pos.z-s.control.aimZ)||a.id-b.id)[0];
 const target=aimed??candidates.find(t=>t.id===s.control.targetId);
 if(!target)return s.failSkill('Hunt: aim at a tracked enemy within 6 km');
 s.architect!.huntTarget=target.id;s.architect!.huntUntil=s.game.time+10;return true;
}
export function huntedTarget(s:Ship):Ship|null {
 const a=s.architect;if(!a||a.huntUntil<=s.game.time)return null;
 return s.game.ships.find(t=>t.id===a.huntTarget&&canTrack(s,t)&&!t.submerged&&Math.hypot(t.pos.x-s.pos.x,t.pos.z-s.pos.z)<=s.mainRange&&clearLine(s,s.pos.x,s.pos.z,t.pos.x,t.pos.z,s.pos.y+s.spec.freeboard+20,t.pos.y+12)===1)??null;
}
export function destroyPlatform(m:Ship):void {
  const tag=m.architectPlatform;if(!tag)return;
  const a=tag.owner.architect;if(!a||a.clearing)return;
  const slot=a.slots[tag.index];slot.skillTimer=ARCHETYPES[slot.type].skills[slot.skill].cooldown;slot.castGap=0;slot.opening=false;slot.hp=0;slot.state='destroyed';slot.rebuild=5;slot.entity=null;slot.path=null;slot.disabled=0;
  disableDocked(tag.owner,slot);
  m.game.events.emit('architectCommand',{ship:tag.owner,kind:'destroy'});
}
export function clearArchitect(s:Ship):void {
  const a=s.architect;if(!a)return;
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
  p.elapsed+=dt;const f=Math.min(1,p.elapsed/p.duration);
  m.pos.set(p.x+(p.tx-p.x)*f,p.y+(p.ty-p.y)*f,p.z+(p.tz-p.z)*f);
  if(f<1){m.pos.y+=Math.sin(f*Math.PI)*160;m.pos.y=Math.max(m.pos.y,s.game.map.heightAt(m.pos.x,m.pos.z)+60);}
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
  let repairBudget=0;
  for(const slot of a.slots){
    const t=s.turrets[slot.index];
    if(slot.state==='docked'){
      slot.reload=Math.max(0,t.reload);slot.disabled=Math.max(0,t.disabled);slot.dockedFor+=dt;
      if(slot.dockedFor>2)repairBudget+=Math.min(a.moduleHp-slot.hp,a.moduleHp*.1*Math.min(dt,slot.dockedFor-2));
    }else if(slot.state==='destroyed'){
      slot.rebuild-=dt;disableDocked(s,slot);
      if(slot.rebuild<=1e-8){slot.state='docked';slot.reloadScale=1;slot.rebuild=0;rebuildArchitectHealth(s,slot);slot.reload=0;slot.disabled=0;slot.dockedFor=0;t.disabled=0;t.reload=0;}
    }else{
      disableDocked(s,slot);
      if(slot.entity?.alive){slot.hp=slot.entity.hp;slot.reload=Math.max(0,slot.entity.turrets[0].reload);slot.disabled=Math.max(0,slot.entity.turrets[0].disabled);}
      if(!a.ultimate)updateModulePath(s,slot,dt);
    }
  }
  if(repairBudget>0)s.heal(repairBudget/PLATFORM_HEALTH_RATIO);
  updateArchitectUltimate(s,dt);
  updateElements(s,dt);
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
  setModuleReloadScale(slot,platformReloadScale(slot));
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
    if(clearLine(s,m.pos.x,m.pos.z,t.pos.x,t.pos.z,m.pos.y+30,t.pos.y+12)<1)continue;
    const priority=t.id===(a.huntUntil>s.game.time?a.huntTarget:s.control.targetId)?-1:d;
    if(priority<dist){target=t;dist=priority;}
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
 s.architect!.elements.jobs=s.architect!.elements.jobs.filter(j=>j.slot!==index||!j.channel);return result(true);
}
