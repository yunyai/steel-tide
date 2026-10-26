import type { Ship } from '../../ships/Ship';
import type { ModuleSlot } from './ArchitectRuntime';

/** A platform carries twice its hull-equivalent HP while outside the ship. */
export const PLATFORM_HEALTH_RATIO = 2;
export const ARCHITECT_FULL_HP = 2500000;
export const MODULE_COMBAT_HP = 200000;
export function moduleHullHp(s:Ship):number { return s.architect!.moduleHp / PLATFORM_HEALTH_RATIO; }

/** Hull HP includes every aboard module. Undocked capacity and surviving HP travel with the module. */
export function ensureArchitectHealth(s:Ship):void {
  const a=s.architect;if(!a)return;
  if(!a.healthReady){
    a.fullHp=s.maxHp;a.moduleHp=a.fullHp*MODULE_COMBAT_HP/ARCHITECT_FULL_HP;
    const ratio=Math.max(0,Math.min(1,s.hp/s.maxHp));
    for(const slot of a.slots)slot.hp=a.moduleHp*ratio;
    a.healthReady=true;return;
  }
  const expected=a.fullHp-a.slots.filter(slot=>!slot.aboard).length*moduleHullHp(s);
  if(Math.abs(s.maxHp-expected)>.01){
    // Refits, Titan Shift ratios and scripted bosses can scale the entire hull.
    const ratio=s.maxHp/Math.max(1,expected);a.fullHp*=ratio;a.moduleHp*=ratio;
    for(const slot of a.slots){slot.hp*=ratio;if(slot.entity){slot.entity.maxHp=a.moduleHp;slot.entity.hp*=ratio;}}
    // Capacity can change before hull HP. Embedded modules cannot borrow nonexistent core HP.
    const resident=a.slots.filter(slot=>slot.aboard),total=resident.reduce((n,slot)=>n+slot.hp,0);
    const available=Math.max(0,s.hp)*PLATFORM_HEALTH_RATIO;
    if(total>available)for(const slot of resident)slot.hp*=available/total;
  }
}
export function detachArchitectHealth(s:Ship,slot:ModuleSlot):void {
  ensureArchitectHealth(s);if(!slot.aboard)return;
  const a=s.architect!;a.healthTransfer=true;
  try{slot.aboard=false;s.hp=Math.max(0,s.hp-slot.hp/PLATFORM_HEALTH_RATIO);s.maxHp-=moduleHullHp(s);}finally{a.healthTransfer=false;}
}
export function returnArchitectHealth(s:Ship,slot:ModuleSlot):void {
  if(slot.aboard)return;
  const a=s.architect!;a.healthTransfer=true;
  try{slot.aboard=true;s.maxHp+=moduleHullHp(s);s.hp=Math.min(s.maxHp,s.hp+slot.hp/PLATFORM_HEALTH_RATIO);}finally{a.healthTransfer=false;}
}
export function rebuildArchitectHealth(s:Ship,slot:ModuleSlot):void {
  const a=s.architect!;
  const resident=a.slots.filter(v=>v!==slot&&v.aboard).reduce((n,v)=>n+v.hp/PLATFORM_HEALTH_RATIO,0);
  const core=Math.max(0,s.hp-resident),share=moduleHullHp(s),coreCapacity=a.fullHp-share*10;
  // Allocate a fair share of the surviving core to the rebuilt turret; no HP is added.
  slot.hp=Math.min(a.moduleHp,core*share/(coreCapacity+share)*PLATFORM_HEALTH_RATIO);
  slot.aboard=true;s.maxHp+=moduleHullHp(s);
}
export function damageArchitectHealth(s:Ship,damage:number):void {
  ensureArchitectHealth(s);if(!s.architect||damage<=0)return;
  const ratio=Math.max(0,1-damage/Math.max(1,s.hp));
  for(const slot of s.architect.slots)if(slot.aboard)slot.hp*=ratio;
}
export function healArchitectHealth(s:Ship,healed:number):void {
  const a=s.architect;if(!a||healed<=0)return;
  const docked=a.slots.filter(slot=>slot.aboard),missing=docked.reduce((n,v)=>n+Math.max(0,a.moduleHp-v.hp),0);
  // Repair each resident deficit by the same fraction as the hull deficit. This includes
  // the core, so refit scaling cannot allocate the same incoming HP to components twice.
  const hullMissing=Math.max(0,s.maxHp-s.hp);
  const budget=hullMissing>0?missing*Math.min(1,healed/hullMissing):0;
  if(missing>0)for(const slot of docked)slot.hp=Math.min(a.moduleHp,slot.hp+budget*Math.max(0,a.moduleHp-slot.hp)/missing);
}

/** Complete surviving pool for hull transformations; detached health is not lost or duplicated. */
export function architectPool(s:Ship):{hp:number;maxHp:number}{
  ensureArchitectHealth(s);const a=s.architect;
  if(!a)return {hp:s.hp,maxHp:s.maxHp};
  return {hp:s.hp+a.slots.reduce((n,slot)=>n+(!slot.aboard&&slot.entity?.alive?slot.entity.hp/PLATFORM_HEALTH_RATIO:0),0),maxHp:a.fullHp};
}
