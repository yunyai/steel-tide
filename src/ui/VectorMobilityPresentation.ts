import type { getVectorMobilityStatus } from '../skills/misc/ArchitectRuntime';
type MobilityStatus = NonNullable<ReturnType<typeof getVectorMobilityStatus>>;
export interface VectorActionPresentation {
  ready: boolean;
  /** `off`: equipped, but every Vector is destroyed until one is rebuilt. */
  tone: 'ready' | 'active' | 'blocked' | 'recharging' | 'off';
  count: string;
  detail: string;
  title: string;
  progress: number;
  /** Seconds shown in the hex tile (empty when the action is usable). */
  timer: string;
  /** Dark cooldown wedge over the hex tile, 0..1. */
  sweep: number;
}
const secs = (t: number) => (t > 0 ? String(Math.ceil(t)) : '');
export function vectorMobilityPresentation(status: MobilityStatus): { dash: VectorActionPresentation; mobile: VectorActionPresentation } {
  const d = status.hullDash, m = status.mobileBattery;
  const off = status.equipped && status.vectors === 0;
  const offDetail = status.rebuildRemaining > 0 ? `Vectors destroyed · rebuild in ${status.rebuildRemaining.toFixed(1)}s` : 'Requires a living Vector';
  const dashBlocked = d.blockedReason && !['Hull Dash active', 'Hull Dash recharging'].includes(d.blockedReason);
  const mobileBlocked = m.blockedReason && m.blockedReason !== 'Mobile Battery recharging';
  const dashReady = !d.blockedReason && d.activeRemaining <= 0;
  const mobileReady = !m.blockedReason && m.activeRemaining <= 0;
  const nextCharge = d.rechargeRemaining > 0 ? ` · +1 in ${d.rechargeRemaining.toFixed(1)}s` : '';
  const dashDetail = off ? offDetail + nextCharge : dashBlocked ? d.blockedReason + nextCharge : d.activeRemaining > 0 ? `Dashing ${d.activeRemaining.toFixed(1)}s${nextCharge}` : dashReady ? `Ready${nextCharge}` : `Recharge ${d.rechargeRemaining.toFixed(1)}s`;
  const mobileTimer = m.cooldownRemaining > 0 ? `${m.cooldownRemaining.toFixed(1)}s` : '';
  const mobileDetail = off ? `${offDetail}${mobileTimer ? ` · recharge ${mobileTimer}` : ''}` : mobileBlocked ? `${m.blockedReason}${m.activeRemaining > 0 ? ` · ${m.activeRemaining.toFixed(1)}s left` : ''}` : m.activeRemaining > 0 ? `Active ${m.activeRemaining.toFixed(1)}s${mobileTimer ? ` · ready in ${mobileTimer}` : ''}` : mobileReady ? `Ready · ${m.duration}s duration` : `Recharge ${mobileTimer}`;
  const dashTone = off ? 'off' : dashBlocked ? 'blocked' : d.activeRemaining > 0 ? 'active' : dashReady ? 'ready' : 'recharging';
  const mobileTone = off ? 'off' : mobileBlocked ? 'blocked' : m.activeRemaining > 0 ? 'active' : mobileReady ? 'ready' : 'recharging';
  return {
    dash: { ready: dashReady, tone: dashTone, count: `${d.charges}/${d.maxCharges}`, detail: dashDetail,
      title: `Hull Dash · ${d.distance}m toward reticle / ${d.duration}s · lifts and turns bow-first, 70% damage reduction · ${Math.round(d.pathDamage / 1000)}k to hulls in the path, ${Math.round(d.landDamage / 1000)}k landing shockwave within ${d.landRadius}m · flies over islands · ${d.charges}/${d.maxCharges} charges · each recharges in ${d.rechargeDuration}s · ${dashDetail}`, progress: d.rechargeRemaining > 0 ? 1 - d.rechargeRemaining / d.rechargeDuration : 1,
      timer: off ? secs(status.rebuildRemaining) : d.charges <= 0 ? secs(d.rechargeRemaining) : '',
      sweep: off ? 1 : d.charges <= 0 && d.rechargeRemaining > 0 ? Math.min(1, d.rechargeRemaining / d.rechargeDuration) : 0 },
    mobile: { ready: mobileReady, tone: mobileTone, count: '', detail: mobileDetail,
      title: `Mobile Battery · ${m.duration}s duration · deployed platforms hover around the hull at up to ${Math.round(m.speed)}m/s while firing · ${m.cooldownDuration.toFixed(1).replace(/\.0$/, '')}s recharge from activation · ${mobileDetail}${mobileBlocked && !off && mobileTimer ? ` · recharge ${mobileTimer}` : ''}`, progress: m.cooldownRemaining > 0 ? 1 - m.cooldownRemaining / m.cooldownDuration : 1,
      timer: off ? secs(status.rebuildRemaining) : m.activeRemaining > 0 ? secs(m.activeRemaining) : secs(m.cooldownRemaining),
      sweep: off ? 1 : m.activeRemaining > 0 ? 0 : Math.min(1, m.cooldownRemaining / m.cooldownDuration) },
  };
}
