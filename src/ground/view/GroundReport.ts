import type { Team } from '../../core/types';
import { countUp, type ReportActions } from '../../ui/Results';
import type { GroundGame } from '../sim/GroundGame';
import { CLASS_NAME } from '../sim/types';
import type { Vehicle } from '../sim/Vehicle';
import { vehicleName } from './GroundHUD';

// A ground battle's report and Tab scoreboard, in the naval sheets' look: the verdict, your own
// numbers, the most valuable vehicle and both sides' tables.

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', `btn ${cls}`, label);
  b.onclick = onClick;
  return b;
}

const respawning = (game: GroundGame) => game.config.type === 'domination' || game.config.type === 'freeplay';

function teamTable(game: GroundGame, team: Team, ally: boolean, me: Vehicle | null): HTMLElement {
  const wrap = el('div');
  wrap.append(el('h4', ally ? 'a' : 'e', ally ? 'Your side' : 'Enemy side'));
  const t = el('table');
  const head = el('tr');
  const deaths = respawning(game);
  head.append(el('th', '', 'Vehicle'), el('th', '', 'Class'), el('th', 'r', 'Damage'), el('th', 'r', 'Kills'));
  if (deaths) head.append(el('th', 'r', 'Deaths'));
  t.append(head);
  const list = game.fleet.filter((v) => v.team === team).sort((a, b) => b.stats.damage - a.stats.damage);
  for (const v of list) {
    const tr = el('tr', `${v === me ? 'you' : v.humanIndex >= 0 ? 'friend' : ''}${v.alive ? '' : ' sunk'}`.trim());
    tr.append(el('td', '', vehicleName(v, me)), el('td', '', CLASS_NAME[v.spec.cls]), el('td', 'r', Math.round(v.stats.damage).toLocaleString()), el('td', 'r', String(v.stats.kills)));
    if (deaths) tr.append(el('td', 'r', String(v.stats.deaths)));
    t.append(tr);
  }
  wrap.append(t);
  return wrap;
}

function tables(game: GroundGame, team: Team, me: Vehicle | null): HTMLElement {
  const cols = el('div', 'report-cols');
  cols.append(teamTable(game, team, true, me), teamTable(game, team === 0 ? 1 : 0, false, me));
  return cols;
}

function personal(v: Vehicle): HTMLElement {
  const row = el('div', 'personal');
  const s = v.stats;
  const int = (n: number) => Math.round(n).toLocaleString();
  const stat = (name: string, value: number, format: (n: number) => string = int, hi = false) => {
    const d = el('div', hi ? 'hi' : '', name);
    const b = el('b', 'num');
    d.prepend(b);
    row.append(d);
    countUp(b, value, format);
  };
  stat('Damage dealt', s.damage, int, true);
  stat('Skill damage', s.skill, int, true);
  stat('Vehicles destroyed', s.kills);
  if (respawning(v.game)) stat('Times destroyed', s.deaths);
  stat('Penetrations', s.pens);
  stat('Crits', s.crits);
  stat('Hit rate', s.shots ? (s.hits / s.shots) * 100 : 0, (n) => `${Math.round(n)}%`);
  stat('Blocked by armour', s.blocked);
  if (s.healed > 0) stat('Repaired for allies', s.healed);
  if (s.props > 0) stat('Buildings levelled', s.props);
  return row;
}

function mvp(game: GroundGame, me: Vehicle | null, viewTeam: Team): HTMLElement | null {
  const best = [...game.fleet].filter((v) => !v.isSummon).sort((a, b) => b.stats.damage - a.stats.damage)[0];
  if (!best || best.stats.damage <= 0) return null;
  const p = el('p', 'mvp', 'Most valuable vehicle: ');
  p.append(el('b', '', vehicleName(best, me)), ` on ${best.team === viewTeam ? 'your' : 'the enemy'} side, ${Math.round(best.stats.damage).toLocaleString()} damage and ${best.stats.kills} ${best.stats.kills === 1 ? 'kill' : 'kills'}.`);
  return p;
}

export function buildGroundReport(game: GroundGame, humans: Vehicle[], actions: ReportActions): HTMLElement {
  const overlay = el('div', 'overlay');
  const sheet = el('div', 'sheet panel report');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Battle report');
  const me = humans[0];
  const viewTeam = me?.team ?? 0;
  const verdict = el('h2', 'verdict');
  if (game.config.type === 'freeplay') verdict.textContent = 'Free play over';
  else if (game.winner === -1) verdict.textContent = 'Draw';
  else {
    const won = game.winner === viewTeam;
    verdict.textContent = won ? 'Victory' : 'Defeat';
    verdict.classList.add(won ? 'win' : 'loss');
  }
  sheet.append(verdict, el('p', 'reason', game.reason));
  if (game.config.type === 'freeplay') {
    const enemy: Team = viewTeam === 0 ? 1 : 0;
    const n = (k: number) => `${k} ${k === 1 ? 'vehicle' : 'vehicles'}`;
    sheet.append(el('p', 'reason', `Your side destroyed ${n(game.score[viewTeam])}; the enemy destroyed ${n(game.score[enemy])}.`));
  }
  if (me) sheet.append(personal(me));
  const best = mvp(game, me ?? null, viewTeam);
  if (best) sheet.append(best);
  sheet.append(tables(game, viewTeam, me ?? null));
  const row = el('div', 'sheet-actions');
  let primary: HTMLButtonElement;
  if ('lobby' in actions) {
    primary = button('Back to lobby', 'btn-primary', actions.lobby);
    row.append(button('Leave lobby', 'btn-quiet', actions.leave), primary);
  } else {
    primary = button('Play again', 'btn-primary', actions.again);
    row.append(button('Main menu', 'btn-quiet', actions.menu), button('Change vehicle', 'btn-quiet', actions.ships), primary);
  }
  sheet.append(row);
  overlay.append(sheet);
  queueMicrotask(() => primary.focus({ preventScroll: true }));
  return overlay;
}

/** Tab-held scoreboard: the report's tables, no verdict or actions. */
export function buildGroundScoreboard(game: GroundGame, me: Vehicle): HTMLElement {
  const overlay = el('div', 'overlay');
  overlay.style.pointerEvents = 'none';
  overlay.style.background = 'rgba(8, 14, 19, 0.35)';
  const sheet = el('div', 'sheet panel report');
  sheet.append(tables(game, me.team, me));
  overlay.append(sheet);
  return overlay;
}
