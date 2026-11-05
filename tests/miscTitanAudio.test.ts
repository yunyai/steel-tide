import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { miscSound } from '../src/fx/MiscTitanAudio';
import type { FaultFxKind, GourmandFxKind, HexFxKind, JudgeFxKind } from '../src/skills/misc/MiscEvents';

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

  const HEX_KINDS: HexFxKind[] = ['pin', 'stitch', 'twist', 'fire', 'ignite', 'rip', 'erupt', 'substitute', 'decoyBurst', 'coven', 'needle', 'unmake', 'tear'];

  it.each(HEX_KINDS)('give the Hexweaver’s %s a packaged recording', (kind) => {
    const s = miscSound(kind);
    expect(s).not.toBeNull();
    expect(existsSync(`public/audio/${s!.asset}.m4a`)).toBe(true);
    expect(s!.gain).toBeGreaterThan(0);
  });

  it('make the Unmaking the loudest Hexweaver moment and let the rain of needles share a voice', () => {
    const loud = miscSound('unmake')!.gain;
    for (const k of HEX_KINDS) if (k !== 'unmake') expect(miscSound(k)!.gain).toBeLessThan(loud);
    expect(miscSound('needle')!.gap).toBeGreaterThan(0);
  });

  const GOURMAND_KINDS: GourmandFxKind[] = ['devour', 'gulp', 'chomp', 'carve', 'slice', 'cooker', 'cookerBurst', 'skewer', 'serve', 'side', 'plate', 'comfort', 'burp', 'banquet', 'bite', 'swallow', 'spit', 'fuse', 'catastrophe'];

  it.each(GOURMAND_KINDS)('give the Gourmand’s %s a packaged recording', (kind) => {
    const s = miscSound(kind);
    expect(s).not.toBeNull();
    expect(existsSync(`public/audio/${s!.asset}.m4a`)).toBe(true);
    expect(s!.gain).toBeGreaterThan(0);
  });

  it('make the Kitchen Catastrophe the loudest Gourmand moment and let rapid bites share a voice', () => {
    const loud = miscSound('catastrophe')!.gain;
    for (const k of GOURMAND_KINDS) if (k !== 'catastrophe') expect(miscSound(k)!.gain).toBeLessThan(loud);
    for (const k of ['gulp', 'chomp', 'slice', 'side'] as const) expect(miscSound(k)!.gap).toBeGreaterThan(0);
  });

  const FAULT_KINDS: FaultFxKind[] = ['fracture', 'rupture', 'uplift', 'subduct', 'crush', 'slip', 'boulder', 'bedrock', 'rebound', 'caldera', 'eruption', 'worldbreaker', 'collapse', 'crumble'];

  it.each(FAULT_KINDS)('give the Faultline’s %s a packaged recording', (kind) => {
    const s = miscSound(kind);
    expect(s).not.toBeNull();
    expect(existsSync(`public/audio/${s!.asset}.m4a`)).toBe(true);
    expect(s!.gain).toBeGreaterThan(0);
  });

  it('make Worldbreaker the loudest Faultline moment and let rapid pulses and boulders share a voice', () => {
    const loud = miscSound('worldbreaker')!.gain;
    for (const k of FAULT_KINDS) if (k !== 'worldbreaker') expect(miscSound(k)!.gain).toBeLessThan(loud);
    for (const k of ['fracture', 'rupture', 'boulder', 'collapse', 'crumble'] as const) expect(miscSound(k)!.gap).toBeGreaterThan(0);
  });

  it('leave the galley mortar’s dishes to the gun sounds', () => {
    expect(miscSound('dish')).toBeNull();
  });

  it('leave battery hits to the gun sounds', () => {
    expect(miscSound('gunHit')).toBeNull();
    expect(miscSound('gunLand')).toBeNull();
  });
});
