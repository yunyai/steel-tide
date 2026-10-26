# Steel Tide naval improvement phase

Implemented in the supplied checkout on `combat-reliability`. No deployment, publishing, push or merge was performed.

## Delivered

- Shared deterministic contact eligibility across player locks, aim assist, AI, targeted skills and homing acquisition. Smoke, cloak and submarine depth conceal contacts until revealed. Rendered hulls retain manual aim and physical weapon depth restrictions.
- Depth-following shields; camera terrain/solid-wall occlusion for enemy name/health markers; sonar range, duration and contact count; concealment and lost-lock feedback.
- Free-play era/class detail synchronization and base-hull selection during Titan Shift, including Queen Elizabeth regression scenarios. Maw preserves charge on failures and explains readiness/range/target failures; execution, titan damage and defences remain intact.
- Per-launcher torpedo readiness uses the firing calculation. Range remains a separate readout.
- Per-team automatic fleets, random allowed pools and explicit/automatic slots, duplicates and titan compensation; validated LAN settings and resolved picks; host Shift tempos; player Random ship in hangar, LAN and free play.
- 43 compact local audio derivatives covering all world/UI events and naval/ground loops, keyed ability/event families, recorded fallbacks, category volumes with legacy preference preservation, voice limits, danger/local-action priority, ambience ducking, final limiting and battle cleanup. In-game attribution and exact asset modifications are included.
- Responsive setup/hangar/picker/settings and nine-skill HUD refinements, fixed setup actions, scrollable details, and controller menu focus/navigation. Four presets preserve combat information and apply from the next battle.
- Cannon, aircraft, weak-skill main-gun and traverse buffs. No skill damage definitions were reduced. [Balance evidence and exact ship-specific choices](balance-report.md).

## Verification

- 501 tests passed, including LAN/lockstep, naval and ground tests; typecheck and production build passed.
- Real Chrome checks at 1280×720, 1920×1080 and 2560×1080: no runtime errors or page overflow; Queen Elizabeth, random choices, controller focus and consumed menu inputs verified. Live LAN duplicate assignments, enemy pools and host Shift tempo reached running lockstep battles at all three sizes. Screenshots and machine-readable results are in [verification](verification/).
- All presets produced hash `979684644`, identical contacts, two live projectiles and a telegraph. Draw calls: 116 / 117 / 143 / 143. CPU frame timings are recorded as measurements from one headless environment, not cross-hardware GPU benchmarks.
- WebAudio decoded all 43 assets; every world/UI/family route played its actual mapped sample. Priority ceilings, recorded fallbacks, mute, source cleanup and loading/end/restart races passed. No oscillator or generated-noise path remains. Shield depth, concealment and reveal passed in the renderer.
- 224 final matched balance battles (112 baseline + 112 tuned): zero exceptions or NaNs. Ordinary-carrier mean damage increased from 77,801 to 109,545; line-battle timeouts decreased from 13/96 to 6/96. The original 112-battle selection baseline is also retained.
- One independent read-only code review; aircraft-return and controller-focus findings reproduced, fixed and verified.

## Review artifacts and commands

- [Audio audition](verification/audio-audition.html), including a crowded render through the game's mixer; [credits and download note](../public/audio/CREDITS.md).
- `npm test`, `npm run typecheck`, `npm run build`.
- With `npm run dev` running and Chrome installed: `npm run verify:ui` and `npm run verify:presentation`. `STEEL_URL` and `PLAYWRIGHT_CHANNEL` override the local server/browser.
- `npm run balance:compare` reproduces the counterfactual comparison in temporary snapshots. It takes several minutes.
- [Implementation ledger](implementation-ledger.md) records decisions, root causes and verification history.

## Limits

Physical gamepad hardware, subjective audio quality, human gunnery/balance feel and broad GPU performance still need hands-on playtesting. The mechanical UI scan flagged one pre-existing boss-health width transition; it remains unchanged.

The Sonniss primary archive still returned HTTP 403. The official 2015 mirror succeeded: selected source files were retrieved with ZIP byte ranges and CRC-verified. The completed replacement now covers all 16 world kinds, 18 UI events, ability families, three cannon weights and distinct naval/ground ambient and engine loops. Sources, author/license details and edits are in the manifest. If a primary file fails, another packaged recording is used; if no suitable recording is available, that event is skipped. [Complete audio replacement report](audio-replacement-report.md).

Balance selection uses at least four appearances, below-median overall damage and a skill share below both the era/class-group median and 40%. This explicit threshold avoids treating skill-dominated ships as weak-skill hulls; the evidence is provisional where cohorts are small.
