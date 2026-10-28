import { validLoadout, validSelection, type ArchitectLoadout } from './architectLoadout';

export const ARCHITECT_LOADOUT_MAX_BYTES = 64 * 1024;
export const ARCHITECT_LOADOUT_FILENAME = 'steel-tide-architect-loadout.json';
export type ArchitectImportResult =
  | { ok:true; loadout:ArchitectLoadout }
  | { ok:false; message:string; slot?:number };

/** Portable selections only. Combat state and unrelated properties never cross this boundary. */
export function serializeArchitectLoadout(value:ArchitectLoadout):string {
  if (!validLoadout(value)) throw new Error('A loadout must contain ten valid platform selections.');
  return JSON.stringify({format:'steel-tide.architect-loadout',version:1,slots:value.map(({type,skill})=>({type,skill}))},null,2);
}

export function parseArchitectLoadout(text:string):ArchitectImportResult {
  if (new TextEncoder().encode(text).byteLength > ARCHITECT_LOADOUT_MAX_BYTES)
    return {ok:false,message:'Loadout exceeds 64 KiB. Choose a smaller JSON file.'};
  let value:unknown;
  try { value=JSON.parse(text); }
  catch { return {ok:false,message:'Invalid JSON. Check the pasted text or choose an exported loadout file.'}; }
  if (!value || typeof value!=='object' || Array.isArray(value)) return {ok:false,message:'Use a Steel Tide Architect loadout JSON document.'};
  const doc=value as Record<string,unknown>;
  if (doc.format!=='steel-tide.architect-loadout') return {ok:false,message:'Unrecognized format. Choose a Steel Tide Architect loadout.'};
  if (doc.version!==1) return {ok:false,message:'Unsupported loadout version. This game accepts version 1.'};
  if (!Array.isArray(doc.slots) || doc.slots.length!==10) return {ok:false,message:'A loadout must contain exactly ten ordered platform slots.'};
  const slot=doc.slots.findIndex(p=>!validSelection(p));
  if (slot!==-1) return {ok:false,slot,message:`Platform ${slot+1}: choose a known type and numeric skill 0 or 1.`};
  return {ok:true,loadout:doc.slots.map(p=>({type:p.type,skill:p.skill}))};
}
