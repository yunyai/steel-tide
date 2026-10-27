import { Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, Vector3, type Scene } from 'three';
import type { Game } from '../core/Game';
import type { GameEventMap } from '../core/Events';
import type { Team } from '../core/types';
import type { Ship } from '../ships/Ship';
import { contactVisible } from '../core/Targeting';
import { audio } from '../fx/Audio';
import { waveHeight } from '../world/Waves';
import { reducedMotion, smooth } from './ArchitectPose';
import { stepperEchoGeometry } from './StepperGeometry';
import { quality } from './Quality';
import { StepperSpatial } from './StepperSpatial';
import { Ribbons } from './Projectiles';

const VIOLET=new Color(0xb699ff).multiplyScalar(1.6),BLUE=new Color(0x8dbaff).multiplyScalar(1.4),RED=new Color(0xff567c).multiplyScalar(1.5);
const WHITE=new Color(0xf4ecff).multiplyScalar(2),DARK=new Color(0x100d20),REPAIR=new Color(0xb6ffe0);
const CAPACITY=64;
type Kind='flash'|'ram'|'broad'|'over'|'back'|'side'|'flicker'|'cross'|'birth';
interface Blink { ship:Ship; x:number;y:number;z:number;h:number; tx:number;tz:number;th:number;kind:Kind;age:number;life:number }
interface Pulse {ship:Ship;x:number;y:number;z:number;h:number;kind:'flicker'|'ram'|'muzzle'|'birth'|'dissolve';age:number;life:number;visible?:[boolean,boolean]}
interface Copy { ship:Ship;x:number;y:number;z:number;h:number;visible:[boolean,boolean] }

/** Three bounded GPU batches; events snapshot positions, never re-read an old teleport's destination. */
export class StepperFx {
  readonly light=new Ribbons(5000,true,false);
  readonly dark=new Ribbons(2500,false,false);
  readonly ghosts:InstancedMesh;
  readonly spatial:StepperSpatial;
  private fade=new InstancedBufferAttribute(new Float32Array(CAPACITY),1).setUsage(DynamicDrawUsage);
  private blinks:Blink[]=[];
  private pulses:Pulse[]=[];
  private copies=new Map<number,Copy>();
  private off:(()=>void)[]=[];
  private locals:Ship[]=[];
  private reduce=reducedMotion();
  private matrix=new Matrix4();private quat=new Quaternion();private point=new Vector3();private scale=new Vector3();private axis=new Vector3(0,1,0);
  constructor(private scene:Scene,private game:Game){
    this.spatial=new StepperSpatial(scene,'stepper');
    const geo=stepperEchoGeometry();geo.setAttribute('iFade',this.fade);
    const material=new MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.42,depthWrite:false,toneMapped:false});
    material.onBeforeCompile=shader=>{
      shader.vertexShader='attribute float iFade; varying float vFade; varying vec3 vEchoN; varying vec3 vEchoV;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvFade=iFade;').replace('#include <project_vertex>','#include <project_vertex>\nvEchoN=normalize(normalMatrix*mat3(instanceMatrix)*normal);vEchoV=-mvPosition.xyz;');
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
          this.pulse({ship:e.ship,x:e.x,y:12,z:e.z,h:e.ship.heading,kind:'flicker',age:0,life:.38});
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
    this.blinks.push({ship:s,x:e.fromX,y:s.pos.y+3,z:e.fromZ,h:e.fromHeading??s.heading,tx:s.pos.x,tz:s.pos.z,th:s.heading,kind,age:0,life:kind==='side'?.3:.42});this.trim();
    if(e.dodge)audio.cue('sideStep','activate','slash',s.pos.x,10,s.pos.z,this.locals.includes(s));
    else audio.play('zap',s.pos.x,10,s.pos.z,100,1);
  }
  private pulse(p:Pulse):void{if(!this.game.over){this.pulses.push(p);if(this.pulses.length>128)this.pulses.shift();}}
  private trim():void{if(this.blinks.length>64)this.blinks.splice(0,this.blinks.length-64);}
  private clearShip(s:Ship):void{this.blinks=this.blinks.filter(b=>b.ship!==s);this.pulses=this.pulses.filter(p=>p.ship!==s);this.copies.delete(s.id);}
  private clear():void{this.blinks=[];this.pulses=[];this.copies.clear();this.spatial.begin();this.spatial.end();this.ghosts.count=0;this.light.begin();this.light.end();this.dark.begin();this.dark.end();}
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
  private visible(s:Ship,team:Team|-1):boolean{return s.alive&&!s.withdrawn&&!s.mods.banished&&(team===-1||contactVisible(s,team));}
  private color(s:Ship,team:Team|-1):Color{return team!==-1&&s.team!==team?RED:s.stepper?.copy?BLUE:VIOLET;}
  prepare(team:Team|-1,heightPx:number):void{
    this.light.begin();this.dark.begin();this.spatial.begin();this.ghosts.count=0;
    this.light.material.uniforms.uViewportH.value=this.dark.material.uniforms.uViewportH.value=heightPx;
    if(!this.game.over){
      // Personal effects obey the same contact visibility as the existing skill presentation.
      for(const s of this.game.ships)if(s.spec.id==='stepper'&&this.visible(s,team))this.ship(s,this.color(s,team));
      for(const b of this.blinks){
        if(!this.visible(b.ship,team))continue;
        const color=this.color(b.ship,team),k=1-b.age/b.life,echo=!!b.ship.stepper?.copy;
        const n=b.kind==='side'&&!this.reduce?3:1;
        for(let i=0;i<n;i++){
          const t=b.kind==='birth'?smooth(b.age/.35):i/3;this.ghost(b.x+(b.tx-b.x)*t,b.y,b.z+(b.tz-b.z)*t,b.h,color,k*(1-t*.65),b.kind==='back'?1-b.age/b.life*.4:1,b.kind==='flash'?1-b.age/b.life*.7:1);
        }
        if(!echo||b.kind==='side'||b.kind==='birth'){
          this.fracture(b.x,b.y+58,b.z,b.h,color,k,0.7);
          this.fracture(b.tx,b.y+58,b.tz,b.th,color,k,1);
        }
        const d=Math.hypot(b.tx-b.x,b.tz-b.z);
        if(d>1){
          // Only a faint line connects long jumps; the endpoints carry the visual weight.
          const u=this.reduce?.5:smooth(b.age/b.life),x=b.x+(b.tx-b.x)*u,z=b.z+(b.tz-b.z)*u;
          this.light.push(b.x,b.y+18,b.z,b.tx,b.y+18,b.tz,color,k*(echo?.09:.18),2,1);
          if(!this.reduce)this.light.push(x-(b.tx-b.x)*.05,b.y+22,z-(b.tz-b.z)*.05,x,b.y+22,z,color,k*.8,5,2);
        }
        if(b.kind==='over'){
          const fx=Math.sin(b.th),fz=-Math.cos(b.th);
          this.spatial.blade(b.tx-fx*160,b.y+12,b.tz-fz*160,b.tx-fx*360,b.y+12,b.tz-fz*360,65,1-k,color,b.tx*.01,.7,Math.PI/2);
        }
      }
      for(const p of this.pulses){
        if(p.kind==='dissolve'?(team!==-1&&!p.visible?.[team]):!this.visible(p.ship,team))continue;
        const color=this.color(p.ship,team),k=1-p.age/p.life;
        if(p.kind==='birth'||p.kind==='dissolve'){
          this.ghost(p.x,p.y+(this.reduce?0:p.age*24),p.z,p.h,color,k*.7,1+(p.kind==='dissolve'?p.age*.2:0));
          for(let i=0;i<12;i++){
            const a=i*2.39996,r=45+(this.reduce?0:p.age*130),x=p.x+Math.cos(a)*r,z=p.z+Math.sin(a)*r;
            this.spatial.shard(x,p.y+20+i%3*22+p.age*25,z,a+(this.reduce?0:p.age*2),8+k*5,2.5,color,k*.8);
          }
          if(p.kind==='birth')this.fracture(p.x,p.y+70,p.z,p.h,color,k,1.3);
        }else if(p.kind==='muzzle'){
          const fx=Math.sin(p.h),fz=-Math.cos(p.h),strong=p.ship.stepper&&p.ship.stepper.broadUntil>this.game.time;
          this.cut(p.x,p.y,p.z,p.x+fx*(strong?100:55)*k,p.y,p.z+fz*(strong?100:55)*k,color,k,strong?6:3);
          for(const side of [-1,1])this.light.push(p.x,p.y,p.z,p.x+fx*28+Math.cos(p.h)*side*18,p.y+12,p.z+fz*28+Math.sin(p.h)*side*18,WHITE,k,1,1.2);
        }else{
          const length=p.kind==='ram'?240:320;
          for(const side of [-1,1]){
            const a=p.h+side*.6,dx=Math.cos(a)*length,dz=Math.sin(a)*length;
            this.spatial.blade(p.x-dx,12,p.z-dz,p.x+dx,160,p.z+dz,170,1-k,color,side+p.x*.01,1,side*.75);
          }
          this.fracture(p.x,70,p.z,p.h,color,k,.8);
        }
      }
      for(const t of this.game.torps.torps)if(t.alive&&t.skill?.id==='overStep'&&(team===-1||t.team===team||t.seen)){
        const color=this.color(t.owner,team),y=waveHeight(t.x,t.z,this.game.renderTime)+3,fx=Math.sin(t.heading),fz=-Math.cos(t.heading);
        this.light.push(t.x-fx*110,y,t.z-fz*110,t.x,y,t.z,color,.75,3,1.5);
        this.light.push(t.x-fx*22,y+.2,t.z-fz*22,t.x,y+.2,t.z,WHITE,.8,1,1);
      }
    }
    this.light.end();this.dark.end();this.spatial.end();this.ghosts.instanceMatrix.needsUpdate=true;this.fade.needsUpdate=true;
    if(this.ghosts.instanceColor)this.ghosts.instanceColor.needsUpdate=true;
  }
  private ship(s:Ship,color:Color):void{
    const st=s.stepper;if(!st)return;const now=this.game.time,x=s.renderPos.x,z=s.renderPos.z,y=s.renderPos.y+18,h=s.renderHeading;
    const fx=Math.sin(h),fz=-Math.cos(h),rx=Math.cos(h),rz=Math.sin(h);
    const line=(ax:number,ay:number,az:number,bx:number,by:number,bz:number,c:Color,k:number,w=1.5)=>this.light.push(x+fx*ax+rx*az,y+ay,z+fz*ax+rz*az,x+fx*bx+rx*bz,y+by,z+fz*bx+rz*bz,c,k,w,1);
    if(st.rush){
      for(const side of [-1,1]){line(-140,8,side*40,205,12,0,color,.9,5);line(-170,6,side*40,-300,6,side*60,color,.6,3);}
    }
    if(st.broadUntil>now)for(const side of [-1,1]){
      line(-125,0,side*16,125,0,side*16,color,.8,2);
      for(const tx of [-115,-78,78,115])line(tx,0,side*16,tx,10,0,WHITE,.65,1);
    }
    if(st.repair){
      const c=color===RED?RED:REPAIR;
      for(const side of [-1,1])for(let i=0;i<5;i++){
        const a=-140+i*65,up=this.reduce?12:((this.game.renderTime*.7+i*.2)%1)*24;
        line(a,up,side*17,a+24,up+7,side*17,c,.7,2);
        line(a+24,up+7,side*17,a+38,up+7,side*17,c,.7,2);
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
  private ghost(x:number,y:number,z:number,h:number,color:Color,opacity:number,scale:number,compress=1):void{
    const i=this.ghosts.count;if(i>=CAPACITY)return;
    this.point.set(x,y,z);this.quat.setFromAxisAngle(this.axis,Math.PI/2-h);this.scale.set(scale,scale,scale*compress);
    this.matrix.compose(this.point,this.quat,this.scale);this.ghosts.setMatrixAt(i,this.matrix);this.ghosts.setColorAt(i,color);this.fade.setX(i,Math.max(0,opacity));this.ghosts.count++;
  }
  private cut(ax:number,ay:number,az:number,bx:number,by:number,bz:number,c:Color,k:number,w:number):void{
    this.dark.push(ax,ay,az,bx,by,bz,DARK,k*.7,w*2.5,2.5);
    this.light.push(ax,ay+.3,az,bx,by+.3,bz,c,k,w,1.4);
    if(quality().particles>=.8)this.light.push(ax,ay+.5,az,bx,by+.5,bz,WHITE,k*.6,w*.22,.7);
  }
  private fracture(x:number,y:number,z:number,h:number,c:Color,k:number,size:number):void{
    const age=1-k,seed=x*.007+z*.011;
    this.spatial.tear(x,y+15,z,h,145*size,290*size,age,c,seed,.95);
    // Solid dark facets tumble out of the tear; the hot lips remain the focal point.
    const count=quality().particles>=.8?8:5;
    for(let i=0;i<count;i++){
      const a=i*2.39996+seed,travel=this.reduce?35:20+age*100;
      this.spatial.shard(x+Math.cos(a)*travel*size,y+(i%3-1)*35*size+age*30,z+Math.sin(a)*travel*size,a+(this.reduce?0:age*3),size*(5+k*6),2.6,c,k*.8);
    }
  }
  dispose():void{this.off.forEach(f=>f());this.clear();this.scene.remove(this.light.mesh,this.dark.mesh,this.ghosts);this.light.dispose();this.dark.dispose();this.spatial.dispose();this.ghosts.dispose();this.ghosts.geometry.dispose();(this.ghosts.material as MeshBasicMaterial).dispose();}
}
