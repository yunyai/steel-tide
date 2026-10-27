import type { Ship } from '../../ships/Ship';
import type { SkillSpec } from '../../core/types';
import { canTrack } from '../../core/Targeting';
import { distToHull, segmentHitsHull } from '../../core/hull';
import { buff,hurt } from '../kit';
import { clearLine,dockPoint, type ModuleSlot } from './ArchitectRuntime';

export const ELEMENTS=['furnace','cryo','storm','gravity','prism'] as const;
export type ArchitectElement=typeof ELEMENTS[number];
export const ELEMENT_STYLE:Record<ArchitectElement,{name:string;short:string;color:number}>={
 furnace:{name:'Furnace',short:'FU',color:0xff862c},cryo:{name:'Cryo',short:'CR',color:0x69e6ff},storm:{name:'Storm',short:'ST',color:0xa98aff},gravity:{name:'Gravity',short:'GR',color:0xff66cc},prism:{name:'Prism',short:'PR',color:0xffe4a0},
};
export type ElementAttack='skill'|'mini'|'coordinated'|'salvo'|'reaction'|'assembly'|'killbox';
export interface ElementEvent {ship:Ship;slot:number;element:ArchitectElement;attack:ElementAttack;phase:'cast'|'hit';id:number;x:number;y:number;z:number;tx:number;ty:number;tz:number;radius:number;pair?:ArchitectElement}
export interface ElementMark {target:number;element:ArchitectElement|null;until:number;ready:number}
export interface ElementJob {id:number;slot:number;element:ArchitectElement;attack:ElementAttack;x:number;y:number;z:number;tx:number;ty:number;tz:number;elapsed:number;next:number;count:number;interval:number;damage:number;radius:number;beam:number;chain:boolean;pull:boolean;slow:boolean;channel:boolean;mark:boolean}
export interface ElementPull {target:number;x:number;z:number;until:number}
export interface ElementState {serial:number;marks:ElementMark[];jobs:ElementJob[];pulls:ElementPull[]}
export const newElementState=():ElementState=>({serial:0,marks:[],jobs:[],pulls:[]});
export function shuffledElements(rng:()=>number):ArchitectElement[]{const a=[...ELEMENTS,...ELEMENTS];for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
const spec=(s:Ship,a:ModuleSlot,attack:ElementAttack):SkillSpec=>({...s.skills[1].spec,id:`architect:${a.element}:${attack}`,short:ELEMENT_STYLE[a.element].name.toUpperCase(),name:`${ELEMENT_STYLE[a.element].name} ${attack==='mini'||attack==='coordinated'?'Overdrive':attack==='reaction'?'Reaction':'Arsenal'}`,ult:attack==='mini'||attack==='coordinated'||attack==='assembly'||attack==='killbox'});
export function elementOrigin(s:Ship,a:ModuleSlot){return a.entity?{x:a.entity.pos.x,y:a.entity.pos.y+a.entity.spec.freeboard+28,z:a.entity.pos.z}:dockPoint(s,a.index);}
export function elementEligible(s:Ship,t:Ship):boolean{return canTrack(s,t)&&!t.submerged&&!t.mods.banished;}
export function elementTarget(s:Ship,a:ModuleSlot):Ship|null {
 const p=elementOrigin(s,a);let best:Ship|null=null,dist=Infinity;
 for(const t of s.game.ships){if(!elementEligible(a.entity??s,t))continue;const d=Math.hypot(t.pos.x-p.x,t.pos.z-p.z);if(d>6000||clearLine(s,p.x,p.z,t.pos.x,t.pos.z,p.y,t.pos.y+4)<1)continue;const priority=t.id===s.control.targetId?-1:d;if(priority<dist||priority===dist&&t.id<(best?.id??Infinity)){best=t;dist=priority;}}
 return best;
}
export function moduleLinked(s:Ship,a:ModuleSlot):boolean {
 const ar=s.architect;if(!ar||ar.linkUntil<=s.game.time||!a.entity?.alive||!['deployed','citadel'].includes(a.state))return false;
 return ar.slots.some(b=>b!==a&&b.entity?.alive&&['deployed','citadel'].includes(b.state)&&Math.hypot(a.entity!.pos.x-b.entity.pos.x,a.entity!.pos.z-b.entity.pos.z)<=2500&&clearLine(s,a.entity!.pos.x,a.entity!.pos.z,b.entity.pos.x,b.entity.pos.z,a.entity!.pos.y+16,b.entity.pos.y+16)===1);
}
function emit(s:Ship,a:ModuleSlot,j:ElementJob,phase:'cast'|'hit',p?:Ship,pair?:ArchitectElement):void{s.game.events.emit('architectElement',{ship:s,slot:a.index,element:a.element,attack:j.attack,phase,id:j.id,x:j.x,y:j.y,z:j.z,tx:p?.pos.x??j.tx,ty:p?p.pos.y+12:j.ty,tz:p?.pos.z??j.tz,radius:j.radius||j.beam,pair});}
function slow(t:Ship){buff(t,'debuff:architectCryo',2,m=>{m.speedMul=Math.min(m.speedMul,.8);});}
function pull(s:Ship,t:Ship,x:number,z:number){if(t.mods.knockImmune||t.mods.ccImmune||t.mods.invulnerable)return;const a=s.architect!.elements;const old=a.pulls.find(p=>p.target===t.id);if(old){old.x=x;old.z=z;old.until=s.game.time+.5;}else a.pulls.push({target:t.id,x,z,until:s.game.time+.5});}
/** Distance to the hull's physical vertical span, combined with its plan-view footprint. */
export function inElementBlast(t:Ship,x:number,y:number,z:number,r:number):boolean {
 const dy=Math.max(t.pos.y-t.spec.draft-y,y-(t.pos.y+t.spec.freeboard+30),0);
 return Math.hypot(distToHull(t,x,z),dy)<=r;
}
function damage(s:Ship,a:ModuleSlot,t:Ship,n:number,attack:ElementAttack,mark=true):number {
 if(!s.alive||!s.architect||!t.alive||t.team===s.team||t.submerged)return 0;
 const dealt=hurt(s,t,n,spec(s,a,attack));if(dealt>0&&mark&&t.alive)applyElementMark(s,a,t);return dealt;
}
export function applyElementMark(s:Ship,a:ModuleSlot,t:Ship):void {
 if(!s.architect||!s.alive||!t.alive||t.team===s.team||t.submerged||t.mods.invulnerable)return;
 const e=s.architect.elements,now=s.game.time;let mark=e.marks.find(m=>m.target===t.id);
 if(!mark){e.marks.push({target:t.id,element:a.element,until:now+4,ready:0});return;}
 if(mark.ready>now+1e-8)return;
 if(!mark.element||mark.until<now||mark.element===a.element){mark.element=a.element;mark.until=now+4;return;}
 const other=mark.element;mark.element=null;mark.ready=now+1;mark.until=now+4;
 const pair=[other,a.element].sort().join('+'),chain=pair==='furnace+storm'||pair==='cryo+storm'||pair==='gravity+storm'||pair==='prism+storm';
 const amount=chain?24000:pair==='gravity+prism'?36000:30000;
 const radius=pair==='cryo+furnace'||pair==='cryo+gravity'?250:300;
 const targets=chain?[t,...s.game.ships.filter(v=>v!==t&&elementEligible(s,v)&&Math.hypot(v.pos.x-t.pos.x,v.pos.z-t.pos.z)<=600&&clearLine(s,t.pos.x,t.pos.z,v.pos.x,v.pos.z,t.pos.y+12,v.pos.y+12)===1).sort((a,b)=>a.pos.distanceTo(t.pos)-b.pos.distanceTo(t.pos)||a.id-b.id).slice(0,2)]:pair==='gravity+prism'?[t]:s.game.ships.filter(v=>v.alive&&v.team!==s.team&&!v.submerged&&inElementBlast(v,t.pos.x,t.pos.y+12,t.pos.z,radius)&&clearLine(s,t.pos.x,t.pos.z,v.pos.x,v.pos.z,t.pos.y+12,v.pos.y+12)===1);
 for(const v of targets){const n=damage(s,a,v,amount,'reaction',false);if(n>0){if(pair==='cryo+storm')slow(v);if(pair==='furnace+gravity'||pair==='cryo+gravity'||pair==='gravity+storm'&&v===t)pull(s,v,t.pos.x,t.pos.z);}}
 if(!s.alive||!s.architect)return;
 const p=elementOrigin(s,a),j=job(s,a,'reaction',p,t.pos,amount,radius);emit(s,a,j,'hit',t,other);
 if(moduleLinked(s,a)){const v=s.game.ships.filter(v=>!targets.includes(v)&&elementEligible(s,v)&&Math.hypot(v.pos.x-t.pos.x,v.pos.z-t.pos.z)<=600&&clearLine(s,t.pos.x,t.pos.z,v.pos.x,v.pos.z,t.pos.y+12,v.pos.y+12)===1).sort((a,b)=>a.pos.distanceTo(t.pos)-b.pos.distanceTo(t.pos)||a.id-b.id)[0];if(v){damage(s,a,v,amount*.5,'reaction',false);emit(s,a,j,'hit',v,other);}}
}
function job(s:Ship,a:ModuleSlot,attack:ElementAttack,p:{x:number;y:number;z:number},t:{x:number;y:number;z:number},damage:number,radius=0):ElementJob{return{id:++s.architect!.elements.serial,slot:a.index,element:a.element,attack,x:p.x,y:p.y,z:p.z,tx:t.x,ty:t.y+12,tz:t.z,elapsed:-.25,next:0,count:1,interval:.3,damage,radius,beam:0,chain:false,pull:false,slow:false,channel:true,mark:true};}
export function startElementAttack(s:Ship,a:ModuleSlot,t:Ship,attack:'skill'|'mini'|'coordinated'):void {
 const p=elementOrigin(s,a),mini=attack!=='skill',j=job(s,a,attack,p,t.pos,0);const e=a.element;
 if(e==='furnace'){j.damage=mini?15000:12000;j.radius=mini?450:180;j.count=mini?6:3;j.interval=mini?.3:.2;}
 if(e==='cryo'){j.damage=mini?30000:36000;j.radius=mini?450:0;j.beam=mini?0:100;j.count=mini?2:1;j.interval=.6;j.slow=true;}
 if(e==='storm'){j.damage=mini?30000:18000;j.chain=!mini;j.radius=mini?300:0;j.count=mini?3:1;j.interval=.5;}
 if(e==='gravity'){j.damage=mini?10000:30000;j.radius=mini?450:300;j.pull=true;j.count=mini?4:1;j.interval=.5;}
 if(e==='prism'){j.damage=mini?30000:42000;j.beam=mini?100:80;j.count=mini?3:1;j.interval=.45;}
 if(j.beam){
  const dx=j.tx-j.x,dy=j.ty-j.y,dz=j.tz-j.z,len=Math.hypot(dx,dz)||1;
  // Preserve the direction through the aim point; a downward beam ends at the water surface.
  const extend=Math.min(6000/len,dy<0?Math.max(1,(j.y-4)/-dy):Infinity);
  j.tx=j.x+dx*extend;j.ty=j.y+dy*extend;j.tz=j.z+dz*extend;
 }
 emit(s,a,j,'cast');s.architect!.elements.jobs.push(j);
}
function resolve(s:Ship,a:ModuleSlot,j:ElementJob):void {
 let targets:Ship[]=[];const k=clearLine(s,j.x,j.z,j.tx,j.tz,j.y,j.ty),tx=j.x+(j.tx-j.x)*k,ty=j.y+(j.ty-j.y)*k,tz=j.z+(j.tz-j.z)*k;
 if(j.beam){targets=s.game.ships.filter(t=>{
  if(!t.alive||t.team===s.team||t.submerged)return false;
  const f=segmentHitsHull(t,j.x,j.z,tx,tz,j.beam);if(f<0)return false;
  const height=j.y+(ty-j.y)*f;
  return height>=t.pos.y-t.spec.draft-j.beam&&height<=t.pos.y+t.spec.freeboard+30+j.beam;
 });}
 else if(j.chain){let px=j.tx,pz=j.tz;for(let n=0;n<3;n++){const t=s.game.ships.filter(t=>!targets.includes(t)&&elementEligible(s,t)&&Math.hypot(t.pos.x-px,t.pos.z-pz)<=(n?700:200)&&clearLine(s,n?px:j.x,n?pz:j.z,t.pos.x,t.pos.z,n?j.ty:j.y,t.pos.y+12)===1).sort((a,b)=>Math.hypot(a.pos.x-px,a.pos.z-pz)-Math.hypot(b.pos.x-px,b.pos.z-pz)||a.id-b.id)[0];if(!t)break;targets.push(t);px=t.pos.x;pz=t.pos.z;}}
 else if(k===1){targets=s.game.ships.filter(t=>t.alive&&t.team!==s.team&&!t.submerged&&inElementBlast(t,j.tx,j.ty,j.tz,j.radius)&&clearLine(s,j.tx,j.tz,t.pos.x,t.pos.z,j.ty,t.pos.y+12)===1);}
 const n=j.element==='cryo'&&j.attack!=='skill'&&j.next===1?60000:j.element==='gravity'&&j.next===3?60000:j.damage;
 for(const t of targets){if(damage(s,a,t,n,j.attack,j.mark)>0){if(j.slow)slow(t);if(j.pull)pull(s,t,j.tx,j.tz);if(j.chain||j.beam)emit(s,a,j,'hit',t);}}
 if(!s.alive||!s.architect)return;
 if(!j.chain)emit(s,a,{...j,tx,ty,tz},'hit');
 if(k===1&&j.element==='furnace'&&j.attack==='skill'&&j.next===0){const patch={...j,id:++s.architect!.elements.serial,x:j.tx,y:j.ty,z:j.tz,elapsed:-1,next:0,count:3,interval:1,damage:6000,radius:250,channel:false};patch.attack='salvo';s.architect!.elements.jobs.push(patch);}
}
export function updateElements(s:Ship,dt:number):void {
 const ar=s.architect;if(!ar)return;const e=ar.elements,now=s.game.time;
 e.marks=e.marks.filter(m=>m.until>=now&&s.game.ships.some(t=>t.id===m.target&&t.alive));
 e.pulls=e.pulls.filter(p=>p.until>now);
 for(const p of e.pulls){const t=s.game.ships.find(t=>t.id===p.target);if(!t?.alive||t.mods.knockImmune||t.mods.ccImmune||t.mods.invulnerable)continue;const dx=p.x-t.pos.x,dz=p.z-t.pos.z,d=Math.hypot(dx,dz);if(d>1){const v=Math.min(60,d*2);const mag=Math.hypot(t.pushX,t.pushZ);if(mag<=60){t.pushX=dx/d*v;t.pushZ=dz/d*v;}}}
 for(const a of ar.slots){
  if(!['deployed','citadel'].includes(a.state)||!a.entity?.alive||ar.ultimate&&ar.ultimate.kind!=='citadel')continue;
  const rate=Math.min(1.75,1+(a.state==='citadel'?.5:0)+(moduleLinked(s,a)?.25:0));a.skillTimer=Math.max(0,a.skillTimer-dt*rate);a.miniTimer=Math.max(0,a.miniTimer-dt*rate);a.castGap=Math.max(0,a.castGap-dt);
  const m=a.entity;if(a.castGap>0||s.mods.stunned||s.mods.disarmed||s.mods.silenced||m.mods.stunned||m.mods.disarmed||m.mods.silenced||a.disabled>0)continue;
  const target=elementTarget(s,a);if(!target)continue;
  if(a.opening){fireElementSalvo(s,a,target.pos.x,target.pos.z,target.pos.y+4,30000);a.opening=false;}
  if(a.coordinated){startElementAttack(s,a,target,'coordinated');a.coordinated=false;a.castGap=.35;}
  else if(a.miniTimer<=0){startElementAttack(s,a,target,'mini');a.miniTimer=18;a.castGap=.35;}
  else if(a.skillTimer<=0){startElementAttack(s,a,target,'skill');a.skillTimer=6;a.castGap=.35;}
 }
 const jobs=e.jobs.slice();for(const j of jobs){const a=ar.slots[j.slot];if(j.channel&&(a.state==='destroyed'||!['deployed','citadel'].includes(a.state)||ar.ultimate&&ar.ultimate.kind!=='citadel'||a.disabled>0||s.mods.stunned||s.mods.disarmed||s.mods.silenced||a.entity?.mods.stunned||a.entity?.mods.disarmed||a.entity?.mods.silenced)){j.next=j.count;continue;}j.elapsed+=dt;while(j.next<j.count&&j.elapsed+1e-8>=j.next*j.interval){resolve(s,a,j);j.next++;}}
 e.jobs=e.jobs.filter(j=>j.next<j.count);
}
export function fireElementSalvo(s:Ship,a:ModuleSlot,x:number,z:number,y=4,amount=30000):void {
 const p=elementOrigin(s,a),shell={...s.spec.main!.ap!,damage:amount};
 for(const offset of [-3,3]){s.game.shells.fire(s,{ammo:'AP',spec:shell,table:s.tableFor('AP')!,fromX:p.x+offset,fromY:p.y,fromZ:p.z,toX:x,toZ:z,toY:y,dmgMul:s.mods.damageMul,guaranteedFire:false,railgun:false,flat:3,look:'rail',skill:s.skills[1].spec,element:{owner:s,slot:a.index,splash:150}});}
 s.stats.shotsFired+=2;const j=job(s,a,'salvo',p,{x,y,z},amount);emit(s,a,j,'cast');
}
export function elementalShellHit(s:Ship,index:number,t:Ship,splash=0,damageAmount=0,impact={x:t.pos.x,y:t.pos.y+12,z:t.pos.z}):void {
 const a=s.architect?.slots[index];if(!a||!s.alive)return;applyElementMark(s,a,t);
 if(splash)for(const v of s.game.ships)if(v!==t&&v.alive&&v.team!==s.team&&!v.submerged&&inElementBlast(v,impact.x,impact.y,impact.z,splash)&&clearLine(s,impact.x,impact.z,v.pos.x,v.pos.z,impact.y,v.pos.y+12)===1)damage(s,a,v,damageAmount,'salvo');
}
/** Ultimate supplementary hits have a cast-local victim cap supplied by the caller. */
export function ultimateElementHit(s:Ship,a:ModuleSlot,t:Ship,attack:'assembly'|'killbox',n=12000):void {damage(s,a,t,n,attack);const j=job(s,a,attack,elementOrigin(s,a),t.pos,n,attack==='assembly'?200:1000);emit(s,a,j,'hit');}
