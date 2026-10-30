import { Color, type Scene } from 'three';
import type { Game } from '../core/Game';
import type { Ship } from '../ships/Ship';
import type { Team } from '../core/types';
import { contactVisible } from '../core/Targeting';
import { ELEMENT_STYLE, type ArchitectElement, type ElementEvent } from '../skills/misc/ArchitectElements';
import { arsenalShip } from '../skills/misc/ArchitectTargets';
import { waveHeight } from '../world/Waves';
import { reducedMotion } from './ArchitectPose';
import { quality } from './Quality';
import { Ribbons } from './Projectiles';
import { MAX_DISTORTIONS, type SpatialDistortion } from './SpatialDistortion';
import { BK, BurstParticles, drift, driftSpeed, hash01 } from './BurstParticles';

interface Point {x:number;y:number;z:number}
interface Reaction {e:ElementEvent;time:number;id:number;key:string}
const TAU=Math.PI*2,LIFE=1.1,WHITE_HOT=0xfff4dc,STEAM=0xe6eef2,FOAM=0xe8f4f8,FROST=0xe8fbff,VOID=0x0d0414;
const C=Object.fromEntries(Object.entries(ELEMENT_STYLE).map(([k,v])=>[k,v.color])) as Record<ArchitectElement,number>;
/** Reactions that open by drawing inward; their outward shock waits for the collapse. */
const IMPLODE:Record<string,number>={'furnace+gravity':.32,'cryo+gravity':.3};
const clamp=(v:number)=>Math.max(0,Math.min(1,v)),ease=(v:number)=>1-(1-clamp(v))**3;
const tint=new Color(),from=new Color(),to=new Color();
const hot=(hex:number,k=1)=>tint.setHex(hex).multiplyScalar(k);
const blend=(a:number,b:number,f:number,k=1)=>tint.copy(from.setHex(a)).lerp(to.setHex(b),clamp(f)).multiplyScalar(k);
const hue=(h:number,k=1)=>tint.setHSL(((h%1)+1)%1,.85,.62).multiplyScalar(k);
const hueHex=(h:number)=>tint.setHSL(((h%1)+1)%1,.85,.62).getHex();

/** Elemental reaction bursts in both element colours, chain arcs, and the owner's view of marked targets. */
export class ArchitectReactionFx {
 readonly particles:BurstParticles;
 readonly streaks=new Ribbons(768,true,false);
 readonly distortions:SpatialDistortion[]=[];
 /** Reaction keys drawn by the last prepare, and the mark glyphs it showed. */
 readonly drawn:string[]=[];
 marks=0;
 private reactions:Reaction[]=[];private serial=0;private reduced=reducedMotion();private detail=quality().particles;
 private bolt:Point[]=[];
 constructor(private scene:Scene,private game:Game){
  this.particles=new BurstParticles(scene,{additive:2048,alpha:512,flat:256},'architect-reaction-fx');
  this.streaks.mesh.name='architect-reaction-fx-streaks';scene.add(this.streaks.mesh);
 }
 add(e:ElementEvent){if(!e.pair)return;this.reactions.push({e,time:this.game.time,id:this.serial++,key:[e.pair,e.element].sort().join('+')});if(this.reactions.length>24)this.reactions.shift();}
 drop(s:Ship){this.reactions=this.reactions.filter(r=>r.e.ship!==s);}
 clear(){this.reactions=[];this.distortions.length=0;}
 update(){this.reactions=this.reactions.filter(r=>this.game.time-r.time<LIFE);}
 get count(){return this.particles.count+this.streaks.count;}
 setFog(color:Color,density:number){this.particles.setFog(color,density);this.streaks.setFog(color,density);}
 private surface(x:number,z:number){return Math.max(waveHeight(x,z,this.game.renderTime)+1,this.game.map.heightAt(x,z)+1);}
 private water(x:number,z:number){return this.game.map.heightAt(x,z)<=0;}
 /** A flat ring of world radius `r`; the ring sits at 0.43 of the decal's width. */
 private ring(x:number,y:number,z:number,r:number,c:Color,alpha:number,kind:BK=BK.Ring,rot=0){if(r>0)this.particles.push(kind,x,y,z,r/.43,c,alpha,rot);}
 /** A flat hexagon outline whose apothem is `r`. */
 private hex(x:number,y:number,z:number,r:number,c:Color,alpha:number,rot=0){if(r>0)this.particles.push(BK.Hex,x,y,z,r/.41,c,alpha,rot);}
 private distort(x:number,y:number,z:number,radius:number,strength:number,priority=1){if(!this.reduced&&this.distortions.length<MAX_DISTORTIONS)this.distortions.push({x,y,z,radius,strength,priority});}
 /** Jagged additive lightning; the seed picks the shape so a flicker is a reseed. */
 private arc(a:Point,b:Point,segments:number,jitter:number,seed:number,hex:number,alpha:number,width:number,glow=0){
  const bolt=this.bolt;bolt.length=0;bolt.push(a);
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
 /** Radial sparks thrown from the blast; `c` alternates the two element colours. */
 private sparks(x:number,y:number,z:number,age:number,n:number,E:number,a:number,b:number,R:(i:number,j:number)=>number){
  for(let i=0;i<n;i++){
   const pl=.45+.35*R(i,0);if(age>pl)continue;const f=age/pl,ang=R(i,1)*TAU,v=E*(1.6+1.4*R(i,2)),up=80+240*R(i,3);
   const ox=drift(age,v,2.4),oy=drift(age,up,2,500),vx=driftSpeed(age,v,2.4),vy=driftSpeed(age,up,2,500);if(oy<-20)continue;
   this.particles.push(BK.Spark,x+Math.cos(ang)*ox,y+oy,z+Math.sin(ang)*ox,1.3,blend(WHITE_HOT,i%2?a:b,.3+f,2),1-f,0,0,Math.cos(ang)*vx*.035,vy*.035,Math.sin(ang)*vx*.035,1.5);
  }
 }
 private reaction(r:Reaction,age:number,k:number){
  const e=r.e,x=e.tx,z=e.tz,base=this.surface(x,z),cy=Math.max(base+20,e.ty+10),E=Math.max(180,Math.min(420,e.radius||300)),A=C[e.pair!],B=C[e.element];
  const p=this.particles,R=(i:number,j:number)=>hash01(r.id*389+i,j),lag=IMPLODE[r.key]??0,sa=age-lag,flick=this.reduced?0:Math.floor(age/.07);
  // Shared layers: a two-colour flash, core and shock pair; implosions hold them until the collapse.
  if(sa>=0){
   if(!this.reduced&&sa<.14)p.push(BK.Flare,x,cy+20,z,E*1.1*(1-sa/.14*.4),blend(WHITE_HOT,B,.2,1.3),1-sa/.14,r.id);
   if(sa<.5)p.push(BK.Glow,x,cy,z,E*1.5,blend(A,B,.5,1.1),.5*(1-sa/.5));
   this.ring(x,base+3,z,this.reduced?E:E*ease(sa/.5),hot(A,1.5),.8*(1-clamp(sa/.65)));
   if(!this.reduced)this.ring(x,base+5,z,E*.75*ease(sa/.3),hot(B,1.6),.7*(1-clamp(sa/.45)),BK.Ring,1);
   if(this.water(x,z))this.ring(x,base+1,z,E*.55*(.5+.5*ease(sa/.5)),hot(FOAM),.45*(1-sa/(LIFE-lag)),BK.Foam,r.id);
   this.sparks(x,cy,z,sa,Math.round((this.reduced?10:22)*k),E,A,B,R);
  }
  switch(r.key){
   case 'cryo+furnace':{
    // Thermal Shock: superheated steam billows out of a short orange core.
    if(age<.35)p.push(BK.Glow,x,cy,z,E*1.1,hot(C.furnace,1.5),.8*(1-age/.35));
    for(let i=0;i<Math.round(22*k);i++){
     const d=.06*R(i,10),pa=age-d;if(pa<0)continue;const f=pa/(LIFE-d),a=R(i,11)*TAU,out=drift(pa,E*(1.2+1.4*R(i,12)),2.2),y=drift(pa,100+300*R(i,13),1.4,-40);
     p.push(BK.Smoke,x+Math.cos(a)*out,cy+y,z+Math.sin(a)*out,(E*.22+E*.2*R(i,14))*(1+f*1.8),blend(STEAM,C.cryo,.3*R(i,15)),.45*(1-f)**1.3,R(i,16)*TAU,R(i,17));
    }
    // Low jets of flashed water skating out across the surface.
    for(let i=0;i<Math.round(12*k);i++){const pl=.6+.3*R(i,30);if(age>pl)continue;const f=age/pl,a=i*TAU/Math.round(12*k)+R(i,31)*.3,out=E*.3+drift(age,E*(2+R(i,32)),2.4),y=drift(age,90+90*R(i,33),1.5,380);if(y<-10)continue;p.push(BK.Spray,x+Math.cos(a)*out,base+y,z+Math.sin(a)*out,(20+14*R(i,34))*(1+f*1.5),hot(STEAM),.6*(1-f),R(i,35)*TAU,R(i,36));}
    for(let i=0;i<Math.round(10*k);i++){
     const pl=.3+.2*R(i,20);if(age>pl)continue;const f=age/pl,a=R(i,21)*TAU,out=drift(age,E*(1.5+R(i,22)),3),y=drift(age,120+200*R(i,23),2,400);
     p.push(BK.Shard,x+Math.cos(a)*out,cy+y,z+Math.sin(a)*out,12+8*R(i,24),blend(FROST,C.furnace,f,1.5),1-f,a+age*6,R(i,25));
    }
    break;
   }
   case 'furnace+storm':{
    // Overload: a fire nova whose rim is a ring of re-striking bolts.
    const m=Math.round(20*k);
    for(let i=0;i<m;i++){const f=clamp(age/.8);if(f>=1)break;const a=i*TAU/m+R(i,10)*.15,out=drift(age,E*2.2,3);p.push(BK.Glow,x+Math.cos(a)*out,cy+10+20*R(i,11),z+Math.sin(a)*out,(60+40*R(i,12))*(1+f),blend(WHITE_HOT,C.furnace,f*2,1.4),.75*(1-f));}
    if(age<.8){const rr=E*(.55+.45*ease(age/.4)),seg=this.reduced?4:6;for(let i=0;i<seg;i++){const a0=i*TAU/seg+r.id,a1=(i+1)*TAU/seg+r.id;this.arc({x:x+Math.cos(a0)*rr,y:cy+15,z:z+Math.sin(a0)*rr},{x:x+Math.cos(a1)*rr,y:cy+15,z:z+Math.sin(a1)*rr},4,E*.1,r.id*31+i+flick*7,C.storm,1-age/.8,3.5,12);}}
    break;
   }
   case 'furnace+gravity':{
    // Core Collapse: embers fall into a dark core, then it detonates as a fire nova.
    const m=Math.round(18*k);
    if(age<lag){
     const f=age/lag;this.distort(x,cy,z,E*.8,.35*(1-f*.3));
     p.push(BK.Smoke,x,cy,z,E*.6*(1-f*.5),hot(VOID),.8,r.id,.4);
     this.ring(x,base+4,z,E*1.2*(1-ease(f)*.85),hot(C.furnace,1.6),.85);
     this.ring(x,base+5,z,E*.9*(1-ease(f)*.9),hot(C.gravity,1.5),.6,BK.Ring,1);
     for(let i=0;i<m;i++){const a=R(i,10)*TAU+f*1.5,rr=E*(1.1+.3*R(i,11))*(1-ease(f)),s=E*.6*(1-f*.5),px=x+Math.cos(a)*rr,py=cy+30*(R(i,12)-.5),pz=z+Math.sin(a)*rr;p.push(BK.Glow,px,py,pz,26,hot(C.furnace,1.8),.8);p.push(BK.Spark,px,py,pz,3.5,hot(C.furnace,2.4),.95,0,0,-Math.cos(a)*s,0,-Math.sin(a)*s,2);}
    }else{
     const pa=age-lag,f=pa/(LIFE-lag);
     for(let i=0;i<m;i++){const a=R(i,12)*TAU,out=drift(pa,E*(2+R(i,13)),2.6),y=drift(pa,60+200*R(i,14),1.5,300);p.push(BK.Glow,x+Math.cos(a)*out,cy+y,z+Math.sin(a)*out,(50+50*R(i,15))*(1+f),blend(WHITE_HOT,i%3?C.furnace:C.gravity,f*1.6,1.3),.7*(1-f));}
     this.ring(x,base+4,z,E*1.15*ease(pa/.35),hot(C.gravity,1.5),.8*(1-clamp(pa/.5)));
    }
    break;
   }
   case 'furnace+prism':{
    // Solar Flare: a sun core throwing slowly turning rays and arcing prominences.
    const rays=this.reduced?8:14,grow=ease(age/.3),f=clamp(age/.9);
    if(f<1){
     p.push(BK.Glow,x,cy+30,z,E*1.1*(1+.3*grow),blend(WHITE_HOT,C.prism,.3,1.5),.7*(1-f));
     for(let i=0;i<rays;i++){const a=i*TAU/rays+r.id*.7+age*.35,el=.15+.45*R(i,10),len=E*(.8+.6*R(i,11))*grow,dx=Math.cos(a)*Math.cos(el),dy=Math.sin(el),dz=Math.sin(a)*Math.cos(el);this.streaks.push(x,cy+30,z,x+dx*len,cy+30+dy*len,z+dz*len,blend(C.prism,C.furnace,R(i,12),1.8),.7*(1-f),E*(.012+.012*R(i,13)),1.5);}
    }
    for(let i=0;i<Math.round(14*k);i++){const pl=.7+.3*R(i,20);if(age>pl)continue;const g=age/pl,a=R(i,21)*TAU,out=drift(age,E*(.6+.8*R(i,22)),1.2),y=drift(age,260+240*R(i,23),1,520);if(y<-20)continue;p.push(BK.Glow,x+Math.cos(a)*out,cy+30+y,z+Math.sin(a)*out,14+12*R(i,24),blend(C.prism,C.furnace,g,1.8),.9*(1-g));}
    break;
   }
   case 'cryo+storm':{
    // Superconduct: a frozen hex lattice with current racing along its edges.
    const f=clamp(age/.95);if(f>=1)break;const hr=E*.36,grow=ease(age/.25),cells:Point[]=[{x,y:base+6,z}];
    for(let i=0;i<6;i++){const a=Math.PI/6+i*TAU/6;cells.push({x:x+Math.cos(a)*hr*2,y:base+6,z:z+Math.sin(a)*hr*2});}
    for(const [i,c] of cells.entries())this.hex(c.x,c.y,c.z,hr*grow*(i?.92:1),hot(i?C.cryo:FROST,1.4),(i?.7:.9)*(1-f));
    for(let i=1;i<cells.length;i++){
     if(this.reduced&&i%2)continue;const c=cells[i],n=cells[i%6+1],lift=(q:Point)=>({x:q.x,y:q.y+8,z:q.z});
     this.arc(lift(cells[0]),lift(c),4,E*.05,r.id*53+i+flick*11,C.storm,(1-f)*.9,3,10);
     if(age>.12)this.arc(lift(c),lift(n),4,E*.05,r.id*59+i+flick*13,C.storm,(1-f)*.7,2.5);
    }
    for(let i=0;i<Math.round(12*k);i++){const pl=.5+.3*R(i,20);if(age>pl)continue;const g=age/pl,a=R(i,21)*TAU,out=drift(age,E*(1.2+R(i,22)),2.4),y=drift(age,180+180*R(i,23),2,480);if(y<-20)continue;p.push(BK.Shard,x+Math.cos(a)*out,cy+y,z+Math.sin(a)*out,10+8*R(i,24),hot(FROST,1.5),1-g,a+age*7,R(i,25));}
    break;
   }
   case 'cryo+gravity':{
    // Cold Crush: shards slam into the hull, then shatter outward in frost.
    const m=Math.round(18*k);
    if(age<lag){
     const f=age/lag;this.distort(x,cy,z,E*.7,.3);
     this.ring(x,base+4,z,E*1.1*(1-ease(f)*.85),hot(C.gravity,1.5),.8);
     for(let i=0;i<m;i++){const a=R(i,10)*TAU,rr=E*(1+.4*R(i,11))*(1-ease(f)),s=E*.25;p.push(BK.Shard,x+Math.cos(a)*rr,cy+40*(R(i,12)-.3),z+Math.sin(a)*rr,14+10*R(i,13),hot(C.cryo,1.6),.95,a,R(i,14),-Math.cos(a)*s,0,-Math.sin(a)*s,2);}
    }else{
     const pa=age-lag;
     for(let i=0;i<Math.round(28*k);i++){const pl=.55+.3*R(i,20);if(pa>pl)continue;const g=pa/pl,a=R(i,21)*TAU,ox=drift(pa,E*(1.8+1.4*R(i,22)),2.2),oy=drift(pa,100+300*R(i,23),1.8,520);if(oy<-30)continue;p.push(BK.Shard,x+Math.cos(a)*ox,cy+oy,z+Math.sin(a)*ox,(10+12*R(i,24))*(1-g*.4),blend(FROST,C.cryo,g,1.5),1-g,R(i,25)*TAU+pa*8,R(i,26));}
     for(let i=0;i<Math.round(8*k);i++){const f=pa/(LIFE-lag),a=R(i,30)*TAU,out=drift(pa,E*(.7+.6*R(i,31)),2.5);p.push(BK.Smoke,x+Math.cos(a)*out,cy+drift(pa,60,1.5,-20),z+Math.sin(a)*out,E*(.3+.2*R(i,32))*(1+f),blend(FROST,C.cryo,.4),.45*(1-f),R(i,33)*TAU,R(i,34));}
    }
    break;
   }
   case 'cryo+prism':{
    // Crystal Break: the mark shatters into spectral shards over turning refraction hexes.
    const f=clamp(age/.9);
    if(f<1){this.hex(x,base+5,z,E*.8*ease(age/.35),hot(C.prism,1.5),.8*(1-f),age*.6);this.hex(x,base+6,z,E*.5*ease(age/.25),hot(C.cryo,1.6),.7*(1-f),.5-age*.9);}
    for(let i=0;i<Math.round(26*k);i++){const pl=.6+.35*R(i,10);if(age>pl)continue;const g=age/pl,a=R(i,11)*TAU,ox=drift(age,E*(1.4+1.2*R(i,12)),2.4),oy=drift(age,60+260*R(i,13),2,420);if(oy<-20)continue;p.push(BK.Shard,x+Math.cos(a)*ox,cy+oy,z+Math.sin(a)*ox,(12+14*R(i,14))*(1-g*.3),hue(R(i,15)+age*.4,1.6),(1-g)*.95,R(i,16)*TAU+age*(4+6*R(i,17)),R(i,18));}
    if(!this.reduced)for(let i=0;i<6;i++){const tw=Math.sin(age*20+i*2.1);if(tw<.4||age>.8)continue;const a=R(i,40)*TAU,rr=E*(.3+.6*R(i,41));p.push(BK.Flare,x+Math.cos(a)*rr,cy+20+80*R(i,42),z+Math.sin(a)*rr,40,hue(R(i,43),1.5),(tw-.4)*1.6*(1-age/.8),R(i,44));}
    break;
   }
   case 'gravity+storm':{
    // Magnetic Storm: spiral arcs wound into a dark eye that tightens as it spins.
    const f=clamp(age/1);if(f>=1)break;const spin=age*5+r.id,arms=this.reduced?2:3;
    this.distort(x,cy,z,E*.6,.25*(1-f));
    p.push(BK.Smoke,x,cy,z,E*.35,hot(VOID),.6*(1-f),r.id,.3);
    for(let arm=0;arm<arms;arm++){
     let px=0,py=0,pz=0;
     for(let i=0;i<=8;i++){
      const u=i/8,a=spin+arm*TAU/arms+u*2.6,rr=E*(.15+.95*u)*(1-.35*ease(f)),j=(i&&i<8?1:0)*E*.05;
      const qx=x+Math.cos(a)*rr+(hash01(r.id*7+arm*17+flick,i*2)-.5)*2*j,qy=cy+10+u*30*Math.sin(age*9+arm),qz=z+Math.sin(a)*rr+(hash01(r.id*7+arm*17+flick,i*2+1)-.5)*2*j;
      if(i){this.streaks.push(px,py,pz,qx,qy,qz,hot(C.storm,.9),(1-f)*.3,12,2);this.streaks.push(px,py,pz,qx,qy,qz,blend(0xffffff,C.storm,.35,2.2),1-f,3,1.3);}
      px=qx;py=qy;pz=qz;
     }
    }
    for(let i=0;i<Math.round(12*k);i++){const a=spin*1.4+R(i,10)*TAU,rr=E*(.3+.6*R(i,11))*(1-.5*f);p.push(BK.Glow,x+Math.cos(a)*rr,cy+15*(R(i,12)-.5),z+Math.sin(a)*rr,20+14*R(i,13),hot(C.gravity,1.6),.75*(1-f));}
    break;
   }
   case 'prism+storm':{
    // Arc Spectrum: a refracted starburst; the chain beams below carry the rainbow.
    const f=clamp(age/.7);if(f>=1)break;const rays=this.reduced?6:10;
    for(let i=0;i<rays;i++){const a=i*TAU/rays+r.id,len=E*.9*ease(age/.2);this.streaks.push(x,cy+20,z,x+Math.cos(a)*len,cy+20,z+Math.sin(a)*len,hue(i/rays+age*.6,1.8),.8*(1-f),E*.02,1.5);}
    // Without chain victims the arcs still ground to the sea, so the reaction keeps its shape.
    if(!e.chain?.length&&age<.6)for(let i=0;i<(this.reduced?3:5);i++){const a=i*TAU/5+r.id,rr=E*(.7+.3*R(i,20));this.arc({x,y:cy+20,z},{x:x+Math.cos(a)*rr,y:this.surface(x+Math.cos(a)*rr,z+Math.sin(a)*rr)+4,z:z+Math.sin(a)*rr},5,E*.08,r.id*61+i+flick*5,hueHex(i/5+age*.5),1-age/.6,3,10);}
    break;
   }
   case 'gravity+prism':{
    // Singularity: a black core with a lensing field and a light-bent accretion disc, then a last pop.
    const f=clamp(age/1.05);if(f>=1)break;const grow=ease(age/.25),collapse=age>.8?ease((age-.8)/.25):0,core=E*.32*grow*(1-collapse*.85),y=cy+20;
    this.distort(x,y,z,E*1.1*Math.max(.2,grow),.55*(1-collapse),2);
    p.push(BK.Smoke,x,y,z,core*2.2,hot(VOID),.92*(1-collapse),r.id,.5);
    p.push(BK.Smoke,x,y,z,core*1.4,hot(0),.95*(1-collapse),r.id+1,.7);
    this.ring(x,y,z,core*1.25,hot(C.prism,1.6),.9*(1-f));
    for(let i=0;i<Math.round(30*k);i++){
     const rr=core*(1.5+1.6*R(i,11)),w=(3+3*R(i,12))/(.4+R(i,11)),a=R(i,10)*TAU+age*w,s=rr*w*.02;
     p.push(BK.Glow,x+Math.cos(a)*rr,y+(R(i,13)-.5)*12,z+Math.sin(a)*rr,18+18*R(i,14),blend(C.prism,C.gravity,R(i,15),1.6),.8*(1-f),0,0,-Math.sin(a)*s,0,Math.cos(a)*s,1.5);
    }
    if(!this.reduced&&age>=.8&&age<.92)p.push(BK.Flare,x,y,z,E*.9,blend(WHITE_HOT,C.prism,.3,1.5),1-(age-.8)/.12,r.id);
    break;
   }
  }
  if(e.chain?.length)this.chains(r,age,{x,y:cy,z},A,B);
 }
 /** Arcs from the marked hull to each secondary victim, with a small strike at every end. */
 private chains(r:Reaction,age:number,c:Point,A:number,B:number){
  if(age>.75)return;const f=age/.75,rainbow=r.key==='prism+storm',flick=this.reduced?0:Math.floor(age/.06),p=this.particles;
  for(const [i,t] of r.e.chain!.entries()){
   const end={x:t.x,y:Math.max(this.surface(t.x,t.z)+20,t.y+10),z:t.z},len=Math.hypot(end.x-c.x,end.z-c.z),segs=Math.max(5,Math.min(12,Math.round(len/60)));
   if(rainbow)for(let b=0;b<(this.reduced?3:5);b++){const off=(b-2)*6;this.arc({x:c.x,y:c.y+off,z:c.z},{x:end.x,y:end.y+off,z:end.z},segs,len*.06,r.id*41+i*7+b+flick*3,hueHex(b/5+age*.5),1-f,2.5,b===2?10:0);}
   else{this.arc(c,end,segs,len*.08,r.id*43+i*5+flick*3,B,1-f,4,16);if(!this.reduced)this.arc(c,end,segs,len*.1,r.id*47+i*5+flick*3,A,(1-f)*.6,2);}
   p.push(BK.Glow,end.x,end.y,end.z,120,blend(A,B,.5,1.4),.7*(1-f));
   this.ring(end.x,this.surface(end.x,end.z)+3,end.z,90*ease(age/.3),hot(B,1.5),.7*(1-f));
  }
 }
 /** Marks on enemies, only for the marker's own team: an element ring with orbiting motes. */
 private glyphs(s:Ship,team:Team|-1){
  const now=this.game.time,p=this.particles;
  for(const m of s.architect!.elements.marks){
   const t=arsenalShip(s,m.target);if(!t?.alive||m.until<now||team!==-1&&!contactVisible(t,team))continue;
   const life=clamp((m.until-now)/.6),x=t.renderPos.x,z=t.renderPos.z,y=t.renderPos.y+t.spec.freeboard+70,r=Math.max(40,t.spec.beam*.9);
   if(!m.element){
    // Spent: a grey ring closes while the mark cannot react again.
    const f=clamp(m.ready-now);if(f>0)this.ring(x,y,z,r*(.6+.4*f),hot(0xcfd8e0),.35*f*life);continue;
   }
   const c=C[m.element],pulse=.5+.5*Math.sin(now*TAU*1.6+t.id),spin=now*1.8+t.id;this.marks++;
   this.ring(x,y,z,r*(1+.08*pulse),hot(c,1.4),(.55+.35*pulse)*life,BK.Ring,spin);
   this.hex(x,y+1,z,r*.55,hot(c,1.2),.45*life,-spin*.7);
   for(let i=0;i<3;i++){const a=spin*1.6+i*TAU/3;p.push(BK.Glow,x+Math.cos(a)*r,y+6*Math.sin(now*4+i),z+Math.sin(a)*r,16+6*pulse,hot(c,1.6),.85*life);}
  }
 }
 prepare(team:Team|-1,heightPx=720){
  this.particles.begin(heightPx);this.streaks.begin();this.streaks.material.uniforms.uViewportH.value=heightPx;this.distortions.length=0;this.drawn.length=0;this.marks=0;
  if(!this.game.over){
   const k=this.detail*(this.reduced?.6:1)*Math.min(1,6/Math.max(1,this.reactions.length));
   for(const r of this.reactions){const s=r.e.ship,age=this.game.time-r.time;if(!s.architect||s.mods.banished||age<0||age>=LIFE||team!==-1&&s.team!==team&&!contactVisible(s,team))continue;this.drawn.push(r.key);this.reaction(r,age,k);}
   for(const s of this.game.ships)if(s.alive&&s.architect&&(team===-1||team===s.team))this.glyphs(s,team);
  }
  this.particles.end();this.streaks.end();this.streaks.mesh.visible=this.streaks.count>0;
 }
 dispose(){this.clear();this.particles.dispose();this.scene.remove(this.streaks.mesh);this.streaks.dispose();}
}
