import { CUBE, SIGNATURE, TUNGSTEN_MODES, type TungstenModeId } from '../skills/misc/TungstenModes';
import { h } from './dom';

export interface CodexRow {
  label: string;
  text: string;
}

/** One tab of the Tungsten's mode guide: a mode, or Overdrive. */
export interface CodexTab {
  id: TungstenModeId | 'overdrive';
  name: string;
  short: string;
  color: string;
  /** Overdrive's chip cycles through every mode colour. */
  rainbow: boolean;
  rows: CodexRow[];
}

const css = (color: number) => `#${color.toString(16).padStart(6, '0')}`;
const k = (v: number) => `${v / 1000}k`;
const km = (v: number) => `${v / 1000} km`;

/** Each mode's Signature (Z), with its real numbers. */
const SIGNATURE_TEXT: Record<TungstenModeId, string> = {
  kinetic: `The cube leaps to the nearest enemy within ${km(SIGNATURE.ricochet.reach)}, then on to the next within ${km(SIGNATURE.ricochet.hop)}: ${SIGNATURE.ricochet.bounces} hulls, ${k(SIGNATURE.ricochet.damage)} each.`,
  crush: `After ${SIGNATURE.slam.time} s the cube slams down: ${k(SIGNATURE.slam.damage)} and a ${SIGNATURE.slam.stun} s stun to every enemy within ${TUNGSTEN_MODES[1].signature.radius} m.`,
  shard: `${k(SIGNATURE.storm.damage)} to every enemy within ${TUNGSTEN_MODES[2].signature.radius} m of the cube, knocking out ${SIGNATURE.storm.turrets} turrets each for ${SIGNATURE.storm.out} s.`,
  repel: `${k(SIGNATURE.repulse.damage)} to enemies within ${TUNGSTEN_MODES[3].signature.radius} m, hurled ${SIGNATURE.repulse.knock} m away; shells, missiles and torpedoes there are torn apart.`,
  tether: `Drags every enemy within ${km(TUNGSTEN_MODES[4].signature.radius)} to the cube over ${SIGNATURE.reel.time} s, then ${k(SIGNATURE.reel.damage)} each.`,
  mend: `Heals allies within ${km(TUNGSTEN_MODES[5].signature.radius)} of the cube ${SIGNATURE.restore.allies * 100}% and the ship ${SIGNATURE.restore.ship * 100}%.`,
};

/** The mode guide as data: six mode tabs, then Overdrive. */
export function tungstenCodexEntries(): CodexTab[] {
  const modes: CodexTab[] = TUNGSTEN_MODES.map((m) => ({
    id: m.id,
    name: m.name,
    short: m.short,
    color: css(m.color),
    rainbow: false,
    rows: [
      { label: 'Throw', text: m.hit },
      { label: 'Passive', text: m.passive },
      { label: `Signature · ${m.signature.name}`, text: SIGNATURE_TEXT[m.id] },
      { label: 'Meteor', text: m.meteor },
    ],
  }));
  const O = CUBE.orbit;
  const overdrive: CodexTab = {
    id: 'overdrive',
    name: 'Overdrive',
    short: 'ALL',
    color: '#f4f8ff',
    rainbow: true,
    rows: [
      { label: 'Cubes', text: `For ${CUBE.overdrive.time} s five more cubes leave the magnet, one in each other mode, and wheel round the dais.` },
      { label: 'Throw', text: `Throws are free and hurl all six abreast, ${CUBE.shot.spread} m apart, each with its own mode's hit.` },
      { label: 'Passive', text: "Every mode's passive is live at once." },
      { label: 'Signature', text: "Every cube fires its own mode's Signature from where it is." },
      { label: 'Shield', text: `All six orbit the ship for ${O.time} s, each capturing fire and battering hulls for ${k(O.damage)} plus ${Math.round(O.store * 100)}% of the store. The ship takes ${Math.round((1 - O.taken) * 100)}% less damage and the store holds ${(CUBE.chargeCap * O.cap) / 1e6}M.` },
      { label: 'Collapse', text: `The six merge into one rainbow singularity, ${CUBE.collapse.merged}x as strong and ${CUBE.collapse.mergedRadius}x as wide.` },
      { label: 'Meteor', text: `Six meteors fall in a ${CUBE.meteor.ring} m ring round the reticle, each in its own mode for ${CUBE.meteor.share * 100}% of the damage.` },
    ],
  };
  return [...modes, overdrive];
}

/** Firepower for the menu gauge: one throw per reload. */
export const cubeFirepower = () => (CUBE.shot.damage * 60) / CUBE.shot.reload;

/** The menu's loadout line for the cube. */
export const cubeLoadout = () =>
  `Cube: fire hurls it up to ${km(CUBE.shot.range)} through every hull for ${k(CUBE.shot.damage)}, every ${CUBE.shot.reload} s; ${1 / CUBE.shot.cost} throws to a full magnet`;

/** The interactive mode guide at the foot of the Tungsten's dossier. `click` plays the menu sound. */
export function tungstenCodex(click: () => void): HTMLElement {
  const tabs = tungstenCodexEntries();
  const root = h('section', { class: 'tungsten-codex', 'aria-label': 'Tungsten mode guide' });
  const chips = h('div', { class: 'codex-chips', role: 'group', 'aria-label': 'Modes' });
  const detail = h('div', { class: 'codex-detail', 'aria-live': 'polite' });
  const show = (i: number) => {
    const t = tabs[i];
    chips.querySelectorAll('button').forEach((b, j) => b.setAttribute('aria-pressed', String(j === i)));
    detail.style.setProperty('--type-color', t.color);
    detail.toggleAttribute('data-rainbow', t.rainbow);
    detail.replaceChildren(h('h4', {}, t.name), h('dl', {}, ...t.rows.flatMap((r) => [h('dt', {}, r.label), h('dd', {}, r.text)])));
  };
  tabs.forEach((t, i) => {
    const b = h('button', { type: 'button', class: 'codex-chip', 'aria-pressed': 'false' }, h('b', {}, h('span', {}, t.short)), h('small', {}, t.name));
    b.style.setProperty('--type-color', t.color);
    b.toggleAttribute('data-rainbow', t.rainbow);
    b.onclick = () => {
      click();
      show(i);
    };
    chips.append(b);
  });
  root.append(
    h('h3', {}, 'Mode guide'),
    h('p', { class: 'arsenal-note' }, "Switch cycles the cube through six modes. Each changes what a throw does to a hull, the passive the ship carries, the Signature and the Meteor. Overdrive runs all six at once."),
    chips,
    detail,
  );
  show(0);
  return root;
}
