import type { PlayerController } from '../player/PlayerController';
import type { Ship } from '../ships/Ship';
import { judgePanel, miscMarkerChip, miscTitanKind, miscTitanSummary, miscVictimBanner, type LawView } from './MiscTitanPresentation';

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
    setFlag(this.root, 'alert', n >= mark);
    if (this.root.getAttribute('aria-valuenow') !== String(n)) {
      this.root.setAttribute('aria-valuenow', String(n));
      this.root.setAttribute('aria-valuemax', String(cap));
    }
  }
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
    const b = miscVictimBanner(me);
    if (this.banner.hidden !== !b) this.banner.hidden = !b;
    if (!b) {
      this.bannerN = -1;
      return;
    }
    if (this.banner.dataset.kind !== b.kind) this.banner.dataset.kind = b.kind;
    setFlag(this.banner, 'alert', b.alert);
    setText(this.bannerTitle, b.title);
    setText(this.bannerDetail, b.detail);
    if (b.laws) {
      this.bannerLaws ??= new Laws(this.banner);
      this.bannerLaws.set(b.laws);
    }
    if (this.bannerLaws && this.bannerLaws.root.hidden !== !b.laws) this.bannerLaws.root.hidden = !b.laws;
    if (b.meter) {
      this.bannerMeter ??= new Meter(this.banner, 'Your case');
      this.bannerMeter.set(b.meter.n, b.meter.cap, b.meter.mark);
      // Every new violation flashes the banner, so the victim sees the moment they broke a law.
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
    setFlag(e, 'alert', c.alert);
    setText(e, c.text);
  }
}
