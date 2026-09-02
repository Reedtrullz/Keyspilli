# Easy-difficulty preservation

## Scope

Use only the existing trusted symbolic fixtures and the current MIDI pipeline. Diagnose Easy loss, implement at most three generic Easy-only fixes, and keep Advanced and Medium byte/structure-equivalent unless a correctness defect proves otherwise. Do not touch AMT, Basic Pitch, GAPS, separation, routing, decoder acquisition, benchmark references, deployment, or production replay.

## Tasks

1. **Preflight and corpus freeze**
   - Verify branch/remote HEAD, disk floor, dirty files, and existing trusted direct-piano/64-attack fixtures.
   - Record fixture IDs, source hashes, timing, roles, and generation eligibility in the plan ledger; keep external/reference MIDIs outside the repository.
   - Generate deterministic canonical/Advanced/Medium/Easy baseline outputs and digests in the plan workspace.

2. **Baseline lineage and loss funnel**
   - Inspect the real Easy path in `packages/midi/src/simplify.ts` and callers/tests.
   - Add the smallest test-only or diagnostics-only harness that counts SOURCE → canonical → Easy input → conflict/WIS → rate → range/revoice → final, with role-aware counts and deterministic loss reasons.
   - Quantify repeated-note, conflict, rate, octave/contour, harmony-change, same-harmony reattack, and playability metrics across every frozen fixture plus the existing full-band shadow fixture.

3. **TDD fix selection**
   - Add a failing synthetic regression for the measured highest-impact generic defect before changing production code.
   - Implement the minimum Easy-only correction (prefer preserving principal melody/re-attacks while simplifying accompaniment); record BASELINE/FIX A ablation and prove Advanced/Medium parity.
   - Add FIX B/C only if fresh cross-fixture evidence shows a separate material defect and the first fix remains playability-safe. Never exceed three behavioral fixes.

4. **Cross-fixture and shadow verification**
   - Run all frozen fixtures and the 64-attack/full-band shadow through baseline and each ablation.
   - Classify melody, harmony, and playability as improved/same/regressed; verify Easy remains materially simpler than Medium and harmony does not materially regress.

5. **Closeout**
   - Produce a compact path-free JSON/Markdown report in the plan workspace with the requested funnel, metrics, ablations, parity, safety non-claims, and exactly one decision state.
   - Run focused tests, full workspace tests, all workspace typechecks, diff-check, deterministic rerun, Advanced/Medium digest parity, remote SHA, and disk checks.
   - Commit/push only green checkpoints on `codex/metal-inference-lane-lock`, verify remote parity, and append an evidence-backed project note to Obsidian. Do not implement the follow-up task from the brief.

## Global constraints

- Use `apply_patch` for edits and keep new artifacts below 50 MiB (prefer below 25 MiB).
- Preserve user-owned untracked files; never stage `.tmp-source-audit/`, root `pnpm-lock.yaml`, references, or benchmark assets.
- No reference MIDI generation/tuning, no model/separator downloads, no audio unless objective metrics justify a tiny project-owned diagnostic.
- Every completion claim requires fresh verification output in this turn.
