import { Vector3 } from 'three';
import { DOMINATION_WIN_SCORE } from '../../config';
import type { Team } from '../../core/types';
import { accentCss } from '../../data/accents';
import { audio } from '../../fx/Audio';
import type { Input } from '../../input/Input';
import { keyName, onBindings } from '../../input/Keybinds';
import { LAN_BATTLE_LIMIT_S } from '../../net/protocol';
import { glyph, groundConsumableIcon, skillIcon, vehicleClassIcon } from '../../ui/Icons';
import { palette } from '../../ui/palette';
import { GROUND_TIME_LIMIT, KMH, REGEN_DELAY, TITAN } from '../sim/config';
import type { GroundGame } from '../sim/GroundGame';
import type { AmmoKind, GroundConsumableType } from '../sim/types';
import type { Vehicle } from '../sim/Vehicle';
import type { PenColour } from './aim';
import { GroundMinimap } from './GroundMinimap';
import type { TankController } from './TankController';

// The heads-up display for one ground captain, bound to a TankController: the aim circle with
// its penetration colour and reload ring, markers over every vehicle, the vehicle card with crit
// lamps, the cockpit (hull, skills, consumables, ammo), score and caps, feeds and the minimap.

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

/** A vehicle as the interface names it: the captain as well when a friend drives it on LAN, "(you)" on your own. */
export function vehicleName(v: Vehicle, me: Vehicle | null = null): string {
  if (v === me) return `${v.spec.name} (you)`;
  if (v.humanIndex >= 0 && v.game.config.mode === 'lan') return `${v.name} (${v.spec.name})`;
  return v.spec.name;
}

const SVG = 'http://www.w3.org/2000/svg';
/** Gamepad labels: normal skills, then ultimates (titans hold LB or RB for their second and third set). */
const PAD_NORMAL = ['X', 'B', 'LB X', 'LB B', 'RB X', 'RB B'];
const PAD_ULT = ['Y', 'LB Y', 'RB Y'];
const PAD_CONS = ['↑', '→'];
const CONS_SHORT: Record<GroundConsumableType, string> = {
  repair: 'REPAIR',
  applique: 'PLATES',
  overdrive: 'BOOST',
  smoke: 'SMOKE',
  steady: 'STEADY',
  relocate: 'MOVE',
  rapidReload: 'RELOAD',
  fieldRepair: 'AURA',
  bulwark: 'BULWARK',
};
const AMMO_NAME: Record<AmmoKind, string> = { AP: 'AP', HE: 'HE', HEAT: 'HEAT', APDS: 'APDS' };
const PEN_TEXT: Record<PenColour, string> = { none: '', green: 'Penetrates', yellow: 'Coin toss', red: 'Will not penetrate', grey: 'Ricochet angle' };

/** Hits on one target closer together than this make one popup; skill volleys merge for longer. */
const MERGE = 0.35;
const SKILL_MERGE = 1.5;
const POP_LIFE = 1.6;
const POOL = 12;
const ARC_LIFE = 2;
const STREAK = 15;
const STREAK_NAME = ['', '', 'Double kill', 'Triple kill', 'Quad kill', 'Rampage', 'Unstoppable'];
const ARC_PATH = (() => {
  const r = 118;
  const a = (18 * Math.PI) / 180;
  const x = (r * Math.sin(a)).toFixed(1);
  const y = (-r * Math.cos(a)).toFixed(1);
  return `M-${x} ${y} A${r} ${r} 0 0 1 ${x} ${y}`;
})();

type PopKind = 'penetration' | 'ricochet' | 'shatter' | 'he' | 'fire' | 'skill';
const POP_RANK: Record<PopKind, number> = { skill: 9, penetration: 5, he: 4, fire: 2, ricochet: 1, shatter: 1 };
const POP_LABEL: Record<PopKind, string> = { skill: '', penetration: 'Penetration', he: 'HE splash', fire: 'Fire', ricochet: 'Ricochet', shatter: 'Blocked' };

interface Pop {
  el: HTMLElement;
  label: HTMLElement;
  num: HTMLElement;
  live: boolean;
  target: Vehicle | null;
  key: string;
  born: number;
  last: number;
  row: number;
  kind: PopKind;
  counts: Partial<Record<PopKind, number>>;
  damage: number;
  title: string;
}

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
  key?: HTMLElement;
}

const v3 = new Vector3();
const v4 = new Vector3();
const gp = new Vector3();

export class GroundHUD {
  readonly root: HTMLElement;
  private team: Team;
  private off: (() => void)[] = [];
  private markers: HTMLElement[] = [];
  private markerLayer: HTMLElement;
  private minimap: GroundMinimap;
  private e: Record<string, HTMLElement> = {};
  private svg: Record<string, SVGElement> = {};
  private slotEls: { root: HTMLElement; bar: HTMLElement; info: HTMLElement }[] = [];
  private skillEls: SkillEl[] = [];
  private consEls: SkillEl[] = [];
  private keyEls: { el: HTMLElement; text: () => string }[] = [];
  private ribbons: Ribbon[] = [];
  private feed: { el: HTMLElement; time: number }[] = [];
  private pops: Pop[] = [];
  private arcs: { g: SVGGElement; from: Vehicle | null; x: number; z: number; time: number }[] = [];
  private arcSvg: SVGSVGElement;
  private bannerUntil = 0;
  private limitWarned = Infinity;
  /** Real-time clock for the feedback, so slow motion does not stretch it. */
  private clock = 0;
  private hurt = 0;
  private lastKill = -100;
  private streak = 0;
  private chipHp: number;
  private chipHold = 0;
  private lastHp: number;
  private lastHeartbeat = -100;
  private fleetKey = '';
  /** The vehicle the cockpit was built for (Free play swaps rebuild it). */
  private built: Vehicle;

  constructor(
    private game: GroundGame,
    private pc: TankController,
    private input: Input,
  ) {
    this.team = pc.v.team;
    this.root = el('div', 'hud ground');
    const r = this.root;
    const e = this.e;
    this.built = pc.v;
    this.chipHp = this.lastHp = pc.v.hp;

    e.scope = el('div', 'scope', r);
    e.hurtfx = el('div', 'hurt', r);
    this.markerLayer = el('div', '', r);
    const pops = el('div', 'pops', r);
    for (let i = 0; i < POOL; i++) {
      const p = el('div', 'pop', pops);
      p.style.display = 'none';
      const label = el('small', '', p);
      const num = el('b', 'num', p);
      this.pops.push({ el: p, label, num, live: false, target: null, key: '', born: 0, last: 0, row: 0, kind: 'he', counts: {}, damage: 0, title: '' });
    }

    // Top: score, caps and the clock.
    const top = el('div', 'top panel', r);
    e.scoreA = el('div', 'score ally num', top);
    const mid = el('div', 'mid', top);
    e.caps = el('div', 'caps', mid);
    const bar = el('div', 'score-bar', mid);
    e.barA = el('i', 'a', bar);
    e.barE = el('i', 'e', bar);
    e.scoreE = el('div', 'score enemy num', top);
    e.timer = el('div', 'timer num', mid);
    if (!game.caps.length) bar.style.display = 'none';
    if (game.config.type === 'freeplay') {
      e.scoreA.title = 'Enemy vehicles your side has destroyed';
      e.scoreE.title = 'Your vehicles the enemy has destroyed';
    }
    e.fleet = el('div', 'fleet', r);

    // The aim: a fixed crosshair at the screen centre, and the circle where the gun really points.
    const cross = el('div', 'gcross', r);
    cross.innerHTML = `<svg viewBox="-40 -40 80 80"><g fill="none" stroke-width="1.6" stroke-linecap="round"><path d="M-22 0 H-9 M9 0 H22 M0 9 V18"/><circle r="1.6" fill="currentColor" stroke="none"/></g></svg>`;
    e.cross = cross;
    const aim = el('div', 'gaim', r);
    aim.innerHTML = `<svg viewBox="-100 -100 200 200"><circle class="ring" r="20"/><circle class="reload" r="24" transform="rotate(-90)"/><g class="ticks"><path d="M0 -20 V-14 M0 20 V14 M-20 0 H-14 M20 0 H14"/></g></svg>`;
    e.aim = aim;
    this.svg.ring = aim.querySelector('.ring') as SVGElement;
    this.svg.reload = aim.querySelector('.reload') as SVGElement;
    this.svg.ticks = aim.querySelector('.ticks') as SVGElement;
    e.readout = el('div', 'greadout num', r);
    e.lock = el('div', 'marker lockbox', r);
    e.lock.innerHTML =
      '<svg width="44" height="44" viewBox="-22 -22 44 44"><path d="M-20 -11 V-20 H-11 M11 -20 H20 V-11 M20 11 V20 H11 M-11 20 H-20 V11" fill="none" stroke="#ff5a4a" stroke-width="2.5"/></svg>';
    e.lock.style.display = 'none';

    e.hitmark = el('div', 'hitmark', r);
    e.hitmark.innerHTML = '<svg viewBox="-24 -24 48 48"><path d="M-17 -17 L-8 -8 M17 -17 L8 -8 M-17 17 L-8 8 M17 17 L8 8"/></svg>';
    e.killmark = el('div', 'killmark', r);
    e.killmark.innerHTML = '<svg viewBox="-24 -24 48 48"><path d="M-15 -15 L15 15 M15 -15 L-15 15"/></svg>';
    const threats = el('div', 'threats', r);
    this.arcSvg = document.createElementNS(SVG, 'svg');
    this.arcSvg.setAttribute('viewBox', '-130 -130 260 260');
    threats.append(this.arcSvg);

    e.dmg = el('div', 'dmg-total', r);
    e.dmg.textContent = 'Damage dealt';
    e.dmgNum = el('b', 'num', e.dmg);
    e.ribbons = el('div', 'ribbons', r);
    e.killfeed = el('div', 'killfeed', r);
    e.alerts = el('div', 'alerts', r);
    e.callout = el('div', 'callout', e.alerts);
    e.alert = el('div', 'alert', e.alerts);
    e.banner = el('div', 'banner', e.alerts);
    e.crit = el('div', 'crit', r);
    e.crit.textContent = 'HULL CRITICAL';
    e.flashfx = el('div', 'flashfx', r);
    e.dead = el('div', 'dead-msg', r);
    e.hint = el('div', 'click-hint', r);
    e.hint.textContent = 'Click to take command';
    e.notice = el('div', 'click-hint', r);

    // Driver's panel, bottom left: speed, gear and the vehicle card.
    const helm = el('div', 'helm panel ghelm', r);
    const card = el('div', 'tankcard', helm);
    card.innerHTML = `<svg viewBox="-40 -40 80 80"><g class="hull"><rect class="trk l" x="-15" y="-22" width="6" height="44"/><rect class="trk r" x="9" y="-22" width="6" height="44"/><rect class="body" x="-10" y="-21" width="20" height="42" rx="2"/><path class="nose" d="M-6 -18 L0 -24 L6 -18"/></g><g class="turret"><rect class="tbody" x="-7" y="-8" width="14" height="15" rx="3"/><rect class="gun" x="-1.4" y="-34" width="2.8" height="27"/></g><path class="view" d="M0 0 L-14 -38 M0 0 L14 -38"/></svg>`;
    this.svg.hull = card.querySelector('.hull') as SVGElement;
    this.svg.turret = card.querySelector('.turret') as SVGElement;
    this.svg.trkL = card.querySelector('.trk.l') as SVGElement;
    this.svg.trkR = card.querySelector('.trk.r') as SVGElement;
    const lamps = el('div', 'lamps', card);
    e.lampTracks = el('i', '', lamps);
    e.lampTracks.innerHTML = glyph('wrench');
    e.lampTracks.title = 'Tracks';
    e.lampFire = el('i', '', lamps);
    e.lampFire.innerHTML = glyph('fire');
    e.lampFire.title = 'Engine fire';
    e.lampAmmo = el('i', '', lamps);
    e.lampAmmo.innerHTML = glyph('salvo');
    e.lampAmmo.title = 'Ammo rack';
    const spdBox = el('div', '', helm);
    const spd = el('div', 'spd', spdBox);
    e.spd = el('span', '', spd);
    el('small', '', spd).textContent = ' km/h';
    e.ord = el('div', 'ord', spdBox);

    e.cockpitHost = el('div', '', r);
    this.buildCockpit();

    const frame = el('div', 'mapframe panel', r);
    this.minimap = new GroundMinimap(game, pc, this.team);
    frame.append(this.minimap.canvas);

    const ev = game.events;
    const mine = (v: Vehicle | null) => !!v && (v === pc.v || v.summonOwner === pc.v);
    this.off.push(
      onBindings(() => this.relabel()),
      ev.on('shellHit', (h) => {
        if (h.target === pc.v) this.hit(h.damage, h.attacker, h.x, h.z);
        if (!mine(h.attacker) || h.target.team === this.team) return;
        const kind: PopKind = h.outcome === 'pen' ? 'penetration' : h.outcome === 'ricochet' ? 'ricochet' : h.outcome === 'block' ? 'shatter' : 'he';
        if (h.outcome === 'splash' && h.damage <= 0) return;
        this.pop(h.target, 'main', kind, h.damage);
        if (h.damage > 0) flash(e.hitmark, 'on');
        if (h.outcome === 'pen') this.ribbon('Penetration');
        else if (h.outcome === 'ricochet') this.ribbon('Ricochet');
        else if (h.outcome === 'block') this.ribbon('Blocked');
      }),
      ev.on('skillHit', (h) => {
        if (h.v === pc.v) this.hit(h.damage, h.attacker, h.attacker.x, h.attacker.z);
        if (!mine(h.attacker) || h.v.team === this.team || h.damage <= 0) return;
        this.pop(h.v, `skill:${h.skill.id}`, 'skill', h.damage, h.skill.short, accentCss(h.skill.accent));
        flash(e.hitmark, 'on');
      }),
      ev.on('crit', (c) => {
        if (c.v === pc.v) {
          if (c.kind === 'ammo') flash(e.lampAmmo, 'on');
          this.say(c.kind === 'tracks' ? 'Tracks broken' : c.kind === 'fire' ? 'Engine fire' : 'Ammo rack hit', '#ff8a4a');
          return;
        }
        if (!mine(c.attacker) || c.v.team === this.team) return;
        if (c.kind === 'fire') this.pop(c.v, 'fire', 'fire', 0);
        this.ribbon(c.kind === 'tracks' ? 'Tracks' : c.kind === 'fire' ? 'Fire' : 'Ammo rack');
      }),
      ev.on('ribbon', (rb) => {
        if (mine(rb.v) && rb.kind !== 'Ammo rack') this.ribbon(rb.kind);
      }),
      ev.on('destroyed', ({ v, killer }) => {
        const line = el('div', '', e.killfeed);
        const k = killer?.summonOwner ?? killer;
        if (k) {
          const a = el('span', k.team === this.team ? 'a' : 'e', line);
          a.innerHTML = vehicleClassIcon(k.spec.cls);
          a.append(` ${vehicleName(k)}`);
        } else el('span', 'x', line).textContent = 'Fire';
        el('span', 'x', line).textContent = '✕';
        const b = el('span', v.team === this.team ? 'a' : 'e', line);
        b.innerHTML = vehicleClassIcon(v.spec.cls);
        b.append(` ${vehicleName(v)}`);
        this.feed.push({ el: line, time: game.time });
        if (v === pc.v) audio.ui('defeat');
        if (mine(killer) && v.team !== this.team) {
          flash(e.killmark, 'on');
          this.streak = this.clock - this.lastKill < STREAK ? this.streak + 1 : 1;
          this.lastKill = this.clock;
          if (this.streak > 1) {
            this.callout(STREAK_NAME[Math.min(this.streak, STREAK_NAME.length - 1)], `${vehicleName(v)} destroyed`, palette().enemy);
            audio.ui('streak');
          } else this.banner(`${vehicleName(v)} destroyed`, '', '#ff8a96');
        }
      }),
      ev.on('capture', (c) => {
        const cap = game.caps[c.cap];
        this.banner(c.team === this.team ? `${cap.name} captured` : `${cap.name} lost`, c.team === this.team ? 'Hold it to keep scoring' : 'Retake it to stop the enemy scoring');
        audio.ui('capture');
      }),
      ev.on('skill', (a) => {
        const sp = a.v.skills[a.index].spec;
        const c = accentCss(sp.accent);
        if (a.v === pc.v) {
          const se = this.skillEls[a.index];
          if (se) flash(se.root, 'flash');
          if (sp.ult) {
            this.callout(sp.name, sp.description, c);
            this.flashScreen(c);
            pc.fovKick = 8;
          }
        } else if (sp.ult && a.v.team !== this.team && !a.v.isSummon) {
          this.banner(`Enemy ${vehicleName(a.v)}: ${sp.name}`, sp.description, c);
        }
      }),
      ev.on('consumable', (c) => {
        if (c.v !== pc.v) return;
        const i = pc.v.consumables.findIndex((x) => x.spec.type === c.type);
        const ce = this.consEls[i];
        if (ce) flash(ce.root, 'flash');
      }),
    );
  }

  /** Name, hull bar, status, skills, consumables and ammo: rebuilt when the captain changes vehicle. */
  private buildCockpit(): void {
    const pc = this.pc;
    const me = pc.v;
    const e = this.e;
    this.skillEls = [];
    this.consEls = [];
    this.slotEls = [];
    this.keyEls = [];
    e.cockpitHost.replaceChildren();
    const titan = me.skills.length > 3;
    const ck = el('div', `cockpit${titan ? ' titan' : ''}`, e.cockpitHost);
    const nb = el('div', 'namebar', ck);
    el('span', 'cls', nb).innerHTML = vehicleClassIcon(me.spec.cls);
    el('span', 'nm', nb).textContent = me.spec.name;
    e.regen = el('span', 'tag regen', nb);
    e.regen.textContent = 'REPAIRING';
    e.hpNum = el('span', 'hpnum num', nb);
    const hp = el('div', 'hpbar', ck);
    e.hpbar = hp;
    e.hpChip = el('i', 'chipt', hp);
    e.hp = el('i', 'fill', hp);
    e.hpShield = el('i', 'sh', hp);
    el('i', 'ticks', hp);
    e.status = el('div', 'status-row', ck);

    const sb = el('div', `skillbar${titan ? ' titan' : ''}`, ck);
    let normals = 0;
    let ults = 0;
    me.skills.forEach((st, i) => {
      const ult = !!st.spec.ult;
      if (ult && !ults) el('div', 'gap', sb);
      const pad = ult ? PAD_ULT[ults++] : PAD_NORMAL[normals++];
      const root = el('div', `sk${ult ? ' ult' : ''}`, sb);
      root.style.setProperty('--accent', accentCss(st.spec.accent));
      root.title = `${st.spec.name}: ${st.spec.description}`;
      const hx = el('div', 'hx', root);
      if (ult) el('div', 'meter', hx);
      hx.insertAdjacentHTML('beforeend', skillIcon(st.spec.icon));
      el('div', 'sweep', hx);
      const t = el('div', 't', hx);
      const k = this.keyLabel(root, () => pc.layout?.skills[i], pad);
      el('div', 'nm', root).textContent = st.spec.short;
      this.skillEls.push({ root, t, wasReady: me.skillReady(i), key: k });
    });
    el('div', 'gap', sb);
    me.consumables.forEach((c, i) => {
      const root = el('div', `sk cons${c.spec.type === 'repair' ? ' repair' : ''}`, sb);
      root.title = c.spec.name;
      const hx = el('div', 'hx', root);
      hx.insertAdjacentHTML('beforeend', groundConsumableIcon(c.spec.type));
      el('div', 'sweep', hx);
      const t = el('div', 't', hx);
      this.keyLabel(root, () => pc.layout?.consumables[i], PAD_CONS[i]);
      el('span', 'ch', root);
      el('div', 'nm', root).textContent = CONS_SHORT[c.spec.type];
      this.consEls.push({ root, t, wasReady: true });
    });

    const weapons = el('div', 'weapons', ck);
    const gun = me.spec.gun;
    if (gun) {
      gun.ammo.forEach((a, i) => {
        const root = el('div', 'slot', weapons);
        root.title = `${a.label}: ${a.damage} damage, ${a.pen} mm`;
        this.keyLabel(root, () => pc.layout?.slots[i], 'LB/RB');
        root.append(`${AMMO_NAME[a.kind]} `);
        el('small', '', root).textContent = a.label;
        const info = el('div', 'num', root);
        const b = el('div', 'bar', root);
        this.slotEls.push({ root, bar: el('i', '', b), info });
      });
    }
    const l = me.spec.launcher;
    if (l) {
      const root = el('div', 'slot on', weapons);
      root.append(l.name);
      const info = el('div', 'num', root);
      const b = el('div', 'bar', root);
      this.slotEls.push({ root, bar: el('i', '', b), info });
    }
    this.built = me;
    this.chipHp = this.lastHp = me.hp;
  }

  private pop(target: Vehicle, key: string, kind: PopKind, damage: number, title = '', accent = ''): void {
    const now = this.clock;
    const merge = kind === 'skill' ? SKILL_MERGE : MERGE;
    let p = this.pops.find((q) => q.live && q.target === target && q.key === key && now - q.last < merge);
    if (!p) {
      p = this.pops.find((q) => !q.live) ?? this.pops.reduce((a, b) => (a.last < b.last ? a : b));
      p.target = target;
      p.key = key;
      p.kind = kind;
      p.counts = {};
      p.damage = 0;
      p.title = title;
      p.el.style.setProperty('--accent', accent || 'var(--cyan)');
      p.born = now;
      p.live = true;
      const rows = new Set(this.pops.filter((q) => q !== p && q.live && q.target === target).map((q) => q.row));
      p.row = 0;
      while (rows.has(p.row)) p.row++;
      p.el.style.display = '';
      flash(p.el, 'fresh');
    }
    p.counts[kind] = (p.counts[kind] ?? 0) + 1;
    p.damage += damage;
    if (POP_RANK[kind] > POP_RANK[p.kind]) p.kind = kind;
    p.last = now;
    const n = p.counts[p.kind] ?? 1;
    p.label.textContent = p.kind === 'skill' ? p.title : n > 1 ? `${POP_LABEL[p.kind]} ×${n}` : POP_LABEL[p.kind];
    p.num.textContent = p.damage > 0 ? Math.round(p.damage).toLocaleString() : '';
    const cls = `pop k-${p.kind}${p.el.classList.contains('fresh') ? ' fresh' : ''}`;
    if (p.el.className !== cls) p.el.className = cls;
  }

  /** My vehicle took damage: redden the edges and point at where it came from. */
  private hit(damage: number, from: Vehicle | null, x: number, z: number): void {
    const me = this.pc.v;
    if (!me.alive || damage <= 0) return;
    this.hurt = Math.min(1, this.hurt + 0.12 + (damage / me.maxHp) * 5);
    let arc = this.arcs.find((a) => (from ? a.from === from : !a.from && Math.hypot(a.x - x, a.z - z) < 30));
    if (!arc) {
      if (this.arcs.length >= 4) this.arcs.shift()!.g.remove();
      const g = document.createElementNS(SVG, 'g');
      const path = document.createElementNS(SVG, 'path');
      path.setAttribute('d', ARC_PATH);
      g.append(path);
      this.arcSvg.append(g);
      arc = { g, from, x, z, time: 0 };
      this.arcs.push(arc);
    }
    arc.x = from ? from.x : x;
    arc.z = from ? from.z : z;
    arc.time = this.clock;
    this.pc.shake(0.2 + (damage / me.maxHp) * 4);
  }

  private ribbon(kind: string): void {
    let r = this.ribbons.find((x) => x.kind === kind);
    if (!r) {
      const e = el('div', `ribbon${kind === 'Ammo rack' ? ' citadel' : kind === 'Destroyed' ? ' kill' : ''}`, this.e.ribbons);
      r = { kind, count: 0, time: 0, el: e };
      this.ribbons.push(r);
    }
    r.count++;
    r.time = this.game.time;
    r.el.textContent = r.count > 1 ? `${kind} ×${r.count}` : kind;
    flash(r.el, 'fresh');
    if (kind === 'Ammo rack') audio.ui('citadel');
    else audio.ui('ribbon');
  }

  banner(title: string, sub: string, color = ''): void {
    const b = this.e.banner;
    b.style.color = color;
    b.replaceChildren(title);
    if (sub) el('small', '', b).textContent = sub;
    flash(b, 'banner');
    this.bannerUntil = this.game.time + 4;
  }

  /** Big centre-screen word: kill streaks, ultimates. */
  callout(title: string, sub: string, color: string): void {
    const c = this.e.callout;
    c.style.setProperty('--c', color);
    c.replaceChildren(title);
    if (sub) el('small', '', c).textContent = sub;
    flash(c, 'on');
  }

  private say(text: string, color: string): void {
    this.callout(text, '', color);
  }

  private flashScreen(color: string): void {
    this.e.flashfx.style.setProperty('--c', `${color}66`);
    flash(this.e.flashfx, 'on');
  }

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
    this.minimap.dispose();
    this.root.remove();
  }

  private project(x: number, y: number, z: number): { x: number; y: number } | null {
    v3.set(x, y, z).project(this.pc.camera);
    if (v3.z > 1 || v3.z < -1) return null;
    return { x: (v3.x * 0.5 + 0.5) * this.root.clientWidth, y: (-v3.y * 0.5 + 0.5) * this.root.clientHeight };
  }

  update(dt: number): void {
    const g = this.game;
    const pc = this.pc;
    if (pc.v !== this.built) this.buildCockpit();
    const me = pc.v;
    const e = this.e;
    this.clock += dt;
    const team = this.team;
    const enemy: Team = team === 0 ? 1 : 0;

    this.updateScore(team, enemy);
    this.updateMarkers();
    this.updateAim();
    this.updateHelm();
    this.updateHull(dt);
    this.updateSkills();
    this.updateWeapons();
    this.updateFeedback(dt);

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
    setText(e.alert, this.strikeThreat(me) ? 'STRIKE INBOUND: MOVE' : '');
    e.banner.style.display = g.time < this.bannerUntil ? '' : 'none';

    if (!me.alive) {
      e.dead.style.display = '';
      const back = g.respawnIn(me);
      const free = g.config.type === 'freeplay';
      const title = back >= 0 ? `Back in ${Math.ceil(back)}…${free ? ` as ${(me.nextSpec ?? me.spec).name}` : ''}` : 'Vehicle destroyed';
      let sp = pc.focus !== me && pc.focus.alive ? `Watching ${vehicleName(pc.focus)}. Fire to switch.` : back >= 0 ? 'The crew is bailing into a fresh vehicle.' : 'Your crew bails out.';
      if (free && back >= 0) sp += ` ${pc.padIndex >= 0 ? 'Start' : 'Esc'}: change vehicle.`;
      if (e.dead.dataset.k !== title + sp) {
        e.dead.dataset.k = title + sp;
        e.dead.replaceChildren();
        el('b', '', e.dead).textContent = title;
        e.dead.append(sp);
      }
    } else e.dead.style.display = 'none';
    e.hint.style.display = pc.device === 'mouse' && !this.input.aiming && me.alive ? '' : 'none';
    const notice = pc.noticeTime > 0 && me.alive ? pc.notice : '';
    setText(e.notice, notice);
    e.notice.style.display = notice ? '' : 'none';
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
            d.textContent = c.name.slice(0, 1);
            d.title = c.name;
            return d;
          }),
        );
      }
      g.caps.forEach((c, i) => {
        const cls = `cap${c.owner === -1 ? '' : c.owner === team ? ' ally' : ' enemy'}${c.contested || (c.progress > 0 && c.capturer !== -1) ? ' contested' : ''}`;
        setClass(e.caps.children[i], cls);
      });
    }
    const side = (t: Team) => g.fleet.filter((v) => v.team === t);
    const key = [team, enemy].map((t) => side(t).map((v) => (v.alive ? 1 : 0)).join('')).join('|');
    if (key !== this.fleetKey) {
      this.fleetKey = key;
      e.fleet.replaceChildren();
      for (const t of [team, enemy]) {
        const span = el('span', t === team ? 'ally' : 'enemy', e.fleet);
        for (const v of side(t)) {
          const b = el('b', v.alive ? '' : 'dead', span);
          b.title = v.spec.name;
        }
      }
      if (!g.caps.length && !free) {
        setText(e.scoreA, String(side(team).filter((v) => v.alive).length));
        setText(e.scoreE, String(side(enemy).filter((v) => v.alive).length));
      }
    }
    if (free) {
      setText(e.scoreA, String(g.score[team]));
      setText(e.scoreE, String(g.score[enemy]));
    }
    const left = free ? g.time : Math.max(0, GROUND_TIME_LIMIT - g.time);
    setText(e.timer, `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`);
    if (free && g.config.mode === 'lan') this.warnLimit(g.time);
  }

  private warnLimit(t: number): void {
    const left = LAN_BATTLE_LIMIT_S - t;
    this.e.timer.classList.toggle('late', left <= 300);
    for (const m of [5, 1]) {
      if (m >= this.limitWarned || left > m * 60 || left < m * 60 - 30) continue;
      this.limitWarned = m;
      this.callout(`Free play ends in ${m === 1 ? '1 minute' : `${m} minutes`}`, 'LAN battles stop after an hour', '#ffb547');
    }
  }

  private updateMarkers(): void {
    const g = this.game;
    const pc = this.pc;
    const me = pc.v;
    const W = this.root.clientWidth;
    const H = this.root.clientHeight;
    const items: { v: Vehicle; x: number; y: number; d: number; label: string }[] = [];
    for (const v of g.vehicles) {
      if (!v.alive || v.withdrawn || v === me) continue;
      const s = v.spec.size;
      const top = v.renderY + s.height + (s.turret?.height ?? 0) + 2.5;
      const p = this.project(v.renderX, top, v.renderZ);
      if (!p || p.x < -50 || p.y < -20 || p.x > W + 50 || p.y > H + 20) continue;
      const d = Math.hypot(v.renderX - pc.camera.position.x, v.renderZ - pc.camera.position.z);
      const ally = v.team === this.team;
      const name = vehicleName(v);
      const label = ally ? name : `${name}  ${Math.round(Math.hypot(v.x - me.x, v.z - me.z))} m`;
      items.push({ v, x: p.x, y: p.y, d, label });
    }
    const lock = pc.lock;
    items.sort((a, b) => (a.v === lock ? -1 : b.v === lock ? 1 : a.d - b.d));
    const rowH = 24;
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    items.forEach((it, n) => {
      const w = it.label.length * 6.4 + 30;
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
      const v = it.v;
      const cls = `marker ${v.team === this.team ? 'ally' : 'enemy'}${v.titan ? ' titan' : ''}${lock === v ? ' locked' : ''}${v.isSummon ? ' summon' : ''}`;
      if (m.className !== cls) m.className = cls;
      if (m.dataset.cls !== v.spec.cls) {
        m.dataset.cls = v.spec.cls;
        (m.querySelector('.ci') as HTMLElement).innerHTML = vehicleClassIcon(v.spec.cls);
      }
      m.style.transform = `translate(${it.x.toFixed(0)}px, ${y.toFixed(0)}px) translate(-50%, -100%)`;
      setText(m.querySelector('.tx') as HTMLElement, it.label);
      setWidth(m.querySelector('.hp i') as HTMLElement, v.hp / v.maxHp);
      const sh = m.querySelector('.sh') as HTMLElement;
      sh.style.visibility = v.shield > 0 ? '' : 'hidden';
      if (v.shield > 0) setWidth(sh.firstChild as HTMLElement, v.shield / v.maxHp);
    });
    for (let i = items.length; i < this.markers.length; i++) this.markers[i].style.display = 'none';
  }

  /** The aim circle where the gun points, sized by the spread, coloured by the plate under the crosshair. */
  private updateAim(): void {
    const pc = this.pc;
    const me = pc.v;
    const e = this.e;
    const alive = me.alive && pc.focus === me;
    e.cross.style.display = alive && !pc.artyView ? '' : 'none';
    e.aim.style.display = alive ? '' : 'none';
    e.readout.style.display = alive ? '' : 'none';
    e.lock.style.display = 'none';
    e.scope.style.opacity = Math.max(0, Math.min(1, (pc.mag - 1) / 1.5)).toFixed(2);
    if (!alive) return;
    const cam = pc.camera;
    pc.gunPoint(gp);
    const p = this.project(gp.x, gp.y, gp.z);
    const aim = pc.aim;
    const pen: PenColour = aim?.pen ?? 'none';
    const pal = palette();
    const colour = pen === 'green' ? pal.good : pen === 'yellow' ? '#ffd34a' : pen === 'red' ? pal.enemy : pen === 'grey' ? '#9aa6b0' : 'rgba(234,246,255,0.92)';
    if (p) {
      // Spread radius at the gun point in metres, then in pixels (one camera-right step away).
      const dist = Math.max(1, pc.aimDist);
      const rm = Math.max(0.15, (me.spread * dist) / 100);
      v4.setFromMatrixColumn(cam.matrixWorld, 0).multiplyScalar(rm).add(gp);
      const q = this.project(v4.x, v4.y, v4.z);
      const rpx = Math.max(10, Math.min(300, q ? Math.hypot(q.x - p.x, q.y - p.y) : 20));
      e.aim.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
      e.aim.style.color = colour;
      this.svg.ring.setAttribute('r', rpx.toFixed(1));
      this.svg.reload.setAttribute('r', (rpx + 4).toFixed(1));
      this.svg.ticks.setAttribute('transform', `scale(${(rpx / 20).toFixed(3)})`);
      // Reload ring: fills clockwise as the gun loads.
      const gun = me.spec.gun;
      const full = gun ? (me.clip < (gun.clip?.size ?? 1) && me.clip > 0 ? (gun.clip?.interval ?? gun.reload) : gun.reload * me.mods.reloadMul) : (me.spec.launcher?.reload ?? 1) * me.mods.reloadMul * me.mods.missileReloadMul;
      const left = gun ? me.reload : me.launcherReload;
      const frac = left > 0 ? 1 - Math.min(1, left / Math.max(0.01, full)) : 1;
      const circ = 2 * Math.PI * (rpx + 4);
      this.svg.reload.setAttribute('stroke-dasharray', `${(circ * frac).toFixed(1)} ${circ.toFixed(1)}`);
      this.svg.reload.classList.toggle('ready', left <= 0);
    } else e.aim.style.display = 'none';
    e.cross.style.color = colour;

    // Readout under the crosshair.
    const gun = me.spec.gun;
    const ammo = me.ammo;
    let main = `${Math.round(pc.aimDist)} m`;
    let sub = '';
    let note = '';
    const range = gun?.range ?? me.spec.launcher?.range ?? 0;
    const out = pc.aimDist > range;
    if (gun && ammo) {
      sub = `${AMMO_NAME[ammo.kind]} ${ammo.pen} mm${me.shotBuff ? `, ${me.shotBuff.skill.short} ×${me.shotBuff.left}` : ''}`;
      if (gun.clip) sub += `, clip ${me.clip}/${gun.clip.size}`;
      if (me.reload > 0 && !me.shotBuff?.instant) note = `Loading ${me.reload.toFixed(1)} s`;
    } else if (me.spec.launcher) {
      const l = me.spec.launcher;
      sub = `${l.name}, ${l.salvo} ${l.salvo > 1 ? 'rockets' : 'missile'}`;
      if (me.launcherReload > 0) note = `Reloading ${me.launcherReload.toFixed(1)} s`;
      else if (!me.launcherBears()) note = 'Outside the launch arc: turn the hull';
    }
    if (gun?.arc && gun.arc < 180 && !me.onTarget && me.reload <= 0) {
      const pv = me.pivot();
      const want = Math.atan2(pc.aimPoint.x - pv.x, -(pc.aimPoint.z - pv.z));
      let rel = want - me.heading - ((gun.facing ?? 0) * Math.PI) / 180;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      if (Math.abs(rel) > (gun.arc * Math.PI) / 180) note = 'Outside the gun arc: turn the hull';
    }
    if (out) note = 'Beyond range';
    if (pc.gunLocked) note = 'Gun held';
    if (pen !== 'none') main += `, ${PEN_TEXT[pen]}`;
    if (pc.scoped) main += `, ${pc.scopeMag.toFixed(1)}x`;
    if (pc.lock) main += `, locked: ${vehicleName(pc.lock)}`;
    const key = `${out}|${main}|${sub}|${note}|${pen}`;
    if (e.readout.dataset.k !== key) {
      e.readout.dataset.k = key;
      e.readout.replaceChildren();
      const m = el('span', out ? 'out' : '', e.readout);
      m.textContent = main;
      m.style.color = pen === 'none' ? '' : colour;
      el('small', '', e.readout).textContent = sub;
      if (note) el('small', 'note', e.readout).textContent = note;
    }
    const lockT = pc.lock ?? pc.assist;
    if (lockT) {
      const s = lockT.spec.size;
      const lp = this.project(lockT.renderX, lockT.renderY + s.height * 0.6, lockT.renderZ);
      if (lp) {
        e.lock.style.display = '';
        e.lock.style.transform = `translate(${lp.x.toFixed(0)}px, ${lp.y.toFixed(0)}px) translate(-50%, -50%)`;
      }
    }
  }

  /** Speed, gear and the vehicle card: hull and turret drawn against the view. */
  private updateHelm(): void {
    const pc = this.pc;
    const me = pc.v;
    const e = this.e;
    const kmh = me.speed / KMH;
    setText(e.spd, Math.abs(kmh).toFixed(0));
    const c = me.control;
    const gear = me.mods.stunned
      ? 'Stunned'
      : me.crits.tracks > 0
        ? 'Tracks broken'
        : me.mods.rooted
          ? 'Rooted'
          : kmh < -0.5
            ? 'Reverse'
            : Math.abs(kmh) < 0.5 && c.steer !== 0
              ? 'Pivot'
              : Math.abs(kmh) < 0.5
                ? 'Neutral'
                : 'Forward';
    setText(e.ord, gear);
    const hullDeg = ((me.renderHeading - pc.yaw) * 180) / Math.PI;
    const turDeg = ((me.renderHeading + me.renderTurret - pc.yaw) * 180) / Math.PI;
    this.svg.hull.setAttribute('transform', `rotate(${hullDeg.toFixed(1)})`);
    this.svg.turret.setAttribute('transform', `rotate(${turDeg.toFixed(1)})`);
    const broken = me.crits.tracks > 0;
    this.svg.trkL.classList.toggle('broken', broken);
    this.svg.trkR.classList.toggle('broken', broken);
    e.lampTracks.classList.toggle('lit', broken);
    e.lampFire.classList.toggle('lit', me.crits.fire > 0);
  }

  private updateHull(dt: number): void {
    const g = this.game;
    const me = this.pc.v;
    const e = this.e;
    e.hpNum.innerHTML = `${Math.round(me.hp).toLocaleString()} <small>/ ${me.maxHp.toLocaleString()}</small>`;
    const frac = me.hp / me.maxHp;
    if (me.hp < this.lastHp - 1) {
      this.chipHold = 0.5;
      if (this.lastHp - me.hp > me.maxHp * 0.02) flash(e.hpbar, 'hit');
    }
    this.lastHp = me.hp;
    this.chipHold -= dt;
    if (this.chipHp < me.hp) this.chipHp = me.hp;
    else if (this.chipHold <= 0) this.chipHp = Math.max(me.hp, this.chipHp - me.maxHp * 0.5 * dt);
    setWidth(e.hp, frac);
    setWidth(e.hpChip, this.chipHp / me.maxHp);
    setWidth(e.hpShield, me.shield / me.maxHp);
    const delay = me.titan ? TITAN.regenDelay : REGEN_DELAY;
    const regen = me.alive && g.time - me.lastHit > delay && me.crits.fire <= 0 && me.hp < me.maxHp;
    setClass(e.hp, `fill${frac < 0.3 ? ' low' : frac < 0.6 ? ' mid' : regen ? ' regen' : ''}`);
    e.regen.style.display = regen ? '' : 'none';
    const critical = me.alive && frac < 0.25;
    e.crit.style.display = critical ? '' : 'none';
    if (critical && g.time - this.lastHeartbeat > 1.1) {
      this.lastHeartbeat = g.time;
      audio.ui('heartbeat');
    }

    const m = me.mods;
    const st: [string, string, string][] = [];
    if (me.crits.fire > 0) st.push(['Engine fire', 'fire', glyph('fire')]);
    if (me.crits.tracks > 0) st.push(['Tracks', '', glyph('wrench')]);
    if (m.stunned) st.push(['Stunned', '', glyph('lightning')]);
    if (m.silenced) st.push(['Silenced', '', glyph('silence')]);
    if (m.disarmed) st.push(['Disarmed', '', glyph('blade')]);
    if (m.feared) st.push(['Feared', '', glyph('fear')]);
    if (m.rooted) st.push(['Rooted', '', glyph('root')]);
    if (m.healBlock) st.push(['No repairs', '', glyph('skull')]);
    if (m.marked > 1) st.push(['Marked', '', glyph('strike')]);
    if (m.exposed) st.push(['Exposed', '', glyph('eye')]);
    if (m.invulnerable || me.spawnShield > 0) st.push(['Invulnerable', 'buff', glyph('shield')]);
    if (m.untargetable) st.push(['Untargetable', 'buff', glyph('cloak')]);
    if (m.unstoppable) st.push(['Unstoppable', 'buff', glyph('ram')]);
    if (m.aps > 0) st.push(['Active protection', 'buff', glyph('flak')]);
    if (m.damageTakenMul < 0.95) st.push([`Armour +${Math.round((1 - m.damageTakenMul) * 100)}%`, 'buff', glyph('shield')]);
    if (m.reloadMul < 0.95) st.push(['Fast reload', 'buff', glyph('reset')]);
    if (m.speedMul > 1.05) st.push(['Boost', 'buff', glyph('speed')]);
    if (g.inSmoke(me.x, me.z)) st.push(['In smoke', 'buff', glyph('smoke')]);
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
    const me = this.pc.v;
    me.skills.forEach((st, i) => {
      const se = this.skillEls[i];
      if (!se) return;
      const ready = me.skillReady(i);
      let p: number;
      let t = '';
      if (st.active) {
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
      se.root.style.setProperty('--p', p.toFixed(3));
      setText(se.t, t);
      const cls = `sk${st.spec.ult ? ' ult' : ''}${st.active ? ' active' : ready ? ' ready' : ' cool'}${se.root.classList.contains('flash') ? ' flash' : ''}`;
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
      if (!ce) return;
      const p = c.active > 0 ? 0 : c.cooldown > 0 ? Math.min(1, c.cooldown / c.spec.cooldown) : c.charges <= 0 ? 1 : 0;
      ce.root.style.setProperty('--p', p.toFixed(3));
      setText(ce.t, c.active > 0 ? String(Math.ceil(c.active)) : c.cooldown > 0 ? String(Math.ceil(c.cooldown)) : '');
      const ch = ce.root.querySelector('.ch') as HTMLElement;
      setText(ch, c.charges > 50 ? '' : String(c.charges));
      ch.style.display = c.charges > 50 ? 'none' : '';
      const ready = c.charges > 0 && c.cooldown <= 0;
      ce.root.classList.toggle('active', c.active > 0);
      ce.root.classList.toggle('ready', ready && c.active <= 0);
      ce.root.classList.toggle('cool', !ready && c.active <= 0);
      ce.root.classList.toggle('empty', c.charges <= 0);
    });
  }

  private updateWeapons(): void {
    const me = this.pc.v;
    const gun = me.spec.gun;
    let i = 0;
    if (gun) {
      const full = gun.reload * me.mods.reloadMul;
      for (; i < gun.ammo.length; i++) {
        const se = this.slotEls[i];
        if (!se) return;
        const on = i === me.ammoIndex;
        se.root.classList.toggle('on', on);
        const a = gun.ammo[i];
        setText(se.info, on ? (me.reload > 0 ? `${me.reload.toFixed(1)}s` : 'Loaded') : `${a.damage} dmg`);
        setWidth(se.bar, on ? 1 - Math.max(0, me.reload) / full : 1);
      }
    }
    const l = me.spec.launcher;
    const se = this.slotEls[i];
    if (l && se) {
      const full = l.reload * me.mods.reloadMul * me.mods.missileReloadMul;
      const r = Math.max(0, me.launcherReload);
      setText(se.info, me.salvoLeft > 0 ? `Firing ${me.salvoLeft}` : r > 0 ? `${r.toFixed(0)}s` : `${l.salvo} ready`);
      setWidth(se.bar, 1 - r / full);
    }
  }

  private updateFeedback(dt: number): void {
    const now = this.clock;
    const pc = this.pc;
    const me = pc.v;
    for (const p of this.pops) {
      if (!p.live) continue;
      const t = now - p.last;
      const s = p.target;
      if (t > POP_LIFE || !s) {
        p.live = false;
        p.el.style.display = 'none';
        continue;
      }
      const top = s.renderY + s.spec.size.height + (s.spec.size.turret?.height ?? 0) + 4;
      const sp = this.project(s.renderX, top, s.renderZ);
      if (!sp) {
        p.el.style.visibility = 'hidden';
        continue;
      }
      p.el.style.visibility = '';
      const rise = 38 * (0.8 + p.row) + Math.min(50, (now - p.born) * 30);
      p.el.style.transform = `translate(${sp.x.toFixed(0)}px, ${(sp.y - rise).toFixed(0)}px) translate(-50%, -100%)`;
      p.el.style.opacity = Math.min(1, (POP_LIFE - t) / 0.45).toFixed(2);
    }
    this.hurt *= Math.exp(-dt * 1.6);
    const frac = me.hp / me.maxHp;
    const low = me.alive && frac < 0.25 ? 0.22 + 0.08 * Math.sin(now * 3.2) : 0;
    this.e.hurtfx.style.opacity = Math.max(this.hurt, low).toFixed(3);
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const a = this.arcs[i];
      const age = now - a.time;
      if (age > ARC_LIFE || !me.alive) {
        a.g.remove();
        this.arcs.splice(i, 1);
        continue;
      }
      if (a.from?.alive) {
        a.x = a.from.renderX;
        a.z = a.from.renderZ;
      }
      const brg = Math.atan2(a.x - me.renderX, -(a.z - me.renderZ));
      const rel = ((brg - pc.yaw) * 180) / Math.PI;
      a.g.setAttribute('transform', `rotate(${rel.toFixed(1)})`);
      a.g.setAttribute('opacity', (1 - age / ARC_LIFE).toFixed(2));
    }
  }

  /** A telegraphed enemy strike is about to land on top of us. */
  private strikeThreat(me: Vehicle): boolean {
    if (!me.alive) return false;
    for (const s of this.game.strikes.list) {
      if (s.done || s.owner.team === me.team) continue;
      if (Math.hypot(me.x - s.x, me.z - s.z) < s.r + me.spec.size.length * 0.5) return true;
    }
    return false;
  }
}
