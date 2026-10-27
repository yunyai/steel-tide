# Steel Tide audio credits

All current game audio plays packaged recordings: weapons, impacts, abilities, interface feedback, and naval/ground ambience and engine loops. There are no runtime oscillators or generated noise, including in fallback paths. Missing primary files use another appropriate recording; if every suitable recording fails, that sound is skipped.

57 curated derivatives, about 3.6 MB total. Exact source paths, licenses, cuts, pitch/filtering, crossfades, codecs and source hashes are recorded in [manifest.json](manifest.json). `scripts/packageAudio.py` and `scripts/packageFleetAudio.py` reproduce the derivatives from the licensed source packs.

## Libraries and licenses

- **Helton Yan — FREE Retro Anime / Old-School Shonen SFX**: https://heltonyan.itch.io/retroanimesfx — **CC BY 4.0**, https://creativecommons.org/licenses/by/4.0/. Changes: excerpts, pitch edits, reversal where recorded, fades, normalization, mono conversion and AAC encoding. These edits do not imply endorsement.
- **Kenney — Sci-fi Sounds**: https://kenney.nl/assets/sci-fi-sounds — **CC0 1.0**, https://creativecommons.org/publicdomain/zero/1.0/. Original license: `Kenney-License.txt`.
- **Sonniss GameAudioGDC 2015 contributors**: https://sonniss.com/gameaudiogdc/ — **Sonniss #GameAudioGDC Bundle License v2.0 (27 August 2026)**, https://sonniss.com/gdc-bundle-license/. Respective contributors retain authorship. The official 2015 mirror https://ftpmirror.your.org/pub/misc/sonniss/sonniss.zip succeeded; selected source files were retrieved with ZIP byte ranges and CRC-verified. The primary archive still returned HTTP 403. No entire source archive is shipped.

## Contributors and packaged files

### Carlo Ascrizzi

`engine-ground.wav`.

### Coll Anderson

`sonniss-explosion.m4a`, `sonniss-hit.m4a`, `gun-light.m4a`, `gun-medium.m4a`, `gun-heavy.m4a`, `flak.m4a`, `ricochet.m4a`, `collapse.m4a`, `ui-siren.m4a`, `ui-heartbeat.m4a`.

### Detunized

`ambience-wind.wav`.

### Eiravaein Works

`ui-click.m4a`, `ui-victory.m4a`, `ui-defeat.m4a`, `ui-streak.m4a`.

### Helton Yan

`charge.m4a`, `impact.m4a`, `beam.m4a`, `slash.m4a`, `transform.m4a`, `torpedo-launch.m4a`, `zap.m4a`, `laser.m4a`, `nuke.m4a`, `ui-ability.m4a`, `ui-ult.m4a`, `ui-pickup.m4a`, `ui-ult-ready.m4a`, `ui-unshift.m4a`.

### Kenney

`shield.m4a`, `missile-launch.m4a`, `ui-citadel.m4a`, `engine-naval.wav`.

### Mechanical Wave

`sonniss-depth.m4a`.

### Membrans

`ui-ribbon.m4a`.

### Secret Source

`ui-horn.m4a`.

### SoundMorph

`ui-alarm.m4a`, `ui-capture.m4a`, `ui-warning.m4a`.

### Soundopolis / Jeff Fienup

`sonniss-splash.m4a`, `thunder.m4a`, `ambience-sea.wav`.

## Loop and event handling

Ambient and engine loops are PCM16 mono at 32 kHz, circularly crossfaded before packaging to avoid lossy-codec padding at the seam. One-shots are AAC at 44.1 kHz. Pitch changes and recorded-note sequences are edits of licensed recordings. Every audible WebAudio source is a decoded sample.

Shared ability families intentionally reuse appropriate recordings across ship skills. There is no added music system.

## Fleet presentation expansion

Additional recordings by Helton Yan (CC BY 4.0) and Kenney (CC0 1.0), from the packs linked above. Detailed edits and original filenames are also in [manifest.json](manifest.json).

| Packaged file | Original recording | Author | Edits |
| --- | --- | --- | --- |
| arcane-charge.m4a | MAGSpel_Anime Ability Charge 5.wav | Helton Yan | First 1.65s excerpt; 80ms fade out; -21 LUFS/-3dBTP normalization; mono 44.1kHz AAC 96kbit/s. |
| energy-charge.m4a | MAGSpel_Anime Ability Charge 12.wav | Helton Yan | First 1.8s excerpt; 80ms fade out; -21 LUFS/-3dBTP normalization; mono 44.1kHz AAC 96kbit/s. |
| energy-heavy.m4a | MAGSpel_Anime Ability Release 5.wav | Helton Yan | First 2.1s excerpt; 80ms fade out; -21 LUFS/-3dBTP normalization; mono 44.1kHz AAC 96kbit/s. |
| energy-pulse.m4a | MAGSpel_Anime Ability Release 9.wav | Helton Yan | First 1.3s excerpt; 80ms fade out; -21 LUFS/-3dBTP normalization; mono 44.1kHz AAC 96kbit/s. |
| cut-heavy.m4a | FGHTClth_Anime Swing 3.wav | Helton Yan | First 0.65s excerpt; 80ms fade out; -21 LUFS/-3dBTP normalization; mono 44.1kHz AAC 96kbit/s. |
| cut-light.m4a | FGHTClth_Anime Swing 2.wav | Helton Yan | First 0.55s excerpt; 80ms fade out; -21 LUFS/-3dBTP normalization; mono 44.1kHz AAC 96kbit/s. |
| blast-heavy.m4a | EXPLDsgn_Anime Explosion 4.wav | Helton Yan | First 1.8s excerpt; 80ms fade out; -21 LUFS/-3dBTP normalization; mono 44.1kHz AAC 96kbit/s. |
| blast-shock.m4a | EXPLDsgn_Anime Explosion 7.wav | Helton Yan | First 1.4s excerpt; 80ms fade out; -21 LUFS/-3dBTP normalization; mono 44.1kHz AAC 96kbit/s. |
| ward-rise.m4a | MAGSpel_Anime Ability Ready 6.wav | Helton Yan | First 1.4s excerpt; 80ms fade out; -21 LUFS/-3dBTP normalization; mono 44.1kHz AAC 96kbit/s. |
| phase-arrival.m4a | MAGSpel_Anime Ability Ready 7.wav | Helton Yan | First 1.2s excerpt; 80ms fade out; -21 LUFS/-3dBTP normalization; mono 44.1kHz AAC 96kbit/s. |
| sensor-ping.m4a | Audio/computerNoise_002.ogg | Kenney | -21 LUFS/-3dBTP normalization; mono 44.1kHz AAC 96kbit/s. |
| mechanical-hit.m4a | Audio/impactMetal_003.ogg | Kenney | -21 LUFS/-3dBTP normalization; mono 44.1kHz AAC 96kbit/s. |
| plasma-shot.m4a | Audio/laserLarge_002.ogg | Kenney | -21 LUFS/-3dBTP normalization; mono 44.1kHz AAC 96kbit/s. |
| jet-release.m4a | Audio/thrusterFire_002.ogg | Kenney | -21 LUFS/-3dBTP normalization; mono 44.1kHz AAC 96kbit/s. |
