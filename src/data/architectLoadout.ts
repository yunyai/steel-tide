/** Pure data shared by simulation, lobby validation and the loadout editor. */
export type ArchitectElement='furnace'|'cryo'|'storm'|'gravity'|'prism';
export type ArchitectType=ArchitectElement|'sentinel'|'abyss'|'restoration'|'bastion'|'resonance'|'swarm'|'vector';
export interface ArchitectSelection {type:ArchitectType;skill:0|1}
export type ArchitectLoadout=ArchitectSelection[];
export interface ArsenalSkill {name:string;cooldown:number;description:string}
export interface Archetype {name:string;short:string;element:ArchitectElement;color:number;skills:[ArsenalSkill,ArsenalSkill]}
const ability=(name:string,cooldown:number,description:string):ArsenalSkill=>({name,cooldown,description});
export const ARCHETYPES:Record<ArchitectType,Archetype>={
 furnace:{name:'Furnace',short:'FU',element:'furnace',color:0xff862c,skills:[ability('Inferno Barrage',8,'Six 18k explosive shells; 300 m splash.'),ability('Meltdown',10,'60k in 450 m, then 12k/s burning ground for 3 s.')]},
 cryo:{name:'Cryo',short:'CR',element:'cryo',color:0x69e6ff,skills:[ability('Glacial Lance',8,'90k piercing lance; 20% slow for 3 s.'),ability('Shatter Field',10,'40k then 70k in 450 m; 20% slow for 3 s.')]},
 storm:{name:'Storm',short:'ST',element:'storm',color:0xa98aff,skills:[ability('Chain Surge',8,'36k to up to four targets, chaining within 700 m.'),ability('Thunder Battery',9,'Three 36k strikes; 350 m splash.')]},
 gravity:{name:'Gravity',short:'GR',element:'gravity',color:0xff66cc,skills:[ability('Compression Well',10,'Three 12k pulses then 72k in 450 m, pulling inward.'),ability('Gravitic Hammer',8,'100k impact in 300 m with an inward pull.')]},
 prism:{name:'Prism',short:'PR',element:'prism',color:0xffe4a0,skills:[ability('Spectrum Lance',9,'108k piercing beam.'),ability('Refraction',8,'Three 36k piercing rays; splits across nearby enemies.')]},
 sentinel:{name:'Sentinel',short:'SE',element:'storm',color:0xffb746,skills:[ability('Searchlight Sweep',10,'Reveals concealed surface ships within 3 km for 6 s.'),ability('Deep Scan',10,'Reveals submarine contacts within 2 km for 6 s.')]},
 abyss:{name:'Abyss',short:'AB',element:'cryo',color:0x38d6c9,skills:[ability('Depth Hammer',8,'Three 30k depth impacts, 300 m splash; surface or revealed submarine.'),ability('Hunter Torpedoes',10,'Four 24k guided torpedoes, 4 km range; surface or revealed submarine.')]},
 restoration:{name:'Restoration',short:'RE',element:'prism',color:0x55ef9b,skills:[ability('Repair Beam',10,'Restore 80k over 2 s to the most injured ally within 2 km.'),ability('Repair Pulse',12,'Restore 25k to allies within 1.2 km.')]},
 bastion:{name:'Bastion',short:'BA',element:'gravity',color:0xf7d466,skills:[ability('Aegis Projector',10,'120k shield for 5 s on the most injured ally within 2 km.'),ability('Bulwark Field',12,'20% damage reduction for allies within 1.2 km for 4 s.')]},
 resonance:{name:'Resonance',short:'RS',element:'storm',color:0xe88dff,skills:[ability('Accelerando',10,'25% faster skill recharge for nearby platforms for 4 s; excludes Resonance.'),ability('Reaction Amplifier',10,'40% stronger elemental reactions from nearby platforms for 4 s.')]},
 swarm:{name:'Swarm',short:'SW',element:'furnace',color:0xff6654,skills:[ability('Hive Salvo',9,'Twelve 9k homing missiles; 100 m splash.'),ability('Brood Launch',12,'Two 25k-HP gun drones for 8 s, each firing 6k elemental rounds every second.')]},
 vector:{name:'Vector',short:'VE',element:'storm',color:0x77b8ff,skills:[ability('Hull Dash',10,'Any living Vector grants Hull Dash and Mobile Battery, and every living Vector adds 6% speed, 20% acceleration, 12% turn and rudder, and 15% turret traverse, with no cap. Hull Dash lifts Architect clear of the water and turns it bow-first onto the reticle for 0.55 s with 70% damage reduction, barrelling through enemy hulls (15k each, shoved aside) and landing with a 450 m, 25k shockwave; both grow with every living Vector. This specialization extends the dash from 800 m to 1100 m; each extra one adds 150 m and a charge. Charges recharge one at a time every 10 s.'),ability('Mobile Battery',14,'Any living Vector grants Hull Dash and Mobile Battery. Deployed platforms lift into a loose hovering escort around Architect, each on its own orbit and altitude, following at up to 1200 m/s (15% faster per living Vector) while firing and using skills, then settle on nearby water. This specialization extends Mobile Battery from 10 s to 14 s; each extra one adds 3 s and cuts the 14 s cooldown by 15%. The cooldown starts on activation.')]},
};
export const ARCHITECT_TYPES=Object.keys(ARCHETYPES) as ArchitectType[];
export function validSelection(v:unknown):v is ArchitectSelection {const x=v as ArchitectSelection;return !!x&&typeof x==='object'&&typeof x.type==='string'&&Object.hasOwn(ARCHETYPES,x.type)&&(x.skill===0||x.skill===1);}
export function validLoadout(v:unknown):v is ArchitectLoadout{return Array.isArray(v)&&v.length===10&&v.every(validSelection);}
export function defaultLoadout():ArchitectLoadout{return Array.from({length:10},(_,i)=>({type:ARCHITECT_TYPES[i%5],skill:i<5?0:1}));}
export function copyLoadout(v:unknown):ArchitectLoadout{return validLoadout(v)?v.map(({type,skill})=>({type,skill})):defaultLoadout();}
export type ArsenalPreset='balanced'|'elemental'|'support'|'shuffle'|'unique';
/** Shared presets stay deterministic; the editor supplies randomness for Shuffle. */
export function loadoutPreset(p:ArsenalPreset,omitted:ArchitectType|ArchitectType[]='resonance',rng:()=>number=()=>.5):ArchitectLoadout{
 if(p==='elemental')return defaultLoadout();
 const excluded=Array.isArray(omitted)?omitted:[omitted];
 const types:ArchitectType[]=p==='support'?['restoration','restoration','bastion','bastion','sentinel','abyss','resonance','prism','storm','swarm']:p==='balanced'?['furnace','cryo','storm','gravity','prism','sentinel','abyss','restoration','bastion','swarm']:ARCHITECT_TYPES.filter(t=>!excluded.includes(t));
 return Array.from({length:10},(_,i)=>({type:p==='shuffle'?ARCHITECT_TYPES[Math.max(0,Math.min(ARCHITECT_TYPES.length-1,Math.floor(rng()*ARCHITECT_TYPES.length)))]:types[i%types.length],skill:(p==='shuffle'?rng()<.5?0:1:i%2) as 0|1}));
}
