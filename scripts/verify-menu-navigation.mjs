import {chromium} from 'playwright';
import {writeFileSync} from 'node:fs';
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL??'chrome',headless:true});
try{
 const page=await browser.newPage();await page.goto(process.env.STEEL_URL??'http://127.0.0.1:5173');await page.waitForFunction(()=>window.steel);
 const results=await page.evaluate(async()=>{
  const {fleetEditor}=await import('/src/ui/FleetEditor.ts');
  const {MenuNavigation}=await import('/src/ui/MenuNavigation.ts');
  const {Input}=await import('/src/input/Input.ts');
  const nav=new MenuNavigation();const editor=fleetEditor('Team A AI','historic',true,{mode:'auto'},2,()=>{});
  editor.style.cssText='position:absolute;inset:0;background:#081522;z-index:999';document.body.append(editor);
  const assignments=[...editor.querySelectorAll('button')].find(b=>b.textContent==='Assignments');assignments.focus();nav.activate(editor);
  const preserved=document.activeElement.textContent==='Assignments';
  const stableKey=Boolean(document.activeElement.dataset.k);
  nav.move(editor,1);
  const entersSlot=document.activeElement instanceof HTMLSelectElement;
  editor.classList.add('sheet');
  const input=new Input(document.createElement('canvas'));
  Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[{axes:[0,0],buttons:Array.from({length:16},(_,i)=>({pressed:i===0,value:i===0?1:0}))}]});
  input.pollPads();nav.update(input,1000);
  const consumedMenuAction=!input.padPressed(0,0);
  return {preserved,stableKey,entersSlot,consumedMenuAction};
 });
 console.log(JSON.stringify(results));if(Object.values(results).some(v=>!v))throw new Error('Controller focus regression');
 writeFileSync('docs/verification/controller-results.json',JSON.stringify(results,null,2));
}finally{await browser.close()}
