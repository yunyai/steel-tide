import { arsenalTeam } from './ArchitectTargets';
import type { Ship } from '../../ships/Ship';
import type { ModuleSlot } from './ArchitectRuntime';
import { buff } from '../kit';
import { elementOrigin, type ElementJob, emitElement } from './ArchitectElements';
export interface SupportAdmission {owner:number;slot:number;until:number}
/** Recipient-owned admission order makes allied owners share the same limit. */
export function supportFactor(target:Ship,owner:Ship,slot:number):number{
 const now=target.game.time;
 target.architectSupport=target.architectSupport.filter(x=>x.until>now);
 let index=target.architectSupport.findIndex(x=>x.owner===owner.id&&x.slot===slot);
 if(index<0){index=target.architectSupport.length;target.architectSupport.push({owner:owner.id,slot,until:now+6});}
 else target.architectSupport[index].until=now+6;
 return index<4?1:index<6?.5:.25;
}
export function grantSupportShield(s:Ship,a:ModuleSlot,t:Ship,amount:number,life:number):void{
 amount*=supportFactor(t,s,a.index)*(s.architect!.huntUntil>s.game.time?1.4:1);
 if(amount>=t.shield){t.shield=t.shieldMax=amount;t.shieldTime=life;}
}
export function supportHeal(s:Ship,a:ModuleSlot,t:Ship,amount:number):void{
 if(t.hp>=t.maxHp)return;
 t.heal(amount*supportFactor(t,s,a.index)*(s.architect!.huntUntil>s.game.time?1.4:1));
}
export function supportTarget(s:Ship,a:ModuleSlot):Ship|null{
 const p=elementOrigin(s,a),range=a.type==='sentinel'?a.skill?2000:3000:a.skill===0?2000:1200;
 if(a.type==='sentinel')return arsenalTeam(s,true).find(t=>t.alive&&t.team!==s.team&&!t.mods.banished&&(a.skill===1?t.submerged:!t.submerged)&&Math.hypot(t.pos.x-p.x,t.pos.z-p.z)<=range)??null;
 const allies=arsenalTeam(s).filter(t=>t.alive&&!t.mods.banished&&t.team===s.team&&Math.hypot(t.pos.x-p.x,t.pos.z-p.z)<=(a.type==='resonance'?1500:range));
 if(a.type==='restoration')return allies.filter(t=>t.hp<t.maxHp).sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp||a.id-b.id)[0]??null;
 if(a.type==='resonance')return allies.find(t=>t.architectPlatform&&t.architectPlatform.owner.architect?.slots[t.architectPlatform.index].type!=='resonance')??null;
 return allies.sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp||a.id-b.id)[0]??null;
}
export function resolveSupport(s:Ship,a:ModuleSlot,j:ElementJob):void{
 const p=elementOrigin(s,a),targets=arsenalTeam(s,a.type==='sentinel').filter(t=>t.alive&&!t.mods.banished&&Math.hypot(t.pos.x-p.x,t.pos.z-p.z)<=j.radius);
 if(a.type==='sentinel'){
  for(const t of targets)if(t.team!==s.team&&(a.skill===1?t.submerged:!t.submerged))t.architectReveal[s.team]=Math.max(t.architectReveal[s.team],s.game.time+6);
 }else if(a.type==='restoration'){
  for(const t of targets)if(t.team===s.team&&(a.skill===1||t.id===j.target))supportHeal(s,a,t,j.damage);
 }else if(a.type==='bastion'){
  for(const t of targets)if(t.team===s.team){if(a.skill===0){if(t.id===j.target)grantSupportShield(s,a,t,120000,5);}else buff(t,'architectBulwark',4,m=>m.citadelDR=Math.max(m.citadelDR,.2));}
 }else if(a.type==='resonance'){
  for(const t of targets)if(t.team===s.team){
   const tag=t.architectPlatform,slot=tag?.owner.architect?.slots[tag.index];
   if(slot){if(a.skill===1)slot.reactionUntil=s.game.time+4;else if(slot.type!=='resonance')slot.boostUntil=s.game.time+4;}
   if(a.skill===1&&t.architect)for(const slot of t.architect.slots)if(slot.state==='docked')slot.reactionUntil=s.game.time+4;
  }
 }
 emitElement(s,a,j,'hit');
}
