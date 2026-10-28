import { expect, it } from 'vitest';
import { defaultLoadout } from '../src/data/architectLoadout';
import { parseArchitectLoadout, serializeArchitectLoadout, ARCHITECT_LOADOUT_MAX_BYTES } from '../src/data/architectLoadoutTransfer';

const documentFor = (slots:unknown=defaultLoadout(), extra={}) => JSON.stringify({format:'steel-tide.architect-loadout',version:1,slots,...extra});
it('round trips ten ordered duplicate type selections with skill one',()=>{
 const value=defaultLoadout();value[0]={type:'swarm',skill:1};value[1]={type:'swarm',skill:1};
 const parsed=parseArchitectLoadout(serializeArchitectLoadout(value));expect(parsed).toEqual({ok:true,loadout:value});
 if(parsed.ok){parsed.loadout[0].skill=0;expect(value[0].skill).toBe(1);}
});
it.each(['{',documentFor(undefined,{format:'other'}),documentFor(undefined,{version:2}),documentFor(defaultLoadout().slice(1)),documentFor([...defaultLoadout(),defaultLoadout()[0]])])('rejects malformed or unsupported documents: %s',text=>expect(parseArchitectLoadout(text).ok).toBe(false));
it.each([2,-1,'1',null])('rejects invalid numeric or string skill %s',skill=>{
 const slots:unknown[]=defaultLoadout();slots[4]={type:'furnace',skill};
 expect(parseArchitectLoadout(documentFor(slots))).toMatchObject({ok:false,slot:4});
});
it('rejects unknown types and leaves caller state intact',()=>{
 const value=defaultLoadout(),before=structuredClone(value),bad=structuredClone(value);(bad[3] as {type:string}).type='constructor';
 expect(parseArchitectLoadout(documentFor(bad))).toMatchObject({ok:false,slot:3});expect(value).toEqual(before);
});
it('limits UTF-8 bytes before JSON parsing, including multibyte file text',()=>{
 expect(ARCHITECT_LOADOUT_MAX_BYTES).toBe(65536);
 expect(parseArchitectLoadout(' '.repeat(65537))).toMatchObject({ok:false,message:expect.stringMatching(/64 KiB/)});
 expect(parseArchitectLoadout(documentFor(defaultLoadout(),{extra:'海'.repeat(22000)}))).toMatchObject({ok:false,message:expect.stringMatching(/64 KiB/)});
});
it('normalizes only whitelisted selection properties on import and export',()=>{
 const slots=defaultLoadout().map(p=>({...p,hp:100000,timer:4}));
 const parsed=parseArchitectLoadout(documentFor(slots,{battleId:'private'}));expect(parsed).toEqual({ok:true,loadout:defaultLoadout()});
 expect(JSON.parse(serializeArchitectLoadout(slots))).toEqual({format:'steel-tide.architect-loadout',version:1,slots:defaultLoadout()});
});
