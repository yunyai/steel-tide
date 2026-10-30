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
import { MAX_DISTORTIONS, type SpatialDistortion } from './SpatialDistortion';

export const BATTERY_FX_CAPS={shells:128,lobes:384,fragments:384,skirts:96,hot:256,trails:1280,arcs:1280,corona:256} as const;
type PoolName=keyof typeof BATTERY_FX_CAPS|'pressure';
interface Pool {mesh:InstancedMesh;capacity:number;count:number;peak:number;drops:number}
interface Contact {launch:ArchitectBatteryLaunch;recipient:ArchitectBatteryRecipient;time:number}
interface Death {owner:Ship;generation:number;target:Ship;type:ArchitectType;slot:number;point:ArchitectBatteryPoint;time:number;large:boolean}
type BurstSource=Pick<ArchitectBatteryLaunch,'type'|'stage'|'slot'>;
interface Danger {owner:Ship;generation:number;castId:number;center:ArchitectBatteryPoint;radius:number;until:number}
const matrix=new Matrix4(),rotation=new Quaternion(),euler=new Euler(),position=new Vector3(),scale=new Vector3(),color=new Color(),direction=new Vector3(),axis=new Vector3(1,0,0);
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
const NEON={furnace:0xff3909,cryo:0x04dfff,storm:0x7134ff,gravity:0xff18b8,prism:0xffb900};
const energyColor=(type:ArchitectType)=>NEON[ARCHETYPES[type].element];

/** Solid luminous geometry keeps color and shape on presets without post-processing. */
function energyMaterial(emissive=1,volume=false,glowing=false):MeshStandardMaterial {
 const limit=glowing?3.2:1.15;
 const material=new MeshStandardMaterial({roughness:.32,metalness:.1,flatShading:!volume,emissive:0xffffff,emissiveIntensity:glowing?emissive:Math.min(1.15,emissive),transparent:volume,opacity:volume?.19:1,depthWrite:!volume,blending:volume?AdditiveBlending:NormalBlending,toneMapped:false});
 material.onBeforeCompile=shader=>{
  shader.vertexShader='attribute float instanceFade; varying float vBatteryFade;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
   vBatteryFade=instanceFade;${volume?'':'transformed*=smoothstep(0.,.45,instanceFade);'}`);
  shader.fragmentShader='varying float vBatteryFade;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\n#ifdef USE_COLOR\ntotalEmissiveRadiance*=vColor.rgb;\n#endif');
  if(volume)shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>',`#include <alphatest_fragment>
   diffuseColor.a*=vBatteryFade;`);
  // Bound each surface's radiance without desaturating it into a white patch under bloom.
  shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`outgoingLight/=max(1.,max(max(outgoingLight.r,outgoingLight.g),outgoingLight.b)/${limit.toFixed(2)});
   ${volume?'diffuseColor.a*=pow(abs(dot(normal,normalize(vViewPosition))),1.8);':''}
   #include <opaque_fragment>`);
 };
 material.customProgramCacheKey=()=>`battery-energy-${emissive}-${volume}-${glowing}`;return material;
}

/** Committed world-space travel/impacts; simulation ownership is checked without consulting a new ultimate. */
export class ArchitectBatteryFx {
 readonly machinery:ArchitectSiege;
 readonly hazard=new Ribbons(2400,false,false);
 readonly pools:Record<PoolName,Pool>;
 readonly distortions:SpatialDistortion[]=[];
 private deaths:Death[]=[];private flights:ArchitectBatteryLaunch[]=[];private impacts:ArchitectBatteryImpact[]=[];private contacts:Contact[]=[];private dangers=new Map<string,Danger>();
 private off:(()=>void)[]=[];private reduced=reducedMotion();private detail=quality().particles;
 private counts={mergedContacts:0,contactDrops:0,committedLaunches:0,committedImpacts:0};
 constructor(private scene:Scene,private game:Game){
  this.machinery=new ArchitectSiege(scene,game);
  const make=(name:PoolName,geometry:BufferGeometry,capacity:number,emissive=0):Pool=>{
   geometry.setAttribute('instanceFade',new InstancedBufferAttribute(new Float32Array(capacity),1).setUsage(DynamicDrawUsage));
   const mesh=new InstancedMesh(geometry,energyMaterial(emissive,name==='trails'||name==='corona',['shells','hot','arcs','skirts'].includes(name)),capacity);mesh.name=`architect-battery-fx-${name}`;mesh.count=0;mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(DynamicDrawUsage);mesh.receiveShadow=false;scene.add(mesh);return {mesh,capacity,count:0,peak:0,drops:0};
  };
  this.pools={shells:make('shells',new OctahedronGeometry(1,0),128,2.8),lobes:make('lobes',new IcosahedronGeometry(1,1),384,.65),fragments:make('fragments',new OctahedronGeometry(1,0),384,1.5),skirts:make('skirts',new TorusGeometry(1,.026,4,32),96,2),hot:make('hot',new OctahedronGeometry(1,0),256,3),pressure:make('pressure',new BoxGeometry(1,1,1),96,1.6),trails:make('trails',new CylinderGeometry(1,1,2,6).rotateZ(Math.PI/2),1280,1.5),arcs:make('arcs',new BoxGeometry(2,1,1),1280,2.4),corona:make('corona',new IcosahedronGeometry(1,1),256,1.1)};
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
  const family=ARCHETYPES[launch.type].element,c=energyColor(launch.type),x=point.x,z=point.z,surface=semantic||deathSize?point.y:this.surface(x,z);
  const t=age/life,fade=1-clamp((t-.62)/.38),seed=launch.slot*7+head*11+launch.stage*3;
  const extent=(semantic?55:finale?510:335)*(blocked?.55:deathSize||1),grow=this.reduced?.82:Math.min(1,.18+age*4.8),r=extent*grow;
  if(semantic){
   // Two solid victim-attached stars are allocated before decorative world impacts.
   for(let i=0;i<2;i++)this.put('lobes',x+(i?18:-18),surface+15+i*20,z,extent*(i?.42:.65),extent*(i?.65:.42),extent*.45,blocked?0xa5b8c5:c,fade,rotation.setFromEuler(euler.set(.6,seed+i,1)));
   this.ring(x,surface+10,z,extent*(.4+grow),blocked?0xa5b8c5:c,fade);return;
  }
  if(!this.reduced&&age<.15)this.put('hot',x,surface+r*.18,z,r*.075,r*.2,r*.075,0xfff3cf,1-age/.17);
  const count=this.detail<1||this.impacts.length>20?4:6;
  // A colored volume surrounds the rigid family silhouette, never an opaque smoke ball.
  this.put('corona',x,surface+r*.55,z,r*.7,r*1.08,r*.7,c,fade*.8);
  if(family==='furnace'){
   // Tall plasma blades curl around a narrow incandescent heart.
   this.put('lobes',x,surface+r*.7,z,r*.16,r*1.05,r*.16,c,fade);
   this.put('lobes',x,surface+r*.63,z,r*.07,r*.8,r*.07,0xffc21b,fade);
   this.ring(x,surface+12,z,r,c,fade);
   for(let i=0;i<count;i++){
    const a=seed+i*Math.PI*2/count,rr=r*(.55+t*.35),yy=surface+55+Math.sin(Math.min(1,t*1.5)*Math.PI)*extent*(.8+(i%3)*.25),p={x:x+Math.cos(a)*rr,y:yy,z:z+Math.sin(a)*rr};
    rotation.setFromEuler(euler.set(Math.cos(a)*.5,a,Math.sin(a)*.5));this.put('fragments',p.x,p.y,p.z,extent*.07,extent*.42,extent*.06,i%2?c:0xffa617,fade,rotation);
    const root={x:x+Math.cos(a)*r*.16,y:surface+20,z:z+Math.sin(a)*r*.16};
    this.segment('trails',root,p,extent*.085,c,fade);this.segment('arcs',root,p,7*fade,0xff8711,fade);
   }
  }else if(family==='cryo'){
   // Upright crystal rupture; every spear is a real faceted volume.
   this.put('lobes',x,surface+r*.48,z,r*.16,r*.8,r*.16,0x18b4ff,fade);
   this.ring(x,surface+10,z,r,c,fade);
   for(let i=0;i<count+2;i++){
    const a=seed+i*Math.PI*2/(count+2),rr=r*(.4+(i%3)*.22),height=extent*(.65+(i%3)*.22)*grow;
    rotation.setFromEuler(euler.set(Math.cos(a)*.3,a,Math.sin(a)*.3));
    this.put('fragments',x+Math.cos(a)*rr,surface+height*.65,z+Math.sin(a)*rr,extent*.1,height,extent*.075,i%2?c:0x2585ff,fade,rotation);
    if(i%2===0)this.segment('arcs',{x:x+Math.cos(a)*rr,y:surface+height*.3,z:z+Math.sin(a)*rr},{x:x+Math.cos(a)*rr*.7,y:surface+height*1.55,z:z+Math.sin(a)*rr*.7},3,0x8cfaff,fade);
   }
  }else if(family==='storm'){
   this.put('lobes',x,surface+r*.35,z,r*.17,r*.5,r*.17,0x4a20ed,fade);
   this.ring(x,surface+25,z,r,c,fade);this.ring(x,surface+110,z,r*.72,0x237aff,fade*.7,.25,seed);
   const top={x:x+Math.sin(seed)*50,y:surface+extent*2.3,z:z+Math.cos(seed)*50};
   this.segment('trails',top,{x,y:surface+10,z},34,c,fade);
   this.bolt(top,{x,y:surface+10,z},13,0x7850ff,fade,seed);
   this.bolt(top,{x:x+90,y:surface+10,z:z-60},5,0x68e7ff,fade*.8,seed+2);
   for(let i=0;i<count;i++){const a=seed+i*Math.PI*2/count;this.bolt({x,y:surface+extent*.65,z},{x:x+Math.cos(a)*r,y:surface+15+(i%2)*110,z:z+Math.sin(a)*r},6,c,fade,seed+i);}
  }else if(family==='gravity'){
   const compress=this.reduced?.6:age<.25?1-age*2.7:.32+Math.min(1,(age-.25)/.15)*.95;
   if(!this.reduced&&this.distortions.length<MAX_DISTORTIONS)this.distortions.push({x,y:surface+extent*.48,z,radius:extent*.9,strength:fade*.4,priority:1});
   this.put('lobes',x,surface+extent*.48,z,extent*.36*compress,extent*.36*compress,extent*.36*compress,0x08021c,fade);
   for(let i=0;i<3;i++)this.ring(x,surface+extent*.48,z,extent*(.55+i*.16)*compress,c,fade,.35+i*.9,seed+i*.8);
   for(let i=0;i<count;i++){
    const a=seed+i*Math.PI*2/count,rr=r*(age<.25?1-age*2.5:.3+(age-.25)*1.6);
    rotation.setFromEuler(euler.set(a,seed,.7));this.put('fragments',x+Math.cos(a)*rr,surface+extent*(.25+.45*Math.sin(a)**2),z+Math.sin(a)*rr,extent*.06,extent*.3,extent*.06,c,fade,rotation);
   }
  }else{
   // Refraction cage: rotated diamonds and spectral polygon edges, no billowing mass.
   this.put('lobes',x,surface+r*.6,z,r*.13,r*.75,r*.13,0xffa71b,fade,rotation.setFromEuler(euler.set(.25,seed,.5)));
   const spectrum=[0xffc600,0xff18c4,0x08dfff];
   for(let layer=0;layer<2;layer++)for(let i=0;i<6;i++){
    const a=seed+i*Math.PI/3+layer*.28,b=a+Math.PI/3,rr=r*(layer?.7:1),yy=surface+extent*(layer?.95:.22);
    const p={x:x+Math.cos(a)*rr,y:yy,z:z+Math.sin(a)*rr},next={x:x+Math.cos(b)*rr,y:yy,z:z+Math.sin(b)*rr};
    this.segment('arcs',p,next,7,spectrum[(i+layer)%3],fade);
    if(layer===0){this.segment('arcs',p,{x,y:surface+extent*1.7,z},5,spectrum[i%3],fade);this.put('fragments',p.x,p.y+extent*.18,p.z,extent*.075,extent*.4,extent*.035,spectrum[i%3],fade,rotation.setFromEuler(euler.set(.3,a,.4)));}
   }
  }
  // Secondary jets and branching ground fractures carry impact energy into the surrounding water.
  // Fixed world seeds are stable under reduced motion and never create additional hit events.
  if(!deathSize){
   const secondaryAge=age-.18,secondary=clamp(secondaryAge/.18)*(1-clamp((age-.85)/.4));
   for(let i=0;i<(this.detail<1?2:3);i++){
    const a=seed+i*2.4,rr=r*(.68+(i%2)*.18),xx=x+Math.cos(a)*rr,zz=z+Math.sin(a)*rr,yy=this.surface(xx,zz)+10;
    const start={x,y:surface+7,z},middle={x:x+Math.cos(a+.23)*rr*.55,y:this.surface(x+Math.cos(a+.23)*rr*.55,z+Math.sin(a+.23)*rr*.55)+7,z:z+Math.sin(a+.23)*rr*.55},end={x:xx,y:yy,z:zz};
    this.segment('arcs',start,middle,4,c,fade);this.segment('arcs',middle,end,3,c,fade);
    if(secondary>0){
     const tip={x:xx+Math.cos(a)*40,y:yy+extent*(.45+(i%2)*.25)*secondary,z:zz+Math.sin(a)*40};
     this.segment('trails',end,tip,extent*.07,c,fade*secondary);
     this.put('fragments',tip.x,tip.y,tip.z,extent*.035,extent*.16,extent*.035,c,fade*secondary,rotation.setFromEuler(euler.set(.3,a,.5)));
    }
   }
   if(age>.12)this.ring(x,surface+6,z,r*(this.reduced?1.08:.85+age*.65),c,fade*.5);
  }
 }
 private pressure(launch:ArchitectBatteryLaunch,age:number){
  if(age<.06||age>.85)return;
  const t=(age-.06)/.79,r=this.reduced?launch.radius*.94:Math.min(launch.radius-40,260+t*launch.radius*1.1),fade=1-t;
  for(let i=0;i<12;i++){
   const a=i*Math.PI/6,span=.19,x=launch.center.x+Math.cos(a)*r,z=launch.center.z+Math.sin(a)*r;
   if(this.game.map.heightAt(x,z)>0||this.game.map.heightAt(launch.center.x+Math.cos(a-span)*r,launch.center.z+Math.sin(a-span)*r)>0||this.game.map.heightAt(launch.center.x+Math.cos(a+span)*r,launch.center.z+Math.sin(a+span)*r)>0)continue;
   rotation.setFromEuler(euler.set(0,-a-Math.PI/2,.025*(i%2?1:-1)));
   this.put('pressure',x,this.surface(x,z)+3,z,r*.17,3+8*fade,10+12*fade,energyColor(launch.type),fade,rotation);
  }
  // One coordinated crown per cast ties the simultaneous detonations into a single storm.
  const spectrum=[NEON.furnace,NEON.cryo,NEON.storm,NEON.gravity,NEON.prism];
  for(let spoke=0;spoke<5;spoke++){
   const angle=spoke*Math.PI*2/5,turn=this.reduced?0:t*.35;
   let last:ArchitectBatteryPoint|undefined;
   for(let n=0;n<=6;n++){
    const f=n/6,a=angle+f*1.2+turn,rr=launch.radius*(.16+.65*f),x=launch.center.x+Math.cos(a)*rr,z=launch.center.z+Math.sin(a)*rr;
    const next={x,y:this.surface(x,z)+Math.sin(f*Math.PI)*720+20,z};
    if(last)this.segment('arcs',last,next,7,spectrum[spoke],fade*.7);last=next;
   }
  }
 }
 prepare(team:Team|-1,heightPx=720){
  this.update();this.machinery.prepare(team);this.distortions.length=0;for(const p of Object.values(this.pools))p.count=0;
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
   const duration=launch.arrivalTime-launch.launchTime,age=this.game.time-launch.launchTime,t=age/duration,platform=launch.owner.architect?.slots[launch.slot]?.entity,visible=!!platform&&(team===-1||contactVisible(platform,team)),c=energyColor(launch.type);
   for(const path of launch.paths){
    if(t<1){const p=sampleArchitectBatteryArc(path,t),next=sampleArchitectBatteryArc(path,Math.min(1,t+.01));direction.set(next.x-p.x,next.y-p.y,next.z-p.z).normalize();rotation.setFromUnitVectors(axis,direction);
     this.put('shells',p.x,p.y,p.z,launch.stage===3?42:32,launch.stage===3?21:15,launch.stage===3?21:15,c,1,rotation);
     this.put('hot',p.x,p.y,p.z,15,4,4,0xf2ffff,1,rotation);
    }
    // Samples refer to committed world positions, so the trail persists through Recall and impact.
    const linger=this.reduced?.14:.3,steps=this.detail<1?7:12,start=Math.max(0,age-linger),end=Math.min(duration,age);
    for(let i=0;i<steps;i++){
     const ta=start+(end-start)*i/steps,tb=start+(end-start)*(i+1)/steps;if(tb<=ta)continue;
     const f=clamp(1-(age-(ta+tb)/2)/linger),a=sampleArchitectBatteryArc(path,ta/duration),b=sampleArchitectBatteryArc(path,tb/duration);
     this.segment('trails',a,b,(launch.stage===3?33:24)*(.3+.7*f),c,f*.85);
     if(i%2===0)this.segment('arcs',a,b,5,c,f*.8);
    }
    if(visible&&age<(this.reduced?.2:.24)){
     const d={x:path.control.x-path.muzzle.x,y:path.control.y-path.muzzle.y,z:path.control.z-path.muzzle.z},n=Math.hypot(d.x,d.y,d.z)||1,end={x:path.muzzle.x+d.x/n*155,y:path.muzzle.y+d.y/n*155,z:path.muzzle.z+d.z/n*155},fade=1-age/.25;
     this.segment('trails',path.muzzle,end,42,c,fade);
     if(!this.reduced)this.segment('hot',path.muzzle,end,13*fade,c,fade);
    }
   }
  }
  for(const d of this.deaths){
   const target=d.target;if(team!==-1&&target.team!==team&&(target.mods.untargetable||target.submerged||this.game.inSmoke(d.point.x,d.point.z)))continue;
   this.burst({type:d.type,slot:d.slot,stage:0},d.point,this.game.time-d.time,0,false,false,d.large?.7:.3);
  }
  for(const charge of this.machinery.charges)this.put('hot',charge.point.x,charge.point.y,charge.point.z,8+charge.strength*8,6+charge.strength*6,8+charge.strength*8,charge.color,.4+charge.strength*.6);
  // Shared finale pressure gets priority over secondary decorative skirts/fragments.
  const pressureDone=new Set<string>();for(const impact of this.impacts){const launch=impact.launch,key=`${launch.owner.id}:${launch.castId}`;if(launch.stage===3&&!pressureDone.has(key)){pressureDone.add(key);this.pressure(launch,this.game.time-impact.resolvedAt);}}
  const linked=new Map<string,ArchitectBatteryImpact>();
  for(const impact of this.impacts){
   const launch=impact.launch,key=`${launch.owner.id}:${launch.castId}:${launch.stage}`,previous=linked.get(key);
   if(previous){const age=this.game.time-impact.resolvedAt,fade=clamp(1-age/1.2),a=previous.launch.paths[0].impact,b=launch.paths[0].impact;
    // Only public impact cells connect; these arcs cannot disclose concealed launch machinery.
    this.bolt({x:a.x,y:a.y+50,z:a.z},{x:b.x,y:b.y+50,z:b.z},4,energyColor(launch.type),fade*.65,launch.slot);
   }
   linked.set(key,impact);
  }
  for(const impact of this.impacts)for(const [head,path] of impact.launch.paths.entries())this.burst(impact.launch,path.impact,this.game.time-impact.resolvedAt,head);
  for(const p of Object.values(this.pools)){
   p.mesh.count=p.count;p.mesh.visible=p.count>0;p.peak=Math.max(p.peak,p.count);if(!p.count)continue;
   for(const attribute of [p.mesh.instanceMatrix,p.mesh.instanceColor,p.mesh.geometry.getAttribute('instanceFade') as InstancedBufferAttribute])if(attribute){attribute.clearUpdateRanges();attribute.addUpdateRange(0,p.count*attribute.itemSize);attribute.needsUpdate=true;}
  }
  this.hazard.end();this.hazard.mesh.visible=this.hazard.count>0;
 }
 private clear(){this.deaths=[];this.flights=[];this.impacts=[];this.contacts=[];this.dangers.clear();this.distortions.length=0;}
 dispose(){for(const off of this.off)off();this.clear();this.machinery.dispose();for(const p of Object.values(this.pools)){this.scene.remove(p.mesh);p.mesh.dispose();p.mesh.geometry.dispose();(p.mesh.material as MeshStandardMaterial).dispose();}this.scene.remove(this.hazard.mesh);this.hazard.dispose();}
}
