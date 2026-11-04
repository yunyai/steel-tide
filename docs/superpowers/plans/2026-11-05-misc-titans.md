# Four Misc Titans — implementation record

Approved scope: Judge, Hexweaver, Gourmand, Faultline; nine skills each, custom 3D models at Stepper/Tungsten/Architect quality. Hadal is not the quality reference.

Isolation: branch misc-titans from coop-rush af30e7a, worktree /private/tmp/steel-tide-misc-titans. Original checkout and uncommitted co-op changes are not implementation targets. Shared lifecycle/input/network hooks are additive.

Model requirement: dedicated gpt-6-astra subagent at xhigh reasoning creates all four procedural Three.js models. Main worker integrates and reviews rendered previews.

## Kits
- Judge Q Jurisdiction (2km court), E Law (chosen six-rule catalogue, 30s duration, 10s cooldown, three simultaneous), Z Contempt (warned 1.5s freeze), X Arrest, C Taxes (preserves violations), V Objection (50% hit dismissal 5s), R Martial Law (all laws, double stacks, 3km 12s), T Verdict, B Death Penalty (20 violations, normal defensive path maxHP damage).
- Judge laws: firing, skills, >20knots, <10knots, >3deg/s turns, leaving court. Per-Judge cases cap30, per-law 1s throttle, outside5s then decay1/s. Forced displacement is not an offence.
- Hexweaver Q Pin (four stored independent6s charges, four18s dolls, three pins per doll), E Stitch (8s nonrecursive echo), Z Twist, X Effigy Fire, C Rip the Seam, V Substitute, R Coven, T Thousand Needles, B Effigy Unmaking. Group Qspread/E/X/C, focused Q/Q/Q/X/C, simple Q/Z. Unprepared attacks remain strong.
- Gourmand Q Devour, E Carve, Z Pressure Cooker, X Skewer, C Serve, V Comfort Food, R Banquet, T Swallow Whole, B Kitchen Catastrophe. Three ingredient types, fixed cap; basic attacks work empty. Swallow warned, <=3s, defense/escape allowed; owner death releases safely.
- Faultline Q Fault, E Uplift, Z Subduction, X Slip, C Aftershock, V Bedrock, R Continental Divide, T Caldera, B Worldbreaker. Real temporary ridges, six per owner,12s life. Preserve exits and safe hull placement. No static map edits.

## Work and evidence
- Baseline: npm test, 107 files / 1488 tests passed before product changes.
- Separate runtime modules + plain state, deterministic game-time/seeded RNG, lifecycle cleanup and state hashes.
- Dynamic ridges integrated into height, line of sight, navigation and swept projectile queries.
- New law choice field validated and carried atomically through turn stream; local selector cancellation spends nothing.
- Models and persistent effects read simulation state without writing it; bounded allocations/disposal and per-viewport visibility.
- Validate focused mechanics, multiplayer replay, cleanup/respawn, full suite, production build and browser captures.

## Implementation rulings
- Effigy Unmaking names Hexweaver's B to preserve the roster-wide unique skill-name invariant; existing Unmaking remains unchanged.
- Exclude the four new naval factions from GroundNation, as with every other Misc faction; no new ground vehicles.
- Judge decay checks allow one fixed-step sampling boundary after escape.

## Review and tuning
- Independent review found and fixed four important issues: law click confirmation, Escape cancellation including pointer lock, shell/ridge collision ordering, and false Closed Borders offences from court relocation/fear. Regression tests reproduce and cover them.
- Existing Misc roster assertions extended for new ships; bespoke models covered by their own geometry/animation/disposal tests rather than generic FleetDetails.
- AI duels against Stepper, Tungsten and Architect exercised all36 new skills with finite state. Six-gun batteries adjusted from9k/5k AP/HE to14k/8k to approach the reference twelve-gun battery output.
- Browser captures and combat results live in docs/verification/misc-titans (ignored generated artifacts). New ships were visually inspected in the actual renderer.
- No changes applied to original coop-rush checkout; work remains on misc-titans for later integration.

## Final verification
- npm test: 115 files / 1,586 tests passed (baseline 1,488).
- npm run build: passed; Vite reports the existing large-bundle advisory.
- npm run verify:ui: passed at 1280×720, 1920×1080 and 2560×1080; menu navigation and LAN lobby checks passed.
- node scripts/verify-judge-input.mjs: pointer confirmation, fallback Escape and pointer-lock Escape passed.
- node scripts/verify-misc-titans.mjs: four models/skill kits/resource HUDs rendered, finite state, no browser page errors; Faultline ridge visible.
- node scripts/verify-misc-combat.mjs: 48 deterministic AI duels, all36 new skills exercised, no non-finite battle state. This is initial balance validation, not a claim of equal duel win rates.
- Final additional regression: rejected Judge law choices are consumed with their input edge; the next E press opens selection normally.
