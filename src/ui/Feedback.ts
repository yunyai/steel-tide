import { ELEMENT_STYLE } from '../skills/misc/ArchitectElements';
import type { Game } from '../core/Game';
import { bearingTo } from '../core/math';
import type { HitOutcome, Team } from '../core/types';
import type { PlayerController } from '../player/PlayerController';
import type { Ship } from '../ships/Ship';
import { accentCss } from '../data/accents';
import { audio } from '../fx/Audio';
import { captainName } from './names';
import { palette } from './palette';

// Combat feedback for one HUD: damage numbers over the ships you hit (skill hits get the big
// accent-coloured ones), hit and kill marks on the reticle, kill-streak callouts, a red edge and
// bearing arcs when you are hit, and a countdown to your shells landing. Runs on the HUD's
// real-time clock so slow motion does not stretch it.

type PopKind = HitOutcome | 'fire' | 'flood' | 'skill';

/** Strongest outcome wins the label when hits merge. */
const RANK: Record<PopKind, number> = {
  skill: 9,
  citadel: 8,
  torpedo: 7,
  missile: 6,
  penetration: 5,
  bomb: 5,
  he: 4,
  secondary: 3,
  overpen: 2,
  ricochet: 1,
  shatter: 1,
  fire: 0,
  flood: 0,
};

const LABEL: Record<PopKind, string> = {
  skill: '',
  citadel: 'Citadel',
  torpedo: 'Torpedo',
  missile: 'Missile',
  penetration: 'Penetration',
  bomb: 'Bomb',
  he: 'HE',
  secondary: 'Secondaries',
  overpen: 'Overpen',
  ricochet: 'Ricochet',
  shatter: 'Shatter',
  fire: 'Fire',
  flood: 'Flooding',
};

/** Hits on one target closer together than this make one popup. */
const MERGE = 0.35;
/** Skill hits keep adding to one number for longer: a volley of rods reads as one total. */
const SKILL_MERGE = 1.5;
/** Seconds a popup stays after its last hit. */
const POP_LIFE = 1.6;
const POOL = 12;
/** Bearing arcs fade over this long. */
const ARC_LIFE = 2;
/** Kills closer together than this count as a streak. */
const STREAK = 15;
const STREAK_NAME = ['', '', 'Double kill', 'Triple kill', 'Quad kill', 'Rampage', 'Unstoppable'];

interface Pop {
  el: HTMLElement;
  label: HTMLElement;
  num: HTMLElement;
  live: boolean;
  target: Ship | null;
  key: string;
  born: number;
  last: number;
  /** Row in the stack of popups over one target. */
  row: number;
  kind: PopKind;
  counts: Partial<Record<PopKind, number>>;
  damage: number;
  /** Skill popups: the short name shown as the label. */
  title: string;
  /** Laid-out size, re-measured when the text changes. */
  w: number;
  h: number;
  dirty: boolean;
}

interface Arc {
  g: SVGGElement;
  from: Ship | null;
  x: number;
  z: number;
  time: number;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent.append(e);
  return e;
}

/** Restart a CSS animation bound to `cls`. */
function flash(e: Element, cls: string): void {
  e.classList.remove(cls);
  void (e as HTMLElement).offsetWidth;
  e.classList.add(cls);
}

const SVG = 'http://www.w3.org/2000/svg';
/** Bearing arc: 36° of a 118-unit circle, centred straight up. */
const ARC_PATH = (() => {
  const r = 118;
  const a = (18 * Math.PI) / 180;
  const x = (r * Math.sin(a)).toFixed(1);
  const y = (-r * Math.cos(a)).toFixed(1);
  return `M-${x} ${y} A${r} ${r} 0 0 1 ${x} ${y}`;
})();

export class Feedback {
  private clock = 0;
  private pops: Pop[] = [];
  private arcs: Arc[] = [];
  private hurt = 0;
  private lastKill = -100;
  private streak = 0;
  private scope: HTMLElement;
  private vignette: HTMLElement;
  private hitmark: HTMLElement;
  private killmark: HTMLElement;
  private arcSvg: SVGSVGElement;
  private impact: HTMLElement;
  private off: (() => void)[] = [];
  private rowH = 38;

  constructor(
    private game: Game,
    private pc: PlayerController,
    root: HTMLElement,
    private project: (x: number, y: number, z: number) => { x: number; y: number } | null,
    banner: (title: string, sub: string, color?: string) => void,
    callout: (title: string, sub: string, color: string) => void,
  ) {
    const team: Team = pc.ship.team;
    // Under everything else in the HUD.
    this.scope = el('div', 'scope', root);
    this.vignette = el('div', 'hurt', root);
    root.prepend(this.scope, this.vignette);

    const layer = el('div', 'pops', root);
    for (let i = 0; i < POOL; i++) {
      const p = el('div', 'pop', layer);
      p.style.display = 'none';
      const label = el('small', '', p);
      const num = el('b', 'num', p);
      this.pops.push({ el: p, label, num, live: false, target: null, key: '', born: 0, last: 0, row: 0, kind: 'he', counts: {}, damage: 0, title: '', w: 0, h: 0, dirty: true });
    }

    this.hitmark = el('div', 'hitmark', root);
    this.hitmark.innerHTML = '<svg viewBox="-24 -24 48 48"><path d="M-17 -17 L-8 -8 M17 -17 L8 -8 M-17 17 L-8 8 M17 17 L8 8"/></svg>';
    this.killmark = el('div', 'killmark', root);
    this.killmark.innerHTML = '<svg viewBox="-24 -24 48 48"><path d="M-15 -15 L15 15 M15 -15 L-15 15"/></svg>';
    const threats = el('div', 'threats', root);
    this.arcSvg = document.createElementNS(SVG, 'svg');
    this.arcSvg.setAttribute('viewBox', '-130 -130 260 260');
    threats.append(this.arcSvg);
    this.impact = el('div', 'impact num', root);

    const mine = (s: Ship | null) => !!s && (s === pc.ship || s.summonOwner === pc.ship);
    const ev = game.events;
    this.off.push(
      ev.on('shellHit', (h) => {
        if (h.target === pc.ship) this.hit(h.damage, h.attacker, h.x, h.z);
        if (!mine(h.attacker) || h.target.team === team || (h.secondary && h.damage <= 0)) return;
        this.add(h.target, h.element?`element:${h.element}`:h.secondary?'sec':'main',h.outcome,h.damage,'',h.element?`#${ELEMENT_STYLE[h.element].color.toString(16).padStart(6,'0')}`:'');
        if (!h.secondary && h.damage > 0) this.tick(h.outcome === 'citadel');
      }),
      ev.on('torpHit', (h) => {
        if (h.target === pc.ship) this.hit(h.damage, null, h.x, h.z);
        if (!mine(h.attacker) || h.target.team === team) return;
        this.add(h.target, 'torp', 'torpedo', h.damage);
        this.tick(false);
      }),
      ev.on('ribbon', (r) => {
        if (!mine(r.ship) || !r.target || r.target.team === team) return;
        if (r.kind === 'Fire' || r.kind === 'Flooding') this.add(r.target, r.kind, r.kind === 'Fire' ? 'fire' : 'flood', 0);
      }),
      ev.on('skillHit', (h) => {
        if (h.ship === pc.ship) this.hit(h.damage, h.attacker, h.attacker.pos.x, h.attacker.pos.z);
        if (!mine(h.attacker) || h.ship.team === team || h.damage <= 0) return;
        const reaction=h.skill.reaction,element=h.skill.element;
        this.add(h.ship,reaction?`reaction:${[...reaction].sort().join('+')}`:`skill:${h.skill.id}`,'skill',h.damage,reaction?`${ELEMENT_STYLE[reaction[0]].short} + ${ELEMENT_STYLE[reaction[1]].short} · ${h.skill.short}`:h.skill.short,element?`#${ELEMENT_STYLE[element].color.toString(16).padStart(6,'0')}`:accentCss(h.skill.accent));
        this.tick(false);
      }),
      ev.on('shipSunk', (s) => {
        if (!mine(s.killer) || s.ship.team === team) return;
        flash(this.killmark, 'on');
        this.streak = this.clock - this.lastKill < STREAK ? this.streak + 1 : 1;
        this.lastKill = this.clock;
        if (this.streak > 1) {
          callout(STREAK_NAME[Math.min(this.streak, STREAK_NAME.length - 1)], `${captainName(s.ship)} destroyed`, palette().enemy);
          audio.ui('streak');
        } else banner(`${captainName(s.ship)} destroyed`, '', '#ff8a96');
      }),
    );
  }

  dispose(): void {
    for (const f of this.off) f();
    this.off = [];
  }

  private add(target: Ship, key: string, kind: PopKind, damage: number, title = '', accent = ''): void {
    const now = this.clock;
    const merge = kind === 'skill' ? SKILL_MERGE : MERGE;
    let p = this.pops.find((q) => q.live && q.target === target && q.key === key && now - q.last < merge);
    if (!p) {
      const same=this.pops.filter(q=>q.live&&q.target===target);
      p = same.length>=4?same.reduce((a,b)=>a.last<b.last?a:b):this.pops.find((q) => !q.live) ?? this.pops.reduce((a, b) => (a.last < b.last ? a : b));
      p.target = target;
      p.key = key;
      p.kind = kind;
      p.counts = {};
      p.damage = 0;
      p.title = title;
      p.el.style.setProperty('--accent', accent || 'var(--cyan)');
      p.born = now;
      p.live = true;
      // Stack above any popup already over this target.
      const rows = new Set(this.pops.filter((q) => q !== p && q.live && q.target === target).map((q) => q.row));
      p.row = 0;
      while (rows.has(p.row)) p.row++;
      p.el.style.display = '';
      flash(p.el, 'fresh');
    }
    p.counts[kind] = (p.counts[kind] ?? 0) + 1;
    p.damage += damage;
    if (RANK[kind] > RANK[p.kind]) p.kind = kind;
    p.last = now;
    const n = p.counts[p.kind] ?? 1;
    p.label.textContent = p.kind === 'skill' ? p.title : n > 1 ? `${LABEL[p.kind]} ×${n}` : LABEL[p.kind];
    p.num.textContent = p.damage > 0 ? Math.round(p.damage).toLocaleString() : '';
    p.dirty = true;
    const cls = `pop k-${p.kind}${key === 'sec' ? ' sec' : ''}${key.startsWith('reaction:')?' elemental-reaction':key.startsWith('element:')?' elemental-hit':''}${p.el.classList.contains('fresh') ? ' fresh' : ''}`;
    if (p.el.className !== cls) p.el.className = cls;
  }

  private tick(citadel: boolean): void {
    this.hitmark.classList.toggle('cit', citadel);
    flash(this.hitmark, 'on');
  }

  /** My ship took damage: redden the edges and point at where it came from. */
  private hit(damage: number, from: Ship | null, x: number, z: number): void {
    const me = this.pc.ship;
    if (!me.alive) return;
    this.hurt = Math.min(1, this.hurt + 0.12 + (damage / me.maxHp) * 6);
    let arc = this.arcs.find((a) => (from ? a.from === from : !a.from && Math.hypot(a.x - x, a.z - z) < 30));
    if (!arc) {
      if (this.arcs.length >= 4) {
        const old = this.arcs.shift()!;
        old.g.remove();
      }
      const g = document.createElementNS(SVG, 'g');
      const path = document.createElementNS(SVG, 'path');
      path.setAttribute('d', ARC_PATH);
      g.append(path);
      this.arcSvg.append(g);
      arc = { g, from, x, z, time: 0 };
      this.arcs.push(arc);
    }
    arc.x = from ? from.pos.x : x;
    arc.z = from ? from.pos.z : z;
    arc.time = this.clock;
  }

  update(dt: number): void {
    this.clock += dt;
    const now = this.clock;
    const pc = this.pc;
    const me = pc.ship;

    // Damage numbers stack over the target's marker and drift upward. Sizes are read before any
    // popup moves, so the layout is forced at most once a frame.
    for (const p of this.pops) {
      if (p.live && p.dirty) {
        p.w = p.el.offsetWidth;
        p.h = p.el.offsetHeight;
        p.dirty = false;
      }
    }
    // Older popups keep their place; a newer one over a ship nearby on screen moves up clear of them.
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    for (const p of this.pops.filter((q) => q.live).sort((a, b) => a.born - b.born)) {
      const t = now - p.last;
      const s = p.target;
      if (t > POP_LIFE || !s) {
        p.live = false;
        p.el.style.display = 'none';
        continue;
      }
      const top = (s.superBox?.top ?? s.spec.freeboard + 6) + 14 + Math.max(0, s.renderPos.y);
      const sp = this.project(s.renderPos.x, top, s.renderPos.z);
      if (!sp) {
        p.el.style.visibility = 'hidden';
        continue;
      }
      p.el.style.visibility = '';
      const rise = this.rowH * (0.8 + p.row) + Math.min(50, (now - p.born) * 30);
      let y = sp.y - rise;
      const half = p.w / 2;
      for (let tries = 0; tries < 6; tries++) {
        const hit = placed.find((b) => sp.x - half < b.x1 && sp.x + half > b.x0 && y - p.h < b.y1 && y > b.y0);
        if (!hit) break;
        y = hit.y0 - 2;
      }
      placed.push({ x0: sp.x - half, x1: sp.x + half, y0: y - p.h, y1: y });
      p.el.style.transform = `translate(${sp.x.toFixed(0)}px, ${y.toFixed(0)}px) translate(-50%, -100%)`;
      p.el.style.opacity = Math.min(1, (POP_LIFE - t) / 0.45).toFixed(2);
    }

    // Red edge: recent damage, plus a slow pulse while the ship is in its last quarter.
    this.hurt *= Math.exp(-dt * 1.6);
    const frac = me.hp / me.maxHp;
    const low = me.alive && frac < 0.25 ? 0.22 + 0.08 * Math.sin(now * 3.2) : 0;
    this.vignette.style.opacity = Math.max(this.hurt, low).toFixed(3);

    // Bearing arcs, relative to where the camera looks.
    const view = pc.yaw + pc.freeYaw;
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const a = this.arcs[i];
      const age = now - a.time;
      if (age > ARC_LIFE || !me.alive) {
        a.g.remove();
        this.arcs.splice(i, 1);
        continue;
      }
      if (a.from?.alive) {
        a.x = a.from.pos.x;
        a.z = a.from.pos.z;
      }
      const rel = ((bearingTo(me.renderPos.x, me.renderPos.z, a.x, a.z) - view) * 180) / Math.PI;
      a.g.setAttribute('transform', `rotate(${rel.toFixed(1)})`);
      a.g.setAttribute('opacity', (1 - age / ARC_LIFE).toFixed(2));
    }

    // Scope vignette opens with the magnification.
    this.scope.style.opacity = Math.max(0, Math.min(1, (pc.mag - 1) / 2)).toFixed(2);

    // Time until my last main-battery shell lands.
    let left = 0;
    if (me.alive) {
      for (const s of this.game.shells.shells) {
        if (s.alive && s.owner === me && !s.secondary && !s.bomb) left = Math.max(left, s.flight - s.age);
      }
    }
    const text = left > 0.05 ? `Impact ${left.toFixed(1)} s` : '';
    if (this.impact.textContent !== text) this.impact.textContent = text;
  }
}
