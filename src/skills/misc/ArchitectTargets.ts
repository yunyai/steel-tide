import type { Game } from '../../core/Game';
import type { Ship } from '../../ships/Ship';
/** Derived, per-tick indexes. Never store target eligibility: effects may change during the tick. */
const cache=new WeakMap<Game,{time:number;count:number;teams:[Ship[],Ship[]];ids:Map<number,Ship>}>();
function index(game:Game){
 let c=cache.get(game);
 if(!c||c.time!==game.time||c.count!==game.ships.length){
  c={time:game.time,count:game.ships.length,teams:[[],[]],ids:new Map()};
  for(const s of game.ships){c.ids.set(s.id,s);if(s.alive&&!s.withdrawn)c.teams[s.team].push(s);}
  cache.set(game,c);
 }
 return c;
}
export function arsenalTeam(s:Ship,enemy=false):Ship[]{return index(s.game).teams[enemy?1-s.team:s.team];}
export function arsenalShip(s:Ship,id:number):Ship|undefined{return index(s.game).ids.get(id);}
