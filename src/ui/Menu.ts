import { architectLoadoutEditor,savedArchitectLoadout,saveArchitectLoadout } from './ArchitectLoadout';
import { fleetEditor } from './FleetEditor';
import { randomShip, selectionError } from '../core/FleetSelection';
import { DIFFICULTIES, INPUT_DEVICES, type InputDeviceId, SHIFT_SURGE, SHIFT_TEMPOS, type ShiftTempo } from '../config';
import { type BattleConfig, type BattleType, type DifficultyId, defaultAssist, type PlayerConfig } from '../core/BattleSetup';
import type { BattleEra, Era, ShipClass, ShipSpec } from '../core/types';
import { accentCss } from '../data/accents';
import { ERAS, ERA_BLURB, ERA_LABEL, FACTIONS, eraOf } from '../data/factions';
import { CLASS_LABEL, LINE_ERAS, SHIPS, SHIP_BY_ID, shipsIn, shipsOf } from '../data/ships';
import { keyName, layoutFor } from '../input/Keybinds';
import { RUSH_WAVES, loadBest } from '../modes/BossRush';
import { consumableLabel } from '../ships/Consumables';
import type { GroundConfig } from '../ground/sim/setup';
import type { VehicleSpec } from '../ground/sim/types';
import { VEHICLES } from '../ground/sim/data';
import { MAPS } from '../world/GameMap';
import { field, h, html, seg } from './dom';
import { type GarageFlow, GroundMenu, kindSwitch } from './GroundMenu';
import { classIcon, glyph, skillIcon, vehicleClassIcon } from './Icons';
import { buildSettings } from './SettingsSheet';

// Title, battle orders, the hangar (ship selection) and settings. Ground battles' orders and
// Garage live in GroundMenu.

export interface MenuHooks {
  start(config: BattleConfig | GroundConfig): void;
  preview(spec: ShipSpec | VehicleSpec, offset: number): void;
  click(): void;
  /** Open the LAN lobbies. */
  lan(): void;
}

/** Which flow the hangar belongs to: picking a ship for a battle, for Boss Rush, for a LAN lobby, or just browsing. */
export type HangarFlow = 'battle' | 'rush' | 'lan' | null;

export type Tab = 'BB' | 'cruiser' | 'DD' | 'CV' | 'SS' | 'TT';
/** Hangar tabs (shared with Free play's ship picker). */
export const TABS: { id: Tab; label: string; classes: ShipClass[] }[] = [
  { id: 'BB', label: 'Battleship', classes: ['BB'] },
  { id: 'cruiser', label: 'Cruiser', classes: ['CB', 'CA', 'CL'] },
  { id: 'DD', label: 'Destroyer', classes: ['DD'] },
  { id: 'CV', label: 'Carrier', classes: ['CV'] },
  { id: 'SS', label: 'Submarine', classes: ['SS'] },
  { id: 'TT', label: 'Titan', classes: ['TT'] },
];

export function tabOf(cls: ShipClass): Tab {
  return TABS.find((t) => t.classes.includes(cls))!.id;
}

/**
 * Eras with ships to sail, and the choices a battle offers (Mixed once there are two). Only eras
 * with line ships can fill a battle; Misc's lone titan sails in Mixed.
 */
export const LIVE_ERAS = ERAS.filter((e) => shipsOf(e).length > 0);
const BATTLE_ERAS: BattleEra[] = LINE_ERAS.length > 1 ? [...LINE_ERAS, 'mixed'] : LINE_ERAS;

/** Eras whose ships can take a Titan Shift (the tempo switch shows for them). */
const shifting = (e: BattleEra) => e === 'mixed' || shipsOf(e).some((s) => s.shift);

/** What a Titan Shift tempo means for a form written at 40 s. */
function tempoBlurb(k: ShiftTempo): string {
  const t = SHIFT_TEMPOS[k];
  const time = 40 * t.timeMul;
  const at = t.unlock.map((u) => Math.round(u * time));
  const ready = at.every((a) => a === 0) ? 'all three of its ultimates are ready at once' : `its ultimates come ready ${at.map((a) => (a === 0 ? 'at once' : `after ${a} s`)).join(', ').replace(/, ([^,]*)$/, ' and $1')}`;
  return `A Titan Shift lasts about ${time} s, and ${ready}. Each fires once per shift.`;
}

function eraName(e: BattleEra): string {
  return e === 'mixed' ? 'Mixed' : ERA_LABEL[e];
}

function eraBlurb(e: BattleEra): string {
  return e === 'mixed' ? 'Every era at once: galleons, missile cruisers and railgun dreadnoughts in one fight.' : ERA_BLURB[e];
}

/** The ship to fall back on in an era: the first of the same hangar tab, else its first line ship. */
function eraDefault(era: BattleEra, like: ShipSpec): ShipSpec {
  const pool = shipsIn(era);
  return pool.find((s) => tabOf(s.cls) === tabOf(like.cls)) ?? pool.find((s) => s.cls !== 'TT')!;
}

function salvoDpm(s: ShipSpec): number {
  let d = s.air ? (s.air.torpedo.planes * s.air.torpedo.damage * 60) / (s.air.launchCooldown * 3 + 40) : 0;
  if (s.main) {
    const shell = s.main.ap ?? s.main.he!;
    const barrels = s.main.turrets.reduce((a, t) => a + t.barrels, 0);
    d += (barrels * shell.damage * 60) / s.main.reload;
  }
  if (s.torpedoes) {
    const tubes = s.torpedoes.launchers.reduce((a, l) => a + (l.tubes ?? s.torpedoes!.tubes), 0);
    d += (tubes * s.torpedoes.damage * 60 * 0.25) / s.torpedoes.reload;
  }
  // Point defence takes a share of every salvo.
  if (s.missiles) d += (s.missiles.salvo * s.missiles.damage * 60 * 0.6) / s.missiles.reload;
  return d;
}

function reach(s: ShipSpec): number {
  return Math.max(s.air?.range ?? 0, s.main?.range ?? 0, s.torpedoes?.range ?? 0, s.missiles?.range ?? 0);
}

// Gauges are scaled against every era's line ships; titans simply max them out.
const LINE = SHIPS.filter((s) => s.cls !== 'TT');
const MAX = {
  dpm: Math.max(...LINE.map(salvoDpm)),
  hp: Math.max(...LINE.map((s) => s.hp)),
  belt: Math.max(...LINE.map((s) => s.armor.belt)),
  speed: Math.max(...LINE.map((s) => s.maxSpeed)),
  range: Math.max(...LINE.map(reach)),
  turnMin: Math.min(...LINE.map((s) => s.turnRadius)),
  turnMax: Math.max(...LINE.map((s) => s.turnRadius)),
};

function loadout(s: ShipSpec): string[] {
  const out: string[] = [];
  if (s.main) {
    const counts = new Map<number, number>();
    for (const t of s.main.turrets) counts.set(t.barrels, (counts.get(t.barrels) ?? 0) + 1);
    const desc = [...counts].map(([b, n]) => `${n}×${b}`).join(' + ');
    out.push(`Main: ${desc} ${s.main.name}, ${(s.main.range / 1000).toFixed(1)} km, ${s.main.reload.toFixed(1)} s reload${s.main.ap ? '' : ' (HE only)'}`);
  }
  for (const sec of s.secondaries ?? []) out.push(`Secondary: ${sec.perSide * 2}×${sec.barrels} ${sec.name}`);
  if (s.torpedoes) {
    const tubes = s.torpedoes.launchers.reduce((a, l) => a + (l.tubes ?? s.torpedoes!.tubes), 0);
    out.push(`Torpedoes: ${tubes} tubes, ${s.torpedoes.name}, ${(s.torpedoes.range / 1000).toFixed(1)} km at ${s.torpedoes.speed} kn`);
  }
  if (s.missiles) {
    const m = s.missiles;
    out.push(`Missiles: ${m.salvo}-round salvos of ${m.name}, ${(m.range / 1000).toFixed(1)} km, ${m.reload.toFixed(0)} s reload`);
  }
  if (s.air) out.push(`Air wing: ${s.air.torpedo.name} torpedo bombers, ${s.air.dive.name} dive bombers, ${s.air.fighter.name} fighters`);
  out.push(`Consumables: ${s.consumables.map((c) => consumableLabel(c.type, s)).join(', ')}`);
  return out;
}

export class Menu {
  private draft: BattleConfig = {
    mode: 'solo',
    type: 'domination',
    mapId: 'strait',
    teamSize: 6,
    difficulty: 'normal',
    players: [{ shipId: 'yamato', device: 'mouse',architectLoadout:savedArchitectLoadout() }],
    seed: 1,
    escorts: 2,
    era: 'historic',
  };
  /** The fleet-battle type to return to after a Boss Rush. */
  private battleType: BattleType = 'domination';
  /** Free play: AI allies sailing with you and AI enemies. */
  private freeAi: [number, number] = [3, 4];
  /** Boss Rush or its endless variant, remembered between visits. */
  private rushType: 'bossrush' | 'survival' = 'bossrush';
  private tab: Tab = 'BB';
  /** The era tab open in the hangar. */
  private era: Era = 'historic';
  /** LAN hangar: whether the lobby allows titans, its era, and where the pick goes. */
  private lan: { titans: boolean; era: BattleEra; done: (shipId: string) => void } | null = null;

  private ground: GroundMenu;

  constructor(
    private root: HTMLElement,
    private hooks: MenuHooks,
  ) {
    this.ground = new GroundMenu({
      mount: (el) => this.mount(el),
      start: (config) => {
        // One pair of hands: the controls picked in the Garage carry over to the hangar.
        const p = config.players[0];
        this.setDevice(p.device, p.assist);
        hooks.start(config);
      },
      preview: (spec, offset) => hooks.preview(spec, offset),
      click: () => hooks.click(),
      title: () => this.showTitle(),
      ships: () => this.showHangar(null),
    });
  }

  private setDevice(device: InputDeviceId, assist: boolean | undefined): void {
    const pc = this.draft.players[0];
    pc.device = device;
    pc.assist = assist;
  }

  /** Ground battle orders, with the captain's controls carried over from the hangar. */
  showGroundOrders(): void {
    const pc = this.draft.players[0];
    this.ground.setDevice(pc.device, pc.assist);
    this.ground.showOrders();
  }

  /** The Garage: for the last ground battle's orders, or (`null`) browsing. */
  showGarage(flow: GarageFlow = 'battle'): void {
    this.ground.showGarage(flow);
  }

  private mount(el: HTMLElement): void {
    this.root.replaceChildren(el);
    const first = el.querySelector<HTMLElement>('[data-focus], button, select');
    first?.focus({ preventScroll: true });
  }

  private act(label: string, cls: string, fn: () => void): HTMLButtonElement {
    const b = h('button', { class: `btn ${cls}` }, label);
    b.onclick = () => {
      this.hooks.click();
      fn();
    };
    return b;
  }

  /** The local captain's ship, controls and fire control as last chosen in the hangar. */
  get captain(): PlayerConfig {
    return this.draft.players[0];
  }

  /** Pick a ship for a LAN lobby; `done` gets the choice when the captain heads back. */
  showLanHangar(shipId: string, titans: boolean, era: BattleEra, done: (shipId: string) => void): void {
    if (SHIP_BY_ID[shipId]) this.draft.players[0].shipId = shipId;
    this.lan = { titans, era, done };
    this.showHangar('lan');
  }

  hide(): void {
    this.root.replaceChildren();
  }

  showTitle(): void {
    this.hooks.preview(SHIP_BY_ID[this.draft.players[0].shipId], 0.3);
    const item = (icon: string, label: string, note: string, cls: string, fn: () => void) => {
      const b = h('button', { class: `go${cls ? ` ${cls}` : ''}` });
      b.innerHTML = `${icon.startsWith('<') ? icon : glyph(icon)}<b>${label}</b><small>${note}</small>`;
      b.onclick = () => {
        this.hooks.click();
        fn();
      };
      return b;
    };
    const battle = item('salvo', 'Naval battle', 'Fleet against fleet: capture zones or sink them all', '', () => this.showOrders('battle'));
    battle.dataset.focus = '';
    const ground = item(vehicleClassIcon('HT'), 'Ground battle', 'Tanks on land: angle the armour, find the weak plate, flatten the cover', '', () => this.showGroundOrders());
    const rush = item('nuke', 'Boss Rush', `Hold out against ${RUSH_WAVES} waves, with a titan every fifth`, 'rush', () => this.showOrders('rush'));
    const lan = item('fleet', 'LAN battle', 'Play friends on your network: team against team, or together against the AI', '', () => this.hooks.lan());
    const line = SHIPS.filter((s) => s.cls !== 'TT').length;
    const titans = SHIPS.length - line;
    const eras = LIVE_ERAS.length > 1 ? ` across ${LIVE_ERAS.length} eras` : '';
    const vehicles = VEHICLES.filter((v) => !v.hidden).length;
    const hangar = item('star', 'Hangar', `${line} warships and ${vehicles} vehicles with two skills and an ultimate, ${titans} titans with six and three${eras}`, '', () => this.showHangar(null));
    const minor = h('div', { class: 'minor' }, this.act('Settings', 'btn-quiet', () => this.showSettings()));
    const el = h(
      'div',
      { class: 'title-screen' },
      h('h1', { class: 'title-mark' }, 'Steel', h('span', {}, 'Tide')),
      h('p', { class: 'title-sub' }, 'Real hulls, real armour, and weapons that should never have been built. Wave-motion cannons, orbital rods and lightning storms decide the fight.'),
      h('div', { class: 'title-actions' }, battle, ground, rush, lan, hangar, minor),
    );
    const best = Object.entries(loadBest()).sort((a, b) => b[1].score - a[1].score)[0];
    if (best && SHIP_BY_ID[best[0]]) {
      const rec = h('div', { class: 'record panel' });
      rec.innerHTML = `${glyph('star')}<div><small>Best Boss Rush run</small><b class="num">${best[1].score.toLocaleString()}</b><small>Wave ${best[1].wave} in ${SHIP_BY_ID[best[0]].name}</small></div>`;
      el.append(rec);
    }
    this.mount(el);
  }

  private seg<T extends string | number>(options: { value: T; label: string }[], get: () => T, set: (v: T) => void): HTMLElement {
    return seg(options, get, set, () => this.hooks.click());
  }

  private field(label: string, control: HTMLElement, note?: HTMLElement | string): HTMLElement {
    return field(label, control, note);
  }

  /** Battle orders: a fleet battle or a Boss Rush run, switchable by the tabs on top. */
  showOrders(kind: 'battle' | 'rush'): void {
    const d = this.draft;
    if (kind === 'rush') {
      if (d.type !== 'bossrush' && d.type !== 'survival') this.battleType = d.type;
      d.type = this.rushType;
      if (!MAPS.some((m) => m.id === d.mapId)) d.mapId = 'open';
    } else d.type = this.battleType;

    const tabs = h('div', { class: 'tabs', role: 'group' });
    const mk = (k: 'battle' | 'rush', title: string, sub: string) => {
      const b = h('button', { class: k === 'rush' ? 'rush' : '', 'aria-pressed': String(kind === k) }, title, h('small', {}, sub));
      b.onclick = () => {
        this.hooks.click();
        this.showOrders(k);
      };
      return b;
    };
    tabs.append(mk('battle', 'Fleet battle', 'You and AI captains against an AI fleet'), mk('rush', 'Boss Rush', 'Survive the waves, sink the titans'));

    const side = this.field(
      'Convoy side',
      this.seg(
        [
          { value: 'escort', label: 'Escort' },
          { value: 'raid', label: 'Raid' },
        ],
        () => d.convoySide ?? 'escort',
        (v) => {
          d.convoySide = v;
          notes();
        },
      ),
    );

    const typeNote = h('p', { class: 'note' });
    const mapNote = h('p', { class: 'note' });
    const shipCount: HTMLElement[] = [];
    const aiCount: HTMLElement[] = [];
    if (kind === 'battle') {
      const counts = (max: number) => Array.from({ length: max + 1 }, (_, n) => ({ value: n, label: String(n) }));
      const fa = this.freeAi;
      shipCount.push(this.field('Ships per team', this.seg([3, 4, 5, 6, 7, 8].map((n) => ({ value: n, label: String(n) })), () => d.teamSize, (v) => { d.teamSize = v; renderFleets(); }), 'A titan brings two extra enemy ships to keep things fair.'));
      aiCount.push(
        this.field('AI allies', this.seg(counts(7), () => fa[0], (v) => { fa[0] = v; renderFleets(); }), 'AI ships sailing with you.'),
        this.field('AI enemies', this.seg(counts(8), () => fa[1], (v) => { fa[1] = v; renderFleets(); }), 'None leaves the sea to you. A titan brings two extra enemy ships when there are any.'),
      );
    }
    const fleetControls = h('div', { class: 'fleet-controls' });
    const renderFleets = () => {
      fleetControls.replaceChildren();
      if (kind !== 'battle') return;
      const counts = d.type === 'freeplay' ? this.freeAi : [d.teamSize - 1, d.teamSize];
      for (const t of [0, 1] as const) fleetControls.append(fleetEditor(t === 0 ? 'Allied AI' : 'Enemy AI', d.era ?? 'historic', true, d.aiSelection?.[t], counts[t], value => {
        d.aiSelection ??= [{ mode: 'auto' }, { mode: 'auto' }];
        d.aiSelection[t] = value;
      }, t === 1 && counts[t] > 0 && SHIP_BY_ID[d.players[0].shipId].cls === 'TT' ? 2 : 0));
    };
    const notes = () => {
      renderFleets();
      typeNote.textContent =
        d.type === 'domination'
          ? 'Hold capture zones to earn points; sinking ships also swings the score. First to 1000 wins. Sunk ships return to the fight after 8 seconds.'
          : d.type === 'convoy'
            ? (d.convoySide ?? 'escort') === 'escort'
              ? 'Four transports sail for a port on the far side. Bring two in, or keep two afloat until time runs out. One life each.'
              : 'Four transports sail for a port on the far side. Sink three of them before they make it. One life each.'
            : d.type === 'freeplay'
              ? 'No score to win and no clock. Every sunk ship comes back after 8 seconds; change ship from the battle menu (Esc), and end the battle there when you are done.'
              : 'No zones. The last fleet afloat wins; at the 15 minute mark, remaining hit points decide.';
      side.hidden = d.type !== 'convoy';
      for (const f of shipCount) f.hidden = d.type === 'freeplay';
      for (const f of aiCount) f.hidden = d.type !== 'freeplay';
      mapNote.textContent = MAPS.find((x) => x.id === d.mapId)!.description;
    };
    notes();
    const rushNote = () =>
      this.rushType === 'survival'
        ? 'No titans and no finish line: every wave is bigger than the last. Between waves you repair and pick one of three refits. How long can you hold?'
        : `Every wave scales up. Titans arrive on waves 5, 10 and 15; after wave ${RUSH_WAVES} the waves never stop. Between waves you repair and pick one of three refits.`;
    const runNote = h('p', { class: 'note' }, rushNote());
    const fields: HTMLElement[] = [];
    const tempoNote = h('p', { class: 'note' }, tempoBlurb(d.shiftTempo ?? 'staggered'));
    const tempo = this.field(
      'Titan Shift',
      this.seg<ShiftTempo>(
        (Object.keys(SHIFT_TEMPOS) as ShiftTempo[]).map((k) => ({ value: k, label: SHIFT_TEMPOS[k].label })),
        () => d.shiftTempo ?? 'staggered',
        (v) => {
          d.shiftTempo = v;
          tempoNote.textContent = tempoBlurb(v);
        },
      ),
      tempoNote,
    );
    tempo.hidden = !shifting(d.era ?? 'historic');
    if (BATTLE_ERAS.length > 1) {
      const eraNote = h('p', { class: 'note' }, eraBlurb(d.era ?? 'historic'));
      fields.push(
        this.field(
          'Era',
          this.seg<BattleEra>(
            BATTLE_ERAS.map((e) => ({ value: e, label: eraName(e) })),
            () => d.era ?? 'historic',
            (v) => {
              d.era = v;
              eraNote.textContent = eraBlurb(v);
              tempo.hidden = !shifting(v);
              // The captain's ship has to come from the era too.
              const pc = d.players[0];
              const cur = SHIP_BY_ID[pc.shipId];
              if (v !== 'mixed' && eraOf(cur) !== v) pc.shipId = eraDefault(v, cur).id;
              renderFleets();
            },
          ),
          eraNote,
        ),
      );
    }
    fields.push(tempo);
    if (kind === 'battle') {
      fields.push(
        this.field(
          'Battle type',
          this.seg<BattleType>(
            [
              { value: 'domination', label: 'Domination' },
              { value: 'annihilation', label: 'Annihilation' },
              { value: 'convoy', label: 'Convoy' },
              { value: 'freeplay', label: 'Free play' },
            ],
            () => d.type,
            (v) => {
              d.type = this.battleType = v;
              notes();
            },
          ),
          typeNote,
        ),
        side,
      );
    }
    fields.push(
      this.field(
        'Map',
        this.seg(
          MAPS.map((m) => ({ value: m.id, label: m.name })),
          () => d.mapId,
          (v) => {
            d.mapId = v;
            notes();
          },
        ),
        mapNote,
      ),
    );
    if (kind === 'battle') {
      fields.push(...shipCount, ...aiCount, fleetControls);
    } else {
      fields.push(
        this.field(
          'Run',
          this.seg<'bossrush' | 'survival'>(
            [
              { value: 'bossrush', label: 'Boss Rush' },
              { value: 'survival', label: 'Survival' },
            ],
            () => this.rushType,
            (v) => {
              d.type = this.rushType = v;
              runNote.textContent = rushNote();
            },
          ),
          runNote,
        ),
        this.field(
          'Escorts',
          this.seg(
            [
              { value: 0, label: 'Alone' },
              { value: 2, label: 'Two AI escorts' },
            ],
            () => d.escorts ?? 2,
            (v) => (d.escorts = v),
          ),
          'A cruiser and a destroyer that follow your lead.',
        ),
      );
    }
    fields.push(
      this.field(
        'AI skill',
        this.seg<DifficultyId>((Object.keys(DIFFICULTIES) as DifficultyId[]).map((k) => ({ value: k, label: DIFFICULTIES[k].label })), () => d.difficulty, (v) => (d.difficulty = v)),
        'Higher skill means tighter aim, better leading and quicker use of skills and ultimates.',
      ),
    );
    const next = this.act('Choose ship', kind === 'rush' ? 'btn-amber' : 'btn-primary', () => this.showHangar(kind));
    const el = h(
      'div',
      { class: 'sheet panel setup naval-setup' },
      tabs,
      h('div', { class: 'setup-body' }, ...fields),
      h('div', { class: 'sheet-actions' }, this.act('Back', 'btn-quiet', () => this.showTitle()), next),
    );
    this.mount(el);
    next.focus({ preventScroll: true });
  }

  showHangar(flow: HangarFlow): void {
    const d = this.draft;
    const pc = d.players[0];
    const lan = flow === 'lan' ? this.lan : null;
    // A battle fixes the era; Mixed battles and plain browsing open every era.
    const battleEra: BattleEra = lan ? lan.era : flow ? (d.era ?? 'historic') : 'mixed';
    const eras = battleEra === 'mixed' ? LIVE_ERAS : [battleEra];
    if (!eras.includes(eraOf(SHIP_BY_ID[pc.shipId]))) pc.shipId = eraDefault(eras[0], SHIP_BY_ID[pc.shipId]).id;
    if (lan && !lan.titans && SHIP_BY_ID[pc.shipId].cls === 'TT') pc.shipId = shipsIn(battleEra).find((s) => s.cls !== 'TT')!.id;
    let spec = SHIP_BY_ID[pc.shipId];
    this.tab = tabOf(spec.cls);
    this.era = eraOf(spec);
    this.hooks.preview(spec, 0);
    const roster = h('nav', { class: 'roster panel', 'aria-label': 'Ships' });
    const dossier = h('section', { class: 'dossier panel' });
    const survival = d.type === 'survival';
    const bests = loadBest(survival);
    /** The preview shows the selected ship's Titan Shift form instead of the ship. */
    let formLook = false;

    const renderDossier = () => {
      const s = spec;
      const titan = s.cls === 'TT';
      const stat = (label: string, frac: number, val: string) => {
        const f = Math.round(Math.max(0.05, Math.min(1, frac)) * 20) * 5;
        const g = h('div', { class: 'gauge' }, h('i', { style: `clip-path: inset(0 ${100 - f}% 0 0)` }));
        return [h('span', {}, label), g, h('span', { class: 'val num' }, val)];
      };
      const agility = (MAX.turnMax - s.turnRadius) / (MAX.turnMax - MAX.turnMin);
      const items = [
        ...stat('Hull', s.hp / MAX.hp, s.hp.toLocaleString()),
        ...stat('Firepower', salvoDpm(s) / MAX.dpm, `${Math.round(salvoDpm(s) / 1000)}k/min`),
        ...stat('Armour', s.armor.belt / MAX.belt, `${s.armor.belt} mm`),
        ...stat('Speed', s.maxSpeed / MAX.speed, `${+s.maxSpeed.toFixed(1)} kn`),
        ...stat('Agility', 0.1 + 0.9 * agility, `${Math.round(s.turnRadius)} m turn`),
        ...stat('Range', reach(s) / MAX.range, `${(reach(s) / 1000).toFixed(1)} km`),
      ];
      const cardsOf = (of: ShipSpec) => {
        const keys = layoutFor(of).skills.map(keyName);
        return of.skills.map((sk, i) => {
          const c = h('div', { class: `skill-card${sk.ult ? ' ult' : ''}${sk.icon === 'shift' ? ' shift' : ''}` });
          c.style.setProperty('--accent', accentCss(sk.accent));
          const hexi = html(`<div class="hexi">${skillIcon(sk.icon)}<kbd>${keys[i]}</kbd></div>`);
          const cd = sk.icon === 'shift' ? 'Titan Shift' : sk.ult ? (of.formOf ? 'Once per shift' : 'Ultimate') : `${sk.cooldown} s cooldown`;
          c.append(hexi, h('div', { class: 'top' }, h('b', {}, sk.name), h('span', { class: 'cd' }, cd)), h('p', {}, sk.description));
          return c;
        });
      };
      const cards = cardsOf(s);
      const form = s.shift ? SHIP_BY_ID[s.shift.form] : undefined;
      const shiftPart: HTMLElement[] = [];
      if (form && s.shift) {
        const fc = cardsOf(form);
        const look = h('button', { class: 'btn btn-quiet form-look', 'aria-pressed': String(formLook) }, formLook ? 'Show the ship' : 'Show the titan form');
        look.onclick = () => {
          this.hooks.click();
          formLook = !formLook;
          this.hooks.preview(formLook ? form : s, 0);
          renderDossier();
        };
        shiftPart.push(
          h('h4', { class: 'kit-head shift' }, `Titan Shift: ${form.name}`),
          h('p', { class: 'shift-note' }, `For about ${Math.round(s.shift.time * (FACTIONS[s.nation].trait?.shiftTimeMul ?? 1))} s: ${form.hp.toLocaleString()} HP titan scale, ${+form.maxSpeed.toFixed(1)} knots, the hull's share of damage carried over plus a ${Math.round(SHIFT_SURGE * 100)}% surge. ${form.description}`),
          look,
          h('div', { class: 'skill-cards titan' }, ...fc.filter((_, i) => !form.skills[i].ult)),
          h('h4', { class: 'kit-head ult' }, 'Form ultimates'),
          h('div', { class: 'skill-cards titan' }, ...fc.filter((_, i) => form.skills[i].ult)),
        );
      }
      const name = h('h2', { class: 'ship-name' }, s.name);
      const meta = h('div', { class: 'ship-meta' });
      if (titan) meta.append(h('span', { class: 'chip titan' }, 'TITAN'));
      const faction = FACTIONS[s.nation];
      // Fantasy hulls have no launch year.
      const year = faction.era === 'fantasy' ? '' : `, ${s.year}`;
      meta.append(`${CLASS_LABEL[s.cls]}, ${faction.label}${year}. ${s.length} m, ${+s.maxSpeed.toFixed(1)} knots`);
      const trait = faction.trait;
      const best = bests[s.id];
      dossier.replaceChildren(
        name,
        meta,
        h('p', { class: 'specialty' }, s.specialty),
        ...(trait ? [h('p', { class: 'trait' }, h('b', {}, trait.name), ` ${trait.description}`)] : []),
        h('div', { class: 'stats' }, ...items),
        ...(titan
          ? [
              h('h4', { class: 'kit-head' }, 'Skills'),
              h('div', { class: 'skill-cards titan' }, ...cards.filter((_, i) => !s.skills[i].ult)),
              h('h4', { class: 'kit-head ult' }, 'Ultimates'),
              h('div', { class: 'skill-cards titan' }, ...cards.filter((_, i) => s.skills[i].ult)),
            ]
          : [h('div', { class: 'skill-cards' }, ...cards)]),
        ...shiftPart,
        ...(s.id==='architect'?[architectLoadoutEditor(pc.architectLoadout??savedArchitectLoadout(),v=>{pc.architectLoadout=v;saveArchitectLoadout(v);})]:[]),
        h('ul', { class: 'loadout' }, ...loadout(s).map((l) => h('li', {}, l)), ...(best ? [h('li', {}, `Best ${survival ? 'Survival' : 'Boss Rush'}: wave ${best.wave}, ${best.score.toLocaleString()} points`)] : [])),
      );
    };

    const list = h('div', { class: 'ship-list' });
    const eraTabs = h('div', { class: 'era-tabs', role: 'group', 'aria-label': 'Era' });
    const classTabs = h('div', { class: 'class-tabs', role: 'group' });
    const renderRoster = () => {
      eraTabs.hidden = eras.length < 2;
      eraTabs.replaceChildren(
        ...eras.map((e) => {
          const b = h('button', { class: `era-${e}`, 'aria-pressed': String(this.era === e) }, ERA_LABEL[e]);
          b.onclick = () => {
            this.hooks.click();
            this.era = e;
            renderRoster();
          };
          return b;
        }),
      );
      const here = shipsOf(this.era);
      const tabs = TABS.filter((t) => (t.id !== 'TT' || !lan || lan.titans) && here.some((s) => t.classes.includes(s.cls)));
      if (!tabs.some((t) => t.id === this.tab)) this.tab = tabs[0].id;
      classTabs.replaceChildren(
        ...tabs.map((t) => {
          const b = h('button', { class: t.id === 'TT' ? 'titan' : '', 'aria-pressed': String(this.tab === t.id) }, t.label);
          b.onclick = () => {
            this.hooks.click();
            this.tab = t.id;
            renderRoster();
          };
          return b;
        }),
      );
      const tab = TABS.find((t) => t.id === this.tab)!;
      list.replaceChildren(
        ...here.filter((s) => tab.classes.includes(s.cls)).map((s) => {
          const b = h('button', { 'aria-pressed': String(s === spec), class: s.cls === 'TT' ? 'tt' : '' });
          b.innerHTML = classIcon(s.cls);
          b.append(h('b', {}, s.name), h('small', {}, FACTIONS[s.nation].short));
          b.onclick = () => {
            this.hooks.click();
            spec = s;
            pc.shipId = s.id;
            formLook = false;
            this.hooks.preview(s, 0);
            renderRoster();
            renderDossier();
          };
          return b;
        }),
      );
    };
    roster.append(h('h3', {}, eras.length > 1 ? 'Hangar' : `${ERA_LABEL[eras[0]]} hangar`));
    // Browsing from the title: the hangar and the garage are one screen with two halves.
    if (!flow) roster.append(kindSwitch('ships', () => {}, () => this.showGarage(null), () => this.hooks.click()));
    const random = this.act('Random ship', 'btn-quiet', () => {
      const chosen = randomShip(lan?.era ?? (flow ? d.era ?? 'historic' : 'mixed'), Math.random);
      if (!chosen) return;
      spec = chosen;
      pc.shipId = chosen.id;
      this.era = eraOf(chosen);
      this.tab = tabOf(chosen.cls);
      formLook = false;
      this.hooks.preview(chosen, 0);
      renderRoster();
      renderDossier();
    });
    roster.append(random, eraTabs, classTabs, list);
    renderRoster();
    renderDossier();

    const devSel = h('select', { id: 'dev0' }) as HTMLSelectElement;
    for (const dev of INPUT_DEVICES) {
      const o = h('option', { value: dev.id }, dev.label);
      if (dev.id === pc.device) o.selected = true;
      devSel.append(o);
    }
    // Fire-control assist follows the device until the player picks it explicitly.
    const aimSel = h('select', { id: 'aim0' }) as HTMLSelectElement;
    aimSel.append(h('option', { value: 'on' }, 'Assisted'), h('option', { value: 'off' }, 'Manual'));
    const syncAim = () => (aimSel.value = (pc.assist ?? defaultAssist(pc.device)) ? 'on' : 'off');
    syncAim();
    aimSel.onchange = () => (pc.assist = aimSel.value === 'on');
    devSel.onchange = () => {
      pc.device = devSel.value as InputDeviceId;
      syncAim();
    };
    const startError = h('p', { class: 'note error', role: 'alert' });
    const start = () => {
      d.seed = Math.floor(Math.random() * 1e9);
      const config = structuredClone(d);
      if (config.type === 'freeplay') config.ai = [this.freeAi[0], this.freeAi[1]];
      const error = selectionError(config.aiSelection, config.era, config.titans !== false, config.ai);
      if (error) { startError.textContent = error; return; }
      this.hooks.start(config);
    };
    const foot = h(
      'div',
      { class: 'hangar-foot' },
      h('label', { for: 'dev0' }, 'Controls'),
      devSel,
      h('label', { for: 'aim0', title: 'Assisted: the aim leads a target near the crosshair and pulls toward it. Spread is unchanged.' }, 'Fire control'),
      aimSel,
      h('span', { class: 'grow' }),
    );
    let primary: HTMLButtonElement;
    if (lan) {
      foot.append((primary = this.act('Back to lobby', 'btn-primary', () => lan.done(pc.shipId))));
    } else if (flow === 'battle') {
      foot.append(this.act('Back', 'btn-quiet', () => this.showOrders('battle')), (primary = this.act('Set sail', 'btn-primary', start)));
    } else if (flow === 'rush') {
      foot.append(this.act('Back', 'btn-quiet', () => this.showOrders('rush')), (primary = this.act(survival ? 'Start Survival' : 'Start Boss Rush', 'btn-amber', start)));
    } else {
      foot.append(
        this.act('Back', 'btn-quiet', () => this.showTitle()),
        this.act('Boss Rush', 'btn-amber', () => this.showOrders('rush')),
        (primary = this.act('Battle', 'btn-primary', () => this.showOrders('battle'))),
      );
    }
    const el = h('div', { class: 'hangar' }, roster, h('div', { class: 'spacer' }), dossier, h('div', { class: 'hangar-bottom' }, startError, foot));
    this.mount(el);
    primary.focus({ preventScroll: true });
  }

  showSettings(): void {
    this.mount(buildSettings({ back: () => this.showTitle(), click: () => this.hooks.click() }));
  }
}
