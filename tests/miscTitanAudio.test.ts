import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { miscSound } from '../src/fx/MiscTitanAudio';
import type { JudgeFxKind } from '../src/skills/misc/MiscEvents';

// Every misc titan effect that should be heard maps to one of the packaged recordings.

const JUDGE_KINDS: JudgeFxKind[] = ['court', 'cite', 'gavelThrow', 'gavelHit', 'contempt', 'arrest', 'taxes', 'objection', 'martial', 'warn', 'verdict', 'death'];

describe('Misc titan sounds', () => {
  it.each(JUDGE_KINDS)('give the Judge’s %s a packaged recording', (kind) => {
    const s = miscSound(kind);
    expect(s).not.toBeNull();
    expect(existsSync(`public/audio/${s!.asset}.m4a`)).toBe(true);
    expect(s!.gain).toBeGreaterThan(0);
  });

  it('make the Verdict and the Death Penalty the loudest Judge moments', () => {
    const loud = Math.min(miscSound('verdict')!.gain, miscSound('death')!.gain);
    for (const k of JUDGE_KINDS) if (k !== 'verdict' && k !== 'death') expect(miscSound(k)!.gain).toBeLessThan(loud);
  });

  it('leave battery hits to the gun sounds', () => {
    expect(miscSound('gunHit')).toBeNull();
    expect(miscSound('gunLand')).toBeNull();
  });
});
