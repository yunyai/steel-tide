import { chromium } from 'playwright';
import { mkdirSync,writeFileSync } from 'node:fs';
const out='docs/verification/stepper-cohesive-refraction';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:640,height:360}}),errors=[];
  page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.addInitScript(()=>{window.requestAnimationFrame=()=>1;});await page.goto((process.env.STEEL_URL??'http://127.0.0.1:5184')+'/?q=high');await page.waitForFunction(()=>window.steel);
  const result=await page.evaluate(async()=>{
    const T=await import('/node_modules/three/build/three.module.js'),{Renderer}=await import('/src/render/Renderer.ts');
    const canvas=document.createElement('canvas');document.body.append(canvas);const renderer=new Renderer(canvas),scene=new T.Scene();scene.background=new T.Color(0x050c18);
    const bytes=new Uint8Array(64*64*4);for(let y=0;y<64;y++)for(let x=0;x<64;x++){const n=(y*64+x)*4,v=(x+y)%2?210:24;bytes.set([v,v,v,255],n);}
    const texture=new T.DataTexture(bytes,64,64);texture.needsUpdate=true;texture.magFilter=T.NearestFilter;texture.minFilter=T.NearestFilter;
    const backdrop=new T.Mesh(new T.PlaneGeometry(1200,700),new T.MeshBasicMaterial({map:texture}));backdrop.position.z=-40;scene.add(backdrop);
    const obstacle=new T.Mesh(new T.PlaneGeometry(140,280),new T.MeshBasicMaterial({color:0x2470ac}));obstacle.position.set(-60,0,100);scene.add(obstacle);
    const camera=new T.PerspectiveCamera(60,640/360,1,2000);camera.position.z=500;camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
    let on=false;const world={scene,fog:{color:0,density:0},distortions:[],update(){},prepare(vp){this.distortions=on&&vp.team===0?[{x:0,y:0,z:0,radius:180,strength:1,priority:3}]:[];},setFog(){},dispose(){}};
    renderer.attach(world);
    const vp={camera,team:0,rect:{x:0,y:0,w:1,h:1},focus:{x:0,z:0}};
    const grab=(views=[vp])=>{renderer.render(views);const gl=renderer.gl.getContext(),size=renderer.gl.getDrawingBufferSize(new T.Vector2()),a=new Uint8Array(size.x*size.y*4);gl.readPixels(0,0,size.x,size.y,gl.RGBA,gl.UNSIGNED_BYTE,a);return{a,w:size.x,h:size.y};};
    grab();const before=grab();on=true;const after=grab();let changed=0,foreground=0,outside=0;
    const diff=(a,b,x,y)=>{const n=(y*a.w+x)*4;return Math.abs(a.a[n]-b.a[n])+Math.abs(a.a[n+1]-b.a[n+1])+Math.abs(a.a[n+2]-b.a[n+2]);};
    for(let y=0;y<before.h;y++)for(let x=0;x<before.w;x++)if(diff(before,after,x,y)>3){changed++;const u=x/before.w,v=y/before.h;if(u>.38&&u<.48&&v>.4&&v<.6)foreground++;if(u<.25||u>.75||v<.15||v>.85)outside++;}
    // Two viewport compositions: the right-hand spectator must receive no left-player refraction.
    const right={...vp,camera:camera.clone(),team:1,rect:{x:.5,y:0,w:.5,h:1}},left={...vp,rect:{x:0,y:0,w:.5,h:1}};
    on=false;const splitBefore=grab([left,right]);on=true;const splitAfter=grab([left,right]);let leaked=0;
    for(let y=0;y<splitBefore.h;y++)for(let x=splitBefore.w/2+2;x<splitBefore.w;x++)if(diff(splitBefore,splitAfter,x,y)>3)leaked++;
    // Exercise post resize and battle restart resource ownership.
    renderer.detach();renderer.attach(world);grab();const gpuError=renderer.gl.getContext().getError();renderer.detach();renderer.gl.dispose();canvas.remove();texture.dispose();backdrop.geometry.dispose();backdrop.material.dispose();obstacle.geometry.dispose();obstacle.material.dispose();
    return{changed,foreground,outside,leaked,gpuError};
  });
  if(result.changed<40||result.foreground||result.outside||result.leaked||result.gpuError||errors.length)throw Error(JSON.stringify({result,errors}));
  const ground=await page.evaluate(()=>{
    window.steel.start({kind:'ground',mode:'solo',type:'freeplay',mapId:'city',teamSize:1,ai:[0,0],difficulty:'normal',players:[{vehicleId:'t34_85',device:'mouse'}],seed:713});
    const b=window.steel.battle;b.shell.input.fallback=true;b.paused=false;b.setOverlay(null);
    for(let i=0;i<60;i++)b.tick(1/60);
    return{calls:window.steel.renderer.gl.info.render.calls,fields:window.steel.renderer.battle.distortions?.length??0,error:window.steel.renderer.gl.getContext().getError()};
  });
  await page.screenshot({path:`${out}/ground-smoke.jpg`,quality:85});
  if(ground.calls<1||ground.fields||ground.error||errors.length)throw Error(JSON.stringify({ground,errors}));
  const concealed=await page.evaluate(async()=>{
    window.steel.start({mode:'solo',type:'freeplay',mapId:'open',teamSize:1,ai:[0,0],difficulty:'normal',players:[{shipId:'stepper',device:'mouse'}],seed:713});
    const b=window.steel.battle,g=b.game,s=g.humans()[0],r=window.steel.renderer;g.ai.clear();
    s.pos.set(0,0,1500);s.prevPos.copy(s.pos);s.throttle=2;s.speed=0;s.control.aimX=s.control.aimZ=0;s.meter=1;s.activateSkill(7);
    s.mods.untargetable=true;s.mods.revealed=false;s.stepper.cross.elapsed=.15;g.interpolate();r.update(.1,b.pcs.map(p=>p.camera));
    b.pcs[0].camera.position.set(0,1500,2200);b.pcs[0].camera.lookAt(0,0,0);b.pcs[0].camera.updateMatrixWorld(true);
    b.viewports[0].team=1;r.render(b.viewports);const fx=b.scene.crossFx;
    const personal=()=>{const p=fx.spatial.tears.geometry.getAttribute('iPhase');return Array.from({length:fx.spatial.tears.count},(_,i)=>p.getW(i)===2&&p.getZ(i)<1000).filter(Boolean).length;};
    const hidden={surfaces:personal(),shards:fx.spatial.shards.count,fields:fx.distortions.length,boundary:fx.light.count};
    b.viewports[0].team=0;r.render(b.viewports);const ally=personal();
    s.mods.revealed=true;b.viewports[0].team=1;r.render(b.viewports);const revealed=personal();
    return{hidden,ally,revealed};
  });
  if(concealed.hidden.surfaces||concealed.hidden.shards||concealed.hidden.fields||!concealed.hidden.boundary||!concealed.ally||!concealed.revealed||errors.length)throw Error(JSON.stringify({concealed,errors}));
  writeFileSync(`${out}/results.json`,JSON.stringify({result,ground,concealed,errors},null,2));console.log(JSON.stringify({result,ground,concealed}));
}finally{await browser.close();}
