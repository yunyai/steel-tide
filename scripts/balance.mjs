// Balance report: headless AI-only battles in every era, plus every titan leading a fleet, run
// on a pool of worker threads. Prints each ship against its class group's median, era averages
// in mixed battles, titan results, and a soak check (errors, NaN, stuck ships).
//
//   npm run balance                  32 battles per era, 4 per titan
//   npm run balance -- --battles 16 --titan-seeds 2 --json out.json

import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { writeFileSync } from 'node:fs';

const root = fileURLToPath(new URL('..', import.meta.url));

async function main() {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : fallback;
  };
  const perEra = Number(arg('battles', 32));
  const titanSeeds = Number(arg('titan-seeds', 4));
  const jsonOut = arg('json', null);

  const { runnerImport } = await import('vite');
  await runnerImport(`${root}src/core/installDetMath.ts`);
  const { module: ships } = await runnerImport(`${root}src/data/ships.ts`);
  const { module: factions } = await runnerImport(`${root}src/data/factions.ts`);
  const titans = ships.SHIPS.filter((s) => s.cls === 'TT').map((s) => ({ id: s.id, era: factions.eraOf(s) }));

  const jobs = [];
  for (const era of ['historic', 'modern', 'scifi', 'fantasy', 'mixed']) {
    for (let i = 0; i < perEra; i++) jobs.push({ kind: 'line', era, type: i % 2 ? 'annihilation' : 'domination', seed: i });
  }
  for (const t of titans) {
    for (let i = 0; i < titanSeeds; i++) jobs.push({ kind: 'titan', era: t.era, type: i % 2 ? 'annihilation' : 'domination', seed: 500 + i, titan: t.id });
  }

  const started = Date.now();
  const results = await runPool(jobs, Math.max(1, Math.min(7, cpus().length - 1)));
  const secs = ((Date.now() - started) / 1000).toFixed(0);

  report(results, ships.SHIP_BY_ID);
  process.stdout.write(`\n${results.length} battles in ${secs} s\n`);
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results));
}

function runPool(jobs, size) {
  return new Promise((resolve) => {
    const results = [];
    let next = 0;
    let done = 0;
    const workers = Array.from({ length: Math.min(size, jobs.length) }, () => new Worker(fileURLToPath(import.meta.url)));
    const feed = (w) => {
      if (next < jobs.length) w.postMessage(jobs[next++]);
    };
    for (const w of workers) {
      w.on('message', (r) => {
        results.push(r);
        done++;
        if (done % 20 === 0) process.stderr.write(`  ${done}/${jobs.length}\n`);
        if (done === jobs.length) {
          for (const x of workers) x.terminate();
          resolve(results);
        } else feed(w);
      });
      w.on('error', (e) => {
        process.stderr.write(`worker failed: ${e.stack ?? e}\n`);
        process.exit(1);
      });
      feed(w);
    }
  });
}

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (v) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`;
const k = (v) => `${Math.round(v / 1000)}k`;
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

/** Per ship and battle type: mean damage, skill share, kills, deaths, survival. */
function shipTable(rows) {
  const by = new Map();
  for (const r of rows) {
    const key = `${r.id}|${r.type}`;
    if (!by.has(key)) by.set(key, { id: r.id, type: r.type, era: r.era, group: r.group, rows: [] });
    by.get(key).rows.push(r);
  }
  for (const v of by.values()) {
    const rs = v.rows;
    v.n = rs.length;
    v.damage = mean(rs.map((r) => r.damage));
    v.skill = rs.reduce((a, r) => a + r.skill, 0) / Math.max(1, rs.reduce((a, r) => a + r.damage, 0));
    v.kills = mean(rs.map((r) => r.kills));
    v.deaths = mean(rs.map((r) => r.deaths));
    v.survival = mean(rs.map((r) => (r.survived ? 1 : 0)));
    v.win = mean(rs.map((r) => (r.won ? 1 : 0)));
  }
  return [...by.values()];
}

/** Each skill's damage per battle the ship sailed, biggest first. */
function skillSplit(results, id) {
  const sailed = results.filter((r) => r.ships.some((s) => s.id === id)).length;
  const sums = new Map();
  for (const r of results) for (const [key, v] of Object.entries(r.skills)) if (key.startsWith(`${id}:`)) sums.set(key.slice(id.length + 1), (sums.get(key.slice(id.length + 1)) ?? 0) + v);
  const list = [...sums].sort((a, b) => b[1] - a[1]);
  return list.length ? list.map(([s, v]) => `${s} ${k(v / Math.max(1, sailed))}`).join(', ') : 'none';
}

function report(results, byId) {
  const out = (s = '') => process.stdout.write(`${s}\n`);
  const line = results.filter((r) => r.job.kind === 'line');
  const titan = results.filter((r) => r.job.kind === 'titan');

  // ------------------------------------------------------------- ships vs group median
  out('SHIPS AGAINST THEIR CLASS GROUP (same era, same battle type), by mean damage per battle');
  out('Flagged: more than 35% off in both battle types, with at least 4 battles in each.');
  const eraRows = line.filter((r) => r.job.era !== 'mixed').flatMap((r) => r.ships.map((s) => ({ ...s, type: r.job.type })));
  const table = shipTable(eraRows);
  const groupMedian = new Map();
  for (const t of table) {
    const key = `${t.era}|${t.group}|${t.type}`;
    if (!groupMedian.has(key)) groupMedian.set(key, median(table.filter((x) => `${x.era}|${x.group}|${x.type}` === key && x.n >= 3).map((x) => x.damage)));
  }
  const ratio = (t) => t.damage / Math.max(1, groupMedian.get(`${t.era}|${t.group}|${t.type}`)) - 1;
  const ids = [...new Set(table.map((t) => t.id))].sort((a, b) => (byId[a].cls + a).localeCompare(byId[b].cls + b));
  const flagged = [];
  for (const era of ['historic', 'modern', 'scifi', 'fantasy']) {
    out();
    out(`${era}`);
    out(`  ${pad('ship', 16)}${pad('group', 9)}${lpad('dom dmg', 9)}${lpad('vs med', 8)}${lpad('ann dmg', 9)}${lpad('vs med', 8)}${lpad('skill', 7)}${lpad('kills', 7)}${lpad('deaths', 7)}${lpad('alive', 7)}${lpad('n', 5)}`);
    for (const id of ids) {
      const d = table.find((t) => t.id === id && t.type === 'domination');
      const a = table.find((t) => t.id === id && t.type === 'annihilation');
      const any = d ?? a;
      if (!any || any.era !== era) continue;
      const rd = d ? ratio(d) : 0;
      const ra = a ? ratio(a) : 0;
      const both = d && a && d.n >= 4 && a.n >= 4 && Math.sign(rd) === Math.sign(ra) && Math.abs(rd) > 0.35 && Math.abs(ra) > 0.35;
      const all = [d, a].filter(Boolean);
      const skill = all.reduce((s, t) => s + t.skill * t.n, 0) / all.reduce((s, t) => s + t.n, 0);
      if (both) flagged.push({ id, era, group: any.group, rd, ra, skill });
      out(
        `${both ? '!' : ' '} ${pad(id, 16)}${pad(any.group, 9)}${lpad(d ? k(d.damage) : '-', 9)}${lpad(d ? pct(rd) : '', 8)}${lpad(a ? k(a.damage) : '-', 9)}${lpad(a ? pct(ra) : '', 8)}${lpad(`${Math.round(skill * 100)}%`, 7)}` +
          `${lpad(mean(all.map((t) => t.kills)).toFixed(1), 7)}${lpad(mean(all.map((t) => t.deaths)).toFixed(1), 7)}${lpad(`${Math.round(mean(all.map((t) => t.survival)) * 100)}%`, 7)}${lpad(all.reduce((s, t) => s + t.n, 0), 5)}`,
      );
    }
  }
  out();
  out(`OUTLIERS (${flagged.length})`);
  for (const f of flagged) {
    out(`  ${pad(f.id, 16)}${pad(`${f.era} ${f.group}`, 18)} dom ${pct(f.rd)}, ann ${pct(f.ra)}, skill share ${Math.round(f.skill * 100)}%`);
    out(`      skill damage per battle: ${skillSplit(results, f.id)}`);
  }

  // ------------------------------------------------------------- eras in mixed battles
  out();
  out('ERAS IN MIXED BATTLES: mean damage per ship against the mean of all ships (same class group)');
  const mixed = line.filter((r) => r.job.era === 'mixed').flatMap((r) => r.ships);
  const groups = ['BB', 'cruiser', 'DD', 'CV', 'SS'];
  out(`  ${pad('era', 10)}${groups.map((g) => lpad(g, 9)).join('')}${lpad('all', 9)}${lpad('alive', 8)}${lpad('n', 6)}`);
  for (const era of ['historic', 'modern', 'scifi', 'fantasy']) {
    const cells = groups.map((g) => {
      const mine = mixed.filter((s) => s.era === era && s.group === g);
      const every = mixed.filter((s) => s.group === g);
      return mine.length ? pct(mean(mine.map((s) => s.damage)) / Math.max(1, mean(every.map((s) => s.damage))) - 1) : '-';
    });
    // Overall: each group weighted equally, so an era with more carriers is not favoured.
    const overall = mean(groups.map((g) => {
      const mine = mixed.filter((s) => s.era === era && s.group === g);
      const every = mixed.filter((s) => s.group === g);
      return mine.length ? mean(mine.map((s) => s.damage)) / Math.max(1, mean(every.map((s) => s.damage))) - 1 : 0;
    }));
    const mine = mixed.filter((s) => s.era === era);
    out(`${Math.abs(overall) > 0.25 ? '!' : ' '} ${pad(era, 10)}${cells.map((c) => lpad(c, 9)).join('')}${lpad(pct(overall), 9)}${lpad(`${Math.round(mean(mine.map((s) => (s.survived ? 1 : 0))) * 100)}%`, 8)}${lpad(mine.length, 6)}`);
  }

  // ------------------------------------------------------------- titans
  out();
  out('TITANS leading 7 AI ships against 10 (their own era)');
  const tRows = titan.map((r) => ({ r, t: r.ships.find((s) => s.group === 'TT') })).filter((x) => x.t);
  const tIds = [...new Set(tRows.map((x) => x.t.id))];
  const tStats = tIds.map((id) => {
    const xs = tRows.filter((x) => x.t.id === id);
    return { id, era: xs[0].t.era, n: xs.length, win: mean(xs.map((x) => (x.r.winner === 0 ? 1 : 0))), damage: mean(xs.map((x) => x.t.damage)), skill: xs.reduce((a, x) => a + x.t.skill, 0) / Math.max(1, xs.reduce((a, x) => a + x.t.damage, 0)), kills: mean(xs.map((x) => x.t.kills)), deaths: mean(xs.map((x) => x.t.deaths)) };
  });
  const tMed = median(tStats.map((t) => t.damage));
  out(`  overall win rate ${Math.round(mean(tRows.map((x) => (x.r.winner === 0 ? 1 : 0))) * 100)}% over ${tRows.length} battles; median titan damage ${k(tMed)}`);
  out(`  ${pad('titan', 16)}${pad('era', 10)}${lpad('win', 6)}${lpad('dmg', 9)}${lpad('vs med', 8)}${lpad('skill', 7)}${lpad('kills', 7)}${lpad('deaths', 7)}`);
  for (const t of tStats.sort((a, b) => b.damage - a.damage)) {
    const r = t.damage / Math.max(1, tMed) - 1;
    out(`${Math.abs(r) > 0.4 ? '!' : ' '} ${pad(t.id, 16)}${pad(t.era, 10)}${lpad(`${Math.round(t.win * 100)}%`, 6)}${lpad(k(t.damage), 9)}${lpad(pct(r), 8)}${lpad(`${Math.round(t.skill * 100)}%`, 7)}${lpad(t.kills.toFixed(1), 7)}${lpad(t.deaths.toFixed(1), 7)}`);
    if (Math.abs(r) > 0.4) out(`      skill damage per battle: ${skillSplit(titan, t.id)}`);
  }

  // ------------------------------------------------------------- soak
  out();
  out('SOAK');
  const errors = results.filter((r) => r.error);
  out(`  exceptions: ${errors.length}`);
  for (const e of errors.slice(0, 5)) out(`    ${JSON.stringify(e.job)}: ${e.error}`);
  const nan = results.flatMap((r) => r.nan);
  out(`  NaN positions: ${nan.length ? [...new Set(nan)].join(', ') : 'none'}`);
  const stuck = new Map();
  for (const r of results) for (const id of r.stuck) stuck.set(id, (stuck.get(id) ?? 0) + 1);
  const appear = new Map();
  for (const r of results) for (const s of new Set(r.ships.map((x) => x.id))) appear.set(s, (appear.get(s) ?? 0) + 1);
  const stuckList = [...stuck].map(([id, n]) => [id, n, appear.get(id) ?? n]).sort((a, b) => b[1] / b[2] - a[1] / a[2]);
  out(`  stuck over 60 s (battles stuck / battles sailed): ${stuckList.length ? '' : 'none'}`);
  for (const [id, n, of] of stuckList.slice(0, 15)) out(`    ${pad(id, 16)}${n}/${of}`);
  const lengths = line.map((r) => r.minutes);
  out(`  battle length: median ${median(lengths).toFixed(1)} min, longest ${Math.max(...lengths).toFixed(1)} min; time-outs ${line.filter((r) => r.reason === 'Time expired').length}/${line.length}`);
}

if (!isMainThread) {
  const { runnerImport } = await import('vite');
  await runnerImport(`${root}src/core/installDetMath.ts`);
  const { module } = await runnerImport(`${root}scripts/balanceSim.ts`);
  parentPort.on('message', (job) => parentPort.postMessage(module.runBattle(job)));
} else {
  await main();
}
