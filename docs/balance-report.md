# Naval balance report

Selection baseline: 112 fixed-seed battles, 96 line battles (16 per era including mixed) plus 16 titan battles, recorded before tuning. The additional main-gun cohort was selected from this run; its raw results are in `verification/balance-selection-baseline.json`.

Final comparison: another 112 baseline and 112 tuned battles on the final combat rules, with only the damage/aircraft/traverse changes removed for the baseline. `node scripts/compareBalance.mjs` creates isolated temporary snapshots and runs identical seeds, maps, rosters and hard AI. Raw matched results are in `verification/balance-before.json` and `verification/balance-after.json`.

Ordinary main and secondary cannon damage is multiplied by 1.20. Aircraft HP is multiplied by 1.50; ordinary launch cooldown and restoration intervals by 0.80. Skill definitions are unchanged. Qualifying weaker-skill main guns receive a further 1.15 multiplier (1.38 total).

Selection rule: at least four appearances, mean damage below the era/class-group median, and skill share below both the group median and 40%. CA/CL/CB share the existing cruiser comparison group. Hulls without main guns receive no main-gun entry. This remains an aggressive starting pass: small cohorts and AI results cannot establish human feel.

| Ship | Selection n | Initial damage | Group median | Skill share | Main multiplier | Matched baseline | Matched tuned |
|---|---:|---:|---:|---:|---:|---:|---:|
| fletcher | 33 | 384,133 | 395,046 | 0.0% | 1.38 | 364,447 | 358,415 |
| desmoines | 17 | 516,579 | 737,526 | 30.9% | 1.38 | 509,241 | 595,100 |
| bismarck | 15 | 657,781 | 958,934 | 38.0% | 1.38 | 762,406 | 809,334 |
| warspite | 11 | 634,189 | 958,934 | 0.0% | 1.38 | 886,122 | 1,095,273 |
| silverbough | 15 | 295,144 | 403,825 | 0.0% | 1.38 | 243,250 | 285,404 |
| revenant | 15 | 1,293,509 | 1,337,123 | 29.7% | 1.38 | 1,361,318 | 1,156,720 |
| tidesinger | 6 | 136,366 | 548,722 | 8.2% | 1.38 | 53,690 | 81,898 |
| daring | 14 | 434,269 | 499,059 | 17.1% | 1.38 | 493,554 | 535,525 |
| itachi | 6 | 0 | 100,789 | 0.0% | 1.38 | 237,832 | 141,515 |

Turrets below their exact era/ship-class median receive 25% faster traverse, capped at that median. Titans, summons and hidden forms retain their handling. `verification/traverse-buffs.json` records every affected hull and before/after degrees per second.

| Metric | Matched baseline | Tuned |
|---|---:|---:|
| Exceptions | 0 | 0 |
| NaN reports | 0 | 0 |
| Line battle timeouts (of 96) | 13 | 6 |
| Median line battle length (minutes) | 5.86 | 5.09 |
| Carrier mean damage | 294059 | 326847 |
| Ordinary carrier mean damage (skill share under 10%) | 77801 | 109545 |

Damage means can fall despite direct buffs because battles follow different trajectories. A shared seed controls map/roster/random stream initialization; it cannot force identical tactical decisions after damage or reload changes. Zero exceptions and NaNs were found in both matched runs. Broad upward adjustments beyond the specified starting buffs would need more carrier and human play data; no destructive skills were reduced.

Verification includes fixed-seed AI battles, direct gunnery/carrier runs, AA/fighter regression coverage, and source assertions for the exact damage/durability/cooldown multipliers. Human gunnery feel and a physical gamepad remain playtest limitations.
