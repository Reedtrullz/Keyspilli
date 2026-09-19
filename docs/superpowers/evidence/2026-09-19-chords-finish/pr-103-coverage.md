# Draft PR #103 coverage — 19 September 2026

Branch: `codex/finish-chords-mode`  
Base: `origin/main` / `881881b8f9b9f8bc75f70dd4d6a551de6e62de6e`  
Head: `abf9abd`  
Scope: 24 commits, 70 changed files. This matrix covers the whole PR, not
only the later Queen source-candidate experiment.

## Current disposition

Engineering evidence is substantially complete for the scoped timing,
producer, UI, comparison, practice, and export-boundary work. The musical
goal is not complete: no required-song default output has received semantic
melody approval, listening acceptance, or physical-keyboard acceptance. The
PR must remain draft and must not be merged or deployed from this evidence.

## T1–T7 coverage

| Task | Full-PR evidence | Status | Remaining limit |
|---|---|---|---|
| T1 — source freeze and contracts | `manifest.json`, `source-contract.md`, `findings.md`, `queen-meter-regression.md`; five pinned targets, source/artifact hashes, tempos, chart coverage, and explicit unknown phase/melody decisions. `t3-canonical-loader-evaluation.md` replays all five copied canonical artifacts with hash assertions. | Partial — structural source freeze verified. | Queen/Oops/Blackbird melody identity and authored phase remain unverified; Your Song is partial-chart; Hell is a negative control. G1 is not passed. |
| T2 — timing through parser/catalog/player/worker | `MidiTimeSignatureEvent[]` is carried through MIDI parsing, variant construction, roundtrip/catalog metadata, source-timing validation, Player/worker options, and request fingerprints. `queen-meter-regression.md`, `source-timing.test.ts`, `timeline.test.ts`, `time-signature-events.test.ts`, catalog tests, and the runtime checkpoint cover the path. | Engineering path verified. | Meter declarations do not prove pickup/downbeat phase. No target gets phase gestures without explicit fingerprinted `sourceTiming`; musical G1 remains open. |
| T3 — automatic reduction, rhythm, and mechanical safety | Shared `buildMelodyAccompaniment` changes and regressions cover phrase overrides, rests, seams, coherent-phrase limits, source support, sparse timing, hand/span diagnostics, and final allocated events. `t3-canonical-loader-evaluation.md` gives default/conservative full-song summaries for all five targets. `source-candidate-comparison.md` freezes Queen importer lineage and exact default invariance. | Structural producer checks verified; musical gate partial. | Two melody hypotheses failed and triggered source investigation. The removed `8916ae3` player identity-anchor hook is historical failure evidence only. No default improvement is established for the three required songs; the Queen importer candidate is not a promoted Chords arrangement. |
| T4 — simple controls, truthful outcomes, saved state | `SoundControls.tsx`, arrangement status, Player preference/reset paths, catalog/song-update handling, focused component/runtime tests, and the runtime checkpoint cover ordinary controls before Advanced disclosure, truthful result categories, saved settings, reset scope, and hand-volume labels. | Engineering behavior covered by focused tests/build. | G3 still needs parent review of the full default UX/geometry/accessibility contract; status/tests do not establish musical usefulness. |
| T5 — same-passage A/B and transport safety | `Player.tsx`, preview lifecycle fixes, `previewPlan` empty-window regression, A/B bounds/identity tests, cancellation on source/mode/seek/navigation changes, worker/stale-reply cases, and the melody Playwright slice. | Mostly verified structurally. | Repeat-practice cancellation remains defensive/instrumentation-limited: mutation evidence did not prove the aggregate stop-count assertion is boundary-specific, and native modal reachability was not established. This is not a musical acceptance claim. |
| T6 — practice, sheet, labels, and export contracts | Runtime checkpoint verifies Chord-mode practice targets the derived arrangement and falling/labels/guidance paths use the active result. `DownloadDialog.tsx`, `BeginnerView.tsx`, `LeadSheetView.tsx`, engine tests, and E2E checks label sheet/download views as Original-backed when Chord mode is selected. | Contract and projection behavior verified. | Derived sheet/export generation is intentionally not implemented in this round; Original-backed output is disclosed, not silently treated as Chord output. G3 remains partial. |
| T7 — verification, review packet, and honest PR | Full workspace `npm test`, `npm run typecheck`, `npm run build`, scoped diagnostics, exact hashes, OGG/SoundFont/encoder provenance, draft PR, this matrix, and source-review packet. | Engineering verification complete for this scope; final gate open. | Human listening, target-tempo physical keyboard review, semantic source-role approval, and required-song musical acceptance are not complete. No merge/deploy. |

## G1–G4 gate status

| Gate | Disposition | Evidence | Why it is not a release/acceptance pass |
|---|---|---|---|
| G1 — source contract and feasible automatic path | Partial | Pinned manifests, canonical loader replay, meter-event transport, fail-closed timing validation, and raw Queen `-CANTO-` lineage. | Source identity and authored phase are still unknown on required material; a right-hand/staff/source label is not melody truth. |
| G2 — producer/player integration and complete-song structural evidence | Partial | Sync/worker/player bridge, default/conservative five-target evaluator, final-event diagnostics, disposable Chords bridge, and default digest invariance. | The default Queen bridge remains `2128` vs `2186` events and `241.250` vs `289.125` fallback beats for current/candidate; the candidate changes texture and does not demonstrate useful arrangement. Structural output is not musical acceptance. |
| G3 — default UX, A/B, and consistent practice | Partial | Focused UI/runtime tests, browser slices, same-target A/B traces, practice-target checks, and explicit Original export labels. | Full human UX/accessibility review and derived export acceptance are not complete; transport instrumentation has one known reachability/test-specific limit. |
| G4 — final diff, musical packet, and actual acceptance | Open | Full diff reviewed into this matrix; source/audio packet is reproducible and bounded. | No reviewer has supplied semantic melody, listening, or keyboard judgments for the required repertoire. Draft PR stays open. |

## Verification run at `abf9abd`

With Node `v22.22.3`:

- `npm test`: web `229`, catalog `1102`, engrave `8`, MIDI `405`, player-core `283`, and transcribe `95` tests passed (`2122` total; `209` files).
- `npm run typecheck`: all workspace typechecks passed.
- `npm run build`: Next.js production build passed.
- Source diagnostic: pinned hashes, all-target unset/empty/default invariance, normalized lineage, and synthetic merge/early-reject regression passed.
- Chords bridge: disposable `loadSongArtifact → projectChordSources → buildMelodyAccompaniment` replay passed with canonical `comparisonDurationBeats=540` (`537.5` note end plus `2.5` terminal timeline pad).
- Strict TypeScript checks and `git diff --check` passed.

These checks establish engineering integrity only. They do not establish
recognizability, useful harmony, comfortable fingering, pedal cleanliness,
balance, or human acceptance.

## Concrete remaining source-review action

Use [`source-review-packet.md`](source-review-packet.md) and answer one bounded
question in beat ranges, without editing source files:

> In the importer-only comparison at Queen `108 BPM`, does the raw FF01
> `-CANTO-` lane in `candidate-full.ogg`/`candidate-diagnostic-18-30-beats.ogg`
> read as the intended melody more reliably than `replay-full.ogg`, and which
> exact beat ranges still contain missing, extra, or role-conflicted melody?

The question has two explicitly separate layers:

1. **Importer/source layer:** Original, current replay, and protected candidate
   OGG/MIDI artifacts show source/importer retention only. A reviewer may mark
   raw-lane identity, rests, and phrase boundaries, or reject the mapping.
2. **Chords producer layer:** The live bridge is default-only. Its current vs
   protected-importer-candidate structural summary is `2128/968` vs
   `2186/1008` output events/attacks, `241.250/289.125` fallback beats, and
   `91/104` unresolved spans. No OGG in the packet is claimed to be the
   Chords-producer output. Do not infer producer usefulness from importer audio.

The required response is a source-role/phrase decision with exact beat ranges,
not a request for another generic selector tweak. If the mapping is rejected,
retain Original on unresolved spans and keep automatic melody inferred/reviewable.

## Explicit non-claims

- The historical `8916ae3` player selector experiment is not in the current
  runtime API or live bridge.
- The importer `protectedIdentitySources` diagnostic remains isolated to the
  source-evidence path; it is not catalog ingestion or Player default behavior.
- No catalog-wide rebuild, source mutation, merge, deployment, or production
  verification was performed.
