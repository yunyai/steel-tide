import {chromium} from 'playwright';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
const out=process.env.ARCH_UI_OUT??'docs/verification/architect-polish-ui';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),rows=[];
try{
 for(const [width,height] of (process.env.ARCH_UI_NARROW?[[900,800],[700,800],[520,800],[390,844]]:[[1280,720],[1920,1080],[2560,1080],[900,800],[700,800],[520,800],[390,844]])){
  const page=await browser.newPage({viewport:{width,height}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(process.env.STEEL_URL??'http://127.0.0.1:5192');await page.waitForFunction(()=>window.steel);
  await page.getByRole('button',{name:/Hangar/}).first().click();await page.getByRole('button',{name:'Misc',exact:true}).click();await page.getByRole('button',{name:'Titan',exact:true}).click();await page.getByRole('button',{name:/Architect/}).first().click();
  const editor=page.locator('.arsenal-editor');await editor.scrollIntoViewIfNeeded();
  const navigation=await page.evaluate(async()=>{const {MenuNavigation}=await import('/src/ui/MenuNavigation.ts'),nav=new MenuNavigation(),root=document.querySelector('.arsenal-editor'),slot=root.querySelector('[data-arsenal-key="slot-8"]');slot.focus();nav.activate(root);const preserved=document.activeElement===slot,select=root.querySelector('.arsenal-detail select');select.focus();nav.move(root,1);const selectPreserved=document.activeElement===select;root.querySelectorAll('.arsenal-skill')[1].click();return{preserved,selectPreserved,selected:root.querySelectorAll('.arsenal-skill[aria-pressed=true]').length};});
  await page.screenshot({path:`${out}/hangar-${width}.jpg`,quality:88});
  await editor.getByRole('button',{name:'Import / export',exact:true}).click();
  const text=editor.getByRole('textbox',{name:'Loadout JSON'}),apply=editor.getByRole('button',{name:'Apply import',exact:true});
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(Error('Denied for verification'))}}));
  await editor.getByRole('button',{name:'Copy JSON',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.arsenal-transfer-status')?.textContent.includes('Clipboard unavailable'));
  const exported=JSON.parse(await text.inputValue()),before=await page.evaluate(()=>localStorage.getItem('steel-tide.architect-loadout.v1'));
  if(exported.format!=='steel-tide.architect-loadout'||exported.version!==1||exported.slots.length!==10)throw Error('Bad exported document');
  await text.fill('{invalid');if(!await apply.isDisabled())throw Error('Invalid import enabled');
  if(await page.evaluate(()=>localStorage.getItem('steel-tide.architect-loadout.v1'))!==before)throw Error('Invalid import mutated selections');
  const candidate={format:'steel-tide.architect-loadout',version:1,slots:Array.from({length:10},(_,i)=>({type:i%2?'sentinel':'swarm',skill:i%2}))};
  await editor.locator('input[type=file]').setInputFiles({name:'candidate.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(candidate))});
  if(await page.evaluate(()=>localStorage.getItem('steel-tide.architect-loadout.v1'))!==before)throw Error('File staged before Apply changed selections');
  await apply.click();const accepted=await page.evaluate(()=>JSON.parse(localStorage.getItem('steel-tide.architect-loadout.v1')));
  if(JSON.stringify(accepted)!==JSON.stringify(candidate.slots))throw Error('Import did not apply ordered selections');
  const downloadPromise=page.waitForEvent('download');await editor.getByRole('button',{name:'Download JSON',exact:true}).click();const download=await downloadPromise;const path=`${out}/roundtrip-${width}.json`;await download.saveAs(path);
  if(JSON.stringify(JSON.parse(readFileSync(path,'utf8')).slots)!==JSON.stringify(accepted))throw Error('Download mismatch');
  await text.focus();await text.fill('');await text.pressSequentially('a b');if(await text.inputValue()!=='a b')throw Error('Native text input was consumed');
  await text.fill(JSON.stringify(candidate,null,2));await page.screenshot({path:`${out}/transfer-${width}.jpg`,quality:88});
  await text.press('Escape');if(await editor.locator('.arsenal-transfer').isVisible())throw Error('Escape did not close transfer');
  await editor.getByRole('button',{name:'Import / export',exact:true}).click();
  const pad=await page.evaluate(async()=>{const {MenuNavigation}=await import('/src/ui/MenuNavigation.ts'),{Input}=await import('/src/input/Input.ts'),root=document.querySelector('.arsenal-editor'),nav=new MenuNavigation(),input=new Input(document.createElement('canvas')),original=navigator.getGamepads;Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[{axes:[0,0],buttons:Array.from({length:16},(_,i)=>({pressed:i===1,value:i===1?1:0}))}]});input.pollPads();const textReachable=nav.controls(root).includes(root.querySelector('textarea'));nav.update(input,performance.now());Object.defineProperty(navigator,'getGamepads',{configurable:true,value:original});return{textReachable,closed:root.querySelector('.arsenal-transfer').hidden,focused:document.activeElement?.classList.contains('arsenal-disclosure')};});
  if(!pad.textReachable||!pad.closed||!pad.focused)throw Error(JSON.stringify(pad));
  const result=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,focused:document.activeElement?.classList.contains('arsenal-disclosure'),selected:document.querySelectorAll('.arsenal-skill[aria-pressed=true]').length,saved:JSON.parse(localStorage.getItem('steel-tide.architect-loadout.v1')).length}));
  rows.push({width,...navigation,...result,pad,errors});if(errors.length||result.overflow||!result.focused||!navigation.preserved||!navigation.selectPreserved||result.selected!==1||result.saved!==10)throw Error(JSON.stringify(rows.at(-1)));
  await page.close();console.log(`UI ${width}: passed transfer, navigation and layout`);
 }
 writeFileSync(`${out}/results.json`,JSON.stringify(rows,null,2));
}finally{await browser.close();}
