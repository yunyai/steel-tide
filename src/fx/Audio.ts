import { fleetCue, variantAsset } from './FleetAudio';
import type { ShipSpec, SkillSpec } from '../core/types';
import { Vector3 } from 'three';
import { sound } from '../input/Settings';
import { allAudioAssets, cueAsset, LOOP_ASSETS, recordedFallbacks, UI_ASSETS, worldAsset, worldCategory, type AudioBattleMode, type CueEvent, type CueFamily, type LoopKind, type SoundKind, type UiSound } from './SoundCues';
import { VoiceBudget, type AudioCategory } from './VoiceBudget';
export type { SoundKind, UiSound } from './SoundCues';

// Every audible source is a decoded recording. Filters, gain and pitch shape those recordings;
// no oscillators or generated noise remain, including when an asset is unavailable.
const SOUND_SPEED = 343 * 1.6;
const MAX_PENDING = 12;
interface PendingSound {
  urls: string[];
  key: string;
  priority: number;
  expires: number;
  generation: number;
  run(buffer: AudioBuffer): void;
}
interface LoopVoice { source: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode; stop(): void }
interface SampleOptions {
  bus: AudioNode;
  category: AudioCategory;
  priority: number;
  key: string;
  gain: number;
  rate?: number;
  delay?: number;
  pan?: number;
  cutoff?: number;
  duration?: number;
}

export class AudioEngine {
  private cueSequence = new Map<string,number>();
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private effects!: GainNode;
  private weapons!: GainNode;
  private abilities!: GainNode;
  private ambience!: GainNode;
  private uiBus!: GainNode;
  private budget = new VoiceBudget();
  private sources = new Set<AudioBufferSourceNode>();
  private buffers = new Map<string, AudioBuffer>();
  private fetches = new Map<string, Promise<ArrayBuffer | null>>();
  private loops = new Map<LoopKind, LoopVoice>();
  private pending: PendingSound[] = [];
  private loading: Promise<void> | null = null;
  private loaded = false;
  private failed = new Set<string>();
  private battleActive = false;
  private battleMode: AudioBattleMode = 'naval';
  private generation = 0;
  private engineLevel = 0;
  private duckUntil = 0;
  muted = false;
  listeners: Vector3[] = [];
  right = new Vector3(1, 0, 0);

  /** Fetch before the first gesture; decoding still waits for the unlocked AudioContext. */
  prepare(): Promise<void> {
    for (const url of allAudioAssets()) {
      if (this.fetches.has(url)) continue;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      this.fetches.set(url, fetch(url, { signal: controller.signal })
        .then(r => r.ok ? r.arrayBuffer() : null).catch(() => null).finally(() => clearTimeout(timer)));
    }
    return Promise.all(this.fetches.values()).then(() => {});
  }

  /** Must be called from a user gesture. Safe before or after a battle starts. */
  init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume().then(() => this.ensureLoops()).catch(() => {});
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    const limiter = ctx.createWaveShaper();
    const curve = new Float32Array(2049);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i / (curve.length - 1)) * 2 - 1) * 1.4) * 0.92;
    limiter.curve = curve;
    limiter.oversample = '4x';
    comp.connect(limiter).connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(comp);
    this.effects = ctx.createGain();
    this.effects.connect(this.master);
    this.weapons = ctx.createGain();
    this.weapons.connect(this.effects);
    this.abilities = ctx.createGain();
    this.abilities.connect(this.effects);
    this.ambience = ctx.createGain();
    this.ambience.connect(this.effects);
    this.uiBus = ctx.createGain();
    this.uiBus.connect(this.master);
    this.applySound();
    void this.prepare();
    this.loading = Promise.all([...this.fetches].map(async ([url, request]) => {
      const data = await request;
      if (!data) { this.failed.add(url); this.flushPending(); this.ensureLoops(); return; }
      try {
        this.buffers.set(url, await ctx.decodeAudioData(data.slice(0)));
        this.flushPending();
        this.ensureLoops();
      } catch { this.failed.add(url); this.flushPending(); this.ensureLoops(); }
    })).then(() => {
      this.loaded = true;
      this.flushPending();
      this.ensureLoops();
    });
  }

  /** After init, waits until every asset has decoded or failed. */
  ready(): Promise<void> { return this.loading ?? this.prepare(); }

  beginBattle(mode: AudioBattleMode = 'naval'): void {
    this.stopBattle();
    this.battleMode = mode;
    this.battleActive = true;
    this.engineLevel = 0;
    this.ensureLoops();
  }

  stopBattle(): void {
    this.cueSequence.clear();
    this.battleActive = false;
    this.generation++;
    this.pending = [];
    this.budget.clear();
    for (const loop of [...this.loops.values()]) loop.stop();
    for (const source of this.sources) { try { source.stop(); } catch { /* Already ended. */ } source.disconnect(); }
    this.sources.clear();
    this.loops.clear();
    this.duckUntil = 0;
    this.applySound();
  }

  applySound(): void {
    if (!this.ctx || this.ctx.state === 'closed') return;
    const v = sound();
    this.master.gain.value = this.muted ? 0 : v.master;
    this.effects.gain.value = v.effects;
    this.weapons.gain.value = v.weapons;
    this.abilities.gain.value = v.abilities;
    const t = this.ctx.currentTime;
    const ducked = this.duckUntil > t;
    this.ambience.gain.cancelScheduledValues(t);
    this.ambience.gain.setTargetAtTime(v.ambience * (ducked ? 0.28 : 1), t, 0.03);
    // Audio-time automation pauses and resumes with the context, including on system sleep.
    if (ducked) this.ambience.gain.setTargetAtTime(v.ambience, this.duckUntil, 0.12);
    this.uiBus.gain.value = v.ui;
  }

  toggleMute(): void { this.muted = !this.muted; this.applySound(); }

  private duck(): void {
    if (!this.ctx) return;
    this.duckUntil = this.ctx.currentTime + 1.8;
    this.applySound();
  }

  private bufferFor(urls: string[]): AudioBuffer | undefined {
    for (const url of urls) { const b = this.buffers.get(url); if (b) return b; }
    return undefined;
  }

  private request(url: string, category: AudioCategory, priority: number, key: string, run: (buffer: AudioBuffer) => void, queue = true): void {
    const urls = recordedFallbacks(category, url);
    const buffer = this.buffers.get(url) ?? (this.loaded || this.failed.has(url) ? this.bufferFor(urls) : undefined);
    if (buffer) { run(buffer); return; }
    if (!queue || this.loaded || category === 'weapon' && priority < 2) return;
    const now = performance.now();
    this.pending = this.pending.filter(p => p.expires > now && p.generation === this.generation);
    if (this.pending.some(p => p.key === key)) return;
    if (this.pending.length >= MAX_PENDING) {
      const lowest = this.pending.reduce((a, b) => a.priority <= b.priority ? a : b);
      if (lowest.priority >= priority) return;
      this.pending = this.pending.filter(p => p !== lowest);
    }
    this.pending.push({ urls, key, priority, generation: this.generation, expires: now + (category === 'ui' ? 1000 : category === 'ability' ? 350 : 200), run });
  }

  private flushPending(): void {
    const now = performance.now();
    const waiting = this.pending;
    this.pending = [];
    for (const p of waiting) {
      if (p.generation !== this.generation || p.expires <= now || this.ctx?.state !== 'running') continue;
      const primary = p.urls[0];
      const buffer = this.buffers.get(primary) ?? (this.loaded || this.failed.has(primary) ? this.bufferFor(p.urls) : undefined);
      if (buffer) p.run(buffer);
      else if (!this.loaded) this.pending.push(p);
    }
  }

  private ensureLoops(): void {
    if (!this.battleActive || this.ctx?.state !== 'running') return;
    const ambient: LoopKind = this.battleMode === 'naval' ? 'sea' : 'wind';
    const engine: LoopKind = this.battleMode === 'naval' ? 'navalEngine' : 'groundEngine';
    this.startLoop(ambient, this.buffers.get(LOOP_ASSETS[ambient]), 0.38);
    // The two engine recordings are suitable recorded fallbacks for each other.
    const primary = LOOP_ASSETS[engine];
    const fallback = this.loaded || this.failed.has(primary) ? this.buffers.get(LOOP_ASSETS[engine === 'navalEngine' ? 'groundEngine' : 'navalEngine']) : undefined;
    this.startLoop(engine, this.buffers.get(primary) ?? fallback, 0);
    this.updateEngine();
  }

  private startLoop(kind: LoopKind, buffer: AudioBuffer | undefined, volume: number): void {
    if (!buffer || !this.ctx || this.loops.has(kind)) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = kind === 'sea' || kind === 'wind' ? 12000 : 1000;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, this.ctx.currentTime);
    gain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.3);
    source.connect(filter).connect(gain).connect(this.ambience);
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      try { source.stop(); } catch { /* Not started or already ended. */ }
      source.disconnect(); filter.disconnect(); gain.disconnect();
      this.sources.delete(source); this.loops.delete(kind);
    };
    source.onended = stop;
    this.sources.add(source);
    this.loops.set(kind, { source, filter, gain, stop });
    source.start();
  }

  engine(level: number): void { this.engineLevel = Math.max(0, Math.min(1, level)); this.updateEngine(); }

  private updateEngine(): void {
    if (!this.ctx) return;
    const loop = this.loops.get(this.battleMode === 'naval' ? 'navalEngine' : 'groundEngine');
    if (!loop) return;
    const t = this.ctx.currentTime;
    loop.gain.gain.setTargetAtTime(0.12 + this.engineLevel * 0.55, t, 0.3);
    loop.source.playbackRate.setTargetAtTime(0.78 + this.engineLevel * 0.48, t, 0.4);
    loop.filter.frequency.setTargetAtTime(500 + this.engineLevel * 1400, t, 0.4);
  }

  private nearest(x: number, y: number, z: number): { d: number; pan: number } {
    let d = Infinity, pan = 0;
    for (const l of this.listeners) {
      const dx = x - l.x, dy = y - l.y, dz = z - l.z;
      const distance = Math.hypot(dx, dy, dz);
      if (distance >= d) continue;
      d = distance;
      if (this.listeners.length === 1 && d > 1) pan = (dx * this.right.x + dz * this.right.z) / d;
    }
    return { d: d === Infinity ? 0 : d, pan };
  }

  /** One decoded recording per voice, with physical attenuation and a short bounded delay. */
  play(kind: SoundKind, x: number, y: number, z: number, size = 100, gain = 1, options: { category?: AudioCategory; priority?: number; asset?: string; rate?: number; key?: string; transient?: boolean; duration?: number } = {}): void {
    if (!this.ctx || !this.battleActive || this.muted || this.ctx.state !== 'running') return;
    const { d, pan } = this.nearest(x, y, z);
    const c = size / 1000;
    const reach = kind === 'gun' ? 900 + c * 9000 : kind === 'explosion' ? 2500 * Math.max(0.5, size) : kind === 'splash' ? 400 + c * 3000 : 1500;
    const vol = gain / (1 + Math.pow(d / reach, 1.5));
    if (vol < 0.015) return;
    const category = options.category ?? worldCategory(kind);
    const priority = options.priority ?? (d < 700 ? 2 : vol > 0.25 ? 1 : 0);
    const key = options.key ?? `${kind}:${Math.floor(x / 500)}:${Math.floor(z / 500)}`;
    const generation = this.generation;
    this.request(options.asset ?? worldAsset(kind, size), category, priority, key, buffer => {
      if (!this.battleActive || generation !== this.generation || this.muted) return;
      this.sample(buffer, {
        bus: category === 'ability' ? this.abilities : this.weapons, category, priority, key, gain: vol,
        pan: Math.max(-1, Math.min(1, pan * 0.8)), cutoff: Math.max(260, 14000 / (1 + d / 900)),
        delay: priority >= 2 ? Math.min(0.08, d / SOUND_SPEED) : Math.min(0.35, d / SOUND_SPEED),
        rate: options.rate ?? (kind === 'explosion' ? size < 0.7 ? 1.15 : size > 2 ? 0.85 : 1 : 1),
        duration: options.duration ?? ((kind === 'laser' || kind === 'charge') && size < 20 ? Math.max(0.2, Math.min(12, size)) : undefined),
      });
    }, !options.transient);
  }

  shipCue(ship:ShipSpec,skill:SkillSpec,x:number,y:number,z:number,local=false):boolean {
    const cue=fleetCue(ship,skill);if(!cue)return false;
    const key=`${ship.id}:${skill.id}`,seq=this.cueSequence.get(key)??0;this.cueSequence.set(key,seq+1);
    this.play(cue.kind,x,y,z,cue.kind==='explosion'?2:100,local?cue.gain:cue.gain*.6,{category:'ability',priority:local?3:1,asset:variantAsset(cue.assets,seq),rate:cue.rate+(seq%3-1)*.025});return true;
  }

  cue(ability: string, event: CueEvent, family: CueFamily, x: number, y: number, z: number, local = false): void {
    const kind: Record<CueFamily, SoundKind> = { charge: 'charge', impact: 'explosion', beam: 'laser', slash: 'zap', transform: 'thunder' };
    this.play(kind[family], x, y, z, family === 'charge' || family === 'beam' ? 1.2 : 2, local ? 0.8 : 0.45, { category: 'ability', priority: local ? 3 : 1, asset: cueAsset(ability, event, family) });
  }

  ui(kind: UiSound): void {
    if (!this.ctx || this.muted || this.ctx.state !== 'running') return;
    const ability = ['ability', 'ult', 'shift', 'unshift'].includes(kind);
    const category = ability ? 'ability' : 'ui';
    const priority = ['alarm', 'siren', 'warning', 'heartbeat'].includes(kind) ? 3 : ability ? 2 : 1;
    const generation = this.generation;
    this.request(UI_ASSETS[kind], category, priority, `ui:${kind}`, buffer => {
      if (generation !== this.generation || this.muted) return;
      this.sample(buffer, { bus: ability ? this.abilities : this.uiBus, category, priority, key: `ui:${kind}`, gain: 0.8 });
    });
  }

  private sample(buffer: AudioBuffer, o: SampleOptions): void {
    const ctx = this.ctx!;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const rate = o.rate ?? 1;
    source.playbackRate.value = rate;
    const natural = buffer.duration / rate;
    const duration = o.duration ?? natural;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    if (duration > natural) { source.loop = true; source.loopStart = Math.min(.03, buffer.duration * .05); source.loopEnd = buffer.duration; }
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = o.cutoff ?? 20000;
    const gain = ctx.createGain();
    const fade = Math.min(.025, duration * .2);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(o.gain, t0 + fade);
    gain.gain.setValueAtTime(o.gain, t0 + Math.max(fade, duration - fade));
    gain.gain.linearRampToValueAtTime(0, t0 + duration);
    const panner = ctx.createStereoPanner();
    panner.pan.value = o.pan ?? 0;
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      try { source.stop(); } catch { /* Not started or already ended. */ }
      source.disconnect(); filter.disconnect(); gain.disconnect(); panner.disconnect();
      this.sources.delete(source); this.budget.release(stop);
    };
    if (!this.budget.admit(o.category, ctx.currentTime, (o.delay ?? 0) + duration, o.priority, o.key, stop)) { stop(); return; }
    source.connect(filter).connect(gain).connect(panner).connect(o.bus);
    source.onended = stop;
    this.sources.add(source);
    if (o.category === 'ability' && o.priority >= 2) this.duck();
    source.start(t0);
    source.stop(t0 + duration);
  }
}

export const audio = new AudioEngine();
