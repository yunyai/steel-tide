import {chromium} from 'playwright';
import {writeFileSync} from 'node:fs';
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL??'chrome',headless:true});
try{
 const page=await browser.newPage();await page.goto(process.env.STEEL_URL??'http://127.0.0.1:5173');await page.waitForFunction(()=>window.steel);
 const results=await page.evaluate(async()=>{
  const {FleetEditor}=await import('/src/ui/FleetEditor.ts');
  const {MenuNavigation}=await import('/src/ui/MenuNavigation.ts');
  const {Input}=await import('/src/input/Input.ts');
  const nav=new MenuNavigation();const editor=new FleetEditor('Team A AI',{era:'historic',titans:true,value:{mode:'auto'},count:2,reinforcements:0},()=>{}).el;
  editor.style.cssText='position:absolute;inset:0;overflow:auto;background:#081522;z-index:999';document.body.append(editor);
  const assignments=[...editor.querySelectorAll('button')].find(b=>b.textContent==='Assignments');assignments.focus();nav.activate(editor);
  const preserved=document.activeElement.textContent==='Assignments';
  const stableKey=Boolean(document.activeElement.dataset.k);
  nav.move(editor,1);
  const trigger=document.activeElement;
  const entersSlot=trigger.classList.contains('ship-combo-trigger');
  editor.classList.add('sheet');
  const input=new Input(document.createElement('canvas'));
  const hold=b=>Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[{axes:[0,0],buttons:Array.from({length:16},(_,i)=>({pressed:i===b,value:i===b?1:0}))}]});
  let now=1000;const press=b=>{hold(b);input.pollPads();nav.update(input,now+=300);hold(-1);input.pollPads();nav.update(input,now+=300);};
  // A opens the ship combo, down walks from its search into the list, A chooses, B closes.
  press(0);
  const panel=trigger.parentElement.querySelector('[role="dialog"]');
  const opens=!panel.hidden&&document.activeElement.type==='search';
  press(13);press(13);
  const walks=document.activeElement.getAttribute('role')==='option'&&document.activeElement.textContent.includes('Yamato');
  press(0);
  const chooses=panel.hidden&&document.activeElement===trigger&&trigger.getAttribute('aria-label')==='Team A AI AI slot 1: Yamato';
  press(0);press(1);
  const closesWithB=panel.hidden&&document.activeElement===trigger;
  hold(0);input.pollPads();nav.update(input,now+=300);
  const consumedMenuAction=!input.padPressed(0,0);
  return {preserved,stableKey,entersSlot,opens,walks,chooses,closesWithB,consumedMenuAction};
 });
 console.log(JSON.stringify(results));if(Object.values(results).some(v=>!v))throw new Error('Controller focus regression');
 writeFileSync('docs/verification/controller-results.json',JSON.stringify(results,null,2));
}finally{await browser.close()}
