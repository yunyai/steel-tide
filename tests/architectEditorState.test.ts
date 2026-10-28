import { expect,it } from 'vitest';
import { defaultLoadout, loadoutPreset } from '../src/data/architectLoadout';
import { ArchitectEditorState, architectRefitEligibility, applyArchitectRefits } from '../src/ui/ArchitectEditorState';
import { emptyGame,place,run } from './helpers';
import { refitArchitect } from '../src/skills/misc/ArchitectRuntime';

it('submits changed docked slots and preserves unchanged deployed timers',()=>{
 const g=emptyGame('open',1,'freeplay'),s=place(g,'architect',0,0,3000);s.control.aimX=0;s.control.aimZ=1000;s.activateSkill(0);run(g,2);
 const slot=s.architect!.slots[0];slot.skillTimer=6;const candidate=s.architectLoadout.map(p=>({...p}));candidate[2]={type:'swarm',skill:1};
 const model=new ArchitectEditorState(s.architectLoadout,architectRefitEligibility(s));
 const result=model.apply(candidate,changes=>applyArchitectRefits(s,changes,(index,pick)=>refitArchitect(s,index,pick)));
 expect(result).toEqual({accepted:[2],pending:[],skipped:[],rejected:[]});expect(slot.skillTimer).toBe(6);expect(s.architectLoadout[2]).toEqual(candidate[2]);
});
it('reports changed locked slots without sending or queuing them',()=>{
 const accepted=defaultLoadout(),candidate=loadoutPreset('support'),editable=Array(10).fill(true);editable[0]=false;
 const model=new ArchitectEditorState(accepted,editable);let sent:number[]=[];
 const result=model.apply(candidate,changes=>{sent=changes.map(c=>c.index);return {accepted:sent,pending:[],skipped:[],rejected:[]};});
 expect(sent).not.toContain(0);expect(result.skipped).toEqual([{index:0,reason:expect.any(String)}]);expect(model.accepted[0]).toEqual(accepted[0]);
});
it('keeps LAN requests pending and reconciles accepted or rejected execution',()=>{
 const value=defaultLoadout(),model=new ArchitectEditorState(value,Array(10).fill(true)),candidate=value.map(p=>({...p}));candidate[2]={type:'swarm',skill:1};
 model.apply(candidate,changes=>({accepted:[],pending:changes.map(c=>c.index),skipped:[],rejected:[]}));
 expect(model.accepted).toEqual(value);expect(model.selection(2)).toEqual(candidate[2]);expect(model.canEdit(2)).toBe(false);
 model.sync(value,Array(10).fill(true));expect(model.canEdit(2)).toBe(false);
 expect(model.apply(candidate,()=>{throw Error('Must not resend pending slot');}).pending).toEqual([2]);
 model.resolve(2,candidate[2],false,'Platform deployed before execution');expect(model.selection(2)).toEqual(value[2]);expect(model.result.rejected).toEqual([{index:2,reason:'Platform deployed before execution'}]);
 model.apply(candidate,changes=>({accepted:[],pending:changes.map(c=>c.index),skipped:[],rejected:[]}));model.resolve(2,candidate[2],true);model.sync(candidate,Array(10).fill(true));
 expect(model.accepted).toEqual(candidate);expect(model.result.accepted).toEqual([2]);expect(model.result.pending).toEqual([]);
});
it('rechecks eligibility at application and updates open editor state for dead or transforming captains',()=>{
 const g=emptyGame('open',1,'freeplay'),s=place(g,'architect',0,0,3000),model=new ArchitectEditorState(s.architectLoadout,architectRefitEligibility(s));
 const candidate=defaultLoadout();candidate[0]={type:'swarm',skill:1};s.alive=false;
 expect(applyArchitectRefits(s,[{index:0,pick:candidate[0]}],()=>{throw Error('Dead captain refit');}).rejected).toHaveLength(1);
 model.sync(s.architectLoadout,architectRefitEligibility(s));expect(model.canEdit(0)).toBe(false);s.alive=true;s.meter=1;s.activateSkill(6);
 model.sync(s.architectLoadout,architectRefitEligibility(s));expect(model.canEdit(0)).toBe(false);
});
it('settles delayed execution through real refit events after deployment changes eligibility',()=>{
 const g=emptyGame('open',1,'freeplay'),s=place(g,'architect',0,0,3000),model=new ArchitectEditorState(s.architectLoadout,architectRefitEligibility(s));
 const candidate=s.architectLoadout.map(p=>({...p}));candidate[0]={type:'swarm',skill:1};
 const off=g.events.on('architectRefit',event=>{if(event.ship===s){model.resolve(event.index,event.pick,event.accepted,event.reason);model.sync(s.architectLoadout,architectRefitEligibility(s));}});
 model.apply(candidate,changes=>applyArchitectRefits(s,changes,()=> 'pending'));
 expect(model.accepted[0]).not.toEqual(candidate[0]);s.control.aimX=0;s.control.aimZ=1000;s.activateSkill(0);run(g,2);
 expect(refitArchitect(s,0,candidate[0])).toBe(false);expect(model.isPending(0)).toBe(false);expect(model.result.rejected).toEqual([{index:0,reason:'Refit: recall this platform first'}]);expect(model.accepted[0]).toEqual(s.architectLoadout[0]);off();
});
