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

Inside each moved folder the layout is unchanged, so relative references between evidence files still resolve. Every hash list (`*.sha256`, `SHA256SUMS.txt`) uses paths relative to its own folder and still verifies.

## Rules

- Move files with `git mv` only. Never reformat them. Validators and sealed manifests check SHA-256 hashes of the exact bytes. For example, `evaluate-tutorial-pipeline.ts` refuses a manifest whose `.sha256` does not match.
- Put new machine-written JSON here, not under `docs/`. Link to it from the prose in `docs/`.
- Code that reads evidence uses the `evidence/...` paths:
  - `apps/web/playwright.chords-v2.t1.config.ts`
  - `apps/web/playwright.organ-gain.config.ts`
  - `apps/web/scripts/validate-chords-v2-t1-evidence.mjs`
  - `services/transcribe/scripts/evaluate-tutorial-pipeline.ts`
  - `packages/catalog/scripts/evaluate-independent-current.ts`
- Older evidence records (candidate freezes, packets) list implementation-file hashes from the day they were made. They were already stale before this move, and nothing checks them.

## Hash-pinned plan JSON

These four files are pinned by SHA-256 in Markdown results or in `evidence/research/experiment-ledger.json`, so they were moved byte-for-byte and are never edited:

- `2026-09-02-beginner-budget-revision-preregistration.json`
- `2026-09-02-beginner-sparse-lh-promotion-evidence-repair-preregistration.json`
- `2026-09-02-difficulty-ladder-baseline.json`
- `2026-09-03-current-production-difficulty-differentiation-review.json`

As a result, `2026-09-02-beginner-sparse-lh-promotion-evidence-repair-preregistration.json` still names its parent preregistration by the old `docs/superpowers/plans/...` path in `logicalRef`. Read that path as a historical record: the file now lives at `evidence/plans/2026-09-02-beginner-sparse-lh-production-preregistration.json`.

Everything that was under `docs/` as JSON evidence has now moved.
