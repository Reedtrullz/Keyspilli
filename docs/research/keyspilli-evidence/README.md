# Keyspilli evidence ledger

This is the durable, path-free summary of the transcription and symbolic-source
experiments. It records decisions and bounded evidence, not copyrighted note
arrays, audio, stems, model weights, or temporary listening packs. Raw artifacts
remain private and disposable according to `storage-policy.md`.

## Product target and gate boundary

The target is a recognizable, playable piano arrangement: a coherent right-hand
melody, useful left-hand harmony/bass, stable rhythm, and a sensible difficulty
ladder. Source fidelity is secondary to learning value. Structural and automated
metrics are the default engineering evidence. Subjective recognizability or
playability claims remain explicitly unassessed unless the user requests human
evaluation; they are never inferred from automated scores.

The accepted product path is `EXTERNAL_SYMBOLIC_FIRST`; audio AMT remains
unsupported as a source authority or automatic fallback. `BENCHMARK_REFERENCE` material is evaluation-only and cannot enter
candidate discovery, generation, fusion, or arrangement. A candidate needs an
independent `alignment.status = aligned` attestation before it can be treated as
generation evidence. Strict reference scoring is null/fail-closed without at
least three aligned windows and 32 comparable bars.

The repaired private-alpha release is now live at immutable revision
`e9dd13a672e9d252b6441076e3ff99c3937cecd9`. A real Chromium browser completed
the authenticated same-origin upload through the live reverse proxy; cross-site
mutation remained blocked. The deployment also passed discovery/handoff,
generation, exports, restart, atomic failure, idempotency, and scoped cleanup.
Keyspilli-owned light/deep systemd monitoring now exposes health, disk, backup,
TLS, Caddy, container, database, and provider-event state without a new secret
or external service. Current decision:
`PRIVATE_ALPHA_OPERATIONALLY_HARDENED_LIVE_VERIFIED`.

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
  role, alignment, and objective validation gates.

## Current blocker and next boundary

Direct dense-metal AMT is `AUDIO_AMT_BRANCH_CLOSED_FOR_CURRENT_PRODUCT_ARCHITECTURE`.
It must not act as source authority or automatic fallback without one of the
material reopening triggers frozen in the closeout report. The current product
path is `EXTERNAL_SYMBOLIC_FIRST`. Product hardening is complete locally; the
authorized deployment candidate was rolled back after its real browser upload
mutation failed at the reverse-proxy origin boundary. The defect is now covered
by `live-same-origin-browser-mutation-port-fix-2026-09-05.json`; deployment has
not been retried.

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
* `cold-transfer-2026-09-02-rerun-metrics.json` — path-free machine-readable
  extract of the frozen per-song metrics, support sets, agreement, and union
  ceiling.
* `texture-amt-routing-2026-09-02.md` — fixed-window, reference-gated AMT
  routing oracle and explicit no-router/no-promotion decision.
* `texture-amt-routing-2026-09-02-metrics.json` — path-free routing metrics,
  per-backend precision/recall, texture-class features, agreement/support
  classes, freeze/report hashes, candidate counts, and limits.
* `muscriptor-cold-metal-reference-evaluation-2026-09-05.json` — frozen
  single-checkpoint MuScriptor reference evaluation; stopped before gated
  weight access, with no protected reference reads or production changes.
* `muscriptor-hf-access-resume-2026-09-05.json` — browser entitlement was
  granted, but the local CLI remained unauthenticated; historical benchmark
  rights were not established and no protected bytes were opened.
* `muscriptor-local-auth-runtime-unlock-2026-09-05.json` — the installed
  official CLI offered token-only login, so no credential, weights, runtime,
  or audio evaluation was started.
* `muscriptor-hf-browser-auth-runtime-unlock-2026-09-05.json` — the official
  browser/device flow authenticated the local research cache, the exact
  frozen weights loaded on MPS, and a project-owned sanity transcription was
  deterministic; dense-metal evaluation remains out of scope.
* `rights-cleared-dense-metal-amt-eval-corpus-2026-09-05.json` — bounded
  official-source survey, HiMMP partial-reference freeze, rights and claim
  boundaries, deterministic corpus verification, and the corpus decision.
* `dense-metal-amt-eval-corpus-v1-manifest.json` — path-free hashes, objective
  complexity metrics, renderer contract, and EVAL_ONLY firewall for the three
  project-owned full-reference pieces.
* `muscriptor-dense-metal-basic-pitch-baseline-2026-09-05.json` — frozen Basic
  Pitch 0.4.0 primary-comparator outputs and metrics captured before MuScriptor
  corpus inference.
* `muscriptor-dense-metal-cold-evaluation-2026-09-05.json` — preregistered
  MuScriptor synthetic full-reference and real kick-only results, raw hashes,
  exact gate decision, and downstream skip.
* `audio-amt-branch-closeout-2026-09-05.json` — chronological AMT inventory,
  separated failure modes, immutable closure decisions, and material reopening
  conditions.
* `discovery-assisted-private-alpha-product-hardening-2026-09-05.json` —
  learner-surface contract reconciliation, fail-closed public AMT retirement,
  discovery/upload state matrix, and local production-container canary.
* `discovery-assisted-private-alpha-hardening-deployment-canary-2026-09-05.json`
  — exact live candidate artifact, discovery/handoff/symbolic canaries,
  browser-origin failure, cleanup, and verified rollback evidence.
* `discovery-assisted-private-alpha-hardening-deployment-canary-retry-2026-09-05.json`
  — immutable retry artifact, real-browser live upload, security boundaries,
  durability, cleanup, and retained rollback evidence.
* `private-alpha-operations-monitoring-hardening-2026-09-05.json` — deployed
  light/deep operations checker, thresholds, negative fixtures, and live status.
* `private-alpha-operational-readiness-closeout-2026-09-05.json` — consolidated
  live, recovery, operations, limitation, and next-goal decision.
* `owner-private-alpha-access-restoration-2026-09-05.json` — owner-usable
  Keychain recovery, live Basic Auth browser matrix, and unchanged-runtime
  evidence without credential material.

## Cold-transfer boundary

`cold-transfer-preregistration.template.json` is a path-redacted template for
an evaluation-only freeze check. `pnpm --filter @keyspilli/catalog
evaluate:cold-transfer -- --preregistration /private/.../preregistration.json`
verifies exact guitar-stem metadata and frozen raw MIDI outputs before opening
any reference MIDI. Missing or hash-mismatched exact inputs fail closed as
`GAPS_COLD_TRANSFER_UNAVAILABLE`; the catalog, production runtime, and
downstream arrangement code remain untouched.
