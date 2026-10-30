import { CROSS, beginCross, updateCross, endCross } from './CrossStep';
import { KNOT, SPEED_SCALE } from '../../config';
import { bearingTo, forwardX, forwardZ, wrapDeg } from '../../core/math';
import { canTrack } from '../../core/Targeting';
import { segmentHitsHull } from '../../core/hull';
import { buff, hurt, nearestEnemy } from '../kit';
import { def, type SkillDef } from '../types';
import {
  FLICKER_RADIUS,
  SIDESTEP,
  evadeIncoming,
  aimedLanding,
  aroundTarget,
  safeStep,
  snapStep,
  stepState,
  stepTarget,
  type Landing,
} from './StepperRuntime';
const VIOLET = 0xb388ff;
/** Overstep lands at the first clear distance past its target, then fires a fast fan led onto the target's course. */
export const OVERSTEP = { past: [500, 575, 650], knots: 320, spread: 0.012 } as const;
const spec = (
  id: string,
  name: string,
  cooldown: number,
  duration = 0,
  icon: 'blink' | 'ram' | 'salvo' | 'torpedo' | 'heal' | 'shield' | 'nuke' | 'fleet' | 'blade' = 'blink',
  ult = false,
) => ({
  id,
  name,
  short: name.replace('-step', '').replace('step', '').toUpperCase(),
  description: '',
  cooldown,
  duration,
  icon,
  accent: VIOLET,
  ult,
});
const aimed = (reach: number) => (s: Parameters<typeof nearestEnemy>[0]) => !!stepTarget(s, reach);
export const STEPPER_SKILLS: SkillDef[] = [
  def(
    {
      ...spec('stepperFlashStep', 'Flash-step', 5),
      description: 'Teleport to clear water beneath the reticle, up to 3.5 km away. Preserves heading and speed.',
    },
    {
      activate(s) {
        const p = aimedLanding(s, 3500);
        if (!p) return s.failSkill('Flash-step: destination blocked; no safe water');
        snapStep(s, p, false, 'flash');
      },
      aiShouldUse(s, _g, t) {
        return !!t && Math.hypot(t.pos.x - s.pos.x, t.pos.z - s.pos.z) > 2200;
      },
    },
  ),
  def(
    {
      ...spec('ramStep', 'Ram-step', 10, 0.35, 'ram'),
      description: 'Step to an enemy within 2.5 km, rush through its hull and deal 120k ramming damage plus flooding.',
    },
    {
      activate(s) {
        const t = stepTarget(s, 2500);
        if (!t) return s.failSkill('Ram-step: aim at a detected enemy within 2.5 km');
        const origin = s.stepper?.mirrorAim ?? s.pos;
        const slot = s.stepper?.copy ? [-0.7, -0.35, 0.35, 0.7][s.stepper.slot] : 0;
        const h = bearingTo(origin.x, origin.z, t.pos.x, t.pos.z) + slot,
          r = (s.spec.length + t.spec.length) / 2 + 100;
        const p = { x: t.pos.x - forwardX(h) * r, z: t.pos.z - forwardZ(h) * r, heading: h };
        const end = { x: t.pos.x + forwardX(h) * r, z: t.pos.z + forwardZ(h) * r, heading: h };
        if (!safeStep(s, p.x, p.z, h) || !safeStep(s, end.x, end.z, h))
          return s.failSkill('Ram-step: rush landing blocked');
        for (let d = 0; d <= r * 2; d += 20)
          if (!safeStep(s, p.x + forwardX(h) * d, p.z + forwardZ(h) * d, h, true))
            return s.failSkill('Ram-step: rush corridor blocked');
        snapStep(s, p, false, 'ram');
        stepState(s).rush = { x0: p.x, z0: p.z, x1: end.x, z1: end.z, elapsed: 0, hit: [] };
      },
      update(s, g, dt, st) {
        const r = s.stepper?.rush;
        if (!r) return;
        const x = s.pos.x,
          z = s.pos.z;
        r.elapsed += dt;
        const f = Math.min(1, r.elapsed / 0.35);
        s.pos.x = r.x0 + (r.x1 - r.x0) * f;
        s.pos.z = r.z0 + (r.z1 - r.z0) * f;
        for (const t of g.ships)
          if (
            t.alive &&
            t.team !== s.team &&
            !t.deep &&
            !r.hit.includes(t.id) &&
            segmentHitsHull(t, x, z, s.pos.x, s.pos.z, s.spec.beam / 2) >= 0
          ) {
            r.hit.push(t.id);
            const dmg = hurt(s, t, 120000, st.spec);
            if (dmg > 0 && t.alive) t.startFlood(s);
          }
      },
      end(s) {
        if (s.stepper) s.stepper.rush = null;
      },
      aiShouldUse: aimed(2500),
    },
  ),
  def(
    {
      ...spec('broadStep', 'Broadstep', 12, 8, 'salvo'),
      description:
        'Step broadside-on 700 m from an enemy within 3 km. Main guns align and spam for 8 s: double damage, quarter reload.',
    },
    {
      activate(s, g, st) {
        const t = stepTarget(s, 3000);
        if (!t) return s.failSkill('Broadstep: aim at a detected enemy within 3 km');
        const p = aroundTarget(s, t, 700, true);
        if (!p) return s.failSkill('Broadstep: no safe broadside position');
        snapStep(s, p, false, 'broad');
        const a = stepState(s);
        a.broadUntil = g.time + 8;
        a.broadTarget = t.id;
        buff(s, st.spec.id, 8, (m) => {
          m.reloadMul *= 0.25;
        });
        s.mods.reloadMul *= 0.25;
        for (const u of s.turrets) {
          const tp = s.localToWorld(u.spec.x, 0, u.spec.z ?? 0);
          u.yaw = wrapDeg(((bearingTo(tp.x, tp.z, t.pos.x, t.pos.z) - s.heading) * 180) / Math.PI - u.spec.facing);
          u.reload = 0;
          u.aligned = u.canBear = true;
        }
      },
      update(s, g) {
        const a = s.stepper!;
        const t = g.ships.find((o) => o.id === a.broadTarget && canTrack(s, o) && !o.deep);
        if (t) {
          s.control.aimX = t.pos.x;
          s.control.aimZ = t.pos.z;
          if (Math.hypot(t.pos.x - s.pos.x, t.pos.z - s.pos.z) > s.mainRange) a.broadTarget = 0;
        } else a.broadTarget = 0;
      },
      end(s) {
        if (s.stepper) {
          s.stepper.broadUntil = 0;
          s.stepper.broadTarget = 0;
        }
      },
      aiShouldUse: aimed(3000),
    },
  ),
  def(
    {
      ...spec('overStep', 'Overstep', 12, 0, 'torpedo'),
      description: `Step ${OVERSTEP.past[0]} m past an enemy within 3 km, then fire eight ${OVERSTEP.knots}-knot torpedoes backwards, led onto its course: 20k each.`,
    },
    {
      activate(s, g, st) {
        const t = stepTarget(s, 3000);
        if (!t) return s.failSkill('Overstep: aim at a detected enemy within 3 km');
        const origin = s.stepper?.mirrorAim ?? s.pos;
        const h = bearingTo(origin.x, origin.z, t.pos.x, t.pos.z);
        const slot = s.stepper?.copy ? (s.stepper.slot - 1.5) * 160 : 0;
        let p: Landing | null = null;
        for (const past of OVERSTEP.past) {
          const q = {
            x: t.pos.x + forwardX(h) * past + Math.cos(h) * slot,
            z: t.pos.z + forwardZ(h) * past + Math.sin(h) * slot,
            heading: h,
          };
          if (safeStep(s, q.x, q.z, h)) {
            p = q;
            break;
          }
        }
        if (!p) return s.failSkill('Overstep: rearward landing blocked');
        snapStep(s, p, false, 'over');
        // Lead the target: aim where its current course meets a torpedo leaving the stern.
        const speed = OVERSTEP.knots * KNOT * SPEED_SCALE,
          stern = s.localToWorld(-s.spec.length / 2 - 15, 0, 0);
        let ax = t.pos.x,
          az = t.pos.z;
        for (let i = 0; i < 2; i++) {
          const lead = Math.hypot(ax - stern.x, az - stern.z) / speed;
          ax = t.pos.x + forwardX(t.heading) * t.speed * lead;
          az = t.pos.z + forwardZ(t.heading) * t.speed * lead;
        }
        const b = bearingTo(stern.x, stern.z, ax, az);
        for (let i = 0; i < 8; i++) {
          const v = s.localToWorld(-s.spec.length / 2 - 15, 0, (i - 3.5) * 7);
          const torp = g.torps.launch(s, v.x, v.z, b + (i - 3.5) * OVERSTEP.spread, {
            ...s.spec.torpedoes!,
            speed: OVERSTEP.knots,
            range: 3000,
            damage: 20000,
            floodChance: 0.4,
          });
          torp.skill = st.spec;
        }
        g.events.emit('torpLaunched', { ship: s, x: s.pos.x, z: s.pos.z, count: 8 });
      },
      aiShouldUse: aimed(3000),
    },
  ),
  def(
    {
      ...spec('backStep', 'Backstep', 20, 8, 'heal'),
      description: 'Retreat 2 km from the nearest detected enemy, phase for 2 s and heal 20% maximum HP, then repair another 20% over 8 s. Hull damage cancels the repair. Usable while stunned, silenced or rooted.',
      alwaysUsable: true,
    },
    {
      activate(s, g) {
        const t = nearestEnemy(s, g, 6000);
        const a = t
          ? bearingTo(t.pos.x, t.pos.z, s.pos.x, s.pos.z)
          : bearingTo(s.control.aimX, s.control.aimZ, s.pos.x, s.pos.z);
        let p: Landing | null = null;
        for (const offset of [0, Math.PI / 12, -Math.PI / 12, Math.PI / 6, -Math.PI / 6, Math.PI / 3, -Math.PI / 3]) {
          const q = {
            x: s.pos.x + forwardX(a + offset) * 2000,
            z: s.pos.z + forwardZ(a + offset) * 2000,
            heading: s.heading,
          };
          if (safeStep(s, q.x, q.z, q.heading)) {
            p = q;
            break;
          }
        }
        if (!p) return s.failSkill('Backstep: no safe retreat 2 km away');
        snapStep(s, p, false, 'back');
        stepState(s).phaseUntil = g.time + 2;
        buff(s, 'backStep', 2, (m) => {
          m.invulnerable = true;
        });
        s.mods.invulnerable = true;
        s.heal(s.maxHp * 0.2);
        stepState(s).repair = { remaining: 8 };
        stepState(s).repairInterruptedUntil = 0;
      },
      update(s, _g, dt) {
        const repair = s.stepper?.repair;
        if (!repair) return;
        const elapsed = Math.min(dt, repair.remaining);
        s.heal(s.maxHp * 0.025 * elapsed);
        repair.remaining -= elapsed;
        if (repair.remaining < 1e-8) s.stepper!.repair = null;
      },
      end(s) { if (s.stepper) s.stepper.repair = null; },
      aiShouldUse(s) {
        return s.hp / s.maxHp < 0.6;
      },
    },
  ),
  def(
    {
      ...spec('sideStep', 'Sidestep', 18, 8, 'shield'),
      description:
        `For 8 s, react before incoming projectiles hit with a step up to ${SIDESTEP.distance} m to a random side. Phase for ${SIDESTEP.phase} s and dodge again every ${SIDESTEP.retrigger} s. Once started, it keeps working through stuns, silences and roots.`,
    },
    {
      activate(s, g) {
        stepState(s).sideUntil = g.time + 8;
      },
      update(s) {
        evadeIncoming(s);
      },
      end(s) {
        if (s.stepper) s.stepper.sideUntil = 0;
      },
      aiShouldUse(s, g) {
        return (
          g.shells.shells.some((p) => p.team !== s.team && Math.hypot(p.x - s.pos.x, p.z - s.pos.z) < 1200) ||
          s.hp / s.maxHp < 0.8
        );
      },
    },
  ),
  def(
    {
      ...spec('flickerStep', 'Flicker-step', 90, 3, 'blink', true),
      description:
        '20 steps around random detected enemies in a 2 km reticle area, within 4 km, each from a new angle and facing the target. 30k per strike over 3 s; repeat targets allowed.',
    },
    {
      activate(s, g) {
        const source = s.stepper?.copy ? s.summonOwner! : s;
        const origin = s.stepper?.mirrorAim ?? { x: source.pos.x, z: source.pos.z };
        let dx = source.control.aimX - origin.x,
          dz = source.control.aimZ - origin.z;
        const d = Math.hypot(dx, dz),
          k = d > 4000 ? 4000 / d : 1;
        dx = origin.x + dx * k;
        dz = origin.z + dz * k;
        if (
          !g.ships.some(
            (t) =>
              canTrack(s, t) &&
              !t.deep &&
              Math.hypot(t.pos.x - dx, t.pos.z - dz) <= FLICKER_RADIUS &&
              !!flickerLanding(s, t, bearingTo(t.pos.x, t.pos.z, s.pos.x, s.pos.z)),
          )
        )
          return s.failSkill('Flicker-step: no detected enemies with safe water in aimed area');
        stepState(s).flicker = { x: dx, z: dz, elapsed: 0, count: 0, last: bearingTo(dx, dz, s.pos.x, s.pos.z) };
        stepState(s).phaseUntil = g.time + 3;
        buff(s, 'flickerStep:phase', 3, (m) => {
          m.invulnerable = true;
        });
        s.mods.invulnerable = true;
      },
      update(s, g, dt, st) {
        const a = s.stepper!,
          f = a.flicker;
        if (!f) return;
        f.elapsed += dt;
        while (f.count < 20 && f.elapsed + 1e-8 >= (f.count + 1) * 0.15) {
          // Each strike comes in at least 60 degrees away from the last one.
          const start = f.last + Math.PI / 3 + (g.rng() * Math.PI * 4) / 3;
          const list = g.ships
            .filter((t) => canTrack(s, t) && !t.deep && Math.hypot(t.pos.x - f.x, t.pos.z - f.z) <= FLICKER_RADIUS)
            .sort((a, b) => a.id - b.id)
            .map((t) => ({ t, p: flickerLanding(s, t, start) }))
            .filter((v) => v.p);
          if (!list.length) {
            st.time = 0;
            break;
          }
          const v = list[Math.floor(g.rng() * list.length)];
          f.last = bearingTo(v.t.pos.x, v.t.pos.z, v.p!.x, v.p!.z);
          snapStep(s, v.p!);
          hurt(s, v.t, 30000, st.spec);
          g.events.emit('stepImpact', { ship: s, x: v.t.pos.x, z: v.t.pos.z, radius: 150, kind: 'flicker' });
          f.count++;
        }
      },
      end(s) {
        if (s.stepper) {
          s.stepper.flicker = null;
          s.stepper.phaseUntil = 0;
          s.effects = s.effects.filter((e) => e.id !== 'flickerStep:phase');
          s.refreshModifiers();
        }
      },
      aiShouldUse: aimed(4000),
    },
  ),
  def(
    {
      ...spec('crossStep', 'Cross-step', 95, 3, 'blade', true),
      description: `Aim within 3.5 km: phase around a 1 km zone for 3 s, carving ${CROSS.cuts} cuts at ${CROSS.damage / 1000}k damage each. Converge for a ${CROSS.finisher / 1000}k final slash. ${(CROSS.cuts * CROSS.damage + CROSS.finisher) / 1000}k total against enemies caught throughout.`,
    },
    {
      activate: beginCross,
      update(s, _g, dt, st) { updateCross(s, dt, st); },
      end: endCross,
      aiShouldUse: aimed(3500),
    },
  ),
  def(
    {
      ...spec('afterimageStep', 'Afterimage-step', 120, 18, 'fleet', true),
      description:
        'Four destroyable afterimages surround you for 18 s. Each has 25% HP, deals 75% damage and mirrors your attacks and offensive ultimates.',
    },
    {
      activate(s, g) {
        if (s.isSummon) return false;
        const slots: Landing[] = [];
        for (let i = 0; i < 4; i++) {
          const a = ((i + 0.5) * Math.PI) / 2;
          let p: Landing | null = null;
          for (const off of [0, 0.15, -0.15, 0.3, -0.3]) {
            const q = {
              x: s.pos.x + Math.cos(a + off) * 500,
              z: s.pos.z + Math.sin(a + off) * 500,
              heading: s.heading,
            };
            if (safeStep(s, q.x, q.z, q.heading, false, slots)) {
              p = q;
              break;
            }
          }
          if (!p) return s.failSkill('Afterimage-step: room needed for all four copies');
          slots.push(p);
        }
        const state = stepState(s);
        for (let i = 0; i < 4; i++) {
          const p = slots[i],
            c = g.addShip(s.spec, s.team, `Stepper · Echo ${i + 1}`, p.x, p.z, p.heading);
          c.isSummon = true;
          c.slot = s.slot;
          c.summonOwner = s;
          c.colossus = false;
          c.maxHp = c.hp = s.maxHp * 0.25;
          c.expiresAt = g.time + 18;
          c.meter = 0;
          c.throttle = s.throttle;
          c.speed = s.speed;
          c.stepper = { ...stepState(c), copy: true, slot: i, ownerId: s.id, until: g.time + 18 };
          state.copies.push(c.id);
        }
        g.events.emit('stepImpact', { ship: s, x: s.pos.x, z: s.pos.z, radius: 550, kind: 'copies' });
      },
      end(s, g) {
        for (const id of s.stepper?.copies ?? []) {
          const c = g.ships.find((o) => o.id === id);
          if (c?.alive) c.withdraw();
        }
        if (s.stepper) s.stepper.copies = [];
      },
      aiShouldUse: aimed(5000),
    },
  ),
];
/** Clear water close around `t`, bow toward it, searched outward in 30 degree steps from the bearing `start`. */
function flickerLanding(s: Parameters<typeof stepTarget>[0], t: Parameters<typeof aroundTarget>[1], start: number): Landing | null {
  for (let i = 0; i < 12; i++) {
    const a = start + Math.ceil(i / 2) * (i % 2 ? 1 : -1) * (Math.PI / 6),
      rel = a - t.heading;
    // The target's half-extent along this bearing keeps the bow just clear of its hull from any side.
    const r =
      s.spec.length / 2 + (Math.abs(Math.cos(rel)) * t.spec.length) / 2 + (Math.abs(Math.sin(rel)) * t.spec.beam) / 2 + 60;
    const x = t.pos.x + forwardX(a) * r,
      z = t.pos.z + forwardZ(a) * r,
      heading = bearingTo(x, z, t.pos.x, t.pos.z);
    if (safeStep(s, x, z, heading)) return { x, z, heading };
  }
  return null;
}
