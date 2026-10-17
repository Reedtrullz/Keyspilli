# Proposal: move large evidence JSON out of `docs/`

Status: **draft proposal, no files moved yet.** Moving anything needs Reidar's decision on the destination (see "Decisions needed").

## Why

`docs/` is 11.0 MB of the 32.8 MB checked-out tree. 214 JSON files make up 8.5 MB of that. The 43 files of 50 KB or more account for 6.9 MB. These are machine-written evidence: captures, manifests, ledgers and fixtures. Nobody reads them as documentation, but they dominate `docs/` diffs and searches and make the prose hard to find.

## Constraints

- **No history rewrite.** No `git filter-repo`, no force-push. Old commits keep the files, so the pack size (about 73 MiB) does not shrink. Only the checkout and `docs/` get lighter.
- **Evidence must stay verifiable.** Many manifests record relative paths and SHA-256 hashes of sibling files. A move must keep each evidence directory's internal layout so those relative references stay valid. Content must be byte-identical (`git mv`, no reformatting).

## What code depends on today

These paths are read by code and must be updated in the same commit as any move:

| Consumer | Path |
|---|---|
| `apps/web/playwright.chords-v2.t1.config.ts` | `docs/superpowers/evidence/2026-09-17-chords-v2-fixtures/` |
| `apps/web/playwright.organ-gain.config.ts` | `docs/superpowers/evidence/2026-09-19-cathedral-organ-gain/` |
| `apps/web/scripts/validate-chords-v2-t1-evidence.mjs` | `…/2026-09-17-chords-v2-baseline.json`, `…-oops-phrase-captures.json`, `…-chords-v2-fixtures/`, `…-chords-v2-evaluation-fixtures/` |
| `packages/catalog/scripts/evaluate-independent-current.ts` | `docs/superpowers/plans/beginner-sparse-lh-independent-current-eval-preregistration.json` |
| `services/transcribe/scripts/evaluate-tutorial-pipeline.ts` | `docs/research/keyspilli-evidence/tutorial-evaluation-manifest.json` |

That is 26 of the 214 JSON files (1.1 MB). No workflow under `.github/` references `docs/` paths. Inside `docs/`, about 60 Markdown or JSON references use full `docs/...` paths, and more use relative links. All of them would be rewritten mechanically.

## Options

1. **Top-level `evidence/` directory (recommended first step).**
   - `git mv docs/research/keyspilli-evidence evidence/research` and `git mv docs/superpowers/evidence evidence/superpowers`. The plan JSONs under `docs/superpowers/plans/*.json` go to `evidence/plans/`.
   - Rewrite the code paths above and the `docs/...` references with a script. Leave relative links inside a moved directory unchanged.
   - Pros: one reviewable PR, no new infrastructure, evidence stays versioned with the code that produced it.
   - Cons: the checkout size is unchanged. Only `docs/` gets lighter.
2. **Separate `Keyspilli-evidence` repository, or release assets, with a pinned manifest.**
   - Keep a small `evidence/manifest.json` (path → SHA-256 → URL) in this repo. Fetch on demand for the chords-v2 and organ-gain Playwright suites and the validators.
   - Pros: the checkout shrinks by about 8.5 MB.
   - Cons: offline evaluation needs a fetch step, the validators need network or a cache, and a second repo to govern.
3. **Git LFS.** Not recommended. It adds a client dependency for every contributor and CI job, and the files are small text that diffs and greps fine.

## Proposed sequence (option 1)

1. Add a check that fails if new JSON files of 50 KB or more land under `docs/` (warn-only at first).
2. Move with `git mv` and rewrite paths in one commit. Run `validate-chords-v2-t1-evidence.mjs`, the chords-v2 T1 and organ-gain Playwright configs, `evaluate-tutorial-pipeline` manifest loading and the full `npm test`.
3. Re-verify recorded SHA-256 values against the moved files to confirm they are byte-identical.

## Decisions needed

- Destination: option 1 (in-repo `evidence/`) or option 2 (external store).
- Whether small JSON under `docs/superpowers/plans/` (preregistrations, below 50 KB) moves too, or stays next to its Markdown plan.

## Inventory: JSON files of 50 KB or more under `docs/` (at `main`)

| Size | Path | Read by code |
|---|---|---|
| 537 KiB | `docs/research/keyspilli-evidence/tutorial-prospective-difficulty-v2.json` |  |
| 354 KiB | `docs/superpowers/evidence/2026-09-17-chords-v2-evaluation-fixtures/dadebrayant-avenged-sevenfold-dear-god-piano-cover-msm014zo/a/notes.json` | yes |
| 278 KiB | `docs/superpowers/evidence/2026-09-18-task-5-audio/oops-64-108/final-capture/oops-section-2-original.json` |  |
| 277 KiB | `docs/superpowers/evidence/2026-09-18-task-5-audio/oops-64-108/initial-capture/oops-section-2-original.json` |  |
| 254 KiB | `docs/superpowers/plans/2026-09-03-current-production-difficulty-differentiation-review.json` |  |
| 248 KiB | `docs/superpowers/evidence/2026-09-18-task-5-audio/oops-64-108/source-preview-capture/oops-section-2-source-preview.json` |  |
| 243 KiB | `docs/superpowers/evidence/2026-09-17-chords-v2-fixtures/britney-spears-oops-i-did-it-again/a/notes.json` | yes |
| 243 KiB | `docs/superpowers/evidence/2026-09-18-task-5-audio/oops-64-108/initial-capture/oops-section-2-resume.json` |  |
| 243 KiB | `docs/superpowers/evidence/2026-09-18-task-5-audio/oops-64-108/final-capture/oops-section-2-resume.json` |  |
| 242 KiB | `docs/superpowers/evidence/2026-09-18-task-5-audio/oops-64-108/final-capture/oops-section-2-coherent.json` |  |
| 242 KiB | `docs/superpowers/evidence/2026-09-18-task-5-audio/oops-64-108/initial-capture/oops-section-2-coherent.json` |  |
| 232 KiB | `docs/research/keyspilli-evidence/authoritative-symbolic-density-normalization-2026-09-04.json` |  |
| 211 KiB | `docs/superpowers/evidence/2026-09-17-chords-v2-capture-packet/captures/reserved-dadebrayant-avenged-sevenfold-dear-god-piano-cover-msm014zo-manual.json` |  |
| 211 KiB | `docs/superpowers/evidence/2026-09-17-chords-v2-capture-packet/captures/reserved-dadebrayant-avenged-sevenfold-dear-god-piano-cover-msm014zo-original.json` |  |
| 206 KiB | `docs/superpowers/evidence/2026-09-17-chords-v2-capture-packet/captures/reserved-dadebrayant-avenged-sevenfold-dear-god-piano-cover-msm014zo-automatic.json` |  |
| 179 KiB | `docs/superpowers/evidence/2026-09-17-chords-v2-fixtures/aria-ellys-music-the-warning-hell-you-call-a-dream-piano-cover-by-aria-ellys-mslzwo1d/a/notes.json` | yes |
| 173 KiB | `docs/research/keyspilli-evidence/authoritative-symbolic-playability-gate-audit-2026-09-04.json` |  |
| 167 KiB | `docs/research/keyspilli-evidence/experiment-ledger.json` |  |
| 166 KiB | `docs/research/keyspilli-evidence/tutorial-runtime-artifact-hashes-2026-09-08.json` |  |
| 165 KiB | `docs/research/keyspilli-evidence/ks09-harmony-pilot-2026-10-12/holdout-evaluation.json` |  |
| 160 KiB | `docs/research/keyspilli-evidence/chords-upload-automation-2026-09-27.json` |  |
| 154 KiB | `docs/superpowers/evidence/2026-09-17-chords-v2-fixtures/the-beatles-blackbird/a/notes.json` | yes |
| 139 KiB | `docs/research/keyspilli-evidence/difficulty-contract-implementation-2026-09-04.json` |  |
| 136 KiB | `docs/superpowers/evidence/2026-09-17-chords-v2-capture-packet/captures/reserved-c-v-alkan-prelude-original.json` |  |
| 133 KiB | `docs/superpowers/evidence/2026-09-17-chords-v2-capture-packet/captures/reserved-c-v-alkan-prelude-manual.json` |  |
| 132 KiB | `docs/research/keyspilli-evidence/importer-stress-2026-09-08/playability-audit.json` |  |
| 125 KiB | `docs/superpowers/evidence/2026-09-17-chords-v2-capture-packet/captures/reserved-c-v-alkan-prelude-automatic.json` |  |
| 118 KiB | `docs/research/keyspilli-evidence/difficulty-contract-review-2026-09-04.json` |  |
| 108 KiB | `docs/research/keyspilli-evidence/source-lane-candidates-2026-09-08.json` |  |
| 104 KiB | `docs/research/keyspilli-evidence/ks09-harmony-pilot-2026-10-12/development-evaluation.json` |  |
| 99 KiB | `docs/research/keyspilli-evidence/tutorial-runtime-dependencies-2026-09-08.json` |  |
| 96 KiB | `docs/superpowers/evidence/2026-09-17-chords-v2-capture-packet/captures/reserved-w-h-doane-near-the-cross-original.json` |  |
| 95 KiB | `docs/superpowers/evidence/2026-09-17-chords-v2-capture-packet/captures/reserved-w-h-doane-near-the-cross-manual.json` |  |
| 94 KiB | `docs/superpowers/evidence/2026-09-17-chords-v2-capture-packet/captures/reserved-w-h-doane-near-the-cross-automatic.json` |  |
| 84 KiB | `docs/superpowers/plans/2026-09-02-difficulty-ladder-baseline.json` |  |
| 65 KiB | `docs/research/keyspilli-evidence/tutorial-difficulty-2026-09-08.json` |  |
| 60 KiB | `docs/research/keyspilli-evidence/metal-piano-controls-2026-09-07.json` |  |
| 59 KiB | `docs/superpowers/evidence/2026-09-18-task-5-audio/blackbird-14-26.5/capture/blackbird-phrase-14-26.5-original.json` |  |
| 58 KiB | `docs/superpowers/evidence/2026-09-18-task-5-audio/blackbird-14-26.5/capture/blackbird-phrase-14-26.5-automatic.json` |  |
| 56 KiB | `docs/research/keyspilli-evidence/metal-beta-acceptance-2026-09-07.json` |  |
| 54 KiB | `docs/superpowers/evidence/2026-09-17-chords-v2-capture-packet/captures/reserved-beginner-piano-tutorial-easy-piano-jumbo-songbook-pay-me-my-money-down-mslzx940-manual.json` |  |
| 54 KiB | `docs/superpowers/evidence/2026-09-17-chords-v2-capture-packet/captures/reserved-beginner-piano-tutorial-easy-piano-jumbo-songbook-pay-me-my-money-down-mslzx940-original.json` |  |
| 53 KiB | `docs/superpowers/evidence/2026-09-17-chords-v2-capture-packet/captures/reserved-beginner-piano-tutorial-easy-piano-jumbo-songbook-pay-me-my-money-down-mslzx940-automatic.json` |  |
