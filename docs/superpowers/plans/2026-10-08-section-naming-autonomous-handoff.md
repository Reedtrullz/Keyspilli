# Section naming: autonomous handoff

Date: 2026-10-08
Base: `main` at `f85624d59249370ba532c7fb3be7deefdfb5c27d`, deployed and healthy.
Owner constraint: the owner will not hand-author hundreds of songs. Do this autonomously.
Design reference: `docs/song-sections.md`.

## Mission

Replace anonymous and machine-guessed section tabs across the catalog with real form names.
Success means more bases resolve to named sections, nothing regresses to `Section N`, and
every label carries provenance that does not overstate what was established.

## Baseline (read-only production audit, 2026-10-07)

| Fact | Value |
|------|-------|
| Rows / distinct bases in production `db.sqlite` | 2,730 / 455 |
| Served by the public API | 1,764 variants / 441 bases (14 not served) |
| Bases with real names | 4 of 441 (3 `source`, 1 `chart`) |
| Bases with estimates | 437 of 441 |
| Numbered `Section N` labels | 0 |
| Positional estimates (`Main passage`, `Opening`, `Closing`) | 70 |
| Approx categories per base | Pop 274, Classical 109, YouTube 46, Rock 15 |
| `catalog/song-sections.json` entries | 6 |
| Ultimate Guitar coverage | 42 manifest rows `source: ug-tabs`; 82 rows in `catalog/ug-tabs.json` |
| Timed-marker harvest | Complete: 391 seed MIDIs, exactly 5 with FF06/FF07 markers, all 5 mapped |

The two maps that look dead (`pink-just-give-me-a-reason`,
`abba-lay-all-your-love-on-me`) are `blocked: true` in
`catalog/learner-review.json`. They exist in the DB but are hidden by
`packages/catalog/src/db.ts`. Do not delete them.

## What you may decide without asking

1. Extract section labels from an external chord chart and write a
   `catalog/song-sections.json` entry with `evidence: "chart"`.
2. Align those labels to the arrangement's beat clock and choose the boundaries,
   provided you report an alignment confidence score.
3. Open PRs, merge when CI is green, and deploy by pushing to `main`.
4. Reject your own alignment and leave the base estimate-only when the signal is
   weak. A smaller honest set beats a larger unearned one.

## What you must not do

- Never write `evidence: "source"` for anything other than timed FF06/FF07 markers
  retained from the exact source MIDI. External charts are `chart`.
- Never claim musical acceptance, recognizability or playability. Those require the
  owner's ears and are out of scope.
- Do not use the owner-metadata `sections` editor to bulk-label songs. That tier means
  a deliberate human edit; bulk-writing it from an agent would launder inference as
  judgement. It stays available for the owner to correct you.
- Do not change `inferSongForm` in `packages/player-core/src/song-form.ts` except to
  fix a demonstrated regression with a test. Its uncertainty is honest, not a defect.
- Do not delete learner-blocked maps, touch `.env` or credential files, or edit the
  primary checkout (it is dirty on `codex/organ`).

## Existing tooling

Run everything from an isolated worktree with Node 22.22.3.

```sh
npm ci
npm run audit:sections -w @keyspilli/catalog
npm run extract:ug-sections -w @keyspilli/catalog -- <saved-tab.html>
npm run typecheck
npm test
npm run build
```

- `audit:sections` is the ledger and integrity gate. It classifies every known base into
  `mapped-source`, `mapped-chart`, `marker-harvest`, `ug-candidate` or
  `estimate-only`, and exits non-zero when a map can never resolve or is structurally
  invalid. It runs in CI.
- `data/` is gitignored, so `data/seed-midi` is absent in a fresh checkout. Use
  `--seed-dir <path>` to scan one from another checkout. Seed MIDI does exist in CI
  because `fetch-seed` runs first.
- `extract:ug-sections` takes a locally saved Ultimate Guitar page (no network, no
  scraping at build time) and prints ordered headings plus chord names. It deliberately
  never emits beats.
- The owner panel accepts one section per line: `Label startBeat endBeat`.

## The missing piece: chart-to-arrangement alignment

This is the real work. Nothing in the repo does it yet; build
`packages/catalog/scripts/align-chart-sections.ts` as step one.

Input: chart labels and chord sequence (from the extractor), plus the base's seed MIDI and
`data/artifacts/<base>/a/notes.json`. Output: a candidate map entry, a confidence score,
and a printed rationale.

What worked for Queen and should be the starting method:

1. Split the arrangement into fixed 8-bar phrases over `measures`, matching the grid that
   `inferSongForm` uses.
2. For each phrase build a pitch-class vector and density from note onsets, exactly as
   `inferSongForm` does.
3. Score every (chart section, phrase run) pair by per-measure harmony match against that
   section's chord set, adding a bass-root mismatch penalty.
4. Run an ordered DP that assigns phrases to sections in chart order, each section taking
   at least one phrase. Report total cost per assignment.
5. Validate against independent landmarks before trusting it. Queen's Bridge was
   independently confirmed by the chart's C-C7-F-Fm-A7-D span landing at bars 48-63.

What failed and must not be reused: a monotonic chord-by-chord DP over the whole piece. It
degenerated, either burning chords in the first measure or stalling far short of the final
chord, and its section starts collapsed onto the same position.

Confidence rule: solve for the best assignment and for plausible alternatives (for example,
several Outro start points). If the best and next-best total costs differ by less than roughly
0.15, treat the span as ambiguous: drop that boundary or ship the base as estimate-only and
record it for later review. Queen's tail differed by about 0.10, which is why its interior
boundaries are marked un-auditioned.

## Execution sequence

1. Build the alignment helper; unit-test it on Queen and reproduce the Bridge landmark at
   bars 48-63.
2. Work the 42 `source: ug-tabs` manifest rows first: extract, align, validate, write
   `chart` entries with confidence scores.
3. Only then consider the remaining UG candidates. Report coverage gained per batch.
4. Classical (109 bases) has no UG coverage. Leave it to the estimator or acquire a real
   source; do not fabricate a form.
5. Batch into focused PRs. One PR per 10-20 maps keeps review honest.

Entry shape (see the Queen entry in `catalog/song-sections.json`): `baseId`,
`sourceArtifactHash` (64 lowercase hex), `playbackTempoBpm`, `sourceFile`,
`provenance`, and `sections` of `{id,label,startBeat,endBeat,type,evidence}`.

Omit `advancedNotesSha256` unless you have the production `notes.json` bytes. Local
`data/artifacts` is stale relative to production, and pinning a stale hash makes the map
silently never match.

## Hazards already hit

- **CI ordering.** `audit:sections` must stay in `.github/workflows/ci.yml` immediately
  after `npm ci` and before `fetch-seed`/`npm run pipeline`. The pipeline regenerates
  `catalog/manifest.json`, and checking against the regenerated subset falsely rejects
  valid maps. This cost one CI cycle.
- **GHCR pulls.** A stale `ghcr.io` credential in `/root/.docker/config.json` or
  `/home/deploy/.docker/config.json` overrides anonymous access to a public package and
  produces `403 denied` during deploy, which auto-rolls back. The playbook has no
  `docker login`. If a deploy fails this way, back up and remove the `ghcr.io` auth entry
  from both paths, verify a plain `docker pull`, then rerun the failed job. Do not handle or
  rotate secrets. Last known state: both empty after the 2026-10-08 deploy, but something
  rewrote root's entry at 2026-10-07T21:09:43Z, so the writer is unknown.
- **False dead maps.** A base that 404s on `/api/songs/<id>` may still exist in the DB
  behind a learner-block check. Confirm against `db.sqlite` first.
- **Playwright configs.** `owner-metadata.spec.ts` runs under
  `--config=playwright.roadmap.config.ts`, not the default config. CI caught a preview-text
  regression that local unit tests missed.

## Acceptance gates

For every PR:

- `npm run audit:sections -w @keyspilli/catalog` reports 0 errors.
- `npm run typecheck`, `npm test`, `npm run build` pass.
- CI `Automatic checks` and `container-smoke` are SUCCESS and merge state is CLEAN before
  merging.
- Coverage delta is stated in the PR body: mapped bases before, after, and which bases were
  rejected for low confidence.

After deploy:

- `/api/health` reports the new commit and both containers healthy.
- Read back a sample of newly mapped songs from localhost `/api/songs/<id>` and confirm the
  labels and `evidence: "chart"`.
- Confirm no `Section N` label appears anywhere in a catalog-wide sweep.

## Explicit non-claims

No output of this work establishes musical acceptance, source authority, recognizability, or
playability. Chart maps state in `provenance` that boundaries were aligned to arrangement
harmony, are not timed markers, and are not recording timestamps. Any low-confidence or
un-auditioned spans should be listed in the PR body for a later owner listening pass.
