import type { Ship } from '../ships/Ship';
import { pinCharges } from '../skills/misc/HexweaverRuntime';
import { brokeRecently, inContempt, inCourt, JUDGE, LAW_LABELS, LAW_LIMITS, LAWS, violationCount, type Law } from '../skills/misc/JudgeRuntime';

// What the HUD shows for the four misc titans, as plain data the DOM layer only copies out. Pure
// functions of the game state, so they are tested without a document.

/** Which misc titan `s` is, or null. */
export type MiscTitanKind = 'judge' | 'hexweaver' | 'gourmand' | 'faultline';

export function miscTitanKind(s: Ship): MiscTitanKind | null {
  return s.judge ? 'judge' : s.hexweaver ? 'hexweaver' : s.gourmand ? 'gourmand' : s.faultline ? 'faultline' : null;
}

/** A small badge on another ship's marker: a misc titan's hold on it. */
export interface MiscChip {
  text: string;
  /** Marks a chip that needs acting on now (a full case, a pending bite). */
  alert: boolean;
  kind: MiscTitanKind;
}

/** One of the Judge's laws as a HUD shows it. */
export interface LawView {
  id: Law;
  label: string;
  limit: string;
  /** Broken in the last moments. */
  broken: boolean;
}

/** A banner on the HUD of a ship an enemy misc titan has a hold on. */
export interface MiscBanner {
  title: string;
  detail: string;
  alert: boolean;
  kind: MiscTitanKind;
  /** The Judge's laws, lit where the victim is breaking them. */
  laws?: LawView[];
  /** A filling meter: `n` of `cap`, with a notch at `mark`. */
  meter?: { n: number; cap: number; mark: number };
}

/** The Judge's own panel, aimed at a target. */
export interface JudgePanel {
  court: 'ACTIVE' | 'UNPLACED';
  /** Seconds of Martial Law left; 0 when it is off. */
  martial: number;
  laws: LawView[];
  case: { n: number; cap: number; death: number } | null;
  /** Seconds the target has left in contempt. */
  contempt: number;
  /** What Gavel, Taxes and the Verdict would deal the target now. */
  previews: { gavel: number; taxes: number; verdict: number };
  deathReady: boolean;
  /** The three biggest open cases. */
  top: { name: string; n: number }[];
}

function lawViews(j: Ship, t: Ship | null): LawView[] {
  return LAWS.map((id) => ({ id, label: LAW_LABELS[id], limit: LAW_LIMITS[id], broken: !!t && brokeRecently(j, t, id) }));
}

export function judgePanel(me: Ship, target: Ship | null): JudgePanel {
  const a = me.judge!;
  const now = me.game.time;
  const t = target && target.team !== me.team && target.alive ? target : null;
  const n = t ? violationCount(me, t) : 0;
  const mul = me.mods.damageMul;
  const c = t ? a.cases.find((c) => c.target === t.id) : undefined;
  return {
    court: a.court ? 'ACTIVE' : 'UNPLACED',
    martial: Math.max(0, a.martialUntil - now),
    laws: lawViews(me, t),
    case: t ? { n, cap: JUDGE.cap, death: JUDGE.death } : null,
    contempt: c ? Math.max(0, c.contemptUntil - now) : 0,
    previews: {
      gavel: (JUDGE.gavel.damage + JUDGE.gavel.perViolation * n) * mul,
      taxes: (JUDGE.taxes.damage + JUDGE.taxes.perViolation * n) * mul,
      verdict: (JUDGE.verdict.damage + JUDGE.verdict.perViolation * n) * mul,
    },
    deathReady: !!t && n >= JUDGE.death,
    top: a.cases
      .filter((c) => c.stacks > 0)
      .sort((x, y) => y.stacks - x.stacks || x.target - y.target)
      .slice(0, 3)
      .map((c) => ({ name: me.game.ships.find((s) => s.id === c.target)?.name ?? '?', n: c.stacks })),
  };
}

/** One line naming a misc titan's own resources, aimed at `target`; '' for every other ship. */
export function miscTitanSummary(me: Ship, target: Ship | null): string {
  const now = me.game.time;
  if (me.judge) {
    const a = me.judge;
    const martial = a.martialUntil > now ? ` · MARTIAL LAW ${Math.ceil(a.martialUntil - now)}s` : '';
    const aimed = target && target.team !== me.team ? ` · ${target.name}: ${violationCount(me, target)}/${JUDGE.cap} violations` : '';
    return `COURT ${a.court ? 'ACTIVE' : 'UNPLACED'}${martial}${aimed}`;
  }
  if (me.hexweaver) {
    const a = me.hexweaver;
    const next = a.recharge.length ? ` · next ${Math.max(0, Math.min(...a.recharge) - now).toFixed(1)}s` : '';
    const dolls = a.dolls.map((d) => {
      const t = me.game.ships.find((t) => t.id === d.target);
      return `${t?.name ?? 'Doll'} ${d.pins} pins${d.stitchedUntil > now ? ' ↔' : ''}${d.burnUntil > now ? ' ♨' : ''}`;
    });
    return `PINS ${pinCharges(me)}/4${next} · DOLLS ${a.dolls.length}/4 · ${dolls.join(' · ')}`;
  }
  if (me.gourmand) {
    const a = me.gourmand;
    const p = a.pantry;
    const meal = a.cooked ? ` · MEAL READY ${Math.ceil(a.cooked.until - now)}s` : '';
    const digest = a.swallow ? ` · DIGESTING ${Math.ceil(a.swallow.until - now)}s` : '';
    return `PANTRY · Shell ${p.shells} · Explosive ${p.explosives} · Scrap ${p.wreckage} / ${a.banquetUntil > now ? 30 : 18}${meal}${digest}`;
  }
  if (me.faultline) {
    const a = me.faultline;
    return `PRESSURE ${Math.round(a.pressure)} · FRACTURES ${a.fractures.length} · RIDGES ${me.game.map.dynamicRidges.filter((r) => r.owner === me.id).length}/6`;
  }
  return '';
}

/** The chip `viewer` sees on `s`'s marker; null when no misc titan holds it. */
export function miscMarkerChip(viewer: Ship, s: Ship): MiscChip | null {
  if (s.team === viewer.team) return null;
  let cases = 0;
  for (const j of viewer.game.ships) if (j.judge && j.alive && j.team === viewer.team) cases = Math.max(cases, violationCount(j, s));
  if (cases > 0) return { kind: 'judge', text: `⚖ ${cases}`, alert: cases >= JUDGE.death };
  return null;
}

/** The banner `me` sees while an enemy misc titan holds it; null when none does. */
export function miscVictimBanner(me: Ship): MiscBanner | null {
  return judgeBanner(me);
}

/** The enemy Judge whose court holds `me`, or else the one with the biggest case on it. */
function judgeBanner(me: Ship): MiscBanner | null {
  let judge: Ship | null = null;
  let best = -1;
  for (const j of me.game.ships) {
    if (!j.judge || !j.alive || j.team === me.team) continue;
    const rank = (inCourt(j, me) ? 1000 : 0) + violationCount(j, me);
    if (rank > best && rank > 0) {
      best = rank;
      judge = j;
    }
  }
  if (!judge) return null;
  const n = violationCount(judge, me);
  const inside = inCourt(judge, me);
  const contempt = inContempt(judge, me);
  return {
    kind: 'judge',
    title: inside ? 'Court of the Judge' : 'Case open',
    detail: contempt ? 'IN CONTEMPT: violations count triple' : n >= JUDGE.death ? 'DEATH PENALTY ELIGIBLE' : inside ? 'Obey every law to stop your case growing' : 'Stay out of court for 5 s to let it fade',
    alert: contempt || n >= JUDGE.death,
    laws: lawViews(judge, me),
    meter: { n, cap: JUDGE.cap, mark: JUDGE.death },
  };
}
