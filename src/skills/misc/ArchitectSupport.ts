import { arsenalTeam } from './ArchitectTargets';
import type { Ship } from '../../ships/Ship';
import type { ModuleSlot } from './ArchitectRuntime';
import { buff } from '../kit';
import { elementOrigin, type ElementJob, emitElement } from './ArchitectElements';
import { addStack } from './ArchitectStacks';
/** Support turrets stack at full strength: every heal and shield lands in full however many emitters share a target. */
const supportBoost=(s:Ship)=>s.architect!.huntUntil>s.game.time?1.4:1;
/** Each Bulwark field adds this much damage reduction, up to the cap; other protection multiplies on top. */
export const BULWARK_DR=.2,BULWARK_CAP=.6;
export function bulwarkTaken(fields:number):number{
 return 1-Math.min(BULWARK_CAP,BULWARK_DR*fields);
}
/** Living Aegis Projectors across every Architect on the team. */
function aegisEmitters(s:Ship):number{
 let n=0;
 for(const o of s.game.ships)if(o.alive&&o.team===s.team&&o.architect)for(const v of o.architect.slots)if(v.type==='bastion'&&v.skill===0&&v.state!=='destroyed'&&v.hp>0)n++;
 return Math.max(1,n);
}
/** Aegis shields add up, but only to one full shield per living Aegis Projector, so staggered casts cannot grow it forever. */
export function grantSupportShield(s:Ship,t:Ship,amount:number,life:number):void{
 amount*=supportBoost(s);
 const next=Math.max(t.shield,Math.min(t.shield+amount,amount*aegisEmitters(s)));
 if(next<=t.shield)return;
 t.shield=next;t.shieldMax=Math.max(t.shieldMax,next);t.shieldTime=Math.max(t.shieldTime,life);
}
export function supportHeal(s:Ship,t:Ship,amount:number):void{
 if(t.hp>=t.maxHp)return;
 t.heal(amount*supportBoost(s));
}
export function supportTarget(s:Ship,a:ModuleSlot):Ship|null{
 const p=elementOrigin(s,a),range=a.type==='sentinel'?a.skill?2000:3000:a.skill===0?2000:1200;
 if(a.type==='sentinel')return arsenalTeam(s,true).find(t=>t.alive&&t.team!==s.team&&!t.mods.banished&&(a.skill===1?t.submerged:!t.submerged)&&Math.hypot(t.pos.x-p.x,t.pos.z-p.z)<=range)??null;
 const allies=arsenalTeam(s).filter(t=>t.alive&&!t.mods.banished&&t.team===s.team&&Math.hypot(t.pos.x-p.x,t.pos.z-p.z)<=(a.type==='resonance'?1500:range));
 if(a.type==='restoration')return allies.filter(t=>t.hp<t.maxHp).sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp||a.id-b.id)[0]??null;
 if(a.type==='resonance')return allies.find(t=>a.skill===0
  ?t.architectPlatform&&t.architectPlatform.owner.architect?.slots[t.architectPlatform.index].type!=='resonance'
  :!!t.architectPlatform||t.architect?.slots.some(slot=>slot.state==='docked'&&slot.hp>0))??null;
 return allies.sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp||a.id-b.id)[0]??null;
}
export function resolveSupport(s:Ship,a:ModuleSlot,j:ElementJob):void{
 const p=elementOrigin(s,a),targets=arsenalTeam(s,a.type==='sentinel').filter(t=>t.alive&&!t.mods.banished&&Math.hypot(t.pos.x-p.x,t.pos.z-p.z)<=j.radius);
 if(a.type==='sentinel'){
  for(const t of targets)if(t.team!==s.team&&(a.skill===1?t.submerged:!t.submerged))t.architectReveal[s.team]=Math.max(t.architectReveal[s.team],s.game.time+6);
 }else if(a.type==='restoration'){
  for(const t of targets)if(t.team===s.team&&(a.skill===1||t.id===j.target))supportHeal(s,t,j.damage);
 }else if(a.type==='bastion'){
  for(const t of targets)if(t.team===s.team){if(a.skill===0){if(t.id===j.target)grantSupportShield(s,t,120000,5);}else buff(t,`architectBulwark:${s.id}:${a.index}`,4,m=>{m.bulwark++;});}
 }else if(a.type==='resonance'){
  for(const t of targets)if(t.team===s.team){
   const tag=t.architectPlatform,slot=tag?.owner.architect?.slots[tag.index];
   // Each emitter keeps its own copy: a second Resonance stacks, its own recast only refreshes.
   const now=s.game.time,source=`${s.id}:${a.index}`;
   if(slot){if(a.skill===1)addStack(slot.amps,source,now+4,now);else if(slot.type!=='resonance')addStack(slot.boosts,source,now+4,now);}
   if(a.skill===1&&t.architect)for(const slot of t.architect.slots)if(slot.state==='docked')addStack(slot.amps,source,now+4,now);
  }
 }
 emitElement(s,a,j,'hit');
}
