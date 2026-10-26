# Complete audio replacement

All existing sound routes now play local recordings. Runtime oscillators, generated noise, synthetic UI melodies and procedural fallback have been removed.

## Coverage

- 16 world categories: three cannon weights, explosions, splashes, metal hits, torpedoes, missiles, flak, depth blasts, electricity, thunder, beams, nukes, shields, charges, ricochets and collapses.
- All 18 interface events, including menu clicks, ribbons, warnings, sirens, horns, heartbeat, captures, pickups, ultimate readiness, streaks, results and transformation feedback.
- Existing ability families and overrides. Shared skill families intentionally reuse suitable recordings.
- Distinct recorded sea/naval-engine and wind/ground-engine loops. Engine pitch and gain follow speed. PCM loops are circularly crossfaded before packaging.

43 packaged recordings total **3,377,960 bytes**. Source recordings came from Helton Yan, Kenney and the official Sonniss 2015 mirror. Every file has author, source, license and processing records in [the manifest](../public/audio/manifest.json); [credits](../public/audio/CREDITS.md) are also linked in game. Original archives and raw recordings are not shipped. The [audition page](verification/audio-audition.html) exposes the packaged clips and a crowded render through the mixer.

## Reliability

The existing category volumes, legacy preferences, spatial attenuation, bounded delay, 40-voice ceiling, local/danger priority, ambience ducking and final limiter remain. Two continuous loops sit outside the one-shot pool.

Files prefetch before the first gesture and decode after audio unlock. At most twelve brief actions may wait for loading; old shots expire quickly. A missing primary uses another recorded cue. If all suitable files fail, that event is skipped. Battle end/restart clears pending actions and stops the actual sources. Duck restoration runs on audio time so device/context suspension cannot leave ambience permanently quiet.

## Verification

- **501 tests passed**, including naval, ground, LAN, determinism and asset/provenance checks. Typechecks and production build passed.
- Real Chrome decoded all 43 files and exercised 42 world/UI/family/calibre routes with oscillator and waveform-buffer creation forbidden. Every route started its expected recorded buffer.
- Verified both mode loops, speed-dependent engines, category volume/mute, at most 40 one-shots plus two loops, recorded fallback, all-files-missing silence, bounded pending actions, cancellation during loading, clean restart and suspension recovery.
- One independent read-only review; its suspension finding was reproduced and fixed. No critical or minor findings remained.
- Crowded offline sample render peak: **0.849**, below clipping. Loop wrap differences and all machine-readable results are in [verification](verification/).
- The recursive project file audit found **no misplaced files or duplicate source recordings**. Identical public/audio and dist/audio copies are expected build output. No user files were moved or removed.

Run `npm run verify:audio` with Vite running (`npm run dev`) and Chrome installed. Recreate derivatives with `python3 scripts/packageAudio.py --helton DIR --kenney DIR --sonniss DIR`. Subjective sound preference and physical-device listening remain user playtest items; the report makes no claim of a hardware listening session.
