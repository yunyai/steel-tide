import { Color, DoubleSide, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, TetrahedronGeometry, Float32BufferAttribute, BufferGeometry, Quaternion, ShaderMaterial, Vector3, type Scene } from 'three';

/** Closed lens mesh: longitudinal rings with a complete cross-section, including an edge-on silhouette. */
function foldGeometry():BufferGeometry {
  const p:number[]=[],uv:number[]=[],ix:number[]=[];const rings=32,sides=12;
  for(let i=0;i<=rings;i++)for(let j=0;j<=sides;j++){
    const u=i/rings,v=j/sides,t=Math.sin(u*Math.PI),a=v*Math.PI*2;
    p.push(u*2-1,Math.sin(a)*t,Math.cos(a)*t*.16);uv.push(u,v);
    if(i<rings&&j<sides){const n=i*(sides+1)+j;ix.push(n,n+sides+1,n+1,n+1,n+sides+1,n+sides+2);}
  }
  const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(p,3));g.setAttribute('uv',new Float32BufferAttribute(uv,2));g.setIndex(ix);g.computeVertexNormals();return g;
}
const vertex=/* glsl */`
attribute vec4 iPhase;
attribute vec3 iTint;
attribute vec4 iCurveA;
attribute vec4 iCurveB;
attribute vec4 iCurveC;
varying vec2 vUv;
varying vec4 vPhase;
varying vec3 vTint;
varying vec3 vNormal;
varying vec3 vView;
void main(){
  vUv=uv;vPhase=iPhase;vTint=iTint;
  float age=clamp(iPhase.x,0.0,1.0),a=uv.y*6.2831853;
  float u=uv.x*2.0-1.0,taper=max(0.0,1.0-u*u);
  vec3 p,n;
  if(iPhase.w<.5){
    float open=.12+.88*sin(pow(age,.7)*3.14159265);
    float bend=sin(u*3.2+iPhase.z)*.09*taper;
    p=vec3(sin(a)*taper*.48*open+bend,u,cos(a)*taper*.16*open);
    n=normalize(vec3(sin(a)*.35,u*.16,cos(a)));
  }else{
    // The leading tip advances along the cut; a closed lenticular cross-section gives it thickness.
    float grow=smoothstep(0.0,.28,age);
    float x=-1.0+(u+1.0)*grow;
    p=vec3(x,.32*(1.0-x*x)+sin(a)*taper*.12,cos(a)*taper*.065);
    n=normalize(vec3(-x*.08,sin(a)*.5,cos(a)));
  }
  if(iPhase.w>1.5){
    float t=uv.x*smoothstep(0.0,.32,age),v=1.0-t;
    vec3 center=v*v*iCurveA.xyz+2.0*v*t*iCurveB.xyz+t*t*iCurveC.xyz;
    vec3 tangent=normalize(2.0*v*(iCurveB.xyz-iCurveA.xyz)+2.0*t*(iCurveC.xyz-iCurveB.xyz)+vec3(.0001));
    vec3 side=normalize(cross(tangent,vec3(0.0,1.0,.001))),up=normalize(cross(side,tangent));
    vec3 lateral=side*cos(iCurveB.w)+up*sin(iCurveB.w),normal=cross(tangent,lateral);
    float taper=pow(max(0.0,sin(uv.x*3.14159265)),.65);
    p=center+(lateral*sin(a)*.5+normal*cos(a)*.07)*iCurveA.w*taper;
    n=normalize(lateral*sin(a)*.3+normal*cos(a));
  }
  vec4 mv=modelViewMatrix*instanceMatrix*vec4(p,1.0);
  vView=-mv.xyz;vNormal=normalize(normalMatrix*mat3(instanceMatrix)*n);
  gl_Position=projectionMatrix*mv;
}`;
const fragment=/* glsl */`
varying vec2 vUv;
varying vec4 vPhase;
varying vec3 vTint;
varying vec3 vNormal;
varying vec3 vView;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
void main(){
  float age=clamp(vPhase.x,0.0,1.0),a=vUv.y*6.2831853;
  float fade=(1.0-smoothstep(.38,1.0,age))*smoothstep(0.0,.025,age);
  float flow=noise(vec2(vUv.x*18.0-age*7.0,vUv.y*5.0)+vPhase.z);
  float lip=pow(max(0.0,1.0-abs(cos(a))),5.0);
  float fresnel=pow(clamp(1.0-abs(dot(normalize(vNormal),normalize(vView))),0.0,1.0),3.0);
  float blade=step(.5,vPhase.w);
  vec3 body=mix(vTint*.018,vTint*.32,blade)*( .65+flow*.7);
  vec3 c=body+vTint*(lip*.75+fresnel*.2)+vec3(2.1,1.9,2.4)*pow(lip,3.0);
  float alpha=mix(.8,.6,blade)+lip*.2;
  alpha*=fade*vPhase.y;
  if(alpha<.004)discard;
  gl_FragColor=vec4(c,clamp(alpha,0.0,1.0));
}`;
const shardVertex=/* glsl */`
attribute vec4 iPhase;
attribute vec3 iTint;
attribute vec3 barycentric;
varying vec3 vBary;
varying vec3 vNormal;
varying vec4 vPhase;
varying vec3 vTint;
void main(){vBary=barycentric;vPhase=iPhase;vTint=iTint;vNormal=normalize(normalMatrix*mat3(instanceMatrix)*normal);gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0);}`;
const shardFragment=/* glsl */`
varying vec3 vBary;varying vec3 vNormal;varying vec4 vPhase;varying vec3 vTint;
void main(){
  float facet=abs(dot(normalize(vNormal),normalize(vec3(.4,.8,.5))));
  float edge=min(vBary.x,min(vBary.y,vBary.z));
  float rim=1.0-smoothstep(0.0,max(.012,fwidth(edge)*1.2),edge);
  vec3 c=mix(vTint*.015,vTint*.16,pow(facet,3.0))+vTint*rim*(.4+facet*.7);
  gl_FragColor=vec4(c,clamp(vPhase.y,0.0,1.0));
}`;

/** Filled spatial forms and solid fragments, all pooled. No textures, randomness, timers or simulation writes. */
export class StepperSpatial {
  readonly tears:InstancedMesh;
  readonly shards:InstancedMesh;
  private phase:InstancedBufferAttribute;
  private tint:InstancedBufferAttribute;
  private shardPhase:InstancedBufferAttribute;
  private shardTint:InstancedBufferAttribute;
  private curveA=new InstancedBufferAttribute(new Float32Array(384*4),4).setUsage(DynamicDrawUsage);
  private curveB=new InstancedBufferAttribute(new Float32Array(384*4),4).setUsage(DynamicDrawUsage);
  private curveC=new InstancedBufferAttribute(new Float32Array(384*4),4).setUsage(DynamicDrawUsage);
  private matrix=new Matrix4();private basis=new Matrix4();private quaternion=new Quaternion();
  private position=new Vector3();private scale=new Vector3();private axis=new Vector3(0,1,0);
  private right=new Vector3();private up=new Vector3();private normal=new Vector3();
  constructor(private scene:Scene,name:string){
    const geo=foldGeometry();
    this.phase=new InstancedBufferAttribute(new Float32Array(384*4),4).setUsage(DynamicDrawUsage);
    this.tint=new InstancedBufferAttribute(new Float32Array(384*3),3).setUsage(DynamicDrawUsage);
    geo.setAttribute('iCurveA',this.curveA);geo.setAttribute('iCurveB',this.curveB);geo.setAttribute('iCurveC',this.curveC);
    geo.setAttribute('iPhase',this.phase);geo.setAttribute('iTint',this.tint);
    this.tears=new InstancedMesh(geo,new ShaderMaterial({vertexShader:vertex,fragmentShader:fragment,transparent:true,depthWrite:false,side:DoubleSide}),384);
    const shardGeo=new TetrahedronGeometry(1,0);
    const bary=new Float32Array(shardGeo.getAttribute('position').count*3);
    for(let i=0;i<bary.length/3;i++)bary[i*3+i%3]=1;
    shardGeo.setAttribute('barycentric',new Float32BufferAttribute(bary,3));
    this.shardPhase=new InstancedBufferAttribute(new Float32Array(512*4),4).setUsage(DynamicDrawUsage);
    this.shardTint=new InstancedBufferAttribute(new Float32Array(512*3),3).setUsage(DynamicDrawUsage);
    shardGeo.setAttribute('iPhase',this.shardPhase);shardGeo.setAttribute('iTint',this.shardTint);
    this.shards=new InstancedMesh(shardGeo,new ShaderMaterial({vertexShader:shardVertex,fragmentShader:shardFragment,transparent:true,depthWrite:false}),512);
    this.tears.name=`${name}-spatial-tears`;this.shards.name=`${name}-fragments`;
    for(const m of [this.tears,this.shards]){m.count=0;m.frustumCulled=false;m.instanceMatrix.setUsage(DynamicDrawUsage);m.renderOrder=3;scene.add(m);}
  }
  begin():void{this.tears.count=this.shards.count=0;}
  tear(x:number,y:number,z:number,heading:number,width:number,height:number,age:number,color:Color,seed:number,opacity=1):void{
    this.position.set(x,y,z);this.quaternion.setFromAxisAngle(this.axis,heading);this.scale.set(width/2,height/2,width/2);
    this.matrix.compose(this.position,this.quaternion,this.scale);this.add(age,color,seed,opacity,0);
  }
  blade(ax:number,ay:number,az:number,bx:number,by:number,bz:number,width:number,age:number,color:Color,seed:number,opacity=1,tilt=.8):void{
    this.right.set(bx-ax,by-ay,bz-az);const length=this.right.length();if(length<.01)return;this.right.multiplyScalar(1/length);
    this.up.set(0,1,0);if(Math.abs(this.right.y)>.98)this.up.set(0,0,1);
    this.normal.crossVectors(this.right,this.up).normalize();this.up.crossVectors(this.normal,this.right).normalize();
    this.quaternion.setFromAxisAngle(this.right,tilt);this.up.applyQuaternion(this.quaternion);this.normal.applyQuaternion(this.quaternion);
    this.basis.makeBasis(this.right,this.up,this.normal);this.quaternion.setFromRotationMatrix(this.basis);
    this.position.set((ax+bx)/2,(ay+by)/2,(az+bz)/2);this.scale.set(length/2,width,width);
    this.matrix.compose(this.position,this.quaternion,this.scale);this.add(age,color,seed,opacity,1);
  }
  /** One continuous curved volume; control point follows the actual ship choreography. */
  arc(ax:number,ay:number,az:number,cx:number,cy:number,cz:number,bx:number,by:number,bz:number,width:number,age:number,color:Color,seed:number,opacity=1,tilt=.5):void{
    const i=this.tears.count;if(i>=384||Math.hypot(ax-bx,ay-by,az-bz)<.01)return;
    this.matrix.identity();this.curveA.setXYZW(i,ax,ay,az,width);this.curveB.setXYZW(i,cx,cy,cz,tilt);this.curveC.setXYZW(i,bx,by,bz,0);
    this.add(age,color,seed,opacity,2);
  }
  private add(age:number,color:Color,seed:number,opacity:number,kind:number):void{
    const i=this.tears.count;if(i>=384)return;this.tears.setMatrixAt(i,this.matrix);this.phase.setXYZW(i,age,opacity,seed,kind);this.tint.setXYZ(i,color.r,color.g,color.b);this.tears.count++;
  }
  shard(x:number,y:number,z:number,spin:number,size:number,stretch:number,color:Color,opacity:number):void{
    const i=this.shards.count;if(i>=512)return;
    this.position.set(x,y,z);this.axis.set(.4,1,.3).normalize();this.quaternion.setFromAxisAngle(this.axis,spin);this.axis.set(0,1,0);
    this.scale.set(size,size*stretch,size*.35);this.matrix.compose(this.position,this.quaternion,this.scale);this.shards.setMatrixAt(i,this.matrix);
    this.shardPhase.setXYZW(i,0,opacity,0,0);this.shardTint.setXYZ(i,color.r,color.g,color.b);this.shards.count++;
  }
  end():void{
    for(const m of [this.tears,this.shards])m.instanceMatrix.needsUpdate=true;
    for(const attr of [this.phase,this.tint,this.shardPhase,this.shardTint,this.curveA,this.curveB,this.curveC])attr.needsUpdate=true;
  }
  dispose():void{for(const m of [this.tears,this.shards]){this.scene.remove(m);m.dispose();m.geometry.dispose();(m.material as ShaderMaterial).dispose();}}
}
