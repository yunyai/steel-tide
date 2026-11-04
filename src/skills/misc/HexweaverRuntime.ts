import type { Ship } from "../../ships/Ship";
import type { SkillSpec } from "../../core/types";
import { buff, hurt } from "../kit";
export interface Doll {
  target: number;
  pins: number;
  until: number;
  stitchedUntil: number;
  burnUntil: number;
  burnNext: number;
}
export interface HexweaverState {
  recharge: number[];
  dolls: Doll[];
  decoy: { x: number; z: number; hp: number; until: number } | null;
  needles: { target: number; next: number; left: number }[];
}
export function newHexweaverState(): HexweaverState {
  return { recharge: [], dolls: [], decoy: null, needles: [] };
}
export function pinCharges(s: Ship): number {
  return s.hexweaver
    ? 4 - s.hexweaver.recharge.filter((t) => t > s.game.time + 1e-8).length
    : 0;
}
export function pinDoll(s: Ship, t: Ship, free = false): boolean {
  const a = s.hexweaver!;
  a.recharge = a.recharge.filter((t) => t > s.game.time + 1e-8);
  if (!free && pinCharges(s) <= 0)
    return s.failSkill("All four Pins are recovering");
  if (!free) a.recharge.push(s.game.time + 6);
  let d = a.dolls.find((d) => d.target === t.id);
  if (!d) {
    if (a.dolls.length >= 4) a.dolls.shift();
    d = {
      target: t.id,
      pins: 0,
      until: 0,
      stitchedUntil: 0,
      burnUntil: 0,
      burnNext: 0,
    };
    a.dolls.push(d);
  }
  d.pins = Math.min(3, d.pins + 1);
  d.until = s.game.time + 18;
  return true;
}
export function dollDamage(
  s: Ship,
  t: Ship,
  amount: number,
  skill: SkillSpec,
  echo = true,
) {
  hurt(s, t, amount, skill);
  const a = s.hexweaver,
    d = a?.dolls.find((d) => d.target === t.id);
  if (!echo || !d || d.stitchedUntil <= s.game.time) return;
  for (const o of a!.dolls)
    if (o !== d && o.stitchedUntil > s.game.time) {
      const v = s.game.ships.find((v) => v.id === o.target && v.alive);
      if (v) hurt(s, v, Math.min(45000, amount * 0.35), skill);
    }
}
export function igniteDoll(s: Ship, d: Doll) {
  d.burnUntil = s.game.time + 5;
  d.burnNext = s.game.time + 0.5;
}
export function clearHexweaver(s: Ship) {
  if (s.hexweaver) s.hexweaver = newHexweaverState();
  for (const o of s.game.ships)
    if (o.hexweaver)
      o.hexweaver.dolls = o.hexweaver.dolls.filter((d) => d.target !== s.id);
}
export function hexweaverAbsorb(s: Ship, amount: number): number {
  const d = s.hexweaver?.decoy;
  if (!d || d.until <= s.game.time || d.hp <= 0) return amount;
  const n = Math.min(d.hp, amount);
  d.hp -= n;
  return amount - n;
}
export function updateHexweaver(s: Ship, _dt: number) {
  const a = s.hexweaver;
  if (!a) return;
  const now = s.game.time;
  a.recharge = a.recharge.filter((t) => t > now + 1e-8);
  a.dolls = a.dolls.filter(
    (d) =>
      d.until > now && s.game.ships.some((t) => t.id === d.target && t.alive),
  );
  for (const d of a.dolls) {
    const t = s.game.ships.find((t) => t.id === d.target)!;
    if (d.burnUntil > now && d.burnNext <= now) {
      d.burnNext += 0.5;
      dollDamage(s, t, 9000 * (1 + d.pins * 0.2), s.skills[3].spec, false);
    }
  }
  for (const n of a.needles)
    if (n.left > 0 && n.next <= now) {
      n.next += 0.15;
      n.left--;
      const t = s.game.ships.find((t) => t.id === n.target && t.alive);
      if (t) {
        const d = a.dolls.find((d) => d.target === t.id);
        dollDamage(s, t, 18000 * (1 + (d?.pins ?? 0) * 0.3), s.skills[7].spec);
        s.game.events.emit("lightning", {
          points: [
            { x: s.pos.x, y: 50, z: s.pos.z },
            { x: t.pos.x, y: 12, z: t.pos.z },
          ],
          color: 0xf090c9,
          straight: true,
        });
      }
    }
  a.needles = a.needles.filter((n) => n.left > 0);
  const decoy = a.decoy;
  if (decoy && (decoy.until <= now || decoy.hp <= 0)) {
    a.decoy = null;
    s.game.strikes.spawn(s, {
      kind: "rod",
      skill: s.skills[5].spec,
      x: decoy.x,
      z: decoy.z,
      radius: 650,
      delay: 0,
      damage: 55000,
      look: "rune",
    });
    for (const d of a.dolls) {
      const t = s.game.ships.find((t) => t.id === d.target && t.alive);
      if (
        t &&
        d.stitchedUntil > now &&
        Math.hypot(t.pos.x - decoy.x, t.pos.z - decoy.z) < 650
      )
        buff(t, "debuff:substitute", 4, (m) => {
          m.marked = true;
        });
    }
  }
}
