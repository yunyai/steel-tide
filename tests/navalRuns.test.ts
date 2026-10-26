import { describe, expect, it } from 'vitest';
import { emptyGame, place, run } from './helpers';

describe('direct naval attack runs', () => {
  it('manual main-gun aim fires a sustained salvo and damages the hull under the reticle', () => {
    const g = emptyGame('open', 53);
    const me = place(g, 'iowa', 0, 0, 0);
    const foe = place(g, 'yamato', 1, 0, -1800);
    me.control.aimX = foe.pos.x;
    me.control.aimZ = foe.pos.z;
    me.control.fire = true;
    run(g, 45);
    expect(me.stats.shotsFired).toBeGreaterThan(6);
    expect(me.stats.damage).toBeGreaterThan(0);
  });

  it('ordinary carrier aircraft complete a dive attack while AA and fighters remain counters', () => {
    const g = emptyGame('open', 17);
    const carrier = place(g, 'queenElizabeth', 0, 0, 0);
    const foe = place(g, 'ford', 1, 0, -1400);
    foe.mods.aaMul = 0;
    foe.addEffect({ id: 'no-aa-control', time: 60, apply: m => { m.aaMul = 0; } });
    const squad = g.air.launch(carrier, 'dive', foe.pos.x, foe.pos.z)!;
    expect(squad).not.toBe(null);
    run(g, 35);
    expect(carrier.stats.damage).toBeGreaterThan(0);

    const aa = emptyGame('open', 17);
    const c = place(aa, 'queenElizabeth', 0, 0, 0);
    const defender = place(aa, 'atlanta', 1, 0, -300);
    const attacked = aa.air.launch(c, 'dive', 0, -300)!;
    attacked.x = defender.pos.x;
    attacked.z = defender.pos.z;
    const hp = attacked.planeHp;
    aa.air.update(1);
    expect(attacked.planeHp < hp || attacked.planes < attacked.spec.planes).toBe(true);
    // Isolate fighters from AA and bomber return behaviour so this checks the fighter counter.
    const duel = emptyGame('open', 17);
    const a = place(duel, 'queenElizabeth', 0, 0, 0);
    const b = place(duel, 'akagi', 1, 100, 0);
    a.mods.aaMul = b.mods.aaMul = 0;
    const capA = duel.air.launch(a, 'fighter', 0, 0)!;
    const capB = duel.air.launch(b, 'fighter', 0, 0)!;
    capA.state = capB.state = 'patrol';
    capA.x = capB.x = capA.z = capB.z = 0;
    capA.speedMul = capB.speedMul = 0;
    const fighterHp = capA.planeHp;
    duel.air.update(1);
    expect(capA.planeHp < fighterHp || capA.planes < capA.spec.planes).toBe(true);
  });

  it('returning squadrons cannot acquire a second payload after their previous target sinks', () => {
    const g = emptyGame();
    const carrier = place(g, 'queenElizabeth', 0, 0, 0);
    const first = place(g, 'iowa', 1, 0, -500);
    place(g, 'ford', 1, 20, -500);
    const sq = g.air.launch(carrier, 'dive', 0, -500)!;
    sq.state = 'return';
    sq.target = first;
    sq.x = 0; sq.z = -500;
    first.alive = false;
    g.air.update(0.01);
    g.air.update(0.01);
    expect(sq.state).toBe('return');
    expect(g.shells.shells.length).toBe(0);
  });
});
