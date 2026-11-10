import type { Color, Scene } from 'three';
import type { Game } from '../core/Game';
import type { Team } from '../core/types';
import type { Ship } from '../ships/Ship';
import { playMiscSound } from '../fx/MiscTitanAudio';
import type { SpatialDistortion } from './SpatialDistortion';
import { FaultlineFx } from './misc/FaultlineFx';
import { GourmandFx } from './misc/GourmandFx';
import { HexweaverFx } from './misc/HexweaverFx';
import { JudgeFx } from './misc/JudgeFx';
import { MiscFxKit } from './misc/MiscFxKit';
import { PharosFx } from './misc/PharosFx';
import type { MiscShipFx } from './misc/MiscShipFx';

export { MISC_FX_BURSTS } from './misc/MiscShipFx';

/**
 * The misc titans' effects behind one scene object: each `miscTitan` event goes to its titan's
 * effects, and every viewport redraws them all from simulation state and event time.
 */
export class MiscTitanFx {
  readonly kit: MiscFxKit;
  readonly judge: JudgeFx;
  readonly hexweaver: HexweaverFx;
  readonly gourmand: GourmandFx;
  readonly faultline: FaultlineFx;
  readonly pharos: PharosFx;
  private all: MiscShipFx[];
  /** The captains on this screen, whose titans' sounds play louder. */
  locals: Ship[] = [];
  private off: (() => void)[] = [];
  private live = new Set<string>();

  constructor(scene: Scene, game: Game) {
    this.kit = new MiscFxKit(scene, game);
    this.judge = new JudgeFx(this.kit);
    this.hexweaver = new HexweaverFx(this.kit);
    this.gourmand = new GourmandFx(this.kit);
    this.faultline = new FaultlineFx(this.kit);
    this.pharos = new PharosFx(this.kit);
    this.all = [this.judge, this.hexweaver, this.gourmand, this.faultline, this.pharos];
    this.off.push(
      game.events.view('miscTitan', (e) => {
        if (game.over) return;
        this.all.find((fx) => fx.owns(e.ship))?.add(e);
        playMiscSound(e, game.time, this.locals.includes(e.ship));
      }),
      game.events.view('gameOver', () => {
        for (const fx of this.all) fx.clear();
      }),
      game.events.view('respawn', (e) => this.drop(e.ship)),
      game.events.view('shipChanged', (e) => this.drop(e.old)),
    );
  }

  /** The light ribbons every cue draws with. */
  get ribbons() {
    return this.kit.light;
  }

  /** Event bursts playing across every titan. */
  get bursts(): number {
    return this.all.reduce((n, fx) => n + fx.bursts, 0);
  }

  get distortions(): SpatialDistortion[] {
    return this.kit.distortions;
  }

  set onShake(f: MiscFxKit['onShake']) {
    this.kit.onShake = f;
  }

  set onFlash(f: MiscFxKit['onFlash']) {
    this.kit.onFlash = f;
  }

  setFog(color: Color, density: number): void {
    this.kit.setFog(color, density);
  }

  private drop(s: Ship): void {
    for (const fx of this.all) fx.drop(s);
  }

  /** Scene groups are kept independently of viewer visibility, avoiding split-screen churn. */
  update(time: number, _dt: number): void {
    this.kit.t = this.kit.reduce ? 0 : time;
    this.live.clear();
    for (const fx of this.all) fx.update(this.live);
    this.kit.sweep(this.live);
  }

  /** Call before each viewport render, after update. No hidden target position is drawn. */
  prepare(team: Team | -1, heightPx = 1000): void {
    this.kit.begin(heightPx);
    this.kit.hideAll();
    for (const fx of this.all) fx.draw(team);
    this.kit.end();
  }

  dispose(): void {
    for (const off of this.off) off();
    this.off = [];
    for (const fx of this.all) fx.dispose();
    this.kit.dispose();
    this.live.clear();
  }
}
