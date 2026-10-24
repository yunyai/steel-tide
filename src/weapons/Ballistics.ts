import { AIR_DENSITY, DEFAULT_SHELL_CD, GRAVITY, SHELL_TIME_SCALE, SIM_DT } from '../config';
import type { ShellSpec } from '../core/types';

// Exterior ballistics. Shells fly with quadratic drag + gravity using real muzzle
// velocities; time is compressed by SHELL_TIME_SCALE. Range tables are built with
// the exact integrator ShellSystem uses so the solver lands shells where aimed.

/** Real seconds integrated per simulation tick. */
export const SHELL_DT = SIM_DT * SHELL_TIME_SCALE;

export function dragK(shell: ShellSpec): number {
  const r = shell.caliber / 2000;
  const area = Math.PI * r * r;
  return (0.5 * AIR_DENSITY * (shell.cd ?? DEFAULT_SHELL_CD) * area) / shell.mass;
}

export interface RangeTable {
  elev: Float64Array;
  range: Float64Array;
  /** Game-time seconds of flight. */
  time: Float64Array;
  impactV: Float64Array;
  /** Angle of fall below horizontal, radians. */
  fall: Float64Array;
  count: number;
  maxRange: number;
}

/** One integration step, shared by the table builder and live shells. */
export function stepShell(
  s: { x: number; y: number; vx: number; vy: number },
  k: number,
  dt: number,
): void {
  const v = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
  s.vx += -k * v * s.vx * dt;
  s.vy += (-GRAVITY - k * v * s.vy) * dt;
  s.x += s.vx * dt;
  s.y += s.vy * dt;
}

const cache = new Map<string, RangeTable>();

export function getRangeTable(shell: ShellSpec, maxRange: number): RangeTable {
  const key = `${shell.caliber}|${shell.mass}|${shell.velocity}|${shell.cd ?? DEFAULT_SHELL_CD}|${maxRange}`;
  let t = cache.get(key);
  if (!t) {
    t = buildRangeTable(shell, maxRange);
    cache.set(key, t);
  }
  return t;
}

export function buildRangeTable(shell: ShellSpec, maxRange: number): RangeTable {
  const k = dragK(shell);
  const elev: number[] = [];
  const range: number[] = [];
  const time: number[] = [];
  const impactV: number[] = [];
  const fall: number[] = [];
  const stepDeg = 0.04;
  for (let deg = stepDeg; deg <= 45; deg += stepDeg) {
    const a = (deg * Math.PI) / 180;
    const s = { x: 0, y: 0, vx: shell.velocity * Math.cos(a), vy: shell.velocity * Math.sin(a) };
    let steps = 0;
    let px = 0;
    let py = 0;
    while (steps < 20000) {
      px = s.x;
      py = s.y;
      stepShell(s, k, SHELL_DT);
      steps++;
      if (s.y < 0 && s.vy < 0) break;
    }
    // Interpolate the water crossing within the last step.
    const f = py / (py - s.y);
    const x = px + (s.x - px) * f;
    const tReal = (steps - 1 + f) * SHELL_DT;
    elev.push(a);
    range.push(x);
    time.push(tReal / SHELL_TIME_SCALE);
    impactV.push(Math.sqrt(s.vx * s.vx + s.vy * s.vy));
    fall.push(Math.atan2(-s.vy, s.vx));
    if (x >= maxRange * 1.03) break;
  }
  return {
    elev: Float64Array.from(elev),
    range: Float64Array.from(range),
    time: Float64Array.from(time),
    impactV: Float64Array.from(impactV),
    fall: Float64Array.from(fall),
    count: elev.length,
    maxRange: Math.min(maxRange, range[range.length - 1]),
  };
}

export interface FiringSolution {
  elevation: number;
  time: number;
  impactV: number;
  fall: number;
  range: number;
}

/** Elevation and flight data needed to land a shell at horizontal distance `d`. */
export function solve(table: RangeTable, d: number): FiringSolution {
  const r = Math.max(0, Math.min(d, table.maxRange));
  const R = table.range;
  let lo = 0;
  let hi = table.count - 1;
  if (r <= R[0]) {
    const f = r / Math.max(1, R[0]);
    return {
      elevation: table.elev[0] * f,
      time: table.time[0] * f,
      impactV: table.impactV[0],
      fall: table.fall[0],
      range: r,
    };
  }
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (R[mid] < r) lo = mid;
    else hi = mid;
  }
  const f = (r - R[lo]) / Math.max(1e-6, R[hi] - R[lo]);
  const mix = (a: Float64Array) => a[lo] + (a[hi] - a[lo]) * f;
  return { elevation: mix(table.elev), time: mix(table.time), impactV: mix(table.impactV), fall: mix(table.fall), range: r };
}

/** AP penetration scales with impact velocity (de Marre-style exponent). */
export function penAtVelocity(shell: ShellSpec, v: number): number {
  return shell.pen * Math.pow(Math.max(0, v) / shell.velocity, 1.43);
}
