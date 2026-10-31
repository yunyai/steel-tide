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
  kinetic: `The cube leaps to the nearest enemy within ${km(SIGNATURE.ricochet.reach)}, then on to the next within ${km(SIGNATURE.ricochet.hop)}: ${SIGNATURE.ricochet.bounces} hulls, ${k(SIGNATURE.ricochet.damage)} each, every leg ${Math.round((SIGNATURE.ricochet.gain - 1) * 100)}% faster.`,
  crush: `The cube leaps onto the enemy nearest the reticle within ${km(TUNGSTEN_MODES[1].signature.radius)}: ${k(SIGNATURE.pile.damage)}, a ${SIGNATURE.pile.stun} s stun, and it holds the hull still for ${SIGNATURE.pile.root} s before dropping beside it.`,
  shard: `${SIGNATURE.cone.shards} shards fan ${SIGNATURE.cone.spread}° toward the reticle, out to ${km(SIGNATURE.cone.range)}: each strikes the first enemy hull in its way for ${k(SIGNATURE.cone.damage)}.`,
  repel: `The magnet throws the ship ${km(SIGNATURE.dash.distance)} away from the cube (toward the reticle if it is docked), through any hull in the way for ${k(SIGNATURE.dash.damage)}; it takes ${Math.round((1 - CUBE.lunge.taken) * 100)}% less damage on the way.`,
  tether: `The two enemies nearest the cube within ${km(TUNGSTEN_MODES[4].signature.radius)} are reeled into each other over ${SIGNATURE.collide.time} s: ${k(SIGNATURE.collide.damage)} each and a ${SIGNATURE.collide.stun} s stun. A lone hull is reeled into the cube.`,
  mend: `A ${km(TUNGSTEN_MODES[5].signature.radius)} dome at the cube for ${SIGNATURE.sanctuary.time} s: allies inside heal ${SIGNATURE.sanctuary.heal * 100}% a second and take ${Math.round((1 - SIGNATURE.sanctuary.taken) * 100)}% less damage.`,
};

const G = CUBE.guard;
/** The Shield outside Overdrive, with the capture reach of the mode. */
const shieldText = (reach: number) =>
  `The cube guards the reticle side for ${G.time} s, capturing fire within ${reach} m into a store of up to ${CUBE.chargeCap / 1e6}M that rides the next cube hit. Hulls it touches take ${k(G.damage)} plus ${Math.round(G.store * 100)}% of the store.`;

/** The guide's opening line. */
export const CODEX_NOTE =
  'Switch cycles the cube through six modes. Each changes what a throw does to a hull, the passive the ship carries, the Signature, the Die face, the Collapse and the Meteor. The Loaded Die keeps the cube on the mode it rolls. Overdrive runs all six at once.';

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
      { label: 'Die face', text: `${m.die} Rolled on a ${m.name} cube, it fires every face.` },
      { label: 'Collapse', text: m.collapse },
      { label: 'Meteor', text: m.meteor },
      { label: 'Shield', text: shieldText(m.id === 'repel' ? G.repelRadius : G.radius) },
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
      { label: 'Cubes', text: `For ${CUBE.overdrive.time} s five more cubes leave the magnet, one in each other mode. All six float as equals in a halo round the ship, and the dais stands empty.` },
      { label: 'Throw', text: `Throws are free and hurl all six abreast, ${CUBE.shot.spread} m apart, each with its own mode's hit.` },
      { label: 'Passive', text: "Every mode's passive is live at once." },
      { label: 'Signature', text: "Every cube fires its own mode's Signature from where it is." },
      { label: 'Die', text: `All six roll, landing in a ${CUBE.die.ring} m ring round the reticle; each keeps its own mode and rolls its own face.` },
      { label: 'Shield', text: `All six orbit the ship for ${O.time} s, each capturing fire and battering hulls for ${k(O.damage)} plus ${Math.round(O.store * 100)}% of the store. The ship takes ${Math.round((1 - O.taken) * 100)}% less damage and the store holds ${(CUBE.chargeCap * O.cap) / 1e6}M.` },
      { label: 'Collapse', text: `The six merge into one rainbow singularity, ${CUBE.collapse.merged}x as strong and ${CUBE.collapse.mergedRadius}x as wide, with every mode's twist.` },
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
    h('p', { class: 'arsenal-note' }, CODEX_NOTE),
    chips,
    detail,
  );
  show(0);
  return root;
}
