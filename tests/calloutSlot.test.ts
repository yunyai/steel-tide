import { describe, expect, it } from 'vitest';
import { CalloutSlot } from '../src/ui/CalloutSlot';

function slot() {
  const shown: string[] = [];
  return { shown, s: new CalloutSlot<string>((c) => shown.push(c)) };
}

describe('CalloutSlot', () => {
  it('shows a plain callout at once, replacing the one before', () => {
    const { shown, s } = slot();
    s.push('Wave 3', 10);
    s.push('Ultimate ready', 10.5);
    expect(shown).toEqual(['Wave 3', 'Ultimate ready']);
  });

  it('holds a held callout: one arriving meanwhile waits, then shows when the hold ends', () => {
    const { shown, s } = slot();
    s.push('JACKPOT', 10, 1.6);
    s.push('Ultimate ready', 10);
    s.update(11);
    expect(shown).toEqual(['JACKPOT']);
    s.update(11.6);
    expect(shown).toEqual(['JACKPOT', 'Ultimate ready']);
    s.update(12);
    expect(shown).toEqual(['JACKPOT', 'Ultimate ready']);
  });

  it('keeps only the newest waiting callout', () => {
    const { shown, s } = slot();
    s.push('JACKPOT', 0, 1.6);
    s.push('Double kill', 0.5);
    s.push('Triple kill', 1);
    s.update(2);
    expect(shown).toEqual(['JACKPOT', 'Triple kill']);
  });

  it('lets a held callout replace one still held', () => {
    const { shown, s } = slot();
    s.push('JACKPOT', 0, 1.6);
    s.push('JACKPOT again', 1, 1.6);
    s.push('Ultimate ready', 2);
    s.update(2.5);
    expect(shown).toEqual(['JACKPOT', 'JACKPOT again']);
    s.update(2.6);
    expect(shown).toEqual(['JACKPOT', 'JACKPOT again', 'Ultimate ready']);
  });
});
