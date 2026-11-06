import type { PlayerController } from '../player/PlayerController';
import type { Ship } from '../ships/Ship';
import { reducedMotion } from '../render/ArchitectPose';
import { faultlinePanel, gourmandPanel, hexPanel, judgePanel, miscMarkerChip, miscPanelState, miscTitanKind, miscVictimBanner, type DollSlot, type LawView } from './MiscTitanPresentation';

// The misc titans' HUD, over the hull bar in the glass of the Tungsten card: the captain's own titan
// panel, the banner a captain sees while an enemy misc titan holds them, and the chip on each marker.
// Panel and banner share two rows: a top row of label-over-value columns spread across the width
// (name and state, gauges, previews) and a main row whose meter runs the length of the hull bar.
// All of it copies what MiscTitanPresentation computes and touches the DOM only when it changes.

const NAMES = { judge: 'THE JUDGE', hexweaver: 'HEXWEAVER', gourmand: 'GOURMAND', faultline: 'FAULTLINE' } as const;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  parent.append(e);
  return e;
}

function setText(e: HTMLElement, t: string): void {
  if (e.textContent !== t) e.textContent = t;
}

function setFlag(e: Element, name: string, on: boolean): void {
  if (e.classList.contains(name) !== on) e.classList.toggle(name, on);
}

function setHidden(e: HTMLElement, hidden: boolean): void {
  if (e.hidden !== hidden) e.hidden = hidden;
}

/** Restarts the CSS animation bound to `cls`. */
function flash(e: HTMLElement, cls: string): void {
  e.classList.remove(cls);
  void e.offsetWidth;
  e.classList.add(cls);
}

function setStyle(e: HTMLElement | SVGElement, prop: string, v: string): void {
  if (e.style.getPropertyValue(prop) !== v) e.style.setProperty(prop, v);
}

function setMeterValue(e: HTMLElement, n: number, max: number): void {
  if (e.getAttribute('aria-valuenow') !== String(n)) {
    e.setAttribute('aria-valuenow', String(n));
    e.setAttribute('aria-valuemax', String(max));
  }
}

const kilo = (v: number): string => `${Math.round(v / 1000)}k`;

/** The titan's name over its state: where every top row starts. */
class Ident {
  readonly name: HTMLElement;
  readonly state: HTMLElement;

  constructor(parent: HTMLElement, name: string) {
    const root = el('span', 'mp-id', parent);
    this.name = el('b', 'mp-name', root);
    this.name.textContent = name;
    this.state = el('span', 'mp-state', root);
  }
}

/** A small uppercase label over a value: a gauge or a preview in the top row. */
class Column {
  readonly root: HTMLElement;
  readonly label: HTMLElement;
  readonly value: HTMLElement;

  constructor(parent: HTMLElement, label: string, cls = '', valueCls = 'mp-value') {
    this.root = el('span', `mp-col${cls ? ` ${cls}` : ''}`, parent);
    this.label = el('span', 'mp-label', this.root);
    this.label.textContent = label;
    this.value = el('span', valueCls, this.root);
  }
}

/** Damage and healing previews, each a label over its number, at the top row's end. */
class Previews {
  private cols: Column[];

  constructor(parent: HTMLElement, names: string[]) {
    const root = el('span', 'mp-prevs', parent);
    this.cols = names.map((n) => new Column(root, n));
  }

  set(values: (string | null)[]): void {
    this.cols.forEach((c, i) => setText(c.value, values[i] ?? '—'));
  }
}

/**
 * A meter in the hull bar's style: a name and a tag over a ticked, chamfered track, its value at
 * the right. `wide` marks the one that runs the panel's length.
 */
class Meter {
  readonly root: HTMLElement;
  private name: HTMLElement;
  private tag: HTMLElement;
  private value: HTMLElement;
  private track: HTMLElement;
  private fill: HTMLElement;
  private notch: HTMLElement;
  private docks: HTMLElement[] = [];

  constructor(parent: HTMLElement, aria: string, cls = '', wide = true) {
    this.root = el('div', `mp-meter${cls ? ` ${cls}` : ''}`, parent);
    this.root.setAttribute('role', 'meter');
    this.root.setAttribute('aria-label', aria);
    this.root.setAttribute('aria-valuemin', '0');
    const head = el('div', 'mp-head', this.root);
    this.name = el('span', 'mp-mname', head);
    this.tag = el('span', 'mp-tag', head);
    this.value = el('b', 'mp-mval', head);
    this.track = el('span', `mp-track${wide ? ' mp-wide' : ''}`, this.root);
    this.fill = el('i', 'mp-fill', this.track);
    this.notch = el('i', 'mp-notch', this.track);
    this.notch.hidden = true;
  }

  /** `frac` fills the track; `notch` (0–1) marks a threshold; `n` of `max` is what screen readers hear. */
  set(o: { name: string; value: string; frac: number; n: number; max: number; tag?: string; notch?: number }): void {
    setText(this.name, o.name);
    setText(this.tag, o.tag ?? '');
    setText(this.value, o.value);
    setStyle(this.fill, 'width', `${(Math.max(0, Math.min(1, o.frac)) * 100).toFixed(1)}%`);
    setHidden(this.notch, o.notch === undefined);
    if (o.notch !== undefined) setStyle(this.notch, 'left', `${(o.notch * 100).toFixed(1)}%`);
    setMeterValue(this.root, Math.round(o.n), o.max);
  }

  /** Thin ticks along the track for other values, such as other open cases. */
  dock(ticks: { at: number; title: string }[]): void {
    while (this.docks.length < ticks.length) this.docks.push(el('i', 'mp-dock', this.track));
    this.docks.forEach((d, i) => {
      const t = ticks[i];
      setHidden(d, !t);
      if (!t) return;
      setStyle(d, 'left', `${(t.at * 100).toFixed(1)}%`);
      if (d.title !== t.title) d.title = t.title;
    });
  }

  aria(label: string): void {
    if (this.root.getAttribute('aria-label') !== label) this.root.setAttribute('aria-label', label);
  }
}

/** A column of skewed pips: each fills with its own share (a recharge, a life left), or sits empty. */
class Pips {
  readonly col: Column;
  private pips: HTMLElement[] = [];

  constructor(parent: HTMLElement, label: string, aria: string) {
    this.col = new Column(parent, label, 'mp-pipcol', 'mp-pips');
    this.col.root.setAttribute('role', 'meter');
    this.col.root.setAttribute('aria-label', aria);
    this.col.root.setAttribute('aria-valuemin', '0');
  }

  /** `fills[i]` is 0–1, or null for an empty slot; `lit` of the pips count. */
  set(label: string, fills: (number | null)[], lit: number): void {
    setText(this.col.label, label);
    while (this.pips.length < fills.length) this.pips.push(el('i', '', this.col.value));
    this.pips.forEach((p, i) => {
      const f = fills[i] ?? null;
      setFlag(p, 'on', f !== null);
      setStyle(p, '--fill', (f ?? 0).toFixed(2));
      setFlag(p, 'ready', f !== null && f >= 1);
      // A pip about to go out flickers.
      setFlag(p, 'low', f !== null && f < 0.2);
    });
    setMeterValue(this.col.root, lit, fills.length);
  }
}

/** The six laws as chips: each names what it asks and lights while it is being broken. */
class Laws {
  readonly col: Column;
  private chips: HTMLElement[] = [];

  constructor(parent: HTMLElement) {
    this.col = new Column(parent, 'Laws in court', 'mp-lawcol', 'misc-laws');
  }

  set(laws: LawView[]): void {
    laws.forEach((l, i) => {
      let c = this.chips[i];
      if (!c) {
        c = this.chips[i] = el('span', 'law', this.col.value);
        c.dataset.law = l.id;
        c.title = `${l.label}: ${l.limit}`;
        c.textContent = l.limit;
      }
      if (l.broken && !c.classList.contains('broken')) flash(c, 'hit');
      setFlag(c, 'broken', l.broken);
    });
  }
}

/** A panel's two rows. */
interface Rows {
  top: HTMLElement;
  main: HTMLElement;
}

/** The Judge: the laws its aimed target is breaking and previews up top, that target's case running the length below. */
class JudgeGauges {
  private laws: Laws;
  private previews: Previews;
  private meter: Meter;

  constructor(r: Rows) {
    this.laws = new Laws(r.top);
    this.previews = new Previews(r.top, ['Gavel', 'Taxes', 'Verdict']);
    this.meter = new Meter(r.main, 'Case on the aimed target');
  }

  update(me: Ship, target: Ship | null): void {
    const p = judgePanel(me, target);
    const c = p.case;
    this.laws.set(p.laws);
    setText(this.laws.col.label, c ? 'Laws it breaks' : 'Laws in court');
    this.previews.set(c ? [kilo(p.previews.gavel), kilo(p.previews.taxes), kilo(p.previews.verdict)] : []);
    const n = c?.n ?? 0;
    const cap = c?.cap ?? 50;
    this.meter.set({
      name: c && target ? target.name : 'No target',
      tag: p.contempt > 0 ? `IN CONTEMPT ${Math.ceil(p.contempt)}s` : '',
      value: p.deathReady ? `DEATH PENALTY READY · ${n}/${cap}` : `${n}/${cap}`,
      frac: n / cap,
      n,
      max: cap,
      notch: (c?.death ?? 30) / cap,
    });
    setFlag(this.meter.root, 'idle', !c);
    setFlag(this.meter.root, 'urgent', p.deathReady);
    this.meter.dock(p.docket.map((d) => ({ at: d.at, title: `${d.name}: ${d.n}` })));
  }
}

const SVG = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent.append(e);
  return e;
}

/** One shelf slot: a little stitched doll, its pins and pricks, and its ship's name, health and life. */
class DollView {
  readonly root: HTMLElement;
  private doll: SVGSVGElement;
  private pins: SVGLineElement[] = [];
  private pricks: HTMLElement[] = [];
  private name: HTMLElement;
  private hp: HTMLElement;
  private stab = 0;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hx-slot', parent);
    const art = el('span', 'hx-art', this.root);
    this.doll = svg('svg', { viewBox: '-20 -26 40 52', class: 'hx-doll', 'aria-hidden': 'true' }, art) as SVGSVGElement;
    // Head, body, arms and legs of a rag doll, with button eyes and a cross-stitched seam.
    svg('circle', { cx: 0, cy: -15, r: 8, class: 'cloth' }, this.doll);
    svg('path', { d: 'M-7 -7 Q-9 6 -6 12 L6 12 Q9 6 7 -7 Z', class: 'cloth' }, this.doll);
    svg('path', { d: 'M-7 -5 L-16 2 M7 -5 L16 2 M-4 12 L-6 23 M4 12 L6 23', class: 'limb' }, this.doll);
    svg('path', { d: 'M-4.5 -17 l3 3 m0 -3 l-3 3 M1.5 -17 l3 3 m0 -3 l-3 3', class: 'eyes' }, this.doll);
    svg('path', { d: 'M0 -5 v14 M-2 -2 h4 M-2 2 h4 M-2 6 h4', class: 'seam' }, this.doll);
    for (const [x, y, a] of [
      [-9, -14, -40],
      [9, -2, 35],
      [-6, 6, -20],
    ])
      this.pins.push(svg('line', { x1: x, y1: y, x2: x - Math.sin((a * Math.PI) / 180) * 12, y2: y - Math.cos((a * Math.PI) / 180) * 12, class: 'pin' }, this.doll) as SVGLineElement);
    const info = el('span', 'hx-info', this.root);
    this.name = el('b', 'hx-name', info);
    const bar = el('span', 'hx-hp', info);
    this.hp = el('i', '', bar);
    const ticks = el('span', 'hx-pricks', info);
    for (let i = 0; i < 4; i++) this.pricks.push(el('i', '', ticks));
  }

  /** Fills the slot from `v`, or shows it as an empty socket. */
  set(v: DollSlot | undefined, still: boolean): void {
    setFlag(this.root, 'idle', !v);
    if (!v) {
      setText(this.name, 'No doll');
      setStyle(this.hp, 'width', '0%');
      setStyle(this.root, '--life', '0');
      this.pins.forEach((p) => setFlag(p, 'on', false));
      this.pricks.forEach((p) => setFlag(p, 'on', false));
      setFlag(this.root, 'burning', false);
      setFlag(this.root, 'stitched', false);
      setFlag(this.root, 'aimed', false);
      setFlag(this.root, 'flinch', false);
      setFlag(this.root, 'unseen', false);
      setStyle(this.doll, 'transform', '');
      this.stab = 0;
      return;
    }
    setText(this.name, v.name);
    setStyle(this.hp, 'width', `${(v.hp * 100).toFixed(1)}%`);
    setStyle(this.root, '--life', v.life.toFixed(3));
    this.pins.forEach((p, i) => setFlag(p, 'on', i < v.pins));
    this.pricks.forEach((p, i) => setFlag(p, 'on', i < v.pricks));
    setFlag(this.root, 'burning', v.burning);
    setFlag(this.root, 'stitched', v.stitched);
    setFlag(this.root, 'aimed', v.aimed);
    setFlag(this.root, 'flinch', v.flinch > 0);
    setFlag(this.root, 'unseen', !v.seen);
    // The doll jolts when its ship is hurt and wrings round when it is twisted.
    const turn = still ? 0 : v.flinch * -16 * (Math.round(v.flinch * 10) % 2 ? 1 : -1) + v.twist * 200;
    setStyle(this.doll, 'transform', turn ? `rotate(${turn.toFixed(1)}deg)` : '');
    if (v.stab > this.stab + 0.5) flash(this.root, 'stab');
    this.stab = v.stab;
  }
}

/** The Hexweaver: pin charges and previews on the aimed doll up top, the doll shelf running the length below. */
class HexGauges {
  private pips: Pips;
  private previews: Previews;
  private slots: DollView[] = [];
  private paths: SVGPathElement[] = [];
  private still = reducedMotion();

  constructor(r: Rows) {
    this.pips = new Pips(r.top, 'Pins', 'Pin charges');
    this.previews = new Previews(r.top, ['Twist', 'Rip', 'Unmaking']);
    const shelf = el('div', 'hx-shelf mp-wide', r.main);
    const threads = svg('svg', { viewBox: '0 0 400 24', preserveAspectRatio: 'none', class: 'hx-threads', 'aria-hidden': 'true' }, shelf);
    for (let i = 0; i < 6; i++) this.paths.push(svg('path', { d: '' }, threads) as SVGPathElement);
    for (let i = 0; i < 4; i++) this.slots.push(new DollView(shelf));
  }

  update(me: Ship, target: Ship | null): void {
    const p = hexPanel(me, target);
    const ready = p.pins.filter((f) => f >= 1).length;
    this.pips.set(`Pins ${ready}/${p.pins.length}`, p.pins, ready);
    this.slots.forEach((v, i) => v.set(p.slots[i], this.still));
    // Threads arc over the shelf between stitched slots.
    this.paths.forEach((path, i) => {
      const l = p.links[i];
      const d = l ? `M${50 + l[0] * 100} 24 Q${50 * (l[0] + l[1]) + 50} ${-6 - 6 * (l[1] - l[0])} ${50 + l[1] * 100} 24` : '';
      if (path.getAttribute('d') !== d) path.setAttribute('d', d);
    });
    const v = p.previews;
    this.previews.set(v ? [kilo(v.twist), kilo(v.rip), kilo(v.unmaking)] : []);
  }
}

/** The Gourmand: the next salvo's flavour and previews up top, the three-jar pantry (or the meal being digested) below. */
class GourmandGauges {
  private next: Column;
  private previews: Previews;
  private pantry: HTMLElement;
  private jars: { meter: Meter; last: number }[] = [];
  private digest: Meter;

  constructor(r: Rows) {
    this.next = new Column(r.top, 'Next salvo', 'gm-next');
    this.previews = new Previews(r.top, ['Cooker', 'Comfort', 'Shield']);
    this.pantry = el('div', 'gm-pantry mp-wide', r.main);
    for (let i = 0; i < 3; i++) this.jars.push({ meter: new Meter(this.pantry, 'Ingredients', 'gm-jar', false), last: 0 });
    this.digest = new Meter(r.main, 'Digesting', 'gm-digest');
    this.digest.root.hidden = true;
  }

  update(me: Ship): void {
    const p = gourmandPanel(me);
    p.jars.forEach((j, i) => {
      const v = this.jars[i];
      if (v.meter.root.dataset.kind !== j.kind) v.meter.root.dataset.kind = j.kind;
      v.meter.aria(`${j.label} ingredients`);
      v.meter.set({ name: j.label, value: `${j.n}/${p.cap}`, frac: j.n / p.cap, n: j.n, max: p.cap });
      setFlag(v.meter.root, 'next', p.next.kind === j.kind);
      // A jar that just filled up a little glints.
      if (j.n > v.last) flash(v.meter.root, 'gain');
      v.last = j.n;
    });
    setText(this.next.value, `${p.next.label} · ${p.next.effect}`);
    if (this.next.root.dataset.kind !== (p.next.kind ?? 'plain')) this.next.root.dataset.kind = p.next.kind ?? 'plain';
    this.previews.set([kilo(p.previews.cooker), `+${kilo(p.previews.heal)}`, kilo(p.previews.shield)]);
    // While a ship is being digested its meal takes the pantry's place.
    const d = p.digest;
    setHidden(this.pantry, !!d);
    setHidden(this.digest.root, !d);
    if (d) this.digest.set({ name: `Digesting ${d.name}`, value: `${d.left.toFixed(1)}s`, frac: d.frac, n: Math.round(d.left * 10) / 10, max: 3 });
  }
}

/** The Faultline: fracture and ridge pips and the Caldera preview up top, the magma pressure gauge running the length below. */
class FaultlineGauges {
  private fractures: Pips;
  private ridges: Pips;
  private caldera: Previews;
  private pressure: Meter;
  private last = 0;

  constructor(r: Rows) {
    this.fractures = new Pips(r.top, 'Fractures', 'Fractures open');
    this.ridges = new Pips(r.top, 'Ridges', 'Ridges standing');
    this.caldera = new Previews(r.top, ['Caldera']);
    this.pressure = new Meter(r.main, 'Pressure', 'fl-pressure');
  }

  update(me: Ship): void {
    const p = faultlinePanel(me);
    const pad = (lives: number[], cap: number) => Array.from({ length: cap }, (_, i) => lives[i] ?? null);
    this.fractures.set(`Fractures ${p.fractures.length}/${p.maxFractures}`, pad(p.fractures, p.maxFractures), p.fractures.length);
    this.ridges.set(`Ridges ${p.ridges.length}/${p.maxRidges}`, pad(p.ridges, p.maxRidges), p.ridges.length);
    this.caldera.set([kilo(p.caldera)]);
    const n = Math.round(p.pressure);
    this.pressure.set({ name: 'Pressure', tag: p.hot ? 'ERUPTION READY' : '', value: `${n}/${p.max}`, frac: p.pressure / p.max, n, max: p.max, notch: 0.8 });
    setFlag(this.pressure.root, 'hot', p.hot);
    // A jump in pressure (a hit, Slip, Bedrock) pulses the gauge.
    if (n >= this.last + 5) flash(this.pressure.root, 'surge');
    this.last = n;
  }
}

/** What a victim banner's meter counts. */
function meterName(kind: string): string {
  return kind === 'hexweaver' ? 'Pins in your doll' : 'Your case';
}

export class MiscTitanHud {
  /** The captain's own titan panel; null for every other ship. */
  readonly panel: HTMLElement | null = null;
  private ident: Ident | null = null;
  private judge: JudgeGauges | null = null;
  private hex: HexGauges | null = null;
  private gourmand: GourmandGauges | null = null;
  private faultline: FaultlineGauges | null = null;
  private banner: HTMLElement;
  private bannerIdent: Ident;
  private bannerTop: HTMLElement;
  private bannerMain: HTMLElement;
  private bannerLaws: Laws | null = null;
  private bannerMeter: Meter | null = null;
  /** The banner meter's last value, to flash it on each new violation. */
  private bannerN = -1;

  constructor(
    parent: HTMLElement,
    private pc: PlayerController,
  ) {
    const kind = miscTitanKind(pc.ship);
    if (kind) {
      const panel = el('div', `misc-panel ${kind}`, parent);
      panel.setAttribute('role', 'group');
      panel.setAttribute('aria-label', `${NAMES[kind]} status`);
      const rows = { top: el('div', 'mp-top', panel), main: el('div', 'mp-main', panel) };
      this.ident = new Ident(rows.top, NAMES[kind]);
      this.ident.state.setAttribute('aria-live', 'polite');
      this.panel = panel;
      if (kind === 'judge') this.judge = new JudgeGauges(rows);
      if (kind === 'hexweaver') this.hex = new HexGauges(rows);
      if (kind === 'gourmand') this.gourmand = new GourmandGauges(rows);
      if (kind === 'faultline') this.faultline = new FaultlineGauges(rows);
    }
    this.banner = el('div', 'misc-banner', parent);
    this.banner.setAttribute('role', 'status');
    this.banner.setAttribute('aria-live', 'polite');
    this.banner.hidden = true;
    this.bannerTop = el('div', 'mp-top', this.banner);
    this.bannerIdent = new Ident(this.bannerTop, '');
    this.bannerMain = el('div', 'mp-main', this.banner);
    this.bannerMain.hidden = true;
  }

  update(): void {
    const me = this.pc.ship;
    const target = this.pc.lock ?? this.pc.assist;
    if (this.ident) setText(this.ident.state, miscPanelState(me));
    this.judge?.update(me, target);
    this.hex?.update(me, target);
    this.gourmand?.update(me);
    this.faultline?.update(me);
    this.updateBanner(me);
  }

  private updateBanner(me: Ship): void {
    const b = miscVictimBanner(me);
    setHidden(this.banner, !b);
    if (!b) {
      this.bannerN = -1;
      return;
    }
    if (this.banner.dataset.kind !== b.kind) {
      this.banner.dataset.kind = b.kind;
      // A different titan's meter counts something else; do not flash on the switch.
      this.bannerN = -1;
    }
    setFlag(this.banner, 'urgent', b.alert);
    setText(this.bannerIdent.name, b.title);
    setText(this.bannerIdent.state, b.detail);
    if (b.laws) {
      this.bannerLaws ??= new Laws(this.bannerTop);
      this.bannerLaws.set(b.laws);
    }
    if (this.bannerLaws) setHidden(this.bannerLaws.col.root, !b.laws);
    setHidden(this.bannerMain, !b.meter);
    if (!b.meter) return;
    const m = b.meter;
    const name = meterName(b.kind);
    this.bannerMeter ??= new Meter(this.bannerMain, name);
    this.bannerMeter.aria(name);
    this.bannerMeter.set({ name, value: `${m.n}/${m.cap}`, frac: m.n / m.cap, n: m.n, max: m.cap, notch: m.mark < m.cap ? m.mark / m.cap : undefined });
    setFlag(this.bannerMeter.root, 'urgent', m.n >= m.mark);
    // Every new violation or pin flashes the banner, so the victim sees the moment it lands.
    if (this.bannerN >= 0 && m.n > this.bannerN) flash(this.banner, 'cited');
    this.bannerN = m.n;
  }

  /** Fills (or hides) the misc titan chip on `marker`, the marker of `s`. */
  chip(marker: HTMLElement, s: Ship): void {
    const c = miscMarkerChip(this.pc.ship, s);
    let e = marker.querySelector<HTMLElement>('.misc-chip');
    if (!c) {
      if (e && !e.hidden) e.hidden = true;
      return;
    }
    if (!e) e = el('span', 'misc-chip', marker.querySelector<HTMLElement>('.nm') ?? marker);
    if (e.hidden) e.hidden = false;
    if (e.dataset.kind !== c.kind) e.dataset.kind = c.kind;
    setFlag(e, 'urgent', c.alert);
    setText(e, c.text);
  }
}
