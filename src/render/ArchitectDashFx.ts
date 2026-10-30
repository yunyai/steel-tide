import { Color, type Scene } from 'three';
import type { Game } from '../core/Game';
import type { Ship } from '../ships/Ship';
import type { Team } from '../core/types';
import type { GameEventMap } from '../core/Events';
import { contactVisible } from '../core/Targeting';
import { ARCHETYPES } from '../data/architectLoadout';
import { architectBatterySkillGain } from '../fx/ArchitectBatteryAudio';
import { audio } from '../fx/Audio';
import { waveHeight } from '../world/Waves';
import { reducedMotion } from './ArchitectPose';
import { quality } from './Quality';
import { BK, BurstParticles, drift, driftSpeed, hash01 } from './BurstParticles';

type DashEvent=GameEventMap['architectDash'];
interface Burst {e:DashEvent;time:number;heading:number;id:number}
const TAU=Math.PI*2,LIFE={launch:.9,land:1.4},VECTOR=ARCHETYPES.vector.color,WHITE_HOT=0xfff4dc,SPRAY=0xdcecf2,FOAM=0xe8f4f8;
const clamp=(v:number)=>Math.max(0,Math.min(1,v)),ease=(v:number)=>1-(1-clamp(v))**3;
const tint=new Color(),from=new Color(),to=new Color();
const hot=(hex:number,k=1)=>tint.setHex(hex).multiplyScalar(k);
const blend=(a:number,b:number,f:number,k=1)=>tint.copy(from.setHex(a)).lerp(to.setHex(b),clamp(f)).multiplyScalar(k);

/** Hull Dash launch spray, airborne downwash and the landing shockwave, plus its audio and local camera kick. */
export class ArchitectDashFx {
 readonly particles:BurstParticles;
 private bursts:Burst[]=[];private off:(()=>void)[]=[];private locals:Ship[]=[];private serial=0;
 private reduced=reducedMotion();private detail=quality().particles;
 /** Called with the dashing ship and a shake amount for its own captain's camera. */
 onShake:((ship:Ship,amount:number)=>void)|null=null;
 constructor(scene:Scene,private game:Game){
  this.particles=new BurstParticles(scene,{additive:1024,alpha:512,flat:96},'architect-dash-fx');
  this.off.push(game.events.on('architectDash',e=>{
   if(game.over)return;this.bursts.push({e,time:game.time,heading:e.ship.heading,id:this.serial++});if(this.bursts.length>32)this.bursts.shift();
   const local=this.locals.includes(e.ship),land=e.phase==='land';
   audio.play(land?'explosion':'charge',e.x,20,e.z,land?2:100,(local?.5:.28)*architectBatterySkillGain(game),{category:'ability',priority:local?3:1,asset:`${import.meta.env.BASE_URL}audio/${land?'blast-heavy':'jet-release'}.m4a`,rate:land?.9:1.1});
   if(local&&!this.reduced)this.onShake?.(e.ship,land?.45+.05*e.vectors:.2);
  }),game.events.on('gameOver',()=>{this.bursts=[];}),game.events.on('respawn',e=>this.drop(e.ship)),game.events.on('shipChanged',e=>this.drop(e.old)));
 }
 private drop(s:Ship){this.bursts=this.bursts.filter(b=>b.e.ship!==s);}
 update(_dt:number,locals:Ship[]=[]){this.locals=locals;this.bursts=this.bursts.filter(b=>this.game.time-b.time<LIFE[b.e.phase]);}
 get count(){return this.particles.count;}
 setFog(color:Color,density:number){this.particles.setFog(color,density);}
 private surface(x:number,z:number){return Math.max(waveHeight(x,z,this.game.renderTime)+1,this.game.map.heightAt(x,z)+1);}
 private ring(x:number,y:number,z:number,r:number,c:Color,alpha:number,kind:BK=BK.Ring,rot=0){this.particles.push(kind,x,y,z,r/.43,c,alpha,rot);}
 private visible(s:Ship,team:Team|-1){return team===-1||s.team===team||contactVisible(s,team);}
 private launch(b:Burst,age:number,k:number){
  const {ship,x,z}=b.e,p=this.particles,L=ship.spec.length,W=ship.spec.beam,h=b.heading,fx=Math.sin(h),fz=-Math.cos(h),base=this.surface(x,z),t=age/LIFE.launch,R=(i:number,j:number)=>hash01(b.id*977+i,j);
  if(age<.25){const f=age/.25;p.push(BK.Glow,x,base+30,z,L*1.4,hot(VECTOR,1.2),.45*(1-f));for(const side of [-1,1])if(!this.reduced)p.push(BK.Flare,x-fx*L*.4+fz*side*W*.24,base+22,z-fz*L*.4-fx*side*W*.24,70*(1-f)+20,hot(WHITE_HOT,1.4),1-f,side);}
  this.ring(x,base+2,z,40+(this.reduced?200:L*1.3*ease(age/.5)),hot(VECTOR,1.3),.8*(1-clamp(age/.6)));
  this.ring(x,base+1,z,L*.75*(.7+.3*ease(age/.4)),hot(FOAM),.5*(1-t),BK.Foam,b.id);
  // A sheet of water torn up along the hull as it lifts.
  for(let i=0;i<Math.round(28*k);i++){
   const pl=.6+.3*R(i,0),pa=age-.03*R(i,1);if(pa<0||pa>pl)continue;const f=pa/pl,along=(R(i,2)-.5)*L*.85,side=R(i,3)<.5?-1:1,ox=fx*along+fz*side*W*.5,oz=fz*along-fx*side*W*.5,out=60+90*R(i,4);
   const y=drift(pa,140+160*R(i,5),1,420);if(y<0)continue;
   p.push(BK.Spray,x+ox+fz*side*drift(pa,out,1.2),base+y,z+oz-fx*side*drift(pa,out,1.2),(10+10*R(i,6))*(1+f*1.4),hot(SPRAY),.7*(1-f),R(i,7)*TAU,R(i,8));
  }
 }
 private land(b:Burst,age:number,k:number){
  const {ship,x,z,radius}=b.e,p=this.particles,base=this.surface(x,z),t=age/LIFE.land,R=(i:number,j:number)=>hash01(b.id*613+i,j),L=ship.spec.length;
  if(!this.reduced&&age<.15){const f=age/.15;p.push(BK.Flare,x,base+40,z,260*(1-f*.4),hot(WHITE_HOT,1.4),1-f,b.id);}
  if(age<.35)p.push(BK.Glow,x,base+50,z,radius*1.3,hot(VECTOR,1.1),.4*(1-age/.35));
  const shock=age/.6;
  if(shock<1){this.ring(x,base+3,z,this.reduced?radius:radius*ease(age/.45),hot(VECTOR,1.5),.9*(1-shock));if(!this.reduced)this.ring(x,base+4,z,radius*.9*ease(age/.32),hot(0xffffff,1.2),.55*(1-clamp(age/.4)));}
  // The exact damage radius lingers faintly so the shoved ring reads against it.
  this.ring(x,base+2,z,radius,hot(VECTOR,1.1),.32*(1-t));
  this.ring(x,base+1,z,radius*.75*(.4+.6*ease(age/.5)),hot(FOAM),.5*(1-t),BK.Foam,b.id);
  for(let i=0;i<Math.round(36*k);i++){
   const pl=.8+.4*R(i,0),pa=age-.02*R(i,1);if(pa<0||pa>pl)continue;const f=pa/pl,a=i*TAU/Math.round(36*k)+R(i,2)*.2,v=radius*(1.6+.6*R(i,3)),r0=L*.35+drift(pa,v,2.2);
   const y=drift(pa,180+160*R(i,4),1.2,520);if(y<0)continue;
   p.push(BK.Spray,x+Math.cos(a)*r0,base+y,z+Math.sin(a)*r0,(18+14*R(i,5))*(1+f*1.5),hot(SPRAY),.65*(1-f),R(i,6)*TAU,R(i,7));
  }
  for(let i=0;i<Math.round(12*k);i++){
   const pl=1+.3*R(i,10),pa=age-.04*R(i,11);if(pa<0||pa>pl)continue;const f=pa/pl,a=R(i,12)*TAU,r0=L*.25*R(i,13),y=drift(pa,320+220*R(i,14),.6,600);if(y<0)continue;
   p.push(BK.Spray,x+Math.cos(a)*r0,base+y,z+Math.sin(a)*r0,(24+18*R(i,15))*(1+f),hot(SPRAY),.6*(1-f),R(i,16)*TAU,R(i,17));
  }
  for(let i=0;i<Math.round((this.reduced?10:26)*k);i++){
   const pl=.5+.4*R(i,20),pa=age;if(pa>pl)continue;const f=pa/pl,a=R(i,21)*TAU,v=radius*(1.4+1.2*R(i,22)),up=120+260*R(i,23);
   const ox=drift(pa,v,2),oy=drift(pa,up,2,600),vx=driftSpeed(pa,v,2),vy=driftSpeed(pa,up,2,600);if(oy<-5)continue;
   p.push(BK.Spark,x+Math.cos(a)*ox,base+20+oy,z+Math.sin(a)*ox,1.4,blend(WHITE_HOT,VECTOR,f,2),1-f,0,0,Math.cos(a)*vx*.04,vy*.04,Math.sin(a)*vx*.04,1.5);
  }
 }
 /** Downwash under the airborne hull and a spray sheet trailing the dash line. */
 private flight(s:Ship,k:number){
  const d=s.architect!.drive!,x=s.renderPos.x,z=s.renderPos.z,base=this.surface(x,z),p=this.particles,L=s.spec.length,lift=Math.max(0,s.renderPos.y);
  this.ring(x,base+2,z,L*.45+lift*1.2,hot(VECTOR,1.2),.35+.25*Math.sin(d.elapsed*40)**2);
  this.ring(x,base+1,z,L*.55,hot(FOAM),.45,BK.Foam,s.id);
  const n=Math.round(12*k);
  for(let i=0;i<n;i++){const back=i*L*.18,f=i/n,px=x-d.dx*back,pz=z-d.dz*back;p.push(BK.Spray,px,this.surface(px,pz)+8+f*30,pz,(L*.18)*(1+f*1.5),hot(SPRAY),.5*(1-f),i*1.7,hash01(s.id,i));}
 }
 prepare(team:Team|-1,heightPx=720){
  this.particles.begin(heightPx);
  if(!this.game.over){
   const k=this.detail*(this.reduced?.6:1);
   for(const b of this.bursts){if(!this.visible(b.e.ship,team))continue;const age=this.game.time-b.time;if(b.e.phase==='launch')this.launch(b,age,k);else this.land(b,age,k);}
   for(const s of this.game.ships)if(s.alive&&s.architect?.drive?.moving&&this.visible(s,team))this.flight(s,k);
  }
  this.particles.end();
 }
 dispose(){for(const off of this.off)off();this.bursts=[];this.particles.dispose();}
}
