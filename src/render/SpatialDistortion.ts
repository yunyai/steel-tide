import { Vector3, Vector4, type PerspectiveCamera } from 'three';

/**
 * Presentation-only world anchors, rebuilt separately for each viewport. Plain fields bend the scene in a
 * thin swirl at half their radius; a `lens` magnifies the background round a black hole, with a far larger
 * displacement budget. A lens leaves its inner 30% alone: that is the hole and its own light.
 */
export interface SpatialDistortion { x:number;y:number;z:number;radius:number;strength:number;priority:number;kind?:'lens' }
export const MAX_DISTORTIONS=12;
const point=new Vector3(),edge=new Vector3(),view=new Vector3();
/** Local actions win the fixed budget; overlapping copies do not multiply displacement. */
export function projectDistortions(fields:readonly SpatialDistortion[],camera:PerspectiveCamera):{shape:Vector4;depth:Vector4}[]{
  const out:{shape:Vector4;depth:Vector4}[]=[];
  for(const f of [...fields].sort((a,b)=>b.priority-a.priority)){
    if(![f.x,f.y,f.z,f.radius,f.strength].every(Number.isFinite)||f.radius<=0||f.strength<=0)continue;
    point.set(f.x,f.y,f.z);view.copy(point).applyMatrix4(camera.matrixWorldInverse);
    if(view.z>=-camera.near)continue;
    point.project(camera);edge.set(f.x,f.y,f.z).addScaledVector(new Vector3().setFromMatrixColumn(camera.matrixWorld,1),f.radius).project(camera);
    const r=Math.min(.45,Math.max(.001,Math.abs(edge.y-point.y)*.5)),x=point.x*.5+.5,y=point.y*.5+.5;
    if(x< -r||x>1+r||y< -r||y>1+r)continue;
    if(out.some(e=>Math.hypot((e.shape.x-x)*camera.aspect,e.shape.y-y)<Math.min(r,e.shape.z)*.65))continue;
    out.push({shape:new Vector4(x,y,r,Math.min(1,f.strength)),depth:new Vector4(-view.z,f.radius,f.kind==='lens'?1:0,0)});
    if(out.length===MAX_DISTORTIONS)break;
  }
  return out;
}
/**
 * How far a lens pulls a pixel `r` lens radii from its centre, as a share of the pixel's offset from it. Outside
 * the inner 30%, each pixel shows the scene from nearer the rim (but never from inside it), so the background
 * just past the hole is magnified and the horizon behind bows round it. Written in the GLSL subset JavaScript
 * also parses, so tests check the profile exactly as the shader runs it. Nothing past the rim moves.
 */
export const LENS_SHIFT_GLSL=/* glsl */`float lensShift(float r){
    if(r<=.3||r>=1.0)return 0.0;
    float u=clamp((r-.3)/.7,0.0,1.0);
    float source=.3+.7*u*mix(.5,1.0,smoothstep(0.0,1.0,u));
    return 1.0-source/r;
  }`;
export const SpatialDistortionShader={
  uniforms:{tDiffuse:{value:null},tDepth:{value:null},uCount:{value:0},uShape:{value:Array.from({length:MAX_DISTORTIONS},()=>new Vector4())},uDepth:{value:Array.from({length:MAX_DISTORTIONS},()=>new Vector4())},uNear:{value:1},uFar:{value:100000},uReverse:{value:0},uAspect:{value:1},uHeight:{value:720}},
  vertexShader:/* glsl */`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
  fragmentShader:/* glsl */`
  uniform sampler2D tDiffuse,tDepth;
  uniform int uCount;
  uniform vec4 uShape[12],uDepth[12];
  uniform float uNear,uFar,uReverse,uAspect,uHeight;
  varying vec2 vUv;
  float distanceAt(vec2 uv){float d=texture2D(tDepth,uv).r;return uNear*uFar/(uReverse>.5?uNear+d*(uFar-uNear):uFar-d*(uFar-uNear));}
  ${LENS_SHIFT_GLSL}
  void main(){
    if(uCount==0){gl_FragColor=texture2D(tDiffuse,vUv);return;}
    vec2 offset=vec2(0.0),lens=vec2(0.0);float sceneDepth=distanceAt(vUv);
    for(int i=0;i<12;i++){
      if(i>=uCount)break;
      vec4 f=uShape[i];vec2 d=(vUv-f.xy)*vec2(uAspect,1.0)/f.z;float r=length(d);
      float visible=smoothstep(uDepth[i].x-uDepth[i].y*.2-10.0,uDepth[i].x-uDepth[i].y*.2+10.0,sceneDepth);
      if(uDepth[i].z>.5){
        // Water in front of the hole fades out of the lens gradually, so no seam tears across it.
        float behind=smoothstep(uDepth[i].x-uDepth[i].y*.6,uDepth[i].x-uDepth[i].y*.1,sceneDepth);
        lens-=(vUv-f.xy)*lensShift(r)*f.w*behind;
        continue;
      }
      float envelope=exp(-pow((r-.48)*4.5,2.0))*(1.0-smoothstep(.75,1.0,r));
      vec2 bend=vec2(d.x*.8-d.y*.25,d.y*.8+d.x*.25);
      offset+=bend*envelope*f.w*visible*4.0/max(1.0,uHeight)/vec2(uAspect,1.0);
    }
    float cap=5.0/max(1.0,uHeight);offset*=min(1.0,cap/max(length(offset),.000001));
    lens*=min(1.0,.2/max(length(lens),.000001));
    vec2 target=clamp(vUv+offset+lens,vec2(.001),vec2(.999));
    // Never pull a nearer obstacle or hull across its silhouette into a background fold.
    if(distanceAt(target)<sceneDepth-max(15.0,sceneDepth*.015))target=vUv;
    gl_FragColor=texture2D(tDiffuse,target);
  }`,
};
