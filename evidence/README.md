# Evidence

Machine-written evidence lives here: captures, manifests, ledgers, freezes, fixtures, and the one-off scripts that produced them. It used to sit under `docs/`. It was moved on 2026-10-17 (Reidar chose a top-level `evidence/` folder) so that `docs/` holds prose only. History was not rewritten: `git log --follow` works on every moved file.

| Now | Was |
|---|---|
| `evidence/research/` | `docs/research/keyspilli-evidence/` |
| `evidence/superpowers/` | `docs/superpowers/evidence/` |

Inside each folder the layout is unchanged, so relative references between evidence files still resolve. Every hash list (`*.sha256`, `SHA256SUMS.txt`) uses paths relative to its own folder and still verifies.

## Rules

- Move files with `git mv` only. Never reformat them. Validators and sealed manifests check SHA-256 hashes of the exact bytes. For example, `evaluate-tutorial-pipeline.ts` refuses a manifest whose `.sha256` does not match.
- Put new machine-written JSON here, not under `docs/`. Link to it from the prose in `docs/`.
- Code that reads evidence uses the `evidence/...` paths:
  - `apps/web/playwright.chords-v2.t1.config.ts`
  - `apps/web/playwright.organ-gain.config.ts`
  - `apps/web/scripts/validate-chords-v2-t1-evidence.mjs`
  - `services/transcribe/scripts/evaluate-tutorial-pipeline.ts`
- Older evidence records (candidate freezes, packets) list implementation-file hashes from the day they were made. They were already stale before this move, and nothing checks them.

## Not moved yet

- The JSON under `docs/superpowers/plans/`: preregistrations and baselines that sit next to their Markdown plans. Whether these move was left open in the proposal.
- A few small loose files: `docs/ops/music-review-results-2026-10-05.json`, `docs/performance-*-2026-10-02.json` and `docs/research/2026-10-02-local-decoder-resource-probe-3.json`.
