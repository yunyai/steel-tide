import { Lockstep } from '../src/net/Lockstep';
import { describe, expect, it } from 'vitest';
import { emptyGame, place, run } from './helpers';
import { draftOrders, TurnApplier } from '../src/net/navalTurns';
import { navalRules } from '../server/rules';
import { emptyControl } from '../src/ships/Ship';

describe('elevated naval aiming', () => {
  it('keeps legacy continuous orders unchanged and carries optional height', () => {
    const c=emptyControl();c.aimX=100;c.aimZ=200;
    expect(draftOrders(c)[0]).toHaveLength(5);
    c.aimY=153.123;
    expect(draftOrders(c)[0]).toEqual([0,100,200,0,-1,153.12]);
    expect(navalRules.cleanContinuous([0,100,200,1,-1,153.12])).toEqual([0,100,200,1,-1,153.12]);
    expect(navalRules.cleanContinuous([0,100,200,0,-1,NaN])).toBeNull();
    expect(navalRules.holdFire([0,100,200,1,-1,153.12])[5]).toBe(153.12);
  });
  it('applies height in lockstep and clears it on later legacy orders', () => {
    const g=emptyGame('open',7,'freeplay');const s=place(g,'iowa',0,0,0);
    g.fleet.push(s);
    const sim=new TurnApplier(g);
    sim.applyTick({k:0,p:[[0,[0,0,-1500,0,-1,150]]]},0);
    expect(s.control.aimY).toBe(150);
    sim.applyTick({k:1,p:[[0,[0,0,-1500,0,-1]]]},0);
    expect(s.control.aimY).toBeUndefined();
  });
  for(const flat of [0,3]) it(`hits actual elevated hulls with ${flat?'straight':'ballistic'} shots`, () => {
    const g=emptyGame('open',7,'freeplay');const s=place(g,'iowa',0,0,0);const t=place(g,'iowa',1,0,-1500,Math.PI/2);
    s.secondaries.length=t.secondaries.length=0;s.throttle=t.throttle=2;s.speed=t.speed=0;
    t.pos.y=150;t.prevPos.copy(t.pos);t.renderPos.copy(t.pos);
    g.shells.fire(s,{ammo:'AP',spec:s.spec.main!.ap!,table:s.tableFor('AP')!,fromX:0,fromY:20,fromZ:0,toX:0,toY:154,toZ:-1500,dmgMul:1,guaranteedFire:false,railgun:false,flat});
    run(g,5);
    expect(t.stats.received).toBeGreaterThan(0);
  });
});

it('sends removal of optional height immediately rather than waiting for a heartbeat',()=>{
  const sent:unknown[]=[];
  const link=new Lockstep({applyTick(){},hash(){return 0;},interpolate(){}},m=>sent.push(m));
  link.sendOrders([0,0,-1500,0,-1,150],null,0);
  link.sendOrders([0,0,-1500,0,-1],null,1);
  expect(sent).toHaveLength(2);
});
it('guided missiles strike elevated hulls at their actual altitude',()=>{
  const g=emptyGame('open',7,'freeplay'),s=place(g,'iowa',0,0,0),t=place(g,'iowa',1,0,-1500,Math.PI/2);
  s.secondaries.length=t.secondaries.length=0;s.throttle=t.throttle=2;s.speed=t.speed=0;
  t.pos.y=150;t.prevPos.copy(t.pos);t.renderPos.copy(t.pos);
  const heights:number[]=[];g.events.on('shellHit',e=>{if(e.target===t&&e.outcome==='missile')heights.push(e.y);});
  g.missiles.launch(s,0,-1500,0,5000,{target:t,profile:'cruise',uninterceptable:true});run(g,15);
  expect(heights.length).toBeGreaterThan(0);expect(heights[0]).toBeGreaterThan(130);
});
it('airborne missile explosions do not hit a surface hull outside their vertical blast radius',()=>{
  const g=emptyGame('open',7,'freeplay'),s=place(g,'iowa',0,0,0),t=place(g,'iowa',1,0,-1500);
  s.secondaries.length=t.secondaries.length=0;
  const m=g.missiles.launch(s,0,-1500,0,5000,{blast:70,from:{x:0,y:154,z:-1500}});
  (g.missiles as unknown as {detonate(value:typeof m):void}).detonate(m);
  expect(t.stats.received).toBe(0);
});
