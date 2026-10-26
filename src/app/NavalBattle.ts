import { Vector3 } from 'three';
import { type BattleConfig, defaultAssist } from '../core/BattleSetup';
import type { Game } from '../core/Game';
import type { ShipSpec } from '../core/types';
import { audio } from '../fx/Audio';
import { display, setDisplay } from '../input/Settings';
import { saveBest } from '../modes/BossRush';
import { draftOrders } from '../net/navalTurns';
import { PlayerController } from '../player/PlayerController';
import { NavalScene } from '../render/NavalScene';
import type { Viewport } from '../render/Renderer';
import { emptyControl, type Ship } from '../ships/Ship';
import { h } from '../ui/dom';
import { HUD } from '../ui/HUD';
import { PerfPanel } from '../ui/PerfPanel';
import { buildPause, buildReport, buildScoreboard, type PauseExtra } from '../ui/Results';
import { buildSettings } from '../ui/SettingsSheet';
import { buildShipPicker } from '../ui/ShipPicker';
import type { ActiveBattle, BattleLink } from './ActiveBattle';
import type { Shell } from './Shell';

// A naval battle on screen: the captains' controllers, cameras and HUDs, the battle menu and
// the report. A solo battle steps its own Game; a LAN battle is stepped by its lockstep link.

const PAD_START = 9;
const PAD_BACK = 8;

/** Slow motion on your kill, your ultimate or a boss arriving: hold at SLOW_MIN, then ease back to full speed. */
const SLOW_MIN = 0.35;
const SLOW_HOLD = 0.3;
const SLOW_EASE = 0.6;
/** Time scale while the shell cam follows a shell. */
const SHELL_CAM_SLOW = 0.45;

const right = new Vector3();

/** The view a captain's controller drives. */
function captainView(pc: PlayerController): Viewport {
  return {
    camera: pc.camera,
    team: pc.ship.team,
    rect: { x: 0, y: 0, w: 1, h: 1 },
    focus: { x: pc.ship.pos.x, z: pc.ship.pos.z },
    get hide() {
      return pc.zoom && pc.focus === pc.ship ? pc.ship : null;
    },
    // Optics cut through the haze as the scope opens.
    get fogScale() {
      return 1 - 0.45 * Math.min(1, (pc.mag - 1) / 2);
    },
  };
}

export class NavalBattle implements ActiveBattle {
  readonly pcs: PlayerController[];
  readonly huds: HUD[];
  readonly viewports: Viewport[];
  /** The sea, islands, ships and effects this battle draws. */
  readonly scene: NavalScene;
  /** Solo: the battle is frozen. LAN: the battle menu is open (nothing freezes). */
  paused = false;
  /** performance.now() when the battle was last paused. */
  private pausedAt = 0;
  ended = false;
  /** Seconds left before the report appears (lets the last ship settle). */
  private reportIn = 0;
  private scoreboard: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;
  /** Keeps the open ship picker in step with the captain's ship. */
  private pickerSync: (() => void) | null = null;
  /** The performance readout, while it is switched on. */
  private perf: PerfPanel | null = null;
  private off: (() => void)[] = [];
  /** Seconds of slow motion left. */
  private slow = 0;
  /** Boss Rush: this run set a new best score for the ship. */
  private newBest = false;

  /** `local` is the LAN captain's ship; solo battles show their first captain. */
  constructor(
    private shell: Shell,
    readonly config: BattleConfig,
    readonly game: Game,
    readonly link: BattleLink | null,
    local: Ship | undefined = game.humans()[0],
  ) {
    const { menu, menuLayer, renderer, hudLayer, input, canvas } = shell;
    audio.beginBattle();
    menu.hide();
    menuLayer.style.pointerEvents = 'none';
    this.scene = new NavalScene(renderer, game);
    renderer.attach(this.scene);
    const humans = local ? [local] : [];
    this.pcs = humans.map((s, i) => {
      // LAN: the server knows only the ship; controls and fire control are this machine's own choice.
      const pcfg = link ? menu.captain : config.players[s.humanIndex];
      const device = pcfg?.device ?? 'mouse';
      const pc = new PlayerController(s, device, i, game, pcfg?.assist ?? defaultAssist(device));
      if (link) pc.draft = emptyControl();
      return pc;
    });
    this.viewports = this.pcs.map(captainView);
    for (const pc of this.pcs) this.scene.aiming.set(pc.camera, pc);
    this.huds = this.pcs.map((pc) => {
      const h = new HUD(game, pc, input);
      hudLayer.append(h.root);
      return h;
    });

    const fx = this.scene.effects;
    fx.locals = humans;
    this.scene.skillFx.locals = humans;
    fx.onShake = (s) => {
      for (const pc of this.pcs) {
        const d = Math.hypot(pc.camera.position.x - s.x, pc.camera.position.z - s.z);
        const k = Math.max(0, 1 - d / 1600);
        if (k > 0) pc.shake(s.amount * k * k);
      }
    };
    this.off.push(
      game.events.on('gameOver', (g) => {
        audio.stopBattle();
        this.shell.input.capture = false;
        this.ended = true;
        this.reportIn = 3.5;
        const rush = game.rush;
        const me = this.mine;
        if (rush && me) this.newBest = saveBest(me.base.id, rush.wave, rush.total, rush.survival);
        const win = g.winner !== -1 && g.winner === me?.team;
        audio.ui(win || config.type === 'freeplay' ? 'victory' : 'defeat');
        link?.over();
      }),
      game.events.on('blink', e => {
        if(!e.dodge) return;
        const pc=this.pcs.find(p=>p.ship===e.ship);
        if(pc){pc.notice='SIDESTEP';pc.noticeTime=0.35;}
      }),
      game.events.on('skill', (a) => {
        const pc = this.pcs.find((p) => p.ship === a.ship);
        if (!pc) return;
        // The view punches out as a skill fires; an ultimate also slows time.
        const spec = a.ship.skills[a.index].spec;
        pc.fovKick = spec.ult ? 12 : 5;
        if (spec.ult) {
          this.slow = SLOW_HOLD + SLOW_EASE;
          renderer.flash(0.22, spec.accent);
        }
      }),
      game.events.on('wave', (w) => {
        if (w.boss) this.slow = SLOW_HOLD + SLOW_EASE + 0.4;
      }),
      game.events.on('shipSunk', (s) => {
        const k = s.killer;
        const me = this.mine;
        if (me && k && s.ship.team !== me.team && (k === me || k.summonOwner === me)) this.slow = SLOW_HOLD + SLOW_EASE;
      }),
      // Titan Shift: the captain's HUD is laid out again for the form's nine skills (or back to three).
      game.events.on('shift', ({ ship, on }) => {
        const i = this.pcs.findIndex((p) => p.ship === ship);
        if (i < 0) return;
        this.huds[i].dispose();
        this.huds[i] = new HUD(this.game, this.pcs[i], this.shell.input);
        this.shell.hudLayer.append(this.huds[i].root);
        if (on) {
          this.slow = SLOW_HOLD + SLOW_EASE + 0.3;
          this.pcs[i].fovKick = 16;
        }
      }),
      // Free play: the captain's orders and view follow them into their next ship.
      game.events.on('shipChanged', ({ old, ship }) => {
        const i = this.pcs.findIndex((p) => p.ship === old);
        if (i >= 0) this.changeCaptain(i, ship);
      }),
      // Light guns still nudge your own camera; heavy ones already shake it through the effects.
      game.events.on('gunFired', (e) => {
        if (e.secondary || e.caliber >= 280) return;
        for (const pc of this.pcs) if (pc.ship === e.ship) pc.shake(0.06 + e.caliber / 2000);
      }),
    );

    // Click the battle view to (re)take mouse control.
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

  /** The local captain's ship (Free play swaps it on a change of ship). */
  private get mine(): Ship | undefined {
    return this.pcs[0]?.ship;
  }

  private get usesMouse(): boolean {
    return this.pcs.some((p) => p.device === 'mouse');
  }

  dispose(): void {
    audio.stopBattle();
    const { hudLayer, overlayLayer, renderer, input, menuLayer } = this.shell;
    for (const f of this.off) f();
    for (const h of this.huds) h.dispose();
    this.perf?.dispose();
    hudLayer.replaceChildren();
    overlayLayer.replaceChildren();
    // An empty overlay layer left catching the pointer would swallow clicks on the next battle's view.
    overlayLayer.style.pointerEvents = 'none';
    renderer.detach();
    input.capture = false;
    input.onLockChange = null;
    input.releaseLock();
    audio.engine(0);
    menuLayer.style.pointerEvents = '';
  }

  /** Free play: captain `i` changed ship. Controls, camera and HUD start over on the new hull. */
  private changeCaptain(i: number, ship: Ship): void {
    const old = this.pcs[i];
    const pc = new PlayerController(ship, old.device, old.index, this.game, old.assistOn);
    this.scene.aiming.delete(old.camera);
    this.scene.aiming.set(pc.camera, pc);
    if (this.link) pc.draft = emptyControl();
    this.pcs[i] = pc;
    this.viewports[i] = captainView(pc);
    this.huds[i].dispose();
    this.huds[i] = new HUD(this.game, pc, this.shell.input);
    this.shell.hudLayer.append(this.huds[i].root);
    const locals = this.pcs.map((p) => p.ship);
    this.scene.effects.locals = locals;
    this.scene.skillFx.locals = locals;
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

  /** The Esc sheet; Free play adds changing ship and (solo, or for the LAN host) ending the battle. */
  private showPauseMenu(): void {
    const resume = this.usesMouse ? 'Resume to take the helm again.' : 'Press Start to resume.';
    const hint = this.link ? `The battle carries on while this menu is open, and your ship holds its course. ${resume}` : `The battle is frozen. ${resume}`;
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
      extra.push({
        label: 'Change ship',
        run: () => {
          audio.ui('click');
          this.openShipPicker();
        },
      });
      if (!this.link || this.link.host) {
        extra.push({
          label: 'End battle',
          run: () => {
            audio.ui('click');
            this.endFreePlay();
          },
        });
      }
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
            if (this.link) return this.link.leave();
            this.shell.closeBattle();
            this.shell.menu.showTitle();
          },
        },
        hint,
        this.link ? 'Battle menu' : 'Paused',
        extra,
      ),
    );
  }

  private openShipPicker(): void {
    const pc = this.pcs[0];
    if (!pc) return;
    const picker = buildShipPicker({
      ship: () => this.pcs[0].ship,
      era: this.config.era ?? 'historic',
      titans: this.config.titans !== false,
      click: () => audio.ui('click'),
      back: () => this.showPauseMenu(),
      pick: (spec, now) => {
        this.orderShip(spec, now);
        this.setPaused(false);
      },
    });
    this.setOverlay(picker.el);
    this.pickerSync = picker.sync;
  }

  /** Free play: sail `spec` from the next respawn, and with `now` leave the fight at once to change into it. */
  private orderShip(spec: ShipSpec, now: boolean): void {
    const pc = this.pcs[0];
    if (!pc) return;
    const ship = pc.ship;
    // LAN: like every other order, the pick reaches the ship through the turns.
    if (this.link) this.link.lockstep.sendEdge(now ? { sp: spec.id, rd: 1 } : { sp: spec.id });
    else {
      this.game.pickShip(ship, spec.id);
      if (now) this.game.redeploy(ship);
    }
    if (!now && ship.alive && spec !== ship.spec) {
      pc.notice = `${spec.name} sails from your next respawn`;
      pc.noticeTime = 4;
    }
  }

  /** Free play has no result to wait for: the solo captain or the LAN host calls it. */
  private endFreePlay(): void {
    if (this.link) {
      this.link.end();
      this.setPaused(false);
      return;
    }
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
    const humans = this.pcs.map((p) => p.ship);
    const solo = {
      again: () => {
        audio.ui('click');
        shell.startSolo({ ...this.config, seed: Math.floor(Math.random() * 1e9) });
      },
      ships: () => {
        audio.ui('click');
        shell.closeBattle();
        shell.menu.showHangar(this.config.type === 'bossrush' || this.config.type === 'survival' ? 'rush' : 'battle');
      },
      menu: () => {
        audio.ui('click');
        shell.closeBattle();
        shell.menu.showTitle();
      },
    };
    const link = this.link;
    const lanActions = link && {
      lobby: () => {
        audio.ui('click');
        link.toLobby();
      },
      leave: () => {
        audio.ui('click');
        link.leaveLobby();
      },
    };
    this.setOverlay(buildReport(this.game, humans, this.newBest, lanActions || solo));
  }

  private timeScale(dt: number): number {
    if (this.slow <= 0) return 1;
    this.slow = Math.max(0, this.slow - dt);
    const t = Math.min(1, this.slow / SLOW_EASE);
    return 1 - (1 - SLOW_MIN) * t * t * (3 - 2 * t);
  }

  /** Feed the performance readout, opening or closing it as the setting says. */
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
        const lines = [
          `${r.calls} draw calls, ${tris} triangles`,
          `${g.ships.filter((s) => s.alive).length} ships, ${g.shells.shells.length} shells, ${g.torps.torps.length} torpedoes, ${g.air.squadrons.length} squadrons`,
          `${particles} particles`,
        ];
        const ls = this.link?.lockstep;
        if (ls) lines.push(`LAN: ${ls.backlog} ticks buffered${ls.catchingUp ? ', catching up' : ''}`);
        return lines;
      });
    }
    const t4 = performance.now();
    this.perf.sample({ frame: dt * 1000, sim: t1 - t0, scene: t2 - t1, draw: t3 - t2, hud: t4 - t3 });
  }

  tick(dt: number): void {
    const t0 = performance.now();
    const { input, renderer, canvas, overlayLayer } = this.shell;
    const g = this.game;
    const link = this.link;
    if (input.pressed('F3')) setDisplay({ perf: !display().perf });
    const padPause = this.pcs.some((p) => p.padIndex >= 0 && input.padPressed(p.padIndex, PAD_START));
    if (!this.ended && (input.pressed('Escape') || padPause)) {
      // Esc also releases the pointer lock (which pauses); it must not then immediately resume.
      // Mouse captains resume with the button or a click, since the lock needs a click anyway.
      const canResume = !this.usesMouse || input.fallback;
      if (!this.paused) this.setPaused(true);
      else if (canResume && performance.now() - this.pausedAt > 250) this.setPaused(false);
    }

    // Solo, riding a shell in slows the battle so the flight reads. A LAN battle is shared, so its
    // clock never bends: no pause, no slow motion.
    const riding = this.pcs.some((p) => p.shellCam.active);
    const frozen = this.paused && !link;
    const k = link ? 1 : frozen ? 0 : Math.min(this.timeScale(dt), riding ? SHELL_CAM_SLOW : 1);
    if (link) {
      for (const pc of this.pcs) {
        if (!this.ended && !this.paused) pc.control(dt, input);
        // With the menu up the ship holds course but stops shooting.
        else pc.out.fire = false;
        const [c, e] = draftOrders(pc.out);
        link.lockstep.sendOrders(c, e);
      }
      link.lockstep.advance(dt);
      link.frame(dt);
    } else if (!frozen) {
      if (!this.ended) for (const pc of this.pcs) pc.control(dt, input);
      g.advance(dt * k);
    }
    const t1 = performance.now();
    for (const pc of this.pcs) pc.updateCamera(frozen ? 0 : dt);
    renderer.update(dt * k, this.pcs.map((p) => p.camera));
    const t2 = performance.now();
    this.viewports.forEach((vp, i) => {
      const pc = this.pcs[i];
      vp.focus.x = pc.focus.pos.x;
      vp.focus.z = pc.focus.pos.z;
      pc.viewW = canvas.clientWidth * vp.rect.w;
      pc.viewH = canvas.clientHeight * vp.rect.h;
    });
    renderer.render(this.viewports);
    const t3 = performance.now();
    for (const h of this.huds) h.update(dt);
    this.pickerSync?.();
    this.measure(dt, t0, t1, t2, t3);

    // Audio follows the cameras; single-viewport games get stereo panning.
    audio.listeners = this.pcs.map((p) => p.camera.position);
    if (this.pcs.length === 1) audio.right.copy(right.set(1, 0, 0).applyQuaternion(this.pcs[0].camera.quaternion));
    const live = this.pcs.map((p) => p.ship).filter((s: Ship) => s.alive);
    audio.engine(frozen || !live.length ? 0 : Math.max(...live.map((s) => Math.abs(s.speed) / s.maxSpeed)));

    // Scoreboard while Tab (or a pad's Back) is held.
    const board = !this.ended && !this.paused && this.pcs.length > 0 && (input.isDown('Tab') || this.pcs.some((p) => p.padIndex >= 0 && input.padDown(p.padIndex, PAD_BACK)));
    if (board && !this.scoreboard) {
      this.scoreboard = buildScoreboard(g, this.pcs[0].ship);
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
