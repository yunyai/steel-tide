import type { Ship } from "../../ships/Ship";
import { canTrack } from "../../core/Targeting";
import { aimPoint } from "../kit";
import { MAP_HALF } from "../../config";
export function miscTarget(s: Ship, range = 5000): Ship | null {
  const p = aimPoint(s, range);
  return (
    s.game.ships
      .filter(
        (t) =>
          t.team !== s.team &&
          canTrack(s, t) &&
          Math.hypot(t.pos.x - s.pos.x, t.pos.z - s.pos.z) <= range,
      )
      .sort(
        (a, b) =>
          Math.hypot(a.pos.x - p.x, a.pos.z - p.z) -
            Math.hypot(b.pos.x - p.x, b.pos.z - p.z) || a.id - b.id,
      )[0] ?? null
  );
}
/** A hull that forced moves leave alone: braced against knockback, unstoppable or CC-immune. */
export function immovable(t: Ship): boolean {
  return !!t.trait?.knockImmune || t.mods.knockImmune || t.mods.unstoppable || t.mods.ccImmune;
}
export function moveSafe(s: Ship, x: number, z: number): boolean {
  if (Math.abs(x) > MAP_HALF - 250 || Math.abs(z) > MAP_HALF - 250)
    return false;
  const r = Math.max(s.spec.beam, s.spec.length) * 0.55;
  for (const [dx, dz] of [
    [0, 0],
    [r, 0],
    [-r, 0],
    [0, r],
    [0, -r],
  ])
    if (s.game.map.heightAt(x + dx, z + dz) > -s.spec.draft - 2) return false;
  s.pos.x = x;
  s.pos.z = z;
  return true;
}
