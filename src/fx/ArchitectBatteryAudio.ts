import type { Game } from '../core/Game';
import type { Ship } from '../ships/Ship';
import type { ArchitectBatteryLaunch } from '../data/architectBattery';
import { ARCHETYPES,type ArchitectElement } from '../data/architectLoadout';
import { audio, type AudioEngine,type SoundKind } from './Audio';

const finaleUntil=new WeakMap<Game,number>();
/** Keep ordinary specialist cues underneath the two coordinated finale beats. */
export function architectBatterySkillGain(game:Game):number{return !game.over&&(finaleUntil.get(game)??0)>game.time?.3:1;}
const asset=(name:string)=>`${import.meta.env.BASE_URL}audio/${name}.m4a`;
// Existing licensed recordings, shaped as short energy ruptures rather than naval cannon splashes.
const ELEMENTS:Record<ArchitectElement,{name:string;kind:SoundKind;rate:number}>={
 furnace:{name:'energy-pulse',kind:'zap',rate:.76},cryo:{name:'phase-arrival',kind:'zap',rate:1.24},
 storm:{name:'zap',kind:'zap',rate:.78},gravity:{name:'blast-heavy',kind:'zap',rate:.66},prism:{name:'beam',kind:'zap',rate:1.18},
};
export interface BatteryShake {x:number;z:number;amount:number}
export class ArchitectBatteryAudio {
  private locals:Ship[]=[];
  private heard=new Map<string,number>();
  private off:(()=>void)[];
  constructor(private readonly game:Game,private readonly sound:Pick<AudioEngine,'play'>=audio,private readonly shake:(s:BatteryShake)=>void=()=>{},private readonly reduced=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches){
    this.off=[
      game.events.on('skill',({ship,index})=>{if(ship.architect&&ship.skills[index]?.spec.id==='architectKillbox')this.charge(ship);}),
      game.events.on('architectBatteryLaunch',r=>this.cue(r,false)),
      game.events.on('architectBatteryImpact',e=>this.cue(e.launch,true)),
      game.events.on('shipSunk',({ship})=>{const tag=ship.architectPlatform;if(!tag)return;const slot=tag.owner.architect?.slots[tag.index];if(!slot)return;this.element(ARCHETYPES[slot.type].element,ship.pos,`death:${ship.id}`,this.locals.includes(tag.owner)?2:1,.4);}),
      game.events.on('gameOver',()=>this.clear()),
    ];
  }
  update(locals:Ship[]):void{this.locals=locals;for(const [key,until] of this.heard)if(until<this.game.time)this.heard.delete(key);}
  private once(key:string,until:number):boolean{if(this.heard.has(key))return false;this.heard.set(key,until);return true;}
  private charge(ship:Ship):void{
    if(this.game.over)return;
    this.sound.play('charge',ship.pos.x,ship.pos.y,ship.pos.z,1.3,this.locals.includes(ship)?.65:.36,{category:'ability',priority:this.locals.includes(ship)?2:1,asset:asset('energy-charge'),rate:.86,key:`battery-charge:${ship.id}`,transient:true,duration:1.3});
  }
  private element(element:ArchitectElement,p:{x:number;y:number;z:number},key:string,priority:number,gain:number):void{
    const cue=ELEMENTS[element];
    this.sound.play(cue.kind,p.x,p.y,p.z,3,gain,{category:'ability',priority,asset:asset(cue.name),rate:cue.rate,key,transient:true,duration:.8});
  }
  private cue(r:ArchitectBatteryLaunch,impact:boolean):void{
    if(this.game.over||r.generation!==this.game.battery.generation(r.owner))return;
    const key=`${r.owner.id}:${r.generation}:${r.castId}:${r.stage}:${impact?1:0}`;
    const finale=r.stage===3,local=this.locals.includes(r.owner),p=impact?r.center:r.paths[0].muzzle,priority=finale&&local?3:finale||local?2:1;
    if(this.once(key,r.arrivalTime+1)){
      if(finale)finaleUntil.set(this.game,Math.max(finaleUntil.get(this.game)??0,r.arrivalTime+.4));
      this.sound.play(impact?'explosion':'gun',p.x,p.y,p.z,impact?(finale?3:1.6):500,local?(finale?.68:.4):(finale?.44:.25),{
        category:'ability',priority,asset:asset(impact?(finale?'blast-heavy':'blast-shock'):'energy-heavy'),rate:finale?.74:.88,
        key:`battery-${impact?'impact':'launch'}:${Math.floor(p.x/500)}:${Math.floor(p.z/500)}`,transient:true,duration:finale?1.2:.75,
      });
      if(!impact)this.sound.play('zap',p.x,p.y,p.z,3,local?.28:.17,{category:'ability',priority,asset:asset('plasma-shot'),rate:finale?.7:.9,key:`battery-plasma:${key}`,transient:true,duration:.5});
      if(!this.reduced())this.shake({x:p.x,z:p.z,amount:impact?(finale?.35:.18):(finale?.14:.07)});
    }
    // Ten modules share a physical beat; retain one tint per element instead of ten explosions.
    if(impact&&this.once(`${key}:${r.element}`,r.arrivalTime+1))this.element(r.element,p,`battery-element:${r.element}:${Math.floor(p.x/500)}:${Math.floor(p.z/500)}`,priority,local?(finale?.32:.2):.13);
  }
  private clear():void{this.heard.clear();finaleUntil.delete(this.game);}
  dispose():void{for(const off of this.off)off();this.off=[];this.locals=[];this.clear();}
}
