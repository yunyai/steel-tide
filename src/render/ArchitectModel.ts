import { BoxGeometry, Color, Float32BufferAttribute, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, type BufferGeometry, type Material } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ShipSpec } from '../core/types';
import type { Ship } from '../ships/Ship';

/** Ten physical docking cradles and the unfolding mass driver; all geometry is cosmetic. */
export class ArchitectModel {
  readonly root=new Group();
  readonly docks:Group[]=[];
  private gun=new Group();
  private segments:Group[]=[];
  private owned:BufferGeometry[]=[];
  private armor=new MeshStandardMaterial({color:0xffffff,vertexColors:true,metalness:.75,roughness:.38});
  private amber=new MeshBasicMaterial({color:0xffc066,toneMapped:false});
  private blue=new MeshBasicMaterial({color:0x9aeeff,toneMapped:false});
  constructor(make:(g:BufferGeometry,m:Material)=>Mesh,spec:ShipSpec){
    this.root.name=spec.id==='architect'?'architect-foundry':'architect-platform-frame';
    const boxes=(items:[number,number,number,number,number,number,number][],parent:Group,material:Material=this.armor)=>{
      const geos=items.map(([w,h,d,x,y,z,c])=>{
        const g=new BoxGeometry(w,h,d).toNonIndexed();g.translate(x,y,z);
        const color=new Color(c),count=g.getAttribute('position').count,colors=new Float32Array(count*3);
        for(let i=0;i<count;i++)colors.set([color.r,color.g,color.b],i*3);
        g.setAttribute('color',new Float32BufferAttribute(colors,3));
        return g;
      });
      const geo=mergeGeometries(geos);geos.forEach(g=>g.dispose());this.owned.push(geo);parent.add(make(geo,material));
    };
    if(spec.id==='architect'){
      const ribs:[number,number,number,number,number,number,number][]=[];
      for(const side of [-1,1]){
        ribs.push([435,7,6,0,20,side*40,0x1a2731],[420,2,2,0,25,side*41,0xefb35c]);
        for(let i=0;i<5;i++)ribs.push([10,18,88,(i-2)*90,15,0,0x66737b]);
      }
      ribs.push([45,34,22,-50,35,0,0xc4ccc9],[24,13,35,-50,56,0,0x293b49],[70,5,22,145,25,0,0xc4ccc9]);
      boxes(ribs,this.root);
      boxes([[28,2,16,-50,65,0,0xffffff]],this.root,this.amber);
      spec.main!.turrets.forEach((t,i)=>{
        const dock=new Group();dock.name=`architect-dock-${i}`;dock.position.set(t.x,spec.freeboard,t.z??0);this.root.add(dock);this.docks.push(dock);
        boxes([[76,9,36,0,0,0,0x697780],[54,6,30,0,6,0,0xcbd1cc],[10,12,5,-32,7,-17,0x293440],[10,12,5,32,7,17,0x293440]],dock);
        boxes([[63,1.2,1.4,0,10,-13,0xffffff],[63,1.2,1.4,0,10,13,0xffffff]],dock,this.amber);
      });
      this.gun.name='architect-final-assembly';this.gun.position.y=70;this.root.add(this.gun);this.gun.visible=false;
      boxes([[145,35,65,-20,0,0,0x344856],[125,8,72,-20,22,0,0xd5d8cf]],this.gun);
      for(let i=0;i<10;i++){
        const segment=new Group();segment.position.x=45+i*65;this.gun.add(segment);this.segments.push(segment);
        boxes([[58,12,10,0,-20,-23,0xd1d5cd],[58,12,10,0,-20,23,0xd1d5cd],[15,56,60,-22,0,0,0x354956]],segment);
        boxes([[65,3,3,4,-4,-15,0xffffff],[65,3,3,4,-4,15,0xffffff]],segment,this.blue);
      }
      const coreGeo=new CylinderGeometry(10,10,720,10);coreGeo.rotateZ(Math.PI/2);coreGeo.translate(340,0,0);this.owned.push(coreGeo);this.gun.add(make(coreGeo,this.blue));
    }else{
      boxes([[70,8,38,0,11,0,0xc3ccc8],[68,4,5,0,17,-18,0x344b59],[68,4,5,0,17,18,0x344b59],[10,24,8,-29,2,-17,0x344b59],[10,24,8,29,2,17,0x344b59]],this.root);
      boxes([[65,1,2,0,20,-15,0xffffff],[65,1,2,0,20,15,0xffffff]],this.root,this.amber);
    }
  }
  pose(time:number,ship?:Ship):void {
    for(let i=0;i<this.docks.length;i++)this.docks[i].visible=!ship?.architect||ship.architect.slots[i].state==='docked';
    const u=ship?.architect?.ultimate;this.gun.visible=u?.kind==='assembly';
    if(u?.kind==='assembly'&&ship){
      const dx=u.aimX-ship.pos.x,dz=u.aimZ-ship.pos.z;
      this.gun.rotation.y=-(Math.atan2(dx,-dz)-ship.heading);
      this.gun.scale.x=Math.max(.02,Math.min(1,(u.elapsed-.4)/1.1));
      const count=u.members.filter(i=>ship.architect!.slots[i].state!=='destroyed').length;
      this.segments.forEach((g,i)=>{g.visible=i<count;g.position.y=Math.sin(time*8+i)*Math.max(0,1.5-u.elapsed)*8;});
      this.blue.color.setRGB(1.3+Math.min(1,u.elapsed/3.5),2.2,2.7);
    }
  }
  dispose():void {this.owned.forEach(g=>g.dispose());this.armor.dispose();this.amber.dispose();this.blue.dispose();}
}
