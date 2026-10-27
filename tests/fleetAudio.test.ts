import {it,expect} from 'vitest';
import {SHIP_BY_ID} from '../src/data/ships';
import {fleetCue,variantAsset} from '../src/fx/FleetAudio';
import {cueAsset,allAudioAssets} from '../src/fx/SoundCues';
it('selects attributable contrasting treatments while preserving bespoke ships',()=>{
 const cue=(id:string,i=0)=>fleetCue(SHIP_BY_ID[id],SHIP_BY_ID[id].skills![i]);
 expect(cue('stepper')).toBeUndefined();expect(cue('architect')).toBeUndefined();
 expect(cue('goku')!.assets).not.toEqual(cue('yamato')!.assets);
 const known=new Set(allAudioAssets());for(const id of ['goku','yamato','hadal','sukunaKing','astraea'])for(const skill of SHIP_BY_ID[id].skills!){const c=fleetCue(SHIP_BY_ID[id],skill)!;expect(c.assets.every(a=>known.has(a))).toBe(true);}
 expect(cueAsset('crossStep','impact','slash')).toBe('/audio/slash.m4a');
});
it('rotates a small cue pool without immediate repetition or simulation RNG',()=>{
 const assets=['a','b','c'];let last='';for(let i=0;i<12;i++){const next=variantAsset(assets,i);expect(next).not.toBe(last);last=next;}expect(variantAsset(['a'],50)).toBe('a');
});
import {vi} from 'vitest';
import {AudioEngine} from '../src/fx/Audio';
it('uses explosion multiplier units instead of cannon caliber for fleet blasts',()=>{
 const engine=new AudioEngine(),play=vi.spyOn(engine,'play').mockImplementation(()=>{}),ship=SHIP_BY_ID.arminColossal;
 const skill={...ship.skills![0],icon:'nuke' as const,ult:true};engine.shipCue(ship,skill,12000,0,0,false);
 expect(play.mock.calls[0][0]).toBe('explosion');expect(play.mock.calls[0][4]).toBeLessThanOrEqual(2);
 play.mockRestore();
});
it('separates beam charging from beam release recordings',()=>{
 const ship=SHIP_BY_ID.goku,skill=ship.skills![0];
 const charge=fleetCue(ship,skill)!,release=fleetCue(ship,skill,'release')!;
 expect(charge.assets.some(a=>a.includes('charge'))).toBe(true);
 expect(release.assets.every(a=>!a.includes('charge'))).toBe(true);
 expect(release.assets).not.toEqual(charge.assets);
});
