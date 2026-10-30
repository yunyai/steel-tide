export interface FeedbackRect {left:number;top:number;right:number;bottom:number}
export interface FeedbackPopup {x:number;y:number;width:number;height:number}

/** Full digits by default; the short setting writes every total of 1,000 or more in thousands or millions. */
export function feedbackDamageText(damage:number,short=false):{text:string;full:string}{
  const amount=Math.round(damage),full=amount.toLocaleString();
  if(!short||amount<1000)return {text:full,full};
  const millions=amount>=999950,unit=millions?1e6:1e3;
  return {text:`${(Math.round(amount/unit*10)/10).toLocaleString(undefined,{maximumFractionDigits:1})}${millions?'M':'K'}`,full};
}

const overlap=(a:FeedbackRect,b:FeedbackRect)=>Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
const clamp=(v:number,low:number,high:number)=>Math.max(low,Math.min(high,v));
const SLOTS=[0,-1,1,-2,2,-3,3];

/** Try a fixed set of nearby side/vertical slots instead of cascading upward without a bound. */
export function layoutFeedbackPopups(items:FeedbackPopup[],width:number,height:number,guards:FeedbackRect[]=[]):{x:number;y:number}[]{
  const padding=12,gap=6;
  const placed:FeedbackRect[]=[];
  return items.map(item=>{
    const half=item.width/2,baseX=clamp(item.x,padding+half,width-padding-half),baseY=clamp(item.y,padding+item.height,height-padding);
    let best={x:baseX,y:baseY},score=Infinity;
    for(const dy of SLOTS)for(const dx of SLOTS){
      const x=clamp(baseX+dx*(item.width+gap),padding+half,width-padding-half),y=clamp(baseY+dy*(item.height+gap),padding+item.height,height-padding);
      const box={left:x-half,right:x+half,top:y-item.height,bottom:y};
      const covered=guards.reduce((sum,b)=>sum+overlap(box,b),0),crowded=placed.reduce((sum,b)=>sum+overlap(box,b),0);
      const cost=covered*1e9+crowded*1e6+(x-baseX)**2+(y-baseY)**2;
      if(cost<score){best={x,y};score=cost;}
    }
    placed.push({left:best.x-half-gap/2,right:best.x+half+gap/2,top:best.y-item.height-gap/2,bottom:best.y+gap/2});
    return best;
  });
}
