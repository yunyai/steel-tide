import { ARCHITECT_TYPES } from '../data/architectLoadout';
import { CUBE_STATES, PATH_KINDS } from '../skills/misc/TungstenRuntime';
import { ELEMENTS } from '../skills/misc/ArchitectElements';
import type { Game } from '../core/Game';
import type { Sections } from './protocol';

export { diffSections, type Sections } from './protocol';

// A cheap fingerprint of the battle. Lockstep peers compare it every couple of seconds: any
// difference in any bit of a position or a hit point total means their battles have parted.

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

function mix(h: number, x: number): number {
  // -0 and 0 behave alike in the battle, but JSON sends -0 as 0: hash them alike too.
  f64[0] = x + 0;
  h = Math.imul(h ^ u32[0], 16777619);
  return Math.imul(h ^ u32[1], 16777619);
}


const SEED = 2166136261 | 0;

/** A stable number for a string id, for hashing effect and phase names. */
function idOf(id: string): number {
  let n = 0;
  for (let i = 0; i < id.length; i++) n = (Math.imul(n, 31) + id.charCodeAt(i)) | 0;
  return n;
}

/** The ship's whole state that later ticks depend on: pose, health, every clock and every runtime. */
function shipHash(s: Game['ships'][number]): number {
  let h = SEED;
  h = mix(h, s.id);
  h = mix(h, s.pos.x);
  h = mix(h, s.pos.y);
  h = mix(h, s.pos.z);
  h = mix(h, s.heading);
  h = mix(h, s.speed);
  h = mix(h, s.hp);
  h = mix(h, s.shield);
  h = mix(h, s.alive ? 1 : 0);
  h = mix(h, s.form ? 1 : 0);
  for(const n of [s.vectorMobility.dashCharges,s.vectorMobility.dashRecharge.length,...s.vectorMobility.dashRecharge,s.vectorMobility.mobileReadyAt,s.vectorMobility.mobileUntil,s.vectorMobility.mobileDuration])h=mix(h,n);
  for(const n of s.architectReveal)h=mix(h,n);
  for(const a of s.architectLoadout){h=mix(h,ARCHITECT_TYPES.indexOf(a.type));h=mix(h,a.skill);}
  if(s.architectDrone){h=mix(h,s.architectDrone.owner.id);h=mix(h,s.architectDrone.slot);h=mix(h,s.expiresAt);}
  if (s.architect) {
    const a=s.architect;
    for(const n of [a.capacitorReadyAt,a.drive?1:0,a.flakReadyAt,a.kindling.length])h=mix(h,n);
    for(const k of a.kindling){h=mix(h,k.target);h=mix(h,k.until);}
    if(a.drive)for(const n of [a.drive.dx,a.drive.dz,a.drive.elapsed,a.drive.distance,a.drive.moving?1:0,a.drive.from,a.drive.travelled,...a.drive.hit])h=mix(h,n);
    for (const n of [a.huntTarget,a.huntUntil,a.fullHp,a.moduleHp,a.healthReady?1:0,a.linkUntil,a.linkTick,a.clearing?1:0]) h=mix(h,n);
    for (const slot of a.slots) {
      h=mix(h,slot.capacitorCycles);h=mix(h,slot.capacitorCharged?1:0);
      h=mix(h,slot.follow?1:0);if(slot.follow)for(const n of [slot.follow.angle,slot.follow.radius,slot.follow.height,slot.follow.tilt,slot.follow.phase,slot.follow.rate])h=mix(h,n);
      for (const n of [ELEMENTS.indexOf(slot.element),slot.skillTimer,ARCHITECT_TYPES.indexOf(slot.type),slot.skill,slot.boostUntil,slot.reactionUntil,slot.castGap,slot.opening?1:0,slot.aboard?1:0,slot.index,['docked','launching','deployed','moving','returning','destroyed','assembling','citadel'].indexOf(slot.state),slot.hp,slot.reload,slot.reloadScale,slot.disabled,slot.rebuild,slot.dockedFor,slot.entity?.id??0])h=mix(h,n);
      if(slot.path)for(const n of [slot.path.x,slot.path.y,slot.path.z,slot.path.tx,slot.path.ty,slot.path.tz,slot.path.elapsed,slot.path.duration,slot.path.damage?1:0,slot.path.settling?1:0,...slot.path.hit])h=mix(h,n);
    }
    h=mix(h,a.elements.serial);
    for(const d of a.elements.drones)for(const n of [d.id,d.slot,d.next])h=mix(h,n);
    for(const m of a.elements.marks)for(const n of [m.target,m.element?ELEMENTS.indexOf(m.element):-1,m.until,m.ready])h=mix(h,n);
    for(const p of a.elements.pulls)for(const n of [p.target,p.x,p.z,p.until])h=mix(h,n);
    for(const j of a.elements.jobs)for(const n of [j.id,j.slot,ELEMENTS.indexOf(j.element),['skill','salvo','reaction','assembly','killbox'].indexOf(j.attack),j.x,j.y,j.z,j.tx,j.ty,j.tz,j.elapsed,j.next,j.count,j.interval,j.damage,j.radius,j.beam,j.chain?1:0,j.pull?1:0,j.slow?1:0,j.channel?1:0,j.mark?1:0,ARCHITECT_TYPES.indexOf(j.type),j.variant,j.target,j.underwater?1:0,j.support?1:0,j.projectile?1:0,j.speed,j.life])h=mix(h,n);
    for(const edge of a.links){h=mix(h,edge.a);h=mix(h,edge.b);}
    const u=a.ultimate;h=mix(h,u?1:0);
    if(u)for(const n of [['assembly','killbox','citadel'].indexOf(u.kind),u.elapsed,u.x,u.z,u.aimX,u.aimY,u.aimZ,u.locked?1:0,u.waves,u.fired?1:0,...u.members,...u.granted])h=mix(h,n);
    if(u?.battery){const c=u.battery;for(const n of [c.id,c.generation,c.startedAt])h=mix(h,n);for(const m of c.members)for(const n of [m.slot,['wide','compact','folded'].indexOf(m.layout),m.carrier.x,m.carrier.y,m.carrier.z,m.carrier.heading])h=mix(h,n);}
  }
  if (s.stepper) {
    const a=s.stepper;
    for(const n of [a.copy?1:0,a.slot,a.ownerId,a.until,a.dodgeReady,a.phaseUntil,a.sideUntil,a.broadUntil,a.broadTarget,...a.copies]) h=mix(h,n);
    h=mix(h,a.flicker?1:0);h=mix(h,a.rush?1:0);
    h=mix(h,a.cross?1:0);h=mix(h,a.repair?1:0);h=mix(h,a.repairInterruptedUntil);
    if(a.repair)h=mix(h,a.repair.remaining);
    if(a.cross)for(const n of [a.cross.x,a.cross.z,a.cross.elapsed,a.cross.count,a.cross.jumps,a.cross.finish.x,a.cross.finish.z,a.cross.finish.heading])h=mix(h,n);
    if(a.flicker)for(const n of [a.flicker.x,a.flicker.z,a.flicker.elapsed,a.flicker.count,a.flicker.last])h=mix(h,n);
    if(a.rush)for(const n of [a.rush.x0,a.rush.z0,a.rush.x1,a.rush.z1,a.rush.elapsed,...a.rush.hit])h=mix(h,n);
  }
  if (s.tungsten) {
    const a=s.tungsten;
    for(const n of [a.mode,a.nextCube,a.charge,a.guardUntil,a.orbitAngle,a.overdriveUntil,a.auraTick,a.energy,a.spent?1:0,a.reload,a.dockHeal?1:0,a.cubes.length,a.tethers.length,a.acts.length])h=mix(h,n);
    for(const c of a.cubes){
      for(const n of [c.id,c.mode,c.extra?1:0,c.slot,CUBE_STATES.indexOf(c.state),c.x,c.y,c.z,c.yaw,c.scale,c.hp,c.flown,c.reform,c.gone?1:0])h=mix(h,n);
      for(const k of c.contacts){h=mix(h,k.id);h=mix(h,k.at);}
      const p=c.path;h=mix(h,p?1:0);
      if(p)for(const n of [PATH_KINDS.indexOf(p.kind),p.skill,p.tx,p.ty,p.tz,p.speed,p.dealt,p.target,p.bounces,p.hit.length,...p.hit,p.healed.length,...p.healed])h=mix(h,n);
    }
    const l=a.lunge;h=mix(h,l?1:0);
    if(l)for(const n of [l.x0,l.z0,l.x1,l.z1,l.elapsed,l.time,l.cube,l.damage,l.skill,...l.hit])h=mix(h,n);
    for(const x of a.tethers)for(const n of [x.target,x.cube,x.skill,x.until,x.tick])h=mix(h,n);
    for(const x of a.acts)for(const n of [['pin','reel','field','mirror'].indexOf(x.kind),x.cube,x.skill,x.x,x.z,x.elapsed,x.time,x.radius,x.rate,x.taken,...x.targets])h=mix(h,n);
    const u=a.ult;h=mix(h,u?1:0);
    if(u)for(const n of [u.kind==='collapse'?1:2,u.skill,u.x,u.z,u.elapsed,u.tick,u.stage,u.merged?1:0,...u.cubes,...u.from,...u.spots,...u.falls,...u.struck,...u.bounce])h=mix(h,n);
  }
    for (const n of [s.throttle, s.depthState, s.flooding, s.rudderJam, s.engineDown, s.control.rudder, ...s.fires]) h = mix(h, n);
  for (const st of s.skills) for (const n of [st.cooldown, st.time, st.meter, st.active ? 1 : 0]) h = mix(h, n);
  for (const c of s.consumables) for (const n of [c.charges, c.cooldown, c.active, c.restock]) h = mix(h, n);
  for (const t of s.turrets) for (const n of [t.reload, t.disabled]) h = mix(h, n);
  for (const m of s.secondaries) h = mix(h, m.reload);
  for (const l of s.launchers) for (const n of [l.reload, l.tubes]) h = mix(h, n);
  if (s.vls) h = mix(h, s.vls.reload);
  if (s.air) {
    h = mix(h, s.air.cooldown);
    for (const k of Object.keys(s.air.hangar).sort()) {
      h = mix(h, s.air.hangar[k as keyof typeof s.air.hangar]);
      h = mix(h, s.air.restore[k as keyof typeof s.air.restore]);
    }
  }
  h = mix(h, s.effects.length);
  for (const e of s.effects) {
    h = mix(h, idOf(e.id));
    h = mix(h, e.time);
  }
  return h >>> 0;
}

/**
 * The battle's fingerprint in named parts. Peers send these along with the whole hash, so when
 * they disagree the server can say which ship or system drifted first.
 */
export function hashSections(g: Game): Sections {
  const out: Sections = [];
  let h = SEED;
  for (const n of [g.time, g.score[0], g.score[1], g.rng.state(), g.nextShipId, g.exposed[0], g.exposed[1], g.ships.length]) h = mix(h, n);
  out.push(['core', h >>> 0]);

  h = SEED;
  h=mix(h,g.battery.castSerial);h=mix(h,g.battery.launchSerial);
  for(const [id,generation] of [...g.battery.generations].sort((a,b)=>a[0]-b[0])){h=mix(h,id);h=mix(h,generation);}
  for(const r of g.battery.pending){
    for(const n of [r.id,r.owner.id,r.generation,r.castId,r.slot,r.stage,r.launchTime,r.arrivalTime,ARCHITECT_TYPES.indexOf(r.type),ELEMENTS.indexOf(r.element),r.skill,r.center.x,r.center.y,r.center.z,r.radius,r.baseDamage,r.damageMultiplier,['wide','compact','folded'].indexOf(r.layout),r.carrier.x,r.carrier.y,r.carrier.z,r.carrier.heading])h=mix(h,n);
    for(const path of r.paths)for(const p of [path.muzzle,path.control,path.impact])for(const n of [p.x,p.y,p.z])h=mix(h,n);
  }
  out.push(['battery', h >>> 0]);

  h = SEED;
  const r = g.rush;
  h = mix(h, r ? 1 : 0);
  if (r) for (const n of [r.wave, idOf(r.phase), r.timer, r.score, r.enemiesLeft, r.cleared ? 1 : 0, r.offer.length]) h = mix(h, n);
  const c = g.convoy;
  h = mix(h, c ? 1 : 0);
  if (c) for (const n of [c.arrived, c.sunk, ...c.transports.map((t) => t.id)]) h = mix(h, n);
  out.push(['mode', h >>> 0]);

  h = SEED;
  for (const m of g.smokes) for (const n of [m.x, m.z, m.r, m.life, m.team]) h = mix(h, n);
  for (const w of g.walls) for (const n of [w.x0, w.z0, w.x1, w.z1, w.team, w.age, w.life]) h = mix(h, n);
  for (const cap of g.caps) for (const n of [cap.owner, cap.capturer, cap.progress, cap.contested ? 1 : 0]) h = mix(h, n);
  for (const x of g.respawns) for (const n of [x.ship.id, x.at]) h = mix(h, n);
  for (const p of g.pickups.items) for (const n of [p.id, idOf(p.kind), p.x, p.z, p.age, p.alive ? 1 : 0]) h = mix(h, n);
  out.push(['world', h >>> 0]);

  h = SEED;
  for (const f of g.fields.fields) for (const n of [f.id, f.x, f.z, f.r, f.age]) h = mix(h, n);
  for (const n of [g.fields.wires.length, g.beams.beams.length, g.strikes.strikes.length, g.depth.charges.length]) h = mix(h, n);
  for (const b of g.beams.beams) for (const n of [b.id, b.x0, b.z0, b.x1, b.z1]) h = mix(h, n);
  for (const x of g.strikes.strikes) for (const n of [x.id, x.age]) h = mix(h, n);
  out.push(['fields', h >>> 0]);

  for (const s of g.ships) out.push([`s${s.id}`, shipHash(s)]);

  h = mix(SEED, g.shells.shells.length);
  for (const p of g.shells.shells) for (const n of [p.id, p.x, p.y, p.z]) h = mix(h, n);
  for(const p of g.shells.shells)if(p.element)for(const n of [p.id,p.element.owner.id,p.element.slot,p.element.kind?ELEMENTS.indexOf(p.element.kind):-1,p.element.docked?ARCHITECT_TYPES.indexOf(p.element.docked):-1,p.element.splash??0,p.x,p.y,p.z,p.vx,p.vy,p.vz,p.dmgMul,p.spec.damage])h=mix(h,n);
  out.push(['shells', h >>> 0]);

  h = mix(SEED, g.torps.torps.length);
  for (const t of g.torps.torps) for (const n of [t.id, t.x, t.z]) h = mix(h, n);
  out.push(['torps', h >>> 0]);

  h = mix(SEED, g.missiles.missiles.length);
  for (const m of g.missiles.missiles) for (const n of [m.id, m.x, m.z]) h = mix(h, n);
  out.push(['missiles', h >>> 0]);

  h = mix(SEED, g.air.squadrons.length);
  for (const q of g.air.squadrons) for (const n of [q.id, q.x, q.z]) h = mix(h, n);
  out.push(['air', h >>> 0]);
  return out;
}

/** The whole fingerprint from its sections: every one folded together in order. */
export function foldSections(sections: Sections): number {
  let h = SEED;
  for (const [, v] of sections) h = mix(h, v);
  return h >>> 0;
}

export function stateHash(g: Game): number {
  return foldSections(hashSections(g));
}

