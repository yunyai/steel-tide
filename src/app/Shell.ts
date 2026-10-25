import type { BattleConfig } from '../core/BattleSetup';
import type { ShipSpec } from '../core/types';
import type { Input } from '../input/Input';
import type { Renderer } from '../render/Renderer';
import type { Menu } from '../ui/Menu';
import type { ActiveBattle } from './ActiveBattle';

/** What every screen of the game shares: the renderer, input and menus, the DOM layers over the view, and the battle on screen. */
export interface Shell {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: Renderer;
  readonly input: Input;
  readonly menu: Menu;
  /** HUDs, one per captain. */
  readonly hudLayer: HTMLElement;
  /** Title, hangar and lobby screens. */
  readonly menuLayer: HTMLElement;
  /** Sheets over a battle: the battle menu, scoreboard and report. */
  readonly overlayLayer: HTMLElement;
  /** The battle on screen, if any. */
  readonly battle: ActiveBattle | null;
  /** Put a battle on screen, closing the one there was. */
  show(battle: ActiveBattle): void;
  /** Close the battle on screen. */
  closeBattle(): void;
  /** Show a ship turning behind the menus, `offset` across the screen. */
  preview(spec: ShipSpec, offset: number): void;
  /** Start a battle on this machine alone. */
  startSolo(config: BattleConfig): void;
}
