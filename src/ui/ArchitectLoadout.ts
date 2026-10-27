import { ARCHETYPES,ARCHITECT_TYPES,copyLoadout,loadoutPreset,type ArchitectLoadout,type ArchitectType,type ArchitectSelection,type ArsenalPreset } from '../data/architectLoadout';
import { h } from './dom';
const KEY='steel-tide.architect-loadout.v1';
export function savedArchitectLoadout():ArchitectLoadout{try{return copyLoadout(JSON.parse(localStorage.getItem(KEY)??'null'));}catch{return copyLoadout(undefined);}}
export function saveArchitectLoadout(value:ArchitectLoadout):void{try{localStorage.setItem(KEY,JSON.stringify(copyLoadout(value)));}catch{/* Private browsers still keep the current battle selection. */}}
export function architectLoadoutEditor(value:ArchitectLoadout,onChange:(v:ArchitectLoadout,index?:number)=>void,editable:(i:number)=>boolean=()=>true):HTMLElement{
 let current=copyLoadout(value),slot=0,omitted:ArchitectType='resonance';
 const root=h('section',{class:'arsenal-editor','aria-label':'Architect turret loadout'});
 const title=h('h3',{},'Platform arsenal'),note=h('p',{class:'arsenal-note'},'Ten platforms · one automatic skill each · elemental guns work while docked');
 const presets=h('div',{class:'arsenal-presets'}),slots=h('div',{class:'arsenal-slots',role:'group','aria-label':'Platform slots'}),detail=h('div',{class:'arsenal-detail'});
 const commit=(v:ArchitectLoadout,index?:number)=>{current=copyLoadout(v);onChange(current,index);render();};
 for(const [id,label] of [['balanced','Balanced'],['elemental','Elemental'],['support','Support'],['shuffle','Shuffle'],['unique','One of each']] as [ArsenalPreset,string][]){const b=h('button',{type:'button'},label);b.onclick=()=>{const next=loadoutPreset(id,omitted);commit(next.map((x,i)=>editable(i)?x:current[i]));};presets.append(b);}
 const omit=h('select',{'aria-label':'Type omitted by One of each'});for(const t of ARCHITECT_TYPES)omit.append(h('option',{value:t},`Omit ${ARCHETYPES[t].name}`));omit.value=omitted;omit.onchange=()=>omitted=omit.value as ArchitectType;presets.append(omit);
 function render(){
  const active=document.activeElement as HTMLElement|null,focus=active&&root.contains(active)?active.dataset.arsenalKey:undefined;
  slots.replaceChildren(...current.map((p,i)=>{const a=ARCHETYPES[p.type],b=h('button',{type:'button','data-arsenal-key':`slot-${i}`,'aria-pressed':String(i===slot),'aria-label':`Platform ${i+1}, ${a.name}, ${a.skills[p.skill].name}`},h('b',{},`${i+1} ${a.short}`),h('small',{},a.skills[p.skill].name));b.style.setProperty('--type-color',`#${a.color.toString(16).padStart(6,'0')}`);b.onclick=()=>{slot=i;render();};return b;}));
  const pick=current[slot],a=ARCHETYPES[pick.type],select=h('select',{'aria-label':`Platform ${slot+1} type`,'data-arsenal-key':'type'});
  for(const t of ARCHITECT_TYPES)select.append(h('option',{value:t},`${ARCHETYPES[t].name} · ${ARCHETYPES[t].element}`));select.value=pick.type;select.disabled=!editable(slot);
  select.onchange=()=>{current[slot]={type:select.value as ArchitectType,skill:0};commit(current,slot);};
  const cards=a.skills.map((skill,i)=>{const b=h('button',{type:'button',class:'arsenal-skill','data-arsenal-key':`skill-${i}`,'aria-pressed':String(pick.skill===i)},h('b',{},skill.name),h('span',{},skill.description),h('small',{},`${skill.cooldown}s recharge · automatic when deployed`));b.disabled=!editable(slot);b.onclick=()=>{current[slot]={...pick,skill:i as ArchitectSelection['skill']};commit(current,slot);};return b;});
  detail.replaceChildren(h('label',{},`Platform ${slot+1}`,select),h('div',{class:'arsenal-choices'},...cards));
  if(focus)root.querySelector<HTMLElement>(`[data-arsenal-key="${focus}"]`)?.focus({preventScroll:true});
  if(!editable(slot))detail.append(h('p',{class:'arsenal-note'},'Recall this platform before refitting. Refitting starts its skill cooldown.'));
 }
 root.append(title,note,presets,slots,detail);render();return root;
}
