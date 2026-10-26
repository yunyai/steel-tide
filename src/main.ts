import { MenuNavigation } from './ui/MenuNavigation';
// Deterministic maths first, before any module computes anything: LAN peers must agree bit for bit.
import './core/installDetMath';
import './ui/styles.css';
import type { ActiveBattle } from './app/ActiveBattle';
import { GroundBattle } from './app/GroundBattle';
import { LanLink } from './app/LanLink';
import { NavalBattle } from './app/NavalBattle';
import type { Shell } from './app/Shell';
import type { BattleConfig } from './core/BattleSetup';
import { Game } from './core/Game';
import type { ShipSpec } from './core/types';
import { audio } from './fx/Audio';
import { GroundGame } from './ground/sim/GroundGame';
import type { GroundConfig } from './ground/sim/setup';
import type { VehicleSpec } from './ground/sim/types';
import { Input } from './input/Input';
import { NetClient } from './net/NetClient';
import { Renderer } from './render/Renderer';
import { Showcase } from './render/Showcase';
import { Menu } from './ui/Menu';
import { applyPalette } from './ui/palette';

// The app shell: the view, the DOM layers over it, the menus, and the frame loop that runs
// whichever battle is on screen (see app/).

applyPalette();
void audio.prepare();

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

let battle: ActiveBattle | null = null;

function preview(spec: ShipSpec | VehicleSpec, offset: number): void {
  if ('drive' in spec) showcase.setVehicle(spec);
  else showcase.setShip(spec);
  showcase.offset = offset;
}

const menu = new Menu(menuLayer, {
  start: (config) => startSolo(config),
  preview,
  click: () => audio.ui('click'),
  lan: () => lan.open(),
});

function closeBattle(): void {
  battle?.dispose();
  battle = null;
}

function startSolo(config: BattleConfig | GroundConfig): void {
  closeBattle();
  if (config.kind === 'ground') shell.show(new GroundBattle(shell, config, new GroundGame(config), null));
  else shell.show(new NavalBattle(shell, config, new Game(config), null));
}

const shell: Shell = {
  canvas,
  renderer,
  input,
  menu,
  hudLayer,
  menuLayer,
  overlayLayer,
  get battle() {
    return battle;
  },
  show(b) {
    if (battle !== b) closeBattle();
    battle = b;
  },
  closeBattle,
  preview,
  startSolo,
};

const lan = new LanLink(shell, netBanner);

// Audio needs a user gesture before it can start.
const unlockAudio = () => {
  audio.init();
  window.removeEventListener('pointerdown', unlockAudio);
  window.removeEventListener('keydown', unlockAudio);
};
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);

const menuNavigation = new MenuNavigation();
let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  input.pollPads();
  menuNavigation.update(input, now);
  if (!lan.frame()) {
    if (battle) battle.tick(dt);
    else showcase.render(renderer.gl, dt);
  }
  input.endFrame();
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => renderer.resize());
// Dev-only handle for poking at a running battle from the console.
if (import.meta.env.DEV) {
  const steelNet = {
    get client() {
      return lan.client;
    },
    get lan() {
      return lan.lan;
    },
    /** [turns played, state hash] of the LAN battle here. */
    hash: () => (lan.lan ? [lan.lan.lockstep.played, lan.lan.sim.hash()] : null),
  };
  Object.assign(window, { steel: { get battle() { return battle; }, renderer, start: startSolo, net: steelNet } });
}
// A reload in the middle of the LAN screens (or a LAN battle) goes straight back there.
if (NetClient.wasActive) lan.open();
else menu.showTitle();
requestAnimationFrame(frame);
