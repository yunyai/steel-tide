import { RUSH_KNOBS, RUSH_PRESET_IDS, RUSH_PRESET_LABEL, RUSH_WAVES, describeKnobs, rushKnobs, type RushDifficulty, type RushKnobs, type RushPreset } from '../modes/RushDifficulty';
import { field, h, seg, stepper } from './dom';

// The Boss Rush difficulty picker, shared by the solo orders screen and the LAN lobby: four
// presets, or Custom with a stepper per knob. Survival has no titans, so it leaves those out.

export interface RushDifficultyOptions {
  get(): RushDifficulty | undefined;
  /** Normal is `undefined`. */
  set(d: RushDifficulty | undefined): void;
  survival(): boolean;
  click(): void;
  /** Custom knobs remembered across a switch to a preset and back. */
  memory?: { custom: RushKnobs | null };
  /** Prefix of the controls' data-k keys, which keep focus across a re-render. */
  key?: string;
  /** After every change, for notes that depend on the difficulty. */
  changed?(): void;
}

/** What a difficulty plays like, in a sentence. */
export function rushDifficultyNote(d: RushDifficulty | undefined, survival: boolean): string {
  return (d?.preset ?? 'normal') === 'normal'
    ? `The Boss Rush as built: waves 1 to ${RUSH_WAVES} as they have always been, then endless waves that keep climbing.`
    : describeKnobs(rushKnobs(d), !survival);
}

/** The Difficulty field and its Custom knobs; `refresh` lays the knobs out again after a switch of run. */
export function rushDifficultyControl(o: RushDifficultyOptions): { fields: HTMLElement[]; refresh(): void } {
  const memory = o.memory ?? { custom: null };
  const key = o.key ?? 'rush';
  const presetOf = (): RushPreset | 'custom' => o.get()?.preset ?? 'normal';
  const knobs = h('div', { class: 'rush-knobs', role: 'group', 'aria-label': 'Custom difficulty' });
  const note = h('p', { class: 'note' });
  const sync = () => {
    knobs.hidden = presetOf() !== 'custom';
    note.textContent = rushDifficultyNote(o.get(), o.survival());
    o.changed?.();
  };
  const custom = () => {
    const k = (memory.custom ??= rushKnobs(o.get()));
    knobs.replaceChildren(
      ...RUSH_KNOBS.filter((s) => !o.survival() || (s.key !== 'bossEvery' && s.key !== 'maxTitans')).map((s) =>
        field(
          s.label,
          stepper(s.label, () => k[s.key], (v) => {
            k[s.key] = v;
            o.set({ preset: 'custom', custom: { ...k } });
            sync();
          }, s, o.click, `${key}-${s.key}`),
        ),
      ),
    );
  };
  const refresh = () => {
    if (presetOf() === 'custom') custom();
    sync();
  };
  const difficulty = field(
    'Difficulty',
    seg<RushPreset | 'custom'>(
      [...RUSH_PRESET_IDS, 'custom' as const].map((v) => ({ value: v, label: RUSH_PRESET_LABEL[v] })),
      presetOf,
      (v) => {
        if (v === 'custom') {
          memory.custom ??= rushKnobs(o.get());
          o.set({ preset: 'custom', custom: { ...memory.custom } });
          custom();
        } else o.set(v === 'normal' ? undefined : { preset: v });
        sync();
      },
      o.click,
      o.key ? `${o.key}-difficulty` : '',
    ),
    note,
  );
  refresh();
  return { fields: [difficulty, knobs], refresh };
}
