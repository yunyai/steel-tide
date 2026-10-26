// Graphics presets. The choice is remembered in this browser; `?q=ultralow|low|medium|high` overrides it.

export type QualityId = 'ultralow' | 'low' | 'medium' | 'high';

export interface Quality {
  id: QualityId;
  label: string;
  /** Upper limit on the device pixel ratio. */
  pixelRatio: number;
  /** Post-processing with bloom (otherwise the scene draws straight to the screen). */
  bloom: boolean;
  /** MSAA samples for the post-processing target. */
  samples: number;
  /** Sun shadow map size; 0 turns shadows off. */
  shadowMap: number;
  /** Haze multiplier: kept equal so every preset has the same combat view distance. */
  viewFog: number;
  /** Coarse sea: fewer vertices, one ripple layer, no sky reflection. */
  oceanLite: boolean;
  trees: boolean;
  /** Scale on particle counts for effects. */
  particles: number;
}

export const QUALITIES: Record<QualityId, Quality> = {
  ultralow: { id: 'ultralow', label: 'Ultra Low', pixelRatio: 1, bloom: false, samples: 0, shadowMap: 0, viewFog: 0.7, oceanLite: true, trees: false, particles: 0.5 },
  low: { id: 'low', label: 'Low', pixelRatio: 1.1, bloom: false, samples: 0, shadowMap: 0, viewFog: 0.7, oceanLite: true, trees: true, particles: 0.8 },
  medium: { id: 'medium', label: 'Medium', pixelRatio: 1.25, bloom: true, samples: 2, shadowMap: 1024, viewFog: 0.7, oceanLite: false, trees: true, particles: 1 },
  high: { id: 'high', label: 'High', pixelRatio: 2, bloom: true, samples: 4, shadowMap: 2048, viewFog: 0.7, oceanLite: false, trees: true, particles: 1 },
};

const KEY = 'steel-tide.quality';

const isId = (v: unknown): v is QualityId => typeof v === 'string' && v in QUALITIES;

function initial(): QualityId {
  try {
    const q = new URLSearchParams(window.location.search).get('q');
    if (isId(q)) return q;
  } catch {
    // No URL to read (tests).
  }
  try {
    const s = window.localStorage.getItem(KEY);
    if (isId(s)) return s;
  } catch {
    // Storage blocked: fall through to the default.
  }
  return 'high';
}

let current: QualityId | null = null;

export function quality(): Quality {
  current ??= initial();
  return QUALITIES[current];
}

export function setQuality(id: QualityId): void {
  current = id;
  try {
    window.localStorage.setItem(KEY, id);
  } catch {
    // Not remembered, but still applies for this session.
  }
}
