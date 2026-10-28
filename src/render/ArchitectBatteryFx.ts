import { BoxGeometry, BufferGeometry, Color, DynamicDrawUsage, Euler, IcosahedronGeometry, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshStandardMaterial, OctahedronGeometry, Quaternion, SphereGeometry, Vector3, type Scene } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Game } from '../core/Game';
import type { Ship } from '../ships/Ship';
import type { Team } from '../core/types';
import { ARCHETYPES } from '../data/architectLoadout';
import type { ArchitectBatteryImpact, ArchitectBatteryLaunch, ArchitectBatteryPoint, ArchitectBatteryRecipient } from '../data/architectBattery';
import { sampleArchitectBatteryArc } from '../skills/misc/ArchitectBatteryPose';
import { contactVisible } from '../core/Targeting';
import { waveHeight } from '../world/Waves';
import { reducedMotion } from './ArchitectPose';
import { quality } from './Quality';
import { Ribbons } from './Projectiles';
import { ArchitectSiege } from './ArchitectSiege';

export const BATTERY_FX_CAPS={shells:128,lobes:384,fragments:384,skirts:96,hot:96} as const;
type PoolName=keyof typeof BATTERY_FX_CAPS|'pressure';
interface Pool {mesh:InstancedMesh;capacity:number;count:number;peak:number;drops:number}
interface Contact {launch:ArchitectBatteryLaunch;recipient:ArchitectBatteryRecipient;time:number}
interface Danger {owner:Ship;generation:number;castId:number;center:ArchitectBatteryPoint;radius:number;until:number}
const matrix=new Matrix4(),rotation=new Quaternion(),euler=new Euler(),position=new Vector3(),scale=new Vector3(),color=new Color(),direction=new Vector3(),axis=new Vector3(1,0,0);
const dark=new Color(0x53616b),hot=new Color();
const clamp=(v:number)=>Math.max(0,Math.min(1,v));

function brokenCrown():BufferGeometry {
 const parts:BufferGeometry[]=[];
 for(let i=0;i<11;i++){
  if(i===3||i===8)continue;
  const a=i*Math.PI*2/11,r=.7+((i*7)%5)*.035,h=.32+((i*13)%7)*.065;
  const jet=new SphereGeometry(1,8,5),cap=new SphereGeometry(1,7,4);
  jet.scale(.15,.25+h*.2,.12);jet.rotateZ(Math.sin(a)*.35);jet.translate(Math.cos(a)*r,.15,Math.sin(a)*r);
  cap.scale(.1,.16+h*.15,.09);cap.translate(Math.cos(a)*(r+.065),h*.72,Math.sin(a)*(r+.065));parts.push(jet,cap);
 }
 const geometry=mergeGeometries(parts)!;parts.forEach(p=>p.dispose());return geometry;
}
function massGeometry():BufferGeometry {
 // Each instance is a connected, smooth billow with several uneven shoulders. Avoid
 // a single closed ellipsoid: the silhouette needs to break up as steam rises.
 const pieces:BufferGeometry[]=[],low=quality().particles<1;
 for(const [x,y,z,sx,sy,sz] of [[0,0,0,.65,.76,.62],[-.48,-.12,.12,.48,.49,.48],[.43,-.18,.23,.5,.57,.46],[-.23,.52,-.12,.47,.5,.44],[.24,.49,.15,.46,.48,.47],[.05,-.4,-.3,.55,.42,.48]]){
  const sphere=new SphereGeometry(1,low?8:10,low?5:7);sphere.scale(sx,sy,sz);sphere.translate(x,y,z);pieces.push(sphere);
 }
 const geometry=mergeGeometries(pieces)!;pieces.forEach(p=>p.dispose());return geometry;
}
function opaqueMaterial(emissive=0,smoke=false):MeshStandardMaterial {
 const material=new MeshStandardMaterial({roughness:.94,metalness:.08,flatShading:!smoke,emissive,emissiveIntensity:emissive?.8:0});
 material.onBeforeCompile=shader=>{
  shader.vertexShader='attribute float instanceFade; varying float vBatteryFade; varying vec3 vBatteryLocal;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvBatteryFade=instanceFade;vBatteryLocal=position;');
  // Opaque, depth-writing mass with a stationary spatial fade. No alpha-sorted blast domes.
  shader.fragmentShader='varying float vBatteryFade; varying vec3 vBatteryLocal;\n'+shader.fragmentShader;
  if(smoke)shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
   float grain=sin(vBatteryLocal.x*17.+sin(vBatteryLocal.y*9.))*sin(vBatteryLocal.z*13.+cos(vBatteryLocal.x*8.));diffuseColor.rgb*=.9+.1*grain;`);
  shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\ntotalEmissiveRadiance*=vColor.rgb;\n#endif');
  shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>',`#include <alphatest_fragment>
    float d=fract(sin(dot(floor(gl_FragCoord.xy),vec2(12.9898,78.233)))*43758.5453);if(d>vBatteryFade)discard;`);
 };
 material.customProgramCacheKey=()=>`battery-opaque-dither-${emissive}-${smoke}`;return material;
}

/** Committed world-space travel/impacts; simulation ownership is checked without consulting a new ultimate. */
export class ArchitectBatteryFx {
 readonly machinery:ArchitectSiege;
 readonly hazard=new Ribbons(2400,false,false);
 readonly pools:Record<PoolName,Pool>;
 private flights:ArchitectBatteryLaunch[]=[];private impacts:ArchitectBatteryImpact[]=[];private contacts:Contact[]=[];private dangers=new Map<string,Danger>();
 private off:(()=>void)[]=[];private reduced=reducedMotion();private detail=quality().particles;
 private counts={mergedContacts:0,contactDrops:0,committedLaunches:0,committedImpacts:0};
 constructor(private scene:Scene,private game:Game){
  this.machinery=new ArchitectSiege(scene,game);
  const make=(name:PoolName,geometry:BufferGeometry,capacity:number,emissive=0):Pool=>{
   geometry.setAttribute('instanceFade',new InstancedBufferAttribute(new Float32Array(capacity),1).setUsage(DynamicDrawUsage));
   const mesh=new InstancedMesh(geometry,opaqueMaterial(emissive,name==='lobes'),capacity);mesh.name=`architect-battery-fx-${name}`;mesh.count=0;mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(DynamicDrawUsage);mesh.receiveShadow=false;scene.add(mesh);return {mesh,capacity,count:0,peak:0,drops:0};
  };
  this.pools={shells:make('shells',new OctahedronGeometry(1,0),128,0x282016),lobes:make('lobes',massGeometry(),384),fragments:make('fragments',new IcosahedronGeometry(1,0),384),skirts:make('skirts',brokenCrown(),96),hot:make('hot',new OctahedronGeometry(1,0),96,0xffffff),pressure:make('pressure',new BoxGeometry(1,1,1),96)};
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
  }),game.events.on('gameOver',()=>this.clear()));
 }
 get stats(){return {machinery:this.machinery.stats,pools:Object.fromEntries(Object.entries(this.pools).map(([name,p])=>[name,{capacity:p.capacity,count:p.count,peak:p.peak,drops:p.drops}])),batches:Object.values(this.pools).filter(p=>p.count>0).length+(this.hazard.count?1:0),activeFlights:this.flights.length,activeImpacts:this.impacts.length,activeContacts:this.contacts.length,activeHazards:this.dangers.size,...this.counts};}
 get count(){return Object.values(this.pools).reduce((n,p)=>n+p.count,0);}
 private valid(r:{owner:Ship;generation:number}){return !this.game.over&&r.owner.alive&&!r.owner.withdrawn&&!!r.owner.architect&&this.game.battery.generation(r.owner)===r.generation;}
 update(_dt=0){
  this.machinery.update();
  this.flights=this.flights.filter(r=>this.valid(r)&&this.game.time<r.arrivalTime);
  this.impacts=this.impacts.filter(e=>this.valid(e.launch)&&this.game.time-e.resolvedAt<(e.launch.stage===3?1.4:1.1));
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
 private burst(launch:ArchitectBatteryLaunch,point:ArchitectBatteryPoint,age:number,head:number,semantic=false,blocked=false){
  const finale=launch.stage===3&&!semantic,life=finale?1.4:semantic?.6:1.1;if(age<0||age>=life)return;
  const type=launch.type,family=ARCHETYPES[type].element,c=ARCHETYPES[type].color;
  const ground=this.game.map.heightAt(point.x,point.z),surface=semantic?point.y:this.surface(point.x,point.z),x=point.x,z=point.z;
  const size=blocked?.38:semantic?.58:finale?1.55:1,seed=launch.slot*7+head*11+launch.stage*3;
  if(age<.065){const r=(semantic?34:finale?55:42)*Math.max(.25,1-age/.08);this.put('hot',x,surface+r*.65,z,r,r*.65,r,blocked?0xcddae0:0xffe4b7);}
  // Actual hull contacts reserve the first allocations. Decorative smoke/fragments follow them.
  if(age>=.035){
   const n=semantic?2:this.detail<1?3:4;
   for(let i=0;i<n;i++){
    const localAge=age-i*.012;if(localAge<.025)continue;
    const rise=clamp(localAge/.22),smoke=clamp((localAge-.22)/.4),fade=1-clamp((localAge-(semantic?.3:.7))/(semantic?.3:life-.7));
    const angle=seed+i*2.39996,rr=(i?29+i*7:8)*size*rise,base=(i?42+i*4:54)*size*(.3+.7*Math.sqrt(rise));
    const compress=family==='gravity'&&age<.13?1.35-age*3:1;
    const height=(.84+((seed+i*7)%11)*.026)*(type==='abyss'?1.55:family==='cryo'?1.1:1)*(i===0?1.3:1),sy=base*height*(1+smoke*.22);
    hot.setHex(blocked?0x7d919d:family==='cryo'?0x9baeb7:family==='gravity'?0x45434b:family==='prism'?0x84939d:i===0&&age<.12?0xac997d:0x64727b);hot.lerp(dark,Math.min(1,smoke*(family==='cryo'?.75:1.3)));
    rotation.setFromEuler(euler.set(i*.37,angle,i*.19));
    this.put('lobes',x+Math.cos(angle)*rr*compress,surface+sy+smoke*(finale?85:54)+Math.sin(seed+i)*12*rise,z+Math.sin(angle)*rr*compress,base,sy,base*(.69+i*.07),hot,fade,rotation);
   }
  }
  if(type==='resonance'&&(age<.055||age>.13&&age<.185))for(const side of [-1,1])this.segment('hot',{x:x-35,y:surface+15+side*9,z:z+side*15},{x:x+35,y:surface+22+side*9,z:z-side*15},3,c);
  if(!semantic&&age>.075&&age<.45){
   const t=(age-.075)/.375,rad=(finale?165:108)*(.35+.65*Math.sqrt(t));
   this.put('skirts',x,surface,z,rad,(ground<0?66:48)*(1-t)*size,rad,ground<0?0xc7d4d9:0x756d60,1-clamp((t-.75)/.25),rotation.setFromEuler(euler.set(0,seed,0)));
  }
  if(age>.1&&age<.7){
   const n=semantic?2:this.detail<1?3:6,t=(age-.1)/.6;
   for(let i=0;i<n;i++){
    const a=seed+i*2.39996,gravity=family==='gravity',out=gravity?(t<.2?.35*(1-t/.2):.9*(t-.2)/.8):t;
    const rad=(semantic?65:finale?240:150)*out,xx=x+Math.cos(a)*rad,zz=z+Math.sin(a)*rad,yy=Math.max(this.surface(xx,zz)+5,surface+12+Math.sin(t*Math.PI)*(semantic?45:finale?180:110));
    const shard=family==='prism'||family==='cryo',slab=type==='bastion';rotation.setFromEuler(euler.set(this.reduced?0:t*4+i,a,this.reduced?0:t*3));
    hot.setHex(c).lerp(dark,clamp(t*1.4));this.put('fragments',xx,yy,zz,(slab?22:shard?4:7)*size,(shard?22:slab?8:10)*size,(slab?15:6)*size,hot,1-t,rotation);
    if((family==='storm'||type==='resonance')&&i<2&&age<.26){const b={x:xx+12,y:yy+18,z:zz-8};this.segment('hot',{x:xx,y:yy,z:zz},b,2,c,1-t);}
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
   this.put('pressure',x,this.surface(x,z)+3,z,r*.17,3+8*fade,10+12*fade,0xc2cec8,fade,rotation);
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
   const age=this.game.time-launch.launchTime,t=age/(launch.arrivalTime-launch.launchTime),platform=launch.owner.architect?.slots[launch.slot]?.entity,visible=!!platform&&(team===-1||contactVisible(platform,team));
   for(const path of launch.paths){
    const p=sampleArchitectBatteryArc(path,t),next=sampleArchitectBatteryArc(path,Math.min(1,t+.01));direction.set(next.x-p.x,next.y-p.y,next.z-p.z).normalize();rotation.setFromUnitVectors(axis,direction);
    this.put('shells',p.x,p.y,p.z,launch.stage===3?20:15,launch.stage===3?9:7,launch.stage===3?9:7,0xcab79b,1,rotation);
    if(!this.reduced)this.segment('hot',{x:p.x-direction.x*32,y:p.y-direction.y*32,z:p.z-direction.z*32},p,3,ARCHETYPES[launch.type].color,.8);
    if(visible&&age<.12){const d={x:path.control.x-path.muzzle.x,y:path.control.y-path.muzzle.y,z:path.control.z-path.muzzle.z},n=Math.hypot(d.x,d.y,d.z)||1;this.segment('hot',path.muzzle,{x:path.muzzle.x+d.x/n*55,y:path.muzzle.y+d.y/n*55,z:path.muzzle.z+d.z/n*55},22*(1-age/.15),0xffd69a);}
   }
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
 private clear(){this.flights=[];this.impacts=[];this.contacts=[];this.dangers.clear();}
 dispose(){for(const off of this.off)off();this.clear();this.machinery.dispose();for(const p of Object.values(this.pools)){this.scene.remove(p.mesh);p.mesh.dispose();p.mesh.geometry.dispose();(p.mesh.material as MeshStandardMaterial).dispose();}this.scene.remove(this.hazard.mesh);this.hazard.dispose();}
}
