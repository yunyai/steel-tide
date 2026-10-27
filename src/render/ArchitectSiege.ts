import { Group,Mesh,MeshBasicMaterial,MeshStandardMaterial,TorusGeometry,type BufferGeometry,type Material } from 'three';
import { ARCHETYPES,ARCHITECT_TYPES,type ArchitectType } from '../data/architectLoadout';
import type { Ship } from '../ships/Ship';
import { Parts } from './Geometry';
import { smooth } from './ArchitectPose';
const IVORY=0xd5d9d0,DARK=0x152732,EDGE=0x617d89,BLACK=0x08121a;
const armor=new MeshStandardMaterial({vertexColors:true,metalness:.72,roughness:.35});
const light=new MeshBasicMaterial({vertexColors:true,toneMapped:false});light.color.setRGB(1.8,1.8,1.8);
const cache=new Map<ArchitectType,BufferGeometry[]>();
/** Six articulated assemblies, each type authored as physical siege machinery. */
export function siegeGeometry(type:ArchitectType):BufferGeometry[]{
 const cached=cache.get(type);if(cached)return cached;
 const c=ARCHETYPES[type].color,base=new Parts(),house=new Parts(),barrel=new Parts(),wing=new Parts(),crown=new Parts(),glow=new Parts();
 base.cyl(45,60,12,0,0,0,DARK,{seg:12});base.cyl(42,45,6,0,12,0,EDGE,{seg:12});
 for(let i=0;i<6;i++){const a=i*Math.PI/3,x=Math.cos(a)*46,z=Math.sin(a)*46;base.box(35,8,17,x,-4,z,IVORY,{ry:-a,taper:.2});base.box(22,2,6,x,5,z,c,{ry:-a});}
 house.box(65,30,54,-14,22,0,IVORY,{taper:.2,slope:8});house.box(42,18,60,-28,31,0,DARK,{taper:.15});house.box(26,36,61,17,19,0,EDGE,{taper:.1});
 for(const z of [-1,1]){house.box(42,5,5,-17,48,z*26,c);for(let x=-35;x<2;x+=8)house.box(4,15,2,x,27,z*30,BLACK);}
 // All specialists retain an unmistakable heavy gun, including repair and sensor builds.
 barrel.box(96,12,12,53,0,0,DARK);barrel.box(85,4,5,56,8,0,c);barrel.box(20,23,23,98,-5,0,IVORY,{taper:.2});barrel.box(2,11,11,109,1,0,BLACK);
 wing.box(43,20,8,-16,0,0,IVORY,{taper:.25});wing.box(34,3,3,-14,22,0,c);
 if(type==='furnace'){
  for(const z of [-15,15]){barrel.box(90,10,10,48,0,z,EDGE);barrel.box(15,20,16,94,-5,z,IVORY);barrel.box(2,9,8,102,1,z,BLACK);}
  crown.box(42,24,40,-32,0,0,DARK,{taper:.2});for(let x=-48;x<-12;x+=7){crown.box(4,24,42,x,4,0,EDGE);glow.box(2,20,44,x,65,0,c);}
 }else if(type==='cryo'){
  barrel.box(135,8,8,66,1,0,IVORY);for(let x=20;x<100;x+=14)for(const z of [-1,1])barrel.box(5,26,18,x,-5,z*15,EDGE,{rz:z*.2});
  for(const z of [-1,1])crown.cyl(9,9,55,-18,2,z*25,c,{seg:10,rz:Math.PI/2});
 }else if(type==='storm'){
  for(const z of [-1,1]){crown.box(13,68,13,-18,0,z*26,EDGE,{taper:.2});for(let y=10;y<66;y+=12)crown.cyl(13,13,4,-18,y,z*26,c,{seg:10});crown.box(36,8,12,-6,65,z*26,IVORY);}
  for(let x=20;x<100;x+=20)barrel.box(7,28,42,x,-8,0,EDGE);
 }else if(type==='gravity'){
  for(let x=15;x<110;x+=29){barrel.add(new TorusGeometry(26,4,6,24),EDGE,x,0,0,{ry:Math.PI/2});barrel.add(new TorusGeometry(21,2,5,24),c,x,0,0,{ry:Math.PI/2});}
  crown.add(new TorusGeometry(28,6,6,20),IVORY,-30,20,0,{ry:Math.PI/2});
 }else if(type==='prism'){
  for(const z of [-1,1]){barrel.box(124,8,9,61,9,z*15,IVORY,{taper:.35});barrel.box(120,2,3,62,18,z*15,c);wing.box(75,32,5,12,4,0,IVORY,{rz:-.2,taper:.4});}
  crown.cyl(3,17,35,-24,0,0,c,{seg:4});
 }else if(type==='sentinel'){
  crown.box(10,46,10,-26,0,0,EDGE);crown.box(64,18,6,-26,44,0,IVORY,{taper:.15});for(let z=-27;z<=27;z+=9)crown.box(3,16,3,-26,46,z,c);
  barrel.box(125,8,8,62,1,0,IVORY);wing.box(7,34,25,-12,14,0,EDGE,{rz:.3});
 }else if(type==='abyss'){
  for(const z of [-22,0,22]){barrel.cyl(11,13,65,27,14,z,EDGE,{seg:10,rz:Math.PI/2});barrel.cyl(8,8,3,61,14,z,BLACK,{seg:10,rz:Math.PI/2});barrel.cyl(12,12,3,55,14,z,c,{seg:10,rz:Math.PI/2});}
  crown.add(new TorusGeometry(24,3,6,24),c,-30,10,0,{ry:Math.PI/2});wing.box(48,26,14,-12,0,0,IVORY,{taper:.2});
 }else if(type==='restoration'){
  for(const z of [-1,1]){crown.box(10,37,10,-22,0,z*28,IVORY);crown.box(38,7,9,-6,34,z*28,EDGE);crown.cyl(8,8,12,14,30,z*28,c,{seg:8});}
  barrel.box(100,6,6,51,0,-17,EDGE);barrel.box(100,6,6,51,0,17,EDGE);wing.box(40,3,18,-6,12,0,c);
 }else if(type==='bastion'){
  house.box(78,38,70,-18,18,0,IVORY,{taper:.2});barrel.box(65,20,26,45,-5,0,EDGE);wing.box(90,46,10,10,-8,0,IVORY,{taper:.22});wing.box(72,30,3,10,-1,6,c,{taper:.25});crown.box(48,8,60,-20,1,0,EDGE);
 }else if(type==='resonance'){
  for(const z of [-1,1]){crown.box(9,58,10,-32,0,z*22,IVORY);crown.box(28,6,10,-20,54,z*22,c);barrel.box(94,7,9,52,14,z*19,IVORY);}
  for(let x=20;x<100;x+=25)barrel.add(new TorusGeometry(19,2,5,20),c,x,0,0,{ry:Math.PI/2});
 }else{
  for(const z of [-1,1])for(let x=-30;x<=6;x+=18){crown.box(15,35,16,x,0,z*24,IVORY,{taper:.12});crown.box(10,5,11,x,35,z*24,BLACK);crown.box(4,3,5,x,37,z*24,c);}
  wing.box(65,16,30,-12,-5,0,DARK,{taper:.15});for(let x=-30;x<20;x+=15)wing.box(10,3,18,x,13,0,c);
 }
 for(const z of [-1,1]){glow.box(45,2,2,-16,48,z*29,c);glow.box(5,14,2,18,28,z*32,c);}
 const out=[base,house,barrel,wing,crown,glow].map(p=>p.merge());cache.set(type,out);return out;
}
export class ArchitectSiege {
 readonly root=new Group();private pieces:Mesh[]=[];private left=new Group();private right=new Group();private type:ArchitectType='furnace';
 constructor(make:(g:BufferGeometry,m:Material)=>Mesh){
  const geo=siegeGeometry(this.type);for(let i=0;i<6;i++){const m=make(geo[i],i===5?light:armor);this.pieces.push(m);if(i===3){this.left.add(m);this.right.add(make(geo[i],armor));}else this.root.add(m);}
  this.root.add(this.left,this.right);this.root.name='architect-siege-cannon';this.root.visible=false;
 }
 pose(ship:Ship,time:number):boolean{
  const tag=ship.architectPlatform,u=tag?.owner.architect?.ultimate,a=tag?.owner.architect?.slots[tag.index];
  const active=!!ship.alive&&u?.kind==='killbox'&&!!a&&u.members.includes(a.index)&&!ship.game.over;
  this.root.visible=active;if(!active||!a||!u)return false;
  if(a.type!==this.type){this.type=a.type;const geo=siegeGeometry(a.type);this.pieces.forEach((m,i)=>m.geometry=geo[i]);(this.right.children[0] as Mesh).geometry=geo[3];}
  const progress=smooth((u.elapsed-.2)/1.3),index=ARCHITECT_TYPES.indexOf(a.type),fold=smooth((progress-.15)/.65),lock=smooth((progress-.5)/.5);
  const [base,house,barrel,,crown,glow]=this.pieces;
  base.scale.set(progress,Math.max(.03,progress),progress);house.position.y=-35*(1-fold);house.scale.y=Math.max(.01,fold);
  const recoil=ship.turrets[0].recoil;barrel.position.set(-55*(1-lock)-Math.sin(Math.min(1,recoil)*Math.PI/2)*14,39,0);barrel.scale.x=.3+.7*lock;
  this.left.position.set(0,25,-27-24*fold);this.right.position.set(0,25,27+24*fold);this.left.rotation.x=(1-fold)*1.3;this.right.rotation.x=-(1-fold)*1.3;
  crown.position.y=47-48*(1-fold);crown.scale.y=Math.max(.01,fold);glow.scale.setScalar(Math.max(.01,lock));
  // Authored type-specific deployment: twist rings, open vanes, raise racks and telescope sensors.
  crown.rotation.y=(1-fold)*(index%2?1:-1)*([2,3,8].includes(index)?Math.PI:.28);
  barrel.rotation.x=a.type==='gravity'?(1-lock)*Math.PI:a.type==='resonance'?Math.sin(time*2)*.025:0;
  if(a.type==='prism'||a.type==='restoration'){this.left.rotation.z=(1-lock)*.8;this.right.rotation.z=-(1-lock)*.8;}
  if(a.type==='swarm'||a.type==='abyss')crown.rotation.z=-(1-fold)*.9;
  if(a.type==='sentinel')crown.rotation.y=time*.2;
  this.root.position.y=2;return true;
 }
}
