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
  }
  h = mix(h, g.shells.shells.length);
  h = mix(h, g.torps.torps.length);
  h = mix(h, g.missiles.missiles.length);
  h = mix(h, g.air.squadrons.length);
  return h >>> 0;
}
