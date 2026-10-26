import { runnerImport } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
await runnerImport(new URL('../src/core/installDetMath.ts', import.meta.url).pathname);
const {
  module: { runBattle },
} = await runnerImport(new URL('./balanceSim.ts', import.meta.url).pathname);
const results = [];
for (const seed of [501, 502, 503, 504])
  for (const titan of ['stepper', 'hadal', 'leviathan']) {
    const r = runBattle({ kind: 'titan', era: 'mixed', type: seed % 2 ? 'annihilation' : 'domination', seed, titan });
    results.push(r);
    if (r.error || r.nan.length) throw new Error(JSON.stringify(r));
    console.log(
      JSON.stringify({
        seed,
        titan,
        winner: r.winner,
        minutes: r.minutes,
        damage: r.ships.find((s) => s.id === titan && s.team === 0)?.damage,
        stuck: r.stuck,
      }),
    );
  }
mkdirSync('docs/verification/stepper', { recursive: true });
writeFileSync('docs/verification/stepper/combat-results.json', JSON.stringify(results, null, 2));
console.log(`${results.length} matched-seed battles, zero exceptions or nonfinite hulls.`);
