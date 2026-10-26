import { contactVisible } from '../core/Targeting';
import { MAP_HALF, CAP_RADIUS } from '../config';
import { PORT_RADIUS } from '../modes/Convoy';
import type { Game } from '../core/Game';
import { PICKUP_COLOR } from '../core/Pickups';
import type { Team } from '../core/types';
import { GameMap } from '../world/GameMap';
import type { PlayerController } from '../player/PlayerController';
import { ALLY, palette } from './palette';

// Tactical minimap: static terrain layer plus live contacts at ~12 Hz.

const CARGO = '#ffd36b';
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

export class Minimap {
  readonly canvas = document.createElement('canvas');
  private terrain = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private timer = 0;
  private size = 0;

  constructor(
    private game: Game,
    private pc: PlayerController,
    private team: Team,
  ) {
    this.canvas.className = 'minimap';
    this.ctx = this.canvas.getContext('2d')!;
  }

  private toPx(v: number): number {
    return ((v + MAP_HALF) / (MAP_HALF * 2)) * this.size;
  }

  private buildTerrain(): void {
    const s = this.size;
    this.terrain.width = this.terrain.height = s;
    const c = this.terrain.getContext('2d')!;
    c.clearRect(0, 0, s, s);
    c.strokeStyle = 'rgba(77,232,255,0.09)';
    c.lineWidth = 1;
    for (let i = 1; i < 9; i++) {
      const p = (i / 9) * s;
      c.beginPath();
      c.moveTo(p, 0);
      c.lineTo(p, s);
      c.moveTo(0, p);
      c.lineTo(s, p);
      c.stroke();
    }
    for (const isl of this.game.map.islands) {
      c.beginPath();
      for (let k = 0; k <= 48; k++) {
        const a = (k / 48) * Math.PI * 2;
        const r = GameMap.radiusAt(isl, a) * 1.02;
        const x = this.toPx(isl.x + Math.cos(a) * r);
        const y = this.toPx(isl.z + Math.sin(a) * r);
        if (k === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.fillStyle = '#1b3240';
      c.fill();
      c.strokeStyle = 'rgba(77,232,255,0.45)';
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
    if (px !== this.size) {
      this.size = px;
      this.canvas.width = this.canvas.height = px;
      this.buildTerrain();
    }
    const c = this.ctx;
    const s = this.size;
    const g = this.game;
    c.clearRect(0, 0, s, s);
    c.drawImage(this.terrain, 0, 0);
    const k = s / (MAP_HALF * 2);

    // Smoke screens.
    c.fillStyle = 'rgba(200,220,235,0.3)';
    for (const sm of g.smokes) {
      c.beginPath();
      c.arc(this.toPx(sm.x), this.toPx(sm.z), sm.r * k, 0, Math.PI * 2);
      c.fill();
    }
    // Capture zones.
    g.caps.forEach((cap) => {
      const x = this.toPx(cap.x);
      const y = this.toPx(cap.z);
      c.beginPath();
      c.arc(x, y, CAP_RADIUS * k, 0, Math.PI * 2);
      c.strokeStyle = cap.owner === -1 ? 'rgba(234,246,255,0.8)' : cap.owner === this.team ? ALLY : palette().enemy;
      c.lineWidth = 1.5 * (s / 230);
      c.stroke();
      c.fillStyle = c.strokeStyle;
      c.font = `700 ${Math.round(11 * (s / 230))}px 'Chakra Petch', sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(cap.name, x, y);
    });

    // Convoy: the route still ahead of the column, and the port.
    const cv = g.convoy;
    if (cv) {
      const lead = Math.min(...cv.afloat().map((t) => cv.leg(t)), cv.route.length - 1);
      const from = cv.centre();
      c.strokeStyle = 'rgba(255,211,107,0.55)';
      c.lineWidth = 1.2 * (s / 230);
      c.setLineDash([4 * (s / 230), 4 * (s / 230)]);
      c.beginPath();
      [...(from ? [from] : []), ...cv.route.slice(lead)].forEach((p, i) => (i ? c.lineTo(this.toPx(p.x), this.toPx(p.z)) : c.moveTo(this.toPx(p.x), this.toPx(p.z))));
      c.stroke();
      c.setLineDash([]);
      c.beginPath();
      c.arc(this.toPx(cv.port.x), this.toPx(cv.port.z), PORT_RADIUS * k, 0, Math.PI * 2);
      c.strokeStyle = CARGO;
      c.lineWidth = 1.5 * (s / 230);
      c.stroke();
      c.fillStyle = 'rgba(255,211,107,0.15)';
      c.fill();
    }

    // Supply crates.
    for (const pk of g.pickups.items) {
      if (!pk.alive) continue;
      const x = this.toPx(pk.x);
      const y = this.toPx(pk.z);
      const r = 3.2 * (s / 230);
      c.fillStyle = hex(PICKUP_COLOR[pk.kind]);
      c.beginPath();
      c.moveTo(x, y - r);
      c.lineTo(x + r, y);
      c.lineTo(x, y + r);
      c.lineTo(x - r, y);
      c.closePath();
      c.fill();
    }
    // Incoming strikes (telegraphed area attacks).
    c.lineWidth = 1;
    for (const st of g.strikes.strikes) {
      if (!st.alive || st.kind === 'mine' || st.kind === 'shock') continue;
      c.strokeStyle = st.owner.team === this.team ? 'rgba(77,232,255,0.6)' : 'rgba(255,59,78,0.8)';
      c.beginPath();
      c.arc(this.toPx(st.x), this.toPx(st.z), Math.max(2, st.radius * k), 0, Math.PI * 2);
      c.stroke();
    }

    // Aim line and gun range ring for the player.
    const me = this.pc.focus;
    if (me.alive) {
      const mx = this.toPx(me.pos.x);
      const my = this.toPx(me.pos.z);
      c.strokeStyle = 'rgba(234,246,255,0.22)';
      c.lineWidth = 1;
      c.beginPath();
      c.arc(mx, my, me.maxAimRange() * k, 0, Math.PI * 2);
      c.stroke();
      if (me === this.pc.ship) {
        c.strokeStyle = 'rgba(255,181,71,0.75)';
        c.beginPath();
        c.moveTo(mx, my);
        c.lineTo(this.toPx(this.pc.aim.x), this.toPx(this.pc.aim.z));
        c.stroke();
      }
    }

    for (const search of this.pc.ship.consumables) {
      if (search.spec.type !== 'search' || search.active <= 0) continue;
      c.beginPath();
      c.arc(this.toPx(this.pc.ship.pos.x), this.toPx(this.pc.ship.pos.z), (search.spec.power ?? 0) * k, 0, Math.PI * 2);
      c.strokeStyle = '#4de8ff';
      c.setLineDash([5, 4]);
      c.stroke();
      c.setLineDash([]);
    }
    // Ships.
    const base = 4.5 * (s / 230);
    for (const sh of g.ships) {
      if (!contactVisible(sh, this.team)) continue;
      const ally = sh.team === this.team;
      const x = this.toPx(sh.pos.x);
      const y = this.toPx(sh.pos.z);
      c.save();
      c.translate(x, y);
      c.rotate(sh.heading);
      const cargo = sh.spec.cls === 'AK';
      const sz = sh.spec.cls === 'TT' ? base * 1.9 : cargo ? base * 1.2 : base;
      c.beginPath();
      c.moveTo(0, -sz * 1.5);
      c.lineTo(sz, sz);
      c.lineTo(-sz, sz);
      c.closePath();
      c.fillStyle = sh === this.pc.ship ? '#ffffff' : cargo ? CARGO : ally ? ALLY : palette().enemy;
      if (sh.submerged) {
        c.strokeStyle = c.fillStyle;
        c.lineWidth = 1.2;
        c.stroke();
      } else c.fill();
      c.restore();
    }
    // Spotted torpedoes.
    c.fillStyle = 'rgba(255,160,170,0.95)';
    for (const t of g.torps.torps) {
      if (!t.alive || (t.team !== this.team && !t.seen)) continue;
      c.fillRect(this.toPx(t.x) - 1, this.toPx(t.z) - 1, 2, 2);
    }
    // Squadrons.
    for (const sq of g.air.squadrons) {
      if (!sq.alive) continue;
      c.fillStyle = sq.team === this.team ? ALLY : palette().enemy;
      c.font = `${Math.round(10 * (s / 230))}px sans-serif`;
      c.fillText('✈', this.toPx(sq.x), this.toPx(sq.z));
    }
  }
}
