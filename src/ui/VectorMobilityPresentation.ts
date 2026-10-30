import type { getVectorMobilityStatus } from '../skills/misc/ArchitectRuntime';
type MobilityStatus = NonNullable<ReturnType<typeof getVectorMobilityStatus>>;
export interface VectorActionPresentation {
  ready: boolean;
  tone: 'ready' | 'active' | 'blocked' | 'recharging';
  count: string;
  detail: string;
  title: string;
  progress: number;
}
export function vectorMobilityPresentation(status: MobilityStatus): { dash: VectorActionPresentation; mobile: VectorActionPresentation } {
  const d = status.hullDash, m = status.mobileBattery;
  const dashBlocked = d.blockedReason && !['Hull Dash active', 'Hull Dash recharging'].includes(d.blockedReason);
  const mobileBlocked = m.blockedReason && m.blockedReason !== 'Mobile Battery recharging';
  const dashReady = !d.blockedReason && d.activeRemaining <= 0;
  const mobileReady = !m.blockedReason && m.activeRemaining <= 0;
  const nextCharge = d.rechargeRemaining > 0 ? ` · +1 in ${d.rechargeRemaining.toFixed(1)}s` : '';
  const dashDetail = dashBlocked ? d.blockedReason + nextCharge : d.activeRemaining > 0 ? `Dashing ${d.activeRemaining.toFixed(1)}s${nextCharge}` : dashReady ? `Ready${nextCharge}` : `Recharge ${d.rechargeRemaining.toFixed(1)}s`;
  const mobileTimer = m.cooldownRemaining > 0 ? `${m.cooldownRemaining.toFixed(1)}s` : '';
  const mobileDetail = mobileBlocked ? `${m.blockedReason}${m.activeRemaining > 0 ? ` · ${m.activeRemaining.toFixed(1)}s left` : ''}` : m.activeRemaining > 0 ? `Active ${m.activeRemaining.toFixed(1)}s${mobileTimer ? ` · ready in ${mobileTimer}` : ''}` : mobileReady ? `Ready · ${m.duration}s duration` : `Recharge ${mobileTimer}`;
  return {
    dash: { ready: dashReady, tone: dashBlocked ? 'blocked' : d.activeRemaining > 0 ? 'active' : dashReady ? 'ready' : 'recharging', count: `${d.charges}/${d.maxCharges}`, detail: dashDetail,
      title: `Hull Dash · ${d.distance}m toward reticle / ${d.duration}s · 70% damage reduction during movement · ${d.charges}/${d.maxCharges} charges · ${d.rechargeDuration}s sequential recharge · ${dashDetail}`, progress: d.rechargeRemaining > 0 ? 1 - d.rechargeRemaining / d.rechargeDuration : 1 },
    mobile: { ready: mobileReady, tone: mobileBlocked ? 'blocked' : m.activeRemaining > 0 ? 'active' : mobileReady ? 'ready' : 'recharging', count: '', detail: mobileDetail,
      title: `Mobile Battery · ${m.duration}s duration · deployed platforms hover around the hull at up to 1200m/s while firing · ${m.cooldownDuration}s recharge from activation · ${mobileDetail}${mobileBlocked && mobileTimer ? ` · recharge ${mobileTimer}` : ''}`, progress: m.cooldownRemaining > 0 ? 1 - m.cooldownRemaining / m.cooldownDuration : 1 },
  };
}
