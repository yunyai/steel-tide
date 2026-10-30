import { Color, Vector3, type Scene } from 'three';
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
import { BK, BurstParticles, drift, driftSpeed, hash01 } from './BurstParticles';

export const BATTERY_PARTICLE_CAPS={additive:6144,alpha:1280,flat:640} as const;
interface Contact {launch:ArchitectBatteryLaunch;recipient:ArchitectBatteryRecipient;time:number}
type BurstSource=Pick<ArchitectBatteryLaunch,'id'|'type'|'stage'|'slot'>;
interface Danger {owner:Ship;generation:number;castId:number;center:ArchitectBatteryPoint;radius:number;until:number}
const TAU=Math.PI*2,clamp=(v:number)=>Math.max(0,Math.min(1,v)),ease=(v:number)=>1-(1-clamp(v))**3;
const NEON={furnace:0xff3909,cryo:0x04dfff,storm:0x7134ff,gravity:0xff18b8,prism:0xffb900};
const SPECTRUM=[0xff3b30,0xffb900,0x3cff7a,0x04dfff,0x7134ff,0xff18b8];
const WHITE_HOT=0xfff4dc,SMOKE_DARK=0x272b31,SMOKE_LIGHT=0x6b7178,SPRAY=0xdcecf2,FOAM=0xe8f4f8;
const energyColor=(type:ArchitectType)=>NEON[ARCHETYPES[type].element];
const tint=new Color(),from=new Color(),to=new Color(),dir=new Vector3(),side=new Vector3(),lift=new Vector3(),UP=new Vector3(0,1,0);
const hot=(hex:number,k=1)=>tint.setHex(hex).multiplyScalar(k);
const blend=(a:number,b:number,f:number,k=1)=>tint.copy(from.setHex(a)).lerp(to.setHex(b),clamp(f)).multiplyScalar(k);
const at={x:0,y:0,z:0},vel={x:0,y:0,z:0};
function fly(t:number,vx:number,vy:number,vz:number,k:number,g:number){at.x=drift(t,vx,k);at.y=drift(t,vy,k,g);at.z=drift(t,vz,k);}
function flyVel(t:number,vx:number,vy:number,vz:number,k:number,g:number){vel.x=driftSpeed(t,vx,k);vel.y=driftSpeed(t,vy,k,g);vel.z=driftSpeed(t,vz,k);}
const bolt:ArchitectBatteryPoint[]=[];

/** Committed world-space travel/impacts; simulation ownership is checked without consulting a new ultimate. */
export class ArchitectBatteryFx {
 readonly machinery:ArchitectSiege;
 readonly hazard=new Ribbons(2400,false,false);
 /** Additive lightning, trail cores and link arcs. */
 readonly streaks=new Ribbons(1536,true,false);
 readonly particles:BurstParticles;
 readonly distortions:SpatialDistortion[]=[];
 /** Shell heads drawn this prepare, at their committed arc positions. */
 readonly heads:ArchitectBatteryPoint[]=[];
 private flights:ArchitectBatteryLaunch[]=[];private impacts:ArchitectBatteryImpact[]=[];private contacts:Contact[]=[];private dangers=new Map<string,Danger>();
 private off:(()=>void)[]=[];private reduced=reducedMotion();private detail=quality().particles;
 /** Ultra low drops shell trail glows, embers and the wide flash for CPU and fill. */
 private lean=this.detail<.6;
 private counts={mergedContacts:0,contactDrops:0,committedLaunches:0,committedImpacts:0};
 private drawn={contacts:0,bursts:0,trail:0};
 constructor(private scene:Scene,private game:Game){
  this.machinery=new ArchitectSiege(scene,game);
  this.particles=new BurstParticles(scene,BATTERY_PARTICLE_CAPS,'architect-battery-fx');
  this.hazard.mesh.name='architect-battery-public-hazard';scene.add(this.hazard.mesh);
  this.streaks.mesh.name='architect-battery-fx-streaks';scene.add(this.streaks.mesh);
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
 get stats(){return {machinery:this.machinery.stats,particles:this.particles.stats,batches:this.particles.drawn+(this.hazard.count?1:0)+(this.streaks.count?1:0),streaks:this.streaks.count,heads:this.heads.length,drawn:{...this.drawn},activeFlights:this.flights.length,activeImpacts:this.impacts.length,activeContacts:this.contacts.length,activeHazards:this.dangers.size,...this.counts};}
 /** Decorative instances this prepare; the public hazard ring is counted separately. */
 get count(){return this.particles.count+this.streaks.count;}
 private valid(r:{owner:Ship;generation:number}){return !this.game.over&&r.owner.alive&&!r.owner.withdrawn&&!!r.owner.architect&&this.game.battery.generation(r.owner)===r.generation;}
 update(_dt=0){
  this.machinery.update();
  this.flights=this.flights.filter(r=>this.valid(r)&&this.game.time<r.arrivalTime+.3);
  this.impacts=this.impacts.filter(e=>this.valid(e.launch)&&this.game.time-e.resolvedAt<(e.launch.stage===3?1.65:1.25));
  this.contacts=this.contacts.filter(c=>this.valid(c.launch)&&this.game.time-c.time<.6);
  for(const [key,d] of this.dangers)if(!this.valid(d)||this.game.time>d.until+.02)this.dangers.delete(key);
 }
 setFog(color:Color,density:number){this.particles.setFog(color,density);this.streaks.setFog(color,density);}
 private surface(x:number,z:number){return Math.max(waveHeight(x,z,this.game.renderTime)+1,this.game.map.heightAt(x,z)+1);}
 private water(x:number,z:number){return this.game.map.heightAt(x,z)<=0;}
 /** A flat ring of world radius `r`; the ring sits at 0.43 of the decal's width. */
 private ring(x:number,y:number,z:number,r:number,c:Color,alpha:number,kind:BK=BK.Ring,rot=0){this.particles.push(kind,x,y,z,r/.43,c,alpha,rot);}
 /** Jagged additive lightning between two points; `points` is filled for branching. */
 private lightning(a:ArchitectBatteryPoint,b:ArchitectBatteryPoint,segments:number,jitter:number,seed:number,hex:number,alpha:number,width:number,glow=0){
  bolt.length=0;bolt.push(a);
  for(let i=1;i<=segments;i++){
   const f=i/segments,j=i===segments?0:jitter*Math.sin(f*Math.PI)**.5;
   bolt.push({x:a.x+(b.x-a.x)*f+(hash01(seed,i*3)-.5)*2*j,y:a.y+(b.y-a.y)*f+(hash01(seed,i*3+1)-.5)*j*.6,z:a.z+(b.z-a.z)*f+(hash01(seed,i*3+2)-.5)*2*j});
  }
  for(let i=1;i<bolt.length;i++){
   const p=bolt[i-1],q=bolt[i];
   if(glow)this.streaks.push(p.x,p.y,p.z,q.x,q.y,q.z,hot(hex,.9),alpha*.28,glow,2);
   this.streaks.push(p.x,p.y,p.z,q.x,q.y,q.z,blend(0xffffff,hex,.35,2.2),alpha,width,1.3);
  }
 }
 /** Elemental detonation at a public impact cell; `k` scales particle counts. */
 private burst(launch:BurstSource,point:ArchitectBatteryPoint,age:number,head:number,k:number){
  const finale=launch.stage===3,life=finale?1.65:1.25;if(age<0||age>=life)return;
  const family=ARCHETYPES[launch.type].element,c=energyColor(launch.type),x=point.x,z=point.z,base=this.surface(x,z),water=this.water(x,z),p=this.particles;
  const E=finale?510:335,t=age/life,fade=(1-t)**1.4,grow=this.reduced?.85:ease(.15+age*3.2),seed=launch.id*7+head*3+launch.slot*131+launch.stage*17;
  const R=(i:number,j:number)=>hash01(seed*97+i,j),n=(count:number)=>Math.max(1,Math.round(count*k));
  this.drawn.bursts++;
  // Gravity holds the shared blast back until its implosion pops.
  const blast=family==='gravity'?age-.25:age;
  if(blast>=0){
   const bt=blast/life,bf=(1-bt)**1.4,cy=base+E*.22;
   if(!this.reduced&&blast<.14){const f=blast/.14;p.push(BK.Flare,x,cy,z,E*1.2*(1-f*.4),hot(WHITE_HOT,1.3),.85*(1-f),seed);if(!this.lean)p.push(BK.Glow,x,cy,z,E*2.2,hot(c),.32*(1-f));}
   p.push(BK.Glow,x,base+E*.3,z,E*(1.1+.6*grow),hot(c),.3*bf*bf);
   // Fireball: dragged glows that cool from white through the element color.
   for(let i=0;i<n(26);i++){
    const pl=life*(.4+.35*R(i,0)),pa=blast-.03*R(i,1);if(pa<0||pa>pl)continue;const f=pa/pl;
    const yaw=R(i,2)*TAU,up=.15+.85*R(i,3),h=Math.sqrt(1-up*up),v=E*(1.5+1.8*R(i,4))*(this.reduced?.5:1);
    fly(pa,Math.cos(yaw)*h*v,up*v,Math.sin(yaw)*h*v,4.5,-E*.4);
    p.push(BK.Glow,x+at.x,cy+at.y,z+at.z,E*(.1+.16*R(i,5))*(.6+f*1.1),blend(WHITE_HOT,c,f*2.2,1.3),.5*(1-f)**1.5,0,R(i,6));
   }
   // Sparks: ballistic streaks with a minimum pixel width.
   for(let i=0;i<n(this.reduced?18:38);i++){
    const pl=.35+.75*R(i,10),pa=blast-.05*R(i,11);if(pa<0||pa>pl)continue;const f=pa/pl;
    const yaw=R(i,12)*TAU,up=Math.pow(R(i,13),.6),h=Math.sqrt(1-up*up),v=E*(2.4+3.4*R(i,14));
    fly(pa,Math.cos(yaw)*h*v,up*v,Math.sin(yaw)*h*v,1.7,E*2);const y=cy+at.y;if(y<base-4)continue;
    flyVel(pa,Math.cos(yaw)*h*v,up*v,Math.sin(yaw)*h*v,1.7,E*2);
    p.push(BK.Spark,x+at.x,y,z+at.z,1+R(i,15),blend(WHITE_HOT,c,f*1.6,2),1-f*f,0,0,vel.x*.032,vel.y*.032,vel.z*.032,1.6);
   }
   // Smoke rolls out after the flash and rises while it thins.
   for(let i=0;i<n(12);i++){
    const delay=.05+.14*R(i,20),pa=blast-delay,pl=life-delay;if(pa<0)continue;const f=pa/pl;
    const yaw=R(i,21)*TAU,v=E*(.5+.7*R(i,22));fly(pa,Math.cos(yaw)*v,E*(.25+.5*R(i,23)),Math.sin(yaw)*v,2.2,-E*.18);
    p.push(BK.Smoke,x+at.x,base+E*.18+at.y,z+at.z,E*(.2+.14*R(i,24))*(1+f*1.7),blend(SMOKE_DARK,SMOKE_LIGHT,f).lerp(from.setHex(c),.12),.5*Math.min(1,pa/.12)*(1-f)**1.3,R(i,25)*TAU,R(i,26));
   }
   // Shock rings run across the water; foam and spray follow on open sea.
   const shock=blast/.55;if(shock<1){this.ring(x,base+2,z,E*(this.reduced?1.2:.25+1.35*ease(shock)),hot(c,1.4),.5*(1-shock));if(!this.reduced)this.ring(x,base+3,z,E*(.2+1.7*ease(shock*1.3)),hot(0xffffff,1.2),.3*(1-clamp(shock*1.3)));}
   if(water){
    this.ring(x,base+1,z,E*(.6+.5*grow),hot(FOAM),.35*bf,BK.Foam,seed);
    for(let i=0;i<n(14);i++){
     const pl=.75+.35*R(i,30),pa=blast-.04-.08*R(i,31);if(pa<0||pa>pl)continue;const f=pa/pl,yaw=R(i,32)*TAU,ro=E*.15,v=E*(.4+.5*R(i,33));
     fly(pa,Math.cos(yaw)*v,E*(1.6+1.6*R(i,34)),Math.sin(yaw)*v,.7,E*2.8);if(at.y<0)continue;
     p.push(BK.Spray,x+Math.cos(yaw)*ro+at.x,base+at.y,z+Math.sin(yaw)*ro+at.z,E*(.07+.06*R(i,35))*(1+f*1.2),hot(SPRAY),.7*(1-f),R(i,36)*TAU,R(i,37));
    }
   }
  }
  if(family==='furnace'){
   // Fire column with drifting embers.
   const rise=ease(age/.4);
   for(let i=0;i<n(12);i++){const f=i/Math.max(1,n(12)-1),wob=Math.sin(age*6+i*1.7)*E*.05;p.push(BK.Glow,x+wob,base+E*(.1+f*1.75)*rise,z+wob*.6,E*(.36-.2*f)*(1-t*.4),blend(0xfff0b0,c,f+t*.6,1.4),.5*fade,0,R(i,40));}
   for(let i=0;i<n(30);i++){
    const pl=life*(.55+.45*R(i,41)),pa=age-.05*R(i,42);if(pa<0||pa>pl)continue;const f=pa/pl,a=R(i,43)*TAU,r0=E*.45*R(i,44);
    fly(pa,(R(i,45)-.5)*E*.6,E*(.6+.9*R(i,46)),(R(i,47)-.5)*E*.6,.8,-E*.15);
    p.push(BK.Glow,x+Math.cos(a)*r0+at.x+Math.sin(pa*5+i)*14,base+E*.2+at.y,z+Math.sin(a)*r0+at.z,3.5+3*R(i,48),blend(0xffd27a,0xff3909,f,1.7),1-f,0,0,0,0,0,1.6);
   }
  }else if(family==='cryo'){
   // Ice spears, flying shards and a low frost mist.
   const g=this.reduced?1:ease(age/.18);
   for(let i=0;i<n(7);i++){
    const a=R(i,50)*TAU,r0=E*(.08+.45*R(i,51)),bx=x+Math.cos(a)*r0,bz=z+Math.sin(a)*r0,sx=Math.cos(a)*E*.25*g,sy=E*(.35+.4*R(i,52))*g,sz=Math.sin(a)*E*.25*g;
    p.push(BK.Spark,bx+sx,base+sy,bz+sz,E*(.02+.015*R(i,53)),blend(0xe9fdff,c,.65,1.5),.7*fade,0,0,sx,sy,sz,2);
   }
   for(let i=0;i<n(18);i++){
    const pl=.6+.5*R(i,54),pa=age-.03*R(i,55);if(pa<0||pa>pl)continue;const f=pa/pl,a=R(i,56)*TAU,v=E*(1.4+1.8*R(i,57));
    fly(pa,Math.cos(a)*v,E*(1+1.4*R(i,58)),Math.sin(a)*v,1.1,E*2.2);if(at.y<-4)continue;
    p.push(BK.Shard,x+at.x,base+E*.15+at.y,z+at.z,E*(.012+.012*R(i,59)),blend(0xffffff,c,.5,1.3),1-f*f,R(i,60)*TAU+pa*(4+6*R(i,61)));
   }
   for(let i=0;i<n(10);i++){
    const pa=age-.08*R(i,62);if(pa<0)continue;const f=pa/(life-.08),a=R(i,63)*TAU,r0=E*(.2+.6*R(i,64))*(.7+.5*grow);
    p.push(BK.Smoke,x+Math.cos(a)*r0,base+E*(.04+.1*R(i,65)),z+Math.sin(a)*r0,E*(.28+.16*R(i,66))*(1+f),hot(0xcfeeff),.34*Math.min(1,pa/.15)*(1-f),R(i,67)*TAU,R(i,68));
   }
  }else if(family==='storm'){
   // Flickering sky strike, ground arcs and a falling violet shower.
   const top={x:x+Math.sin(seed)*E*.15,y:base+E*2.6,z:z+Math.cos(seed)*E*.15},phase=Math.floor(age/.055),strike=age/.8;
   p.push(BK.Glow,top.x,top.y,top.z,E*1.3,hot(c,1.1),.35*fade);
   if(strike<1&&(this.reduced||hash01(seed,phase)>.22)){
    const flick=this.reduced?0:phase;
    this.lightning(top,{x,y:base+6,z},10,E*.22,seed*13+flick,0xb69cff,1-strike,5,18);
    const mid=bolt.slice(3,7);
    for(const [i,fork] of mid.entries())if(i%2===0||this.detail>=1){const a=R(i,70)*TAU,r0=E*(.4+.5*R(i,71));this.lightning(fork,{x:x+Math.cos(a)*r0,y:base+6,z:z+Math.sin(a)*r0},5,E*.12,seed*29+flick+i,0x9ad8ff,(1-strike)*.75,4);}
   }
   if(age<.9)for(let i=0;i<(this.detail<1?3:5);i++){const a=seed+i*TAU/5,r0=E*(.6+.5*R(i,72))*grow;this.lightning({x,y:base+5,z},{x:x+Math.cos(a)*r0,y:this.surface(x+Math.cos(a)*r0,z+Math.sin(a)*r0)+5,z:z+Math.sin(a)*r0},5,E*.08,seed*31+i+(this.reduced?0:Math.floor(age/.08)),0x7d5bff,.8*(1-age/.9),3.5);}
   for(let i=0;i<n(40);i++){
    const delay=.05+.45*R(i,73),pa=age-delay,pl=.6;if(pa<0||pa>pl)continue;const f=pa/pl,a=R(i,74)*TAU,r0=E*.9*Math.sqrt(R(i,75)),vy=-E*(1.5+R(i,76));
    fly(pa,0,vy,0,.3,E*1.5);const y=base+E*(1.2+R(i,77))+at.y;if(y<base)continue;flyVel(pa,0,vy,0,.3,E*1.5);
    p.push(BK.Spark,x+Math.cos(a)*r0,y,z+Math.sin(a)*r0,1.2,blend(0xe0d4ff,c,f,2),1-f,0,0,0,vel.y*.05,0,1.5);
   }
  }else if(family==='gravity'){
   // Implosion, dark core and accretion ring, then the shared blast pops outward.
   const compress=this.reduced?.6:age<.25?1-age*2.7:.32+Math.min(1,(age-.25)/.15)*.95,cy=base+E*.48;
   if(!this.reduced&&this.distortions.length<MAX_DISTORTIONS)this.distortions.push({x,y:cy,z,radius:E*.9,strength:fade*.4,priority:1});
   p.push(BK.Smoke,x,cy,z,E*.8*compress,hot(0x07010f),.88*fade,seed,.5);
   p.push(BK.Glow,x,cy,z,E*1.3*compress,hot(c,1.2),.4*fade);
   for(let ring=0;ring<2;ring++)for(let i=0;i<n(18);i++){
    const a=i*TAU/n(18)+age*(ring?-2.4:3)*(this.reduced?.2:1),tilt=ring?.9:.25,r0=E*(.5+ring*.16)*compress,lx=Math.cos(a)*r0,ly=Math.sin(a)*r0*Math.sin(tilt),lz=Math.sin(a)*r0*Math.cos(tilt);
    p.push(BK.Glow,x+lx,cy+ly,z+lz,E*.07,blend(0xffffff,c,.6,1.6),.75*fade,0,0,0,0,0,1.5);
   }
   for(let i=0;i<n(28);i++){
    const a=R(i,80)*TAU,el=R(i,81)*1.2-.2,r0=E*(.9+.4*R(i,82)),sx=Math.cos(a)*Math.cos(el)*r0,sy=Math.sin(el)*r0,sz=Math.sin(a)*Math.cos(el)*r0;
    if(age<.25){const f=(age/.25)**2,s=1-f;p.push(BK.Spark,x+sx*s,cy+sy*s,z+sz*s,1.4,blend(0xffffff,c,f,1.8),.4+.6*f,0,0,-sx*.2,-sy*.2,-sz*.2,1.5);}
    else{const pa=age-.25,pl=.5;if(pa>pl)continue;const v=E*3.2/r0;fly(pa,sx*v,sy*v,sz*v,3,0);flyVel(pa,sx*v,sy*v,sz*v,3,0);p.push(BK.Spark,x+at.x,cy+at.y,z+at.z,1.4,blend(WHITE_HOT,c,pa/pl,2),1-pa/pl,0,0,vel.x*.05,vel.y*.05,vel.z*.05,1.5);}
   }
  }else{
   // Spectral starburst, hex refraction rings and spinning prism shards.
   const g=this.reduced?1:ease(age/.25),cy=base+E*.55;
   for(let i=0;i<n(12);i++){
    const yy=1-(i+.5)/n(12)*1.4,rr=Math.sqrt(Math.max(0,1-yy*yy)),a=i*2.39996+seed,len=E*(.5+.35*R(i,90))*g,dx=Math.cos(a)*rr*len,dy=yy*len,dz=Math.sin(a)*rr*len;
    p.push(BK.Spark,x+dx,cy+dy,z+dz,E*.012,hot(SPECTRUM[i%6],2),.8*fade,0,0,dx,dy,dz,1.8);
   }
   const hexR=E*(.35+.95*ease(age/.6));
   this.ring(x,base+3,z,hexR,hot(0xfff0c0,1.4),.55*fade,BK.Hex,seed+age*(this.reduced?0:.6));
   this.ring(x,base+4,z,hexR*.62,hot(c,1.4),.45*fade,BK.Hex,-seed-age*(this.reduced?0:.9));
   for(let i=0;i<n(12);i++){
    const pa=age-.04*R(i,91);if(pa<0)continue;const f=pa/life,a=R(i,92)*TAU,v=E*.6*(.5+R(i,93));
    fly(pa,Math.cos(a)*v,E*(.6+.6*R(i,94)),Math.sin(a)*v,1.5,-E*.1);
    p.push(BK.Shard,x+at.x,base+E*.3+at.y,z+at.z,E*.016,hot(SPECTRUM[(i+2)%6],1.5),1-f,R(i,95)*TAU+pa*5);
   }
  }
 }
 /** Victim-attached hit feedback; drawn first so crowded finales never drop it. */
 private contact(c:Contact,age:number){
  const k=age/.6;if(k<0||k>=1)return;const r=c.recipient,blocked=r.damage<=0,hex=blocked?0xa5b8c5:energyColor(c.launch.type),y=r.y+18,seed=c.launch.id*13+r.target.id,p=this.particles;
  this.drawn.contacts++;
  p.push(this.reduced?BK.Glow:BK.Flare,r.x,y,r.z,(blocked?50:90)*(1-k*.4),hot(hex,1.6),1-k,seed);
  p.push(BK.Glow,r.x,y,r.z,blocked?80:150,hot(hex,1.1),.5*(1-k));
  this.ring(r.x,this.surface(r.x,r.z)+3,r.z,30+(this.reduced?70:90*ease(k*2)),hot(hex,1.3),.5*(1-k));
  if(!blocked)for(let i=0;i<(this.lean?4:10);i++){
   const a=hash01(seed,i)*TAU,up=hash01(seed,i+20),v=260+300*hash01(seed,i+40),h=Math.sqrt(1-up*up),pa=age;if(pa>.45)continue;
   fly(pa,Math.cos(a)*h*v,up*v,Math.sin(a)*h*v,2,600);flyVel(pa,Math.cos(a)*h*v,up*v,Math.sin(a)*h*v,2,600);
   p.push(BK.Spark,r.x+at.x,y+at.y,r.z+at.z,1.1,blend(WHITE_HOT,hex,pa/.45,2),1-pa/.45,0,0,vel.x*.04,vel.y*.04,vel.z*.04,1.4);
  }
 }
 /** Launch flash at a visible platform's gun head. */
 private muzzle(launch:ArchitectBatteryLaunch,path:ArchitectBatteryLaunch['paths'][number],age:number,k:number,c:number){
  if(age>=.3)return;const m=path.muzzle,f=age/.3,seed=launch.id*5+launch.slot,p=this.particles;
  dir.set(path.control.x-m.x,path.control.y-m.y,path.control.z-m.z).normalize();side.crossVectors(dir,UP);if(side.lengthSq()<1e-6)side.set(1,0,0);side.normalize();lift.crossVectors(side,dir);
  if(!this.reduced)p.push(BK.Flare,m.x+dir.x*20,m.y+dir.y*20,m.z+dir.z*20,90*(1-f)+20,hot(WHITE_HOT,1.6),1-f,seed);
  for(let i=0;i<8;i++){const d=15+155*i/7,s=1-i/8;p.push(BK.Glow,m.x+dir.x*d,m.y+dir.y*d,m.z+dir.z*d,(18+60*i/7)*(.6+.4*(1-f)),blend(WHITE_HOT,c,i/7,1.4),.7*(1-f)*s);}
  for(let i=0;i<Math.max(4,Math.round(20*k));i++){
   if(age>.35)break;const v=700+700*hash01(seed,i),sa=(hash01(seed,i+30)-.5)*.7,sb=(hash01(seed,i+60)-.5)*.7;
   const vx=(dir.x+side.x*sa+lift.x*sb)*v,vy=(dir.y+side.y*sa+lift.y*sb)*v,vz=(dir.z+side.z*sa+lift.z*sb)*v;
   fly(age,vx,vy,vz,5,300);flyVel(age,vx,vy,vz,5,300);
   p.push(BK.Spark,m.x+at.x,m.y+at.y,m.z+at.z,1.1,blend(WHITE_HOT,c,f,2),1-f,0,0,vel.x*.03,vel.y*.03,vel.z*.03,1.4);
  }
  for(let i=0;i<Math.max(3,Math.round(10*k));i++){
   const a=i*TAU/10+seed,v=160+80*hash01(seed,i+90),ox=Math.cos(a),oy=Math.sin(a);
   const vx=(side.x*ox+lift.x*oy)*v+dir.x*80,vy=(side.y*ox+lift.y*oy)*v+dir.y*80,vz=(side.z*ox+lift.z*oy)*v+dir.z*80;
   fly(age,vx,vy,vz,3,-30);p.push(BK.Smoke,m.x+dir.x*30+at.x,m.y+dir.y*30+at.y,m.z+dir.z*30+at.z,26+60*f,hot(0x5b6168),.45*(1-f),a,hash01(seed,i+120));
  }
  if(age<.4&&this.water(m.x,m.z))this.ring(m.x,this.surface(m.x,m.z)+2,m.z,40+260*ease(age/.4),hot(c,1.2),.4*(1-age/.4));
 }
 /** Shared finale crown per cast: one ring, five light pillars and a spectral sweep. */
 private crown(launch:ArchitectBatteryLaunch,age:number){
  if(age<.06||age>1.2)return;
  const t=(age-.06)/1.14,fade=(1-t)**1.2,{x,z}=launch.center,p=this.particles,base=this.surface(x,z);
  this.ring(x,base+4,z,this.reduced?launch.radius*.94:launch.radius*(.12+.88*ease(t*1.6)),hot(0xffe7b0,1.4),.9*fade);
  this.ring(x,base+5,z,this.reduced?launch.radius*.88:launch.radius*(.1+.84*ease(t*1.4)),hot(NEON.prism,1.2),.5*fade);
  const spectrum=[NEON.furnace,NEON.cryo,NEON.storm,NEON.gravity,NEON.prism];
  for(let spoke=0;spoke<5;spoke++){
   const a=spoke*TAU/5+launch.castId,px=x+Math.cos(a)*launch.radius*.55,pz=z+Math.sin(a)*launch.radius*.55,py=this.surface(px,pz),H=1400*(this.reduced?1:ease(age/.25));
   p.push(BK.Spark,px,py+H,pz,26,hot(spectrum[spoke],2),.9*fade,0,0,0,H,0,3);
   p.push(BK.Glow,px,py+40,pz,240,hot(spectrum[spoke],1.2),.5*fade);
   for(let n=1;n<6;n++){const f=n/6,turn=this.reduced?0:t*.35,b=a+f*1.2+turn,rr=launch.radius*(.16+.65*f),sx=x+Math.cos(b)*rr,sz=z+Math.sin(b)*rr;p.push(BK.Glow,sx,this.surface(sx,sz)+Math.sin(f*Math.PI)*720+20,sz,70,hot(spectrum[spoke],1.4),.6*fade);}
  }
 }
 prepare(team:Team|-1,heightPx=720){
  this.update();this.machinery.prepare(team);this.distortions.length=0;this.heads.length=0;this.drawn={contacts:0,bursts:0,trail:0};
  this.particles.begin(heightPx);this.streaks.begin();this.streaks.material.uniforms.uViewportH.value=heightPx;
  this.hazard.begin();this.hazard.material.uniforms.uViewportH.value=heightPx;
  // Public danger zones disclose the area, never an anchor ray or concealed source location.
  const active=new Map(this.dangers);
  for(const owner of this.game.ships){const u=owner.architect?.ultimate;if(u?.kind==='killbox'&&u.battery&&this.valid({owner,generation:u.battery.generation}))active.set(`${owner.id}:${u.battery.generation}:${u.battery.id}`,{owner,generation:u.battery.generation,castId:u.battery.id,center:{x:u.x,y:0,z:u.z},radius:1500,until:this.game.time+.1});}
  for(const d of active.values()){
   const ring=tint.setHex(team===-1||team===d.owner.team?0xd7a454:0xff674c);
   for(let i=0;i<80;i++){if(i%5===4)continue;const a=i*Math.PI/40,b=(i+.8)*Math.PI/40,x=d.center.x+Math.sin(a)*d.radius,z=d.center.z+Math.cos(a)*d.radius,xx=d.center.x+Math.sin(b)*d.radius,zz=d.center.z+Math.cos(b)*d.radius;this.hazard.push(x,this.surface(x,z)+2,z,xx,this.surface(xx,zz)+2,zz,ring,.7,3,1.3);}
  }
  for(const c of this.contacts){if(team!==-1){const target=c.recipient.target,visible=target.alive?contactVisible(target,team):!target.withdrawn&&!target.mods.banished&&(target.team===team||!target.mods.untargetable&&!target.submerged&&!this.game.inSmoke(target.pos.x,target.pos.z));if(!visible)continue;}this.contact(c,this.game.time-c.time);}
  // Fewer particles per detonation when many land at once keeps a crowded finale in budget.
  // Ultra low thins further than its particle scale alone: its budget is CPU and fill, not GPU features.
  const live=this.impacts.length*2,lod=this.detail*(this.lean?.6:1),k=lod*Math.min(1,20/Math.max(1,live))*(this.reduced?.6:1);
  for(const launch of this.flights){
   const duration=launch.arrivalTime-launch.launchTime,age=this.game.time-launch.launchTime,t=age/duration,platform=launch.owner.architect?.slots[launch.slot]?.entity,visible=!!platform&&(team===-1||contactVisible(platform,team)),c=energyColor(launch.type),big=launch.stage===3;
   for(const [index,path] of launch.paths.entries()){
    if(t<1){const p=sampleArchitectBatteryArc(path,t),next=sampleArchitectBatteryArc(path,Math.min(1,t+.01));dir.set(next.x-p.x,next.y-p.y,next.z-p.z).normalize();this.heads.push(p);
     this.particles.push(BK.Flare,p.x,p.y,p.z,big?34:26,hot(WHITE_HOT,1.8),1,launch.id+index,0,0,0,0,4);
     this.particles.push(BK.Glow,p.x,p.y,p.z,big?150:110,hot(c,1.4),.6);
     this.particles.push(BK.Spark,p.x,p.y,p.z,big?16:13,hot(c,2),.9,0,0,dir.x*170,dir.y*170,dir.z*170,3);
    }
    // Samples refer to committed world positions, so the trail persists through Recall and impact.
    const linger=this.reduced?.14:.3,steps=this.lean?5:this.detail<1?8:14,start=Math.max(0,age-linger),end=Math.min(duration,age);
    let last:ArchitectBatteryPoint|undefined;
    for(let i=0;i<=steps;i++){
     const ta=start+(end-start)*i/steps;if(end<=start)break;const f=clamp(1-(age-ta)/linger),a=sampleArchitectBatteryArc(path,ta/duration);
     if(last){this.streaks.push(last.x,last.y,last.z,a.x,a.y,a.z,hot(c,1.8),f*.8,(big?12:9)*(.3+.7*f),1.5);this.drawn.trail++;}
     if(!this.lean)this.particles.push(BK.Glow,a.x,a.y,a.z,(big?50:36)*(.35+.65*f),hot(c,1.2),f*.4);last=a;
    }
    // Embers shed along the committed arc keep falling after the head has passed.
    const emberLife=this.reduced?.35:.6;
    for(let i=0;i<(this.lean?0:steps);i++){
     const te=Math.max(0,age-emberLife)+emberLife*(i+hash01(launch.id*3+index,i))/steps;if(te>Math.min(age,duration))continue;
     const ea=age-te,f=ea/emberLife,a=sampleArchitectBatteryArc(path,te/duration),seed=launch.id*31+index*7+i;
     this.particles.push(BK.Glow,a.x+drift(ea,(hash01(seed,1)-.5)*140,1.5),a.y+drift(ea,0,.6,240),a.z+drift(ea,(hash01(seed,2)-.5)*140,1.5),2.2,blend(WHITE_HOT,c,f,1.7),1-f,0,0,0,0,0,1.5);
    }
    if(visible)this.muzzle(launch,path,age,k,c);
   }
  }
  for(const charge of this.machinery.charges)this.particles.push(BK.Glow,charge.point.x,charge.point.y,charge.point.z,18+charge.strength*24,hot(charge.color,1.4),.4+charge.strength*.6,0,0,0,0,0,2);
  const crowned=new Set<string>();for(const impact of this.impacts){const launch=impact.launch,key=`${launch.owner.id}:${launch.castId}`;if(launch.stage===3&&!crowned.has(key)){crowned.add(key);this.crown(launch,this.game.time-impact.resolvedAt);}}
  const linked=new Map<string,ArchitectBatteryImpact>();
  for(const impact of this.impacts){
   const launch=impact.launch,key=`${launch.owner.id}:${launch.castId}:${launch.stage}`,previous=linked.get(key);
   if(previous){const age=this.game.time-impact.resolvedAt,fade=clamp(1-age/1.2),a=previous.launch.paths[0].impact,b=launch.paths[0].impact;
    // Only public impact cells connect; these arcs cannot disclose concealed launch machinery.
    if(fade>0)this.lightning({x:a.x,y:a.y+50,z:a.z},{x:b.x,y:b.y+50,z:b.z},6,40,launch.id*17+launch.slot,energyColor(launch.type),fade*.65,3.5);
   }
   linked.set(key,impact);
  }
  for(const impact of this.impacts)for(const [head,path] of impact.launch.paths.entries())this.burst(impact.launch,path.impact,this.game.time-impact.resolvedAt,head,k);
  this.particles.end();this.streaks.end();this.streaks.mesh.visible=this.streaks.count>0;
  this.hazard.end();this.hazard.mesh.visible=this.hazard.count>0;
 }
 private clear(){this.flights=[];this.impacts=[];this.contacts=[];this.dangers.clear();this.distortions.length=0;this.heads.length=0;}
 dispose(){for(const off of this.off)off();this.clear();this.machinery.dispose();this.particles.dispose();for(const r of [this.hazard,this.streaks]){this.scene.remove(r.mesh);r.dispose();}}
}
