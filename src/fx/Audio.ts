import { Vector3 } from 'three';
import { sound } from '../input/Settings';

// Procedural WebAudio sound: no asset files. Distance attenuation, air
// absorption (low-pass) and speed-of-sound delay, so far salvos rumble late.

export type SoundKind = 'gun' | 'explosion' | 'splash' | 'hit' | 'torpedo' | 'missile' | 'flak' | 'depth' | 'zap' | 'thunder' | 'laser' | 'nuke' | 'shield' | 'charge' | 'ricochet' | 'collapse';

export type UiSound =
  | 'click'
  | 'ribbon'
  | 'alarm'
  | 'ability'
  | 'ult'
  | 'capture'
  | 'victory'
  | 'defeat'
  | 'citadel'
  | 'warning'
  | 'pickup'
  | 'siren'
  | 'horn'
  | 'heartbeat'
  | 'ultReady'
  | 'streak'
  | 'shift'
  | 'unshift';

const SOUND_SPEED = 343 * 1.6;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  /** World sounds, the sea and the engine. */
  private effects!: GainNode;
  /** Interface sounds. */
  private uiBus!: GainNode;
  private noise!: AudioBuffer;
  private brown!: AudioBuffer;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private voices = 0;
  muted = false;
  /** Listener positions (one per viewport). */
  listeners: Vector3[] = [];
  /** Listener right vector when there is a single viewport (for panning). */
  right = new Vector3(1, 0, 0);

  /** Must be called from a user gesture. */
  init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(comp);
    this.effects = ctx.createGain();
    this.effects.connect(this.master);
    this.uiBus = ctx.createGain();
    this.uiBus.connect(this.master);
    this.applySound();

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      b[i] = last * 3.5;
    }
    this.startAmbience();
  }

  /** Take up the volumes from the sound settings. */
  applySound(): void {
    if (!this.ctx) return;
    const v = sound();
    this.master.gain.value = this.muted ? 0 : v.master;
    this.effects.gain.value = v.effects;
    this.uiBus.gain.value = v.ui;
  }

  toggleMute(): void {
    this.muted = !this.muted;
    this.applySound();
  }

  private startAmbience(): void {
    const ctx = this.ctx!;
    const sea = ctx.createBufferSource();
    sea.buffer = this.brown;
    sea.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 380;
    const g = ctx.createGain();
    g.gain.value = 0.12;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lg = ctx.createGain();
    lg.gain.value = 0.06;
    lfo.connect(lg).connect(g.gain);
    sea.connect(f).connect(g).connect(this.effects);
    sea.start();
    lfo.start();

    const eng = ctx.createBufferSource();
    eng.buffer = this.brown;
    eng.loop = true;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 120;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    eng.connect(this.engineFilter).connect(this.engineGain).connect(this.effects);
    eng.start();
  }

  /** Engine rumble for the local player(s), 0..1. */
  engine(level: number): void {
    if (!this.ctx || !this.engineGain || !this.engineFilter) return;
    const t = this.ctx.currentTime;
    this.engineGain.gain.setTargetAtTime(0.05 + level * 0.25, t, 0.4);
    this.engineFilter.frequency.setTargetAtTime(90 + level * 160, t, 0.4);
  }

  private nearest(x: number, y: number, z: number): { d: number; pan: number } {
    let best = Infinity;
    let pan = 0;
    for (const l of this.listeners) {
      const dx = x - l.x;
      const dy = y - l.y;
      const dz = z - l.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < best) {
        best = d;
        if (this.listeners.length === 1 && d > 1) pan = (dx * this.right.x + dz * this.right.z) / d;
      }
    }
    return { d: best === Infinity ? 0 : best, pan };
  }

  /** Spatial one-shot. `size` is calibre in mm for guns/splashes, scale for explosions. */
  play(kind: SoundKind, x: number, y: number, z: number, size = 100, gain = 1): void {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    const { d, pan } = this.nearest(x, y, z);
    const c = size / 1000;
    const reach = kind === 'gun' ? 900 + c * 9000 : kind === 'explosion' ? 2500 * Math.max(0.5, size) : kind === 'splash' ? 400 + c * 3000 : 1500;
    const vol = gain / (1 + Math.pow(d / reach, 1.5));
    if (vol < 0.015) return;
    if (this.voices > 40 && vol < 0.25) return;
    const t0 = ctx.currentTime + Math.min(4, d / SOUND_SPEED);
    const air = ctx.createBiquadFilter();
    air.type = 'lowpass';
    air.frequency.value = Math.max(260, 14000 / (1 + d / 900));
    const out = ctx.createGain();
    out.gain.value = vol;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan * 0.8));
    air.connect(out).connect(panner).connect(this.effects);
    let dur = 1;
    switch (kind) {
      case 'gun':
        dur = 0.4 + c * 2.8;
        this.burst(air, t0, 'lowpass', 400 + 2200 * (1 - Math.min(1, c * 2)), 0.002, dur * 0.6, 1.1);
        this.thump(air, t0, 95 - c * 90, 32, 0.9, dur);
        break;
      case 'explosion':
        dur = 1.6 + size * 0.5;
        this.burst(air, t0, 'lowpass', 700, 0.01, dur, 1.3);
        this.thump(air, t0, 60, 25, 1.2, dur * 0.8);
        break;
      case 'splash':
        dur = 0.6 + c * 1.6;
        this.burst(air, t0, 'bandpass', 700 + 900 * (1 - c), 0.04, dur, 0.8);
        break;
      case 'hit':
        dur = 0.5;
        this.burst(air, t0, 'highpass', 1400, 0.001, 0.25, 0.9);
        this.tone(air, t0, 'triangle', 380 + Math.random() * 200, 0.4, 0.35);
        this.thump(air, t0, 80, 40, 0.6, 0.4);
        break;
      case 'torpedo':
        dur = 0.8;
        this.thump(air, t0, 140, 50, 0.7, 0.5);
        this.burst(air, t0 + 0.05, 'bandpass', 1800, 0.05, 0.7, 0.4);
        break;
      case 'missile':
        dur = 2.5;
        this.burst(air, t0, 'bandpass', 1200, 0.2, 2.4, 0.7);
        break;
      case 'flak':
        dur = 0.4;
        this.burst(air, t0, 'lowpass', 1600, 0.001, 0.35, 0.6);
        break;
      case 'depth':
        dur = 1.8;
        this.thump(air, t0, 50, 22, 1.3, 1.6);
        this.burst(air, t0 + 0.1, 'lowpass', 500, 0.08, 1.6, 0.7);
        break;
      case 'zap':
        dur = 0.3;
        this.tone(air, t0, 'sawtooth', 1800, 0.25, 0.18, 300);
        this.burst(air, t0, 'highpass', 3000, 0.001, 0.12, 0.4);
        break;
      case 'thunder':
        dur = 1.6;
        this.burst(air, t0, 'highpass', 2200, 0.001, 0.18, 1.1);
        this.burst(air, t0 + 0.05, 'lowpass', 900, 0.02, 1.4, 1.0);
        this.thump(air, t0, 70, 30, 0.8, 1.2);
        break;
      case 'laser':
        // `size` is the beam's duration in seconds: a hum that holds, then dies.
        dur = size + 0.6;
        this.tone(air, t0, 'sawtooth', 110, 0.22, dur, 90);
        this.tone(air, t0, 'square', 220, 0.08, dur, 180);
        this.burst(air, t0, 'bandpass', 2600, 0.05, dur, 0.35);
        break;
      case 'charge':
        dur = Math.max(0.5, size);
        this.tone(air, t0, 'sawtooth', 80, 0.18, dur, 900);
        this.tone(air, t0, 'sine', 160, 0.2, dur, 1800);
        break;
      case 'nuke':
        dur = 5;
        this.thump(air, t0, 45, 16, 1.6, 4.5);
        this.burst(air, t0, 'lowpass', 400, 0.05, 4.8, 1.5);
        this.burst(air, t0 + 0.3, 'bandpass', 900, 0.4, 3, 0.6);
        break;
      case 'ricochet':
        // A whine off the plate as the round skips away.
        dur = 0.6;
        this.burst(air, t0, 'highpass', 2400, 0.001, 0.08, 0.8);
        this.tone(air, t0, 'sine', 2600 + Math.random() * 900, 0.25, 0.55, 900);
        break;
      case 'collapse':
        // `size` scales the building: a long grinding roar of masonry.
        dur = 2.2 + size * 0.6;
        this.thump(air, t0, 55, 24, 1.1, dur * 0.6);
        this.burst(air, t0, 'lowpass', 500, 0.08, dur, 1.2);
        this.burst(air, t0 + 0.25, 'bandpass', 1300, 0.3, dur * 0.7, 0.45);
        break;
      case 'shield':
        dur = 0.5;
        this.tone(air, t0, 'sine', 1400, 0.2, 0.35, 700);
        this.tone(air, t0, 'triangle', 2100, 0.08, 0.25);
        break;
    }
    this.voices++;
    window.setTimeout(() => {
      this.voices--;
      out.disconnect();
    }, (t0 - ctx.currentTime + dur + 0.3) * 1000);
  }

  private burst(dest: AudioNode, t0: number, type: BiquadFilterType, freq: number, attack: number, decay: number, peak: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = type === 'bandpass' ? 0.8 : 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + attack + decay);
    src.connect(f).connect(g).connect(dest);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + attack + decay + 0.05);
  }

  private thump(dest: AudioNode, t0: number, f0: number, f1: number, peak: number, decay: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(Math.max(20, f0), t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(18, f1), t0 + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + decay);
    o.connect(g).connect(dest);
    o.start(t0);
    o.stop(t0 + decay + 0.05);
  }

  private tone(dest: AudioNode, t0: number, type: OscillatorType, freq: number, peak: number, decay: number, freq1 = freq): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (freq1 !== freq) o.frequency.exponentialRampToValueAtTime(freq1, t0 + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + decay);
    o.connect(g).connect(dest);
    o.start(t0);
    o.stop(t0 + decay + 0.05);
  }

  /** Non-spatial interface sounds. */
  ui(kind: UiSound): void {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.value = 0.5;
    g.connect(this.uiBus);
    switch (kind) {
      case 'click':
        this.tone(g, t, 'sine', 900, 0.15, 0.06);
        break;
      case 'ribbon':
        this.tone(g, t, 'sine', 1320, 0.12, 0.12);
        break;
      case 'citadel':
        this.tone(g, t, 'triangle', 880, 0.2, 0.12);
        this.tone(g, t + 0.08, 'triangle', 1320, 0.2, 0.2);
        break;
      case 'alarm':
        for (let i = 0; i < 3; i++) this.tone(g, t + i * 0.18, 'square', i % 2 ? 660 : 880, 0.08, 0.14);
        break;
      case 'warning':
        this.tone(g, t, 'sawtooth', 220, 0.08, 0.3, 180);
        break;
      case 'ability':
        this.tone(g, t, 'sawtooth', 160, 0.12, 0.9, 720);
        this.tone(g, t + 0.05, 'sine', 320, 0.2, 1.0, 1100);
        this.burst(g, t, 'bandpass', 1500, 0.3, 0.8, 0.25);
        break;
      case 'ult':
        this.tone(g, t, 'sawtooth', 90, 0.16, 1.4, 900);
        this.tone(g, t + 0.05, 'sine', 220, 0.22, 1.5, 1760);
        this.thump(g, t + 0.1, 70, 30, 0.6, 1.2);
        this.burst(g, t, 'bandpass', 1800, 0.4, 1.1, 0.3);
        break;
      case 'pickup':
        [880, 1175, 1568].forEach((f, i) => this.tone(g, t + i * 0.06, 'triangle', f, 0.14, 0.25));
        break;
      case 'siren':
        for (let i = 0; i < 4; i++) this.tone(g, t + i * 0.6, 'sawtooth', 420, 0.12, 0.58, 760);
        break;
      case 'horn':
        this.tone(g, t, 'sawtooth', 110, 0.14, 1.4, 104);
        this.tone(g, t, 'sawtooth', 165, 0.08, 1.4, 156);
        break;
      case 'heartbeat':
        this.thump(g, t, 70, 40, 0.5, 0.18);
        this.thump(g, t + 0.2, 60, 35, 0.35, 0.2);
        break;
      case 'ultReady':
        [784, 1046, 1568].forEach((f, i) => this.tone(g, t + i * 0.09, 'sine', f, 0.18, 0.5));
        break;
      case 'streak':
        this.tone(g, t, 'square', 523, 0.1, 0.12);
        this.tone(g, t + 0.1, 'square', 784, 0.12, 0.3);
        break;
      case 'capture':
        this.tone(g, t, 'sine', 660, 0.15, 0.2);
        this.tone(g, t + 0.15, 'sine', 990, 0.15, 0.35);
        break;
      case 'victory':
        [523, 659, 784, 1046].forEach((f, i) => this.tone(g, t + i * 0.16, 'triangle', f, 0.2, 0.6));
        break;
      case 'defeat':
        [392, 330, 262].forEach((f, i) => this.tone(g, t + i * 0.25, 'triangle', f, 0.2, 0.8));
        break;
      case 'shift':
        // Titan Shift: a long rising roar, then the boom as the form breaks out.
        this.tone(g, t, 'sawtooth', 55, 0.2, 1.6, 440);
        this.tone(g, t + 0.1, 'sine', 110, 0.22, 1.6, 1320);
        this.burst(g, t, 'bandpass', 900, 0.8, 1.4, 0.35);
        this.thump(g, t + 1.4, 48, 18, 1.1, 1.6);
        this.burst(g, t + 1.4, 'lowpass', 600, 0.01, 1.4, 0.9);
        break;
      case 'unshift':
        this.tone(g, t, 'sine', 660, 0.16, 1.2, 140);
        this.burst(g, t, 'lowpass', 700, 0.1, 1, 0.3);
        break;
    }
    window.setTimeout(() => g.disconnect(), 3000);
  }
}

export const audio = new AudioEngine();
