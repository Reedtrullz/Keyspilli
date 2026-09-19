# Chord mode finish findings — evidence ledger

Baseline: 881881b8f9b9f8bc75f70dd4d6a551de6e62de6e
Evidence scope: source freeze, structural implementation, and later bounded musical review. Empty or pending acceptance cells are not passes.

| ID | Finding | Severity | Owning task | Required check | Current status / limit |
|---|---|---:|---|---|---|
| F1 | Default practice surface exposes source, melody, phrase, audition, and provenance controls before ordinary practice controls. | P1 | T4 | Fresh-entry component/browser assertions at 390x844, 926x390, 1550x560, and 200% zoom; keyboard disclosure and status-announcement checks. | Open at T1. Advanced disclosure must preserve existing callbacks and ordinary instruments/gains/pedal. |
| F2 | Outcome copy can call support generated when the realized result is source-retained, label-only, balance-only, or unavailable. | P1 | T4 | Final-event change summary tests covering reduction, balance-only, partial retention, unchanged, unavailable, pending, and generated-label-only. | Open at T1. Do not derive status from selected source alone. |
| F3 | Arrangement preview is a four-beat/current-window action and has an unrelated C-major empty fallback; no same-passage Original/Chord comparison exists. | P1 | T5 | Empty-window silence, identical bounds, cancellation, state restoration, rapid A/B, pedal tails, seek, instrument changes, and 100/100 gain checks. | Open at T1. Remove generic C-major arrangement fallback; keep any instrument sound test separate. |
| F4 | Validated sparse meter-phase support exists in player-core but the production sync/worker path currently does not carry it. | P1 | T2 | Pickup/unknown/changed timing, sync-worker parity, request-key invalidation, and real-loader/player fixture with dense supported, simple, and unknown cases. | T2 checkpoint: timing now reaches sync/worker/request-key paths and the real disposable loader/worker check passes; phase remains unknown without explicit validated metadata. |
| F5 | Current “phrases” are structural intervals and review navigation only targets the playhead interval. | P2 | T4 | Grouped readable intervals, stable edit target, next/previous/loop/revert, exact underlying override/fingerprint preservation. | Open at T1. Keep phrase-local correction behavior; do not build a general score editor. |
| F6 | Physical hand buses, musical audition roles, and reset scope are conflated. | P2 | T4/T5 | Routing-label tests, retained-unclassified audition disclosure, legacy preference migration, per-song reset, variant switching, and temporary A/B state isolation. | Open at T1. Do not reroute audio merely to match old labels or erase instrument/mix settings. |
| F7 | Occupancy/span/velocity/pedal guards do not establish target-tempo fingering, jumps, repeated attacks, pedal cleanliness, or balance. | P2 | T3/T7 | Final allocated-event diagnostics plus declared-tempo checks for dense melody, wide movement, repetitions, seams, and pedal on/off; separate listening and keyboard review. | Open at T1. Structural results remain engineering evidence, never automatic playability acceptance. |
| F8 | Source identity/rest evidence is incomplete for automatic melody promotion. | P1 | T1/T3 | Full-source inspection, bounded source recovery if justified, no hand-label shortcut, and two-failed-iteration source investigation rule. | Open at T1. Queen’s current importer replay uniquely traces all 278 raw CANTO roots: 129 are rejected before Advanced output and 38 undergo non-grid transforms, but no semantic role is promoted. The bounded protected-root candidate retains 248/278 roots but still drops 30 and changes accompaniment, so it is review evidence rather than completion. Its 34-semitone RH and 28-semitone LH top-voice leaps remain material playability diagnostics despite the 12-semitone span cap. Oops backup staff/voice is recoverable but has no semantic legend; Blackbird worksheet remains reviewer-owned; Somebody/Your Song/Hell have no runtime semantic melody contract. |
| F9 | Queen changes from 2/4 at beat 0 to 6/8 at beat 12; the old scalar parser exposed only the final tuple and produced incorrect arithmetic measure starts. | P1 | T2 | Preserve the meter-event timeline through parse, variant, and source metadata; segment measures at event boundaries; do not infer phase from declarations alone. | T2 transport/segmentation is fixed and scalar consumers use the stored measure map where available; `sourceTiming` remains restricted to explicit fingerprinted source-measure-boundary metadata. Queen phase and melody remain unresolved. |

## Historical boundaries carried forward

- Existing available-hand allocation and phrase-local correction workflow are present; neither is reclassified as a missing feature.
- Source-only preview explicitly does not repair attack grids or prove physical playability.
- Existing source safeguards and original-retained fallback behavior remain required.
- Generated-note counts, changed counts, waveform hashes, and CI are descriptive/integrity evidence only; none is a musical acceptance quota.

## Gate decisions

- G1 source freeze: exact source evidence is pinned; meter-event transport is explicit, while timing phase and automatic melody identity remain unresolved.
- G2 producer/player path: T2 focused tests, typechecks, build, and a real disposable loader/worker check pass; T3 remains.
- G3 default UX/A-B: not yet assessed at this checkpoint.
- G4 final musical/keyboard acceptance: not started; cannot be inferred from T1.
