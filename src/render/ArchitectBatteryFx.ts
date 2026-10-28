import { AdditiveBlending, BoxGeometry, BufferGeometry, Color, CylinderGeometry, DynamicDrawUsage, Euler, IcosahedronGeometry, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshStandardMaterial, NormalBlending, OctahedronGeometry, Quaternion, TorusGeometry, Vector3, type Scene } from 'three';
import type { Game } from '../core/Game';
import type { Ship } from '../ships/Ship';
import type { Team } from '../core/types';
import { ARCHETYPES, type ArchitectType } from '../data/architectLoadout';
import type { ArchitectBatteryImpact, ArchitectBatteryLaunch, ArchitectBatteryPoint, ArchitectBatteryRecipient } from '../data/architectBattery';
import { sampleArchitectBatteryArc } from '../skills/misc/ArchitectBatteryPose';
import { contactVisible } from '../core/Targeting';
import { waveHeight } from '../world/Waves';
import { reducedMotion } from './ArchitectPose';
import { quality } from './Quality';
import { Ribbons } from './Projectiles';
import { ArchitectSiege } from './ArchitectSiege';

export const BATTERY_FX_CAPS={shells:128,lobes:384,fragments:384,skirts:96,hot:256,trails:1280,arcs:1280} as const;
type PoolName=keyof typeof BATTERY_FX_CAPS|'pressure';
interface Pool {mesh:InstancedMesh;capacity:number;count:number;peak:number;drops:number}
interface Contact {launch:ArchitectBatteryLaunch;recipient:ArchitectBatteryRecipient;time:number}
interface Death {owner:Ship;generation:number;target:Ship;type:ArchitectType;slot:number;point:ArchitectBatteryPoint;time:number;large:boolean}
type BurstSource=Pick<ArchitectBatteryLaunch,'type'|'stage'|'slot'>;
interface Danger {owner:Ship;generation:number;castId:number;center:ArchitectBatteryPoint;radius:number;until:number}
const matrix=new Matrix4(),rotation=new Quaternion(),euler=new Euler(),position=new Vector3(),scale=new Vector3(),color=new Color(),direction=new Vector3(),axis=new Vector3(1,0,0);
const clamp=(v:number)=>Math.max(0,Math.min(1,v));

/** Solid luminous geometry keeps color and shape on presets without post-processing. */
function energyMaterial(emissive=1,volume=false):MeshStandardMaterial {
 const material=new MeshStandardMaterial({roughness:.32,metalness:.25,flatShading:!volume,emissive:0xffffff,emissiveIntensity:emissive,transparent:volume,opacity:volume?.2:1,depthWrite:!volume,blending:volume?AdditiveBlending:NormalBlending,toneMapped:false});
 material.onBeforeCompile=shader=>{
  shader.vertexShader='attribute float instanceFade; varying float vBatteryFade;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvBatteryFade=instanceFade;');
  shader.fragmentShader='varying float vBatteryFade;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\n#ifdef USE_COLOR\ntotalEmissiveRadiance*=vColor.rgb;\n#endif');
  shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>',volume?`#include <alphatest_fragment>
   diffuseColor.a*=vBatteryFade;`:`#include <alphatest_fragment>
   float d=fract(sin(dot(floor(gl_FragCoord.xy),vec2(12.9898,78.233)))*43758.5453);if(d>vBatteryFade)discard;`);
 };
 material.customProgramCacheKey=()=>`battery-energy-${emissive}-${volume}`;return material;
}

/** Committed world-space travel/impacts; simulation ownership is checked without consulting a new ultimate. */
export class ArchitectBatteryFx {
 readonly machinery:ArchitectSiege;
 readonly hazard=new Ribbons(2400,false,false);
 readonly pools:Record<PoolName,Pool>;
 private deaths:Death[]=[];private flights:ArchitectBatteryLaunch[]=[];private impacts:ArchitectBatteryImpact[]=[];private contacts:Contact[]=[];private dangers=new Map<string,Danger>();
 private off:(()=>void)[]=[];private reduced=reducedMotion();private detail=quality().particles;
 private counts={mergedContacts:0,contactDrops:0,committedLaunches:0,committedImpacts:0};
 constructor(private scene:Scene,private game:Game){
  this.machinery=new ArchitectSiege(scene,game);
  const make=(name:PoolName,geometry:BufferGeometry,capacity:number,emissive=0):Pool=>{
   geometry.setAttribute('instanceFade',new InstancedBufferAttribute(new Float32Array(capacity),1).setUsage(DynamicDrawUsage));
   const mesh=new InstancedMesh(geometry,energyMaterial(emissive,name==='trails'),capacity);mesh.name=`architect-battery-fx-${name}`;mesh.count=0;mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(DynamicDrawUsage);mesh.receiveShadow=false;scene.add(mesh);return {mesh,capacity,count:0,peak:0,drops:0};
  };
  this.pools={shells:make('shells',new OctahedronGeometry(1,0),128,2.8),lobes:make('lobes',new IcosahedronGeometry(1,1),384,.65),fragments:make('fragments',new OctahedronGeometry(1,0),384,1.5),skirts:make('skirts',new TorusGeometry(1,.035,4,32),96,2),hot:make('hot',new OctahedronGeometry(1,0),256,3),pressure:make('pressure',new BoxGeometry(1,1,1),96,1.6),trails:make('trails',new CylinderGeometry(1,1,2,6).rotateZ(Math.PI/2),1280,1.5),arcs:make('arcs',new BoxGeometry(2,1,1),1280,2.4)};
  this.hazard.mesh.name='architect-battery-public-hazard';scene.add(this.hazard.mesh);
  this.off.push(game.events.on('architectBatteryLaunch',launch=>{
   if(!this.valid(launch))return;this.flights.push(launch);this.counts.committedLaunches++;
   const key=`${launch.owner.id}:${launch.generation}:${launch.castId}`,danger=this.dangers.get(key);
   this.dangers.set(key,{owner:launch.owner,generation:launch.generation,castId:launch.castId,center:launch.center,radius:launch.radius,until:Math.max(danger?.until??0,launch.arrivalTime)});
  }),game.events.on('architectBatteryImpact',impact=>{
   if(!this.valid(impact.launch))return;this.impacts.push(impact);this.counts.committedImpacts++;
   for(const recipient of impact.recipients){
    const duplicate=this.contacts.find(c=>c.recipient.target===recipient.target&&Math.abs(impact.resolvedAt-c.time)<=.05);
    if(duplicate){this.counts.mergedContacts++;continue;}
    if(this.contacts.length>=128){this.counts.contactDrops++;continue;}
    this.contacts.push({launch:impact.launch,recipient,time:impact.resolvedAt});
   }
  }),game.events.on('shipSunk',({ship})=>{
   const tag=ship.architectPlatform;if(!tag||ship.withdrawn||game.over)return;
   const slot=tag.owner.architect?.slots[tag.index];if(!slot)return;
   if(this.deaths.length>=64)this.deaths.shift();
   this.deaths.push({owner:tag.owner,generation:game.battery.generation(tag.owner),target:ship,type:slot.type,slot:tag.index,point:{x:ship.pos.x,y:ship.pos.y+20,z:ship.pos.z},time:game.time,large:tag.owner.architect?.ultimate?.kind==='killbox'});
  }),game.events.on('gameOver',()=>this.clear()));
 }
 get stats(){return {machinery:this.machinery.stats,pools:Object.fromEntries(Object.entries(this.pools).map(([name,p])=>[name,{capacity:p.capacity,count:p.count,peak:p.peak,drops:p.drops}])),batches:Object.values(this.pools).filter(p=>p.count>0).length+(this.hazard.count?1:0),activeDeaths:this.deaths.length,activeFlights:this.flights.length,activeImpacts:this.impacts.length,activeContacts:this.contacts.length,activeHazards:this.dangers.size,...this.counts};}
 get count(){return Object.values(this.pools).reduce((n,p)=>n+p.count,0);}
 private valid(r:{owner:Ship;generation:number}){return !this.game.over&&r.owner.alive&&!r.owner.withdrawn&&!!r.owner.architect&&this.game.battery.generation(r.owner)===r.generation;}
 update(_dt=0){
  this.machinery.update();
  this.flights=this.flights.filter(r=>this.valid(r)&&this.game.time<r.arrivalTime+.3);
  this.deaths=this.deaths.filter(d=>this.valid(d)&&this.game.time-d.time<1.25);
  this.impacts=this.impacts.filter(e=>this.valid(e.launch)&&this.game.time-e.resolvedAt<(e.launch.stage===3?1.65:1.25));
  this.contacts=this.contacts.filter(c=>this.valid(c.launch)&&this.game.time-c.time<.6);
  for(const [key,d] of this.dangers)if(!this.valid(d)||this.game.time>d.until+.02)this.dangers.delete(key);
 }
 private surface(x:number,z:number){return Math.max(waveHeight(x,z,this.game.renderTime)+1,this.game.map.heightAt(x,z)+1);}
 private put(name:PoolName,x:number,y:number,z:number,sx:number,sy:number,sz:number,tint:Color|number,fade=1,rot=rotation.identity()){
  const p=this.pools[name],shared=name==='skirts'||name==='pressure';
  if(p.count>=p.capacity||shared&&this.pools.skirts.count+this.pools.pressure.count>=BATTERY_FX_CAPS.skirts){p.drops++;return;}
  if(fade<=.01||Math.min(sx,sy,sz)<=0)return;
  const n=p.count++;matrix.compose(position.set(x,y,z),rot,scale.set(sx,sy,sz));p.mesh.setMatrixAt(n,matrix);p.mesh.setColorAt(n,typeof tint==='number'?color.setHex(tint):tint);(p.mesh.geometry.getAttribute('instanceFade') as InstancedBufferAttribute).setX(n,clamp(fade));
 }
 private segment(name:PoolName,a:ArchitectBatteryPoint,b:ArchitectBatteryPoint,width:number,tint:Color|number,fade=1){
  direction.set(b.x-a.x,b.y-a.y,b.z-a.z);const len=direction.length();if(len<.01)return;rotation.setFromUnitVectors(axis,direction.divideScalar(len));this.put(name,(a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2,len/2,width,width,tint,fade,rotation);
 }
 private ring(x:number,y:number,z:number,r:number,tint:number,fade:number,tilt=Math.PI/2,yaw=0){
  rotation.setFromEuler(euler.set(tilt,yaw,0));this.put('skirts',x,y,z,r,r,r,tint,fade,rotation);
 }
 private bolt(a:ArchitectBatteryPoint,b:ArchitectBatteryPoint,width:number,tint:number,fade:number,seed:number){
  let last=a;
  const n=5;
  for(let i=1;i<=n;i++){const t=i/n,off=i===n?0:Math.sin(seed+i*7.3)*24,next={x:a.x+(b.x-a.x)*t+off,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t-off*.6};this.segment('arcs',last,next,width,tint,fade);last=next;}
 }
 private burst(launch:BurstSource,point:ArchitectBatteryPoint,age:number,head:number,semantic=false,blocked=false,deathSize=0){
  const finale=launch.stage===3&&!semantic,life=finale?1.65:semantic?.6:1.25;if(age<0||age>=life)return;
  const family=ARCHETYPES[launch.type].element,c=ARCHETYPES[launch.type].color,x=point.x,z=point.z,surface=semantic||deathSize?point.y:this.surface(x,z);
  const t=age/life,fade=1-clamp((t-.62)/.38),seed=launch.slot*7+head*11+launch.stage*3;
  const extent=(semantic?55:finale?420:265)*(blocked?.55:deathSize||1),grow=this.reduced?.78:Math.min(1,.18+age*4.8),r=extent*grow;
  if(semantic){
   // Two solid victim-attached stars are allocated before decorative world impacts.
   for(let i=0;i<2;i++)this.put('lobes',x+(i?18:-18),surface+15+i*20,z,extent*(i?.42:.65),extent*(i?.65:.42),extent*.45,blocked?0xa5b8c5:c,fade,rotation.setFromEuler(euler.set(.6,seed+i,1)));
   this.ring(x,surface+10,z,extent*(.4+grow),blocked?0xa5b8c5:c,fade);return;
  }
  if(age<.15)this.put('hot',x,surface+r*.18,z,r*.26,r*.36,r*.26,0xffffff,1-age/.17);
  const count=this.detail<1?5:7;
  if(family==='furnace'){
   // A white-hot plasma heart, molten lances and detached incandescent slabs.
   this.put('lobes',x,surface+r*.52,z,r*.48,r*.76,r*.48,0xff381b,fade);
   this.put('lobes',x,surface+r*.65,z,r*.26,r*.83,r*.26,0xffcc53,fade*.85);
   this.ring(x,surface+12,z,r,c,fade,.5*Math.PI,seed);
   for(let i=0;i<count;i++){
    const a=seed+i*Math.PI*2/count,rr=r*(.75+t*.6),yy=surface+35+Math.sin(Math.min(1,t*1.5)*Math.PI)*extent*(.7+(i%3)*.2),p={x:x+Math.cos(a)*rr,y:yy,z:z+Math.sin(a)*rr};
    rotation.setFromEuler(euler.set(.4,a,this.reduced?.2:t*2));this.put('fragments',p.x,p.y,p.z,extent*.085,extent*.25,extent*.075,c,fade,rotation);
    this.segment('arcs',{x:x+Math.cos(a)*r*.2,y:surface+35,z:z+Math.sin(a)*r*.2},p,8*fade,c,fade*.8);
   }
  }else if(family==='cryo'){
   // Upright crystal rupture; every spear is a real faceted volume.
   this.put('lobes',x,surface+r*.48,z,r*.3,r*.68,r*.3,0xb8faff,fade);
   this.ring(x,surface+10,z,r,c,fade);
   for(let i=0;i<count+2;i++){
    const a=seed+i*Math.PI*2/(count+2),rr=r*(.4+(i%3)*.22),height=extent*(.65+(i%3)*.22)*grow;
    rotation.setFromEuler(euler.set(Math.cos(a)*.3,a,Math.sin(a)*.3));
    this.put('fragments',x+Math.cos(a)*rr,surface+height*.65,z+Math.sin(a)*rr,extent*.13,height,extent*.1,i%2?c:0xe5ffff,fade,rotation);
   }
  }else if(family==='storm'){
   this.put('lobes',x,surface+r*.35,z,r*.28,r*.45,r*.28,c,fade*.7);
   this.ring(x,surface+25,z,r,c,fade);this.ring(x,surface+110,z,r*.72,0xd4baff,fade*.7,.25,seed);
   const top={x:x+Math.sin(seed)*50,y:surface+extent*2.1,z:z+Math.cos(seed)*50};
   this.bolt(top,{x,y:surface+10,z},12,c,fade,seed);
   for(let i=0;i<count;i++){const a=seed+i*Math.PI*2/count;this.bolt({x,y:surface+extent*.65,z},{x:x+Math.cos(a)*r,y:surface+15+(i%2)*110,z:z+Math.sin(a)*r},6,c,fade,seed+i);}
  }else if(family==='gravity'){
   const compress=this.reduced?.6:age<.25?1-age*2.7:.32+Math.min(1,(age-.25)/.15)*.95;
   this.put('lobes',x,surface+extent*.48,z,extent*.38*compress,extent*.38*compress,extent*.38*compress,0x160924,fade);
   for(let i=0;i<3;i++)this.ring(x,surface+extent*.48,z,extent*(.55+i*.16)*compress,c,fade,.35+i*.9,seed+i*.8);
   for(let i=0;i<count;i++){
    const a=seed+i*Math.PI*2/count,rr=r*(age<.25?1-age*2.5:.3+(age-.25)*1.6);
    rotation.setFromEuler(euler.set(a,seed,.7));this.put('fragments',x+Math.cos(a)*rr,surface+extent*(.25+.45*Math.sin(a)**2),z+Math.sin(a)*rr,extent*.06,extent*.3,extent*.06,c,fade,rotation);
   }
  }else{
   // Refraction cage: rotated diamonds and spectral polygon edges, no billowing mass.
   this.put('lobes',x,surface+r*.6,z,r*.36,r*.7,r*.36,0xfff1b1,fade*.8,rotation.setFromEuler(euler.set(.25,seed,.5)));
   const spectrum=[0xffe7a0,0xff8ed6,0xa4f9ff];
   for(let layer=0;layer<2;layer++)for(let i=0;i<6;i++){
    const a=seed+i*Math.PI/3+layer*.28,b=a+Math.PI/3,rr=r*(layer?.7:1),yy=surface+extent*(layer?.95:.22);
    const p={x:x+Math.cos(a)*rr,y:yy,z:z+Math.sin(a)*rr},next={x:x+Math.cos(b)*rr,y:yy,z:z+Math.sin(b)*rr};
    this.segment('arcs',p,next,5,spectrum[(i+layer)%3],fade);
    if(layer===0){this.segment('arcs',p,{x,y:surface+extent*1.7,z},3,c,fade*.8);this.put('fragments',p.x,p.y+extent*.18,p.z,extent*.075,extent*.34,extent*.075,spectrum[i%3],fade,rotation.setFromEuler(euler.set(.3,a,.4)));}
   }
  }
 }
 private pressure(launch:ArchitectBatteryLaunch,age:number){
  if(age<.06||age>.85)return;
  const t=(age-.06)/.79,r=this.reduced?launch.radius*.94:Math.min(launch.radius-40,260+t*launch.radius*1.1),fade=1-t;
  for(let i=0;i<12;i++){
   const a=i*Math.PI/6,span=.19,x=launch.center.x+Math.cos(a)*r,z=launch.center.z+Math.sin(a)*r;
   if(this.game.map.heightAt(x,z)>0||this.game.map.heightAt(launch.center.x+Math.cos(a-span)*r,launch.center.z+Math.sin(a-span)*r)>0||this.game.map.heightAt(launch.center.x+Math.cos(a+span)*r,launch.center.z+Math.sin(a+span)*r)>0)continue;
   rotation.setFromEuler(euler.set(0,-a-Math.PI/2,.025*(i%2?1:-1)));
   this.put('pressure',x,this.surface(x,z)+3,z,r*.17,3+8*fade,10+12*fade,ARCHETYPES[launch.type].color,fade,rotation);
  }
 }
 prepare(team:Team|-1,heightPx=720){
  this.update();this.machinery.prepare(team);for(const p of Object.values(this.pools))p.count=0;
  this.hazard.begin();this.hazard.material.uniforms.uViewportH.value=heightPx;
  // Public danger zones disclose the area, never an anchor ray or concealed source location.
  const active=new Map(this.dangers);
  for(const owner of this.game.ships){const u=owner.architect?.ultimate;if(u?.kind==='killbox'&&u.battery&&this.valid({owner,generation:u.battery.generation}))active.set(`${owner.id}:${u.battery.generation}:${u.battery.id}`,{owner,generation:u.battery.generation,castId:u.battery.id,center:{x:u.x,y:0,z:u.z},radius:1500,until:this.game.time+.1});}
  for(const d of active.values()){
   const tint=color.setHex(team===-1||team===d.owner.team?0xd7a454:0xff674c);
   for(let i=0;i<80;i++){if(i%5===4)continue;const a=i*Math.PI/40,b=(i+.8)*Math.PI/40,x=d.center.x+Math.sin(a)*d.radius,z=d.center.z+Math.cos(a)*d.radius,xx=d.center.x+Math.sin(b)*d.radius,zz=d.center.z+Math.cos(b)*d.radius;this.hazard.push(x,this.surface(x,z)+2,z,xx,this.surface(xx,zz)+2,zz,tint,.7,3,1.3);}
  }
  for(const c of this.contacts){if(team!==-1){const target=c.recipient.target,visible=target.alive?contactVisible(target,team):!target.withdrawn&&!target.mods.banished&&(target.team===team||!target.mods.untargetable&&!target.submerged&&!this.game.inSmoke(target.pos.x,target.pos.z));if(!visible)continue;}this.burst(c.launch,c.recipient,this.game.time-c.time,2,true,c.recipient.damage<=0);}
  for(const launch of this.flights){
   const duration=launch.arrivalTime-launch.launchTime,age=this.game.time-launch.launchTime,t=age/duration,platform=launch.owner.architect?.slots[launch.slot]?.entity,visible=!!platform&&(team===-1||contactVisible(platform,team)),c=ARCHETYPES[launch.type].color;
   for(const path of launch.paths){
    if(t<1){const p=sampleArchitectBatteryArc(path,t),next=sampleArchitectBatteryArc(path,Math.min(1,t+.01));direction.set(next.x-p.x,next.y-p.y,next.z-p.z).normalize();rotation.setFromUnitVectors(axis,direction);
     this.put('shells',p.x,p.y,p.z,launch.stage===3?27:21,launch.stage===3?13:10,launch.stage===3?13:10,c,1,rotation);
     this.put('hot',p.x,p.y,p.z,13,5,5,0xf2ffff,1,rotation);
    }
    // Samples refer to committed world positions, so the trail persists through Recall and impact.
    const linger=this.reduced?.14:.3,steps=this.detail<1?7:12,start=Math.max(0,age-linger),end=Math.min(duration,age);
    for(let i=0;i<steps;i++){
     const ta=start+(end-start)*i/steps,tb=start+(end-start)*(i+1)/steps;if(tb<=ta)continue;
     const f=clamp(1-(age-(ta+tb)/2)/linger),a=sampleArchitectBatteryArc(path,ta/duration),b=sampleArchitectBatteryArc(path,tb/duration);
     this.segment('trails',a,b,(launch.stage===3?17:12)*(.3+.7*f),c,f*.85);
     if(i%2===0)this.segment('arcs',a,b,2.5,c,f*.6);
    }
    if(visible&&age<.12){const d={x:path.control.x-path.muzzle.x,y:path.control.y-path.muzzle.y,z:path.control.z-path.muzzle.z},n=Math.hypot(d.x,d.y,d.z)||1;this.segment('hot',path.muzzle,{x:path.muzzle.x+d.x/n*70,y:path.muzzle.y+d.y/n*70,z:path.muzzle.z+d.z/n*70},24*(1-age/.15),c);}
   }
  }
  for(const d of this.deaths){
   const target=d.target;if(team!==-1&&target.team!==team&&(target.mods.untargetable||target.submerged||this.game.inSmoke(d.point.x,d.point.z)))continue;
   this.burst({type:d.type,slot:d.slot,stage:0},d.point,this.game.time-d.time,0,false,false,d.large?.7:.3);
  }
  for(const charge of this.machinery.charges)this.put('hot',charge.point.x,charge.point.y,charge.point.z,8+charge.strength*8,6+charge.strength*6,8+charge.strength*8,charge.color,.4+charge.strength*.6);
  // Shared finale pressure gets priority over secondary decorative skirts/fragments.
  const pressureDone=new Set<string>();for(const impact of this.impacts){const launch=impact.launch,key=`${launch.owner.id}:${launch.castId}`;if(launch.stage===3&&!pressureDone.has(key)){pressureDone.add(key);this.pressure(launch,this.game.time-impact.resolvedAt);}}
  for(const impact of this.impacts)for(const [head,path] of impact.launch.paths.entries())this.burst(impact.launch,path.impact,this.game.time-impact.resolvedAt,head);
  for(const p of Object.values(this.pools)){
   p.mesh.count=p.count;p.mesh.visible=p.count>0;p.peak=Math.max(p.peak,p.count);if(!p.count)continue;
   for(const attribute of [p.mesh.instanceMatrix,p.mesh.instanceColor,p.mesh.geometry.getAttribute('instanceFade') as InstancedBufferAttribute])if(attribute){attribute.clearUpdateRanges();attribute.addUpdateRange(0,p.count*attribute.itemSize);attribute.needsUpdate=true;}
  }
  this.hazard.end();this.hazard.mesh.visible=this.hazard.count>0;
 }
 private clear(){this.deaths=[];this.flights=[];this.impacts=[];this.contacts=[];this.dangers.clear();}
 dispose(){for(const off of this.off)off();this.clear();this.machinery.dispose();for(const p of Object.values(this.pools)){this.scene.remove(p.mesh);p.mesh.dispose();p.mesh.geometry.dispose();(p.mesh.material as MeshStandardMaterial).dispose();}this.scene.remove(this.hazard.mesh);this.hazard.dispose();}
}
