import type { Vector3 } from 'three';
import { WALL_HEIGHT } from '../config';
import type { Game } from '../core/Game';
import type { Team } from '../core/types';
import { segmentsCross } from '../core/math';

/** Presentation only: terrain and solid ice walls hide name/health markers, even with sonar. */
export function cameraOccluded(game: Game, camera: Pick<Vector3, 'x' | 'y' | 'z'>, point: Pick<Vector3, 'x' | 'y' | 'z'>, _team: Team): boolean {
  const d = Math.hypot(point.x - camera.x, point.z - camera.z);
  const n = Math.max(1, Math.ceil(d / 20));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const y = camera.y + (point.y - camera.y) * t;
    if (game.map.heightAt(camera.x + (point.x - camera.x) * t, camera.z + (point.z - camera.z) * t) > Math.max(0, y)) return true;
  }
  return game.walls.some(w => {
    if (w.age >= w.life) return false;
    const t = segmentsCross(camera.x, camera.z, point.x, point.z, w.x0, w.z0, w.x1, w.z1);
    return t >= 0 && camera.y + (point.y - camera.y) * t < WALL_HEIGHT;
  });
}
