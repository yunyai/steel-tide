import type { Game } from '../core/Game';
import type { Ship } from '../ships/Ship';
import type { ArchitectBatteryLaunch } from '../data/architectBattery';
import { audio, type AudioEngine } from './Audio';

const finaleUntil=new WeakMap<Game,number>();
/** Keep ordinary specialist cues underneath the two coordinated finale beats. */
export function architectBatterySkillGain(game:Game):number{return !game.over&&(finaleUntil.get(game)??0)>game.time?.3:1;}
export class ArchitectBatteryAudio {
  private locals:Ship[]=[];
  private heard=new Map<string,number>();
  private off:(()=>void)[];
  constructor(private readonly game:Game,private readonly sound:Pick<AudioEngine,'play'>=audio){
    this.off=[game.events.on('architectBatteryLaunch',r=>this.cue(r,false)),game.events.on('architectBatteryImpact',e=>this.cue(e.launch,true)),game.events.on('gameOver',()=>{this.heard.clear();finaleUntil.delete(game);})];
  }
  update(locals:Ship[]):void{
    this.locals=locals;
    for(const [key,until] of this.heard)if(until<this.game.time)this.heard.delete(key);
  }
  private cue(r:ArchitectBatteryLaunch,impact:boolean):void{
    if(this.game.over||r.generation!==this.game.battery.generation(r.owner))return;
    const key=`${r.owner.id}:${r.generation}:${r.castId}:${r.stage}:${impact?1:0}`;
    if(this.heard.has(key))return;
    this.heard.set(key,r.arrivalTime+1);
    const finale=r.stage===3,local=this.locals.includes(r.owner),p=r.center;
    if(finale)finaleUntil.set(this.game,Math.max(finaleUntil.get(this.game)??0,r.arrivalTime+.4));
    this.sound.play(impact?'explosion':'gun',p.x,p.y,p.z,impact?(finale?3:1.6):500,local?(finale?.8:.45):(finale?.5:.28),{
      category:'ability',priority:finale?3:local?2:1,
      asset:impact?`${import.meta.env.BASE_URL}audio/${finale?'blast-heavy':'sonniss-explosion'}.m4a`:`${import.meta.env.BASE_URL}audio/${finale?'energy-heavy':'mechanical-hit'}.m4a`,rate:finale?.78:.9,
    });
  }
  dispose():void{for(const off of this.off)off();this.off=[];this.heard.clear();finaleUntil.delete(this.game);}
}
