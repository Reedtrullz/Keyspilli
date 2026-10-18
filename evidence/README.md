# Evidence

Machine-written evidence lives here: captures, manifests, ledgers, freezes, fixtures, and the one-off scripts that produced them. It used to sit under `docs/`. It was moved on 2026-10-17 (Reidar chose a top-level `evidence/` folder) so that `docs/` holds prose only. History was not rewritten: `git log --follow` works on every moved file.

| Now | Was |
|---|---|
| `evidence/research/` | `docs/research/keyspilli-evidence/` |
| `evidence/superpowers/` | `docs/superpowers/evidence/` |
| `evidence/plans/*.json` | `docs/superpowers/plans/*.json` (preregistrations, baselines and reports; the Markdown plans stay in `docs/`) |
| `evidence/performance/` | `docs/performance-{baseline,span,stress}-2026-10-02.json` |
| `evidence/ops/` | `docs/ops/music-review-results-2026-10-05.json` |
| `evidence/research/2026-10-02-local-decoder-resource-probe-3.json` | `docs/research/2026-10-02-local-decoder-resource-probe-3.json` |

The relocation map in `relocations.json` records every original path, SHA-256 and stored location, plus each current copy's hash. It covers 318 moved files and the original versions of 33 changed context files from source commit `6742f2400d219ff60fade0a8f099300d4f89aef4`. It does not freeze today's application source or establish new musical approval.

The original proposal moved 270 files byte-for-byte and adapted 48 for paths, imports or links. Every original remains preserved: unchanged bytes at the current path, or an unmodified copy under `evidence/originals/` with a `.raw` suffix, alongside original context files. Repairs restore some current copies to their original bytes; the map records each current digest rather than treating the proposal counts as a live qualification. Raw files are immutable records, not executable tools. Updated current copies are derivatives, not replacement baselines or historical approval receipts. Links pinned to historical commits retain the paths that existed at those commits.

Verify all originals and current derivatives without changing them:

```sh
python3 -B scripts/evidence_relocation.py
```

Reconstruct the original tracked layout into a new directory outside this checkout:

```sh
python3 -B scripts/evidence_relocation.py --reconstruct /absolute/new/run-local/evidence-layout
```

The command verifies inputs first, refuses existing destinations, traversal and symlink inputs, bounds the reconstruction to 32 MiB and checks its estimated size against a 6 GiB free-space reserve. It writes isolated copies without hardlinks and removes its own partial output on failure or cancellation. A successful output is owned scratch: use a run-local directory and release it after checking; on the VPS, allocate it through the installed managed-run lifecycle. Existing canonical archives, protected evidence and production data are never reconstruction destinations.

This is a reconstruction of tracked evidence and changed context, not a complete historical runtime or acquisition restore. Some historical audio/input bytes are absent from the current tree; their existing commit-pinned references are preserved. Restore and verify those inputs separately before attempting a complete old runtime evaluation. The representative fixture reconstruction check verifies the baseline's production/evaluation fixture hashes; it does not claim that all historical recordings were replayed.

## Rules

- Preserve original bytes and their relocation-map hashes. Make any needed adaptation in an explicitly mapped current derivative; never repair a failed original hash in place. Validators and sealed manifests retain their existing SHA-256 checks.
- Put new machine-written JSON here, not under `docs/`. Link to it from the prose in `docs/`.
- Code that reads evidence uses the `evidence/...` paths:
  - `apps/web/playwright.chords-v2.t1.config.ts`
  - `apps/web/playwright.organ-gain.config.ts`
  - `apps/web/scripts/validate-chords-v2-t1-evidence.mjs`
  - `services/transcribe/scripts/evaluate-tutorial-pipeline.ts`
  - `packages/catalog/scripts/evaluate-independent-current.ts`
- Older records retain the implementation identities and acceptance limits from their creation. Relocation is not a new pass, and preserved historical hashes must not be replaced by current source hashes.

## Hash-pinned plan JSON

These four files are pinned by SHA-256 in Markdown results or in `evidence/research/experiment-ledger.json`, so they were moved byte-for-byte and are never edited:

- `2026-09-02-beginner-budget-revision-preregistration.json`
- `2026-09-02-beginner-sparse-lh-promotion-evidence-repair-preregistration.json`
- `2026-09-02-difficulty-ladder-baseline.json`
- `2026-09-03-current-production-difficulty-differentiation-review.json`

As a result, `2026-09-02-beginner-sparse-lh-promotion-evidence-repair-preregistration.json` still names its parent preregistration by the old `docs/superpowers/plans/...` path in `logicalRef`. Read that path as a historical record: the file now lives at `evidence/plans/2026-09-02-beginner-sparse-lh-production-preregistration.json`.

The map, original bytes and representative reconstruction are checked by `scripts/test_keyspilli_evidence_relocation.py`. Do not infer completeness from file counts or Git rename similarity alone.
