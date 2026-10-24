import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { type InputDeviceId, type KeyLayout, layoutFor } from '../config';
import type { Game } from '../core/Game';
import { bearingTo, clamp, dist2D, wrapAngle } from '../core/math';
import type { ControlState, Ship } from '../ships/Ship';
import { waveHeight } from '../world/Waves';
import type { Input } from '../input/Input';
import { controls } from '../input/Settings';
import { type AimHit, assistAim, flightTimeFn, leadPoint, raycast } from './FireControl';
import { ShellCam } from './ShellCam';

// Turns one input device into ship orders and drives that player's camera.
// The camera orbits the ship and whatever sits under the crosshair is the aim point:
// a hull, an island or the sea. The mouse swings the view directly; gamepad captains
// set a range instead and the view pitches to look at it. Either device can lock a
// target so the rangefinder tracks it.

const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const DEADZONE = 0.18;
const BASE_FOV = 55;
const MIN_DIST = 0.45;
/** Radians of view per mouse count at 1x. */
const MOUSE_SENS = 0.0022;
const PITCH_MIN = -1.2;
const PITCH_MAX = 0.35;
/** Below this depression the unscoped view pitches slower (at least HORIZON_MIN of full speed), so ranging stays steady. */
const HORIZON_BAND = 0.2;
const HORIZON_MIN = 0.5;
/** Scope magnification limits, the step per wheel notch and the default for the zoom key. */
const MAG_MIN = 3;
const MAG_MAX = 16;
const MAG_STEP = 1.3;
const MAG_DEFAULT = 6;
/** Assist reach around the crosshair, in viewport pixels. */
const ASSIST_PX = 90;

const tmpV = new Vector3();
const tmpDir = new Vector3();
const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpQ = new Quaternion();
/** Shell cam: metres behind and above the shell, and its narrower field of view. */
const SHELL_BACK = 35;
const SHELL_UP = 5;
const SHELL_FOV = 42;

function dz(v: number): number {
  return Math.abs(v) < DEADZONE ? 0 : (v - Math.sign(v) * DEADZONE) / (1 - DEADZONE);
}

export class PlayerController {
  readonly camera = new PerspectiveCamera(BASE_FOV, 1, 1, 42000);
  yaw: number;
  /** View pitch, radians (negative looks down). */
  pitch = -0.02;
  /** Sea range the view holds while the mouse is still (Infinity when looking above the horizon). */
  private holdRange: number;
  /** Distance from the ship to the current aim point. */
  range = 2000;
  /** Vertical aim input arrived this frame (the view then sets the range, not the other way round). */
  private pitchInput = false;
  zoomToggle = false;
  private zoomHold = false;
  /** Magnification the scope opens at; the wheel steps it. */
  scopeMag = MAG_DEFAULT;
  /** Current smoothed magnification (1 = no scope). */
  mag = 1;
  /** Extra field of view in degrees, decaying (ability punch). */
  fovKick = 0;
  dist = 1;
  /** Fire-control assist on, the target it is working on, and what the crosshair ray hit. */
  assistOn: boolean;
  assist: Ship | null = null;
  aimHit: AimHit | null = null;
  /** Viewport size in CSS pixels (set by the host each frame). */
  viewW = 1280;
  viewH = 720;
  freeYaw = 0;
  rudderStep = 0;
  lock: Ship | null = null;
  private lockYaw = 0;
  private lockRange = 0;
  focus: Ship;
  private shakeAmt = 0;
  private camPos = new Vector3();
  private padTimers = { thr: 0, rud: 0 };
  /** A shoulder button was used as a skill modifier since it went down (so its release does not switch weapons). */
  private padChord = false;
  /** The weapon a shoulder press last asked for, and how long to count from it rather than the
   * ship's own (in LAN the switch takes a turn or two to arrive, so quick presses would repeat). */
  private slotAsked = 0;
  private slotAskedTime = 0;
  private deadTime = 0;
  /** A tap of fire stays armed briefly so it still fires once a turret finishes loading or traversing. */
  private fireLatch = 0;
  /** Short message for the HUD (e.g. a lock with nothing to lock onto) and how long it stays up. */
  notice = '';
  noticeTime = 0;
  readonly layout: KeyLayout | null;
  readonly aim = new Vector3();
  readonly shellCam: ShellCam;
  /** Set for a LAN battle (see `out`). */
  draft: ControlState | null = null;

  constructor(
    readonly ship: Ship,
    readonly device: InputDeviceId,
    readonly index: number,
    private game: Game,
    assist = device !== 'mouse',
  ) {
    this.yaw = ship.heading;
    this.focus = ship;
    this.assistOn = assist;
    this.holdRange = this.range = ship.maxAimRange() * 0.6;
    this.aim.set(ship.pos.x + Math.sin(this.yaw) * this.range, 0, ship.pos.z - Math.cos(this.yaw) * this.range);
    this.layout = device === 'mouse' ? layoutFor(ship.spec) : null;
    this.camPos.copy(ship.pos);
    this.shellCam = new ShellCam(game, ship);
  }

  /**
   * Where the controls write. Solo: the ship's own ControlState. LAN: a draft the lockstep sends
   * to the server, so the ship only obeys orders that every peer applies on the same tick.
   */
  get out(): ControlState {
    return this.draft ?? this.ship.control;
  }

  get zoom(): boolean {
    return this.zoomToggle || this.zoomHold;
  }

  /** Mouse captains pitch the view directly; everyone else sets a range and the view follows it. */
  private get freeAim(): boolean {
    return this.device === 'mouse';
  }

  get padIndex(): number {
    return this.device === 'pad0' ? 0 : -1;
  }

  shake(amount: number): void {
    this.shakeAmt = Math.min(3, this.shakeAmt + amount);
  }

  private maxRange(): number {
    return this.ship.maxAimRange() * 1.12;
  }

  /** Enemy nearest the crosshair direction. */
  private pickTarget(): Ship | null {
    const s = this.ship;
    let best: Ship | null = null;
    let bestScore = Infinity;
    for (const o of this.game.ships) {
      if (!o.alive || o.team === s.team || o.mods.untargetable || o.isSummon && o.summonOwner === s) continue;
      const brg = bearingTo(s.pos.x, s.pos.z, o.pos.x, o.pos.z);
      const off = Math.abs(wrapAngle(brg - this.yaw));
      const d = dist2D(s.pos.x, s.pos.z, o.pos.x, o.pos.z);
      const score = off * 4000 + d * 0.3;
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    return best;
  }

  private toggleLock(trackCamera: boolean): void {
    const t = this.pickTarget();
    if (!t || t === this.lock) {
      if (!t && !this.lock) {
        this.notice = 'No enemy in sight to lock';
        this.noticeTime = 1.6;
      }
      this.lock = null;
      this.out.targetId = -1;
      return;
    }
    this.lock = t;
    this.out.targetId = t.id;
    if (trackCamera) {
      this.lockYaw = 0;
      this.lockRange = 0;
    }
  }

  /** Read the device and write ControlState. Call before the sim step. */
  control(dt: number, input: Input): void {
    const s = this.ship;
    const c = this.out;
    const L = this.layout;
    const p = this.padIndex;
    const pad = p >= 0 ? input.pad(p) : null;
    const mouse = this.device === 'mouse';
    const tracking = !mouse && this.lock !== null;
    if (this.lock && (!this.lock.alive || this.lock.mods.untargetable)) {
      this.lock = null;
      c.targetId = -1;
    }

    // Spectating after death.
    if (!s.alive) {
      this.deadTime += dt;
      c.fire = false;
      const next = (mouse && input.mousePressed(0)) || (p >= 0 && input.padPressed(p, PAD.RT));
      if ((this.deadTime > 4 && !this.focus.alive) || next) {
        const allies = this.game.ships.filter((o) => o.alive && o.team === s.team && !o.isSummon);
        if (allies.length) {
          const i = allies.indexOf(this.focus);
          this.focus = allies[(i + 1) % allies.length];
        }
      }
      this.cameraInput(dt, input, pad, mouse);
      return;
    }
    // Back from the dead (Domination): the view returns to your own ship, facing the enemy.
    if (this.deadTime > 0) {
      this.deadTime = 0;
      this.focus = s;
      this.yaw = s.heading;
      this.freeYaw = 0;
      this.lock = null;
      this.rudderStep = 0;
      c.targetId = -1;
    }

    if (L) {
      if (input.pressed(L.throttleUp)) c.throttleUp = true;
      if (input.pressed(L.throttleDown)) c.throttleDown = true;
      if (input.pressed(L.left)) this.rudderStep = Math.max(-2, this.rudderStep - 1);
      if (input.pressed(L.right)) this.rudderStep = Math.min(2, this.rudderStep + 1);
      L.slots.forEach((k, i) => {
        if (input.pressed(k)) c.slot = i;
      });
      L.skills.forEach((k, i) => {
        if (input.pressed(k)) c.skill = i;
      });
      L.consumables.forEach((k, i) => {
        if (input.pressed(k)) c.consumable = i;
      });
      if (input.pressed(L.diveUp)) c.diveUp = true;
      if (input.pressed(L.diveDown)) c.diveDown = true;
      if (input.pressed(L.zoom)) this.zoomToggle = !this.zoomToggle;
      if (input.pressed(L.follow)) this.followShot();
      if (input.pressed(L.lock) || (input.aiming && input.mousePressed(1))) this.toggleLock(false);
      if (input.pressed(L.assist)) {
        this.assistOn = !this.assistOn;
        this.notice = this.assistOn ? 'Fire control: assisted' : 'Fire control: manual';
        this.noticeTime = 1.6;
      }
      if (input.aiming && input.mousePressed(0)) {
        this.fireLatch = 0.4;
        this.shellCam.cancel();
      }
      c.fire = input.aiming && input.mouseDown(0);
    }
    if (pad) {
      const ly = dz(pad.axes[1] ?? 0);
      const lx = dz(pad.axes[0] ?? 0);
      this.padTimers.thr -= dt;
      this.padTimers.rud -= dt;
      if (Math.abs(ly) > 0.6 && this.padTimers.thr <= 0) {
        if (ly < 0) c.throttleUp = true;
        else c.throttleDown = true;
        this.padTimers.thr = 0.35;
      }
      if (Math.abs(ly) < 0.3) this.padTimers.thr = 0;
      if (Math.abs(lx) > 0.6 && this.padTimers.rud <= 0) {
        this.rudderStep = clamp(this.rudderStep + Math.sign(lx), -2, 2);
        this.padTimers.rud = 0.3;
      }
      if (Math.abs(lx) < 0.3) this.padTimers.rud = 0;
      // X, B: skills; Y: the ultimate. Titans hold LB or RB for their second and third set.
      // D-pad up: repair kit; right: utility.
      const chords = s.ultIndices.length > 1;
      const bank = chords ? (input.padDown(p, PAD.LB) ? 1 : input.padDown(p, PAD.RB) ? 2 : 0) : 0;
      const normal = s.skills.filter((st) => !st.spec.ult).map((st) => st.index);
      const face: [number, number | undefined][] = [
        [PAD.X, normal[bank * 2]],
        [PAD.B, normal[bank * 2 + 1]],
        [PAD.Y, s.ultIndices[bank]],
      ];
      for (const [b, idx] of face) {
        if (!input.padPressed(p, b) || idx === undefined) continue;
        c.skill = idx;
        if (bank) this.padChord = true;
      }
      // Shoulders cycle weapons; a titan's switch on release, unless they were held as a modifier.
      if (input.padPressed(p, PAD.LB) || input.padPressed(p, PAD.RB)) this.padChord = false;
      const next = chords ? input.padReleased(p, PAD.RB) && !this.padChord : input.padPressed(p, PAD.RB);
      const prev = chords ? input.padReleased(p, PAD.LB) && !this.padChord : input.padPressed(p, PAD.LB);
      const cur = this.slotAskedTime > 0 ? this.slotAsked : s.slot;
      if (next || prev) {
        c.slot = this.slotAsked = (cur + (next ? 1 : -1) + s.slots.length) % s.slots.length;
        this.slotAskedTime = 0.5;
      }
      if (input.padPressed(p, PAD.A)) this.toggleLock(true);
      if (input.padPressed(p, PAD.UP)) c.consumable = 0;
      if (input.padPressed(p, PAD.RIGHT)) c.consumable = 1;
      if (input.padPressed(p, PAD.DOWN)) {
        this.assistOn = !this.assistOn;
        this.notice = this.assistOn ? 'Fire control: assisted' : 'Fire control: manual';
        this.noticeTime = 1.6;
      }
      if (input.padPressed(p, PAD.LEFT)) this.zoomToggle = !this.zoomToggle;
      // Right stick click: surface a submarine; on anything else, follow the shot.
      if (input.padPressed(p, PAD.RS)) {
        if (s.spec.sub) c.diveUp = true;
        else this.followShot();
      }
      if (input.padPressed(p, PAD.LS)) c.diveDown = true;
      this.zoomHold = input.padDown(p, PAD.LT) || (pad.buttons[PAD.LT]?.value ?? 0) > 0.5;
      if (input.padPressed(p, PAD.RT)) {
        this.fireLatch = 0.4;
        this.shellCam.cancel();
      }
      c.fire = input.padDown(p, PAD.RT) || (pad.buttons[PAD.RT]?.value ?? 0) > 0.5;
    }
    // Boss Rush refit cards take 1-3 and the pad's face buttons while they are up.
    if (this.game.rush?.phase === 'offer') {
      c.skill = -1;
      c.slot = null;
    }
    this.fireLatch -= dt;
    this.slotAskedTime -= dt;
    this.noticeTime -= dt;
    if (this.fireLatch > 0) c.fire = true;
    c.throttleSet = null;
    c.rudder = this.rudderStep / 2;


    this.cameraInput(dt, input, pad, mouse);
    if (tracking && this.lock) {
      const t = this.lock;
      this.yaw = wrapAngle(bearingTo(s.pos.x, s.pos.z, t.pos.x, t.pos.z) + this.lockYaw);
      this.holdRange = clamp(dist2D(s.pos.x, s.pos.z, t.pos.x, t.pos.z) + this.lockRange, 100, this.maxRange());
    }
    // The aim point comes from last frame's crosshair ray (see updateCamera).
    c.aimX = this.aim.x;
    c.aimZ = this.aim.z;
  }

  private cameraInput(dt: number, input: Input, pad: Gamepad | null, mouse: boolean): void {
    // Sensitivity follows the actual field of view, so the scope feels the same at every power.
    const zoomK = 1 / this.mag;
    const tracking = !mouse && this.lock !== null;
    let dYaw = 0;
    let dPitch = 0;
    let rangeMul = 1;
    if (mouse) {
      if (input.aiming) {
        if (input.mouseDown(2)) {
          this.freeYaw = wrapAngle(this.freeYaw + input.mouseDx * 0.004);
        } else {
          const pref = controls();
          const sens = MOUSE_SENS * pref.sens;
          dYaw += (input.mouseDx * sens + input.edge * 1.4 * dt) * zoomK;
          // In the scope both axes move alike (magnification already gives precision). Unscoped,
          // pitch slows a little toward the horizon so ranging the far sea stays steady.
          const horizonK = this.zoom ? 1 : clamp(Math.abs(this.pitch) / HORIZON_BAND, HORIZON_MIN, 1);
          dPitch -= input.mouseDy * (pref.invertY ? -1 : 1) * sens * zoomK * horizonK;
        }
      }
      if (!input.mouseDown(2)) this.freeYaw *= Math.max(0, 1 - dt * 6);
      // Scrolling in past the closest view opens the scope, then steps its power; scrolling out
      // below the lowest power closes it.
      if (input.wheel) {
        if (this.zoom) {
          const m = this.scopeMag * Math.pow(MAG_STEP, -input.wheel);
          if (m < MAG_MIN - 0.01) {
            this.zoomToggle = false;
            this.zoomHold = false;
          } else this.scopeMag = Math.min(MAG_MAX, m);
        } else if (input.wheel < 0 && this.dist <= MIN_DIST + 0.01) {
          this.zoomToggle = true;
          this.scopeMag = MAG_MIN;
        } else this.dist = clamp(this.dist * Math.exp(input.wheel * 0.15), MIN_DIST, 2.6);
      }
    }
    if (pad) {
      const rx = dz(pad.axes[2] ?? 0);
      const ry = dz(pad.axes[3] ?? 0);
      dYaw += rx * Math.abs(rx) * 1.3 * zoomK * dt;
      rangeMul *= Math.exp(-ry * Math.abs(ry) * 1.1 * dt * (this.zoom ? 0.3 : 1));
    }
    if (tracking) {
      const d = this.holdRange;
      this.lockYaw = clamp(this.lockYaw + dYaw, -0.6, 0.6);
      this.lockRange = clamp(this.lockRange + d * (rangeMul - 1), -d * 0.6, d * 0.6);
    } else {
      this.yaw = wrapAngle(this.yaw + dYaw);
      if (this.freeAim) {
        if (dPitch) {
          this.pitch = clamp(this.pitch + dPitch, PITCH_MIN, PITCH_MAX);
          this.pitchInput = true;
        }
      } else {
        if (!Number.isFinite(this.holdRange)) this.holdRange = this.maxRange();
        this.holdRange = clamp(this.holdRange * rangeMul, 100, this.maxRange());
      }
    }
  }

  /** Position the camera after the sim step, then cast the crosshair ray for the next aim point. */
  updateCamera(dt: number): void {
    const s = this.focus;
    const own = s === this.ship;
    const spec = s.spec;
    const cam = this.camera;
    const t = this.game.renderTime;
    const p = s.renderPos;
    const target = tmpV;
    const viewYaw = this.yaw + this.freeYaw;
    const fx = Math.sin(viewYaw);
    const fz = -Math.cos(viewYaw);
    const scope = this.zoom && own && s.alive;
    // Magnification eases in log space so every step of the wheel takes the same time.
    const goal = scope ? this.scopeMag : 1;
    this.mag = Math.exp(Math.log(this.mag) + (Math.log(goal) - Math.log(this.mag)) * Math.min(1, dt * 12));
    if (Math.abs(this.mag - goal) < 0.005) this.mag = goal;
    if (scope) {
      // On the rangefinder, above the bridge.
      const h = (s.superBox ? s.superBox.top : spec.freeboard + 8) + 6;
      target.set(p.x - fx * 20, Math.max(p.y + h, 6), p.z - fz * 20);
    } else {
      // Orbit: looking down lifts the camera over the ship, as if on a boom.
      const L = Math.max(60, spec.length);
      const D = (L * 1.05 + 70) * this.dist;
      const e = clamp(0.17 + Math.max(0, -this.pitch) * 0.6, 0.06, 1.1);
      const lift = spec.freeboard + 4;
      target.set(p.x - fx * D * Math.cos(e), Math.max(0, p.y) + lift + D * Math.sin(e), p.z - fz * D * Math.cos(e));
      this.clearTerrain(p, target);
    }
    const snap = this.camPos.distanceToSquared(target) > 1500 * 1500;
    if (snap) this.camPos.copy(target);
    else this.camPos.lerp(target, 1 - Math.exp(-dt * 14));
    const floor = Math.max(waveHeight(this.camPos.x, this.camPos.z, t) + 3, this.game.map.heightAt(this.camPos.x, this.camPos.z) + 8);
    if (this.camPos.y < floor) this.camPos.y = floor;

    // Steady aim: unless the mouse just moved vertically, re-solve the pitch so the view still
    // meets the sea at the held range. Bobbing, boom changes and the scope never shift the aim.
    const looking = own && s.alive && Math.abs(this.freeYaw) < 0.05;
    const cx = this.camPos.x;
    const cy = this.camPos.y;
    const cz = this.camPos.z;
    if (own && s.alive) {
      const ax = Math.sin(this.yaw);
      const az = -Math.cos(this.yaw);
      if (!this.pitchInput && Number.isFinite(this.holdRange)) {
        const tx = p.x + ax * this.holdRange;
        const tz = p.z + az * this.holdRange;
        this.pitch = clamp(-Math.atan2(cy, Math.hypot(tx - cx, tz - cz)), PITCH_MIN, PITCH_MAX);
      } else if (this.pitchInput) {
        if (this.pitch < -1e-4) {
          const hd = cy / Math.tan(-this.pitch);
          this.holdRange = Math.max(30, (cx + ax * hd - p.x) * ax + (cz + az * hd - p.z) * az);
        } else this.holdRange = Infinity;
      }
    }
    this.pitchInput = false;

    const cp = Math.cos(this.pitch);
    tmpDir.set(fx * cp, Math.sin(this.pitch), fz * cp);
    cam.position.copy(this.camPos);
    if (this.shakeAmt > 0.01) {
      const a = this.shakeAmt;
      cam.position.x += (Math.random() - 0.5) * a * 1.6;
      cam.position.y += (Math.random() - 0.5) * a * 1.2;
      cam.position.z += (Math.random() - 0.5) * a * 1.6;
      this.shakeAmt *= Math.exp(-dt * 5);
    }
    tmpA.copy(cam.position).add(tmpDir);
    cam.lookAt(tmpA);
    this.fovKick *= Math.exp(-dt * 4);
    cam.fov = (2 * Math.atan(Math.tan((BASE_FOV * Math.PI) / 360) / this.mag) * 180) / Math.PI + this.fovKick;
    this.rideShell(dt, own);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    if (looking) this.updateAim(tmpDir);
    else this.assist = null;
  }

  /**
   * Shell cam: blend the view toward a chase camera behind the shell, then a slow pull-back
   * from the impact. The aim ray still comes from the normal view, so the guns do not wander.
   */
  private rideShell(dt: number, enabled: boolean): void {
    const sc = this.shellCam;
    sc.update(dt, enabled);
    if (sc.weight <= 0) return;
    const cam = this.camera;
    const w = sc.weight * sc.weight * (3 - 2 * sc.weight);
    tmpQ.copy(cam.quaternion);
    tmpB.copy(cam.position);
    const pull = sc.landed ? sc.holdTime : 0;
    cam.position.copy(sc.pos).addScaledVector(sc.dir, -(SHELL_BACK + pull * 50));
    cam.position.y += SHELL_UP + pull * 18;
    const floor = waveHeight(cam.position.x, cam.position.z, this.game.renderTime) + 3;
    if (cam.position.y < floor) cam.position.y = floor;
    tmpA.copy(sc.pos);
    if (!sc.landed) tmpA.addScaledVector(sc.dir, 80);
    cam.lookAt(tmpA);
    cam.quaternion.copy(tmpQ.slerp(cam.quaternion, w));
    cam.position.lerpVectors(tmpB, cam.position, w);
    cam.fov += (SHELL_FOV - cam.fov) * w;
  }

  /** Ride the newest main-battery shell in, or hand the view back if already riding one. */
  private followShot(): void {
    if (this.shellCam.toggle()) return;
    this.notice = 'No shell in flight';
    this.noticeTime = 1.2;
  }

  /** Cast the crosshair ray from the (unshaken) camera and set the aim point, with assist if on. */
  private updateAim(dir: Vector3): void {
    const me = this.ship;
    const max = this.maxRange();
    const hit = raycast(this.game, me.team, this.camPos, dir, max + 600, me);
    this.aimHit = hit;
    let x = hit.x;
    let z = hit.z;
    if (hit.kind === 'sky') {
      x = me.pos.x + Math.sin(this.yaw) * max;
      z = me.pos.z - Math.cos(this.yaw) * max;
    }
    this.assist = null;
    const ft = this.assistOn || this.lock ? flightTimeFn(me) : null;
    const tgt = ft ? this.assistTarget(hit, x, z, ft) : null;
    if (tgt && ft) {
      const lead = leadPoint(me, tgt, ft);
      const a = assistAim(x, z, tgt.renderPos.x, tgt.renderPos.z, lead.x, lead.z);
      x = a.x;
      z = a.z;
      this.assist = tgt;
    }
    this.aim.set(x, 0, z);
    this.range = dist2D(me.pos.x, me.pos.z, x, z);
  }

  /** Enemy whose hull or lead point sits close to the crosshair (the locked ship always counts). */
  private assistTarget(hit: AimHit, ax: number, az: number, ft: (d: number) => number): Ship | null {
    const me = this.ship;
    if (!this.assistOn) return null;
    if (this.lock) return this.lock;
    if (hit.ship) return hit.ship;
    const reach = ASSIST_PX * (this.zoom ? 1.4 : 1);
    const hw = this.viewW / 2;
    const hh = this.viewH / 2;
    const max = this.maxRange();
    let best: Ship | null = null;
    let bestPx = reach;
    for (const o of this.game.ships) {
      if (!o.alive || o.team === me.team || o.mods.untargetable || o.deep) continue;
      const d = dist2D(me.pos.x, me.pos.z, o.pos.x, o.pos.z);
      if (d > max) continue;
      // Ignore ships far from where the crosshair meets the sea (stops picks through the horizon).
      if (dist2D(ax, az, o.pos.x, o.pos.z) > Math.max(800, d * 0.5)) continue;
      const half = o.spec.length / 2;
      const fx = Math.sin(o.renderHeading) * half;
      const fz = -Math.cos(o.renderHeading) * half;
      const y = o.spec.freeboard * 0.5;
      tmpA.set(o.renderPos.x + fx, y, o.renderPos.z + fz).project(this.camera);
      tmpB.set(o.renderPos.x - fx, y, o.renderPos.z - fz).project(this.camera);
      if (tmpA.z > 1 || tmpB.z > 1) continue;
      let px = segPx(tmpA.x * hw, tmpA.y * hh, tmpB.x * hw, tmpB.y * hh);
      const lead = leadPoint(me, o, ft);
      tmpA.set(lead.x, 2, lead.z).project(this.camera);
      if (tmpA.z <= 1) px = Math.min(px, Math.hypot(tmpA.x * hw, tmpA.y * hh));
      if (px < bestPx) {
        bestPx = px;
        best = o;
      }
    }
    return best;
  }

  /** Lift the chase camera so the hill between it and the ship never hides the ship. */
  private clearTerrain(ship: Vector3, cam: Vector3): void {
    const map = this.game.map;
    const base = ship.y + 10;
    for (const k of [0.2, 0.4, 0.6, 0.8, 1]) {
      const h = map.heightAt(ship.x + (cam.x - ship.x) * k, ship.z + (cam.z - ship.z) * k);
      if (h <= 0) continue;
      const need = base + (h + 15 - base) / k;
      if (cam.y < need) cam.y = need;
    }
  }
}

/** Pixel distance from the screen centre to a segment. */
function segPx(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const u = l2 > 1e-6 ? clamp(-(ax * dx + ay * dy) / l2, 0, 1) : 0;
  return Math.hypot(ax + dx * u, ay + dy * u);
}
