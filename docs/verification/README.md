# Verification artifacts

- `ui-results.json`, `lobby-results.json`, `controller-results.json`: real Chrome interaction checks and screenshots at the three requested sizes.
- `preset-results.json`: identical fixed-seed battle and camera path at every preset, including two live projectiles and one telegraph. CPU timings reflect this headless environment; draw calls include post-processing.
- `audio-results.json`, `shield-results.json`: actual WebAudio and renderer checks. `crowded-audio.m4a` is an offline render through the game's audio engine. Its latest peak before encoding was 0.849 after replacing all remaining synthesis with samples; the pre-limiter reproduction peaked at 1.99.
- `audio-audition.html`: play all 43 recordings and crowded render. Serve the repository with Vite for the individual-asset links, or open the files directly.
- `balance-selection-baseline.json`: original fixed-seed evidence used to select the nine additional main-gun buffs.
- `balance-before.json`, `balance-after.json`: final matched snapshots after the aircraft lifecycle correction. Each contains 112 jobs; baseline removes only this phase's balance multipliers and traverse boost.
- `traverse-buffs.json`: exact affected hulls and before/after traverse speeds.

Reproduce with `npm test`, `npm run build`, and, with `npm run dev` running, `npm run verify:ui` / `npm run verify:presentation`. `npm run balance:compare` takes several minutes and writes matched results here.

- `sonniss-results.json`: four source files CRC-verified during acquisition; real Chrome confirms the four world-effect categories play decoded samples and clean up their sources.

- `all-audio-results.json`: all 43 recordings decoded; 42 world/UI/ability-family/calibre routes played their exact mapped buffers with generators forbidden. Both battle-mode loops, engine response, volumes, mute, voice limits, missing primaries, all-missing silence and loading/end/restart/suspension races passed.
- `loop-seams.json`: PCM loop durations, peaks and measured sample differences at the wrap boundary.
- `audio-file-audit.json`: source/build audio copies are expected; no unexpected audio/archive files or duplicate source recordings were found inside the project.

For audio-only checks with Vite running, use `npm run verify:audio`. The full replacement supersedes the earlier partial-audio notes in historical evidence.


## Stepper follow-up

See [Stepper report](../stepper-report.md) and [Stepper verification](stepper/) for the nine-move titan, three responsive sizes, all graphics presets, simulated controller/keyboard mappings, independent-review regressions and twelve matched-seed fleet battles. The earlier phase artifacts remain historical evidence for that phase.
