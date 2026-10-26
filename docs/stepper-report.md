# Stepper delivery report

Stepper is available under **Misc → Titan → Stepper**, including the hangar, free-play picker and titan-enabled Mixed LAN fleets. The Fold is a new Misc faction with descriptive metadata and no additional passive stat multipliers.

## Delivered behavior

- Unique procedural violet phase warship: narrow keel, floating armored sponsons, crystal drive and rotating rings. Translucent afterimages, correct departure silhouettes and bounded arrival/impact rings share the existing recorded audio mixer.
- All six regular steps and three independent ultimates use the approved values in [the implementation plan](stepper-plan.md). Main-gun scaling follows the existing balance rules; skill damage retains the specified values.
- Flash/Explosion target water under the reticle. Ram/Broad/Over target a detected hull. Back retreats from the nearest detected enemy, Side reacts to incoming hits, Flicker selects seeded random contacts in the aimed area. Failed activations explain why and preserve their resources.
- Four destroyable afterimages last 18 seconds, have 25% maximum HP, deal 75% damage once (including linked damage and flooding/fire), inherit weapon selection and mirror successful offensive ultimates without recursive summons. Destroying copies grants no kill rewards. End/expiry/death/redeploy clean them up.
- Full-hull water, obstacle, ship and map-edge checks; stable teleported/interpolated poses; swept Ram damage; preserved concealment, submarine and defensive interactions. LAN commands retain their current wire format, with new runtime state included in hashes.
- Nine existing keyboard/controller bindings, duration/copy feedback, and a held Flicker camera that eases back to the hull.

## Evidence

- Full suite: **566 tests passed** across 35 files, including **63 Stepper scenarios**. Both typechecks, production build and `git diff --check` passed.
- Browser: 1280×720, 1920×1080 and 2560×1080, all nine hangar cards, four translucent modeled copies, no horizontal overflow or runtime errors. [Screenshots and results](verification/stepper/).
- Recorded-audio verification passed: all 43 assets and 42 event routes, zero generated waveforms, engine response, category volumes, voice limits, loading/fallback behavior and cleanup.
- Keyboard and simulated gamepad route all nine slots correctly. [Input results](verification/stepper/input-results.json). This does not claim physical controller testing.
- Ultra Low/Low/Medium/High produce identical simulation hash **3415272019**, with all five ships completing twenty Flicker strikes: **2.4M combined damage** against an unmodified durable target. No damage reduction was introduced to control spectacle.
- The stress sequence peaked at **40 fading meshes / 48 limit** and **32 one-shot voices / 40 limit**. All presets retain impact rings and contacts; cleanup passed. Headless CPU median frames were 1.0–3.2 ms in this run; these numbers are not a hardware GPU benchmark.
- Initial-release matched-seed fleet evidence (twelve battles): each titan leads the same seeded Mixed fleets over two annihilation and two domination scenarios. Zero exceptions, nonfinite hulls or ships flagged as stuck. [Raw combat results](verification/stepper/combat-results.json).

| Titan | Fleet wins | Mean titan damage | Mean battle minutes |
|---|---:|---:|---:|
| Stepper | 4/4 | 3,025,044 | 0.78 |
| Hadal | 4/4 | 1,711,163 | 1.63 |
| Leviathan | 4/4 | 1,633,005 | 1.47 |

All three fleets won their four scenarios; this small comparison establishes aggressive starting performance, not statistical balance. Stepper's starting damage and cooldown values remain unchanged.

## Sidestep playtest revision

Sidestep now makes visible lateral jumps up to **180 m**, with **0.08 s phase protection** and **0.12 s between triggers**. The stance remains 8 s with the same 18 s base cooldown. It predicts imminent shell, torpedo and low missile collisions, retains damage-time evasion for other direct attacks, and searches opposite/shorter safe landings when needed. It does not evade ongoing fire/flooding, reflected or explicitly piercing damage.

Every dodge leaves three fading hull silhouettes, a bright arrival ring and a short HUD notice, using packaged recorded sound. Eight new or expanded regression scenarios cover timing, predictive threats, false positives, blocked landings, independent copy evasion and deterministic replay. In Chrome, a 100-tick focused barrage produced **13 dodges, zero damage and hash 1465643046 on all four presets**. The effect pool peaked at 13/48 fading meshes and audio at 32/40 one-shots. [Dodge screenshots and results](verification/stepper/sidestep-results.json).

## Review and implementation decisions

One independent read-only review found two important issues and one cosmetic issue. All were reproduced before fixing: persistent copy weapon selection, repeated 75% scaling through spread/echo links, and departure orientation. The six added regressions now pass, followed by the full acceptance suite. No re-review was dispatched and no review findings remain deferred.

- Internal id `stepperFlashStep` keeps Ichigo's existing `flashStep` distinct; the displayed name remains Flash-step. No gameplay tradeoff.
- The Fold's named trait is descriptive only, preserving the approved stats and existing faction metadata expectations.
- During the 0.35-second Ram rush, physical hull separation is suspended for that rushing ship; swept hit detection still deals damage once per crossed enemy. Otherwise collision pushes would displace it from its validated corridor. Copies use fan-shaped Ram corridors and separate Overstep lanes.
- A missing safe copy landing skips that copy's mirrored move rather than placing a hull in terrain; the original successful cast remains valid.

The existing checkout and prior changes are preserved. No merge, push, deployment or publishing was performed.

## Reproduction

With the Vite server running, set `STEEL_URL` if its port is not 5184:

```sh
npm test
npm run build
node scripts/verify-stepper.mjs
node scripts/verify-stepper-input.mjs
node scripts/verify-sidestep.mjs
node scripts/verify-stepper-combat.mjs
npm run verify:audio
```
