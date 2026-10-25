// Player preferences, remembered in this browser: controls, display and sound.

export type ShakeLevel = 0 | 0.5 | 1;

export interface ControlSettings {
  /** Mouse sensitivity multiplier (0.5..2). */
  sens: number;
  invertY: boolean;
  /** Camera shake: off, low or full. */
  shake: ShakeLevel;
}

export interface DisplaySettings {
  /** Colour-blind palette: green cues turn blue, enemy red turns vermilion. */
  colourBlind: boolean;
  /** The performance readout in battle (F3 toggles it too). */
  perf: boolean;
}

/** Volumes 0..1; effects and interface sounds are each a share of the master volume. */
export interface SoundSettings {
  master: number;
  effects: number;
  ui: number;
}

const unit = (v: unknown, fallback: number) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : fallback);

/** A preference record in localStorage: read once, validated field by field, written on change. */
function store<T extends object>(key: string, defaults: T, clean: (v: Partial<Record<keyof T, unknown>>) => T) {
  let current: T | null = null;
  const load = (): T => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        const v = JSON.parse(raw) as unknown;
        if (v && typeof v === 'object') return clean(v as Partial<Record<keyof T, unknown>>);
      }
    } catch {
      // Storage blocked or no window (tests): use the defaults.
    }
    return { ...defaults };
  };
  return {
    get: (): T => (current ??= load()),
    set: (patch: Partial<T>): void => {
      current = { ...(current ?? load()), ...patch };
      try {
        window.localStorage.setItem(key, JSON.stringify(current));
      } catch {
        // Not remembered, but still applies for this session.
      }
    },
  };
}

const controlStore = store<ControlSettings>('steel-tide.controls', { sens: 1, invertY: false, shake: 1 }, (v) => ({
  sens: typeof v.sens === 'number' && v.sens >= 0.5 && v.sens <= 2 ? v.sens : 1,
  invertY: v.invertY === true,
  shake: v.shake === 0 || v.shake === 0.5 ? v.shake : 1,
}));

const displayStore = store<DisplaySettings>('steel-tide.display', { colourBlind: false, perf: false }, (v) => ({
  colourBlind: v.colourBlind === true,
  perf: v.perf === true,
}));

const soundStore = store<SoundSettings>('steel-tide.sound', { master: 0.75, effects: 1, ui: 1 }, (v) => ({
  master: unit(v.master, 0.75),
  effects: unit(v.effects, 1),
  ui: unit(v.ui, 1),
}));

export const controls = controlStore.get;
export const setControls = controlStore.set;
export const display = displayStore.get;
export const setDisplay = displayStore.set;
export const sound = soundStore.get;
export const setSound = soundStore.set;
