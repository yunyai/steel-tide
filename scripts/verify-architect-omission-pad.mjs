import{chromium}from'playwright';import{mkdirSync,writeFileSync}from'node:fs';
const out=process.env.ARCH_UI_OUT??'docs/verification/architect-visual-control-polish';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.addInitScript(()=>{window.requestAnimationFrame=()=>1;});await page.goto(process.env.STEEL_URL??'http://127.0.0.1:5192');await page.waitForFunction(()=>window.steel);
 const result=await page.evaluate(async()=>{
  const{MenuNavigation}=await import('/src/ui/MenuNavigation.ts'),{Input}=await import('/src/input/Input.ts'),{architectLoadoutEditor}=await import('/src/ui/ArchitectLoadout.ts'),{copyLoadout}=await import('/src/data/architectLoadout.ts');
  let accepted=copyLoadout(undefined);const editor=architectLoadoutEditor(accepted,changes=>{for(const c of changes)accepted[c.index]={...c.pick};return{accepted:changes.map(c=>c.index),pending:[],skipped:[],rejected:[]};});
  const root=editor.el;root.classList.add('sheet');root.style.cssText='position:absolute;inset:20px;z-index:999;overflow:auto;background:#07131e';document.body.append(root);
  const nav=new MenuNavigation(),input=new Input(document.createElement('canvas'));let down=[],tick=1000;
  Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[{index:0,axes:[0,0,0,0],buttons:Array.from({length:17},(_,i)=>({pressed:down.includes(i),value:down.includes(i)?1:0}))}]});
  const press=button=>{down=[];input.pollPads();input.endFrame();down=[button];input.pollPads();nav.update(input,tick+=250);input.endFrame();down=[];input.pollPads();input.endFrame();};
  const selectors=[...root.querySelectorAll('.arsenal-omissions select')],omissions=()=>selectors.map(s=>s.value),start=omissions();
  selectors[0].focus();press(13);press(13);const forward={omissions:omissions(),focusedSecond:document.activeElement===selectors[1]};
  // At Vector's lower boundary, focus leaves the selector. Moving back re-enters
  // it, then crosses Swarm (disabled by the first omission) to Resonance.
  press(13);press(12);press(12);const reverse={omissions:omissions(),focusedSecond:document.activeElement===selectors[1]};
  root.querySelectorAll('.arsenal-skill')[1].focus();press(13);const wrapped=document.activeElement===root.querySelector('.arsenal-presets button');
  selectors[0].value='resonance';selectors[0].dispatchEvent(new Event('change',{bubbles:true}));const rejectedDuplicate=omissions();
  const unique=[...root.querySelectorAll('button')].find(b=>b.textContent==='One of each');unique.focus();press(0);
  const actual=accepted.map(s=>s.type);editor.dispose();return{start,forward,reverse,wrapped,rejectedDuplicate,actual};
 });
 const expected=['furnace','cryo','storm','gravity','prism','sentinel','abyss','restoration','bastion','vector'];
 if(JSON.stringify(result.start)!=='["resonance","vector"]'||JSON.stringify(result.forward.omissions)!=='["swarm","vector"]'||!result.forward.focusedSecond||JSON.stringify(result.reverse.omissions)!=='["swarm","resonance"]'||!result.reverse.focusedSecond||!result.wrapped||JSON.stringify(result.rejectedDuplicate)!=='["swarm","resonance"]'||JSON.stringify(result.actual)!==JSON.stringify(expected)||errors.length)throw Error(JSON.stringify({result,errors}));
 writeFileSync(`${out}/omission-pad-results.json`,JSON.stringify({...result,errors},null,2));console.log(JSON.stringify({...result,errors}));
}finally{await browser.close();}
