export type AudioCategory = 'weapon' | 'ability' | 'ui';
interface Voice { category: AudioCategory; until: number; at: number; priority: number; key: string; stop(): void }
const LIMITS: Record<AudioCategory, number> = { weapon: 20, ability: 12, ui: 8 };

/** Counts scheduled voices as well as audible ones; reserves room for abilities and warnings. */
export class VoiceBudget {
  private voices: Voice[] = [];
  get size(): number { return this.voices.length; }

  admit(category: AudioCategory, now: number, duration: number, priority: number, key: string, stop = () => {}): boolean {
    this.voices = this.voices.filter(v => v.until > now);
    if (priority < 2 && this.voices.some(v => v.key === key && now - v.at < 0.1)) return false;
    const peers = this.voices.filter(v => v.category === category);
    if (peers.length >= LIMITS[category] || this.voices.length >= 40) {
      const candidates = peers.length >= LIMITS[category] ? peers : this.voices;
      const victim = candidates.filter(v => v.priority < priority).sort((a, b) => a.priority - b.priority || a.at - b.at)[0];
      if (!victim) return false;
      victim.stop();
      this.voices = this.voices.filter(v => v !== victim);
    }
    this.voices.push({ category, until: now + duration, at: now, priority, key, stop });
    return true;
  }

  release(stop: () => void): void {
    this.voices = this.voices.filter(v => v.stop !== stop);
  }

  clear(): void {
    for (const v of this.voices) v.stop();
    this.voices = [];
  }
}
