// Reproducible comparison of the same code and seeds, with only this phase's balance tunings removed.
// Copies into temporary directories so the active workspace and browser battle are unaffected.
import { cpSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const runs = mkdtempSync(join(tmpdir(), 'steel-tide-balance-'));
const destination = process.argv[2] ?? join(root, 'docs/verification');
const battles = process.argv[3] ?? '16';
for (const variant of ['before', 'after']) {
  const dir = join(runs, variant);
  for (const name of ['src', 'scripts', 'server', 'package.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.node.json']) cpSync(join(root, name), join(dir, name), { recursive: true });
  symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'));
  if (variant === 'before') {
    const balance = join(dir, 'src/data/Balance.ts');
    let source = readFileSync(balance, 'utf8');
    for (const [from, to] of [['= 1.2;', '= 1;'], ['= 1.15;', '= 1;'], ['= 1.5;', '= 1;'], ['= 0.8;', '= 1;']]) source = source.replace(from, to);
    writeFileSync(balance, source);
    const ships = join(dir, 'src/data/ships.ts');
    writeFileSync(ships, readFileSync(ships, 'utf8').replace('s.main.traverse * 1.25', 's.main.traverse'));
  }
  console.log(`Running ${variant}: ${dir}`);
  const output = join(destination, `balance-${variant}.json`);
  const child = spawn(process.execPath, ['scripts/balance.mjs', '--battles', battles, '--titan-seeds', '1', '--json', output], { cwd: dir, stdio: 'inherit' });
  const code = await new Promise(resolve => child.on('exit', resolve));
  if (code !== 0) process.exit(code ?? 1);
}
console.log(`Matched results: ${destination}`);
