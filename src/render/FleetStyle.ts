import type {SkillSpec} from '../core/types';
export type SkillTreatment='battery'|'energy'|'cut'|'blast'|'ward'|'repair'|'summon'|'wake'|'scan'|'storm';
export function skillTreatment(s:SkillSpec):SkillTreatment{
 if(['beam','laser','rod','gravity','magnet'].includes(s.icon))return 'energy';
 if(['blade','fist','hammer'].includes(s.icon))return 'cut';
 if(['nuke','strike','meteor'].includes(s.icon))return 'blast';
 if(['shield','wall','cloak','silence','time','eye'].includes(s.icon))return 'ward';
 if(s.icon==='heal')return 'repair';
 if(['fleet','drone','plane','beast','portal','skull','root'].includes(s.icon))return 'summon';
 if(['speed','blink','swap','ram','torpedo'].includes(s.icon))return 'wake';
 if(['radar','reveal'].includes(s.icon))return 'scan';
 if(['lightning','cryo','snow','gale','wave','drums','fear','rune','shift'].includes(s.icon))return 'storm';
 return 'battery';
}
