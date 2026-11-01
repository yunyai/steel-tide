import { describe, expect, it } from 'vitest';
import type { BattleConfig } from '../src/core/BattleSetup';
import { Game } from '../src/core/Game';
import { SIM_DT, MAP_HALF } from '../src/config';
import { SHIPS, SHIP_BY_ID } from '../src/data/ships';
import { stateHash } from '../src/net/hash';
import { TurnApplier } from '../src/net/navalTurns';
import { MAX_DUMMIES, type SandboxCmd, type Turn } from '../src/net/protocol';
import type { Ship } from '../src/ships/Ship';
import { navalRules } from '../server/rules';
import { refitArchitect } from '../src/skills/misc/ArchitectRuntime';

const sandbox = (shipId = 'yamato', over: Partial<BattleConfig> = {}): Game =>
  new Game({ mode: 'solo', type: 'sandbox', mapId: 'open', teamSize: 1, ai: [0, 0], difficulty: 'normal', seed: 5, players: [{ shipId, device: 'mouse' }], ...over });

const run = (g: Game, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) g.step(SIM_DT);
};

/** One dummy of `id` 3 km off the captain's bow, facing it, on team 1. */
function dummy(g: Game, id = 'fletcher', n = 1, team: 0 | 1 = 1): Ship[] {
  const me = g.humans()[0];
  const x = me.pos.x + Math.sin(me.heading) * 3000;
  const z = me.pos.z - Math.cos(me.heading) * 3000;
  const before = new Set(g.ships);
  g.sandbox!.apply({ k: 'spawn', ship: id, n, team, x, z, heading: me.heading + Math.PI });
  return g.ships.filter((s) => !before.has(s));
}

describe('sandbox battles', () => {
  it('sail with only their captains, never end, and bring a sunk captain back after 3 s', () => {
    const g = sandbox();
    const me = g.humans()[0];
    expect(g.ships).toEqual([me]);
    run(g, 20);
    expect(g.over).toBe(false);
    me.takeDamage(me.maxHp * 3, null);
    expect(me.alive).toBe(false);
    expect(g.respawnIn(me)).toBeCloseTo(3, 1);
    run(g, 3.1);
    expect(me.alive).toBe(true);
    // A titan captain brings no extra enemies either.
    expect(sandbox('leviathan').ships).toHaveLength(1);
  });

  it('let the Architect refit docked platforms, as in Free play', () => {
    const g = sandbox('architect');
    expect(refitArchitect(g.humans()[0], 0, { type: 'swarm', skill: 1 })).toBe(true);
  });

  it('let a captain change into any ship, whatever the era or titan rules', () => {
    const g = sandbox('yamato', { eras: ['historic'], titans: false });
    const me = g.humans()[0];
    g.pickShip(me, 'leviathan');
    expect(me.nextSpec?.id).toBe('leviathan');
    const anime = SHIPS.find((s) => s.id === 'luffy')!;
    g.pickShip(me, anime.id);
    expect(me.nextSpec).toBe(anime);
  });
});

describe('sandbox cheats', () => {
  const cheat = (g: Game, cheat: Extract<SandboxCmd, { k: 'cheat' }>['cheat'], on = true) => g.sandbox!.apply({ k: 'cheat', cheat, on });

  it('cooldowns: skills and consumables ready, weapon reloads held at 0.25 s; off leaves them alone', () => {
    const g = sandbox('yamato');
    const me = g.humans()[0];
    const wind = () => {
      for (const st of me.skills) if (!st.spec.ult) st.cooldown = 30;
      for (const c of me.consumables) c.cooldown = 30;
      for (const t of me.turrets) t.reload = 20;
      for (const m of me.secondaries) m.reload = 20;
      for (const l of me.launchers) l.reload = 20;
    };
    wind();
    run(g, SIM_DT);
    expect(me.skills.filter((st) => !st.spec.ult).every((st) => st.cooldown > 29)).toBe(true);
    cheat(g, 'cooldowns');
    run(g, SIM_DT);
    expect(me.skills.filter((st) => !st.spec.ult).every((st) => st.cooldown <= 0)).toBe(true);
    expect(me.consumables.every((c) => c.cooldown <= c.active)).toBe(true);
    expect(me.turrets.every((t) => t.reload <= 0.25)).toBe(true);
    expect(me.secondaries.every((m) => m.reload <= 0.25)).toBe(true);
    cheat(g, 'cooldowns', false);
    wind();
    run(g, SIM_DT);
    expect(me.turrets.every((t) => t.reload > 19)).toBe(true);
  });

  it('ult keeps every ultimate meter full', () => {
    const g = sandbox('yamato');
    const me = g.humans()[0];
    me.meter = 0;
    run(g, SIM_DT);
    expect(me.meter).toBeLessThan(0.1);
    cheat(g, 'ult');
    run(g, SIM_DT);
    expect(me.ultIndices.every((i) => me.skills[i].meter === 1)).toBe(true);
  });

  it('consumables keeps every charge', () => {
    const g = sandbox('yamato');
    const me = g.humans()[0];
    for (const c of me.consumables) c.charges = 0;
    cheat(g, 'consumables');
    run(g, SIM_DT);
    expect(me.consumables.every((c) => c.charges === c.spec.charges)).toBe(true);
  });

  it('god protects the captain but not dummies', () => {
    const g = sandbox('yamato');
    const me = g.humans()[0];
    const [d] = dummy(g);
    cheat(g, 'god');
    expect(me.takeDamage(5000, d)).toBe(0);
    expect(me.hp).toBe(me.maxHp);
    expect(d.takeDamage(500, me)).toBeGreaterThan(0);
    cheat(g, 'god', false);
    expect(me.takeDamage(5000, d)).toBeGreaterThan(0);
  });

  it('tough keeps dummies afloat and patches them up 5 s after the last hit', () => {
    const g = sandbox('yamato');
    const me = g.humans()[0];
    const [d] = dummy(g);
    cheat(g, 'tough');
    d.takeDamage(d.maxHp * 5, me);
    expect(d.alive).toBe(true);
    expect(d.hp).toBeLessThan(2);
    run(g, 4);
    expect(d.hp).toBeLessThan(d.maxHp);
    run(g, 1.2);
    expect(d.hp).toBe(d.maxHp);
  });

  it('every ship reads ready after firing every skill and consumable', () => {
    const stuck: string[] = [];
    for (const spec of SHIPS.filter((s) => !s.hidden)) {
      const g = sandbox(spec.id);
      dummy(g);
      for (const c of ['cooldowns', 'ult', 'consumables'] as const) cheat(g, c);
      run(g, SIM_DT);
      const me = g.humans()[0];
      for (let i = 0; i < me.skills.length; i++) {
        me.activateSkill(i);
        run(g, SIM_DT * 2);
      }
      for (let i = 0; i < me.consumables.length; i++) {
        me.control.consumable = i;
        run(g, SIM_DT * 2);
      }
      const ship = g.humans()[0];
      for (const st of ship.skills) {
        const ready = st.active || (st.spec.ult ? st.meter >= 1 : st.cooldown <= 0);
        if (!ready) stuck.push(`${spec.id} ${st.spec.id}`);
      }
      for (const c of ship.consumables) if (c.charges !== c.spec.charges || c.cooldown > c.active) stuck.push(`${spec.id} ${c.spec.type}`);
    }
    expect(stuck).toEqual([]);
  });

  it('readies Architect modules, capacitor and Hull Dash', () => {
    const g = sandbox('architect');
    const me = g.humans()[0];
    const a = me.architect!;
    for (const slot of a.slots) slot.reload = 9;
    a.capacitorReadyAt = g.time + 50;
    a.flakReadyAt = g.time + 50;
    me.vectorMobility.dashCharges = 0;
    me.vectorMobility.mobileReadyAt = g.time + 50;
    cheat(g, 'cooldowns');
    run(g, SIM_DT);
    expect(a.slots.every((s) => s.reload <= 0.25)).toBe(true);
    expect(a.capacitorReadyAt).toBeLessThanOrEqual(g.time);
    expect(a.flakReadyAt).toBeLessThanOrEqual(g.time);
    expect(me.vectorMobility.dashRecharge).toEqual([]);
    expect(me.vectorMobility.mobileReadyAt).toBeLessThanOrEqual(g.time);
  });

  it('readies the Tungsten cube and Stepper dodge', () => {
    const g = sandbox('tungsten');
    const t = g.humans()[0].tungsten!;
    t.reload = 5;
    t.energy = 0;
    t.spent = true;
    cheat(g, 'cooldowns');
    run(g, SIM_DT);
    expect(t.reload).toBeLessThanOrEqual(0.25);
    expect(t.energy).toBe(1);
    expect(t.spent).toBe(false);

    const s = sandbox('stepper');
    const st = s.humans()[0].stepper!;
    st.dodgeReady = s.time + 30;
    s.sandbox!.apply({ k: 'cheat', cheat: 'cooldowns', on: true });
    run(s, SIM_DT);
    expect(st.dodgeReady).toBeLessThanOrEqual(s.time);
  });
});

describe('sandbox dummies', () => {
  it('spawn in a row on open water, outside the fleet, with ids in command order', () => {
    const g = sandbox();
    const ds = dummy(g, 'iowa', 3);
    expect(ds).toHaveLength(3);
    expect(ds.map((d) => d.id)).toEqual([2, 3, 4]);
    expect(ds.every((d) => d.spec === SHIP_BY_ID.iowa && d.team === 1 && !g.fleet.includes(d))).toBe(true);
    expect(ds.every((d) => g.map.heightAt(d.pos.x, d.pos.z) < -6 && Math.abs(d.pos.x) < MAP_HALF && Math.abs(d.pos.z) < MAP_HALF)).toBe(true);
    const gaps = ds.slice(1).map((d, i) => Math.hypot(d.pos.x - ds[i].pos.x, d.pos.z - ds[i].pos.z));
    expect(Math.min(...gaps)).toBeGreaterThan(200);
  });

  it('cap at MAX_DUMMIES', () => {
    const g = sandbox();
    dummy(g, 'fletcher', 10);
    dummy(g, 'fletcher', 10);
    expect(g.sandbox!.dummies).toHaveLength(MAX_DUMMIES);
  });

  it('idle: stopped and holding fire', () => {
    const g = sandbox();
    const [d] = dummy(g, 'fletcher');
    run(g, 5);
    expect(Math.abs(d.speed)).toBeLessThan(0.5);
    expect(d.mods.disarmed).toBe(true);
    expect(g.ai.has(d)).toBe(false);
  });

  it('sail: a square course around its post, armed but not fighting', () => {
    const g = sandbox();
    const [d] = dummy(g, 'fletcher');
    g.sandbox!.apply({ k: 'mode', mode: 'sail' });
    const post = { x: d.pos.x, z: d.pos.z };
    let far = 0;
    for (let i = 0; i < 6; i++) {
      run(g, 10);
      const r = Math.max(Math.abs(d.pos.x - post.x), Math.abs(d.pos.z - post.z));
      far = Math.max(far, r);
      expect(r).toBeLessThan(2200);
    }
    expect(far).toBeGreaterThan(500);
    expect(d.mods.disarmed).toBe(false);
    expect(g.ai.has(d)).toBe(false);
  });

  it('fight: sailed by the AI; back to idle drops it', () => {
    const g = sandbox();
    const [d] = dummy(g, 'fletcher');
    g.sandbox!.apply({ k: 'mode', mode: 'fight' });
    expect(g.ai.has(d)).toBe(true);
    g.sandbox!.apply({ k: 'mode', mode: 'idle' });
    expect(g.ai.has(d)).toBe(false);
  });

  it('a sunk dummy sails again at its post after 3 s; respawn and clear', () => {
    const g = sandbox();
    const me = g.humans()[0];
    const [d] = dummy(g, 'fletcher');
    const post = { x: d.pos.x, z: d.pos.z };
    d.takeDamage(d.maxHp * 5, me);
    expect(d.alive).toBe(false);
    run(g, 2.9);
    expect(d.alive).toBe(false);
    run(g, 0.2);
    expect(d.alive).toBe(true);
    expect(Math.hypot(d.pos.x - post.x, d.pos.z - post.z)).toBeLessThan(1);
    expect(d.mods.invulnerable).toBe(false);
    expect(me.stats.kills + g.score[0]).toBeGreaterThan(0);

    d.takeDamage(d.maxHp / 2, me);
    g.sandbox!.apply({ k: 'respawn' });
    expect(d.hp).toBe(d.maxHp);
    g.sandbox!.apply({ k: 'clear' });
    expect(g.sandbox!.dummies).toEqual([]);
    expect(d.alive).toBe(false);
    run(g, 5);
    expect(d.alive).toBe(false);
  });
});

describe('damage events', () => {
  it('report every hit once, by kind, adding up to the damage stat', () => {
    const g = sandbox('yamato');
    const me = g.humans()[0];
    const [d] = dummy(g, 'iowa');
    g.sandbox!.apply({ k: 'cheat', cheat: 'tough', on: true });
    const hits: { amount: number; kind: string; attacker: Ship | null }[] = [];
    g.events.on('damage', (e) => hits.push(e));
    for (let i = 0; i < 40 / SIM_DT; i++) {
      me.control.aimX = d.pos.x;
      me.control.aimZ = d.pos.z;
      me.control.fire = true;
      g.step(SIM_DT);
    }
    const mine = hits.filter((h) => h.attacker === me);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.reduce((a, h) => a + h.amount, 0)).toBeCloseTo(me.stats.damage, 3);
    expect(mine.some((h) => h.kind === 'gun')).toBe(true);

    hits.length = 0;
    d.takeDamage(10, me, null, true);
    d.takeDamage(10, me, null, false, false, true);
    d.takeDamage(10, me, me.skills[0].spec);
    g.hitKind = 'torp';
    d.takeDamage(10, me);
    g.hitKind = 'gun';
    expect(hits.map((h) => h.kind)).toEqual(['reflect', 'dot', 'skill', 'torp']);
  });
});

describe('sandbox over LAN', () => {
  const lanConfig = () => navalRules.config({ ...navalRules.defaults(), type: 'sandbox' }, [{ pick: 'yamato', team: 0, name: 'A' }, { pick: 'iowa', team: 1, name: 'B' }], 77);

  it('builds with no AI fleets and any captain ship', () => {
    const c = lanConfig();
    expect(c.type).toBe('sandbox');
    expect(c.ai).toEqual([0, 0]);
    const st = { ...navalRules.defaults(), type: 'sandbox' as const, eras: ['anime' as const], titans: false };
    expect(navalRules.pickAllowed('leviathan', st)).toBe(true);
    expect(navalRules.startError(st, [])).toBeNull();
  });

  it('keeps two peers identical through sandbox commands', () => {
    const c = lanConfig();
    const a = new Game(c), b = new Game(structuredClone(c));
    const ap = new TurnApplier(a), bp = new TurnApplier(b);
    const cmds: Record<number, SandboxCmd> = {
      2: { k: 'cheat', cheat: 'cooldowns', on: true },
      3: { k: 'spawn', ship: 'fletcher', n: 3, team: 1, x: 0, z: 0, heading: 1 },
      4: { k: 'mode', mode: 'fight' },
      40: { k: 'mode', mode: 'sail' },
      60: { k: 'respawn' },
      80: { k: 'clear' },
    };
    for (let k = 0; k < 120; k++) {
      const turn: Turn = { k, p: [[0, [0.3, 2000, 0, 1, -1]]] };
      if (cmds[k]) turn.ev = [{ sb: cmds[k] }];
      const copy = structuredClone(turn);
      for (let tick = 0; tick < 2; tick++) { ap.applyTick(turn, tick); bp.applyTick(copy, tick); }
      if (k % 20 === 19) expect(stateHash(a)).toBe(stateHash(b));
    }
    expect(a.sandbox!.cheats.cooldowns).toBe(true);
  });

  it('hashes the sandbox state', () => {
    const g = new Game(lanConfig());
    const before = stateHash(g);
    g.sandbox!.apply({ k: 'cheat', cheat: 'god', on: true });
    expect(stateHash(g)).not.toBe(before);
  });

  it('cleans commands from the wire', () => {
    const clean = navalRules.cleanSandbox;
    expect(clean({ k: 'cheat', cheat: 'god', on: true })).toEqual({ k: 'cheat', cheat: 'god', on: true });
    expect(clean({ k: 'cheat', cheat: 'everything', on: true })).toBeNull();
    const spawn = clean({ k: 'spawn', ship: 'fletcher', n: 99, team: 1, x: 1e9, z: -3, heading: 7 }) as Extract<SandboxCmd, { k: 'spawn' }>;
    expect({ ...spawn, heading: 0 }).toEqual({ k: 'spawn', ship: 'fletcher', n: MAX_DUMMIES, team: 1, x: MAP_HALF, z: -3, heading: 0 });
    expect(spawn.heading).toBeCloseTo(7 - 2 * Math.PI, 9);
    expect(clean({ k: 'spawn', ship: 'nonsense', n: 1, team: 1, x: 0, z: 0, heading: 0 })).toBeNull();
    expect(clean({ k: 'spawn', ship: 'fletcher', n: 1, team: 2, x: 0, z: 0, heading: 0 })).toBeNull();
    expect(clean({ k: 'spawn', ship: 'fletcher', n: 1, team: 1, x: NaN, z: 0, heading: 0 })).toBeNull();
    expect(clean({ k: 'mode', mode: 'fight' })).toEqual({ k: 'mode', mode: 'fight' });
    expect(clean({ k: 'mode', mode: 'dance' })).toBeNull();
    expect(clean({ k: 'respawn', extra: 1 })).toEqual({ k: 'respawn' });
    expect(clean({ k: 'clear' })).toEqual({ k: 'clear' });
    for (const bad of [null, 'clear', 3, { k: 'nuke' }, { k: '__proto__' }]) expect(clean(bad)).toBeNull();
  });
});
