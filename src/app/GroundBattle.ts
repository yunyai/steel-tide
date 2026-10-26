import { Vector3 } from 'three';
import { defaultAssist } from '../core/BattleSetup';
import { audio } from '../fx/Audio';
import { KMH } from '../ground/sim/config';
import { PROP_RUBBLE } from '../ground/sim/props';
import type { GroundGame } from '../ground/sim/GroundGame';
import type { GroundConfig } from '../ground/sim/setup';
import type { VehicleSpec } from '../ground/sim/types';
import type { Vehicle } from '../ground/sim/Vehicle';
import { GroundHUD } from '../ground/view/GroundHUD';
import { buildGroundReport, buildGroundScoreboard } from '../ground/view/GroundReport';
import { GroundScene } from '../ground/view/GroundScene';
import { TankController } from '../ground/view/TankController';
import { buildVehiclePicker } from '../ground/view/VehiclePicker';
import { display, setDisplay } from '../input/Settings';
import type { Viewport } from '../render/Renderer';
import { h } from '../ui/dom';
import { PerfPanel } from '../ui/PerfPanel';
import { buildPause, type PauseExtra } from '../ui/Results';
import { buildSettings } from '../ui/SettingsSheet';
import type { ActiveBattle, BattleLink } from './ActiveBattle';
import type { Shell } from './Shell';

// A ground battle on screen: the drivers' controllers, cameras and HUDs, the battle menu and the
// report. Solo for now: the LAN link arrives with the ground lockstep.

const PAD_START = 9;
const PAD_BACK = 8;

/** Slow motion on your kill or your ultimate: hold at SLOW_MIN, then ease back to full speed. */
const SLOW_MIN = 0.35;
const SLOW_HOLD = 0.3;
const SLOW_EASE = 0.6;
/** Shake falls off to nothing this far from the camera (land fights are closer than sea ones). */
const SHAKE_REACH = 700;

const right = new Vector3();

/** The view a driver's controller drives. */
function driverView(pc: TankController): Viewport {
  return {
    camera: pc.camera,
    get team() {
      return pc.v.team;
    },
    rect: { x: 0, y: 0, w: 1, h: 1 },
    focus: { x: pc.v.renderX, z: pc.v.renderZ },
    get hide() {
      return pc.scoped && pc.focus === pc.v ? pc.v : null;
    },
    get fogScale() {
      return 1 - 0.45 * Math.min(1, (pc.mag - 1) / 2);
    },
  };
}

export class GroundBattle implements ActiveBattle {
  readonly pcs: TankController[];
  readonly huds: GroundHUD[];
  readonly viewports: Viewport[];
  readonly scene: GroundScene;
  /** Solo: the battle is frozen. */
  paused = false;
  private pausedAt = 0;
  ended = false;
  /** Seconds left before the report appears (lets the last wreck settle). */
  private reportIn = 0;
  private scoreboard: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;
  private pickerSync: (() => void) | null = null;
  private perf: PerfPanel | null = null;
  private off: (() => void)[] = [];
  private slow = 0;

  constructor(
    private shell: Shell,
    readonly config: GroundConfig,
    readonly game: GroundGame,
    readonly link: BattleLink | null,
    local: Vehicle | undefined = game.humans()[0],
  ) {
    const { menu, menuLayer, renderer, hudLayer, input, canvas } = shell;
    audio.beginBattle('ground');
    menu.hide();
    menuLayer.style.pointerEvents = 'none';
    this.scene = new GroundScene(renderer, game);
    renderer.attach(this.scene);
    const humans = local ? [local] : [];
    this.pcs = humans.map((v, i) => {
      const pcfg = config.players[v.humanIndex];
      const device = pcfg?.device ?? 'mouse';
      return new TankController(v, device, i, game, pcfg?.assist ?? defaultAssist(device));
    });
    this.viewports = this.pcs.map(driverView);
    this.huds = this.pcs.map((pc) => {
      const hud = new GroundHUD(game, pc, input);
      hudLayer.append(hud.root);
      return hud;
    });

    this.setLocals();
    const shake = (s: { x: number; z: number; amount: number }) => {
      for (const pc of this.pcs) {
        const d = Math.hypot(pc.camera.position.x - s.x, pc.camera.position.z - s.z);
        const k = Math.max(0, 1 - d / SHAKE_REACH);
        if (k > 0) pc.shake(s.amount * k * k);
      }
    };
    this.scene.effects.onShake = shake;
    this.scene.skillFx.onShake = shake;
    this.off.push(
      game.events.on('gameOver', (g) => {
        audio.stopBattle();
        this.shell.input.capture = false;
        this.ended = true;
        this.reportIn = 3.5;
        const win = g.winner !== -1 && g.winner === this.mine?.team;
        audio.ui(win || config.type === 'freeplay' ? 'victory' : 'defeat');
        link?.over();
      }),
      game.events.on('skill', (a) => {
        const pc = this.pcs.find((p) => p.v === a.v);
        if (!pc) return;
        const spec = a.v.skills[a.index].spec;
        pc.fovKick = spec.ult ? 8 : 4;
        if (spec.ult) {
          this.slow = SLOW_HOLD + SLOW_EASE;
          renderer.flash(0.22, spec.accent);
        }
      }),
      game.events.on('destroyed', (e) => {
        const k = e.killer;
        const me = this.mine;
        if (me && k && e.v.team !== me.team && (k === me || k.summonOwner === me)) this.slow = SLOW_HOLD + SLOW_EASE;
      }),
      // Free play: controllers and HUDs follow the driver into the new hull on their own.
      game.events.on('vehicleChanged', () => this.setLocals()),
      game.events.on('gunFired', (e) => {
        for (const pc of this.pcs) if (pc.v === e.v) pc.shake(0.08 + e.caliber / 1500);
      }),
    );

    const click = () => {
      if (!this.paused && !this.ended && this.usesMouse && !input.aiming) input.requestLock();
    };
    canvas.addEventListener('click', click);
    this.off.push(() => canvas.removeEventListener('click', click));

    input.capture = true;
    input.onLockChange = (locked) => {
      if (!locked && shell.battle === this && !this.ended && !this.paused && this.usesMouse) this.setPaused(true);
    };
    if (this.usesMouse) input.requestLock();
  }

  private get mine(): Vehicle | undefined {
    return this.pcs[0]?.v;
  }

  private get usesMouse(): boolean {
    return this.pcs.some((p) => p.device === 'mouse');
  }

  /** Effects that treat your own vehicle differently (nearer sounds, your shells' tracers). */
  private setLocals(): void {
    const locals = this.pcs.map((p) => p.v);
    this.scene.effects.locals = locals;
    this.scene.skillFx.locals = locals;
  }

  dispose(): void {
    audio.stopBattle();
    const { hudLayer, overlayLayer, renderer, input, menuLayer } = this.shell;
    for (const f of this.off) f();
    for (const hud of this.huds) hud.dispose();
    for (const pc of this.pcs) pc.dispose();
    this.perf?.dispose();
    hudLayer.replaceChildren();
    overlayLayer.replaceChildren();
    overlayLayer.style.pointerEvents = 'none';
    renderer.detach();
    input.capture = false;
    input.onLockChange = null;
    input.releaseLock();
    audio.engine(0);
    menuLayer.style.pointerEvents = '';
  }

  private setOverlay(el: HTMLElement | null): void {
    this.pickerSync = null;
    this.overlay?.remove();
    this.overlay = el;
    this.shell.overlayLayer.style.pointerEvents = el ? '' : 'none';
    if (el) this.shell.overlayLayer.append(el);
  }

  private setPaused(paused: boolean): void {
    if (this.ended || this.paused === paused) return;
    this.paused = paused;
    this.shell.input.capture = !paused;
    if (paused) {
      this.pausedAt = performance.now();
      this.shell.input.releaseLock();
      this.showPauseMenu();
    } else {
      this.setOverlay(null);
      if (this.usesMouse) this.shell.input.requestLock();
    }
  }

  private showPauseMenu(): void {
    const resume = this.usesMouse ? 'Resume to take the controls again.' : 'Press Start to resume.';
    const extra: PauseExtra[] = [
      {
        label: 'Settings',
        run: () => {
          audio.ui('click');
          this.setOverlay(h('div', { class: 'overlay' }, buildSettings({ back: () => this.showPauseMenu(), click: () => audio.ui('click') })));
        },
      },
    ];
    if (this.config.type === 'freeplay' && this.pcs.length) {
      extra.push(
        {
          label: 'Change vehicle',
          run: () => {
            audio.ui('click');
            this.openPicker();
          },
        },
        {
          label: 'End battle',
          run: () => {
            audio.ui('click');
            this.endFreePlay();
          },
        },
      );
    }
    this.setOverlay(
      buildPause(
        {
          resume: () => {
            audio.ui('click');
            this.setPaused(false);
          },
          quit: () => {
            audio.ui('click');
            this.shell.closeBattle();
            this.shell.menu.showTitle();
          },
        },
        `The battle is frozen. ${resume}`,
        'Paused',
        extra,
      ),
    );
  }

  private openPicker(): void {
    if (!this.pcs.length) return;
    const picker = buildVehiclePicker({
      vehicle: () => this.pcs[0].v,
      era: this.config.era ?? 'historic',
      titans: this.config.titans !== false,
      click: () => audio.ui('click'),
      back: () => this.showPauseMenu(),
      pick: (spec, now) => {
        this.orderVehicle(spec, now);
        this.setPaused(false);
      },
    });
    this.setOverlay(picker.el);
    this.pickerSync = picker.sync;
  }

  private orderVehicle(spec: VehicleSpec, now: boolean): void {
    const pc = this.pcs[0];
    if (!pc) return;
    const v = pc.v;
    this.game.pickVehicle(v, spec.id);
    if (now) this.game.redeploy(v);
    if (!now && v.alive && spec !== v.spec) {
      pc.notice = `${spec.name} rolls out from your next respawn`;
      pc.noticeTime = 4;
    }
  }

  private endFreePlay(): void {
    this.paused = false;
    this.setOverlay(null);
    this.game.finish(-1, 'You ended free play');
    this.reportIn = 0.4;
  }

  private showReport(): void {
    const { shell } = this;
    shell.input.releaseLock();
    this.scoreboard?.remove();
    this.scoreboard = null;
    const humans = this.pcs.map((p) => p.v);
    this.setOverlay(
      buildGroundReport(this.game, humans, {
        again: () => {
          audio.ui('click');
          shell.startSolo({ ...this.config, seed: Math.floor(Math.random() * 1e9) });
        },
        ships: () => {
          audio.ui('click');
          shell.closeBattle();
          shell.menu.showGarage();
        },
        menu: () => {
          audio.ui('click');
          shell.closeBattle();
          shell.menu.showTitle();
        },
      }),
    );
  }

  private timeScale(dt: number): number {
    if (this.slow <= 0) return 1;
    this.slow = Math.max(0, this.slow - dt);
    const t = Math.min(1, this.slow / SLOW_EASE);
    return 1 - (1 - SLOW_MIN) * t * t * (3 - 2 * t);
  }

  private measure(dt: number, t0: number, t1: number, t2: number, t3: number): void {
    if (!display().perf) {
      this.perf?.dispose();
      this.perf = null;
      return;
    }
    if (!this.perf) {
      const { renderer } = this.shell;
      const g = this.game;
      this.perf = new PerfPanel(this.shell.hudLayer, () => {
        const r = renderer.gl.info.render;
        const tris = r.triangles >= 1e6 ? `${(r.triangles / 1e6).toFixed(1)}M` : `${Math.round(r.triangles / 1000)}k`;
        const particles = renderer.alpha.count + renderer.add.count + renderer.flat.count;
        const standing = g.props.list.filter((p) => p.state !== PROP_RUBBLE).length;
        return [
          `${r.calls} draw calls, ${tris} triangles`,
          `${g.vehicles.filter((v) => v.alive).length} vehicles, ${g.shells.list.length} shells, ${g.missiles.list.length} missiles, ${g.strikes.list.length} strikes`,
          `${standing} of ${g.props.list.length} props standing, ${particles} particles`,
        ];
      });
    }
    const t4 = performance.now();
    this.perf.sample({ frame: dt * 1000, sim: t1 - t0, scene: t2 - t1, draw: t3 - t2, hud: t4 - t3 });
  }

  tick(dt: number): void {
    const t0 = performance.now();
    const { input, renderer, canvas, overlayLayer } = this.shell;
    const g = this.game;
    if (input.pressed('F3')) setDisplay({ perf: !display().perf });
    const padPause = this.pcs.some((p) => p.padIndex >= 0 && input.padPressed(p.padIndex, PAD_START));
    if (!this.ended && (input.pressed('Escape') || padPause)) {
      const canResume = !this.usesMouse || input.fallback;
      if (!this.paused) this.setPaused(true);
      else if (canResume && performance.now() - this.pausedAt > 250) this.setPaused(false);
    }

    const frozen = this.paused;
    const k = frozen ? 0 : this.timeScale(dt);
    if (!frozen) {
      if (!this.ended) for (const pc of this.pcs) pc.control(dt, input);
      g.advance(dt * k);
    }
    const t1 = performance.now();
    for (const pc of this.pcs) pc.updateCamera(frozen ? 0 : dt);
    renderer.update(dt * k, this.pcs.map((p) => p.camera));
    const t2 = performance.now();
    this.viewports.forEach((vp, i) => {
      const pc = this.pcs[i];
      vp.focus.x = pc.focus.renderX;
      vp.focus.z = pc.focus.renderZ;
      pc.viewW = canvas.clientWidth * vp.rect.w;
      pc.viewH = canvas.clientHeight * vp.rect.h;
    });
    renderer.render(this.viewports);
    const t3 = performance.now();
    for (const hud of this.huds) hud.update(dt);
    this.pickerSync?.();
    this.measure(dt, t0, t1, t2, t3);

    audio.listeners = this.pcs.map((p) => p.camera.position);
    if (this.pcs.length === 1) audio.right.copy(right.set(1, 0, 0).applyQuaternion(this.pcs[0].camera.quaternion));
    const live = this.pcs.map((p) => p.v).filter((v) => v.alive);
    audio.engine(frozen || !live.length ? 0 : Math.max(...live.map((v) => Math.min(1, Math.abs(v.speed) / (v.spec.drive.maxSpeed * KMH)))));

    const board = !this.ended && !this.paused && this.pcs.length > 0 && (input.isDown('Tab') || this.pcs.some((p) => p.padIndex >= 0 && input.padDown(p.padIndex, PAD_BACK)));
    if (board && !this.scoreboard) {
      this.scoreboard = buildGroundScoreboard(g, this.pcs[0].v);
      overlayLayer.append(this.scoreboard);
    } else if (!board && this.scoreboard) {
      this.scoreboard.remove();
      this.scoreboard = null;
    }

    if (this.ended && this.reportIn > 0) {
      this.reportIn -= dt;
      if (this.reportIn <= 0) this.showReport();
    }
  }
}
