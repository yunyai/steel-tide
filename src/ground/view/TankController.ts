import { PerspectiveCamera, Vector3 } from 'three';
import type { InputDeviceId, KeyLayout } from '../../config';
import { clamp, wrapAngle } from '../../core/math';
import type { Input } from '../../input/Input';
import { type Bindings, bindings, layoutFor } from '../../input/Keybinds';
import { controls } from '../../input/Settings';
import { SHELL_SPEED_SCALE } from '../sim/config';
import type { GroundGame } from '../sim/GroundGame';
import type { GroundControl, Vehicle } from '../sim/Vehicle';
import { castAim, type GroundAim } from './aim';

// Turns one input device into vehicle orders and drives that player's camera, in the World of
// Tanks manner: W/S and A/D are held, the mouse swings the view and the turret follows the point
// under the crosshair. The wheel pulls the camera in and, past the closest view, opens the
// gunsight. Artillery trades the gunsight for a view from above the aim point.

const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const DEADZONE = 0.18;
const BASE_FOV = 60;
/** Radians of view per mouse count at 1x. */
const MOUSE_SENS = 0.0022;
const PITCH_MIN = -1.05;
const PITCH_MAX = 0.4;
/** Orbit distance multiplier limits. */
const DIST_MIN = 0.6;
const DIST_MAX = 2.2;
/** Gunsight magnification limits, the step per wheel notch and where it opens. */
const MAG_MIN = 2;
const MAG_MAX = 8;
const MAG_STEP = 1.3;
const MAG_DEFAULT = 2;
/** Artillery view height limits (m above the aim point). */
const ARTY_MIN = 60;
const ARTY_MAX = 250;
/** Assist reach around the crosshair, in viewport pixels. */
const ASSIST_PX = 80;

const tmpA = new Vector3();
const tmpDir = new Vector3();

function dz(v: number): number {
  return Math.abs(v) < DEADZONE ? 0 : (v - Math.sign(v) * DEADZONE) / (1 - DEADZONE);
}

export class TankController {
  readonly camera = new PerspectiveCamera(BASE_FOV, 1, 0.3, 6000);
  /** View heading and pitch (negative looks down). */
  yaw: number;
  pitch = -0.08;
  /** Orbit distance multiplier, set by the wheel. */
  dist = 1;
  zoomToggle = false;
  private zoomHold = false;
  /** Magnification the gunsight opens at; the wheel steps it. */
  scopeMag = MAG_DEFAULT;
  /** Current smoothed magnification (1 = no gunsight). */
  mag = 1;
  /** Extra field of view in degrees, decaying (ultimate punch). */
  fovKick = 0;
  /** Artillery view: the aim point on the ground and the camera height over it. */
  artyX = 0;
  artyZ = 0;
  artyH = 140;
  /** What the crosshair ray hit, and the aim point sent to the sim. */
  aim: GroundAim | null = null;
  readonly aimPoint = new Vector3();
  /** The gun is held on its last aim while the right mouse button is down. */
  gunLocked = false;
  /** Locked target (missile locks, the repair beam); else the vehicle under the crosshair counts. */
  lock: Vehicle | null = null;
  /** Fire-control assist (pads by default): the aim slides onto an enemy near the crosshair, with lead. */
  assistOn: boolean;
  assist: Vehicle | null = null;
  /** Viewport size in CSS pixels (set by the host each frame). */
  viewW = 1280;
  viewH = 720;
  focus: Vehicle;
  private shakeAmt = 0;
  private camPos = new Vector3();
  private padChord = false;
  private ammoAsked = 0;
  private ammoAskedTime = 0;
  private deadTime = 0;
  /** A tap of fire stays armed briefly so it still fires once the gun finishes loading. */
  private fireLatch = 0;
  /** Short message for the HUD and how long it stays up. */
  notice = '';
  noticeTime = 0;
  private keys: { b: Bindings; layout: KeyLayout } | null = null;
  /** Set for a LAN battle (see `out`). */
  draft: GroundControl | null = null;
  private off: () => void;

  constructor(
    public v: Vehicle,
    readonly device: InputDeviceId,
    readonly index: number,
    private game: GroundGame,
    assist = device !== 'mouse',
  ) {
    this.yaw = v.heading;
    this.focus = v;
    this.assistOn = assist;
    this.camPos.set(v.renderX, v.renderY + 8, v.renderZ);
    this.resetArty();
    // Free play: a new vehicle at respawn is a new hull; the controls follow the captain into it.
    this.off = game.events.on('vehicleChanged', ({ old, v: nv }) => {
      if (old !== this.v) return;
      this.v = nv;
      this.focus = nv;
      this.keys = null;
      this.lock = null;
      this.zoomToggle = false;
    });
  }

  dispose(): void {
    this.off();
  }

  /** The keyboard layout (keyboard + mouse captains), following the bindings as they change. */
  get layout(): KeyLayout | null {
    if (this.device !== 'mouse') return null;
    const b = bindings();
    if (this.keys?.b !== b) this.keys = { b, layout: layoutFor(this.v.spec, b) };
    return this.keys.layout;
  }

  /** Where the controls write: the vehicle's own orders solo, a draft the lockstep sends on LAN. */
  get out(): GroundControl {
    return this.draft ?? this.v.control;
  }

  get zoom(): boolean {
    return this.zoomToggle || this.zoomHold;
  }

  /** Artillery: the zoom key opens the view from above rather than the gunsight. */
  get artyView(): boolean {
    return this.zoom && !!this.v.spec.gun?.artillery && this.v.alive && this.focus === this.v;
  }

  /** Gunsight up (the own vehicle is hidden while it is). */
  get scoped(): boolean {
    return this.zoom && !this.v.spec.gun?.artillery && this.v.alive && this.focus === this.v;
  }

  get padIndex(): number {
    return this.device === 'pad0' ? 0 : -1;
  }

  /** Metres from the gun to the aim point. */
  get aimDist(): number {
    const p = this.v.pivot();
    return Math.hypot(this.aimPoint.x - p.x, this.aimPoint.z - p.z);
  }

  /** Where the gun actually points at the aim's range (the aim circle sits here). */
  gunPoint(out: Vector3): Vector3 {
    const v = this.v;
    const p = v.pivot();
    const d = this.aimDist;
    if (v.spec.gun?.artillery || !v.spec.gun) return out.copy(this.aimPoint);
    const yaw = v.renderHeading + v.renderTurret;
    return out.set(p.x + Math.sin(yaw) * d, this.aimPoint.y, p.z - Math.cos(yaw) * d);
  }

  shake(amount: number): void {
    this.shakeAmt = Math.min(2.5, this.shakeAmt + amount * controls().shake);
  }

  private say(text: string, time = 1.6): void {
    this.notice = text;
    this.noticeTime = time;
  }

  private resetArty(): void {
    const v = this.v;
    const r = Math.min(400, (v.spec.gun?.range ?? 600) * 0.4);
    this.artyX = v.x + Math.sin(v.heading) * r;
    this.artyZ = v.z - Math.cos(v.heading) * r;
  }

  /** The enemy nearest the crosshair's line, for a lock with nothing under it. */
  private pickTarget(): Vehicle | null {
    const me = this.v;
    let best: Vehicle | null = null;
    let bestScore = Infinity;
    for (const o of this.game.vehicles) {
      if (!o.alive || o.team === me.team || o.mods.untargetable || o.withdrawn) continue;
      const brg = Math.atan2(o.x - me.x, -(o.z - me.z));
      const off = Math.abs(wrapAngle(brg - this.yaw));
      const d = Math.hypot(o.x - me.x, o.z - me.z);
      const score = off * 2000 + d * 0.3;
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    return best;
  }

  private toggleLock(): void {
    const t = this.aim?.target && this.aim.target.team !== this.v.team ? this.aim.target : this.pickTarget();
    if (!t || t === this.lock) {
      if (!t && !this.lock) this.say('No enemy in sight to lock');
      this.lock = null;
      return;
    }
    this.lock = t;
  }

  /** Read the device and write the orders. Call before the sim step. */
  control(dt: number, input: Input): void {
    const v = this.v;
    const c = this.out;
    const L = this.layout;
    const p = this.padIndex;
    const pad = p >= 0 ? input.pad(p) : null;
    const mouse = this.device === 'mouse';
    if (this.lock && (!this.lock.alive || this.lock.mods.untargetable || this.lock.withdrawn)) this.lock = null;
    this.noticeTime -= dt;

    // Spectating after death.
    if (!v.alive) {
      this.deadTime += dt;
      c.fire = false;
      c.drive = c.steer = 0;
      const next = (mouse && input.mousePressed(0)) || (p >= 0 && input.padPressed(p, PAD.RT));
      if ((this.deadTime > 4 && (!this.focus.alive || this.focus === v)) || next) {
        const allies = this.game.vehicles.filter((o) => o.alive && o.team === v.team && !o.isSummon);
        if (allies.length) {
          const i = allies.indexOf(this.focus);
          this.focus = allies[(i + 1) % allies.length];
        }
      }
      this.cameraInput(dt, input, pad, mouse);
      return;
    }
    // Back from the dead: the view returns to your own vehicle, facing the enemy.
    if (this.deadTime > 0) {
      this.deadTime = 0;
      this.focus = v;
      this.yaw = v.heading;
      this.pitch = -0.08;
      this.lock = null;
      this.zoomToggle = false;
      this.resetArty();
    }

    let drive = 0;
    let steer = 0;
    let fire = false;
    if (L) {
      if (input.isDown(L.throttleUp)) drive += 1;
      if (input.isDown(L.throttleDown)) drive -= 1;
      if (input.isDown(L.left)) steer -= 1;
      if (input.isDown(L.right)) steer += 1;
      L.slots.forEach((k, i) => {
        if (input.pressed(k) && v.spec.gun && i < v.spec.gun.ammo.length) c.ammo = i;
      });
      L.skills.forEach((k, i) => {
        if (input.pressed(k) && i < v.skills.length) c.skill = i;
      });
      L.consumables.forEach((k, i) => {
        if (input.pressed(k)) c.consumable = i;
      });
      if (input.pressed(L.zoom)) this.zoomToggle = !this.zoomToggle;
      if (input.pressed(L.lock) || (input.aiming && input.mousePressed(1))) this.toggleLock();
      if (input.pressed(L.assist)) {
        this.assistOn = !this.assistOn;
        this.say(this.assistOn ? 'Aim assist: on' : 'Aim assist: off');
      }
      if (input.aiming && input.mousePressed(0)) this.fireLatch = 0.4;
      fire = input.aiming && input.mouseDown(0);
      this.gunLocked = input.aiming && input.mouseDown(2);
    }
    if (pad) {
      const ly = dz(pad.axes[1] ?? 0);
      const lx = dz(pad.axes[0] ?? 0);
      drive += -ly;
      steer += lx;
      // X, B: skills; Y: the ultimate. Titans hold LB or RB for their second and third set.
      // D-pad up: repair kit; right: utility; down: assist; left: gunsight.
      const chords = v.ultIndices.length > 1;
      const bank = chords ? (input.padDown(p, PAD.LB) ? 1 : input.padDown(p, PAD.RB) ? 2 : 0) : 0;
      const normal = v.skills.filter((st) => !st.spec.ult).map((st) => st.index);
      const face: [number, number | undefined][] = [
        [PAD.X, normal[bank * 2]],
        [PAD.B, normal[bank * 2 + 1]],
        [PAD.Y, v.ultIndices[bank]],
      ];
      for (const [b, idx] of face) {
        if (!input.padPressed(p, b) || idx === undefined) continue;
        c.skill = idx;
        if (bank) this.padChord = true;
      }
      // Shoulders cycle the ammo; a titan's switch on release, unless they were held as a modifier.
      const rounds = v.spec.gun?.ammo.length ?? 0;
      if (input.padPressed(p, PAD.LB) || input.padPressed(p, PAD.RB)) this.padChord = false;
      const next = chords ? input.padReleased(p, PAD.RB) && !this.padChord : input.padPressed(p, PAD.RB);
      const prev = chords ? input.padReleased(p, PAD.LB) && !this.padChord : input.padPressed(p, PAD.LB);
      const cur = this.ammoAskedTime > 0 ? this.ammoAsked : v.ammoIndex;
      if ((next || prev) && rounds > 1) {
        c.ammo = this.ammoAsked = (cur + (next ? 1 : -1) + rounds) % rounds;
        this.ammoAskedTime = 0.5;
      }
      if (input.padPressed(p, PAD.A)) this.toggleLock();
      if (input.padPressed(p, PAD.UP)) c.consumable = 0;
      if (input.padPressed(p, PAD.RIGHT)) c.consumable = 1;
      if (input.padPressed(p, PAD.DOWN)) {
        this.assistOn = !this.assistOn;
        this.say(this.assistOn ? 'Aim assist: on' : 'Aim assist: off');
      }
      if (input.padPressed(p, PAD.LEFT)) this.zoomToggle = !this.zoomToggle;
      this.zoomHold = input.padDown(p, PAD.LT) || (pad.buttons[PAD.LT]?.value ?? 0) > 0.5;
      if (input.padPressed(p, PAD.RT)) this.fireLatch = 0.4;
      fire ||= input.padDown(p, PAD.RT) || (pad.buttons[PAD.RT]?.value ?? 0) > 0.5;
    }
    this.fireLatch -= dt;
    this.ammoAskedTime -= dt;
    c.drive = clamp(drive, -1, 1);
    c.steer = clamp(steer, -1, 1);
    c.fire = fire || this.fireLatch > 0;
    // The gun follows last frame's crosshair (see updateCamera), unless it is held.
    if (!this.gunLocked) {
      c.aimX = this.aimPoint.x;
      c.aimY = this.aimPoint.y;
      c.aimZ = this.aimPoint.z;
    }
    const t = this.lock ?? this.aim?.target ?? null;
    c.targetId = t && t.alive ? t.id : 0;
    this.cameraInput(dt, input, pad, mouse);
  }

  private cameraInput(dt: number, input: Input, pad: Gamepad | null, mouse: boolean): void {
    // Sensitivity follows the actual field of view, so the gunsight feels the same at every power.
    const zoomK = 1 / this.mag;
    const arty = this.artyView;
    let dYaw = 0;
    let dPitch = 0;
    let panX = 0;
    let panZ = 0;
    if (mouse) {
      if (input.aiming) {
        const pref = controls();
        const sens = MOUSE_SENS * pref.sens;
        const dy = input.mouseDy * (pref.invertY ? -1 : 1);
        if (arty) {
          panX += input.mouseDx * sens * this.artyH * 0.9;
          panZ += dy * sens * this.artyH * 0.9;
        } else {
          dYaw += (input.mouseDx * sens + input.edge * 1.4 * dt) * zoomK;
          dPitch -= dy * sens * zoomK;
        }
      }
      // Scrolling in past the closest view opens the gunsight (or lowers the artillery view), then
      // steps its power; scrolling out below the lowest power closes it.
      if (input.wheel) {
        if (arty) {
          const h = this.artyH * Math.exp(input.wheel * 0.15);
          if (h > ARTY_MAX + 1) this.zoomToggle = this.zoomHold = false;
          else this.artyH = clamp(h, ARTY_MIN, ARTY_MAX);
        } else if (this.zoom) {
          const m = this.scopeMag * Math.pow(MAG_STEP, -input.wheel);
          if (m < MAG_MIN - 0.01) this.zoomToggle = this.zoomHold = false;
          else this.scopeMag = Math.min(MAG_MAX, m);
        } else if (input.wheel < 0 && this.dist <= DIST_MIN + 0.01 && this.v.alive && this.focus === this.v) {
          this.zoomToggle = true;
          this.scopeMag = MAG_MIN;
          if (this.v.spec.gun?.artillery) this.artyH = ARTY_MAX;
        } else this.dist = clamp(this.dist * Math.exp(input.wheel * 0.12), DIST_MIN, DIST_MAX);
      }
    }
    if (pad) {
      const rx = dz(pad.axes[2] ?? 0);
      const ry = dz(pad.axes[3] ?? 0);
      if (arty) {
        panX += rx * this.artyH * 1.6 * dt;
        panZ += ry * this.artyH * 1.6 * dt;
      } else {
        dYaw += rx * Math.abs(rx) * 2.2 * zoomK * dt;
        dPitch -= ry * Math.abs(ry) * 1.2 * zoomK * dt;
      }
    }
    if (arty) {
      // Pan the aim point in the view's frame (mouse up carries it forward), within the gun's reach.
      const s = Math.sin(this.yaw);
      const cz = Math.cos(this.yaw);
      this.artyX += cz * panX - s * panZ;
      this.artyZ += s * panX + cz * panZ;
      const v = this.v;
      const range = v.spec.gun?.range ?? 1000;
      const ex = this.artyX - v.x;
      const ez = this.artyZ - v.z;
      const d = Math.hypot(ex, ez);
      if (d > range) {
        this.artyX = v.x + (ex / d) * range;
        this.artyZ = v.z + (ez / d) * range;
      }
      const half = this.game.terrain.half - 5;
      this.artyX = clamp(this.artyX, -half, half);
      this.artyZ = clamp(this.artyZ, -half, half);
    } else {
      this.yaw = wrapAngle(this.yaw + dYaw);
      this.pitch = clamp(this.pitch + dPitch, PITCH_MIN, PITCH_MAX);
    }
  }

  /** Position the camera after the sim step, then cast the crosshair ray for the next aim point. */
  updateCamera(dt: number): void {
    const g = this.game;
    const v = this.focus;
    const own = v === this.v;
    const live = own && v.alive;
    const cam = this.camera;
    const size = v.spec.size;
    const scope = this.scoped;
    const arty = this.artyView;
    // Magnification eases in log space so every step of the wheel takes the same time.
    const goal = scope ? this.scopeMag : 1;
    this.mag = Math.exp(Math.log(this.mag) + (Math.log(goal) - Math.log(this.mag)) * Math.min(1, dt * 12));
    if (Math.abs(this.mag - goal) < 0.005) this.mag = goal;

    const fx = Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const cp = Math.cos(this.pitch);
    tmpDir.set(fx * cp, Math.sin(this.pitch), fz * cp);
    const target = tmpA;
    let lookDown = false;
    if (arty) {
      // Over the aim point, a little back toward the gun so the arc reads.
      const gy = g.terrain.heightAt(this.artyX, this.artyZ);
      target.set(this.artyX - fx * this.artyH * 0.25, gy + this.artyH, this.artyZ - fz * this.artyH * 0.25);
      lookDown = true;
    } else if (scope) {
      const p = v.pivot();
      target.set(p.x, p.y + 0.35, p.z);
    } else {
      // Orbit about a point over the turret: the vehicle sits low in the frame, the crosshair above it.
      const L = Math.max(size.length, size.width * 1.4);
      const D = Math.max(8, L * 1.6) * this.dist;
      const px = v.renderX;
      const py = v.renderY + size.height + 1.6 + L * 0.12;
      const pz = v.renderZ;
      target.set(px - tmpDir.x * D, py - tmpDir.y * D + D * 0.12, pz - tmpDir.z * D);
      this.clearOrbit(px, py, pz, target);
    }
    const snap = this.camPos.distanceToSquared(target) > 300 * 300 || scope;
    if (snap) this.camPos.copy(target);
    else this.camPos.lerp(target, 1 - Math.exp(-dt * (arty ? 10 : 18)));
    const floor = g.terrain.heightAt(this.camPos.x, this.camPos.z) + (scope ? 0.4 : 1.2);
    if (this.camPos.y < floor) this.camPos.y = floor;

    cam.position.copy(this.camPos);
    if (this.shakeAmt > 0.01) {
      const a = this.shakeAmt * (scope ? 0.25 : 1);
      cam.position.x += (Math.random() - 0.5) * a * 0.8;
      cam.position.y += (Math.random() - 0.5) * a * 0.6;
      cam.position.z += (Math.random() - 0.5) * a * 0.8;
      this.shakeAmt *= Math.exp(-dt * 6);
    }
    if (lookDown) {
      const gy = g.terrain.heightAt(this.artyX, this.artyZ);
      cam.up.set(fx, 0, fz);
      cam.lookAt(this.artyX, gy, this.artyZ);
    } else {
      cam.up.set(0, 1, 0);
      cam.lookAt(cam.position.x + tmpDir.x, cam.position.y + tmpDir.y, cam.position.z + tmpDir.z);
    }
    this.fovKick *= Math.exp(-dt * 4);
    cam.fov = (2 * Math.atan(Math.tan((BASE_FOV * Math.PI) / 360) / this.mag) * 180) / Math.PI + this.fovKick;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    if (!live) {
      this.aim = null;
      this.assist = null;
      return;
    }
    if (arty) {
      const y = g.terrain.heightAt(this.artyX, this.artyZ);
      this.aim = { x: this.artyX, y, z: this.artyZ, dist: this.artyH, kind: 'ground', target: null, pen: 'none' };
      this.assist = null;
      this.aimPoint.set(this.artyX, y, this.artyZ);
      return;
    }
    // The crosshair ray leaves the unshaken camera along the view.
    const hit = castAim(g, this.v, this.camPos.x, this.camPos.y, this.camPos.z, tmpDir.x, tmpDir.y, tmpDir.z);
    this.aim = hit;
    this.aimPoint.set(hit.x, hit.y, hit.z);
    // Artillery off its overhead view still aims where the crosshair meets the world.
    if (this.v.spec.gun?.artillery) {
      this.artyX = hit.x;
      this.artyZ = hit.z;
    }
    this.assist = null;
    if (this.assistOn || this.lock) this.applyAssist(hit);
  }

  /** Slide the aim onto an enemy near the crosshair (or the locked one), leading its motion. */
  private applyAssist(hit: GroundAim): void {
    const me = this.v;
    let tgt: Vehicle | null = this.lock;
    if (!tgt && hit.target && hit.target.team !== me.team) tgt = hit.target;
    if (!tgt && this.assistOn) {
      const hw = this.viewW / 2;
      const hh = this.viewH / 2;
      let bestPx = ASSIST_PX * (this.scoped ? 1.4 : 1);
      for (const o of this.game.vehicles) {
        if (!o.alive || o.team === me.team || o.mods.untargetable || o.withdrawn) continue;
        if (Math.hypot(o.x - me.x, o.z - me.z) > 1400) continue;
        tmpA.set(o.renderX, o.renderY + o.spec.size.height * 0.6, o.renderZ).project(this.camera);
        if (tmpA.z > 1) continue;
        const px = Math.hypot(tmpA.x * hw, tmpA.y * hh);
        if (px < bestPx) {
          bestPx = px;
          tgt = o;
        }
      }
    }
    if (!tgt) return;
    // Only when it is in sight from the gun: assist never aims through a house.
    const p = me.pivot();
    const ty = tgt.renderY + tgt.spec.size.height * 0.6;
    if (!this.game.lineOfSight(p.x, p.y, p.z, tgt.renderX, ty, tgt.renderZ)) return;
    const ammo = me.ammo;
    const d = Math.hypot(tgt.renderX - p.x, tgt.renderZ - p.z);
    const speed = ammo ? ammo.velocity * SHELL_SPEED_SCALE : (me.spec.launcher?.speed ?? 200);
    const lead = me.spec.gun?.artillery ? 0 : d / Math.max(50, speed);
    const f = tgt.pose.f;
    const r = tgt.pose.r;
    const vx = f[0] * tgt.speed + r[0] * tgt.side;
    const vz = f[2] * tgt.speed + r[2] * tgt.side;
    this.aimPoint.set(tgt.renderX + vx * lead, ty, tgt.renderZ + vz * lead);
    this.assist = tgt;
  }

  /** Pull the orbit camera in front of any house or hill between it and the vehicle. */
  private clearOrbit(px: number, py: number, pz: number, cam: Vector3): void {
    const g = this.game;
    let t = 1;
    const ph = g.props.segment(px, py, pz, cam.x, cam.y, cam.z);
    if (ph) t = Math.min(t, ph.t);
    const th = g.terrain.segmentHit(px, py, pz, cam.x, cam.y, cam.z);
    if (th >= 0) t = Math.min(t, th);
    if (t < 1) {
      const k = Math.max(0.08, t - 0.06);
      cam.set(px + (cam.x - px) * k, py + (cam.y - py) * k, pz + (cam.z - pz) * k);
    }
  }
}
