# Complete recorded audio replacement

User intent: replace all remaining procedural audio, extending the earlier licensed-asset work.

Scope: all 16 world sound kinds, all 18 interface events, all ability families, naval sea/engine loops and ground wind/engine loops. Existing callers, spatial attenuation, category volumes, priority ceilings, ducking and battle cleanup remain. No music is added because the game has no existing music system.

Approach: finish the existing WebAudio sample player using curated Helton Yan, Kenney and Sonniss recordings. Every normal event and every fallback uses a packaged recording. Remove oscillators and generated noise. When every suitable recording fails, skip that sound; never synthesize an old cue. Keep load-time pending actions bounded and brief, and invalidate them at battle boundaries.

1. Inventory every event; obtain and CRC-check missing recordings; package small derivatives with contributor/license/edit records. Prepare seamless recorded ambience and engine loops.
2. Add exhaustive typed world/UI/loop registries and regression checks that demonstrate missing coverage and synthesized playback before implementation.
3. Replace synthesis with sample playback, finite recorded fallbacks, safe async loading, bounded pending actions, sample loops and cancellation. Preserve both battle modes and current saved settings.
4. Verify every event in real Chrome with oscillator/noise generation forbidden; test missing files, load/end/restart races, loops, loud crowded battles, volumes and cleanup. Run the full suite, typechecks and production build; complete one independent read-only review.

Completion means every current audio call has an asset mapping and real playback evidence, with no generated-waveform path remaining. Sources and exact processing remain reviewable in the manifest; subjective sound taste is not claimed as a hardware listening test.
