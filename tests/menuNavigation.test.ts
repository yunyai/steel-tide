import {afterEach,describe,expect,it,vi} from 'vitest';
import {MenuNavigation} from '../src/ui/MenuNavigation';

// Vitest's node environment has no browser DOM. Keep the selection/focus boundary
// minimal and run the production navigation method, without replacing its logic.
class OptionGroup {constructor(public disabled=false){}}
class Option {
  selected=false;
  constructor(public disabled=false,public parentElement:OptionGroup|null=null){}
  scrollIntoView():void{}
}
class Control {
  getClientRects():object[]{return[{}];}
  focus():void{(document as unknown as {activeElement:Element}).activeElement=this as unknown as Element;}
  scrollIntoView():void{}
}
class Select extends Control {
  dataset:Record<string,string>={};
  multiple=false;
  changes:number[]=[];
  constructor(public options:Option[],public selectedIndex:number){super();}
  dispatchEvent():boolean{this.changes.push(this.selectedIndex);return true;}
}
function fixture(options:Option[],selected:number):{select:Select;after:Control;root:HTMLElement;nav:MenuNavigation}{
  const select=new Select(options,selected),after=new Control();
  const doc={activeElement:select,addEventListener:()=>{}};
  vi.stubGlobal('document',doc);vi.stubGlobal('HTMLSelectElement',Select);vi.stubGlobal('HTMLElement',Control);vi.stubGlobal('HTMLOptGroupElement',OptionGroup);
  const root={contains:(value:unknown)=>value===select||value===after,querySelectorAll:()=>[select,after]} as unknown as HTMLElement;
  return{select,after,root,nav:new MenuNavigation()};
}
afterEach(()=>vi.unstubAllGlobals());

describe('controller selection respects unavailable choices',()=>{
 it('skips a disabled final choice and leaves the selector at its last enabled option',()=>{
  // Resonance -> Swarm -> disabled Vector must advance focus, never choose Vector.
  const {select,after,root,nav}=fixture(Array.from({length:12},(_,i)=>new Option(i===11)),9);
  nav.move(root,1);nav.move(root,1);
  expect(select.changes).toEqual([10]);expect(select.selectedIndex).toBe(10);expect(document.activeElement).toBe(after);
 });
 it('skips disabled choices while moving backward',()=>{
  const {select,root,nav}=fixture([new Option(),new Option(true),new Option()],2);
  nav.move(root,-1);expect(select.selectedIndex).toBe(0);expect(select.changes).toEqual([0]);
 });
 it('skips every choice inside a disabled option group',()=>{
  const group=new OptionGroup(true),{select,root,nav}=fixture([new Option(),new Option(false,group),new Option(false,group),new Option()],0);
  nav.move(root,1);expect(select.selectedIndex).toBe(3);expect(select.changes).toEqual([3]);
 });
 it('resumes from native selection after a prior controller move',()=>{
  const {select,root,nav}=fixture(Array.from({length:5},()=>new Option()),0);
  nav.move(root,1);select.selectedIndex=3;nav.move(root,1);
  expect(select.selectedIndex).toBe(4);expect(select.changes).toEqual([1,4]);
 });
 it('does not activate an unavailable multiple-selection option',()=>{
  const {select,root,nav}=fixture([new Option(),new Option(true)],1);select.multiple=true;
  nav.activate(root);expect(select.options[1].selected).toBe(false);expect(select.changes).toEqual([]);
 });
});
