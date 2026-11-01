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

// A pad drives an open ship combo like any other dialog: the combo sits inside the sheet,
// so it comes later in document order and wins the navigation root.
class Button extends Control {
  clicks=0;dataset:Record<string,string>={};
  constructor(public label='',public back=false){super();if(back)this.dataset.menuBack='';}
  get textContent():string{return this.label;}
  click():void{this.clicks++;}
}
class Pad {
  held=new Set<number>();
  pad(i:number){return i===0?{axes:[0,0]}:null;}
  padPressed(i:number,b:number):boolean{return i===0&&this.held.has(b);}
  consumePadPress(_i:number,b:number):void{this.held.delete(b);}
  press(nav:MenuNavigation,b:number):void{this.held.add(b);nav.update(this as never,0);}
}
function pickerFixture(){
  const search=new Control(),yamato=new Button('Yamato'),iowa=new Button('Iowa'),close=new Button('Close',true),behind=new Button('Back');
  const sheet={getClientRects:()=>[{}],querySelectorAll:()=>[behind],querySelector:()=>null};
  const picker={
   getClientRects:()=>[{}],
   contains:(v:unknown)=>[search,yamato,iowa,close].includes(v as Control),
   querySelector:()=>null,
   querySelectorAll:(sel:string)=>sel==='[data-menu-back]'?[close]:sel==='button'?[yamato,iowa,close]:[search,yamato,iowa,close],
  };
  const doc={activeElement:search,addEventListener:()=>{},querySelectorAll:()=>[sheet,picker]};
  vi.stubGlobal('document',doc);vi.stubGlobal('getComputedStyle',()=>({visibility:'visible'}));
  vi.stubGlobal('HTMLSelectElement',Select);vi.stubGlobal('HTMLElement',Control);vi.stubGlobal('HTMLTextAreaElement',class{});
  return{search,yamato,iowa,close,behind,nav:new MenuNavigation(),pad:new Pad()};
}

describe('controller in the ship combo',()=>{
 it('moves from the search box through the ships and chooses one',()=>{
  const {yamato,iowa,nav,pad}=pickerFixture();
  pad.press(nav,13);expect(document.activeElement).toBe(yamato);
  pad.press(nav,13);expect(document.activeElement).toBe(iowa);
  pad.press(nav,0);expect(iowa.clicks).toBe(1);expect(yamato.clicks).toBe(0);
 });
 it('closes the combo with B rather than leaving the screen behind it',()=>{
  const {close,behind,nav,pad}=pickerFixture();
  pad.press(nav,1);expect(close.clicks).toBe(1);expect(behind.clicks).toBe(0);
 });
});

// Rebuilding an editor (an era change, a lobby update) must leave the player where they were.
class Field extends Control {
  dataset:Record<string,string>;scrollTop=0;scrollLeft=0;selectionStart:number|null=null;selectionEnd:number|null=null;
  constructor(key:string,attr:'k'|'scrollKey'='k'){super();this.dataset={[attr]:key};}
  setSelectionRange(a:number,b:number):void{this.selectionStart=a;this.selectionEnd=b;}
}
describe('editor rebuilds keep the player in place',()=>{
 it('restores focus, the caret and scroll positions after an era change rebuilds the controls',async()=>{
  const {keepUi}=await import('../src/ui/uiMemory');
  let parts=[new Field('fleet-Enemy AI-search'),new Field('fleet-Enemy AI-pool','scrollKey')];
  const root={contains:(v:unknown)=>parts.includes(v as Field),querySelectorAll:(sel:string)=>parts.filter(p=>sel==='[data-scroll-key]'?p.dataset.scrollKey!==undefined:p.dataset.k!==undefined)};
  vi.stubGlobal('document',{activeElement:parts[0]});
  parts[0].setSelectionRange(2,4);parts[1].scrollTop=120;
  keepUi(root as unknown as HTMLElement,()=>{parts=[new Field('fleet-Enemy AI-search'),new Field('fleet-Enemy AI-pool','scrollKey')];(document as unknown as {activeElement:unknown}).activeElement=null;});
  expect(document.activeElement).toBe(parts[0]);
  expect([parts[0].selectionStart,parts[0].selectionEnd]).toEqual([2,4]);
  expect(parts[1].scrollTop).toBe(120);
 });
 it('leaves focus alone when it was outside the editor',async()=>{
  const {keepUi}=await import('../src/ui/uiMemory');
  const outside=new Control();let parts=[new Field('a')];
  const root={contains:(v:unknown)=>parts.includes(v as Field),querySelectorAll:()=>parts};
  vi.stubGlobal('document',{activeElement:outside});
  keepUi(root as unknown as HTMLElement,()=>{parts=[new Field('a')];});
  expect(document.activeElement).toBe(outside);
 });
});
