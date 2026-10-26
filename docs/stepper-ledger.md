# Stepper implementation ledger

- Plan: docs/stepper-plan.md; source of truth is approved conversation plan.
- Existing combat-reliability checkout is explicitly authorized; preserve all prior uncommitted work.
- Pre-flight: summon ultimates are globally forbidden; use a narrow mirrored activation path. Copy damage must apply at damage intake once to cover guns, skills, torpedoes and DOT consistently. Existing summon AI is inappropriate for synchronized copies.
- Tasks: roster/teleport; moves; copies; presentation; verification.

- RED→GREEN: absent roster/12 initial scenarios; additional defenses, copy commands and LAN scenarios expose/fix early landing context, copy rush/torpedo lane collisions, retained Broadstep fire after concealment, selected-weapon gating and invalid Flicker starting water.
- Ruling: Stepper Flash-step uses internal id stepperFlashStep because Ichigo already owns flashStep. Display name unchanged; no gameplay cost.
- Ruling: The Fold has a named descriptive trait with no stat multipliers, satisfying existing faction metadata without adding unplanned passive power.
- Ruling: Ram-step phases through physical ship separation during its 0.35 s swept rush; otherwise collision pushes move the caster away from its validated path. Other collision behavior remains unchanged.
- Copies use fan-shaped Ram corridors and parallel Overstep lanes to execute all four mirrors safely.
- Presentation: dedicated procedural hull details and bounded 48-mesh fading silhouettes/rings; copied ships are translucent, labeled Afterimage 1–4. Camera held around Flicker area then eased back.

- Final independent review: two Important findings (selected weapon persistence, repeated copy scaling through spread/echo damage links) and one cosmetic departure ghost orientation issue. All reproduced RED→GREEN in six focused regressions; no unresolved findings. Cosmetic correction included because departure direction is part of the requested teleport presentation.
- Final acceptance: 55 Stepper scenarios, full suite 558/558, typechecks/build/diff-check pass; three browser sizes and all four presets green, identical hash3415272019 and 2.4M combined Flicker damage. Twelve matched-seed fleet battles re-run after gameplay review fixes: no exceptions/nonfinite/stuck hulls.
- Input: browser keyboard slots0–8 and simulated standard-controller banks all pass. No physical-controller test claim.
- Verification note: audio engine-response test used fixed wall-clock waits and twice sampled before enough audio time advanced. It now waits for 0.45 seconds of actual audio time with a 5-second timeout and includes timing diagnostics; no Audio runtime changes were needed.

- Recorded-audio acceptance passed after the audio-clock verification fix: all43assets/42routes, no generators, engine/volumes/limits/fallback/cleanup green. Existing production preview on4173 serves verified index-BOtWoWJh.js and packaged audio (HTTP200). Temporary test server5184 closed; existing preview left running.

### Sidestep playtest buff
- User requested stronger, clearer dodges, then explicitly requested shorter protection and retrigger windows. Final values: 180 m preferred lateral jump (120/60 m safe fallback), 0.08 s phase, 0.12 s retrigger. Existing eight-second stance and 18 s base cooldown retained.
- Added deterministic pre-impact shell/torpedo/low missile reactions; ignored friendly, distant and high-flying fire. Existing direct-hit evasion and periodic/reflected/piercing exclusions retained. Rush/Flicker movement sequences are not interrupted by evasions.
- Added three departure/travel silhouettes, an arrival ring, recorded slash cue and local SIDESTEP notice. Existing 48-fade/40-voice limits preserved.
- RED→GREEN: old 10 m dodge and missing proactive triggers fail the new scenarios. Final focused suite: 63 Stepper scenarios; full suite566/566, both typechecks/build/diff-check passed. Browser: allfourpresets, 13 dodges in100ticks, no damage, identicalhash1465643046, max13fades/32voices.
