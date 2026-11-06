import { contactVisible } from '../core/Targeting';
import type { Ship } from '../ships/Ship';
import { FAULTLINE } from '../skills/misc/FaultlineRuntime';
import { cookerDamage, FLAVOURS, GOURMAND, nextFlavour, pantryCapacity, pantryTotal, spend, type Flavour } from '../skills/misc/GourmandRuntime';
import { burnRate, dollOf, HEX, pinCharges, type Doll } from '../skills/misc/HexweaverRuntime';
import { brokeRecently, inContempt, inCourt, JUDGE, LAW_LABELS, LAW_LIMITS, LAW_OFFENCES, LAWS, violationCount, type Law } from '../skills/misc/JudgeRuntime';
import type { MiscTitanEvent } from '../skills/misc/MiscEvents';

// What the HUD shows for the four misc titans, as plain data the DOM layer only copies out. Pure
// functions of the game state, so they are tested without a document.

/** What the HUD calls each pantry jar and the salvo flavour it gives. */
export const FLAVOUR_LABELS: Record<Flavour, string> = { shells: 'SHELL', explosives: 'EXPLOSIVE', wreckage: 'SCRAP' };

/** What each flavour does to a salvo, for the next-flavour chip. */
const FLAVOUR_EFFECTS: Record<Flavour, string> = {
  shells: '+40% damage, pierces',
  explosives: 'wider splash, sets fire',
  wreckage: 'shrapnel ring, knockback',
};

/** The Gourmand's own panel. */
export interface GourmandPanel {
  jars: { kind: Flavour; label: string; n: number }[];
  /** What the pantry holds at most now (more during Banquet). */
  cap: number;
  next: { kind: Flavour | null; label: string; effect: string };
  /** What the Pressure Cooker would deal at its centre, and what Comfort Food would heal and shield. */
  previews: { cooker: number; heal: number; shield: number };
  /** The ship being digested, and the seconds it has left inside. */
  digest: { name: string; left: number; frac: number } | null;
  /** Seconds of Banquet and of Devour's open mouth left; 0 when off. */
  banquet: number;
  mouth: number;
}

export function gourmandPanel(me: Ship): GourmandPanel {
  const a = me.gourmand!;
  const now = me.game.time;
  const p = a.pantry;
  const next = nextFlavour(p);
  const pot = spend({ ...p }, GOURMAND.cooker.max);
  const n = pantryTotal(p);
  const C = GOURMAND.comfort;
  const w = a.swallow;
  const victim = w ? me.game.ships.find((v) => v.id === w.target) : undefined;
  return {
    jars: FLAVOURS.map((kind) => ({ kind, label: FLAVOUR_LABELS[kind], n: p[kind] })),
    cap: pantryCapacity(me),
    next: { kind: next, label: next ? FLAVOUR_LABELS[next] : 'PLAIN', effect: next ? FLAVOUR_EFFECTS[next] : 'no flavour: stock the pantry' },
    previews: {
      cooker: (cookerDamage(pot) + pot.shells * GOURMAND.cooker.focus) * me.mods.damageMul,
      heal: me.maxHp * C.heal + n * C.perHeal,
      shield: C.shield + n * C.perShield,
    },
    digest: w && victim ? { name: victim.name, left: Math.max(0, w.until - now), frac: Math.max(0, Math.min(1, (w.until - now) / GOURMAND.swallow.time)) } : null,
    banquet: Math.max(0, a.banquetUntil - now),
    mouth: Math.max(0, a.mouthUntil - now),
  };
}

/** The Faultline's own panel. */
export interface FaultlinePanel {
  /** Stored pressure, 0 to `max`; hot from 80, when the gauge glows and shakes. */
  pressure: number;
  max: number;
  hot: boolean;
  /** What Caldera would deal now, spending all of it. */
  caldera: number;
  /** One pip per living fracture and per own ridge: the share of its life left, oldest first. */
  fractures: number[];
  ridges: number[];
  maxFractures: number;
  maxRidges: number;
  /** Seconds of Bedrock's brace left; 0 when off. */
  bedrock: number;
}

export function faultlinePanel(me: Ship): FaultlinePanel {
  const a = me.faultline!;
  const now = me.game.time;
  const life = (until: number, span: number) => Math.max(0, Math.min(1, (until - now) / span));
  const C = FAULTLINE.caldera;
  return {
    pressure: a.pressure,
    max: FAULTLINE.maxPressure,
    hot: a.pressure >= 80,
    caldera: (C.damage + a.pressure * C.perPressure) * me.mods.damageMul * me.mods.ultDamageMul,
    fractures: a.fractures.map((f) => life(f.expiresAt, FAULTLINE.fractureLife)),
    ridges: me.game.map.dynamicRidges.filter((r) => r.owner === me.id).map((r) => life(r.expiresAt, FAULTLINE.ridgeLife)),
    maxFractures: FAULTLINE.maxFractures,
    maxRidges: FAULTLINE.maxRidges,
    bedrock: Math.max(0, a.bedrockUntil - now),
  };
}

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
  /** The three biggest open cases on ships the Judge can see. */
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
      .map((c) => ({ c, ship: me.game.ships.find((s) => s.id === c.target) }))
      .filter(({ c, ship }) => c.stacks > 0 && !!ship && contactVisible(ship, me.team))
      .sort((x, y) => y.c.stacks - x.c.stacks || x.c.target - y.c.target)
      .slice(0, 3)
      .map(({ c, ship }) => ({ name: ship!.name, n: c.stacks })),
  };
}

/** One doll on the Hexweaver's shelf. */
export interface DollSlot {
  target: number;
  /** Whether the Hexweaver can see the doll's ship; a hidden ship's name and health are withheld. */
  seen: boolean;
  name: string;
  /** Its ship's health, 0–1; 0 while it is hidden. */
  hp: number;
  pins: number;
  /** Needle hits toward the next free pin, of `HEX.pricks`. */
  pricks: number;
  /** The doll's remaining life, 0–1. */
  life: number;
  burning: boolean;
  stitched: boolean;
  aimed: boolean;
  /** 1 the moment its ship is hurt by the Hexweaver, fading to 0. */
  flinch: number;
  /** 1 the moment it is twisted, fading to 0. */
  twist: number;
  /** 1 the moment a pin goes in, fading to 0. */
  stab: number;
}

/** The Hexweaver's own panel. */
export interface HexPanel {
  /** One pip per Pin charge: 1 ready, else how far it has recovered. */
  pins: number[];
  slots: DollSlot[];
  /** Pairs of shelf slots stitched together. */
  links: [number, number][];
  /** What Twist, Rip the Seam and Effigy Unmaking would deal the aimed doll now. */
  previews: { twist: number; rip: number; unmaking: number } | null;
}

const fade = (since: number, time: number): number => Math.max(0, Math.min(1, 1 - since / time));

export function hexPanel(me: Ship, target: Ship | null): HexPanel {
  const a = me.hexweaver!;
  const now = me.game.time;
  const spent = a.recharge.filter((r) => r > now + 1e-8).sort((x, y) => x - y);
  const pins = [...Array<number>(HEX.pin.charges - spent.length).fill(1), ...spent.map((r) => 1 - (r - now) / HEX.pin.recharge)];
  const slots: DollSlot[] = [];
  for (const d of a.dolls) {
    const t = me.game.ships.find((v) => v.id === d.target);
    if (!t) continue;
    const seen = contactVisible(t, me.team);
    slots.push({
      target: d.target,
      seen,
      name: seen ? t.name : 'Lost contact',
      hp: seen && t.maxHp > 0 ? Math.max(0, t.hp / t.maxHp) : 0,
      pins: d.pins,
      pricks: d.pricks,
      life: Math.max(0, Math.min(1, (d.until - now) / HEX.pin.life)),
      burning: d.burnUntil > now,
      stitched: d.stitchedUntil > now,
      aimed: !!target && target.id === d.target,
      flinch: fade(now - d.struck, 0.4),
      twist: fade(now - d.twistedAt, 0.8),
      stab: fade(now - d.pinnedAt, 0.5),
    });
  }
  const links: [number, number][] = [];
  for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) if (slots[i].stitched && slots[j].stitched) links.push([i, j]);
  const t = target && target.team !== me.team && target.alive ? target : null;
  const d = t ? dollOf(me, t) : undefined;
  return { pins, slots, links, previews: t ? hexPreviews(me, d, now) : null };
}

function hexPreviews(me: Ship, d: Doll | undefined, now: number): HexPanel['previews'] {
  const n = d?.pins ?? 0;
  const mul = me.mods.damageMul;
  return {
    twist: (HEX.twist.damage + n * HEX.twist.perPin + (n > 0 ? HEX.twist.consume : 0)) * mul,
    rip: (HEX.rip.damage + (d ? Math.max(0, d.burnUntil - now) * burnRate(d) : 0) + n * HEX.rip.perPin) * mul,
    unmaking: (HEX.unmaking.damage + n * HEX.unmaking.perPin) * mul * me.mods.ultDamageMul,
  };
}

/** A citation popup: `+n label` over `target`, merged by `key` while the same law keeps breaking. */
export interface CitePopup {
  target: Ship;
  key: string;
  label: string;
  n: number;
}

/**
 * The popup `viewer` sees for a Judge's `cite` event: only its victim and the Judge itself see one,
 * and the Judge only over a ship it can see.
 */
export function judgeCitePopup(viewer: Ship, e: MiscTitanEvent): CitePopup | null {
  if (e.kind !== 'cite' || !e.target || !e.n) return null;
  if (viewer !== e.target && viewer !== e.ship && viewer !== e.ship.summonOwner) return null;
  if (viewer !== e.target && !contactVisible(e.target, viewer.team)) return null;
  const law = e.law !== undefined && e.law >= 0 ? LAWS[e.law] : null;
  return { target: e.target, key: `cite:${law ?? 'any'}`, label: law ? LAW_OFFENCES[law] : 'CITED', n: e.n };
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
    const pins = a.dolls.reduce((n, d) => n + d.pins, 0);
    return `PINS ${pinCharges(me)}/${HEX.pin.charges}${next} · DOLLS ${a.dolls.length}/${HEX.dolls} · ${pins} pins bound`;
  }
  if (me.gourmand) {
    const a = me.gourmand;
    const p = a.pantry;
    const next = nextFlavour(p);
    const digest = a.swallow ? ` · DIGESTING ${Math.ceil(a.swallow.until - now)}s` : '';
    return `PANTRY · Shell ${p.shells} · Explosive ${p.explosives} · Scrap ${p.wreckage} / ${pantryCapacity(me)} · NEXT ${next ? FLAVOUR_LABELS[next] : 'PLAIN'}${digest}`;
  }
  if (me.faultline) {
    const a = me.faultline;
    const bedrock = a.bedrockUntil > now ? ` · BEDROCK ${Math.ceil(a.bedrockUntil - now)}s` : '';
    return `PRESSURE ${Math.round(a.pressure)}/${FAULTLINE.maxPressure} · FRACTURES ${a.fractures.length}/${FAULTLINE.maxFractures} · RIDGES ${me.game.map.dynamicRidges.filter((r) => r.owner === me.id).length}/${FAULTLINE.maxRidges}${bedrock}`;
  }
  return '';
}

/** The chip `viewer` sees on `s`'s marker; null when no misc titan holds it. */
export function miscMarkerChip(viewer: Ship, s: Ship): MiscChip | null {
  if (s.team === viewer.team) return null;
  const meal = gourmandHold(s, (g) => g.team === viewer.team);
  if (meal) return { kind: 'gourmand', text: meal.hold === 'swallow' ? 'SWALLOWED' : meal.hold === 'bite' ? 'BITE' : 'SKEWERED', alert: meal.hold !== 'reel' };
  let cases = 0;
  for (const j of viewer.game.ships) if (j.judge && j.alive && j.team === viewer.team) cases = Math.max(cases, violationCount(j, s));
  if (cases > 0) return { kind: 'judge', text: `⚖ ${cases}`, alert: cases >= JUDGE.death };
  let doll: Doll | undefined;
  for (const h of viewer.game.ships) {
    if (!h.hexweaver || !h.alive || h.team !== viewer.team) continue;
    const d = dollOf(h, s);
    if (d && (!doll || d.pins > doll.pins)) doll = d;
  }
  if (doll) return { kind: 'hexweaver', text: `✂ ${doll.pins}`, alert: doll.pins >= HEX.pin.max || doll.burnUntil > viewer.game.time };
  return null;
}

/** The banner `me` sees while an enemy misc titan holds it; null when none does. */
export function miscVictimBanner(me: Ship): MiscBanner | null {
  return gourmandBanner(me) ?? judgeBanner(me) ?? hexBanner(me);
}

/** A Gourmand on a side `side` accepts holding `s`: swallowed, under a bite warning, or skewered. */
function gourmandHold(s: Ship, side: (g: Ship) => boolean): { gourmand: Ship; hold: 'swallow' | 'bite' | 'reel' } | null {
  let found: { gourmand: Ship; hold: 'swallow' | 'bite' | 'reel' } | null = null;
  for (const g of s.game.ships) {
    const a = g.gourmand;
    if (!a || !g.alive || !side(g)) continue;
    if (a.swallow?.target === s.id) return { gourmand: g, hold: 'swallow' };
    if (a.bite?.target === s.id) found = { gourmand: g, hold: 'bite' };
    else if (a.reel?.target === s.id && !found) found = { gourmand: g, hold: 'reel' };
  }
  return found;
}

function gourmandBanner(me: Ship): MiscBanner | null {
  const meal = gourmandHold(me, (g) => g.team !== me.team);
  if (!meal) return null;
  const a = meal.gourmand.gourmand!;
  const now = me.game.time;
  if (meal.hold === 'swallow') {
    const left = Math.max(0, a.swallow!.until - now);
    return { kind: 'gourmand', title: `Swallowed ${left.toFixed(1)} s`, detail: `Digesting ${GOURMAND.swallow.digest / 1000}k/s · defensive skills still work`, alert: true };
  }
  if (meal.hold === 'bite') {
    const left = Math.max(0, a.bite!.at - now);
    return { kind: 'gourmand', title: 'Bite incoming – move!', detail: `Leave the circle within ${left.toFixed(1)} s`, alert: true };
  }
  return { kind: 'gourmand', title: 'Skewered', detail: 'Being reeled into the mouth: land blocks the pull', alert: false };
}

/** The enemy Hexweaver with the most pins in `me`'s doll. */
function hexBanner(me: Ship): MiscBanner | null {
  const now = me.game.time;
  let doll: Doll | undefined;
  for (const h of me.game.ships) {
    if (!h.hexweaver || !h.alive || h.team === me.team) continue;
    const d = dollOf(h, me);
    if (d && (!doll || d.pins > doll.pins)) doll = d;
  }
  if (!doll) return null;
  const stitched = doll.stitchedUntil > now;
  const burning = doll.burnUntil > now;
  const parts = [`${doll.pins} ${doll.pins === 1 ? 'pin' : 'pins'}: +${Math.round(doll.pins * HEX.pinBonus * 100)}% damage from the Hexweaver`];
  if (stitched) parts.push('STITCHED: shares the pain of other dolls');
  if (burning) parts.push(`BURNING ${Math.ceil(doll.burnUntil - now)}s`);
  return {
    kind: 'hexweaver',
    title: 'Hexed',
    detail: parts.join(' · '),
    alert: doll.pins >= HEX.pin.max || burning,
    meter: { n: doll.pins, cap: HEX.pin.max, mark: HEX.pin.max },
  };
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
