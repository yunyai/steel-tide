import { audio, type AudioEngine } from '../fx/Audio';

/** Reuse the same recorded response for mouse, keyboard and controller editor actions. */
export function menuFeedback(root:HTMLElement,sound:Pick<AudioEngine,'ui'>=audio):()=>void {
  let last=-Infinity;
  const feedback=(event:Event)=>{
    const target=event.target instanceof Element?event.target.closest('button,select,input[type="checkbox"]'):null;
    if(!(target instanceof HTMLElement)||target.matches(':disabled')||!root.contains(target))return;
    if(event.type==='click'&&target.tagName!=='BUTTON')return;
    // A controller activation can cause click and focus in the same frame.
    const now=performance.now();if(now-last<60)return;last=now;sound.ui('click');
  };
  root.addEventListener('click',feedback);root.addEventListener('change',feedback);
  return()=>{root.removeEventListener('click',feedback);root.removeEventListener('change',feedback);};
}
