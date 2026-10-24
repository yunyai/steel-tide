import type { Input } from '../input/Input';
import type { BossRush } from '../modes/BossRush';

// Boss Rush refit choice between waves: three cards, picked with 1/2/3, a gamepad face
// button or a click. Falls back to the first card when the clock runs out (the director
// does that, not this view).

const KEYS = ['Digit1', 'Digit2', 'Digit3'];
const PAD_KEYS = [2, 3, 1]; // X, Y, B: left to right on most pads.

export class Intermission {
  readonly root = document.createElement('div');
  private count: HTMLElement;
  private shown = '';

  constructor(
    private rush: BossRush,
    private input: Input,
    private padIndex: number,
    private onPick: () => void,
  ) {
    this.root.className = 'intermission';
    this.root.style.display = 'none';
    this.count = document.createElement('div');
    this.count.className = 'count';
  }

  private build(): void {
    const r = this.rush;
    const h = document.createElement('h3');
    h.textContent = r.cleared && r.wave === 15 ? 'All 15 waves cleared' : `Wave ${r.wave} cleared`;
    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = r.cleared ? 'Endless waves from here. Hull patched 35%, one repair kit restocked.' : 'Hull patched 35%, one repair kit restocked. Choose a refit.';
    const row = document.createElement('div');
    row.className = 'cards';
    r.offer.forEach((u, i) => {
      const b = document.createElement('button');
      b.className = 'card panel';
      const k = document.createElement('kbd');
      k.textContent = String(i + 1);
      const n = document.createElement('b');
      n.textContent = u.name;
      const p = document.createElement('p');
      p.textContent = u.description;
      b.append(k, n, p);
      const owned = r.taken.filter((t) => t === u.id).length;
      if (owned) {
        const s = document.createElement('div');
        s.className = 'stack';
        s.textContent = `Owned ×${owned}, stacks`;
        b.append(s);
      }
      b.onclick = () => this.pick(i);
      row.append(b);
    });
    this.root.replaceChildren(h, sub, row, this.count);
  }

  private pick(i: number): void {
    if (this.rush.choose(i)) this.onPick();
  }

  update(): void {
    const r = this.rush;
    const on = r.phase === 'offer' && r.offer.length > 0;
    const key = on ? `${r.wave}:${r.offer.map((u) => u.id).join()}` : '';
    if (key !== this.shown) {
      this.shown = key;
      this.root.style.display = on ? '' : 'none';
      if (on) this.build();
    }
    if (!on) return;
    const t = `Auto-pick in ${Math.ceil(r.timer)} s`;
    if (this.count.textContent !== t) this.count.textContent = t;
    KEYS.forEach((k, i) => {
      if (this.input.pressed(k)) this.pick(i);
    });
    if (this.padIndex >= 0) PAD_KEYS.forEach((b, i) => {
      if (this.input.padPressed(this.padIndex, b)) this.pick(i);
    });
  }
}
