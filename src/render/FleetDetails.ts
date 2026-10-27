import {Color, TorusGeometry, OctahedronGeometry} from 'three';
import type {ShipSpec} from '../core/types';
import {deckHeight,hullHalfWidth} from '../ships/HullShape';
import {Parts} from './Geometry';

type Motif='director'|'armor'|'hangar'|'sensor'|'crystal'|'forge'|'rib'|'crown'|'blade'|'coil'|'exhaust'|'shrine'|'drum'|'wing'|'petal'|'bone'|'solar'|'depth';
export interface FleetDetail {motif:Motif; station:number; count:number}
/** Art direction per hull, including transformations and summons. Stations are fractions of hull length. */
export const FLEET_DETAILS:Record<string,FleetDetail>={};
function group(motif:Motif, rows:string){for(const row of rows.split(' ')){const [id,x,n]=row.split(':');FLEET_DETAILS[id]={motif,station:Number(x),count:Number(n??3)};}}
group('director','yamato:.04:4 iowa:.08:3 desmoines:.02:3 atlanta:.12:2 warspite:.06:3 belfast:.10:2 stalingrad:.08:4');
group('armor','bismarck:.02:4 leviathan:.02:6 anvilheart:.05:4 hammerfall:.10:3 conqueror:.10:4 buran:.05:4 tunguska:.08:3');
group('sensor','shimakaze:.10:2 fletcher:.14:2 arsenal:.12:4 zumwalt:.08:3 burke:.08:3 nakhimov:.06:4 ustinov:.10:3 sovremenny:.14:2 zhenyuan:.06:4 nanchang:.08:3 kunming:.12:2 daring:.10:3 glasgow:.12:2 tarantul:.10:2');
group('hangar','akagi:-.17:3 ford:-.18:4 kuznetsov:-.15:3 fujian:-.12:4 queenElizabeth:-.18:3 gyrehold:-.14:3');
group('depth','gato:.03:3 tidesinger:.05:3 deepdelver:.03:4 drownedBell:.04:3 voidpearl:.06:3 virginia:.05:4 belgorod:.04:5 type093b:.04:4 astute:.04:3 kage:.06:4 orion:.06:4 vostok:.03:5 jiaolong:.04:4 hadal:.02:7 law:.06:3 aizen:.03:3 muzan:.02:4');
group('crystal','eldarwyn:.04:3 silverbough:.08:3 windrunner:.12:2 sunspire:.05:4 spellweaver:.08:3 blinkwisp:.13:2 dragonrest:-.15:4 gojo:.02:3 gojoHonored:.02:5 starWarden:.04:3');
group('forge','sparkrunner:.10:3 brokkr:.04:6 bakugo:.07:3 bakugoDynamight:.05:5');
group('rib','revenant:.04:4 gravewake:.08:3 wraith:.12:3 nightwing:-.15:4 naglfar:.02:7 skeletalGalleon:.04:4');
group('crown','aspidochelone:.02:6 koschei:.04:6 frieza:.06:3 friezaGolden:.04:6 aizenHogyoku:.03:5');
group('blade','tsurugi:.04:3 oboro:.09:3 kunai:.12:2 kaguya:.02:6 zoro:.05:3 zoroKing:.04:6 ichigo:.04:3 ichigoMugetsu:.02:6 levi:.11:2 leviStrongest:.06:5');
group('coil','apollo:.04:4 artemis:.08:3 montana:.05:5 constellation:.03:6 tiangong:.03:4 shenzhou:.08:3 nuwa:.04:6 vegeta:.04:3 vegetaEgo:.02:6');
group('exhaust','mercury:-.25:3 molniya:-.24:3 wukong:-.18:3 wukongClone:-.16:2 deku:-.18:3 dekuOFA:-.16:5');
group('shrine','sukuna:.04:3 sukunaKing:.03:6 megumi:.06:3 sasuke:.03:3 sasukeSusanoo:.02:6 itachi:.07:3 itachiSusanoo:.04:5 naruto:.05:3 narutoKurama:.03:6 narutoClone:.06:2');
group('drum','raijin:.02:6 zhenghe:.03:5 luffy:.07:3 luffyNika:.03:6');
group('wing','gryphonhold:-.14:3 shiden:-.15:3 gemini:-.14:4 mir:-.12:3 queqiao:-.14:3 lun:-.15:6');
group('petal','byakuya:.06:3 byakuyaKageyoshi:.02:6 aizenMirage:.08:2');
group('bone','eren:.05:3 erenFounder:.02:7 armin:.08:3 arminColossal:.03:6 wallTitan:.04:4 mahoraga:.03:6 divineDog:.05:2 seaSerpent:.02:4 treant:.06:4');
group('solar','goku:.03:3 gokuUI:.02:6 tanjiro:.10:2 tanjiroSun:.05:5 rengoku:.04:3 rengokuNinth:.02:6 allMight:.03:4 allMightPrime:.02:6 nezuko:.08:2');
group('shrine','muzanKing:.03:6 upperMoon:.05:3');
group('coil','lawAwakened:.03:5 astraea:.03:6');
group('armor','habakkuk:.04:6 vanguard:.04:5 droneFrigate:.06:3 nanoSkiff:.06:2 koscheiEgg:0:3');

/** Merged into the existing hull draw. These details never become collision geometry. */
export function addFleetDetails(p:Parts,s:ShipSpec):void{
 const d=FLEET_DETAILS[s.id];if(!d)return;
 const {palette:c}=s.model,L=s.length,B=s.beam,fb=s.freeboard,titan=s.cls==='TT';
 const dark=new Color(c.hull).multiplyScalar(.46).getHex(),edge=new Color(c.upper).lerp(new Color(0xc8d3db),.32).getHex();
 const top=(x:number)=>{let stack=0,result=0;for(const b of s.model.blocks){const y=b.y??stack;stack=y+b.h;if(Math.abs(x-b.x)<=b.len/2)result=Math.max(result,stack);}if(s.model.tower&&Math.abs(x-s.model.tower.x)<s.model.tower.len/2)result+=s.model.tower.h;return deckHeight(s,x)+result;};
 // Armor strakes, deck access and inset machinery follow each hull's real width.
 const n=d.count;
 for(let i=0;i<n;i++){
  const x=L*(-.32+.64*i/Math.max(1,n-1)),hw=hullHalfWidth(s,x),y=deckHeight(s,x);
  for(const side of [-1,1]){
   if(s.sub){p.box(L*.055,.3,B*.12,x,fb*.4,side*hw*.77,dark,{taper:.22});continue;}
   if(!s.model.flightDeck){
    p.box(L*.065,Math.max(.6,fb*.13),1.1,x,y-.5,side*hw*.86,edge,{taper:.25});
    p.box(L*.035,.5,Math.max(.9,B*.065),x,y+.1,side*hw*.68,dark);
   }
   p.box(L*.07,Math.max(.5,fb*.24),.45,x,fb*.3,side*hw*.985,i%2?dark:c.hull,{taper:.15});
  }
 }
 // Paired fittings deliberately leave turret centers and carrier runways clear.
 const x=L*d.station;
 const k=Math.max(1.5,Math.min(12,B*(titan?.115:.095)));
 const carrier=!!s.model.flightDeck;
 const y=s.sub?fb+(s.model.conningTower?.h??2):carrier?fb+s.model.flightDeck!.y+.8:top(x);
 const z0=carrier?B*.37:0;
 const feature=(z:number,sign:number)=>{
  const yy=y+.3;
  switch(d.motif){
   case 'director':case 'sensor':
    p.cyl(k*.9,k*1.1,k*.7,x,yy,z,dark,{seg:8});
    p.box(k*2.7,k*.9,k*1.5,x,yy+k*.7,z,c.upper,{taper:.25});
    p.box(k*.2,k*.6,k*2.8,x+k*1.25,yy+k*.9,z,0x263748);
    for(let j=0;j<3;j++)p.box(k*.12,k*.06,k*2.5,x+k*1.36,yy+k*(1+j*.16),z,edge);
    break;
   case 'hangar':
    p.box(L*.11,k*1.4,k*2.2,x,yy,z,c.upper,{taper:.2});
    p.box(L*.09,k*.9,k*.12,x,yy+k*.12,z+sign*k*1.12,dark);
    for(let j=0;j<4;j++)p.box(L*.007,k*.9,k*.14,x+L*(j-1.5)*.024,yy+k*.12,z+sign*k*1.2,edge);
    break;
   case 'armor':
    for(let j=0;j<3;j++)p.box(k*3.5,k*.65,k*2.8,x-(j-1)*k*2,yy+j*k*.35,z,c.upper,{taper:.28,slope:k*.5});
    p.box(k*6,.4,k*.5,x,yy+k*1.7,z,c.accent);break;
   case 'depth':{
    const sx=L*.09;
    for(let j=0;j<n;j++){const dx=x+(j-(n-1)/2)*sx;p.box(sx*.7,k*.6,k*1.5,dx,fb-.2,sign*B*.22,c.upper,{taper:.28});p.box(sx*.5,.2,k*.65,dx,fb+k*.4,sign*B*.22,c.accent);}
    p.box(L*.13,k*.5,B*.78,-L*.34,fb-.5,0,c.hull,{taper:.35,slope:L*.04});break;}
   case 'crystal':case 'petal':
    for(let j=0;j<3;j++){const a=j*Math.PI*2/3;p.add(new OctahedronGeometry(k),c.accent,x+Math.cos(a)*k*1.3,yy+k*(1.5+j*.3),z+Math.sin(a)*k, {sy:2.1,sz:.5,rz:(j-1)*.3});}
    p.cyl(k*1.8,k*2,.7,x,yy,z,dark,{seg:6});break;
   case 'forge':case 'exhaust':
    for(let j=0;j<3;j++){p.barrel(k*.55,k*.6,k*3,x-k*1.5,yy+k*.8,z+(j-1)*k*1.2,c.upper,8);p.barrel(k*.45,k*.45,.35,x-k*1.55,yy+k*.8,z+(j-1)*k*1.2,dark,8);p.box(k*2,.25,k*.28,x,yy+k*1.4,z+(j-1)*k*1.2,c.accent);}break;
   case 'rib':case 'bone':
    for(let j=0;j<n;j++){const dx=x+(j-(n-1)/2)*k*1.8;p.box(k*.6,k*(2.2-Math.abs(j-(n-1)/2)*.12),k*.7,dx,yy,z,c.upper,{taper:.65,rz:sign*.35});p.box(k*.7,.3,k*2,dx,yy,z,c.accent);}
    break;
   case 'crown':case 'shrine':
    p.box(k*4,k*.7,k*3,x,yy,z,dark,{taper:.16});
    for(const a of [-1,1]){p.box(k*.65,k*3,k*.7,x+a*k*1.5,yy,z,c.upper,{taper:.4});p.box(k*4,k*.45,k*1.1,x,yy+k*2.6,z,c.accent,{taper:.2});}
    if(d.motif==='crown')p.add(new OctahedronGeometry(k*.7),c.accent,x,yy+k*1.7,z,{sy:1.6});break;
   case 'blade':case 'wing':
    for(const a of [-1,1])p.box(k*4,k*2,k*.5,x,yy,z+a*k,c.upper,{taper:.55,slope:k*2,rz:a*.14});
    p.box(k*3,.25,k*2.4,x,yy+k*.5,z,c.accent);break;
   case 'coil':case 'solar':case 'drum':
    p.cyl(k,k*1.5,k*.7,x,yy,z,dark,{seg:10});
    for(let j=0;j<(titan?3:2);j++)p.add(new TorusGeometry(k*(1.1+j*.4),k*.12,5,20),j%2?edge:c.accent,x,yy+k*1.8,z,{ry:j*.6,rx:j*.35});
    p.add(new OctahedronGeometry(k*.6),c.accent,x,yy+k*1.8,z);break;
  }
 };
 if(s.sub){feature(0,1);}
 else if(carrier){feature(z0,-1);}
 else if(['rib','bone','blade','wing','exhaust'].includes(d.motif)){for(const side of [-1,1])feature(side*B*.27,side);}
 else feature(0,1);
}
