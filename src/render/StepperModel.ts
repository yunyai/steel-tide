import { Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, OctahedronGeometry, TorusGeometry, type BufferGeometry, type Material } from 'three';
import type { Ship } from '../ships/Ship';
import { Parts } from './Geometry';
import { reducedMotion, smooth } from './ArchitectPose';
import { STEP, stepperPlateGeometry } from './StepperGeometry';

/** Read-only presentation: the keel and actual weapon mounts never move with the floating armor. */
export class StepperModel {
  readonly root=new Group();
  private plates:Group[]=[];
  private rings:Group[]=[];
  private shutters:Group[]=[];
  private core=new Group();
  private owned:BufferGeometry[]=[];
  private armor=new MeshStandardMaterial({color:0xffffff,vertexColors:true,metalness:.68,roughness:.4});
  private light=new MeshBasicMaterial({color:STEP.violet,toneMapped:false});
  private white=new MeshBasicMaterial({color:STEP.white,toneMapped:false});
  private reduce=reducedMotion();
  constructor(make:(g:BufferGeometry,m:Material)=>Mesh){
    this.root.name='stepper-phase-drive';
    const add=(g:BufferGeometry,m:Material,parent:Group=this.root)=>{this.owned.push(g);const mesh=make(g,m);parent.add(mesh);return mesh;};
    const frame=new Parts(),veins=new Parts();
    for(const side of [-1,1]){
      frame.box(258,4,4,-7,10,side*18,STEP.armor);
      for(const x of [-105,0,105]){
        frame.box(10,4,30,x,8,side*15,STEP.edge,{taper:.15});
        const plate=new Group();plate.name=`stepper-armor-${this.plates.length}`;this.root.add(plate);this.plates.push(plate);
        add(stepperPlateGeometry(),this.armor,plate);add(stepperPlateGeometry(true),this.light,plate);
      }
      veins.box(250,.8,1.2,-7,14,side*17,STEP.violet);
      veins.box(22,1,1,34,36,side*9,STEP.violet);
      veins.box(1,5,6,-174,14,side*11,STEP.violet);
      // Raked mechanical struts frame the reactor without hiding the bridge or guns.
      frame.box(8,31,5,-32,19,side*19,STEP.edge,{rz:-.3});
      frame.box(8,22,5,0,18,side*19,STEP.armor,{rz:.3});
    }
    add(frame.merge(),this.armor);add(veins.merge(),this.light);
    this.core.position.set(-17,48,0);this.core.name='stepper-reactor';this.root.add(this.core);
    const crystal=add(new OctahedronGeometry(12,0),this.white,this.core);crystal.scale.set(.8,1.65,.8);
    const cage=new Parts();for(const side of [-1,1])cage.add(new OctahedronGeometry(8),STEP.armor,0,side*24,0,{sy:1.6,sx:.8,sz:.8});add(cage.merge(),this.armor,this.core);
    for(let i=0;i<3;i++){
      const ring=new Group();ring.name=`stepper-reactor-ring-${i}`;ring.position.set(-17,48,0);this.root.add(ring);this.rings.push(ring);
      const p=new Parts(),l=new Parts(),radius=27+i*8;
      for(let j=0;j<8;j++){
        const a=j*Math.PI/4;
        p.add(new TorusGeometry(radius,1.8,5,8,.59),STEP.edge,0,0,0,{rz:a});
        l.add(new TorusGeometry(radius-2.7,.65,4,8,.45),STEP.white,0,0,0,{rz:a+.06});
        p.box(5,4,4,Math.cos(a)*radius,Math.sin(a)*radius-2,0,STEP.dark,{rz:a});
      }
      add(p.merge(),this.armor,ring);add(l.merge(),i===1?this.white:this.light,ring);
    }
    for(const side of [-1,1]){
      const shutter=new Group();shutter.position.set(-17,25,side*10);this.root.add(shutter);this.shutters.push(shutter);
      const p=new Parts();p.box(37,3,10,0,0,0,STEP.edge,{taper:.2});p.box(27,1,6,0,3,0,STEP.armor);add(p.merge(),this.armor,shutter);
    }
    this.pose(0);
  }
  pose(time:number,ship?:Ship):void{
    const st=ship?.alive&&!ship.withdrawn&&!ship.game.over?ship.stepper:null;
    const now=ship?.game.time??0,t=this.reduce?0:time;
    const cross=st?.cross,flicker=st?.flicker;
    const copies=!!st&&!st.copy&&st.copies.some(id=>ship!.game.ships.some(s=>s.id===id&&s.alive&&!s.withdrawn));
    const copyTime=ship?.skills[8]?.time??0;
    const ultimate=cross?smooth(cross.elapsed/.22):flicker?smooth(flicker.elapsed/.2):copies?.65*smooth((18-copyTime)/.3):0;
    const spread=ultimate*(this.reduce?.45:1),broad=st&&st.broadUntil>now?1:0,rush=st?.rush?1:0;
    const phase=st&&st.phaseUntil>now?1:0,sideArmed=st&&st.sideUntil>now?1:0;
    this.plates.forEach((p,i)=>{
      const side=i<3?-1:1,n=i%3-1;
      p.position.set(n*(105+spread*(cross?42:27))+rush*10,9+spread*(cross?35:23)+Math.sin(t*1.2+i)*.6,side*(25+spread*(cross?42:32)+broad*7));
      p.rotation.set(side*spread*(cross?.32:.16),side*(.055+n*spread*.14),n*(spread*.12+rush*.08));
    });
    this.core.position.y=48+spread*22+Math.sin(t*1.5)*.7;
    this.core.rotation.y=t*.35;
    this.rings.forEach((r,i)=>{
      r.position.y=48+spread*22;r.position.x=-17+(i-1)*spread*(cross?24:17);
      r.scale.setScalar(1+spread*(.4+i*.08));
      const axes=[[.35,.55,0],[Math.PI/2,.2,0],[.4,Math.PI/2,-.6]][i];
      r.rotation.set(axes[0]*(1-spread*.5)+t*(i%2?.14:-.12),axes[1]+spread*(i-1)*.25,t*.12+axes[2]);
    });
    this.shutters.forEach((p,i)=>{p.position.z=(i?1:-1)*(10+spread*20);p.rotation.x=(i?1:-1)*spread*.65;});
    const spectral=!!ship?.stepper?.copy;
    this.armor.transparent=spectral;this.armor.opacity=spectral?.35:1;this.armor.depthWrite=!spectral;
    this.armor.color.setHex(spectral?0xb9a6ee:0xffffff);
    this.light.color.setHex(spectral?0x8bafff:st?.repair?0xb7ffe4:STEP.violet).multiplyScalar(1+ultimate*.35+broad*.2+sideArmed*.12);
    this.white.color.setHex(STEP.white).multiplyScalar(1+phase*.25);
  }
  dispose():void{for(const g of this.owned)g.dispose();this.armor.dispose();this.light.dispose();this.white.dispose();}
}
