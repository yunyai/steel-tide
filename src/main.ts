// Deterministic maths first, before any module computes anything: LAN peers must agree bit for bit.
import './core/installDetMath';
import './ui/styles.css';
import { Vector3 } from 'three';
import { type BattleConfig, defaultAssist } from './core/BattleSetup';
import { Game } from './core/Game';
import { audio } from './fx/Audio';
import { Input } from './input/Input';
import { stateHash } from './net/hash';
import { Lockstep } from './net/Lockstep';
import { NetClient } from './net/NetClient';
import { type ServerMsg, TURN_TICKS, type Turn } from './net/protocol';
import { PlayerController } from './player/PlayerController';
import { Renderer, type Viewport } from './render/Renderer';
import { Showcase } from './render/Showcase';
import { HUD } from './ui/HUD';
import { Lobby } from './ui/Lobby';
import { Menu } from './ui/Menu';
import { saveBest } from './modes/BossRush';
import { buildPause, buildReport, buildScoreboard } from './ui/Results';
import { emptyControl, type Ship } from './ships/Ship';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const ui = document.getElementById('ui')!;
const hudLayer = document.createElement('div');
const menuLayer = document.createElement('div');
const overlayLayer = document.createElement('div');
for (const l of [hudLayer, menuLayer, overlayLayer]) {
  l.style.position = 'absolute';
  l.style.inset = '0';
  l.style.pointerEvents = 'none';
  ui.append(l);
}
menuLayer.style.pointerEvents = '';
// LAN status line (waiting for captains, catching up, reconnecting), above everything.
const netBanner = document.createElement('div');
netBanner.className = 'net-banner';
netBanner.setAttribute('role', 'status');
netBanner.hidden = true;
ui.append(netBanner);

const renderer = new Renderer(canvas);
const input = new Input(canvas);
const showcase = new Showcase(renderer.gl);

const PAD_START = 9;
const PAD_BACK = 8;

/** A LAN battle on this peer: the lockstep that feeds it, and how it got here. */
interface LanBattle {
  config: BattleConfig;
  you: number;
  game: Game;
  lockstep: Lockstep;
  /** Replaying the server's log before the battle is shown (rejoining, or after a desync). */
  replaying: boolean;
  /** Resyncs requested in this battle; past MAX_RESYNCS we stop and play on. */
  resyncs: number;
  /** A resync was asked for and its log has not arrived yet. */
  awaitingLog: boolean;
  sentOver: boolean;
  /** Seconds the turn buffer has been empty. */
  starved: number;
}

const MAX_RESYNCS = 3;

interface Battle {
  config: BattleConfig;
  game: Game;
  pcs: PlayerController[];
  huds: HUD[];
  viewports: Viewport[];
  /** Solo: the battle is frozen. LAN: the battle menu is open (nothing freezes). */
  paused: boolean;
  /** performance.now() when the battle was last paused. */
  pausedAt: number;
  ended: boolean;
  /** Seconds left before the report appears (lets the last ship settle). */
  reportIn: number;
  scoreboard: HTMLElement | null;
  overlay: HTMLElement | null;
  off: (() => void)[];
  /** Seconds of slow motion left. */
  slow: number;
  /** Boss Rush: this run set a new best score for the ship. */
  newBest: boolean;
  net: LanBattle | null;
}

/** Slow motion on your kill, your ultimate or a boss arriving: hold at SLOW_MIN, then ease back to full speed. */
const SLOW_MIN = 0.35;
const SLOW_HOLD = 0.3;
const SLOW_EASE = 0.6;
/** Time scale while the shell cam follows a shell. */
const SHELL_CAM_SLOW = 0.45;

function timeScale(b: Battle, dt: number): number {
  if (b.slow <= 0) return 1;
  b.slow = Math.max(0, b.slow - dt);
  const t = Math.min(1, b.slow / SLOW_EASE);
  return 1 - (1 - SLOW_MIN) * t * t * (3 - 2 * t);
}

let battle: Battle | null = null;
/** The LAN battle in progress here, shown or still replaying. */
let lan: LanBattle | null = null;
let net: NetClient | null = null;
let lobby: Lobby | null = null;

const menu = new Menu(menuLayer, {
  start: (config) => startBattle(config),
  preview: (spec, offset) => {
    showcase.setShip(spec);
    showcase.offset = offset;
  },
  click: () => audio.ui('click'),
  lan: () => openLan(),
});

// Audio needs a user gesture before it can start.
const unlockAudio = () => {
  audio.init();
  window.removeEventListener('pointerdown', unlockAudio);
  window.removeEventListener('keydown', unlockAudio);
};
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);

function usesMouse(b: Battle): boolean {
  return b.pcs.some((p) => p.device === 'mouse');
}

function startBattle(config: BattleConfig): void {
  endBattle();
  presentBattle(config, new Game(config), null);
}

/** Put a built battle on screen: renderer, controllers, HUD. LAN battles get one captain, the local one. */
function presentBattle(config: BattleConfig, game: Game, nb: LanBattle | null): void {
  menu.hide();
  lobby?.hide();
  menuLayer.style.pointerEvents = 'none';
  renderer.attach(game);
  const local = nb ? nb.lockstep.ship : game.humans()[0];
  const humans = local ? [local] : [];
  const pcs = humans.map((s, i) => {
    // LAN: the server knows only the ship; controls and fire control are this machine's own choice.
    const pcfg = nb ? menu.captain : config.players[s.humanIndex];
    const device = pcfg?.device ?? 'mouse';
    const pc = new PlayerController(s, device, i, game, pcfg?.assist ?? defaultAssist(device));
    if (nb) pc.draft = emptyControl();
    return pc;
  });
  const viewports: Viewport[] = pcs.map((pc) => ({
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
  }));
  const huds = pcs.map((pc) => {
    const h = new HUD(game, pc, input);
    hudLayer.append(h.root);
    return h;
  });
  const b: Battle = { config, game, pcs, huds, viewports, paused: false, pausedAt: 0, ended: false, reportIn: 0, scoreboard: null, overlay: null, off: [], slow: 0, newBest: false, net: nb };
  const me = humans[0];
  battle = b;

  const fx = renderer.effects!;
  fx.locals = humans;
  renderer.skillFx!.locals = humans;
  fx.onShake = (s) => {
    for (const pc of pcs) {
      const d = Math.hypot(pc.camera.position.x - s.x, pc.camera.position.z - s.z);
      const k = Math.max(0, 1 - d / 1600);
      if (k > 0) pc.shake(s.amount * k * k);
    }
  };
  b.off.push(
    game.events.on('gameOver', (g) => {
      b.ended = true;
      b.reportIn = 3.5;
      const rush = game.rush;
      if (rush && me) b.newBest = saveBest(me.spec.id, rush.wave, rush.total, rush.survival);
      const win = g.winner !== -1 && g.winner === me?.team;
      audio.ui(win ? 'victory' : 'defeat');
      if (nb && !nb.sentOver) {
        nb.sentOver = true;
        net?.send({ t: 'over' });
      }
    }),
    game.events.on('skill', (a) => {
      const pc = pcs.find((p) => p.ship === a.ship);
      if (!pc) return;
      // The view punches out as a skill fires; an ultimate also slows time.
      const spec = a.ship.skills[a.index].spec;
      pc.fovKick = spec.ult ? 12 : 5;
      if (spec.ult) {
        b.slow = SLOW_HOLD + SLOW_EASE;
        renderer.flash(0.22, spec.accent);
      }
    }),
    game.events.on('wave', (w) => {
      if (w.boss) b.slow = SLOW_HOLD + SLOW_EASE + 0.4;
    }),
    game.events.on('shipSunk', (s) => {
      const k = s.killer;
      if (me && k && s.ship.team !== me.team && (k === me || k.summonOwner === me)) b.slow = SLOW_HOLD + SLOW_EASE;
    }),
    // Light guns still nudge your own camera; heavy ones already shake it through the effects.
    game.events.on('gunFired', (e) => {
      if (e.secondary || e.caliber >= 280) return;
      for (const pc of pcs) if (pc.ship === e.ship) pc.shake(0.06 + e.caliber / 2000);
    }),
  );

  input.capture = true;
  input.onLockChange = (locked) => {
    if (!locked && battle === b && !b.ended && !b.paused && usesMouse(b)) setPaused(b, true);
  };
  if (usesMouse(b)) input.requestLock();
}

function endBattle(): void {
  const b = battle;
  if (!b) return;
  for (const f of b.off) f();
  for (const h of b.huds) h.dispose();
  hudLayer.replaceChildren();
  overlayLayer.replaceChildren();
  // An empty overlay layer left catching the pointer would swallow clicks on the next battle's view.
  overlayLayer.style.pointerEvents = 'none';
  renderer.detach();
  battle = null;
  input.capture = false;
  input.onLockChange = null;
  input.releaseLock();
  audio.engine(0);
  menuLayer.style.pointerEvents = '';
}

function setOverlay(b: Battle, el: HTMLElement | null): void {
  b.overlay?.remove();
  b.overlay = el;
  overlayLayer.style.pointerEvents = el ? '' : 'none';
  if (el) overlayLayer.append(el);
}

function setPaused(b: Battle, paused: boolean): void {
  if (b.ended || b.paused === paused) return;
  b.paused = paused;
  if (paused) {
    b.pausedAt = performance.now();
    input.releaseLock();
    const resume = usesMouse(b) ? 'Resume to take the helm again.' : 'Press Start to resume.';
    const hint = b.net ? `The battle carries on while this menu is open, and your ship holds its course. ${resume}` : `The battle is frozen. ${resume}`;
    setOverlay(
      b,
      buildPause(
        {
          resume: () => {
            audio.ui('click');
            setPaused(b, false);
          },
          quit: () => {
            audio.ui('click');
            if (b.net) return leaveLanBattle();
            endBattle();
            menu.showTitle();
          },
        },
        hint,
        b.net ? 'Battle menu' : 'Paused',
      ),
    );
  } else {
    setOverlay(b, null);
    if (usesMouse(b)) input.requestLock();
  }
}

function showReport(b: Battle): void {
  input.releaseLock();
  b.scoreboard?.remove();
  b.scoreboard = null;
  const humans = b.pcs.map((p) => p.ship);
  const solo = {
    again: () => {
      audio.ui('click');
      startBattle({ ...b.config, seed: Math.floor(Math.random() * 1e9) });
    },
    ships: () => {
      audio.ui('click');
      endBattle();
      menu.showHangar(b.config.type === 'bossrush' || b.config.type === 'survival' ? 'rush' : 'battle');
    },
    menu: () => {
      audio.ui('click');
      endBattle();
      menu.showTitle();
    },
  };
  const lanActions = {
    lobby: () => {
      audio.ui('click');
      closeLanBattle();
    },
    leave: () => {
      audio.ui('click');
      net?.leave();
      closeLanBattle();
    },
  };
  setOverlay(b, buildReport(b.game, humans, b.newBest, b.net ? lanActions : solo));
}

// ---------------------------------------------------------------------------- LAN

function openLan(): void {
  if (!net) {
    const n = (net = new NetClient());
    n.listen(onNet);
    n.onStatus(updateBanner);
    const l = (lobby = new Lobby(menuLayer, n, {
      click: () => audio.ui('click'),
      preview: (spec, offset) => {
        showcase.setShip(spec);
        showcase.offset = offset;
      },
      back: () => closeLan(),
      chooseShip: (shipId, titans, era) => {
        l.hide();
        menu.showLanHangar(shipId, titans, era, (id) => {
          l.pickShip(id);
          l.show();
        });
      },
    }));
  }
  lobby!.show();
}

/** Back from the LAN screens to the title. */
function closeLan(): void {
  if (net?.lobby) net.leave();
  lobby?.hide();
  net?.close();
  net = null;
  lobby = null;
  lan = null;
  updateBanner();
  menu.showTitle();
}

/** The LAN battle is done here (report closed, or the server ended it): back to the lobby. */
function closeLanBattle(note?: string): void {
  endBattle();
  lan = null;
  updateBanner();
  if (!lobby) return;
  lobby.show();
  if (note) lobby.notice(note);
}

/** Leave mid-battle from the battle menu: the AI takes the ship over for the others. */
function leaveLanBattle(): void {
  net?.leave();
  closeLanBattle();
}

/** Build a LAN battle from its config and, when rejoining or resyncing, the turns so far. */
function startLan(config: BattleConfig, you: number, turns: Turn[] | null, resyncs = 0): void {
  endBattle();
  menu.hide();
  lobby?.hide();
  const game = new Game(config);
  const nb: LanBattle = { config, you, game, lockstep: null!, replaying: false, resyncs, awaitingLog: false, sentOver: false, starved: 0 };
  // Checkpoints passed while replaying were settled long ago; reporting them again only adds noise.
  nb.lockstep = new Lockstep(game, you, (m) => {
    if (m.t === 'hash' && nb.replaying) return;
    net?.send(m);
  });
  for (const t of turns ?? []) nb.lockstep.onTurn(t);
  lan = nb;
  if (!turns?.length) net?.send({ t: 'loaded' });
  if (nb.lockstep.backlog > TURN_TICKS * 4) nb.replaying = true;
  else presentBattle(config, game, nb);
  updateBanner();
}

/** One frame of a replay: fast-forward through the log, then show the battle once caught up. */
function replayFrame(nb: LanBattle): void {
  nb.lockstep.fastForward(40);
  if (nb.lockstep.backlog <= TURN_TICKS * 2) {
    nb.replaying = false;
    presentBattle(nb.config, nb.game, nb);
  }
  updateBanner();
}

function onNet(m: ServerMsg): void {
  const n = net!;
  switch (m.t) {
    case 'welcome':
      // The server restarted, or forgot us while we were away: that battle is gone.
      if (n.lostSeat && lan) closeLanBattle('Lost the seat in that battle: the LAN server restarted.');
      return;
    case 'start':
      return startLan(m.config, m.you, null);
    case 'turn':
      lan?.lockstep.onTurn(m.turn);
      return;
    case 'log': {
      const same = lan && lan.config.seed === m.config.seed && lan.you === m.you;
      // Back after a dropped connection with the battle still intact: just take the turns we missed.
      if (same && !lan!.awaitingLog) {
        for (const t of m.turns) lan!.lockstep.onTurn(t);
        return;
      }
      return startLan(m.config, m.you, m.turns, same ? lan!.resyncs : 0);
    }
    case 'desync':
      if (!lan || lan.awaitingLog || lan.resyncs >= MAX_RESYNCS) return;
      lan.resyncs++;
      lan.awaitingLog = true;
      n.send({ t: 'resync' });
      updateBanner();
      return;
    case 'ended':
      // Normally everyone saw the battle end and the report is up; otherwise the server called it.
      if (lan && !battle?.ended) closeLanBattle('The battle was called off before it finished here.');
      return;
    case 'lobby':
      if (!m.lobby && lan && battle?.net === lan && !battle.ended) closeLanBattle();
      return;
  }
}

let bannerText = '';
function setBanner(text: string, cls = ''): void {
  if (text === bannerText && netBanner.className === `net-banner ${cls}`.trim()) return;
  bannerText = text;
  netBanner.textContent = text;
  netBanner.className = `net-banner ${cls}`.trim();
  netBanner.hidden = !text;
}

/** What the LAN banner should say right now. */
function updateBanner(): void {
  const nb = lan;
  if (!nb || !net) return setBanner('');
  if (net.status !== 'online') return setBanner('Lost the LAN server. Reconnecting…', 'warn');
  // Battle over here: the report is up and turns may stop at any moment.
  if (battle?.net === nb && battle.ended) return setBanner('');
  if (nb.replaying) {
    const done = nb.lockstep.played;
    const pct = Math.floor((100 * done) / Math.max(1, done + nb.lockstep.backlog / TURN_TICKS));
    return setBanner(`${nb.resyncs ? 'Getting back in step with the other captains' : 'Rejoining the battle'}: ${pct}%`, 'screen');
  }
  if (nb.awaitingLog) return setBanner('Getting back in step with the other captains…');
  if (!nb.lockstep.started) {
    const l = net.lobby;
    const total = nb.config.players.length;
    return setBanner(total > 1 ? `Waiting for every captain to load: ${Math.min(total, l?.loaded ?? 0)} of ${total}` : 'Casting off…');
  }
  if (nb.lockstep.catchingUp) return setBanner('Catching up…');
  if (nb.starved > 0.6) return setBanner('Waiting for the LAN server…', 'warn');
  if (nb.resyncs >= MAX_RESYNCS) return setBanner('Out of step with the other captains. This battle may play out differently here.', 'warn');
  setBanner('');
}

// ---------------------------------------------------------------------------- frame

// Click the battle view to (re)take mouse control.
canvas.addEventListener('click', () => {
  if (battle && !battle.paused && !battle.ended && usesMouse(battle) && !input.aiming) input.requestLock();
});

const right = new Vector3();

function tickBattle(b: Battle, dt: number): void {
  const g = b.game;
  const nb = b.net;
  const padPause = b.pcs.some((p) => p.padIndex >= 0 && input.padPressed(p.padIndex, PAD_START));
  if (!b.ended && (input.pressed('Escape') || padPause)) {
    // Esc also releases the pointer lock (which pauses); it must not then immediately resume.
    // Mouse captains resume with the button or a click, since the lock needs a click anyway.
    const canResume = !usesMouse(b) || input.fallback;
    if (!b.paused) setPaused(b, true);
    else if (canResume && performance.now() - b.pausedAt > 250) setPaused(b, false);
  }

  // Solo, riding a shell in slows the battle so the flight reads. A LAN battle is shared, so its
  // clock never bends: no pause, no slow motion.
  const riding = b.pcs.some((p) => p.shellCam.active);
  const frozen = b.paused && !nb;
  const k = nb ? 1 : frozen ? 0 : Math.min(timeScale(b, dt), riding ? SHELL_CAM_SLOW : 1);
  if (nb) {
    for (const pc of b.pcs) {
      if (!b.ended && !b.paused) pc.control(dt, input);
      // With the menu up the ship holds course but stops shooting.
      else pc.out.fire = false;
      nb.lockstep.sendLocal(pc.out);
    }
    nb.lockstep.advance(dt);
    nb.starved = nb.lockstep.started && nb.lockstep.backlog === 0 ? nb.starved + dt : 0;
    updateBanner();
  } else if (!frozen) {
    if (!b.ended) for (const pc of b.pcs) pc.control(dt, input);
    g.advance(dt * k);
  }
  for (const pc of b.pcs) pc.updateCamera(frozen ? 0 : dt);
  renderer.update(dt * k, b.pcs.map((p) => p.camera));
  b.viewports.forEach((vp, i) => {
    const pc = b.pcs[i];
    vp.focus.x = pc.focus.pos.x;
    vp.focus.z = pc.focus.pos.z;
    pc.viewW = canvas.clientWidth * vp.rect.w;
    pc.viewH = canvas.clientHeight * vp.rect.h;
  });
  renderer.render(b.viewports);
  for (const h of b.huds) h.update(dt);

  // Audio follows the cameras; single-viewport games get stereo panning.
  audio.listeners = b.pcs.map((p) => p.camera.position);
  if (b.pcs.length === 1) audio.right.copy(right.set(1, 0, 0).applyQuaternion(b.pcs[0].camera.quaternion));
  const live = b.pcs.map((p) => p.ship).filter((s: Ship) => s.alive);
  audio.engine(frozen || !live.length ? 0 : Math.max(...live.map((s) => Math.abs(s.speed) / s.maxSpeed)));

  // Scoreboard while Tab (or a pad's Back) is held.
  const board = !b.ended && !b.paused && b.pcs.length > 0 && (input.isDown('Tab') || b.pcs.some((p) => p.padIndex >= 0 && input.padDown(p.padIndex, PAD_BACK)));
  if (board && !b.scoreboard) {
    b.scoreboard = buildScoreboard(g, b.pcs[0].ship);
    overlayLayer.append(b.scoreboard);
  } else if (!board && b.scoreboard) {
    b.scoreboard.remove();
    b.scoreboard = null;
  }

  if (b.ended && b.reportIn > 0) {
    b.reportIn -= dt;
    if (b.reportIn <= 0) showReport(b);
  }
}

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  input.pollPads();
  if (lan?.replaying) replayFrame(lan);
  else if (battle) tickBattle(battle, dt);
  else showcase.render(renderer.gl, dt);
  input.endFrame();
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => renderer.resize());
// Dev-only handle for poking at a running battle from the console.
if (import.meta.env.DEV) {
  const steelNet = {
    get client() {
      return net;
    },
    get lan() {
      return lan;
    },
    /** [turns played, state hash] of the LAN battle here. */
    hash: () => (lan ? [lan.lockstep.played, stateHash(lan.game)] : null),
  };
  Object.assign(window, { steel: { get battle() { return battle; }, renderer, start: startBattle, net: steelNet } });
}
// A reload in the middle of the LAN screens (or a LAN battle) goes straight back there.
if (NetClient.wasActive) openLan();
else menu.showTitle();
requestAnimationFrame(frame);
