# Keyspilli evidence ledger

This is the durable, path-free summary of the transcription and symbolic-source
experiments. It records decisions and bounded evidence, not copyrighted note
arrays, audio, stems, model weights, or temporary listening packs. Raw artifacts
remain private and disposable according to `storage-policy.md`.

## Product target and gate boundary

The target is a recognizable, playable piano arrangement: a coherent right-hand
melody, useful left-hand harmony/bass, stable rhythm, and a sensible difficulty
ladder. Source fidelity is secondary to learning value. Structural and automated
metrics are diagnostics; recognizability and playability require human listening.

The accepted source order is `EXTERNAL_SYMBOLIC_FIRST`, with audio AMT as a
fallback. `BENCHMARK_REFERENCE` material is evaluation-only and cannot enter
candidate discovery, generation, fusion, or arrangement. A candidate needs an
independent `alignment.status = aligned` attestation before it can be treated as
generation evidence. Strict reference scoring is null/fail-closed without at
least three aligned windows and 32 comparable bars.

## Chronological conclusions

### Direct metal and semantic guitar work

The direct metal path, source-aware lane locking, semantic guitar harmony, low
wall routing, and learner cleanup made the MIDI structurally safer: vocals stay
immutable, drums remain pitchless, rhythm roots can reach the left hand, and
source interleaving was reduced. Synthetic coverage includes harmonic-stack
collapse, jittered onsets, source lock, vocal preservation, low-wall handling,
root/quality stabilization, variants, and monotonicity.

Human listening did not support a recognizability claim. On retained real stems,
Easy/Medium still lost substantial lead detail and the remaining AMT pitch
evidence was weak. Reference-shaped checks therefore remain diagnostics, not a
release gate. No Sabaton-specific rule was accepted.

### Defence of Moscow reference comparison

Two local reference MIDI files were byte-distinct aliases of the same compact
event set (velocity/track/division differences only). They were kept outside
the repository. The reference has a regular upper line, a separate low lane,
and a denser solo; generated windows were longer and not safely alignable by an
implicit offset. The comparison conclusion is qualitative and structural:
human references sounded good, while generated direct-metal variants were not
recognizable. No reference bytes were uploaded or used for generation.

### OMR and score-source investigation

Audiveris and HOMR, including a dual-engine/canonical-spine experiment, supplied
useful role and agreement diagnostics but not a dependable seven-song symbolic
source. Coverage, alignment, raster/OMR noise, and operational cost outweighed
the benefit for the current product slice. OMR remains an optional local
evidence path, not a production dependency.

### Seven human-validated benchmark MIDIs

The private set covers `1916`, `Christmas Truce`, `The Final Solution`, `Gott
Mit Uns`, `The Red Baron`, `Free Bird`, and `The Carolean's Prayer`. Human review
found the supplied source excerpts musically useful, so they are
`BENCHMARK_REFERENCE` / `EVAL_ONLY`. Their hashes and private locations are in
the ignored retention manifest, not this ledger. The latest evidence inventory
has **0/7 legitimate independently aligned candidates** and **0/7 real songs
human-ready**; local submitted files are not independent acquisition proof.

### Audio AMT experiments

The tested routes were Demucs `htdemucs_6s` + Basic Pitch, BS-RoFormer + Basic
Pitch, YourMT3+, and direct AMT baselines. Separation and onset timing were
often useful, but pitch correspondence and downstream lead retention remained
poor. In the three-song oracle, raw guitar onset recall was approximately
64.8%/75.5%/69.8% (Final Solution/Gott Mit Uns/Red Baron), while current Easy
right-hand guitar onset recall was approximately 8.7%/17.1%/11.9%. This is an
upstream evidence ceiling, not proof that another arranger threshold will solve
the songs. Generated WAV/stems are not durable evidence; their conclusions and
hashes are summarized in the machine ledger.

### Architecture decisions

* `SEPARATION_FIRST` was rejected as the default authority because separated
  metal stems still contain ambiguous harmonic/rhythm evidence.
* `DIRECT_AMT_FIRST` was rejected as the default authority because pitch
  fidelity and melody continuity were not dependable.
* `EXTERNAL_SYMBOLIC_FIRST` was selected, with strict provenance, identity,
  role, alignment, and human gates; AMT remains a conservative fallback.

## Current blocker and next boundary

The blocker is trustworthy, independently aligned lead evidence for real songs,
not another broad learner-rate tweak. The next musical task must start only
after an explicit new decision; this storage mission intentionally does not
resume it. The current branch and checkpoint preserve the implementation and
experiment history needed to continue later.

## Durable companion files

* `experiment-ledger.json` — stable experiment IDs, commits, outcomes, and
  retention decisions.
* `reproduction-manifest.md` — tools, model identifiers, and deterministic
  configuration boundaries.
* `storage-policy.md` — one artifact root, metadata, expiry, and disk guard.
* `storage-inventory.json` — measured storage snapshot and disposition classes.

* `cold-transfer-2026-09-02-rerun.md` — paired Basic Pitch/GAPS rerun,
  freeze-before-reference hashes, diagnostic metrics, and the no-promotion
  decision.

## Cold-transfer boundary

`cold-transfer-preregistration.template.json` is a path-redacted template for
an evaluation-only freeze check. `pnpm --filter @keyspilli/catalog
evaluate:cold-transfer -- --preregistration /private/.../preregistration.json`
verifies exact guitar-stem metadata and frozen raw MIDI outputs before opening
any reference MIDI. Missing or hash-mismatched exact inputs fail closed as
`GAPS_COLD_TRANSFER_UNAVAILABLE`; the catalog, production runtime, and
downstream arrangement code remain untouched.
