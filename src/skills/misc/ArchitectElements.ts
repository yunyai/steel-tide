import { arsenalTeam,arsenalShip } from './ArchitectTargets';
import { ARCHETYPES } from '../../data/architectLoadout';
import { supportTarget,resolveSupport } from './ArchitectSupport';
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
export const REACTION_NAMES:Record<string,string>={'cryo+furnace':'Thermal Shock','furnace+storm':'Overload','furnace+gravity':'Core Collapse','furnace+prism':'Solar Flare','cryo+storm':'Superconduct','cryo+gravity':'Cold Crush','cryo+prism':'Crystal Break','gravity+storm':'Magnetic Storm','prism+storm':'Arc Spectrum','gravity+prism':'Singularity'};
export type ElementAttack='skill'|'salvo'|'reaction'|'assembly'|'killbox';
export interface ElementEvent {ship:Ship;slot:number;element:ArchitectElement;attack:ElementAttack;phase:'cast'|'hit';id:number;x:number;y:number;z:number;tx:number;ty:number;tz:number;radius:number;pair?:ArchitectElement;type?:ModuleSlot["type"];target?:number;damage?:number;
 /** Presentation only: secondary victims a chain reaction arcs to, in order. */
 chain?:readonly {x:number;y:number;z:number}[]}
export interface ElementMark {target:number;element:ArchitectElement|null;until:number;ready:number}
export interface ElementJob {id:number;slot:number;element:ArchitectElement;attack:ElementAttack;x:number;y:number;z:number;tx:number;ty:number;tz:number;elapsed:number;next:number;count:number;interval:number;damage:number;radius:number;beam:number;chain:boolean;pull:boolean;slow:boolean;channel:boolean;mark:boolean;type:ModuleSlot['type'];variant:number;target:number;underwater:boolean;support:boolean;projectile:boolean;speed:number;life:number}
export interface ElementPull {target:number;x:number;z:number;until:number}
export interface ElementState {serial:number;marks:ElementMark[];jobs:ElementJob[];pulls:ElementPull[];drones:{id:number;slot:number;next:number}[]}
export const newElementState=():ElementState=>({serial:0,marks:[],jobs:[],pulls:[],drones:[]});
export function shuffledElements(rng:()=>number):ArchitectElement[]{const a=[...ELEMENTS,...ELEMENTS];for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
const spec=(s:Ship,a:ModuleSlot,attack:ElementAttack):SkillSpec=>({...s.skills[1].spec,id:`architect:${a.type}:${a.skill}:${attack}`,short:attack==='reaction'?'REACTION':ARCHETYPES[a.type].name.toUpperCase(),name:attack==='reaction'?'Elemental reaction':ARCHETYPES[a.type].skills[a.skill].name,element:a.element,ult:attack==='assembly'||attack==='killbox'});
export function elementOrigin(s:Ship,a:ModuleSlot){return a.entity?{x:a.entity.pos.x,y:a.entity.pos.y+a.entity.spec.freeboard+28,z:a.entity.pos.z}:dockPoint(s,a.index);}
export function elementEligible(s:Ship,t:Ship):boolean{return canTrack(s,t)&&!t.submerged&&!t.mods.banished;}
export function elementTarget(s:Ship,a:ModuleSlot,surfaceOnly=false):Ship|null {
 const p=elementOrigin(s,a);let best:Ship|null=null,dist=Infinity;
 for(const t of arsenalTeam(s,true)){if(!canTrack(a.entity??s,t)||t.mods.banished||(t.submerged&&(surfaceOnly||a.type!=='abyss')))continue;const d=Math.hypot(t.pos.x-p.x,t.pos.z-p.z);if(d>(a.type==='abyss'&&a.skill===1?4000:6000)||clearLine(s,p.x,p.z,t.pos.x,t.pos.z,p.y,t.pos.y+4)<1)continue;const u=s.architect?.ultimate;if(u?.kind==='killbox'&&Math.hypot(t.pos.x-u.x,t.pos.z-u.z)>1500)continue;const priority=t.id===(s.architect!.huntUntil>s.game.time?s.architect!.huntTarget:s.control.targetId)?-1:d;if(priority<dist||priority===dist&&t.id<(best?.id??Infinity)){best=t;dist=priority;}}
 return best;
}
export function moduleLinked(s:Ship,a:ModuleSlot):boolean {
 const ar=s.architect;if(!ar||ar.linkUntil<=s.game.time||!a.entity?.alive||!['deployed','citadel'].includes(a.state))return false;
 return ar.slots.some(b=>b.index!==a.index&&b.entity?.alive&&['deployed','citadel'].includes(b.state)&&Math.hypot(a.entity!.pos.x-b.entity.pos.x,a.entity!.pos.z-b.entity.pos.z)<=2500&&clearLine(s,a.entity!.pos.x,a.entity!.pos.z,b.entity.pos.x,b.entity.pos.z,a.entity!.pos.y+16,b.entity.pos.y+16)===1);
}
/** Recharge work per simulation second; control effects block casting, not recharge. */
export function architectSkillRechargeRate(s:Ship,a:ModuleSlot):number {
 if(!s.alive||!['deployed','citadel'].includes(a.state)||!a.entity?.alive||s.architect?.ultimate?.kind==='assembly')return 0;
 return a.state==='citadel'?5:Math.min(1.5,1+(moduleLinked(s,a)?.25:0)+(a.boostUntil>s.game.time?.25:0));
}
export function emitElement(s:Ship,a:ModuleSlot,j:ElementJob,phase:'cast'|'hit',p?:Ship,pair?:ArchitectElement,chain?:readonly {x:number;y:number;z:number}[]):void{s.game.events.emit('architectElement',{ship:s,slot:a.index,element:a.element,attack:j.attack,phase,id:j.id,x:j.x,y:j.y,z:j.z,tx:p?.pos.x??j.tx,ty:p?p.pos.y+12:j.ty,tz:p?.pos.z??j.tz,radius:j.radius||j.beam,pair,type:a.type,target:p?.id,chain});}
function slow(t:Ship){buff(t,'debuff:architectCryo',3,m=>{m.speedMul=Math.min(m.speedMul,.8);});}
function pull(s:Ship,t:Ship,x:number,z:number){if(t.mods.knockImmune||t.mods.ccImmune||t.mods.invulnerable)return;const a=s.architect!.elements;const old=a.pulls.find(p=>p.target===t.id);if(old){old.x=x;old.z=z;old.until=s.game.time+.5;}else a.pulls.push({target:t.id,x,z,until:s.game.time+.5});}
/** Distance to the hull's physical vertical span, combined with its plan-view footprint. */
export function inElementBlast(t:Ship,x:number,y:number,z:number,r:number):boolean {
 const dy=Math.max(t.pos.y-t.spec.draft-y,y-(t.pos.y+t.spec.freeboard+30),0);
 return Math.hypot(distToHull(t,x,z),dy)<=r;
}
function damage(s:Ship,a:ModuleSlot,t:Ship,n:number,attack:ElementAttack,mark=true,underwater=false,pair?:ArchitectElement):number {
 if(!s.alive||!s.architect||!t.alive||t.team===s.team||t.submerged&&!underwater)return 0;
 const dealt=hurt(s,t,n*(attack==='reaction'&&a.reactionUntil>s.game.time?1.4:1),{...spec(s,a,attack),...(pair?{reaction:[pair,a.element] as [ArchitectElement,ArchitectElement],short:REACTION_NAMES[[pair,a.element].sort().join('+')]}:{})});if(dealt>0&&mark&&t.alive)applyElementMark(s,a,t,underwater);return dealt;
}
export function applyElementMark(s:Ship,a:ModuleSlot,t:Ship,underwater=false):void {
 if(!s.architect||!s.alive||!t.alive||t.team===s.team||t.submerged&&!underwater||t.mods.invulnerable)return;
 const e=s.architect.elements,now=s.game.time;let mark=e.marks.find(m=>m.target===t.id);
 if(!mark){e.marks.push({target:t.id,element:a.element,until:now+4,ready:0});return;}
 if(mark.ready>now+1e-8)return;
 if(!mark.element||mark.until<now||mark.element===a.element){mark.element=a.element;mark.until=now+4;return;}
 const other=mark.element;mark.element=null;mark.ready=now+1;mark.until=now+4;
 const pair=[other,a.element].sort().join('+'),chain=pair==='furnace+storm'||pair==='cryo+storm'||pair==='gravity+storm'||pair==='prism+storm';
 const amount=chain?24000:pair==='gravity+prism'?36000:30000;
 const radius=pair==='cryo+furnace'||pair==='cryo+gravity'?250:300;
 const targets=chain?[t,...arsenalTeam(s,true).filter(v=>v!==t&&(underwater?canTrack(s,v):elementEligible(s,v))&&Math.hypot(v.pos.x-t.pos.x,v.pos.z-t.pos.z)<=600&&clearLine(s,t.pos.x,t.pos.z,v.pos.x,v.pos.z,t.pos.y+12,v.pos.y+12)===1).sort((a,b)=>a.pos.distanceTo(t.pos)-b.pos.distanceTo(t.pos)||a.id-b.id).slice(0,2)]:pair==='gravity+prism'?[t]:arsenalTeam(s,true).filter(v=>v.alive&&v.team!==s.team&&(!v.submerged||underwater)&&inElementBlast(v,t.pos.x,t.pos.y+12,t.pos.z,radius)&&clearLine(s,t.pos.x,t.pos.z,v.pos.x,v.pos.z,t.pos.y+12,v.pos.y+12)===1);
 for(const v of targets){const n=damage(s,a,v,amount,'reaction',false,underwater,other);if(n>0){if(pair==='cryo+storm')slow(v);if(pair==='furnace+gravity'||pair==='cryo+gravity'||pair==='gravity+storm'&&v===t)pull(s,v,t.pos.x,t.pos.z);}}
 if(!s.alive||!s.architect)return;
 const p=elementOrigin(s,a),j=job(s,a,'reaction',p,t.pos,amount,radius);emitElement(s,a,j,'hit',t,other,chain?targets.slice(1).map(v=>({x:v.pos.x,y:v.pos.y+12,z:v.pos.z})):undefined);
 if(moduleLinked(s,a)){const v=arsenalTeam(s,true).filter(v=>!targets.includes(v)&&(underwater?canTrack(s,v):elementEligible(s,v))&&Math.hypot(v.pos.x-t.pos.x,v.pos.z-t.pos.z)<=600&&clearLine(s,t.pos.x,t.pos.z,v.pos.x,v.pos.z,t.pos.y+12,v.pos.y+12)===1).sort((a,b)=>a.pos.distanceTo(t.pos)-b.pos.distanceTo(t.pos)||a.id-b.id)[0];if(v){damage(s,a,v,amount*.5,'reaction',false,underwater,other);emitElement(s,a,j,'hit',v,other);}}
}
function job(s:Ship,a:ModuleSlot,attack:ElementAttack,p:{x:number;y:number;z:number},t:{x:number;y:number;z:number},damage:number,radius=0):ElementJob{return{id:++s.architect!.elements.serial,slot:a.index,element:a.element,attack,x:p.x,y:p.y,z:p.z,tx:t.x,ty:t.y+12,tz:t.z,elapsed:-.25,next:0,count:1,interval:.3,damage,radius,beam:0,chain:false,pull:false,slow:false,channel:true,mark:true,type:a.type,variant:a.skill,target:0,underwater:a.type==='abyss',support:['sentinel','restoration','bastion','resonance'].includes(a.type),projectile:false,speed:0,life:0};}
export function startElementAttack(s:Ship,a:ModuleSlot,t:Ship,attack:'skill'):void {
 const p=elementOrigin(s,a),j=job(s,a,attack,p,t.pos,0);j.target=t.id;
 const second=a.skill===1;
 if(a.type==='furnace'){j.damage=second?60000:18000;j.radius=second?450:300;j.count=second?1:6;j.interval=.2;}
 if(a.type==='cryo'){j.damage=second?40000:90000;j.radius=second?450:0;j.beam=second?0:120;j.count=second?2:1;j.interval=.6;j.slow=true;}
 if(a.type==='storm'){j.damage=36000;j.chain=!second;j.radius=second?350:0;j.count=second?3:1;j.interval=.5;}
 if(a.type==='gravity'){j.damage=second?100000:12000;j.radius=second?300:450;j.pull=true;j.count=second?1:4;j.interval=.5;}
 if(a.type==='prism'){j.damage=second?36000:108000;j.beam=100;}
 if(a.type==='abyss'){j.damage=second?24000:30000;j.radius=second?100:300;j.count=second?4:3;j.interval=.25;}
 if(a.type==='swarm'){
  if(second){launchBrood(s,a);emitElement(s,a,j,'cast');return;}
  j.damage=9000;j.radius=100;j.count=12;j.interval=.08;
 }
 if(a.type==='restoration'){j.damage=second?25000:20000;j.count=second?1:4;j.interval=.5;j.radius=second?1200:2000;}
 if(a.type==='bastion')j.radius=second?1200:2000;
 if(a.type==='resonance')j.radius=1500;
 if(a.type==='sentinel')j.radius=second?2000:3000;
 const jobs=[j];
 if(a.type==='prism'&&second){
  const targets=arsenalTeam(s,true).filter(v=>elementEligible(s,v)&&Math.hypot(v.pos.x-p.x,v.pos.z-p.z)<=6000&&clearLine(s,p.x,p.z,v.pos.x,v.pos.z,p.y,v.pos.y+12)===1).sort((a,b)=>a.id===t.id?-1:b.id===t.id?1:a.id-b.id);
  for(let i=1;i<3;i++){const v=targets[i%Math.max(1,targets.length)]??t;jobs.push({...j,id:++s.architect!.elements.serial,target:v.id,tx:v.pos.x,ty:v.pos.y+12,tz:v.pos.z});}
 }
 for(const x of jobs){
  if(x.beam){const dx=x.tx-x.x,dy=x.ty-x.y,dz=x.tz-x.z,len=Math.hypot(dx,dz)||1,extend=Math.min(6000/len,dy<0?Math.max(1,(x.y-4)/-dy):Infinity);x.tx=x.x+dx*extend;x.ty=x.y+dy*extend;x.tz=x.z+dz*extend;}
  emitElement(s,a,x,'cast');s.architect!.elements.jobs.push(x);
 }
}
function launchBrood(s:Ship,a:ModuleSlot):void{
 const e=s.architect!.elements,p=elementOrigin(s,a),existing=e.drones.filter(d=>d.slot===a.index&&arsenalShip(s,d.id)?.alive);
 for(let i=0;i<2;i++){
  let m=s.game.ships.find(m=>m.id===existing[i]?.id);
  if(!m){m=s.game.addShip(s.game.shipSpec('architectPlatform'),s.team,'Brood drone',p.x+(i?55:-55),p.z,s.heading);m.architectDrone={owner:s,slot:a.index};m.isSummon=true;m.summonOwner=s;m.colossus=false;m.hp=m.maxHp=25000;m.secondaries=[];e.drones.push({id:m.id,slot:a.index,next:s.game.time+.5+i*.25});}
  m.expiresAt=s.game.time+8;m.throttle=2;m.speed=0;m.pos.y=p.y+25;
 }
}
function launchProjectile(s:Ship,a:ModuleSlot,j:ElementJob):void{
 const p=elementOrigin(s,a),target=arsenalShip(s,j.target);
 if(!target)return;
 const torp=a.type==='abyss';
 s.architect!.elements.jobs.push({...j,id:++s.architect!.elements.serial,x:p.x,y:torp?Math.min(0,target.pos.y):p.y,z:p.z,tx:target.pos.x,ty:torp?target.pos.y:target.pos.y+12,tz:target.pos.z,next:0,count:1,elapsed:0,channel:false,projectile:true,speed:torp?300:1500,life:torp?16:6});
}
function resolve(s:Ship,a:ModuleSlot,j:ElementJob):void {
 a={...a,type:j.type,skill:j.variant as 0|1,element:j.element};
 if(j.support){resolveSupport(s,a,j);return;}
 if(!j.projectile&&(a.type==='swarm'||a.type==='abyss'&&j.variant===1)){launchProjectile(s,a,j);return;}
 let targets:Ship[]=[];const k=clearLine(s,j.x,j.z,j.tx,j.tz,j.y,j.ty),tx=j.x+(j.tx-j.x)*k,ty=j.y+(j.ty-j.y)*k,tz=j.z+(j.tz-j.z)*k;
 if(j.beam){targets=arsenalTeam(s,true).filter(t=>{
  if(!t.alive||t.team===s.team||t.submerged)return false;
  const f=segmentHitsHull(t,j.x,j.z,tx,tz,j.beam);if(f<0)return false;
  const height=j.y+(ty-j.y)*f;
  return height>=t.pos.y-t.spec.draft-j.beam&&height<=t.pos.y+t.spec.freeboard+30+j.beam;
 });}
 else if(j.chain){let px=j.tx,pz=j.tz;for(let n=0;n<4;n++){const t=arsenalTeam(s,true).filter(t=>!targets.includes(t)&&elementEligible(s,t)&&Math.hypot(t.pos.x-px,t.pos.z-pz)<=(n?700:200)&&clearLine(s,n?px:j.x,n?pz:j.z,t.pos.x,t.pos.z,n?j.ty:j.y,t.pos.y+12)===1).sort((a,b)=>Math.hypot(a.pos.x-px,a.pos.z-pz)-Math.hypot(b.pos.x-px,b.pos.z-pz)||a.id-b.id)[0];if(!t)break;targets.push(t);px=t.pos.x;pz=t.pos.z;}}
 else if(k===1){targets=arsenalTeam(s,true).filter(t=>t.alive&&t.team!==s.team&&(!t.submerged||j.underwater)&&inElementBlast(t,j.tx,j.ty,j.tz,Math.max(35,j.radius))&&clearLine(s,j.tx,j.tz,t.pos.x,t.pos.z,j.ty,t.pos.y+12)===1);}
 const n=j.element==='cryo'&&j.variant===1&&j.next===1?70000:j.element==='gravity'&&j.variant===0&&j.next===3?72000:j.damage;
 for(const t of targets){if(damage(s,a,t,n,j.attack,j.mark,j.underwater)>0){if(j.slow)slow(t);if(j.pull)pull(s,t,j.tx,j.tz);if(j.chain||j.beam)emitElement(s,a,j,'hit',t);}}
 if(!s.alive||!s.architect)return;
 if(!j.chain)emitElement(s,a,{...j,tx,ty,tz},'hit');
 if(k===1&&j.element==='furnace'&&a.type==='furnace'&&j.variant===1&&j.attack==='skill'&&j.next===0){const patch={...j,id:++s.architect!.elements.serial,x:j.tx,y:j.ty,z:j.tz,elapsed:-1,next:0,count:3,interval:1,damage:12000,radius:450,channel:false};patch.attack='salvo';s.architect!.elements.jobs.push(patch);}
}
export function updateElements(s:Ship,dt:number):void {
 const ar=s.architect;if(!ar)return;const e=ar.elements,now=s.game.time;
 e.marks=e.marks.filter(m=>m.until>=now&&arsenalShip(s,m.target)?.alive);
 e.pulls=e.pulls.filter(p=>p.until>now);
 for(const p of e.pulls){const t=arsenalShip(s,p.target);if(!t?.alive||t.mods.knockImmune||t.mods.ccImmune||t.mods.invulnerable)continue;const dx=p.x-t.pos.x,dz=p.z-t.pos.z,d=Math.hypot(dx,dz);if(d>1){const v=Math.min(60,d*2);const mag=Math.hypot(t.pushX,t.pushZ);if(mag<=60){t.pushX=dx/d*v;t.pushZ=dz/d*v;}}}
 for(const a of ar.slots){
  if(a.type==='vector'){a.opening=false;continue;}
  const rate=architectSkillRechargeRate(s,a);if(!rate)continue;
  a.skillTimer=Math.max(0,a.skillTimer-dt*rate);a.castGap=Math.max(0,a.castGap-dt);
  const m=a.entity!;if(a.castGap>0||s.mods.stunned||s.mods.disarmed||s.mods.silenced||m.mods.stunned||m.mods.disarmed||m.mods.silenced||a.disabled>0)continue;
  if(a.skillTimer>0&&!a.opening)continue;
  const support=['sentinel','restoration','bastion','resonance'].includes(a.type);
  const target=support?supportTarget(s,a):elementTarget(s,a);
  if(a.opening){const gunTarget=elementTarget(s,a);if(gunTarget&&!gunTarget.submerged){fireElementSalvo(s,a,gunTarget.pos.x,gunTarget.pos.z,gunTarget.pos.y+4,30000);a.opening=false;}}
  if(!target||a.skillTimer>0||e.jobs.some(j=>j.slot===a.index&&j.channel))continue;
  startElementAttack(s,a,target,'skill');a.skillTimer=ARCHETYPES[a.type].skills[a.skill].cooldown;a.castGap=.35;
 }
 for(const d of e.drones){
  const m=arsenalShip(s,d.id),a=ar.slots[d.slot];if(!m?.alive)continue;
  if(!a.entity?.alive||!['deployed','citadel'].includes(a.state)){m.withdraw();continue;}
  const p=elementOrigin(s,a);m.pos.set(p.x+Math.sin(d.id*2+s.game.time)*65,p.y+25,p.z+Math.cos(d.id*2+s.game.time)*65);
  if(now>=d.next){d.next=now+1;const t=elementTarget(s,a);if(t&&!s.mods.stunned&&!s.mods.disarmed&&!s.mods.silenced&&!m.mods.stunned&&!m.mods.disarmed){const j=job(s,a,'salvo',m.pos,t.pos,6000,0);j.channel=false;j.target=t.id;j.projectile=true;j.speed=1800;j.life=5;j.support=false;e.jobs.push(j);emitElement(s,a,j,'cast');}}
 }
 e.drones=e.drones.filter(d=>arsenalShip(s,d.id)?.alive);
 const jobs=e.jobs.slice();for(const j of jobs){
  const a=ar.slots[j.slot];
  if(j.channel&&(a.state==='destroyed'||!['deployed','citadel'].includes(a.state)||ar.ultimate?.kind==='assembly'||a.disabled>0||s.mods.stunned||s.mods.disarmed||s.mods.silenced||a.entity?.mods.stunned||a.entity?.mods.disarmed||a.entity?.mods.silenced)){j.next=j.count;continue;}
  if(j.projectile){
   j.life-=dt;const t=arsenalShip(s,j.target);
   if(t&&canTrack(s,t)&&(!t.submerged||j.underwater)){j.tx=t.pos.x;j.ty=t.pos.y+(j.underwater?0:12);j.tz=t.pos.z;}
   const dx=j.tx-j.x,dy=j.ty-j.y,dz=j.tz-j.z,len=Math.hypot(dx,dy,dz),k=Math.min(1,j.speed*dt/Math.max(1,len));
   const nx=j.x+dx*k,ny=j.y+dy*k,nz=j.z+dz*k;
   if(clearLine(s,j.x,j.z,nx,nz,j.y,ny)<1){j.next=j.count;continue;}
   j.x=nx;j.y=ny;j.z=nz;
   if(k>=1){resolve(s,a,j);j.next=j.count;}else if(j.life<=0)j.next=j.count;
   continue;
  }
  j.elapsed+=dt;while(j.next<j.count&&j.elapsed+1e-8>=j.next*j.interval){resolve(s,a,j);j.next++;if(!s.alive)break;}
 }
 e.jobs=e.jobs.filter(j=>j.next<j.count);
}
export function fireElementSalvo(s:Ship,a:ModuleSlot,x:number,z:number,y=4,amount=30000):void {
 const p=elementOrigin(s,a),shell={...s.spec.main!.ap!,damage:amount};
 for(const offset of [-3,3]){s.game.shells.fire(s,{ammo:'AP',spec:shell,table:s.tableFor('AP')!,fromX:p.x+offset,fromY:p.y,fromZ:p.z,toX:x,toZ:z,toY:y,dmgMul:s.mods.damageMul,guaranteedFire:false,railgun:false,flat:3,look:'rail',skill:s.skills[1].spec,element:{owner:s,slot:a.index,splash:150}});}
 s.stats.shotsFired+=2;const j=job(s,a,'salvo',p,{x,y,z},amount);emitElement(s,a,j,'cast');
}
/** One stored bolt, separate from ordinary turret cycles and selected automatic skills. */
export function fireCapacitorBolt(s:Ship,a:ModuleSlot,t:Ship):boolean{
 const table=s.tableFor('AP'),base=s.spec.main?.ap;if(!table||!base)return false;
 const p=elementOrigin(s,a),shell={...base,damage:18000};
 s.game.shells.fire(s,{ammo:'AP',spec:shell,table,fromX:p.x,fromY:p.y,fromZ:p.z,toX:t.pos.x,toZ:t.pos.z,toY:t.pos.y+12,dmgMul:s.mods.damageMul,guaranteedFire:false,railgun:false,flat:3,look:'rail',skill:spec(s,a,'salvo'),element:{owner:s,slot:a.index,kind:a.element}});
 s.stats.shotsFired++;emitElement(s,a,job(s,a,'salvo',p,t.pos,18000),'cast',t);return true;
}
export function elementalShellHit(s:Ship,index:number,t:Ship,splash=0,damageAmount=0,impact={x:t.pos.x,y:t.pos.y+12,z:t.pos.z},kind?:ArchitectElement):void {
 const slot=s.architect?.slots[index];if(!slot||!s.alive)return;const a=kind?{...slot,element:kind}:slot;applyElementMark(s,a,t);
 if(splash)for(const v of s.game.ships)if(v!==t&&v.alive&&v.team!==s.team&&!v.submerged&&inElementBlast(v,impact.x,impact.y,impact.z,splash)&&clearLine(s,impact.x,impact.z,v.pos.x,v.pos.z,impact.y,v.pos.y+12)===1)damage(s,a,v,damageAmount,'salvo');
}
/** Ultimate supplementary hits have a cast-local victim cap supplied by the caller. */
export function ultimateElementHit(s:Ship,a:ModuleSlot,t:Ship,attack:'assembly'|'killbox',n=12000):void {damage(s,a,t,n,attack);const j=job(s,a,attack,elementOrigin(s,a),t.pos,n,attack==='assembly'?200:1000);emitElement(s,a,j,'hit');}
