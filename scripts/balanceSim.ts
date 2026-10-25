import type { BattleConfig, BattleType } from '../src/core/BattleSetup';
import { groupOf } from '../src/core/BattleSetup';
import { Game } from '../src/core/Game';
import type { BattleEra } from '../src/core/types';
import { eraOf } from '../src/data/factions';
import { SHIP_BY_ID } from '../src/data/ships';
import type { Ship } from '../src/ships/Ship';

// One headless AI battle for the balance report (see balance.mjs): every ship's damage, skill
// damage, kills, deaths and survival, plus a soak check for errors, NaN and stuck ships.

export interface BalanceJob {
  /** A fleet battle of one era, or a titan leading a fleet of its own era. */
  kind: 'line' | 'titan';
  era: BattleEra;
  type: BattleType;
  seed: number;
  /** The titan sailing for team 0 (titan jobs). */
  titan?: string;
}

export interface ShipResult {
  id: string;
  era: string;
  group: string;
  team: number;
  won: boolean;
  damage: number;
  skill: number;
  kills: number;
  deaths: number;
  survived: boolean;
}

export interface BalanceResult {
  job: BalanceJob;
  winner: number;
  reason: string;
  minutes: number;
  ships: ShipResult[];
  error: string | null;
  /** Ships whose position went NaN. */
  nan: string[];
  /** Ships that sat within 60 m of one spot for over a minute while afloat. */
  stuck: string[];
  /** Skill damage by `shipId:skillId`. */
  skills: Record<string, number>;
}

const MAPS = ['strait', 'open', 'archipelago', 'dusk'];
const MAX_TIME = 16 * 60;

export function runBattle(job: BalanceJob): BalanceResult {
  const config: BattleConfig = {
    mode: 'solo',
    type: job.type,
    mapId: MAPS[job.seed % MAPS.length],
    teamSize: 8,
    difficulty: 'hard',
    players: job.titan ? [{ shipId: job.titan, device: 'mouse', team: 0, name: 'Titan' }] : [],
    seed: 1000 + job.seed,
    era: job.era,
    ai: job.titan ? [7, 8] : [8, 8],
  };
  const out: BalanceResult = { job, winner: -1, reason: '', minutes: 0, ships: [], error: null, nan: [], stuck: [], skills: {} };
  let g: Game | null = null;
  try {
    g = new Game(config);
    for (const s of g.fleet) if (s.humanIndex >= 0) g.handToAI(s);
    g.events.on('skillHit', (e) => {
      const owner = e.attacker.summonOwner ?? e.attacker;
      const key = `${owner.spec.id}:${e.skill.id}`;
      out.skills[key] = (out.skills[key] ?? 0) + e.damage;
    });
    // Where each ship was at the last check, and for how long it has stayed near there.
    const anchor = new Map<Ship, { x: number; z: number; since: number }>();
    const stuck = new Set<string>();
    const nan = new Set<string>();
    let nextCheck = 0;
    while (!g.over && g.time < MAX_TIME) {
      g.step();
      if (g.time < nextCheck) continue;
      nextCheck = g.time + 5;
      for (const s of g.ships) {
        if (!s.alive || s.isSummon) continue;
        if (!Number.isFinite(s.pos.x) || !Number.isFinite(s.pos.z) || !Number.isFinite(s.hp)) nan.add(s.spec.id);
        const a = anchor.get(s);
        if (!a || Math.hypot(s.pos.x - a.x, s.pos.z - a.z) > 60) anchor.set(s, { x: s.pos.x, z: s.pos.z, since: g.time });
        else if (g.time - a.since > 60) stuck.add(s.spec.id);
      }
    }
    out.nan = [...nan];
    out.stuck = [...stuck];
  } catch (e) {
    out.error = e instanceof Error ? `${e.message}\n${e.stack?.split('\n').slice(1, 4).join('\n')}` : String(e);
  }
  if (!g) return out;
  out.winner = g.winner;
  out.reason = g.reason;
  out.minutes = g.time / 60;
  for (const s of g.fleet) {
    if (s.isSummon) continue;
    const spec = SHIP_BY_ID[s.spec.id] ?? s.spec;
    out.ships.push({
      id: spec.id,
      era: eraOf(spec),
      group: spec.cls === 'TT' ? 'TT' : groupOf(spec.cls),
      team: s.team,
      won: g.winner === s.team,
      damage: s.stats.damage,
      skill: s.stats.skill,
      kills: s.stats.kills,
      deaths: s.stats.deaths,
      survived: s.alive,
    });
  }
  return out;
}
