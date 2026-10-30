import { ARCHETYPES } from '../data/architectLoadout';
import type { Ship } from '../ships/Ship';
import { architectSkillRechargeRate } from '../skills/misc/ArchitectElements';
import { vectorMobilityPresentation } from './VectorMobilityPresentation';

export interface ArchitectSkillTiming {
  activeRemaining:number;
  activeTotal:number;
  cooldownRemaining:number;
  phase:string;
  members?:number;
}
/** All timers use authoritative simulation time. Presentation never changes activation locks. */
export function architectSkillPresentation(ship:Ship,index:number):ArchitectSkillTiming {
  const state=ship.skills[index],a=ship.architect,now=ship.game.time;
  const base:ArchitectSkillTiming={activeRemaining:0,activeTotal:0,cooldownRemaining:Math.max(0,state?.cooldown??0),phase:state?.cooldown>0?'Cooldown':'Ready'};
  if (!ship.alive||!a||!state) return {...base,phase:'Unavailable'};
  const id=state.spec.id;
  const timed=id==='architectBurst'?[a.huntUntil,10,'Hunt'] as const:id==='architectConnect'?[a.linkUntil,10,'Connect'] as const:id==='architectFortify'?[Number(state.data.activeUntil)||0,8,'Fortify'] as const:null;
  if (timed) {
    base.activeTotal=timed[1];base.activeRemaining=Math.max(0,Math.min(timed[1],timed[0]-now));
    if (base.activeRemaining>0) base.phase=timed[2];
    return base;
  }
  const u=a.ultimate;
  if (!u||index!==(u.kind==='assembly'?6:u.kind==='killbox'?7:8)) return base;
  base.members=u.members.filter(i=>a.slots[i].state!=='destroyed').length;
  if (u.kind==='assembly') {
    base.activeTotal=4;base.activeRemaining=Math.max(0,4-u.elapsed);
    base.phase=u.elapsed<1.5?'Assembling':u.elapsed<3.1?'Charging':u.elapsed<3.5?'Aim locked':u.elapsed<3.7?'Firing':'Recovery';
  } else if (u.kind==='killbox') {
    const gathering=u.elapsed<1.5;
    base.activeTotal=7.5;base.activeRemaining=Math.max(0,7.5-u.elapsed);
    base.phase=gathering?'Gathering':'Bombardment';
  } else {
    const ascending=u.elapsed<1.5;
    base.activeTotal=13.5;base.activeRemaining=Math.max(0,13.5-u.elapsed);
    base.phase=ascending?'Ascending':'Airborne';
  }
  return base;
}

export interface ArchitectModuleSkillTiming {
  name:string;color:string;remainingWork:number;progress:number;eta:number|null;
  phase:'ready'|'recharging'|'paused'|'disabled';label:string;
}
export function architectModuleSkillPresentation(ship:Ship,index:number):ArchitectModuleSkillTiming {
  const slot=ship.architect!.slots[index],type=ARCHETYPES[slot.type],skill=type.skills[slot.skill];
  if(slot.type==='vector'){
    const status=ship.getVectorMobilityStatus()!,action=slot.skill===0?status.hullDash:status.mobileBattery,presentation=vectorMobilityPresentation(status),view=slot.skill===0?presentation.dash:presentation.mobile;
    const remainingWork='rechargeRemaining' in action?action.rechargeRemaining:action.cooldownRemaining;
    const destroyed=slot.state==='destroyed'||(slot.entity?.hp??slot.hp)<=0;
    const disabled=destroyed||view.tone==='blocked';
    const phase=disabled?'disabled':view.ready?'ready':'recharging';
    const detail=destroyed?'Platform destroyed':`${view.count?`${view.count} · `:''}${view.detail}`;
    return {name:skill.name,color:`#${type.color.toString(16).padStart(6,'0')}`,remainingWork,progress:Math.max(0,Math.min(1,view.progress)),eta:remainingWork,phase,label:`${skill.name}: manual ${slot.skill===0?'Hull Dash':'Mobile Battery'} · ${detail}`};
  }
  const remainingWork=Math.max(0,slot.skillTimer),rate=architectSkillRechargeRate(ship,slot),eta=rate>0?remainingWork/rate:null;
  const m=slot.entity,disabled=slot.disabled>0||ship.mods.stunned||ship.mods.disarmed||ship.mods.silenced||!!(m?.mods.stunned||m?.mods.disarmed||m?.mods.silenced);
  const phase=disabled?'disabled':rate<=0?'paused':remainingWork>0?'recharging':'ready';
  const detail=phase==='disabled'?`Disabled${eta&&remainingWork>0?` · recharge ${eta.toFixed(1)}s`:''}`:phase==='paused'?`Paused · ${slot.state}`:phase==='ready'?'Ready':`${eta!.toFixed(1)}s`;
  return {name:skill.name,color:`#${type.color.toString(16).padStart(6,'0')}`,remainingWork,progress:Math.max(0,Math.min(1,1-remainingWork/skill.cooldown)),eta,phase,label:`${skill.name}: ${detail}`};
}

/** A launched Battery round can still be incoming after command control has ended. */
export function architectIncomingBattery(ship:Ship):{count:number;remaining:number}|null {
  const view=ship.game as typeof ship.game & {battery?:{pending:readonly {owner:Ship;arrivalTime:number}[]}};
  const pending=view.battery?.pending.filter(p=>p.owner===ship&&p.arrivalTime>ship.game.time)??[];
  return pending.length?{count:pending.length,remaining:Math.max(...pending.map(p=>p.arrivalTime))-ship.game.time}:null;
}
