import { expect,it } from 'vitest';
import { ARCHETYPES, defaultLoadout, validLoadout, loadoutPreset } from '../src/data/architectLoadout';
import { emptyGame,place } from './helpers';
it('offers eleven types with two skills and validates exactly ten selections',()=>{
 expect(Object.keys(ARCHETYPES)).toHaveLength(11);
 for(const t of Object.values(ARCHETYPES))expect(t.skills).toHaveLength(2);
 const a=defaultLoadout();expect(validLoadout(a)).toBe(true);expect(validLoadout(a.slice(1))).toBe(false);
 expect(validLoadout(a.map(x=>({...x,skill:2})))).toBe(false);expect(validLoadout(a.map(x=>({...x,type:'__proto__'})))).toBe(false);
 expect(new Set(loadoutPreset('unique','resonance').map(x=>x.type)).size).toBe(10);
 expect(defaultLoadout()).not.toBe(a);
});
it('initializes a single selected skill and preserves it across destruction and respawn',()=>{
 const g=emptyGame('open',713,'freeplay'),s=place(g,'architect',0,0,2000);
 expect(s.architect!.slots[0].type).toBe('furnace');expect(s.architect!.slots[0].skill).toBe(0);
 expect('miniTimer' in s.architect!.slots[0]).toBe(false);
});
import {navalRules} from '../server/rules';
import {DEFAULT_SETTINGS} from '../src/net/protocol';
it('rejects malformed JSON types without coercion or throwing in lobby and refits',()=>{
 for(const type of [{toString:null},['furnace'],null,42,true]){
  const pick={type,skill:0};expect(()=>validLoadout(Array.from({length:10},()=>pick))).not.toThrow();expect(validLoadout(Array.from({length:10},()=>pick))).toBe(false);
  expect(()=>navalRules.cleanEdge({ar:{index:0,pick}},{...DEFAULT_SETTINGS,type:'freeplay'})).not.toThrow();expect(navalRules.cleanEdge({ar:{index:0,pick}},{...DEFAULT_SETTINGS,type:'freeplay'})).toBeNull();
 }
});
