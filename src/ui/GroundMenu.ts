import { DIFFICULTIES, DOMINATION_WIN_SCORE, INPUT_DEVICES, type InputDeviceId, RESPAWN_DELAY } from '../config';
import { type DifficultyId, defaultAssist } from '../core/BattleSetup';
import type { BattleEra, Era } from '../core/types';
import { accentCss } from '../data/accents';
import { ERA_BLURB, ERA_LABEL, FACTIONS } from '../data/factions';
import { GROUND_TIME_LIMIT } from '../ground/sim/config';
import { ARMY, VEHICLE_BY_ID, VEHICLES, vehiclesIn } from '../ground/sim/data';
import { GROUND_MAPS } from '../ground/sim/maps';
import type { GroundBattleType, GroundConfig } from '../ground/sim/setup';
import { CLASS_NAME, VEHICLE_CLASSES, type VehicleClass, type VehicleSpec } from '../ground/sim/types';
import { GROUND_ERAS } from '../ground/view/VehiclePicker';
import { keyName, layoutFor } from '../input/Keybinds';
import { field, h, html, seg } from './dom';
import { vehicleClassIcon, skillIcon } from './Icons';

// Ground battle orders and the Garage (vehicle selection), in the naval menus' look.

export interface GroundMenuHooks {
  mount(el: HTMLElement): void;
  start(config: GroundConfig): void;
  preview(spec: VehicleSpec, offset: number): void;
  click(): void;
  title(): void;
  /** The naval hangar, from the Garage's Ships | Vehicles switch. */
  ships(): void;
}

/** Where the Garage was opened from: picking for a battle, or browsing from the title. */
export type GarageFlow = 'battle' | null;

const BATTLE_ERAS: BattleEra[] = GROUND_ERAS.length > 1 ? [...GROUND_ERAS, 'mixed'] : GROUND_ERAS;

const offered = (era: BattleEra) => vehiclesIn(era).filter((s) => !s.hidden);

function eraName(e: BattleEra): string {
  return e === 'mixed' ? 'Mixed' : ERA_LABEL[e];
}

function eraBlurb(e: BattleEra): string {
  return e === 'mixed' ? 'Every era at once: Tigers, Armatas, grav-tanks and rune engines in one fight.' : ERA_BLURB[e];
}

/** The vehicle to fall back on in an era: the same class, else its first line vehicle. */
function eraDefault(era: BattleEra, like: VehicleSpec): VehicleSpec {
  const pool = offered(era);
  return pool.find((s) => s.cls === like.cls) ?? pool.find((s) => s.cls !== 'TT')!;
}

/** Hull front as the shell meets it head on: the plate over the cosine of its slope. */
function frontArmor(s: VehicleSpec): number {
  return Math.round(s.armor.hull.front / Math.cos((s.armor.hull.slope * Math.PI) / 180));
}

function topPen(s: VehicleSpec): number {
  return Math.max(0, ...(s.gun?.ammo.map((a) => a.pen) ?? []), s.launcher?.pen ?? 0);
}

/** Damage a minute from the gun's first shell (clips included) and the launcher's salvos. */
function firepower(s: VehicleSpec): number {
  let d = 0;
  const g = s.gun;
  if (g) {
    const rounds = g.clip?.size ?? 1;
    const cycle = g.reload + (g.clip ? g.clip.interval * (g.clip.size - 1) : 0);
    d += (g.ammo[0].damage * (g.barrels ?? 1) * rounds * 60) / cycle;
  }
  const l = s.launcher;
  if (l) d += (l.damage * l.salvo * 60) / (l.reload + l.interval * l.salvo);
  return d;
}

function reloadTime(s: VehicleSpec): number {
  return s.gun?.reload ?? s.launcher?.reload ?? 0;
}

/** Turret traverse, or for casemates and rails the hull's own turn. */
function traverse(s: VehicleSpec): number {
  return s.gun && !s.gun.arc ? s.gun.traverse : s.drive.turnRate;
}

// Gauges are scaled against every line vehicle; titans simply max them out.
const LINE = VEHICLES.filter((s) => s.cls !== 'TT' && !s.hidden);
const MAX = {
  hp: Math.max(...LINE.map((s) => s.hp)),
  front: Math.max(...LINE.map(frontArmor)),
  side: Math.max(...LINE.map((s) => s.armor.hull.side)),
  rear: Math.max(...LINE.map((s) => s.armor.hull.rear)),
  pen: Math.max(...LINE.map(topPen)),
  firepower: Math.max(...LINE.map(firepower)),
  reloadMin: Math.min(...LINE.map(reloadTime).filter((r) => r > 0)),
  speed: Math.max(...LINE.map((s) => s.drive.maxSpeed)),
  traverse: Math.max(...LINE.map(traverse)),
};

const DRIVE_NAME = { tracks: 'Tracks', wheels: 'Wheels', hover: 'Hover drive' };

function loadout(s: VehicleSpec): string[] {
  const out: string[] = [];
  const g = s.gun;
  if (g) {
    const clip = g.clip ? `, ${g.clip.size}-round autoloader` : '';
    const twin = g.barrels && g.barrels > 1 ? `${g.barrels}× ` : '';
    out.push(`Gun: ${twin}${g.name}, ${g.reload.toFixed(1)} s reload${clip}, ${(g.range / 1000).toFixed(1)} km`);
    out.push(`Ammunition: ${g.ammo.map((a) => `${a.label} (${a.kind}, ${a.pen} mm)`).join(', ')}`);
    if (g.arc) out.push(`Casemate: ${g.arc * 2}° gun arc, the hull turns to aim`);
  }
  const l = s.launcher;
  if (l) {
    const guide = l.guidance === 'beam' ? ', guided to the crosshair' : l.guidance === 'top' ? ', top attack on a locked target' : '';
    out.push(`Launcher: ${l.salvo}-round salvos of ${l.name}, ${l.reload.toFixed(0)} s reload, ${(l.range / 1000).toFixed(1)} km${guide}`);
  }
  if (s.repairBeam) out.push(`Repair beam: ${s.repairBeam.hps} hit points a second to an ally within ${s.repairBeam.range} m`);
  out.push(`Drive: ${DRIVE_NAME[s.drive.type]}, ${Math.round(s.drive.reverse)} km/h reverse, climbs ${s.drive.climbDeg}°`);
  out.push(`Consumables: ${s.consumables.map((c) => c.name).join(', ')}`);
  return out;
}

export class GroundMenu {
  readonly draft: GroundConfig = {
    kind: 'ground',
    mode: 'solo',
    type: 'domination',
    mapId: GROUND_MAPS[0].id,
    teamSize: 6,
    difficulty: 'normal',
    players: [{ vehicleId: 'tiger2', device: 'mouse' }],
    seed: 1,
    era: 'historic',
    titans: true,
  };
  /** Free play: AI allies driving with you and AI enemies. */
  private freeAi: [number, number] = [3, 4];
  private tab: VehicleClass = 'HT';
  private era: Era = 'historic';

  constructor(private hooks: GroundMenuHooks) {}

  /** Controls and fire control follow the naval captain's until set here. */
  setDevice(device: InputDeviceId, assist: boolean | undefined): void {
    const pc = this.draft.players[0];
    pc.device = device;
    pc.assist = assist;
  }

  private act(label: string, cls: string, fn: () => void): HTMLButtonElement {
    const b = h('button', { class: `btn ${cls}` }, label);
    b.onclick = () => {
      this.hooks.click();
      fn();
    };
    return b;
  }

  private seg<T extends string | number>(options: { value: T; label: string }[], get: () => T, set: (v: T) => void): HTMLElement {
    return seg(options, get, set, () => this.hooks.click());
  }

  showOrders(): void {
    const d = this.draft;
    const typeNote = h('p', { class: 'note' });
    const mapNote = h('p', { class: 'note' });
    const counts = (max: number) => Array.from({ length: max + 1 }, (_, n) => ({ value: n, label: String(n) }));
    const fa = this.freeAi;
    const sizeField = field('Vehicles per team', this.seg([3, 4, 5, 6, 7, 8].map((n) => ({ value: n, label: String(n) })), () => d.teamSize, (v) => (d.teamSize = v)), 'A titan brings two extra enemy vehicles to keep things fair.');
    const aiFields = [
      field('AI allies', this.seg(counts(7), () => fa[0], (v) => (fa[0] = v)), 'AI vehicles driving with you.'),
      field('AI enemies', this.seg(counts(8), () => fa[1], (v) => (fa[1] = v)), 'None leaves the field to you. A titan brings two extra enemy vehicles when there are any.'),
      field(
        'Titans',
        this.seg<'on' | 'off'>(
          [
            { value: 'on', label: 'Allowed' },
            { value: 'off', label: 'Off' },
          ],
          () => (d.titans === false ? 'off' : 'on'),
          (v) => (d.titans = v === 'on'),
        ),
        'Whether you may change into a titan from the battle menu.',
      ),
    ];
    const minutes = Math.round(GROUND_TIME_LIMIT / 60);
    const notes = () => {
      typeNote.textContent =
        d.type === 'domination'
          ? `Hold capture zones to earn points; destroying vehicles also swings the score. First to ${DOMINATION_WIN_SCORE} wins. Destroyed vehicles return after ${RESPAWN_DELAY} seconds.`
          : d.type === 'freeplay'
            ? `No score to win and no clock. Every destroyed vehicle comes back after ${RESPAWN_DELAY} seconds; change vehicle from the battle menu (Esc), and end the battle there when you are done.`
            : `No zones and one life each. The last side with vehicles wins; at the ${minutes} minute mark, remaining hit points decide.`;
      sizeField.hidden = d.type === 'freeplay';
      for (const f of aiFields) f.hidden = d.type !== 'freeplay';
      mapNote.textContent = GROUND_MAPS.find((m) => m.id === d.mapId)!.description;
    };
    notes();
    const fields: HTMLElement[] = [];
    if (BATTLE_ERAS.length > 1) {
      const eraNote = h('p', { class: 'note' }, eraBlurb(d.era ?? 'historic'));
      fields.push(
        field(
          'Era',
          this.seg<BattleEra>(
            BATTLE_ERAS.map((e) => ({ value: e, label: eraName(e) })),
            () => d.era ?? 'historic',
            (v) => {
              d.era = v;
              eraNote.textContent = eraBlurb(v);
              const pc = d.players[0];
              const cur = VEHICLE_BY_ID[pc.vehicleId];
              if (v !== 'mixed' && cur.era !== v) pc.vehicleId = eraDefault(v, cur).id;
            },
          ),
          eraNote,
        ),
      );
    }
    fields.push(
      field(
        'Battle type',
        this.seg<GroundBattleType>(
          [
            { value: 'domination', label: 'Domination' },
            { value: 'annihilation', label: 'Annihilation' },
            { value: 'freeplay', label: 'Free play' },
          ],
          () => d.type,
          (v) => {
            d.type = v;
            notes();
          },
        ),
        typeNote,
      ),
      field(
        'Map',
        this.seg(
          GROUND_MAPS.map((m) => ({ value: m.id, label: m.name })),
          () => d.mapId,
          (v) => {
            d.mapId = v;
            notes();
          },
        ),
        mapNote,
      ),
      sizeField,
      ...aiFields,
      field(
        'AI skill',
        this.seg<DifficultyId>((Object.keys(DIFFICULTIES) as DifficultyId[]).map((k) => ({ value: k, label: DIFFICULTIES[k].label })), () => d.difficulty, (v) => (d.difficulty = v)),
        'Higher skill means tighter aim, better leading and quicker use of skills and ultimates.',
      ),
    );
    const next = this.act('Choose vehicle', 'btn-primary', () => this.showGarage('battle'));
    const el = h(
      'div',
      { class: 'sheet panel setup' },
      h('h2', {}, 'Ground battle'),
      h('p', { class: 'lede' }, 'You and AI crews against an AI force, on land. Angle your armour, aim for the weak plates, and save the ultimate for the push.'),
      ...fields,
      h('div', { class: 'sheet-actions' }, this.act('Back', 'btn-quiet', () => this.hooks.title()), next),
    );
    this.hooks.mount(el);
    next.focus({ preventScroll: true });
  }

  showGarage(flow: GarageFlow): void {
    const d = this.draft;
    const pc = d.players[0];
    const battleEra: BattleEra = flow ? (d.era ?? 'historic') : 'mixed';
    const eras = battleEra === 'mixed' ? GROUND_ERAS : [battleEra];
    let spec = VEHICLE_BY_ID[pc.vehicleId] ?? offered(eras[0])[0];
    if (!eras.includes(spec.era)) spec = eraDefault(eras[0], spec);
    pc.vehicleId = spec.id;
    this.tab = spec.cls;
    this.era = spec.era;
    this.hooks.preview(spec, 0);
    const roster = h('nav', { class: 'roster panel', 'aria-label': 'Vehicles' });
    const dossier = h('section', { class: 'dossier panel' });

    const renderDossier = () => {
      const s = spec;
      const titan = s.cls === 'TT';
      const stat = (label: string, frac: number, val: string) => {
        const f = Math.round(Math.max(0.05, Math.min(1, frac)) * 20) * 5;
        const g = h('div', { class: 'gauge' }, h('i', { style: `clip-path: inset(0 ${100 - f}% 0 0)` }));
        return [h('span', {}, label), g, h('span', { class: 'val num' }, val)];
      };
      const reload = reloadTime(s);
      const t = s.armor.turret;
      const items = [
        ...stat('Hit points', s.hp / MAX.hp, s.hp.toLocaleString()),
        ...stat('Front armour', frontArmor(s) / MAX.front, `${frontArmor(s)} mm${t ? `, turret ${t.front}` : ''}`),
        ...stat('Side armour', s.armor.hull.side / MAX.side, `${s.armor.hull.side} mm`),
        ...stat('Rear armour', s.armor.hull.rear / MAX.rear, `${s.armor.hull.rear} mm`),
        ...stat('Penetration', topPen(s) / MAX.pen, `${topPen(s)} mm`),
        ...stat('Firepower', firepower(s) / MAX.firepower, `${(firepower(s) / 1000).toFixed(1)}k/min`),
        ...stat('Reload', reload > 0 ? MAX.reloadMin / reload : 0, `${reload.toFixed(1)} s`),
        ...stat('Speed', s.drive.maxSpeed / MAX.speed, `${Math.round(s.drive.maxSpeed)} km/h`),
        ...stat('Traverse', traverse(s) / MAX.traverse, `${Math.round(traverse(s))}°/s`),
      ];
      const keys = layoutFor(s).skills.map(keyName);
      const cards = s.skills.map((sk, i) => {
        const c = h('div', { class: `skill-card${sk.ult ? ' ult' : ''}` });
        c.style.setProperty('--accent', accentCss(sk.accent));
        c.append(
          html(`<div class="hexi">${skillIcon(sk.icon)}<kbd>${keys[i]}</kbd></div>`),
          h('div', { class: 'top' }, h('b', {}, sk.name), h('span', { class: 'cd' }, sk.ult ? 'Ultimate' : `${sk.cooldown} s cooldown`)),
          h('p', {}, sk.description),
        );
        return c;
      });
      const meta = h('div', { class: 'ship-meta' });
      if (titan) meta.append(h('span', { class: 'chip titan' }, 'TITAN'));
      const faction = FACTIONS[s.nation];
      const year = faction.era === 'fantasy' ? '' : `, ${s.year}`;
      meta.append(`${CLASS_NAME[s.cls]}, ${ARMY[s.nation].label}${year}. ${s.mass} t, ${Math.round(s.drive.maxSpeed)} km/h`);
      const trait = faction.trait;
      dossier.replaceChildren(
        h('h2', { class: 'ship-name' }, s.name),
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
        h('ul', { class: 'loadout' }, ...loadout(s).map((l) => h('li', {}, l))),
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
      const here = offered(this.era);
      const tabs = VEHICLE_CLASSES.filter((c) => here.some((s) => s.cls === c));
      if (!tabs.includes(this.tab)) this.tab = tabs[0];
      classTabs.replaceChildren(
        ...tabs.map((c) => {
          const b = h('button', { class: c === 'TT' ? 'titan' : '', 'aria-pressed': String(this.tab === c) }, CLASS_NAME[c]);
          b.onclick = () => {
            this.hooks.click();
            this.tab = c;
            renderRoster();
          };
          return b;
        }),
      );
      list.replaceChildren(
        ...here
          .filter((s) => s.cls === this.tab)
          .map((s) => {
            const b = h('button', { 'aria-pressed': String(s === spec), class: s.cls === 'TT' ? 'tt' : '' });
            b.innerHTML = vehicleClassIcon(s.cls);
            b.append(h('b', {}, s.name), h('small', {}, ARMY[s.nation].short));
            b.onclick = () => {
              this.hooks.click();
              spec = s;
              pc.vehicleId = s.id;
              this.hooks.preview(s, 0);
              renderRoster();
              renderDossier();
            };
            return b;
          }),
      );
    };
    const head = h('h3', {}, eras.length > 1 ? 'Garage' : `${ERA_LABEL[eras[0]]} garage`);
    roster.append(head);
    // Browsing from the title: the hangar and the garage are one screen with two halves.
    if (!flow) roster.append(kindSwitch('vehicles', () => this.hooks.ships(), () => {}, () => this.hooks.click()));
    roster.append(eraTabs, classTabs, list);
    renderRoster();
    renderDossier();

    const devSel = h('select', { id: 'dev0' }) as HTMLSelectElement;
    for (const dev of INPUT_DEVICES) {
      const o = h('option', { value: dev.id }, dev.label);
      if (dev.id === pc.device) o.selected = true;
      devSel.append(o);
    }
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
    if (flow === 'battle') foot.append(this.act('Back', 'btn-quiet', () => this.showOrders()), (primary = this.act('Roll out', 'btn-primary', start)));
    else foot.append(this.act('Back', 'btn-quiet', () => this.hooks.title()), (primary = this.act('Ground battle', 'btn-primary', () => this.showOrders())));
    const el = h('div', { class: 'hangar' }, roster, h('div', { class: 'spacer' }), dossier, foot);
    this.hooks.mount(el);
    primary.focus({ preventScroll: true });
  }
}

/** The browse screen's Ships | Vehicles switch. */
export function kindSwitch(on: 'ships' | 'vehicles', ships: () => void, vehicles: () => void, click: () => void): HTMLElement {
  const wrap = h('div', { class: 'seg kind-switch', role: 'group', 'aria-label': 'Show' });
  const mk = (k: 'ships' | 'vehicles', label: string, go: () => void) => {
    const b = h('button', { 'aria-pressed': String(on === k) }, label);
    b.onclick = () => {
      if (on === k) return;
      click();
      go();
    };
    return b;
  };
  wrap.append(mk('ships', 'Ships', ships), mk('vehicles', 'Vehicles', vehicles));
  return wrap;
}
