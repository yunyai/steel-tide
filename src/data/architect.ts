import type { ShipSpec } from '../core/types';
import { TITAN_REPAIR, search } from './common';
import { ARCHITECT_SKILLS } from '../skills/misc/architect';

const armor = { belt:280,deck:150,bow:60,stern:60,superstructure:40,turret:350,citadelInner:60,torpedoProtection:0.4 };
const palette = { hull:0x293440,upper:0xd0d3cd,deck:0x36434a,accent:0xffbb58,boot:0x111c26 };
const battery = {
  name:'420 mm modular railguns',look:'rail' as const,flat:3,
  turrets:Array.from({length:10},(_,i)=>({x:(Math.floor(i/2)-2)*90,z:i%2?28:-28,y:2,facing:i<4?180:0,halfArc:160,barrels:2})),
  reload:10,traverse:24,range:15000,dispersion:75,barrelLength:30,
  ap:{caliber:420,mass:1300,velocity:1200,damage:9000,pen:760},
  he:{caliber:420,mass:1050,velocity:1200,damage:4500,pen:80,fireChance:0.2},
};
export const ARCHITECT: ShipSpec[] = [{
  id:'architect',name:'Architect',nation:'foundry',cls:'TT',year:2190,
  description:'A battleship that builds its own battlefield. Ten armored cannon blocks detach from exposed docking rails, anchor across the sea and return to assemble impossible weapons.',
  specialty:'Ten 200k-HP railgun platforms, each reserving 100k hull HP. Deployed guns hit three times as hard with half the reload time; destroyed platforms rebuild in 5 s. Two each of Furnace, Cryo, Storm, Gravity and Prism automatically unleash skills and overdrives. Mix elemental reactions, fire extra command salvos, assemble a combined cannon, and raise an airborne Citadel.',
  hp:2500000,length:500,beam:90,draft:13,freeboard:17,maxSpeed:30,accelTime:45,turnRadius:1050,rudderTime:14,
  armor,citadel:{length:0.6,top:2,width:0.65},main:battery,
  aa:{range:6000,dps:1000},consumables:[TITAN_REPAIR,search(9000)],skills:ARCHITECT_SKILLS.map(d=>d.spec),
  model:{palette,bow:'clipper',stern:'transom',sheer:0.3,turretStyle:'rail',funnels:[],masts:[],blocks:[{x:-40,len:65,w:24,h:12},{x:-50,len:30,w:18,h:18}]},
},{
  id:'architectPlatform',name:'Cannon Platform',nation:'foundry',cls:'DD',year:2190,hidden:true,
  description:'A numbered heavy railgun module belonging to Architect. Its guns and health follow it between the hull and the battlefield.',
  specialty:'Auxiliary platform. No independent kill rewards, capture or respawn.',
  hp:40000,length:80,beam:44,draft:6,freeboard:12,maxSpeed:0,accelTime:1,turnRadius:100,rudderTime:1,
  armor:{...armor,belt:140,deck:70,bow:30,stern:30,superstructure:25,turret:180,citadelInner:0,torpedoProtection:0.2},
  citadel:{length:0.25,top:0,width:0.6},main:{...battery,turrets:[{x:0,y:1,facing:0,halfArc:180,barrels:2}]},
  aa:{range:0,dps:0},consumables:[],skills:[],
  model:{palette,bow:'straight',stern:'transom',sheer:0,turretStyle:'rail',funnels:[],masts:[],blocks:[]},
}];
