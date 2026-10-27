import { ELEMENTS, ELEMENT_STYLE, type ArchitectElement } from '../skills/misc/ArchitectElements';
import { Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, TorusGeometry, Vector3, type BufferGeometry, type Material } from 'three';
import type { ShipSpec } from '../core/types';
import type { Ship } from '../ships/Ship';
import { Parts } from './Geometry';
import { ASSEMBLY_HEIGHT, ASSEMBLY_MUZZLE, reducedMotion, satellitePose, smooth } from './ArchitectPose';

const DARK=0x253541,EDGE=0x526b79,IVORY=0xd5d9d0,BLACK=0x0e1b25,GOLD=0xffbd66,CYAN=0x91edff;

/** Architect alone uses these heavy gun houses; normal railgun ships keep their own silhouette. */
export function architectTurretGeometry(element:ArchitectElement='furnace'){
  const accent=ELEMENT_STYLE[element].color;
  const house=new Parts(),guns=new Parts(),glow=new Parts();
  house.cyl(12,14,5,0,0,0,DARK,{seg:12});
  house.cyl(12.3,12.3,1.4,0,4,0,accent,{seg:12});
  house.box(31,15,24,-4,5,0,IVORY,{taper:.18,slope:3});
  house.box(24,3,18,-6,20,0,EDGE,{taper:.15});
  house.box(9,9,26,11,8,0,DARK,{taper:.1});
  for(const z of [-1,1]){
    house.box(21,5,3,-7,9,z*12,EDGE);
    house.box(12,1.3,2,-8,18,z*10,accent);
    for(let x=-14;x<=-2;x+=4)house.box(2,3,1.5,x,12,z*14,BLACK);
    guns.box(42,4,4,20,-2,z*6.5,DARK);
    guns.box(36,2,1.6,21,0,z*6.5,accent);
    guns.box(34,2,1.4,18,2.2,z*8.7,IVORY);
    guns.box(34,2,1.4,18,2.2,z*4.3,IVORY);
    guns.box(8,8,8,3,-4,z*6.5,EDGE,{taper:.1});
    guns.box(6,7,7,40,-3.5,z*6.5,IVORY,{taper:.12});
    guns.box(1,3,3,43.1,-1.5,z*6.5,BLACK);
  }
  if(element==='furnace'){
    house.box(17,16,22,-16,12,0,DARK,{taper:.12});
    for(const z of [-1,1])for(let x=-22;x<=-10;x+=4){house.box(2,10,3,x,17,z*12,accent);house.box(3,2,5,x,27,z*12,EDGE);}
    guns.box(17,8,20,29,-4,0,EDGE,{taper:.18});guns.box(14,2,14,29,5,0,accent);
  }else if(element==='cryo'){
    for(const z of [-1,1]){house.cyl(4,4,20,-12,18,z*15,EDGE,{seg:8,rz:Math.PI/2});house.cyl(2.5,2.5,17,-12,18,z*15,accent,{seg:8,rz:Math.PI/2});for(let x=-16;x<=2;x+=5)house.box(2,9,7,x,20,z*8,IVORY,{taper:.3});}
    guns.box(22,4,22,18,2,0,IVORY,{taper:.2});guns.box(24,1,13,18,6,0,accent);
  }else if(element==='storm'){
    for(const z of [-1,1]){house.box(8,25,6,-8,13,z*13,EDGE,{taper:.2});for(let y=21;y<39;y+=5)house.box(11,2,9,-8,y,z*13,accent);house.box(16,5,7,-7,38,z*13,IVORY,{taper:.2});}
    for(const x of [12,23,34])guns.box(3,11,24,x,-5,0,EDGE);
  }else if(element==='gravity'){
    house.box(12,24,29,-13,10,0,DARK,{taper:.2});
    for(const x of [11,25,38]){guns.add(new TorusGeometry(13,2,6,16),EDGE,x,0,0,{ry:Math.PI/2});guns.add(new TorusGeometry(10.5,1,5,20),accent,x,0,0,{ry:Math.PI/2});}
  }else{
    for(const z of [-1,1]){house.box(25,9,4,-5,21,z*12,IVORY,{rz:z*.18,taper:.3});guns.box(36,5,5,22,5,z*10,IVORY,{rz:z*.1,taper:.25});guns.box(34,1,2,23,10,z*10,accent);}
    guns.box(35,3,3,23,0,0,accent);guns.box(8,10,18,42,-4,0,EDGE,{taper:.25});
  }
  for(const z of [-1,1]){glow.box(18,1.4,1.5,-7,22,z*11,accent);glow.box(4,6,1.4,6,13,z*13,accent);}
  if(element==='furnace')for(const z of [-1,1])for(let x=-22;x<=-10;x+=4)glow.box(1.5,9,1,x,18,z*13.6,accent);
  if(element==='cryo')for(const z of [-1,1])glow.cyl(2.7,2.7,17,-12,18,z*15,accent,{seg:8,rz:Math.PI/2});
  if(element==='storm')for(const z of [-1,1])for(let y=21;y<39;y+=5)glow.box(11.2,1.2,9.2,-8,y+.5,z*13,accent);
  if(element==='gravity')glow.add(new TorusGeometry(11,.8,5,24),accent,34,15,0,{ry:Math.PI/2});
  if(element==='prism')for(const z of [-1,1])glow.box(23,1,1,-5,30,z*12,accent);
  return {house:house.merge(),guns:guns.merge(),glow:glow.merge(),pivotX:10,pivotY:15};
}

export const architectGlowMaterial=new MeshBasicMaterial({color:0xffffff,vertexColors:true,toneMapped:false});
architectGlowMaterial.color.setRGB(1.6,1.6,1.6);
const elementalGeometry=new Map<ArchitectElement,ReturnType<typeof architectTurretGeometry>>();
export function elementalTurretGeometry(element:ArchitectElement){let g=elementalGeometry.get(element);if(!g){g=architectTurretGeometry(element);elementalGeometry.set(element,g);}return g;}

/** Mechanical silhouettes are merged by material; only clamps, outriggers and satellites articulate. */
export class ArchitectModel {
  readonly root=new Group();
  readonly docks:Group[]=[];
  private clamps:Group[][]=[];
  private supports:Group[]=[];
  private jets=new Group();
  private gun=new Group();
  private cannon=new Group();
  private rails:Group[]=[];
  private vents:Group[]=[];
  private satellites:Group[]=[];
  private owned:BufferGeometry[]=[];
  private armor=new MeshStandardMaterial({color:0xffffff,vertexColors:true,metalness:.65,roughness:.42});
  private amber=new MeshBasicMaterial({color:GOLD,toneMapped:false});
  private blue=new MeshBasicMaterial({color:CYAN,toneMapped:false});
  private reduce=reducedMotion();
  private point=new Vector3();

  constructor(make:(g:BufferGeometry,m:Material)=>Mesh,spec:ShipSpec){
    const add=(parts:Parts,parent:Group,material:Material=this.armor)=>{
      const geo=parts.merge();this.owned.push(geo);parent.add(make(geo,material));
    };
    this.root.name=spec.id==='architect'?'architect-foundry':'architect-platform-frame';
    if(spec.id==='architect'){
      const frame=new Parts(),lights=new Parts();
      for(const side of [-1,1]){
        frame.box(430,9,7,0,16,side*41,DARK,{taper:.12});
        frame.box(410,3,4,0,25,side*40,IVORY);
        lights.box(405,1.2,1.3,0,29,side*40,GOLD);
        for(let i=0;i<5;i++){
          const x=(i-2)*90;
          frame.box(12,14,80,x,10,0,EDGE,{taper:.1});
          frame.box(62,5,4,x,15,side*44,IVORY);
        }
      }
      // A narrow armored control spine leaves the paired batteries exposed.
      frame.box(310,6,13,-10,21,0,DARK,{taper:.2});
      frame.box(55,24,21,-52,28,0,IVORY,{taper:.25,slope:8});
      frame.box(32,15,19,-61,52,0,DARK,{taper:.2});
      frame.box(39,4,25,-60,67,0,IVORY,{taper:.12});
      frame.box(6,16,6,-67,71,0,EDGE);
      frame.box(29,3,5,-67,86,0,DARK);
      lights.box(26,2,1,-59,62,9,GOLD);lights.box(26,2,1,-59,62,-9,GOLD);
      for(const x of [-223,222])frame.box(27,8,40,x,18,0,IVORY,{taper:.35});
      add(frame,this.root);add(lights,this.root,this.amber);
      spec.main!.turrets.forEach((t,i)=>{
        const socket=new Group();socket.name=`architect-socket-${i}`;socket.position.set(t.x,spec.freeboard,t.z??0);this.root.add(socket);
        const p=new Parts();
        p.box(71,2,31,0,0,0,BLACK);
        for(const z of [-1,1]){p.box(70,6,3,0,0,z*16,EDGE);p.box(65,1,1,0,6,z*16,GOLD);}
        for(const x of [-31,31])p.box(7,5,31,x,0,0,IVORY,{taper:.2});
        p.cyl(13,15,2,0,2,0,EDGE,{seg:12});add(p,socket);
        const clamps:Group[]=[];
        for(const side of [-1,1]){
          const clamp=new Group();clamp.position.set(0,5,side*15);socket.add(clamp);clamps.push(clamp);
          add(new Parts().box(36,5,4,0,0,0,IVORY).box(8,8,5,-12,0,0,EDGE).box(8,8,5,12,0,0,EDGE),clamp);
        }
        this.clamps.push(clamps);
        const dock=new Group();dock.name=`architect-dock-${i}`;socket.add(dock);this.docks.push(dock);
        add(new Parts().box(54,5,25,0,3,0,IVORY,{taper:.15}).cyl(13,14,6,0,7,0,DARK,{seg:12}),dock);
      });
      this.gun.name='architect-final-assembly';this.root.add(this.gun);this.gun.position.y=ASSEMBLY_HEIGHT;this.gun.visible=false;
      this.gun.add(this.cannon);
      const breech=new Parts();
      breech.box(120,48,62,-55,-25,0,DARK,{taper:.15});
      breech.box(100,10,68,-60,23,0,IVORY,{taper:.2});
      breech.box(100,10,68,-60,-34,0,EDGE,{taper:.15});
      for(const z of [-1,1])breech.box(96,28,10,-60,-15,z*35,IVORY,{taper:.15});
      for(const x of [-100,-65,-30])breech.box(9,58,74,x,-30,0,EDGE,{taper:.08});
      add(breech,this.cannon);
      for(const side of [-1,1]){
        const rail=new Group();this.cannon.add(rail);this.rails.push(rail);
        const p=new Parts();
        p.box(350,24,18,171,-12,side*27,IVORY,{taper:.08});
        p.box(360,10,12,171,-5,side*35,DARK);
        for(let x=35;x<350;x+=55)p.box(11,36,26,x,-18,side*29,EDGE,{taper:.15});
        p.box(40,42,28,329,-21,side*28,IVORY,{taper:.15});add(p,rail);
        add(new Parts().box(345,5,3,171,-2.5,side*17,CYAN),rail,this.blue);
        const vent=new Group();vent.position.set(-55,4,side*38);this.cannon.add(vent);this.vents.push(vent);
        const fins=new Parts();for(let x=-35;x<=35;x+=14)fins.box(6,26,14,x,0,0,IVORY,{taper:.2});add(fins,vent);
      }
      const collars=new Parts();
      for(const x of [0,150,ASSEMBLY_MUZZLE])collars.add(new TorusGeometry(x===ASSEMBLY_MUZZLE?40:47,3.5,6,12),EDGE,x,0,0,{ry:Math.PI/2});
      add(collars,this.cannon);
      add(new Parts().barrel(7,4,ASSEMBLY_MUZZLE,-10,0,0,CYAN),this.cannon,this.blue);
      // Reuse the same heavy gun silhouette in each cosmetic focusing satellite.

      const base=new Parts().box(56,10,32,-4,-8,0,IVORY,{taper:.2}).box(48,5,36,-4,-13,0,DARK).merge();this.owned.push(base);
      for(let i=0;i<10;i++){
        const turret=elementalTurretGeometry(ELEMENTS[i%5]);
        const sat=new Group();sat.name=`architect-satellite-${i}`;this.gun.add(sat);this.satellites.push(sat);
        sat.add(make(base,this.armor),make(turret.house,this.armor));
        const barrels=make(turret.guns,this.armor);barrels.position.set(turret.pivotX,turret.pivotY,0);sat.add(barrels);sat.add(make(turret.glow,architectGlowMaterial));
      }
    }else{
      const frame=new Parts();
      frame.box(68,8,36,0,10,0,IVORY,{taper:.16});
      frame.box(52,4,28,0,18,0,DARK,{taper:.1});
      frame.cyl(13,15,5,0,21,0,EDGE,{seg:12});
      for(const side of [-1,1]){
        frame.box(62,6,5,0,5,side*19,EDGE);
        frame.box(50,2,2,0,17,side*18,GOLD);
      }
      add(frame,this.root);
      const footGeo=new Parts().box(8,5,17,0,-3,6,EDGE).box(18,8,12,0,-7,17,IVORY,{taper:.2}).box(12,2,9,0,-9,17,DARK).merge();this.owned.push(footGeo);
      for(const x of [-24,24])for(const side of [-1,1]){
        const leg=new Group();leg.position.set(x,8,side*15);leg.rotation.y=side===1?0:Math.PI;leg.name='architect-stabilizer';leg.add(make(footGeo,this.armor));this.root.add(leg);this.supports.push(leg);
      }
      const engines=new Parts(),glow=new Parts();
      for(const x of [-24,24])for(const z of [-13,13]){
        engines.cyl(5,7,7,x,-5,z,DARK,{seg:8});
        glow.cyl(4,1,20,x,-23,z,CYAN,{seg:8});
      }
      add(engines,this.root);add(glow,this.jets,this.blue);this.root.add(this.jets);this.jets.visible=false;
    }
  }

  pose(_time:number,ship?:Ship):void {
    for(let i=0;i<this.docks.length;i++){
      const slot=ship?.architect?.slots[i],docked=!slot||slot.state==='docked';
      this.docks[i].visible=docked;
      const open=docked?1-smooth((slot?.dockedFor??1)/.25):1;
      this.clamps[i].forEach((c,n)=>c.rotation.x=(n?1:-1)*open*.85);
    }
    const module=ship?.architectPlatform,slot=module?.owner.architect?.slots[module.index];
    const flight=!!slot&&(!!slot.path||slot.state==='citadel');
    let folded=flight?1:0;
    if(slot?.path){const p=slot.path,k=p.elapsed/p.duration;folded=Math.min(smooth(k*5),smooth((1-k)*5));}
    this.supports.forEach(g=>g.rotation.x=folded*1.25);
    this.jets.visible=flight&&!!ship?.alive&&!ship.game.over;
    const u=ship?.architect?.ultimate;
    this.gun.visible=!!ship?.alive&&!ship.game.over&&u?.kind==='assembly';
    if(u?.kind==='assembly'&&ship){
      const build=smooth((u.elapsed-.2)/1.3),charge=smooth((u.elapsed-1.5)/2),fire=Math.max(0,u.elapsed-3.5);
      this.gun.rotation.y=-(Math.atan2(u.aimX-ship.pos.x,-(u.aimZ-ship.pos.z))-ship.renderHeading);
      this.gun.position.y=40+(ASSEMBLY_HEIGHT-40)*build;
      this.cannon.scale.setScalar(Math.max(.01,build));
      this.cannon.position.x=-30*Math.sin(Math.min(1,fire/.5)*Math.PI)*(this.reduce?.25:1);
      this.rails.forEach((r,i)=>r.position.z=(i?1:-1)*(1-charge)*13);
      this.vents.forEach((v,i)=>v.rotation.x=(i?1:-1)*(.25+charge*.5+Math.min(1,fire*8)*.4));
      this.satellites.forEach((g,i)=>{
        g.visible=u.elapsed>=1.5&&u.members.includes(i)&&ship.architect!.slots[i].state==='assembling';
        const geo=elementalTurretGeometry(ship.architect!.slots[i].element);(g.children[1] as Mesh).geometry=geo.house;(g.children[2] as Mesh).geometry=geo.guns;(g.children[3] as Mesh).geometry=geo.glow;
        satellitePose(ship,i,this.reduce,this.point);g.position.copy(this.point);
      });
      this.blue.color.setRGB(.55+charge*.7,1.3+charge*.8,1.7+charge*.7);
    }else this.blue.color.setHex(CYAN);
  }
  dispose():void {this.owned.forEach(g=>g.dispose());this.armor.dispose();this.amber.dispose();this.blue.dispose();}
}
