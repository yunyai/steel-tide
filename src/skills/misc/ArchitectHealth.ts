import type { Ship } from '../../ships/Ship';
import type { ModuleSlot } from './ArchitectRuntime';

/** Hull HP includes every aboard module. Undocked capacity and surviving HP travel with the module. */
export function ensureArchitectHealth(s:Ship):void {
  const a=s.architect;if(!a)return;
  if(!a.healthReady){
    a.fullHp=s.maxHp;a.moduleHp=a.fullHp/30;
    const ratio=Math.max(0,Math.min(1,s.hp/s.maxHp));
    for(const slot of a.slots)slot.hp=a.moduleHp*ratio;
    a.healthReady=true;return;
  }
  const expected=a.fullHp-a.slots.filter(slot=>!slot.aboard).length*a.moduleHp;
  if(Math.abs(s.maxHp-expected)>.01){
    // Refits, Titan Shift ratios and scripted bosses can scale the entire hull.
    const ratio=s.maxHp/Math.max(1,expected);a.fullHp*=ratio;a.moduleHp*=ratio;
    for(const slot of a.slots){slot.hp*=ratio;if(slot.entity){slot.entity.maxHp=a.moduleHp;slot.entity.hp*=ratio;}}
  }
}
export function detachArchitectHealth(s:Ship,slot:ModuleSlot):void {
  ensureArchitectHealth(s);if(!slot.aboard)return;
  const a=s.architect!;a.healthTransfer=true;
  try{slot.aboard=false;s.hp=Math.max(0,s.hp-slot.hp);s.maxHp-=a.moduleHp;}finally{a.healthTransfer=false;}
}
export function returnArchitectHealth(s:Ship,slot:ModuleSlot):void {
  if(slot.aboard)return;
  const a=s.architect!;a.healthTransfer=true;
  try{slot.aboard=true;s.maxHp+=a.moduleHp;s.hp=Math.min(s.maxHp,s.hp+slot.hp);}finally{a.healthTransfer=false;}
}
export function rebuildArchitectHealth(s:Ship,slot:ModuleSlot):void {
  const a=s.architect!;
  const resident=a.slots.filter(v=>v!==slot&&v.aboard).reduce((n,v)=>n+v.hp,0);
  const core=Math.max(0,s.hp-resident),coreCapacity=a.fullHp-a.moduleHp*10;
  // Allocate a fair share of the surviving core to the rebuilt turret; no HP is added.
  slot.hp=Math.min(a.moduleHp,core*a.moduleHp/(coreCapacity+a.moduleHp));
  slot.aboard=true;s.maxHp+=a.moduleHp;
}
export function damageArchitectHealth(s:Ship,damage:number):void {
  ensureArchitectHealth(s);if(!s.architect||damage<=0)return;
  const ratio=Math.max(0,1-damage/Math.max(1,s.hp));
  for(const slot of s.architect.slots)if(slot.aboard)slot.hp*=ratio;
}
export function healArchitectHealth(s:Ship,healed:number):void {
  const a=s.architect;if(!a||healed<=0)return;
  const docked=a.slots.filter(slot=>slot.aboard),missing=docked.reduce((n,v)=>n+Math.max(0,a.moduleHp-v.hp),0);
  const budget=Math.min(healed,missing);
  if(missing>0)for(const slot of docked)slot.hp=Math.min(a.moduleHp,slot.hp+budget*Math.max(0,a.moduleHp-slot.hp)/missing);
}

/** Complete surviving pool for hull transformations; detached health is not lost or duplicated. */
export function architectPool(s:Ship):{hp:number;maxHp:number}{
  ensureArchitectHealth(s);const a=s.architect;
  if(!a)return {hp:s.hp,maxHp:s.maxHp};
  return {hp:s.hp+a.slots.reduce((n,slot)=>n+(!slot.aboard&&slot.entity?.alive?slot.entity.hp:0),0),maxHp:a.fullHp};
}
