import type { Ship } from '../ships/Ship';
import { pinCharges } from '../skills/misc/HexweaverRuntime';
import { LAW_LABELS, violationCount } from '../skills/misc/JudgeRuntime';

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

/** A banner on the HUD of a ship an enemy misc titan has a hold on. */
export interface MiscBanner {
  title: string;
  detail: string;
  alert: boolean;
  kind: MiscTitanKind;
}

/** One line naming a misc titan's own resources, aimed at `target`; '' for every other ship. */
export function miscTitanSummary(me: Ship, target: Ship | null): string {
  const now = me.game.time;
  if (me.judge) {
    const a = me.judge;
    const laws = a.martialUntil > now ? `MARTIAL LAW ${Math.ceil(a.martialUntil - now)}s` : a.laws.map((l) => `${LAW_LABELS[l.id]} ${Math.ceil(l.until - now)}s`).join(' · ') || 'E: choose a law';
    return `COURT ${a.court ? 'ACTIVE' : 'UNPLACED'} · ${laws}${target ? ` · ${target.name}: ${violationCount(me, target)}/20 violations` : ''}`;
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
export function miscMarkerChip(_viewer: Ship, _s: Ship): MiscChip | null {
  return null;
}

/** The banner `me` sees while an enemy misc titan holds it; null when none does. */
export function miscVictimBanner(_me: Ship): MiscBanner | null {
  return null;
}
