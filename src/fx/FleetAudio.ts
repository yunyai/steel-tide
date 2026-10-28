import type {ShipSpec,SkillSpec} from '../core/types';
import {eraOf} from '../data/factions';
import {skillTreatment} from '../render/FleetStyle';
import type {SoundKind} from './SoundCues';
export const FLEET_AUDIO_ASSETS=['arcane-charge','energy-charge','energy-heavy','energy-pulse','cut-heavy','cut-light','blast-heavy','blast-shock','ward-rise','phase-arrival','sensor-ping','mechanical-hit','plasma-shot','jet-release'].map(s=>`${import.meta.env.BASE_URL}audio/${s}.m4a`);
const a=(...names:string[])=>names.map(n=>`${import.meta.env.BASE_URL}audio/${n}.m4a`);
export interface FleetCue {assets:string[];kind:SoundKind;gain:number;rate:number}
export function fleetCue(ship:ShipSpec,skill:SkillSpec,event: 'activate'|'release'='activate'):FleetCue|undefined{
 if(ship.id==='stepper'||ship.nation==='foundry')return;
 const era=eraOf(ship),tech=era==='modern'||era==='historic',titan=ship.cls==='TT',kind=skillTreatment(skill);
 let assets:string[],sound:SoundKind='zap';
 switch(kind){
  case 'battery':assets=tech?a('mechanical-hit','torpedo-launch'):a('plasma-shot','energy-pulse');sound='gun';break;
  case 'energy':assets=event==='activate'?(tech?a('energy-charge'):a('arcane-charge','energy-charge')):a('energy-heavy','energy-pulse');sound=event==='activate'?'charge':'laser';break;
  case 'cut':assets=a('cut-heavy','cut-light');break;
  case 'blast':assets=tech?a('sonniss-explosion','sonniss-depth'):a('blast-heavy','blast-shock');sound='explosion';break;
  case 'ward':assets=tech?a('shield','sensor-ping'):a('ward-rise','arcane-charge');sound='shield';break;
  case 'repair':assets=a('ward-rise','shield');sound='shield';break;
  case 'summon':assets=tech?a('jet-release','missile-launch'):a('phase-arrival','ward-rise');break;
  case 'wake':assets=tech?a('jet-release','torpedo-launch'):a('cut-light','phase-arrival');break;
  case 'scan':assets=a('sensor-ping');sound='shield';break;
  default:assets=tech?a('sonniss-depth','energy-charge'):a('arcane-charge','energy-charge');sound='charge';
 }
 // A signature from each titan's existing theme, rather than a universal ultimate bang.
 if(skill.ult){
  if(['drums','lightning'].includes(skill.icon))assets=a('thunder','blast-shock');
  if(skill.icon==='skull'||ship.id==='hadal')assets=a('collapse','blast-heavy');
  if(kind==='energy'&&event==='release')assets=ship.nation==='dragonball'?a('energy-heavy','beam'):a('energy-pulse','plasma-shot');
 }
 return {assets,kind:sound,gain:skill.ult?.75:kind==='scan'?.45:.6,rate:titan?.91:1};
}
/** Round-robin selection is local to the audio engine; no Game RNG consumption. */
export function variantAsset(assets:readonly string[],sequence:number):string{return assets[sequence%assets.length];}
export function fleetWeapon(ship:ShipSpec,look:string|undefined):string|undefined{
 if(ship.id==='stepper'||ship.nation==='foundry'||!look||look==='shell')return;
 return look==='rail'?`${import.meta.env.BASE_URL}audio/mechanical-hit.m4a`:look==='laser'||look==='plasma'?`${import.meta.env.BASE_URL}audio/plasma-shot.m4a`:look==='soulfire'?`${import.meta.env.BASE_URL}audio/phase-arrival.m4a`:look==='runefire'?`${import.meta.env.BASE_URL}audio/blast-shock.m4a`:`${import.meta.env.BASE_URL}audio/energy-pulse.m4a`;
}
