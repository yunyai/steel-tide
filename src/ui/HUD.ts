import { architectSkillPresentation,architectModuleSkillPresentation,architectIncomingBattery } from './ArchitectSkillPresentation';
import { architectDockingStatus } from '../skills/misc/ArchitectRuntime';
import { CROSS } from '../skills/misc/CrossStep';
import { vectorMobilityPresentation } from './VectorMobilityPresentation';
import { cubeReticle, cubeSlot, tungstenPresentation, type TungstenView } from './TungstenPresentation';
import { ARCHETYPES } from '../data/architectLoadout';
import { canTrack, contactVisible, proximityContact, revealSource } from '../core/Targeting';
import { cameraOccluded } from '../render/Visibility';
import { Vector3 } from 'three';
import { BATTLE_TIME_LIMIT, DOMINATION_WIN_SCORE, KNOT, SPEED_SCALE } from '../config';
import type { Game } from '../core/Game';
import { dist2D } from '../core/math';
import { PICKUP_COLOR, PICKUP_LABEL } from '../core/Pickups';
import type { ConsumableType, Era, Team } from '../core/types';
import { accentCss } from '../data/accents';
import { audio } from '../fx/Audio';
import type { Input } from '../input/Input';
import { bindings, keyName, onBindings } from '../input/Keybinds';
import { RUSH_WAVES } from '../modes/BossRush';
import { ARRIVE_GOAL, SINK_GOAL } from '../modes/Convoy';
import { LAN_BATTLE_LIMIT_S } from '../net/protocol';
import { leadPoint } from '../player/FireControl';
import type { PlayerController } from '../player/PlayerController';
import { consumableLabel } from '../ships/Consumables';
import { eraOf } from '../data/factions';
import { THROTTLE_LABELS, type Ship } from '../ships/Ship';
import { solve } from '../weapons/Ballistics';
import { Feedback } from './Feedback';
import { hullHealthDisplay } from './HullHealth';
import { classIcon, consumableIcon, glyph, skillIcon } from './Icons';
import { Intermission } from './Intermission';
import { Minimap } from './Minimap';
import { captainName } from './names';
import { palette } from './palette';

// The heads-up display for the player's viewport, bound to a PlayerController.

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  parent?.append(e);
  return e;
}

function setText(e: HTMLElement, t: string): void {
  if (e.textContent !== t) e.textContent = t;
}

function setWidth(e: HTMLElement, frac: number): void {
  const w = `${(Math.max(0, Math.min(1, frac)) * 100).toFixed(1)}%`;
  if (e.style.width !== w) e.style.width = w;
}

function setClass(e: Element, cls: string): void {
  if (e.className !== cls) e.className = cls;
}

/** Restart a CSS animation bound to `cls`. */
function flash(e: Element, cls: string): void {
  e.classList.remove(cls);
  void (e as HTMLElement).offsetWidth;
  e.classList.add(cls);
}

const OUTCOME_LABEL: Record<string, string> = {
  citadel: 'Citadel',
  penetration: 'Penetration',
  overpen: 'Overpenetration',
  ricochet: 'Ricochet',
  shatter: 'Shatter',
  he: 'Hit',
  secondary: 'Secondary hit',
  missile: 'Missile hit',
  bomb: 'Bomb hit',
};

/** Gamepad labels: normal skills, then ultimates (titans hold LB or RB for their second and third set). */
const PAD_NORMAL = ['X', 'B', 'LB X', 'LB B', 'RB X', 'RB B'];
const PAD_ULT = ['Y', 'LB Y', 'RB Y'];
const PAD_CONS = ['↑', '→'];
/** One short word under each consumable button, so neighbours never collide. */
const CONS_SHORT: Record<ConsumableType, string> = {
  repair: 'REPAIR',
  smoke: 'SMOKE',
  search: 'RADAR',
  speedBoost: 'BOOST',
  depthCharges: 'DEPTH',
};
/** Search goes by another name outside the gunnery eras. */
const SEARCH_SHORT: Record<Era, string> = { historic: 'RADAR', modern: 'RADAR', fantasy: 'SCRY', scifi: 'SCAN', anime: 'SENSE', misc: 'SONAR' };

interface Ribbon {
  kind: string;
  count: number;
  time: number;
  el: HTMLElement;
}

interface SkillEl {
  root: HTMLElement;
  t: HTMLElement;
  wasReady: boolean;
  /** Key (or pad buttons) shown on the button. */
  key?: HTMLElement;
  /** Short name under a skill button. */
  nm?: HTMLElement;
}

/** Edge chevrons shown at most, nearest first. */
const MAX_OFFSCREEN = 8;
const v3 = new Vector3();

export class HUD {
  readonly root: HTMLElement;
  private team: Team;
  private off: (() => void)[] = [];
  private markers: HTMLElement[] = [];
  private markerLayer: HTMLElement;
  /** Edge chevrons for enemies outside the view. */
  private offMarks: HTMLElement[] = [];
  /** One layout snapshot per frame, shared by every world-to-HUD projection. */
  private viewportWidth = 0;
  private viewportHeight = 0;
  private minimap: Minimap;
  // Elements updated every frame.
  private e: Record<string, HTMLElement> = {};
  private moduleEls: HTMLElement[] = [];
  private turretDots: HTMLElement[] = [];
  private telegraph: HTMLElement[] = [];
  private slotEls: { root: HTMLElement; bar: HTMLElement; info: HTMLElement }[] = [];
  /** The Tungsten's view this frame, shared by its panel, status lines and skill buttons. */
  private tungsten: TungstenView | null = null;
  private tungstenEls: { root: HTMLElement; mode: HTMLElement; where: HTMLElement; gauges: Record<'energy' | 'cube' | 'store', { root: HTMLElement; fill: HTMLElement; text: HTMLElement }>; cubes: HTMLElement[] } | null = null;
  private skillEls: SkillEl[] = [];
  private consEls: SkillEl[] = [];
  private vectorEls: {root:HTMLElement;t:HTMLElement;count:HTMLElement;lastActive?:number;wasReady:boolean}[] = [];
  /** LAN Free play: the last "minutes left" warning given before the server's time limit. */
  private limitWarned = Infinity;
  /** Key labels on the buttons, redrawn when the bindings change. */
  private keyEls: { el: HTMLElement; text: () => string }[] = [];
  private ribbons: Ribbon[] = [];
  private feed: { el: HTMLElement; time: number }[] = [];
  private bannerUntil = 0;
  private lastTorpAlarm = -100;
  private lastHeartbeat = -100;
  private fleetKey = '';
  private convoyKey = '';
  private fb: Feedback;
  private intermission: Intermission | null = null;
  /** HP shown by the white chip trail, catching up with the real bar after a pause. */
  private chipHp: number;
  private chipHold = 0;
  private bossChip = 1;
  private lastHp: number;
  private lastHullCapacity = 0;
  private lastCombo = 0;

  constructor(
    private game: Game,
    private pc: PlayerController,
    private input: Input,
  ) {
    this.team = pc.ship.team;
    this.root = el('div', 'hud');
    const r = this.root;
    const e = this.e;
    const me = pc.ship;
    this.chipHp = this.lastHp = me.hp;

    const rush = game.rush;
    this.markerLayer = el('div', '', r);
    e.lead = el('div', 'marker lead', r);
    e.lead.innerHTML = '<svg width="18" height="18" viewBox="-9 -9 18 18"><path d="M0 -7 L7 0 L0 7 L-7 0 Z" fill="none" stroke="#ffb547" stroke-width="2"/></svg>';
    e.lead.style.transform = 'translate(-50%,-50%)';
    // VLS lock: brackets round the enemy the next salvo goes for.
    e.lock = el('div', 'marker lockbox', r);
    e.lock.innerHTML =
      '<svg width="44" height="44" viewBox="-22 -22 44 44"><path d="M-20 -11 V-20 H-11 M11 -20 H20 V-11 M20 11 V20 H11 M-11 20 H-20 V11" fill="none" stroke="#ff5a4a" stroke-width="2.5"/></svg>';
    e.lock.style.display = 'none';

    // Top: score and caps, or the Boss Rush wave counter.
    const top = el('div', 'top panel', r);
    if (rush) {
      const wb = el('div', 'wavebox', top);
      e.wave = el('div', 'w', wb);
      const left = el('div', 'left', wb);
      e.left = el('b', '', left);
      left.append('enemies');
      const pts = el('div', 'pts', wb);
      e.pts = el('b', '', pts);
      pts.append('score');
      e.combo = el('div', 'combo', top);
      const boss = el('div', 'bossbar', r);
      e.bossbar = boss;
      const nm = el('div', 'nm', boss);
      e.bossName = el('span', '', nm);
      e.bossHp = el('small', 'num', nm);
      const bar = el('div', 'bar', boss);
      e.bossChip = el('i', 'chipt', bar);
      e.bossFill = el('i', 'fill', bar);
      e.bossShield = el('i', 'sh', bar);
      boss.style.display = 'none';
    } else {
      e.scoreA = el('div', 'score ally num', top);
      const mid = el('div', 'mid', top);
      e.caps = el('div', 'caps', mid);
      const bar = el('div', 'score-bar', mid);
      e.barA = el('i', 'a', bar);
      e.barE = el('i', 'e', bar);
      e.scoreE = el('div', 'score enemy num', top);
      // Inside the panel: anything hung below it is cut off by the panel's clipped corners.
      e.timer = el('div', 'timer num', mid);
      if (!game.caps.length) bar.style.display = 'none';
      if (game.config.type === 'freeplay') {
        e.scoreA.title = 'Enemy ships your fleet has sunk';
        e.scoreE.title = 'Your ships the enemy has sunk';
        e.timer.title = 'Time in free play';
      }
      if (game.convoy) {
        e.convoy = el('div', 'convoy', mid);
        e.goal = el('div', 'goal', mid);
      }
      e.fleet = el('div', 'fleet', r);
    }

    // Reticle: fire-control graticule with range ticks.
    const ret = el('div', 'reticle', r);
    ret.innerHTML = `<svg viewBox="-120 -70 240 140"><g stroke="rgba(160,240,255,0.95)" stroke-width="1.5" fill="none">
      <path d="M-110 0 H-14 M14 0 H110 M0 -60 V-14 M0 14 V60"/>
      ${[-80, -60, -40, -20, 20, 40, 60, 80].map((x) => `<path d="M${x} -4 V4"/>`).join('')}
      ${[24, 36, 48].map((y) => `<path d="M-6 ${y} H6"/>`).join('')}
      <path d="M-8 -8 L-4 -8 M-8 -8 L-8 -4 M8 -8 L4 -8 M8 -8 L8 -4 M-8 8 L-4 8 M-8 8 L-8 4 M8 8 L4 8 M8 8 L8 4" stroke="#4de8ff" stroke-width="2"/>
      <circle r="2.2" fill="#eaf6ff" stroke="none"/></g></svg>`;
    e.readout = el('div', 'readout num', ret);
    e.reticle = ret;
    e.dots = el('div', 'turret-dots', r);
    me.turrets.forEach(() => this.turretDots.push(el('i', '', e.dots)));

    e.dmg = el('div', 'dmg-total', r);
    e.dmg.textContent = 'Damage dealt';
    e.dmgNum = el('b', 'num', e.dmg);
    e.ribbons = el('div', 'ribbons', r);
    e.killfeed = el('div', 'killfeed', r);
    e.alerts = el('div', 'alerts', r);
    e.callout = el('div', 'callout', e.alerts);
    e.alert = el('div', 'alert', e.alerts);
    e.banner = el('div', 'banner', e.alerts);
    e.siren = el('div', 'siren', r);
    e.siren.innerHTML = '<b>BOSS INCOMING</b><small></small>';
    e.crit = el('div', 'crit', r);
    e.crit.textContent = 'HULL CRITICAL';
    e.flashfx = el('div', 'flashfx', r);
    e.shellcam = el('div', 'shellcam', r);
    e.shellcam.style.display = 'none';
    e.dead = el('div', 'dead-msg', r);
    e.hint = el('div', 'click-hint', r);
    e.hint.textContent = 'Click to take the helm';
    e.notice = el('div', 'click-hint', r);

    // Helm, bottom left.
    const helm = el('div', 'helm panel', r);
    const tel = el('div', 'telegraph', helm);
    THROTTLE_LABELS.forEach((_, i) => this.telegraph.push(el('i', i === 2 ? 'stop' : '', tel)));
    const spdBox = el('div', '', helm);
    const spd = el('div', 'spd', spdBox);
    e.spd = el('span', '', spd);
    el('small', '', spd).textContent = ' kn';
    e.ord = el('div', 'ord', spdBox);
    const rud = el('div', 'rudder', spdBox);
    el('b', '', rud);
    e.rudTarget = el('i', '', rud);
    e.rudTarget.style.opacity = '0.35';
    e.rud = el('i', '', rud);

    // Cockpit, bottom centre: name, hull, status, skills, weapons.
    const titan = me.skills.length > 3;
    const ck = el('div', `cockpit${titan ? ' titan' : ''}`, r);
    // Skill failures sit just above the cockpit so a tall titan cockpit never hides them.
    ck.append(e.notice);
    // Architect: one chip per turret socket sits above the hull block.
    if (me.architect) {
      const battery=e.battery=el('div','architect-battery',ck);battery.setAttribute('aria-label','Modular arsenal');
      for(let i=0;i<10;i++){
        const item=el('div','architect-slot',battery);item.innerHTML=`<b>${i+1}</b><em></em><span>DOCK</span><i></i>`;this.moduleEls.push(item);
      }
    }
    // Tungsten: the cube's whereabouts, the magnet's energy, the cube's health and the Shield store.
    if (me.tungsten) {
      const root = el('div', 'tungsten-panel', ck);
      const head = el('div', 'tp-head', root);
      const mode = el('b', '', head);
      const where = el('span', '', head);
      const gauge = (key: string, label: string) => {
        const g = el('div', `tp-gauge ${key}`, root);
        el('span', 'tp-label', g).textContent = label;
        const text = el('span', 'num', g);
        return { root: g, fill: el('i', '', el('div', 'tp-bar', g)), text };
      };
      const gauges = { energy: gauge('energy', 'Energy'), cube: gauge('cube', 'Cube'), store: gauge('store', 'Store') };
      const row = el('div', 'tp-cubes', gauges.cube.root);
      this.tungstenEls = { root, mode, where, gauges, cubes: Array.from({ length: 6 }, () => el('i', '', row)) };
    }
    const nb = el('div', 'namebar', ck);
    el('span', 'cls', nb).innerHTML = classIcon(me.spec.cls);
    el('span', 'nm', nb).textContent = me.spec.name;
    e.regen = el('span', 'tag regen', nb);
    e.regen.textContent = 'REPAIRING';
    e.hpNum = el('span', 'hpnum num', nb);
    const hp = el('div', 'hpbar', ck);
    e.hpbar = hp;
    e.hpChip = el('i', 'chipt', hp);
    e.hp = el('i', 'fill', hp);
    e.hpShield = el('i', 'sh', hp);
    e.hpReserved = el('i', 'reserved', hp);
    el('i', 'ticks', hp);
    e.status = el('div', 'status-row', ck);
    // Titan Shift: the form's name, the time it has left, and where each ultimate comes ready.
    const f = me.form;
    if (f) {
      const fb = el('div', 'formbar', ck);
      fb.style.setProperty('--accent', accentCss(me.spec.model.formAura ?? 0xff8ac8));
      el('span', 'nm', fb).textContent = 'Titan Shift';
      const track = el('div', 'track', fb);
      e.formFill = el('i', 'fill', track);
      const span = f.until - f.start;
      for (const at of f.unlock) {
        if (at <= 0) continue;
        el('i', 'tick', track).style.left = `${((1 - at / span) * 100).toFixed(1)}%`;
      }
      e.formLeft = el('span', 'left num', fb);
    }

    const sb = el('div', `skillbar${titan ? ' titan' : ''}`, ck);
    let normals = 0;
    let ults = 0;
    me.skills.forEach((st, i) => {
      const ult = !!st.spec.ult;
      // A gap sets the ultimates apart from the normal skills.
      if (ult && !ults) el('div', 'gap', sb);
      const pad = ult ? PAD_ULT[ults++] : PAD_NORMAL[normals++];
      const root = el('div', `sk${ult ? ' ult' : ''}${st.spec.icon === 'shift' ? ' shift' : ''}`, sb);
      root.title=`${st.spec.name}: ${st.spec.description}`;
      root.style.setProperty('--accent', accentCss(st.spec.accent));
      root.title = `${st.spec.name}: ${st.spec.description}`;
      const hx = el('div', 'hx', root);
      if (ult) el('div', 'meter', hx);
      hx.insertAdjacentHTML('beforeend', skillIcon(st.spec.icon));
      el('div', 'sweep', hx);
      const t = el('div', 't', hx);
      const k = this.keyLabel(root, () => pc.layout?.skills[i], pad);
      const nm = el('div', 'nm', root);
      nm.textContent = st.spec.short;
      this.skillEls.push({ root, t, wasReady: me.skillReady(i), key: k, nm });
    });
    el('div', 'gap', sb);
    me.consumables.forEach((c, i) => {
      const root = el('div', `sk cons${c.spec.type === 'repair' ? ' repair' : ''}`, sb);
      root.title = consumableLabel(c.spec.type, me.spec);
      const hx = el('div', 'hx', root);
      hx.insertAdjacentHTML('beforeend', consumableIcon(c.spec.type));
      el('div', 'sweep', hx);
      const t = el('div', 't', hx);
      this.keyLabel(root, () => pc.layout?.consumables[i], PAD_CONS[i]);
      el('span', 'ch', root);
      el('div', 'nm', root).textContent = c.spec.type === 'search' ? SEARCH_SHORT[eraOf(me.spec)] : CONS_SHORT[c.spec.type];
      this.consEls.push({ root, t, wasReady: true });
    });
    // Vector: two hex tiles, shown only while the arsenal carries a Vector.
    if (me.architect) {
      const equipped=me.architect.slots.some(a=>a.type==='vector');
      e.vectorGap=el('div','gap vector-gap',sb);e.vectorGap.hidden=!equipped;
      for(const [id,label,short,icon,pad] of [['architectHullDash','Hull Dash','HULL DASH','ram','LB + →'],['architectMobileBattery','Mobile Battery','MOBILE','fleet','RB + →']] as const){
        const root=el('div','sk cons vector',sb);root.dataset.action=id;root.hidden=!equipped;root.title=label;
        const hx=el('div','hx',root);hx.insertAdjacentHTML('beforeend',skillIcon(icon));el('div','sweep',hx);
        const t=el('div','t',hx);
        this.keyLabel(root,()=>bindings()[id]||undefined,pad);
        const count=el('span','ch',root);
        el('div','nm',root).textContent=short;
        this.vectorEls.push({root,t,count,wasReady:true});
      }
    }

    const weapons = el('div', 'weapons', ck);
    me.slots.forEach((s, i) => {
      const root = el('div', 'slot', weapons);
      this.keyLabel(root, () => pc.layout?.slots[i], 'LB/RB');
      root.append(s.label.replace(' shells', ''));
      const info = el('div', 'num info', root);
      const b = el('div', 'bar', root);
      this.slotEls.push({ root, bar: el('i', '', b), info });
    });

    if (me.isSub) {
      const dp = el('div', 'depth panel', r);
      e.depth = dp;
      ['Surface', 'Periscope', 'Deep'].forEach((t) => {
        el('div', 'lvl', dp).textContent = t;
      });
      const bat = el('div', 'bat', dp);
      e.battery = el('i', '', bat);
    }

    const frame = el('div', 'mapframe panel', r);
    this.minimap = new Minimap(game, pc, this.team);
    frame.append(this.minimap.canvas);
    this.fb = new Feedback(game, pc, r, (x, y, z) => this.project(x, y, z), (t, s, c) => this.banner(t, s, c), (t, s, c) => this.callout(t, s, c));

    if (rush) {
      this.intermission = new Intermission(rush, input, pc.padIndex, () => audio.ui('click'));
      r.append(this.intermission.root);
    }

    // Event feeds.
    const ev = game.events;
    const mine = (s: Ship) => s === pc.ship || s.summonOwner === pc.ship;
    this.off.push(
      onBindings(() => this.relabel()),
      ev.on('shellHit', (h) => {
        if (!mine(h.attacker) || h.target.team === this.team || (h.secondary && h.damage <= 0)) return;
        const label = OUTCOME_LABEL[h.outcome];
        if (label) this.ribbon(label);
      }),
      ev.on('ribbon', (rb) => {
        if (mine(rb.ship)) this.ribbon(rb.kind);
      }),
      ev.on('shipSunk', (s) => {
        if (s.ship.architectPlatform || s.ship.architectDrone) return;
        const k = s.killer;
        const line = el('div', '', e.killfeed);
        if (k) {
          const a = el('span', k.team === this.team ? 'a' : 'e', line);
          a.innerHTML = classIcon(k.spec.cls);
          a.append(` ${captainName(k)}`);
        } else el('span', 'x', line).textContent = 'Fire and flooding';
        el('span', 'x', line).textContent = '✕';
        const b = el('span', s.ship.team === this.team ? 'a' : 'e', line);
        b.innerHTML = classIcon(s.ship.spec.cls);
        b.append(` ${captainName(s.ship)}`);
        this.feed.push({ el: line, time: game.time });
        if (s.ship === pc.ship) audio.ui('defeat');
      }),
      ev.on('detonation', (d) => {
        const k = d.killer?.summonOwner ?? d.killer;
        if (k === pc.ship) this.callout('Detonation', `${captainName(d.ship)} breaks in two`, '#ffb547');
        else if (d.ship === pc.ship) this.callout('Magazine detonation', 'Your ship has broken in two', '#ff5a4a');
      }),
      ev.on('capture', (c) => {
        const cap = game.caps[c.cap];
        this.banner(c.team === this.team ? `Zone ${cap.name} captured` : `Zone ${cap.name} lost`, c.team === this.team ? 'Hold it to keep scoring' : 'Retake it to stop the enemy scoring');
        audio.ui('capture');
      }),
      ev.on('skill', (a) => {
        const sp = a.ship.skills[a.index].spec;
        const c = accentCss(sp.accent);
        if (a.ship === pc.ship) {
          flash(this.skillEls[a.index].root, 'flash');
          if (sp.ult) {
            const brief:Record<string,string>={flickerStep:'20 strikes · Fold, strike, repeat',crossStep:`${CROSS.cuts} cuts · Final convergence`,afterimageStep:'Four echoes · Your attacks, multiplied',architectAssembly:'Assembling the railgun · Aim until the final lock',architectKillbox:'Ten siege cannons · Continuous elemental bombardment',architectCitadel:'Airborne battery · Protect allies within 900 m'};
            this.callout(sp.name, brief[sp.id]??sp.description, c);
            this.flashScreen(c);
          }
        } else if (sp.ult && a.ship.team !== this.team && !a.ship.isSummon) {
          this.banner(`Enemy ${captainName(a.ship)}: ${sp.name}`, sp.description, c);
        }
      }),
      ev.on('pickupTaken', (p) => {
        if (p.ship !== pc.ship) return;
        this.banner(PICKUP_LABEL[p.pickup.kind], '', accentCss(PICKUP_COLOR[p.pickup.kind]));
        audio.ui('pickup');
      }),
      ev.on('wave', (w) => {
        if (w.boss) {
          const s = e.siren.querySelector('small')!;
          s.textContent = w.boss.spec.name.toUpperCase();
          flash(e.siren, 'on');
          audio.ui('siren');
        } else {
          this.callout(`Wave ${w.wave}`, `${game.rush?.enemiesLeft || 'Enemy'} ships inbound`, '#4de8ff');
          audio.ui('horn');
        }
      }),
      ev.on('convoy', (c) => {
        const ours = c.ship.team === this.team;
        if (c.kind === 'arrived') this.callout('Transport in port', ours ? `${c.ship.name} made it through` : `${c.ship.name} slipped past you`, ours ? palette().good : palette().enemy);
        else this.callout('Transport sunk', ours ? `${c.ship.name} is lost` : `${c.ship.name} goes down`, ours ? palette().enemy : '#ffb547');
        audio.ui(ours === (c.kind === 'arrived') ? 'capture' : 'horn');
      }),
      ev.on('waveClear', (w) => {
        this.callout(w.cleared ? 'Victory' : 'Wave clear', w.cleared ? 'All titans sunk. Endless waves continue.' : 'Choose a refit', palette().good);
        audio.ui('capture');
      }),
    );
  }

  private ribbon(kind: string): void {
    let r = this.ribbons.find((x) => x.kind === kind);
    if (!r) {
      const e = el('div', `ribbon${kind === 'Citadel' ? ' citadel' : kind === 'Destroyed' || kind === 'Detonation' ? ' kill' : ''}`, this.e.ribbons);
      r = { kind, count: 0, time: 0, el: e };
      this.ribbons.push(r);
    }
    r.count++;
    r.time = this.game.time;
    r.el.textContent = r.count > 1 ? `${kind} ×${r.count}` : kind;
    flash(r.el, 'fresh');
    if (kind !== 'Citadel') audio.ui('ribbon');
  }

  private banner(title: string, sub: string, color = ''): void {
    const b = this.e.banner;
    b.style.color = color;
    b.replaceChildren(title);
    if (sub) {
      const s = document.createElement('small');
      s.textContent = sub;
      b.append(s);
    }
    flash(b, 'banner');
    this.bannerUntil = this.game.time + 4;
  }

  /** Big centre-screen word: kill streaks, ultimates, waves. */
  private callout(title: string, sub: string, color: string): void {
    const c = this.e.callout;
    c.style.setProperty('--c', color);
    c.replaceChildren(title);
    if (sub) {
      const s = document.createElement('small');
      s.textContent = sub;
      c.append(s);
    }
    flash(c, 'on');
  }

  private flashScreen(color: string): void {
    this.e.flashfx.style.setProperty('--c', `${color}66`);
    flash(this.e.flashfx, 'on');
  }

  /** A key label for a button: the bound key for keyboard captains, else the pad buttons. */
  private keyLabel(root: HTMLElement, code: () => string | undefined, pad: string): HTMLElement {
    const k = el('kbd', '', root);
    const text = () => (this.pc.layout ? keyName(code()) : pad);
    k.textContent = text();
    this.keyEls.push({ el: k, text });
    return k;
  }

  private relabel(): void {
    for (const k of this.keyEls) k.el.textContent = k.text();
  }

  dispose(): void {
    for (const f of this.off) f();
    this.fb.dispose();
    this.root.remove();
  }

  update(dt: number): void {
    // Read before HUD writes: projections later in this update must not force layout again.
    this.viewportWidth = this.root.clientWidth;
    this.viewportHeight = this.root.clientHeight;
    const g = this.game;
    const pc = this.pc;
    const me = pc.ship;
    this.root.classList.toggle('stepper-cinematic', me.spec.id === 'stepper' && me.alive && !g.over && me.skills.some(st => st.spec.ult && st.active));
    const e = this.e;
    const team = this.team;
    const enemy: Team = team === 0 ? 1 : 0;
    this.tungsten = me.tungsten ? tungstenPresentation(me.tungsten, g.time, me.pos.x, me.pos.z) : null;

    if (g.rush) this.updateRush();
    else this.updateScore(team, enemy);

    this.updateMarkers();
    this.updateReticle();

    // Helm.
    const kn = me.speed / (KNOT * SPEED_SCALE);
    setText(e.spd, Math.abs(kn).toFixed(0));
    setText(e.ord, me.mods.stunned ? 'Stunned' : THROTTLE_LABELS[me.throttle]);
    this.telegraph.forEach((t, i) => {
      const on = me.throttle >= 2 ? i >= 2 && i <= me.throttle : i >= me.throttle && i <= 2;
      t.classList.toggle('on', on && i !== 2);
    });
    e.rud.style.left = `${50 + me.rudder * 50}%`;
    e.rudTarget.style.left = `${50 + me.rudderTarget * 50}%`;

    this.updateHull(dt);
    this.updateSkills();
    this.updateTungsten();
    if(me.architect){
      // The docking summary rides on the turret strip instead of a bar of its own.
      const docking=architectDockingStatus(me),summary=`Modular arsenal · Dock ${docking.count}/10 · DR ${Math.round(docking.damageReduction*100)}% · Hull +${Math.round(!me.alive||me.mods.healBlock?0:docking.hullRegenPerSecond*me.mods.regenMul).toLocaleString()}/s · CAP ${docking.capacitors} ready / ${docking.chargingCycles} half`;
      if(e.battery.dataset.summary!==summary){e.battery.dataset.summary=summary;e.battery.setAttribute('aria-label',summary);e.battery.title=`${summary}\nEach docked platform: 1.5% hull protection, up to 15%. After 2s: hull repair 0.03%/s, and a platform below the hull's health repairs 20%/s until it catches up. Capacitors store one 18k elemental bolt per two ordinary docked firing cycles.`;}
    }
    if(me.architect)this.moduleEls.forEach((item,i)=>{
      const a=me.architect!.slots[i],state=a.state;
      item.dataset.state=state;item.dataset.health=a.hp/me.architect!.moduleHp<.3?'low':a.hp/me.architect!.moduleHp<.6?'mid':'high';item.style.setProperty('--health',`${Math.max(0,a.hp/me.architect!.moduleHp)}`);
      setText(item.querySelector('span')!,state==='destroyed'?`${Math.ceil(a.rebuild)}s`:state==='docked'?'DOCK':state==='deployed'&&!a.follow?'SET':state==='citadel'||state==='deployed'?'AIR':state==='returning'?'HOME':state==='assembling'?'BUILD':'MOVE');
      const theme=ARCHETYPES[a.type];setText(item.querySelector('em')!,theme.short);item.style.setProperty('--type',`#${theme.color.toString(16).padStart(6,'0')}`);
      item.dataset.capacitor=a.capacitorCharged?'charged':a.capacitorCycles?'half':'empty';
      item.title=`${theme.name} ${i+1} · ${architectModuleSkillPresentation(me,i).label} · ${state}, ${Math.ceil(a.hp).toLocaleString()} / ${Math.round(me.architect!.moduleHp).toLocaleString()} HP · capacitor ${a.capacitorCharged?'18k ready':`${a.capacitorCycles}/2 firing cycles`}`;
      item.setAttribute('aria-label',item.title);
    });

    // Weapons.
    me.slots.forEach((s, i) => {
      const se = this.slotEls[i];
      se.root.classList.toggle('on', i === me.slot);
      let fracR = 1;
      let info = '';
      if (s.kind === 'gun' && me.spec.main) {
        const live = me.turrets.filter((t) => t.disabled <= 0);
        const r = live.length ? Math.max(0, ...live.map((t) => t.reload)) : Infinity;
        const ready = live.filter((t) => t.reload <= 0).length;
        const full = me.mods.reloadOverride > 0 ? me.mods.reloadOverride : me.spec.main.reload * me.mods.reloadMul;
        fracR = r === Infinity ? 0 : 1 - r / full;
        info = r === Infinity ? me.architect ? 'Battery deployed' : 'Knocked out' : r <= 0 ? 'Ready' : ready ? `${ready}/${live.length} ready` : `${r.toFixed(1)}s`;
      } else if (s.kind === 'torp' && me.spec.torpedoes) {
        const states = me.launchers.map(l => me.torpedoReadiness(l, this.pc.aim.x, this.pc.aim.z));
        const ready = states.filter(s => s === 'ready').length;
        const r = Math.min(...me.launchers.map((l) => l.reload));
        fracR = 1 - Math.max(0, r) / me.spec.torpedoes.reload;
        info = states.map((state, i) => `${i + 1}: ${state === 'reloading' ? `${Math.max(0, me.launchers[i].reload).toFixed(0)}s` : state}`).join(' · ');
        se.root.classList.toggle('ready', ready > 0);
      } else if (s.kind === 'air' && me.air && me.spec.air) {
        const n = Math.floor(me.air.hangar[s.sq]);
        fracR = me.air.cooldown > 0 ? 1 - me.air.cooldown / me.spec.air.launchCooldown : 1;
        info = `${n} planes`;
      } else if (s.kind === 'vls' && me.vls && me.spec.missiles) {
        const r = Math.max(0, me.vls.reload);
        fracR = 1 - r / (me.spec.missiles.reload * me.mods.missileReloadMul);
        info = r <= 0 ? `${me.spec.missiles.salvo + (me.trait?.vlsExtra ?? 0)} ready` : `${r.toFixed(0)}s`;
      } else if (s.kind === 'cube' && me.tungsten) {
        ({ frac: fracR, info } = cubeSlot(me.tungsten));
      }
      setText(se.info, info);
      setWidth(se.bar, fracR);
    });

    // Submarine depth.
    if (e.depth && me.spec.sub) {
      [...e.depth.querySelectorAll('.lvl')].forEach((l, i) => l.classList.toggle('on', i === me.depthState));
      setWidth(e.battery, me.battery / me.spec.sub.battery);
    }

    // Ribbons and feeds expire.
    for (let i = this.ribbons.length - 1; i >= 0; i--) {
      if (g.time - this.ribbons[i].time > 14) {
        this.ribbons[i].el.remove();
        this.ribbons.splice(i, 1);
      }
    }
    for (let i = this.feed.length - 1; i >= 0; i--) {
      if (g.time - this.feed[i].time > 25 || this.feed.length > 6) {
        this.feed[i].el.remove();
        this.feed.splice(i, 1);
      }
    }
    setText(e.dmgNum, Math.round(me.stats.damage).toLocaleString());

    // Alerts.
    const torpWarning = me.alive && this.torpedoThreat(me);
    setText(e.alert, torpWarning ? 'TORPEDOES INBOUND' : this.strikeThreat(me) ? 'STRIKE INBOUND: MOVE' : '');
    if (torpWarning && g.time - this.lastTorpAlarm > 6) {
      this.lastTorpAlarm = g.time;
      audio.ui('alarm');
    }
    e.banner.style.display = g.time < this.bannerUntil ? '' : 'none';
    if (!me.alive) {
      e.dead.style.display = '';
      const back = g.respawnIn(me);
      // Free play: the ship you come back in, and where to change it (never opened for you).
      const free = g.config.type === 'freeplay';
      const title = back >= 0 ? `Back in ${Math.ceil(back)}…${free ? ` as ${(me.nextSpec ?? me.spec).name}` : ''}` : 'Ship lost';
      let sp = pc.focus !== me && pc.focus.alive ? `Watching ${captainName(pc.focus)}. Fire to switch ship.` : back >= 0 ? 'A fresh hull is fitting out.' : 'Your crew abandons ship.';
      if (free && back >= 0) sp += ` ${pc.padIndex >= 0 ? 'Start' : 'Esc'}: change ship.`;
      if (e.dead.dataset.k !== title + sp) {
        e.dead.dataset.k = title + sp;
        e.dead.replaceChildren();
        el('b', '', e.dead).textContent = title;
        e.dead.append(sp);
      }
    } else e.dead.style.display = 'none';
    e.hint.style.display = pc.device === 'mouse' && !this.input.aiming && me.alive && g.rush?.phase !== 'offer' ? '' : 'none';
    const notice = me.alive && me.skillFailureUntil > this.game.time && me.skillFailure ? me.skillFailure : pc.noticeTime > 0 && me.alive ? pc.notice : '';
    setText(e.notice, notice);
    e.notice.style.display = notice ? '' : 'none';

    this.intermission?.update();
    this.fb.update(dt,this.viewportWidth,this.viewportHeight);
    this.minimap.update(dt);
  }

  private updateScore(team: Team, enemy: Team): void {
    const g = this.game;
    const e = this.e;
    const free = g.config.type === 'freeplay';
    if (g.caps.length) {
      setText(e.scoreA, String(Math.max(0, Math.round(g.score[team]))));
      setText(e.scoreE, String(Math.max(0, Math.round(g.score[enemy]))));
      setWidth(e.barA, g.score[team] / DOMINATION_WIN_SCORE / 2);
      setWidth(e.barE, g.score[enemy] / DOMINATION_WIN_SCORE / 2);
      if (e.caps.childElementCount !== g.caps.length) {
        e.caps.replaceChildren(
          ...g.caps.map((c) => {
            const d = el('div', 'cap');
            d.textContent = c.name;
            return d;
          }),
        );
      }
      g.caps.forEach((c, i) => {
        const cls = `cap${c.owner === -1 ? '' : c.owner === team ? ' ally' : ' enemy'}${c.contested || (c.progress > 0 && c.capturer !== -1) ? ' contested' : ''}`;
        setClass(e.caps.children[i], cls);
      });
    }
    const cv = g.convoy;
    if (cv) {
      const state = (s: Ship) => (s.withdrawn ? 'port' : s.alive ? 'sea' : 'sunk');
      const key = cv.transports.map(state).join();
      if (key !== this.convoyKey) {
        this.convoyKey = key;
        e.convoy.replaceChildren(
          ...cv.transports.map((s) => {
            const b = el('b', state(s));
            b.title = `${s.name}: ${state(s) === 'port' ? 'in port' : state(s) === 'sea' ? 'at sea' : 'sunk'}`;
            return b;
          }),
        );
      }
      setText(e.goal, cv.team === team ? `${cv.arrived} of ${ARRIVE_GOAL} in port` : `${cv.sunk} of ${SINK_GOAL} sunk`);
    }
    const alive = (t: Team) => g.fleet.filter((s) => s.team === t);
    const key = [team, enemy].map((t) => alive(t).map((s) => (s.alive ? 1 : 0)).join('')).join('|');
    if (key !== this.fleetKey) {
      this.fleetKey = key;
      e.fleet.replaceChildren();
      for (const t of [team, enemy]) {
        const span = el('span', t === team ? 'ally' : 'enemy', e.fleet);
        for (const s of alive(t)) {
          const b = el('b', s.alive ? '' : 'dead', span);
          b.title = s.base.name;
        }
      }
      if (!g.caps.length && !free) {
        setText(e.scoreA, String(alive(team).filter((s) => s.alive).length));
        setText(e.scoreE, String(alive(enemy).filter((s) => s.alive).length));
      }
    }
    // Free play keeps count of ships sunk by each fleet, and its clock runs up: there is no limit.
    if (free) {
      setText(e.scoreA, String(g.score[team]));
      setText(e.scoreE, String(g.score[enemy]));
    }
    const left = free ? g.time : Math.max(0, BATTLE_TIME_LIMIT - g.time);
    setText(e.timer, `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`);
    if (free && g.config.mode === 'lan') this.warnLimit(g.time);
  }

  /** LAN Free play ends at the server's time limit: say so 5 minutes and 1 minute before. */
  private warnLimit(t: number): void {
    const left = LAN_BATTLE_LIMIT_S - t;
    this.e.timer.classList.toggle('late', left <= 300);
    for (const m of [5, 1]) {
      // Only near the mark itself: a captain rejoining later is not told about a warning gone by.
      if (m >= this.limitWarned || left > m * 60 || left < m * 60 - 30) continue;
      this.limitWarned = m;
      this.callout(`Free play ends in ${m === 1 ? '1 minute' : `${m} minutes`}`, 'LAN battles stop after an hour', '#ffb547');
    }
  }

  private updateRush(): void {
    const r = this.game.rush!;
    const e = this.e;
    if (e.wave.dataset.w !== String(r.wave)) {
      e.wave.dataset.w = String(r.wave);
      e.wave.innerHTML = `Wave ${Math.max(1, r.wave)}<small>${r.survival || r.wave > RUSH_WAVES ? ' endless' : ` / ${RUSH_WAVES}`}</small>`;
    }
    setText(e.left, r.phase === 'fight' ? String(r.enemiesLeft) : r.phase === 'warmup' ? `${Math.ceil(r.timer)}s` : '—');
    // The refit cards take the centre of the screen; callouts would print over their heading.
    const hide = r.phase === 'offer' ? 'hidden' : '';
    e.alerts.style.visibility = hide;
    e.siren.style.visibility = hide;
    setText(e.pts, r.total.toLocaleString());
    const comboOn = r.combo > 1 && this.game.time - r.lastKillTime < 6;
    setText(e.combo, comboOn ? `×${r.combo} COMBO` : '');
    if (r.combo !== this.lastCombo) {
      this.lastCombo = r.combo;
      if (comboOn) flash(e.combo, 'fresh');
    }
    // Boss bar.
    const b = r.boss;
    const on = !!b && b.alive;
    e.bossbar.style.display = on ? '' : 'none';
    if (on && b) {
      setText(e.bossName, b.spec.name.toUpperCase());
      setText(e.bossHp, `${Math.round(b.hp).toLocaleString()} / ${b.maxHp.toLocaleString()}`);
      const f = b.hp / b.maxHp;
      if (f < this.bossChip) this.bossChip = Math.max(f, this.bossChip - 0.004);
      else this.bossChip = f;
      setWidth(e.bossFill, f);
      setWidth(e.bossChip, this.bossChip);
      setWidth(e.bossShield, b.shield / b.maxHp);
    } else this.bossChip = 1;
  }

  private updateHull(dt: number): void {
    const g = this.game;
    const me = this.pc.ship;
    const e = this.e;
    const team = this.team;
    const enemy: Team = team === 0 ? 1 : 0;
    const health=hullHealthDisplay(me),fmt=(n:number)=>Math.round(n).toLocaleString();
    e.hpNum.innerHTML = `${fmt(me.hp)} <small>/ ${fmt(health.maximum)}</small>`;
    const healthDetail=health.reserved>0
      ?`Hull ${fmt(me.hp)} / ${fmt(me.maxHp)} HP · ${fmt(health.reserved)} hull HP reserved · Platforms ${fmt(health.platformHp)} / ${fmt(health.platformMaxHp)} combat HP`
      :`Hull ${fmt(me.hp)} / ${fmt(health.maximum)} HP`;
    e.hpNum.title=healthDetail;e.hpbar.title=healthDetail;
    e.hpbar.setAttribute('aria-label',healthDetail);
    e.hpReserved.style.display=health.reserved>0?'':'none';
    setWidth(e.hpReserved,health.reserved/health.maximum);
    setText(e.hpReserved,health.reserved>=1e6?`${+(health.reserved/1e6).toFixed(1)}M`:`${Math.round(health.reserved/1000)}k`);
    const frac = me.hp / me.maxHp;
    if(me.architect&&this.lastHullCapacity!==me.maxHp){this.lastHp=me.hp;this.chipHp=me.hp;this.chipHold=0;}
    this.lastHullCapacity=me.maxHp;
    // Chip trail: holds for a moment after a hit, then drains to the real value.
    if (me.hp < this.lastHp - 1) {
      this.chipHold = 0.5;
      if (this.lastHp - me.hp > me.maxHp * 0.02) flash(e.hpbar, 'hit');
    }
    this.lastHp = me.hp;
    this.chipHold -= dt;
    if (this.chipHp < me.hp) this.chipHp = me.hp;
    else if (this.chipHold <= 0) this.chipHp = Math.max(me.hp, this.chipHp - me.maxHp * 0.5 * dt);
    if (me.form && e.formFill) {
      const left = me.formLeft;
      setWidth(e.formFill, left / (me.form.until - me.form.start));
      setText(e.formLeft, `${Math.ceil(left)} s`);
    }
    setWidth(e.hp, me.hp / health.maximum);
    setWidth(e.hpChip, Math.min(this.chipHp,me.maxHp) / health.maximum);
    setWidth(e.hpShield, Math.min(me.shield,me.maxHp) / health.maximum);
    const regen = me.alive && me.regenerating;
    setClass(e.hp, `fill${frac < 0.3 ? ' low' : frac < 0.6 ? ' mid' : regen ? ' regen' : ''}`);
    e.regen.style.display = regen ? '' : 'none';
    const critical = me.alive && frac < 0.25;
    e.crit.style.display = critical ? '' : 'none';
    if (critical && g.time - this.lastHeartbeat > 1.1) {
      this.lastHeartbeat = g.time;
      audio.ui('heartbeat');
    }

    const st: [string, string, string][] = [];
    const fires = me.fires.filter((f) => f > 0).length;
    if (fires) st.push([fires > 1 ? `Fire ×${fires}` : 'Fire', 'fire', glyph('fire')]);
    if (me.flooding > 0) st.push(['Flooding', 'flood', glyph('flood')]);
    if (me.mods.banished) st.push(['Banished', '', glyph('portal')]);
    else if (me.mods.stunned) st.push(['Stunned', '', glyph('lightning')]);
    if (me.mods.silenced) st.push(['Silenced', '', glyph('silence')]);
    if (me.mods.disarmed) st.push(['Disarmed', '', glyph('blade')]);
    if (me.mods.feared) st.push(['Feared', '', glyph('fear')]);
    if (me.mods.rooted) st.push(['Rooted', '', glyph('root')]);
    if (me.mods.healBlock) st.push(['No repairs', '', glyph('skull')]);
    const exposure = revealSource(me, enemy);
    const proximity = proximityContact(me, enemy);
    if (exposure) st.push([exposure === 'sonar' ? 'Sonar revealed' : exposure === 'proximity' ? (proximity === 'forced' ? 'Proximity revealed' : 'Nearby detection') : 'Ability revealed', '', glyph('eye')]);
    else if (proximity === 'submarine') st.push(['Nearby silhouette', '', glyph('eye')]);
    if (me.guard) st.push([me.guard.left > 1 ? `Warded ×${me.guard.left}` : 'Warded', 'buff', glyph('rune')]);
    if (me.mods.undying || me.lastStand) st.push(['Undying', 'buff', glyph('skull')]);
    if (me.mods.marked) st.push(['Marked', '', glyph('strike')]);
    if (me.mods.inverted) st.push(['Inverted', '', glyph('swap')]);
    if (me.link && me.link.until > g.time) st.push([me.link.mode === 'spread' ? 'Hive-linked' : 'Chained', me.link.mode === 'spread' ? 'buff' : '', glyph('magnet')]);
    if (me.mods.ccImmune) st.push(['CC-immune', 'buff', glyph('heal')]);
    if (me.mods.spellMirror) st.push(['Spell mirror', 'buff', glyph('shield')]);
    if (me.mods.hitCap > 0) st.push(['Oathbound', 'buff', glyph('shield')]);
    if (me.rudderJam > 0) st.push(['Steering gear', '', '']);
    if (me.engineDown > 0) st.push(['Engine', '', '']);
    if (me.mods.invulnerable) st.push(['Invulnerable', 'buff', glyph('shield')]);
    if (me.mods.untargetable && !me.mods.banished) st.push([exposure ? 'Cloak exposed' : 'Untargetable', exposure ? '' : 'buff', glyph('cloak')]);
    if (me.fireProof) st.push(['Fireproof', 'buff', glyph('wrench')]);
    if(me.architect){
      const a=me.architect,u=a.ultimate;
      for(const [index,icon] of [[1,'salvo'],[2,'lightning'],[5,'shield']] as const){
        const timing=architectSkillPresentation(me,index);
        if(timing.activeRemaining>0)st.push([`${timing.phase} · ${timing.activeRemaining.toFixed(1)}s`,'buff',glyph(icon)]);
      }
      if(u){
        const index=u.kind==='assembly'?6:u.kind==='killbox'?7:8,timing=architectSkillPresentation(me,index);
        st.push([`${u.kind==='assembly'?'Assembly':u.kind==='killbox'?'Grand Battery':'Citadel'} · ${timing.phase} ${timing.activeRemaining.toFixed(1)}s · ${timing.members}/10`,'buff',glyph('fleet')]);
      }
      const incoming=architectIncomingBattery(me);
      if(incoming)st.push([`Battery incoming · ${incoming.remaining.toFixed(1)}s · ${incoming.count} ${incoming.count===1?'round':'rounds'}`,'buff',glyph('salvo')]);
    }
    if(me.stepper) {
      const a=me.stepper;
      if(a.sideUntil>g.time)st.push([`Sidestep ${Math.ceil(a.sideUntil-g.time)}s`, 'buff',glyph('blink')]);
      if(a.broadUntil>g.time)st.push([`Broadstep ${Math.ceil(a.broadUntil-g.time)}s`, 'buff',glyph('salvo')]);
      const copies=g.ships.filter(s=>s.alive&&s.summonOwner===me&&s.stepper?.copy);
      if(copies.length)st.push([`Afterimages ${copies.length}/4 · ${Math.ceil(Math.max(...copies.map(s=>s.expiresAt))-g.time)}s`, 'buff',glyph('fleet')]);
      if(a.cross)st.push([`Cross-step ${a.cross.count}/${CROSS.cuts}`, 'buff',glyph('blade')]);
      if(a.repair)st.push([`Backstep repair ${Math.ceil(a.repair.remaining)}s`, 'buff',glyph('heal')]);
      if(a.repairInterruptedUntil>g.time)st.push(['Backstep repair interrupted', '',glyph('heal')]);
      if(a.flicker)st.push([`Flicker ${a.flicker.count}/20`, 'buff',glyph('blink')]);
    }
    if (this.tungsten) for (const line of this.tungsten.status) st.push([line.text, line.buff ? 'buff' : '', glyph(line.icon)]);
    if (me.effects.some((f) => f.id === 'pickup:fury')) st.push(['Fury', 'buff', glyph('fire')]);
    if (g.exposed[team] > 0) st.push(['Enemies exposed', 'buff', glyph('reveal')]);
    if (g.exposed[enemy] > 0) st.push(['You are exposed', '', glyph('reveal')]);
    if (g.inSmoke(me.pos.x, me.pos.z)) st.push([exposure ? 'Smoke exposed' : 'Smoke concealment', exposure ? '' : 'buff', '']);
    if (me.submerged && !exposure) st.push(['Depth concealment', 'buff', glyph('cloak')]);
    for (const c of me.consumables) if (c.spec.type === 'search' && c.active > 0) {
      const r = c.spec.power ?? 0;
      const n = g.ships.filter(s => s.alive && s.team !== team && dist2D(s.pos.x, s.pos.z, me.pos.x, me.pos.z) <= r).length;
      st.push([`Search ${(r / 1000).toFixed(1)} km · ${Math.ceil(c.active)}s · ${n} contacts`, 'buff', glyph('eye')]);
    }
    const stKey = st.map((s) => s[0]).join(',');
    if (e.status.dataset.k !== stKey) {
      e.status.dataset.k = stKey;
      e.status.replaceChildren(
        ...st.map(([t, cls, ic]) => {
          const s = el('span', cls);
          s.innerHTML = ic;
          s.append(t);
          return s;
        }),
      );
    }
  }

  private updateSkills(): void {
    const me = this.pc.ship;
    const tungsten = this.tungsten;
    me.skills.forEach((st, i) => {
      const se = this.skillEls[i];
      // Switch and Signature name the current mode and its move, in its colour.
      if (tungsten && se.nm && (st.spec.id === 'tungstenSwitch' || st.spec.id === 'tungstenSignature')) {
        const sig = st.spec.id === 'tungstenSignature';
        setText(se.nm, sig ? tungsten.signatureLabel : tungsten.switchLabel);
        const title = `${st.spec.name}: ${st.spec.description}\n${sig ? tungsten.signatureTitle : tungsten.switchTitle}`;
        if (se.root.title !== title) se.root.title = title;
        if (se.root.style.getPropertyValue('--accent') !== tungsten.accent) se.root.style.setProperty('--accent', tungsten.accent);
      }
      const ready = me.skillReady(i);
      let p: number;
      let t = '';
      const timing=me.architect?architectSkillPresentation(me,i):null;
      const active=timing?timing.activeRemaining>0:st.active;
      if (timing&&active) {
        p=1-timing.activeRemaining/Math.max(.01,timing.activeTotal);
        t=String(Math.ceil(timing.activeRemaining));
      } else if (st.active) {
        p = 1 - st.time / Math.max(0.01, st.spec.duration);
        t = String(Math.ceil(st.time));
      } else if (st.spec.ult) {
        p = 1 - st.meter;
        t = ready ? '' : `${Math.floor(st.meter * 100)}%`;
      } else {
        const full = st.spec.cooldown * me.mods.cooldownMul;
        p = st.cooldown > 0 ? Math.min(1, st.cooldown / Math.max(0.01, full)) : 0;
        t = st.cooldown > 0 ? String(Math.ceil(st.cooldown)) : '';
      }
      if(timing){se.root.dataset.phase=timing.phase;se.root.title=`${st.spec.name}: ${active?`${timing.phase} · ${timing.activeRemaining.toFixed(1)}s${timing.members!==undefined?` · ${timing.members}/10 platforms`:''}`:ready?'Ready':timing.cooldownRemaining>0?`${timing.cooldownRemaining.toFixed(1)}s recharge`:'Charging'}`;}
      se.root.style.setProperty('--p', p.toFixed(3));
      setText(se.t, t);
      const cls = `sk${st.spec.ult ? ' ult' : ''}${active ? ' active' : ready ? ' ready' : ' cool'}${se.root.classList.contains('flash') ? ' flash' : ''}`;
      setClass(se.root, cls);
      if (ready && !se.wasReady && me.alive) {
        flash(se.root, 'flash');
        if (st.spec.ult) {
          this.callout('Ultimate ready', `${st.spec.name}: press ${se.key?.textContent ?? ''}`, '#ffb547');
          audio.ui('ultReady');
        }
      }
      se.wasReady = ready;
    });
    me.consumables.forEach((c, i) => {
      const ce = this.consEls[i];
      if(c.spec.type==='search'){ce.root.dataset.utility='search';ce.root.title=consumableLabel(c.spec.type,me.spec);ce.root.setAttribute('aria-label',ce.root.title);}
      const p = c.active > 0 ? 0 : c.cooldown > 0 ? Math.min(1, c.cooldown / c.spec.cooldown) : c.charges <= 0 ? 1 : 0;
      ce.root.style.setProperty('--p', p.toFixed(3));
      setText(ce.t, c.active > 0 ? String(Math.ceil(c.active)) : c.cooldown > 0 ? String(Math.ceil(c.cooldown)) : '');
      const ch = ce.root.querySelector('.ch') as HTMLElement;
      ch.hidden=false;
      setText(ch, c.charges > 50 ? '' : String(c.charges));
      ch.style.display = c.charges > 50 ? 'none' : '';
      const ready = c.charges > 0 && c.cooldown <= 0;
      ce.root.classList.toggle('active', c.active > 0);
      ce.root.classList.toggle('ready', ready && c.active <= 0);
      ce.root.classList.toggle('cool', !ready && c.active <= 0);
      ce.root.classList.toggle('empty', c.charges <= 0);
    });
    const mobility=me.getVectorMobilityStatus();
    if(mobility){
      const view=vectorMobilityPresentation(mobility);
      if(this.e.vectorGap)this.e.vectorGap.hidden=!mobility.equipped;
      [view.dash,view.mobile].forEach((state,i)=>{
        const item=this.vectorEls[i];if(!item)return;
        item.root.hidden=!mobility.equipped;if(!mobility.equipped)return;
        const active=i===0?mobility.hullDash.activeRemaining:mobility.mobileBattery.activeRemaining;
        if(item.lastActive!==undefined&&active>item.lastActive+.05&&me.alive)audio.ui('ability');
        item.lastActive=active;
        setText(item.count,state.count);item.count.hidden=!state.count;setText(item.t,state.timer);
        item.root.dataset.state=state.tone;item.root.style.setProperty('--p',state.sweep.toFixed(3));
        setClass(item.root,`sk cons vector ${state.tone==='active'?'active':state.tone==='ready'||state.tone==='blocked'&&state.ready?'ready':'cool'}${state.tone==='off'?' off':''}${item.root.classList.contains('flash')?' flash':''}`);
        if(state.ready&&!item.wasReady&&me.alive)flash(item.root,'flash');
        item.wasReady=state.ready;
        const key=item.root.querySelector('kbd')!,code=bindings()[i===0?'architectHullDash':'architectMobileBattery'],unbound=this.pc.layout&&!code;
        key.classList.toggle('unbound',!!unbound);if(this.pc.layout)setText(key,keyName(code)||'Unbound');
        item.root.title=`${state.title}${unbound?' · Keyboard unbound: assign a key in Settings':''}`;
        item.root.setAttribute('aria-label',`${key.textContent}: ${item.root.title}`);
      });
    }
  }

  private torpedoThreat(me: Ship): boolean {
    for (const t of this.game.torps.torps) {
      if (!t.alive || t.team === me.team || !t.seen) continue;
      const dx = me.pos.x - t.x;
      const dz = me.pos.z - t.z;
      const d = Math.hypot(dx, dz);
      if (d > 1200) continue;
      const fx = Math.sin(t.heading);
      const fz = -Math.cos(t.heading);
      const along = dx * fx + dz * fz;
      if (along < 0) continue;
      const miss = Math.abs(dx * fz - dz * fx);
      if (miss < me.spec.length * 0.8 || t.homing === me) return true;
    }
    return false;
  }

  /** A telegraphed enemy strike is about to land on top of us. */
  private strikeThreat(me: Ship): boolean {
    if (!me.alive) return false;
    for (const s of this.game.strikes.strikes) {
      if (!s.alive || s.team === me.team || s.kind === 'mine' || s.kind === 'shock') continue;
      if (dist2D(me.pos.x, me.pos.z, s.x, s.z) < s.radius + me.spec.length * 0.5) return true;
    }
    return false;
  }

  private project(x: number, y: number, z: number): { x: number; y: number } | null {
    v3.set(x, y, z).project(this.pc.camera);
    if (v3.z > 1 || v3.z < -1) return null;
    return { x: (v3.x * 0.5 + 0.5) * this.viewportWidth, y: (-v3.y * 0.5 + 0.5) * this.viewportHeight };
  }

  private updateTungsten(): void {
    const v = this.tungsten?.panel;
    const els = this.tungstenEls;
    if (!v || !els) return;
    const t = this.tungsten!;
    if (els.root.style.getPropertyValue('--mode') !== t.accent) els.root.style.setProperty('--mode', t.accent);
    setText(els.mode, t.switchLabel);
    setText(els.where, v.where);
    for (const key of ['energy', 'cube', 'store'] as const) {
      const g = els.gauges[key];
      const value = v[key];
      g.root.hidden = !value;
      if (!value) continue;
      g.root.classList.toggle('low', value.low);
      setWidth(g.fill, value.frac);
      setText(g.text, value.text);
    }
    els.root.classList.toggle('overdrive', v.cubes.length > 0);
    v.cubes.forEach((c, i) => {
      const bar = els.cubes[i];
      if (bar.style.getPropertyValue('--type') !== c.color) bar.style.setProperty('--type', c.color);
      const f = `${Math.max(0, Math.min(1, c.frac))}`;
      if (bar.style.getPropertyValue('--health') !== f) bar.style.setProperty('--health', f);
    });
  }

  private updateMarkers(): void {
    const g = this.game;
    const me = this.pc.ship;
    const W = this.viewportWidth;
    const H = this.viewportHeight;
    const items: { s: Ship; x: number; y: number; d: number; label: string }[] = [];
    const off: { s: Ship; d: number }[] = [];
    for (const s of g.ships) {
      if (!s.alive || s === me || !contactVisible(s, this.team)) continue;
      const ally = s.team === this.team;
      const top = (s.superBox?.top ?? s.spec.freeboard + 6) + 14 + Math.max(0, s.renderPos.y);
      if (!ally && cameraOccluded(g, this.pc.camera.position, { x: s.renderPos.x, y: s.renderPos.y + s.spec.freeboard, z: s.renderPos.z }, this.team)) continue;
      const p = this.project(s.renderPos.x, top, s.renderPos.z);
      const d = dist2D(me.pos.x, me.pos.z, s.pos.x, s.pos.z);
      if (!p || p.x < -50 || p.y < -20 || p.x > W + 50 || p.y > H + 20) {
        // Off-screen chevrons for enemies, and for the convoy whichever side it sails for.
        if ((!ally || s.spec.cls === 'AK') && !s.isSummon) off.push({ s, d });
        continue;
      }
      const name = s.architectPlatform ? `${ARCHETYPES[s.architectPlatform.owner.architect!.slots[s.architectPlatform.index].type].name} ${s.architectPlatform.index+1}` : captainName(s);
      const compact=!!s.architectPlatform&&this.pc.lock!==s&&this.pc.aimHit?.ship!==s;
      const label = compact ? `${s.architectPlatform!.index+1} ${ARCHETYPES[s.architectPlatform!.owner.architect!.slots[s.architectPlatform!.index].type].short}` : ally ? name : `${name}  ${(d / 1000).toFixed(1)} km`;
      items.push({ s, x: p.x, y: p.y, d, label });
    }
    // Declutter: nearer (and locked) ships keep their spot, others stack upward.
    const lock = this.pc.lock;
    items.sort((a, b) => (a.s === lock ? -1 : b.s === lock ? 1 : a.d - b.d));
    const rowH = 24;
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    items.forEach((it, n) => {
      const w = Math.max(it.s.architectPlatform?60:0,it.label.length * 6.4 + 30);
      let y = it.y;
      for (let tries = 0; tries < 6; tries++) {
        const box = { x0: it.x - w / 2, x1: it.x + w / 2, y0: y - rowH, y1: y };
        if (!placed.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) break;
        y -= rowH;
      }
      placed.push({ x0: it.x - w / 2, x1: it.x + w / 2, y0: y - rowH, y1: y });
      let m = this.markers[n];
      if (!m) {
        m = el('div', 'marker', this.markerLayer);
        m.innerHTML = '<div class="nm"><span class="ci"></span><span class="tx"></span></div><div class="hp"><i></i></div><div class="sh"><i></i></div>';
        this.markers.push(m);
      }
      m.style.display = '';
      const s = it.s;
      const cls = `marker ${s.team === this.team ? 'ally' : 'enemy'}${s.spec.cls === 'TT' ? ' titan' : s.spec.cls === 'AK' ? ' cargo' : ''}${lock === s ? ' locked' : ''}${s.architectPlatform?' module-contact':''}${s.architectPlatform&&lock!==s&&this.pc.aimHit?.ship!==s?' compact':''}`;
      if (m.className !== cls) m.className = cls;
      if (m.dataset.cls !== s.spec.cls) {
        m.dataset.cls = s.spec.cls;
        (m.querySelector('.ci') as HTMLElement).innerHTML = classIcon(s.spec.cls);
      }
      m.style.transform = `translate(${it.x.toFixed(0)}px, ${y.toFixed(0)}px) translate(-50%, -100%)`;
      setText(m.querySelector('.tx') as HTMLElement, it.label);
      setWidth(m.querySelector('.hp i') as HTMLElement, s.hp / s.maxHp);
      if(s.architectPlatform){
        m.dataset.health=s.hp/s.maxHp<.3?'low':s.hp/s.maxHp<.6?'mid':'high';
        m.setAttribute('aria-label',`Module ${s.architectPlatform.index+1}: ${Math.ceil(s.hp).toLocaleString()} / ${Math.round(s.maxHp).toLocaleString()} HP`);
      }else{delete m.dataset.health;m.removeAttribute('aria-label');}
      let cds=m.querySelector('.module-cooldowns') as HTMLElement|null;
      const tag=s.architectPlatform,owned=tag?.owner===this.pc.ship;
      if(owned&&tag){
        const timing=architectModuleSkillPresentation(tag.owner,tag.index);
        if(!cds){cds=el('div','module-cooldowns',m);const ring=el('i','module-skill-cooldown',cds);ring.setAttribute('role','img');}
        cds.style.display='';
        const ring=cds.firstElementChild as HTMLElement;
        ring.style.setProperty('--ready',String(timing.progress));ring.style.setProperty('--cool-color',timing.color);
        ring.dataset.phase=timing.phase;ring.title=timing.label;ring.setAttribute('aria-label',timing.label);
        setText(ring,timing.phase==='disabled'?'×':timing.phase==='paused'?'Ⅱ':timing.eta!==null&&timing.eta>0?String(Math.ceil(timing.eta)):'◆');
      }else if(cds)cds.style.display='none';
      const sh = m.querySelector('.sh') as HTMLElement;
      sh.style.visibility = s.shield > 0 ? '' : 'hidden';
      if (s.shield > 0) setWidth(sh.firstChild as HTMLElement, s.shield / Math.max(1, s.shieldMax));
    });
    for (let i = items.length; i < this.markers.length; i++) this.markers[i].style.display = 'none';
    this.updateOffscreen(off, W, H);
  }

  /** Bearing of a point from the camera, in radians clockwise from straight ahead on screen. */
  private screenBearing(x: number, z: number): number {
    const cam = this.pc.camera;
    cam.getWorldDirection(v3);
    const fl = Math.hypot(v3.x, v3.z) || 1;
    const fx = v3.x / fl;
    const fz = v3.z / fl;
    const dx = x - cam.position.x;
    const dz = z - cam.position.z;
    return Math.atan2(-dx * fz + dz * fx, dx * fx + dz * fz);
  }

  /** Chevrons on an ellipse near the screen edge for the nearest enemies out of view. */
  private updateOffscreen(off: { s: Ship; d: number }[], W: number, H: number): void {
    off.sort((a, b) => a.d - b.d);
    const n = Math.min(off.length, MAX_OFFSCREEN);
    const rx = W * 0.44;
    const ry = H * 0.4;
    for (let i = 0; i < n; i++) {
      const { s, d } = off[i];
      let m = this.offMarks[i];
      if (!m) {
        m = el('div', 'offmark', this.markerLayer);
        m.innerHTML = '<svg viewBox="-12 -12 24 24"><path d="M-9 4 L0 -6 L9 4 L0 0 Z"/></svg><span class="num"></span>';
        this.offMarks.push(m);
      }
      m.style.display = '';
      const cls = `offmark${s.spec.cls === 'TT' ? ' titan' : s.spec.cls === 'AK' ? ' cargo' : ''}`;
      if (m.className !== cls) m.className = cls;
      const a = this.screenBearing(s.renderPos.x, s.renderPos.z);
      m.style.transform = `translate(${(W / 2 + Math.sin(a) * rx).toFixed(0)}px, ${(H / 2 - Math.cos(a) * ry).toFixed(0)}px) translate(-50%, -50%)`;
      (m.firstChild as HTMLElement).style.transform = `rotate(${a.toFixed(3)}rad)`;
      setText(m.lastChild as HTMLElement, `${(d / 1000).toFixed(1)} km`);
    }
    for (let i = n; i < this.offMarks.length; i++) this.offMarks[i].style.display = 'none';
  }

  private updateReticle(): void {
    const pc = this.pc;
    const me = pc.ship;
    const e = this.e;
    const slot = me.currentSlot;
    const alive = me.alive;
    // Riding a shell in: the graticule would point nowhere useful, so a caption replaces it.
    const sc = pc.shellCam;
    const riding = alive && sc.weight > 0.5;
    e.shellcam.style.display = riding ? '' : 'none';
    if (riding) {
      const p = sc.impact;
      const k = !p ? '' : sc.kill ? 'Killing blow' : p.outcome === 'citadel' ? 'Citadel' : 'Hit';
      setText(e.shellcam, p ? `${k} on ${captainName(p.ship)}` : 'Following the shot');
    }
    e.reticle.style.display = alive && !riding ? '' : 'none';
    e.dots.style.display = alive && !riding && slot?.kind === 'gun' ? '' : 'none';
    e.lead.style.display = 'none';
    e.lock.style.display = 'none';
    if (!alive || riding) return;
    const range = pc.range;
    let main = `${(range / 1000).toFixed(2)} km`;
    let sub = '';
    let note = '';
    let out = false;
    if (slot?.kind === 'gun') {
      const table = me.tableFor(slot.ammo);
      if (table) {
        out = range > table.maxRange;
        sub = out ? 'Beyond gun range' : `${solve(table, range).time.toFixed(1)} s flight, ${slot.ammo}`;
        const live = me.turrets.filter((t) => t.disabled <= 0);
        const bearing = live.filter((t) => t.canBear).length;
        const aligned = live.filter((t) => t.aligned).length;
        if (live.length && !bearing) note = 'Outside firing arcs: turn the ship';
        else if (aligned < bearing) note = `Turrets traversing, ${aligned} of ${bearing} on target`;
        this.lead(this.gunTarget(table.maxRange), (d) => solve(table, d).time);
      }
    } else if (slot?.kind === 'torp' && me.spec.torpedoes) {
      const torps = me.spec.torpedoes;
      const sp = torps.speed * KNOT * SPEED_SCALE;
      out = range > torps.range;
      sub = out ? 'Beyond torpedo range' : `${(range / sp).toFixed(0)} s run`;
      note = me.launchers.map((l, i) => `${i + 1}: ${me.torpedoReadiness(l, pc.aim.x, pc.aim.z)}`).join(' · ');
      this.lead(this.nearestEnemy(torps.range), (d) => d / sp);
    } else if (slot?.kind === 'air') {
      sub = `${slot.label} strike`;
      out = range > (me.spec.air?.range ?? 0);
    } else if (slot?.kind === 'cube' && me.tungsten) {
      ({ text: sub, out } = cubeReticle(me.tungsten, this.game.time, pc.aim.x, pc.aim.z));
    } else if (slot?.kind === 'vls' && me.spec.missiles) {
      const lock = me.vls?.lock;
      out = range > me.spec.missiles.range;
      sub = out ? 'Beyond missile range' : lock ? `Locked: ${captainName(lock)}` : 'No lock: salvo scatters on the reticle';
      const p = lock && this.project(lock.renderPos.x, lock.spec.freeboard, lock.renderPos.z);
      if (p) {
        e.lock.style.display = '';
        e.lock.style.transform = `translate(${p.x.toFixed(0)}px, ${p.y.toFixed(0)}px) translate(-50%, -50%)`;
      }
    }
    if (pc.lock) main += `, ${captainName(pc.lock)}`;
    if (pc.zoom) main += `, ${pc.scopeMag.toFixed(pc.scopeMag < 10 ? 1 : 0)}x`;
    const key = `${out}|${main}|${sub}|${note}`;
    if (e.readout.dataset.k !== key) {
      e.readout.dataset.k = key;
      e.readout.replaceChildren();
      const m = el('span', out ? 'out' : '', e.readout);
      m.textContent = main;
      el('small', '', e.readout).textContent = sub;
      if (note) el('small', 'note', e.readout).textContent = note;
    }
    me.turrets.forEach((t, i) => {
      const d = this.turretDots[i];
      setClass(d, me.architect&&!me.architect.slots[i].aboard ? 'remote' : t.disabled > 0 ? 'off' : t.reload <= 0 ? `ready${t.aligned ? ' bear' : ''}` : '');
    });
  }

  private liveEnemies(): Ship[] {
    const me = this.pc.ship;
    return this.game.ships.filter((s) => canTrack(me, s));
  }

  private nearestEnemy(maxRange: number): Ship | null {
    const me = this.pc.ship;
    if (this.pc.lock) return this.pc.lock;
    let best: Ship | null = null;
    let bestD = maxRange;
    for (const s of this.liveEnemies()) {
      const d = dist2D(me.pos.x, me.pos.z, s.pos.x, s.pos.z);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  /** The locked ship, else the enemy nearest the point the reticle is on. */
  private gunTarget(maxRange: number): Ship | null {
    const pc = this.pc;
    const me = pc.ship;
    if (pc.lock) return pc.lock;
    let best: Ship | null = null;
    let bestD = Math.max(700, pc.range * 0.15);
    for (const s of this.liveEnemies()) {
      if (dist2D(me.pos.x, me.pos.z, s.pos.x, s.pos.z) > maxRange) continue;
      const d = dist2D(pc.aim.x, pc.aim.z, s.pos.x, s.pos.z);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  /** Lead marker: put the reticle on it and a shot fired now meets the target. Filled while assist is steering. */
  private lead(t: Ship | null, flightTime: (d: number) => number): void {
    t = this.pc.assist ?? t;
    if (!t) return;
    const l = leadPoint(this.pc.ship, t, flightTime);
    const p = this.project(l.x, 2, l.z);
    if (!p) return;
    this.e.lead.style.display = '';
    this.e.lead.classList.toggle('assist', this.pc.assist === t);
    this.e.lead.style.transform = `translate(${p.x.toFixed(0)}px, ${p.y.toFixed(0)}px) translate(-50%, -50%)`;
  }
}
