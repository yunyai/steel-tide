import { BufferGeometry, Color, DoubleSide, DynamicDrawUsage, Float32BufferAttribute, Mesh, ShaderMaterial, type Scene } from 'three';
import type { Game } from '../core/Game';
import { quality } from './Quality';
import { waveHeight } from '../world/Waves';

const MAX=24576,FOAM=new Color(0xb8dce0);
/** Wave-conforming strips, with a raised mist crest. Each triangle is clipped away from land. */
export class StepperWater {
  readonly mesh:Mesh<BufferGeometry,ShaderMaterial>;
  private position=new Float32BufferAttribute(new Float32Array(MAX*3),3).setUsage(DynamicDrawUsage);
  private color=new Float32BufferAttribute(new Float32Array(MAX*4),4).setUsage(DynamicDrawUsage);
  private uv=new Float32BufferAttribute(new Float32Array(MAX*2),2).setUsage(DynamicDrawUsage);
  private count=0;
  constructor(scene:Scene,private game:Game){
    const g=new BufferGeometry();g.setAttribute('position',this.position);g.setAttribute('aColor',this.color);g.setAttribute('uv',this.uv);g.setDrawRange(0,0);
    const m=new ShaderMaterial({transparent:true,depthWrite:false,side:DoubleSide,
      vertexShader:`attribute vec4 aColor;varying vec4 vColor;varying vec2 vUv;void main(){vColor=aColor;vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader:`varying vec4 vColor;varying vec2 vUv;void main(){float grain=.65+.35*sin(vUv.x*173.0+sin(vUv.x*37.0)*3.0);float a=sin(vUv.y*3.14159265)*vColor.a*grain;if(a<.005)discard;gl_FragColor=vec4(vColor.rgb,a);#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}`.replace(';#include',';\n#include'),
    });this.mesh=new Mesh(g,m);this.mesh.name='stepper-displaced-water';this.mesh.frustumCulled=false;this.mesh.renderOrder=2;scene.add(this.mesh);
  }
  begin():void{this.count=0;}
  add(x:number,z:number,h:number,age:number,life:number,strength=1,scale=1):void{
    const t=Math.max(0,Math.min(1,age/life)),fade=Math.sin(Math.PI*Math.sqrt(t))*(1-t)*strength;
    if(fade<.005||this.game.map.heightAt(x,z)>0)return;
    const fx=Math.sin(h),fz=-Math.cos(h),rx=Math.cos(h),rz=Math.sin(h),segments=quality().particles>=1?32:16;
    const vertex=(a:number,v:number):[number,number,number,number,number]=>{
      const along=Math.cos(a)*(180+t*130+v*28)*scale,across=Math.sin(a)*(28+t*150+v*28)*scale;
      const px=x+fx*along+rx*across,pz=z+fz*along+rz*across;
      const py=waveHeight(px,pz,this.game.renderTime)+1.5+Math.sin(v*Math.PI)*8*(1-t)*scale;
      return[px,py,pz,a/(Math.PI*2),v];
    };
    for(let i=0;i<segments;i++)for(let j=0;j<3;j++){
      const a=i*Math.PI*2/segments,b=(i+1)*Math.PI*2/segments,v=j/3,w=(j+1)/3;
      const p=vertex(a,v),q=vertex(b,v),r=vertex(a,w),s=vertex(b,w);
      for(const tri of [[p,q,r],[q,s,r]]){
        if(this.count+3>MAX)return;
        if(tri.some(p=>this.game.map.heightAt(p[0],p[2])>p[1]-3))continue;
        for(const p of tri){this.position.setXYZ(this.count,p[0],p[1],p[2]);this.color.setXYZW(this.count,FOAM.r,FOAM.g,FOAM.b,fade*.5);this.uv.setXY(this.count,p[3],p[4]);this.count++;}
      }
    }
  }
  end():void{this.mesh.geometry.setDrawRange(0,this.count);for(const a of [this.position,this.color,this.uv])a.needsUpdate=true;}
  dispose():void{this.mesh.removeFromParent();this.mesh.geometry.dispose();this.mesh.material.dispose();}
}
