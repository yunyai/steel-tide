// Player control preferences, remembered in this browser.

export interface ControlSettings {
  /** Mouse sensitivity multiplier (0.5..2). */
  sens: number;
  invertY: boolean;
}

const KEY = 'steel-tide.controls';
const DEFAULTS: ControlSettings = { sens: 1, invertY: false };

let current: ControlSettings | null = null;

function load(): ControlSettings {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<ControlSettings>;
      return {
        sens: typeof v.sens === 'number' && v.sens >= 0.5 && v.sens <= 2 ? v.sens : DEFAULTS.sens,
        invertY: v.invertY === true,
      };
    }
  } catch {
    // Storage blocked or no window (tests): use the defaults.
  }
  return { ...DEFAULTS };
}

export function controls(): ControlSettings {
  current ??= load();
  return current;
}

export function setControls(patch: Partial<ControlSettings>): void {
  current = { ...controls(), ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Not remembered, but still applies for this session.
  }
}
