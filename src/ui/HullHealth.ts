import type { Ship } from '../ships/Ship';

/** Presentation units: the hull bar reserves capacity; platform bars use combat HP. */
export function hullHealthDisplay(s:Ship):{maximum:number;reserved:number;platformHp:number;platformMaxHp:number} {
  const a=s.architect,maximum=a?.healthReady?a.fullHp:s.maxHp;
  let platformHp=0,platformMaxHp=0;
  for(const slot of a?.slots??[])if(!slot.aboard&&slot.entity?.alive){
    platformHp+=slot.entity.hp;platformMaxHp+=slot.entity.maxHp;
  }
  return {maximum,reserved:Math.max(0,maximum-s.maxHp),platformHp,platformMaxHp};
}
