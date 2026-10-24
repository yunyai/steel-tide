import { DIFFICULTIES, INPUT_DEVICES, type InputDeviceId, LAYOUT_MOUSE, LAYOUT_TITAN, layoutFor } from '../config';
import { type BattleConfig, type BattleType, type DifficultyId, defaultAssist, type PlayerConfig } from '../core/BattleSetup';
import type { BattleEra, Era, ShipClass, ShipSpec } from '../core/types';
import { accentCss } from '../data/accents';
import { ERAS, ERA_BLURB, ERA_LABEL, FACTIONS, eraOf } from '../data/factions';
import { CLASS_LABEL, SHIPS, SHIP_BY_ID, shipsIn, shipsOf } from '../data/ships';
import { audio } from '../fx/Audio';
import { controls, setControls } from '../input/Settings';
import { RUSH_WAVES, loadBest } from '../modes/BossRush';
import { QUALITIES, type QualityId, quality, setQuality } from '../render/Quality';
import { consumableLabel } from '../ships/Consumables';
import { MAPS } from '../world/GameMap';
import { field, h, html, seg } from './dom';
import { classIcon, glyph, skillIcon } from './Icons';

// Title, battle orders, the hangar (ship selection), controls and graphics.

export interface MenuHooks {
  start(config: BattleConfig): void;
  preview(spec: ShipSpec, offset: number): void;
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

/** Eras with ships to sail, and the choices a battle offers (Mixed once there are two). */
export const LIVE_ERAS = ERAS.filter((e) => shipsOf(e).length > 0);
const BATTLE_ERAS: BattleEra[] = LIVE_ERAS.length > 1 ? [...LIVE_ERAS, 'mixed'] : LIVE_ERAS;

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

function keyName(code: string): string {
  return code.replace('Key', '').replace('Digit', '').replace('ShiftLeft', 'Shift');
}

export class Menu {
  private draft: BattleConfig = {
    mode: 'solo',
    type: 'domination',
    mapId: 'strait',
    teamSize: 6,
    difficulty: 'normal',
    players: [{ shipId: 'yamato', device: 'mouse' }],
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

  constructor(
    private root: HTMLElement,
    private hooks: MenuHooks,
  ) {}

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
      b.innerHTML = `${glyph(icon)}<b>${label}</b><small>${note}</small>`;
      b.onclick = () => {
        this.hooks.click();
        fn();
      };
      return b;
    };
    const battle = item('salvo', 'Battle', 'Fleet against fleet: capture zones or sink them all', '', () => this.showOrders('battle'));
    battle.dataset.focus = '';
    const rush = item('nuke', 'Boss Rush', `Hold out against ${RUSH_WAVES} waves, with a titan every fifth`, 'rush', () => this.showOrders('rush'));
    const lan = item('fleet', 'LAN battle', 'Play friends on your network: team against team, or together against the AI', '', () => this.hooks.lan());
    const line = SHIPS.filter((s) => s.cls !== 'TT').length;
    const titans = SHIPS.length - line;
    const eras = LIVE_ERAS.length > 1 ? ` across ${LIVE_ERAS.length} eras` : '';
    const hangar = item('star', 'Hangar', `${line} warships with two skills and an ultimate, ${titans} titans with six and three${eras}`, '', () => this.showHangar(null));
    const minor = h('div', { class: 'minor' }, this.act('Controls', 'btn-quiet', () => this.showControls()), this.act('Graphics and sound', 'btn-quiet', () => this.showGraphics()));
    const el = h(
      'div',
      { class: 'title-screen' },
      h('h1', { class: 'title-mark' }, 'Steel', h('span', {}, 'Tide')),
      h('p', { class: 'title-sub' }, 'Real hulls, real armour, and weapons that should never have been built. Wave-motion cannons, orbital rods and lightning storms decide the fight.'),
      h('div', { class: 'title-actions' }, battle, rush, lan, hangar, minor),
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
      shipCount.push(this.field('Ships per team', this.seg([3, 4, 5, 6, 7, 8].map((n) => ({ value: n, label: String(n) })), () => d.teamSize, (v) => (d.teamSize = v)), 'A titan brings two extra enemy ships to keep things fair.'));
      aiCount.push(
        this.field('AI allies', this.seg(counts(7), () => fa[0], (v) => (fa[0] = v)), 'AI ships sailing with you.'),
        this.field('AI enemies', this.seg(counts(8), () => fa[1], (v) => (fa[1] = v)), 'None leaves the sea to you. A titan brings two extra enemy ships when there are any.'),
      );
    }
    const notes = () => {
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
              // The captain's ship has to come from the era too.
              const pc = d.players[0];
              const cur = SHIP_BY_ID[pc.shipId];
              if (v !== 'mixed' && eraOf(cur) !== v) pc.shipId = eraDefault(v, cur).id;
            },
          ),
          eraNote,
        ),
      );
    }
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
      fields.push(...shipCount, ...aiCount);
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
      { class: 'sheet panel setup' },
      tabs,
      ...fields,
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
      const keys = layoutFor(s).skills.map(keyName);
      const cards = s.skills.map((sk, i) => {
        const c = h('div', { class: `skill-card${sk.ult ? ' ult' : ''}` });
        c.style.setProperty('--accent', accentCss(sk.accent));
        const hexi = html(`<div class="hexi">${skillIcon(sk.icon)}<kbd>${keys[i]}</kbd></div>`);
        c.append(
          hexi,
          h('div', { class: 'top' }, h('b', {}, sk.name), h('span', { class: 'cd' }, sk.ult ? 'Ultimate' : `${sk.cooldown} s cooldown`)),
          h('p', {}, sk.description),
        );
        return c;
      });
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
            this.hooks.preview(s, 0);
            renderRoster();
            renderDossier();
          };
          return b;
        }),
      );
    };
    roster.append(h('h3', {}, eras.length > 1 ? 'Hangar' : `${ERA_LABEL[eras[0]]} hangar`), eraTabs, classTabs, list);
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
    const start = () => {
      d.seed = Math.floor(Math.random() * 1e9);
      const config = structuredClone(d);
      if (config.type === 'freeplay') config.ai = [this.freeAi[0], this.freeAi[1]];
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
    const el = h('div', { class: 'hangar' }, roster, h('div', { class: 'spacer' }), dossier, foot);
    this.mount(el);
    primary.focus({ preventScroll: true });
  }

  showGraphics(): void {
    const levels = [
      { value: 0, label: 'Off' },
      { value: 0.35, label: 'Low' },
      { value: 0.7, label: 'Medium' },
      { value: 1, label: 'High' },
    ];
    const el = h(
      'div',
      { class: 'sheet panel' },
      h('h2', {}, 'Graphics and sound'),
      this.field(
        'Graphics',
        this.seg<QualityId>((Object.keys(QUALITIES) as QualityId[]).map((k) => ({ value: k, label: QUALITIES[k].label })), () => quality().id, (v) => setQuality(v)),
        'Ultra Low has the lowest detail and the longest view distance, for seeing ships far out through the haze or running on weak machines. Low turns off shadows and post effects. Medium and High add bloom, colour grading and anti-aliasing. Changes apply from the next battle.',
      ),
      this.field(
        'Volume',
        this.seg(
          levels,
          () => levels.reduce((a, b) => (Math.abs(b.value - audio.volume) < Math.abs(a.value - audio.volume) ? b : a)).value,
          (v) => audio.setVolume(v),
        ),
      ),
      h('div', { class: 'sheet-actions' }, this.act('Done', 'btn-primary', () => this.showTitle())),
    );
    this.mount(el);
  }

  showControls(): void {
    const L = LAYOUT_MOUSE;
    const T = LAYOUT_TITAN;
    const keys = (codes: string[]) => {
      const span = h('span');
      codes.forEach((c, i) => {
        if (i) span.append(' ');
        span.append(h('kbd', {}, keyName(c)));
      });
      return span;
    };
    const txt = (t: string) => document.createTextNode(t);
    const rows: [string, Node, string][] = [
      ['Engine telegraph', keys([L.throttleUp, L.throttleDown]), 'Left stick up / down'],
      ['Rudder (steps, stays set)', keys([L.left, L.right]), 'Left stick left / right'],
      ['Aim', txt('Mouse'), 'Right stick'],
      ['Fire', txt('Left mouse'), 'RT'],
      ['Skills', keys([L.skills[0], L.skills[1]]), 'X, B'],
      ['Ultimate (charges from damage dealt and taken, kills, and time)', keys([L.skills[2]]), 'Y'],
      ['Titan skills', keys(T.skills.slice(0, 6)), 'X, B; hold LB or RB for the rest'],
      ['Titan ultimates (each charges on its own)', keys(T.skills.slice(6)), 'Y, LB Y, RB Y'],
      ['Repair kit: puts out fires and flooding, heals', keys([L.consumables[0]]), 'D-pad up'],
      ['Class utility (smoke, search, boost)', keys([L.consumables[1]]), 'D-pad right'],
      ['Weapons (AP, HE, torpedoes / squadrons)', keys(L.slots), 'LB / RB'],
      ['Lock target (titans: middle mouse only)', h('span', {}, keys([L.lock]), txt(' or middle mouse')), 'A'],
      ['Gunsight scope', txt('Shift, or wheel past the closest view'), 'LT (hold) or d-pad left'],
      ['Follow shot: ride your newest shell in (again, or fire, to return)', keys([L.follow]), 'RS click (not submarines)'],
      ['Fire-control assist on / off (titans: N)', keys([L.assist]), 'D-pad down'],
      ['Submarine surface / dive', keys([L.diveUp, L.diveDown]), 'RS / LS click'],
      ['Free look / camera distance', txt('Right mouse drag / wheel'), '—'],
      ['Boss Rush refit choice', keys(['Digit1', 'Digit2', 'Digit3']), 'X, Y, B'],
      ['Scoreboard, pause', keys(['Tab', 'Escape']), 'Back, Start'],
    ];
    const table = h(
      'table',
      {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Action'), h('th', {}, 'Keyboard + mouse'), h('th', {}, 'Gamepad'))),
      h('tbody', {}, ...rows.map((r) => h('tr', {}, h('td', {}, r[0]), h('td', {}, r[1]), h('td', {}, r[2])))),
    );
    this.mount(
      h(
        'div',
        { class: 'sheet panel controls' },
        h('h2', {}, 'Controls'),
        h(
          'p',
          { class: 'lede' },
          'Guns aim at whatever is under the crosshair. The amber diamond shows where to aim so shells meet a moving target. Crates at sea repair you, charge your ultimate, reset your skills or boost your damage: sail over them. Out of combat for 7 seconds, your hull starts repairing itself.',
        ),
        h(
          'div',
          { class: 'prefs' },
          this.field(
            'Mouse sensitivity',
            this.seg(
              [0.5, 0.75, 1, 1.25, 1.5, 2].map((v) => ({ value: v, label: `${v}×` })),
              () => controls().sens,
              (v) => setControls({ sens: v }),
            ),
          ),
          this.field(
            'Vertical aim',
            this.seg(
              [
                { value: 0, label: 'Normal' },
                { value: 1, label: 'Inverted' },
              ],
              () => (controls().invertY ? 1 : 0),
              (v) => setControls({ invertY: v === 1 }),
            ),
          ),
        ),
        table,
        h('div', { class: 'sheet-actions' }, this.act('Back', 'btn-quiet', () => this.showTitle())),
      ),
    );
  }
}
