import { Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, Vector3, type Scene } from 'three';
import type { Game } from '../core/Game';
import type { GameEventMap } from '../core/Events';
import type { Team } from '../core/types';
import type { Ship } from '../ships/Ship';
import { contactVisible } from '../core/Targeting';
import { wrapAngle } from '../core/math';
import { audio } from '../fx/Audio';
import { waveHeight } from '../world/Waves';
import { reducedMotion, smooth } from './ArchitectPose';
import { stepperEchoGeometry } from './StepperGeometry';
import { quality } from './Quality';
import { StepperSpatial } from './StepperSpatial';
import { StepperWater } from './StepperWater';
import type { SpatialDistortion } from './SpatialDistortion';
import { Ribbons } from './Projectiles';

const VIOLET=new Color(0xb699ff).multiplyScalar(1.6),BLUE=new Color(0x8dbaff).multiplyScalar(1.4),RED=new Color(0xff567c).multiplyScalar(1.5);
const WHITE=new Color(0xf4ecff).multiplyScalar(2),DARK=new Color(0x100d20),REPAIR=new Color(0xb6ffe0);
const CAPACITY=64;
/** Flicker arrives along its path, then swings to face the target; the slash lands as the turn completes. */
export const FLICKER_TURN=.07;
const echoStrength=(s:Ship)=>s.stepper?.copy?.35:.85;
type Kind='flash'|'ram'|'broad'|'over'|'back'|'side'|'flicker'|'cross'|'birth';
interface Blink { ship:Ship; x:number;y:number;z:number;h:number; tx:number;tz:number;th:number;kind:Kind;age:number;life:number }
interface Pulse {ship:Ship;x:number;y:number;z:number;h:number;kind:'flicker'|'ram'|'muzzle'|'birth'|'dissolve';age:number;life:number;visible?:[boolean,boolean];final?:boolean}
interface Copy { ship:Ship;x:number;y:number;z:number;h:number;visible:[boolean,boolean] }

/** Three bounded GPU batches; events snapshot positions, never re-read an old teleport's destination. */
export class StepperFx {
  readonly light=new Ribbons(5000,true,false);
  readonly dark=new Ribbons(2500,false,false);
  readonly ghosts:InstancedMesh;
  readonly spatial:StepperSpatial;
  readonly water:StepperWater;
  readonly distortions:SpatialDistortion[]=[];
  private folds=new InstancedBufferAttribute(new Float32Array(CAPACITY),1).setUsage(DynamicDrawUsage);
  private fade=new InstancedBufferAttribute(new Float32Array(CAPACITY),1).setUsage(DynamicDrawUsage);
  private blinks:Blink[]=[];
  private pulses:Pulse[]=[];
  private copies=new Map<number,Copy>();
  private off:(()=>void)[]=[];
  private locals:Ship[]=[];
  private reduce=reducedMotion();
  private matrix=new Matrix4();private quat=new Quaternion();private point=new Vector3();private scale=new Vector3();private axis=new Vector3(0,1,0);
  constructor(private scene:Scene,private game:Game){
    this.spatial=new StepperSpatial(scene,'stepper');this.water=new StepperWater(scene,game);
    const geo=stepperEchoGeometry();geo.setAttribute('iFade',this.fade);geo.setAttribute('iFold',this.folds);
    const material=new MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.42,depthWrite:false,toneMapped:false});
    material.onBeforeCompile=shader=>{
      shader.vertexShader='attribute float iFold; attribute float iFade; varying float vFade; varying vec3 vEchoN; varying vec3 vEchoV;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvFade=iFade;float fold=smoothstep(-.25,.25,position.x/360.0+iFold*1.5-.75);transformed.z*=1.0-fold*.8;transformed.y+=fold*sin(position.x*.009)*8.0;').replace('#include <project_vertex>','#include <project_vertex>\nvEchoN=normalize(normalMatrix*mat3(instanceMatrix)*normal);vEchoV=-mvPosition.xyz;');
      shader.fragmentShader='varying float vFade; varying vec3 vEchoN; varying vec3 vEchoV;\n'+shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\nfloat rim=pow(clamp(1.0-abs(dot(normalize(vEchoN),normalize(vEchoV))),0.0,1.0),1.4);diffuseColor.a*=vFade*(.18+rim*.82);diffuseColor.rgb*=.8+rim*.7;');
    };
    material.customProgramCacheKey=()=> 'stepper-echo-fade';
    this.ghosts=new InstancedMesh(geo,material,CAPACITY);this.ghosts.count=0;this.ghosts.frustumCulled=false;this.ghosts.instanceMatrix.setUsage(DynamicDrawUsage);
    this.light.mesh.name='stepper-energy';this.dark.mesh.name='stepper-fractures';this.ghosts.name='stepper-silhouettes';
    scene.add(this.dark.mesh,this.light.mesh,this.ghosts);
    const ev=game.events;
    this.off.push(
      ev.on('blink',e=>this.blink(e)),
      ev.on('stepImpact',e=>{
        if(e.kind==='flicker'){
          this.pulse({ship:e.ship,x:e.x,y:12,z:e.z,h:e.ship.heading,kind:'flicker',age:this.reduce?0:-FLICKER_TURN,life:e.ship.stepper?.flicker?.count===19?.7:.42,final:e.ship.stepper?.flicker?.count===19});
          audio.play('hit',e.x,10,e.z,300,.6);
        }else{
          for(const c of game.ships.filter(s=>s.summonOwner===e.ship&&s.alive)){
            this.pulse({ship:c,x:c.pos.x,y:5,z:c.pos.z,h:c.heading,kind:'birth',age:0,life:.7});
            this.blinks.push({ship:c,x:e.x,y:5,z:e.z,h:e.ship.heading,tx:c.pos.x,tz:c.pos.z,th:c.heading,kind:'birth',age:0,life:.65});
          }
          this.trim();audio.cue('afterimageStep','activate','transform',e.x,20,e.z,this.locals.includes(e.ship));
        }
      }),
      ev.on('skillHit',e=>{if(e.skill.id==='ramStep')this.pulse({ship:e.attacker,x:e.ship.pos.x,y:12,z:e.ship.pos.z,h:e.attacker.heading,kind:'ram',age:0,life:.5});}),
      ev.on('gunFired',e=>{if(e.ship.spec.id==='stepper'&&!e.secondary)this.pulse({ship:e.ship,x:e.x,y:e.y,z:e.z,h:e.bearing,kind:'muzzle',age:0,life:.18});}),
      ev.on('respawn',e=>this.clearShip(e.ship)),ev.on('shipChanged',e=>this.clearShip(e.old)),
      ev.on('gameOver',()=>this.clear()),
    );
  }
  private blink(e:GameEventMap['blink']):void{
    const s=e.ship;if(s.spec.id!=='stepper'||this.game.over)return;
    const kind:Kind=e.dodge?'side':s.stepper?.cross?'cross':s.stepper?.flicker?'flicker':e.step??'flash';
    // Dodge trails outlive about two rearms (0.09 s) so rapid evasions stay readable instead of stacking.
    this.blinks.push({ship:s,x:e.fromX,y:s.pos.y+3,z:e.fromZ,h:e.fromHeading??s.heading,tx:s.pos.x,tz:s.pos.z,th:s.heading,kind,age:0,life:kind==='side'?.22:kind==='cross'||kind==='flicker'?.38:.55});this.trim();
    if(e.dodge)audio.cue('sideStep','activate','slash',s.pos.x,10,s.pos.z,this.locals.includes(s));
    else audio.play('zap',s.pos.x,10,s.pos.z,100,1);
  }
  private pulse(p:Pulse):void{if(!this.game.over){this.pulses.push(p);if(this.pulses.length>128)this.pulses.shift();}}
  private trim():void{if(this.blinks.length>64)this.blinks.splice(0,this.blinks.length-64);}
  private clearShip(s:Ship):void{this.blinks=this.blinks.filter(b=>b.ship!==s);this.pulses=this.pulses.filter(p=>p.ship!==s);this.copies.delete(s.id);}
  private clear():void{this.blinks=[];this.pulses=[];this.copies.clear();this.spatial.begin();this.spatial.end();this.water.begin();this.water.end();this.distortions.length=0;this.ghosts.count=0;this.light.begin();this.light.end();this.dark.begin();this.dark.end();}
  update(dt:number,locals:Ship[]=[]):void{
    this.locals=locals;if(this.game.over){this.clear();return;}
    for(const b of this.blinks)b.age+=dt;for(const p of this.pulses)p.age+=dt;
    this.blinks=this.blinks.filter(b=>b.age<b.life&&b.ship.alive&&!b.ship.withdrawn);
    this.pulses=this.pulses.filter(p=>p.age<p.life&&(p.kind==='dissolve'||p.ship.alive&&!p.ship.withdrawn));
    for(const [id,c] of this.copies)if(!c.ship.alive||c.ship.withdrawn||!this.game.ships.includes(c.ship)){
      this.pulse({...c,kind:'dissolve',age:0,life:.65});this.copies.delete(id);
    }
    for(const s of this.game.ships)if(s.alive&&!s.withdrawn&&s.stepper?.copy){
      this.copies.set(s.id,{ship:s,x:s.renderPos.x,y:s.renderPos.y+4,z:s.renderPos.z,h:s.renderHeading,visible:[contactVisible(s,0),contactVisible(s,1)]});
    }
  }
  foldPhase(s:Ship):number {
    for(let i=this.blinks.length-1;i>=0;i--){const b=this.blinks[i];if(b.ship===s)return Math.sin(Math.PI*Math.min(1,b.age/b.life));}
    return 0;
  }
  /** Yaw to add to the hull just after a Flicker arrival: it starts along the travel path and eases onto the target. */
  turnOffset(s:Ship):number {
    if(this.reduce)return 0;
    for(let i=this.blinks.length-1;i>=0;i--){
      const b=this.blinks[i];if(b.ship!==s)continue;
      if(b.kind!=='flicker'||b.age>=FLICKER_TURN||Math.hypot(b.tx-b.x,b.tz-b.z)<1)return 0;
      return wrapAngle(Math.atan2(b.tx-b.x,-(b.tz-b.z))-b.th)*(1-smooth(b.age/FLICKER_TURN));
    }
    return 0;
  }
  private visible(s:Ship,team:Team|-1):boolean{return s.alive&&!s.withdrawn&&!s.mods.banished&&(team===-1||contactVisible(s,team));}
  private color(s:Ship,team:Team|-1):Color{return team!==-1&&s.team!==team?RED:s.stepper?.copy?BLUE:VIOLET;}
  prepare(team:Team|-1,heightPx:number):void{
    this.light.begin();this.dark.begin();this.spatial.begin();this.water.begin();this.distortions.length=0;this.ghosts.count=0;
    this.light.material.uniforms.uViewportH.value=this.dark.material.uniforms.uViewportH.value=heightPx;
    if(!this.game.over){
      // Personal effects obey the same contact visibility as the existing skill presentation.
      for(const s of this.game.ships)if(s.spec.id==='stepper'&&this.visible(s,team))this.ship(s,this.color(s,team));
      for(const b of [...this.blinks].sort((a,b)=>Number(this.locals.includes(b.ship))-Number(this.locals.includes(a.ship))||a.age-b.age)){
        if(!this.visible(b.ship,team))continue;
        const color=this.color(b.ship,team),k=1-b.age/b.life,echo=!!b.ship.stepper?.copy;
        const age=b.age/b.life,travel=Math.atan2(b.tx-b.x,-(b.tz-b.z)),birth=b.kind==='birth';
        const blend=birth?(this.reduce?1:smooth(b.age/.35)):0;
        // The cosmetic departure folds along its own keel; the live hull stays at the resolved destination.
        this.ghost(b.x+(b.tx-b.x)*blend,b.y,b.z+(b.tz-b.z)*blend,b.h+(b.th-b.h)*blend,color,k*(echo?.45:.85),1,1,this.reduce?0:birth?1-blend:age);
        if(b.kind==='side'&&!this.reduce)for(let i=1;i<=2;i++){
          const t=i/3;this.ghost(b.x+(b.tx-b.x)*t,b.y,b.z+(b.tz-b.z)*t,b.h,color,k*(.45-t*.3),1,1,age);
        }
        if(!echo||birth||b.kind==='side'){
          // Paired longitudinal lips enclose the ship instead of standing upright beside it.
          this.hullFold(b.x,b.y,b.z,b.h,color,age,false,echo?.45:1);
          this.hullFold(b.tx,b.y,b.tz,b.th,color,age,true,echo?.45:1);
        }
        if(!echo||birth){
          this.water.add(b.x,b.z,travel,b.age,b.life,.6);
          this.water.add(b.tx,b.tz,b.th,b.age,b.life,1);
        }
        if(!this.reduce){
          const priority=this.locals.includes(b.ship)?3:echo?0:1;
          this.distortions.push({x:b.tx,y:b.y+35,z:b.tz,radius:230,strength:k*(echo?.22:.8),priority});
          if(!echo)this.distortions.push({x:b.x,y:b.y+35,z:b.z,radius:200,strength:k*.5,priority});
        }
        // A faint cut along each Flicker approach shows the strikes arriving from shifting sides.
        if(b.kind==='flicker'&&!echo&&Math.hypot(b.tx-b.x,b.tz-b.z)<1500)this.cut(b.x,b.y+8,b.z,b.tx,b.y+8,b.tz,color,k*.45,2);
        if(b.kind==='over'){
          const fx=Math.sin(b.th),fz=-Math.cos(b.th);
          this.spatial.blade(b.tx-fx*160,b.y+12,b.tz-fz*160,b.tx-fx*360,b.y+12,b.tz-fz*360,65,1-k,color,b.tx*.01,.7,Math.PI/2);
        }
      }
      for(const p of this.pulses){
        if(p.age<0)continue;
        if(p.kind==='dissolve'?(team!==-1&&!p.visible?.[team]):!this.visible(p.ship,team))continue;
        const color=this.color(p.ship,team),k=1-p.age/p.life;
        if(p.kind==='birth'||p.kind==='dissolve'){
          if(p.kind==='dissolve')this.ghost(p.x,p.y+(this.reduce?0:p.age*10),p.z,p.h,color,k*.7,1,1,1-k);
          for(let i=0;i<12;i++){
            const a=i*2.39996,r=45+(this.reduce?0:p.age*130),x=p.x+Math.cos(a)*r,z=p.z+Math.sin(a)*r;
            this.spatial.shard(x,p.y+20+i%3*22+p.age*25,z,a+(this.reduce?0:p.age*2),8+k*5,2.5,color,k*.8);
          }
          if(p.kind==='birth')this.hullFold(p.x,p.y,p.z,p.h,color,1-k,true,.45);
        }else if(p.kind==='muzzle'){
          const fx=Math.sin(p.h),fz=-Math.cos(p.h),strong=p.ship.stepper&&p.ship.stepper.broadUntil>this.game.time;
          this.cut(p.x,p.y,p.z,p.x+fx*(strong?100:55)*k,p.y,p.z+fz*(strong?100:55)*k,color,k,strong?6:3);
          for(const side of [-1,1])this.light.push(p.x,p.y,p.z,p.x+fx*28+Math.cos(p.h)*side*18,p.y+12,p.z+fz*28+Math.sin(p.h)*side*18,WHITE,k,1,1.2);
        }else{
          const length=p.final?520:p.kind==='ram'?260:340,fx=Math.sin(p.h),fz=-Math.cos(p.h),age=1-k;
          this.spatial.blade(p.x-fx*length*.6,18,p.z-fz*length*.6,p.x+fx*length,65,p.z+fz*length,p.final?300:180,age,color,p.x*.01,echoStrength(p.ship),.65);
          if(p.final)this.spatial.blade(p.x-fz*length,35,p.z+fx*length,p.x+fz*length,90,p.z-fx*length,180,age,color,p.z*.01,.8,-.7);
          this.water.add(p.x,p.z,p.h,p.age,p.life,p.final?1:.55,p.final?1.8:1);
          if(!this.reduce)this.distortions.push({x:p.x,y:45,z:p.z,radius:p.final?450:200,strength:k*(p.final?1:.55),priority:this.locals.includes(p.ship)?4:1});
        }
      }
      for(const t of this.game.torps.torps)if(t.alive&&t.skill?.id==='overStep'&&(team===-1||t.team===team||t.seen)){
        const color=this.color(t.owner,team),y=waveHeight(t.x,t.z,this.game.renderTime)+3,fx=Math.sin(t.heading),fz=-Math.cos(t.heading);
        // Wakes scale with the 320-knot run so the fan still reads from a battle camera.
        this.spatial.blade(t.x-fx*220,y+1,t.z-fz*220,t.x,y+1,t.z,18,.3,color,t.x*.01,.42,Math.PI/2);
        this.light.push(t.x-fx*240,y,t.z-fz*240,t.x,y,t.z,color,.85,4,2.5);
        this.light.push(t.x-fx*40,y+.2,t.z-fz*40,t.x,y+.2,t.z,WHITE,1,1.6,1.6);
      }
    }
    this.light.end();this.dark.end();this.spatial.end();this.water.end();this.ghosts.instanceMatrix.needsUpdate=true;this.fade.needsUpdate=true;this.folds.needsUpdate=true;
    if(this.ghosts.instanceColor)this.ghosts.instanceColor.needsUpdate=true;
  }
  private ship(s:Ship,color:Color):void{
    const st=s.stepper;if(!st)return;const now=this.game.time,x=s.renderPos.x,z=s.renderPos.z,y=s.renderPos.y+18,h=s.renderHeading+this.turnOffset(s);
    const fx=Math.sin(h),fz=-Math.cos(h),rx=Math.cos(h),rz=Math.sin(h);
    const line=(ax:number,ay:number,az:number,bx:number,by:number,bz:number,c:Color,k:number,w=1.5)=>this.light.push(x+fx*ax+rx*az,y+ay,z+fz*ax+rz*az,x+fx*bx+rx*bz,y+by,z+fz*bx+rz*bz,c,k,w,1);
    if(st.rush){
      for(const side of [-1,1])this.spatial.blade(x-fx*160+rx*side*40,y+4,z-fz*160+rz*side*40,x+fx*215,y+8,z+fz*215,75,.28,color,side,.65,side*.85);
      for(const side of [-1,1]){line(-140,8,side*40,205,12,0,color,.9,5);line(-170,6,side*40,-300,6,side*60,color,.6,3);}
    }
    if(st.broadUntil>now){
      for(const side of [-1,1])line(-125,0,side*16,125,0,side*16,color,.8,2);
      for(const turret of s.turrets){
        const tx=x+fx*turret.spec.x, tz=z+fz*turret.spec.x, ty=y+turret.spec.y;
        this.spatial.arc(x-fx*17,y+30,z-fz*17,x+fx*turret.spec.x*.5,y+14,z+fz*turret.spec.x*.5,tx,ty,tz,9,.3,color,turret.spec.x,.5,.5);
        const bearing=h+turret.yaw*Math.PI/180,dx=Math.sin(bearing),dz=-Math.cos(bearing);
        this.light.push(tx,ty+7,tz,tx+dx*34,ty+7,tz+dz*34,WHITE,.8,1.2,.8);
      }
    }
    if(st.repair){
      const c=color===RED?RED:REPAIR;
      for(const side of [-1,1]){
        const phase=this.reduce?.3:(this.game.renderTime*.5)%1;
        this.spatial.arc(x-fx*155,y-2,z-fz*155,x+rx*side*40,y+16,z+rz*side*40,x+fx*155,y-2,z+fz*155,18,this.reduce?.3:.12+phase*.6,c,side,.5,.8);
        line(-150,0,side*17,150,0,side*17,c,.35,1);
      }
    }
    if(st.sideUntil>now)for(const side of [-1,1])for(const end of [-1,1]){
      line(end*100,3,side*33,end*130,3,side*39,color,.6,1.5);
      line(end*130,3,side*39,end*145,3,side*27,color,.6,1.5);
    }
    // Edge tracery gives translucent copies a stable silhouette even with bloom disabled.
    if(st.copy)for(const side of [-1,1]){
      line(-175,-3,side*10,130,-3,side*21,color,.7,1.5);line(130,-3,side*21,180,0,0,color,.7,1.5);
      for(const tx of [-115,-78,78,115])line(tx-9,15,side*10,tx+9,15,side*10,color,.7,1);
    }
  }
  private ghost(x:number,y:number,z:number,h:number,color:Color,opacity:number,scale:number,compress=1,fold=0):void{
    const i=this.ghosts.count;if(i>=CAPACITY)return;
    this.point.set(x,y,z);this.quat.setFromAxisAngle(this.axis,Math.PI/2-h);this.scale.set(scale,scale,scale*compress);
    this.matrix.compose(this.point,this.quat,this.scale);this.ghosts.setMatrixAt(i,this.matrix);this.ghosts.setColorAt(i,color);this.fade.setX(i,Math.max(0,opacity));this.folds.setX(i,fold);this.ghosts.count++;
  }
  private cut(ax:number,ay:number,az:number,bx:number,by:number,bz:number,c:Color,k:number,w:number):void{
    this.dark.push(ax,ay,az,bx,by,bz,DARK,k*.7,w*2.5,2.5);
    this.light.push(ax,ay+.3,az,bx,by+.3,bz,c,k,w,1.4);
    if(quality().particles>=.8)this.light.push(ax,ay+.5,az,bx,by+.5,bz,WHITE,k*.6,w*.22,.7);
  }
  private hullFold(x:number,y:number,z:number,h:number,c:Color,age:number,arrival:boolean,strength:number):void{
    const fx=Math.sin(h),fz=-Math.cos(h),rx=Math.cos(h),rz=Math.sin(h);
    const sweep=this.reduce?0:(arrival?-1:1)*(smooth(age)-.5)*210;
    // A pair of thin curved seams grows out of the reactor, bows around the armor, and seals along the keel.
    for(const side of [-1,1]){
      this.spatial.arc(x-fx*175,y+10,z-fz*175,x+rx*side*65,y+45,z+rz*side*65,x+fx*180,y+10,z+fz*180,45,Math.min(.99,age*.88+.04),c,x*.007+side,strength*.85,side*1.1);
    }
    const cx=x+fx*sweep,cz=z+fz*sweep;
    this.spatial.tear(cx,y+32,cz,h,100,95,Math.min(.99,age*.9+.03),c,z*.011,strength*.65);
    for(let i=0;i<6;i++){
      const a=i*2.39996,along=(i-2.5)*54+sweep*.2,spread=(this.reduce?0:Math.sin(age*Math.PI)*24);
      this.spatial.shard(x+fx*along+rx*Math.cos(a)*(28+spread),y+12+(i%3)*9,z+fz*along+rz*Math.cos(a)*(28+spread),a+(this.reduce?0:age),3+(1-age)*3,2.4,c,(1-age)*strength*.55);
    }
  }
  dispose():void{this.off.forEach(f=>f());this.clear();this.scene.remove(this.light.mesh,this.dark.mesh,this.ghosts);this.light.dispose();this.dark.dispose();this.spatial.dispose();this.water.dispose();this.ghosts.dispose();this.ghosts.geometry.dispose();(this.ghosts.material as MeshBasicMaterial).dispose();}
}
