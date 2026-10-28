import type { Game } from '../core/Game';
import type { Ship } from '../ships/Ship';
import type { ArchitectBatteryLaunch, ArchitectBatteryLaunchInput, ArchitectBatteryRecipient } from '../data/architectBattery';
import { distToHull } from '../core/hull';
import { applyElementMark } from '../skills/misc/ArchitectElements';
import { clearLine } from '../skills/misc/ArchitectRuntime';

/** Committed Battery flight outlives the command that launched it. */
export class ArchitectBatterySystem {
  private queue:ArchitectBatteryLaunch[]=[];
  private ownerGenerations=new Map<number,number>();
  private castCounter=0;
  private launchCounter=0;
  constructor(private readonly game:Game){}
  get pending():readonly ArchitectBatteryLaunch[]{return this.queue;}
  get generations():ReadonlyMap<number,number>{return this.ownerGenerations;}
  get castSerial():number{return this.castCounter;}
  get launchSerial():number{return this.launchCounter;}
  generation(owner:Ship):number{return this.ownerGenerations.get(owner.id)??0;}
  beginCast(owner:Ship):number{
    if(!this.ownerGenerations.has(owner.id))this.ownerGenerations.set(owner.id,0);
    return ++this.castCounter;
  }
  launch(input:ArchitectBatteryLaunchInput):void{
    if(!input.owner.alive||input.owner.withdrawn||this.game.over||input.generation!==this.generation(input.owner))return;
    const point=(p:{x:number;y:number;z:number})=>Object.freeze({...p});
    const paths=input.paths.map(p=>Object.freeze({muzzle:point(p.muzzle),control:point(p.control),impact:point(p.impact)})) as unknown as ArchitectBatteryLaunch['paths'];
    const record:ArchitectBatteryLaunch=Object.freeze({...input,id:++this.launchCounter,center:point(input.center),carrier:Object.freeze({...input.carrier}),paths:Object.freeze(paths)});
    this.queue.push(record);
    this.game.events.emit('architectBatteryLaunch',record);
  }
  update():void{
    if(this.game.over){if(this.queue.length)this.clear();return;}
    if(!this.queue.length)return;
    // Detach the ready batch before damage callbacks can cancel an owner or enqueue a new cast.
    const ready=this.queue.filter(r=>r.arrivalTime<=this.game.time+1e-8).sort((a,b)=>a.id-b.id);
    this.queue=this.queue.filter(r=>r.arrivalTime>this.game.time+1e-8);
    for(const launch of ready){
      const s=launch.owner;
      if(!s.alive||s.withdrawn||!s.architect||launch.generation!==this.generation(s))continue;
      const recipients:ArchitectBatteryRecipient[]=[];
      const skill={...s.skills[7].spec,element:launch.element};
      const slot={...s.architect.slots[launch.slot],type:launch.type,skill:launch.skill,element:launch.element};
      for(const t of this.game.ships){
        if(!s.alive||launch.generation!==this.generation(s))break;
        if(!t.alive||t.team===s.team||t.submerged||Math.abs(t.pos.y)>120||distToHull(t,launch.center.x,launch.center.z)>launch.radius||clearLine(s,launch.center.x,launch.center.z,t.pos.x,t.pos.z,16,t.pos.y+12)<1)continue;
        // Source offense was captured at launch. Critical/Hunt and all target defenses remain arrival-time behavior.
        const damage=t.takeDamage(launch.baseDamage*launch.damageMultiplier*s.critMul(t),s,skill);
        recipients.push({target:t,damage,x:t.pos.x,y:t.pos.y+12,z:t.pos.z});
        if(damage>0&&t.alive)applyElementMark(s,slot,t);
      }
      if(s.alive&&launch.generation===this.generation(s))this.game.events.emit('architectBatteryImpact',{launch,resolvedAt:this.game.time,recipients});
    }
  }
  cancelOwner(owner:Ship):void{
    this.ownerGenerations.set(owner.id,this.generation(owner)+1);
    this.queue=this.queue.filter(r=>r.owner!==owner);
  }
  clear():void{
    for(const [id,generation] of this.ownerGenerations)this.ownerGenerations.set(id,generation+1);
    this.queue=[];
  }
}
