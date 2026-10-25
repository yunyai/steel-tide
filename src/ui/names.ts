import type { Ship } from '../ships/Ship';

/**
 * A ship as the interface names it: the class name for AI ships (transports keep their own
 * names), the captain as well when a friend sails it in a LAN battle, and "(you)" on your own.
 */
export function captainName(s: Ship, me: Ship | null = null): string {
  // The hull's own name, even mid Titan Shift: the captain is the character, not the form.
  const ship = s.base.cls === 'AK' ? s.name : s.base.name;
  if (s === me) return `${ship} (you)`;
  if (s.humanIndex >= 0 && s.game.config.mode === 'lan') return `${s.name} (${ship})`;
  return ship;
}
