import { copyLoadout, type ArchitectLoadout, type ArchitectSelection } from '../data/architectLoadout';
import type { Ship } from '../ships/Ship';

export interface ArchitectSlotChange { index:number; pick:ArchitectSelection }
export interface ArchitectApplyResult {
  accepted:number[];
  pending:number[];
  skipped:{index:number;reason:string}[];
  rejected:{index:number;reason:string}[];
}
export type ArchitectApply = (changes:readonly ArchitectSlotChange[])=>ArchitectApplyResult;
const emptyResult=():ArchitectApplyResult=>({accepted:[],pending:[],skipped:[],rejected:[]});
export const sameArchitectSelection=(a:ArchitectSelection,b:ArchitectSelection)=>a.type===b.type&&a.skill===b.skill;

export function architectRefitEligibility(ship:Ship):boolean[] {
  return Array.from({length:10},(_,i)=>!!(ship.alive&&ship.architect&&!ship.architect.ultimate&&ship.architect.slots[i].state==='docked'));
}

/** Recheck at submission as the hull may have changed since the last rendered frame. */
export function applyArchitectRefits(ship:Ship,changes:readonly ArchitectSlotChange[],perform:(index:number,pick:ArchitectSelection)=>boolean|'pending'):ArchitectApplyResult {
  const result=emptyResult(),editable=architectRefitEligibility(ship);
  for (const {index,pick} of changes) {
    if (ship.architectLoadout[index]&&sameArchitectSelection(ship.architectLoadout[index],pick)) continue;
    if (!editable[index]) { result.rejected.push({index,reason:!ship.alive?'Captain is sunk.':ship.architect?.ultimate?'Transformation in progress.':'Recall this platform before refitting.'}); continue; }
    const outcome=perform(index,pick);
    if (outcome==='pending') result.pending.push(index);
    else if (outcome) result.accepted.push(index);
    else result.rejected.push({index,reason:ship.skillFailure||'Refit was rejected.'});
  }
  return result;
}

/** Accepted selections and in-flight requests remain distinct until authoritative execution. */
export class ArchitectEditorState {
  accepted:ArchitectLoadout;
  result:ArchitectApplyResult=emptyResult();
  private editable:readonly boolean[];
  private pending=new Map<number,ArchitectSelection>();
  constructor(value:ArchitectLoadout,editable:readonly boolean[]) {this.accepted=copyLoadout(value);this.editable=[...editable];}
  selection(index:number):ArchitectSelection {return this.pending.get(index)??this.accepted[index];}
  canEdit(index:number):boolean {return !!this.editable[index]&&!this.pending.has(index);}
  isPending(index:number):boolean {return this.pending.has(index);}
  sync(value:ArchitectLoadout,editable:readonly boolean[]):void {
    this.accepted=copyLoadout(value);this.editable=[...editable];
    for (const [index,pick] of this.pending) if (sameArchitectSelection(pick,this.accepted[index])) this.resolve(index,pick,true);
  }
  apply(candidate:ArchitectLoadout,apply:ArchitectApply):ArchitectApplyResult {
    const changes:ArchitectSlotChange[]=[],skipped:ArchitectApplyResult['skipped']=[];
    candidate.forEach((pick,index)=>{
      if (sameArchitectSelection(pick,this.accepted[index])||this.pending.has(index)) return;
      if (!this.editable[index]) skipped.push({index,reason:'Locked: recall this platform and finish any transformation before refitting.'});
      else changes.push({index,pick:{...pick}});
    });
    if (!changes.length&&!skipped.length&&this.pending.size) return this.result;
    const next=changes.length?apply(changes):emptyResult();
    this.result={accepted:[...next.accepted],pending:[...this.pending.keys(),...next.pending],skipped:[...skipped,...next.skipped],rejected:[...next.rejected]};
    for (const {index,pick} of changes) {
      if (next.accepted.includes(index)) this.accepted[index]={...pick};
      else if (next.pending.includes(index)) this.pending.set(index,{...pick});
    }
    return this.result;
  }
  resolve(index:number,pick:ArchitectSelection,accepted:boolean,reason?:string):void {
    const requested=this.pending.get(index);
    if (!requested||!sameArchitectSelection(requested,pick)) return;
    this.pending.delete(index);
    this.result.pending=this.result.pending.filter(i=>i!==index);
    if (accepted) {this.accepted[index]={...pick};if (!this.result.accepted.includes(index)) this.result.accepted.push(index);}
    else this.result.rejected.push({index,reason:reason??'Refit was rejected.'});
  }
}
