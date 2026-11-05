import type { PlayerController } from '../player/PlayerController';
import type { Ship } from '../ships/Ship';
import { reducedMotion } from '../render/ArchitectPose';
import { faultlinePanel, gourmandPanel, hexPanel, judgePanel, miscMarkerChip, miscTitanKind, miscTitanSummary, miscVictimBanner, type LawView } from './MiscTitanPresentation';

// The misc titans' HUD: the captain's own titan panel beside the skill bar, the banner a captain
// sees while an enemy misc titan holds them, and the chip on each marker. All three copy what
// MiscTitanPresentation computes and touch the DOM only when it changes.

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

function setFlag(e: HTMLElement, name: string, on: boolean): void {
  if (e.classList.contains(name) !== on) e.classList.toggle(name, on);
}

/** Restarts the CSS animation bound to `cls`. */
function flash(e: HTMLElement, cls: string): void {
  e.classList.remove(cls);
  void e.offsetWidth;
  e.classList.add(cls);
}

const kilo = (v: number): string => `${Math.round(v / 1000)}k`;

/** A filling bar with a notch: `n` of `cap`, alerting from `mark`. */
class Meter {
  private fill: HTMLElement;
  private notch: HTMLElement;
  private label: HTMLElement;
  readonly root: HTMLElement;

  constructor(parent: HTMLElement, name: string) {
    this.root = el('div', 'misc-meter', parent);
    this.root.setAttribute('role', 'meter');
    this.root.setAttribute('aria-label', name);
    const track = el('span', 'mm-track', this.root);
    this.fill = el('i', 'mm-fill', track);
    this.notch = el('i', 'mm-notch', track);
    this.label = el('span', 'mm-n', this.root);
  }

  set(n: number, cap: number, mark: number): void {
    const w = `${((Math.min(n, cap) / cap) * 100).toFixed(1)}%`;
    if (this.fill.style.width !== w) this.fill.style.width = w;
    const at = `${((mark / cap) * 100).toFixed(1)}%`;
    if (this.notch.style.left !== at) this.notch.style.left = at;
    setText(this.label, `${n}/${cap}`);
    setFlag(this.root, 'urgent', n >= mark);
    if (this.root.getAttribute('aria-valuenow') !== String(n)) {
      this.root.setAttribute('aria-valuenow', String(n));
      this.root.setAttribute('aria-valuemax', String(cap));
    }
  }
}

/** What a victim banner's meter counts, for screen readers. */
function meterName(kind: string): string {
  return kind === 'hexweaver' ? 'Pins in your doll' : 'Your case';
}

/** The six laws as chips: each names what it asks and lights while it is being broken. */
class Laws {
  private chips: HTMLElement[] = [];
  readonly root: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'misc-laws', parent);
  }

  /** Copies `laws` in; returns whether a law just began to be broken. */
  set(laws: LawView[]): boolean {
    let fresh = false;
    laws.forEach((l, i) => {
      let c = this.chips[i];
      if (!c) {
        c = this.chips[i] = el('span', 'law', this.root);
        c.dataset.law = l.id;
        c.title = `${l.label}: ${l.limit}`;
        c.textContent = l.limit;
      }
      if (l.broken && !c.classList.contains('broken')) {
        fresh = true;
        flash(c, 'hit');
      }
      setFlag(c, 'broken', l.broken);
    });
    return fresh;
  }
}

/** The Judge's own gauges: the laws its aimed target is breaking, that target's case, previews and the docket. */
class JudgeGauges {
  private laws: Laws;
  private meter: Meter;
  private contempt: HTMLElement;
  private previews: HTMLElement[];
  private ready: HTMLElement;
  private top: HTMLElement;
  private aim: HTMLElement;

  constructor(body: HTMLElement) {
    const row = el('div', 'jp-row', body);
    this.aim = el('span', 'jp-aim', row);
    this.laws = new Laws(row);
    const kase = el('div', 'jp-row', body);
    this.meter = new Meter(kase, 'Case on the aimed target');
    this.contempt = el('b', 'jp-contempt', kase);
    this.ready = el('b', 'jp-ready', kase);
    this.ready.textContent = 'DEATH PENALTY READY';
    const prev = el('div', 'jp-row jp-prev', body);
    this.previews = ['GAVEL', 'TAXES', 'VERDICT'].map((name) => {
      const p = el('span', '', prev);
      p.dataset.name = name;
      return p;
    });
    this.top = el('span', 'jp-top', prev);
  }

  update(me: Ship, target: Ship | null): void {
    const p = judgePanel(me, target);
    setText(this.aim, p.case && target ? target.name : 'NO TARGET');
    this.laws.set(p.laws);
    setFlag(this.meter.root, 'idle', !p.case);
    this.meter.set(p.case?.n ?? 0, p.case?.cap ?? 50, p.case?.death ?? 30);
    setText(this.contempt, p.contempt > 0 ? `CONTEMPT ${Math.ceil(p.contempt)}s` : '');
    if (this.ready.hidden !== !p.deathReady) this.ready.hidden = !p.deathReady;
    const v = [p.previews.gavel, p.previews.taxes, p.previews.verdict];
    this.previews.forEach((e, i) => setText(e, p.case ? `${e.dataset.name} ${kilo(v[i])}` : `${e.dataset.name} —`));
    setText(this.top, p.top.length ? `DOCKET ${p.top.map((c) => `${c.name} ${c.n}`).join(' · ')}` : '');
  }
}

const SVG = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent.append(e);
  return e;
}

function setStyle(e: HTMLElement | SVGElement, prop: string, v: string): void {
  if (e.style.getPropertyValue(prop) !== v) e.style.setProperty(prop, v);
}

/** One shelf slot: a little stitched doll, its pins and pricks, and its ship's name, health and life. */
class DollView {
  readonly root: HTMLElement;
  private doll: SVGSVGElement;
  private pins: SVGLineElement[] = [];
  private pricks: HTMLElement[] = [];
  private name: HTMLElement;
  private hp: HTMLElement;
  private life: HTMLElement;
  private stab = 0;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hx-slot', parent);
    this.life = el('span', 'hx-life', this.root);
    this.doll = svg('svg', { viewBox: '-20 -26 40 52', class: 'hx-doll', 'aria-hidden': 'true' }, this.life) as SVGSVGElement;
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

  set(v: ReturnType<typeof hexPanel>['slots'][number] | undefined, still: boolean): void {
    if (this.root.hidden !== !v) this.root.hidden = !v;
    if (!v) return;
    setText(this.name, v.name);
    setStyle(this.hp, 'width', `${(v.hp * 100).toFixed(1)}%`);
    setStyle(this.life, '--life', `${(v.life * 360).toFixed(0)}deg`);
    this.pins.forEach((p, i) => {
      const on = i < v.pins;
      if (p.classList.contains('on') !== on) p.classList.toggle('on', on);
    });
    this.pricks.forEach((p, i) => setFlag(p, 'on', i < v.pricks));
    setFlag(this.root, 'burning', v.burning);
    setFlag(this.root, 'stitched', v.stitched);
    setFlag(this.root, 'aimed', v.aimed);
    setFlag(this.root, 'flinch', v.flinch > 0);
    // The doll jolts when its ship is hurt and wrings round when it is twisted.
    const turn = still ? 0 : v.flinch * -16 * (Math.round(v.flinch * 10) % 2 ? 1 : -1) + v.twist * 200;
    setStyle(this.doll, 'transform', turn ? `rotate(${turn.toFixed(1)}deg)` : '');
    if (v.stab > this.stab + 0.5) flash(this.root, 'stab');
    this.stab = v.stab;
  }
}

/** The Hexweaver's gauges: pin pips, the doll shelf with its threads, and previews on the aimed doll. */
class HexGauges {
  private pips: HTMLElement[] = [];
  private slots: DollView[] = [];
  private threads: SVGSVGElement;
  private paths: SVGPathElement[] = [];
  private previews: HTMLElement;
  private still = reducedMotion();

  constructor(body: HTMLElement) {
    const row = el('div', 'jp-row', body);
    const pips = el('span', 'hx-pips', row);
    pips.setAttribute('aria-label', 'Pin charges');
    for (let i = 0; i < 4; i++) this.pips.push(el('i', '', pips));
    this.previews = el('span', 'hx-prev', row);
    const shelf = el('div', 'hx-shelf', body);
    this.threads = svg('svg', { viewBox: '0 0 400 24', preserveAspectRatio: 'none', class: 'hx-threads', 'aria-hidden': 'true' }, shelf) as SVGSVGElement;
    for (let i = 0; i < 6; i++) this.paths.push(svg('path', { d: '' }, this.threads) as SVGPathElement);
    for (let i = 0; i < 4; i++) this.slots.push(new DollView(shelf));
  }

  update(me: Ship, target: Ship | null): void {
    const p = hexPanel(me, target);
    this.pips.forEach((e, i) => {
      setStyle(e, '--fill', p.pins[i].toFixed(2));
      setFlag(e, 'ready', p.pins[i] >= 1);
    });
    this.slots.forEach((v, i) => v.set(p.slots[i], this.still));
    // Threads arc over the shelf between stitched slots.
    this.paths.forEach((path, i) => {
      const l = p.links[i];
      const d = l ? `M${50 + l[0] * 100} 24 Q${50 * (l[0] + l[1]) + 50} ${-6 - 6 * (l[1] - l[0])} ${50 + l[1] * 100} 24` : '';
      if (path.getAttribute('d') !== d) path.setAttribute('d', d);
    });
    const v = p.previews;
    setText(this.previews, v ? `TWIST ${kilo(v.twist)} · RIP ${kilo(v.rip)} · UNMAKING ${kilo(v.unmaking)}` : 'TWIST — · RIP — · UNMAKING —');
  }
}

/** The Gourmand's own gauges: three jars, the next salvo's flavour, previews, digestion and the feast timers. */
class GourmandGauges {
  private jars: { root: HTMLElement; n: HTMLElement; last: number }[] = [];
  private next: HTMLElement;
  private previews: HTMLElement;
  private digest: HTMLElement;
  private digestName: HTMLElement;
  private digestFill: HTMLElement;
  private digestTime: HTMLElement;
  private feast: HTMLElement;

  constructor(body: HTMLElement) {
    const row = el('div', 'jp-row', body);
    const jars = el('span', 'gm-jars', row);
    for (const label of ['SHELL', 'EXPLOSIVE', 'SCRAP']) {
      const root = el('span', 'gm-jar', jars);
      root.setAttribute('role', 'meter');
      root.setAttribute('aria-label', `${label} ingredients`);
      el('i', 'gm-fill', root);
      el('b', '', root).textContent = label[0];
      this.jars.push({ root, n: el('span', 'gm-n', root), last: 0 });
    }
    this.next = el('span', 'gm-next', row);
    this.previews = el('div', 'gm-prev', body);
    this.digest = el('div', 'gm-digest', body);
    this.digest.hidden = true;
    this.digestName = el('span', 'gm-dname', this.digest);
    this.digestFill = el('i', '', el('span', 'gm-dbar', this.digest));
    this.digestTime = el('span', 'gm-dtime', this.digest);
    this.feast = el('div', 'gm-feast', body);
  }

  update(me: Ship): void {
    const p = gourmandPanel(me);
    p.jars.forEach((j, i) => {
      const v = this.jars[i];
      v.root.dataset.kind = j.kind;
      setStyle(v.root, '--fill', (j.n / p.cap).toFixed(3));
      setText(v.n, String(j.n));
      setFlag(v.root, 'next', p.next.kind === j.kind);
      if (v.root.getAttribute('aria-valuenow') !== String(j.n)) {
        v.root.setAttribute('aria-valuenow', String(j.n));
        v.root.setAttribute('aria-valuemax', String(p.cap));
      }
      // A jar that just filled up a little glints.
      if (j.n > v.last) flash(v.root, 'gain');
      v.last = j.n;
    });
    setText(this.next, `NEXT ${p.next.label} · ${p.next.effect}`);
    if (this.next.dataset.kind !== (p.next.kind ?? 'plain')) this.next.dataset.kind = p.next.kind ?? 'plain';
    setText(this.previews, `COOKER ${kilo(p.previews.cooker)} · COMFORT +${kilo(p.previews.heal)} HP, ${kilo(p.previews.shield)} shield`);
    const d = p.digest;
    if (this.digest.hidden !== !d) this.digest.hidden = !d;
    if (d) {
      setText(this.digestName, `DIGESTING ${d.name}`);
      setStyle(this.digestFill, 'width', `${(d.frac * 100).toFixed(1)}%`);
      setText(this.digestTime, `${d.left.toFixed(1)}s`);
    }
    const feast = [p.banquet > 0 ? `BANQUET ${Math.ceil(p.banquet)}s` : '', p.mouth > 0 ? `MOUTH OPEN ${p.mouth.toFixed(1)}s` : ''].filter(Boolean).join(' · ');
    setText(this.feast, feast);
    if (this.feast.hidden !== !feast) this.feast.hidden = !feast;
  }
}

/** A row of pips, one per slot, each draining with the life its fracture or ridge has left. */
class Pips {
  readonly root: HTMLElement;
  private pips: HTMLElement[] = [];
  private label: HTMLElement;

  constructor(parent: HTMLElement, private name: string) {
    this.root = el('span', 'fl-pips', parent);
    this.root.setAttribute('role', 'meter');
    this.root.setAttribute('aria-label', name);
    this.label = el('b', '', this.root);
  }

  set(lives: number[], cap: number): void {
    while (this.pips.length < cap) this.pips.push(el('i', 'fl-pip', this.root));
    this.pips.forEach((pip, i) => {
      const life = lives[i];
      setFlag(pip, 'on', life !== undefined);
      setStyle(pip, '--life', (life ?? 0).toFixed(2));
      // A pip about to go out flickers.
      setFlag(pip, 'low', life !== undefined && life < 0.2);
    });
    setText(this.label, `${this.name.split(' ')[0].toUpperCase()} ${lives.length}/${cap}`);
    if (this.root.getAttribute('aria-valuenow') !== String(lives.length)) {
      this.root.setAttribute('aria-valuenow', String(lives.length));
      this.root.setAttribute('aria-valuemax', String(cap));
    }
  }
}

/** The Faultline's own gauges: a magma pressure gauge that runs hot from 80, the Caldera preview, and fracture and ridge pips. */
class FaultlineGauges {
  private gauge: HTMLElement;
  private n: HTMLElement;
  private caldera: HTMLElement;
  private fractures: Pips;
  private ridges: Pips;
  private bedrock: HTMLElement;
  private last = 0;

  constructor(body: HTMLElement) {
    const row = el('div', 'jp-row', body);
    this.gauge = el('span', 'fl-gauge', row);
    this.gauge.setAttribute('role', 'meter');
    this.gauge.setAttribute('aria-label', 'Pressure');
    this.gauge.setAttribute('aria-valuemin', '0');
    el('i', 'fl-magma', el('span', 'fl-track', this.gauge));
    this.n = el('span', 'fl-n', this.gauge);
    this.caldera = el('span', 'fl-caldera', row);
    const pips = el('div', 'fl-network', body);
    this.fractures = new Pips(pips, 'Fractures open');
    this.ridges = new Pips(pips, 'Ridges standing');
    this.bedrock = el('div', 'fl-bedrock', body);
  }

  update(me: Ship): void {
    const p = faultlinePanel(me);
    const n = Math.round(p.pressure);
    setStyle(this.gauge, '--fill', (p.pressure / p.max).toFixed(3));
    setFlag(this.gauge, 'hot', p.hot);
    setText(this.n, `PRESSURE ${n}`);
    if (this.gauge.getAttribute('aria-valuenow') !== String(n)) {
      this.gauge.setAttribute('aria-valuenow', String(n));
      this.gauge.setAttribute('aria-valuemax', String(p.max));
    }
    // A jump in pressure (a hit, Slip, Bedrock) pulses the gauge.
    if (n >= this.last + 5) flash(this.gauge, 'surge');
    this.last = n;
    setText(this.caldera, `CALDERA ${kilo(p.caldera)}`);
    setFlag(this.caldera, 'hot', p.hot);
    this.fractures.set(p.fractures, p.maxFractures);
    this.ridges.set(p.ridges, p.maxRidges);
    const brace = p.bedrock > 0 ? `BEDROCK ${p.bedrock.toFixed(1)}s · REBOUND READY` : '';
    setText(this.bedrock, brace);
    if (this.bedrock.hidden !== !brace) this.bedrock.hidden = !brace;
  }
}

export class MiscTitanHud {
  /** The captain's own titan panel; null for every other ship. */
  readonly panel: HTMLElement | null = null;
  /** Where each titan's own gauges go. */
  readonly body: HTMLElement | null = null;
  private line: HTMLElement | null = null;
  private banner: HTMLElement;
  private bannerTitle: HTMLElement;
  private bannerDetail: HTMLElement;
  private bannerLaws: Laws | null = null;
  private bannerMeter: Meter | null = null;
  /** The banner meter's last value, to flash it on each new violation. */
  private bannerN = -1;
  private judge: JudgeGauges | null = null;
  private hex: HexGauges | null = null;
  private gourmand: GourmandGauges | null = null;
  private faultline: FaultlineGauges | null = null;

  constructor(
    parent: HTMLElement,
    private pc: PlayerController,
  ) {
    const kind = miscTitanKind(pc.ship);
    if (kind) {
      const panel = el('div', `misc-panel ${kind}`, parent);
      panel.setAttribute('role', 'group');
      panel.setAttribute('aria-label', `${NAMES[kind]} status`);
      el('b', 'mp-name', panel).textContent = NAMES[kind];
      this.line = el('span', 'mp-line', panel);
      this.line.setAttribute('aria-live', 'polite');
      this.body = el('div', 'mp-body', panel);
      this.panel = panel;
      if (kind === 'judge') this.judge = new JudgeGauges(this.body);
      if (kind === 'hexweaver') this.hex = new HexGauges(this.body);
      if (kind === 'gourmand') this.gourmand = new GourmandGauges(this.body);
      if (kind === 'faultline') this.faultline = new FaultlineGauges(this.body);
    }
    this.banner = el('div', 'misc-banner', parent);
    this.banner.setAttribute('role', 'status');
    this.banner.setAttribute('aria-live', 'polite');
    this.banner.hidden = true;
    this.bannerTitle = el('b', '', this.banner);
    this.bannerDetail = el('span', '', this.banner);
  }

  update(): void {
    const me = this.pc.ship;
    const target = this.pc.lock ?? this.pc.assist;
    if (this.line) setText(this.line, miscTitanSummary(me, target));
    this.judge?.update(me, target);
    this.hex?.update(me, target);
    this.gourmand?.update(me);
    this.faultline?.update(me);
    const b = miscVictimBanner(me);
    if (this.banner.hidden !== !b) this.banner.hidden = !b;
    if (!b) {
      this.bannerN = -1;
      return;
    }
    if (this.banner.dataset.kind !== b.kind) {
      this.banner.dataset.kind = b.kind;
      // A different titan's meter counts something else; do not flash on the switch.
      this.bannerN = -1;
      this.bannerMeter?.root.setAttribute('aria-label', meterName(b.kind));
    }
    setFlag(this.banner, 'urgent', b.alert);
    setText(this.bannerTitle, b.title);
    setText(this.bannerDetail, b.detail);
    if (b.laws) {
      this.bannerLaws ??= new Laws(this.banner);
      this.bannerLaws.set(b.laws);
    }
    if (this.bannerLaws && this.bannerLaws.root.hidden !== !b.laws) this.bannerLaws.root.hidden = !b.laws;
    if (b.meter) {
      this.bannerMeter ??= new Meter(this.banner, meterName(b.kind));
      this.bannerMeter.set(b.meter.n, b.meter.cap, b.meter.mark);
      // Every new violation or pin flashes the banner, so the victim sees the moment it lands.
      if (this.bannerN >= 0 && b.meter.n > this.bannerN) flash(this.banner, 'cited');
      this.bannerN = b.meter.n;
    }
    if (this.bannerMeter && this.bannerMeter.root.hidden !== !b.meter) this.bannerMeter.root.hidden = !b.meter;
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
