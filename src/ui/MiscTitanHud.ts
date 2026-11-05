import type { PlayerController } from '../player/PlayerController';
import type { Ship } from '../ships/Ship';
import { miscMarkerChip, miscTitanKind, miscTitanSummary, miscVictimBanner } from './MiscTitanPresentation';

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

export class MiscTitanHud {
  /** The captain's own titan panel; null for every other ship. */
  readonly panel: HTMLElement | null = null;
  /** Where each titan's own gauges go. */
  readonly body: HTMLElement | null = null;
  private line: HTMLElement | null = null;
  private banner: HTMLElement;
  private bannerTitle: HTMLElement;
  private bannerDetail: HTMLElement;

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
    if (this.line) setText(this.line, miscTitanSummary(me, this.pc.lock ?? this.pc.assist));
    const b = miscVictimBanner(me);
    if (this.banner.hidden !== !b) this.banner.hidden = !b;
    if (!b) return;
    if (this.banner.dataset.kind !== b.kind) this.banner.dataset.kind = b.kind;
    setFlag(this.banner, 'alert', b.alert);
    setText(this.bannerTitle, b.title);
    setText(this.bannerDetail, b.detail);
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
