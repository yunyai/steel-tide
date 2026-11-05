import type { Ship } from '../../ships/Ship';
import { gourmandRider } from './GourmandRuntime';
import { hexRider } from './HexweaverRuntime';
import { judgeRider } from './JudgeRuntime';
import { emitMisc, isMiscTitanShip, type TitanRider } from './MiscEvents';

// The misc titans' bespoke batteries ride on ordinary turret fire: `Ship.fireTurret` asks for a
// rider once per turret salvo and hands its hooks to every round of it.

/** One turret's salvo: which hulls its rounds have struck so far. */
export interface MiscSalvo {
  turret: number;
  struck: number[];
}

export interface MiscRider {
  onHit: (target: Ship, x: number, z: number) => void;
  onLand: (x: number, z: number) => void;
  hitMul?: (target: Ship) => number;
  pierce?: boolean;
  fire?: boolean;
}

function titanRider(s: Ship): TitanRider {
  if (s.judge) return judgeRider(s);
  if (s.hexweaver) return hexRider(s);
  if (s.gourmand) return gourmandRider(s);
  return {};
}

/** The rider for turret `turret` of `s`, or null for a ship that is not a misc titan. */
export function miscBattery(s: Ship, turret: number): MiscRider | null {
  if (!isMiscTitanShip(s)) return null;
  const salvo: MiscSalvo = { turret, struck: [] };
  const own = titanRider(s);
  return {
    onHit: (target, x, z) => {
      const first = !salvo.struck.includes(target.id);
      if (first) {
        salvo.struck.push(target.id);
        own.onFirstHit?.(target);
      }
      own.onHit?.(target, x, z);
      emitMisc(s, 'gunHit', x, z, { target, n: first ? 1 : 0 });
    },
    onLand: (x, z) => {
      own.onLand?.(x, z);
      emitMisc(s, 'gunLand', x, z);
    },
    hitMul: own.hitMul,
    pierce: own.pierce,
    fire: own.fire,
  };
}
