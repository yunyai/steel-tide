import type { GameMap } from './GameMap';

/** The nearest spot to x, z with deep water around a hull, spiralling inward from it. */
export function findOpenWater(map: GameMap, x: number, z: number): { x: number; z: number } {
  for (let i = 0; i < 24; i++) {
    const k = 1 - i * 0.03;
    const a = i * 0.7;
    const px = x * k + Math.cos(a) * i * 40;
    const pz = z * k + Math.sin(a) * i * 40;
    if (map.heightAt(px, pz) < -12 && map.heightAt(px + 200, pz) < -6 && map.heightAt(px - 200, pz) < -6) return { x: px, z: pz };
  }
  return { x: x * 0.7, z: z * 0.7 };
}
