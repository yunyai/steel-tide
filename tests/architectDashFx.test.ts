import { expect, it } from 'vitest';
import { Scene } from 'three';
import { emptyGame, place, run } from './helpers';
import { defaultLoadout } from '../src/data/architectLoadout';
import { setArchitectLoadout } from '../src/skills/misc/ArchitectRuntime';
import { ArchitectDashFx } from '../src/render/ArchitectDashFx';
import { BK } from '../src/render/BurstParticles';
import { stateHash } from '../src/net/hash';

function arena(){
 const g=emptyGame('open',713,'freeplay');g.map.heightAt=()=>-100;
 const s=place(g,'architect',0,0,1500),scene=new Scene(),fx=new ArchitectDashFx(scene,g);
 s.throttle=2;s.speed=0;s.secondaries=[];const picks=defaultLoadout();picks[0]={type:'vector',skill:0};setArchitectLoadout(s,picks);
 s.control.aimX=2000;s.control.aimZ=1500;
 return {g,s,scene,fx};
}
const kinds=(fx:ArchitectDashFx)=>{const n=Array(9).fill(0);for(const b of Object.values(fx.particles.batches))for(let i=0;i<b.count;i++)n[b.kindAt(i)]++;return n;};

it('bursts on launch, shows downwash in flight and a shockwave at the landing radius, then clears',()=>{
 const {g,s,fx,scene}=arena(),shakes:number[]=[];fx.onShake=(ship,amount)=>{if(ship===s)shakes.push(amount);};fx.update(0,[s]);
 const radii:number[]=[];g.events.on('architectDash',e=>{if(e.phase==='land')radii.push(e.radius);});
 s.control.architectHullDash=true;run(g,1/30);g.interpolate();
 const before=stateHash(g);fx.prepare(0);expect(stateHash(g)).toBe(before);
 expect(kinds(fx)[BK.Spray]).toBeGreaterThan(5);expect(kinds(fx)[BK.Ring]).toBeGreaterThan(0);expect(s.architect!.drive?.moving).toBe(true);
 run(g,.6);g.interpolate();expect(radii).toHaveLength(1);fx.update(0,[s]);fx.prepare(0);
 // Some landing ring sits exactly on the simulated damage radius.
 const flat=fx.particles.batches.flat;let exact=false;for(let i=0;i<flat.count;i++)if(flat.kindAt(i)===BK.Ring&&Math.abs(flat.misc.getX(i)*.43-radii[0])<1e-3)exact=true;
 expect(exact).toBe(true);expect(shakes).toHaveLength(2);expect(shakes[1]).toBeGreaterThan(shakes[0]);
 run(g,1.5);fx.update(0,[s]);fx.prepare(0);expect(fx.count).toBe(0);
 for(const b of Object.values(fx.particles.batches))expect(b.mesh.visible).toBe(false);
 fx.dispose();expect(scene.children).toHaveLength(0);
});

it('conceals a hidden dash from the enemy viewport and never shakes other captains',()=>{
 const {g,s,fx}=arena(),shakes:unknown[]=[];fx.onShake=(ship)=>shakes.push(ship);fx.update(0,[]);
 s.control.architectHullDash=true;run(g,1/30);s.mods.untargetable=true;
 fx.prepare(1);expect(fx.count).toBe(0);fx.prepare(0);expect(fx.count).toBeGreaterThan(0);expect(shakes).toHaveLength(0);fx.dispose();
});
