import { h } from './dom';

// The performance readout: frame rate and where each frame's time goes, refreshed once a second.

/** Milliseconds spent in each part of one frame. */
export interface FrameCost {
  /** Since the frame before (vsync and GPU waits included). */
  frame: number;
  sim: number;
  /** Moving the scene to match the battle: ship views, effects, particles. */
  scene: number;
  draw: number;
  hud: number;
}

const PARTS = ['sim', 'scene', 'draw', 'hud'] as const;

export class PerfPanel {
  readonly root = h('div', { class: 'perf-panel', 'aria-hidden': 'true' });
  private n = 0;
  private time = 0;
  private sum = { frame: 0, cpu: 0, sim: 0, scene: 0, draw: 0, hud: 0 };
  private worst = { frame: 0, cpu: 0 };

  /** `extra` gives the lines under the timings: draw calls, what is afloat, the LAN link. */
  constructor(
    parent: HTMLElement,
    private extra: () => string[],
  ) {
    parent.append(this.root);
    this.root.textContent = 'Measuring…';
  }

  sample(c: FrameCost): void {
    const cpu = c.sim + c.scene + c.draw + c.hud;
    this.n++;
    this.time += c.frame;
    this.sum.frame += c.frame;
    this.sum.cpu += cpu;
    for (const p of PARTS) this.sum[p] += c[p];
    this.worst.frame = Math.max(this.worst.frame, c.frame);
    this.worst.cpu = Math.max(this.worst.cpu, cpu);
    if (this.time >= 1000) this.show();
  }

  private show(): void {
    const n = this.n;
    const ms = (v: number) => (v / n).toFixed(1);
    const lines = [
      `${Math.round((1000 * n) / this.time)} fps, frame ${ms(this.sum.frame)} ms (worst ${this.worst.frame.toFixed(1)})`,
      `CPU ${ms(this.sum.cpu)} ms (worst ${this.worst.cpu.toFixed(1)})`,
      PARTS.map((p) => `${p} ${ms(this.sum[p])}`).join('  '),
      ...this.extra(),
    ];
    this.root.replaceChildren(...lines.map((l) => h('div', {}, l)));
    this.n = 0;
    this.time = 0;
    this.sum = { frame: 0, cpu: 0, sim: 0, scene: 0, draw: 0, hud: 0 };
    this.worst = { frame: 0, cpu: 0 };
  }

  dispose(): void {
    this.root.remove();
  }
}
