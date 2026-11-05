import { describe, expect, it } from 'vitest';
import { battleMenuChoices } from '../src/ui/Results';

// What the Esc sheet offers past Settings, for each kind of battle and seat.

describe('the battle menu', () => {
  const host = { host: true };
  const guest = { host: false };

  it('lets a Free play captain change ship, and whoever runs it end it', () => {
    expect(battleMenuChoices('freeplay', true, null)).toEqual(['Change ship', 'End battle']);
    expect(battleMenuChoices('freeplay', true, host)).toEqual(['Change ship', 'End battle']);
    expect(battleMenuChoices('freeplay', true, guest)).toEqual(['Change ship']);
  });

  it('lets the LAN host end a co-op run for everyone', () => {
    expect(battleMenuChoices('bossrush', true, host)).toEqual(['End run']);
    expect(battleMenuChoices('survival', true, host)).toEqual(['End run']);
  });

  it('leaves a co-op guest and a solo run with Leave alone', () => {
    expect(battleMenuChoices('bossrush', true, guest)).toEqual([]);
    expect(battleMenuChoices('survival', true, null)).toEqual([]);
    expect(battleMenuChoices('bossrush', true, null)).toEqual([]);
  });

  it('offers nothing more in a fleet battle', () => {
    expect(battleMenuChoices('domination', true, host)).toEqual([]);
    expect(battleMenuChoices('domination', true, null)).toEqual([]);
  });
});
