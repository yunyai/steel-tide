import { expect,it } from 'vitest';
import { feedbackDamageText,layoutFeedbackPopups,type FeedbackRect } from '../src/ui/FeedbackLayout';

const overlaps=(a:FeedbackRect,b:FeedbackRect)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;

it('keeps crowded salvos inside the viewport and clear of score and active-alert areas',()=>{
  const items=Array.from({length:12},()=>({x:640,y:280,width:140,height:48}));
  const guards=[{left:500,top:12,right:780,bottom:80},{left:390,top:160,right:890,bottom:238}];
  const positions=layoutFeedbackPopups(items,1280,720,guards),boxes:FeedbackRect[]=[];
  positions.forEach((p,i)=>{
    const item=items[i],box={left:p.x-item.width/2,right:p.x+item.width/2,top:p.y-item.height,bottom:p.y};
    expect(box.left).toBeGreaterThanOrEqual(12);expect(box.right).toBeLessThanOrEqual(1268);
    expect(box.top).toBeGreaterThanOrEqual(12);expect(box.bottom).toBeLessThanOrEqual(708);
    expect(guards.some(g=>overlaps(box,g))).toBe(false);
    expect(boxes.some(b=>overlaps(box,b))).toBe(false);
    expect(Math.abs(p.x-640)).toBeLessThanOrEqual(438);expect(Math.abs(p.y-280)).toBeLessThanOrEqual(162);
    boxes.push(box);
  });
});

it('bounds feedback at both viewport edges using the full animated footprint',()=>{
  const items=[{x:2,y:20,width:378,height:95},{x:1278,y:718,width:378,height:95}];
  const positions=layoutFeedbackPopups(items,1280,720);
  positions.forEach((p,i)=>{
    expect(p.x-items[i].width/2).toBeGreaterThanOrEqual(12);
    expect(p.x+items[i].width/2).toBeLessThanOrEqual(1268);
    expect(p.y-items[i].height).toBeGreaterThanOrEqual(12);expect(p.y).toBeLessThanOrEqual(708);
  });
});

it('leaves one unobstructed ordinary hit at its target anchor',()=>{
  expect(layoutFeedbackPopups([{x:640,y:400,width:200,height:60}],1280,720)).toEqual([{x:640,y:400}]);
});

it('compacts crowded totals while retaining exact accessible damage',()=>{
  expect(feedbackDamageText(1400000,false)).toEqual({text:'1,400,000',full:'1,400,000'});
  expect(feedbackDamageText(1400000,true)).toEqual({text:'1.4M',full:'1,400,000'});
  expect(feedbackDamageText(900000,true)).toEqual({text:'900K',full:'900,000'});
  expect(feedbackDamageText(999950,true)).toEqual({text:'1M',full:'999,950'});
  expect(feedbackDamageText(4432.4,true)).toEqual({text:'4,432',full:'4,432'});
});
