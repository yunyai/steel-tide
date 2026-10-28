import { ARCHETYPES,ARCHITECT_TYPES,copyLoadout,loadoutPreset,type ArchitectLoadout,type ArchitectType,type ArchitectSelection,type ArsenalPreset } from '../data/architectLoadout';
import { ARCHITECT_LOADOUT_FILENAME,ARCHITECT_LOADOUT_MAX_BYTES,parseArchitectLoadout,serializeArchitectLoadout } from '../data/architectLoadoutTransfer';
import { ArchitectEditorState,type ArchitectApply,type ArchitectApplyResult } from './ArchitectEditorState';
import { h } from './dom';
const KEY='steel-tide.architect-loadout.v1';
export function savedArchitectLoadout():ArchitectLoadout{try{return copyLoadout(JSON.parse(localStorage.getItem(KEY)??'null'));}catch{return copyLoadout(undefined);}}
export function saveArchitectLoadout(value:ArchitectLoadout):void{try{localStorage.setItem(KEY,JSON.stringify(copyLoadout(value)));}catch{/* Private browsers still keep the current battle selection. */}}
export interface ArchitectEditor {
  el:HTMLElement;
  sync(accepted:ArchitectLoadout,editable:readonly boolean[]):void;
  resolve(index:number,pick:ArchitectSelection,accepted:boolean,reason?:string):void;
  dispose():void;
}
export function architectLoadoutEditor(value:ArchitectLoadout,onApply:ArchitectApply,editable:readonly boolean[]=Array(10).fill(true)):ArchitectEditor {
  const state=new ArchitectEditorState(value,editable);
  let slot=0,omitted:ArchitectType='resonance',candidate:ArchitectLoadout|null=null,disposed=false,hasResult=false,previewing=false;
  let lastSyncKey=JSON.stringify(value)+editable.join();
  const root=h('section',{class:'arsenal-editor','aria-label':'Architect turret loadout'});
  const title=h('h3',{},'Platform arsenal'),note=h('p',{class:'arsenal-note'},'Ten platforms · one automatic skill each · elemental guns work while docked');
  const presets=h('div',{class:'arsenal-presets'}),slots=h('div',{class:'arsenal-slots',role:'group','aria-label':'Platform slots'}),detail=h('div',{class:'arsenal-detail'});
  const result=h('p',{class:'arsenal-result',role:'status','aria-live':'polite','aria-atomic':'true'});
  const disclosure=h('button',{type:'button',class:'arsenal-disclosure','aria-expanded':'false'},'Import / export');
  const transfer=h('div',{class:'arsenal-transfer',hidden:''});
  const transferNote=h('p',{class:'arsenal-note'},'Version 1 JSON · ten ordered selections · 64 KiB maximum. Paste or choose a file to preview; Apply import changes the available slots.');
  const transferStatus=h('p',{class:'arsenal-transfer-status',role:'status','aria-live':'polite','aria-atomic':'true'});
  const text=h('textarea',{rows:'7',spellcheck:'false','aria-label':'Loadout JSON','data-arsenal-key':'json',placeholder:'Paste an exported Architect loadout JSON document'});
  const applyImport=h('button',{type:'button'},'Apply import');applyImport.disabled=true;
  const status=(message:string,error=false)=>{previewing=false;if(transferStatus.textContent!==message)transferStatus.textContent=message;transferStatus.classList.toggle('error',error);text.setAttribute('aria-invalid',String(error));};
  function report(outcome:ArchitectApplyResult):void {
    const counts=`${outcome.accepted.length} applied · ${outcome.pending.length} pending · ${outcome.skipped.length} locked · ${outcome.rejected.length} rejected`;
    const failures=outcome.rejected.map(x=>`Platform ${x.index+1}: ${x.reason}`).join(' ');
    const message=`${counts}.${failures?' '+failures:''}`;if(result.textContent!==message)result.textContent=message;
  }
  function commit(next:ArchitectLoadout):void {hasResult=true;report(state.apply(next,onApply));render();}
  function stage():void {
    if (!text.value.trim()) {candidate=null;applyImport.disabled=true;status('Paste JSON or choose a loadout file.');return;}
    const parsed=parseArchitectLoadout(text.value);candidate=parsed.ok?parsed.loadout:null;applyImport.disabled=!candidate;
    if (!parsed.ok) {status(parsed.message,true);return;}
    preview();
  }
  function preview():void {
    if (!candidate) return;
    let changed=0,available=0;
    candidate.forEach((pick,i)=>{const accepted=state.accepted[i];if (pick.type!==accepted.type||pick.skill!==accepted.skill) {changed++;if(state.canEdit(i))available++;}});
    status(`Valid loadout: ${changed} changed · ${available} available · ${changed-available} locked or pending. Apply import to refit available slots.`);previewing=true;
  }
  const closeTransfer=()=>{transfer.hidden=true;disclosure.setAttribute('aria-expanded','false');disclosure.focus({preventScroll:true});};
  disclosure.onclick=()=>{transfer.hidden=!transfer.hidden;disclosure.setAttribute('aria-expanded',String(!transfer.hidden));if(!transfer.hidden&&!text.value)status('Paste JSON or choose a loadout file.');};
  const copy=h('button',{type:'button'},'Copy JSON');
  copy.onclick=async()=>{
    const json=serializeArchitectLoadout(state.accepted);
    try {if(!navigator.clipboard?.writeText)throw Error('Clipboard unavailable');await navigator.clipboard.writeText(json);if(!disposed)status('Accepted loadout copied.');}
    catch {if(disposed)return;text.value=json;stage();text.focus();text.select();status('Clipboard unavailable. JSON is selected below: use your browser’s Copy command or Ctrl/Cmd+C.');}
  };
  const download=h('button',{type:'button'},'Download JSON');
  download.onclick=()=>{
    const url=URL.createObjectURL(new Blob([serializeArchitectLoadout(state.accepted)],{type:'application/json'})),anchor=h('a',{href:url,download:ARCHITECT_LOADOUT_FILENAME});
    root.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);status('Accepted loadout downloaded.');
  };
  const file=h('input',{type:'file',accept:'.json,application/json',hidden:'','aria-label':'Choose JSON file'}),choose=h('button',{type:'button'},'Choose JSON file');
  choose.onclick=()=>{file.value='';file.click();};
  file.onchange=async()=>{
    const selected=file.files?.[0];if(!selected)return;
    if(selected.size>ARCHITECT_LOADOUT_MAX_BYTES){candidate=null;applyImport.disabled=true;status('File exceeds 64 KiB. Choose a smaller JSON file.',true);return;}
    try {const value=await selected.text();if(disposed)return;text.value=value;stage();}
    catch {if(!disposed){candidate=null;applyImport.disabled=true;status('Could not read this file. Choose it again or paste its JSON.',true);}}
  };
  text.oninput=stage;
  // Menu input must not consume ordinary text-editing keys while the battle is paused.
  text.onkeydown=e=>e.stopPropagation();
  root.addEventListener('keydown',e=>{if(e.key==='Escape'&&!transfer.hidden){e.preventDefault();e.stopPropagation();closeTransfer();}},true);
  applyImport.onclick=()=>{if(candidate){commit(candidate);preview();}};
  const close=h('button',{type:'button','data-menu-back':'transfer'},'Close');close.onclick=closeTransfer;
  transfer.append(transferNote,h('div',{class:'arsenal-transfer-actions'},copy,download),h('label',{class:'arsenal-json-label'},'Loadout JSON',text),h('div',{class:'arsenal-transfer-actions'},choose,applyImport,close),file,transferStatus);
  for(const [id,label] of [['balanced','Balanced'],['elemental','Elemental'],['support','Support'],['shuffle','Shuffle'],['unique','One of each']] as [ArsenalPreset,string][]){const b=h('button',{type:'button'},label);b.onclick=()=>commit(loadoutPreset(id,omitted,Math.random));presets.append(b);}
  const omit=h('select',{'aria-label':'Type omitted by One of each'});for(const t of ARCHITECT_TYPES)omit.append(h('option',{value:t},`Omit ${ARCHETYPES[t].name}`));omit.value=omitted;omit.onchange=()=>omitted=omit.value as ArchitectType;presets.append(omit);
  const slotButtons=Array.from({length:10},(_,i)=>{
    const b=h('button',{type:'button','data-arsenal-key':`slot-${i}`},h('b'),h('small'));
    b.onclick=()=>{slot=i;render();};slots.append(b);return b;
  });
  const select=h('select',{'aria-label':'Platform 1 type','data-arsenal-key':'type'});
  for(const t of ARCHITECT_TYPES)select.append(h('option',{value:t},`${ARCHETYPES[t].name} · ${ARCHETYPES[t].element}`));
  select.onchange=()=>{const next=copyLoadout(state.accepted);next[slot]={type:select.value as ArchitectType,skill:0};commit(next);};
  const slotLabel=h('span',{},'Platform 1'),lockNote=h('p',{class:'arsenal-note'});
  const cards=[0,1].map(i=>{
    const b=h('button',{type:'button',class:'arsenal-skill','data-arsenal-key':`skill-${i}`},h('b'),h('span'),h('small'));
    b.onclick=()=>{const next=copyLoadout(state.accepted);next[slot]={...state.selection(slot),skill:i as 0|1};commit(next);};return b;
  });
  detail.append(h('label',{},slotLabel,select),h('div',{class:'arsenal-choices'},...cards),lockNote);
  function render():void {
    slotButtons.forEach((b,i)=>{
      const p=state.selection(i),a=ARCHETYPES[p.type];b.setAttribute('aria-pressed',String(i===slot));
      b.setAttribute('aria-label',`Platform ${i+1}, ${a.name}, ${a.skills[p.skill].name}${state.isPending(i)?', refit pending':!state.canEdit(i)?', locked':''}`);
      b.dataset.refit=state.isPending(i)?'pending':state.canEdit(i)?'available':'locked';
      b.style.setProperty('--type-color',`#${a.color.toString(16).padStart(6,'0')}`);b.children[0].textContent=`${i+1} ${a.short}`;b.children[1].textContent=a.skills[p.skill].name;
    });
    const pick=state.selection(slot),a=ARCHETYPES[pick.type];
    slotLabel.textContent=`Platform ${slot+1}`;select.setAttribute('aria-label',`Platform ${slot+1} type`);select.value=pick.type;select.disabled=!state.canEdit(slot);
    cards.forEach((b,i)=>{const skill=a.skills[i];b.setAttribute('aria-pressed',String(pick.skill===i));b.disabled=!state.canEdit(slot);b.children[0].textContent=skill.name;b.children[1].textContent=skill.description;b.children[2].textContent=`${skill.cooldown}s recharge · automatic when deployed`;});
    lockNote.hidden=state.canEdit(slot);lockNote.textContent=state.isPending(slot)?'Refit pending. Waiting for battle confirmation.':'Refitting requires a living captain, a docked platform and no transformation. Refits start the selected skill’s cooldown.';
    if(candidate&&!transfer.hidden&&previewing)preview();
  }
  root.append(title,note,presets,disclosure,transfer,slots,detail,result);render();
  return {el:root,sync(accepted,editable){const key=JSON.stringify(accepted)+editable.join();if(key===lastSyncKey)return;lastSyncKey=key;state.sync(accepted,editable);if(hasResult)report(state.result);render();},resolve(index,pick,accepted,reason){state.resolve(index,pick,accepted,reason);if(hasResult)report(state.result);render();},dispose(){disposed=true;}};
}
