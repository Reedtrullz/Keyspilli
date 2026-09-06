# Controlled Beginner role-budget revision — results

## Decision

`BEGINNER_TWO_HAND_SKELETON_PROMISING_NOT_VALIDATED`

`NO_PRODUCTION_BEHAVIOR_CHANGE`

The experiment tested the preregistered baseline plus exactly three envelopes. Candidate A did not change any Beginner output. Candidates B/C recovered active left-hand-only passages, but violated Beginner's two-sounding-note ceiling on the human fixtures and produced no principal RH identity gain. They are useful product evidence, not a safe default change.

## Freeze and provenance

- Branch: `codex/metal-inference-lane-lock`
- Freeze revision: `663adcd97c4ebbc1c37f3d0ec49375faa5d839ff`
- Preregistration commit: `6ef9804`
- Preregistration SHA-256: `9c7a47e0f007a74af0f8d4528ad0e6b935c525624997c49b5d8c56e72f10be63`
- Frozen ladder SHA-256 (tracked/current/repeat): `19500f7c4b7dc4cff3fa4d4ac3104176c8cc06241ec5b97608e5c33970a4a98b`
- Candidate report (local-only): `/private/tmp/keyspilli-beginner-budget-revision/report.json`
- Candidate report SHA-256 (repeat run identical): `f125b9b496cbf1856dcc915cd526d7419c635780e2758106dea04b6cc9d9cd87`

The four source fixtures were unchanged and remained outside the candidate output:

| Fixture | SHA-256 | Source notes | Tempo / meter |
|---|---|---:|---|
| Classical | `e7e0fd260e049e338120cc4ee35c1a998ef616c01529a4c1a79837d6bb914039` | 1,309 | 60 / 9/8 |
| Cover | `eb8a1cf8f0076a548acaa206b67d19123814e1167d654496afa24c0458dc6f9d` | 1,400 | 144 / 4/4 |
| Pop | `87915f6b8dce035951af2ddc89c9c36ce105fde8e79ba6f936e31b7f80ef7fd6` | 1,016 | 79 / 4/4 |
| Synthetic full-band | `fba496e372f8962967b5e08903fa4883d6f4be1bde046f0eb3a06e1a1dcc8dc6` | 20 | 120 / 4/4 |

## Binding constraints

Generic learner Beginner is RH-only: `buildVariants()` takes Very Easy RH through the Beginner melody path (`melodyOnly` → sounding-span cap → Beginner cap → ladder preservation), and only the metal profile calls `sparseLeftHandAnchors`. Beginner's hard envelope is `maxSim=2`, `maxDensity=6 attacks/s`, `minMedianIoi=.08s`, 0.25-beat grid, 0.5-beat melody minimum, and `LADDER_TOL.beginner=.02`.

The prior lineage attribution remains:

| Fixture | Principal-RH loss at Beginner | LH-only input loss | First binding cause |
|---|---:|---:|---|
| Classical | 0 | 527 | `ROLE_POLICY_RH_ONLY` for lower texture |
| Cover | 398 | 434 | RH ladder/selection cliff plus `ROLE_POLICY_RH_ONLY` |
| Pop | 0 | 472 | `ROLE_POLICY_RH_ONLY` |
| Synthetic | 0 | 4 explicit guitar-LH events | `ROLE_POLICY_RH_ONLY` |

Case 05 (`pop`, `[0,12)`) is a policy probe, not a selector failure: Very Easy has 9 LH notes across 5 onsets; Beginner has no RH candidate and therefore emits zero events.

## Candidate frontier

All non-Beginner levels were held byte-identical to the frozen baseline in every candidate envelope.

| Candidate | Beginner change | Result |
|---|---|---|
| A | `LADDER_TOL.beginner` `.02 → .075` (midpoint to Very Easy) | No digest/count/coverage change on any fixture; no identity gain. |
| B | Add at most one lowest Very Easy LH note at the first LH onset of each 4-beat source window | Recovers LH-only activity, but adds 80/129/95/2 LH notes (Classical/Cover/Pop/Synthetic); new `Beginner: 3 sounding notes (limit 2)` on the three human fixtures; RH coverage unchanged. |
| C | A + B | Byte-identical to B because A was a no-op; same playability failure and no RH gain. |

Selected metrics (Beginner):

| Fixture | Baseline notes (RH/LH) | A notes (RH/LH) | B/C notes (RH/LH) | RH onset coverage (all) | Fully erased active 4-beat windows (baseline → B/C) |
|---|---:|---:|---:|---:|---:|
| Classical | 435 (435/0) | 435 (435/0) | 515 (435/80) | `.991/.991/.991/.991` | `0 → 0` |
| Cover | 381 (381/0) | 381 (381/0) | 510 (381/129) | `.474/.474/.474/.474` | `13 → 2` |
| Pop | 375 (375/0) | 375 (375/0) | 470 (375/95) | `.997/.997/.997/.997` | `28 → 0` |
| Synthetic | 4 (4/0) | 4 (4/0) | 6 (4/2) | `1/1/1/1` | `0 → 0` |

For Case 05 specifically, Beginner `[0,12)` is `0` events in baseline/A and `2` sparse LH anchors in B/C. This confirms the role-policy mechanism, but it does not meet the preregistered RH identity-gain criterion.

## Gate outcome

- Candidate A: `NO_MATERIAL_IDENTITY_GAIN`.
- Candidate B: `BEGINNER_TWO_HAND_SKELETON_PROMISING_NOT_VALIDATED`; active LH recovery is real, but it violates the existing two-sounding-note gate and changes the Beginner teaching contract.
- Candidate C: same as B; no additional benefit over B.
- No candidate recovered ≥10% of lost RH proxy events or improved RH onset coverage by ≥.10.
- No non-Beginner control digest changed.

The smallest defensible follow-up is a separately designed two-hand Beginner policy with an explicit collision rule (rather than shipping B), or a richer RH principal-event experiment for the Cover cliff. Neither is part of this slice.

## Verification and boundaries

The local candidate report was generated twice with the same bytes/options; SHA and `cmp` matched. No production/default Beginner behavior, other difficulty level, external reference MIDI, audio render, replay, deployment, or human-rater work was performed.
