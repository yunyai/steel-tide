import { describe, it, expect } from "vitest";
import { Game } from "../src/core/Game";
import { TurnApplier, draftOrders } from "../src/net/navalTurns";
import { DEFAULT_SETTINGS, TURN_TICKS, type Turn } from "../src/net/protocol";
import { navalRules } from "../server/rules";
import { stateHash } from "../src/net/hash";
import { emptyControl } from "../src/ships/Ship";
import { emptyGame, place } from "./helpers";

describe("new Misc titan integration", () => {
  it("sends the Judge's skills as plain skill edges", () => {
    const c = emptyControl();
    c.skill = 1;
    expect(draftOrders(c)[1]).toEqual({ sk: 1 });
    expect(navalRules.cleanEdge({ sk: 1, jl: 5 }, DEFAULT_SETTINGS)).toEqual({ sk: 1 });
    expect(navalRules.cleanEdge({ jl: 2 }, DEFAULT_SETTINGS)).toBeNull();
  });
  for (const id of ["judge", "hexweaver", "gourmand", "faultline", "pharos"]) {
    it(
      id + " replays skill inputs identically and hashes runtime changes",
      () => {
        const cfg = {
          mode: "lan" as const,
          type: "freeplay" as const,
          mapId: "open",
          teamSize: 1,
          ai: [0, 0] as [number, number],
          difficulty: "normal" as const,
          seed: 713,
          era: "mixed" as const,
          players: [
            { shipId: id, device: "mouse" as const, team: 0 as const },
            { shipId: "stepper", device: "mouse" as const, team: 1 as const },
          ],
        };
        const a = new Game(cfg),
          b = new Game(structuredClone(cfg)),
          x = new TurnApplier(a),
          y = new TurnApplier(b);
        for (const g of [a, b]) {
          const [s, t] = g.humans();
          s.pos.set(0, 0, 0);
          t.pos.set(600, 0, 0);
          s.speed = t.speed = 0;
          s.throttle = t.throttle = 2;
          s.meter = 1;
        }
        for (let k = 0; k < 100; k++) {
          const turn: Turn = {
            k,
            p: k === 0 ? [[0, [0, 600, 0, 0, -1]]] : undefined,
            e:
              k % 10 === 0
                ? [
                    [
                      0,
                      0,
                      {
                        sk: Math.floor(k / 10) % 9,
                      },
                    ],
                  ]
                : undefined,
          };
          for (let tick = 0; tick < TURN_TICKS; tick++) {
            x.applyTick(turn, tick);
            y.applyTick(JSON.parse(JSON.stringify(turn)), tick);
            expect(x.hash()).toBe(y.hash());
          }
        }
        expect(
          a.ships.every(
            (s) => Number.isFinite(s.hp) && Number.isFinite(s.pos.x),
          ),
        ).toBe(true);
        const s = a.humans()[0],
          before = stateHash(a);
        if (s.judge) s.judge.martialUntil++;
        if (s.hexweaver) s.hexweaver.recharge.push(a.time + 5);
        if (s.gourmand) s.gourmand.pantry.shells++;
        if (s.faultline) s.faultline.pressure++;
        if (s.pharos) s.pharos.dir = s.pharos.dir === 1 ? -1 : 1;
        expect(stateHash(a)).not.toBe(before);
      },
    );
    it(id + " clears its state on withdrawal and restores a fresh life", () => {
      const g = emptyGame(),
        s = place(g, id, 0, 0, 0);
      place(g, "stepper", 1, 600, 0);
      s.control.aimX = 600;
      s.control.aimZ = 0;
      s.meter = 1;
      for (let i = 0; i < 9; i++) s.activateSkill(i);
      s.withdraw();
      expect(s.alive).toBe(false);
      s.respawn(0, 0, 0);
      expect(s.alive).toBe(true);
      expect(s.judge?.cases.length ?? 0).toBe(0);
      expect(s.hexweaver?.dolls.length ?? 0).toBe(0);
      expect(s.gourmand?.swallow ?? null).toBeNull();
      expect(s.faultline?.pressure ?? 0).toBe(0);
      expect(s.pharos?.buoys.length ?? 0).toBe(0);
      expect(s.pharos?.beacon ?? null).toBeNull();
    });
  }
});
