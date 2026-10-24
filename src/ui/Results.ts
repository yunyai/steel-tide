import { CLASS_LABEL } from '../data/ships';
import type { Game } from '../core/Game';
import type { Team } from '../core/types';
import type { Ship } from '../ships/Ship';
import { captainName } from './names';

// End-of-battle report, the Tab scoreboard (same tables, no verdict) and the pause sheet.

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

function teamTable(game: Game, team: Team, ally: boolean, me: Ship | null, limit = Infinity): HTMLElement {
  const wrap = el('div');
  wrap.append(el('h4', ally ? 'a' : 'e', ally ? 'Your fleet' : 'Enemy fleet'));
  const t = el('table');
  const head = el('tr');
  // Only Domination brings ships back, so only there is a death count worth a column.
  const deaths = game.config.type === 'domination';
  head.append(el('th', '', 'Ship'), el('th', '', 'Class'), el('th', 'r', 'Damage'), el('th', 'r', 'Kills'));
  if (deaths) head.append(el('th', 'r', 'Deaths'));
  t.append(head);
  const ships = game.fleet
    .filter((s) => s.team === team)
    .sort((a, b) => b.stats.damage - a.stats.damage);
  for (const s of ships.slice(0, limit)) {
    const tr = el('tr', `${s === me ? 'you' : s.humanIndex >= 0 ? 'friend' : ''}${s.alive ? '' : ' sunk'}`.trim());
    tr.append(
      el('td', '', captainName(s, me)),
      el('td', '', CLASS_LABEL[s.spec.cls]),
      el('td', 'r', Math.round(s.stats.damage).toLocaleString()),
      el('td', 'r', String(s.stats.kills)),
    );
    if (deaths) tr.append(el('td', 'r', String(s.stats.deaths)));
    t.append(tr);
  }
  wrap.append(t);
  if (ships.length > limit) wrap.append(el('p', 'note', `and ${ships.length - limit} more`));
  return wrap;
}

function tables(game: Game, team: Team, me: Ship | null): HTMLElement {
  const cols = el('div', 'report-cols');
  const enemy: Team = team === 0 ? 1 : 0;
  // Boss Rush fleets grow wave after wave; list only the enemies that hurt the most.
  cols.append(teamTable(game, team, true, me), teamTable(game, enemy, false, me, game.rush ? 8 : Infinity));
  return cols;
}

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Count a number up from zero once the report is on screen. */
function countUp(b: HTMLElement, value: number, format: (n: number) => string): void {
  b.textContent = format(value);
  if (reduceMotion() || value <= 0) return;
  const t0 = performance.now() + 250;
  const dur = 1100;
  const tick = (now: number) => {
    const k = Math.min(1, Math.max(0, (now - t0) / dur));
    b.textContent = format(value * (1 - Math.pow(1 - k, 3)));
    if (k < 1 && b.isConnected) requestAnimationFrame(tick);
  };
  b.textContent = format(0);
  requestAnimationFrame(tick);
}

function personal(s: Ship): HTMLElement {
  const row = el('div', 'personal');
  const acc = s.stats.shotsFired ? Math.round((s.stats.hits / s.stats.shotsFired) * 100) : 0;
  const int = (n: number) => Math.round(n).toLocaleString();
  const stat = (name: string, value: number, format: (n: number) => string = int, hi = false) => {
    const d = el('div', hi ? 'hi' : '', name);
    const b = el('b', 'num');
    d.prepend(b);
    row.append(d);
    countUp(b, value, format);
  };
  stat('Damage dealt', s.stats.damage, int, true);
  stat('Skill damage', s.stats.skill, int, true);
  stat('Ships sunk', s.stats.kills);
  if (s.game.config.type === 'domination') stat('Times sunk', s.stats.deaths);
  stat('Citadel hits', s.stats.citadels);
  stat('Fires set', s.stats.fires);
  stat('Accuracy', acc, (n) => `${Math.round(n)}%`);
  stat('Damage taken', s.stats.received);
  return row;
}

/** The ship with the most damage in the battle, either side. */
function mvp(game: Game, me: Ship | null, viewTeam: Team): HTMLElement | null {
  const best = [...game.fleet].filter((s) => !s.isSummon).sort((a, b) => b.stats.damage - a.stats.damage)[0];
  if (!best || best.stats.damage <= 0) return null;
  const p = el('p', 'mvp', 'Most valuable ship: ');
  p.append(el('b', '', captainName(best, me)), ` of ${best.team === viewTeam ? 'your' : 'the enemy'} fleet, ${Math.round(best.stats.damage).toLocaleString()} damage and ${best.stats.kills} ${best.stats.kills === 1 ? 'kill' : 'kills'}.`);
  return p;
}

export type ReportActions =
  | { again(): void; ships(): void; menu(): void }
  /** LAN: no rematch from here; the lobby decides what is next. */
  | { lobby(): void; leave(): void };

export function buildReport(game: Game, humans: Ship[], newBest: boolean, actions: ReportActions): HTMLElement {
  const overlay = el('div', 'overlay');
  const sheet = el('div', 'sheet panel report');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Battle report');
  const me = humans[0];
  const viewTeam = me?.team ?? 0;
  const rush = game.rush;
  const verdict = el('h2', 'verdict');
  if (rush) {
    verdict.textContent = rush.cleared ? `${rush.wave} waves survived` : `Wave ${rush.wave}`;
    verdict.classList.add(rush.cleared ? 'win' : 'rush');
    if (newBest) verdict.append(el('span', 'badge', 'New best'));
  } else if (game.winner === -1) {
    verdict.textContent = 'Draw';
  } else {
    const won = game.winner === viewTeam;
    verdict.textContent = won ? 'Victory' : 'Defeat';
    verdict.classList.add(won ? 'win' : 'loss');
  }
  sheet.append(verdict, el('p', 'reason', game.reason));
  if (rush) {
    const row = el('div', 'personal');
    const score = el('div', 'hi', 'Run score');
    const b = el('b', 'num');
    score.prepend(b);
    countUp(b, rush.total, (n) => Math.round(n).toLocaleString());
    const refits = el('div', '', 'Refits taken');
    refits.prepend(el('b', 'num', String(rush.taken.length)));
    row.append(score, refits);
    sheet.append(row);
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
    primary = button(rush ? 'Run again' : 'Play again', rush ? 'btn-amber' : 'btn-primary', actions.again);
    row.append(button('Main menu', 'btn-quiet', actions.menu), button('Change ship', 'btn-quiet', actions.ships), primary);
  }
  sheet.append(row);
  overlay.append(sheet);
  queueMicrotask(() => primary.focus({ preventScroll: true }));
  return overlay;
}

/** Tab-held scoreboard: same tables as the report, no verdict or actions. */
export function buildScoreboard(game: Game, me: Ship): HTMLElement {
  const overlay = el('div', 'overlay');
  overlay.style.pointerEvents = 'none';
  overlay.style.background = 'rgba(8, 14, 19, 0.35)';
  const sheet = el('div', 'sheet panel report');
  sheet.append(tables(game, me.team, me));
  overlay.append(sheet);
  return overlay;
}

export interface PauseActions {
  resume(): void;
  quit(): void;
}

/** The Esc sheet. Solo it freezes the battle; in a LAN battle (`title` "Battle menu") it does not. */
export function buildPause(actions: PauseActions, hint: string, title = 'Paused'): HTMLElement {
  const overlay = el('div', 'overlay');
  const sheet = el('div', 'sheet panel pause');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', title);
  sheet.append(el('h2', '', title), el('p', 'lede', hint));
  const row = el('div', 'row');
  const resume = button('Resume battle', 'btn-primary', actions.resume);
  row.append(resume, button('Leave battle', 'btn-quiet', actions.quit));
  sheet.append(row);
  overlay.append(sheet);
  queueMicrotask(() => resume.focus({ preventScroll: true }));
  return overlay;
}
