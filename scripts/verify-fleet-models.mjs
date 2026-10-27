import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const out=process.env.FLEET_OUT??'docs/verification/fleet-refresh/models';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:960,height:640}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.addInitScript(()=>window.requestAnimationFrame=()=>1);
 await page.goto('http://127.0.0.1:5184');await page.waitForFunction(()=>window.steel);
 const ids=await page.evaluate(async()=>{
  const T=await import('/node_modules/.vite/deps/three.js'),{ShipView}=await import('/src/render/ShipModel.ts'),{ALL}=await import('/src/data/ships.ts');
  document.body.querySelectorAll('body > :not(canvas)').forEach(e=>e.style.visibility='hidden');
  const gl=window.steel.renderer.gl;gl.domElement.style.visibility='visible';gl.domElement.style.position='fixed';gl.domElement.style.inset='0';gl.setSize(960,640);gl.setPixelRatio(1);
  const scene=new T.Scene();scene.background=new T.Color(0x172431);scene.add(new T.HemisphereLight(0xdcefff,0x344254,3));const sun=new T.DirectionalLight(0xffedcf,3);sun.position.set(200,400,250);scene.add(sun);
  const camera=new T.PerspectiveCamera(35,1.5,1,20000);window.fleetModels={T,ShipView,ALL,scene,camera,gl};
  return ALL.filter(s=>!['stepper','architect','architectPlatform'].includes(s.id)).map(s=>s.id);
 });
 const rows=[];
 for(const id of ids){
  if(process.env.FLEET_IDS&&!process.env.FLEET_IDS.split(',').includes(id))continue;
  const row=await page.evaluate(id=>{const t=window.fleetModels,s=t.ALL.find(s=>s.id===id);if(t.view){t.scene.remove(t.view.root);t.view.dispose();}const v=t.view=new t.ShipView(s);t.scene.add(v.root);const box=new t.T.Box3().setFromObject(v.root),c=box.getCenter(new t.T.Vector3()),size=box.getSize(new t.T.Vector3()),d=Math.max(size.x,size.z)*1.4;t.camera.position.set(c.x+d*.7,c.y+d*.43,c.z+d*.75);t.camera.lookAt(c);t.gl.render(t.scene,t.camera);return{id,name:s.name,nation:s.nation,titan:s.cls==='TT',hidden:!!s.hidden,calls:t.gl.info.render.calls,triangles:t.gl.info.render.triangles,bounds:size.toArray()};},id);
  await page.screenshot({path:`${out}/${id}.jpg`,quality:84});rows.push(row);
 }
 if(errors.length)throw Error(errors.join('\n'));writeFileSync(`${out}/results.json`,JSON.stringify(rows,null,2));console.log(`${rows.length} hulls captured; ${errors.length} errors`);
}finally{await browser.close();}
