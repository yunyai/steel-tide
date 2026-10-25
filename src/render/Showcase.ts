import {
  BoxGeometry,
  Color,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Quaternion,
  RingGeometry,
  Scene,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from 'three';
import type { ShipSpec } from '../core/types';
import { GROUND_MAP_BY_ID } from '../ground/sim/maps';
import type { VehicleSpec } from '../ground/sim/types';
import { VehicleView, type VehicleViewSource } from '../ground/view/VehicleModel';
import { MAP_BY_ID } from '../world/GameMap';
import { Environment } from './Environment';
import { Ocean } from './Ocean';
import { ShipView } from './ShipModel';

// Menu backdrop under a slowly orbiting camera: a ship riding the swell at dusk, or a vehicle
// on a plate of snow-dusted rubble.

const PLATE_R = 70;

/** The garage plate: a broad disc of rubble and old snow, fading into the haze, with loose chunks. */
function buildPlate(fog: number): Mesh[] {
  const geo = new RingGeometry(0.01, PLATE_R, 72, 16);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const rubble = new Color(0.3, 0.28, 0.25);
  const snow = new Color(0.78, 0.81, 0.86);
  const haze = new Color(fog);
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    const n = Math.sin(x * 0.31 + Math.cos(z * 0.23) * 2) * Math.cos(z * 0.27 - x * 0.11) * 0.5 + 0.5;
    if (r > 8) pos.setY(i, (n - 0.5) * 0.35 * Math.min(1, (r - 8) / 10));
    c.copy(rubble).lerp(snow, Math.max(0, Math.min(1, (n - 0.35) * 1.8)));
    c.lerp(haze, Math.max(0, Math.min(1, (r - PLATE_R * 0.55) / (PLATE_R * 0.45))));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const plate = new Mesh(geo, new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
  plate.receiveShadow = true;

  const count = 26;
  const chunks = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ color: 0x5b554d, roughness: 0.9 }), count);
  const m = new Matrix4();
  const q = new Quaternion();
  const p = new Vector3();
  const s = new Vector3();
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 9 + Math.random() * 28;
    const k = 0.4 + Math.random() * 1.4;
    p.set(Math.cos(a) * r, k * 0.25, Math.sin(a) * r);
    q.setFromAxisAngle(s.set(Math.random(), Math.random(), Math.random()).normalize(), Math.random() * 0.8);
    s.set(k * (1 + Math.random()), k * 0.6, k * (0.6 + Math.random()));
    chunks.setMatrixAt(i, m.compose(p, q, s));
  }
  chunks.castShadow = chunks.receiveShadow = true;
  return [plate, chunks];
}

export class Showcase {
  readonly camera = new PerspectiveCamera(40, 1, 1, 42000);
  private size = new Vector2();
  private sea: { scene: Scene; env: Environment; ocean: Ocean } | null = null;
  private land: { scene: Scene; env: Environment } | null = null;
  private view: ShipView | null = null;
  private spec: ShipSpec | null = null;
  private vehicle: { view: VehicleView; src: VehicleViewSource } | null = null;
  private time = 0;
  private orbit = 0.6;
  /** Horizontal offset of the subject on screen (-1..1), so UI panels don't cover it. */
  offset = 0.25;

  constructor(private gl: WebGLRenderer) {}

  /** The scene on show now. */
  private get stage(): { scene: Scene; env: Environment } | null {
    return this.vehicle ? this.land : this.sea;
  }

  get exposure(): number {
    return this.stage?.env.look.exposure ?? 1;
  }

  setShip(spec: ShipSpec): void {
    this.clearVehicle();
    if (this.spec === spec) return;
    this.spec = spec;
    if (!this.sea) {
      const scene = new Scene();
      const env = new Environment(scene, MAP_BY_ID.dusk);
      env.bake(this.gl);
      const ocean = new Ocean(env.look, env.sunDir, env.skyCube);
      scene.add(ocean.mesh);
      this.sea = { scene, env, ocean };
    }
    if (this.view) {
      this.sea.scene.remove(this.view.root);
      this.view.dispose();
    }
    this.view = new ShipView(spec);
    this.view.root.rotation.order = 'YZX';
    this.view.root.rotation.y = Math.PI / 2;
    this.sea.scene.add(this.view.root);
  }

  setVehicle(spec: VehicleSpec): void {
    if (this.vehicle?.view.spec === spec) return;
    this.clearVehicle();
    if (!this.land) {
      const scene = new Scene();
      const env = new Environment(scene, GROUND_MAP_BY_ID.city);
      env.bake(this.gl);
      env.sun.castShadow = false;
      scene.add(...buildPlate(env.look.fog));
      this.land = { scene, env };
    }
    const src: VehicleViewSource = {
      spec,
      alive: true,
      renderX: 0,
      renderY: 0,
      renderZ: 0,
      renderHeading: 0,
      renderPitch: 0,
      renderRoll: 0,
      renderTurret: 0,
      gunPitch: 0.03,
      deathTime: 0,
      launcherReload: 0,
      salvoLeft: 1,
    };
    const view = new VehicleView(src, false);
    this.land.scene.add(view.group);
    this.vehicle = { view, src };
  }

  private clearVehicle(): void {
    this.vehicle?.view.dispose();
    this.vehicle = null;
  }

  render(gl: WebGLRenderer, dt: number): void {
    this.time += dt;
    this.orbit += dt * 0.05;
    const stage = this.stage;
    if (!stage) return;
    const veh = this.vehicle;
    if (veh) {
      // The turret looks about on its own.
      veh.src.renderTurret = Math.sin(this.time * 0.35) * 0.6;
      veh.view.update(dt, this.time);
      const sz = veh.view.spec.size;
      const L = Math.max(sz.length, sz.width * 1.6);
      const r = L * 1.85 + 7;
      this.camera.position.set(Math.cos(this.orbit) * r, L * 0.22 + 2.2, Math.sin(this.orbit) * r);
      this.camera.lookAt(0, sz.height * 0.7, 0);
    } else {
      const spec = this.spec;
      const sea = this.sea;
      if (!spec || !this.view || !sea) return;
      this.view.pose(this.time);
      const L = spec.length;
      const r = L * 1.45 + 50;
      this.camera.position.set(Math.cos(this.orbit) * r, L * 0.16 + 12, Math.sin(this.orbit) * r);
      this.camera.lookAt(0, spec.freeboard + 4, 0);
      sea.ocean.follow(this.camera);
      sea.ocean.update(this.time);
    }
    // Shift the framing sideways so the subject sits clear of the menu panels.
    this.camera.setViewOffset(1000, 1000, -this.offset * 500, 0, 1000, 1000);
    stage.env.update(this.time);
    stage.env.focus(0, 0);
    gl.toneMappingExposure = stage.env.look.exposure;
    const c = gl.getSize(this.size);
    gl.setViewport(0, 0, c.x, c.y);
    this.camera.aspect = c.x / Math.max(1, c.y);
    this.camera.updateProjectionMatrix();
    gl.clear();
    gl.render(stage.scene, this.camera);
  }

  dispose(): void {
    this.sea?.env.dispose();
    this.sea?.ocean.dispose();
    this.land?.env.dispose();
    this.view?.dispose();
    this.clearVehicle();
  }
}
