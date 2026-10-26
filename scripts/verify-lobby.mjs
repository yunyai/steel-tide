import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL??'chrome',headless:true});
const results=[];
try {
 for(const [width,height] of [[1280,720],[1920,1080],[2560,1080]]) {
  const page=await browser.newPage({viewport:{width,height}});const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(process.env.STEEL_URL??'http://127.0.0.1:5173');await page.waitForFunction(()=>window.steel);
  await page.getByRole('button',{name:/^LAN battle/}).click();
  await page.getByRole('button',{name:'Create lobby',exact:true}).click();
  await page.waitForFunction(()=>window.steel.net.client?.lobby);
  await page.evaluate(()=>window.steel.net.client.send({t:'settings',s:{era:'mixed',type:'freeplay',shiftTempo:'long',ai:[2,2],aiSelection:[{mode:'assign',slots:['queenElizabeth','queenElizabeth']},{mode:'pool',pool:['fletcher']}]}}));
  await page.waitForFunction(()=>window.steel.net.client.lobby.settings.shiftTempo==='long');
  const firstSlot=page.locator('.fleet-editor select[aria-label*="slot 1"]').first();
  await firstSlot.focus();await firstSlot.selectOption('iowa');
  await page.waitForFunction(()=>window.steel.net.client.lobby.settings.aiSelection[0].slots[0]==='iowa');
  const focusRestored=await page.evaluate(()=>document.activeElement instanceof HTMLSelectElement&&Boolean(document.activeElement.dataset.k));
  if(!focusRestored)throw new Error('LAN select focus was lost on server refresh');
  await firstSlot.selectOption('queenElizabeth');
  await page.waitForFunction(()=>window.steel.net.client.lobby.settings.aiSelection[0].slots[0]==='queenElizabeth');
  await page.screenshot({path:`docs/verification/lobby-${width}.jpg`,quality:82});
  await page.getByRole('button',{name:'Start battle',exact:true}).click();
  await page.waitForFunction(()=>window.steel.net.lan?.lockstep.played>3);
  const state=await page.evaluate(()=>({tempo:window.steel.battle.config.shiftTempo,ai:window.steel.battle.config.resolvedAI,turns:window.steel.net.hash()[0]}));
  if(state.tempo!=='long'||state.ai[0].join(',')!=='queenElizabeth,queenElizabeth'||state.ai[1].some(id=>id!=='fletcher'))throw new Error(JSON.stringify(state));
  results.push({width,height,focusRestored,...state,errors});if(errors.length)throw new Error(errors.join('\n'));
  await page.evaluate(()=>window.steel.net.client.send({t:'end'}));
  await page.waitForTimeout(100);
  await page.close();
 }
 writeFileSync('docs/verification/lobby-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{await browser.close()}
