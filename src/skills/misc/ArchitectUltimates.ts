import { ARCHITECT_BATTERY_FLIGHT, type ArchitectBatteryCast, type ArchitectBatteryStage } from '../../data/architectBattery';
import { planArchitectBatteryLayout, buildArchitectBatteryPaths, planArchitectBatteryFormation, BATTERY_TRANSPORT_TIME, BATTERY_FOLD_TIME } from './ArchitectBatteryPose';
import { applyElementMark, ultimateElementHit } from './ArchitectElements';
import type { Ship } from '../../ships/Ship';
import { MAP_HALF } from '../../config';
import { bearingTo } from '../../core/math';
import { distToHull, segmentHitsHull } from '../../core/hull';
import { hurt, buff } from '../kit';
import { available, archAim, attachModule, clearLine, dockPoint, moduleLanding, moveModule, raiseShield, updateModulePath } from './ArchitectRuntime';

export type ArchitectUltimateKind='assembly'|'killbox'|'citadel';
export interface ArchitectUltimate {
  battery:ArchitectBatteryCast|null;
  kind:ArchitectUltimateKind;elapsed:number;members:number[];x:number;z:number;
  aimX:number;aimY:number;aimZ:number;locked:boolean;waves:number;fired:boolean;granted:number[];
}
const indexOf=(kind:ArchitectUltimateKind)=>kind==='assembly'?6:kind==='killbox'?7:8;
export function beginArchitectUltimate(s:Ship,kind:ArchitectUltimateKind):boolean {
  const a=s.architect!,slots=available(s);
  if(slots.length<2)return s.failSkill('Assembly requires at least two surviving modules');
  const p=archAim(s);
  const poses=kind==='killbox'?planArchitectBatteryFormation(p,slots.length,(x,z)=>s.game.map.heightAt(x,z)):null;
  const battery:ArchitectBatteryCast|null=kind==='killbox'?{
    id:s.game.battery.beginCast(s),generation:s.game.battery.generation(s),startedAt:s.game.time,
    members:slots.map((slot,n)=>{const q=poses![n],carrier={x:q.x,y:q.y,z:q.z,heading:q.heading};return {slot:slot.index,carrier,layout:planArchitectBatteryLayout(carrier,{x:p.x,y:4,z:p.z},(x,z)=>s.game.map.heightAt(x,z))};}),
  }:null;
  a.ultimate={battery,kind,elapsed:0,members:slots.map(a=>a.index),x:p.x,z:p.z,aimX:s.control.aimX,aimY:s.control.aimY??4,aimZ:s.control.aimZ,locked:false,waves:0,fired:false,granted:[]};
  slots.forEach((slot,n)=>{
    const q=kind==='assembly'?dockPoint(s,slot.index):kind==='killbox'?poses![n]:airPosition(s,n,slots.length,slot.index);
    moveModule(s,slot,q,'assembling',kind==='killbox'?BATTERY_TRANSPORT_TIME:1.5);
  });
  s.game.events.emit('architectCommand',{ship:s,kind});return true;
}
function airPosition(s:Ship,n:number,count:number,skip:number):{x:number;y:number;z:number;heading:number} {
  const angle=n*Math.PI*2/count+Math.max(0,(s.architect?.ultimate?.elapsed??1.5)-1.5)*.12,lim=MAP_HALF-100;
  const taken=s.architect!.slots.filter(a=>a.index!==skip&&a.entity&&a.state==='citadel').map(a=>a.entity!.pos);
  let x=s.pos.x,z=s.pos.z;
  search:for(const r of [650,500,800,950])for(let j=0;j<36;j++){
    const off=j===0?0:Math.ceil(j/2)*.08*(j%2?1:-1),a=angle+off;
    const px=Math.max(-lim,Math.min(lim,s.pos.x+Math.sin(a)*r)),pz=Math.max(-lim,Math.min(lim,s.pos.z-Math.cos(a)*r));
    if(taken.some(p=>Math.hypot(p.x-px,p.z-pz)<100))continue;
    x=px;z=pz;break search;
  }
  let y=150;
  for(let i=0;i<32;i++){
    const a=i*Math.PI/16,px=Math.max(-lim,Math.min(lim,s.pos.x+Math.sin(a)*650)),pz=Math.max(-lim,Math.min(lim,s.pos.z-Math.cos(a)*650));
    y=Math.max(y,s.game.map.heightAt(px,pz)+100);
  }
  y=Math.max(y,s.game.map.heightAt(x,z)+100);
  return {x,y,z,heading:bearingTo(x,z,s.pos.x,s.pos.z)};
}
/** Piercing rays are spatial attacks: normal defenses apply, with explicit height and obstacle checks. */
function rail(s:Ship,x:number,y:number,z:number,tx:number,ty:number,tz:number,width:number,damage:number,index:number,kind:'assembly'|'killbox',slot?:number):Ship[] {
  const hits:Ship[]=[];
  const k=clearLine(s,x,z,tx,tz,y,ty);tx=x+(tx-x)*k;tz=z+(tz-z)*k;ty=y+(ty-y)*k;
  const dx=tx-x,dz=tz-z,d2=dx*dx+dz*dz;
  for(const t of s.game.ships){
    if(!s.alive)break;
    if(!t.alive||t.team===s.team||t.deep)continue;
    const f=Math.max(0,Math.min(1,((t.pos.x-x)*dx+(t.pos.z-z)*dz)/Math.max(1,d2))),height=y+(ty-y)*f;
    if(height<t.pos.y-t.spec.draft-width/2||height>t.pos.y+t.spec.freeboard+30+width/2)continue;
    if(segmentHitsHull(t,x,z,tx,tz,width/2)>=0){hits.push(t);const dealt=hurt(s,t,damage,s.skills[index].spec);if(dealt>0&&slot!==undefined)applyElementMark(s,s.architect!.slots[slot],t);}
  }
  s.game.events.emit('architectShot',{ship:s,x,y,z,tx,ty,tz,width,kind,slot});return hits;
}
export function updateArchitectUltimate(s:Ship,dt:number):void {
  const a=s.architect,u=a?.ultimate;if(!a||!u)return;
  u.elapsed+=dt;
  // Nothing left to command: stand down early and keep the unused charge.
  if(u.members.every(i=>a.slots[i].state==='destroyed')){endArchitectUltimate(s);return;}
  if(u.elapsed<=1.5+1e-8)for(const i of u.members){const slot=a.slots[i];if(slot.entity?.alive)updateModulePath(s,slot,dt);}
  if(u.elapsed+1e-8>=1.5){
    for(const i of u.members){
      const slot=a.slots[i];if(slot.state!=='assembling')continue;
      if(u.kind==='assembly'){
        if(slot.entity?.alive)attachModule(s,slot);
        slot.state='assembling';slot.path=null;s.turrets[i].disabled=Infinity;
      }else if(slot.entity?.alive){if(slot.path)slot.entity.pos.set(slot.path.tx,slot.path.ty,slot.path.tz);slot.state=u.kind==='citadel'?'citadel':'deployed';if(u.kind==='citadel')slot.skillTimer=0;slot.path=null;if(u.kind==='killbox'&&slot.entity)slot.entity.turrets[0].reload=slot.index*.09;}
    }
  }
  if(u.kind==='assembly'){
    if(!u.locked){u.aimX=s.control.aimX;u.aimZ=s.control.aimZ;u.aimY=s.control.aimY??4;if(u.elapsed+1e-8>=3.1)u.locked=true;}
    if(u.elapsed+1e-8>=3.5&&!u.fired){
      u.fired=true;
      const count=u.members.filter(i=>a.slots[i].state!=='destroyed').length;
      const dx=u.aimX-s.pos.x,dz=u.aimZ-s.pos.z,len=Math.hypot(dx,dz)||1;
      if(count){
        const hits=rail(s,s.pos.x,s.pos.y+24,s.pos.z,s.pos.x+dx/len*6000,u.aimY,s.pos.z+dz/len*6000,180,count*120000,6,'assembly');
        for(const i of u.members){const slot=a.slots[i];if(slot.state==='destroyed')continue;
          const victims=new Set<Ship>();
          for(const hit of hits)for(const t of s.game.ships)if(t.alive&&t.team!==s.team&&!t.submerged&&distToHull(t,hit.pos.x,hit.pos.z)<=200&&Math.abs(t.pos.y-hit.pos.y)<120&&clearLine(s,hit.pos.x,hit.pos.z,t.pos.x,t.pos.z,hit.pos.y+12,t.pos.y+12)===1)victims.add(t);
          for(const t of victims)ultimateElementHit(s,slot,t,'assembly');
        }
      }
    }
    if(u.elapsed+1e-8>=4)endArchitectUltimate(s);
  }else if(u.kind==='killbox'){
    if(u.elapsed+1e-8>=1.5){
      for(const t of s.game.ships)if(t.alive&&t.team!==s.team&&!t.submerged&&!t.mods.ccImmune&&distToHull(t,u.x,u.z)<=1500)buff(t,'debuff:grandBattery',.1,m=>m.speedMul=Math.min(m.speedMul,.8));
      // Each scheduled module stage is consumed once, even when that module was destroyed.
      const count=u.members.length;
      while(u.waves<count*4){
        const stage=Math.floor(u.waves/count),n=u.waves%count;
        const at=1.5+(stage===3?6:stage*2+n/Math.max(1,count-1)*.6);
        if(u.elapsed+1e-8<at)break;
        const slot=a.slots[u.members[n]],m=slot.entity;u.waves++;
        if(!m?.alive||slot.state!=='deployed')continue;
        const cast=u.battery!,member=cast.members.find(v=>v.slot===slot.index)!;
        const center={x:u.x,y:4,z:u.z},launchTime=cast.startedAt+at;
        s.game.battery.launch({owner:s,generation:cast.generation,castId:cast.id,slot:slot.index,stage:stage as ArchitectBatteryStage,
          launchTime,arrivalTime:launchTime+ARCHITECT_BATTERY_FLIGHT,type:slot.type,element:slot.element,skill:slot.skill,
          center,radius:1500,baseDamage:stage===3?90000:50000,damageMultiplier:s.mods.damageMul*s.mods.ultDamageMul,
          layout:member.layout,carrier:member.carrier,
          paths:buildArchitectBatteryPaths({carrier:member.carrier,center,radius:1500,slot:slot.index,stage:stage as ArchitectBatteryStage,type:slot.type,layout:member.layout,groundHeight:(x,z)=>s.game.map.heightAt(x,z)}),
        });
        m.turrets[0].recoil=1;
      }
    }
    if(u.elapsed+1e-8>=7.5)endArchitectUltimate(s);
  }else{
    if(u.elapsed+1e-8>=1.5){
      // Read all slots before moving them so positions don't depend on incidental traversal order.
      for(let n=0;n<u.members.length;n++){
        const slot=a.slots[u.members[n]],m=slot.entity;if(!m?.alive||slot.state!=='citadel')continue;
        const p=airPosition(s,n,u.members.length,slot.index);m.pos.set(p.x,p.y,p.z);m.heading=p.heading;
        if(!u.granted.includes(m.id)){raiseShield(m,150000,12);u.granted.push(m.id);}
      }
      const count=u.members.filter(i=>a.slots[i].state==='citadel'&&a.slots[i].entity?.alive).length;
      if(count>=1)for(const t of s.game.ships){
        if(!t.alive||t.team!==s.team||Math.hypot(t.pos.x-s.pos.x,t.pos.z-s.pos.z)>900)continue;
        const dr=Math.min(.6,.3+count*.03);
        buff(t,`architectCitadel:${s.id}`,.05,m=>{m.citadelDR=Math.max(m.citadelDR,dr);});
        if(!u.granted.includes(t.id)){
          raiseShield(t,t===s?500000:150000,12);u.granted.push(t.id);
        }
      }
    }
    if(u.elapsed+1e-8>=13.5)endArchitectUltimate(s);
  }
}
export function endArchitectUltimate(s:Ship,recalling=false):void {
  const a=s.architect,u=a?.ultimate;if(!a||!u)return;
  a.ultimate=null;
  const reservations:ReturnType<typeof moduleLanding>[]=[];
  for(const i of u.members){
    const slot=a.slots[i];if(slot.state==='destroyed')continue;
    if(recalling)continue;
    if(u.kind==='assembly'){
      if(slot.entity?.alive)attachModule(s,slot);
      slot.state='docked';slot.path=null;s.turrets[i].disabled=slot.disabled;s.turrets[i].reload=slot.reload;
    }else if(u.kind==='citadel'&&slot.entity?.alive){
      const m=slot.entity,p=moduleLanding(s,slot,m.pos.x,m.pos.z,m.heading,reservations.filter((p):p is NonNullable<typeof p>=>!!p),1000);
      if(p){reservations.push(p);moveModule(s,slot,p,'moving',1);}
      else moveModule(s,slot,dockPoint(s,i),'returning');
    }else if(slot.entity?.alive){
      const m=slot.entity,p=moduleLanding(s,slot,m.pos.x,m.pos.z,m.heading,reservations.filter((p):p is NonNullable<typeof p>=>!!p),1000);
      if(p){reservations.push(p);const still=Math.hypot(p.x-m.pos.x,p.z-m.pos.z)<1&&m.pos.y<=1;moveModule(s,slot,p,'moving',BATTERY_FOLD_TIME+(still?0:1));}
      else {const dock=dockPoint(s,i);moveModule(s,slot,dock,'returning',BATTERY_FOLD_TIME+Math.max(1,Math.hypot(dock.x-m.pos.x,dock.z-m.pos.z)/1200));}
      if(slot.path)slot.path.settling=true;
    }
  }
  const st=s.skills[indexOf(u.kind)];
  // Ending early (Recall, or every platform lost) refunds the meter for the time left; a sunk Architect keeps nothing.
  if(st&&s.alive&&st.spec.duration>0)st.meter=Math.max(st.meter,Math.max(0,Math.min(1,st.time/st.spec.duration)));
  if(st){st.time=0;if(st.active){st.active=false;s.game.events.emit('skillEnd',{ship:s,index:st.index});}}
  s.game.events.emit('architectCommand',{ship:s,kind:'end'});
}
