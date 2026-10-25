import type { Team } from '../../core/types';
import { ALLY, palette } from '../../ui/palette';
import { GROUND_CAP_RADIUS } from '../sim/config';
import type { GroundGame } from '../sim/GroundGame';
import { PROP_RUBBLE } from '../sim/props';
import { MAT } from '../sim/terrain';
import type { TankController } from './TankController';

// Tactical map for one ground HUD: shaded relief with roads, water and houses (redrawn as they
// fall), then capture zones, smoke, telegraphed strikes and every vehicle at about 12 Hz.

/** Map colours per material, before hill shading. */
const MAT_RGB: Record<number, [number, number, number]> = {
  [MAT.dirt]: [74, 66, 52],
  [MAT.grass]: [58, 72, 48],
  [MAT.road]: [70, 72, 76],
  [MAT.rubble]: [84, 78, 70],
  [MAT.snow]: [178, 186, 196],
  [MAT.deepSnow]: [196, 204, 214],
  [MAT.ice]: [140, 176, 200],
  [MAT.water]: [28, 56, 78],
  [MAT.mud]: [64, 54, 40],
  [MAT.rail]: [60, 56, 54],
};

export class GroundMinimap {
  readonly canvas = document.createElement('canvas');
  private ground = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private timer = 0;
  private size = 0;
  /** Houses have fallen since the static layer was drawn. */
  private stale = false;
  private off: () => void;

  constructor(
    private game: GroundGame,
    private pc: TankController,
    private team: Team,
  ) {
    this.canvas.className = 'minimap';
    this.ctx = this.canvas.getContext('2d')!;
    this.off = game.events.on('propDown', () => (this.stale = true));
  }

  dispose(): void {
    this.off();
  }

  private toPx(v: number): number {
    const h = this.game.terrain.half;
    return ((v + h) / (h * 2)) * this.size;
  }

  /** Relief, materials and houses, at one pixel per map pixel. */
  private buildGround(): void {
    const s = this.size;
    const g = this.game;
    const t = g.terrain;
    this.ground.width = this.ground.height = s;
    const c = this.ground.getContext('2d')!;
    const img = c.createImageData(s, s);
    const half = t.half;
    const step = (half * 2) / s;
    for (let py = 0; py < s; py++) {
      for (let px = 0; px < s; px++) {
        const x = -half + (px + 0.5) * step;
        const z = -half + (py + 0.5) * step;
        const m = t.materialAt(x, z);
        const rgb = MAT_RGB[m] ?? MAT_RGB[MAT.dirt];
        // Light from the north-west.
        const gr = t.gradient(x, z);
        const shade = Math.max(0.55, Math.min(1.35, 1 + (gr.gx + gr.gz) * -1.6));
        const k = (py * s + px) * 4;
        img.data[k] = rgb[0] * shade;
        img.data[k + 1] = rgb[1] * shade;
        img.data[k + 2] = rgb[2] * shade;
        img.data[k + 3] = 235;
      }
    }
    c.putImageData(img, 0, 0);
    const kpx = s / (half * 2);
    for (const p of g.props.list) {
      if (p.kind !== 'building' && p.kind !== 'wall') continue;
      c.save();
      c.translate(this.toPx(p.x), this.toPx(p.z));
      c.rotate(p.rot);
      c.fillStyle = p.state === PROP_RUBBLE ? 'rgba(120,110,96,0.55)' : p.kind === 'wall' ? 'rgba(150,150,150,0.8)' : 'rgba(26,30,36,0.92)';
      c.fillRect(-p.hw * kpx, -p.hd * kpx, p.hw * 2 * kpx, p.hd * 2 * kpx);
      c.restore();
    }
    c.strokeStyle = 'rgba(77,232,255,0.08)';
    c.lineWidth = 1;
    for (let i = 1; i < 8; i++) {
      const p = (i / 8) * s;
      c.beginPath();
      c.moveTo(p, 0);
      c.lineTo(p, s);
      c.moveTo(0, p);
      c.lineTo(s, p);
      c.stroke();
    }
  }

  update(dt: number): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.08;
    const w = this.canvas.clientWidth;
    if (!w) return;
    const dpr = Math.min(2, window.devicePixelRatio);
    const px = Math.round(w * dpr);
    if (px !== this.size || this.stale) {
      this.stale = false;
      if (px !== this.size) this.canvas.width = this.canvas.height = px;
      this.size = px;
      this.buildGround();
    }
    const c = this.ctx;
    const s = this.size;
    const g = this.game;
    const k = s / (g.terrain.half * 2);
    const u = s / 230;
    c.clearRect(0, 0, s, s);
    c.drawImage(this.ground, 0, 0);

    c.fillStyle = 'rgba(210,220,230,0.35)';
    for (const sm of g.smokes) {
      c.beginPath();
      c.arc(this.toPx(sm.x), this.toPx(sm.z), sm.r * k, 0, Math.PI * 2);
      c.fill();
    }
    g.caps.forEach((cap) => {
      const x = this.toPx(cap.x);
      const y = this.toPx(cap.z);
      c.beginPath();
      c.arc(x, y, GROUND_CAP_RADIUS * k, 0, Math.PI * 2);
      c.strokeStyle = cap.owner === -1 ? 'rgba(234,246,255,0.85)' : cap.owner === this.team ? ALLY : palette().enemy;
      c.lineWidth = 1.5 * u;
      c.stroke();
      c.fillStyle = c.strokeStyle;
      c.font = `700 ${Math.round(11 * u)}px 'Chakra Petch', sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(cap.name, x, y);
    });
    c.lineWidth = 1;
    for (const st of g.strikes.list) {
      if (st.done) continue;
      c.strokeStyle = st.owner.team === this.team ? 'rgba(77,232,255,0.6)' : 'rgba(255,59,78,0.85)';
      c.beginPath();
      c.arc(this.toPx(st.x), this.toPx(st.z), Math.max(2, st.r * k), 0, Math.PI * 2);
      c.stroke();
    }

    // Gun range ring and the aim line.
    const pc = this.pc;
    const me = pc.focus;
    if (me.alive) {
      const mx = this.toPx(me.renderX);
      const my = this.toPx(me.renderZ);
      const range = me.spec.gun?.range ?? me.spec.launcher?.range ?? 0;
      c.strokeStyle = 'rgba(234,246,255,0.2)';
      c.beginPath();
      c.arc(mx, my, range * k, 0, Math.PI * 2);
      c.stroke();
      if (me === pc.v) {
        c.strokeStyle = 'rgba(255,181,71,0.75)';
        c.beginPath();
        c.moveTo(mx, my);
        c.lineTo(this.toPx(pc.aimPoint.x), this.toPx(pc.aimPoint.z));
        c.stroke();
        // View cone.
        c.fillStyle = 'rgba(234,246,255,0.08)';
        c.beginPath();
        c.moveTo(mx, my);
        c.arc(mx, my, 60 * u, pc.yaw - Math.PI / 2 - 0.5, pc.yaw - Math.PI / 2 + 0.5);
        c.closePath();
        c.fill();
      }
    }

    const base = 4 * u;
    for (const v of g.vehicles) {
      if (!v.alive || v.withdrawn) continue;
      const ally = v.team === this.team;
      c.save();
      c.translate(this.toPx(v.renderX), this.toPx(v.renderZ));
      c.rotate(v.renderHeading);
      const sz = v.titan ? base * 2 : v.isSummon ? base * 0.75 : base;
      c.fillStyle = v === pc.v ? '#ffffff' : ally ? ALLY : palette().enemy;
      // A hull box with the gun line: direction and turret at a glance.
      c.fillRect(-sz * 0.75, -sz, sz * 1.5, sz * 2);
      c.rotate(v.renderTurret);
      c.fillRect(-sz * 0.18, -sz * 2.1, sz * 0.36, sz * 1.6);
      c.restore();
    }
  }
}
