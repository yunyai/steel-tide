import { clamp } from '../../core/math';
import { FLATTEN_HEAVY, KMH } from './config';
import type { GroundGame } from './GroundGame';
import { blocksVehicles, flattenMass, type Prop, Props } from './props';
import { MAT, MAT_GRIP, MAT_SPEED } from './terrain';
import type { Vehicle } from './Vehicle';

// Locomotion: how throttle and steering move a hull over the ground. Tracks pivot on the spot,
// wheels turn on a radius, hover sleds keep sliding. Slopes, mud and snow slow everything but
// hover; ice takes the grip away. Each type is a function so walkers can join later.

const DEG = Math.PI / 180;
const nearProps: Prop[] = [];

/** Lateral grip: how fast sideways drift dies (per second, before the ground's grip). */
const SIDE_GRIP = { tracks: 10, wheels: 7, hover: 1.1 };

export function driveStep(v: Vehicle, g: GroundGame, dt: number): void {
  const d = v.spec.drive;
  const t = g.terrain;
  const m = v.mods;
  const pose = v.pose;
  const mat = t.materialAt(pose.x, pose.z);
  const hover = d.type === 'hover';
  const matSpeed = hover ? 1 : MAT_SPEED[mat] || 0.6;
  const grip = hover ? 1 : MAT_GRIP[mat] || 1;
  const immobile = v.crits.tracks > 0 || m.rooted || m.stunned;
  const maxF = d.maxSpeed * KMH * m.speedMul * matSpeed;
  const maxR = (m.fastReverse ? d.maxSpeed : d.reverse) * KMH * m.speedMul * matSpeed;

  let drive = immobile ? 0 : clamp(v.control.drive, -1, 1);
  let steer = immobile ? 0 : clamp(v.control.steer, -1, 1);
  if (m.feared) {
    // Flee: drive away from the source of the fear.
    const want = Math.atan2(pose.x - m.fearX, -(pose.z - m.fearZ));
    const off = Math.atan2(Math.sin(want - v.heading), Math.cos(want - v.heading));
    steer = clamp(off * 2, -1, 1);
    drive = 1;
  }

  // Throttle toward the wanted speed; slopes slow the climb and speed the descent.
  const grade = pose.f[1];
  let target = drive >= 0 ? drive * maxF : drive * maxR;
  if (!hover && target !== 0) target *= clamp(1 - grade * Math.sign(target) * 1.8, 0.2, 1.15);
  const braking = target === 0 || Math.sign(target) !== Math.sign(v.speed);
  const accel = d.accel * (m.accelMul ?? 1) * (braking ? 2.2 : 1) * (hover ? 1 : grip);
  if (v.speed < target) v.speed = Math.min(target, v.speed + accel * dt);
  else v.speed = Math.max(target, v.speed - accel * dt);

  // Steering.
  let rate = d.turnRate * DEG * m.turnMul;
  if (d.type === 'wheels') rate *= clamp(Math.abs(v.speed) / Math.max(1, maxF * 0.25), 0, 1) * (v.speed < 0 ? -1 : 1);
  else rate *= 1 - 0.35 * clamp(Math.abs(v.speed) / Math.max(1, maxF), 0, 1);
  const turn = steer * rate;
  v.yawRate = turn;

  // Velocity in the world before the turn, then re-split along the new heading: what the
  // ground does not grip keeps going the old way (hover, ice).
  const fx = Math.sin(v.heading);
  const fz = -Math.cos(v.heading);
  const vx = fx * v.speed + -fz * v.side;
  const vz = fz * v.speed + fx * v.side;
  v.heading += turn * dt;
  const nfx = Math.sin(v.heading);
  const nfz = -Math.cos(v.heading);
  v.speed = vx * nfx + vz * nfz;
  v.side = vx * -nfz + vz * nfx;
  v.side *= Math.exp(-dt * SIDE_GRIP[d.type] * (hover ? 1 : grip));
  if (m.knockX || m.knockZ) {
    // A shove from a blast or a ram, spent over a few steps.
    v.side += (m.knockX * -nfz + m.knockZ * nfx) * dt * 6;
    v.speed += (m.knockX * nfx + m.knockZ * nfz) * dt * 6;
  }

  // Move, unless the way ahead is too steep, deep water or off the map.
  const wx = nfx * v.speed + -nfz * v.side;
  const wz = nfz * v.speed + nfx * v.side;
  let nx = pose.x + wx * dt;
  let nz = pose.z + wz * dt;
  const sp = Math.hypot(wx, wz);
  if (sp > 0.05) {
    const ux = wx / sp;
    const uz = wz / sp;
    const reach = v.spec.size.length / 2 + 1;
    const px = nx + ux * reach;
    const pz = nz + uz * reach;
    const rise = t.heightAt(px, pz) - t.heightAt(nx, nz);
    const tooSteep = !hover && rise / reach > Math.tan(d.climbDeg * DEG) && !m.unstoppable;
    const wet = !hover && t.materialAt(px, pz) === MAT.water;
    if (tooSteep || wet) {
      nx = pose.x;
      nz = pose.z;
      v.speed *= -0.1;
      v.side = 0;
    }
  }
  const lim = t.half - 24;
  pose.x = clamp(nx, -lim, lim);
  pose.z = clamp(nz, -lim, lim);

  collideProps(v, g);
  settle(v, g);
}

/** Push the hull out of houses and rocks; drive through what its weight can flatten. */
function collideProps(v: Vehicle, g: GroundGame): void {
  const s = v.spec.size;
  const pose = v.pose;
  const r = s.width * 0.55;
  const fx = Math.sin(v.heading);
  const fz = -Math.cos(v.heading);
  const near = g.props.near(pose.x, pose.z, s.length, nearProps);
  for (const p of near) {
    if (!blocksVehicles(p) || p.y + p.h < pose.y + 0.4) continue;
    for (const k of [-0.32, 0, 0.32]) {
      const cx = pose.x + fx * s.length * k;
      const cz = pose.z + fz * s.length * k;
      const push = Props.circlePush(p, cx, cz, r);
      if (!push) continue;
      // Titans and the unstoppable plough through everything short of bedrock.
      const need = v.mods.unstoppable || v.titan ? (p.kind === 'rock' ? Infinity : 0) : flattenMass(p);
      if (v.mass >= need && Math.abs(v.speed) > 0.8) {
        g.flattenProp(p, v);
        v.speed *= v.mass >= FLATTEN_HEAVY * 2 || v.mods.unstoppable || v.titan ? 0.97 : 0.8;
        break;
      }
      pose.x += push.px;
      pose.z += push.pz;
      // Lose the part of the motion that runs into the face.
      const pl = Math.hypot(push.px, push.pz) || 1;
      const nx = push.px / pl;
      const nz = push.pz / pl;
      const wx = fx * v.speed + -fz * v.side;
      const wz = fz * v.speed + fx * v.side;
      const into = wx * nx + wz * nz;
      if (into < 0) {
        const ax = wx - nx * into;
        const az = wz - nz * into;
        v.speed = ax * fx + az * fz;
        v.side = ax * -fz + az * fx;
      }
    }
  }
}

/** Sit the hull on the ground: height from the four corners, pitch and roll from their slopes. */
export function settle(v: Vehicle, g: GroundGame): void {
  const t = g.terrain;
  const s = v.spec.size;
  const pose = v.pose;
  const fx = Math.sin(v.heading);
  const fz = -Math.cos(v.heading);
  const rx = -fz;
  const rz = fx;
  const hl = s.length * 0.42;
  const hw = s.width * 0.42;
  const hover = v.spec.drive.type === 'hover';
  const ground = (x: number, z: number) => (hover ? t.surfaceAt(x, z) : t.heightAt(x, z));
  const fl = ground(pose.x + fx * hl - rx * hw, pose.z + fz * hl - rz * hw);
  const fr = ground(pose.x + fx * hl + rx * hw, pose.z + fz * hl + rz * hw);
  const bl = ground(pose.x - fx * hl - rx * hw, pose.z - fz * hl - rz * hw);
  const br = ground(pose.x - fx * hl + rx * hw, pose.z - fz * hl + rz * hw);
  const front = (fl + fr) / 2;
  const back = (bl + br) / 2;
  const left = (fl + bl) / 2;
  const right = (fr + br) / 2;
  v.pitch = Math.atan2(front - back, hl * 2);
  v.roll = Math.atan2(left - right, hw * 2);
  pose.y = Math.max((fl + fr + bl + br) / 4, ground(pose.x, pose.z) - 0.3) + (hover ? 0.7 + Math.sin(g.time * 2.1 + v.id) * 0.08 : 0);
  v.updateAxes();
}
