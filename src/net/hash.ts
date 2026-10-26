import type { Game } from '../core/Game';

// A cheap fingerprint of the battle. Lockstep peers compare it every couple of seconds: any
// difference in any bit of a position or a hit point total means their battles have parted.

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

function mix(h: number, x: number): number {
  f64[0] = x;
  h = Math.imul(h ^ u32[0], 16777619);
  return Math.imul(h ^ u32[1], 16777619);
}

export function stateHash(g: Game): number {
  let h = 2166136261 | 0;
  h = mix(h, g.time);
  h = mix(h, g.score[0]);
  h = mix(h, g.score[1]);
  for (const s of g.ships) {
    h = mix(h, s.id);
    h = mix(h, s.pos.x);
    h = mix(h, s.pos.y);
    h = mix(h, s.pos.z);
    h = mix(h, s.heading);
    h = mix(h, s.speed);
    h = mix(h, s.hp);
    h = mix(h, s.shield);
    h = mix(h, s.alive ? 1 : 0);
    h = mix(h, s.form ? 1 : 0);
    if (s.stepper) {
      const a=s.stepper;
      for(const n of [a.copy?1:0,a.slot,a.ownerId,a.until,a.dodgeReady,a.phaseUntil,a.sideUntil,a.broadUntil,a.broadTarget,...a.copies]) h=mix(h,n);
      for(const st of s.skills) for(const n of [st.cooldown,st.time,st.meter,st.active?1:0]) h=mix(h,n);
      h=mix(h,a.flicker?1:0);h=mix(h,a.rush?1:0);
      h=mix(h,a.cross?1:0);h=mix(h,a.repair?1:0);h=mix(h,a.repairInterruptedUntil);
      if(a.repair)h=mix(h,a.repair.remaining);
      if(a.cross)for(const n of [a.cross.x,a.cross.z,a.cross.elapsed,a.cross.count,a.cross.jumps,a.cross.finish.x,a.cross.finish.z,a.cross.finish.heading])h=mix(h,n);
      if(a.flicker)for(const n of [a.flicker.x,a.flicker.z,a.flicker.elapsed,a.flicker.count])h=mix(h,n);
      if(a.rush)for(const n of [a.rush.x0,a.rush.z0,a.rush.x1,a.rush.z1,a.rush.elapsed,...a.rush.hit])h=mix(h,n);
    }
  }
  h = mix(h, g.shells.shells.length);
  h = mix(h, g.torps.torps.length);
  h = mix(h, g.missiles.missiles.length);
  h = mix(h, g.air.squadrons.length);
  return h >>> 0;
}
