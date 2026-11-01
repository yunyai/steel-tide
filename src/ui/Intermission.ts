import type { Input } from '../input/Input';
import { RUSH_WAVES, type BossRush, type Upgrade } from '../modes/BossRush';

// Boss Rush refit choice between waves: three cards, picked with 1/2/3, a gamepad face
// button or a click. Falls back to the first card when the clock runs out (the director
// does that, not this view). In co-op each captain sees their own cards, then who the
// offer still waits on.

const KEYS = ['Digit1', 'Digit2', 'Digit3'];
const PAD_KEYS = [2, 3, 1]; // X, Y, B: left to right on most pads.

/** Sends a card pick as an order every LAN peer applies on the same turn. */
export type SendCard = (i: number) => void;

/** What `captain` sees: their own cards, or (picked, or sent and on its way) who the offer waits on. */
export function intermissionView(r: BossRush, captain: number, sent: boolean): { on: boolean; cards: Upgrade[]; waiting: string } {
  const c = r.captains[captain];
  if (r.phase !== 'offer' || !c) return { on: false, cards: [], waiting: '' };
  if (!c.chosen && !sent) return { on: true, cards: c.offer, waiting: '' };
  const left = r.captains.filter((k, i) => i !== captain && !k.chosen).length;
  return { on: true, cards: [], waiting: left ? `Waiting for ${left} captain${left === 1 ? '' : 's'}…` : 'Refit chosen.' };
}

/** Pick card `i` for `captain`: solo applies it now; on LAN it only sends it, so every peer applies it alike. */
export function pickCard(r: BossRush, captain: number, i: number, send: SendCard | null): boolean {
  const c = r.captains[captain];
  if (r.phase !== 'offer' || !c || c.chosen || !c.offer[i]) return false;
  if (!send) return r.choose(i, captain);
  send(i);
  return true;
}

export class Intermission {
  readonly root = document.createElement('div');
  private count: HTMLElement;
  private shown = '';
  /** LAN: the wave whose card this captain has sent, while it travels to every peer. */
  private sentWave = -1;

  constructor(
    private rush: BossRush,
    /** The captain this view picks for. */
    private captain: number,
    private input: Input,
    private padIndex: number,
    /** LAN: how a pick travels; null applies it at once (solo). */
    private send: SendCard | null,
    private onPick: () => void,
  ) {
    this.root.className = 'intermission';
    this.root.style.display = 'none';
    this.count = document.createElement('div');
    this.count.className = 'count';
  }

  private build(cards: Upgrade[], waiting: string): void {
    const r = this.rush;
    const h = document.createElement('h3');
    h.textContent = r.cleared && r.wave === RUSH_WAVES ? `All ${RUSH_WAVES} waves cleared` : `Wave ${r.wave} cleared`;
    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = r.cleared ? 'Endless waves from here. Hull patched 35%, one repair kit restocked.' : 'Hull patched 35%, one repair kit restocked. Choose a refit.';
    // What the next wave brings, so the refit can answer it.
    const n = r.next;
    const ahead = document.createElement('div');
    ahead.className = 'next';
    const parts = [`${n.ships} ship${n.ships === 1 ? '' : 's'}`];
    if (n.titans) parts.push(n.titans === 1 ? 'a titan' : `${n.titans} titans`);
    if (n.elites) parts.push('elites');
    ahead.textContent = `Next: wave ${n.wave}, ${parts.join(', ')}`;
    const row = document.createElement('div');
    row.className = waiting ? 'waiting' : 'cards';
    if (waiting) row.textContent = waiting;
    const taken = r.captains[this.captain]?.taken ?? [];
    cards.forEach((u, i) => {
      const b = document.createElement('button');
      b.className = 'card panel';
      const k = document.createElement('kbd');
      k.textContent = String(i + 1);
      const n = document.createElement('b');
      n.textContent = u.name;
      const p = document.createElement('p');
      p.textContent = u.description;
      b.append(k, n, p);
      const owned = taken.filter((t) => t === u.id).length;
      if (owned) {
        const s = document.createElement('div');
        s.className = 'stack';
        s.textContent = `Owned ×${owned}, stacks`;
        b.append(s);
      }
      b.onclick = () => this.pick(i);
      row.append(b);
    });
    this.root.replaceChildren(h, sub, ahead, row, this.count);
  }

  private pick(i: number): void {
    if (this.sentWave === this.rush.wave || !pickCard(this.rush, this.captain, i, this.send)) return;
    if (this.send) this.sentWave = this.rush.wave;
    this.onPick();
  }

  update(): void {
    const r = this.rush;
    const { on, cards, waiting } = intermissionView(r, this.captain, this.sentWave === r.wave);
    const key = on ? `${r.wave}:${cards.map((u) => u.id).join()}:${waiting}` : '';
    if (key !== this.shown) {
      this.shown = key;
      this.root.style.display = on ? '' : 'none';
      if (on) this.build(cards, waiting);
    }
    if (!on) return;
    const t = waiting ? `The rest auto-pick in ${Math.ceil(r.timer)} s` : `Auto-pick in ${Math.ceil(r.timer)} s`;
    if (this.count.textContent !== t) this.count.textContent = t;
    if (waiting) return;
    KEYS.forEach((k, i) => {
      if (this.input.pressed(k)) this.pick(i);
    });
    if (this.padIndex >= 0) PAD_KEYS.forEach((b, i) => {
      if (this.input.padPressed(this.padIndex, b)) this.pick(i);
    });
  }
}
