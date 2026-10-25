import type { GroundGame } from './GroundGame';

// A cheap fingerprint of a ground battle for lockstep peers: positions, hit points, the props
// that fell and the rounds in the air. Any difference means their battles have parted.

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

function mix(h: number, x: number): number {
  f64[0] = x;
  h = Math.imul(h ^ u32[0], 16777619);
  return Math.imul(h ^ u32[1], 16777619);
}

export function groundStateHash(g: GroundGame): number {
  let h = 2166136261 | 0;
  h = mix(h, g.time);
  h = mix(h, g.score[0]);
  h = mix(h, g.score[1]);
  for (const v of g.vehicles) {
    h = mix(h, v.id);
    h = mix(h, v.x);
    h = mix(h, v.y);
    h = mix(h, v.z);
    h = mix(h, v.heading);
    h = mix(h, v.speed);
    h = mix(h, v.turretYaw);
    h = mix(h, v.hp);
    h = mix(h, v.shield);
    h = mix(h, v.alive ? 1 : 0);
  }
  for (const p of g.props.list) {
    if (p.state === 0 && p.hp === p.maxHp) continue;
    h = mix(h, p.id);
    h = mix(h, p.state);
    h = mix(h, p.hp);
  }
  for (const c of g.caps) h = mix(h, c.owner * 7 + c.progress);
  h = mix(h, g.shells.list.length);
  h = mix(h, g.missiles.list.length);
  h = mix(h, g.strikes.list.length);
  h = mix(h, g.terrain.version);
  return h >>> 0;
}
