import { ensureArchitectHealth, detachArchitectHealth, returnArchitectHealth, rebuildArchitectHealth } from './ArchitectHealth';
import { Vector3 } from 'three';
import type { Ship, TurretState } from '../../ships/Ship';
import type { SkillSpec } from '../../core/types';
import { canTrack } from '../../core/Targeting';
import { MAP_HALF } from '../../config';
import { bearingTo } from '../../core/math';
import { segmentHitsHull } from '../../core/hull';
import { hurt } from '../kit';
import { safeStep, type Landing } from './StepperRuntime';
import { updateArchitectUltimate, endArchitectUltimate, type ArchitectUltimate } from './ArchitectUltimates';

export type ModuleMode = 'docked'|'launching'|'deployed'|'moving'|'returning'|'destroyed'|'assembling'|'citadel';
export interface ModuleSlot {
  aboard:boolean; index:number; state:ModuleMode; hp:number; reload:number; disabled:number; rebuild:number; dockedFor:number;
  entity:Ship|null;
  path:{ x:number;y:number;z:number;tx:number;ty:number;tz:number;elapsed:number;duration:number;hit:number[];damage:boolean }|null;
}
export interface ArchitectState {
  fullHp:number;moduleHp:number;healthReady:boolean;healthTransfer:boolean;
  slots:ModuleSlot[];
  links:{a:number;b:number}[];linkUntil:number;linkTick:number;
  ultimate:ArchitectUltimate|null;
  clearing:boolean;
}
export interface ArchitectPlatform { owner:Ship; index:number }
export const MODULE_HP=50000;
export function newArchitectState():ArchitectState {
  return {fullHp:1500000,moduleHp:50000,healthReady:false,healthTransfer:false,slots:Array.from({length:10},(_,index)=>({aboard:true,index,state:'docked',hp:MODULE_HP,reload:0,disabled:0,rebuild:0,dockedFor:0,entity:null,path:null})),links:[],linkUntil:0,linkTick:0,ultimate:null,clearing:false};
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
  if(a.state==='docked'){const t=s.turrets[a.index];a.reload=t.reload;a.disabled=t.disabled;}
  const m=materialize(s,a);m.control.fire=false;
  a.state=mode;a.dockedFor=0;
  if(p.heading!==undefined)m.heading=p.heading;
  a.path={x:m.pos.x,y:m.pos.y,z:m.pos.z,tx:p.x,ty:p.y??0,tz:p.z,elapsed:0,duration:duration??Math.max(.05,Math.hypot(m.pos.x-p.x,m.pos.z-p.z)/1200),hit:[],damage};
  disableDocked(s,a);
}
export function attachModule(s:Ship,a:ModuleSlot):void {
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
  slots.forEach((a,i)=>moveModule(s,a,poses[i],'launching'));
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
  slots.forEach((a,i)=>moveModule(s,a,poses[i],'moving',undefined,true));return true;
}
export function raiseShield(s:Ship,amount:number,life=6):void {
  s.shield=Math.max(s.shield,amount);s.shieldMax=Math.max(s.shieldMax,s.shield);s.shieldTime=Math.max(s.shieldTime,life);
}
export function fortify(s:Ship):void {
  raiseShield(s,75000);
  for(const a of available(s))if(a.entity?.alive)raiseShield(a.entity,25000);
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
  for(let i=0;i<(slots.length===2?1:slots.length);i++){
    const m=slots[i],n=slots[(i+1)%slots.length];if(!n)continue;
    const p=m.entity!.pos,q=n.entity!.pos;
    if(Math.hypot(p.x-q.x,p.z-q.z)<=2500&&clearLine(s,p.x,p.z,q.x,q.z)===1)a.links.push({a:m.index,b:n.index});
  }
  if(!a.links.length)return s.failSkill('Connect: two anchored platforms need a clear link within 2.5 km');
  a.linkUntil=s.game.time+10;a.linkTick=0;return true;
}
export function commandedBurst(s:Ship,spec:SkillSpec):boolean {
  let count=0;
  for(const a of available(s)){
    if(a.state!=='docked'&&a.state!=='deployed')continue;
    if(a.disabled>0)continue;
    const m=a.entity,origin=m?m.localToWorld(0,m.spec.freeboard+4,0):dockPoint(s,a.index);
    if(Math.hypot(origin.x-s.control.aimX,origin.z-s.control.aimZ)>s.mainRange)continue;
    const shell={...s.spec.main!.ap!,damage:20000};
    for(let barrel=0;barrel<2;barrel++)s.game.shells.fire(s,{ammo:'AP',spec:shell,table:s.tableFor('AP')!,fromX:origin.x+(barrel?3:-3),fromY:origin.y,fromZ:origin.z,toX:s.control.aimX,toZ:s.control.aimZ,toY:s.control.aimY,dmgMul:s.mods.damageMul,guaranteedFire:false,railgun:false,flat:3,look:'rail',skill:spec});
    a.reload=s.spec.main!.reload*s.mods.reloadMul;
    const turret=m?.turrets[0]??s.turrets[a.index];turret.reload=a.reload;turret.recoil=.6;
    s.stats.shotsFired+=2;count++;
    s.game.events.emit('gunFired',{ship:m??s,x:origin.x,y:origin.y,z:origin.z,bearing:bearingTo(origin.x,origin.z,s.control.aimX,s.control.aimZ),caliber:420,secondary:false,look:'rail'});
  }
  return count>0||s.failSkill('Commanded Burst: no available guns in range');
}
export function destroyPlatform(m:Ship):void {
  const tag=m.architectPlatform;if(!tag)return;
  const a=tag.owner.architect;if(!a||a.clearing)return;
  const slot=a.slots[tag.index];slot.hp=0;slot.state='destroyed';slot.rebuild=12;slot.entity=null;slot.path=null;slot.disabled=0;
  disableDocked(tag.owner,slot);
  m.game.events.emit('architectCommand',{ship:tag.owner,kind:'destroy'});
}
export function clearArchitect(s:Ship):void {
  const a=s.architect;if(!a)return;
  const full=a.healthReady?a.fullHp:s.maxHp;
  s.maxHp=full;
  a.clearing=true;
  for(const slot of a.slots)if(slot.entity?.alive)slot.entity.withdraw();
  s.architect=s.spec.id==='architect'?newArchitectState():null;
  if(s.architect){s.architect.fullHp=full;s.architect.moduleHp=full/30;}
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
      if(slot.rebuild<=1e-8){slot.state='docked';slot.rebuild=0;rebuildArchitectHealth(s,slot);slot.reload=0;slot.disabled=0;slot.dockedFor=0;t.disabled=0;t.reload=0;}
    }else{
      disableDocked(s,slot);
      if(slot.entity?.alive){slot.hp=slot.entity.hp;slot.reload=Math.max(0,slot.entity.turrets[0].reload);slot.disabled=Math.max(0,slot.entity.turrets[0].disabled);}
      if(!a.ultimate)updateModulePath(s,slot,dt);
    }
  }
  if(repairBudget>0)s.heal(repairBudget);
  updateArchitectUltimate(s,dt);
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
  if(slot.state==='citadel')m.mods.reloadMul*=.5;
  m.control.fire=false;
  if(slot.state!=='deployed'&&slot.state!=='citadel')return;
  if(a.ultimate&&a.ultimate.kind!=='citadel'&&a.ultimate.members.includes(slot.index))return;
  let target:Ship|null=null,dist=Infinity;
  for(const t of m.game.ships){
    if(!canTrack(m,t)||t.submerged)continue;
    const d=Math.hypot(t.pos.x-m.pos.x,t.pos.z-m.pos.z);if(d>m.mainRange)continue;
    const priority=t.id===s.control.targetId?-1:d;
    if(priority<dist){target=t;dist=priority;}
  }
  if(!target)return;
  m.control.aimX=target.pos.x;m.control.aimZ=target.pos.z;m.control.aimY=target.pos.y>20?target.pos.y+4:undefined;
  m.heading=bearingTo(m.pos.x,m.pos.z,target.pos.x,target.pos.z);m.prevHeading=m.renderHeading=m.heading;
  m.turrets[0].yaw=0;m.turrets[0].canBear=m.turrets[0].aligned=true;m.control.fire=true;
}
export function endArchitect(s:Ship):void {if(s.architect?.ultimate)endArchitectUltimate(s);}
export function turretInDock(s:Ship,t:TurretState):boolean {
  const i=s.turrets.indexOf(t);return !s.architect||s.architect.slots[i]?.state==='docked';
}
