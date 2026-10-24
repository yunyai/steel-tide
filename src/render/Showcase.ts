import { PerspectiveCamera, Scene, Vector2, type WebGLRenderer } from 'three';
import type { ShipSpec } from '../core/types';
import { MAP_BY_ID } from '../world/GameMap';
import { Environment } from './Environment';
import { Ocean } from './Ocean';
import { ShipView } from './ShipModel';

// Menu backdrop: one ship riding the swell at dusk under a slowly orbiting camera.

export class Showcase {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(40, 1, 1, 42000);
  private env: Environment;
  private size = new Vector2();
  private ocean: Ocean;
  private view: ShipView | null = null;
  private spec: ShipSpec | null = null;
  private time = 0;
  private orbit = 0.6;
  /** Horizontal offset of the ship on screen (-1..1), so UI panels don't cover it. */
  offset = 0.25;

  constructor(gl: WebGLRenderer) {
    this.env = new Environment(this.scene, MAP_BY_ID.dusk);
    this.env.bake(gl);
    this.ocean = new Ocean(this.env.look, this.env.sunDir, this.env.skyCube);
    this.scene.add(this.ocean.mesh);
  }

  get exposure(): number {
    return this.env.look.exposure;
  }

  setShip(spec: ShipSpec): void {
    if (this.spec === spec) return;
    this.spec = spec;
    if (this.view) {
      this.scene.remove(this.view.root);
      this.view.dispose();
    }
    this.view = new ShipView(spec);
    this.view.root.rotation.order = 'YZX';
    this.view.root.rotation.y = Math.PI / 2;
    this.scene.add(this.view.root);
  }

  render(gl: WebGLRenderer, dt: number): void {
    this.time += dt;
    this.orbit += dt * 0.05;
    const spec = this.spec;
    if (!spec || !this.view) return;
    this.view.pose(this.time);
    const L = spec.length;
    const r = L * 1.45 + 50;
    const cx = Math.cos(this.orbit) * r;
    const cz = Math.sin(this.orbit) * r;
    this.camera.position.set(cx, L * 0.16 + 12, cz);
    this.camera.lookAt(0, spec.freeboard + 4, 0);
    // Shift the framing sideways so the ship sits clear of the menu panels.
    this.camera.setViewOffset(1000, 1000, -this.offset * 500, 0, 1000, 1000);
    this.ocean.follow(this.camera);
    this.ocean.update(this.time);
    this.env.update(this.time);
    this.env.focus(0, 0);
    gl.toneMappingExposure = this.env.look.exposure;
    const c = gl.getSize(this.size);
    gl.setViewport(0, 0, c.x, c.y);
    this.camera.aspect = c.x / Math.max(1, c.y);
    this.camera.updateProjectionMatrix();
    gl.clear();
    gl.render(this.scene, this.camera);
  }

  dispose(): void {
    this.env.dispose();
    this.ocean.dispose();
    this.view?.dispose();
  }
}
