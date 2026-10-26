# Naval improvement phase

Source of intent: the six-pass implementation plan supplied in this conversation.

- Baseline: 456 simulation tests passed; 15 LAN tests failed because the sandbox blocks local sockets. Re-running with socket permission.
- Workspace: `combat-reliability` in the supplied checkout. The managed worktree was created outside the permitted writable roots; it remains unused.
- Shared interfaces: targeting eligibility feeds controls, skills, AI, homing and contacts; roster configuration feeds solo/LAN UI, server validation and deterministic construction; audio settings retain the legacy effects multiplier; balance changes apply only to ordinary weapons.
- Execution: combat reliability and concealment → fleet/LAN selection → audio → UI/presets → balance and final verification.

## Decisions and evidence

Implementation and verification results are appended per pass.


### Passes 1–3
- RED→GREEN: smoke/reveal expiry, mouse/gamepad submarine locks, Titan Shift with Queen Elizabeth queued, Maw range failure and charge preservation, fleet pools/duplicates/compensation/era validation and LAN tempo.
- Root causes: divergent target filters; marker/lead filters skipped concealment; picker tab changes left details on the old tab; selecting a base hull during a form compared against the temporary spec.
- Shared targeting is deterministic; camera terrain/ice-wall occlusion affects presentation only. Rendered hulls remain manually aimable. Physical collisions and weapon depth limits stay intact.
- Maw now validates a detected target against its actual 3 km radius. Failed readiness/target/range checks preserve charge and show a reason. Damage and defence interactions are unchanged.
- First integrated run: 482/482 tests passed, including all 15 LAN server tests. Typechecking subsequently caught a tuple annotation in the new LAN editor, corrected before continuing.

### Audio, polish, and balance in progress
- Audio admission reserves 20 weapon, 12 ability and 8 interface voices; distant repetitions merge, local actions/warnings have priority, ambience ducks, delayed sounds are bounded, battle teardown stops all sources/timers.
- Legacy master/effects/UI preferences remain; weapons, abilities and ambience are extra multipliers defaulting to 1.
- Ruling: “low skill contribution” means below the era/class-group skill-share median and below 40% of total damage, with at least 4 baseline appearances. This avoids classifying ships dealing 90% skill damage as weak-skill ships. The report records the threshold and sample sizes; small samples remain provisional.
- Baseline for balance: 96 line battles (16 per era including mixed) and 16 titan battles, fixed seeds. After-buff run uses the same jobs.


### Final review and fix pass
- One read-only fresh-context review found no critical findings, one important aircraft lifecycle regression, and one controller-focus finding. No second review was dispatched.
- Aircraft reproduction: a returning dive squadron dropped a second payload after its old target sank. The regression failed with four unwanted bombs; limiting the state transition to attacking aircraft passed the regression and direct carrier/gunnery runs.
- Controller reproduction: Assignments activation left focus on BODY. Focus preservation in shared segments and stable LAN control keys now preserve Assignments and enter its first slot. The browser reproduction changed from all false to all true.
- Controller focus was treated as important for this phase because uninterrupted controller access is an explicit requirement; it was fixed in the same pass.
- Audio stress rendering exposed compressor attack peaks above unity (1.99). A final soft limiter reduced the crowded render peak to 0.819. The rendered audition is in docs/verification/crowded-audio.m4a.
- Packaged six curated AAC assets (about 133 KiB audio): five Helton Yan derivatives and one Kenney shield. Sources, licenses, exact edits and original filenames are in public/audio/manifest.json, with in-game credits and license text.
- Supplemental Sonniss archive `Sonniss.com - GDC - Game Audio Bundle 1of5.zip` returned HTTP 403 / Cloudflare challenge. Exact URL and fallback coverage are recorded in public/audio/CREDITS.md; no Sonniss asset is claimed or shipped.

### Final verification
- Simulation/server suite: 497 tests passed, including naval and ground regression coverage. Direct gunnery, carrier/AA/fighter, and returning-squadron regressions all pass. Final acceptance after controller input consumption: 497/497 tests passed in 15.74 s; production build (including both typechecks) passed; git diff --check passed.
- Typecheck and production build passed. git diff --check passed.
- Chrome UI: 1280×720, 1920×1080, 2560×1080; no runtime errors or horizontal overflow; Queen Elizabeth and random selections displayed correctly; controller focus verified. Setup actions stay fixed while details scroll.
- Preset comparison: identical hash 979684644, five identical contacts, two live projectiles and one telegraph at every preset; next-battle application verified. Headless CPU/frame measurements and draw calls are in docs/verification/preset-results.json.
- Real WebAudio: all six assets decoded; repeated salvos bounded; missing assets fell back procedurally; mute and source/timer cleanup passed. Shield render depth, enemy concealment and sonar reveal passed in Chrome.
- Final matched balance comparison after the aircraft fix: 112 counterfactual baseline battles + 112 tuned battles, zero exceptions and NaNs. Original cohort-selection baseline also retained. Report: docs/balance-report.md.

### Review limitations and disposition
- Physical controller hardware, subjective sound quality and human balance feel require hands-on playtesting. Browser controller focus, offline mix rendering and deterministic attack runs are the available evidence; no physical-device claim is made.
- GPU performance ordering was measured in one headless Chrome environment. Preset cost controls increase consistently, but CPU frame-time noise is not a GPU benchmark across hardware.
- The reviewer inspected executor suite/balance evidence without rerunning lengthy suites. Executor fresh runs remain the verification gate.
- Deferred minor: the mechanical UI detector flagged the pre-existing boss-bar width transition at styles.css:1298. It is unrelated to the new controls and was left intact.
- Integration: keep the implementation in the supplied checkout on combat-reliability; no deployment, publishing, push or merge.

- Live LAN browser verification at all three sizes: duplicate Queen Elizabeth AI assignments, Fletcher enemy pool, Long Shift tempo and resolved picks reached a running lockstep battle. Focus survived the server settings refresh; no runtime errors.
- Controller input consumption reproduction failed before the fix and passed after: a menu A/B/D-pad action cannot also become a lock, ability or utility action when it closes the menu.


### Sonniss retry and audio scope clarification
- User asked whether all audio had been replaced and requested another Sonniss attempt. Clarified that replacement is partial: shared ability/shield clips existed, while weapons, ambience and interface remained procedural.
- Primary archive retry: HTTP 403 / Cloudflare challenge. Official 2015 mirror `https://ftpmirror.your.org/pub/misc/sonniss/sonniss.zip` responded HTTP 200 with byte-range support. Retrieved the ZIP index and four selected files; verified each original CRC32, recorded original SHA-256 and source filenames.
- Curated four compact derivatives and connected ordinary explosion, metal-hit, splash and depth categories. Existing procedural fallback remains. In-game credits, manifest and phase report updated to ten clips total, with explicit partial-replacement status.
- Browser integration regression: missing registry/asset entries failed first. After wiring, actual AudioBufferSource playback of the four decoded samples and source cleanup were checked. No user download assistance was needed.
- Retry verification complete: 497/497 tests passed; typecheck/production build passed; all ten assets decoded, four new categories played their actual recorded buffers, voice limits/mute/missing-asset fallback/cleanup passed. Updated crowded-render peak is 0.837.


### Complete audio replacement (follow-up request)
- User explicitly requested replacement of all audio after the partial/hybrid coverage was clarified. New scope includes every existing world and UI route plus continuous naval/ground loops. No music system is introduced.
- Packaged 43 licensed derivatives (~3.38 MB) from Helton Yan, Kenney and Sonniss contributors; exact cuts, pitch/sequence edits, circular loop crossfades, codecs, author/license and source hashes are recorded. `scripts/packageAudio.py` reproduces the new derivatives from original recordings.
- Removed runtime oscillators, generated noise, synthesized UI motifs and procedural fallback. Only decoded recordings create audible sources. Missing primaries use another recording; no suitable recording means silence.
- Added prefetch/decode readiness, twelve-entry short pending queue, epoch invalidation, actual-source cancellation/release, complete typed registries, separate mode loops, pitch-responsive engines and audio-time duck restoration.
- RED→GREEN: browser found ten oscillators in old routes; new full coverage creates zero generators. Delayed primary click/engine tests caught early fallback masking, then passed with primary-aware loading. Loading/end/restart tests verify no late old sound.
- One independent read-only review found ambience could stay at 0.28 after context suspension. The reproduction failed before the fix and passed (gain 0.980) after scheduling restoration on audio time. No critical or minor findings; no re-review.
- 501 tests, typechecks and production build passed. Real Chrome decoded all 43 recordings and verified 42 event routes, both mode loops, engine response, volumes, mute, limits, missing-file recorded fallback, all-missing silence, clean end/restart and suspension recovery. Crowded offline mix peak: 0.849.
- User asked about possible misplaced duplicates. Read-only recursive audio/archive scan plus SHA-256 grouping found no unexpected project audio files and no duplicate source recordings. All 43 source files have expected build copies in dist/audio. Nothing was moved or removed.
- Subjective listening on the user's hardware and independent legal review were outside the review evidence; source/license provenance and an audition page are supplied. Gameplay/balance source changes were not part of this follow-up.
