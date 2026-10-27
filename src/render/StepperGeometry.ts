import { Color, OctahedronGeometry, TorusGeometry, Vector3, type BufferGeometry } from 'three';
import { Parts, loft } from './Geometry';

export const STEP = { dark:0x151421, armor:0x353446, edge:0x75788c, pale:0xbac0ce, recess:0x080b18, violet:0xb69aff, white:0xf3eaff } as const;

/** +X bow; a physical keel under suspended armor, with a recessed machinery spine. */
export function stepperHullGeometry():BufferGeometry {
  const p=new Parts(),rings:Vector3[][]=[],colors:Color[][]=[];
  for(const [x,w,top] of [[-180,8,11],[-158,16,13],[-110,18,13],[-40,15,13],[40,16,13],[105,16,14],[150,10,16],[180,.5,18]]){
    const ring=[new Vector3(x,top,-w),new Vector3(x,top-5,-w),new Vector3(x,-10,-w*.65),new Vector3(x,-14,0),new Vector3(x,-10,w*.65),new Vector3(x,top-5,w),new Vector3(x,top,w),new Vector3(x,top,-w)];
    rings.push(ring);colors.push(ring.map((_,i)=>new Color(i===7?STEP.armor:i===0||i===6?STEP.edge:STEP.dark)));
  }
  p.list.push(loft(rings,colors,true).toNonIndexed());
  p.box(318,3,22,-7,12,0,STEP.dark,{taper:.14});
  for(const side of [-1,1]){
    p.box(254,2,1.5,-10,15,side*10,STEP.edge);
    for(let x=-140;x<=140;x+=28){p.box(5,3,27,x,10,0,STEP.armor);p.box(11,2,3,x,15,side*10,STEP.recess);}
    // Engine housings at the stern, exposed heat exchangers and an armored bow chine.
    p.box(43,9,9,-151,10,side*11,STEP.armor,{taper:.18});
    for(let x=-167;x<-130;x+=6)p.box(2,2,7,x,19,side*11,STEP.edge);
    p.box(42,3,3,152,14,side*7,STEP.edge,{ry:side*.16,taper:.2});
  }
  p.box(52,10,23,28,15,0,STEP.armor,{taper:.3,slope:7});
  p.box(30,12,17,29,25,0,STEP.dark,{taper:.24,slope:5});
  p.box(34,3,21,31,37,0,STEP.edge,{taper:.2});
  p.box(20,3,18,34,33,0,STEP.recess);
  p.box(12,11,6,21,40,0,STEP.armor,{taper:.35});
  p.box(22,2,3,20,51,0,STEP.edge);
  p.cyl(16,20,5,-17,15,0,STEP.armor,{seg:8});
  p.cyl(14,16,3,-17,20,0,STEP.recess,{seg:8});
  for(const x of [-115,-78,78,115])p.cyl(11,13,3,x,13+(Math.abs(x)<100?5:0),0,STEP.edge,{seg:12});
  return p.merge();
}

export function stepperTurretGeometry(){
  const p=new Parts(),g=new Parts();
  p.cyl(10.5,12,3,0,0,0,STEP.dark,{seg:12});
  p.cyl(10.8,10.8,.8,0,3,0,STEP.violet,{seg:12});
  p.box(25,10,21,-3,4,0,STEP.armor,{taper:.2,slope:4});
  p.box(16,2,17,-5,14,0,STEP.edge,{taper:.15});
  for(const z of [-1,1]){
    p.box(21,6,3,-3,5,z*11,STEP.dark,{taper:.15});
    p.box(12,1,1,-4,12,z*11,STEP.violet);
    for(let x=-10;x<0;x+=4)p.box(1.5,3,1,x,7,z*13,STEP.edge);
  }
  for(const z of [-5.5,0,5.5]){
    g.box(8,6,4.8,2,-3,z,STEP.dark,{taper:.1});
    g.box(23,3,3,11.5,-1.5,z,STEP.armor);
    g.box(22,.9,.8,12,1.5,z,STEP.violet);
    for(const side of [-1,1])g.box(19,1.2,.7,13,2.3,z+side*1.6,STEP.pale);
    g.box(4,4.5,4.5,22,-2.25,z,STEP.edge,{taper:.12});
    g.box(.4,2.8,2.8,24.1,-1.4,z,STEP.recess);
  }
  return{house:p.merge(),guns:g.merge(),pivotX:7,pivotY:9};
}

export function stepperPlateGeometry(light=false):BufferGeometry{
  const p=new Parts();
  if(light){
    p.box(92,1.2,.9,0,8.7,5.6,STEP.white);
    p.box(75,.8,.9,-4,6.6,-5.8,STEP.violet);
    for(const x of [-32,-20,-8])p.box(3,1.2,6,x,8.6,0,STEP.violet);
  }else{
    p.box(106,9,13,0,0,0,STEP.dark,{taper:.28,slope:12});
    p.box(90,3,11,-3,6,0,STEP.armor,{taper:.22,slope:8});
    p.box(70,1.2,5,-4,9,0,STEP.edge,{taper:.2});
    p.box(12,7,12,-42,0,0,STEP.edge,{taper:.25});
    for(const x of [-25,0,25])p.box(4,3,12,x,4,0,STEP.armor);
    p.add(new OctahedronGeometry(1),STEP.armor,50,2,0,{sx:18,sy:4,sz:6});
  }
  return p.merge();
}

/** One merged, recognizable snapshot shared by every pooled teleport silhouette. */
export function stepperEchoGeometry():BufferGeometry{
  const p=new Parts();p.add(stepperHullGeometry(),STEP.white);
  for(const side of [-1,1])for(const x of [-105,0,105])p.add(stepperPlateGeometry(),STEP.white,x,9,side*25,{ry:side*.07});
  for(const x of [-115,-78,78,115]){
    const g=stepperTurretGeometry(),y=16+(Math.abs(x)<100?5:0),ry=x<0?Math.PI:0;
    p.add(g.house,STEP.white,x,y,0,{ry});p.add(g.guns,STEP.white,x+(x<0?-7:7),y+9,0,{ry});
  }
  p.add(new OctahedronGeometry(13),STEP.white,-17,48,0,{sy:1.6});
  p.add(new TorusGeometry(33,1.3,4,32),STEP.white,-17,48,0,{ry:Math.PI/2});
  return p.merge();
}
