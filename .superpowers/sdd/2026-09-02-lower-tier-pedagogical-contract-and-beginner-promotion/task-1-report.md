# Task 1 — Freeze and preregistration

Status: complete. Production source and tests were not changed.

## Freeze

- Starting revision: `008ac14fb546557da7593c55cf27b225da138e27`
- Branch: `codex/metal-inference-lane-lock`
- Working tree was already dirty with user-owned `.tmp-source-audit/`, the
  implementation plan, and root `pnpm-lock.yaml`; these were not staged.
- Data-volume free space: `56 GiB` (`df -h /System/Volumes/Data`).
- Read-only calibration: `npm run calibrate:ladder -w @keyspilli/catalog -- --out <logical-output-path>` — exit 0.
- Six-level output freeze: four eligible fixtures × six levels; the exact
  hashes and source hashes are in the preregistration JSON.

## Current contract findings

The canonical IDs and display labels are `very-beginner` / Very Beginner,
`beginner` / Beginner, and `very-easy` / Very Easy. `buildVariants()` uses
0.5-beat / 1-beat melody floors and 12-semitone span caps for Very Beginner,
0.25-beat / 0.5-beat floors and a 12-semitone span cap for Beginner, and the
retained Easy RH/LH stream at Very Easy. `PLAYABILITY_LIMITS` are respectively
maxSim 2/2/5, max density 5/6/12 attacks per second, and minimum median IOI
0.15/0.08/0.08 seconds. Calibration invokes `maxDurBeats: null`, so note duration
is intentionally unbounded/waived for this frozen calibration; note duration
validity remains a metric/regression check. Generic learner Beginner is RH-only; only the metal
profile invokes the existing `sparseLeftHandAnchors` primitive. Therefore the
proposed contracts classify as `ALREADY_ALIGNED` (Very Beginner),
`NOT_ALIGNED` (Beginner), and `PARTIALLY_ALIGNED` (Very Easy).

## Fixture eligibility

The declared generation-side corpus is `classical`, `cover`, `pop`, and the
project-owned inline `synthetic-full-band` fixture. The first three are frozen
local trusted inputs whose `data/artifacts/...` paths are ignored/untracked;
their hashes are preserved in the preregistration, but reproducibility requires
the same local files. The repository also has
seven private human-validated benchmark/reference songs (`1916`, Christmas
Truce, The Final Solution, Gott Mit Uns, The Red Baron, Free Bird, and The
Carolean's Prayer); all are `EVAL_ONLY`. The tracked seed MIDIs
`data/seed-midi/dadebrayant-avenged-sevenfold-dear-god-piano-cover-msm014zo.mid`
and `data/seed-midi/the-theorist-elton-john-your-song-piano-cover-jz6ugvghbt8.mid`
are also `EVAL_ONLY`: they are seed/product inputs, not declared calibration
fixtures. The 457 local catalog manifests and
generated artifact tree are `EXCLUDED` because they are product data, not
declared calibration fixtures. Temporary/unread external/protected material
is also excluded. No protected reference was opened or downloaded.

## Artifact

Preregistration: `docs/superpowers/plans/2026-09-02-beginner-sparse-lh-production-preregistration.json`

SHA-256: `26af25998344d3c1c1740a46765d5af9669528c233c7a8f89affadc12b8133a3`

This freezes the exact `COLLISION_AWARE_SPARSE_LH` rule, proposed contracts,
eligibility classifications, six-level digests, metrics, hard/regression
gates, promotion rule, and deferred `COVER_RH_IDENTITY_CLIFF` /
`DIFFICULTY_DIFFERENTIATION_CONCERN` concerns before aggregate evaluation.
