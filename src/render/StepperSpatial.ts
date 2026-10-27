import { Color, DoubleSide, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, TetrahedronGeometry, Float32BufferAttribute, PlaneGeometry, Quaternion, ShaderMaterial, Vector3, type Scene } from 'three';

const vertex=/* glsl */`
attribute vec4 iPhase;
attribute vec3 iTint;
varying vec2 vUv;
varying vec4 vPhase;
varying vec3 vTint;
void main(){
  vUv=uv;vPhase=iPhase;vTint=iTint;
  gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0);
}`;
const fragment=/* glsl */`
varying vec2 vUv;
varying vec4 vPhase;
varying vec3 vTint;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
void main(){
  vec2 p=vUv*2.0-1.0;
  float age=clamp(vPhase.x,0.0,1.0),seed=vPhase.z;
  float fade=(1.0-smoothstep(.45,1.0,age))*smoothstep(0.0,.035,age);
  float grain=noise(p*vec2(13.0,21.0)+seed);
  float d;
  if(vPhase.w<.5){
    // A torn opening: a dark interior, irregular lips and a soft charged atmosphere.
    float taper=pow(max(0.0,1.0-p.y*p.y),.7);
    float bend=(sin(p.y*4.5+seed)*.13+(grain-.5)*.055)*taper;
    float open=.15+.85*sin(pow(age,.65)*3.14159265);
    d=abs(p.x-bend)-taper*(.45+(grain-.5)*.07)*open;
  }else{
    // Broad curved cutting surface, with a hot leading edge and a trailing energy veil.
    float taper=max(0.0,1.0-p.x*p.x);
    float curve=.5*taper-.2;
    d=abs(p.y-curve)-(taper*(.26+(grain-.5)*.035));
    fade*=1.0-smoothstep(.72,1.0,abs(p.x));
  }
  float aa=max(.006,fwidth(d)*1.2);
  float inside=1.0-smoothstep(-aa,aa,d);
  float lip=exp(-abs(d)*38.0),aura=exp(-abs(d)*10.0);
  vec3 voidColor=mix(vec3(.008,.005,.025),vTint*.09,grain);
  vec3 energy=vTint*(.65+grain*.35);
  vec3 body=vPhase.w<.5?voidColor:mix(energy*.22,energy*.6,smoothstep(-.25,0.0,d));
  vec3 color=body+vTint*lip*.9+vec3(1.1,1.05,1.2)*pow(lip,3.0)+vTint*aura*.12;
  float alpha=(inside*(vPhase.w<.5?.88:.58)+aura*.28)*fade*vPhase.y;
  alpha*=1.0-smoothstep(.92,1.0,max(abs(p.x),abs(p.y)));
  if(alpha<.005)discard;
  gl_FragColor=vec4(color,clamp(alpha,0.0,1.0));
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
  private matrix=new Matrix4();private basis=new Matrix4();private quaternion=new Quaternion();
  private position=new Vector3();private scale=new Vector3();private axis=new Vector3(0,1,0);
  private right=new Vector3();private up=new Vector3();private normal=new Vector3();
  constructor(private scene:Scene,name:string){
    const geo=new PlaneGeometry(2,2);
    this.phase=new InstancedBufferAttribute(new Float32Array(384*4),4).setUsage(DynamicDrawUsage);
    this.tint=new InstancedBufferAttribute(new Float32Array(384*3),3).setUsage(DynamicDrawUsage);
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
    this.position.set(x,y,z);this.quaternion.setFromAxisAngle(this.axis,heading);this.scale.set(width/2,height/2,1);
    this.matrix.compose(this.position,this.quaternion,this.scale);this.add(age,color,seed,opacity,0);
  }
  blade(ax:number,ay:number,az:number,bx:number,by:number,bz:number,width:number,age:number,color:Color,seed:number,opacity=1,tilt=.8):void{
    this.right.set(bx-ax,by-ay,bz-az);const length=this.right.length();if(length<.01)return;this.right.multiplyScalar(1/length);
    this.up.set(0,1,0);if(Math.abs(this.right.y)>.98)this.up.set(0,0,1);
    this.normal.crossVectors(this.right,this.up).normalize();this.up.crossVectors(this.normal,this.right).normalize();
    this.quaternion.setFromAxisAngle(this.right,tilt);this.up.applyQuaternion(this.quaternion);this.normal.applyQuaternion(this.quaternion);
    this.basis.makeBasis(this.right,this.up,this.normal);this.quaternion.setFromRotationMatrix(this.basis);
    this.position.set((ax+bx)/2,(ay+by)/2,(az+bz)/2);this.scale.set(length/2,width,1);
    this.matrix.compose(this.position,this.quaternion,this.scale);this.add(age,color,seed,opacity,1);
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
    for(const attr of [this.phase,this.tint,this.shardPhase,this.shardTint])attr.needsUpdate=true;
  }
  dispose():void{for(const m of [this.tears,this.shards]){this.scene.remove(m);m.dispose();m.geometry.dispose();(m.material as ShaderMaterial).dispose();}}
}
