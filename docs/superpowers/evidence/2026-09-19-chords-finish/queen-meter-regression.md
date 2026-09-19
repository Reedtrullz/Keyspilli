# Queen meter regression — T2 evidence

Source review is anchored to `/Users/reidar/Documents/Codex/2026-09-19/chords-mode-source-evidence/outputs/queen-meter-regression-spec.md` and its JSON companion.

- Raw source SHA-256: `4505d3a7cb3c...` (full digest is recorded in the external spec).
- Raw source size: 64,763 bytes; MIDI format 1; 12 tracks; division 384.
- Track 0 declares 2/4 at tick 0 / beat 0, then 6/8 at tick 4608 / beat 12.
- The previous parser exposed only the final `[6,8]` tuple, and the previous variant builder therefore segmented measures at `[0,3,6,9,12]`.
- The expected starts are `[0,2,4,6,8,10,12,15,18,...]` only when the phase has been independently validated. Meter events alone do not prove pickup or downbeat phase.

The implementation now retains `MidiTimeSignatureEvent[]` through parsing, variant construction, and catalog notes metadata. Sparse backing accepts a timeline only through explicit, fingerprinted `source-measure-boundary` metadata. The catalog preserves declarations as `timeSigEvents` without promoting them to `sourceTiming`.

Focused checks cover:

- `packages/midi/test/time-signature-events.test.ts`
- `packages/player-core/test/melody-accompaniment.test.ts`
- `apps/web/src/lib/catalog-api.test.ts`
- `apps/web/e2e/melody-accompaniment.spec.ts`

Non-claim: this checkpoint fixes timing transport and segmentation only. It does not establish Queen phase, melody selection, musical quality, listening acceptance, or keyboard acceptance.
